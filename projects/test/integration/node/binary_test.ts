/**
 * Binary data integration tests: VARBINARY(max) + FILESTREAM.
 * VARBINARY tests run on all platforms.
 * FILESTREAM tests only run on Windows with FILESTREAM support.
 * @module
 */

import { describe, test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTestEnv, skipFilestream, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

const TEST_CONTENT =
  "Hello, world! \u{1F30D}\u{1F389} H\u00E9llo \u00E9mojis: \u{1F680}\u{1F4BB}\u{1F3B5} \u65E5\u672C\u8A9E\u30C6\u30B9\u30C8 caf\u00E9 na\u00EFve r\u00E9sum\u00E9";
const TEST_BYTES = new TextEncoder().encode(TEST_CONTENT);

/** Decode base64 string to Uint8Array. */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe("filestreamAvailable", () => {
  test("returns false on non-Windows", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    if (env.isWindows) return;
    await using cn = await mssql.connect(env.connectionString);
    strictEqual(await cn.fs.available(), false);
  });

  test("via pool", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    if (env.isWindows) return;
    await using pool = await mssql.createPool(env.connectionString);
    strictEqual(await pool.filestreamAvailable(), false);
  });

  test("with explicit database name", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const defaultResult = await cn.fs.available();
    const explicitResult = await cn.fs.available("MSSQLTS_TEST");
    const bracketResult = await cn.fs.available("[MSSQLTS_TEST]");
    strictEqual(defaultResult, explicitResult);
    strictEqual(defaultResult, bracketResult);
  });
});

describe("VARBINARY(max)", () => {
  test("round-trip with emoji", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #vb_roundtrip (
      id INT IDENTITY PRIMARY KEY,
      data VARBINARY(MAX)
    )`);

    await cn.execute("INSERT INTO #vb_roundtrip (data) VALUES (@data)", {
      data: { value: TEST_BYTES, type: "varbinary" },
    });

    const row = await cn.querySingle<{ data: string }>(
      "SELECT data FROM #vb_roundtrip WHERE id = 1",
    );

    const decoded = fromBase64(row.data);
    strictEqual(new TextDecoder().decode(decoded), TEST_CONTENT);
  });

  test("NULL and empty", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #vb_null (
      id INT IDENTITY PRIMARY KEY,
      data VARBINARY(MAX)
    )`);

    await cn.execute("INSERT INTO #vb_null (data) VALUES (NULL)");
    // Empty VARBINARY works via parameterized value
    await cn.execute(
      "INSERT INTO #vb_null (data) VALUES (@data)",
      { data: { value: new Uint8Array(0), type: "varbinary" } },
    );

    const rows = await cn.query<{ data: string | null }>(
      "SELECT data FROM #vb_null ORDER BY id",
    );
    strictEqual(rows[0].data, null);
    if (rows[1].data !== null) {
      strictEqual(fromBase64(rows[1].data).length, 0);
    }
  });

  test("file round-trip", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const tmpDir = await mkdtemp(join(tmpdir(), "mssql-test-"));
    try {
      const tmpInput = join(tmpDir, "input.bin");
      const tmpOutput = join(tmpDir, "output.bin");

      await writeFile(tmpInput, TEST_BYTES);

      await cn.execute(`CREATE TABLE #vb_file (
        id INT IDENTITY PRIMARY KEY,
        data VARBINARY(MAX)
      )`);

      const inputBytes = await readFile(tmpInput);
      await cn.execute("INSERT INTO #vb_file (data) VALUES (@data)", {
        data: { value: new Uint8Array(inputBytes), type: "varbinary" },
      });

      const row = await cn.querySingle<{ data: string }>(
        "SELECT data FROM #vb_file WHERE id = 1",
      );
      await writeFile(tmpOutput, fromBase64(row.data));

      const outputBytes = await readFile(tmpOutput);
      strictEqual(new TextDecoder().decode(outputBytes), TEST_CONTENT);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("via BinaryFiles table", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const tableExists =
      (await cn.scalar<number>(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'BinaryFiles'",
      )) ?? 0;
    if (!tableExists) return;

    const testName = `test_vb_${Date.now()}.bin`;

    try {
      await cn.execute(
        "INSERT INTO dbo.BinaryFiles (file_name, file_data) VALUES (@name, @data)",
        {
          name: testName,
          data: { value: TEST_BYTES, type: "varbinary" },
        },
      );

      const row = await cn.querySingle<{ file_data: string }>(
        "SELECT file_data FROM dbo.BinaryFiles WHERE file_name = @name",
        { name: testName },
      );

      strictEqual(
        new TextDecoder().decode(fromBase64(row.file_data)),
        TEST_CONTENT,
      );
    } finally {
      await cn
        .execute(
          "DELETE FROM dbo.BinaryFiles WHERE file_name = @name",
          { name: testName },
        )
        .catch(() => {});
    }
  });
});

describe("blob streaming", () => {
  test("write + read via node:stream", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #blob_stream (
      id INT IDENTITY PRIMARY KEY, data VARBINARY(MAX)
    )`);
    await cn.execute("INSERT INTO #blob_stream (data) VALUES (0x)");

    // Write
    {
      await using tx = await cn.beginTransaction();
      const writable = cn.blob.filestream.write(tx, {
        table: "#blob_stream", column: "data",
        where: "id = 1", chunkSize: 64,
      });
      const mid = Math.floor(TEST_BYTES.length / 2);
      writable.write(TEST_BYTES.slice(0, mid));
      writable.end(TEST_BYTES.slice(mid));
      await new Promise<void>((resolve, reject) => {
        writable.on("finish", resolve);
        writable.on("error", reject);
      });
      await tx.commit();
    }

    // Read
    {
      await using tx = await cn.beginTransaction();
      const readable = cn.blob.filestream.read(tx, {
        table: "#blob_stream", column: "data",
        where: "id = 1", chunkSize: 64,
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of readable) {
        chunks.push(chunk);
      }
      await tx.commit();

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { result.set(c, offset); offset += c.length; }
      strictEqual(new TextDecoder().decode(result), TEST_CONTENT);
    }
  });

  test("write + read via web streams", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #blob_web (
      id INT IDENTITY PRIMARY KEY, data VARBINARY(MAX)
    )`);
    await cn.execute("INSERT INTO #blob_web (data) VALUES (0x)");

    // Write
    {
      await using tx = await cn.beginTransaction();
      const ws = cn.blob.webstream.write(tx, {
        table: "#blob_web", column: "data", where: "id = 1",
      });
      const writer = ws.getWriter();
      await writer.write(TEST_BYTES);
      await writer.close();
      await tx.commit();
    }

    // Read
    {
      await using tx = await cn.beginTransaction();
      const rs = cn.blob.webstream.read(tx, {
        table: "#blob_web", column: "data", where: "id = 1",
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of rs) { chunks.push(chunk); }
      await tx.commit();

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { result.set(c, offset); offset += c.length; }
      strictEqual(new TextDecoder().decode(result), TEST_CONTENT);
    }
  });
});

describe("FILESTREAM", () => {
  test("pipeline via node:stream", { skip: skipFilestream }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const testName = `test_fs_pipeline_${Date.now()}.bin`;
    const tmpDir = await mkdtemp(join(tmpdir(), "mssql-fs-"));
    const tmpInput = join(tmpDir, "input.bin");
    const tmpOutput = join(tmpDir, "output.bin");

    try {
      await writeFile(tmpInput, TEST_BYTES);

      // Write: insert row, then pipeline file -> FILESTREAM
      {
        await using tx = await cn.beginTransaction();
        await cn.execute(
          `INSERT INTO dbo.BinaryFiles (file_name, file_data)
           VALUES (@name, CAST('' AS VARBINARY(MAX)))`,
          { name: testName },
          { transaction: tx },
        );

        const info = await cn.querySingle<{ path: string; ctx: string }>(
          `SELECT file_data.PathName() AS path,
                  GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
             FROM dbo.BinaryFiles WHERE file_name = @name`,
          { name: testName },
          { transaction: tx },
        );

        const source = createReadStream(tmpInput);
        const writable = cn.fs.open(info.path, info.ctx, "write");
        await pipeline(source, writable);
        await tx.commit();
      }

      // Read: pipeline FILESTREAM -> file
      {
        await using tx = await cn.beginTransaction();
        const info = await cn.querySingle<{ path: string; ctx: string }>(
          `SELECT file_data.PathName() AS path,
                  GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
             FROM dbo.BinaryFiles WHERE file_name = @name`,
          { name: testName },
          { transaction: tx },
        );

        const readable = cn.fs.open(info.path, info.ctx, "read");
        const dest = createWriteStream(tmpOutput);
        await pipeline(readable, dest);
        await tx.commit();
      }

      // Compare
      const output = await readFile(tmpOutput);
      strictEqual(new TextDecoder().decode(output), TEST_CONTENT);
    } finally {
      await cn
        .execute(
          "DELETE FROM dbo.BinaryFiles WHERE file_name = @name",
          { name: testName },
        )
        .catch(() => {});
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("via web streams", { skip: skipFilestream }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const testName = `test_fs_webstream_${Date.now()}.bin`;

    try {
      // Write via web stream
      {
        await using tx = await cn.beginTransaction();
        await cn.execute(
          `INSERT INTO dbo.BinaryFiles (file_name, file_data)
           VALUES (@name, CAST('' AS VARBINARY(MAX)))`,
          { name: testName },
          { transaction: tx },
        );

        const info = await cn.querySingle<{ path: string; ctx: string }>(
          `SELECT file_data.PathName() AS path,
                  GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
             FROM dbo.BinaryFiles WHERE file_name = @name`,
          { name: testName },
          { transaction: tx },
        );

        const writable = cn.fs.openWeb(info.path, info.ctx, "write");
        const writer = writable.getWriter();
        await writer.write(TEST_BYTES);
        await writer.close();
        await tx.commit();
      }

      // Read via web stream
      {
        await using tx = await cn.beginTransaction();
        const info = await cn.querySingle<{ path: string; ctx: string }>(
          `SELECT file_data.PathName() AS path,
                  GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
             FROM dbo.BinaryFiles WHERE file_name = @name`,
          { name: testName },
          { transaction: tx },
        );

        const readable = cn.fs.openWeb(info.path, info.ctx, "read");
        const reader = readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        await tx.commit();

        // Concatenate chunks and compare
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          result.set(c, offset);
          offset += c.length;
        }
        strictEqual(new TextDecoder().decode(result), TEST_CONTENT);
      }
    } finally {
      await cn
        .execute(
          "DELETE FROM dbo.BinaryFiles WHERE file_name = @name",
          { name: testName },
        )
        .catch(() => {});
    }
  });
});

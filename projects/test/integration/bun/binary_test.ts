/**
 * Binary data integration tests: VARBINARY(max) + FILESTREAM.
 * VARBINARY tests run on all platforms.
 * FILESTREAM tests only run on Windows with FILESTREAM support.
 * @module
 */

import { describe, expect, test } from "bun:test";
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
  test.skipIf(skipMssql)("returns false on non-Windows", async () => {
    const env = getTestEnv();
    if (env.isWindows) return;
    await using cn = await mssql.connect(env.connectionString);
    expect(await cn.filestreamAvailable()).toBe(false);
  });

  test.skipIf(skipMssql)("via pool", async () => {
    const env = getTestEnv();
    if (env.isWindows) return;
    await using pool = await mssql.createPool(env.connectionString);
    expect(await pool.filestreamAvailable()).toBe(false);
  });

  test.skipIf(skipMssql)("with explicit database name", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const defaultResult = await cn.filestreamAvailable();
    const explicitResult = await cn.filestreamAvailable("MSSQLTS_TEST");
    const bracketResult = await cn.filestreamAvailable("[MSSQLTS_TEST]");
    expect(defaultResult).toBe(explicitResult);
    expect(defaultResult).toBe(bracketResult);
  });
});

describe("VARBINARY(max)", () => {
  test.skipIf(skipMssql)("round-trip with emoji", async () => {
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
    expect(new TextDecoder().decode(decoded)).toBe(TEST_CONTENT);
  });

  test.skipIf(skipMssql)("NULL and empty", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #vb_null (
      id INT IDENTITY PRIMARY KEY,
      data VARBINARY(MAX)
    )`);

    await cn.execute("INSERT INTO #vb_null (data) VALUES (NULL)");
    // Empty VARBINARY can't be sent as a parameterized value (mssql-client v0.6 driver
    // limitation: sends VARBINARY(0) which SQL Server rejects). Use SQL literal instead.
    await cn.execute(
      "INSERT INTO #vb_null (data) VALUES (CAST(0x AS VARBINARY(MAX)))",
    );

    const rows = await cn.query<{ data: string | null }>(
      "SELECT data FROM #vb_null ORDER BY id",
    );
    expect(rows[0].data).toBeNull();
    if (rows[1].data !== null) {
      expect(fromBase64(rows[1].data).length).toBe(0);
    }
  });

  test.skipIf(skipMssql)("file round-trip", async () => {
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
      expect(new TextDecoder().decode(outputBytes)).toBe(TEST_CONTENT);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test.skipIf(skipMssql)("via BinaryFiles table", async () => {
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

      expect(new TextDecoder().decode(fromBase64(row.file_data))).toBe(
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

describe("FILESTREAM", () => {
  test.skipIf(skipFilestream)("pipeline via node:stream", async () => {
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
        const writable = cn.openFilestream(info.path, info.ctx, "write");
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

        const readable = cn.openFilestream(info.path, info.ctx, "read");
        const dest = createWriteStream(tmpOutput);
        await pipeline(readable, dest);
        await tx.commit();
      }

      // Compare
      const output = await readFile(tmpOutput);
      expect(new TextDecoder().decode(output)).toBe(TEST_CONTENT);
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

  test.skipIf(skipFilestream)("via web streams", async () => {
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

        const writable = cn.openWebstream(info.path, info.ctx, "write");
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

        const readable = cn.openWebstream(info.path, info.ctx, "read");
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
        expect(new TextDecoder().decode(result)).toBe(TEST_CONTENT);
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

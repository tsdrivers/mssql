/**
 * Binary data integration tests: VARBINARY(max) + FILESTREAM.
 * VARBINARY tests run on all platforms.
 * FILESTREAM tests only run on Windows with FILESTREAM support.
 * @module
 */

import { assertEquals } from "jsr:@std/assert";
import { getTestEnv, skipFilestream, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

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

// ── FILESTREAM availability checks ────────────────────────────

Deno.test({
  name: "binary - filestreamAvailable returns false on non-Windows",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    if (env.isWindows) return; // Only meaningful on non-Windows
    await using cn = await mssql.connect(env.connectionString);
    assertEquals(await cn.fs.available(), false);
  },
});

Deno.test({
  name: "binary - filestreamAvailable via pool",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    if (env.isWindows) return;
    await using pool = await mssql.createPool(env.connectionString);
    assertEquals(await pool.filestreamAvailable(), false);
  },
});

Deno.test({
  name: "binary - filestreamAvailable with explicit database name",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const defaultResult = await cn.fs.available();
    const explicitResult = await cn.fs.available("MSSQLTS_TEST");
    const bracketResult = await cn.fs.available("[MSSQLTS_TEST]");
    assertEquals(defaultResult, explicitResult);
    assertEquals(defaultResult, bracketResult);
  },
});

// ── VARBINARY(max) tests ──────────────────────────────────────

Deno.test({
  name: "binary - VARBINARY(max) round-trip with emoji",
  ignore: skipMssql,
  async fn() {
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
    assertEquals(new TextDecoder().decode(decoded), TEST_CONTENT);
  },
});

Deno.test({
  name: "binary - VARBINARY(max) NULL and empty",
  ignore: skipMssql,
  async fn() {
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
    assertEquals(rows[0].data, null);
    if (rows[1].data !== null) {
      assertEquals(fromBase64(rows[1].data).length, 0);
    }
  },
});

Deno.test({
  name: "binary - VARBINARY(max) file round-trip",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const tmpInput = await Deno.makeTempFile({ suffix: ".bin" });
    const tmpOutput = await Deno.makeTempFile({ suffix: ".bin" });

    try {
      await Deno.writeFile(tmpInput, TEST_BYTES);

      await cn.execute(`CREATE TABLE #vb_file (
        id INT IDENTITY PRIMARY KEY,
        data VARBINARY(MAX)
      )`);

      const inputBytes = await Deno.readFile(tmpInput);
      await cn.execute("INSERT INTO #vb_file (data) VALUES (@data)", {
        data: { value: inputBytes, type: "varbinary" },
      });

      const row = await cn.querySingle<{ data: string }>(
        "SELECT data FROM #vb_file WHERE id = 1",
      );
      await Deno.writeFile(tmpOutput, fromBase64(row.data));

      const outputBytes = await Deno.readFile(tmpOutput);
      assertEquals(new TextDecoder().decode(outputBytes), TEST_CONTENT);
    } finally {
      await Deno.remove(tmpInput).catch(() => {});
      await Deno.remove(tmpOutput).catch(() => {});
    }
  },
});

Deno.test({
  name: "binary - VARBINARY(max) via BinaryFiles table",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    // Skip if BinaryFiles table doesn't exist (db-setup not run)
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

      assertEquals(
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
  },
});

// ── Blob streaming tests (cross-platform) ───────────────────

Deno.test({
  name: "binary - blob stream write + read via node:stream",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #blob_stream (
      id INT IDENTITY PRIMARY KEY,
      data VARBINARY(MAX)
    )`);

    // Insert row with empty binary
    await cn.execute("INSERT INTO #blob_stream (data) VALUES (0x)");

    // Write via blob stream
    {
      await using tx = await cn.beginTransaction();
      const writable = cn.blob.filestream.write(tx, {
        table: "#blob_stream",
        column: "data",
        where: "id = 1",
        chunkSize: 64, // small chunks to test multi-chunk
      });
      // Write in two chunks
      const mid = Math.floor(TEST_BYTES.length / 2);
      writable.write(TEST_BYTES.slice(0, mid));
      writable.end(TEST_BYTES.slice(mid));
      await new Promise<void>((resolve, reject) => {
        writable.on("finish", resolve);
        writable.on("error", reject);
      });
      await tx.commit();
    }

    // Read via blob stream
    {
      await using tx = await cn.beginTransaction();
      const readable = cn.blob.filestream.read(tx, {
        table: "#blob_stream",
        column: "data",
        where: "id = 1",
        chunkSize: 64,
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of readable) {
        chunks.push(chunk);
      }
      await tx.commit();

      // Reassemble and compare
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        result.set(c, offset);
        offset += c.length;
      }
      assertEquals(new TextDecoder().decode(result), TEST_CONTENT);
    }
  },
});

Deno.test({
  name: "binary - blob stream write + read via web streams",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute(`CREATE TABLE #blob_web (
      id INT IDENTITY PRIMARY KEY,
      data VARBINARY(MAX)
    )`);

    await cn.execute("INSERT INTO #blob_web (data) VALUES (0x)");

    // Write via web WritableStream
    {
      await using tx = await cn.beginTransaction();
      const ws = cn.blob.webstream.write(tx, {
        table: "#blob_web",
        column: "data",
        where: "id = 1",
      });
      const writer = ws.getWriter();
      await writer.write(TEST_BYTES);
      await writer.close();
      await tx.commit();
    }

    // Read via web ReadableStream
    {
      await using tx = await cn.beginTransaction();
      const rs = cn.blob.webstream.read(tx, {
        table: "#blob_web",
        column: "data",
        where: "id = 1",
      });
      const chunks: Uint8Array[] = [];
      for await (const chunk of rs) {
        chunks.push(chunk);
      }
      await tx.commit();

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        result.set(c, offset);
        offset += c.length;
      }
      assertEquals(new TextDecoder().decode(result), TEST_CONTENT);
    }
  },
});

// ── FILESTREAM tests (Windows only) ──────────────────────────

Deno.test({
  name: "binary - FILESTREAM pipeline via node:stream",
  ignore: skipFilestream,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const testName = `test_fs_pipeline_${Date.now()}.bin`;
    const tmpInput = await Deno.makeTempFile({ suffix: ".bin" });
    const tmpOutput = await Deno.makeTempFile({ suffix: ".bin" });

    try {
      await Deno.writeFile(tmpInput, TEST_BYTES);

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
      const output = await Deno.readFile(tmpOutput);
      assertEquals(new TextDecoder().decode(output), TEST_CONTENT);
    } finally {
      await cn
        .execute(
          "DELETE FROM dbo.BinaryFiles WHERE file_name = @name",
          { name: testName },
        )
        .catch(() => {});
      await Deno.remove(tmpInput).catch(() => {});
      await Deno.remove(tmpOutput).catch(() => {});
    }
  },
});

Deno.test({
  name: "binary - FILESTREAM via web streams (pipeTo)",
  ignore: skipFilestream,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const testName = `test_fs_webstream_${Date.now()}.bin`;
    const tmpInput = await Deno.makeTempFile({ suffix: ".bin" });
    const tmpOutput = await Deno.makeTempFile({ suffix: ".bin" });

    try {
      await Deno.writeFile(tmpInput, TEST_BYTES);

      // Write: pipeTo from Deno file -> FILESTREAM
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

        const wsWritable = cn.fs.openWeb(info.path, info.ctx, "write");
        const inFile = await Deno.open(tmpInput, { read: true });
        await inFile.readable.pipeTo(wsWritable);
        await tx.commit();
      }

      // Read: pipeTo from FILESTREAM -> Deno file
      {
        await using tx = await cn.beginTransaction();
        const info = await cn.querySingle<{ path: string; ctx: string }>(
          `SELECT file_data.PathName() AS path,
                  GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
             FROM dbo.BinaryFiles WHERE file_name = @name`,
          { name: testName },
          { transaction: tx },
        );

        const wsReadable = cn.fs.openWeb(info.path, info.ctx, "read");
        const outFile = await Deno.open(tmpOutput, {
          write: true,
          create: true,
        });
        await wsReadable.pipeTo(outFile.writable);
        await tx.commit();
      }

      // Compare
      const output = await Deno.readFile(tmpOutput);
      assertEquals(new TextDecoder().decode(output), TEST_CONTENT);
    } finally {
      await cn
        .execute(
          "DELETE FROM dbo.BinaryFiles WHERE file_name = @name",
          { name: testName },
        )
        .catch(() => {});
      await Deno.remove(tmpInput).catch(() => {});
      await Deno.remove(tmpOutput).catch(() => {});
    }
  },
});

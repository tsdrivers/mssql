# Blob Streaming

Stream large `VARBINARY(MAX)` data in chunks without loading the entire value
into memory. Works on **all platforms** (Windows, Linux, macOS) using standard
SQL queries under the hood.

::: tip When to Use
Use blob streaming for binary data too large to fit comfortably in a single
query result (multi-MB files, images, documents). For smaller data (< 10 MB),
standard parameterized queries are simpler — see [Binary Data](./binary).

For Windows-only FILESTREAM I/O via native file handles, see
[FILESTREAM](./filestream).
:::

## Transaction Required

All blob streams require an active transaction. This ensures consistent reads
(no partial data from concurrent writes) and atomic writes (all chunks or none).

```ts
await using tx = await cn.beginTransaction();
// ... open blob stream, read/write, then commit ...
await tx.commit();
```

## Reading (Node.js Streams)

Use `cn.blob.filestream.read` to get a `node:stream.Readable` that reads the
column in chunks via `SUBSTRING`:

```ts
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

await using cn = await mssql.connect(connectionString);
await using tx = await cn.beginTransaction();

const readable = cn.blob.filestream.read(tx, {
  table: "Documents", // "[dbo].[Documents]", "[MyDb].[Schema].[TableName]", etc.
  column: "data",
  where: "id = @id",
  params: { id: docId },
  chunkSize: 512 * 1024, // 512 KB chunks (default: 1 MB)
});

await pipeline(readable, createWriteStream("output.bin"));
await tx.commit();
```

## Writing (Node.js Streams)

Use `cn.blob.filestream.write` to get a `node:stream.Writable` that appends
chunks using SQL Server's `.WRITE` syntax:

```ts
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";

await using cn = await mssql.connect(connectionString);
await using tx = await cn.beginTransaction();

// Column must have an initial value (even empty)
await cn.execute(
  "UPDATE Documents SET data = 0x WHERE id = @id",
  { id: docId },
  { transaction: tx },
);

const writable = cn.blob.filestream.write(tx, {
  table: "Documents",
  column: "data",
  where: "id = @id",
  params: { id: docId },
});

await pipeline(createReadStream("input.bin"), writable);
await tx.commit();
```

## Reading (Web Streams)

Use `cn.blob.webstream.read` for a `ReadableStream`, ideal for Deno or any
environment that prefers Web Standard streams:

```ts
await using cn = await mssql.connect(connectionString);
await using tx = await cn.beginTransaction();

const stream = cn.blob.webstream.read(tx, {
  table: "Documents",
  column: "data",
  where: "id = @id",
  params: { id: docId },
});

// Deno: pipe to a file
const file = await Deno.open("output.bin", { write: true, create: true });
await stream.pipeTo(file.writable);
await tx.commit();
```

## Writing (Web Streams)

Use `cn.blob.webstream.write` for a `WritableStream`:

```ts
await using cn = await mssql.connect(connectionString);
await using tx = await cn.beginTransaction();

// Initialize column
await cn.execute(
  "UPDATE Documents SET data = 0x WHERE id = @id",
  { id: docId },
  { transaction: tx },
);

const stream = cn.blob.webstream.write(tx, {
  table: "Documents",
  column: "data",
  where: "id = @id",
  params: { id: docId },
});

// Deno: pipe from a file
const file = await Deno.open("input.bin", { read: true });
await file.readable.pipeTo(stream);
await tx.commit();
```

## BlobTarget Options

| Option      | Type                      | Default          | Description                                          |
| ----------- | ------------------------- | ---------------- | ---------------------------------------------------- |
| `table`     | `string`                  | _(required)_     | Table name (auto bracket-escaped)                    |
| `column`    | `string`                  | _(required)_     | VARBINARY(MAX) column name (auto bracket-escaped)    |
| `where`     | `string`                  | _(required)_     | WHERE clause identifying the row (e.g. `"id = @id"`) |
| `params`    | `Record<string, unknown>` | `{}`             | Parameters for the WHERE clause                      |
| `chunkSize` | `number`                  | `1048576` (1 MB) | Chunk size in bytes for streaming                    |

Multi-part table names are supported — each part is bracket-escaped
individually. Already-bracketed names are passed through as-is:

```ts
// All of these work:
{ table: "Documents", ... }                    // [Documents]
{ table: "dbo.Documents", ... }                // [dbo].[Documents]
{ table: "MyDB.dbo.Documents", ... }           // [MyDB].[dbo].[Documents]
{ table: "[dbo].[Documents]", ... }            // [dbo].[Documents] (unchanged)
```

## API Summary

| Method                              | Returns                | Description                    |
| ----------------------------------- | ---------------------- | ------------------------------ |
| `cn.blob.filestream.read(tx, target)`  | `node:stream.Readable` | Read VARBINARY(MAX) in chunks  |
| `cn.blob.filestream.write(tx, target)` | `node:stream.Writable` | Write VARBINARY(MAX) in chunks |
| `cn.blob.webstream.read(tx, target)`   | `ReadableStream`       | Read (Web Standard)            |
| `cn.blob.webstream.write(tx, target)`  | `WritableStream`       | Write (Web Standard)           |

### Naming Convention

The sub-object pattern mirrors the FILESTREAM API:

| Feature                        | Node.js Streams         | Web Streams             |
| ------------------------------ | ----------------------- | ----------------------- |
| FILESTREAM (Windows)           | `cn.fs.open(path, ...)`   | `cn.fs.openWeb(path, ...)` |
| Blob streaming (all platforms) | `cn.blob.filestream.*`  | `cn.blob.webstream.*`   |

## Comparison with FILESTREAM

| Feature      | Blob Streaming                       | FILESTREAM                              |
| ------------ | ------------------------------------ | --------------------------------------- |
| Platform     | All (Windows, Linux, macOS)          | Windows only                            |
| Mechanism    | SQL queries (`SUBSTRING` / `.WRITE`) | Win32 file handle (`OpenSqlFilestream`) |
| Server setup | None                                 | FILESTREAM filegroup required           |
| Dependencies | ODBC Driver 18 (already required)    | ODBC Driver 18 (already required)       |
| Performance  | Good (SQL round-trips per chunk)     | Best (direct file I/O)                  |
| Max size     | 2 GB (SQL Server VARBINARY(MAX) limit) | Unlimited (direct file I/O bypasses SQL engine) |
| Transaction  | Required                             | Required                                |

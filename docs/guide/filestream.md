# FILESTREAM

SQL Server FILESTREAM allows storing large binary data (BLOBs) directly on the
file system while maintaining transactional consistency.

::: warning Windows Only FILESTREAM is only available on Windows with the
[Microsoft ODBC Driver 18 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)
installed (required for all features).

For cross-platform streaming of large `VARBINARY(MAX)` data that works on all
platforms, see [Blob Streaming](./blob-streaming). :::

## Check Availability

Checks all three requirements: ODBC driver installed, server FILESTREAM access
level >= 2, and a FILESTREAM filegroup exists in the target database.

```ts
await using cn = await mssql.connect("Server=localhost;...");

// Check current database
if (await cn.fs.available()) {
  console.log("FILESTREAM is ready");
}

// Check a specific database
if (await cn.fs.available("MyFilestreamDB")) {
  console.log("FILESTREAM is ready on MyFilestreamDB");
}
```

Also works on pools:

```ts
await using pool = await mssql.createPool("Server=localhost;...");
if (await pool.filestreamAvailable()) {
  // ...
}
```

## Two FILESTREAM APIs

`@tsdrivers/mssql` provides two ways to work with FILESTREAM blobs via `cn.fs`:

| Method            | Returns                                      | Best for                                      |
| ----------------- | -------------------------------------------- | --------------------------------------------- |
| `cn.fs.open()`    | `node:stream` Readable / Writable / Duplex   | `pipe()`, Node.js patterns, `node:fs` interop |
| `cn.fs.openWeb()` | Web Standard ReadableStream / WritableStream | `pipeTo()`, Deno patterns, Web API interop    |

Both require an active transaction and the FILESTREAM path + transaction context
from a query.

## Getting the Path and Context

```ts
await using cn = await mssql.connect("Server=localhost;...");
await using tx = await cn.beginTransaction();

const row = await cn.querySingle<{ path: string; ctx: Uint8Array }>(
  `SELECT file_data.PathName() AS path,
          GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
     FROM Documents WHERE id = @id`,
  { id: docId },
  { transaction: tx },
);
```

## Node.js Streams (`cn.fs.open`)

Returns a `node:stream` Readable, Writable, or Duplex depending on the mode.
Works across Deno, Node.js, and Bun — all runtimes support `node:stream`.

### Read a blob

```ts
const readable = cn.fs.open(row.path, row.ctx, "read");

const chunks: Uint8Array[] = [];
for await (const chunk of readable) {
  chunks.push(chunk);
}
```

### Write a blob

```ts
const writable = cn.fs.open(row.path, row.ctx, "write");

writable.write(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
writable.end();
```

### Pipe from a local file into FILESTREAM

```ts
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const source = createReadStream("./upload.bin");
const writable = cn.fs.open(row.path, row.ctx, "write");

await pipeline(source, writable);
await tx.commit();
```

### Pipe from FILESTREAM to a local file

```ts
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const readable = cn.fs.open(row.path, row.ctx, "read");
const dest = createWriteStream("./download.bin");

await pipeline(readable, dest);
await tx.commit();
```

## Web Streams (`cn.fs.openWeb`)

Returns a Web Standard `ReadableStream` or `WritableStream`. Native in all
runtimes — ideal for Deno's file APIs and the Fetch/Streams spec.

### Read a blob

```ts
await using readable = cn.fs.openWeb(row.path, row.ctx, "read");

const reader = readable.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // value is Uint8Array
}
```

### Write a blob

```ts
await using writable = cn.fs.openWeb(row.path, row.ctx, "write");

const writer = writable.getWriter();
await writer.write(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
await writer.close();
await tx.commit();
```

### Pipe from a local file into FILESTREAM (Deno)

```ts
await using writable = cn.fs.openWeb(row.path, row.ctx, "write");

using file = await Deno.open("./upload.bin", { read: true });
await file.readable.pipeTo(writable);

await tx.commit();
```

### Pipe from FILESTREAM to a local file (Deno)

```ts
await using readable = cn.fs.openWeb(row.path, row.ctx, "read");

using file = await Deno.open("./download.bin", { write: true, create: true });
await readable.pipeTo(file.writable);

await tx.commit();
```

### Read/write mode

For `"readwrite"` mode, `cn.fs.openWeb` returns an object with both streams:

```ts
const { readable, writable } = cn.fs.openWeb(row.path, row.ctx, "readwrite"); // individual streams are disposable
```

## Close and Commit

Always commit the transaction after FILESTREAM operations:

```ts
await tx.commit();
```

Streams are automatically closed when destroyed or when the underlying handle
reaches end-of-file. You can also close explicitly by calling `.destroy()` on
Node.js streams or cancelling the Web stream.

## Advanced: Gzipped Line-Delimited JSON (NDJSON)

FILESTREAM streams compose with standard stream transforms. This example shows
how to store and retrieve records as gzip-compressed
[NDJSON](https://ndjson.org/) — useful for large log exports, audit trails, or
ETL staging that benefit from compressed structured data in the database.

### Read: FILESTREAM -> gunzip -> async iterable of T

#### Node.js streams

Uses `node:readline` whose `Interface` is already an async iterable — the
cleanest approach across all runtimes:

```ts
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import * as mssql from "@tsdrivers/mssql";

async function* readNdjsonGz<T>(
  cn: mssql.MssqlConnection,
  fileName: string,
): AsyncGenerator<T> {
  await using tx = await cn.beginTransaction();

  const info = await cn.querySingle<{ path: string; ctx: string }>(
    `SELECT file_data.PathName() AS path,
            GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
       FROM dbo.BinaryFiles WHERE file_name = @name`,
    { name: fileName },
    { transaction: tx },
  );

  const readable = cn.fs.open(info.path, info.ctx, "read");
  const gunzip = createGunzip();
  const lines = createInterface({
    input: readable.pipe(gunzip),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line) as T;
  }

  await tx.commit();
}
```

::: tip Early break If the caller exits the `for await` loop early (e.g. with
`break`), the generator's cleanup path runs and the transaction rolls back. For
reads this is safe — the rollback has no effect on data. :::

#### Web Streams (Deno-compatible)

Uses `DecompressionStream` and `TextDecoderStream` — both are standard Web APIs
available natively in Deno, Node.js 18+, and Bun:

```ts
import * as mssql from "@tsdrivers/mssql";

async function* readNdjsonGzWeb<T>(
  cn: mssql.MssqlConnection,
  fileName: string,
): AsyncGenerator<T> {
  await using tx = await cn.beginTransaction();

  const info = await cn.querySingle<{ path: string; ctx: string }>(
    `SELECT file_data.PathName() AS path,
            GET_FILESTREAM_TRANSACTION_CONTEXT() AS ctx
       FROM dbo.BinaryFiles WHERE file_name = @name`,
    { name: fileName },
    { transaction: tx },
  );

  const reader = cn.fs
    .openWeb(info.path, info.ctx, "read")
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream())
    .getReader();

  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as T;
  } finally {
    reader.releaseLock();
  }

  await tx.commit();
}
```

### Consuming the async iterable

Both `readNdjsonGz` and `readNdjsonGzWeb` return an async generator that streams
records one at a time without buffering the entire file in memory:

```ts
interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

// Process records one by one
for await (const entry of readNdjsonGz<LogEntry>(cn, "audit-2024.ndjson.gz")) {
  console.log(entry.ts, entry.level, entry.msg);
}

// Collect into an array (loads all into memory)
const entries = await Array.fromAsync(
  readNdjsonGz<LogEntry>(cn, "audit-2024.ndjson.gz"),
);

// Filter/transform inline
for await (const entry of readNdjsonGz<LogEntry>(cn, "audit-2024.ndjson.gz")) {
  if (entry.level === "error") await notifyOpsTeam(entry);
}
```

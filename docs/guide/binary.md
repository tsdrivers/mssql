# Binary Data (VARBINARY)

SQL Server `VARBINARY(MAX)` columns store raw binary data. The driver transports
binary across the FFI boundary as base64 strings, so both writing and reading
require a small encoding step.

## Writing Binary Data

Pass a `Uint8Array` with `type: "varbinary"`. **The type hint is required** —
without it the value is treated as an NVARCHAR string:

```ts
const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

await cn.execute("INSERT INTO Files (data) VALUES (@data)", {
  data: { value: bytes, type: "varbinary" },
});
```

Reading a file and storing it:

```ts
import { readFile } from "node:fs/promises";

const bytes = new Uint8Array(await readFile("./upload.bin"));

await cn.execute("INSERT INTO Files (name, data) VALUES (@name, @data)", {
  name: "upload.bin",
  data: { value: bytes, type: "varbinary" },
});
```

### Using `Buffer` (Node.js style)

`Buffer` is a subclass of `Uint8Array`, so it works anywhere a `Uint8Array` is
accepted. Pass it with `type: "varbinary"` the same way:

```ts
import { readFileSync } from "node:fs";

const buf = readFileSync("./upload.bin"); // Buffer

await cn.execute("INSERT INTO Files (data) VALUES (@data)", {
  data: { value: buf, type: "varbinary" },
});
```

In Deno and Bun, `Buffer` is available via `node:buffer` if needed, but plain
`Uint8Array` is preferred in those runtimes.

## Reading Binary Data

VARBINARY columns are returned as **base64-encoded strings**. Declare the column
type as `string` and decode after reading:

```ts
// Declare the column as string — that's what comes back from JSON
const row = await cn.querySingle<{ data: string }>(
  "SELECT data FROM Files WHERE id = @id",
  { id: 1 },
);

// Decode base64 → Uint8Array (works in Deno, Node, and Bun)
const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
```

### Nullable columns

```ts
const row = await cn.querySingle<{ data: string | null }>(
  "SELECT data FROM Files WHERE id = @id",
  { id: 1 },
);

if (row.data !== null) {
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
}
```

### Using `Buffer` for decoding (Node.js style)

`Buffer.from(base64, "base64")` is a convenient Node.js idiom and produces a
`Buffer` (which is a `Uint8Array`):

```ts
// Node.js / Bun
const buf = Buffer.from(row.data, "base64");

// Deno (import Buffer from node:buffer)
import { Buffer } from "node:buffer";
const buf = Buffer.from(row.data, "base64");
```

All three runtimes support the global `atob()` / `btoa()` functions, so the
`Uint8Array.from(atob(...))` pattern is always portable.

## Runtime Differences

The binary API is identical across all three runtimes. There are no
runtime-specific code paths in the driver for binary data.

| Feature                      | Deno              | Node.js     | Bun         |
| ---------------------------- | ----------------- | ----------- | ----------- |
| `Uint8Array` input           | ✅                | ✅          | ✅          |
| `Buffer` input               | via `node:buffer` | ✅ (global) | ✅ (global) |
| `atob` / `btoa` globals      | ✅                | ✅ (v16+)   | ✅          |
| `Buffer.from(b64, "base64")` | via `node:buffer` | ✅          | ✅          |
| Output as base64 string      | ✅                | ✅          | ✅          |

## Full Round-Trip Example

```ts
import * as mssql from "@tsdrivers/mssql";

const TEST = new TextEncoder().encode("Hello, world! 🌍");

await using cn = await mssql.connect(connectionString);

// Write
await cn.execute("INSERT INTO Blobs (data) VALUES (@data)", {
  data: { value: TEST, type: "varbinary" },
});

// Read back
const row = await cn.querySingle<{ data: string }>(
  "SELECT TOP 1 data FROM Blobs ORDER BY id DESC",
);
const roundTripped = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));

console.log(new TextDecoder().decode(roundTripped)); // "Hello, world! 🌍"
```

## Empty VARBINARY

Empty `Uint8Array` values are supported — the driver automatically generates a
`CAST(0x AS VARBINARY(MAX))` literal:

```ts
// ✅ Works — empty binary is handled correctly
await cn.execute("INSERT INTO T (data) VALUES (@data)", {
  data: { value: new Uint8Array(0), type: "varbinary" },
});
```

## Large Data

Binary data is serialized through JSON (base64-encoded), which works well for
BLOBs up to ~10 MB. For larger data, use streaming:

| Approach                           | Platform     | Best For                                             |
| ---------------------------------- | ------------ | ---------------------------------------------------- |
| Standard query (in-memory)         | All          | Up to ~10 MB                                         |
| [Blob Streaming](./blob-streaming) | All          | Large reads/writes via `Readable`/`Writable` streams |
| [FILESTREAM](./filestream)         | Windows only | Very large files with native file handle I/O         |

See [Blob Streaming](./blob-streaming) for the full API — it provides
`node:stream` and Web Standard stream interfaces that work identically to the
FILESTREAM API but on all platforms.

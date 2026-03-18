# Binary Data (VARBINARY)

SQL Server `VARBINARY(MAX)` columns store raw binary data. The driver transports
binary across the FFI boundary as base64 strings, so both writing and reading
require a small encoding step.

## Writing Binary Data

Pass a `Uint8Array` with `type: "varbinary"`. **The type hint is required** — without
it the value is treated as an NVARCHAR string:

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

| Feature | Deno | Node.js | Bun |
|---|---|---|---|
| `Uint8Array` input | ✅ | ✅ | ✅ |
| `Buffer` input | via `node:buffer` | ✅ (global) | ✅ (global) |
| `atob` / `btoa` globals | ✅ | ✅ (v16+) | ✅ |
| `Buffer.from(b64, "base64")` | via `node:buffer` | ✅ | ✅ |
| Output as base64 string | ✅ | ✅ | ✅ |

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

## Limitations

### Empty VARBINARY

The underlying `mssql-client` v0.6 driver sends `VARBINARY(0)` for an empty
`Uint8Array`, which SQL Server rejects. Use a SQL literal instead:

```ts
// ❌ Fails — driver sends VARBINARY(0), SQL Server rejects it
await cn.execute("INSERT INTO T (data) VALUES (@data)", {
  data: { value: new Uint8Array(0), type: "varbinary" },
});

// ✅ Correct — use a SQL literal for empty binary
await cn.execute("INSERT INTO T (data) VALUES (CAST(0x AS VARBINARY(MAX)))");
```

### Large Data

The driver serializes binary data through JSON (base64-encoded), which is
memory-efficient for small-to-medium BLOBs. For files in the multi-MB range,
consider [FILESTREAM](./filestream.md) (Windows only) or chunking the data via
multiple INSERT/UPDATE calls.

The `btoa(String.fromCharCode(...bytes))` spread approach used internally hits
JavaScript's argument stack limit (~65,000 elements) for very large arrays.
Chunking the encode/decode yourself avoids this:

```ts
// Safe base64 encode for large Uint8Array
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

// Safe base64 decode to Uint8Array
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
```

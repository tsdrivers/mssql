# mssql-ts-ffi — @tracker1/mssql

SQL Server driver for Deno, Node.js 22+, and Bun via Rust FFI.

Full documentation is available at [tracker1.github.io/mssql-ts-ffi](https://tracker1.github.io/mssql-ts-ffi/).

## Alpha

- I'm going to keep the version number below 1.0 until I am more comfortable.
- Consider this alpha quality
- This has mostly been developed with Claude Code and Opus 4.6.
- My main interest was to create a client for use with Deno.
  - Node and Bun are kind of secondary to me and I won't be using this myself.
- Bug reports are nice, but PRs will probably be more helpful if you are experiencing bugs.

## Features

- Queries with typed results, parameterized queries, and tagged template literals
- Connection pooling with automatic acquire/release
- Transactions with commit/rollback
- Streaming queries with async iteration, `ReadableStream` support, and convenience methods (map, filter, reduce)
- Bulk insert with positional rows, named objects, or async iterables
- Async Disposable (`await using`) for connections, pools, transactions, and streams
- Cascading resource cleanup — disposing a connection auto-cleans child transactions and streams
- COMB UUID generation for SQL Server-friendly sequential GUIDs
- UTF-8 collation helpers
- Transparent native binary download (postinstall for Node/Bun, install script for Deno)
- FILESTREAM support (Windows only, requires [Microsoft OLE DB Driver 19][oledb])
- Zero native dependencies except FILESTREAM on Windows

[oledb]: https://learn.microsoft.com/en-us/sql/connect/oledb/download-oledb-driver-for-sql-server?view=sql-server-ver17

## Package

| Registry | Package | Description |
|----------|---------|-------------|
| [jsr] / [npm] | `@tracker1/mssql` | Unified package — auto-detects runtime |

[jsr]: https://jsr.io/@tracker1
[npm]: https://www.npmjs.com/org/tracker1

A single package supports Deno, Node.js 22+, and Bun. The correct FFI adapter
(`Deno.dlopen`, `koffi`, or `bun:ffi`) is selected automatically at runtime.

## Installation

```sh
# Deno
deno add jsr:@tracker1/mssql

# Bun
bun add @tracker1/mssql

# Node.js
npm install @tracker1/mssql koffi
```

The postinstall script (Node/Bun) automatically downloads the native library.
For Deno, use the install script:

```sh
deno run -A jsr:@tracker1/mssql/install
```

You can also set `TRACKER1_MSSQL_LIB_PATH` to an explicit path, or build from
source with `cd rust && cargo build --release`.

## Quick Start

```ts
import * as mssql from "@tracker1/mssql";

// Create a pool
await using pool = await mssql.createPool(
  "Server=localhost;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;"
);

// Query with typed results
const users = await pool.query<{ name: string; age: number }>(
  "SELECT name, age FROM Users WHERE age > @minAge",
  { minAge: 18 },
);

// Tagged template literal (auto-parameterized)
const minAge = 18;
const users2 = await pool.query<{ name: string }>`SELECT name FROM Users WHERE age > ${minAge}`;
```

## API Overview

```ts
// Pool
const pool = await mssql.createPool(connectionString);
const rows = await pool.query<T>(sql, params?);
await pool.close();

// Connection
await using cn = await pool.connect();
await using cn = await mssql.connect(connectionString);

// Query methods (available on both pool and connection)
cn.query<T>(sql, params?, opts?)          // -> T[]
cn.queryFirst<T>(sql, params?, opts?)     // -> T | undefined
cn.querySingle<T>(sql, params?, opts?)    // -> T (throws if != 1 row)
cn.scalar<T>(sql, params?, opts?)         // -> T | undefined
cn.execute(sql, params?, opts?)           // -> number (rows affected)
cn.sql<T>`SELECT ... WHERE x = ${val}`   // -> T[] (tagged template)

// Streaming
const stream = await cn.queryStream<T>(sql, params?);
for await (const row of stream) { /* ... */ }
await stream.toArray();
stream.toReadableStream();

// Bulk insert
await cn.bulk("MyTable")
  .columns([{ name: "id", type: "int" }, { name: "name", type: "nvarchar" }])
  .rows([[1, "Alice"], [2, "Bob"]])
  .execute();

// Transactions
await using tx = await cn.beginTransaction("READ_COMMITTED");
await cn.execute("INSERT ...", params, { transaction: tx });
await tx.commit();

// COMB UUID (SQL Server-friendly sequential GUID)
const id = mssql.newCOMB();

// FILESTREAM (Windows only)
await using fs = cn.openFilestream(path, txContext, "read");
const data = await fs.readAll();
```

## Connection Strings

Three formats are supported:

```
# ADO.NET style
Server=localhost;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;
Server=myserver\SQLEXPRESS;Database=mydb;User Id=sa;Password=pass;
Server=myserver,1434;Database=mydb;Integrated Security=true;

# URL style (mssql:// or sqlserver://)
mssql://sa:pass@localhost/mydb?trustServerCertificate=true
mssql://localhost/mydb?instanceName=SQLEXPRESS

# Config object (tedious-compatible)
{ server: "localhost", database: "mydb", authentication: { type: "default", options: { userName: "sa", password: "pass" } } }
```

## Platform Support

| Platform | Architecture | Library |
|----------|-------------|---------|
| Linux | x86_64 | `mssqlts-linux-x86_64.so` |
| Linux | aarch64 | `mssqlts-linux-aarch64.so` |
| macOS | x86_64 | `mssqlts-macos-x86_64.dylib` |
| macOS | aarch64 | `mssqlts-macos-aarch64.dylib` |
| Windows | x86_64 | `mssqlts-windows-x86_64.dll` |
| Windows | aarch64 | `mssqlts-windows-aarch64.dll` |

## Architecture

```
Rust cdylib (mssql-client + mssql-driver-pool + tokio) -> C ABI -> FFI boundary
  | u64 handle IDs, JSON strings
Deno.dlopen / bun:ffi / koffi -> RuntimeFFI interface -> Core TS classes
```

The Rust layer handles all SQL Server communication using
[mssql-client](https://crates.io/crates/mssql-client) (pure Rust TDS implementation
with rustls, supporting TDS 7.3–8.0), [tokio](https://tokio.rs) for async I/O,
and [mssql-driver-pool](https://crates.io/crates/mssql-driver-pool) for connection
pooling. It exposes a C ABI with opaque `u64` handle IDs and JSON serialization
across the FFI boundary.

The core TypeScript layer is runtime-agnostic — connection/pool classes, query
serialization, config parsing, and binary resolution are shared by all three
runtime adapters, which are thin FFI wrappers.

The `@tracker1/mssql` package embeds FFI adapters for all three runtimes and
auto-detects which to use. On Deno, FFI initialization begins eagerly at module
load time. On Node.js (via `koffi`) and Bun (via `bun:ffi`), it resolves lazily
on first `createPool()` or `connect()` call.

### Cross-Compilation

The native library must be compiled for each target platform. The `run/binall`
script builds all 6 platform binaries into `dist/bin/`. It uses
[cross](https://github.com/cross-rs/cross), which runs each build inside a
Docker container with the correct toolchain pre-configured — no system-level
cross-compilers needed.

```sh
cargo install cross --git https://github.com/cross-rs/cross
./run/binall
```

## License

[MIT](LICENSE) - Copyright (c) 2026 Michael J. Ryan

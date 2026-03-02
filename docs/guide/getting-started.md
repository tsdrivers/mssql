# Getting Started

**mssql-ts-ffi** is a SQL Server driver for TypeScript runtimes (Deno, Node.js 22+, Bun) that uses a native Rust library via FFI for high performance.

## Quick Start

```ts
import * as mssql from "@tracker1/mssql";

await using pool = await mssql.createPool(
  "Server=localhost;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;"
);

const users = await pool.query<{ name: string }>("SELECT name FROM Users");
console.log(users);
```

The unified `@tracker1/mssql` package automatically detects your runtime (Deno,
Node.js, or Bun) and loads the correct FFI adapter. See
[Runtime-Specific Packages](./runtime-packages) for advanced usage.

## Architecture

The library has three layers:

1. **Rust cdylib** — Handles all SQL Server communication using [mssql-client](https://crates.io/crates/mssql-client), [tokio](https://tokio.rs), and [mssql-driver-pool](https://crates.io/crates/mssql-driver-pool) for connection pooling. Exposes a C ABI with 26 FFI functions.

2. **Core TypeScript** — Runtime-agnostic business logic: connection/pool classes, query serialization, config parsing, binary resolution. Shared by all three runtime adapters.

3. **Runtime adapters** — Thin FFI wrappers for each runtime:
   - Deno: `Deno.dlopen`
   - Node.js: [koffi](https://koffi.dev)
   - Bun: `bun:ffi`

## Next Steps

- [Installation](./installation) — Install the native library
- [Connections](./connections) — Connect to SQL Server
- [Queries](./queries) — Execute queries and commands

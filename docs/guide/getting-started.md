# Getting Started

**@tsdrivers/mssql** is a SQL Server driver for TypeScript runtimes (Deno,
Node.js 22+, Bun) that uses a native Rust library via FFI for high performance.

## Quick Start

```ts
import * as mssql from "@tsdrivers/mssql";

await using pool = await mssql.createPool(
  "Server=localhost;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;",
);

const users = await pool.query<{ name: string }>("SELECT name FROM Users");
console.log(users);
```

The unified `@tsdrivers/mssql` package automatically detects your runtime (Deno,
Node.js, or Bun) and loads the correct FFI adapter. See
[Runtime-Specific Packages](./runtime-packages) for advanced usage.

## Architecture

The library has three layers:

1. **Rust cdylib** — Communicates with SQL Server via the
   [Microsoft ODBC Driver 18](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)
   through the [odbc-api](https://crates.io/crates/odbc-api) crate. Exposes a C
   ABI with 24 FFI functions.

2. **Core TypeScript** — Runtime-agnostic business logic: connection/pool
   classes, query serialization, config parsing, binary resolution. Shared by
   all three runtime adapters.

3. **Runtime adapters** — Thin FFI wrappers for each runtime:
   - Deno: `Deno.dlopen` (nonblocking via V8 thread pool)
   - Node.js + Bun: [koffi](https://koffi.dev) (nonblocking via worker threads)

## Next Steps

- [Installation](./installation) — Install the native library
- [Connections](./connections) — Connect to SQL Server
- [Queries](./queries) — Execute queries and commands

# CLAUDE.md — @tracker1/mssql

SQL Server driver for Deno, Node.js 22+, and Bun via Rust FFI.

## Project Philosophy

- **Public TS API first.** Design the TypeScript surface area to be clean, simple,
  and well-documented. The Rust layer is an implementation detail — users should
  never need to think about FFI, handles, or JSON serialization.
- **Simple, readable code over cleverness.** Prefer straightforward implementations.
  Three similar lines are better than a premature abstraction. Only add complexity
  when it directly serves a user-facing need.
- **Minimal blast radius.** Changes should touch as few files as possible. Don't
  refactor surrounding code when fixing a bug. Don't add features that weren't asked for.
- **Test-driven confidence.** All functionality is validated through TS integration tests
  (Deno, Node, Bun). Rust-only integration tests are unnecessary — the FFI boundary
  is the contract that matters.

## Building & Testing

Use the `run/` scripts. They handle Docker, native builds, DB setup, and test execution.

### Quick iteration (Docker + binary already running)

```bash
MSSQL_SKIP_DOCKER=1 MSSQL_SKIP_BUILD=1 run/test-deno
MSSQL_SKIP_DOCKER=1 MSSQL_SKIP_BUILD=1 run/test-node
MSSQL_SKIP_DOCKER=1 MSSQL_SKIP_BUILD=1 run/test-bun
```

### Full pipeline

```bash
run/test-deno    # Docker clean+up, cargo build, db-setup, deno test
run/test-node    # Same + npm install for koffi, node --test
run/test-bun     # Same + bun test
```

### Individual steps

```bash
run/dbup         # Start MSSQL 2025 container (waits for health check)
run/dbdown       # Stop container (preserves data volume)
run/clean        # Stop container, delete volume, delete .bin/ and dist/
run/bin          # Build native lib for current OS/arch → .bin/
run/binall       # Cross-compile for all 6 targets → dist/bin/
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MSSQL_HOST_PORT` | `14330` | Host port mapped to container's 1433 |
| `MSSQL_SA_PASSWORD` | `DevPassword1!` | SA password for dev container |
| `MSSQL_SA_CONNECTION` | Auto-derived | ADO.NET connection string for SA |
| `MSSQL_SKIP_DOCKER` | `0` | Set `1` to skip Docker setup in test scripts |
| `MSSQL_SKIP_BUILD` | `1` | Set `1` to skip `cargo build` in test scripts |
| `MSSQL_TEST_ENABLED` | Set by test scripts | Integration tests check this to run |
| `MSSQL_TEST_CONNECTION` | Set by test scripts | Connection string for test DB |

A `.env` file at project root (gitignored) is sourced by all `run/` scripts if present.

### Docker

`docker-compose.yml` runs MSSQL Server 2025 Developer Edition on port 14330.
`run/scripts/db-setup.ts` creates the `MSSQLTS_TEST` database with UTF-8 collation
(`Latin1_General_100_CI_AS_SC_UTF8`).

## Architecture Overview

```
Rust cdylib (mssql-client + mssql-driver-pool + tokio)
  ↕ C ABI: u64 handle IDs, JSON strings, null-terminated C strings
projects/mssql/ffi/{deno,node,bun}.ts  →  RuntimeFFI interface
  ↕
projects/mssql/core/*.ts  →  Public API classes (MssqlPool, MssqlConnection, etc.)
  ↕
projects/mssql/mod.ts  →  Entry point (runtime detection, lazy FFI init)
```

### Key files

**Rust (`projects/rust/src/`)**
| File | Purpose |
|---|---|
| `lib.rs` | FFI entry points (`#[no_mangle] pub extern "C" fn`) |
| `handle.rs` | Handle storage: u64 → `Arc<ConnHandle/PoolHandle>` in static HashMaps |
| `query.rs` | Query execution, parameter marshalling, result → JSON serialization |
| `config.rs` | `NormalizedConfig` deserialized from JSON (auth, host, pool settings) |
| `pool.rs` | mssql-driver-pool wrapper |
| `stream.rs` | Row streaming via VecDeque cursor |
| `bulk.rs` | Bulk insert via batched INSERT VALUES statements |
| `debug.rs` | Debug logging (`MSSQLTS_DEBUG` env var, stderr output) |
| `diagnostics.rs` | Pool/connection diagnostic info (no credentials) |
| `error.rs` | Error types |
| `filestream.rs` | Windows FILESTREAM I/O |

**TypeScript (`projects/mssql/`)**
| File | Purpose |
|---|---|
| `mod.ts` | Public entry: `createPool()`, `connect()`, runtime detection |
| `core/runtime.ts` | `RuntimeFFI` interface — the contract all FFI adapters implement |
| `core/connection.ts` | `MssqlConnection` class + `serializeCommand()` helper |
| `core/pool.ts` | `MssqlPool`, `PooledQueryStream`, `PoolBulkInsertBuilder` |
| `core/types.ts` | All public TypeScript types/interfaces |
| `core/config.ts` | Connection string parsing (ADO.NET, URL, config object) |
| `core/stream.ts` | `QueryStream` — async iteration, map/filter/reduce |
| `core/transaction.ts` | `Transaction` — begin/commit/rollback lifecycle |
| `core/bulk.ts` | `BulkInsertBuilder` fluent API |
| `core/exec_result.ts` | `ExecResult` — OUTPUT params + multiple result sets |
| `core/filestream.ts` | `FilestreamHandle` (internal), `FilestreamReadable/Writable/Duplex` (node:stream), web stream helpers |
| `ffi/deno.ts` | Deno FFI adapter (`Deno.dlopen`, `nonblocking: true`) |
| `ffi/node.ts` | Node.js FFI adapter (`koffi`) |
| `ffi/bun.ts` | Bun FFI adapter (`bun:ffi`) |
| `ffi/resolve.ts` | Runtime detection, lazy FFI singleton |

**Tests**
| Location | What |
|---|---|
| `projects/mssql/core/*_test.ts` | Unit tests (172 tests, no DB needed) |
| `projects/test/integration/{deno,node,bun}/` | Integration tests (29 tests per runtime) |

Integration tests are split into 6 files per runtime:
`env_test.ts`, `query_test.ts`, `transaction_test.ts`, `pool_test.ts`, `exec_test.ts`, `windows_test.ts`

## Critical Gotchas

### `return await` with `await using` (MOST IMPORTANT)

Pool convenience methods MUST use `return await`, never bare `return`:

```typescript
// CORRECT — disposal waits for query to complete
async query<T>(sql: string): Promise<T[]> {
  await using cn = await this.connect();
  return await cn.query<T>(sql);
}

// BROKEN — disposal runs BEFORE the Promise resolves
async query<T>(sql: string): Promise<T[]> {
  await using cn = await this.connect();
  return cn.query<T>(sql);  // poolRelease fires while query is in-flight!
}
```

With `await using`, disposal runs when the `return` statement executes, NOT when
the returned Promise resolves. For Deno's `nonblocking: true` FFI calls (which run
on background threads), `return cn.query(...)` causes `poolRelease` to fire while
the query is still in-flight on the background thread, corrupting the connection.

**Any new pool convenience method must follow this pattern.**

### Never use `panic = "abort"`

This is an FFI library loaded into a JS runtime. `panic = "abort"` would kill the
entire Node/Deno/Bun process on any Rust panic. The default `panic = "unwind"` lets
panics propagate as caught errors, keeping the host process alive.

### Deno `nonblocking: true` semantics

FFI symbols marked `nonblocking: true` run on V8's thread pool and return Promises.
Synchronous symbols (`poolRelease`, `disconnect`, `streamClose`) run on the main thread.
This asymmetry is intentional — release/close operations are fast HashMap removals that
must complete synchronously before the calling code continues.

### Adding new FFI symbols — 5 files to update

1. `projects/rust/src/lib.rs` — `#[no_mangle] pub extern "C" fn` implementation
2. `projects/mssql/ffi/deno.ts` — Deno `dlopen` symbol definition
3. `projects/mssql/ffi/node.ts` — koffi function binding
4. `projects/mssql/ffi/bun.ts` — bun:ffi symbol definition
5. `projects/mssql/core/runtime.ts` — `RuntimeFFI` interface method

### Handle lifecycle

All Rust state is behind u64 opaque handle IDs stored in global `lazy_static` HashMaps.
`Arc<ConnHandle>` is used so streaming queries can hold references without blocking
connection release.

### Connection cleanup cascade

`MssqlConnection.#cleanup()` disposes in order:
1. All tracked transactions (which close their streams and rollback)
2. Any remaining orphan streams
3. Then the connection itself is released/disconnected

### Build profile

`Cargo.toml` release profile: `opt-level = "z"` (size), `lto = true`, `codegen-units = 1`.
Debug symbols are built in but split out by `run/bin` into separate `.debug`/`.dSYM`/`.pdb`
files. The shipped binary is stripped.

## Current State

Phases 1–14 are complete. Phase 14 fixed all `cargo clippy` warnings (unsafe ptr
deref, await-holding-lock via take-and-replace, large enum variant boxing, duplicate
branches, manual range contains) and redesigned the FILESTREAM TypeScript API:
`cn.openFilestream()` returns `node:stream` Readable/Writable/Duplex,
`cn.openWebstream()` returns Web Standard ReadableStream/WritableStream.
See `TODO.md` for Phase 15 (outstanding items).

## Code Style

- Deno-first: `deno fmt`, `deno lint`, `deno check` are the formatters/linters
- TypeScript with strict types; no `any` unless unavoidable at FFI boundaries
- Rust: standard `cargo fmt` + `cargo clippy`
- JSDoc on all public API methods and types
- Unit tests alongside source files (`*_test.ts`)
- Integration tests in `projects/test/integration/{deno,node,bun}/`

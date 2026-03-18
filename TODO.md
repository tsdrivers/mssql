# Implementation Phases

## Phase 1 — Scaffold ✅

- [x] Directory structure
- [x] Cargo.toml with platform-conditional deps
- [x] Workspace deno.json
- [x] Package configs (deno.json, package.json)
- [x] Rust modules: error, config, pool, handle, query, stream, bulk,
      filestream, lib
- [x] Core TS: runtime interface, types, config parser, comb, collation,
      transaction, stream, bulk, filestream

## Phase 2 — Rust Native Library ✅

- [x] Fix Cargo.toml (`tls-rustls` → `rustls`, lib name → `mssqlts`, add `tds73`
      feature)
- [x] Verify compilation on Linux (`cargo check` + `cargo build`)
- [x] Fix query.rs (OwnedParam ToSql, NaiveDate/NaiveTime read as NaiveDateTime)
- [x] Fix stream.rs (channel-based approach for QueryStream lifetime issues)
- [x] Fix bulk.rs (use ColumnData variants + IntoSql for datetime)
- [x] Fix config.rs (`AuthMethod::sql_server` instead of `AuthMethod::windows`)
- [x] Config deserialization unit tests (9 tests: SQL, NTLM, Windows, pool,
      instance, errors)

## Phase 3 — Core TypeScript ✅

- [x] connection.ts — MssqlConnection class with query, queryFirst, querySingle,
      scalar, execute, sql tagged template, sqlWith, queryStream, bulk,
      beginTransaction, openFilestream
- [x] pool.ts — MssqlPool with convenience methods, PooledQueryStream,
      PoolBulkInsertBuilder
- [x] binary.ts — libraryFileName, resolveLibraryPath (7-step search),
      downloadUrl, ResolutionContext
- [x] Unit tests: connection_test.ts (23 tests), pool_test.ts (8 tests),
      binary_test.ts (23 tests)
- [x] All 106 core unit tests passing

## Phase 4 — Deno Adapter ✅

- [x] ffi.ts — Deno.dlopen → RuntimeFFI (22 symbols, `"buffer"` for inputs)
- [x] mod.ts — createPool, connect, getFfi with lazy init, re-exports
- [x] install.ts — CLI install with platform detection, --version, --force,
      --platform args
- [x] Integration test stubs (21 tests, 18 skipped without MSSQL_TEST_ENABLED)

## Phase 5 — Node/Bun Adapters ✅

- [x] Node ffi.ts (koffi) → RuntimeFFI
- [x] Node index.ts — createPool, connect, getFfi, re-exports
- [x] Node install.ts — download script with redirect support
- [x] Bun ffi.ts (bun:ffi) → RuntimeFFI
- [x] Bun index.ts — createPool, connect, getFfi, re-exports
- [x] Bun install.ts — download script using fetch + Bun.write
- [x] postinstall.mjs for both packages

## Phase 6 — Node/Bun Integration Testing ✅

- [x] Node.js: integration test runner (node:test with
      --experimental-strip-types)
- [x] Node.js: integration tests against MSSQL (connect, query, params,
      transactions, streaming, bulk, pool)
- [x] Bun: integration test runner (bun:test)
- [x] Bun: integration tests against MSSQL (connect, query, params,
      transactions, streaming, bulk, pool)
- [x] Verify koffi string handling (null-terminated C strings, pointer decode,
      free)
- [x] Verify bun:ffi pointer/CString lifecycle

## Phase 7 — CI/CD ✅

- [x] ci.yml — TS (fmt, lint, check, test) + Rust (check, clippy, fmt, test) +
      Integration (MSSQL 2025 container)
- [x] release-please.yml — conventional commits → changelog + version bump
- [x] publish.yml — matrix build (6 platforms), upload to GitHub releases,
      publish JSR + npm
- [x] docs.yml — VitePress → GitHub Pages

## Phase 8 — Documentation ✅

- [x] VitePress config + landing page
- [x] Guide pages: getting started, installation, connections, queries,
      transactions, streaming, bulk insert, pooling, COMB UUIDs, UTF-8
      collation, FILESTREAM
- [x] API reference page
- [x] TypeDoc integration for auto-generated API reference (typedoc +
      typedoc-plugin-markdown + typedoc-vitepress-theme)

## Phase 9 — Enhancements ✅

- [x] Enable `nonblocking: true` for Deno FFI symbols — prefer async for all
      I/O-bound calls
- [x] Binary distribution: GitHub releases (build/deploy workflow still needs
      finalization)
- [x] Connection string: add Azure AD token auth support
- [x] Stored procedure OUTPUT parameters
- [x] Multiple result sets from stored procedures
- [x] Cursor-based streaming for very large datasets (server-side cursors)

## Phase 10 — Unified `@tsdrivers/mssql` Package ✅

- [x] Create `packages/mssql/` with `deno.json` (JSR metadata) and
      `package.json` (npm metadata)
- [x] Implement runtime detection (Deno, Bun, Node) in `packages/mssql/mod.ts`
- [x] Eager Deno backend: top-level `import("jsr:@tsdrivers/mssql@<version>")`
      at module load
- [x] Lazy Node/Bun backend: `ensureBackend()` with shared promise, auto-install
      fallback
- [x] Auto-install fallback for Node (`npm install --no-save`) and Bun
      (`bun add --no-save`)
- [x] Clear error message when auto-install fails, directing users to install
      runtime-specific package
- [x] Static re-exports from core: types, `newCOMB()`, `parseConnection()`,
      collation helpers, `UTF8_COLLATIONS`
- [x] Shim `createPool()` and `connect()` to delegate to resolved backend
- [x] Add `packages/mssql` to workspace in root `deno.json`
- [x] Update README.md — lead with `@tsdrivers/mssql` as primary install target
- [x] Update docs landing page and installation guide for unified package
- [x] Update all guide pages (getting-started, connections, queries, etc.) to
      use `@tsdrivers/mssql`
- [x] Add docs section explaining runtime-specific packages as
      advanced/alternative option
- [x] Note in docs: Node/Bun users can pre-install runtime-specific package for
      faster cold start

## Phase 11 — Consolidate FFI into Unified Package ✅

- [x] Move `packages/deno/ffi.ts` → `packages/mssql/ffi/deno.ts`
- [x] Move `packages/node/src/ffi.ts` → `packages/mssql/ffi/node.ts`
- [x] Move `packages/bun/src/ffi.ts` → `packages/mssql/ffi/bun.ts`
- [x] Move runtime detection + resolution context from each adapter into
      `packages/mssql/ffi/resolve.ts`
- [x] Rewrite `packages/mssql/mod.ts` to use local FFI files instead of
      delegating to sub-packages
- [x] On-demand `koffi` install for Node.js (`import("koffi")` → fallback
      `npm install koffi --no-save`)
- [x] Merge install scripts into `packages/mssql/install.ts` (unified native
      binary download)
- [x] Expose `getFfi()` and `loadLibrary()` from unified package
- [x] Remove `packages/deno/`, `packages/node/`, `packages/bun/` (replaced by
      unified package)
- [x] Remove old workspace entries from root `deno.json`
- [x] Update `packages/mssql/package.json` — add `koffi` as
      `optionalDependencies`
- [x] Update docs to remove references to runtime-specific sub-packages as
      separate installs
- [x] Update DESIGN.md architecture diagram for consolidated structure
- [x] Move `packages/core/*` → `packages/mssql/core/` and update all references

## Phase 12 Rust Driver Transition: Tiberius → mssql-client ✅

Replaced the Tiberius + bb8 Rust FFI driver with `mssql-client` v0.6 +
`mssql-driver-pool` v0.6. The TypeScript API surface remained identical, with
two new exports: `diagnosticInfo()` and `setDebug()` (from Phase 13.1/13.2).

- [x] 12.0: Repo restructure (`packages/` → `projects/`, `rust/` →
      `projects/rust-odbc-mssql/`)
- [x] 12.1: Remove cursor and batch streaming options
- [x] 12.2: New Rust driver (`projects/rust-odbc-mssql/`) with all 26 FFI
      symbols
  - mssql-client + mssql-driver-pool + tokio (replaces tiberius + bb8)
  - Diagnostics (`mssql_diagnostic_info`) and debug (`mssql_set_debug`) built in
  - TS-side: RuntimeFFI interface, FFI adapters, types, and public API updated
- [x] 12.3: Integration testing — all three runtimes pass (Deno, Node, Bun)
- [x] 12.4: Cleanup — old driver deleted, renamed to
      `projects/rust-odbc-mssql/`, docs updated

## Phase 13 — Connection Pool Enhancements & Validation

### 13.0 — `Disposable` (sync `using`) support + error-state pool eviction ✅

- [x] `MssqlConnection`: `#hasError` tracking — set on FFI error in `query()`,
      `execute()`, `exec()`, `queryStream()`, `beginTransaction()`
- [x] `MssqlConnection`: `Symbol.dispose` — sync cleanup (close streams,
      force-deactivate transactions), return to pool if clean, evict if error or
      active tx
- [x] `MssqlConnection`: `Symbol.asyncDispose` — async cleanup (rollback
      transactions), return to pool if no error, evict if error
- [x] `Transaction`: `_forceInactive()` — sync close streams + mark inactive (no
      rollback)
- [x] `Transaction`: `Symbol.dispose` — calls `_forceInactive()`
- [x] `QueryStream`: `Symbol.dispose` — calls `close()`
- [x] `MssqlPool`: `Symbol.dispose` — calls `close()`
- [x] `PooledQueryStream`: `Symbol.dispose` — close stream + sync-dispose
      connection
- [x] `PooledQueryStream`: `close()` fixed to return connection to pool via
      `asyncDispose` instead of destroying via `disconnect()`
- [x] All classes implement both `Disposable` and `AsyncDisposable`
- [x] 14 new unit tests (163 total)

### 13.1 — Diagnostics ✅ _(Completed in Phase 12.2)_

- [x] `mssql_diagnostic_info` FFI function returning JSON (pool/connection
      state, no credentials)
- [x] `mssql.diagnosticInfo()` public API, `DiagnosticInfo` type

### 13.2 — Debug output (`MSSQLTS_DEBUG`) ✅ _(Completed in Phase 12.2)_

- [x] `mssql_set_debug` FFI function, auto-enabled via `MSSQLTS_DEBUG=1` env var
- [x] Debug messages to stderr (pool acquire/release, connection create/destroy,
      query timing)
- [x] `mssql.setDebug(enabled: boolean)` public API

### 13.3 — Bare vs pooled connections (`close()` / `disconnect()`) ✅

- [x] Add `close()` method to `MssqlConnection` — always destroys (evicts from
      pool)
- [x] Change `disconnect()` to alias for `close()`
- [x] Unit tests for `close()` on bare and pooled connections (4 tests)
- [x] `await using` / `using` on pooled connections still returns to pool
      (unchanged)

### 13.4 — Pool size config parsing ✅

- [x] Add `Min Pool Size` / `Max Pool Size` aliases to ADO.NET parser
- [x] Add `minPoolSize` / `maxPoolSize` query params to URL parser
- [x] Unit tests for pool size parsing (5 tests: ADO.NET both/partial/none, URL
      both/partial)
- [x] Rust already handles `pool.min`/`pool.max` via `to_pool_config()`
      (mssql-driver-pool defaults: min=1, max=10)

### 13.5 — Pool dedup + refcounting (Rust) ✅

- [x] `NormalizedConfig::dedup_key()` — canonical identity string excluding
      pool-tuning params
- [x] `POOL_DEDUP: HashMap<String, u64>` registry mapping dedup key → pool ID
- [x] `PoolHandle.ref_count: AtomicU32` — incremented on dedup hit, decremented
      on close
- [x] `store_pool()` returns existing pool ID on dedup hit
- [x] `remove_pool()` only destroys pool when refcount reaches 0
- [x] Rust unit tests for dedup key generation (4 tests)
- [x] `diagnostic_snapshot()` includes `ref_count` in pool info

### 13.6 — `closeAll()` + exit handlers ✅

- [x] Rust: `mssql_close_all()` FFI function — clears all handles (pools,
      connections, cursors, filestreams)
- [x] New FFI symbol across 5 files (lib.rs, runtime.ts, deno.ts, node.ts,
      bun.ts)
- [x] `mssql.closeAll()` public API
- [x] Exit handlers: auto-register on first FFI load (Deno: `unload`, Node/Bun:
      `beforeExit`)
- [x] `mssql.disableExitHandler()` opt-out

### 13.7 — Timeout error messages (Rust) ✅

- [x] Replace catch-all `PoolError → format!("{e}")` with variant-specific
      messages
- [x] Match all 10 `mssql_driver_pool::PoolError` variants
- [x] Distinguish timeout vs exhaustion vs connection-creation errors

### 13.8 — Integration tests ✅

- [x] Split integration test suites from single file into 6 focused files per
      runtime:
  - `env_test.ts` — environment detection (3 tests)
  - `query_test.ts` — connection, queries, params, types, streaming, bulk (10
    tests)
  - `transaction_test.ts` — transaction commit/rollback (2 tests)
  - `pool_test.ts` — pool operations + Phase 13 pool enhancements (8 tests)
  - `exec_test.ts` — stored procedure exec() (2 tests)
  - `windows_test.ts` — SSPI auth, FILESTREAM (4 tests)
- [x] Pool dedup: same connection string → diagnosticInfo shows 1 pool
- [x] Pool refcounting: close first holder, second still works
- [x] `close()` evicts pooled connection
- [x] Multiple concurrent pool queries via `Promise.all`
- [x] Sequential pool queries reuse connections
- [x] `closeAll()` cleans up all resources
- [x] Updated test runner scripts for multi-file discovery (node, bun)

### 13.9 — Pool convenience methods + docs ✅

- [x] `pool.query()`, `pool.scalar()`, etc. acquire/release connections
      expediently
- [x] `return await` in pool convenience methods to prevent premature release
      with `await using`
- [x] Idle connection reuse via `mssql-driver-pool` (connections auto-returned
      on drop)
- [x] TODO.md, DESIGN.md, CLAUDE.md updated

## Phase 14 — Clippy Fixes + FILESTREAM API Redesign

### 14.1 — Clippy Fixes (Rust) ✅

- [x] 14.1a: Crate-level `#![allow(clippy::not_unsafe_ptr_arg_deref)]` with FFI
      safety comment
- [x] 14.1b: Fix `await_holding_lock` — take-and-replace pattern for
      `conn.client` mutex (8 functions)
- [x] 14.1c: Fix `if_same_then_else` — combine `is_nan() || is_infinite()`
      branches in query.rs
- [x] 14.1d: Fix `manual_range_contains` — use `.contains()` in query.rs (3
      sites)
- [x] 14.1e: Fix `large_enum_variant` — Box both `MssqlClient` variants
      (Pooled + Bare)
- [x] Verify `cargo clippy -- -D warnings` passes with zero warnings

### 14.2 — FILESTREAM API Redesign (TypeScript) ✅

- [x] `cn.openFilestream(path, txContext, mode)` → `node:stream` Readable /
      Writable / Duplex
- [x] `cn.openWebstream(path, txContext, mode)` → Web Standards ReadableStream /
      WritableStream
- [x] `FilestreamReadable`, `FilestreamWritable`, `FilestreamDuplex` classes in
      filestream.ts
- [x] TypeScript overloaded signatures on connection.ts
- [x] Keep `FilestreamHandle` as internal (not re-exported)
- [x] Added `"nodeModulesDir": "auto"` to root deno.json for `node:stream` type
      resolution

### 14.3 — FILESTREAM Documentation ✅

- [x] Rewrite `docs/guide/filestream.md` with both API variants
- [x] Node.js/Bun piping examples (`fs.createReadStream().pipe()`)
- [x] Web Streams piping examples (`Deno.open` + `pipeTo()`)

### 14.4 — Binary / FILESTREAM Integration Tests ✅

- [x] `run/scripts/db-setup.ts` — conditional BinaryFiles table (FILESTREAM on
      Windows, VARBINARY(MAX) elsewhere)
- [x] FILESTREAM filegroup + file setup on Windows when FILESTREAM access level
      >= 2
- [x] `binary_test.ts` in all 3 runtimes (Deno, Node, Bun) with:
  - VARBINARY(max) round-trip with emoji text (temp table)
  - VARBINARY(max) NULL and empty values
  - VARBINARY(max) file round-trip (temp files, cleanup)
  - VARBINARY(max) via persistent BinaryFiles table
  - FILESTREAM pipeline via `node:stream` + `pipeline()` (Windows only, temp
    files)
  - FILESTREAM via web streams — Deno: `Deno.open` + `pipeTo()`, Node/Bun:
    in-memory read/write
- [x] Removed placeholder FILESTREAM tests from `windows_test.ts` files

## Phase 15 — ODBC Driver Migration

Replace the Rust TDS-protocol crate (`mssql-client` + `mssql-driver-pool`) with
the Microsoft ODBC Driver for SQL Server via the `odbc-api` Rust crate. This
eliminates the incomplete upstream SSPI/Windows-auth story and leverages
Microsoft's own driver for TDS, auth, and encryption — the same driver that the
.NET `Microsoft.Data.SqlClient` uses under the covers.

**Runtime dependency**: Microsoft ODBC Driver 18 (or 17) for SQL Server must be
installed on the target system:

- Windows: `winget install Microsoft.ODBC.18`
- macOS: `brew install microsoft/mssql-release/msodbcsql18`
- Linux: `msodbcsql18` package from Microsoft's repo

**TypeScript changes**: None. The `RuntimeFFI` interface, `NormalizedConfig`
JSON shape, and all 24 FFI symbol signatures remain identical.

### 15.0 — Cargo.toml + dependencies ✅

- [x] Remove `mssql-client`, `mssql-driver-pool` dependencies
- [x] Add `odbc-api = "8"` dependency
- [x] Remove `tokio` (no longer needed — ODBC is synchronous)
- [x] Keep `serde`, `serde_json`, `lazy_static`, `uuid`, `chrono`, `base64`
- [x] Keep Windows `windows` crate for FILESTREAM

### 15.1 — config.rs (ODBC connection string builder) ✅

- [x] Remove `to_client_config()` (mssql-client specific)
- [x] Remove `to_pool_config()` (mssql-driver-pool specific)
- [x] Add `to_odbc_connection_string()` — builds ODBC connection string
- [x] Auth mapping:
  - `sql` → `UID=user;PWD=pass;`
  - `ntlm` → `UID=domain\user;PWD=pass;`
  - `windows` → `Trusted_Connection=yes;`
  - `azure_ad` → `Authentication=ActiveDirectoryPassword;UID=user;PWD=pass;`
  - `azure_ad_token` → `AccessToken=token;`
- [x] Driver detection: try ODBC Driver 18 → fall back to 17
- [x] Map `packet_size`, `connect_timeout_ms`, `app_name`, `encrypt`,
      `trust_server_certificate`, `instance_name`
- [x] Keep `dedup_key()` and unit tests unchanged

### 15.2 — error.rs (ODBC error mapping) ✅

- [x] Remove `From<mssql_client::Error>` and
      `From<mssql_driver_pool::PoolError>`
- [x] Add `From<odbc_api::Error>` with SQLSTATE-based classification
- [x] Pool errors via local `MssqlError::Pool` variant

### 15.3 — pool.rs (simple ODBC connection pool) ✅

- [x] Implement `OdbcPool` with idle `VecDeque<Connection>`,
      min/max/idle_timeout
- [x] `get()` — take from idle queue or create new (block up to connect_timeout)
- [x] `put()` — return to idle queue (drop if over capacity)
- [x] `status()` — total/idle/in_use/max for diagnostics
- [x] `evict()` — drop connection without returning to pool
- [x] `create_single()` for bare (non-pooled) connections

### 15.4 — handle.rs (ODBC connection wrappers) ✅

- [x] Global `OnceLock<Environment>` for ODBC environment singleton
- [x] Replace `MssqlClient` with `OdbcConn` enum wrapping
      `odbc_api::Connection<'static>` (Pooled / Bare variants)
- [x] `PoolHandle` wraps `OdbcPool` instead of `mssql_driver_pool::Pool`
- [x] Pool dedup, refcounting, diagnostics unchanged

### 15.5 — query.rs (ODBC query execution) ✅

- [x] Remove `mssql_client::{Row, SqlValue, ToSql}` imports
- [x] `execute_query()` — ODBC execute + `TextRowSet` cursor reads → JSON array
- [x] `execute_nonquery()` — ODBC execute + `@@ROWCOUNT` → JSON
- [x] `execute_exec()` — OUTPUT param batch via `simple_execute` pattern
- [x] `execute_query_stream()` — ODBC execute, collect rows as `Vec<Value>`
- [x] `row_to_json()` removed — rows serialized inline from ODBC cursor buffers
- [x] `param_to_sql_value()` / `sql_value_to_literal()` replaced with
      `param_to_literal()` (no external dependency)
- [x] Named param rewriting and unit tests unchanged
- [x] `simple_execute()` for transaction SQL statements

### 15.6 — stream.rs (pre-serialized JSON rows) ✅

- [x] `RowCursor` stores `VecDeque<serde_json::Value>` instead of
      `VecDeque<Row>`
- [x] `next_row()` returns `Option<serde_json::Value>` (already JSON)

### 15.7 — bulk.rs (minimal changes) ✅

- [x] Replace `Client<Ready>` parameter with `&Connection<'static>`
- [x] Keep INSERT VALUES batch approach unchanged

### 15.8 — lib.rs (FFI wiring) ✅

- [x] All 24 FFI symbol signatures unchanged
- [x] Remove tokio runtime — all calls are synchronous via ODBC
- [x] `with_conn()` helper for take-and-replace pattern
- [x] Transaction SQL statements via `simple_execute()`
- [x] `mssql_stream_next` returns pre-serialized JSON (no `row_to_json` call)
- [x] Pool release returns ODBC connection to pool's idle queue

### 15.9 — filestream.rs + debug.rs ✅

- [x] `debug.rs` — no driver dependency, unchanged
- [x] `filestream.rs` — migrated from `msoledbsql.dll` to `msodbcsql18.dll` for
      `OpenSqlFilestream`. The ODBC driver exports this function, so no
      additional OLE DB Driver install is needed. Falls back to ODBC Driver 17.

### 15.10 — Integration testing ✅

All 283 tests pass on Windows Server 2025 with SQL Server 2025, Windows auth
(SSPI), ODBC Driver 18, FILESTREAM enabled:

- [x] `run/test-windows.ps1` — full pipeline (db-setup, unit, integration,
      teardown) passes across all three runtimes
- [x] Deno 2.7: 172 unit tests + 37 integration tests (209 total)
- [x] Node.js 24: 37 integration tests (koffi FFI)
- [x] Bun 1.3: 37 integration tests (bun:ffi)
- [x] Verify: Windows auth (SSPI), FILESTREAM (node:stream + web streams),
      transactions, streaming, bulk insert, stored procedures with OUTPUT
      params, pool dedup/refcounting, binary data round-trips, execute row
      counts
- [x] Node.js koffi resolver: walk up from cwd + NODE_PATH for reliable
      resolution in monorepo / nested test layouts

### 15.11 — Build + test verification ✅

- [x] `cargo build --release` — zero errors, zero warnings
- [x] `cargo test` — 19/19 Rust unit tests pass
- [x] Binary copied to `.bin/mssqlts-windows-x86_64.dll`

## Phase 16 — VARBINARY(MAX) Blob Streaming ✅

Cross-platform alternative to FILESTREAM for reading/writing large binary data
in chunks without loading the entire value into memory. Implemented entirely in
TypeScript using existing query infrastructure — no new FFI symbols needed.

### 16.1 — Core blob streaming (`core/blob.ts`) ✅

- [x] `BlobTarget` interface: `table`, `column`, `where`, `params?`,
      `chunkSize?` (default 1 MB)
- [x] `BlobReadable` (extends `node:stream.Readable`) — reads via
      `SELECT SUBSTRING(column, @offset, @len)` with transaction
- [x] `BlobWritable` (extends `node:stream.Writable`) — appends via
      `UPDATE ... SET column.WRITE(@chunk, NULL, NULL)` with transaction
- [x] `createBlobReadableStream()` / `createBlobWritableStream()` — Web Standard
      `ReadableStream` / `WritableStream` factories
- [x] `bracketEscape()` — multi-part table names (`dbo.Documents` →
      `[dbo].[Documents]`); already-bracketed names passed through as-is
- [x] Export `BlobTarget` type from `mod.ts`

### 16.2 — Sub-object API on `MssqlConnection` ✅

- [x] `cn.fs.open(path, ctx, mode)` — FILESTREAM `node:stream`
- [x] `cn.fs.openWeb(path, ctx, mode)` — FILESTREAM Web Standard stream
- [x] `cn.fs.available(database?)` — FILESTREAM availability check
- [x] `cn.blob.filestream.read(tx, target)` — blob `node:stream.Readable`
- [x] `cn.blob.filestream.write(tx, target)` — blob `node:stream.Writable`
- [x] `cn.blob.webstream.read(tx, target)` — blob Web `ReadableStream`
- [x] `cn.blob.webstream.write(tx, target)` — blob Web `WritableStream`
- [x] Sub-object accessors via lazy-initialized inner classes
      (`FilestreamAccessor`, `BlobAccessor`, `BlobFilestreamAccessor`,
      `BlobWebstreamAccessor`)

### 16.3 — Documentation ✅

- [x] Guide page: `docs/guide/blob-streaming.md` — full API reference, examples
      for both stream types, `BlobTarget` options table, comparison with
      FILESTREAM (platform, mechanism, performance, max size)
- [x] Updated `docs/guide/filestream.md` — cross-reference to blob streaming
- [x] Updated `docs/guide/binary.md` — large data section points to blob
      streaming
- [x] Sidebar entry in `docs/.vitepress/config.ts`

### 16.4 — Integration tests ✅

All tests pass across Deno, Node.js, and Bun (41 tests per runtime, 295 total):

- [x] Write + read via `node:stream` (manual chunks, small `chunkSize: 64`)
- [x] Write + read via Web Standard streams
- [x] Pipeline via `node:stream` (`pipeline()` with file I/O)
- [x] Pipeline via Web Standard streams (`pipeTo()` with file I/O)

## Phase 17 — Outstanding Items

- [ ] Add Node/Bun integration jobs to ci.yml
- [ ] Build/bundle pipeline for JSR + npm publishing
- [ ] Publish unified `@tsdrivers/mssql` to JSR and npm

## Phase 18 — SQL Server 2025 Readiness (future)

- [ ] Native JSON data type support
- [ ] Native VECTOR data type

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
      `projects/rust/`)
- [x] 12.1: Remove cursor and batch streaming options
- [x] 12.2: New Rust driver (`projects/rust/`) with all 26 FFI symbols
  - mssql-client + mssql-driver-pool + tokio (replaces tiberius + bb8)
  - Diagnostics (`mssql_diagnostic_info`) and debug (`mssql_set_debug`) built in
  - TS-side: RuntimeFFI interface, FFI adapters, types, and public API updated
- [x] 12.3: Integration testing — all three runtimes pass (Deno, Node, Bun)
- [x] 12.4: Cleanup — old driver deleted, renamed to `projects/rust/`, docs
      updated

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

## Phase 15 — Outstanding Items

- [ ] Windows CI: SSPI + FILESTREAM tests
- [ ] Add Node/Bun integration jobs to ci.yml
- [ ] README generation script (per-package READMEs from main README)
- [ ] Build/bundle pipeline for JSR + npm publishing
- [ ] Publish unified `@tsdrivers/mssql` to JSR and npm

## Phase 16 - SQL Server 2025 Readiness (future)

With `mssql-client` as the driver, these become easier to add later:

- [ ] Native JSON data type support (new TDS type token in `tds-protocol` crate)
- [ ] TDS 8.0 strict mode (already supported by `mssql-client`)
- [ ] Native VECTOR data type (falls back to JSON on older TDS versions
      automatically, but binary support needs TDS 7.4+ token handling)
- [ ] Add SQL Server 2025 Express to CI test matrix alongside 2022

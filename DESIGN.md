# Design Document — @tracker1/mssql

SQL Server driver for Deno, Node.js 22+, and Bun via Rust FFI.

**Repository:** `github.com/tracker1/mssql-ts-ffi`
**Docs:** `tracker1.github.io/mssql-ts-ffi`

## Package

| Registry | Package | Description |
|---|---|---|
| JSR / npm | `@tracker1/mssql` | Unified package — auto-detects runtime, embedded FFI |

A single package supports all three runtimes. FFI adapters for Deno (`Deno.dlopen`),
Node.js (`koffi`), and Bun (`bun:ffi`) are embedded directly in the package.
Runtime detection happens automatically at first use.

## Architecture

```
Rust cdylib (mssql-client + mssql-driver-pool + tokio) → C ABI → FFI boundary
  ↕ u64 handle IDs, JSON strings
Deno.dlopen / bun:ffi / koffi → RuntimeFFI interface → Core TS classes
  ↑
@tracker1/mssql → detects runtime → loads correct FFI adapter
```

### Embedded FFI Architecture

`@tracker1/mssql` contains FFI adapters for all three runtimes (`ffi/deno.ts`,
`ffi/node.ts`, `ffi/bun.ts`). At first use, `ffi/resolve.ts` detects the
runtime and dynamically imports the correct adapter:

- **Deno:** FFI initialization starts eagerly at module evaluation time
  (Deno's `dlopen` is synchronous, so the FFI is typically ready before
  user code calls `createPool()`/`connect()`)
- **Node.js:** Uses `koffi` for FFI (listed as `optionalDependencies`; auto-installed
  on demand if missing). Lazy initialization on first use
- **Bun:** Uses `bun:ffi`. Lazy initialization on first use
- A shared `Promise` ensures the backend is resolved only once; concurrent
  callers await the same promise

### Key Decisions
- **FFI via C ABI** — stable across platforms, no WASM TCP limitations
- **mssql-client with rustls** — pure Rust TDS (supports TDS 7.3–8.0), no OpenSSL dependency
- **mssql-driver-pool** — built-in connection pooling (replaces bb8)
- **Embedded tokio runtime** — FFI calls block_on async operations
- **u64 opaque handles** — safer than raw pointers across FFI
- **JSON serialization** across FFI boundary for params/results
- **std::sync::Mutex** for client access within block_on context
- **Platform-conditional** features via cfg(windows)
- **Zero native deps** except FILESTREAM on Windows (lazy detection)

## Public API

```typescript
import * as mssql from "@tracker1/mssql";

// Pool
const pool = await mssql.createPool(connectionString);
const users = await pool.query<User>("SELECT ...", { age: 25 });

// Connection
await using cn = await pool.connect();
await using cn = await mssql.connect(connectionString);

// Query methods (on both pool and connection)
cn.query<T>(sql, params?, opts?)          → T[]
cn.queryFirst<T>(sql, params?, opts?)     → T | undefined
cn.querySingle<T>(sql, params?, opts?)    → T (throws if ≠ 1)
cn.scalar<T>(sql, params?, opts?)         → T | undefined
cn.execute(sql, params?, opts?)           → number (rows affected)
cn.exec(sql, params?, opts?)             → ExecResult (OUTPUT params + multi result sets)
cn.sql<T>`SELECT ... WHERE x = ${val}`   → T[]
cn.sqlWith(opts)<T>`...`                  → T[]

// Streaming
const stream = await cn.queryStream<T>(sql, params?, opts?);
for await (const row of stream) { ... }
await stream.toArray();
await stream.map(fn);
await stream.filter(fn);
await stream.reduce(fn, initial);
stream.toReadableStream();
await stream.pipeTo(writable);

// Bulk insert
await cn.bulk("Table")
  .columns([{ name: "Id", type: "uniqueidentifier" }, ...])
  .rows([[mssql.newCOMB(), ...]])     // positional
  .fromObjects([{ Id: ..., ... }])     // named
  .fromAsyncIterable(source, transform) // streaming
  .batchSize(5000)
  .execute();

// Transactions
await using tx = await cn.beginTransaction("READ_COMMITTED");
await cn.execute("...", params, { transaction: tx });
await tx.commit();

// COMB UUID
const id = mssql.newCOMB();

// FILESTREAM (Windows only, lazy dependency check)
await using fs = cn.openFilestream(path, txContext, "read");
const data = await fs.readAll();

// UTF-8 collation helpers
mssql.utf8Column("Name", "varchar(200)")
await mssql.supportsUtf8(cn)
```

## Connection String Formats

### ADO.NET
```
Server=localhost;Database=mydb;User Id=sa;Password=pass;
Server=tcp:host,port;Database=mydb;Integrated Security=true;
Server=host\INSTANCE;Database=mydb;User Id=sa;Password='has;semicolons';
```

### URL
```
mssql://sa:pass@localhost/mydb
mssql://localhost/mydb?integratedSecurity=true&domain=CORP
```

### Config Object (tedious-compatible)
```typescript
{
  server: "localhost",
  database: "mydb",
  authentication: {
    type: "default",
    options: { userName: "sa", password: "pass" }
  }
}
```

### Defaults
- encrypt: true
- trust_server_certificate: true
- port: 1433
- database: "master"

### Implicit Windows Auth
No credentials + Windows OS → SSPI

## FFI Contract

All handles are u64 IDs. Return 0 = failure. Check mssql_last_error().

### Symbols
```
mssql_pool_create(config_json: *c_char) → u64
mssql_pool_acquire(pool_id: u64) → u64
mssql_pool_release(pool_id: u64, conn_id: u64)
mssql_pool_close(pool_id: u64)
mssql_connect(config_json: *c_char) → u64
mssql_disconnect(conn_id: u64)
mssql_query(conn_id: u64, cmd_json: *c_char) → *c_char | null
mssql_execute_nonquery(conn_id: u64, cmd_json: *c_char) → *c_char | null
mssql_exec(conn_id: u64, cmd_json: *c_char) → *c_char | null
mssql_query_stream(conn_id: u64, cmd_json: *c_char) → u64
mssql_stream_next(stream_id: u64) → *c_char | null
mssql_stream_close(stream_id: u64)
mssql_bulk_insert(conn_id: u64, req_json: *c_char) → *c_char | null
mssql_begin_transaction(conn_id: u64, tx_json: *c_char) → *c_char | null
mssql_commit(conn_id: u64, tx_id: *c_char) → *c_char | null
mssql_rollback(conn_id: u64, tx_id: *c_char) → *c_char | null
mssql_cancel(conn_id: u64)
mssql_last_error(handle_id: u64) → *c_char | null
mssql_free_string(ptr: *c_char)
mssql_filestream_available() → u32
mssql_filestream_open(req_json: *c_char) → u64
mssql_filestream_read(fs_id: u64, max_bytes: u64) → *c_char | null
mssql_filestream_write(fs_id: u64, data_base64: *c_char) → u64
mssql_filestream_close(fs_id: u64)
mssql_diagnostic_info() → *c_char | null
mssql_set_debug(enabled: u32)
mssql_close_all()
```

### Pool Deduplication

`store_pool()` computes a canonical `dedup_key` from the connection config
(server, port, database, auth, encrypt, trust, instance, app_name, packet_size).
Pool-tuning params (min, max, idle_timeout) and timeouts are excluded. If a pool
with the same identity key already exists, the existing pool's refcount is
incremented and its ID is returned. `remove_pool()` decrements the refcount and
only destroys the pool when it reaches 0.

## Binary Distribution

### Platform targets (6)

| Target | Filename |
|--------|----------|
| x86_64-unknown-linux-gnu | `mssqlts-linux-x86_64.so` |
| aarch64-unknown-linux-gnu | `mssqlts-linux-aarch64.so` |
| x86_64-apple-darwin | `mssqlts-macos-x86_64.dylib` |
| aarch64-apple-darwin | `mssqlts-macos-aarch64.dylib` |
| x86_64-pc-windows-msvc | `mssqlts-windows-x86_64.dll` |
| aarch64-pc-windows-msvc | `mssqlts-windows-aarch64.dll` |

Filenames use `mssqlts-{os}-{arch}.{ext}` so all 6 can coexist in a single
directory, GitHub release, or distribution package. The resolver picks the one
matching the current execution environment.

### Resolution order
1. `TRACKER1_MSSQL_LIB_PATH` env var (explicit path)
2. `node_modules/pkg/native/` (Node/Bun postinstall location)
3. Walk up from cwd — at each directory check:
   - `{dir}/{filename}`
   - `{dir}/lib/{filename}`, `{dir}/.lib/{filename}`
   - `{dir}/bin/{filename}`, `{dir}/.bin/{filename}`
4. Next to entry point
5. Home directory — check:
   - `~/lib/{filename}`, `~/.lib/{filename}`
   - `~/bin/{filename}`, `~/.bin/{filename}`
6. `~/.cache/tracker1-mssql/{version}/{filename}`
7. Download from GitHub releases

### Node/Bun: postinstall downloads to node_modules/pkg/native/
### Deno: lazy download on first use, or explicit install script

## Platform Dependencies

| Feature | All Platforms | Windows Only |
|---------|:---:|:---:|
| Core (queries, pool, tx, bulk, streaming) | ✅ zero deps | |
| Windows Auth (SSPI) | | ✅ zero deps |
| FILESTREAM | | ⚠️ needs Microsoft OLE DB Driver 19 (lazy detected) |

## CI/CD

- **ci.yml**: PR checks — fmt, lint, type check, unit tests, Rust checks
- **release-please.yml**: conventional commits → changelog + version bump
- **publish.yml**: build 6 binaries → publish JSR + npm
- **docs.yml**: VitePress + TypeDoc → GitHub Pages

## Documentation

- VitePress site at tracker1.github.io/mssql-ts-ffi/
- TypeDoc generates API reference from JSDoc in projects/mssql/core/
- Guide pages in docs/src/guide/
- Runtime-specific tabs in code examples
- README per package generated via scripts/build-readmes.ts

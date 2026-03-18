/**
 * Node.js FFI adapter — wraps koffi into RuntimeFFI interface.
 *
 * I/O-bound symbols use `fn.async(...)` so the native function runs
 * on a koffi worker thread and returns a Promise, keeping the Node.js
 * event loop free. Fast local operations (release, close, free) remain
 * synchronous.
 *
 * @module
 */

import type { RuntimeFFI } from "../core/runtime.ts";

// Lazily import koffi to avoid issues when type-checking without it installed.
// deno-lint-ignore no-explicit-any
let _koffi: any = null;

/**
 * Try to load koffi by searching multiple locations:
 * 1. NODE_PATH directories (if set)
 * 2. Walk up from cwd checking each `node_modules/koffi`
 *
 * Uses `createRequire` which respects CJS resolution from arbitrary
 * locations — more reliable than ESM `import()` which only resolves
 * from the calling module's location.
 */
// deno-lint-ignore no-explicit-any
async function tryLoadKoffiFromParents(): Promise<any> {
  const { createRequire } = await import("node:module");
  const { resolve, dirname, delimiter } = await import("node:path");
  const { existsSync } = await import("node:fs");

  // Check NODE_PATH directories first
  const nodePath = process.env.NODE_PATH;
  if (nodePath) {
    for (const dir of nodePath.split(delimiter)) {
      const candidate = resolve(dir, "koffi");
      if (existsSync(candidate)) {
        const req = createRequire(resolve(dir, "..", "package.json"));
        try {
          return req("koffi");
        } catch { /* try next */ }
      }
    }
  }

  // Walk up from cwd
  let dir = process.cwd();
  const seen = new Set<string>();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    const candidate = resolve(dir, "node_modules", "koffi");
    if (existsSync(candidate)) {
      const req = createRequire(resolve(dir, "package.json"));
      return req("koffi");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function getKoffi(): Promise<any> {
  if (!_koffi) {
    // 1. Try standard ESM import (works when koffi is in node_modules
    //    relative to this module or an ancestor)
    try {
      const mod = await import("koffi");
      _koffi = mod.default ?? mod;
    } catch {
      // 2. Walk up from cwd looking for node_modules/koffi
      const fromParents = await tryLoadKoffiFromParents();
      if (fromParents) {
        _koffi = fromParents;
      } else {
        // 3. Last resort: attempt on-demand install
        try {
          const { execSync } = await import("node:child_process");
          execSync("npm install koffi --no-save", { stdio: "pipe" });
          const mod = await import("koffi");
          _koffi = mod.default ?? mod;
        } catch {
          throw new Error(
            "@tsdrivers/mssql: could not load or install koffi (required for Node.js FFI).\n" +
              "Install it manually:\n  npm install koffi",
          );
        }
      }
    }
  }
  return _koffi;
}

/**
 * Wrap a koffi function's callback-based `.async()` in a Promise.
 * koffi async calls run the native function on a worker thread and
 * invoke `(err, result)` on the main thread when done.
 */
// deno-lint-ignore no-explicit-any
function callAsync<T>(fn: any, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn.async(...args, (err: Error | null, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Open the native library using koffi and return a RuntimeFFI implementation.
 */
export async function createFFI(libPath: string): Promise<RuntimeFFI> {
  const koffi = await getKoffi();
  const lib = koffi.load(libPath);

  // Define C function signatures
  const mssql_pool_create = lib.func(
    "uint64_t mssql_pool_create(const char *)",
  );
  const mssql_pool_acquire = lib.func("uint64_t mssql_pool_acquire(uint64_t)");
  const mssql_pool_release = lib.func(
    "void mssql_pool_release(uint64_t, uint64_t)",
  );
  const mssql_pool_close = lib.func("void mssql_pool_close(uint64_t)");
  const mssql_connect = lib.func("uint64_t mssql_connect(const char *)");
  const mssql_disconnect = lib.func("void mssql_disconnect(uint64_t)");
  const mssql_query = lib.func("void * mssql_query(uint64_t, const char *)");
  const mssql_execute_nonquery = lib.func(
    "void * mssql_execute_nonquery(uint64_t, const char *)",
  );
  const mssql_exec = lib.func("void * mssql_exec(uint64_t, const char *)");
  const mssql_query_stream = lib.func(
    "uint64_t mssql_query_stream(uint64_t, const char *)",
  );
  const mssql_stream_next = lib.func("void * mssql_stream_next(uint64_t)");
  const mssql_stream_close = lib.func("void mssql_stream_close(uint64_t)");
  const mssql_bulk_insert = lib.func(
    "void * mssql_bulk_insert(uint64_t, const char *)",
  );
  const mssql_begin_transaction = lib.func(
    "void * mssql_begin_transaction(uint64_t, const char *)",
  );
  const mssql_commit = lib.func("void * mssql_commit(uint64_t, const char *)");
  const mssql_rollback = lib.func(
    "void * mssql_rollback(uint64_t, const char *)",
  );
  const mssql_cancel = lib.func("void mssql_cancel(uint64_t)");
  const mssql_last_error = lib.func("void * mssql_last_error(uint64_t)");
  const mssql_free_string = lib.func("void mssql_free_string(void *)");
  const mssql_filestream_available = lib.func(
    "uint32_t mssql_filestream_available()",
  );
  const mssql_filestream_open = lib.func(
    "uint64_t mssql_filestream_open(const char *)",
  );
  const mssql_filestream_read = lib.func(
    "void * mssql_filestream_read(uint64_t, uint64_t)",
  );
  const mssql_filestream_write = lib.func(
    "uint64_t mssql_filestream_write(uint64_t, const char *)",
  );
  const mssql_filestream_close = lib.func(
    "void mssql_filestream_close(uint64_t)",
  );
  const mssql_diagnostic_info = lib.func("void * mssql_diagnostic_info()");
  const mssql_set_debug = lib.func("void mssql_set_debug(uint32_t)");
  const mssql_close_all = lib.func("void mssql_close_all()");

  /** Read a C string from a pointer, then free it. Returns null for null pointers. */
  function readAndFree(rawPtr: unknown): string | null {
    if (rawPtr === null || rawPtr === undefined || rawPtr === 0) return null;
    const str = koffi.decode(rawPtr, "char", -1) as string;
    mssql_free_string(rawPtr);
    return str;
  }

  return {
    async poolCreate(configJson: string): Promise<bigint> {
      return BigInt(await callAsync(mssql_pool_create, configJson));
    },

    async poolAcquire(poolId: bigint): Promise<bigint> {
      return BigInt(await callAsync(mssql_pool_acquire, poolId));
    },

    poolRelease(poolId: bigint, connId: bigint): void {
      mssql_pool_release(poolId, connId);
    },

    poolClose(poolId: bigint): void {
      mssql_pool_close(poolId);
    },

    async connect(configJson: string): Promise<bigint> {
      return BigInt(await callAsync(mssql_connect, configJson));
    },

    disconnect(connId: bigint): void {
      mssql_disconnect(connId);
    },

    async query(connId: bigint, cmdJson: string): Promise<string | null> {
      const ptr = await callAsync(mssql_query, connId, cmdJson);
      return readAndFree(ptr);
    },

    async executeNonquery(
      connId: bigint,
      cmdJson: string,
    ): Promise<string | null> {
      const ptr = await callAsync(mssql_execute_nonquery, connId, cmdJson);
      return readAndFree(ptr);
    },

    async exec(connId: bigint, cmdJson: string): Promise<string | null> {
      const ptr = await callAsync(mssql_exec, connId, cmdJson);
      return readAndFree(ptr);
    },

    async queryStream(connId: bigint, cmdJson: string): Promise<bigint> {
      return BigInt(await callAsync(mssql_query_stream, connId, cmdJson));
    },

    async streamNext(cursorId: bigint): Promise<string | null> {
      const ptr = await callAsync(mssql_stream_next, cursorId);
      return readAndFree(ptr);
    },

    streamClose(cursorId: bigint): void {
      mssql_stream_close(cursorId);
    },

    async bulkInsert(connId: bigint, reqJson: string): Promise<string | null> {
      const ptr = await callAsync(mssql_bulk_insert, connId, reqJson);
      return readAndFree(ptr);
    },

    async beginTransaction(
      connId: bigint,
      txJson: string,
    ): Promise<string | null> {
      const ptr = await callAsync(mssql_begin_transaction, connId, txJson);
      return readAndFree(ptr);
    },

    async commit(connId: bigint, txId: string): Promise<string | null> {
      const ptr = await callAsync(mssql_commit, connId, txId);
      return readAndFree(ptr);
    },

    async rollback(connId: bigint, txId: string): Promise<string | null> {
      const ptr = await callAsync(mssql_rollback, connId, txId);
      return readAndFree(ptr);
    },

    cancel(connId: bigint): void {
      mssql_cancel(connId);
    },

    lastError(handleId: bigint): string | null {
      const ptr = mssql_last_error(handleId);
      return readAndFree(ptr);
    },

    filestreamAvailable(): boolean {
      return mssql_filestream_available() !== 0;
    },

    filestreamOpen(reqJson: string): bigint {
      return BigInt(mssql_filestream_open(reqJson));
    },

    filestreamRead(fsId: bigint, maxBytes: bigint): string | null {
      const ptr = mssql_filestream_read(fsId, maxBytes);
      return readAndFree(ptr);
    },

    filestreamWrite(fsId: bigint, dataBase64: string): bigint {
      return BigInt(mssql_filestream_write(fsId, dataBase64));
    },

    filestreamClose(fsId: bigint): void {
      mssql_filestream_close(fsId);
    },

    diagnosticInfo(): string | null {
      const ptr = mssql_diagnostic_info();
      return readAndFree(ptr);
    },

    setDebug(enabled: number): void {
      mssql_set_debug(enabled);
    },

    closeAll(): void {
      mssql_close_all();
    },
  };
}

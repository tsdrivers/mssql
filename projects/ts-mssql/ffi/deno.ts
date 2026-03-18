/**
 * Deno FFI adapter — wraps Deno.dlopen into RuntimeFFI interface.
 *
 * I/O-bound symbols use `nonblocking: true` so the native function
 * runs on a background thread and returns a Promise, keeping the
 * Deno event loop free.
 *
 * @module
 */

import type { RuntimeFFI } from "../core/runtime.ts";

// FFI symbol definitions matching the C ABI exported from the Rust cdylib.
// Symbols with `nonblocking: true` run on a separate thread and return Promises.
const SYMBOLS = {
  // Pool — create/acquire do network I/O; release/close are local HashMap ops
  mssql_pool_create: {
    parameters: ["buffer"],
    result: "u64",
    nonblocking: true,
  },
  mssql_pool_acquire: { parameters: ["u64"], result: "u64", nonblocking: true },
  mssql_pool_release: { parameters: ["u64", "u64"], result: "void" },
  mssql_pool_close: { parameters: ["u64"], result: "void" },

  // Connection — connect does TLS handshake; disconnect drops handle
  mssql_connect: { parameters: ["buffer"], result: "u64", nonblocking: true },
  mssql_disconnect: { parameters: ["u64"], result: "void" },

  // Queries — all involve network roundtrips
  mssql_query: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },
  mssql_execute_nonquery: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },
  mssql_exec: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },

  // Streaming — open and next involve network I/O; close drops cursor
  mssql_query_stream: {
    parameters: ["u64", "buffer"],
    result: "u64",
    nonblocking: true,
  },
  mssql_stream_next: {
    parameters: ["u64"],
    result: "pointer",
    nonblocking: true,
  },
  mssql_stream_close: { parameters: ["u64"], result: "void" },

  // Bulk — network I/O
  mssql_bulk_insert: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },

  // Transactions — all involve network roundtrips
  mssql_begin_transaction: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },
  mssql_commit: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },
  mssql_rollback: {
    parameters: ["u64", "buffer"],
    result: "pointer",
    nonblocking: true,
  },

  // Cancel — placeholder (no-op)
  mssql_cancel: { parameters: ["u64"], result: "void" },

  // Error/memory — fast local operations
  mssql_last_error: { parameters: ["u64"], result: "pointer" },
  mssql_free_string: { parameters: ["pointer"], result: "void" },

  // FILESTREAM — sync file I/O (Windows only)
  mssql_filestream_available: { parameters: [], result: "u32" },
  mssql_filestream_open: { parameters: ["buffer"], result: "u64" },
  mssql_filestream_read: { parameters: ["u64", "u64"], result: "pointer" },
  mssql_filestream_write: { parameters: ["u64", "buffer"], result: "u64" },
  mssql_filestream_close: { parameters: ["u64"], result: "void" },

  // Diagnostics / Debug
  mssql_diagnostic_info: { parameters: [], result: "pointer" },
  mssql_set_debug: { parameters: ["u32"], result: "void" },

  // Cleanup
  mssql_close_all: { parameters: [], result: "void" },
} as const;

const encoder = new TextEncoder();

/** Encode a JS string as a null-terminated C string buffer. */
function toCString(s: string): ArrayBuffer {
  const bytes = encoder.encode(s);
  const buf = new Uint8Array(bytes.length + 1);
  buf.set(bytes);
  // Last byte is already 0 (null terminator)
  return buf.buffer;
}

/**
 * Read a C string from a pointer, then free it via mssql_free_string.
 * Returns null if the pointer is null.
 */
function readAndFree(
  lib: Deno.DynamicLibrary<typeof SYMBOLS>,
  ptr: Deno.PointerValue,
): string | null {
  if (ptr === null) return null;
  const view = new Deno.UnsafePointerView(ptr);
  const str = view.getCString();
  lib.symbols.mssql_free_string(ptr);
  return str;
}

/**
 * Open the native library and return a RuntimeFFI implementation.
 */
export function createFFI(libPath: string): RuntimeFFI {
  const lib = Deno.dlopen(libPath, SYMBOLS);

  return {
    async poolCreate(configJson: string): Promise<bigint> {
      const buf = toCString(configJson);
      return await lib.symbols.mssql_pool_create(buf);
    },

    async poolAcquire(poolId: bigint): Promise<bigint> {
      return await lib.symbols.mssql_pool_acquire(poolId);
    },

    poolRelease(poolId: bigint, connId: bigint): void {
      lib.symbols.mssql_pool_release(poolId, connId);
    },

    poolClose(poolId: bigint): void {
      lib.symbols.mssql_pool_close(poolId);
    },

    async connect(configJson: string): Promise<bigint> {
      const buf = toCString(configJson);
      return await lib.symbols.mssql_connect(buf);
    },

    disconnect(connId: bigint): void {
      lib.symbols.mssql_disconnect(connId);
    },

    async query(connId: bigint, cmdJson: string): Promise<string | null> {
      const buf = toCString(cmdJson);
      const ptr = await lib.symbols.mssql_query(connId, buf);
      return readAndFree(lib, ptr);
    },

    async executeNonquery(
      connId: bigint,
      cmdJson: string,
    ): Promise<string | null> {
      const buf = toCString(cmdJson);
      const ptr = await lib.symbols.mssql_execute_nonquery(connId, buf);
      return readAndFree(lib, ptr);
    },

    async exec(connId: bigint, cmdJson: string): Promise<string | null> {
      const buf = toCString(cmdJson);
      const ptr = await lib.symbols.mssql_exec(connId, buf);
      return readAndFree(lib, ptr);
    },

    async queryStream(connId: bigint, cmdJson: string): Promise<bigint> {
      const buf = toCString(cmdJson);
      return await lib.symbols.mssql_query_stream(connId, buf);
    },

    async streamNext(cursorId: bigint): Promise<string | null> {
      const ptr = await lib.symbols.mssql_stream_next(cursorId);
      return readAndFree(lib, ptr);
    },

    streamClose(cursorId: bigint): void {
      lib.symbols.mssql_stream_close(cursorId);
    },

    async bulkInsert(connId: bigint, reqJson: string): Promise<string | null> {
      const buf = toCString(reqJson);
      const ptr = await lib.symbols.mssql_bulk_insert(connId, buf);
      return readAndFree(lib, ptr);
    },

    async beginTransaction(
      connId: bigint,
      txJson: string,
    ): Promise<string | null> {
      const buf = toCString(txJson);
      const ptr = await lib.symbols.mssql_begin_transaction(connId, buf);
      return readAndFree(lib, ptr);
    },

    async commit(connId: bigint, txId: string): Promise<string | null> {
      const buf = toCString(txId);
      const ptr = await lib.symbols.mssql_commit(connId, buf);
      return readAndFree(lib, ptr);
    },

    async rollback(connId: bigint, txId: string): Promise<string | null> {
      const buf = toCString(txId);
      const ptr = await lib.symbols.mssql_rollback(connId, buf);
      return readAndFree(lib, ptr);
    },

    cancel(connId: bigint): void {
      lib.symbols.mssql_cancel(connId);
    },

    lastError(handleId: bigint): string | null {
      const ptr = lib.symbols.mssql_last_error(handleId) as Deno.PointerValue;
      return readAndFree(lib, ptr);
    },

    filestreamAvailable(): boolean {
      return (lib.symbols.mssql_filestream_available() as number) !== 0;
    },

    filestreamOpen(reqJson: string): bigint {
      const buf = toCString(reqJson);
      return lib.symbols.mssql_filestream_open(buf) as bigint;
    },

    filestreamRead(fsId: bigint, maxBytes: bigint): string | null {
      const ptr = lib.symbols.mssql_filestream_read(
        fsId,
        maxBytes,
      ) as Deno.PointerValue;
      return readAndFree(lib, ptr);
    },

    filestreamWrite(fsId: bigint, dataBase64: string): bigint {
      const buf = toCString(dataBase64);
      return lib.symbols.mssql_filestream_write(fsId, buf) as bigint;
    },

    filestreamClose(fsId: bigint): void {
      lib.symbols.mssql_filestream_close(fsId);
    },

    diagnosticInfo(): string | null {
      const ptr = lib.symbols.mssql_diagnostic_info() as Deno.PointerValue;
      return readAndFree(lib, ptr);
    },

    setDebug(enabled: number): void {
      lib.symbols.mssql_set_debug(enabled);
    },

    closeAll(): void {
      lib.symbols.mssql_close_all();
    },
  };
}

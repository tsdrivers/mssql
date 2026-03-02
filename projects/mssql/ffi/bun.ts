/**
 * Bun FFI adapter — wraps bun:ffi's dlopen into RuntimeFFI interface.
 *
 * bun:ffi does not support nonblocking calls, so I/O-bound methods
 * wrap their synchronous results in resolved Promises to satisfy
 * the async RuntimeFFI interface.
 *
 * @module
 */

import type { RuntimeFFI } from "../core/runtime.ts";

// deno-lint-ignore no-explicit-any
type BunFFILib = any;

const encoder = new TextEncoder();

/** Encode a JS string as a null-terminated C string buffer. */
function toCString(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  const buf = new Uint8Array(bytes.length + 1);
  buf.set(bytes);
  return buf;
}

/**
 * Open the native library using bun:ffi and return a RuntimeFFI implementation.
 */
export async function createFFI(libPath: string): Promise<RuntimeFFI> {
  // Dynamic import to avoid Deno/Node type errors
  const bunFFI = await import("bun:ffi");
  const { dlopen, FFIType, CString, ptr } = bunFFI;

  const lib: BunFFILib = dlopen(libPath, {
    mssql_pool_create: { args: [FFIType.ptr], returns: FFIType.u64 },
    mssql_pool_acquire: { args: [FFIType.u64], returns: FFIType.u64 },
    mssql_pool_release: {
      args: [FFIType.u64, FFIType.u64],
      returns: FFIType.void,
    },
    mssql_pool_close: { args: [FFIType.u64], returns: FFIType.void },
    mssql_connect: { args: [FFIType.ptr], returns: FFIType.u64 },
    mssql_disconnect: { args: [FFIType.u64], returns: FFIType.void },
    mssql_query: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
    mssql_execute_nonquery: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.ptr,
    },
    mssql_exec: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
    mssql_query_stream: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.u64,
    },
    mssql_stream_next: { args: [FFIType.u64], returns: FFIType.ptr },
    mssql_stream_close: { args: [FFIType.u64], returns: FFIType.void },
    mssql_bulk_insert: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.ptr,
    },
    mssql_begin_transaction: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.ptr,
    },
    mssql_commit: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
    mssql_rollback: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
    mssql_cancel: { args: [FFIType.u64], returns: FFIType.void },
    mssql_last_error: { args: [FFIType.u64], returns: FFIType.ptr },
    mssql_free_string: { args: [FFIType.ptr], returns: FFIType.void },
    mssql_filestream_available: { args: [], returns: FFIType.u32 },
    mssql_filestream_open: { args: [FFIType.ptr], returns: FFIType.u64 },
    mssql_filestream_read: {
      args: [FFIType.u64, FFIType.u64],
      returns: FFIType.ptr,
    },
    mssql_filestream_write: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.u64,
    },
    mssql_filestream_close: { args: [FFIType.u64], returns: FFIType.void },

    // Diagnostics / Debug
    mssql_diagnostic_info: { args: [], returns: FFIType.ptr },
    mssql_set_debug: { args: [FFIType.u32], returns: FFIType.void },

    // Cleanup
    mssql_close_all: { args: [], returns: FFIType.void },
  });

  const sym = lib.symbols;

  /** Read a C string from a pointer, then free it. Returns null for null pointers. */
  function readAndFree(rawPtr: number | bigint | null): string | null {
    if (rawPtr === null || rawPtr === 0 || rawPtr === 0n) return null;
    const str = new CString(rawPtr);
    sym.mssql_free_string(rawPtr);
    return str.toString();
  }

  return {
    async poolCreate(configJson: string): Promise<bigint> {
      const buf = toCString(configJson);
      return BigInt(sym.mssql_pool_create(ptr(buf)));
    },

    async poolAcquire(poolId: bigint): Promise<bigint> {
      return BigInt(sym.mssql_pool_acquire(poolId));
    },

    poolRelease(poolId: bigint, connId: bigint): void {
      sym.mssql_pool_release(poolId, connId);
    },

    poolClose(poolId: bigint): void {
      sym.mssql_pool_close(poolId);
    },

    async connect(configJson: string): Promise<bigint> {
      const buf = toCString(configJson);
      return BigInt(sym.mssql_connect(ptr(buf)));
    },

    disconnect(connId: bigint): void {
      sym.mssql_disconnect(connId);
    },

    async query(connId: bigint, cmdJson: string): Promise<string | null> {
      const buf = toCString(cmdJson);
      const result = sym.mssql_query(connId, ptr(buf));
      return readAndFree(result);
    },

    async executeNonquery(
      connId: bigint,
      cmdJson: string,
    ): Promise<string | null> {
      const buf = toCString(cmdJson);
      const result = sym.mssql_execute_nonquery(connId, ptr(buf));
      return readAndFree(result);
    },

    async exec(connId: bigint, cmdJson: string): Promise<string | null> {
      const buf = toCString(cmdJson);
      const result = sym.mssql_exec(connId, ptr(buf));
      return readAndFree(result);
    },

    async queryStream(connId: bigint, cmdJson: string): Promise<bigint> {
      const buf = toCString(cmdJson);
      return BigInt(sym.mssql_query_stream(connId, ptr(buf)));
    },

    async streamNext(cursorId: bigint): Promise<string | null> {
      const result = sym.mssql_stream_next(cursorId);
      return readAndFree(result);
    },

    streamClose(cursorId: bigint): void {
      sym.mssql_stream_close(cursorId);
    },

    async bulkInsert(connId: bigint, reqJson: string): Promise<string | null> {
      const buf = toCString(reqJson);
      const result = sym.mssql_bulk_insert(connId, ptr(buf));
      return readAndFree(result);
    },

    async beginTransaction(
      connId: bigint,
      txJson: string,
    ): Promise<string | null> {
      const buf = toCString(txJson);
      const result = sym.mssql_begin_transaction(connId, ptr(buf));
      return readAndFree(result);
    },

    async commit(connId: bigint, txId: string): Promise<string | null> {
      const buf = toCString(txId);
      const result = sym.mssql_commit(connId, ptr(buf));
      return readAndFree(result);
    },

    async rollback(connId: bigint, txId: string): Promise<string | null> {
      const buf = toCString(txId);
      const result = sym.mssql_rollback(connId, ptr(buf));
      return readAndFree(result);
    },

    cancel(connId: bigint): void {
      sym.mssql_cancel(connId);
    },

    lastError(handleId: bigint): string | null {
      const result = sym.mssql_last_error(handleId);
      return readAndFree(result);
    },

    filestreamAvailable(): boolean {
      return sym.mssql_filestream_available() !== 0;
    },

    filestreamOpen(reqJson: string): bigint {
      const buf = toCString(reqJson);
      return BigInt(sym.mssql_filestream_open(ptr(buf)));
    },

    filestreamRead(fsId: bigint, maxBytes: bigint): string | null {
      const result = sym.mssql_filestream_read(fsId, maxBytes);
      return readAndFree(result);
    },

    filestreamWrite(fsId: bigint, dataBase64: string): bigint {
      const buf = toCString(dataBase64);
      return BigInt(sym.mssql_filestream_write(fsId, ptr(buf)));
    },

    filestreamClose(fsId: bigint): void {
      sym.mssql_filestream_close(fsId);
    },

    diagnosticInfo(): string | null {
      const result = sym.mssql_diagnostic_info();
      return readAndFree(result);
    },

    setDebug(enabled: number): void {
      sym.mssql_set_debug(enabled);
    },

    closeAll(): void {
      sym.mssql_close_all();
    },
  };
}

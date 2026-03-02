/**
 * Abstract FFI interface that each runtime adapter implements.
 * All methods accept and return plain strings/numbers — no
 * runtime-specific pointer types leak into core.
 *
 * I/O-bound methods return Promises so that Deno can use
 * `nonblocking: true` FFI calls (runs native code on a background
 * thread instead of blocking the event loop). Node/Bun adapters
 * wrap their synchronous FFI calls in resolved Promises.
 *
 * @module
 */

export const INVALID_HANDLE = 0n;

export interface RuntimeFFI {
  // Pool
  poolCreate(configJson: string): Promise<bigint>;
  poolAcquire(poolId: bigint): Promise<bigint>;
  poolRelease(poolId: bigint, connId: bigint): void;
  poolClose(poolId: bigint): void;

  // Connection
  connect(configJson: string): Promise<bigint>;
  disconnect(connId: bigint): void;

  // Queries — return JSON string or null on error
  query(connId: bigint, cmdJson: string): Promise<string | null>;
  executeNonquery(connId: bigint, cmdJson: string): Promise<string | null>;
  exec(connId: bigint, cmdJson: string): Promise<string | null>;

  // Streaming
  queryStream(connId: bigint, cmdJson: string): Promise<bigint>;
  streamNext(cursorId: bigint): Promise<string | null>;
  streamClose(cursorId: bigint): void;

  // Bulk
  bulkInsert(connId: bigint, reqJson: string): Promise<string | null>;

  // Transactions
  beginTransaction(connId: bigint, txJson: string): Promise<string | null>;
  commit(connId: bigint, txId: string): Promise<string | null>;
  rollback(connId: bigint, txId: string): Promise<string | null>;

  // Cancel
  cancel(connId: bigint): void;

  // Error
  lastError(handleId: bigint): string | null;

  // FILESTREAM
  filestreamAvailable(): boolean;
  filestreamOpen(reqJson: string): bigint;
  filestreamRead(fsId: bigint, maxBytes: bigint): string | null;
  filestreamWrite(fsId: bigint, dataBase64: string): bigint;
  filestreamClose(fsId: bigint): void;

  // Diagnostics
  diagnosticInfo(): string | null;

  // Debug
  setDebug(enabled: number): void;

  // Cleanup
  closeAll(): void;
}

export interface RuntimeInfo {
  os: "windows" | "darwin" | "linux";
  arch: "x86_64" | "aarch64";
  runtime: "deno" | "node" | "bun";
}

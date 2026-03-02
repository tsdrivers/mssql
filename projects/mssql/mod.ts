/**
 * Unified SQL Server driver — auto-detects Deno, Node.js, or Bun at runtime.
 *
 * ```ts
 * import * as mssql from "@tracker1/mssql";
 *
 * const pool = await mssql.createPool("Server=localhost;Database=mydb;User Id=sa;Password=pass;");
 * const rows = await pool.query<{ name: string }>("SELECT name FROM Users");
 * await pool.close();
 * ```
 *
 * @module
 */

import type { MssqlConfig } from "./core/types.ts";
import { INVALID_HANDLE } from "./core/runtime.ts";
import { parseConnection, resolveTokenProvider } from "./core/config.ts";
import { MssqlConnection } from "./core/connection.ts";
import { MssqlPool } from "./core/pool.ts";
import { getFfi } from "./ffi/resolve.ts";

// ── FFI access ────────────────────────────────────────────────

export { disableExitHandler, getFfi, loadLibrary } from "./ffi/resolve.ts";

// ── Public API ────────────────────────────────────────────────

/**
 * Create a connection pool.
 *
 * @param input Connection string (ADO.NET or URL), or MssqlConfig object.
 */
export async function createPool(
  input: string | MssqlConfig,
): Promise<MssqlPool> {
  const ffi = await getFfi();
  const config = parseConnection(input);
  await resolveTokenProvider(config);
  const configJson = JSON.stringify(config);
  const poolId = await ffi.poolCreate(configJson);
  if (poolId === INVALID_HANDLE) {
    throw new Error(
      "Failed to create pool: " + (ffi.lastError(0n) ?? "unknown error"),
    );
  }
  return new MssqlPool(poolId, ffi);
}

/**
 * Create a single (non-pooled) connection.
 *
 * @param input Connection string (ADO.NET or URL), or MssqlConfig object.
 */
export async function connect(
  input: string | MssqlConfig,
): Promise<MssqlConnection> {
  const ffi = await getFfi();
  const config = parseConnection(input);
  await resolveTokenProvider(config);
  const configJson = JSON.stringify(config);
  const connId = await ffi.connect(configJson);
  if (connId === INVALID_HANDLE) {
    throw new Error(
      "Failed to connect: " + (ffi.lastError(0n) ?? "unknown error"),
    );
  }
  return new MssqlConnection(connId, ffi);
}

// ── Diagnostics / Debug ───────────────────────────────────────

/**
 * Get diagnostic information about active pools and connections.
 * Contains no credentials, connection strings, or passwords.
 */
export async function diagnosticInfo(): Promise<
  import("./core/types.ts").DiagnosticInfo
> {
  const ffi = await getFfi();
  const json = ffi.diagnosticInfo();
  if (!json) return { pools: [], connections: [] };
  return JSON.parse(json);
}

/**
 * Enable or disable debug logging from the Rust driver.
 * When enabled, debug messages are written to stderr.
 * Auto-enabled if the `MSSQLTS_DEBUG=1` environment variable is set.
 */
export async function setDebug(enabled: boolean): Promise<void> {
  const ffi = await getFfi();
  ffi.setDebug(enabled ? 1 : 0);
}

/**
 * Close all active pools, connections, cursors, and FILESTREAM handles.
 * Typically called during process shutdown.
 */
export async function closeAll(): Promise<void> {
  const ffi = await getFfi();
  ffi.closeAll();
}

// ── Re-exports from core (no FFI needed) ──────────────────────

export { newCOMB } from "./core/comb.ts";
export {
  setDatabaseUtf8,
  supportsUtf8,
  UTF8_COLLATIONS,
  utf8Column,
} from "./core/collation.ts";
export { ExecResult } from "./core/exec_result.ts";
export { Transaction } from "./core/transaction.ts";
export { QueryStream } from "./core/stream.ts";
export { PooledQueryStream } from "./core/pool.ts";
export { BulkInsertBuilder } from "./core/bulk.ts";
export {
  FilestreamDuplex,
  FilestreamReadable,
  FilestreamWritable,
} from "./core/filestream.ts";
export type { FilestreamWebResult } from "./core/filestream.ts";
export { MssqlConnection } from "./core/connection.ts";
export { MssqlPool } from "./core/pool.ts";
export { parseConnection } from "./core/config.ts";
export {
  downloadUrl,
  libraryFileName,
  resolveLibraryPath,
} from "./core/binary.ts";
export type {
  BulkColumn,
  CommandOptions,
  CommandType,
  DiagnosticConnection,
  DiagnosticInfo,
  DiagnosticPool,
  FilestreamMode,
  IsolationLevel,
  MssqlConfig,
  NormalizedConfig,
  Params,
  ParamValue,
  SqlType,
  TypedParam,
  Utf8Collation,
} from "./core/types.ts";

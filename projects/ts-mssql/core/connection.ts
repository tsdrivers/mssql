/**
 * MssqlConnection — wraps a single FFI connection handle.
 * @module
 */

import type { RuntimeFFI } from "./runtime.ts";
import { INVALID_HANDLE } from "./runtime.ts";
import type {
  CommandOptions,
  FilestreamMode,
  IsolationLevel,
  Params,
  ParamValue,
  SerializedCommand,
  SerializedParam,
  StreamOptions,
  TypedParam,
} from "./types.ts";
import { ExecResult } from "./exec_result.ts";
import type { ExecResultRaw } from "./exec_result.ts";
import { Transaction } from "./transaction.ts";
import { QueryStream } from "./stream.ts";
import { BulkInsertBuilder } from "./bulk.ts";
import {
  FilestreamDuplex,
  FilestreamHandle,
  FilestreamReadable,
  FilestreamWritable,
} from "./filestream.ts";
import type { FilestreamWebResult } from "./filestream.ts";
import type { BlobTarget } from "./blob.ts";
import {
  BlobReadable,
  BlobWritable,
  createBlobReadableStream,
  createBlobWritableStream,
  type DisposableReadableStream,
  type DisposableWritableStream,
} from "./blob.ts";
import type { Duplex, Readable, Writable } from "node:stream";

/**
 * A single connection to SQL Server.
 *
 * Use `await using` for automatic cleanup:
 * ```ts
 * await using cn = await mssql.connect(connectionString);
 * const rows = await cn.query<User>("SELECT * FROM Users");
 * ```
 */
export class MssqlConnection implements Disposable, AsyncDisposable {
  #connId: bigint;
  #ffi: RuntimeFFI;
  #poolId: bigint | null;
  #disposed = false;
  #hasError = false;
  #streams: Set<QueryStream<unknown>> = new Set();
  #transactions: Set<Transaction> = new Set();

  /** @internal */
  constructor(connId: bigint, ffi: RuntimeFFI, poolId: bigint | null = null) {
    this.#connId = connId;
    this.#ffi = ffi;
    this.#poolId = poolId;
  }

  /** Execute a query and return all rows. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T[]> {
    this.#ensureOpen(opts);
    const cmdJson = serializeCommand(sql, params, opts);
    const result = await this.#ffi.query(this.#connId, cmdJson);
    if (result === null) {
      this.#hasError = true;
      throw new Error(this.#ffi.lastError(this.#connId) ?? "Query failed");
    }
    return JSON.parse(result) as T[];
  }

  /** Execute a query and return the first row, or undefined. */
  async queryFirst<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params, opts);
    return rows[0];
  }

  /** Execute a query and return exactly one row. Throws if not exactly 1. */
  async querySingle<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T> {
    const rows = await this.query<T>(sql, params, opts);
    if (rows.length !== 1) {
      throw new Error(`Expected exactly 1 row, got ${rows.length}`);
    }
    return rows[0];
  }

  /** Execute a query and return the first column of the first row. */
  async scalar<T = unknown>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T | undefined> {
    const row = await this.queryFirst<Record<string, unknown>>(
      sql,
      params,
      opts,
    );
    if (!row) return undefined;
    const keys = Object.keys(row);
    return (keys.length > 0 ? row[keys[0]] : undefined) as T | undefined;
  }

  /** Execute a non-query and return the number of rows affected. */
  async execute(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<number> {
    this.#ensureOpen(opts);
    const cmdJson = serializeCommand(sql, params, opts);
    const result = await this.#ffi.executeNonquery(this.#connId, cmdJson);
    if (result === null) {
      this.#hasError = true;
      throw new Error(this.#ffi.lastError(this.#connId) ?? "Execute failed");
    }
    return (JSON.parse(result) as { rowsAffected: number }).rowsAffected;
  }

  /**
   * Execute a stored procedure and return a rich result with OUTPUT
   * parameters and multiple result sets.
   */
  async exec(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<ExecResult> {
    this.#ensureOpen(opts);
    const cmdJson = serializeCommand(sql, params, opts);
    const result = await this.#ffi.exec(this.#connId, cmdJson);
    if (result === null) {
      this.#hasError = true;
      throw new Error(this.#ffi.lastError(this.#connId) ?? "Exec failed");
    }
    return new ExecResult(JSON.parse(result) as ExecResultRaw);
  }

  /** Tagged template for parameterized queries. */
  sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: ParamValue[]
  ): Promise<T[]> {
    const { sql, params } = buildTaggedTemplate(strings, values);
    return this.query<T>(sql, params);
  }

  /** Tagged template with options. */
  sqlWith(opts: CommandOptions): <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: ParamValue[]
  ) => Promise<T[]> {
    return <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: ParamValue[]
    ): Promise<T[]> => {
      const { sql, params } = buildTaggedTemplate(strings, values);
      return this.query<T>(sql, params, opts);
    };
  }

  /** Open a streaming query for large result sets. */
  async queryStream<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: StreamOptions,
  ): Promise<QueryStream<T>> {
    this.#ensureOpen(opts);
    const cmdJson = serializeCommand(sql, params, opts);
    const cursorId = await this.#ffi.queryStream(this.#connId, cmdJson);
    if (cursorId === INVALID_HANDLE) {
      this.#hasError = true;
      throw new Error(
        this.#ffi.lastError(this.#connId) ?? "Failed to open stream",
      );
    }
    const stream = new QueryStream<T>(cursorId, this.#ffi);

    // Track at connection level; auto-untrack on close
    this.#streams.add(stream as QueryStream<unknown>);
    stream._onClose(() => {
      this.#streams.delete(stream as QueryStream<unknown>);
    });

    // Also track at transaction level if within a transaction
    if (opts?.transaction && opts.transaction instanceof Transaction) {
      opts.transaction._trackStream(stream as QueryStream<unknown>);
    }

    return stream;
  }

  /** Create a bulk insert builder for the given table. */
  bulk(table: string): BulkInsertBuilder {
    this.#ensureOpen();
    return new BulkInsertBuilder(table, this.#connId, this.#ffi);
  }

  /** Begin a transaction with the given isolation level. */
  async beginTransaction(
    isolation: IsolationLevel = "READ_COMMITTED",
  ): Promise<Transaction> {
    this.#ensureOpen();
    const tx = new Transaction(
      isolation,
      async (txId: string) => {
        const err = await this.#ffi.commit(this.#connId, txId);
        if (err !== null) throw new Error(`Commit failed: ${err}`);
      },
      async (txId: string) => {
        const err = await this.#ffi.rollback(this.#connId, txId);
        if (err !== null) throw new Error(`Rollback failed: ${err}`);
      },
    );

    const txJson = JSON.stringify({ id: tx.id, isolation });
    const err = await this.#ffi.beginTransaction(this.#connId, txJson);
    if (err !== null) {
      this.#hasError = true;
      throw new Error(`Begin transaction failed: ${err}`);
    }

    this.#transactions.add(tx);
    return tx;
  }

  // ── Sub-object APIs ──────────────────────────────────────────

  /**
   * FILESTREAM access (Windows only).
   *
   * ```ts
   * cn.fs.open(path, ctx, "read")    // node:stream Readable/Writable/Duplex
   * cn.fs.openWeb(path, ctx, "read") // Web ReadableStream/WritableStream
   * cn.fs.available()                // check availability
   * ```
   */
  get fs(): FilestreamAccessor {
    return new FilestreamAccessor(this, this.#ffi);
  }

  /**
   * Cross-platform VARBINARY(MAX) blob streaming. Requires a transaction.
   *
   * ```ts
   * cn.blob.filestream.read(tx, target)  // node:stream Readable
   * cn.blob.filestream.write(tx, target) // node:stream Writable
   * cn.blob.webstream.read(tx, target)   // Web ReadableStream
   * cn.blob.webstream.write(tx, target)  // Web WritableStream
   * ```
   */
  get blob(): BlobAccessor {
    return new BlobAccessor(this);
  }

  /**
   * Close this connection permanently.
   * For pooled connections, the connection is evicted (NOT returned to pool).
   * Cascades: disposes transactions, closes streams, then destroys the connection.
   */
  async close(): Promise<void> {
    if (!this.#disposed) {
      this.#disposed = true;
      await this.#cleanup();
      this.#ffi.disconnect(this.#connId);
    }
  }

  [Symbol.dispose](): void {
    if (!this.#disposed) {
      this.#disposed = true;
      const hadActiveTx = this.#syncCleanup();
      if (this.#poolId !== null && !this.#hasError && !hadActiveTx) {
        this.#ffi.poolRelease(this.#poolId, this.#connId);
      } else {
        this.#ffi.disconnect(this.#connId);
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#disposed) {
      this.#disposed = true;
      await this.#cleanup();
      if (this.#poolId !== null && !this.#hasError) {
        this.#ffi.poolRelease(this.#poolId, this.#connId);
      } else {
        this.#ffi.disconnect(this.#connId);
      }
    }
  }

  /**
   * Synchronous cleanup for `Symbol.dispose`. Closes streams, force-deactivates
   * transactions (no rollback — server cleans up when connection is destroyed).
   * Returns true if any transaction was still active.
   */
  #syncCleanup(): boolean {
    let hadActiveTx = false;

    // 1. Force-deactivate all tracked transactions
    const txs = [...this.#transactions];
    this.#transactions.clear();
    for (const tx of txs) {
      try {
        if (tx.isActive) hadActiveTx = true;
        tx._forceInactive();
      } catch { /* best-effort */ }
    }

    // 2. Close all tracked streams
    const streams = [...this.#streams];
    this.#streams.clear();
    for (const s of streams) {
      try {
        s.close();
      } catch { /* best-effort */ }
    }

    return hadActiveTx;
  }

  /**
   * Cascading cleanup: dispose all transactions (which closes their streams
   * and rolls back), then close any remaining orphan streams.
   */
  async #cleanup(): Promise<void> {
    // 1. Dispose all tracked transactions (closes their streams, rolls back)
    const txs = [...this.#transactions];
    this.#transactions.clear();
    for (const tx of txs) {
      try {
        await tx._dispose();
      } catch { /* best-effort */ }
    }

    // 2. Close any remaining orphan streams
    const streams = [...this.#streams];
    this.#streams.clear();
    for (const s of streams) {
      try {
        s.close();
      } catch { /* best-effort */ }
    }
  }

  #ensureOpen(opts?: CommandOptions): void {
    if (this.#disposed) throw new Error("Connection is closed");
    opts?.signal?.throwIfAborted();
    opts?.transaction?._ensureActive();
  }
}

// ── Accessor classes for sub-object APIs ─────────────────────

/** @internal Windows FILESTREAM sub-object: `cn.fs` */
export class FilestreamAccessor {
  #cn: MssqlConnection;
  #ffi: RuntimeFFI;

  constructor(cn: MssqlConnection, ffi: RuntimeFFI) {
    this.#cn = cn;
    this.#ffi = ffi;
  }

  /** Open as `node:stream` Readable, Writable, or Duplex. Windows only. */
  open(path: string, ctx: Uint8Array | string, mode: "read"): Readable;
  open(path: string, ctx: Uint8Array | string, mode: "write"): Writable;
  open(path: string, ctx: Uint8Array | string, mode: "readwrite"): Duplex;
  open(
    path: string,
    ctx: Uint8Array | string,
    mode: FilestreamMode,
  ): Readable | Writable | Duplex {
    const handle = FilestreamHandle._open(this.#ffi, path, ctx, mode);
    switch (mode) {
      case "read":
        return new FilestreamReadable(handle);
      case "write":
        return new FilestreamWritable(handle);
      case "readwrite":
        return new FilestreamDuplex(handle);
    }
  }

  /** Open as Web Standard ReadableStream, WritableStream, or both. Windows only. */
  openWeb(
    path: string,
    ctx: Uint8Array | string,
    mode: "read",
  ): DisposableReadableStream;
  openWeb(
    path: string,
    ctx: Uint8Array | string,
    mode: "write",
  ): DisposableWritableStream;
  openWeb(
    path: string,
    ctx: Uint8Array | string,
    mode: "readwrite",
  ): FilestreamWebResult;
  openWeb(
    path: string,
    ctx: Uint8Array | string,
    mode: FilestreamMode,
  ): DisposableReadableStream | DisposableWritableStream | FilestreamWebResult {
    const handle = FilestreamHandle._open(this.#ffi, path, ctx, mode);
    switch (mode) {
      case "read":
        return handle.toReadableStream();
      case "write":
        return handle.toWritableStream();
      case "readwrite":
        return {
          readable: handle.toReadableStream(),
          writable: handle.toWritableStream(),
        };
    }
  }

  /**
   * Check if FILESTREAM is available end-to-end: ODBC driver,
   * server-level configuration, and database-level filegroup.
   */
  async available(database?: string): Promise<boolean> {
    if (!this.#ffi.filestreamAvailable()) return false;

    try {
      const level = await this.#cn.scalar<number>(
        "SELECT CAST(value_in_use AS int) FROM sys.configurations WHERE name = 'filestream access level'",
      );
      if ((level ?? 0) < 2) return false;
    } catch {
      return false;
    }

    try {
      const dbName = database?.replace(/^\[|\]$/g, "");
      const fgCount = dbName
        ? await this.#cn.scalar<number>(
          `SELECT COUNT(*) FROM [${
            dbName.replace(/\]/g, "]]")
          }].sys.filegroups WHERE type = 'FD'`,
        )
        : await this.#cn.scalar<number>(
          "SELECT COUNT(*) FROM sys.filegroups WHERE type = 'FD'",
        );
      return (fgCount ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

/** @internal Cross-platform blob streaming sub-object: `cn.blob` */
export class BlobAccessor {
  #cn: MssqlConnection;

  constructor(cn: MssqlConnection) {
    this.#cn = cn;
  }

  /** Node.js stream interface for blob read/write. */
  get filestream(): BlobFilestreamAccessor {
    return new BlobFilestreamAccessor(this.#cn);
  }

  /** Web Standard stream interface for blob read/write. */
  get webstream(): BlobWebstreamAccessor {
    return new BlobWebstreamAccessor(this.#cn);
  }
}

/** @internal `cn.blob.filestream` — node:stream Readable/Writable for VARBINARY(MAX). */
export class BlobFilestreamAccessor {
  #cn: MssqlConnection;

  constructor(cn: MssqlConnection) {
    this.#cn = cn;
  }

  /** Read a VARBINARY(MAX) column as a `node:stream.Readable`. */
  read(tx: Transaction, target: BlobTarget): Readable {
    tx._ensureActive();
    return new BlobReadable(this.#cn, tx, target);
  }

  /** Write to a VARBINARY(MAX) column as a `node:stream.Writable`. */
  write(tx: Transaction, target: BlobTarget): Writable {
    tx._ensureActive();
    return new BlobWritable(this.#cn, tx, target);
  }
}

/** @internal `cn.blob.webstream` — Web ReadableStream/WritableStream for VARBINARY(MAX). */
export class BlobWebstreamAccessor {
  #cn: MssqlConnection;

  constructor(cn: MssqlConnection) {
    this.#cn = cn;
  }

  /** Read a VARBINARY(MAX) column as a Web `ReadableStream`. */
  read(tx: Transaction, target: BlobTarget): DisposableReadableStream {
    tx._ensureActive();
    return createBlobReadableStream(this.#cn, tx, target);
  }

  /** Write to a VARBINARY(MAX) column as a Web `WritableStream`. */
  write(tx: Transaction, target: BlobTarget): DisposableWritableStream {
    tx._ensureActive();
    return createBlobWritableStream(this.#cn, tx, target);
  }
}

// ── Serialization helpers ─────────────────────────────────────

/** @internal */
export function serializeCommand(
  sql: string,
  params?: Params,
  opts?: CommandOptions | StreamOptions,
): string {
  const cmd: SerializedCommand = {
    sql,
    params: serializeParams(params),
    transaction_id: opts?.transaction?.id ?? null,
    command_timeout_ms: opts?.commandTimeout ?? null,
    command_type: opts?.commandType ?? "text",
  };
  return JSON.stringify(cmd);
}

function serializeParams(params?: Params): SerializedParam[] {
  if (!params) return [];
  return Object.entries(params).map(([name, raw]) => {
    const isTyped = raw !== null && raw !== undefined &&
      typeof raw === "object" && "value" in raw && "type" in raw;

    const value = isTyped ? (raw as TypedParam).value : raw as ParamValue;
    const type = isTyped ? (raw as TypedParam).type : null;
    const output = isTyped ? (raw as TypedParam).output : undefined;

    const param: SerializedParam = {
      name,
      value: serializeValue(value),
      type,
    };
    if (output) param.output = true;
    return param;
  });
}

function serializeValue(val: ParamValue): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (val instanceof Uint8Array) return btoa(String.fromCharCode(...val));
  return val;
}

function buildTaggedTemplate(
  strings: TemplateStringsArray,
  values: ParamValue[],
): { sql: string; params: Params } {
  const params: Params = {};
  const parts: string[] = [strings[0]];
  for (let i = 0; i < values.length; i++) {
    const name = `p${i}`;
    params[name] = values[i];
    parts.push(`@${name}`);
    parts.push(strings[i + 1]);
  }
  return { sql: parts.join(""), params };
}

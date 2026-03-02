/**
 * MssqlPool — connection pool with convenience query methods.
 * @module
 */

import type { RuntimeFFI } from "./runtime.ts";
import { INVALID_HANDLE } from "./runtime.ts";
import type { CommandOptions, Params, ParamValue, StreamOptions } from "./types.ts";
import type { ExecResult } from "./exec_result.ts";
import { MssqlConnection } from "./connection.ts";
import { QueryStream } from "./stream.ts";
import { BulkInsertBuilder } from "./bulk.ts";

/**
 * A connection pool for SQL Server. Acquire connections or use
 * convenience methods that auto-acquire and release.
 *
 * @example
 * ```ts
 * const pool = await mssql.createPool(connectionString);
 * const users = await pool.query<User>("SELECT * FROM Users");
 * await pool.close();
 * ```
 */
export class MssqlPool implements Disposable, AsyncDisposable {
  #poolId: bigint;
  #ffi: RuntimeFFI;
  #closed = false;

  /** @internal */
  constructor(poolId: bigint, ffi: RuntimeFFI) {
    this.#poolId = poolId;
    this.#ffi = ffi;
  }

  /** Acquire a connection from the pool. */
  async connect(): Promise<MssqlConnection> {
    this.#ensureOpen();
    const connId = await this.#ffi.poolAcquire(this.#poolId);
    if (connId === INVALID_HANDLE) {
      throw new Error(
        this.#ffi.lastError(this.#poolId) ??
          "Failed to acquire connection from pool",
      );
    }
    return new MssqlConnection(connId, this.#ffi, this.#poolId);
  }

  /** Execute a query using an auto-acquired connection. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T[]> {
    await using cn = await this.connect();
    // `return await` is required: with `await using`, disposal runs when the
    // `return` statement is reached, not when the returned Promise resolves.
    // Without `await`, poolRelease would run while the nonblocking FFI query
    // is still in-flight on the background thread.
    return await cn.query<T>(sql, params, opts);
  }

  /** Execute a query and return the first row, or undefined. */
  async queryFirst<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T | undefined> {
    await using cn = await this.connect();
    return await cn.queryFirst<T>(sql, params, opts);
  }

  /** Execute a query and return exactly one row. */
  async querySingle<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T> {
    await using cn = await this.connect();
    return await cn.querySingle<T>(sql, params, opts);
  }

  /** Execute a query and return the first column of the first row. */
  async scalar<T = unknown>(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<T | undefined> {
    await using cn = await this.connect();
    return await cn.scalar<T>(sql, params, opts);
  }

  /** Execute a non-query and return the number of rows affected. */
  async execute(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<number> {
    await using cn = await this.connect();
    return await cn.execute(sql, params, opts);
  }

  /** Execute a stored procedure using an auto-acquired connection. */
  async exec(
    sql: string,
    params?: Params,
    opts?: CommandOptions,
  ): Promise<ExecResult> {
    await using cn = await this.connect();
    return await cn.exec(sql, params, opts);
  }

  /** Tagged template for parameterized queries. */
  async sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: ParamValue[]
  ): Promise<T[]> {
    await using cn = await this.connect();
    return await cn.sql<T>(strings, ...values);
  }

  /**
   * Open a streaming query. The connection is held until the stream closes.
   */
  async queryStream<T = Record<string, unknown>>(
    sql: string,
    params?: Params,
    opts?: StreamOptions,
  ): Promise<PooledQueryStream<T>> {
    const cn = await this.connect();
    try {
      const stream = await cn.queryStream<T>(sql, params, opts);
      return new PooledQueryStream(stream, cn);
    } catch (err) {
      await cn.disconnect();
      throw err;
    }
  }

  /**
   * Create a bulk insert builder. Connection is acquired on execute() and
   * released automatically afterward.
   */
  bulk(table: string): PoolBulkInsertBuilder {
    this.#ensureOpen();
    return new PoolBulkInsertBuilder(table, this);
  }

  /**
   * Check if FILESTREAM is available end-to-end: local OLE DB driver,
   * server-level configuration, and database-level filegroup.
   *
   * @param database Optional database name (with or without square brackets).
   *                 Defaults to the current connection's database.
   */
  async filestreamAvailable(database?: string): Promise<boolean> {
    await using cn = await this.connect();
    return await cn.filestreamAvailable(database);
  }

  /** Close the pool and all connections. */
  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#ffi.poolClose(this.#poolId);
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("Pool is closed");
  }
}

/**
 * A QueryStream that holds a pooled connection and releases it when closed.
 */
export class PooledQueryStream<T = Record<string, unknown>>
  implements AsyncIterable<T>, Disposable, AsyncDisposable {
  #inner: QueryStream<T>;
  #conn: MssqlConnection;

  /** @internal */
  constructor(inner: QueryStream<T>, conn: MssqlConnection) {
    this.#inner = inner;
    this.#conn = conn;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      for await (const row of this.#inner) {
        yield row;
      }
    } finally {
      await this.close();
    }
  }

  async toArray(): Promise<T[]> {
    const results: T[] = [];
    for await (const row of this) results.push(row);
    return results;
  }

  async map<U>(fn: (row: T) => U): Promise<U[]> {
    const results: U[] = [];
    for await (const row of this) results.push(fn(row));
    return results;
  }

  async filter(fn: (row: T) => boolean): Promise<T[]> {
    const results: T[] = [];
    for await (const row of this) {
      if (fn(row)) results.push(row);
    }
    return results;
  }

  async reduce<U>(fn: (acc: U, row: T) => U, initial: U): Promise<U> {
    let acc = initial;
    for await (const row of this) acc = fn(acc, row);
    return acc;
  }

  toReadableStream(): ReadableStream<T> {
    return this.#inner.toReadableStream();
  }

  async close(): Promise<void> {
    this.#inner.close();
    await this.#conn[Symbol.asyncDispose]();
  }

  [Symbol.dispose](): void {
    this.#inner.close();
    this.#conn[Symbol.dispose]();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * Bulk insert builder that acquires a pool connection on execute.
 */
class PoolBulkInsertBuilder {
  #table: string;
  #pool: MssqlPool;
  #columns: import("./types.ts").BulkColumn[] = [];
  #rows: unknown[][] = [];
  #batchSize = 0;

  constructor(table: string, pool: MssqlPool) {
    this.#table = table;
    this.#pool = pool;
  }

  columns(cols: import("./types.ts").BulkColumn[]): this {
    this.#columns = cols;
    return this;
  }

  rows(rows: import("./types.ts").ParamValue[][]): this {
    this.#rows.push(...rows);
    return this;
  }

  fromObjects(
    objects: Record<string, import("./types.ts").ParamValue>[],
  ): this {
    for (const obj of objects) {
      const row = this.#columns.map((col) => {
        const val = obj[col.name];
        return val === undefined ? null : val;
      });
      this.#rows.push(row);
    }
    return this;
  }

  async fromAsyncIterable<T>(
    source: AsyncIterable<T>,
    transform: (item: T) => import("./types.ts").ParamValue[],
  ): Promise<this> {
    for await (const item of source) {
      this.#rows.push(transform(item));
    }
    return this;
  }

  batchSize(size: number): this {
    this.#batchSize = size;
    return this;
  }

  async execute(): Promise<number> {
    await using cn = await this.#pool.connect();
    const builder = cn.bulk(this.#table);
    builder.columns(this.#columns);
    builder.rows(this.#rows as import("./types.ts").ParamValue[][]);
    if (this.#batchSize > 0) builder.batchSize(this.#batchSize);
    return await builder.execute();
  }
}

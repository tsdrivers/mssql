/**
 * Builder for bulk insert operations using SQL Server's native TDS BulkLoad.
 * @module
 */

import type { RuntimeFFI } from "./runtime.ts";
import type { BulkColumn, ParamValue } from "./types.ts";

/**
 * Builder for bulk insert operations.
 *
 * @example
 * ```ts
 * await cn.bulk("Users")
 *   .columns([
 *     { name: "Id", type: "uniqueidentifier" },
 *     { name: "Name", type: "nvarchar" },
 *   ])
 *   .rows([
 *     [mssql.newCOMB(), "Alice"],
 *     [mssql.newCOMB(), "Bob"],
 *   ])
 *   .execute();
 * ```
 */
export class BulkInsertBuilder {
  #table: string;
  #columns: BulkColumn[] = [];
  #rows: unknown[][] = [];
  #connId: bigint;
  #ffi: RuntimeFFI;
  #batchSize = 0;

  /** @internal */
  constructor(table: string, connId: bigint, ffi: RuntimeFFI) {
    this.#table = table;
    this.#connId = connId;
    this.#ffi = ffi;
  }

  /** Define the columns for the bulk insert. */
  columns(cols: BulkColumn[]): this {
    this.#columns = cols;
    return this;
  }

  /** Add rows as positional arrays (matching column order). */
  rows(rows: ParamValue[][]): this {
    this.#rows.push(...rows);
    return this;
  }

  /** Add rows from an array of objects (keys matching column names). */
  fromObjects(objects: Record<string, ParamValue>[]): this {
    for (const obj of objects) {
      const row = this.#columns.map((col) => {
        const val = obj[col.name];
        return val === undefined ? null : val;
      });
      this.#rows.push(row);
    }
    return this;
  }

  /** Add rows from an async iterable with a transform function. */
  async fromAsyncIterable<T>(
    source: AsyncIterable<T>,
    transform: (item: T) => ParamValue[],
  ): Promise<this> {
    for await (const item of source) {
      this.#rows.push(transform(item));
    }
    return this;
  }

  /** Set batch size — rows are sent in chunks of this size. */
  batchSize(size: number): this {
    this.#batchSize = size;
    return this;
  }

  /** Execute the bulk insert. Returns total rows affected. */
  async execute(): Promise<number> {
    if (this.#columns.length === 0) {
      throw new Error("No columns defined for bulk insert");
    }

    const serializedRows = this.#rows.map((row) =>
      row.map((val) => {
        if (val instanceof Date) return val.toISOString();
        if (val instanceof Uint8Array) return btoa(String.fromCharCode(...val));
        return val ?? null;
      })
    );

    if (this.#batchSize > 0 && serializedRows.length > this.#batchSize) {
      return await this.#executeBatched(serializedRows);
    }

    return await this.#executeSingle(serializedRows);
  }

  async #executeSingle(rows: unknown[][]): Promise<number> {
    const request = JSON.stringify({
      table: this.#table,
      columns: this.#columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable ?? false,
      })),
      rows,
    });

    const result = await this.#ffi.bulkInsert(this.#connId, request);
    if (result === null) {
      const err = this.#ffi.lastError(this.#connId) ?? "Unknown error";
      throw new Error(`Bulk insert failed: ${err}`);
    }
    return (JSON.parse(result) as { rowsAffected: number }).rowsAffected;
  }

  async #executeBatched(rows: unknown[][]): Promise<number> {
    let total = 0;
    for (let i = 0; i < rows.length; i += this.#batchSize) {
      const chunk = rows.slice(i, i + this.#batchSize);
      total += await this.#executeSingle(chunk);
    }
    return total;
  }
}

/**
 * Cross-platform VARBINARY(MAX) blob streaming via SQL queries.
 *
 * Provides `node:stream` Readable/Writable and Web Standard
 * ReadableStream/WritableStream for reading and writing large binary
 * data in chunks — without loading the entire value into memory.
 *
 * - **Reads** use `SUBSTRING(column, offset, length)` in a loop.
 * - **Writes** use `UPDATE ... SET column.WRITE(@chunk, NULL, NULL)` to append.
 *
 * All blob streams require an active transaction for consistency —
 * concurrent modifications during a multi-chunk read or write would
 * corrupt the data without transactional isolation.
 *
 * Works on all platforms (Windows, Linux, macOS). For Windows-only
 * FILESTREAM I/O via the native file handle API, see `filestream.ts`.
 *
 * @module
 */

import { Readable, Writable } from "node:stream";

// ── Types ───────────────────────────────────────────────────────

/** Identifies the VARBINARY(MAX) column and row to stream. */
export interface BlobTarget {
  /** Table name (use bracket escaping for special characters, e.g. `"[dbo].[MyTable]"`). */
  table: string;
  /** VARBINARY(MAX) column name (use bracket escaping if needed). */
  column: string;
  /** WHERE clause identifying the row (e.g. `"id = @id"`). */
  where: string;
  /** Parameters for the WHERE clause. */
  params?: Record<string, unknown>;
  /** Chunk size in bytes for streaming. Default: 1 MB. */
  chunkSize?: number;
}

/** Transaction reference — must be active for the lifetime of the stream. */
interface TransactionRef {
  id: string;
  _ensureActive(): void;
}

// ── Helpers ─────────────────────────────────────────────────────

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  const CHUNK = 32768;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    out += String.fromCharCode(...slice);
  }
  return btoa(out);
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1 MB

// ── Query interface (subset of MssqlConnection) ─────────────────

/** Minimal query interface for blob streams. */
export interface BlobQueryable {
  queryFirst<T>(
    sql: string,
    params?: Record<string, unknown>,
    opts?: { transaction?: TransactionRef },
  ): Promise<T | undefined>;
  execute(
    sql: string,
    params?: Record<string, unknown>,
    opts?: { transaction?: TransactionRef },
  ): Promise<number>;
}

// ── Node.js-compatible streams ──────────────────────────────────

/**
 * A `node:stream.Readable` that reads a VARBINARY(MAX) column in chunks
 * using `SUBSTRING`. Works on all platforms.
 *
 * Requires an active transaction for consistent reads.
 */
export class BlobReadable extends Readable {
  #cn: BlobQueryable;
  #tx: TransactionRef;
  #table: string;
  #column: string;
  #where: string;
  #params: Record<string, unknown>;
  #chunkSize: number;
  #offset = 1; // SQL SUBSTRING is 1-based
  #done = false;

  /** @internal */
  constructor(cn: BlobQueryable, tx: TransactionRef, target: BlobTarget) {
    super();
    this.#cn = cn;
    this.#tx = tx;
    this.#table = target.table;
    this.#column = target.column;
    this.#where = target.where;
    this.#params = target.params ?? {};
    this.#chunkSize = target.chunkSize ?? DEFAULT_CHUNK_SIZE;
  }

  override _read(_size: number): void {
    if (this.#done) {
      this.push(null);
      return;
    }
    this.#readChunk()
      .then((chunk) => {
        if (!chunk || chunk.length === 0) {
          this.#done = true;
          this.push(null);
        } else {
          this.push(chunk);
          if (chunk.length < this.#chunkSize) {
            this.#done = true;
          }
        }
      })
      .catch((err) =>
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      );
  }

  async #readChunk(): Promise<Uint8Array | null> {
    this.#tx._ensureActive();
    const row = await this.#cn.queryFirst<{ __chunk: string | null }>(
      `SELECT SUBSTRING(${this.#column}, @__offset, @__len) AS __chunk ` +
        `FROM ${this.#table} WHERE ${this.#where}`,
      { ...this.#params, __offset: this.#offset, __len: this.#chunkSize },
      { transaction: this.#tx },
    );
    if (!row?.__chunk) return null;
    const bytes = fromBase64(row.__chunk);
    this.#offset += bytes.length;
    return bytes;
  }
}

/**
 * A `node:stream.Writable` that appends to a VARBINARY(MAX) column in chunks
 * using the `.WRITE(@chunk, NULL, NULL)` syntax. Works on all platforms.
 *
 * The target column must already have an initial value (even `0x` for empty).
 * Requires an active transaction for consistent writes.
 */
export class BlobWritable extends Writable {
  #cn: BlobQueryable;
  #tx: TransactionRef;
  #table: string;
  #column: string;
  #where: string;
  #params: Record<string, unknown>;

  /** @internal */
  constructor(cn: BlobQueryable, tx: TransactionRef, target: BlobTarget) {
    super();
    this.#cn = cn;
    this.#tx = tx;
    this.#table = target.table;
    this.#column = target.column;
    this.#where = target.where;
    this.#params = target.params ?? {};
  }

  override _write(
    chunk: Uint8Array,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    const data = chunk;
    const b64 = toBase64(data);
    this.#tx._ensureActive();
    this.#cn
      .execute(
        `UPDATE ${this.#table} SET ${this.#column}.WRITE(@__chunk, NULL, NULL) ` +
          `WHERE ${this.#where}`,
        { ...this.#params, __chunk: { value: b64, type: "varbinary" } },
        { transaction: this.#tx },
      )
      .then(() => callback())
      .catch((err) =>
        callback(err instanceof Error ? err : new Error(String(err)))
      );
  }
}

// ── Disposable Web Standard stream wrappers ─────────────────────

/**
 * A `ReadableStream<Uint8Array>` that supports `using` / `await using`.
 *
 * - `Symbol.dispose` calls `cancel()` synchronously (fire-and-forget).
 * - `Symbol.asyncDispose` awaits `cancel()`.
 */
export class DisposableReadableStream extends ReadableStream<Uint8Array>
  implements Disposable, AsyncDisposable {
  [Symbol.dispose](): void {
    this.cancel();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.cancel();
  }
}

/**
 * A `WritableStream<Uint8Array>` that supports `using` / `await using`.
 *
 * - `Symbol.dispose` calls `close()` synchronously (fire-and-forget).
 * - `Symbol.asyncDispose` awaits `close()`.
 */
export class DisposableWritableStream extends WritableStream<Uint8Array>
  implements Disposable, AsyncDisposable {
  [Symbol.dispose](): void {
    this.close().catch(() => {});
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// ── Web Standard streams ────────────────────────────────────────

/**
 * Create a Web `ReadableStream<Uint8Array>` that reads a VARBINARY(MAX)
 * column in chunks. Works on all platforms.
 * Requires an active transaction.
 */
export function createBlobReadableStream(
  cn: BlobQueryable,
  tx: TransactionRef,
  target: BlobTarget,
): DisposableReadableStream {
  const table = target.table;
  const column = target.column;
  const where = target.where;
  const params = target.params ?? {};
  const chunkSize = target.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let offset = 1;

  return new DisposableReadableStream({
    async pull(controller) {
      try {
        tx._ensureActive();
        const row = await cn.queryFirst<{ __chunk: string | null }>(
          `SELECT SUBSTRING(${column}, @__offset, @__len) AS __chunk ` +
            `FROM ${table} WHERE ${where}`,
          { ...params, __offset: offset, __len: chunkSize },
          { transaction: tx },
        );
        if (!row?.__chunk) {
          controller.close();
          return;
        }
        const bytes = fromBase64(row.__chunk);
        if (bytes.length === 0) {
          controller.close();
          return;
        }
        controller.enqueue(bytes);
        offset += bytes.length;
        if (bytes.length < chunkSize) {
          controller.close();
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Create a Web `WritableStream<Uint8Array>` that appends to a VARBINARY(MAX)
 * column using `.WRITE`. Works on all platforms.
 * Requires an active transaction.
 *
 * The target column must already have an initial value (even `0x` for empty).
 */
export function createBlobWritableStream(
  cn: BlobQueryable,
  tx: TransactionRef,
  target: BlobTarget,
): DisposableWritableStream {
  const table = target.table;
  const column = target.column;
  const where = target.where;
  const params = target.params ?? {};

  return new DisposableWritableStream({
    async write(chunk) {
      tx._ensureActive();
      const b64 = toBase64(chunk);
      await cn.execute(
        `UPDATE ${table} SET ${column}.WRITE(@__chunk, NULL, NULL) ` +
          `WHERE ${where}`,
        { ...params, __chunk: { value: b64, type: "varbinary" } },
        { transaction: tx },
      );
    },
  });
}

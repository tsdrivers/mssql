/**
 * Async iterable stream of query rows.
 * @module
 */

import type { RuntimeFFI } from "./runtime.ts";

/**
 * An async iterable stream of rows from a query.
 * Rows are fetched one at a time from the Rust cursor.
 *
 * @example
 * ```ts
 * for await (const row of stream) {
 *   console.log(row.Name);
 * }
 *
 * // Or collect
 * const all = await stream.toArray();
 * ```
 */
export class QueryStream<T = Record<string, unknown>> implements AsyncIterable<T>, Disposable, AsyncDisposable {
  #cursorId: bigint;
  #ffi: RuntimeFFI;
  #done = false;
  #closed = false;
  #onCloseCallbacks: (() => void)[] = [];

  /** @internal */
  constructor(cursorId: bigint, ffi: RuntimeFFI) {
    this.#cursorId = cursorId;
    this.#ffi = ffi;
  }

  /** @internal Register a callback invoked once when this stream closes. */
  _onClose(cb: () => void): void {
    if (this.#closed) {
      cb();
      return;
    }
    this.#onCloseCallbacks.push(cb);
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    try {
      while (!this.#done) {
        const row = await this.#fetchNext();
        if (row === null) {
          this.#done = true;
          break;
        }
        yield row;
      }
    } finally {
      this.close();
    }
  }

  /** Collect all remaining rows into an array. */
  async toArray(): Promise<T[]> {
    const results: T[] = [];
    for await (const row of this) results.push(row);
    return results;
  }

  /** Transform each row and collect. */
  async map<U>(fn: (row: T) => U): Promise<U[]> {
    const results: U[] = [];
    for await (const row of this) results.push(fn(row));
    return results;
  }

  /** Filter rows and collect. */
  async filter(fn: (row: T) => boolean): Promise<T[]> {
    const results: T[] = [];
    for await (const row of this) {
      if (fn(row)) results.push(row);
    }
    return results;
  }

  /** Reduce over rows without collecting all in memory. */
  async reduce<U>(fn: (acc: U, row: T) => U, initial: U): Promise<U> {
    let acc = initial;
    for await (const row of this) acc = fn(acc, row);
    return acc;
  }

  /** Pipe to a WritableStream. */
  async pipeTo(writable: WritableStream<T>): Promise<void> {
    const writer = writable.getWriter();
    try {
      for await (const row of this) await writer.write(row);
      await writer.close();
    } catch (err) {
      await writer.abort(err);
      throw err;
    }
  }

  /** Return a standard ReadableStream. */
  toReadableStream(): ReadableStream<T> {
    const self = this;
    return new ReadableStream<T>({
      async pull(controller) {
        const row = await self.#fetchNext();
        if (row === null) {
          self.#done = true;
          controller.close();
          self.close();
        } else {
          controller.enqueue(row);
        }
      },
      cancel() { self.close(); },
    });
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#ffi.streamClose(this.#cursorId);
      const cbs = this.#onCloseCallbacks;
      this.#onCloseCallbacks = [];
      for (const cb of cbs) {
        try { cb(); } catch { /* best-effort */ }
      }
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  async #fetchNext(): Promise<T | null> {
    if (this.#done || this.#closed) return null;
    const json = await this.#ffi.streamNext(this.#cursorId);
    if (json === null) return null;
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "__error" in parsed) {
      throw new Error(`Stream error: ${parsed.__error}`);
    }
    return parsed as T;
  }
}

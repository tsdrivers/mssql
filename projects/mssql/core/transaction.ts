/**
 * Transaction management with async disposable auto-rollback.
 * @module
 */

import type { IsolationLevel } from "./types.ts";
import type { QueryStream } from "./stream.ts";

/**
 * A database transaction. Use with `await using` for auto-rollback.
 *
 * @example
 * ```ts
 * await using tx = await cn.beginTransaction();
 * await cn.execute("INSERT ...", params, { transaction: tx });
 * await tx.commit();
 * // auto-rollback if commit() not called
 * ```
 */
export class Transaction implements Disposable, AsyncDisposable {
  readonly id: string;
  readonly isolation: IsolationLevel;

  #committed = false;
  #rolledBack = false;
  #commitFn: (txId: string) => Promise<void>;
  #rollbackFn: (txId: string) => Promise<void>;
  #streams: Set<QueryStream<unknown>> = new Set();

  /** @internal */
  constructor(
    isolation: IsolationLevel,
    commitFn: (txId: string) => Promise<void>,
    rollbackFn: (txId: string) => Promise<void>,
  ) {
    this.id = crypto.randomUUID();
    this.isolation = isolation;
    this.#commitFn = commitFn;
    this.#rollbackFn = rollbackFn;
  }

  get isActive(): boolean {
    return !this.#committed && !this.#rolledBack;
  }

  /** @internal */
  _ensureActive(): void {
    if (!this.isActive) {
      throw new Error("Transaction is no longer active");
    }
  }

  /** @internal Track a stream opened under this transaction. */
  _trackStream(stream: QueryStream<unknown>): void {
    this.#streams.add(stream);
    stream._onClose(() => {
      this.#streams.delete(stream);
    });
  }

  /** @internal Dispose this transaction (close streams, rollback if active). */
  async _dispose(): Promise<void> {
    return this[Symbol.asyncDispose]();
  }

  /**
   * @internal Force-deactivate without rollback (sync). Used by connection's
   * sync dispose — the server will clean up when the connection is destroyed.
   */
  _forceInactive(): void {
    this.#closeAllStreams();
    if (this.isActive) {
      this.#rolledBack = true;
    }
  }

  #closeAllStreams(): void {
    const streams = [...this.#streams];
    this.#streams.clear();
    for (const s of streams) {
      try { s.close(); } catch { /* best-effort */ }
    }
  }

  async commit(): Promise<void> {
    this._ensureActive();
    await this.#commitFn(this.id);
    this.#committed = true;
  }

  async rollback(): Promise<void> {
    this._ensureActive();
    await this.#rollbackFn(this.id);
    this.#rolledBack = true;
  }

  [Symbol.dispose](): void {
    this._forceInactive();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#closeAllStreams();
    if (this.isActive) {
      try {
        await this.#rollbackFn(this.id);
      } catch {
        // Best-effort rollback on dispose
      }
      this.#rolledBack = true;
    }
  }
}

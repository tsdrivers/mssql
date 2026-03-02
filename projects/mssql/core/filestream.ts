/**
 * FILESTREAM blob access for Windows. Provides both Node.js-compatible
 * streams (`node:stream`) and Web Standard streams.
 * @module
 */

import { Duplex, Readable, Writable } from "node:stream";

import type { RuntimeFFI } from "./runtime.ts";
import { INVALID_HANDLE } from "./runtime.ts";
import type { FilestreamMode } from "./types.ts";

/**
 * Internal handle to a SQL Server FILESTREAM blob. Windows only.
 * Not exported publicly — consumers use `openFilestream()` or `openWebstream()`.
 * @internal
 */
export class FilestreamHandle implements AsyncDisposable {
  #fsId: bigint;
  #ffi: RuntimeFFI;
  #closed = false;
  #mode: FilestreamMode;

  /** @internal */
  constructor(fsId: bigint, ffi: RuntimeFFI, mode: FilestreamMode) {
    this.#fsId = fsId;
    this.#ffi = ffi;
    this.#mode = mode;
  }

  /** @internal */
  get mode(): FilestreamMode {
    return this.#mode;
  }

  /** @internal */
  static _open(
    ffi: RuntimeFFI,
    path: string,
    txContext: Uint8Array | string,
    mode: FilestreamMode,
  ): FilestreamHandle {
    if (!ffi.filestreamAvailable()) {
      throw new Error(
        "FILESTREAM requires Microsoft OLE DB Driver 19 for SQL Server.\n" +
          "\n" +
          "Install via:\n" +
          "  winget install Microsoft.OLEDBDriver\n" +
          "  https://learn.microsoft.com/en-us/sql/connect/oledb/download-oledb-driver-for-sql-server\n" +
          "\n" +
          "This is ONLY needed for FILESTREAM. All other driver features work without it.",
      );
    }

    const ctxBase64 = txContext instanceof Uint8Array
      ? btoa(String.fromCharCode(...txContext))
      : txContext;

    const req = JSON.stringify({ path, tx_context_base64: ctxBase64, mode });
    const fsId = ffi.filestreamOpen(req);

    if (fsId === INVALID_HANDLE) {
      throw new Error("Failed to open FILESTREAM handle");
    }

    return new FilestreamHandle(fsId, ffi, mode);
  }

  /** Check if FILESTREAM is available on this platform. */
  static isAvailable(ffi: RuntimeFFI): boolean {
    return ffi.filestreamAvailable();
  }

  /** Read up to maxBytes. Omit for entire blob. */
  async read(maxBytes?: number): Promise<Uint8Array> {
    this.#ensureOpen();
    const ptr = this.#ffi.filestreamRead(this.#fsId, BigInt(maxBytes ?? 0));
    if (ptr === null) throw new Error("FILESTREAM read failed");
    const result = JSON.parse(ptr);
    if (result.__error) throw new Error(`FILESTREAM read: ${result.__error}`);
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Write data, returning bytes written. */
  async write(data: Uint8Array): Promise<number> {
    this.#ensureOpen();
    const b64 = btoa(String.fromCharCode(...data));
    const written = this.#ffi.filestreamWrite(this.#fsId, b64);
    if (written === 0n && data.length > 0) {
      throw new Error("FILESTREAM write failed");
    }
    return Number(written);
  }

  /** Create a Web ReadableStream from this FILESTREAM handle. */
  toReadableStream(chunkSize = 65536): ReadableStream<Uint8Array> {
    return new ReadableStream({
      pull: async (controller) => {
        try {
          const chunk = await this.read(chunkSize);
          if (chunk.length === 0) {
            controller.close();
            this.close();
          } else {
            controller.enqueue(chunk);
          }
        } catch (err) {
          controller.error(err);
          this.close();
        }
      },
      cancel: () => {
        this.close();
      },
    });
  }

  /** Create a Web WritableStream to this FILESTREAM handle. */
  toWritableStream(): WritableStream<Uint8Array> {
    return new WritableStream({
      write: async (chunk) => {
        await this.write(chunk);
      },
      close: () => {
        this.close();
      },
      abort: () => {
        this.close();
      },
    });
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#ffi.filestreamClose(this.#fsId);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("FILESTREAM handle is closed");
  }
}

// ── Node.js-compatible stream wrappers ─────────────────────────

/**
 * A `node:stream.Readable` backed by a FILESTREAM blob.
 * Compatible with `pipe()`, Node.js stream utilities, and `node:fs` patterns.
 */
export class FilestreamReadable extends Readable {
  #handle: FilestreamHandle;
  #chunkSize: number;

  /** @internal */
  constructor(handle: FilestreamHandle, chunkSize = 65536) {
    super();
    this.#handle = handle;
    this.#chunkSize = chunkSize;
  }

  override _read(_size: number): void {
    this.#handle
      .read(this.#chunkSize)
      .then((chunk) => {
        if (chunk.length === 0) this.push(null);
        else this.push(chunk);
      })
      .catch((err) => this.destroy(err instanceof Error ? err : new Error(String(err))));
  }

  override _destroy(
    err: Error | null,
    cb: (err: Error | null) => void,
  ): void {
    this.#handle.close();
    cb(err);
  }
}

/**
 * A `node:stream.Writable` backed by a FILESTREAM blob.
 * Compatible with `pipe()`, Node.js stream utilities, and `node:fs` patterns.
 */
export class FilestreamWritable extends Writable {
  #handle: FilestreamHandle;

  /** @internal */
  constructor(handle: FilestreamHandle) {
    super();
    this.#handle = handle;
  }

  override _write(
    chunk: Uint8Array,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    const data = chunk;
    this.#handle
      .write(data)
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }

  override _destroy(
    err: Error | null,
    cb: (err: Error | null) => void,
  ): void {
    this.#handle.close();
    cb(err);
  }
}

/**
 * A `node:stream.Duplex` backed by a FILESTREAM blob opened in "readwrite" mode.
 * Implements both `_read()` and `_write()`.
 */
export class FilestreamDuplex extends Duplex {
  #handle: FilestreamHandle;
  #chunkSize: number;

  /** @internal */
  constructor(handle: FilestreamHandle, chunkSize = 65536) {
    super();
    this.#handle = handle;
    this.#chunkSize = chunkSize;
  }

  override _read(_size: number): void {
    this.#handle
      .read(this.#chunkSize)
      .then((chunk) => {
        if (chunk.length === 0) this.push(null);
        else this.push(chunk);
      })
      .catch((err) => this.destroy(err instanceof Error ? err : new Error(String(err))));
  }

  override _write(
    chunk: Uint8Array,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    const data = chunk;
    this.#handle
      .write(data)
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }

  override _destroy(
    err: Error | null,
    cb: (err: Error | null) => void,
  ): void {
    this.#handle.close();
    cb(err);
  }
}

/** Return type for `openWebstream()` in "readwrite" mode. */
export interface FilestreamWebResult {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

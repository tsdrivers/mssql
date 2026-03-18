/**
 * Bun FFI adapter — delegates to the koffi-based Node.js adapter.
 *
 * Bun's native `bun:ffi` does not support nonblocking calls, so we
 * use koffi (a Node-API addon that Bun supports) instead. This gives
 * Bun the same async worker-thread behavior as Node.js — I/O-bound
 * calls run off the main thread via `koffi.async()`.
 *
 * @module
 */

export { createFFI } from "./node.ts";

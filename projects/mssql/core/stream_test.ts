import { assertEquals } from "jsr:@std/assert";
import { QueryStream } from "./stream.ts";
import type { RuntimeFFI } from "./runtime.ts";

// ── Mock FFI ──────────────────────────────────────────────────

function createMockFFI(overrides: Partial<RuntimeFFI> = {}): RuntimeFFI {
  return {
    poolCreate: () => Promise.resolve(1n),
    poolAcquire: () => Promise.resolve(1n),
    poolRelease: () => {},
    poolClose: () => {},
    connect: () => Promise.resolve(1n),
    disconnect: () => {},
    query: () => Promise.resolve("[]"),
    executeNonquery: () => Promise.resolve('{"rowsAffected":0}'),
    exec: () =>
      Promise.resolve(
        '{"rowsAffected":0,"resultSets":[],"outputParams":{}}',
      ),
    queryStream: () => Promise.resolve(1n),
    streamNext: () => Promise.resolve(null),
    streamClose: () => {},
    bulkInsert: () => Promise.resolve('{"rowsAffected":0}'),
    beginTransaction: () => Promise.resolve(null),
    commit: () => Promise.resolve(null),
    rollback: () => Promise.resolve(null),
    cancel: () => {},
    lastError: () => null,
    filestreamAvailable: () => false,
    filestreamOpen: () => 0n,
    filestreamRead: () => null,
    filestreamWrite: () => 0n,
    filestreamClose: () => {},
    diagnosticInfo: () => null,
    setDebug: () => {},
    closeAll: () => {},
    ...overrides,
  };
}

// ── _onClose callback tests ──────────────────────────────────

Deno.test("QueryStream._onClose - callback invoked on close", () => {
  const ffi = createMockFFI();
  const stream = new QueryStream(1n, ffi);
  let called = false;
  stream._onClose(() => {
    called = true;
  });
  stream.close();
  assertEquals(called, true);
});

Deno.test("QueryStream._onClose - multiple callbacks invoked in order", () => {
  const ffi = createMockFFI();
  const stream = new QueryStream(1n, ffi);
  const calls: number[] = [];
  stream._onClose(() => calls.push(1));
  stream._onClose(() => calls.push(2));
  stream.close();
  assertEquals(calls, [1, 2]);
});

Deno.test("QueryStream._onClose - invoked immediately if already closed", () => {
  const ffi = createMockFFI();
  const stream = new QueryStream(1n, ffi);
  stream.close();
  let called = false;
  stream._onClose(() => {
    called = true;
  });
  assertEquals(called, true);
});

Deno.test("QueryStream._onClose - double close does not re-invoke", () => {
  const ffi = createMockFFI();
  const stream = new QueryStream(1n, ffi);
  let count = 0;
  stream._onClose(() => {
    count++;
  });
  stream.close();
  stream.close();
  assertEquals(count, 1);
});

Deno.test("QueryStream - dispose calls close", () => {
  let closeCalled = false;
  const ffi = createMockFFI({
    streamClose: () => {
      closeCalled = true;
    },
  });
  {
    using _stream = new QueryStream(1n, ffi);
  }
  assertEquals(closeCalled, true);
});

Deno.test("QueryStream._onClose - callback error is swallowed", () => {
  const ffi = createMockFFI();
  const stream = new QueryStream(1n, ffi);
  let secondCalled = false;
  stream._onClose(() => {
    throw new Error("boom");
  });
  stream._onClose(() => {
    secondCalled = true;
  });
  stream.close(); // Should not throw
  assertEquals(secondCalled, true);
});

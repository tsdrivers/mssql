import { assertEquals, assertRejects } from "jsr:@std/assert";
import { Transaction } from "./transaction.ts";
import { QueryStream } from "./stream.ts";
import type { RuntimeFFI } from "./runtime.ts";

function makeTransaction(
  isolation: "READ_COMMITTED" | "SERIALIZABLE" = "READ_COMMITTED",
) {
  const calls: string[] = [];
  const tx = new Transaction(
    isolation,
    async (txId: string) => {
      calls.push(`commit:${txId}`);
    },
    async (txId: string) => {
      calls.push(`rollback:${txId}`);
    },
  );
  return { tx, calls };
}

Deno.test("Transaction - has UUID id", () => {
  const { tx } = makeTransaction();
  const pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assertEquals(pattern.test(tx.id), true, `Invalid UUID: ${tx.id}`);
});

Deno.test("Transaction - stores isolation level", () => {
  const { tx } = makeTransaction("SERIALIZABLE");
  assertEquals(tx.isolation, "SERIALIZABLE");
});

Deno.test("Transaction - isActive initially true", () => {
  const { tx } = makeTransaction();
  assertEquals(tx.isActive, true);
});

Deno.test("Transaction - commit calls commitFn", async () => {
  const { tx, calls } = makeTransaction();
  await tx.commit();
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `commit:${tx.id}`);
  assertEquals(tx.isActive, false);
});

Deno.test("Transaction - rollback calls rollbackFn", async () => {
  const { tx, calls } = makeTransaction();
  await tx.rollback();
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `rollback:${tx.id}`);
  assertEquals(tx.isActive, false);
});

Deno.test("Transaction - commit after commit throws", async () => {
  const { tx } = makeTransaction();
  await tx.commit();
  await assertRejects(
    () => tx.commit(),
    Error,
    "Transaction is no longer active",
  );
});

Deno.test("Transaction - rollback after commit throws", async () => {
  const { tx } = makeTransaction();
  await tx.commit();
  await assertRejects(
    () => tx.rollback(),
    Error,
    "Transaction is no longer active",
  );
});

Deno.test("Transaction - commit after rollback throws", async () => {
  const { tx } = makeTransaction();
  await tx.rollback();
  await assertRejects(
    () => tx.commit(),
    Error,
    "Transaction is no longer active",
  );
});

Deno.test("Transaction - _ensureActive throws when inactive", async () => {
  const { tx } = makeTransaction();
  await tx.commit();
  try {
    tx._ensureActive();
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "Transaction is no longer active");
  }
});

Deno.test("Transaction - asyncDispose auto-rollback when uncommitted", async () => {
  const { tx, calls } = makeTransaction();
  await tx[Symbol.asyncDispose]();
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `rollback:${tx.id}`);
  assertEquals(tx.isActive, false);
});

Deno.test("Transaction - asyncDispose no-op after commit", async () => {
  const { tx, calls } = makeTransaction();
  await tx.commit();
  await tx[Symbol.asyncDispose]();
  assertEquals(calls.length, 1); // only the commit, no rollback
});

Deno.test("Transaction - asyncDispose no-op after rollback", async () => {
  const { tx, calls } = makeTransaction();
  await tx.rollback();
  await tx[Symbol.asyncDispose]();
  assertEquals(calls.length, 1); // only the explicit rollback
});

Deno.test("Transaction - asyncDispose swallows rollback errors", async () => {
  const tx = new Transaction(
    "READ_COMMITTED",
    async () => {},
    async () => {
      throw new Error("rollback failed");
    },
  );
  // Should not throw
  await tx[Symbol.asyncDispose]();
  assertEquals(tx.isActive, false);
});

// ── Stream tracking tests ────────────────────────────────────

function createStreamMockFFI(overrides: Partial<RuntimeFFI> = {}): RuntimeFFI {
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

Deno.test("Transaction - asyncDispose closes tracked streams", async () => {
  const { tx, calls } = makeTransaction();
  let streamCloseCount = 0;
  const ffi = createStreamMockFFI({
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const s1 = new QueryStream(1n, ffi);
  const s2 = new QueryStream(2n, ffi);
  tx._trackStream(s1);
  tx._trackStream(s2);
  await tx[Symbol.asyncDispose]();
  assertEquals(streamCloseCount, 2);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `rollback:${tx.id}`);
});

Deno.test("Transaction - asyncDispose skips already-closed streams", async () => {
  const { tx } = makeTransaction();
  let closeCount = 0;
  const ffi = createStreamMockFFI({
    streamClose: () => {
      closeCount++;
    },
  });
  const stream = new QueryStream(1n, ffi);
  tx._trackStream(stream);
  stream.close(); // Close before dispose
  assertEquals(closeCount, 1);
  await tx[Symbol.asyncDispose]();
  assertEquals(closeCount, 1); // Not closed again — removed from set by _onClose
});

Deno.test("Transaction - stream close error during dispose is swallowed", async () => {
  const { tx } = makeTransaction();
  const ffi = createStreamMockFFI({
    streamClose: () => {
      throw new Error("FFI error");
    },
  });
  const stream = new QueryStream(1n, ffi);
  tx._trackStream(stream);
  // Should not throw
  await tx[Symbol.asyncDispose]();
  assertEquals(tx.isActive, false);
});

// ── Sync dispose tests ──────────────────────────────────────

Deno.test("Transaction - dispose marks inactive without rollback", () => {
  const { tx, calls } = makeTransaction();
  tx[Symbol.dispose]();
  assertEquals(tx.isActive, false);
  assertEquals(calls.length, 0); // No rollback call — sync can't await
});

Deno.test("Transaction - dispose no-op after commit", async () => {
  const { tx, calls } = makeTransaction();
  await tx.commit();
  tx[Symbol.dispose]();
  assertEquals(calls.length, 1); // Only the commit
});

Deno.test("Transaction - dispose closes tracked streams", () => {
  const { tx } = makeTransaction();
  let streamCloseCount = 0;
  const ffi = createStreamMockFFI({
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const s1 = new QueryStream(1n, ffi);
  const s2 = new QueryStream(2n, ffi);
  tx._trackStream(s1);
  tx._trackStream(s2);
  tx[Symbol.dispose]();
  assertEquals(streamCloseCount, 2);
  assertEquals(tx.isActive, false);
});

Deno.test("Transaction._forceInactive - closes streams and marks inactive", () => {
  const { tx, calls } = makeTransaction();
  let streamCloseCount = 0;
  const ffi = createStreamMockFFI({
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const stream = new QueryStream(1n, ffi);
  tx._trackStream(stream);
  tx._forceInactive();
  assertEquals(streamCloseCount, 1);
  assertEquals(tx.isActive, false);
  assertEquals(calls.length, 0); // No rollback
});

Deno.test("Transaction._forceInactive - no-op when already committed", async () => {
  const { tx, calls } = makeTransaction();
  await tx.commit();
  tx._forceInactive();
  assertEquals(calls.length, 1); // Only the commit
  assertEquals(tx.isActive, false);
});

Deno.test("Transaction._dispose - delegates to asyncDispose", async () => {
  const { tx, calls } = makeTransaction();
  await tx._dispose();
  assertEquals(calls.length, 1);
  assertEquals(calls[0], `rollback:${tx.id}`);
  assertEquals(tx.isActive, false);
});

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { MssqlPool } from "./pool.ts";
import type { RuntimeFFI } from "./runtime.ts";

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

Deno.test("MssqlPool.connect - acquires and returns connection", async () => {
  let acquired = false;
  const ffi = createMockFFI({
    poolAcquire: () => {
      acquired = true;
      return Promise.resolve(5n);
    },
  });
  const pool = new MssqlPool(1n, ffi);
  const cn = await pool.connect();
  assertEquals(acquired, true);
  await cn.disconnect();
  pool.close();
});

Deno.test("MssqlPool.connect - throws on failed acquire", async () => {
  const ffi = createMockFFI({
    poolAcquire: () => Promise.resolve(0n),
    lastError: () => "Pool exhausted",
  });
  const pool = new MssqlPool(1n, ffi);
  await assertRejects(
    () => pool.connect(),
    Error,
    "Pool exhausted",
  );
  pool.close();
});

Deno.test("MssqlPool.query - auto-acquires and releases", async () => {
  let acquireCount = 0;
  let releaseCount = 0;
  const ffi = createMockFFI({
    poolAcquire: () => {
      acquireCount++;
      return Promise.resolve(BigInt(acquireCount));
    },
    poolRelease: () => {
      releaseCount++;
    },
    query: () => Promise.resolve('[{"x":1}]'),
  });
  const pool = new MssqlPool(1n, ffi);
  const rows = await pool.query("SELECT 1 as x");
  assertEquals(rows.length, 1);
  assertEquals(acquireCount, 1);
  assertEquals(releaseCount, 1);
  pool.close();
});

Deno.test("MssqlPool.execute - auto-acquires and releases", async () => {
  let released = false;
  const ffi = createMockFFI({
    poolAcquire: () => Promise.resolve(1n),
    poolRelease: () => {
      released = true;
    },
    executeNonquery: () => Promise.resolve('{"rowsAffected":3}'),
  });
  const pool = new MssqlPool(1n, ffi);
  const count = await pool.execute("DELETE FROM T");
  assertEquals(count, 3);
  assertEquals(released, true);
  pool.close();
});

Deno.test("MssqlPool.scalar - returns scalar value", async () => {
  const ffi = createMockFFI({
    query: () => Promise.resolve('[{"count":42}]'),
  });
  const pool = new MssqlPool(1n, ffi);
  const val = await pool.scalar<number>("SELECT COUNT(*) as count FROM T");
  assertEquals(val, 42);
  pool.close();
});

Deno.test("MssqlPool - throws after close", async () => {
  const ffi = createMockFFI();
  const pool = new MssqlPool(1n, ffi);
  pool.close();
  await assertRejects(
    () => pool.connect(),
    Error,
    "Pool is closed",
  );
});

Deno.test("MssqlPool - asyncDispose closes pool", async () => {
  let closed = false;
  const ffi = createMockFFI({
    poolClose: () => {
      closed = true;
    },
  });
  {
    await using _pool = new MssqlPool(1n, ffi);
  }
  assertEquals(closed, true);
});

Deno.test("MssqlPool.close - only calls ffi once", () => {
  let closeCount = 0;
  const ffi = createMockFFI({
    poolClose: () => {
      closeCount++;
    },
  });
  const pool = new MssqlPool(1n, ffi);
  pool.close();
  pool.close();
  assertEquals(closeCount, 1);
});

Deno.test("MssqlPool - dispose closes pool", () => {
  let closed = false;
  const ffi = createMockFFI({
    poolClose: () => {
      closed = true;
    },
  });
  {
    using _pool = new MssqlPool(1n, ffi);
  }
  assertEquals(closed, true);
});

Deno.test("MssqlPool.exec - auto-acquires and releases connection", async () => {
  let acquired = false;
  let released = false;
  const ffi = createMockFFI({
    poolAcquire: () => {
      acquired = true;
      return Promise.resolve(2n);
    },
    poolRelease: () => {
      released = true;
    },
    exec: () =>
      Promise.resolve(
        '{"rowsAffected":1,"resultSets":[],"outputParams":{"out":99}}',
      ),
  });
  const pool = new MssqlPool(1n, ffi);
  const result = await pool.exec("sp_Test", {}, {
    commandType: "stored_procedure",
  });
  assertEquals(acquired, true);
  assertEquals(released, true);
  assertEquals(result.rowsAffected, 1);
  assertEquals(result.getOutput<number>("out"), 99);
  pool.close();
});

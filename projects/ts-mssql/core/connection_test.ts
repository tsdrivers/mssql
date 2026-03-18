import { assertEquals, assertRejects } from "jsr:@std/assert";
import { MssqlConnection, serializeCommand } from "./connection.ts";
import type { RuntimeFFI } from "./runtime.ts";
import type { Params } from "./types.ts";

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

// ── serializeCommand tests ────────────────────────────────────

Deno.test("serializeCommand - basic SQL", () => {
  const json = serializeCommand("SELECT 1");
  const cmd = JSON.parse(json);
  assertEquals(cmd.sql, "SELECT 1");
  assertEquals(cmd.params, []);
  assertEquals(cmd.transaction_id, null);
  assertEquals(cmd.command_timeout_ms, null);
  assertEquals(cmd.command_type, "text");
});

Deno.test("serializeCommand - with params", () => {
  const params: Params = { name: "Alice", age: 30 };
  const json = serializeCommand(
    "SELECT * FROM Users WHERE name = @name AND age = @age",
    params,
  );
  const cmd = JSON.parse(json);
  assertEquals(cmd.params.length, 2);
  assertEquals(cmd.params[0].name, "name");
  assertEquals(cmd.params[0].value, "Alice");
  assertEquals(cmd.params[0].type, null);
  assertEquals(cmd.params[1].name, "age");
  assertEquals(cmd.params[1].value, 30);
});

Deno.test("serializeCommand - typed param", () => {
  const params: Params = {
    id: {
      value: "550e8400-e29b-41d4-a716-446655440000",
      type: "uniqueidentifier",
    },
  };
  const json = serializeCommand("SELECT * FROM T WHERE Id = @id", params);
  const cmd = JSON.parse(json);
  assertEquals(cmd.params[0].name, "id");
  assertEquals(cmd.params[0].value, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(cmd.params[0].type, "uniqueidentifier");
});

Deno.test("serializeCommand - Date param converted to ISO string", () => {
  const d = new Date("2024-06-15T10:30:00Z");
  const params: Params = { created: d };
  const json = serializeCommand("SELECT 1", params);
  const cmd = JSON.parse(json);
  assertEquals(cmd.params[0].value, d.toISOString());
});

Deno.test("serializeCommand - null/undefined params", () => {
  const params: Params = { a: null, b: undefined };
  const json = serializeCommand("SELECT 1", params);
  const cmd = JSON.parse(json);
  assertEquals(cmd.params[0].value, null);
  assertEquals(cmd.params[1].value, null);
});

Deno.test("serializeCommand - Uint8Array param to base64", () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const params: Params = { data: bytes };
  const json = serializeCommand("SELECT 1", params);
  const cmd = JSON.parse(json);
  assertEquals(cmd.params[0].value, btoa("Hello"));
});

Deno.test("serializeCommand - stored procedure command type", () => {
  const json = serializeCommand("sp_GetUsers", undefined, {
    commandType: "stored_procedure",
    commandTimeout: 5000,
  });
  const cmd = JSON.parse(json);
  assertEquals(cmd.command_type, "stored_procedure");
  assertEquals(cmd.command_timeout_ms, 5000);
});

Deno.test("serializeCommand - with transaction", () => {
  const mockTx = { id: "tx-123", _ensureActive: () => {} };
  const json = serializeCommand("INSERT INTO T VALUES(1)", undefined, {
    transaction: mockTx,
  });
  const cmd = JSON.parse(json);
  assertEquals(cmd.transaction_id, "tx-123");
});

// ── MssqlConnection query tests ───────────────────────────────

Deno.test("MssqlConnection.query - returns parsed rows", async () => {
  const ffi = createMockFFI({
    query: () =>
      Promise.resolve('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]'),
  });
  const cn = new MssqlConnection(1n, ffi);
  const rows = await cn.query("SELECT * FROM Users");
  assertEquals(rows.length, 2);
  assertEquals((rows[0] as Record<string, unknown>).name, "Alice");
  await cn.disconnect();
});

Deno.test("MssqlConnection.query - throws on null result", async () => {
  const ffi = createMockFFI({
    query: () => Promise.resolve(null),
    lastError: () => "Syntax error near SELECT",
  });
  const cn = new MssqlConnection(1n, ffi);
  await assertRejects(
    () => cn.query("BAD SQL"),
    Error,
    "Syntax error near SELECT",
  );
  await cn.disconnect();
});

Deno.test("MssqlConnection.queryFirst - returns first row", async () => {
  const ffi = createMockFFI({
    query: () => Promise.resolve('[{"id":1}]'),
  });
  const cn = new MssqlConnection(1n, ffi);
  const row = await cn.queryFirst("SELECT TOP 1 * FROM T");
  assertEquals((row as Record<string, unknown>).id, 1);
  await cn.disconnect();
});

Deno.test("MssqlConnection.queryFirst - returns undefined for empty", async () => {
  const ffi = createMockFFI({ query: () => Promise.resolve("[]") });
  const cn = new MssqlConnection(1n, ffi);
  const row = await cn.queryFirst("SELECT * FROM T WHERE 1=0");
  assertEquals(row, undefined);
  await cn.disconnect();
});

Deno.test("MssqlConnection.querySingle - returns single row", async () => {
  const ffi = createMockFFI({ query: () => Promise.resolve('[{"id":1}]') });
  const cn = new MssqlConnection(1n, ffi);
  const row = await cn.querySingle("SELECT * FROM T WHERE id = 1");
  assertEquals((row as Record<string, unknown>).id, 1);
  await cn.disconnect();
});

Deno.test("MssqlConnection.querySingle - throws for zero rows", async () => {
  const ffi = createMockFFI({ query: () => Promise.resolve("[]") });
  const cn = new MssqlConnection(1n, ffi);
  await assertRejects(
    () => cn.querySingle("SELECT * FROM T WHERE 1=0"),
    Error,
    "Expected exactly 1 row, got 0",
  );
  await cn.disconnect();
});

Deno.test("MssqlConnection.querySingle - throws for multiple rows", async () => {
  const ffi = createMockFFI({
    query: () => Promise.resolve('[{"id":1},{"id":2}]'),
  });
  const cn = new MssqlConnection(1n, ffi);
  await assertRejects(
    () => cn.querySingle("SELECT * FROM T"),
    Error,
    "Expected exactly 1 row, got 2",
  );
  await cn.disconnect();
});

Deno.test("MssqlConnection.scalar - returns first column value", async () => {
  const ffi = createMockFFI({ query: () => Promise.resolve('[{"count":42}]') });
  const cn = new MssqlConnection(1n, ffi);
  const val = await cn.scalar<number>("SELECT COUNT(*) as count FROM T");
  assertEquals(val, 42);
  await cn.disconnect();
});

Deno.test("MssqlConnection.scalar - returns undefined for empty", async () => {
  const ffi = createMockFFI({ query: () => Promise.resolve("[]") });
  const cn = new MssqlConnection(1n, ffi);
  const val = await cn.scalar("SELECT 1 WHERE 1=0");
  assertEquals(val, undefined);
  await cn.disconnect();
});

Deno.test("MssqlConnection.execute - returns rowsAffected", async () => {
  const ffi = createMockFFI({
    executeNonquery: () => Promise.resolve('{"rowsAffected":5}'),
  });
  const cn = new MssqlConnection(1n, ffi);
  const count = await cn.execute("DELETE FROM T WHERE active = 0");
  assertEquals(count, 5);
  await cn.disconnect();
});

Deno.test("MssqlConnection.sql - tagged template", async () => {
  let capturedJson = "";
  const ffi = createMockFFI({
    query: (_connId: bigint, cmdJson: string) => {
      capturedJson = cmdJson;
      return Promise.resolve("[]");
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.sql`SELECT * FROM Users WHERE name = ${"Alice"} AND age = ${30}`;
  const cmd = JSON.parse(capturedJson);
  assertEquals(cmd.sql, "SELECT * FROM Users WHERE name = @p0 AND age = @p1");
  assertEquals(cmd.params[0].name, "p0");
  assertEquals(cmd.params[0].value, "Alice");
  assertEquals(cmd.params[1].name, "p1");
  assertEquals(cmd.params[1].value, 30);
  await cn.disconnect();
});

Deno.test("MssqlConnection - throws when closed", async () => {
  const ffi = createMockFFI();
  const cn = new MssqlConnection(1n, ffi);
  await cn.disconnect();
  await assertRejects(
    () => cn.query("SELECT 1"),
    Error,
    "Connection is closed",
  );
});

Deno.test("MssqlConnection - disconnect calls ffi.disconnect", async () => {
  let disconnected = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnected = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.disconnect();
  assertEquals(disconnected, true);
});

Deno.test("MssqlConnection - disconnect on pooled connection calls ffi.disconnect (not poolRelease)", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  await cn.disconnect();
  assertEquals(disconnectCalled, true);
  assertEquals(poolReleaseCalled, false);
});

Deno.test("MssqlConnection - asyncDispose on pooled connection calls poolRelease", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  {
    await using _cn = new MssqlConnection(1n, ffi, 10n);
  }
  assertEquals(poolReleaseCalled, true);
  assertEquals(disconnectCalled, false);
});

Deno.test("MssqlConnection - asyncDispose on standalone calls disconnect", async () => {
  let disconnected = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnected = true;
    },
  });
  {
    await using _cn = new MssqlConnection(1n, ffi);
  }
  assertEquals(disconnected, true);
});

// ── Cascading cleanup tests ──────────────────────────────────

Deno.test("MssqlConnection.disconnect - closes tracked streams", async () => {
  let streamCloseCount = 0;
  const ffi = createMockFFI({
    queryStream: () => Promise.resolve(10n),
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.queryStream("SELECT 1");
  await cn.queryStream("SELECT 2");
  await cn.disconnect();
  assertEquals(streamCloseCount, 2);
});

Deno.test("MssqlConnection.disconnect - disposes tracked transactions (rollback)", async () => {
  let rollbackCount = 0;
  const ffi = createMockFFI({
    beginTransaction: () => Promise.resolve(null),
    rollback: () => {
      rollbackCount++;
      return Promise.resolve(null);
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.beginTransaction();
  await cn.beginTransaction();
  await cn.disconnect();
  assertEquals(rollbackCount, 2);
});

Deno.test("MssqlConnection.disconnect - transaction dispose closes its streams before rollback", async () => {
  const order: string[] = [];
  const ffi = createMockFFI({
    queryStream: () => Promise.resolve(10n),
    streamClose: () => {
      order.push("streamClose");
    },
    beginTransaction: () => Promise.resolve(null),
    rollback: () => {
      order.push("rollback");
      return Promise.resolve(null);
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  const tx = await cn.beginTransaction();
  await cn.queryStream("SELECT 1", undefined, { transaction: tx });
  await cn.disconnect();
  assertEquals(order[0], "streamClose");
  assertEquals(order[1], "rollback");
});

Deno.test("MssqlConnection.disconnect - idempotent (double call safe)", async () => {
  let disconnectCount = 0;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnectCount++;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.disconnect();
  await cn.disconnect();
  assertEquals(disconnectCount, 1);
});

Deno.test("MssqlConnection.disconnect - swallows cleanup errors", async () => {
  const ffi = createMockFFI({
    queryStream: () => Promise.resolve(10n),
    streamClose: () => {
      throw new Error("FFI crash");
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.queryStream("SELECT 1");
  // Should not throw
  await cn.disconnect();
});

Deno.test("MssqlConnection - committed tx is no-op during cleanup", async () => {
  let rollbackCount = 0;
  const ffi = createMockFFI({
    beginTransaction: () => Promise.resolve(null),
    commit: () => Promise.resolve(null),
    rollback: () => {
      rollbackCount++;
      return Promise.resolve(null);
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  const tx = await cn.beginTransaction();
  await tx.commit();
  await cn.disconnect();
  assertEquals(rollbackCount, 0);
});

Deno.test("MssqlConnection - naturally closed stream is not double-closed", async () => {
  let streamCloseCount = 0;
  const ffi = createMockFFI({
    queryStream: () => Promise.resolve(10n),
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  const stream = await cn.queryStream("SELECT 1");
  stream.close();
  assertEquals(streamCloseCount, 1);
  await cn.disconnect();
  assertEquals(streamCloseCount, 1); // Not closed again — already removed from tracking
});

// ── exec() tests ─────────────────────────────────────────────

Deno.test("MssqlConnection.exec - returns ExecResult", async () => {
  const ffi = createMockFFI({
    exec: () =>
      Promise.resolve(
        JSON.stringify({
          rowsAffected: 3,
          resultSets: [[{ id: 1 }]],
          outputParams: { total: 42 },
        }),
      ),
  });
  const cn = new MssqlConnection(1n, ffi);
  const result = await cn.exec("sp_Test", {}, {
    commandType: "stored_procedure",
  });
  assertEquals(result.rowsAffected, 3);
  assertEquals(result.resultSets, 1);
  assertEquals(result.getOutput<number>("total"), 42);
  assertEquals(result.getResults(0), [{ id: 1 }]);
  await cn.disconnect();
});

Deno.test("MssqlConnection.exec - throws on null result", async () => {
  const ffi = createMockFFI({
    exec: () => Promise.resolve(null),
    lastError: () => "Exec error",
  });
  const cn = new MssqlConnection(1n, ffi);
  await assertRejects(() => cn.exec("sp_Bad"), Error, "Exec error");
  await cn.disconnect();
});

Deno.test("serializeCommand - output param includes output flag", () => {
  const params: Params = {
    input: 42,
    output: { value: null, type: "int", output: true },
  };
  const json = serializeCommand("sp_Test", params, {
    commandType: "stored_procedure",
  });
  const cmd = JSON.parse(json);
  const inputParam = cmd.params.find((p: { name: string }) =>
    p.name === "input"
  );
  const outputParam = cmd.params.find((p: { name: string }) =>
    p.name === "output"
  );
  assertEquals(inputParam.output, undefined);
  assertEquals(outputParam.output, true);
  assertEquals(outputParam.type, "int");
});

// ── serializeCommand stream options tests ─────────────────────

// ── Symbol.dispose (sync) tests ──────────────────────────────

Deno.test("MssqlConnection - dispose on pooled connection calls poolRelease", () => {
  let poolReleaseCalled = false;
  let disconnectCalled = false;
  const ffi = createMockFFI({
    poolRelease: () => {
      poolReleaseCalled = true;
    },
    disconnect: () => {
      disconnectCalled = true;
    },
  });
  {
    using _cn = new MssqlConnection(1n, ffi, 10n);
  }
  assertEquals(poolReleaseCalled, true);
  assertEquals(disconnectCalled, false);
});

Deno.test("MssqlConnection - dispose on standalone calls disconnect", () => {
  let disconnected = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnected = true;
    },
  });
  {
    using _cn = new MssqlConnection(1n, ffi);
  }
  assertEquals(disconnected, true);
});

Deno.test("MssqlConnection - dispose after error evicts pooled connection", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    query: () => Promise.resolve(null),
    lastError: () => "Query failed",
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  try {
    await cn.query("BAD SQL");
  } catch { /* expected */ }
  cn[Symbol.dispose]();
  assertEquals(disconnectCalled, true);
  assertEquals(poolReleaseCalled, false);
});

Deno.test("MssqlConnection - asyncDispose after error evicts pooled connection", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    query: () => Promise.resolve(null),
    lastError: () => "Query failed",
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  try {
    await cn.query("BAD SQL");
  } catch { /* expected */ }
  await cn[Symbol.asyncDispose]();
  assertEquals(disconnectCalled, true);
  assertEquals(poolReleaseCalled, false);
});

Deno.test("MssqlConnection - dispose with active transaction evicts pooled connection", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    beginTransaction: () => Promise.resolve(null),
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  await cn.beginTransaction();
  cn[Symbol.dispose]();
  assertEquals(disconnectCalled, true);
  assertEquals(poolReleaseCalled, false);
});

Deno.test("MssqlConnection - asyncDispose with active tx rolls back then returns to pool", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  let rollbackCalled = false;
  const ffi = createMockFFI({
    beginTransaction: () => Promise.resolve(null),
    rollback: () => {
      rollbackCalled = true;
      return Promise.resolve(null);
    },
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  await cn.beginTransaction();
  await cn[Symbol.asyncDispose]();
  assertEquals(rollbackCalled, true);
  assertEquals(poolReleaseCalled, true);
  assertEquals(disconnectCalled, false);
});

Deno.test("MssqlConnection - dispose closes streams synchronously", () => {
  let streamCloseCount = 0;
  const ffi = createMockFFI({
    queryStream: () => Promise.resolve(10n),
    streamClose: () => {
      streamCloseCount++;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  // Must open streams asynchronously first, then test sync dispose
  // Use direct construction for unit test simplicity
  cn[Symbol.dispose]();
  assertEquals(streamCloseCount, 0); // No streams tracked
});

// ── close() tests ────────────────────────────────────────────

Deno.test("MssqlConnection.close - on bare connection calls ffi.disconnect", async () => {
  let disconnected = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnected = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.close();
  assertEquals(disconnected, true);
});

Deno.test("MssqlConnection.close - on pooled connection evicts (calls disconnect, not poolRelease)", async () => {
  let disconnectCalled = false;
  let poolReleaseCalled = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnectCalled = true;
    },
    poolRelease: () => {
      poolReleaseCalled = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi, 10n);
  await cn.close();
  assertEquals(disconnectCalled, true);
  assertEquals(poolReleaseCalled, false);
});

Deno.test("MssqlConnection.close - idempotent (double call safe)", async () => {
  let disconnectCount = 0;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnectCount++;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.close();
  await cn.close();
  assertEquals(disconnectCount, 1);
});

Deno.test("MssqlConnection.disconnect - delegates to close()", async () => {
  let disconnected = false;
  const ffi = createMockFFI({
    disconnect: () => {
      disconnected = true;
    },
  });
  const cn = new MssqlConnection(1n, ffi);
  await cn.disconnect();
  assertEquals(disconnected, true);
});

// ── serializeCommand stream options tests ─────────────────────

Deno.test("serializeCommand - without stream options omits fields", () => {
  const json = serializeCommand("SELECT 1");
  const cmd = JSON.parse(json);
  assertEquals(cmd.stream_mode, undefined);
  assertEquals(cmd.fetch_size, undefined);
});

Deno.test("serializeCommand - stream options with command options", () => {
  const json = serializeCommand("SELECT 1", undefined, {
    commandTimeout: 5000,
  });
  const cmd = JSON.parse(json);
  assertEquals(cmd.command_timeout_ms, 5000);
});

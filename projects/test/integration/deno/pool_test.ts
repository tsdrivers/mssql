/**
 * Pool integration tests including Phase 13 pool enhancements
 * (require running MSSQL).
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

// ── Existing pool tests ──────────────────────────────────────

Deno.test({
  name: "pool - create and query",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Query via pool (auto acquire/release)
    const result = await pool.query<{ val: number }>("SELECT 42 AS val");
    assertEquals(result.length, 1);
    assertEquals(result[0].val, 42);

    // Multiple queries should work (connections acquired/released back to pool)
    const r2 = await pool.scalar<number>(
      "SELECT COUNT(*) AS c FROM sys.objects",
    );
    assertExists(r2);
  },
});

Deno.test({
  name: "pool - explicit connect",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Explicit acquire
    await using cn = await pool.connect();
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    assertEquals(result[0].val, 1);
  },
});

// ── Phase 13 pool enhancement tests ─────────────────────────

Deno.test({
  name: "pool - dedup: same connection string shows 1 pool",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    const pool1 = await mssql.createPool(env.connectionString);
    const pool2 = await mssql.createPool(env.connectionString);

    try {
      const diag = await mssql.diagnosticInfo();
      // Both createPool calls with same connection string should dedup to 1 pool
      assertEquals(diag.pools.length, 1);
    } finally {
      pool1.close();
      pool2.close();
    }
  },
});

Deno.test({
  name: "pool - refcounting: close first holder, second still works",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    const pool1 = await mssql.createPool(env.connectionString);
    const pool2 = await mssql.createPool(env.connectionString);

    // Close first handle — pool should stay alive due to refcount
    pool1.close();

    // Second handle should still work
    const result = await pool2.query<{ val: number }>("SELECT 1 AS val");
    assertEquals(result.length, 1);
    assertEquals(result[0].val, 1);

    pool2.close();
  },
});

Deno.test({
  name: "pool - close() evicts pooled connection",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Acquire a connection from the pool
    const cn = await pool.connect();

    // close() should destroy the connection, not return it to pool
    await cn.close();

    // Pool should still be functional — it will create a new connection
    const result = await pool.query<{ val: number }>("SELECT 1 AS val");
    assertEquals(result.length, 1);
    assertEquals(result[0].val, 1);
  },
});

Deno.test({
  name: "pool - concurrent queries via Promise.all",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Run 5 concurrent queries
    const results = await Promise.all([
      pool.query<{ val: number }>("SELECT 1 AS val"),
      pool.query<{ val: number }>("SELECT 2 AS val"),
      pool.query<{ val: number }>("SELECT 3 AS val"),
      pool.query<{ val: number }>("SELECT 4 AS val"),
      pool.query<{ val: number }>("SELECT 5 AS val"),
    ]);

    // All should return correct values
    for (let i = 0; i < 5; i++) {
      assertEquals(results[i].length, 1);
      assertEquals(results[i][0].val, i + 1);
    }
  },
});

Deno.test({
  name: "pool - sequential queries reuse connections",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Run 5 sequential queries
    for (let i = 0; i < 5; i++) {
      const result = await pool.query<{ val: number }>(
        `SELECT ${i + 1} AS val`,
      );
      assertEquals(result[0].val, i + 1);
    }

    // Verify connection count is bounded (should reuse, not create 5 new)
    const diag = await mssql.diagnosticInfo();
    const poolInfo = diag.pools[0];
    assertExists(poolInfo);
    // After sequential queries, idle connections should be small (typically 1)
    assertEquals(poolInfo.idle <= 2, true);
  },
});

Deno.test({
  name: "pool - closeAll() cleans up everything",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();

    // Create a pool and a bare connection
    const pool = await mssql.createPool(env.connectionString);
    const cn = await mssql.connect(env.connectionString);

    // Verify they exist
    const diagBefore = await mssql.diagnosticInfo();
    assertEquals(diagBefore.pools.length > 0, true);
    assertEquals(diagBefore.connections.length > 0, true);

    // Close everything
    await mssql.closeAll();

    // Verify all cleaned up
    const diagAfter = await mssql.diagnosticInfo();
    assertEquals(diagAfter.pools.length, 0);
    assertEquals(diagAfter.connections.length, 0);

    // Suppress dispose errors since handles are already invalidated
    try {
      pool.close();
    } catch { /* already closed */ }
    try {
      await cn.close();
    } catch { /* already closed */ }
  },
});

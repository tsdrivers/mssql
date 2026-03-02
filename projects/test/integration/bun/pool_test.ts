/**
 * Pool integration tests including Phase 13 pool enhancements
 * (require running MSSQL).
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("pool", () => {
  // ── Existing pool tests ──────────────────────────────────

  test.skipIf(skipMssql)("create and query", async () => {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Query via pool (auto acquire/release)
    const result = await pool.query<{ val: number }>("SELECT 42 AS val");
    expect(result.length).toBe(1);
    expect(result[0].val).toBe(42);

    // Multiple queries should work (connections acquired/released)
    const r2 = await pool.scalar<number>(
      "SELECT COUNT(*) AS c FROM sys.objects",
    );
    expect(r2).toBeDefined();
  });

  test.skipIf(skipMssql)("explicit connect", async () => {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Explicit acquire
    await using cn = await pool.connect();
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    expect(result[0].val).toBe(1);
  });

  // ── Phase 13 pool enhancement tests ─────────────────────

  test.skipIf(skipMssql)("dedup: same connection string shows 1 pool", async () => {
    const env = getTestEnv();
    const pool1 = await mssql.createPool(env.connectionString);
    const pool2 = await mssql.createPool(env.connectionString);

    try {
      const diag = await mssql.diagnosticInfo();
      // Both createPool calls with same connection string should dedup to 1 pool
      expect(diag.pools.length).toBe(1);
    } finally {
      pool1.close();
      pool2.close();
    }
  });

  test.skipIf(skipMssql)("refcounting: close first holder, second still works", async () => {
    const env = getTestEnv();
    const pool1 = await mssql.createPool(env.connectionString);
    const pool2 = await mssql.createPool(env.connectionString);

    // Close first handle — pool should stay alive due to refcount
    pool1.close();

    // Second handle should still work
    const result = await pool2.query<{ val: number }>("SELECT 1 AS val");
    expect(result.length).toBe(1);
    expect(result[0].val).toBe(1);

    pool2.close();
  });

  test.skipIf(skipMssql)("close() evicts pooled connection", async () => {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Acquire a connection from the pool
    const cn = await pool.connect();

    // close() should destroy the connection, not return it to pool
    await cn.close();

    // Pool should still be functional — it will create a new connection
    const result = await pool.query<{ val: number }>("SELECT 1 AS val");
    expect(result.length).toBe(1);
    expect(result[0].val).toBe(1);
  });

  test.skipIf(skipMssql)("concurrent queries via Promise.all", async () => {
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
      expect(results[i].length).toBe(1);
      expect(results[i][0].val).toBe(i + 1);
    }
  });

  test.skipIf(skipMssql)("sequential queries reuse connections", async () => {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Run 5 sequential queries
    for (let i = 0; i < 5; i++) {
      const result = await pool.query<{ val: number }>(
        `SELECT ${i + 1} AS val`,
      );
      expect(result[0].val).toBe(i + 1);
    }

    // Verify connection count is bounded (should reuse, not create 5 new)
    const diag = await mssql.diagnosticInfo();
    const poolInfo = diag.pools[0];
    expect(poolInfo).toBeDefined();
    // After sequential queries, idle connections should be small (typically 1)
    expect(poolInfo.idle <= 2).toBe(true);
  });

  test.skipIf(skipMssql)("closeAll() cleans up everything", async () => {
    const env = getTestEnv();

    // Create a pool and a bare connection
    const pool = await mssql.createPool(env.connectionString);
    const cn = await mssql.connect(env.connectionString);

    // Verify they exist
    const diagBefore = await mssql.diagnosticInfo();
    expect(diagBefore.pools.length > 0).toBe(true);
    expect(diagBefore.connections.length > 0).toBe(true);

    // Close everything
    await mssql.closeAll();

    // Verify all cleaned up
    const diagAfter = await mssql.diagnosticInfo();
    expect(diagAfter.pools.length).toBe(0);
    expect(diagAfter.connections.length).toBe(0);

    // Suppress dispose errors since handles are already invalidated
    try {
      pool.close();
    } catch { /* already closed */ }
    try {
      await cn.close();
    } catch { /* already closed */ }
  });
});

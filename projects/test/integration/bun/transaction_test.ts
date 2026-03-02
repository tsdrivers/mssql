/**
 * Transaction integration tests (require running MSSQL).
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("transactions", () => {
  test.skipIf(skipMssql)("transaction commit", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    // Create temp table
    await cn.execute("CREATE TABLE #txtest (id INT, name NVARCHAR(50))");

    // Insert within transaction and commit
    await using tx = await cn.beginTransaction();
    await cn.execute("INSERT INTO #txtest VALUES (1, 'Alice')", undefined, {
      transaction: tx,
    });
    await tx.commit();

    // Verify the data persisted
    const rows = await cn.query<{ id: number; name: string }>(
      "SELECT * FROM #txtest",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Alice");
  });

  test.skipIf(skipMssql)("transaction rollback", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    // Create temp table
    await cn.execute(
      "CREATE TABLE #txrollback (id INT, name NVARCHAR(50))",
    );
    await cn.execute("INSERT INTO #txrollback VALUES (1, 'Before')");

    // Insert within transaction and rollback
    {
      await using tx = await cn.beginTransaction();
      await cn.execute(
        "INSERT INTO #txrollback VALUES (2, 'During')",
        undefined,
        { transaction: tx },
      );
      await tx.rollback();
    }

    // Verify only original data remains
    const rows = await cn.query<{ id: number }>(
      "SELECT * FROM #txrollback",
    );
    expect(rows.length).toBe(1);
  });
});

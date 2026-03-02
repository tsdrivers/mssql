/**
 * Transaction integration tests (require running MSSQL).
 * @module
 */

import { describe, test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("transactions", () => {
  test("transaction commit", { skip: skipMssql }, async () => {
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
    strictEqual(rows.length, 1);
    strictEqual(rows[0].name, "Alice");
  });

  test("transaction rollback", { skip: skipMssql }, async () => {
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
    strictEqual(rows.length, 1);
  });
});

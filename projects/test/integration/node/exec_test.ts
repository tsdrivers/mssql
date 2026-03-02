/**
 * Stored procedure exec() integration tests (require running MSSQL).
 * @module
 */

import { describe, test } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("stored procedures", () => {
  test("exec with output params and multiple result sets", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    // Create temp stored procedure with input/output params and multiple result sets
    await cn.execute(`
    CREATE PROCEDURE #sp_ExecTest
      @inputId INT,
      @inputName NVARCHAR(100),
      @totalCount INT OUTPUT,
      @greeting NVARCHAR(200) OUTPUT
    AS
    BEGIN
      -- Result set 0: items based on input
      SELECT @inputId AS id, @inputName AS name
      UNION ALL
      SELECT @inputId + 1 AS id, @inputName + (N'_2' COLLATE DATABASE_DEFAULT) AS name;

      -- Result set 1: a summary row
      SELECT 42 AS answer, N'summary' AS label;

      -- Set output params
      SET @totalCount = 2;
      SET @greeting = (N'Hello, ' COLLATE DATABASE_DEFAULT) + @inputName + (N'!' COLLATE DATABASE_DEFAULT);
    END
  `);

    // Call stored procedure with OUTPUT params via exec()
    const result = await cn.exec("#sp_ExecTest", {
      inputId: 10,
      inputName: "Alice",
      totalCount: { value: null, type: "int", output: true },
      greeting: { value: null, type: "nvarchar", output: true },
    }, { commandType: "stored_procedure" });

    // Verify OUTPUT parameters
    strictEqual(result.getOutput<number>("totalCount"), 2);
    strictEqual(result.getOutput<string>("greeting"), "Hello, Alice!");
    // @ prefix should also work
    strictEqual(result.getOutput<number>("@totalCount"), 2);

    // Verify multiple result sets
    strictEqual(result.resultSets, 2);

    // Result set 0: two rows from the UNION ALL
    const items = result.getResults<{ id: number; name: string }>(0);
    strictEqual(items.length, 2);
    strictEqual(items[0].id, 10);
    strictEqual(items[0].name, "Alice");
    strictEqual(items[1].id, 11);
    strictEqual(items[1].name, "Alice_2");

    // Result set 1: summary row
    const summary = result.getResultFirst<{
      answer: number;
      label: string;
    }>(1);
    ok(summary !== undefined);
    strictEqual(summary.answer, 42);
    strictEqual(summary.label, "summary");
  });

  test("exec via pool", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using pool = await mssql.createPool(env.connectionString);

    // Create proc on a direct connection first, then call via pool
    await using cn = await pool.connect();
    await cn.execute(`
    CREATE PROCEDURE #sp_PoolExecTest
      @val INT,
      @doubled INT OUTPUT
    AS
    BEGIN
      SET @doubled = @val * 2;
      SELECT @val AS original;
    END
  `);

    // exec() via connection obtained from pool
    const result = await cn.exec("#sp_PoolExecTest", {
      val: 21,
      doubled: { value: null, type: "int", output: true },
    }, { commandType: "stored_procedure" });

    strictEqual(result.getOutput<number>("doubled"), 42);
    strictEqual(result.resultSets, 1);
    const rows = result.getResults<{ original: number }>(0);
    strictEqual(rows.length, 1);
    strictEqual(rows[0].original, 21);
  });
});

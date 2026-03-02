/**
 * Stored procedure exec() integration tests (require running MSSQL).
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("stored procedures", () => {
  test.skipIf(skipMssql)("exec with output params and multiple result sets", async () => {
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
    expect(result.getOutput<number>("totalCount")).toBe(2);
    expect(result.getOutput<string>("greeting")).toBe("Hello, Alice!");
    // @ prefix should also work
    expect(result.getOutput<number>("@totalCount")).toBe(2);

    // Verify multiple result sets
    expect(result.resultSets).toBe(2);

    // Result set 0: two rows from the UNION ALL
    const items = result.getResults<{ id: number; name: string }>(0);
    expect(items.length).toBe(2);
    expect(items[0].id).toBe(10);
    expect(items[0].name).toBe("Alice");
    expect(items[1].id).toBe(11);
    expect(items[1].name).toBe("Alice_2");

    // Result set 1: summary row
    const summary = result.getResultFirst<{
      answer: number;
      label: string;
    }>(1);
    expect(summary).toBeDefined();
    expect(summary!.answer).toBe(42);
    expect(summary!.label).toBe("summary");
  });

  test.skipIf(skipMssql)("exec via pool", async () => {
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

    expect(result.getOutput<number>("doubled")).toBe(42);
    expect(result.resultSets).toBe(1);
    const rows = result.getResults<{ original: number }>(0);
    expect(rows.length).toBe(1);
    expect(rows[0].original).toBe(21);
  });
});

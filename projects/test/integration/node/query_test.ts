/**
 * Query and connection integration tests (require running MSSQL).
 * @module
 */

import { describe, test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("queries", () => {
  test("connect to MSSQL", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    await cn.execute("SELECT 1");
  });

  test("basic query", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    strictEqual(result.length, 1);
    strictEqual(result[0].val, 1);
  });

  test("parameterized query", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ name: string; age: number }>(
      "SELECT @name AS name, @age AS age",
      { name: "Alice", age: 30 },
    );
    strictEqual(result.length, 1);
    strictEqual(result[0].name, "Alice");
    strictEqual(result[0].age, 30);
  });

  test("tagged template query", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const name = "Bob";
    const age = 25;
    const result = await cn
      .sql<{ name: string; age: number }>`SELECT ${name} AS name, ${age} AS age`;
    strictEqual(result.length, 1);
    strictEqual(result[0].name, "Bob");
    strictEqual(result[0].age, 25);
  });

  test("multiple data types", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const result = await cn.query<{
      int_val: number;
      float_val: number;
      str_val: string;
      bit_val: boolean;
      date_val: string;
    }>(`
    SELECT
      CAST(42 AS INT) AS int_val,
      CAST(3.14 AS FLOAT) AS float_val,
      CAST('hello' AS NVARCHAR(50)) AS str_val,
      CAST(1 AS BIT) AS bit_val,
      CAST('2024-06-15' AS DATE) AS date_val
  `);

    strictEqual(result.length, 1);
    strictEqual(result[0].int_val, 42);
    strictEqual(typeof result[0].float_val, "number");
    strictEqual(result[0].str_val, "hello");
  });

  test("null handling", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const result = await cn.query<{ val: string | null }>(
      "SELECT NULL AS val",
    );
    strictEqual(result.length, 1);
    strictEqual(result[0].val, null);

    // Parameterized null
    const result2 = await cn.query<{ val: string | null }>(
      "SELECT @p AS val",
      { p: null },
    );
    strictEqual(result2.length, 1);
    strictEqual(result2[0].val, null);
  });

  test("queryFirst and querySingle", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const first = await cn.queryFirst<{ val: number }>("SELECT 1 AS val");
    strictEqual(first !== undefined, true);
    strictEqual(first!.val, 1);

    const single = await cn.querySingle<{ val: number }>("SELECT 1 AS val");
    strictEqual(single.val, 1);

    const empty = await cn.queryFirst<{ val: number }>(
      "SELECT 1 AS val WHERE 1=0",
    );
    strictEqual(empty, undefined);
  });

  test("execute returns row count", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute("CREATE TABLE #exectest (id INT)");
    await cn.execute("INSERT INTO #exectest VALUES (1), (2), (3)");
    const deleted = await cn.execute("DELETE FROM #exectest WHERE id > 1");
    strictEqual(deleted, 2);
  });

  test("streaming query", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const stream = await cn.queryStream<{ n: number }>(
      "SELECT n FROM (VALUES (1),(2),(3),(4),(5)) AS t(n)",
    );

    const collected: number[] = [];
    for await (const row of stream) {
      collected.push(row.n);
    }
    deepStrictEqual(collected, [1, 2, 3, 4, 5]);
  });

  test("bulk insert", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    // Create test table
    await cn.execute(`
    CREATE TABLE #bulktest (
      id INT NOT NULL,
      name NVARCHAR(100),
      value FLOAT
    )
  `);

    // Bulk insert
    const result = await cn.bulk("#bulktest")
      .columns([
        { name: "id", type: "int" },
        { name: "name", type: "nvarchar" },
        { name: "value", type: "float" },
      ])
      .rows([
        [1, "Alice", 1.5],
        [2, "Bob", 2.5],
        [3, "Charlie", 3.5],
      ])
      .execute();
    strictEqual(result, 3);

    // Verify
    const rows = await cn.query<{ id: number; name: string }>(
      "SELECT * FROM #bulktest ORDER BY id",
    );
    strictEqual(rows.length, 3);
    strictEqual(rows[0].name, "Alice");
    strictEqual(rows[2].name, "Charlie");
  });
});

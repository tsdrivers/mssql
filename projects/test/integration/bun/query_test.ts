/**
 * Query and connection integration tests (require running MSSQL).
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("queries", () => {
  test.skipIf(skipMssql)("connect to MSSQL", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    await cn.execute("SELECT 1");
  });

  test.skipIf(skipMssql)("basic query", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    expect(result.length).toBe(1);
    expect(result[0].val).toBe(1);
  });

  test.skipIf(skipMssql)("parameterized query", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ name: string; age: number }>(
      "SELECT @name AS name, @age AS age",
      { name: "Alice", age: 30 },
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Alice");
    expect(result[0].age).toBe(30);
  });

  test.skipIf(skipMssql)("tagged template query", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const name = "Bob";
    const age = 25;
    const result = await cn
      .sql<{ name: string; age: number }>`SELECT ${name} AS name, ${age} AS age`;
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Bob");
    expect(result[0].age).toBe(25);
  });

  test.skipIf(skipMssql)("multiple data types", async () => {
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

    expect(result.length).toBe(1);
    expect(result[0].int_val).toBe(42);
    expect(typeof result[0].float_val).toBe("number");
    expect(result[0].str_val).toBe("hello");
  });

  test.skipIf(skipMssql)("null handling", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const result = await cn.query<{ val: string | null }>(
      "SELECT NULL AS val",
    );
    expect(result.length).toBe(1);
    expect(result[0].val).toBeNull();

    // Parameterized null
    const result2 = await cn.query<{ val: string | null }>(
      "SELECT @p AS val",
      { p: null },
    );
    expect(result2.length).toBe(1);
    expect(result2[0].val).toBeNull();
  });

  test.skipIf(skipMssql)("queryFirst and querySingle", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const first = await cn.queryFirst<{ val: number }>("SELECT 1 AS val");
    expect(first).toBeDefined();
    expect(first!.val).toBe(1);

    const single = await cn.querySingle<{ val: number }>("SELECT 1 AS val");
    expect(single.val).toBe(1);

    const empty = await cn.queryFirst<{ val: number }>(
      "SELECT 1 AS val WHERE 1=0",
    );
    expect(empty).toBeUndefined();
  });

  test.skipIf(skipMssql)("execute returns row count", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute("CREATE TABLE #exectest (id INT)");
    await cn.execute("INSERT INTO #exectest VALUES (1), (2), (3)");
    const deleted = await cn.execute("DELETE FROM #exectest WHERE id > 1");
    expect(deleted).toBe(2);
  });

  test.skipIf(skipMssql)("streaming query", async () => {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const stream = await cn.queryStream<{ n: number }>(
      "SELECT n FROM (VALUES (1),(2),(3),(4),(5)) AS t(n)",
    );

    const collected: number[] = [];
    for await (const row of stream) {
      collected.push(row.n);
    }
    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  test.skipIf(skipMssql)("bulk insert", async () => {
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
    expect(result).toBe(3);

    // Verify
    const rows = await cn.query<{ id: number; name: string }>(
      "SELECT * FROM #bulktest ORDER BY id",
    );
    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Alice");
    expect(rows[2].name).toBe("Charlie");
  });
});

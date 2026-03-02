/**
 * Query and connection integration tests (require running MSSQL).
 * @module
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { getTestEnv, skipMssql } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

Deno.test({
  name: "integration - connect to MSSQL",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    await cn.execute("SELECT 1");
  },
});

Deno.test({
  name: "integration - basic query",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    assertEquals(result.length, 1);
    assertEquals(result[0].val, 1);
  },
});

Deno.test({
  name: "integration - parameterized query",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const result = await cn.query<{ name: string; age: number }>(
      "SELECT @name AS name, @age AS age",
      { name: "Alice", age: 30 },
    );
    assertEquals(result.length, 1);
    assertEquals(result[0].name, "Alice");
    assertEquals(result[0].age, 30);
  },
});

Deno.test({
  name: "integration - tagged template query",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);
    const name = "Bob";
    const age = 25;
    const result = await cn
      .sql<
      { name: string; age: number }
    >`SELECT ${name} AS name, ${age} AS age`;
    assertEquals(result.length, 1);
    assertEquals(result[0].name, "Bob");
    assertEquals(result[0].age, 25);
  },
});

Deno.test({
  name: "integration - multiple data types",
  ignore: skipMssql,
  async fn() {
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

    assertEquals(result.length, 1);
    assertEquals(result[0].int_val, 42);
    assertEquals(typeof result[0].float_val, "number");
    assertEquals(result[0].str_val, "hello");
  },
});

Deno.test({
  name: "integration - null handling",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const result = await cn.query<{ val: string | null }>(
      "SELECT NULL AS val",
    );
    assertEquals(result.length, 1);
    assertEquals(result[0].val, null);

    // Parameterized null
    const result2 = await cn.query<{ val: string | null }>(
      "SELECT @p AS val",
      { p: null },
    );
    assertEquals(result2.length, 1);
    assertEquals(result2[0].val, null);
  },
});

Deno.test({
  name: "integration - queryFirst and querySingle",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const first = await cn.queryFirst<{ val: number }>("SELECT 1 AS val");
    assertExists(first);
    assertEquals(first.val, 1);

    const single = await cn.querySingle<{ val: number }>("SELECT 1 AS val");
    assertEquals(single.val, 1);

    const empty = await cn.queryFirst<{ val: number }>(
      "SELECT 1 AS val WHERE 1=0",
    );
    assertEquals(empty, undefined);
  },
});

Deno.test({
  name: "integration - execute returns row count",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    await cn.execute("CREATE TABLE #exectest (id INT)");
    await cn.execute("INSERT INTO #exectest VALUES (1), (2), (3)");
    const deleted = await cn.execute("DELETE FROM #exectest WHERE id > 1");
    assertEquals(deleted, 2);
  },
});

Deno.test({
  name: "integration - streaming query",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    await using cn = await mssql.connect(env.connectionString);

    const stream = await cn.queryStream<{ n: number }>(
      "SELECT n FROM (VALUES (1),(2),(3),(4),(5)) AS t(n)",
    );

    const collected: number[] = [];
    for await (const row of stream) {
      collected.push(row.n);
    }
    assertEquals(collected, [1, 2, 3, 4, 5]);
  },
});

Deno.test({
  name: "integration - bulk insert",
  ignore: skipMssql,
  async fn() {
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
    assertEquals(result, 3);

    // Verify
    const rows = await cn.query<{ id: number; name: string }>(
      "SELECT * FROM #bulktest ORDER BY id",
    );
    assertEquals(rows.length, 3);
    assertEquals(rows[0].name, "Alice");
    assertEquals(rows[2].name, "Charlie");
  },
});

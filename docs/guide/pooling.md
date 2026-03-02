# Connection Pooling

## Creating a Pool

```ts
await using pool = await mssql.createPool("Server=localhost;Database=mydb;...");
```

Pool configuration is included in the connection string or config object:

```ts
await using pool = await mssql.createPool({
  server: "localhost",
  database: "mydb",
  authentication: { type: "sql", userName: "sa", password: "pass" },
  pool: {
    min: 2,
    max: 10,
  },
});
```

## Auto Acquire/Release

The pool's convenience methods automatically acquire and release connections:

```ts
// Each call gets its own connection from the pool
const users = await pool.query("SELECT * FROM Users");
const count = await pool.scalar<number>("SELECT COUNT(*) AS c FROM Orders");
const affected = await pool.execute("DELETE FROM Logs WHERE old = 1");
```

## Manual Connection Management

For multiple operations on the same connection:

```ts
await using cn = await pool.connect();
await cn.execute("CREATE TABLE #tmp (id INT)");
await cn.execute("INSERT INTO #tmp VALUES (1), (2)");
const rows = await cn.query("SELECT * FROM #tmp");
// Connection released at end of scope
```

## Tagged Templates

```ts
const name = "Alice";
const rows = await pool.sql<{ id: number }>`SELECT id FROM Users WHERE name = ${name}`;
```

## Pool Streaming

```ts
const stream = await pool.queryStream<{ id: number }>("SELECT id FROM BigTable");
for await (const row of stream) {
  // Connection held during iteration
}
// Connection released when stream ends
```

## Closing

```ts
pool.close(); // Or let `await using` handle it
```

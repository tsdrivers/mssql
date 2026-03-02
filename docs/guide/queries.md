# Queries

## Basic Query

```ts
const rows = await cn.query<{ id: number; name: string }>("SELECT id, name FROM Users");
// rows: Array<{ id: number; name: string }>
```

## Parameterized Queries

Always use parameters for user input to prevent SQL injection:

```ts
const rows = await cn.query<{ name: string }>(
  "SELECT name FROM Users WHERE age > @minAge AND city = @city",
  { minAge: 18, city: "Portland" }
);
```

## Tagged Template Literals

The `sql` method provides a convenient tagged template syntax:

```ts
const name = "Alice";
const age = 30;
const rows = await cn.sql<{ id: number }>`
  SELECT id FROM Users WHERE name = ${name} AND age = ${age}
`;
// Generates: SELECT id FROM Users WHERE name = @p0 AND age = @p1
```

## Query Variants

### queryFirst

Returns the first row or `undefined`:

```ts
const user = await cn.queryFirst<{ name: string }>("SELECT TOP 1 name FROM Users");
if (user) {
  console.log(user.name);
}
```

### querySingle

Returns exactly one row. Throws if zero or multiple rows:

```ts
const user = await cn.querySingle<{ name: string }>(
  "SELECT name FROM Users WHERE id = @id",
  { id: 1 }
);
```

### scalar

Returns the first column of the first row:

```ts
const count = await cn.scalar<number>("SELECT COUNT(*) AS c FROM Users");
```

### execute

Returns the number of rows affected:

```ts
const deleted = await cn.execute("DELETE FROM Logs WHERE created < @cutoff", {
  cutoff: new Date("2024-01-01"),
});
console.log(`Deleted ${deleted} rows`);
```

## Typed Parameters

For explicit SQL type control:

```ts
const rows = await cn.query("SELECT * FROM T WHERE Id = @id", {
  id: { value: "550e8400-e29b-41d4-a716-446655440000", type: "uniqueidentifier" },
});
```

## Command Options

```ts
const rows = await cn.query("sp_GetUsers", undefined, {
  commandType: "stored_procedure",
  commandTimeout: 30000, // ms
});
```

## Stored Procedures

### Simple Execution

Use `commandType: "stored_procedure"` to call stored procedures:

```ts
const rows = await cn.query("sp_GetUsers", { status: "active" }, {
  commandType: "stored_procedure",
});
```

### exec() — OUTPUT Parameters & Multiple Result Sets

The `exec()` method returns an `ExecResult` with support for OUTPUT parameters
and multiple result sets:

```ts
const result = await cn.exec("sp_ProcessOrder", {
  orderId: 42,
  total: { value: null, type: "decimal", output: true },
  status: { value: null, type: "nvarchar", output: true },
}, { commandType: "stored_procedure" });

result.rowsAffected;                    // number
result.resultSets;                      // number (count of result sets)
result.getOutput<number>("total");      // OUTPUT param value
result.getOutput<string>("status");     // @ prefix is optional
result.getResults<OrderItem>(0);        // T[] — rows from result set 0
result.getResultFirst<OrderSummary>(1); // T | undefined — first row of set 1
```

OUTPUT parameters require a `type` and `output: true` in the typed parameter:

```ts
// OUTPUT param with an initial input value
{ value: 0, type: "int", output: true }

// OUTPUT param with no initial value
{ value: null, type: "int", output: true }
```

The `exec()` method is available on both connections and pools:

```ts
// Via pool (auto-acquires and releases connection)
const result = await pool.exec("sp_MyProc", params, {
  commandType: "stored_procedure",
});
```

## Binary Data

Pass `Uint8Array` values — they are automatically base64-encoded for the FFI boundary:

```ts
const data = new Uint8Array([1, 2, 3, 4]);
await cn.execute("INSERT INTO Files (data) VALUES (@data)", { data });
```

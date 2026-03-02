# Transactions

## Basic Usage

```ts
await using cn = await mssql.connect("Server=localhost;...");

await using tx = await cn.beginTransaction();
await cn.execute("INSERT INTO Users (name) VALUES (@name)", { name: "Alice" }, { transaction: tx });
await cn.execute("INSERT INTO Logs (msg) VALUES ('User created')", undefined, { transaction: tx });
await tx.commit();
```

## Auto-Rollback

If a transaction is not committed before it goes out of scope, it is automatically rolled back via `AsyncDisposable`:

```ts
{
  await using tx = await cn.beginTransaction();
  await cn.execute("INSERT INTO Users (name) VALUES ('Bob')", undefined, { transaction: tx });
  // No commit — transaction is rolled back at end of scope
}
```

## Explicit Rollback

```ts
const tx = await cn.beginTransaction();
try {
  await cn.execute("DELETE FROM Users", undefined, { transaction: tx });
  // Oops, don't want to do that
  await tx.rollback();
} catch (err) {
  await tx.rollback();
  throw err;
}
```

## Isolation Levels

```ts
const tx = await cn.beginTransaction("serializable");
```

Supported isolation levels:
- `read_uncommitted`
- `read_committed` (default)
- `repeatable_read`
- `serializable`
- `snapshot`

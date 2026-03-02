# Bulk Insert

SQL Server's native TDS BulkLoad protocol for high-performance inserts.

## Basic Usage

```ts
const count = await cn.bulk("Users")
  .columns([
    { name: "Id", type: "uniqueidentifier" },
    { name: "Name", type: "nvarchar" },
    { name: "Age", type: "int", nullable: true },
  ])
  .rows([
    [mssql.newCOMB(), "Alice", 30],
    [mssql.newCOMB(), "Bob", 25],
    [mssql.newCOMB(), "Charlie", null],
  ])
  .execute();

console.log(`Inserted ${count} rows`);
```

## From Objects

```ts
const count = await cn.bulk("Users")
  .columns([
    { name: "Name", type: "nvarchar" },
    { name: "Age", type: "int" },
  ])
  .fromObjects([
    { Name: "Alice", Age: 30 },
    { Name: "Bob", Age: 25 },
  ])
  .execute();
```

## Batched Insert

For very large inserts, use batching to control memory usage:

```ts
const count = await cn.bulk("LargeTable")
  .columns([...])
  .rows(millionsOfRows)
  .batchSize(10000)
  .execute();
```

## With Pool

```ts
const count = await pool.bulk("Users")
  .columns([...])
  .rows([...])
  .execute();
// Connection is automatically acquired and released
```

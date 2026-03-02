# Streaming Queries

For large result sets, use streaming to process rows one at a time without loading everything into memory.

## Basic Streaming

```ts
const stream = await cn.queryStream<{ id: number; name: string }>(
  "SELECT id, name FROM LargeTable"
);

for await (const row of stream) {
  console.log(row.id, row.name);
}
```

## Pool Streaming

When using a pool, the connection is automatically acquired and released:

```ts
const stream = await pool.queryStream<{ id: number }>(
  "SELECT id FROM LargeTable WHERE status = @status",
  { status: "active" }
);

for await (const row of stream) {
  process(row);
}
// Connection released when stream closes
```

## Early Exit

You can break out of the stream early:

```ts
const stream = await cn.queryStream<{ id: number }>("SELECT id FROM BigTable");

for await (const row of stream) {
  if (row.id > 100) break;
}
// Stream is automatically closed
```

## Stream Utility Methods

`QueryStream` provides several convenience methods:

```ts
// Collect all rows
const rows = await stream.toArray();

// Transform rows
const names = await stream.map(row => row.name);

// Filter rows
const active = await stream.filter(row => row.active);

// Reduce without collecting
const total = await stream.reduce((sum, row) => sum + row.amount, 0);

// Convert to standard ReadableStream
const readable = stream.toReadableStream();

// Pipe to WritableStream
await stream.pipeTo(writableStream);
```

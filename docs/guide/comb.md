# COMB UUIDs

COMB (Combined UUID-Timestamp) is a UUID v4 variant where the last 6 bytes encode a millisecond timestamp. This produces UUIDs that are mostly sequential when used as clustered primary keys in SQL Server, dramatically reducing index fragmentation.

## Usage

```ts
import { newCOMB } from "@tracker1/mssql";

const id = newCOMB();
// e.g. "a3f1b2c4-d5e6-4f7a-8b9c-019437a2b1c0"
```

## Why COMB?

SQL Server's `NEWID()` generates fully random GUIDs that cause heavy page splits on clustered indexes. `NEWSEQUENTIALID()` is sequential but only works as a column default — you can't generate them client-side.

COMB gives you:
- **Client-side generation** — no database round-trip needed
- **Sequential ordering** — last 48 bits encode current time, so inserts are mostly append-only
- **Uniqueness** — first 80 bits are random (same as UUID v4)
- **Standard format** — valid UUID v4, works with `uniqueidentifier` columns

## With Bulk Insert

```ts
const rows = users.map(u => [newCOMB(), u.name, u.email]);

await cn.bulk("Users")
  .columns([
    { name: "Id", type: "uniqueidentifier" },
    { name: "Name", type: "nvarchar" },
    { name: "Email", type: "nvarchar" },
  ])
  .rows(rows)
  .execute();
```

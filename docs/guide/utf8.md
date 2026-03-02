# UTF-8 Collation

SQL Server 2019+ supports UTF-8 collations for `VARCHAR` columns, reducing storage for predominantly ASCII data while supporting full Unicode.

## Helpers

### utf8Column

Generate a column definition with UTF-8 collation:

```ts
import { utf8Column } from "@tracker1/mssql";

const col = utf8Column("Name", "varchar(100)");
// "Name varchar(100) COLLATE Latin1_General_100_CI_AS_SC_UTF8"
```

### supportsUtf8

Generate a check query:

```ts
import { supportsUtf8 } from "@tracker1/mssql";

const sql = supportsUtf8();
// "SELECT CASE WHEN SERVERPROPERTY('ProductMajorVersion') >= 15 THEN 1 ELSE 0 END AS supported"
```

### setDatabaseUtf8

Generate ALTER DATABASE statement:

```ts
import { setDatabaseUtf8 } from "@tracker1/mssql";

const sql = setDatabaseUtf8("MyDatabase");
// "ALTER DATABASE [MyDatabase] COLLATE Latin1_General_100_CI_AS_SC_UTF8"
```

### Available Collations

```ts
import { UTF8_COLLATIONS } from "@tracker1/mssql";

UTF8_COLLATIONS.CI_AS;    // "Latin1_General_100_CI_AS_SC_UTF8"
UTF8_COLLATIONS.CS_AS;    // "Latin1_General_100_CS_AS_SC_UTF8"
UTF8_COLLATIONS.CI_AI;    // "Latin1_General_100_CI_AI_SC_UTF8"
UTF8_COLLATIONS.CS_AI;    // "Latin1_General_100_CS_AI_SC_UTF8"
```

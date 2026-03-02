# Connections

## Connection Strings

Three formats are supported:

### ADO.NET Style

```ts
const cn = await mssql.connect(
  "Server=myserver;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;"
);
```

Common keys (case-insensitive, aliases supported):

| Key | Aliases | Description |
|-----|---------|-------------|
| `Server` | `Data Source`, `Address` | Server hostname (see [Named Instances](#named-instances)) |
| `Database` | `Initial Catalog` | Database name |
| `User Id` | `UID` | SQL auth username |
| `Password` | `PWD` | SQL auth password |
| `Integrated Security` | | `true` or `SSPI` for Windows auth |
| `TrustServerCertificate` | | Skip TLS validation |
| `Encrypt` | | `true`/`false`/`strict` |
| `Connect Timeout` | `Connection Timeout` | Timeout in seconds |

The `Server` value supports several formats:

| Format | Example | Description |
|--------|---------|-------------|
| `host` | `myserver` | Connects on the default port (1433) |
| `host,port` | `myserver,1434` | Explicit port (comma-separated, per ADO.NET convention) |
| `host\instance` | `myserver\SQLEXPRESS` | Named instance (see [Named Instances](#named-instances)) |

### URL Style

```ts
const cn = await mssql.connect("mssql://sa:pass@myserver:1433/mydb?trustServerCertificate=true");
```

Both `mssql://` and `sqlserver://` schemes are supported.

### Config Object

```ts
const cn = await mssql.connect({
  server: "myserver",
  database: "mydb",
  authentication: {
    type: "sql",
    userName: "sa",
    password: "pass",
  },
  options: {
    trustServerCertificate: true,
    encrypt: true,
  },
});
```

## Azure AD Authentication

Azure SQL supports Azure Active Directory (Entra ID) authentication. The driver
supports several Azure AD auth flows — all resolve to an access token on the
TypeScript side before crossing the FFI boundary.

### Pre-acquired Access Token

If you already have an access token (from `@azure/identity`, a managed identity
endpoint, or another source):

```ts
const pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: {
    type: "azure-active-directory-access-token",
    options: { token: accessToken },
  },
});
```

Or via ADO.NET connection string:

```
Authentication=ActiveDirectoryAccessToken;Access Token=eyJ...;Server=myserver.database.windows.net;Database=mydb;
```

Or via URL:

```
mssql://myserver.database.windows.net/mydb?authentication=azure-active-directory-access-token&token=eyJ...
```

### Token Provider Callback

For automatic token refresh, provide a `tokenProvider` callback. The library
calls this function each time it creates a pool or connection, keeping the
library dependency-free — you bring your own token acquisition logic.

**DefaultAzureCredential** (recommended for most scenarios):

```ts
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();

const pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: { type: "azure-active-directory-default" },
  tokenProvider: async () => {
    const token = await credential.getToken("https://database.windows.net/.default");
    return token.token;
  },
});
```

**Service Principal** (for server-to-server auth):

```ts
import { ClientSecretCredential } from "@azure/identity";

const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

const pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: {
    type: "azure-active-directory-service-principal-secret",
    options: { clientId, clientSecret, tenantId },
  },
  tokenProvider: async () => {
    const token = await credential.getToken("https://database.windows.net/.default");
    return token.token;
  },
});
```

> **Note:** The `authentication.options` fields (`clientId`, `clientSecret`,
> `tenantId`) on the service principal type are informational — the actual
> token acquisition is handled by your `tokenProvider` callback.

## Named Instances

SQL Server supports running multiple instances on a single host, identified by
an instance name (e.g. `SQLEXPRESS`). All three connection formats can target a
named instance.

### ADO.NET — backslash in `Server`

Use the `host\instance` format in the `Server` key:

```ts
const cn = await mssql.connect(
  "Server=myserver\\SQLEXPRESS;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;"
);
```

> **Note:** In a JavaScript/TypeScript string literal the backslash must be
> doubled (`\\`). In an `.env` file or shell variable, a single `\` is fine.

### URL — `instanceName` query parameter

```ts
const cn = await mssql.connect(
  "mssql://sa:pass@myserver/mydb?instanceName=SQLEXPRESS&trustServerCertificate=true"
);
```

### Config Object — `options.instanceName`

```ts
const cn = await mssql.connect({
  server: "myserver",
  database: "mydb",
  authentication: {
    type: "sql",
    userName: "sa",
    password: "pass",
  },
  options: {
    instanceName: "SQLEXPRESS",
    trustServerCertificate: true,
  },
});
```

## Single Connection

```ts
await using cn = await mssql.connect("Server=localhost;...");
const rows = await cn.query("SELECT 1 AS val");
// Connection automatically disconnected at end of scope
```

Or explicitly disconnect:

```ts
const cn = await mssql.connect("Server=localhost;...");
try {
  const rows = await cn.query("SELECT 1 AS val");
} finally {
  cn.disconnect();
}
```

## Connection Pool

For applications that make multiple queries, use a pool:

```ts
await using pool = await mssql.createPool("Server=localhost;...");

// Queries auto-acquire and release connections
const users = await pool.query("SELECT * FROM Users");

// Or manually acquire
await using cn = await pool.connect();
await cn.query("SELECT 1");
```

See [Connection Pooling](./pooling) for more details.

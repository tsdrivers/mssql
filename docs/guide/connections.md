# Connections

## Connection Strings

Three formats are supported:

### ADO.NET Style

```ts
await using cn = await mssql.connect(
  "Server=myserver;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;",
);
```

Common keys (case-insensitive, aliases supported):

| Key                      | Aliases                  | Description                                               |
| ------------------------ | ------------------------ | --------------------------------------------------------- |
| `Server`                 | `Data Source`, `Address` | Server hostname (see [Named Instances](#named-instances)) |
| `Database`               | `Initial Catalog`        | Database name                                             |
| `User Id`                | `UID`                    | SQL auth username                                         |
| `Password`               | `PWD`                    | SQL auth password                                         |
| `Integrated Security`    |                          | `true` or `SSPI` for Windows auth                         |
| `TrustServerCertificate` |                          | Skip TLS validation                                       |
| `Encrypt`                |                          | `true`/`false`/`strict`                                   |
| `Connect Timeout`        | `Connection Timeout`     | Timeout in seconds                                        |

The `Server` value supports several formats:

| Format          | Example               | Description                                              |
| --------------- | --------------------- | -------------------------------------------------------- |
| `host`          | `myserver`            | Connects on the default port (1433)                      |
| `host,port`     | `myserver,1434`       | Explicit port (comma-separated, per ADO.NET convention)  |
| `host\instance` | `myserver\SQLEXPRESS` | Named instance (see [Named Instances](#named-instances)) |

### URL Style

```ts
await using cn = await mssql.connect(
  "mssql://sa:pass@myserver:1433/mydb?trustServerCertificate=true",
);
```

Both `mssql://` and `sqlserver://` schemes are supported.

### Config Object

```ts
await using cn = await mssql.connect({
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

## Authentication

The driver supports several authentication methods. The right choice depends on
your environment and security requirements.

### SQL Server Authentication

Username and password authentication against SQL Server's built-in auth system.
Works on all platforms.

```ts
// ADO.NET
"Server=myserver;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;"

// URL
"mssql://sa:pass@myserver/mydb?trustServerCertificate=true"

// Config object
{
  server: "myserver",
  authentication: { type: "sql", userName: "sa", password: "pass" },
}
```

### Windows Authentication (Integrated Security)

Uses the current process identity to authenticate — no username or password
needed. This is the most common method in enterprise Windows environments.

```ts
// ADO.NET
"Server=myserver;Database=mydb;Integrated Security=true;TrustServerCertificate=true;"

// URL
"mssql://myserver/mydb?integratedSecurity=true&trustServerCertificate=true"

// Config object
{
  server: "myserver",
  authentication: { type: "windows" },
}
```

::: tip Platform Behavior

| Platform          | How It Works                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows**       | Uses SSPI (Security Support Provider Interface) automatically. The current Windows user's credentials are sent to SQL Server via Kerberos or NTLM. No additional configuration needed. |
| **Linux / macOS** | Uses Kerberos. You must have a valid Kerberos ticket before connecting. Obtain one with `kinit user@REALM` (requires `krb5-user` on Debian/Ubuntu or `krb5-workstation` on RHEL).      |
| :::               |                                                                                                                                                                                        |

### NTLM Authentication (Explicit Domain Credentials)

Authenticate with a specific Active Directory domain account by providing
domain, username, and password. Works on **all platforms** — the ODBC driver
handles NTLM negotiation natively.

This is useful when:

- You need to connect as a different user than the current process
- You're on Linux/macOS and don't want to set up Kerberos
- You're running in a container or CI environment

```ts
// ADO.NET — use Domain keyword
"Server=myserver;Database=mydb;User Id=myuser;Password=pass;Domain=MYDOMAIN;TrustServerCertificate=true;"

// URL — use domain query param
"mssql://myuser:pass@myserver/mydb?domain=MYDOMAIN&trustServerCertificate=true"

// Config object
{
  server: "myserver",
  authentication: {
    type: "ntlm",
    options: { domain: "MYDOMAIN", userName: "myuser", password: "pass" },
  },
}
```

::: info Cross-Platform NTLM with explicit credentials is the simplest way to
use Windows/domain authentication from Linux or macOS — no Kerberos ticket or
keytab required. The ODBC driver handles the NTLM handshake on all platforms.
:::

### Authentication Method Summary

| Method                         | Credentials Required         | Windows    | Linux / macOS                  |
| ------------------------------ | ---------------------------- | ---------- | ------------------------------ |
| SQL Server (`sql`)             | Username + password          | Yes        | Yes                            |
| Windows Integrated (`windows`) | None (current user)          | Yes (SSPI) | Yes (Kerberos ticket required) |
| NTLM (`ntlm`)                  | Domain + username + password | Yes        | Yes                            |
| Azure AD (see below)           | Token or credentials         | Yes        | Yes                            |

## Azure AD / Entra ID Authentication

Azure SQL supports Azure Active Directory (now Microsoft Entra ID)
authentication. The ODBC Driver 18 handles Azure AD auth natively — the driver
supports token-based flows where your TypeScript code acquires the token and
passes it through.

Works on all platforms (Windows, Linux, macOS).

### Pre-acquired Access Token

If you already have an access token (from `@azure/identity`, a managed identity
endpoint, or another source):

```ts
await using pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: {
    type: "azure-active-directory-access-token",
    options: { token: accessToken },
  },
});
```

Or via connection string:

```
Server=myserver.database.windows.net;Database=mydb;Authentication=ActiveDirectoryAccessToken;Access Token=eyJ...;Encrypt=true;
```

Or via URL:

```
mssql://myserver.database.windows.net/mydb?authentication=azure-active-directory-access-token&token=eyJ...&encrypt=true
```

::: info Encryption Azure SQL requires encrypted connections. Always set
`Encrypt=true` (or omit it — the driver defaults to encrypted for Azure
endpoints). :::

### Token Provider Callback

For automatic token refresh, provide a `tokenProvider` callback. The library
calls this function each time it creates a pool or connection, keeping the
library dependency-free — you bring your own token acquisition logic.

**DefaultAzureCredential** (recommended for most scenarios):

```ts
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();

await using pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: { type: "azure-active-directory-default" },
  tokenProvider: async () => {
    const token = await credential.getToken(
      "https://database.windows.net/.default",
    );
    return token.token;
  },
});
```

**Service Principal** (for server-to-server auth):

```ts
import { ClientSecretCredential } from "@azure/identity";

const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

await using pool = await mssql.createPool({
  server: "myserver.database.windows.net",
  database: "mydb",
  authentication: {
    type: "azure-active-directory-service-principal-secret",
    options: { clientId, clientSecret, tenantId },
  },
  tokenProvider: async () => {
    const token = await credential.getToken(
      "https://database.windows.net/.default",
    );
    return token.token;
  },
});
```

> **Note:** The `authentication.options` fields (`clientId`, `clientSecret`,
> `tenantId`) on the service principal type are informational — the actual token
> acquisition is handled by your `tokenProvider` callback.

## Named Instances

SQL Server supports running multiple instances on a single host, identified by
an instance name (e.g. `SQLEXPRESS`). All three connection formats can target a
named instance.

### ADO.NET — backslash in `Server`

Use the `host\instance` format in the `Server` key:

```ts
await using cn = await mssql.connect(
  "Server=myserver\\SQLEXPRESS;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=true;",
);
```

> **Note:** In a JavaScript/TypeScript string literal the backslash must be
> doubled (`\\`). In an `.env` file or shell variable, a single `\` is fine.

### URL — `instanceName` query parameter

```ts
await using cn = await mssql.connect(
  "mssql://sa:pass@myserver/mydb?instanceName=SQLEXPRESS&trustServerCertificate=true",
);
```

### Config Object — `options.instanceName`

```ts
await using cn = await mssql.connect({
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
// Connection automatically closed at end of scope
```

Or explicitly close (for cases where you need manual lifecycle control):

```ts
const cn = await mssql.connect("Server=localhost;...");
try {
  const rows = await cn.query("SELECT 1 AS val");
} finally {
  await cn.close();
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

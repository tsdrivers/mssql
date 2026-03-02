import { assertEquals, assertThrows } from "jsr:@std/assert";
import { parseConnection, resolveTokenProvider } from "./config.ts";

// ── ADO.NET format ──────────────────────────────────────────

Deno.test("parseConnection - ADO.NET basic SQL auth", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=mydb;User Id=sa;Password=pass123;",
  );
  assertEquals(cfg.server, "localhost");
  assertEquals(cfg.port, 1433);
  assertEquals(cfg.database, "mydb");
  assertEquals(cfg.auth, { type: "sql", username: "sa", password: "pass123" });
});

Deno.test("parseConnection - ADO.NET with port via comma", () => {
  const cfg = parseConnection(
    "Server=tcp:myhost,1434;Database=testdb;User Id=sa;Password=p;",
  );
  assertEquals(cfg.server, "myhost");
  assertEquals(cfg.port, 1434);
  assertEquals(cfg.database, "testdb");
});

Deno.test("parseConnection - ADO.NET with instance name", () => {
  const cfg = parseConnection(
    "Server=myhost\\MYINST;Database=db;User Id=sa;Password=p;",
  );
  assertEquals(cfg.server, "myhost");
  assertEquals(cfg.instance_name, "MYINST");
  assertEquals(cfg.port, 1433); // default when instance used
});

Deno.test("parseConnection - ADO.NET integrated security", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=db;Integrated Security=true;",
  );
  assertEquals(cfg.auth, { type: "windows" });
});

Deno.test("parseConnection - ADO.NET integrated security SSPI", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=db;Integrated Security=SSPI;",
  );
  assertEquals(cfg.auth, { type: "windows" });
});

Deno.test("parseConnection - ADO.NET NTLM with domain", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=db;User Id=admin;Password=p;Domain=CORP;",
  );
  assertEquals(cfg.auth, {
    type: "ntlm",
    username: "admin",
    password: "p",
    domain: "CORP",
  });
});

Deno.test("parseConnection - ADO.NET quoted password with semicolons", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=db;User Id=sa;Password='has;semi;colons';",
  );
  assertEquals(cfg.auth, {
    type: "sql",
    username: "sa",
    password: "has;semi;colons",
  });
});

Deno.test("parseConnection - ADO.NET key aliases", () => {
  const cfg = parseConnection(
    "Data Source=host1;Initial Catalog=mydb;UID=user1;PWD=pass1;",
  );
  assertEquals(cfg.server, "host1");
  assertEquals(cfg.database, "mydb");
  assertEquals(cfg.auth, { type: "sql", username: "user1", password: "pass1" });
});

Deno.test("parseConnection - ADO.NET encrypt and trust options", () => {
  const cfg = parseConnection(
    "Server=localhost;Database=db;User Id=sa;Password=p;Encrypt=false;TrustServerCertificate=false;",
  );
  assertEquals(cfg.encrypt, false);
  assertEquals(cfg.trust_server_certificate, false);
});

Deno.test("parseConnection - ADO.NET timeout parsing (seconds)", () => {
  const cfg = parseConnection(
    "Server=localhost;User Id=sa;Password=p;Connection Timeout=30;Command Timeout=60;",
  );
  assertEquals(cfg.connect_timeout_ms, 30000);
  assertEquals(cfg.request_timeout_ms, 60000);
});

Deno.test("parseConnection - ADO.NET timeout parsing (ms when > 1000)", () => {
  const cfg = parseConnection(
    "Server=localhost;User Id=sa;Password=p;Connection Timeout=5000;",
  );
  assertEquals(cfg.connect_timeout_ms, 5000);
});

Deno.test("parseConnection - ADO.NET defaults", () => {
  const cfg = parseConnection("Server=localhost;User Id=sa;Password=p;");
  assertEquals(cfg.port, 1433);
  assertEquals(cfg.database, "master");
  assertEquals(cfg.encrypt, true);
  assertEquals(cfg.trust_server_certificate, true);
  assertEquals(cfg.connect_timeout_ms, 15000);
  assertEquals(cfg.request_timeout_ms, 15000);
  assertEquals(cfg.app_name, "@tracker1/mssql");
  assertEquals(cfg.instance_name, null);
  assertEquals(cfg.packet_size, 4096);
  assertEquals(cfg.pool, null);
});

Deno.test("parseConnection - ADO.NET Min Pool Size and Max Pool Size", () => {
  const cfg = parseConnection(
    "Server=localhost;User Id=sa;Password=p;Min Pool Size=5;Max Pool Size=20;",
  );
  assertEquals(cfg.pool, { min: 5, max: 20 });
});

Deno.test("parseConnection - ADO.NET Max Pool Size only", () => {
  const cfg = parseConnection(
    "Server=localhost;User Id=sa;Password=p;Max Pool Size=10;",
  );
  assertEquals(cfg.pool, { min: undefined, max: 10 });
});

Deno.test("parseConnection - ADO.NET no pool params returns null", () => {
  const cfg = parseConnection("Server=localhost;User Id=sa;Password=p;");
  assertEquals(cfg.pool, null);
});

// ── URL format ──────────────────────────────────────────────

Deno.test("parseConnection - URL basic SQL auth", () => {
  const cfg = parseConnection("mssql://sa:pass123@localhost/mydb");
  assertEquals(cfg.server, "localhost");
  assertEquals(cfg.port, 1433);
  assertEquals(cfg.database, "mydb");
  assertEquals(cfg.auth, { type: "sql", username: "sa", password: "pass123" });
});

Deno.test("parseConnection - URL with port", () => {
  const cfg = parseConnection("mssql://sa:pass@host1:1434/testdb");
  assertEquals(cfg.server, "host1");
  assertEquals(cfg.port, 1434);
  assertEquals(cfg.database, "testdb");
});

Deno.test("parseConnection - URL with integrated security", () => {
  const cfg = parseConnection("mssql://localhost/mydb?integratedSecurity=true");
  assertEquals(cfg.auth, { type: "windows" });
});

Deno.test("parseConnection - URL with NTLM domain", () => {
  const cfg = parseConnection("mssql://admin:p@localhost/db?domain=CORP");
  assertEquals(cfg.auth, {
    type: "ntlm",
    username: "admin",
    password: "p",
    domain: "CORP",
  });
});

Deno.test("parseConnection - URL sqlserver:// scheme", () => {
  const cfg = parseConnection("sqlserver://sa:pass@localhost/mydb");
  assertEquals(cfg.server, "localhost");
  assertEquals(cfg.database, "mydb");
  assertEquals(cfg.auth, { type: "sql", username: "sa", password: "pass" });
});

Deno.test("parseConnection - URL with options", () => {
  const cfg = parseConnection(
    "mssql://sa:p@localhost/db?encrypt=false&trustServerCertificate=false&appName=myapp",
  );
  assertEquals(cfg.encrypt, false);
  assertEquals(cfg.trust_server_certificate, false);
  assertEquals(cfg.app_name, "myapp");
});

Deno.test("parseConnection - URL encoded credentials", () => {
  const cfg = parseConnection("mssql://sa:p%40ss%23@localhost/db");
  assertEquals(cfg.auth, { type: "sql", username: "sa", password: "p@ss#" });
});

Deno.test("parseConnection - URL defaults", () => {
  const cfg = parseConnection("mssql://sa:p@localhost");
  assertEquals(cfg.database, "master");
  assertEquals(cfg.port, 1433);
  assertEquals(cfg.encrypt, true);
  assertEquals(cfg.trust_server_certificate, true);
});

Deno.test("parseConnection - URL minPoolSize and maxPoolSize", () => {
  const cfg = parseConnection(
    "mssql://sa:p@localhost/db?minPoolSize=2&maxPoolSize=15",
  );
  assertEquals(cfg.pool, { min: 2, max: 15 });
});

Deno.test("parseConnection - URL maxPoolSize only", () => {
  const cfg = parseConnection("mssql://sa:p@localhost/db?maxPoolSize=25");
  assertEquals(cfg.pool, { min: undefined, max: 25 });
});

// ── Config object format ────────────────────────────────────

Deno.test("parseConnection - config object SQL auth", () => {
  const cfg = parseConnection({
    server: "localhost",
    database: "mydb",
    authentication: {
      type: "default",
      options: { userName: "sa", password: "pass123" },
    },
  });
  assertEquals(cfg.server, "localhost");
  assertEquals(cfg.database, "mydb");
  assertEquals(cfg.auth, { type: "sql", username: "sa", password: "pass123" });
});

Deno.test("parseConnection - config object Windows auth", () => {
  const cfg = parseConnection({
    server: "localhost",
    authentication: { type: "windows" },
  });
  assertEquals(cfg.auth, { type: "windows" });
});

Deno.test("parseConnection - config object NTLM", () => {
  const cfg = parseConnection({
    server: "localhost",
    authentication: {
      type: "ntlm",
      options: { userName: "admin", password: "p", domain: "CORP" },
    },
  });
  assertEquals(cfg.auth, {
    type: "ntlm",
    username: "admin",
    password: "p",
    domain: "CORP",
  });
});

Deno.test("parseConnection - config object Azure AD", () => {
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: {
      type: "azure-active-directory-password",
      options: { userName: "user@domain.com", password: "pass" },
    },
  });
  assertEquals(cfg.auth, {
    type: "azure_ad",
    username: "user@domain.com",
    password: "pass",
  });
});

Deno.test("parseConnection - config object with options", () => {
  const cfg = parseConnection({
    server: "localhost",
    port: 1434,
    database: "testdb",
    authentication: {
      type: "default",
      options: { userName: "sa", password: "p" },
    },
    options: {
      encrypt: false,
      trustServerCertificate: false,
      connectTimeout: 30000,
      requestTimeout: 60000,
      appName: "myapp",
      instanceName: "INST1",
      packetSize: 8192,
    },
  });
  assertEquals(cfg.port, 1434);
  assertEquals(cfg.database, "testdb");
  assertEquals(cfg.encrypt, false);
  assertEquals(cfg.trust_server_certificate, false);
  assertEquals(cfg.connect_timeout_ms, 30000);
  assertEquals(cfg.request_timeout_ms, 60000);
  assertEquals(cfg.app_name, "myapp");
  assertEquals(cfg.instance_name, "INST1");
  assertEquals(cfg.packet_size, 8192);
});

Deno.test("parseConnection - config object with pool", () => {
  const cfg = parseConnection({
    server: "localhost",
    authentication: {
      type: "default",
      options: { userName: "sa", password: "p" },
    },
    pool: { min: 2, max: 20, idleTimeoutMillis: 30000 },
  });
  assertEquals(cfg.pool, { min: 2, max: 20, idle_timeout_ms: 30000 });
});

Deno.test("parseConnection - config object no auth defaults to windows", () => {
  const cfg = parseConnection({ server: "localhost" });
  assertEquals(cfg.auth, { type: "windows" });
});

// ── Azure AD auth ──────────────────────────────────────────

Deno.test("parseConnection - config object azure-active-directory-access-token", () => {
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test" },
    },
  });
  assertEquals(cfg.auth, {
    type: "azure_ad_token",
    token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
  });
  assertEquals(cfg.token_provider, undefined);
});

Deno.test("parseConnection - config object azure-active-directory-access-token requires token", () => {
  assertThrows(
    () =>
      parseConnection({
        server: "myserver.database.windows.net",
        authentication: {
          type: "azure-active-directory-access-token",
          options: {},
        },
      }),
    Error,
    "requires options.token",
  );
});

Deno.test("parseConnection - config object azure-active-directory-default with tokenProvider", () => {
  const provider = () => Promise.resolve("resolved-token");
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: { type: "azure-active-directory-default" },
    tokenProvider: provider,
  });
  // Auth has placeholder token — entry point resolves via token_provider
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "" });
  assertEquals(cfg.token_provider, provider);
});

Deno.test("parseConnection - config object azure-active-directory-service-principal-secret with tokenProvider", () => {
  const provider = () => Promise.resolve("sp-token");
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: {
      type: "azure-active-directory-service-principal-secret",
      options: { clientId: "id", clientSecret: "secret", tenantId: "tenant" },
    },
    tokenProvider: provider,
  });
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "" });
  assertEquals(cfg.token_provider, provider);
});

Deno.test("parseConnection - ADO.NET ActiveDirectoryAccessToken", () => {
  const cfg = parseConnection(
    "Server=myserver.database.windows.net;Database=mydb;Authentication=ActiveDirectoryAccessToken;Access Token=eyJtoken123;",
  );
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "eyJtoken123" });
  assertEquals(cfg.database, "mydb");
});

Deno.test("parseConnection - URL azure-active-directory-access-token", () => {
  const cfg = parseConnection(
    "mssql://myserver.database.windows.net/mydb?authentication=azure-active-directory-access-token&token=eyJtoken456",
  );
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "eyJtoken456" });
  assertEquals(cfg.database, "mydb");
});

Deno.test("resolveTokenProvider - resolves token and strips provider", async () => {
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: { type: "azure-active-directory-default" },
    tokenProvider: () => Promise.resolve("fresh-token-123"),
  });
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "" });
  assertEquals(typeof cfg.token_provider, "function");

  await resolveTokenProvider(cfg);
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "fresh-token-123" });
  assertEquals(cfg.token_provider, undefined);
});

Deno.test("resolveTokenProvider - no-op when no provider", async () => {
  const cfg = parseConnection({
    server: "myserver.database.windows.net",
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: "direct-token" },
    },
  });
  await resolveTokenProvider(cfg);
  assertEquals(cfg.auth, { type: "azure_ad_token", token: "direct-token" });
});

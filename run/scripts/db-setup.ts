#!/usr/bin/env -S deno run -A
/**
 * Database setup script for integration tests.
 *
 * Creates the MSSQLTS_TEST database with UTF8 collation.
 * On Windows, also configures FILESTREAM access.
 *
 * Outputs the derived test connection string to stdout.
 * All diagnostics go to stderr.
 */

import { connect } from "../../projects/mssql/mod.ts";

const SA_CONNECTION =
  Deno.env.get("MSSQL_SA_CONNECTION") ??
  "Server=localhost;Database=master;User Id=sa;Password=DevPassword1!;TrustServerCertificate=true;";

const TARGET_COLLATION = "Latin1_General_100_CI_AS_SC_UTF8";
const TEST_DB = "MSSQLTS_TEST";

function log(msg: string): void {
  console.error(msg);
}

/**
 * Derive the test connection string from the SA connection string
 * by replacing the Database (or Initial Catalog) value with the test database name.
 */
function deriveTestConnection(saConn: string): string {
  const dbPattern = /(?:Database|Initial Catalog)\s*=\s*[^;]*/i;
  if (dbPattern.test(saConn)) {
    return saConn.replace(dbPattern, `Database=${TEST_DB}`);
  }
  // No database key found; append it
  const trimmed = saConn.replace(/;?\s*$/, "");
  return `${trimmed};Database=${TEST_DB};`;
}

try {
  log("Connecting to master...");
  const cn = await connect(SA_CONNECTION);

  // Check if database exists and its collation
  const existing = await cn.queryFirst<{
    name: string;
    collation: string;
  }>(
    "SELECT name, collation_name AS collation FROM sys.databases WHERE name = @db",
    { db: TEST_DB },
  );

  if (!existing) {
    log(`Creating database [${TEST_DB}] with collation ${TARGET_COLLATION}...`);
    await cn.execute(
      `CREATE DATABASE [${TEST_DB}] COLLATE ${TARGET_COLLATION}`,
    );
    log("Database created.");
  } else if (existing.collation !== TARGET_COLLATION) {
    log(
      `Database exists with collation ${existing.collation}, changing to ${TARGET_COLLATION}...`,
    );
    await cn.execute(
      `ALTER DATABASE [${TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`,
    );
    await cn.execute(
      `ALTER DATABASE [${TEST_DB}] COLLATE ${TARGET_COLLATION}`,
    );
    await cn.execute(`ALTER DATABASE [${TEST_DB}] SET MULTI_USER`);
    log("Collation updated.");
  } else {
    log(`Database [${TEST_DB}] already exists with correct collation.`);
  }

  // Windows FILESTREAM setup
  if (Deno.build.os === "windows") {
    log("Windows detected — configuring FILESTREAM...");
    const fsLevel = await cn.queryFirst<{ value: number }>(
      "SELECT CAST(value_in_use AS int) AS value FROM sys.configurations WHERE name = 'filestream access level'",
    );
    if (fsLevel && fsLevel.value < 2) {
      log("Enabling FILESTREAM access level 2...");
      await cn.execute(
        "EXEC sp_configure 'filestream access level', 2",
      );
      await cn.execute("RECONFIGURE");
      log("FILESTREAM enabled.");
    } else {
      log(`FILESTREAM already at level ${fsLevel?.value ?? "unknown"}.`);
    }

    // Add FILESTREAM filegroup to test database if FILESTREAM is enabled
    const currentLevel = await cn.scalar<number>(
      "SELECT CAST(value_in_use AS int) FROM sys.configurations WHERE name = 'filestream access level'",
    ) ?? 0;

    if (currentLevel >= 2) {
      const fgExists = await cn.scalar<number>(
        `SELECT COUNT(*) FROM [${TEST_DB}].sys.filegroups WHERE name = 'FSGroup' AND type = 'FD'`,
      ) ?? 0;

      if (!fgExists) {
        log("Adding FILESTREAM filegroup to test database...");
        await cn.execute(
          `ALTER DATABASE [${TEST_DB}] ADD FILEGROUP [FSGroup] CONTAINS FILESTREAM`,
        );
        const dataDir = await cn.scalar<string>(
          "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(260))",
        ) ?? "";
        await cn.execute(
          `ALTER DATABASE [${TEST_DB}] ADD FILE (NAME = 'FSData', FILENAME = '${dataDir}MSSQLTS_TEST_FS') TO FILEGROUP [FSGroup]`,
        );
        log("FILESTREAM filegroup created.");
      } else {
        log("FILESTREAM filegroup already exists.");
      }
    }
  }

  await cn.disconnect();

  // Set up test tables in the test database
  const testConn = deriveTestConnection(SA_CONNECTION);
  log("Setting up test tables...");
  const testCn = await connect(testConn);

  try {
    const tableExists = await testCn.scalar<number>(
      "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'BinaryFiles' AND TABLE_SCHEMA = 'dbo'",
    ) ?? 0;

    if (!tableExists) {
      const hasFilestream = await testCn.scalar<number>(
        "SELECT COUNT(*) FROM sys.filegroups WHERE type = 'FD'",
      ) ?? 0;

      if (hasFilestream) {
        log("Creating FILESTREAM-enabled BinaryFiles table...");
        await testCn.execute(`
          CREATE TABLE dbo.BinaryFiles (
            id UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL DEFAULT NEWSEQUENTIALID(),
            file_name NVARCHAR(255) NOT NULL,
            file_data VARBINARY(MAX) FILESTREAM NULL,
            created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_BinaryFiles PRIMARY KEY (id)
          )
        `);
      } else {
        log("Creating VARBINARY BinaryFiles table...");
        await testCn.execute(`
          CREATE TABLE dbo.BinaryFiles (
            id UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL DEFAULT NEWSEQUENTIALID(),
            file_name NVARCHAR(255) NOT NULL,
            file_data VARBINARY(MAX) NULL,
            created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_BinaryFiles PRIMARY KEY (id)
          )
        `);
      }
      log("BinaryFiles table created.");
    } else {
      log("BinaryFiles table already exists.");
    }
  } finally {
    await testCn.disconnect();
  }

  // Output the test connection string to stdout (bash captures this)
  console.log(testConn);
} catch (err) {
  log(`ERROR: ${err}`);
  Deno.exit(1);
}

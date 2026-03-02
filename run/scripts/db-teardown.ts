#!/usr/bin/env -S deno run -A
/**
 * Database teardown script for integration tests.
 *
 * Drops the MSSQLTS_TEST database if it exists.
 * All diagnostics go to stderr.
 */

import { connect } from "../../projects/mssql/mod.ts";

const SA_CONNECTION =
  Deno.env.get("MSSQL_SA_CONNECTION") ??
  "Server=localhost;Database=master;User Id=sa;Password=DevPassword1!;TrustServerCertificate=true;";

const TEST_DB = "MSSQLTS_TEST";

function log(msg: string): void {
  console.error(msg);
}

try {
  log("Connecting to master...");
  const cn = await connect(SA_CONNECTION);

  const existing = await cn.queryFirst<{ name: string }>(
    "SELECT name FROM sys.databases WHERE name = @db",
    { db: TEST_DB },
  );

  if (existing) {
    log(`Dropping database [${TEST_DB}]...`);
    await cn.execute(
      `ALTER DATABASE [${TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`,
    );
    await cn.execute(`DROP DATABASE [${TEST_DB}]`);
    log("Database dropped.");
  } else {
    log(`Database [${TEST_DB}] does not exist, nothing to drop.`);
  }

  await cn.disconnect();
} catch (err) {
  log(`ERROR: ${err}`);
  Deno.exit(1);
}

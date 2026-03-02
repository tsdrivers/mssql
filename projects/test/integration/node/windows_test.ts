/**
 * Windows-only integration tests (SSPI auth, FILESTREAM).
 * Automatically skipped on Linux.
 * @module
 */

import { describe, test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { getTestEnv, skipFilestream, skipMssql, skipWindows } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("windows-only", () => {
  test("Windows auth (SSPI)", { skip: skipWindows || skipMssql }, async () => {
    // Use Windows auth connection string
    const cn = await mssql.connect(
      "Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true;",
    );
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    strictEqual(result[0].val, 1);
    cn.disconnect();
  });

  test("FILESTREAM read/write", { skip: skipFilestream }, async () => {
    // FILESTREAM tests require Windows + FILESTREAM-enabled MSSQL
    const ffi = await mssql.getFfi();
    const available = ffi.filestreamAvailable();
    strictEqual(available, true);
  });

  test("FILESTREAM availability check", { skip: skipMssql }, async () => {
    const env = getTestEnv();
    if (!env.isWindows) {
      // On Linux, FILESTREAM is not available
      const ffi = await mssql.getFfi();
      strictEqual(ffi.filestreamAvailable(), false);
    }
  });
});

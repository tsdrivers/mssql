/**
 * Windows-only integration tests (SSPI auth, FILESTREAM).
 * Automatically skipped on Linux.
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv, skipFilestream, skipMssql, skipWindows } from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

describe("windows-only", () => {
  test.skipIf(skipWindows || skipMssql)("Windows auth (SSPI)", async () => {
    // Use Windows auth connection string
    const cn = await mssql.connect(
      "Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true;",
    );
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    expect(result[0].val).toBe(1);
    cn.disconnect();
  });

  test.skipIf(skipFilestream)("FILESTREAM read/write", async () => {
    // FILESTREAM tests require Windows + FILESTREAM-enabled MSSQL
    const ffi = await mssql.getFfi();
    const available = ffi.filestreamAvailable();
    expect(available).toBe(true);
  });

  test.skipIf(skipMssql)("FILESTREAM availability check", async () => {
    const env = getTestEnv();
    if (!env.isWindows) {
      // On Linux, FILESTREAM is not available
      const ffi = await mssql.getFfi();
      expect(ffi.filestreamAvailable()).toBe(false);
    }
  });
});

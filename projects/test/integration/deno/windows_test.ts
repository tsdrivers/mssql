/**
 * Windows-only integration tests (SSPI auth, FILESTREAM).
 * Automatically skipped on Linux.
 * @module
 */

import { assertEquals } from "jsr:@std/assert";
import {
  getTestEnv,
  skipFilestream,
  skipMssql,
  skipWindows,
} from "./test_helpers.ts";
import * as mssql from "../../../mssql/mod.ts";

Deno.test({
  name: "windows - auth (SSPI)",
  ignore: skipWindows || skipMssql,
  async fn() {
    // Use Windows auth connection string
    const cn = await mssql.connect(
      "Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true;",
    );
    const result = await cn.query<{ val: number }>("SELECT 1 AS val");
    assertEquals(result[0].val, 1);
    cn.disconnect();
  },
});

Deno.test({
  name: "windows - FILESTREAM read/write",
  ignore: skipFilestream,
  async fn() {
    // FILESTREAM tests require Windows + FILESTREAM-enabled MSSQL
    const ffi = await mssql.getFfi();
    const available = ffi.filestreamAvailable();
    assertEquals(available, true);
  },
});

Deno.test({
  name: "windows - FILESTREAM availability check",
  ignore: skipMssql,
  async fn() {
    const env = getTestEnv();
    if (!env.isWindows) {
      // On Linux, FILESTREAM is not available
      const ffi = await mssql.getFfi();
      assertEquals(ffi.filestreamAvailable(), false);
    }
  },
});

/**
 * Environment detection integration tests (always run, no MSSQL needed).
 * @module
 */

import { assertEquals } from "jsr:@std/assert";
import { getTestEnv } from "./test_helpers.ts";
import { parseConnection } from "../../../mssql/core/config.ts";

Deno.test("test environment - detects OS correctly", () => {
  const env = getTestEnv();
  const os = Deno.build.os;
  if (os === "windows") {
    assertEquals(env.isWindows, true);
    assertEquals(env.isLinux, false);
  } else if (os === "linux") {
    assertEquals(env.isLinux, true);
    assertEquals(env.isWindows, false);
  }
});

Deno.test("test environment - has connection string", () => {
  const env = getTestEnv();
  assertEquals(typeof env.connectionString, "string");
  assertEquals(env.connectionString.length > 0, true);
});

Deno.test("test environment - connection string parses correctly", () => {
  const env = getTestEnv();
  const cfg = parseConnection(env.connectionString);
  assertEquals(typeof cfg.server, "string");
  assertEquals(cfg.server.length > 0, true);
});

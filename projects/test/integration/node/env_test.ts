/**
 * Environment detection integration tests (always run, no MSSQL needed).
 * @module
 */

import { describe, test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { getTestEnv } from "./test_helpers.ts";
import { parseConnection } from "../../../mssql/core/config.ts";

describe("environment detection", () => {
  test("detects OS correctly", () => {
    const env = getTestEnv();
    const platform = process.platform;
    if (platform === "win32") {
      strictEqual(env.isWindows, true);
      strictEqual(env.isLinux, false);
    } else if (platform === "linux") {
      strictEqual(env.isLinux, true);
      strictEqual(env.isWindows, false);
    }
  });

  test("has connection string", () => {
    const env = getTestEnv();
    strictEqual(typeof env.connectionString, "string");
    strictEqual(env.connectionString.length > 0, true);
  });

  test("connection string parses correctly", () => {
    const env = getTestEnv();
    const cfg = parseConnection(env.connectionString);
    strictEqual(typeof cfg.server, "string");
    strictEqual(cfg.server.length > 0, true);
  });
});

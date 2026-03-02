/**
 * Environment detection integration tests (always run, no MSSQL needed).
 * @module
 */

import { describe, expect, test } from "bun:test";
import { getTestEnv } from "./test_helpers.ts";
import { parseConnection } from "../../../mssql/core/config.ts";

describe("environment detection", () => {
  test("detects OS correctly", () => {
    const env = getTestEnv();
    const platform = process.platform;
    if (platform === "win32") {
      expect(env.isWindows).toBe(true);
      expect(env.isLinux).toBe(false);
    } else if (platform === "linux") {
      expect(env.isLinux).toBe(true);
      expect(env.isWindows).toBe(false);
    }
  });

  test("has connection string", () => {
    const env = getTestEnv();
    expect(typeof env.connectionString).toBe("string");
    expect(env.connectionString.length > 0).toBe(true);
  });

  test("connection string parses correctly", () => {
    const env = getTestEnv();
    const cfg = parseConnection(env.connectionString);
    expect(typeof cfg.server).toBe("string");
    expect(cfg.server.length > 0).toBe(true);
  });
});

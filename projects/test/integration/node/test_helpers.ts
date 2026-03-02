/**
 * Test helpers for Node.js integration tests.
 * Provides environment detection and conditional test registration.
 * @module
 */

export interface TestEnv {
  /** Whether a MSSQL server is reachable for integration tests */
  hasMssql: boolean;
  /** Whether we're running on Windows (for FILESTREAM/SSPI tests) */
  isWindows: boolean;
  /** Whether we're running on Linux */
  isLinux: boolean;
  /** Connection string for the test MSSQL instance */
  connectionString: string;
}

let _env: TestEnv | null = null;

/** Detect the test environment once and cache it. */
export function getTestEnv(): TestEnv {
  if (_env) return _env;

  const platform = process.platform;
  const isWindows = platform === "win32";
  const isLinux = platform === "linux";

  // Allow overriding via env vars
  const connectionString = process.env.MSSQL_TEST_CONNECTION ??
    "Server=localhost;Database=MSSQLTS_TEST;User Id=sa;Password=DevPassword1!;TrustServerCertificate=true;";

  // Check if MSSQL integration tests are enabled
  const mssqlEnabled = process.env.MSSQL_TEST_ENABLED === "1" ||
    process.env.MSSQL_TEST_ENABLED === "true";

  _env = {
    hasMssql: mssqlEnabled,
    isWindows,
    isLinux,
    connectionString,
  };
  return _env;
}

/** Whether MSSQL integration tests should be skipped. */
export const skipMssql = !getTestEnv().hasMssql;

/** Whether Windows-only tests should be skipped. */
export const skipWindows = !getTestEnv().isWindows;

/** Whether FILESTREAM tests should be skipped (requires Windows + MSSQL). */
export const skipFilestream = skipWindows || skipMssql;

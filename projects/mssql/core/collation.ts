/**
 * Helpers for working with SQL Server UTF-8 collations (2019+).
 *
 * The driver handles all encoding transparently — just define your
 * columns with a UTF-8 collation and use normal strings in queries.
 * SQL Server converts nvarchar ↔ UTF-8 varchar automatically.
 *
 * @module
 */

export const UTF8_COLLATIONS = {
  /** Case-insensitive, accent-sensitive, supplementary characters */
  CI_AS: "LATIN1_GENERAL_100_CI_AS_SC_UTF8",
  /** Case-sensitive, accent-sensitive, supplementary characters */
  CS_AS: "LATIN1_GENERAL_100_CS_AS_SC_UTF8",
  /** Binary sort order */
  BIN2: "LATIN1_GENERAL_100_BIN2_UTF8",
} as const;

/**
 * Generate a column definition with UTF-8 collation.
 *
 * @example
 * ```ts
 * await cn.execute(`
 *   CREATE TABLE Posts (
 *     ${mssql.utf8Column("Title", "varchar(200)")},
 *     ${mssql.utf8Column("Body", "varchar(max)")},
 *     ${mssql.utf8Column("Slug", "varchar(100)", mssql.UTF8_COLLATIONS.BIN2)}
 *   )
 * `);
 * ```
 */
export function utf8Column(
  name: string,
  typeDef: string,
  collation: string = UTF8_COLLATIONS.CI_AS,
): string {
  return `[${name}] ${typeDef} COLLATE ${collation}`;
}

/**
 * Check if the connected server supports UTF-8 collations (SQL Server 2019+).
 */
export async function supportsUtf8(
  cn: { scalar: <T>(sql: string) => Promise<T | undefined> },
): Promise<boolean> {
  const version = await cn.scalar<number>(
    "SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS INT)",
  );
  return (version ?? 0) >= 15;
}

/**
 * Set the default database collation to UTF-8.
 * All new varchar columns will inherit this collation unless overridden.
 */
export async function setDatabaseUtf8(
  cn: { execute: (sql: string) => Promise<number> },
  database: string,
  collation: string = UTF8_COLLATIONS.CI_AS,
): Promise<void> {
  const safeName = database.replace(/[[\]'";\s]/g, "");
  await cn.execute(`ALTER DATABASE [${safeName}] COLLATE ${collation}`);
}

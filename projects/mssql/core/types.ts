/**
 * Shared type definitions for @tracker1/mssql.
 * @module
 */

// ── SQL Types ───────────────────────────────────────────────

export type SqlType =
  | "int"
  | "bigint"
  | "smallint"
  | "tinyint"
  | "float"
  | "real"
  | "decimal"
  | "bit"
  | "varchar"
  | "nvarchar"
  | "text"
  | "ntext"
  | "char"
  | "nchar"
  | "date"
  | "datetime"
  | "datetime2"
  | "datetimeoffset"
  | "time"
  | "uniqueidentifier"
  | "varbinary"
  | "xml"
  | "json";

export type IsolationLevel =
  | "READ_UNCOMMITTED"
  | "READ_COMMITTED"
  | "REPEATABLE_READ"
  | "SNAPSHOT"
  | "SERIALIZABLE";

export type CommandType = "text" | "stored_procedure";

export type FilestreamMode = "read" | "write" | "readwrite";

/**
 * Common UTF-8 collations available in SQL Server 2019+.
 */
export type Utf8Collation =
  | "LATIN1_GENERAL_100_CI_AS_SC_UTF8"
  | "LATIN1_GENERAL_100_CS_AS_SC_UTF8"
  | "LATIN1_GENERAL_100_BIN2_UTF8"
  | string;

// ── Parameter Types ─────────────────────────────────────────

export type ParamValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | Uint8Array;

export interface TypedParam {
  value: ParamValue;
  type: SqlType;
  /** Set to `true` for OUTPUT parameters (stored procedures). */
  output?: boolean;
}

export type Params = Record<string, ParamValue | TypedParam>;

// ── Command Options ─────────────────────────────────────────

export interface CommandOptions {
  transaction?: { id: string; _ensureActive(): void };
  commandTimeout?: number;
  commandType?: CommandType;
  signal?: AbortSignal;
}

// ── Stream Options ──────────────────────────────────────────

export interface StreamOptions extends CommandOptions {
}

// ── Serialized Types (JSON across FFI boundary) ─────────────

export interface SerializedCommand {
  sql: string;
  params: SerializedParam[];
  transaction_id: string | null;
  command_timeout_ms: number | null;
  command_type: string;
}

export interface SerializedParam {
  name: string;
  value: unknown;
  type: string | null;
  output?: boolean;
}

// ── Config Types ────────────────────────────────────────────

export interface MssqlConfig {
  server: string;
  port?: number;
  database?: string;
  authentication?: {
    type:
      | "default"
      | "ntlm"
      | "windows"
      | "azure-active-directory-password"
      | "azure-active-directory-access-token"
      | "azure-active-directory-default"
      | "azure-active-directory-service-principal-secret";
    options?: {
      userName?: string;
      password?: string;
      domain?: string;
      token?: string;
      clientId?: string;
      clientSecret?: string;
      tenantId?: string;
    };
  };
  /** Async function that returns an Azure AD access token. Used with azure-active-directory-default and service-principal-secret types. */
  tokenProvider?: () => Promise<string>;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    connectTimeout?: number;
    requestTimeout?: number;
    appName?: string;
    instanceName?: string;
    packetSize?: number;
  };
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
  };
}

export interface NormalizedConfig {
  server: string;
  port: number;
  database: string;
  auth:
    | { type: "sql"; username: string; password: string }
    | { type: "ntlm"; username: string; password: string; domain: string }
    | { type: "windows" }
    | { type: "azure_ad"; username: string; password: string }
    | { type: "azure_ad_token"; token: string };
  encrypt: boolean;
  trust_server_certificate: boolean;
  connect_timeout_ms: number;
  request_timeout_ms: number;
  app_name: string;
  instance_name: string | null;
  packet_size: number;
  pool: { min?: number; max?: number; idle_timeout_ms?: number } | null;
  /** Async function that returns an Azure AD access token. Resolved by entry points before FFI serialization. */
  token_provider?: () => Promise<string>;
}

// ── Bulk Insert Types ───────────────────────────────────────

export interface BulkColumn {
  name: string;
  type: SqlType;
  nullable?: boolean;
  collation?: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

// ── Diagnostics ─────────────────────────────────────────────

/** Pool status snapshot from the Rust driver. */
export interface DiagnosticPool {
  id: number;
  total: number;
  idle: number;
  in_use: number;
  max: number;
}

/** Connection status snapshot from the Rust driver. */
export interface DiagnosticConnection {
  id: number;
  pool_id: number | null;
  is_pooled: boolean;
  has_active_transaction: boolean;
}

/**
 * Diagnostic information about active pools and connections.
 * Contains no credentials, connection strings, or passwords.
 */
export interface DiagnosticInfo {
  pools: DiagnosticPool[];
  connections: DiagnosticConnection[];
}

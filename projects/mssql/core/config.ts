/**
 * Connection string parsing for ADO.NET, URL, and config object formats.
 * @module
 */

import type { MssqlConfig, NormalizedConfig } from "./types.ts";

const DEFAULTS: Omit<NormalizedConfig, "server" | "auth"> = {
  port: 1433,
  database: "master",
  encrypt: true,
  trust_server_certificate: true,
  connect_timeout_ms: 15000,
  request_timeout_ms: 15000,
  app_name: "@tracker1/mssql",
  instance_name: null,
  packet_size: 4096,
  pool: null,
};

// ── ADO.NET key aliases ─────────────────────────────────────

const KEY_MAP: Record<string, string> = {
  "server": "server",
  "data source": "server",
  "addr": "server",
  "address": "server",
  "database": "database",
  "initial catalog": "database",
  "user id": "user",
  "uid": "user",
  "user": "user",
  "password": "password",
  "pwd": "password",
  "integrated security": "integrated_security",
  "trusted_connection": "integrated_security",
  "encrypt": "encrypt",
  "trustservercertificate": "trust_server_certificate",
  "trust server certificate": "trust_server_certificate",
  "connection timeout": "connect_timeout",
  "connect timeout": "connect_timeout",
  "command timeout": "request_timeout",
  "request timeout": "request_timeout",
  "application name": "app_name",
  "app": "app_name",
  "packet size": "packet_size",
  "domain": "domain",
  "authentication": "authentication",
  "access token": "access_token",
  "min pool size": "min_pool_size",
  "max pool size": "max_pool_size",
};

export function parseConnection(input: string | MssqlConfig): NormalizedConfig {
  if (typeof input === "string") {
    if (input.startsWith("mssql://") || input.startsWith("sqlserver://")) {
      return parseUrl(input);
    }
    return parseAdoNet(input);
  }
  return parseConfigObject(input);
}

// ── ADO.NET ─────────────────────────────────────────────────

function parseAdoNet(connStr: string): NormalizedConfig {
  const pairs = splitAdoNet(connStr);
  const map = new Map<string, string>();

  for (const [rawKey, value] of pairs) {
    const normalized = KEY_MAP[rawKey.toLowerCase().trim()] ??
      rawKey.toLowerCase().trim();
    map.set(normalized, value);
  }

  const serverRaw = map.get("server") ?? "localhost";
  const { host, port, instance } = parseServerValue(serverRaw);

  const isWindows = ["true", "yes", "sspi"].includes(
    (map.get("integrated_security") ?? "").toLowerCase(),
  );
  const user = map.get("user");
  const password = map.get("password") ?? "";
  const domain = map.get("domain");
  const authentication = (map.get("authentication") ?? "").toLowerCase();
  const accessToken = map.get("access_token");

  let auth: NormalizedConfig["auth"];
  if (authentication === "activedirectoryaccesstoken" && accessToken) {
    auth = { type: "azure_ad_token", token: accessToken };
  } else if (isWindows) {
    auth = { type: "windows" };
  } else if (domain && user) {
    auth = { type: "ntlm", username: user, password, domain };
  } else if (user) {
    auth = { type: "sql", username: user, password };
  } else {
    // No credentials — default to Windows on Windows, error on other platforms
    auth = { type: "windows" };
  }

  const minPool = parseInt(map.get("min_pool_size") ?? "") || undefined;
  const maxPool = parseInt(map.get("max_pool_size") ?? "") || undefined;

  return {
    ...DEFAULTS,
    server: host,
    port: port ?? DEFAULTS.port,
    instance_name: instance ?? DEFAULTS.instance_name,
    database: map.get("database") ?? DEFAULTS.database,
    auth,
    encrypt: parseBool(map.get("encrypt"), DEFAULTS.encrypt),
    trust_server_certificate: parseBool(
      map.get("trust_server_certificate"),
      DEFAULTS.trust_server_certificate,
    ),
    connect_timeout_ms: parseSeconds(
      map.get("connect_timeout"),
      DEFAULTS.connect_timeout_ms,
    ),
    request_timeout_ms: parseSeconds(
      map.get("request_timeout"),
      DEFAULTS.request_timeout_ms,
    ),
    app_name: map.get("app_name") ?? DEFAULTS.app_name,
    packet_size: parseInt(map.get("packet_size") ?? "") || DEFAULTS.packet_size,
    pool: (minPool !== undefined || maxPool !== undefined)
      ? { min: minPool, max: maxPool }
      : null,
  };
}

function splitAdoNet(s: string): [string, string][] {
  const pairs: [string, string][] = [];
  let i = 0;

  while (i < s.length) {
    // Find key
    const eqIdx = s.indexOf("=", i);
    if (eqIdx === -1) break;
    const key = s.substring(i, eqIdx).trim();
    i = eqIdx + 1;

    // Find value — handle quoted values
    let value: string;
    if (i < s.length && (s[i] === "'" || s[i] === '"')) {
      const quote = s[i];
      i++;
      const endQuote = s.indexOf(quote, i);
      if (endQuote === -1) {
        value = s.substring(i);
        i = s.length;
      } else {
        value = s.substring(i, endQuote);
        i = endQuote + 1;
        if (i < s.length && s[i] === ";") i++;
      }
    } else {
      const semi = s.indexOf(";", i);
      if (semi === -1) {
        value = s.substring(i).trim();
        i = s.length;
      } else {
        value = s.substring(i, semi).trim();
        i = semi + 1;
      }
    }

    if (key) pairs.push([key, value]);
  }

  return pairs;
}

function parseServerValue(
  raw: string,
): { host: string; port: number | null; instance: string | null } {
  // Strip "tcp:" prefix
  let s = raw.replace(/^tcp:/i, "");

  // host\instance
  const backslash = s.indexOf("\\");
  if (backslash !== -1) {
    return {
      host: s.substring(0, backslash),
      port: null,
      instance: s.substring(backslash + 1),
    };
  }

  // host,port
  const comma = s.indexOf(",");
  if (comma !== -1) {
    return {
      host: s.substring(0, comma),
      port: parseInt(s.substring(comma + 1)) || null,
      instance: null,
    };
  }

  return { host: s, port: null, instance: null };
}

// ── URL ─────────────────────────────────────────────────────

function parseUrl(urlStr: string): NormalizedConfig {
  // Replace mssql:// or sqlserver:// with a parseable scheme
  const normalized = urlStr.replace(/^(mssql|sqlserver):\/\//, "http://");
  const url = new URL(normalized);

  const params = url.searchParams;
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : "";
  const database = url.pathname.replace(/^\//, "") || DEFAULTS.database;
  const domain = params.get("domain") ?? undefined;
  const isWindows = parseBool(params.get("integratedSecurity"), false);
  const authentication = (params.get("authentication") ?? "").toLowerCase();
  const token = params.get("token") ?? undefined;

  let auth: NormalizedConfig["auth"];
  if (authentication === "azure-active-directory-access-token" && token) {
    auth = { type: "azure_ad_token", token };
  } else if (isWindows) {
    auth = { type: "windows" };
  } else if (domain && user) {
    auth = { type: "ntlm", username: user, password, domain };
  } else if (user) {
    auth = { type: "sql", username: user, password };
  } else {
    auth = { type: "windows" };
  }

  const minPool = parseInt(params.get("minPoolSize") ?? "") || undefined;
  const maxPool = parseInt(params.get("maxPoolSize") ?? "") || undefined;

  return {
    ...DEFAULTS,
    server: url.hostname || "localhost",
    port: url.port ? parseInt(url.port) : DEFAULTS.port,
    database,
    auth,
    encrypt: parseBool(params.get("encrypt"), DEFAULTS.encrypt),
    trust_server_certificate: parseBool(
      params.get("trustServerCertificate") ??
        params.get("trust_server_certificate"),
      DEFAULTS.trust_server_certificate,
    ),
    connect_timeout_ms: parseSeconds(
      params.get("connectTimeout"),
      DEFAULTS.connect_timeout_ms,
    ),
    request_timeout_ms: parseSeconds(
      params.get("requestTimeout"),
      DEFAULTS.request_timeout_ms,
    ),
    app_name: params.get("appName") ?? DEFAULTS.app_name,
    instance_name: params.get("instanceName") ?? DEFAULTS.instance_name,
    packet_size: parseInt(params.get("packetSize") ?? "") ||
      DEFAULTS.packet_size,
    pool: (minPool !== undefined || maxPool !== undefined)
      ? { min: minPool, max: maxPool }
      : null,
  };
}

// ── Config Object ───────────────────────────────────────────

function parseConfigObject(cfg: MssqlConfig): NormalizedConfig {
  const authCfg = cfg.authentication;
  const opts = cfg.options ?? {};

  let auth: NormalizedConfig["auth"];
  if (authCfg?.type === "windows") {
    auth = { type: "windows" };
  } else if (authCfg?.type === "ntlm") {
    auth = {
      type: "ntlm",
      username: authCfg.options?.userName ?? "",
      password: authCfg.options?.password ?? "",
      domain: authCfg.options?.domain ?? "",
    };
  } else if (authCfg?.type === "azure-active-directory-password") {
    auth = {
      type: "azure_ad",
      username: authCfg.options?.userName ?? "",
      password: authCfg.options?.password ?? "",
    };
  } else if (authCfg?.type === "azure-active-directory-access-token") {
    const token = authCfg.options?.token;
    if (!token) {
      throw new Error(
        "azure-active-directory-access-token requires options.token",
      );
    }
    auth = { type: "azure_ad_token", token };
  } else if (
    authCfg?.type === "azure-active-directory-default" ||
    authCfg?.type === "azure-active-directory-service-principal-secret"
  ) {
    // Token will be resolved by entry points via token_provider before FFI serialization.
    // Use a placeholder that will be replaced.
    auth = { type: "azure_ad_token", token: "" };
  } else if (authCfg?.options?.userName) {
    auth = {
      type: "sql",
      username: authCfg.options.userName,
      password: authCfg.options?.password ?? "",
    };
  } else {
    auth = { type: "windows" };
  }

  const result: NormalizedConfig = {
    ...DEFAULTS,
    server: cfg.server,
    port: cfg.port ?? DEFAULTS.port,
    database: cfg.database ?? DEFAULTS.database,
    auth,
    encrypt: opts.encrypt ?? DEFAULTS.encrypt,
    trust_server_certificate: opts.trustServerCertificate ??
      DEFAULTS.trust_server_certificate,
    connect_timeout_ms: opts.connectTimeout ?? DEFAULTS.connect_timeout_ms,
    request_timeout_ms: opts.requestTimeout ?? DEFAULTS.request_timeout_ms,
    app_name: opts.appName ?? DEFAULTS.app_name,
    instance_name: opts.instanceName ?? DEFAULTS.instance_name,
    packet_size: opts.packetSize ?? DEFAULTS.packet_size,
    pool: cfg.pool
      ? {
        min: cfg.pool.min,
        max: cfg.pool.max,
        idle_timeout_ms: cfg.pool.idleTimeoutMillis,
      }
      : null,
  };

  if (cfg.tokenProvider) {
    result.token_provider = cfg.tokenProvider;
  }

  return result;
}

// ── Token Provider Resolution ────────────────────────────────

/**
 * Resolve the token_provider callback on a NormalizedConfig, replacing the
 * auth with an azure_ad_token variant containing the resolved token.
 * Call this in entry points (createPool/connect) before JSON serialization.
 */
export async function resolveTokenProvider(
  config: NormalizedConfig,
): Promise<void> {
  if (config.token_provider) {
    const token = await config.token_provider();
    config.auth = { type: "azure_ad_token", token };
    delete config.token_provider;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function parseBool(val: string | null | undefined, fallback: boolean): boolean {
  if (val === null || val === undefined) return fallback;
  return ["true", "yes", "1"].includes(val.toLowerCase());
}

function parseSeconds(
  val: string | null | undefined,
  fallbackMs: number,
): number {
  if (val === null || val === undefined) return fallbackMs;
  const n = parseInt(val);
  if (isNaN(n)) return fallbackMs;
  return n > 1000 ? n : n * 1000; // If > 1000, assume ms; otherwise seconds
}

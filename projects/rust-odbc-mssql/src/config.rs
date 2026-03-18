use serde::Deserialize;

use crate::error::{MssqlError, Result};

/// JSON config sent from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct NormalizedConfig {
    pub server: String,
    pub port: u16,
    pub database: String,
    pub auth: AuthConfig,
    pub encrypt: bool,
    pub trust_server_certificate: bool,
    pub connect_timeout_ms: u64,
    pub request_timeout_ms: u64,
    pub app_name: String,
    pub instance_name: Option<String>,
    pub packet_size: u16,
    pub pool: Option<PoolConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum AuthConfig {
    #[serde(rename = "sql")]
    Sql { username: String, password: String },
    #[serde(rename = "ntlm")]
    Ntlm {
        username: String,
        password: String,
        domain: String,
    },
    #[serde(rename = "windows")]
    Windows,
    #[serde(rename = "azure_ad")]
    AzureAd { username: String, password: String },
    #[serde(rename = "azure_ad_token")]
    AzureAdToken { token: String },
}

#[derive(Debug, Deserialize, Clone)]
pub struct PoolConfig {
    pub min: Option<u32>,
    pub max: Option<u32>,
    pub idle_timeout_ms: Option<u64>,
}

/// Detect which ODBC driver is available on the system.
fn detect_odbc_driver() -> Result<&'static str> {
    // Try drivers in order of preference
    let candidates = [
        "ODBC Driver 18 for SQL Server",
        "ODBC Driver 17 for SQL Server",
    ];
    let env = crate::handle::odbc_env();
    if let Ok(drivers) = env.drivers() {
        for candidate in &candidates {
            if drivers.iter().any(|d| d.description == *candidate) {
                return Ok(match *candidate {
                    "ODBC Driver 18 for SQL Server" => "ODBC Driver 18 for SQL Server",
                    _ => "ODBC Driver 17 for SQL Server",
                });
            }
        }
    }
    // Fallback: try 18 and let ODBC produce the error if missing
    Ok("ODBC Driver 18 for SQL Server")
}

impl NormalizedConfig {
    /// Parse from a JSON string sent over FFI.
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json)
            .map_err(|e| MssqlError::Config(format!("Invalid config JSON: {e}")))
    }

    /// Build an ODBC connection string from the normalized config.
    pub fn to_odbc_connection_string(&self) -> Result<String> {
        let driver = detect_odbc_driver()?;
        let mut parts: Vec<String> = Vec::with_capacity(16);

        parts.push(format!("DRIVER={{{driver}}}"));

        // Server: host,port or host\instance
        if let Some(ref instance) = self.instance_name {
            parts.push(format!("SERVER={}\\{}", self.server, instance));
        } else {
            parts.push(format!("SERVER={},{}", self.server, self.port));
        }

        if !self.database.is_empty() {
            parts.push(format!("DATABASE={}", self.database));
        }

        // Auth
        match &self.auth {
            AuthConfig::Sql { username, password } => {
                parts.push(format!("UID={username}"));
                parts.push(format!("PWD={password}"));
            }
            AuthConfig::Ntlm {
                username,
                password,
                domain,
            } => {
                parts.push(format!("UID={domain}\\{username}"));
                parts.push(format!("PWD={password}"));
            }
            AuthConfig::Windows => {
                parts.push("Trusted_Connection=yes".to_string());
            }
            AuthConfig::AzureAd { username, password } => {
                parts.push("Authentication=ActiveDirectoryPassword".to_string());
                parts.push(format!("UID={username}"));
                parts.push(format!("PWD={password}"));
            }
            AuthConfig::AzureAdToken { token } => {
                // For token auth we set UID empty and handle via connection attribute
                // The token will be set separately via SQL_COPT_SS_ACCESS_TOKEN
                // For ODBC Driver 18+, we can use the connection string directly
                parts.push(format!("AccessToken={token}"));
            }
        }

        // Encryption
        if self.encrypt {
            parts.push("Encrypt=yes".to_string());
        } else {
            parts.push("Encrypt=no".to_string());
        }

        if self.trust_server_certificate {
            parts.push("TrustServerCertificate=yes".to_string());
        }

        // Timeouts (ODBC uses seconds)
        let connect_timeout_secs = (self.connect_timeout_ms / 1000).max(1);
        parts.push(format!("Connection Timeout={connect_timeout_secs}"));

        // Command timeout is set per-statement, not in connection string

        if !self.app_name.is_empty() {
            parts.push(format!("Application Name={}", self.app_name));
        }

        if self.packet_size > 0 {
            parts.push(format!("Packet Size={}", self.packet_size));
        }

        Ok(parts.join(";") + ";")
    }

    /// Canonical identity key for pool deduplication.
    /// Excludes pool-tuning params (min/max/idle_timeout) and timeouts.
    pub fn dedup_key(&self) -> String {
        let auth_key = match &self.auth {
            AuthConfig::Sql { username, .. } => format!("sql|{}", username),
            AuthConfig::Ntlm {
                username, domain, ..
            } => format!("ntlm|{}|{}", domain, username),
            AuthConfig::Windows => "windows".into(),
            AuthConfig::AzureAd { username, .. } => format!("azure_ad|{}", username),
            AuthConfig::AzureAdToken { .. } => "azure_ad_token".into(),
        };
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}",
            self.server.to_lowercase(),
            self.port,
            self.database.to_lowercase(),
            auth_key,
            self.encrypt,
            self.trust_server_certificate,
            self.instance_name
                .as_deref()
                .unwrap_or("")
                .to_lowercase(),
            self.app_name,
            self.packet_size,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sql_auth() {
        let json = r#"{
            "server": "localhost",
            "port": 1433,
            "database": "master",
            "auth": {"type": "sql", "username": "sa", "password": "secret"},
            "encrypt": true,
            "trust_server_certificate": true,
            "connect_timeout_ms": 15000,
            "request_timeout_ms": 30000,
            "app_name": "test",
            "instance_name": null,
            "packet_size": 4096,
            "pool": null
        }"#;
        let cfg = NormalizedConfig::from_json(json).unwrap();
        assert_eq!(cfg.server, "localhost");
        assert_eq!(cfg.port, 1433);
    }

    #[test]
    fn parse_with_pool() {
        let json = r#"{
            "server": "localhost",
            "port": 1433,
            "database": "test",
            "auth": {"type": "sql", "username": "sa", "password": "pw"},
            "encrypt": false,
            "trust_server_certificate": false,
            "connect_timeout_ms": 5000,
            "request_timeout_ms": 10000,
            "app_name": "app",
            "instance_name": null,
            "packet_size": 4096,
            "pool": {"min": 2, "max": 10, "idle_timeout_ms": 60000}
        }"#;
        let cfg = NormalizedConfig::from_json(json).unwrap();
        assert!(cfg.pool.is_some());
        let pool = cfg.pool.unwrap();
        assert_eq!(pool.min, Some(2));
        assert_eq!(pool.max, Some(10));
    }

    #[test]
    fn parse_azure_ad_token() {
        let json = r#"{
            "server": "myserver.database.windows.net",
            "port": 1433,
            "database": "mydb",
            "auth": {"type": "azure_ad_token", "token": "eyJ..."},
            "encrypt": true,
            "trust_server_certificate": false,
            "connect_timeout_ms": 15000,
            "request_timeout_ms": 30000,
            "app_name": "test",
            "instance_name": null,
            "packet_size": 4096,
            "pool": null
        }"#;
        let cfg = NormalizedConfig::from_json(json).unwrap();
        assert!(matches!(cfg.auth, AuthConfig::AzureAdToken { .. }));
    }

    #[test]
    fn invalid_json_returns_error() {
        let result = NormalizedConfig::from_json("not json");
        assert!(result.is_err());
    }

    fn make_config(
        server: &str,
        database: &str,
        pool_min: Option<u32>,
        pool_max: Option<u32>,
    ) -> NormalizedConfig {
        NormalizedConfig {
            server: server.to_string(),
            port: 1433,
            database: database.to_string(),
            auth: AuthConfig::Sql {
                username: "sa".to_string(),
                password: "secret".to_string(),
            },
            encrypt: true,
            trust_server_certificate: true,
            connect_timeout_ms: 15000,
            request_timeout_ms: 15000,
            app_name: "@tsdrivers/mssql".to_string(),
            instance_name: None,
            packet_size: 4096,
            pool: Some(PoolConfig {
                min: pool_min,
                max: pool_max,
                idle_timeout_ms: None,
            }),
        }
    }

    #[test]
    fn dedup_key_same_config() {
        let a = make_config("localhost", "mydb", Some(2), Some(10));
        let b = make_config("localhost", "mydb", Some(2), Some(10));
        assert_eq!(a.dedup_key(), b.dedup_key());
    }

    #[test]
    fn dedup_key_different_server() {
        let a = make_config("host1", "mydb", Some(2), Some(10));
        let b = make_config("host2", "mydb", Some(2), Some(10));
        assert_ne!(a.dedup_key(), b.dedup_key());
    }

    #[test]
    fn dedup_key_different_pool_same_key() {
        let a = make_config("localhost", "mydb", Some(1), Some(5));
        let b = make_config("localhost", "mydb", Some(5), Some(50));
        assert_eq!(a.dedup_key(), b.dedup_key());
    }

    #[test]
    fn dedup_key_case_insensitive_server() {
        let a = make_config("MyServer", "mydb", None, None);
        let b = make_config("myserver", "mydb", None, None);
        assert_eq!(a.dedup_key(), b.dedup_key());
    }
}

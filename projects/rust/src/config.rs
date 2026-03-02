use mssql_client::{Config, Credentials};
use serde::Deserialize;
use std::time::Duration;

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

impl NormalizedConfig {
    /// Parse from a JSON string sent over FFI.
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| MssqlError::Config(format!("Invalid config JSON: {e}")))
    }

    /// Convert to an mssql-client Config.
    pub fn to_client_config(&self) -> Result<Config> {
        let credentials = match &self.auth {
            AuthConfig::Sql { username, password } => {
                Credentials::sql_server(username.clone(), password.clone())
            }
            AuthConfig::Ntlm {
                username,
                password,
                domain,
            } => {
                // mssql-client uses domain\username format for NTLM
                let full_user = format!("{domain}\\{username}");
                Credentials::sql_server(full_user, password.clone())
            }
            AuthConfig::Windows => {
                #[cfg(not(windows))]
                return Err(MssqlError::Config(
                    "Windows authentication is only available on Windows".into(),
                ));
                #[cfg(windows)]
                {
                    return Err(MssqlError::Config(
                        "Windows authentication not yet supported in mssql-client driver".into(),
                    ));
                }
            }
            AuthConfig::AzureAd { username, password } => {
                // Azure AD password auth maps to SQL auth for now
                Credentials::sql_server(username.clone(), password.clone())
            }
            AuthConfig::AzureAdToken { token } => {
                Credentials::azure_token(token.clone())
            }
        };

        let mut config = Config::new()
            .host(&self.server)
            .port(self.port)
            .credentials(credentials)
            .connect_timeout(Duration::from_millis(self.connect_timeout_ms))
            .application_name(&self.app_name)
            .trust_server_certificate(self.trust_server_certificate)
            .encrypt(self.encrypt);

        // Set command timeout via field (no builder method)
        config.command_timeout = Duration::from_millis(self.request_timeout_ms);

        if !self.database.is_empty() {
            config = config.database(&self.database);
        }

        if let Some(ref instance) = self.instance_name {
            config.instance = Some(instance.clone());
        }

        if self.packet_size > 0 {
            config.packet_size = self.packet_size;
        }

        Ok(config)
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

    /// Build a pool config from the normalized config.
    pub fn to_pool_config(&self) -> mssql_driver_pool::PoolConfig {
        let mut pc = mssql_driver_pool::PoolConfig::default();
        if let Some(ref pool) = self.pool {
            if let Some(min) = pool.min {
                pc.min_connections = min;
            }
            if let Some(max) = pool.max {
                pc.max_connections = max;
            }
            if let Some(idle_ms) = pool.idle_timeout_ms {
                pc.idle_timeout = Duration::from_millis(idle_ms);
            }
        }
        pc.connection_timeout = Duration::from_millis(self.connect_timeout_ms);
        pc
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
        let client_cfg = cfg.to_client_config().unwrap();
        assert_eq!(client_cfg.host, "localhost");
        assert_eq!(client_cfg.port, 1433);
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
        let pool_cfg = cfg.to_pool_config();
        assert_eq!(pool_cfg.min_connections, 2);
        assert_eq!(pool_cfg.max_connections, 10);
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
        let _client_cfg = cfg.to_client_config().unwrap();
    }

    #[test]
    fn invalid_json_returns_error() {
        let result = NormalizedConfig::from_json("not json");
        assert!(result.is_err());
    }

    fn make_config(server: &str, database: &str, pool_min: Option<u32>, pool_max: Option<u32>) -> NormalizedConfig {
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
            app_name: "@tracker1/mssql".to_string(),
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

use std::fmt;

/// Error types for the mssqlts FFI layer.
pub enum MssqlError {
    Config(String),
    Connection(String),
    Query(String),
    Transaction(String),
    Pool(String),
    Cancelled,
}

impl fmt::Display for MssqlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MssqlError::Config(msg) => write!(f, "Config error: {msg}"),
            MssqlError::Connection(msg) => write!(f, "Connection error: {msg}"),
            MssqlError::Query(msg) => write!(f, "Query error: {msg}"),
            MssqlError::Transaction(msg) => write!(f, "Transaction error: {msg}"),
            MssqlError::Pool(msg) => write!(f, "Pool error: {msg}"),
            MssqlError::Cancelled => write!(f, "Operation cancelled"),
        }
    }
}

impl fmt::Debug for MssqlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl std::error::Error for MssqlError {}

impl From<mssql_client::Error> for MssqlError {
    fn from(e: mssql_client::Error) -> Self {
        match e {
            mssql_client::Error::Config(msg) => MssqlError::Config(msg),
            mssql_client::Error::Connection(msg) => MssqlError::Connection(msg),
            mssql_client::Error::ConnectionClosed => {
                MssqlError::Connection("Connection closed".into())
            }
            mssql_client::Error::ConnectTimeout
            | mssql_client::Error::ConnectionTimeout
            | mssql_client::Error::TlsTimeout => {
                MssqlError::Connection("Connection timeout".into())
            }
            mssql_client::Error::CommandTimeout => {
                MssqlError::Query("Command timeout".into())
            }
            mssql_client::Error::Query(msg) => MssqlError::Query(msg),
            mssql_client::Error::Transaction(msg) => MssqlError::Transaction(msg),
            mssql_client::Error::Server {
                number,
                message,
                class,
                ..
            } => MssqlError::Query(format!(
                "SQL Server error {number} (severity {class}): {message}"
            )),
            mssql_client::Error::Authentication(e) => {
                MssqlError::Connection(format!("Authentication error: {e}"))
            }
            mssql_client::Error::Cancelled => MssqlError::Cancelled,
            other => MssqlError::Query(format!("{other}")),
        }
    }
}

impl From<mssql_driver_pool::PoolError> for MssqlError {
    fn from(e: mssql_driver_pool::PoolError) -> Self {
        use mssql_driver_pool::PoolError;
        match e {
            PoolError::Timeout => {
                MssqlError::Pool("Connection timeout: pool exhausted".into())
            }
            PoolError::AcquisitionTimeout(d) => MssqlError::Pool(format!(
                "Connection timeout after {}ms: pool exhausted",
                d.as_millis()
            )),
            PoolError::PoolClosed => MssqlError::Pool("Pool is closed".into()),
            PoolError::MaxConnectionsReached { max } => MssqlError::Pool(format!(
                "Pool exhausted: maximum connections ({max}) reached"
            )),
            PoolError::ConnectionCreation(msg) => {
                MssqlError::Pool(format!("Could not establish connection: {msg}"))
            }
            PoolError::Connection(msg) => {
                MssqlError::Pool(format!("Connection error: {msg}"))
            }
            PoolError::UnhealthyConnection(msg) => {
                MssqlError::Pool(format!("Connection health check failed: {msg}"))
            }
            PoolError::ResetFailed(msg) => {
                MssqlError::Pool(format!("Connection reset failed: {msg}"))
            }
            PoolError::Configuration(msg) => {
                MssqlError::Pool(format!("Pool configuration error: {msg}"))
            }
            PoolError::ValidationFailed(msg) => {
                MssqlError::Pool(format!("Connection validation failed: {msg}"))
            }
        }
    }
}

pub type Result<T> = std::result::Result<T, MssqlError>;

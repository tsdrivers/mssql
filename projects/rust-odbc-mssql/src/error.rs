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

impl From<odbc_api::Error> for MssqlError {
    fn from(e: odbc_api::Error) -> Self {
        match &e {
            odbc_api::Error::Diagnostics { record, function } => {
                let state = std::str::from_utf8(&record.state.0).unwrap_or("?????");
                let message = String::from_utf16_lossy(&record.message);
                let msg = format!(
                    "ODBC error in {}: [{}] {}",
                    function, state, message
                );
                // Classify by SQLSTATE prefix
                if state.starts_with("08") || state.starts_with("28") {
                    MssqlError::Connection(msg)
                } else if state == "HYT00" || state == "HYT01" {
                    MssqlError::Connection(msg)
                } else {
                    MssqlError::Query(msg)
                }
            }
            _ => MssqlError::Query(format!("ODBC error: {e}")),
        }
    }
}

pub type Result<T> = std::result::Result<T, MssqlError>;

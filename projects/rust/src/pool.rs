use mssql_client::{Client, Ready};
use mssql_driver_pool::Pool;

use crate::config::NormalizedConfig;
use crate::debug::debug_log;
use crate::error::{MssqlError, Result};

/// Create a connection pool from the normalized config.
pub async fn create_pool(config: &NormalizedConfig) -> Result<Pool> {
    let client_config = config.to_client_config()?;
    let pool_config = config.to_pool_config();

    debug_log!(
        "Creating pool: min={}, max={}, timeout={}ms",
        pool_config.min_connections,
        pool_config.max_connections,
        pool_config.connection_timeout.as_millis()
    );

    let pool = Pool::new(pool_config, client_config).await?;
    debug_log!("Pool created successfully");
    Ok(pool)
}

/// Create a single (non-pooled) connection.
pub async fn create_single(config: &NormalizedConfig) -> Result<Client<Ready>> {
    let client_config = config.to_client_config()?;

    debug_log!("Creating bare connection to {}:{}", config.server, config.port);

    let client = Client::connect(client_config)
        .await
        .map_err(MssqlError::from)?;

    debug_log!("Bare connection established");
    Ok(client)
}

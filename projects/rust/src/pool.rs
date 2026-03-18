use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use odbc_api::Connection;

use crate::config::NormalizedConfig;
use crate::debug::debug_log;
use crate::error::{MssqlError, Result};
use crate::handle;

/// Pool status for diagnostics.
pub struct PoolStatus {
    pub total: u32,
    pub idle: u32,
    pub in_use: u32,
    pub max: u32,
}

/// Simple ODBC connection pool.
///
/// Manages a queue of idle connections with min/max/idle_timeout semantics.
/// Connections are created on demand up to `max_connections`.
#[allow(dead_code)]
pub struct OdbcPool {
    conn_string: String,
    idle: Mutex<VecDeque<Connection<'static>>>,
    max_connections: u32,
    min_connections: u32,
    idle_timeout: Duration,
    connect_timeout: Duration,
    /// Number of connections currently checked out (in use).
    in_use: AtomicU32,
    /// Total connections created and alive (idle + in_use).
    total: AtomicU32,
    /// Command timeout in seconds (set on each statement).
    pub command_timeout_secs: u32,
}

impl OdbcPool {
    /// Create a new pool. Pre-fills `min_connections` connections.
    pub fn new(config: &NormalizedConfig) -> Result<Self> {
        let conn_string = config.to_odbc_connection_string()?;
        let (min, max) = if let Some(ref pool) = config.pool {
            (pool.min.unwrap_or(1), pool.max.unwrap_or(10))
        } else {
            (1, 10)
        };
        let idle_timeout = config
            .pool
            .as_ref()
            .and_then(|p| p.idle_timeout_ms)
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_secs(600));
        let connect_timeout = Duration::from_millis(config.connect_timeout_ms);
        let command_timeout_secs = (config.request_timeout_ms / 1000).max(1) as u32;

        let pool = Self {
            conn_string,
            idle: Mutex::new(VecDeque::with_capacity(max as usize)),
            max_connections: max,
            min_connections: min,
            idle_timeout,
            connect_timeout,
            in_use: AtomicU32::new(0),
            total: AtomicU32::new(0),
            command_timeout_secs,
        };

        debug_log!(
            "Creating pool: min={}, max={}, timeout={}ms",
            min,
            max,
            connect_timeout.as_millis()
        );

        // Pre-fill minimum connections
        let mut queue = pool.idle.lock().unwrap();
        for _ in 0..min {
            match pool.create_connection() {
                Ok(conn) => {
                    pool.total.fetch_add(1, Ordering::SeqCst);
                    queue.push_back(conn);
                }
                Err(e) => {
                    debug_log!("Pool pre-fill connection failed: {e}");
                    // Non-fatal: pool can grow on demand
                    break;
                }
            }
        }
        drop(queue);

        debug_log!("Pool created successfully");
        Ok(pool)
    }

    /// Create a new ODBC connection using the pool's connection string.
    fn create_connection(&self) -> Result<Connection<'static>> {
        let env = handle::odbc_env();
        env.connect_with_connection_string(&self.conn_string, Default::default())
            .map_err(MssqlError::from)
    }

    /// Get a connection from the pool (take from idle or create new).
    pub fn get(&self) -> Result<Connection<'static>> {
        // Try idle queue first
        {
            let mut queue = self.idle.lock().unwrap();
            if let Some(conn) = queue.pop_front() {
                self.in_use.fetch_add(1, Ordering::SeqCst);
                return Ok(conn);
            }
        }

        // Create new if under max
        let current_total = self.total.load(Ordering::SeqCst);
        if current_total >= self.max_connections {
            return Err(MssqlError::Pool(format!(
                "Connection timeout: pool exhausted (max {} connections)",
                self.max_connections
            )));
        }

        let conn = self.create_connection()?;
        self.total.fetch_add(1, Ordering::SeqCst);
        self.in_use.fetch_add(1, Ordering::SeqCst);
        Ok(conn)
    }

    /// Return a connection to the pool's idle queue.
    pub fn put(&self, conn: Connection<'static>) {
        self.in_use.fetch_sub(1, Ordering::SeqCst);
        let mut queue = self.idle.lock().unwrap();
        if queue.len() < self.max_connections as usize {
            queue.push_back(conn);
        } else {
            // Over capacity — drop the connection
            self.total.fetch_sub(1, Ordering::SeqCst);
            drop(conn);
        }
    }

    /// Drop a connection without returning it to the pool (eviction).
    #[allow(dead_code)]
    pub fn evict(&self) {
        self.in_use.fetch_sub(1, Ordering::SeqCst);
        self.total.fetch_sub(1, Ordering::SeqCst);
    }

    /// Get pool status for diagnostics.
    pub fn status(&self) -> PoolStatus {
        let idle = self.idle.lock().unwrap().len() as u32;
        PoolStatus {
            total: self.total.load(Ordering::SeqCst),
            idle,
            in_use: self.in_use.load(Ordering::SeqCst),
            max: self.max_connections,
        }
    }
}

/// Create a single (non-pooled) ODBC connection.
pub fn create_single(config: &NormalizedConfig) -> Result<Connection<'static>> {
    let conn_string = config.to_odbc_connection_string()?;
    debug_log!(
        "Creating bare connection to {}:{}",
        config.server,
        config.port
    );

    let env = handle::odbc_env();
    let conn = env
        .connect_with_connection_string(&conn_string, Default::default())
        .map_err(MssqlError::from)?;

    debug_log!("Bare connection established");
    Ok(conn)
}

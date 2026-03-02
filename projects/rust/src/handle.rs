use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use lazy_static::lazy_static;
use mssql_client::{Client, Ready};
use mssql_driver_pool::{Pool, PooledConnection};

use crate::config::NormalizedConfig;
use crate::error::{MssqlError, Result};

// ── Handle ID counters ────────────────────────────────────────

static NEXT_POOL_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);

fn next_pool_id() -> u64 {
    NEXT_POOL_ID.fetch_add(1, Ordering::SeqCst)
}

fn next_conn_id() -> u64 {
    NEXT_CONN_ID.fetch_add(1, Ordering::SeqCst)
}

// ── Global handle maps ───────────────────────────────────────

lazy_static! {
    static ref POOLS: Mutex<HashMap<u64, Arc<PoolHandle>>> = Mutex::new(HashMap::new());
    static ref CONNS: Mutex<HashMap<u64, Arc<ConnHandle>>> = Mutex::new(HashMap::new());
    /// Maps dedup_key → pool_id for pool deduplication.
    static ref POOL_DEDUP: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
}

// ── Pool handle ──────────────────────────────────────────────

/// The pool holds an mssql-driver-pool Pool plus the original config
/// for creating bare (non-pooled) connections.
pub struct PoolHandle {
    pub pool: Pool,
    pub last_error: Mutex<Option<String>>,
    pub ref_count: AtomicU32,
    pub dedup_key: String,
}

// ── Connection handle ────────────────────────────────────────

/// A connection wraps either a pooled or bare mssql-client Client.
/// The client is stored behind Option so it can be temporarily taken
/// out during async operations.
pub struct ConnHandle {
    pub client: Mutex<Option<MssqlClient>>,
    pub pool_id: Option<u64>,
    pub last_error: Mutex<Option<String>>,
    pub active_transaction: Mutex<Option<String>>,
}

/// Either a pool-managed connection or a standalone one.
pub enum MssqlClient {
    Pooled(Box<PooledConnection>),
    Bare(Box<Client<Ready>>),
}

impl MssqlClient {
    /// Get a mutable reference to the underlying Client<Ready>.
    pub fn as_client_mut(&mut self) -> Option<&mut Client<Ready>> {
        match self {
            MssqlClient::Pooled(pc) => pc.client_mut(),
            MssqlClient::Bare(c) => Some(c.as_mut()),
        }
    }
}

// ── Pool operations ──────────────────────────────────────────

/// Store a pool, returning its handle ID. If a pool with the same dedup key
/// already exists, the existing pool's refcount is incremented and its ID is
/// returned (the new Pool is dropped).
pub fn store_pool(pool: Pool, config: NormalizedConfig) -> u64 {
    let key = config.dedup_key();
    let mut dedup = POOL_DEDUP.lock().unwrap();
    let mut pools = POOLS.lock().unwrap();

    // Check for existing pool with same identity
    if let Some(&existing_id) = dedup.get(&key) {
        if let Some(existing) = pools.get(&existing_id) {
            existing.ref_count.fetch_add(1, Ordering::SeqCst);
            return existing_id;
        }
        // Stale entry — remove it and fall through to create new
        dedup.remove(&key);
    }

    let id = next_pool_id();
    let handle = Arc::new(PoolHandle {
        pool,
        last_error: Mutex::new(None),
        ref_count: AtomicU32::new(1),
        dedup_key: key.clone(),
    });
    pools.insert(id, handle);
    dedup.insert(key, id);
    id
}

pub fn get_pool(id: u64) -> Result<Arc<PoolHandle>> {
    POOLS
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| MssqlError::Pool(format!("Pool {id} not found")))
}

/// Decrement the pool's refcount. Only removes from the map when refcount
/// reaches 0.
pub fn remove_pool(id: u64) -> Option<Arc<PoolHandle>> {
    let mut pools = POOLS.lock().unwrap();
    if let Some(handle) = pools.get(&id) {
        let prev = handle.ref_count.fetch_sub(1, Ordering::SeqCst);
        if prev <= 1 {
            // Refcount hit 0 — actually remove
            let removed = pools.remove(&id);
            if let Some(ref h) = removed {
                POOL_DEDUP.lock().unwrap().remove(&h.dedup_key);
            }
            return removed;
        }
        // Refcount still positive — pool stays alive
        return None;
    }
    None
}

/// Remove all pools and clear the dedup registry.
pub fn remove_all_pools() {
    POOLS.lock().unwrap().clear();
    POOL_DEDUP.lock().unwrap().clear();
}

// ── Connection operations ────────────────────────────────────

pub fn store_conn(client: MssqlClient, pool_id: Option<u64>) -> u64 {
    let id = next_conn_id();
    let handle = Arc::new(ConnHandle {
        client: Mutex::new(Some(client)),
        pool_id,
        last_error: Mutex::new(None),
        active_transaction: Mutex::new(None),
    });
    CONNS.lock().unwrap().insert(id, handle);
    id
}

pub fn get_conn(id: u64) -> Result<Arc<ConnHandle>> {
    CONNS
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| MssqlError::Connection(format!("Connection {id} not found")))
}

pub fn remove_conn(id: u64) -> Option<Arc<ConnHandle>> {
    CONNS.lock().unwrap().remove(&id)
}

/// Remove all connections.
pub fn remove_all_conns() {
    CONNS.lock().unwrap().clear();
}

// ── Error helpers ────────────────────────────────────────────

impl ConnHandle {
    pub fn set_error(&self, msg: String) {
        *self.last_error.lock().unwrap() = Some(msg);
    }
}

impl PoolHandle {
    pub fn set_error(&self, msg: String) {
        *self.last_error.lock().unwrap() = Some(msg);
    }
}

// ── Diagnostics ──────────────────────────────────────────────

/// Snapshot of all pools and connections for diagnostics.
pub fn diagnostic_snapshot() -> serde_json::Value {
    let pools = POOLS.lock().unwrap();
    let conns = CONNS.lock().unwrap();

    let pool_info: Vec<serde_json::Value> = pools
        .iter()
        .map(|(id, handle)| {
            let status = handle.pool.status();
            serde_json::json!({
                "id": id,
                "total": status.total,
                "idle": status.available,
                "in_use": status.in_use,
                "max": status.max,
                "ref_count": handle.ref_count.load(Ordering::SeqCst),
            })
        })
        .collect();

    let conn_info: Vec<serde_json::Value> = conns
        .iter()
        .map(|(id, handle)| {
            let has_tx = handle
                .active_transaction
                .lock()
                .unwrap()
                .is_some();
            let is_pooled = handle.pool_id.is_some();
            serde_json::json!({
                "id": id,
                "pool_id": handle.pool_id,
                "is_pooled": is_pooled,
                "has_active_transaction": has_tx,
            })
        })
        .collect();

    serde_json::json!({
        "pools": pool_info,
        "connections": conn_info,
    })
}

// All public functions in this crate are #[no_mangle] extern "C" FFI entry points.
// Raw pointer parameters (*const c_char) are provided by the JS runtime via FFI
// and are always valid null-terminated C strings. The unsafe dereference in
// read_cstr() is the standard pattern for receiving strings across FFI boundaries.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

mod bulk;
mod config;
mod debug;
mod error;
mod filestream;
mod handle;
mod pool;
mod query;
mod stream;

use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use serde::Deserialize;
use tokio::runtime::Runtime;

use config::NormalizedConfig;
use error::MssqlError;
use handle::MssqlClient;
use query::SerializedCommand;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn rt() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        debug::init();
        debug::debug_log!("Tokio runtime initialized");
        Runtime::new().expect("Failed to create tokio runtime")
    })
}

unsafe fn read_cstr<'a>(ptr: *const c_char) -> &'a str {
    CStr::from_ptr(ptr).to_str().unwrap_or("")
}

fn to_cstring(s: &str) -> *mut c_char {
    CString::new(s).unwrap_or_default().into_raw()
}

// ── Cursor / FILESTREAM storage ───────────────────────────────

static NEXT_CURSOR_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_FS_ID: AtomicU64 = AtomicU64::new(1);

lazy_static::lazy_static! {
    static ref CURSORS: std::sync::Mutex<HashMap<u64, stream::RowCursor>> =
        std::sync::Mutex::new(HashMap::new());
    static ref FS_HANDLES: std::sync::Mutex<HashMap<u64, filestream::FilestreamHandle>> =
        std::sync::Mutex::new(HashMap::new());
}

// ══════════════════════════════════════════════════════════════
// Pool FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_pool_create(config_json: *const c_char) -> u64 {
    let json = unsafe { read_cstr(config_json) };
    let result = rt().block_on(async {
        let config = NormalizedConfig::from_json(json)?;
        debug::debug_log!(
            "Creating pool for {}:{}",
            config.server,
            config.port
        );
        let pool = pool::create_pool(&config).await?;
        Ok::<_, MssqlError>(handle::store_pool(pool, config))
    });
    match result {
        Ok(id) => {
            debug::debug_log!("Pool created: id={}", id);
            id
        }
        Err(e) => {
            eprintln!("[@tracker1/mssql] Pool creation failed: {e}");
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_pool_acquire(pool_id: u64) -> u64 {
    let result = rt().block_on(async {
        let pool_handle = handle::get_pool(pool_id)?;
        debug::debug_log!("Acquiring connection from pool {}", pool_id);

        let pooled_conn = pool_handle
            .pool
            .get()
            .await
            .map_err(MssqlError::from)?;

        let client = MssqlClient::Pooled(Box::new(pooled_conn));
        Ok::<_, MssqlError>(handle::store_conn(client, Some(pool_id)))
    });
    match result {
        Ok(id) => {
            debug::debug_log!("Pool {} acquired connection {}", pool_id, id);
            id
        }
        Err(e) => {
            if let Ok(ph) = handle::get_pool(pool_id) {
                ph.set_error(e.to_string());
            }
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_pool_release(pool_id: u64, conn_id: u64) {
    debug::debug_log!(
        "Releasing connection {} back to pool {}",
        conn_id,
        pool_id
    );
    // Remove the connection handle — the PooledConnection's Drop impl
    // automatically returns it to the pool.
    handle::remove_conn(conn_id);
}

#[no_mangle]
pub extern "C" fn mssql_pool_close(pool_id: u64) {
    debug::debug_log!("Closing pool {}", pool_id);
    handle::remove_pool(pool_id);
}

// ══════════════════════════════════════════════════════════════
// Connection FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_connect(config_json: *const c_char) -> u64 {
    let json = unsafe { read_cstr(config_json) };
    let result = rt().block_on(async {
        let config = NormalizedConfig::from_json(json)?;
        debug::debug_log!(
            "Connecting to {}:{}",
            config.server,
            config.port
        );
        let client = pool::create_single(&config).await?;
        Ok::<_, MssqlError>(handle::store_conn(
            MssqlClient::Bare(Box::new(client)),
            None,
        ))
    });
    match result {
        Ok(id) => {
            debug::debug_log!("Connection established: id={}", id);
            id
        }
        Err(e) => {
            eprintln!("[@tracker1/mssql] Connection failed: {e}");
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_disconnect(conn_id: u64) {
    debug::debug_log!("Disconnecting connection {}", conn_id);
    handle::remove_conn(conn_id);
}

// ══════════════════════════════════════════════════════════════
// Query FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_query(conn_id: u64, cmd_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(cmd_json) };
    let result = rt().block_on(async {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!("Query on conn {}: {}", conn_id, &cmd.sql[..cmd.sql.len().min(100)]);
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => query::execute_query(client, &cmd).await,
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result
    });
    match result {
        Ok(json) => to_cstring(&json),
        Err(e) => {
            if let Ok(conn) = handle::get_conn(conn_id) {
                conn.set_error(e.to_string());
            }
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_execute_nonquery(conn_id: u64, cmd_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(cmd_json) };
    let result = rt().block_on(async {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!("Execute on conn {}: {}", conn_id, &cmd.sql[..cmd.sql.len().min(100)]);
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => query::execute_nonquery(client, &cmd).await,
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result
    });
    match result {
        Ok(json) => to_cstring(&json),
        Err(e) => {
            if let Ok(conn) = handle::get_conn(conn_id) {
                conn.set_error(e.to_string());
            }
            std::ptr::null_mut()
        }
    }
}

// ══════════════════════════════════════════════════════════════
// Exec FFI (stored procedures with OUTPUT params + multi result sets)
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_exec(conn_id: u64, cmd_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(cmd_json) };
    let result = rt().block_on(async {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!("Exec on conn {}: {}", conn_id, &cmd.sql[..cmd.sql.len().min(100)]);
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => query::execute_exec(client, &cmd).await,
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result
    });
    match result {
        Ok(json) => to_cstring(&json),
        Err(e) => {
            if let Ok(conn) = handle::get_conn(conn_id) {
                conn.set_error(e.to_string());
            }
            std::ptr::null_mut()
        }
    }
}

// ══════════════════════════════════════════════════════════════
// Streaming FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_query_stream(conn_id: u64, cmd_json: *const c_char) -> u64 {
    let json = unsafe { read_cstr(cmd_json) };
    let result = rt().block_on(async {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!(
            "Stream query on conn {}: {}",
            conn_id,
            &cmd.sql[..cmd.sql.len().min(100)]
        );

        // Execute query and collect all rows (mssql-client buffers anyway)
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => query::execute_query_stream(client, &cmd).await,
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        let rows = result?;

        let cursor = stream::RowCursor::new(rows);
        let cursor_id = NEXT_CURSOR_ID.fetch_add(1, Ordering::Relaxed);
        CURSORS.lock().unwrap().insert(cursor_id, cursor);
        debug::debug_log!("Stream cursor {} opened on conn {}", cursor_id, conn_id);
        Ok::<_, MssqlError>(cursor_id)
    });
    match result {
        Ok(id) => id,
        Err(e) => {
            if let Ok(conn) = handle::get_conn(conn_id) {
                conn.set_error(e.to_string());
            }
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_stream_next(cursor_id: u64) -> *mut c_char {
    let mut map = CURSORS.lock().unwrap();
    let cursor = match map.get_mut(&cursor_id) {
        Some(c) => c,
        None => return std::ptr::null_mut(),
    };
    match cursor.next_row() {
        Some(row) => {
            let json = query::row_to_json(&row);
            to_cstring(&json.to_string())
        }
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn mssql_stream_close(cursor_id: u64) {
    debug::debug_log!("Closing stream cursor {}", cursor_id);
    CURSORS.lock().unwrap().remove(&cursor_id);
}

// ══════════════════════════════════════════════════════════════
// Bulk Insert FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_bulk_insert(conn_id: u64, req_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(req_json) };
    let result = rt().block_on(async {
        let req: bulk::BulkInsertRequest =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => bulk::execute_bulk(client, &req).await,
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        let count = result?;
        Ok::<_, MssqlError>(serde_json::json!({ "rowsAffected": count }).to_string())
    });
    match result {
        Ok(json) => to_cstring(&json),
        Err(e) => {
            if let Ok(conn) = handle::get_conn(conn_id) {
                conn.set_error(e.to_string());
            }
            std::ptr::null_mut()
        }
    }
}

// ══════════════════════════════════════════════════════════════
// Transaction FFI
// ══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct BeginTxRequest {
    id: String,
    isolation: String,
}

#[no_mangle]
pub extern "C" fn mssql_begin_transaction(conn_id: u64, tx_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(tx_json) };
    let result = rt().block_on(async {
        let req: BeginTxRequest =
            serde_json::from_str(json).map_err(|e| MssqlError::Transaction(e.to_string()))?;

        let isolation_sql = match req.isolation.as_str() {
            "READ_UNCOMMITTED" => "READ UNCOMMITTED",
            "READ_COMMITTED" => "READ COMMITTED",
            "REPEATABLE_READ" => "REPEATABLE READ",
            "SNAPSHOT" => "SNAPSHOT",
            "SERIALIZABLE" => "SERIALIZABLE",
            other => {
                return Err(MssqlError::Transaction(format!(
                    "Unknown isolation level: {other}"
                )))
            }
        };

        debug::debug_log!(
            "Begin transaction on conn {}: isolation={}",
            conn_id,
            isolation_sql
        );

        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => client
                .simple_query(&format!(
                    "SET TRANSACTION ISOLATION LEVEL {isolation_sql}; BEGIN TRANSACTION"
                ))
                .await
                .map_err(|e| MssqlError::Transaction(e.to_string())),
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result?;
        *conn.active_transaction.lock().unwrap() = Some(req.id);
        Ok::<_, MssqlError>(())
    });
    match result {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => to_cstring(&e.to_string()),
    }
}

#[no_mangle]
pub extern "C" fn mssql_commit(conn_id: u64, _tx_id: *const c_char) -> *mut c_char {
    let result = rt().block_on(async {
        debug::debug_log!("Commit transaction on conn {}", conn_id);
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => client
                .simple_query("COMMIT TRANSACTION")
                .await
                .map_err(|e| MssqlError::Transaction(e.to_string())),
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result?;
        *conn.active_transaction.lock().unwrap() = None;
        Ok::<_, MssqlError>(())
    });
    match result {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => to_cstring(&e.to_string()),
    }
}

#[no_mangle]
pub extern "C" fn mssql_rollback(conn_id: u64, _tx_id: *const c_char) -> *mut c_char {
    let result = rt().block_on(async {
        debug::debug_log!("Rollback transaction on conn {}", conn_id);
        let conn = handle::get_conn(conn_id)?;
        let mut mc = conn.client.lock().unwrap()
            .take()
            .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
        let result = match mc.as_client_mut() {
            Some(client) => client
                .simple_query("ROLLBACK TRANSACTION")
                .await
                .map_err(|e| MssqlError::Transaction(e.to_string())),
            None => Err(MssqlError::Connection("Cannot access client".into())),
        };
        *conn.client.lock().unwrap() = Some(mc);
        result?;
        *conn.active_transaction.lock().unwrap() = None;
        Ok::<_, MssqlError>(())
    });
    match result {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => to_cstring(&e.to_string()),
    }
}

// ══════════════════════════════════════════════════════════════
// Cancel FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_cancel(_conn_id: u64) {
    // Placeholder — true mid-query cancellation requires TDS ATTENTION
    // signal. AbortSignal is checked before/after FFI calls on the JS side.
}

// ══════════════════════════════════════════════════════════════
// FILESTREAM FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_filestream_available() -> u32 {
    if filestream::is_available() { 1 } else { 0 }
}

#[derive(Deserialize)]
struct FilestreamOpenRequest {
    path: String,
    tx_context_base64: String,
    mode: String,
}

#[no_mangle]
pub extern "C" fn mssql_filestream_open(req_json: *const c_char) -> u64 {
    let json = unsafe { read_cstr(req_json) };
    let result = (|| -> error::Result<u64> {
        let req: FilestreamOpenRequest =
            serde_json::from_str(json).map_err(|e| MssqlError::Config(e.to_string()))?;

        use base64::Engine;
        let tx_context = base64::engine::general_purpose::STANDARD
            .decode(&req.tx_context_base64)
            .map_err(|e| MssqlError::Config(format!("Invalid tx_context base64: {e}")))?;

        let mode = match req.mode.as_str() {
            "read" => filestream::FilestreamMode::Read,
            "write" => filestream::FilestreamMode::Write,
            "readwrite" => filestream::FilestreamMode::ReadWrite,
            other => return Err(MssqlError::Config(format!("Invalid mode: {other}"))),
        };

        let handle = filestream::FilestreamHandle::open(&req.path, &tx_context, mode)?;
        let id = NEXT_FS_ID.fetch_add(1, Ordering::Relaxed);
        FS_HANDLES.lock().unwrap().insert(id, handle);
        Ok(id)
    })();
    match result {
        Ok(id) => id,
        Err(e) => {
            eprintln!("[@tracker1/mssql] FILESTREAM open failed: {e}");
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_filestream_read(fs_id: u64, max_bytes: u64) -> *mut c_char {
    let map = FS_HANDLES.lock().unwrap();
    let handle = match map.get(&fs_id) {
        Some(h) => h,
        None => return std::ptr::null_mut(),
    };
    let result = if max_bytes == 0 {
        handle.read_all()
    } else {
        let mut buf = vec![0u8; max_bytes as usize];
        handle.read(&mut buf).map(|n| {
            buf.truncate(n);
            buf
        })
    };
    match result {
        Ok(data) => {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let response = serde_json::json!({ "data": b64, "length": data.len() });
            to_cstring(&response.to_string())
        }
        Err(e) => {
            let response = serde_json::json!({ "__error": e.to_string() });
            to_cstring(&response.to_string())
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_filestream_write(fs_id: u64, data_base64: *const c_char) -> u64 {
    let b64 = unsafe { read_cstr(data_base64) };
    let map = FS_HANDLES.lock().unwrap();
    let handle = match map.get(&fs_id) {
        Some(h) => h,
        None => return 0,
    };
    use base64::Engine;
    let data = match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(d) => d,
        Err(_) => return 0,
    };
    match handle.write_all(&data) {
        Ok(()) => data.len() as u64,
        Err(_) => 0,
    }
}

#[no_mangle]
pub extern "C" fn mssql_filestream_close(fs_id: u64) {
    FS_HANDLES.lock().unwrap().remove(&fs_id);
}

// ══════════════════════════════════════════════════════════════
// Diagnostics FFI (Phase 13.1 — built in from the start)
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_diagnostic_info() -> *mut c_char {
    let snapshot = handle::diagnostic_snapshot();
    to_cstring(&snapshot.to_string())
}

// ══════════════════════════════════════════════════════════════
// Debug FFI (Phase 13.2 — built in from the start)
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_set_debug(enabled: u32) {
    debug::set_debug(enabled != 0);
}

// ══════════════════════════════════════════════════════════════
// Close All FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_close_all() {
    debug::debug_log!("Closing all handles");
    CURSORS.lock().unwrap().clear();
    FS_HANDLES.lock().unwrap().clear();
    handle::remove_all_conns();
    handle::remove_all_pools();
}

// ══════════════════════════════════════════════════════════════
// Error / Memory FFI
// ══════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn mssql_last_error(handle_id: u64) -> *mut c_char {
    // Check connections first, then pools
    if let Ok(conn) = handle::get_conn(handle_id) {
        if let Some(err) = conn.last_error.lock().unwrap().take() {
            return to_cstring(&err);
        }
    }
    if let Ok(pool) = handle::get_pool(handle_id) {
        if let Some(err) = pool.last_error.lock().unwrap().take() {
            return to_cstring(&err);
        }
    }
    std::ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn mssql_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            drop(CString::from_raw(ptr));
        }
    }
}

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
pub mod query;
mod stream;

use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;

use config::NormalizedConfig;
use error::MssqlError;
use handle::OdbcConn;
use query::SerializedCommand;

unsafe fn read_cstr<'a>(ptr: *const c_char) -> &'a str {
    CStr::from_ptr(ptr).to_str().unwrap_or("")
}

fn to_cstring(s: &str) -> *mut c_char {
    CString::new(s).unwrap_or_default().into_raw()
}

/// Initialize debug logging on first use.
fn ensure_init() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        debug::init();
        debug::debug_log!("ODBC driver initialized");
    });
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
    ensure_init();
    let json = unsafe { read_cstr(config_json) };
    let result = (|| {
        let config = NormalizedConfig::from_json(json)?;
        debug::debug_log!(
            "Creating pool for {}:{}",
            config.server,
            config.port
        );
        let pool = pool::OdbcPool::new(&config)?;
        Ok::<_, MssqlError>(handle::store_pool(pool, &config))
    })();
    match result {
        Ok(id) => {
            debug::debug_log!("Pool created: id={}", id);
            id
        }
        Err(e) => {
            eprintln!("[@tsdrivers/mssql] Pool creation failed: {e}");
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn mssql_pool_acquire(pool_id: u64) -> u64 {
    let result = (|| {
        let pool_handle = handle::get_pool(pool_id)?;
        debug::debug_log!("Acquiring connection from pool {}", pool_id);

        let conn = pool_handle.pool.get()?;
        let odbc_conn = OdbcConn::Pooled(conn);
        Ok::<_, MssqlError>(handle::store_conn(odbc_conn, Some(pool_id)))
    })();
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
    // Remove the connection handle and return the ODBC connection to the pool
    if let Some(conn_handle) = handle::remove_conn(conn_id) {
        if let Some(odbc_conn) = conn_handle.conn.lock().unwrap().take() {
            if let OdbcConn::Pooled(conn) = odbc_conn {
                if let Ok(pool_handle) = handle::get_pool(pool_id) {
                    pool_handle.pool.put(conn);
                    return;
                }
            }
        }
    }
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
    ensure_init();
    let json = unsafe { read_cstr(config_json) };
    let result = (|| {
        let config = NormalizedConfig::from_json(json)?;
        debug::debug_log!(
            "Connecting to {}:{}",
            config.server,
            config.port
        );
        let conn = pool::create_single(&config)?;
        Ok::<_, MssqlError>(handle::store_conn(OdbcConn::Bare(conn), None))
    })();
    match result {
        Ok(id) => {
            debug::debug_log!("Connection established: id={}", id);
            id
        }
        Err(e) => {
            eprintln!("[@tsdrivers/mssql] Connection failed: {e}");
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

/// Helper: take the connection, run a closure, put it back.
fn with_conn<F, T>(conn_id: u64, f: F) -> std::result::Result<T, MssqlError>
where
    F: FnOnce(&odbc_api::Connection<'static>) -> std::result::Result<T, MssqlError>,
{
    let conn_handle = handle::get_conn(conn_id)?;
    let oc = conn_handle
        .conn
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| MssqlError::Connection("Connection is in use".into()))?;
    let result = f(oc.connection());
    *conn_handle.conn.lock().unwrap() = Some(oc);
    result
}

#[no_mangle]
pub extern "C" fn mssql_query(conn_id: u64, cmd_json: *const c_char) -> *mut c_char {
    let json = unsafe { read_cstr(cmd_json) };
    let result = (|| {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!(
            "Query on conn {}: {}",
            conn_id,
            &cmd.sql[..cmd.sql.len().min(100)]
        );
        with_conn(conn_id, |conn| query::execute_query(conn, &cmd))
    })();
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
    let result = (|| {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!(
            "Execute on conn {}: {}",
            conn_id,
            &cmd.sql[..cmd.sql.len().min(100)]
        );
        with_conn(conn_id, |conn| query::execute_nonquery(conn, &cmd))
    })();
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
    let result = (|| {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!(
            "Exec on conn {}: {}",
            conn_id,
            &cmd.sql[..cmd.sql.len().min(100)]
        );
        with_conn(conn_id, |conn| query::execute_exec(conn, &cmd))
    })();
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
    let result = (|| {
        let cmd: SerializedCommand =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        debug::debug_log!(
            "Stream query on conn {}: {}",
            conn_id,
            &cmd.sql[..cmd.sql.len().min(100)]
        );

        let rows = with_conn(conn_id, |conn| query::execute_query_stream(conn, &cmd))?;

        let cursor = stream::RowCursor::new(rows);
        let cursor_id = NEXT_CURSOR_ID.fetch_add(1, Ordering::Relaxed);
        CURSORS.lock().unwrap().insert(cursor_id, cursor);
        debug::debug_log!("Stream cursor {} opened on conn {}", cursor_id, conn_id);
        Ok::<_, MssqlError>(cursor_id)
    })();
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
        Some(json) => to_cstring(&json.to_string()),
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
    let result = (|| {
        let req: bulk::BulkInsertRequest =
            serde_json::from_str(json).map_err(|e| MssqlError::Query(e.to_string()))?;
        let count = with_conn(conn_id, |conn| bulk::execute_bulk(conn, &req))?;
        Ok::<_, MssqlError>(serde_json::json!({ "rowsAffected": count }).to_string())
    })();
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
    let result = (|| {
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

        with_conn(conn_id, |conn| {
            query::simple_execute(
                conn,
                &format!(
                    "SET TRANSACTION ISOLATION LEVEL {isolation_sql}; BEGIN TRANSACTION"
                ),
            )
            .map_err(|e| MssqlError::Transaction(e.to_string()))
        })?;

        let conn_handle = handle::get_conn(conn_id)?;
        *conn_handle.active_transaction.lock().unwrap() = Some(req.id);
        Ok::<_, MssqlError>(())
    })();
    match result {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => to_cstring(&e.to_string()),
    }
}

#[no_mangle]
pub extern "C" fn mssql_commit(conn_id: u64, _tx_id: *const c_char) -> *mut c_char {
    let result = (|| {
        debug::debug_log!("Commit transaction on conn {}", conn_id);
        with_conn(conn_id, |conn| {
            query::simple_execute(conn, "COMMIT TRANSACTION")
                .map_err(|e| MssqlError::Transaction(e.to_string()))
        })?;
        let conn_handle = handle::get_conn(conn_id)?;
        *conn_handle.active_transaction.lock().unwrap() = None;
        Ok::<_, MssqlError>(())
    })();
    match result {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => to_cstring(&e.to_string()),
    }
}

#[no_mangle]
pub extern "C" fn mssql_rollback(conn_id: u64, _tx_id: *const c_char) -> *mut c_char {
    let result = (|| {
        debug::debug_log!("Rollback transaction on conn {}", conn_id);
        with_conn(conn_id, |conn| {
            query::simple_execute(conn, "ROLLBACK TRANSACTION")
                .map_err(|e| MssqlError::Transaction(e.to_string()))
        })?;
        let conn_handle = handle::get_conn(conn_id)?;
        *conn_handle.active_transaction.lock().unwrap() = None;
        Ok::<_, MssqlError>(())
    })();
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
    // Placeholder — true mid-query cancellation could use SQLCancel.
    // AbortSignal is checked before/after FFI calls on the JS side.
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
            eprintln!("[@tsdrivers/mssql] FILESTREAM open failed: {e}");
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

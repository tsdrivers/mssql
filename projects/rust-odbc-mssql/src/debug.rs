use std::sync::atomic::{AtomicBool, Ordering};

static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);

/// Initialize debug mode from environment variable.
/// Called once during the first FFI call.
pub fn init() {
    if std::env::var("MSSQLTS_DEBUG")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        DEBUG_ENABLED.store(true, Ordering::SeqCst);
        eprintln!("[mssqlts] Debug mode enabled via MSSQLTS_DEBUG");
    }
}

/// Set debug mode at runtime.
pub fn set_debug(enabled: bool) {
    DEBUG_ENABLED.store(enabled, Ordering::SeqCst);
    if enabled {
        eprintln!("[mssqlts] Debug mode enabled");
    }
}

/// Check if debug mode is active.
pub fn is_debug() -> bool {
    DEBUG_ENABLED.load(Ordering::SeqCst)
}

/// Log a debug message to stderr if debug mode is enabled.
macro_rules! debug_log {
    ($($arg:tt)*) => {
        if $crate::debug::is_debug() {
            eprintln!("[mssqlts] {}", format!($($arg)*));
        }
    };
}

pub(crate) use debug_log;

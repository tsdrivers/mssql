#[cfg(windows)]
mod platform {
    use std::ffi::CString;
    use std::sync::OnceLock;

    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};
    use windows::core::PCSTR;

    use crate::error::{MssqlError, Result};

    type OpenSqlFilestreamFn = unsafe extern "system" fn(
        FilestreamPath: PCSTR,
        DesiredAccess: u32,
        OpenOptions: u32,
        FilestreamTransactionContext: *const u8,
        FilestreamTransactionContextLength: u32,
        AllocationSize: *const i64,
    ) -> HANDLE;

    const SQL_FILESTREAM_READ: u32 = 0;
    const SQL_FILESTREAM_WRITE: u32 = 1;
    const SQL_FILESTREAM_READWRITE: u32 = 2;

    static OPEN_FN: OnceLock<std::result::Result<OpenSqlFilestreamFn, String>> = OnceLock::new();

    fn resolve_open_fn() -> std::result::Result<OpenSqlFilestreamFn, String> {
        let cstr = CString::new("msoledbsql.dll").unwrap();
        let lib = unsafe { LoadLibraryA(PCSTR::from_raw(cstr.as_ptr() as *const u8)) };

        if let Ok(lib) = lib {
            let proc = unsafe {
                GetProcAddress(lib, PCSTR::from_raw(b"OpenSqlFilestream\0".as_ptr()))
            };
            if let Some(proc) = proc {
                let func: OpenSqlFilestreamFn = unsafe { std::mem::transmute(proc) };
                return Ok(func);
            }
        }

        Err(
            "FILESTREAM requires Microsoft OLE DB Driver 19 for SQL Server.\n\
             \n\
             Install via:\n\
             • winget install Microsoft.OLEDBDriver\n\
             • https://learn.microsoft.com/en-us/sql/connect/oledb/download-oledb-driver-for-sql-server\n\
             \n\
             This is ONLY needed for FILESTREAM. All other features work without it."
                .to_string(),
        )
    }

    fn get_open_fn() -> Result<OpenSqlFilestreamFn> {
        OPEN_FN
            .get_or_init(resolve_open_fn)
            .clone()
            .map_err(MssqlError::Connection)
    }

    #[derive(Clone, Copy)]
    pub enum FilestreamMode {
        Read,
        Write,
        ReadWrite,
    }

    pub struct FilestreamHandle {
        handle: HANDLE,
    }

    impl FilestreamHandle {
        pub fn open(path: &str, tx_context: &[u8], mode: FilestreamMode) -> Result<Self> {
            let open_fn = get_open_fn()?;

            let path_cstr = CString::new(path)
                .map_err(|_| MssqlError::Connection("Invalid filestream path".into()))?;

            let access = match mode {
                FilestreamMode::Read => SQL_FILESTREAM_READ,
                FilestreamMode::Write => SQL_FILESTREAM_WRITE,
                FilestreamMode::ReadWrite => SQL_FILESTREAM_READWRITE,
            };

            let handle = unsafe {
                open_fn(
                    PCSTR::from_raw(path_cstr.as_ptr() as *const u8),
                    access,
                    0,
                    tx_context.as_ptr(),
                    tx_context.len() as u32,
                    std::ptr::null(),
                )
            };

            if handle.is_invalid() {
                return Err(MssqlError::Connection(format!(
                    "OpenSqlFilestream failed for path: {path}"
                )));
            }

            Ok(Self { handle })
        }

        pub fn read(&self, buf: &mut [u8]) -> Result<usize> {
            let mut bytes_read: u32 = 0;
            unsafe {
                ReadFile(self.handle, Some(buf), Some(&mut bytes_read), None)
                    .map_err(|e| MssqlError::Query(format!("FILESTREAM read failed: {e}")))?;
            }
            Ok(bytes_read as usize)
        }

        pub fn read_all(&self) -> Result<Vec<u8>> {
            let mut result = Vec::new();
            let mut buf = [0u8; 65536];
            loop {
                let n = self.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                result.extend_from_slice(&buf[..n]);
            }
            Ok(result)
        }

        pub fn write(&self, data: &[u8]) -> Result<usize> {
            let mut bytes_written: u32 = 0;
            unsafe {
                WriteFile(self.handle, Some(data), Some(&mut bytes_written), None)
                    .map_err(|e| MssqlError::Query(format!("FILESTREAM write failed: {e}")))?;
            }
            Ok(bytes_written as usize)
        }

        pub fn write_all(&self, data: &[u8]) -> Result<()> {
            let mut offset = 0;
            while offset < data.len() {
                let n = self.write(&data[offset..])?;
                if n == 0 {
                    return Err(MssqlError::Query("FILESTREAM write stalled".into()));
                }
                offset += n;
            }
            Ok(())
        }
    }

    impl Drop for FilestreamHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    pub fn is_available() -> bool {
        get_open_fn().is_ok()
    }
}

#[cfg(not(windows))]
mod platform {
    use crate::error::{MssqlError, Result};

    #[derive(Clone, Copy)]
    pub enum FilestreamMode {
        Read,
        Write,
        ReadWrite,
    }

    pub struct FilestreamHandle;

    #[allow(dead_code)] // stub implementation for non-Windows platforms
    impl FilestreamHandle {
        pub fn open(_path: &str, _tx_context: &[u8], _mode: FilestreamMode) -> Result<Self> {
            Err(MssqlError::Connection(
                "FILESTREAM is only available on Windows.\n\
                 Use varbinary(max) with standard queries on other platforms."
                    .into(),
            ))
        }
        pub fn read(&self, _buf: &mut [u8]) -> Result<usize> { unreachable!() }
        pub fn read_all(&self) -> Result<Vec<u8>> { unreachable!() }
        pub fn write(&self, _data: &[u8]) -> Result<usize> { unreachable!() }
        pub fn write_all(&self, _data: &[u8]) -> Result<()> { unreachable!() }
    }

    pub fn is_available() -> bool { false }
}

pub use platform::{is_available, FilestreamHandle, FilestreamMode};

# Installation

## Prerequisites

[Microsoft ODBC Driver 18 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server) must be installed on the target system:

```sh
# Windows
winget install Microsoft.ODBC.18

# macOS
brew install microsoft/mssql-release/msodbcsql18

# Debian / Ubuntu
curl https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
sudo apt-get update && sudo apt-get install -y msodbcsql18

# RHEL / Fedora
sudo dnf install msodbcsql18
```

## Install the Package

```sh
# Deno
deno add jsr:@tsdrivers/mssql

# Node.js
npm install @tsdrivers/mssql koffi

# Bun
bun add @tsdrivers/mssql koffi
```

The `@tsdrivers/mssql` package auto-detects your runtime and uses the correct
FFI adapter automatically. Deno uses its built-in `Deno.dlopen`; Node.js and
Bun use [koffi](https://koffi.dev/) which provides nonblocking async FFI calls
via worker threads.

## Native Library

The native Rust library must be available at runtime. There are several ways to
provide it:

### Automatic Download

The Node.js and Bun postinstall script downloads the native library
automatically. For Deno, use the install script:

```sh
deno run -A jsr:@tsdrivers/mssql/install
```

### Manual Download

Download the appropriate binary from
[GitHub Releases](https://github.com/tsdrivers/mssql/releases) and place it in
one of the search paths.

### Environment Variable

Set `TSDRIVERS_MSSQL_LIB_PATH` to the full path of the native library:

```sh
export TSDRIVERS_MSSQL_LIB_PATH=/path/to/mssqlts-linux-x86_64.so
```

### Library Search Order

The library resolver searches these locations in order:

1. `TSDRIVERS_MSSQL_LIB_PATH` environment variable
2. `node_modules/@tsdrivers/mssql/native/`
3. Current directory and parent directories (including `lib/`, `.lib/`, `bin/`,
   `.bin/` subdirs)
4. Next to the entry point script
5. Home directory (`~/lib/`, `~/.lib/`, `~/bin/`, `~/.bin/`)
6. Cache directory (`~/.cache/@tsdrivers/mssql/{version}/`)

### Platform Binaries

| Platform | Architecture | Filename                      |
| -------- | ------------ | ----------------------------- |
| Linux    | x86_64       | `mssqlts-linux-x86_64.so`     |
| Linux    | aarch64      | `mssqlts-linux-aarch64.so`    |
| macOS    | x86_64       | `mssqlts-macos-x86_64.dylib`  |
| macOS    | aarch64      | `mssqlts-macos-aarch64.dylib` |
| Windows  | x86_64       | `mssqlts-windows-x86_64.dll`  |
| Windows  | aarch64      | `mssqlts-windows-aarch64.dll` |

### Build from Source

```sh
cd projects/rust-odbc-mssql
cargo build --release
# Copy projects/rust-odbc-mssql/target/release/libmssqlts.so to your project
```

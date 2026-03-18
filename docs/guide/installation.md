# Installation

## Install the Package

```sh
# Deno
deno add jsr:@tsdrivers/mssql

# Node.js
npm install @tsdrivers/mssql

# Bun
bun add @tsdrivers/mssql
```

The `@tsdrivers/mssql` package auto-detects your runtime and uses the correct
FFI adapter (Deno.dlopen, koffi, or bun:ffi) automatically.

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
cd projects/rust
cargo build --release
# Copy projects/rust/target/release/libmssqlts.so to your project
```

# Runtime Support

The `@tracker1/mssql` package includes FFI adapters for all three supported
runtimes. The correct adapter is selected automatically — no configuration
needed.

## How It Works

When you first call `createPool()` or `connect()`, the package:

1. **Detects the runtime** (Deno, Bun, or Node.js)
2. **Loads the correct FFI adapter** (`Deno.dlopen`, `bun:ffi`, or `koffi`)
3. **Resolves the native library** using the standard search order
4. **Caches the result** — subsequent calls reuse the same FFI singleton

### Deno

FFI initialization starts **eagerly at module evaluation time**. Since Deno's
`dlopen` is synchronous, the FFI is typically ready before your code calls
`createPool()` or `connect()`.

### Node.js

Uses [koffi](https://koffi.dev) for FFI binding. `koffi` is listed as an
`optionalDependency` in `package.json` and is installed automatically. If it's
missing at runtime, the package attempts to install it on demand via
`npm install koffi --no-save`.

### Bun

Uses the built-in `bun:ffi` module. No additional dependencies needed.

## Low-Level FFI Access

The package exports `getFfi()` and `loadLibrary()` for advanced use cases:

```ts
import { getFfi, loadLibrary } from "@tracker1/mssql";

// Get the FFI singleton (resolved lazily, or eagerly on Deno)
const ffi = await getFfi();

// Or load from an explicit path
const ffi = await loadLibrary("/path/to/mssqlts-linux-x86_64.so");

// Check FILESTREAM availability (Windows only)
if (ffi.filestreamAvailable()) {
  console.log("FILESTREAM is available");
}
```

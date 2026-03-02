/**
 * Library binary resolution — finds the native library for the current platform.
 * @module
 */

import type { RuntimeInfo } from "./runtime.ts";

/**
 * Context provided by the runtime adapter for resolving the library path.
 * Keeps core runtime-agnostic.
 */
export interface ResolutionContext {
  env(name: string): string | undefined;
  fileExists(path: string): boolean;
  cwd(): string;
  homeDir(): string;
  entryPoint(): string | undefined;
  version: string;
  info: RuntimeInfo;
  sep: string;
}

/**
 * Get the platform-specific library filename.
 *
 * Format: `mssqlts-{os}-{arch}.{ext}`
 *
 * Examples:
 * - `mssqlts-linux-x86_64.so`
 * - `mssqlts-macos-aarch64.dylib`
 * - `mssqlts-windows-x86_64.dll`
 */
export function libraryFileName(os: RuntimeInfo["os"], arch: RuntimeInfo["arch"]): string {
  const osName = os === "darwin" ? "macos" : os;
  const ext = os === "windows" ? "dll" : os === "darwin" ? "dylib" : "so";
  return `mssqlts-${osName}-${arch}.${ext}`;
}

/**
 * Resolve the path to the native library. Throws if not found.
 *
 * Resolution order:
 * 1. `TRACKER1_MSSQL_LIB_PATH` env var (explicit path)
 * 2. `node_modules/pkg/native/{filename}` (Node/Bun postinstall)
 * 3. Walk up from cwd — at each dir check:
 *    `{dir}/{filename}`, `{dir}/lib/`, `{dir}/.lib/`, `{dir}/bin/`, `{dir}/.bin/`
 * 4. Next to entry point
 * 5. Home directory: `~/lib/`, `~/.lib/`, `~/bin/`, `~/.bin/`
 * 6. `~/.cache/tracker1-mssql/{version}/{filename}`
 * 7. Throw with install instructions
 */
export function resolveLibraryPath(ctx: ResolutionContext): string {
  const filename = libraryFileName(ctx.info.os, ctx.info.arch);
  const sep = ctx.sep;

  // 1. Explicit env var
  const envPath = ctx.env("TRACKER1_MSSQL_LIB_PATH");
  if (envPath && ctx.fileExists(envPath)) return envPath;

  // 2. node_modules location (unified package or runtime-specific)
  const nodeModulesUnified = `${ctx.cwd()}${sep}node_modules${sep}@tracker1${sep}mssql${sep}native${sep}${filename}`;
  if (ctx.fileExists(nodeModulesUnified)) return nodeModulesUnified;
  const nodeModulesRuntime = `${ctx.cwd()}${sep}node_modules${sep}@tracker1${sep}mssql-${ctx.info.runtime}${sep}native${sep}${filename}`;
  if (ctx.fileExists(nodeModulesRuntime)) return nodeModulesRuntime;

  // 3. Walk up from cwd
  const subdirs = ["", "lib", ".lib", "bin", ".bin"];
  let dir = ctx.cwd();
  const root = ctx.info.os === "windows" ? dir.slice(0, 3) : "/";

  while (dir.length >= root.length) {
    for (const sub of subdirs) {
      const candidate = sub
        ? `${dir}${sep}${sub}${sep}${filename}`
        : `${dir}${sep}${filename}`;
      if (ctx.fileExists(candidate)) return candidate;
    }
    const parent = dir.substring(0, dir.lastIndexOf(sep));
    if (parent === dir || parent === "") break;
    dir = parent;
  }

  // 4. Next to entry point
  const entry = ctx.entryPoint();
  if (entry) {
    const entryDir = entry.substring(0, entry.lastIndexOf(sep));
    if (entryDir) {
      const candidate = `${entryDir}${sep}${filename}`;
      if (ctx.fileExists(candidate)) return candidate;
    }
  }

  // 5. Home directory subdirs
  const home = ctx.homeDir();
  for (const sub of ["lib", ".lib", "bin", ".bin"]) {
    const candidate = `${home}${sep}${sub}${sep}${filename}`;
    if (ctx.fileExists(candidate)) return candidate;
  }

  // 6. Cache directory
  const cachePath = `${home}${sep}.cache${sep}tracker1-mssql${sep}${ctx.version}${sep}${filename}`;
  if (ctx.fileExists(cachePath)) return cachePath;

  // 7. Not found
  throw new Error(
    `Native library "${filename}" not found.\n` +
    "\n" +
    "Install it with:\n" +
    `  deno run -A jsr:@tracker1/mssql/install\n` +
    "\n" +
    "Or set TRACKER1_MSSQL_LIB_PATH to the library path.",
  );
}

/**
 * Construct the GitHub release download URL for a given platform.
 */
export function downloadUrl(
  version: string,
  os: RuntimeInfo["os"],
  arch: RuntimeInfo["arch"],
): string {
  const filename = libraryFileName(os, arch);
  return `https://github.com/tracker1/mssql-ts-ffi/releases/download/v${version}/${filename}`;
}

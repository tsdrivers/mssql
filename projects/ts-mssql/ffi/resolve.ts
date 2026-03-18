/**
 * Runtime detection, resolution context, and FFI singleton management.
 *
 * Detects whether the current runtime is Deno, Bun, or Node.js,
 * builds the appropriate ResolutionContext, and lazily creates
 * the FFI binding singleton. Deno FFI is initialized eagerly
 * at module evaluation time to eliminate added latency.
 *
 * @module
 */

import type { RuntimeFFI, RuntimeInfo } from "../core/runtime.ts";
import type { ResolutionContext } from "../core/binary.ts";
import { resolveLibraryPath } from "../core/binary.ts";

const VERSION = "0.1.0";

type Runtime = "deno" | "bun" | "node";

/** Detect current JavaScript runtime. */
export function detectRuntime(): Runtime {
  // deno-lint-ignore no-explicit-any
  if (typeof (globalThis as any).Deno !== "undefined") return "deno";
  // deno-lint-ignore no-explicit-any
  if (typeof (globalThis as any).Bun !== "undefined") return "bun";
  return "node";
}

/** Build RuntimeInfo for the given runtime. */
function getRuntimeInfo(runtime: Runtime): RuntimeInfo {
  if (runtime === "deno") {
    // deno-lint-ignore no-explicit-any
    const build = (globalThis as any).Deno.build;
    const os: RuntimeInfo["os"] = build.os === "darwin"
      ? "darwin"
      : build.os === "windows"
      ? "windows"
      : "linux";
    const arch: RuntimeInfo["arch"] = build.arch === "aarch64"
      ? "aarch64"
      : "x86_64";
    return { os, arch, runtime };
  }

  // Bun and Node both expose globalThis.process
  const platform = globalThis.process?.platform ?? "linux";
  const processArch = globalThis.process?.arch ?? "x64";
  const os: RuntimeInfo["os"] = platform === "darwin"
    ? "darwin"
    : platform === "win32"
    ? "windows"
    : "linux";
  const arch: RuntimeInfo["arch"] = processArch === "arm64"
    ? "aarch64"
    : "x86_64";
  return { os, arch, runtime };
}

/** Build a ResolutionContext for Deno (fully synchronous). */
function getDenoResolutionContext(): ResolutionContext {
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  const info = getRuntimeInfo("deno");
  return {
    env: (name: string) => {
      try {
        return D.env.get(name);
      } catch {
        return undefined;
      }
    },
    fileExists: (path: string) => {
      try {
        D.statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    cwd: () => D.cwd(),
    homeDir: () => D.env.get("HOME") ?? D.env.get("USERPROFILE") ?? "",
    entryPoint: () =>
      D.mainModule ? new URL(D.mainModule).pathname : undefined,
    version: VERSION,
    info,
    sep: info.os === "windows" ? "\\" : "/",
  };
}

/**
 * Build a ResolutionContext for Node.js or Bun.
 * Async because node:fs must be dynamically imported.
 */
async function getNodeBunResolutionContext(
  runtime: "node" | "bun",
): Promise<ResolutionContext> {
  // Computed path prevents deno check from eagerly resolving @types/node
  const fsModule = "node:" + "fs";
  // deno-lint-ignore no-explicit-any
  const { statSync } = await import(fsModule) as any;
  const info = getRuntimeInfo(runtime);
  return {
    env: (name: string) => {
      try {
        return globalThis.process?.env?.[name];
      } catch {
        return undefined;
      }
    },
    fileExists: (path: string) => {
      try {
        statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    cwd: () => globalThis.process?.cwd?.() ?? ".",
    homeDir: () =>
      globalThis.process?.env?.HOME ??
        globalThis.process?.env?.USERPROFILE ?? "",
    entryPoint: () => globalThis.process?.argv?.[1],
    version: VERSION,
    info,
    sep: info.os === "windows" ? "\\" : "/",
  };
}

/**
 * Dynamically import and call the runtime-specific FFI factory.
 *
 * The import path is computed from the runtime name to prevent
 * TypeScript/bundlers from eagerly resolving all three adapters.
 */
async function createRuntimeFFI(
  runtime: Runtime,
  libPath: string,
): Promise<RuntimeFFI> {
  const modPath = `./${runtime}.ts`;
  const mod = await import(modPath);
  const ffi: RuntimeFFI = await mod.createFFI(libPath);
  registerExitHandler(ffi);
  return ffi;
}

// ── Exit handler ─────────────────────────────────────────────

let _exitHandlerDisabled = false;
let _exitHandlerRegistered = false;

function registerExitHandler(ffi: RuntimeFFI): void {
  if (_exitHandlerRegistered || _exitHandlerDisabled) return;
  _exitHandlerRegistered = true;
  const cleanup = () => {
    if (!_exitHandlerDisabled) ffi.closeAll();
  };
  if (_runtime === "deno") {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).addEventListener("unload", cleanup);
  } else {
    globalThis.process?.on("beforeExit", cleanup);
  }
}

/** Disable the automatic exit handler that calls `closeAll()` on process exit. */
export function disableExitHandler(): void {
  _exitHandlerDisabled = true;
}

// ── FFI singleton ─────────────────────────────────────────────

const _runtime = detectRuntime();

// Eager Deno initialization — starts at module evaluation time.
// Deno's dlopen and library resolution are synchronous, so the
// only async step is the dynamic import() of ./deno.ts.
// By the time user code calls createPool/connect, the FFI is ready.
let _ffiPromise: Promise<RuntimeFFI> | null =
  _runtime === "deno"
    ? (async () => {
      const ctx = getDenoResolutionContext();
      const libPath = resolveLibraryPath(ctx);
      return await createRuntimeFFI("deno", libPath);
    })()
    : null;

/**
 * Get or initialize the FFI singleton.
 * First call triggers resolution; concurrent callers await the same promise.
 */
export function getFfi(): Promise<RuntimeFFI> {
  if (!_ffiPromise) {
    _ffiPromise = (async () => {
      const ctx = await getNodeBunResolutionContext(
        _runtime as "node" | "bun",
      );
      const libPath = resolveLibraryPath(ctx);
      return await createRuntimeFFI(_runtime, libPath);
    })();
  }
  return _ffiPromise;
}

/**
 * Load FFI from an explicit library path, replacing the singleton.
 */
export async function loadLibrary(path: string): Promise<RuntimeFFI> {
  const promise = createRuntimeFFI(_runtime, path);
  _ffiPromise = promise;
  return await promise;
}

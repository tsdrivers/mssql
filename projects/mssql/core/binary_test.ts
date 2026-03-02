import { assertEquals, assertThrows } from "jsr:@std/assert";
import { libraryFileName, resolveLibraryPath, downloadUrl } from "./binary.ts";
import type { ResolutionContext } from "./binary.ts";
import type { RuntimeInfo } from "./runtime.ts";

// ── libraryFileName tests ─────────────────────────────────────

Deno.test("libraryFileName - linux x86_64", () => {
  assertEquals(libraryFileName("linux", "x86_64"), "mssqlts-linux-x86_64.so");
});

Deno.test("libraryFileName - linux aarch64", () => {
  assertEquals(libraryFileName("linux", "aarch64"), "mssqlts-linux-aarch64.so");
});

Deno.test("libraryFileName - darwin x86_64 uses macos", () => {
  assertEquals(libraryFileName("darwin", "x86_64"), "mssqlts-macos-x86_64.dylib");
});

Deno.test("libraryFileName - darwin aarch64 uses macos", () => {
  assertEquals(libraryFileName("darwin", "aarch64"), "mssqlts-macos-aarch64.dylib");
});

Deno.test("libraryFileName - windows x86_64", () => {
  assertEquals(libraryFileName("windows", "x86_64"), "mssqlts-windows-x86_64.dll");
});

Deno.test("libraryFileName - windows aarch64", () => {
  assertEquals(libraryFileName("windows", "aarch64"), "mssqlts-windows-aarch64.dll");
});

// ── downloadUrl tests ─────────────────────────────────────────

Deno.test("downloadUrl - correct format", () => {
  const url = downloadUrl("0.1.0", "linux", "x86_64");
  assertEquals(
    url,
    "https://github.com/tracker1/mssql-ts-ffi/releases/download/v0.1.0/mssqlts-linux-x86_64.so",
  );
});

Deno.test("downloadUrl - macos name in URL", () => {
  const url = downloadUrl("1.2.3", "darwin", "aarch64");
  assertEquals(
    url,
    "https://github.com/tracker1/mssql-ts-ffi/releases/download/v1.2.3/mssqlts-macos-aarch64.dylib",
  );
});

// ── resolveLibraryPath tests ──────────────────────────────────

function mockContext(
  existingFiles: Set<string>,
  overrides: Partial<ResolutionContext> = {},
): ResolutionContext {
  const info: RuntimeInfo = { os: "linux", arch: "x86_64", runtime: "deno" };
  return {
    env: () => undefined,
    fileExists: (p: string) => existingFiles.has(p),
    cwd: () => "/home/user/project",
    homeDir: () => "/home/user",
    entryPoint: () => "/home/user/project/src/main.ts",
    version: "0.1.0",
    info,
    sep: "/",
    ...overrides,
  };
}

Deno.test("resolveLibraryPath - env var takes priority", () => {
  const ctx = mockContext(
    new Set(["/custom/path/libmssqlts.so"]),
    { env: (name: string) => name === "TRACKER1_MSSQL_LIB_PATH" ? "/custom/path/libmssqlts.so" : undefined },
  );
  assertEquals(resolveLibraryPath(ctx), "/custom/path/libmssqlts.so");
});

Deno.test("resolveLibraryPath - env var ignored if file missing", () => {
  const files = new Set(["/home/user/.cache/tracker1-mssql/0.1.0/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files, {
    env: (name: string) => name === "TRACKER1_MSSQL_LIB_PATH" ? "/nonexistent" : undefined,
  });
  assertEquals(resolveLibraryPath(ctx), "/home/user/.cache/tracker1-mssql/0.1.0/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - node_modules location", () => {
  const files = new Set([
    "/home/user/project/node_modules/@tracker1/mssql-deno/native/mssqlts-linux-x86_64.so",
  ]);
  const ctx = mockContext(files);
  assertEquals(
    resolveLibraryPath(ctx),
    "/home/user/project/node_modules/@tracker1/mssql-deno/native/mssqlts-linux-x86_64.so",
  );
});

Deno.test("resolveLibraryPath - cwd directory", () => {
  const files = new Set(["/home/user/project/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/project/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - lib subdirectory", () => {
  const files = new Set(["/home/user/project/lib/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/project/lib/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - .lib subdirectory", () => {
  const files = new Set(["/home/user/project/.lib/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/project/.lib/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - bin subdirectory", () => {
  const files = new Set(["/home/user/project/bin/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/project/bin/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - walks up parent directories", () => {
  const files = new Set(["/home/user/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - parent lib subdirectory", () => {
  const files = new Set(["/home/user/lib/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/lib/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - next to entry point", () => {
  const files = new Set(["/home/user/project/src/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files);
  assertEquals(resolveLibraryPath(ctx), "/home/user/project/src/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - home lib directory", () => {
  const files = new Set(["/home/user/lib/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files, { cwd: () => "/tmp/other" });
  assertEquals(resolveLibraryPath(ctx), "/home/user/lib/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - home .bin directory", () => {
  const files = new Set(["/home/user/.bin/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files, { cwd: () => "/tmp/other" });
  assertEquals(resolveLibraryPath(ctx), "/home/user/.bin/mssqlts-linux-x86_64.so");
});

Deno.test("resolveLibraryPath - cache directory", () => {
  const files = new Set(["/home/user/.cache/tracker1-mssql/0.1.0/mssqlts-linux-x86_64.so"]);
  const ctx = mockContext(files, { cwd: () => "/tmp/other" });
  assertEquals(
    resolveLibraryPath(ctx),
    "/home/user/.cache/tracker1-mssql/0.1.0/mssqlts-linux-x86_64.so",
  );
});

Deno.test("resolveLibraryPath - throws when not found", () => {
  const ctx = mockContext(new Set(), { cwd: () => "/tmp/other" });
  assertThrows(
    () => resolveLibraryPath(ctx),
    Error,
    'Native library "mssqlts-linux-x86_64.so" not found',
  );
});

Deno.test("resolveLibraryPath - windows paths", () => {
  const files = new Set(["C:\\Users\\test\\lib\\mssqlts-windows-x86_64.dll"]);
  const ctx = mockContext(files, {
    cwd: () => "C:\\Users\\test\\project",
    homeDir: () => "C:\\Users\\test",
    sep: "\\",
    info: { os: "windows", arch: "x86_64", runtime: "deno" },
  });
  assertEquals(resolveLibraryPath(ctx), "C:\\Users\\test\\lib\\mssqlts-windows-x86_64.dll");
});

#!/usr/bin/env node
/**
 * Postinstall script for @tsdrivers/mssql.
 *
 * Downloads the native library for the current platform into
 * ~/.cache/@tsdrivers/mssql/{version}/ so it's ready at runtime.
 *
 * If the download fails (e.g. no network, firewall), it logs a
 * warning but does NOT fail the install. The library path can be
 * set manually via the TSDRIVERS_MSSQL_LIB_PATH environment variable.
 */

import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";

function libraryFileName(os, cpuArch) {
  const osName = os === "darwin" ? "macos" : os;
  const ext = os === "windows" ? "dll" : os === "darwin" ? "dylib" : "so";
  return `mssqlts-${osName}-${cpuArch}.${ext}`;
}

function downloadUrl(version, os, cpuArch) {
  const filename = libraryFileName(os, cpuArch);
  return `https://github.com/tsdrivers/mssql/releases/download/v${version}/${filename}`;
}

async function main() {
  const plat = platform();
  const processArch = arch();

  const os = plat === "darwin"
    ? "darwin"
    : plat === "win32"
    ? "windows"
    : "linux";
  const cpuArch = processArch === "arm64" ? "aarch64" : "x86_64";

  const home = homedir();
  const cacheDir = join(home, ".cache", "@tsdrivers", "mssql", VERSION);
  const filename = libraryFileName(os, cpuArch);
  const destPath = join(cacheDir, filename);

  // Check if already exists
  try {
    await stat(destPath);
    console.log(
      `[@tsdrivers/mssql] Native library already installed at ${destPath}`,
    );
    return;
  } catch {
    // File doesn't exist, proceed with download
  }

  console.log("[@tsdrivers/mssql] Installing native library...");
  console.log(`  Platform: ${os}-${cpuArch}`);

  await mkdir(cacheDir, { recursive: true });

  const url = downloadUrl(VERSION, os, cpuArch);
  console.log(`  Downloading ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    await writeFile(destPath, data);
    console.log(
      `  Saved to ${destPath} (${(data.length / 1024 / 1024).toFixed(1)} MB)`,
    );

    if (os !== "windows") {
      await chmod(destPath, 0o755);
    }

    console.log("[@tsdrivers/mssql] Done.");
  } catch (err) {
    console.warn(
      `[@tsdrivers/mssql] Could not download native library: ${err.message}\n` +
        "  You may need to install it manually.\n" +
        "  See: https://github.com/tsdrivers/mssql#installation",
    );
  }
}

main().catch(() => {
  // Don't fail the install if download fails
});

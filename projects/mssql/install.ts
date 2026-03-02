/**
 * Standalone install script for pre-downloading the native library.
 *
 * ```sh
 * deno run -A jsr:@tracker1/mssql/install
 * ```
 *
 * @module
 */

import { downloadUrl, libraryFileName } from "./core/binary.ts";

const VERSION = "0.1.0";

interface InstallOptions {
  version: string;
  force: boolean;
  platforms: Array<{
    os: "linux" | "darwin" | "windows";
    arch: "x86_64" | "aarch64";
  }>;
}

function parseArgs(args: string[]): InstallOptions {
  const opts: InstallOptions = {
    version: VERSION,
    force: false,
    platforms: [],
  };

  for (const arg of args) {
    if (arg.startsWith("--version=")) {
      opts.version = arg.slice("--version=".length);
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg.startsWith("--platform=")) {
      const plat = arg.slice("--platform=".length);
      const [os, arch] = plat.split("-") as [
        "linux" | "darwin" | "windows",
        "x86_64" | "aarch64",
      ];
      opts.platforms.push({ os, arch });
    }
  }

  // Default to current platform
  if (opts.platforms.length === 0) {
    const build = Deno.build;
    const os = build.os === "darwin"
      ? "darwin"
      : build.os === "windows"
      ? "windows"
      : "linux";
    const arch = build.arch === "aarch64" ? "aarch64" : "x86_64";
    opts.platforms.push({
      os: os as "linux" | "darwin" | "windows",
      arch,
    });
  }

  return opts;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`  Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText} from ${url}`,
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  await Deno.writeFile(destPath, data);
  console.log(
    `  Saved to ${destPath} (${(data.length / 1024 / 1024).toFixed(1)} MB)`,
  );
}

async function install(opts: InstallOptions): Promise<void> {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  const sep = Deno.build.os === "windows" ? "\\" : "/";
  const cacheDir =
    `${home}${sep}.cache${sep}tracker1-mssql${sep}${opts.version}`;

  // Ensure cache directory exists
  await Deno.mkdir(cacheDir, { recursive: true });

  for (const plat of opts.platforms) {
    const filename = libraryFileName(plat.os, plat.arch);
    const destPath = `${cacheDir}${sep}${filename}`;

    // Check if already exists
    if (!opts.force) {
      try {
        await Deno.stat(destPath);
        console.log(
          `  ${filename} already exists (use --force to re-download)`,
        );
        continue;
      } catch {
        // File doesn't exist, download it
      }
    }

    const url = downloadUrl(opts.version, plat.os, plat.arch);
    try {
      await downloadFile(url, destPath);

      // Make executable on unix
      if (plat.os !== "windows") {
        await Deno.chmod(destPath, 0o755);
      }
    } catch (err) {
      console.error(`  Failed to download ${filename}: ${err}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("[@tracker1/mssql] Installing native library...");
  const opts = parseArgs(Deno.args);
  console.log(`  Version: ${opts.version}`);
  console.log(
    `  Platforms: ${
      opts.platforms.map((p) => `${p.os}-${p.arch}`).join(", ")
    }`,
  );
  await install(opts);
  console.log("[@tracker1/mssql] Done.");
}

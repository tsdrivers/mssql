<#
.SYNOPSIS
    Build and run the full integration test suite against a local SQL Server Express instance.

.DESCRIPTION
    Assumes:
      - SQL Server Express is installed at localhost\SQLEXPRESS
      - FILESTREAM is enabled (access level >= 2) or the script will enable it
      - The current user has sysadmin / dbcreator rights (Windows auth)
      - Deno, Node.js 22+, and Bun are on PATH
      - Rust toolchain (cargo) is on PATH

    Runs all tests including FILESTREAM and Windows auth (SSPI) tests that are
    skipped in the Linux/Docker scripts.

.PARAMETER SkipBuild
    Skip the cargo build step (use the existing .bin\ artifact).

.EXAMPLE
    # Full run
    .\run\test-windows.ps1

    # Skip rebuild (binary already built)
    .\run\test-windows.ps1 -SkipBuild
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# ── Paths ──────────────────────────────────────────────────────

$scriptDir   = $PSScriptRoot
$projectRoot = Split-Path $scriptDir -Parent
$rustDir     = Join-Path $projectRoot "projects\rust"
$binDir      = Join-Path $projectRoot ".bin"
$mssqlDir    = Join-Path $projectRoot "projects\mssql"
$denoTestDir = Join-Path $projectRoot "projects\test\integration\deno"
$nodeTestDir = Join-Path $projectRoot "projects\test\integration\node"
$bunTestDir  = Join-Path $projectRoot "projects\test\integration\bun"

# ── Helper: run an external command and throw on failure ───────

function Invoke-Cmd {
    param([string]$Description, [scriptblock]$Command)
    Write-Host ""
    Write-Host "=== $Description ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed (exit code $LASTEXITCODE)"
    }
}

# ── Helper: capture stdout from external command ───────────────

function Invoke-CmdCapture {
    param([string]$Description, [scriptblock]$Command)
    Write-Host ""
    Write-Host "=== $Description ===" -ForegroundColor Cyan
    $output = & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed (exit code $LASTEXITCODE)"
    }
    return ($output -join "`n").Trim()
}

# ── Detect architecture ────────────────────────────────────────

$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    'Arm64' { "aarch64" }
    default { "x86_64" }
}
$artifact    = "mssqlts-windows-$arch.dll"
$dbgArtifact = "mssqlts-windows-$arch.pdb"

# ── Step 1: Build ─────────────────────────────────────────────

if (-not $SkipBuild) {
    Invoke-Cmd "Building native library (release, opt-level=z)" {
        Push-Location $rustDir
        try {
            cargo build --release
        } finally {
            Pop-Location
        }
    }

    $null = New-Item -ItemType Directory -Path $binDir -Force
    $dllSrc = Join-Path $rustDir "target\release\mssqlts.dll"
    $pdbSrc = Join-Path $rustDir "target\release\mssqlts.pdb"

    Copy-Item $dllSrc (Join-Path $binDir $artifact) -Force
    Write-Host "  Copied: .bin\$artifact" -ForegroundColor Green

    if (Test-Path $pdbSrc) {
        Copy-Item $pdbSrc (Join-Path $binDir $dbgArtifact) -Force
        Write-Host "  Debug:  .bin\$dbgArtifact" -ForegroundColor DarkGray
    }
} else {
    Write-Host ""
    Write-Host "=== Skipping build (-SkipBuild) ===" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $binDir $artifact))) {
        throw "No binary found at .bin\$artifact — run without -SkipBuild first."
    }
}

# ── Step 2: DB setup (Windows auth to SQLEXPRESS) ─────────────
#
# Uses Integrated Security so no SA password is needed.
# The db-setup.ts script detects Windows and configures FILESTREAM + filegroup.

$saConn = "Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true;"
$env:MSSQL_SA_CONNECTION = $saConn

$testConn = Invoke-CmdCapture "Setting up test database" {
    deno run -A "$projectRoot\run\scripts\db-setup.ts"
}

$env:MSSQL_TEST_ENABLED    = "1"
$env:MSSQL_TEST_CONNECTION = $testConn

# ── Run tests (teardown always runs via finally) ───────────────

try {

    # ── Step 3: Deno core unit tests ──────────────────────────

    Invoke-Cmd "Running core unit tests (Deno)" {
        deno test --allow-env $mssqlDir
    }

    # ── Step 4: Deno integration tests ────────────────────────
    # All tests run on Windows: MSSQL, FILESTREAM, SSPI are all live.

    Invoke-Cmd "Running Deno integration tests" {
        deno test `
            --allow-env `
            --allow-net `
            --allow-ffi `
            --allow-read `
            --allow-write `
            $denoTestDir
    }

    # ── Step 5: Node.js integration tests ─────────────────────

    Invoke-Cmd "Installing Node dependencies (koffi)" {
        Push-Location $nodeTestDir
        try {
            if (Test-Path "package-lock.json") { npm ci } else { npm install }
        } finally {
            Pop-Location
        }
    }

    $env:NODE_PATH = Join-Path $nodeTestDir "node_modules"

    Invoke-Cmd "Running Node.js integration tests" {
        $testFiles = (Get-ChildItem -Path $nodeTestDir -Filter "*_test.ts").FullName
        node --test $testFiles
    }

    # ── Step 6: Bun integration tests ─────────────────────────

    Invoke-Cmd "Running Bun integration tests" {
        bun test $bunTestDir
    }

    Write-Host ""
    Write-Host "=== All tests passed ===" -ForegroundColor Green

} finally {

    # ── Teardown: always drop the test database ────────────────

    Write-Host ""
    Write-Host "=== Tearing down test database ===" -ForegroundColor Cyan
    # Don't throw if teardown fails — we want the original error to surface.
    try {
        deno run -A "$projectRoot\run\scripts\db-teardown.ts"
    } catch {
        Write-Warning "Teardown failed: $_"
    }
}

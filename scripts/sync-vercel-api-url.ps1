# Resolve local Vercel CLI (avoids broken npx cache on Windows).
param([string]$AdminWebDir)

function Get-VercelCliPath([string]$root) {
    $local = Join-Path $root "node_modules\.bin\vercel.cmd"
    if (Test-Path $local) { return $local }

    Write-Host "Installing local Vercel CLI (one-time)..."
    Push-Location $root
    try {
        npm install vercel@54.17.1 --save-dev --no-fund --no-audit 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "npm install vercel failed" }
    } finally {
        Pop-Location
    }

    if (Test-Path $local) { return $local }
    throw "Vercel CLI not found after install"
}

function Invoke-VercelCli([string]$root, [string]$workDir, [string[]]$CliArguments) {
    $cli = Get-VercelCliPath $root
    Write-Host "> $cli $($CliArguments -join ' ')"
    $proc = Start-Process -FilePath $cli -ArgumentList $CliArguments -WorkingDirectory $workDir -Wait -PassThru -NoNewWindow
    return $proc.ExitCode
}

function Sync-VercelFromTunnelFile {
    param(
        [string]$Root,
        [string]$VercelAppUrl = "https://qts-job-tracking.vercel.app"
    )

    $urlFile = Join-Path $Root "tunnel-url.txt"
    $adminWeb = Join-Path $Root "admin-web"

    if (-not (Test-Path $urlFile)) {
        throw "Missing tunnel-url.txt - run start-server.bat first"
    }

    $tunnelUrl = (Get-Content $urlFile | Where-Object { $_ -match '^Public API URL:' } | ForEach-Object {
        if ($_ -match '^Public API URL:\s*(.+)$') { $Matches[1].Trim() }
    }) | Select-Object -First 1

    if (-not $tunnelUrl) { throw "Could not read tunnel URL from tunnel-url.txt" }

    Write-Host "Tunnel URL: $tunnelUrl"
    Write-Host "Updating Vercel API_URL..."

    $envExit = Invoke-VercelCli $Root $adminWeb @("env", "add", "API_URL", "production", "--force", "--value", $tunnelUrl, "--yes")
    if ($envExit -ne 0) { throw "Vercel env update failed (exit $envExit)" }

    Write-Host "Redeploying Vercel (about 1-2 minutes)..."
    $deployExit = Invoke-VercelCli $Root $adminWeb @("deploy", "--prod", "--yes")
    if ($deployExit -ne 0) { throw "Vercel deploy failed (exit $deployExit)" }

    Write-Host ""
    Write-Host "Vercel sync OK: $VercelAppUrl" -ForegroundColor Green
    Write-Host "Test: $VercelAppUrl/api/health"
}

if ($MyInvocation.InvocationName -ne '.') {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $projectRoot = Split-Path -Parent $scriptRoot
    try {
        Sync-VercelFromTunnelFile -Root $projectRoot
        exit 0
    } catch {
        Write-Host ""
        Write-Host "SYNC FAILED: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        exit 1
    }
}

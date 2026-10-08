# Start QTS API + Cloudflare quick tunnel (free, no card).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-cloud-tunnel.ps1 [-SyncVercel] [-OpenBrowser]

param(
    [switch]$SyncVercel,
    [switch]$OpenBrowser,
    [string]$VercelAppUrl = "https://qts-job-tracking.vercel.app"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $Root "server"
$BinDir = Join-Path $PSScriptRoot "bin"
$Cloudflared = Join-Path $BinDir "cloudflared.exe"
$UrlFile = Join-Path $Root "tunnel-url.txt"
$LockFile = Join-Path $Root ".cloud-tunnel.lock"
$LogsDir = Join-Path $Root "logs"
$Port = 1028
$apiProc = $null
$tunnel = $null

function Initialize-LogDirectory {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
    Get-ChildItem -Path $Root -Filter "*.log" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Move-Item -Path $_.FullName -Destination $LogsDir -Force -ErrorAction SilentlyContinue
    }
}

function New-LogPath([string]$baseName) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    return Join-Path $LogsDir "$baseName-$stamp.log"
}

function Get-CloudflaredPath {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path $Cloudflared) { return $Cloudflared }
    return $null
}

function Install-CloudflaredLocal {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $release = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Write-Host "Downloading cloudflared..."
    Invoke-WebRequest -Uri $release -OutFile $Cloudflared -UseBasicParsing
}

function Stop-ExistingTunnel {
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Stopping existing cloudflared (PID $($_.Id))..."
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Test-ApiHealth {
    param([int]$ListenPort = $Port)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        $body = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/api/health" -TimeoutSec 3
        return ($body.success -eq $true -and $body.features.documentUploadCategory -eq $true)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Test-FullServerRunning {
    $tunnelProc = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Where-Object { -not $_.HasExited } | Select-Object -First 1
    if (-not $tunnelProc) { return $false }
    return (Test-ApiHealth)
}

function Get-EnvValue([string]$content, [string]$name) {
    foreach ($line in $content -split "`r?`n") {
        if ($line -match "^\s*$([regex]::Escape($name))\s*=\s*(.*?)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Assert-CloudDatabaseConfig {
    $envCloud = Join-Path $ServerDir ".env.cloud"
    if (-not (Test-Path $envCloud)) {
        throw "Missing server/.env.cloud. Copy server/.env.cloud.example to server/.env.cloud, enter your Neon DATABASE_URL and secrets, then run start-server.bat again."
    }

    $content = Get-Content $envCloud -Raw
    $embedded = Get-EnvValue $content "EMBEDDED_PG"
    $databaseUrl = Get-EnvValue $content "DATABASE_URL"
    $databaseSsl = Get-EnvValue $content "DATABASE_SSL"
    if ($embedded -ne "false") {
        throw "server/.env.cloud must set EMBEDDED_PG=false to use Neon."
    }
    if (-not $databaseUrl -or $databaseUrl -match 'xxxx|replace-with|your-|example') {
        throw "Set DATABASE_URL in server/.env.cloud to your real Neon PostgreSQL connection string."
    }
    try {
        $databaseUri = [uri]$databaseUrl
    } catch {
        throw "DATABASE_URL in server/.env.cloud is not a valid PostgreSQL URL."
    }
    if ($databaseUri.Scheme -notin @("postgres", "postgresql") -or -not $databaseUri.Host.EndsWith(".neon.tech", [StringComparison]::OrdinalIgnoreCase)) {
        throw "DATABASE_URL in server/.env.cloud must point to your Neon PostgreSQL host."
    }
    if ($databaseSsl -ne "true") {
        throw "Set DATABASE_SSL=true in server/.env.cloud for the Neon connection."
    }
}

function Stop-PortListener([int]$listenPort) {
    $conn = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Write-Host "Stopping existing process on port $listenPort (PID $($conn.OwningProcess))..."
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

function Test-NeedsApiBuild {
    $distEntry = Join-Path $ServerDir "dist/server.js"
    if (-not (Test-Path $distEntry)) { return $true }

    $featureRoute = Join-Path $ServerDir "dist/modules/application-sessions/application-sessions.routes.js"
    if (-not (Test-Path $featureRoute)) { return $true }

    $tasksRoute = Join-Path $ServerDir "dist/modules/application-sessions/application-tasks.routes.js"
    if (-not (Test-Path $tasksRoute)) { return $true }

    $sessionsRoute = Join-Path $ServerDir "dist/modules/application-sessions/application-sessions.routes.js"
    if (Test-Path $sessionsRoute) {
        $routeText = Get-Content $sessionsRoute -Raw
        if ($routeText -notmatch 'document_upload') { return $true }
    }

    $srcApp = Join-Path $ServerDir "src/app.ts"
    if (Test-Path $srcApp) {
        $srcTime = (Get-Item $srcApp).LastWriteTimeUtc
        $distTime = (Get-Item $distEntry).LastWriteTimeUtc
        if ($srcTime -gt $distTime) { return $true }
    }

    return $false
}

function Start-ApiServer {
    $envCloud = Join-Path $ServerDir ".env.cloud"
    Write-Host "Using server/.env.cloud (Neon)"

    Push-Location $ServerDir
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "Installing API dependencies..."
            npm ci --no-fund --no-audit 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { npm install --no-fund --no-audit 2>&1 | Out-Host }
            if ($LASTEXITCODE -ne 0) { throw "API dependency install failed" }
        } elseif (-not (Test-Path "node_modules\debug\src\index.js")) {
            Write-Host "Repairing corrupted API dependencies..."
            Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
            npm ci --no-fund --no-audit 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { npm install --no-fund --no-audit 2>&1 | Out-Host }
            if ($LASTEXITCODE -ne 0) { throw "API dependency repair failed" }
        }

        if (Test-NeedsApiBuild) {
            Write-Host "Building API..."
            npm run build 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "API build failed (exit $LASTEXITCODE)" }
        }

        Stop-PortListener $Port

        Write-Host "Starting API on http://localhost:$Port ..."
        $apiLog = New-LogPath "api-cloud"
        $apiErr = New-LogPath "api-cloud.err"
        Write-Host "API logs: $apiLog"
        $previousEnvFile = $env:QTS_ENV_FILE
        $env:QTS_ENV_FILE = $envCloud
        try {
            $apiProc = Start-Process -FilePath "node" -ArgumentList "dist/server.js" -WorkingDirectory $ServerDir `
                -RedirectStandardOutput $apiLog -RedirectStandardError $apiErr -PassThru -WindowStyle Hidden
        } finally {
            if ($null -eq $previousEnvFile) {
                Remove-Item Env:QTS_ENV_FILE -ErrorAction SilentlyContinue
            } else {
                $env:QTS_ENV_FILE = $previousEnvFile
            }
        }

        $deadline = (Get-Date).AddSeconds(90)
        while ((Get-Date) -lt $deadline) {
            if ($apiProc.HasExited) {
                throw "API process exited early. See $apiErr"
            }
            if (Test-ApiHealth) {
                Write-Host "API is online."
                return $apiProc
            }
            Start-Sleep -Seconds 2
        }
        throw "API did not start in time. See logs\$([System.IO.Path]::GetFileName($apiLog)) and logs\$([System.IO.Path]::GetFileName($apiErr))"
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
}

function Start-Tunnel([string]$cfPath, [int]$listenPort) {
    Write-Host "Starting Cloudflare tunnel..."
    $tunnelOut = New-LogPath "tunnel-cloud"
    $tunnelErr = New-LogPath "tunnel-cloud.err"

    $tunnelProc = Start-Process -FilePath $cfPath `
        -ArgumentList "tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:$listenPort" `
        -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(60)
    $publicUrl = $null
    while ((Get-Date) -lt $deadline) {
        foreach ($logPath in @($tunnelOut, $tunnelErr)) {
            if (Test-Path $logPath) {
                $log = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
                if ($log -match "https://[a-z0-9-]+\.trycloudflare\.com") {
                    $publicUrl = $Matches[0]
                    break
                }
            }
        }
        if ($publicUrl) { break }
        Start-Sleep -Seconds 2
    }

    if (-not $publicUrl) {
        if (-not $tunnelProc.HasExited) {
            Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
        }
        throw "Tunnel URL not found. See $tunnelOut and $tunnelErr"
    }

    $healthUrl = "$publicUrl/api/health"
    $healthDeadline = (Get-Date).AddSeconds(45)
    $healthy = $false
    while ((Get-Date) -lt $healthDeadline) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
            if ($health.success -eq $true) {
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 3
        }
    }
    if (-not $healthy) {
        if (-not $tunnelProc.HasExited) {
            Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
        }
        throw "Cloudflare tunnel started, but its API health check failed at $healthUrl"
    }

    return @{ Url = $publicUrl; Process = $tunnelProc; Log = $tunnelOut }
}

function Sync-VercelApiUrl([string]$vercelAppUrl) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if (-not (Get-Command Sync-VercelFromTunnelFile -ErrorAction SilentlyContinue)) {
            $syncScript = Join-Path $PSScriptRoot "sync-vercel-api-url.ps1"
            . $syncScript
        }
        Sync-VercelFromTunnelFile -Root $Root -VercelAppUrl $vercelAppUrl
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Assert-VercelReady {
    $projectFile = Join-Path $Root "admin-web\.vercel\project.json"
    if (-not (Test-Path $projectFile)) {
        throw "Vercel project is not linked. Run .\node_modules\.bin\vercel.cmd login, then from admin-web run ..\node_modules\.bin\vercel.cmd link and select qts-job-tracking."
    }

    $syncScript = Join-Path $PSScriptRoot "sync-vercel-api-url.ps1"
    . $syncScript
    if ((Invoke-VercelCli $Root (Join-Path $Root "admin-web") @("whoami")) -ne 0) {
        throw "Vercel CLI is not logged in. Run .\node_modules\.bin\vercel.cmd login, then start-server.bat again."
    }
}

function Show-ReadyBanner([string]$vercelAppUrl) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  QTS SERVER IS RUNNING" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Admin login:     $vercelAppUrl/login"
    Write-Host "  Extension URL:   $vercelAppUrl"
    Write-Host ""
    Write-Host "  DO NOT CLOSE THIS WINDOW" -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
}

function Get-RunningServer {
    $tunnelProc = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Where-Object { -not $_.HasExited } | Select-Object -First 1
    if (-not $tunnelProc) { return $null }

    $apiConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $apiConn) { return $null }

    $apiProc = Get-Process -Id $apiConn.OwningProcess -ErrorAction SilentlyContinue
    if (-not $apiProc -or $apiProc.HasExited) { return $null }
    if (-not (Test-ApiHealth)) { return $null }

    return @{
        ApiProc = $apiProc
        TunnelProc = $tunnelProc
    }
}

function Watch-Server($apiProc, $tunnelProc, $lockFile) {
    try {
        while ($true) {
            if ($apiProc.HasExited) { throw "API process stopped unexpectedly." }
            if ($tunnelProc.HasExited) { throw "Tunnel process stopped unexpectedly." }
            Start-Sleep -Seconds 5
        }
    } finally {
        Write-Host "Stopping..."
        Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
        Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
    }
}

# --- main ---
Initialize-LogDirectory
$LogFile = Join-Path $LogsDir "start-server-last.log"
try {
    Start-Transcript -Path $LogFile -Force | Out-Null
} catch {}

try {
Write-Host ""
Write-Host "=== QTS Cloudflare Tunnel ===" -ForegroundColor Cyan
Write-Host ""

Assert-CloudDatabaseConfig
if ($SyncVercel) { Assert-VercelReady }

$cf = Get-CloudflaredPath
if (-not $cf) {
    try {
        winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements | Out-Null
        $cf = Get-CloudflaredPath
    } catch {}
}
if (-not $cf) {
    Install-CloudflaredLocal
    $cf = Get-CloudflaredPath
}
if (-not $cf) { throw "cloudflared not found. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" }

$lockFile = $LockFile
$running = Get-RunningServer
if ($running -and $running.ApiProc -and $running.TunnelProc) {
    Write-Host ""
    Write-Host "Server already running. Keeping it alive in this window." -ForegroundColor Yellow
    if (Test-Path $UrlFile) { Write-Host ""; Get-Content $UrlFile }
    if ($SyncVercel) {
        Sync-VercelApiUrl -vercelAppUrl $VercelAppUrl
    }
    Show-ReadyBanner $VercelAppUrl
    if ($OpenBrowser) { Start-Process "$VercelAppUrl/login" }
    Watch-Server -apiProc $running.ApiProc -tunnelProc $running.TunnelProc -lockFile $lockFile
    exit 0
}

if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }

Stop-ExistingTunnel

$apiProc = Start-ApiServer
$tunnel = Start-Tunnel -cfPath $cf -listenPort $Port

$lockPid = "$($apiProc.Id),$($tunnel.Process.Id)"
Set-Content -Path $lockFile -Value $lockPid -Encoding UTF8

@(
    "Public API URL: $($tunnel.Url)"
    "Health check:   $($tunnel.Url)/api/health"
    "Vercel API_URL: $($tunnel.Url)"
    "Extension URL:  $VercelAppUrl"
    "Admin login:    $VercelAppUrl/login"
    ""
    "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "API PID: $($apiProc.Id)"
    "Tunnel PID: $($tunnel.Process.Id)"
) | Set-Content -Path $UrlFile -Encoding UTF8

if ($SyncVercel) {
    $vercelOk = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            if ($attempt -gt 1) { Write-Host "Retrying Vercel sync (attempt $attempt)..." -ForegroundColor Yellow }
            Sync-VercelApiUrl -vercelAppUrl $VercelAppUrl
            $vercelOk = $true
            break
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }
    if (-not $vercelOk) {
        Write-Host ""
        throw "Vercel could not be synced to the tunnel. Check Vercel login/link and deployment output, then retry start-server.bat."
    }
}

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "Public URL: $($tunnel.Url)" -ForegroundColor Yellow
Write-Host "Saved to:   $UrlFile"
Write-Host ""
Show-ReadyBanner $VercelAppUrl
if ($OpenBrowser) { Start-Process "$VercelAppUrl/login" }
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""

Watch-Server -apiProc $apiProc -tunnelProc $tunnel.Process -lockFile $lockFile

} catch {
    if ($tunnel -and $tunnel.Process -and -not $tunnel.Process.HasExited) {
        Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($apiProc -and -not $apiProc.HasExited) {
        Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
    if ($tunnel -and (Test-Path $UrlFile)) {
        Remove-Item $UrlFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "See logs\start-server-last.log for full details." -ForegroundColor Yellow
    Write-Host ""
    exit 1
} finally {
    try { Stop-Transcript | Out-Null } catch {}
}

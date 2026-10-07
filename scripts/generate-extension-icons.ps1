# Generate Chrome extension toolbar + install icons from WYS bidder logo.
# Usage: powershell -File scripts/generate-extension-icons.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$assets = Join-Path $root 'extension\assets'
$src = Join-Path $assets 'bidder-logo.png'

if (-not (Test-Path $src)) {
  $fallback = Join-Path $root 'admin-web\public\bidder-logo.png'
  if (Test-Path $fallback) { Copy-Item $fallback $src }
  else { throw "Missing bidder-logo.png in extension/assets" }
}

Add-Type -AssemblyName System.Drawing

function New-ExtensionIcon {
  param([int]$Size, [string]$OutPath, [double]$PaddingRatio = 0.06)

  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(15, 23, 42))

  $pad = [int][Math]::Round($Size * $PaddingRatio)
  $inner = $Size - (2 * $pad)
  $g.DrawImage($img, $pad, $pad, $inner, $inner)
  $g.Dispose()
  $img.Dispose()

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

foreach ($size in 16, 32, 48, 128) {
  $padding = if ($size -le 16) { 0.04 } elseif ($size -le 32) { 0.05 } else { 0.06 }
  $out = Join-Path $assets "icon$size.png"
  New-ExtensionIcon -Size $size -OutPath $out -PaddingRatio $padding
  Write-Host "Wrote $out"
}

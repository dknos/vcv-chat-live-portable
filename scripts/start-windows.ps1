[CmdletBinding()]
param(
  [string]$ChatFile,
  [int]$OverlayPort = 9392,
  [switch]$DryRun,
  [switch]$Immediate
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$HomeRoot = Split-Path -Parent $ProjectRoot

if (-not $ChatFile) {
  $ChatFile = Join-Path $HomeRoot 'netify-dev\public\data\live-session.json'
}

$Node = (Get-Command node.exe -ErrorAction Stop).Source
$env:CHAT_SESSION_FILE = $ChatFile
$env:OSC_HOST = '127.0.0.1'
$env:OVERLAY_HOST = '127.0.0.1'
$env:OVERLAY_PORT = [string]$OverlayPort
if ($DryRun) { $env:DRY_RUN = '1' }
if ($Immediate) { $env:QUANTIZE_BARS = '0' }

Write-Host "[launcher] Node: $Node"
Write-Host "[launcher] Chat: $ChatFile"
Write-Host "[launcher] Overlay: http://127.0.0.1:$OverlayPort/overlay"
Write-Host "[launcher] OSC: 127.0.0.1:7001"

& $Node (Join-Path $ProjectRoot 'src\main.js')
exit $LASTEXITCODE

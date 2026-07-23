[CmdletBinding()]
param(
  [ValidateSet('start', 'stop', 'status', 'restart')]
  [string]$Action = 'start',

  [string]$ProjectRoot = '',
  [string]$ChatFile = '',
  [int]$OverlayPort = 9392,
  [string]$AudioReactiveInput = 'SAMSON LIVE MIC',
  [string]$CameraReactiveSource = 'Mic Vision Feed',
  [switch]$Immediate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
if ([string]::IsNullOrWhiteSpace($ChatFile)) {
  $ChatFile = Join-Path $ProjectRoot 'state\live-session.json'
}

$stateDirectory = Join-Path $env:LOCALAPPDATA 'VCVChatLive'
$pidFile = Join-Path $stateDirectory 'bridge.pid'
$stdoutLog = Join-Path $stateDirectory 'bridge.out.log'
$stderrLog = Join-Path $stateDirectory 'bridge.err.log'

function Get-ManagedProcess {
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
  $raw = [IO.File]::ReadAllText($pidFile).Trim()
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) { return $null }
  return Get-Process -Id $pidValue -ErrorAction SilentlyContinue
}

function Stop-ManagedProcess {
  $process = Get-ManagedProcess
  if ($process) {
    Stop-Process -Id $process.Id -ErrorAction Stop
    $process.WaitForExit(5000) | Out-Null
    Write-Host "[bridge] stopped PID $($process.Id)"
  } else {
    Write-Host '[bridge] not running'
  }
  if (Test-Path -LiteralPath $pidFile -PathType Leaf) { Remove-Item -LiteralPath $pidFile -Force }
}

if ($Action -eq 'status') {
  $process = Get-ManagedProcess
  if ($process) {
    Write-Host "[bridge] running PID $($process.Id)"
    Write-Host "[bridge] overlay http://127.0.0.1:$OverlayPort/overlay"
    exit 0
  }
  Write-Host '[bridge] stopped'
  exit 1
}

if ($Action -eq 'stop') {
  Stop-ManagedProcess
  exit 0
}

if ($Action -eq 'restart') { Stop-ManagedProcess }

$existing = Get-ManagedProcess
if ($existing) {
  Write-Host "[bridge] already running PID $($existing.Id)"
  exit 0
}

$entry = Join-Path $ProjectRoot 'src\main.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Bridge entry not found: $entry" }
if (-not (Test-Path -LiteralPath $ChatFile -PathType Leaf)) { throw "Chat feed not found: $ChatFile" }
$node = (Get-Command node.exe -ErrorAction Stop).Source

[IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
if (Test-Path -LiteralPath $pidFile -PathType Leaf) { Remove-Item -LiteralPath $pidFile -Force }

$env:CHAT_SESSION_FILE = $ChatFile
$env:OSC_HOST = '127.0.0.1'
$env:OVERLAY_HOST = '127.0.0.1'
$env:OVERLAY_PORT = [string]$OverlayPort
$env:OBS_AUDIO_REACTIVE_INPUT = $AudioReactiveInput
$env:OBS_CAMERA_REACTIVE_SOURCE = $CameraReactiveSource
if ($Immediate) { $env:QUANTIZE_BARS = '0' }

$process = Start-Process -FilePath $node -ArgumentList "`"$entry`"" -WorkingDirectory $env:TEMP `
  -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText($pidFile, [string]$process.Id)
Start-Sleep -Milliseconds 1200
if ($process.HasExited) {
  $errorTail = if (Test-Path -LiteralPath $stderrLog) { ([IO.File]::ReadAllLines($stderrLog) | Select-Object -Last 8) -join ' ' } else { '' }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  throw "Bridge exited during startup. $errorTail"
}

Write-Host "[bridge] started PID $($process.Id)"
Write-Host "[bridge] overlay http://127.0.0.1:$OverlayPort/overlay"
Write-Host "[bridge] logs $stateDirectory"

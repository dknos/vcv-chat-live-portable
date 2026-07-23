[CmdletBinding()]
param(
  [ValidateSet('start', 'stop', 'status', 'restart')]
  [string]$Action = 'start',

  [string]$RackPath = 'C:\Program Files\VCV\Rack2Free\Rack.exe',
  [string]$PatchPath = (Join-Path $env:LOCALAPPDATA 'Rack2\patches\ChatRack-Live.vcv'),
  [int]$ExpectedModules = 54,
  [int]$ExpectedCables = 98
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RackProcess {
  Get-Process Rack -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Stop-Rack {
  $rack = Get-RackProcess
  if (-not $rack) {
    Write-Host '[rack] stopped'
    return
  }
  Stop-Process -Id $rack.Id -Force
  $rack.WaitForExit(5000) | Out-Null
  Write-Host "[rack] stopped PID $($rack.Id)"
}

function Test-LoadedPatch([Diagnostics.Process]$Process) {
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  $autosave = Join-Path $env:LOCALAPPDATA 'Rack2\autosave\patch.json'
  $patchName = [IO.Path]::GetFileName($PatchPath)
  do {
    Start-Sleep -Milliseconds 500
    $Process.Refresh()
    if ($Process.HasExited) { throw 'Rack exited while loading the managed patch' }
    if ($Process.MainWindowTitle -like "*$patchName*" -and (Test-Path -LiteralPath $autosave -PathType Leaf)) {
      try {
        $state = [IO.File]::ReadAllText($autosave) | ConvertFrom-Json
        $modules = @($state.modules).Count
        $cables = @($state.cables).Count
        if ($modules -eq $ExpectedModules -and $cables -eq $ExpectedCables) {
          Write-Host "[rack] verified $modules modules / $cables cables"
          return
        }
      } catch { }
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Rack opened without the expected patch ($ExpectedModules modules / $ExpectedCables cables)"
}

if ($Action -eq 'status') {
  $rack = Get-RackProcess
  if (-not $rack) { Write-Host '[rack] stopped'; exit 1 }
  Write-Host "[rack] running PID $($rack.Id): $($rack.MainWindowTitle)"
  exit 0
}

if ($Action -eq 'stop') { Stop-Rack; exit 0 }
if ($Action -eq 'restart') { Stop-Rack }

$existing = Get-RackProcess
if ($existing) {
  Write-Host "[rack] already running PID $($existing.Id): $($existing.MainWindowTitle)"
  exit 0
}
if (-not (Test-Path -LiteralPath $RackPath -PathType Leaf)) { throw "Rack not found: $RackPath" }
if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) { throw "Patch not found: $PatchPath" }

$workingDirectory = [IO.Path]::GetDirectoryName($RackPath)
$quotedPatch = '"' + $PatchPath + '"'
$process = Start-Process -FilePath $RackPath -WorkingDirectory $workingDirectory -ArgumentList $quotedPatch -PassThru
try {
  Test-LoadedPatch $process
  Write-Host "[rack] started PID $($process.Id): $($process.MainWindowTitle)"
} catch {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  throw
}

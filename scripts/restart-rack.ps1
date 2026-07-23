[CmdletBinding()]
param(
  [ValidateRange(5, 60)]
  [int]$TimeoutSeconds = 25
)

# Controlled reload of the one managed Rack patch. This deliberately refuses to
# force-kill a process or launch a different executable/patch.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rackExe = Join-Path $env:ProgramFiles 'VCV\Rack2Free\Rack.exe'
$patch = Join-Path $env:LOCALAPPDATA 'Rack2\patches\ChatRack-Live.vcv'
$expectedTitle = 'VCV Rack Free 2.6.6 - ChatRack-Live.vcv'
$expectedTitlePattern = '^VCV Rack Free 2\.6\.6 - \*?ChatRack-Live\.vcv$'

if (-not (Test-Path -LiteralPath $rackExe -PathType Leaf)) {
  throw "Managed Rack executable was not found: $rackExe"
}
if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) {
  throw "Managed Rack patch was not found: $patch"
}

$racks = @(Get-Process -Name Rack -ErrorAction SilentlyContinue)
if ($racks.Count -ne 1) {
  throw "Expected exactly one running Rack.exe process; found $($racks.Count)."
}
$rack = $racks[0]
$rack.Refresh()
if ($rack.MainWindowTitle -notmatch $expectedTitlePattern) {
  throw "Rack is not showing the managed patch: '$($rack.MainWindowTitle)'."
}
if (-not $rack.CloseMainWindow()) {
  throw 'Windows refused Rack’s normal close request.'
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while (-not $rack.HasExited -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $rack.Refresh()
}
if (-not $rack.HasExited) {
  throw 'Rack did not close normally before timeout; it was not force-stopped.'
}

$started = Start-Process -FilePath $rackExe -ArgumentList "`"$patch`"" -WorkingDirectory (Split-Path -Parent $rackExe) -PassThru
do {
  Start-Sleep -Milliseconds 250
  $started.Refresh()
  if ($started.HasExited) {
    throw "Rack exited during startup with code $($started.ExitCode)."
  }
} while (($started.MainWindowHandle -eq [IntPtr]::Zero -or $started.MainWindowTitle -notmatch $expectedTitlePattern) -and [DateTime]::UtcNow -lt $deadline)

if ($started.MainWindowHandle -eq [IntPtr]::Zero -or $started.MainWindowTitle -notmatch $expectedTitlePattern) {
  throw 'Rack did not reopen the managed patch before timeout.'
}

Write-Host "[rack-restart] Reloaded $expectedTitle (PID $($started.Id))."

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('live', 'doom')]
  [string]$Profile,

  [ValidateRange(5, 60)]
  [int]$TimeoutSeconds = 30,

  [string]$RackPath = 'C:\Program Files\VCV\Rack2Free\Rack.exe',

  # Use only after independently confirming OBS is neither recording nor
  # streaming. A profile switch briefly removes Rack from window capture.
  [switch]$AllowObsRunning
)

# Checked profile switcher for the repository-owned Rack documents. It
# requests a normal close, never force-stops Rack, and does not touch OBS.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$profiles = @{
  live = @{
    File = 'ChatRack-Live.vcv'
    Modules = 54
    Cables = 98
  }
  doom = @{
    File = 'Doom-Jazz-Machine.vcv'
    Modules = 59
    Cables = 120
  }
}

$selected = $profiles[$Profile]
$repositoryPatchPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\patches\$($selected.File)"))
$patchPath = Join-Path $env:LOCALAPPDATA "Rack2\patches\$($selected.File)"
$autosavePath = Join-Path $env:LOCALAPPDATA 'Rack2\autosave\patch.json'
$expectedTitle = "VCV Rack Free 2.6.6 - $($selected.File)"
$expectedPattern = '^VCV Rack Free 2\.6\.6 - ' + [Regex]::Escape($selected.File) + '$'
$dirtyPattern = '^VCV Rack Free 2\.6\.6 - \*' + [Regex]::Escape($selected.File) + '$'

if (-not (Test-Path -LiteralPath $RackPath -PathType Leaf)) {
  throw "Rack executable not found: $RackPath"
}
if (-not (Test-Path -LiteralPath $repositoryPatchPath -PathType Leaf)) {
  throw "Repository Rack profile not found: $repositoryPatchPath"
}

function Test-ExpectedAutosave {
  if (-not (Test-Path -LiteralPath $autosavePath -PathType Leaf)) { return $false }
  try {
    $state = [IO.File]::ReadAllText($autosavePath) | ConvertFrom-Json
    return @($state.modules).Count -eq $selected.Modules -and @($state.cables).Count -eq $selected.Cables
  } catch {
    return $false
  }
}

$artifactMatches = (Test-Path -LiteralPath $patchPath -PathType Leaf) -and
  ((Get-FileHash -LiteralPath $repositoryPatchPath -Algorithm SHA256).Hash -eq
   (Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash)

$racks = @(Get-Process -Name Rack -ErrorAction SilentlyContinue)
if ($racks.Count -gt 1) {
  throw "Expected zero or one Rack process; found $($racks.Count)."
}
if ($racks.Count -eq 1) {
  $rack = $racks[0]
  $rack.Refresh()
  if ($rack.MainWindowTitle -match $dirtyPattern) {
    throw "Rack has unsaved changes in $($selected.File); save or discard them manually before switching profiles."
  }
  if ($rack.MainWindowTitle -match $expectedPattern -and $artifactMatches -and (Test-ExpectedAutosave)) {
    Write-Host "[rack-profile] already loaded: $expectedTitle (PID $($rack.Id))"
    exit 0
  }
  if (@(Get-Process -Name obs64 -ErrorAction SilentlyContinue).Count -gt 0 -and -not $AllowObsRunning) {
    throw 'OBS is running; close it first, or pass -AllowObsRunning only after confirming recording and streaming are stopped.'
  }
  if (-not $rack.CloseMainWindow()) {
    throw "Windows refused Rack's normal close request; the current patch was left running."
  }
  $closeDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (-not $rack.HasExited -and [DateTime]::UtcNow -lt $closeDeadline) {
    Start-Sleep -Milliseconds 250
    $rack.Refresh()
  }
  if (-not $rack.HasExited) {
    throw 'Rack did not close normally before the timeout; it was not force-stopped.'
  }
}

if ($racks.Count -eq 0 -and
    @(Get-Process -Name obs64 -ErrorAction SilentlyContinue).Count -gt 0 -and
    -not $AllowObsRunning) {
  throw 'OBS is running; close it first, or pass -AllowObsRunning only after confirming recording and streaming are stopped.'
}

[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($patchPath)) | Out-Null
if (-not $artifactMatches) {
  Copy-Item -LiteralPath $repositoryPatchPath -Destination $patchPath -Force
  Write-Host "[rack-profile] synced repository artifact to $patchPath"
}

$workingDirectory = [IO.Path]::GetDirectoryName($RackPath)
$started = Start-Process -FilePath $RackPath -WorkingDirectory $workingDirectory -ArgumentList "`"$patchPath`"" -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Milliseconds 250
  $started.Refresh()
  if ($started.HasExited) {
    throw "Rack exited while loading $($selected.File), code $($started.ExitCode)."
  }
  if ($started.MainWindowTitle -match $expectedPattern -and (Test-ExpectedAutosave)) {
    Write-Host "[rack-profile] loaded $($selected.File): $($selected.Modules) modules / $($selected.Cables) cables (PID $($started.Id))"
    exit 0
  }
} while ([DateTime]::UtcNow -lt $deadline)

throw "Rack did not verify $($selected.File) as $($selected.Modules) modules / $($selected.Cables) cables before timeout."

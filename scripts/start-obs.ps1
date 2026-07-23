[CmdletBinding()]
param(
  [switch]$Record,
  [switch]$Stream,
  [switch]$NormalMode,

  [switch]$ValidateOnly,

  [ValidateSet('rack', 'phone')]
  [string]$Mode = 'rack'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$obsRunning = @(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0
if ($obsRunning -and -not $ValidateOnly) {
  throw 'OBS is already running.'
}

$obsDirectory = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit'
$obsExe = Join-Path $obsDirectory 'obs64.exe'
if (-not (Test-Path -LiteralPath $obsExe -PathType Leaf)) {
  throw "OBS was not found: $obsExe"
}

$profilePath = Join-Path $env:APPDATA 'obs-studio\basic\profiles\VCV_Rack_Live\basic.ini'
$collectionPath = Join-Path $env:APPDATA 'obs-studio\basic\scenes\VCV_Rack_Live.json'
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $collectionPath -PathType Leaf)) {
  throw 'The VCV Rack Live OBS profile/collection is missing. Run prepare-obs.ps1 first.'
}

$sceneName = if ($Mode -eq 'phone') { 'Phone Live' } else { 'Rack Live' }
if ($Mode -eq 'phone') {
  $pluginPath = Join-Path $env:ProgramFiles 'obs-studio\obs-plugins\64bit\droidcam-obs.dll'
  $expectedPluginHash = '60ed395b2e22de50e281387d1ed0611faab44509d9eb0eb00fc05e64bd2a73b7'
  if (-not (Test-Path -LiteralPath $pluginPath -PathType Leaf)) {
    throw 'DroidCam OBS is not installed. Phone mode was not started.'
  }
  $actualPluginHash = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualPluginHash -ne $expectedPluginHash) {
    throw 'The DroidCam OBS plugin changed since it was reviewed. Verify the update and refresh the pinned hash before using phone mode.'
  }

  $collection = [IO.File]::ReadAllText($collectionPath) | ConvertFrom-Json
  $phoneScene = @($collection.sources | Where-Object { $_.id -eq 'scene' -and $_.name -eq $sceneName })
  $droidCam = @($collection.sources | Where-Object { $_.id -eq 'droidcam_obs' -and $_.name -eq 'DroidCam Phone' })
  $phoneOverlay = @($collection.sources | Where-Object {
    $_.id -eq 'browser_source' -and $_.name -eq 'Chat Music Overlay Phone'
  })
  $rackAudio = @($collection.sources | Where-Object {
    $_.id -eq 'wasapi_process_output_capture' -and $_.name -eq 'Rack Audio'
  })
  $phoneMarker = $collection.modules.'vcv-chat-live'.phone_live
  $forbiddenCapture = @($collection.sources | Where-Object {
    ([string]$_.id) -match '^(?:monitor_capture|display_capture|screen_capture|xshm_input|pipewire-screen-capture-source)$' -or
    ([string]$_.versioned_id) -match '^(?:monitor_capture|display_capture|screen_capture|xshm_input|pipewire-screen-capture-source)$'
  })
  $nestedCapturePattern = '(?i)"(?:id|versioned_id)"\s*:\s*"(?:monitor_capture|display_capture|screen_capture|xshm_input|pipewire-screen-capture-source)"'
  if (($collection | ConvertTo-Json -Depth 100 -Compress) -match $nestedCapturePattern) {
    throw 'A nested display/screen capture descriptor exists in the managed collection; phone mode was not started.'
  }
  if ($phoneScene.Count -ne 1 -or $droidCam.Count -ne 1 -or $phoneOverlay.Count -ne 1 -or
      $rackAudio.Count -ne 1 -or $null -eq $phoneMarker -or $phoneMarker.managed -ne $true) {
    throw 'The managed Phone Live scene is missing. Run prepare-obs-phone.ps1 while OBS is closed.'
  }
  if ($phoneMarker.scene_source_uuid -ne $phoneScene[0].uuid -or
      $phoneMarker.droidcam_source_uuid -ne $droidCam[0].uuid -or
      $phoneMarker.overlay_source_uuid -ne $phoneOverlay[0].uuid -or
      $phoneMarker.rack_audio_source_uuid -ne $rackAudio[0].uuid) {
    throw 'The managed Phone Live marker does not match its sources.'
  }
  if ([int64]$droidCam[0].mixers -ne 0 -or [int]$droidCam[0].monitoring_type -ne 0 -or
      $droidCam[0].muted -ne $true) {
    throw 'DroidCam audio is not isolated; phone mode requires mixers=0 and monitoring=off.'
  }
  if ($phoneOverlay[0].settings.url -ne 'http://127.0.0.1:9392/overlay?layout=phone' -or
      $phoneOverlay[0].settings.reroute_audio -ne $true -or
      [int]$phoneOverlay[0].settings.width -ne 1080 -or
      [int]$phoneOverlay[0].settings.height -ne 1920 -or
      [int64]$phoneOverlay[0].mixers -eq 0 -or
      [int64]$rackAudio[0].mixers -eq 0 -or
      [int]$rackAudio[0].monitoring_type -ne 0) {
    throw 'The phone overlay or Rack-only audio isolation failed validation.'
  }
  $phoneItems = @($phoneScene[0].settings.items)
  $expectedPhoneUuids = @($droidCam[0].uuid, $rackAudio[0].uuid, $phoneOverlay[0].uuid)
  if ($phoneItems.Count -ne 3 -or @($phoneItems | Where-Object { $_.locked -ne $true }).Count -ne 0 -or
      @($phoneItems | Where-Object { $_.source_uuid -notin $expectedPhoneUuids }).Count -ne 0 -or
      $phoneItems[0].source_uuid -ne $droidCam[0].uuid -or
      $phoneItems[1].source_uuid -ne $rackAudio[0].uuid -or
      $phoneItems[2].source_uuid -ne $phoneOverlay[0].uuid) {
    throw 'Phone Live must contain exactly the locked DroidCam, Rack Audio, and phone overlay sources.'
  }
  if ($forbiddenCapture.Count -gt 0) {
    throw 'A display/screen capture source exists in the managed collection; phone mode was not started.'
  }

  # DroidCam is a reviewed third-party OBS source, so this mode intentionally
  # loads normal plugins. Rack mode remains bundled-only by default.
  $NormalMode = $true
}

if ($ValidateOnly) {
  Write-Host "[obs-start] $sceneName launch validation passed; no process was started."
  exit 0
}

if ($Stream) {
  $servicePath = Join-Path $env:APPDATA 'obs-studio\basic\profiles\VCV_Rack_Live\service.json'
  if (-not (Test-Path -LiteralPath $servicePath -PathType Leaf)) {
    throw 'YouTube service.json is missing. Run configure-obs-youtube.ps1 first.'
  }
}

if (($Record -or $Stream) -and $Mode -eq 'rack') {
  $rackCaptureScript = Join-Path $PSScriptRoot 'set-rack-capture-window.ps1'
  if (-not (Test-Path -LiteralPath $rackCaptureScript -PathType Leaf)) {
    throw "Rack capture window helper is missing: $rackCaptureScript"
  }
  & $rackCaptureScript -Action Enable
}

$arguments = "--disable-shutdown-check --profile `"VCV Rack Live`" --collection `"VCV Rack Live`" --scene `"$sceneName`""
if (-not $NormalMode) { $arguments += ' --only-bundled-plugins' }
if ($Record) { $arguments += ' --startrecording' }
if ($Stream) { $arguments += ' --startstreaming' }
if ($Record -or $Stream) { $arguments += ' --minimize-to-tray' }

$process = Start-Process -FilePath $obsExe -WorkingDirectory $obsDirectory -ArgumentList $arguments -PassThru
Write-Host "[obs-start] OBS started (PID $($process.Id)) in $sceneName mode."
if (-not $NormalMode) { Write-Host '[obs-start] Bundled-only mode is active; third-party plugins and scripts are disabled.' }
if ($Mode -eq 'phone') { Write-Host '[obs-start] Reviewed DroidCam plugin mode is active; phone and desktop audio remain excluded.' }
if ($Record) { Write-Host '[obs-start] Local recording was requested.' }
if ($Stream) { Write-Host '[obs-start] YouTube streaming was requested.' }

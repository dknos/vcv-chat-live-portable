[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$OverlayPort = 9392,

  [ValidateRange(0, 8192)]
  [int]$RackCropLeft = 70,

  [ValidateRange(0, 8192)]
  [int]$RackCropRight = 70,

  [ValidateRange(0, 8192)]
  [int]$RackCropTop = 0,

  [ValidateRange(0, 8192)]
  [int]$RackCropBottom = 0,

  [switch]$ValidateOnly,

  [switch]$RefreshManaged
)

# Offline creator for OBS 32.1.x. It deliberately does not select the new
# profile/collection, connect a streaming service, or read/copy another
# profile. Existing OBS configuration files are outside its write set.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProfileName = 'VCV Rack Live'
$ProfileDirectoryName = 'VCV_Rack_Live'
$CollectionName = 'VCV Rack Live'
$CollectionFileName = 'VCV_Rack_Live.json'
$SceneName = 'Rack Live'
$ManagedBy = 'vcv-chat-live/scripts/prepare-obs.ps1'
$SchemaVersion = 4
$ObsVersionPacked = 536936450 # OBS 32.1.2
$CanvasWidth = 1080
$CanvasHeight = 1920
$MainCanvasUuid = '6c69626f-6273-4c00-9d88-c5136d61696e'
$RackWindowSelector = 'VCV Rack:GLFW30:Rack.exe'
$ManagedHotkeys = [ordered]@{
  'OBSBasic.StartRecording' = 'OBS_KEY_F9'
  'OBSBasic.StopRecording' = 'OBS_KEY_F10'
  'OBSBasic.StartStreaming' = 'OBS_KEY_F11'
  'OBSBasic.StopStreaming' = 'OBS_KEY_F12'
}

function Test-ObsRunning {
  return @(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0
}

function New-ObsSource {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Uuid,
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Settings,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Hotkeys,
    [int]$Mixers = 255,
    [ValidateSet(0, 1, 2)][int]$MonitoringType = 0
  )

  return [ordered]@{
    prev_ver = $ObsVersionPacked
    name = $Name
    uuid = $Uuid
    id = $Id
    versioned_id = $Id
    settings = $Settings
    mixers = $Mixers
    sync = 0
    flags = 0
    volume = 1.0
    balance = 0.5
    enabled = $true
    muted = $false
    'push-to-mute' = $false
    'push-to-mute-delay' = 0
    'push-to-talk' = $false
    'push-to-talk-delay' = 0
    hotkeys = $Hotkeys
    deinterlace_mode = 0
    deinterlace_field_order = 0
    monitoring_type = $MonitoringType
    private_settings = [ordered]@{}
  }
}

function New-SceneItem {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$SourceUuid,
    [Parameter(Mandatory = $true)][int]$Id,
    [int]$BoundsType = 0,
    [double]$BoundsX = 0.0,
    [double]$BoundsY = 0.0,
    [int]$BoundsAlign = 0,
    [int]$CropLeft = 0,
    [int]$CropRight = 0,
    [int]$CropTop = 0,
    [int]$CropBottom = 0
  )

  # OBS 32 uses a coordinate system whose canvas height spans [-1, 1].
  $relativeLeft = -1.0 * $CanvasWidth / $CanvasHeight
  $relativeBoundsX = 2.0 * $BoundsX / $CanvasHeight
  $relativeBoundsY = 2.0 * $BoundsY / $CanvasHeight

  return [ordered]@{
    name = $Name
    source_uuid = $SourceUuid
    visible = $true
    locked = $true
    rot = 0.0
    scale_ref = [ordered]@{ x = $CanvasWidth; y = $CanvasHeight }
    align = 5
    bounds_type = $BoundsType
    bounds_align = $BoundsAlign
    bounds_crop = $false
    crop_left = $CropLeft
    crop_top = $CropTop
    crop_right = $CropRight
    crop_bottom = $CropBottom
    id = $Id
    group_item_backup = $false
    pos = [ordered]@{ x = 0.0; y = 0.0 }
    pos_rel = [ordered]@{ x = $relativeLeft; y = -1.0 }
    scale = [ordered]@{ x = 1.0; y = 1.0 }
    scale_rel = [ordered]@{ x = 1.0; y = 1.0 }
    bounds = [ordered]@{ x = $BoundsX; y = $BoundsY }
    bounds_rel = [ordered]@{ x = $relativeBoundsX; y = $relativeBoundsY }
    scale_filter = 'bicubic'
    blend_method = 'default'
    blend_type = 'normal'
    show_transition = [ordered]@{ duration = 0 }
    hide_transition = [ordered]@{ duration = 0 }
    private_settings = [ordered]@{}
  }
}

function Assert-ManagedHotkeys {
  param([Parameter(Mandatory = $true)][string]$Text)

  if ([regex]::Matches($Text, '(?m)^\[Hotkeys\]\r?$').Count -ne 1) {
    throw 'Generated OBS INI must contain exactly one Hotkeys section.'
  }

  $managedEntryPattern = '(?m)^OBSBasic\.(?:Start|Stop)(?:Recording|Streaming)='
  if ([regex]::Matches($Text, $managedEntryPattern).Count -ne $ManagedHotkeys.Count) {
    throw 'Generated OBS INI contains a missing, duplicate, or unexpected managed output hotkey.'
  }

  if (@($ManagedHotkeys.Values | Select-Object -Unique).Count -ne $ManagedHotkeys.Count) {
    throw 'Managed OBS output hotkeys must use unique keys.'
  }

  foreach ($entry in $ManagedHotkeys.GetEnumerator()) {
    $pattern = '(?m)^' + [regex]::Escape([string]$entry.Key) + '=(?<json>\{[^\r\n]*\})\r?$'
    $matches = [regex]::Matches($Text, $pattern)
    if ($matches.Count -ne 1) {
      throw "Generated OBS INI must contain exactly one '$($entry.Key)' hotkey."
    }

    try {
      $hotkeyData = $matches[0].Groups['json'].Value | ConvertFrom-Json
    } catch {
      throw "Generated OBS hotkey '$($entry.Key)' is not valid JSON: $($_.Exception.Message)"
    }

    $rootProperties = @($hotkeyData.PSObject.Properties | ForEach-Object { $_.Name })
    if ($rootProperties.Count -ne 1 -or $rootProperties[0] -ne 'bindings') {
      throw "Generated OBS hotkey '$($entry.Key)' has an unexpected JSON shape."
    }

    $bindings = @($hotkeyData.bindings)
    if ($bindings.Count -ne 1) {
      throw "Generated OBS hotkey '$($entry.Key)' must contain exactly one binding."
    }

    $binding = $bindings[0]
    $bindingProperties = @($binding.PSObject.Properties | ForEach-Object { $_.Name })
    $unexpectedProperties = @($bindingProperties | Where-Object { $_ -notin @('shift', 'control', 'key') })
    if ($bindingProperties.Count -ne 3 -or $unexpectedProperties.Count -gt 0) {
      throw "Generated OBS hotkey '$($entry.Key)' has unexpected binding properties."
    }

    $shiftProperty = $binding.PSObject.Properties['shift']
    $controlProperty = $binding.PSObject.Properties['control']
    $keyProperty = $binding.PSObject.Properties['key']
    if ($null -eq $shiftProperty -or $shiftProperty.Value -isnot [bool] -or -not $shiftProperty.Value -or
        $null -eq $controlProperty -or $controlProperty.Value -isnot [bool] -or -not $controlProperty.Value -or
        $null -eq $keyProperty -or $keyProperty.Value -ne $entry.Value) {
      throw "Generated OBS hotkey '$($entry.Key)' must be Ctrl+Shift+$($entry.Value.Replace('OBS_KEY_', ''))."
    }
  }
}

function Assert-CredentialFreeIni {
  param([Parameter(Mandatory = $true)][string]$Text)

  $required = @(
    '(?m)^\[General\]\r?$',
    '(?m)^Name=VCV Rack Live\r?$',
    '(?m)^VCVChatLiveManaged=true\r?$',
    '(?m)^\[Video\]\r?$',
    '(?m)^BaseCX=1080\r?$',
    '(?m)^BaseCY=1920\r?$',
    '(?m)^FPSCommon=30\r?$',
    '(?m)^\[Audio\]\r?$',
    '(?m)^SampleRate=48000\r?$'
  )

  foreach ($pattern in $required) {
    if ($Text -notmatch $pattern) {
      throw "Generated OBS INI failed required-field validation: $pattern"
    }
  }

  $forbidden = @(
    '(?im)^\[YouTube\]$',
    '(?im)^\[Auth\]$',
    '(?im)^\s*(RefreshToken|Token|OAuthToken|StreamKey|Password)\s*=',
    '(?i)ya29\.',
    '(?i)rtmp(s)?://[^\s]*/live2/[^\s]+'
  )

  foreach ($pattern in $forbidden) {
    if ($Text -match $pattern) {
      throw "Generated OBS INI failed credential-safety validation: $pattern"
    }
  }

  Assert-ManagedHotkeys -Text $Text
}

function Assert-SceneCollection {
  param([Parameter(Mandatory = $true)][string]$Text)

  try {
    $scene = $Text | ConvertFrom-Json
  } catch {
    throw "Generated OBS scene collection is not valid JSON: $($_.Exception.Message)"
  }

  if ($scene.name -ne $CollectionName -or $scene.current_scene -ne $SceneName) {
    throw 'Generated OBS scene collection has the wrong collection or scene name.'
  }

  $expectedKinds = @('window_capture', 'wasapi_process_output_capture', 'browser_source', 'scene')
  foreach ($kind in $expectedKinds) {
    if (@($scene.sources | Where-Object { $_.id -eq $kind }).Count -ne 1) {
      throw "Generated OBS scene collection must contain exactly one '$kind' source."
    }
  }

  if (@($scene.sources).Count -ne 4) {
    throw 'Generated OBS scene collection contains an unexpected source.'
  }

  $uuids = @($scene.sources | ForEach-Object { $_.uuid })
  if (@($uuids | Select-Object -Unique).Count -ne $uuids.Count) {
    throw 'Generated OBS scene collection contains duplicate source UUIDs.'
  }

  $videoSource = @($scene.sources | Where-Object { $_.id -eq 'window_capture' })[0]
  if ($videoSource.settings.window -ne $RackWindowSelector -or $videoSource.settings.method -ne 1 -or
      $videoSource.settings.priority -ne 2 -or $videoSource.settings.compatibility -ne $true -or
      $videoSource.settings.cursor -ne $false -or $videoSource.settings.capture_audio -ne $false -or
      $videoSource.settings.client_area -ne $true -or $videoSource.settings.force_sdr -ne $false) {
    throw 'Rack Video is not locked to Rack.exe using compatibility BitBlt client-area capture.'
  }

  $audioSource = @($scene.sources | Where-Object { $_.id -eq 'wasapi_process_output_capture' })[0]
  if ($audioSource.settings.priority -ne 2 -or [int]$audioSource.monitoring_type -ne 0 -or
      [int64]$audioSource.mixers -eq 0) {
    throw 'Rack Application Audio Capture must use executable matching with local monitoring off.'
  }

  $browserSource = @($scene.sources | Where-Object { $_.id -eq 'browser_source' })[0]
  $expectedOverlay = "http://127.0.0.1:$OverlayPort/overlay"
  if ($browserSource.settings.url -ne $expectedOverlay -or
      $browserSource.settings.width -ne $CanvasWidth -or
      $browserSource.settings.height -ne $CanvasHeight -or
      $browserSource.settings.reroute_audio -ne $true -or
      [math]::Abs([double]$browserSource.volume - 0.72) -gt 0.001) {
    throw 'Rack browser overlay settings failed validation.'
  }

  $rackScene = @($scene.sources | Where-Object { $_.id -eq 'scene' -and $_.name -eq $SceneName })[0]
  if (@($rackScene.settings.items | Where-Object { $_.locked -ne $true }).Count -ne 0) {
    throw 'Every managed Rack scene item must be transform-locked.'
  }
  $rackVideoItem = @($rackScene.settings.items | Where-Object { $_.name -eq 'Rack Video' })[0]
  if ($rackVideoItem.crop_left -ne $RackCropLeft -or $rackVideoItem.crop_right -ne $RackCropRight -or
      $rackVideoItem.crop_top -ne $RackCropTop -or $rackVideoItem.crop_bottom -ne $RackCropBottom) {
    throw 'Rack video crop failed validation.'
  }

  $jsonForbidden = '(?i)(refresh[_-]?token|oauth[_-]?token|stream[_-]?key|server[_-]?password|rtmps?://)'
  if ($Text -match $jsonForbidden) {
    throw 'Generated OBS scene collection contains a credential-like field or remote RTMP URL.'
  }
}

if (Test-ObsRunning) {
  throw 'OBS is running. Exit OBS completely before preparing the isolated VCV profile.'
}

$videoPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyVideos)
if ([string]::IsNullOrWhiteSpace($videoPath)) {
  $videoPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) 'Videos'
}
$videoPathIni = $videoPath.Replace('\', '\\')
$managedHotkeyLines = @('[Hotkeys]')
foreach ($entry in $ManagedHotkeys.GetEnumerator()) {
  $hotkeyJson = ([ordered]@{
    bindings = @([ordered]@{
      shift = $true
      control = $true
      key = [string]$entry.Value
    })
  } | ConvertTo-Json -Compress -Depth 4)
  $managedHotkeyLines += "$($entry.Key)=$hotkeyJson"
}
$managedHotkeysIni = $managedHotkeyLines -join "`n"

$profileIni = @"
[General]
Name=$ProfileName
VCVChatLiveManaged=true
VCVChatLiveSchema=$SchemaVersion
ManagedBy=$ManagedBy

[Output]
Mode=Simple
FilenameFormatting=%CCYY-%MM-%DD %hh-%mm-%ss
DelayEnable=false
Reconnect=true
RetryDelay=2
MaxRetries=25
BindIP=default
IPFamily=IPv4+IPv6
LowLatencyEnable=false

[SimpleOutput]
FilePath=$videoPathIni
RecFormat2=mkv
VBitrate=10000
ABitrate=160
NVENCPreset2=p5
RecQuality=Stream
RecRB=false
StreamAudioEncoder=aac
RecAudioEncoder=aac
StreamEncoder=nvenc
RecEncoder=nvenc
UseAdvanced=false

[Video]
BaseCX=$CanvasWidth
BaseCY=$CanvasHeight
OutputCX=$CanvasWidth
OutputCY=$CanvasHeight
FPSType=0
FPSCommon=30
FPSInt=30
FPSNum=30
FPSDen=1
ScaleType=bicubic
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial
SdrWhiteLevel=300
HdrNominalPeakLevel=1000

[Audio]
MonitoringDeviceId=default
MonitoringDeviceName=Default
SampleRate=48000
ChannelSetup=Stereo
MeterDecayRate=23.53
PeakMeterType=0

$managedHotkeysIni
"@

$sourceMuteHotkeys = [ordered]@{
  'libobs.mute' = @()
  'libobs.unmute' = @()
  'libobs.push-to-mute' = @()
  'libobs.push-to-talk' = @()
}

$videoUuid = [guid]::NewGuid().ToString()
$audioUuid = [guid]::NewGuid().ToString()
$browserUuid = [guid]::NewGuid().ToString()
$sceneUuid = [guid]::NewGuid().ToString()

$videoSource = New-ObsSource -Name 'Rack Video' -Uuid $videoUuid -Id 'window_capture' -Settings ([ordered]@{
  window = $RackWindowSelector
  method = 1
  priority = 2
  compatibility = $true
  cursor = $false
  capture_audio = $false
  client_area = $true
  force_sdr = $false
}) -Hotkeys ([ordered]@{}) -Mixers 0

$audioSource = New-ObsSource -Name 'Rack Audio' -Uuid $audioUuid -Id 'wasapi_process_output_capture' -Settings ([ordered]@{
  window = $RackWindowSelector
  priority = 2
}) -Hotkeys $sourceMuteHotkeys -MonitoringType 0

$browserHotkeys = [ordered]@{
  'libobs.mute' = @()
  'libobs.unmute' = @()
  'libobs.push-to-mute' = @()
  'libobs.push-to-talk' = @()
  'ObsBrowser.Refresh' = @()
}

$browserSource = New-ObsSource -Name 'Chat Music Overlay' -Uuid $browserUuid -Id 'browser_source' -Settings ([ordered]@{
  url = "http://127.0.0.1:$OverlayPort/overlay"
  width = $CanvasWidth
  height = $CanvasHeight
  shutdown = $false
  restart_when_active = $true
  # Route WebAudio from the overlay into OBS so owner-triggered four-second
  # samples are heard by the stream without enabling desktop audio capture.
  reroute_audio = $true
  is_local_file = $false
  webpage_control_level = 0
  css = 'html, body { background-color: rgba(0, 0, 0, 0) !important; margin: 0; overflow: hidden; }'
}) -Hotkeys $browserHotkeys
$browserSource.volume = 0.72

# The Rack viewport remains wide so every module and cable is legible. It fills
# the upper third of the portrait canvas; the responsive live-chat overlay owns
# the lower area rather than cropping the patch down to a narrow unreadable strip.
$sceneItems = @(
  (New-SceneItem -Name 'Rack Video' -SourceUuid $videoUuid -Id 1 -BoundsType 2 -BoundsX $CanvasWidth -BoundsY $CanvasHeight -BoundsAlign 5 -CropLeft $RackCropLeft -CropRight $RackCropRight -CropTop $RackCropTop -CropBottom $RackCropBottom),
  (New-SceneItem -Name 'Rack Audio' -SourceUuid $audioUuid -Id 2),
  (New-SceneItem -Name 'Chat Music Overlay' -SourceUuid $browserUuid -Id 3)
)

$sceneHotkeys = [ordered]@{
  'OBSBasic.SelectScene' = @()
  'libobs.show_scene_item.1' = @()
  'libobs.hide_scene_item.1' = @()
  'libobs.show_scene_item.2' = @()
  'libobs.hide_scene_item.2' = @()
  'libobs.show_scene_item.3' = @()
  'libobs.hide_scene_item.3' = @()
}

$sceneSource = New-ObsSource -Name $SceneName -Uuid $sceneUuid -Id 'scene' -Settings ([ordered]@{
  custom_size = $true
  cx = $CanvasWidth
  cy = $CanvasHeight
  items = $sceneItems
  id_counter = 3
}) -Hotkeys $sceneHotkeys -Mixers 0
$sceneSource['canvas_uuid'] = $MainCanvasUuid

$sceneCollection = [ordered]@{
  name = $CollectionName
  sources = @($videoSource, $audioSource, $browserSource, $sceneSource)
  groups = @()
  scene_order = @([ordered]@{ name = $SceneName })
  current_scene = $SceneName
  current_program_scene = $SceneName
  canvases = @()
  current_transition = 'Fade'
  transition_duration = 300
  transitions = @()
  quick_transitions = @(
    [ordered]@{ name = 'Cut'; duration = 300; hotkeys = @(); id = 1; fade_to_black = $false },
    [ordered]@{ name = 'Fade'; duration = 300; hotkeys = @(); id = 2; fade_to_black = $false },
    [ordered]@{ name = 'Fade'; duration = 300; hotkeys = @(); id = 3; fade_to_black = $true }
  )
  saved_projectors = @()
  preview_locked = $false
  scaling_enabled = $false
  scaling_level = 0
  scaling_off_x = 0.0
  scaling_off_y = 0.0
  'virtual-camera' = [ordered]@{ type2 = 3 }
  modules = [ordered]@{
    'vcv-chat-live' = [ordered]@{
      managed = $true
      schema = $SchemaVersion
      managed_by = $ManagedBy
    }
  }
  resolution = [ordered]@{ x = $CanvasWidth; y = $CanvasHeight }
  version = 2
}

$sceneJson = $sceneCollection | ConvertTo-Json -Depth 100
Assert-CredentialFreeIni -Text $profileIni
Assert-SceneCollection -Text $sceneJson

if ($ValidateOnly) {
  Write-Host '[obs-prepare] Validation passed; no files were read or written.'
  Write-Host "[obs-prepare] Profile: $ProfileName"
  Write-Host "[obs-prepare] Collection: $CollectionName"
  Write-Host "[obs-prepare] Overlay: http://127.0.0.1:$OverlayPort/overlay"
  exit 0
}

$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
if ([string]::IsNullOrWhiteSpace($appData)) {
  throw 'Windows did not provide an ApplicationData path.'
}

$obsRoot = Join-Path $appData 'obs-studio'
$profilesRoot = Join-Path $obsRoot 'basic\profiles'
$scenesRoot = Join-Path $obsRoot 'basic\scenes'
$profilePath = Join-Path $profilesRoot $ProfileDirectoryName
$profileIniPath = Join-Path $profilePath 'basic.ini'
$scenePath = Join-Path $scenesRoot $CollectionFileName

$profileExists = Test-Path -LiteralPath $profilePath
$sceneExists = Test-Path -LiteralPath $scenePath

if ($profileExists -and $sceneExists) {
  if (-not (Test-Path -LiteralPath $profileIniPath -PathType Leaf)) {
    throw "The target profile directory exists without basic.ini: $profilePath"
  }

  $existingIni = [IO.File]::ReadAllText($profileIniPath)
  $existingScene = [IO.File]::ReadAllText($scenePath)
  if ($existingIni -notmatch '(?m)^ManagedBy=vcv-chat-live/scripts/prepare-obs\.ps1\r?$' -or
      $existingScene -notmatch '"vcv-chat-live"') {
    throw 'VCV Rack Live targets already exist but were not created by this script; refusing to overwrite them.'
  }

  if ($RefreshManaged) {
    $utf8Bom = New-Object System.Text.UTF8Encoding($true)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $tempIni = "$profileIniPath.$([guid]::NewGuid().ToString('N')).tmp"
    $tempScene = "$scenePath.$([guid]::NewGuid().ToString('N')).tmp"
    try {
      [IO.File]::WriteAllText($tempIni, $profileIni, $utf8Bom)
      [IO.File]::WriteAllText($tempScene, $sceneJson, $utf8NoBom)
      Assert-CredentialFreeIni -Text ([IO.File]::ReadAllText($tempIni))
      Assert-SceneCollection -Text ([IO.File]::ReadAllText($tempScene))
      Move-Item -LiteralPath $tempIni -Destination $profileIniPath -Force
      Move-Item -LiteralPath $tempScene -Destination $scenePath -Force
    } finally {
      if (Test-Path -LiteralPath $tempIni -PathType Leaf) { Remove-Item -LiteralPath $tempIni -Force }
      if (Test-Path -LiteralPath $tempScene -PathType Leaf) { Remove-Item -LiteralPath $tempScene -Force }
    }
    Write-Host '[obs-prepare] Refreshed the managed profile and scene collection; service.json was preserved.'
    exit 0
  }

  Write-Host '[obs-prepare] Managed profile and scene collection already exist; no changes made.'
  Write-Host "[obs-prepare] Profile: $profilePath"
  Write-Host "[obs-prepare] Collection: $scenePath"
  exit 0
}

if ($profileExists -or $sceneExists) {
  throw 'Only one VCV Rack Live target exists. Refusing to overwrite or repair a partial/manual setup.'
}

$obsExe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
if (-not (Test-Path -LiteralPath $obsExe -PathType Leaf)) {
  throw "OBS was not found at the expected path: $obsExe"
}

$obsVersionText = (Get-Item -LiteralPath $obsExe).VersionInfo.FileVersion
try {
  [Version]$obsVersion = $obsVersionText
} catch {
  throw "OBS reported an unreadable file version: '$obsVersionText'."
}
if ($obsVersion.Major -ne 32) {
  throw "This generator is pinned to the OBS 32 scene schema; installed version is '$obsVersionText'."
}

[IO.Directory]::CreateDirectory($profilesRoot) | Out-Null
[IO.Directory]::CreateDirectory($scenesRoot) | Out-Null

$nonce = [guid]::NewGuid().ToString('N')
$tempProfilePath = Join-Path $profilesRoot ".$ProfileDirectoryName.$nonce.tmp"
$tempScenePath = Join-Path $scenesRoot ".$CollectionFileName.$nonce.tmp"
$profileCommitted = $false
$sceneCommitted = $false

try {
  [IO.Directory]::CreateDirectory($tempProfilePath) | Out-Null
  $tempIniPath = Join-Path $tempProfilePath 'basic.ini'

  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($tempIniPath, $profileIni, $utf8Bom)
  [IO.File]::WriteAllText($tempScenePath, $sceneJson, $utf8NoBom)

  Assert-CredentialFreeIni -Text ([IO.File]::ReadAllText($tempIniPath))
  Assert-SceneCollection -Text ([IO.File]::ReadAllText($tempScenePath))

  if (Test-ObsRunning) {
    throw 'OBS started during preparation. No OBS profile or scene collection was committed.'
  }

  [IO.Directory]::Move($tempProfilePath, $profilePath)
  $profileCommitted = $true
  [IO.File]::Move($tempScenePath, $scenePath)
  $sceneCommitted = $true
} catch {
  if ($sceneCommitted -and (Test-Path -LiteralPath $scenePath -PathType Leaf)) {
    [IO.File]::Delete($scenePath)
  }
  if ($profileCommitted -and (Test-Path -LiteralPath $profilePath -PathType Container)) {
    [IO.Directory]::Delete($profilePath, $true)
  }
  throw
} finally {
  if (Test-Path -LiteralPath $tempScenePath -PathType Leaf) {
    [IO.File]::Delete($tempScenePath)
  }
  if (Test-Path -LiteralPath $tempProfilePath -PathType Container) {
    [IO.Directory]::Delete($tempProfilePath, $true)
  }
}

Write-Host '[obs-prepare] Created a credential-free OBS profile and scene collection.'
Write-Host "[obs-prepare] Profile: $profilePath"
Write-Host "[obs-prepare] Collection: $scenePath"
Write-Host "[obs-prepare] Overlay: http://127.0.0.1:$OverlayPort/overlay"
Write-Host '[obs-prepare] Existing profiles, collections, user.ini, global.ini, and plugin configs were not changed.'
Write-Host '[obs-prepare] Start OBS in safe mode, select VCV Rack Live, and verify Rack video/audio before streaming.'

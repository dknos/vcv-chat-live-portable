[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$OverlayPort = 9392,

  [string]$DroidCamSourceCollection,

  [switch]$ValidateOnly,

  [switch]$RefreshManaged
)

# Offline, additive editor for the managed VCV Rack Live collection. This
# script never selects a scene, starts an output, or changes the OBS profile.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProfileDirectoryName = 'VCV_Rack_Live'
$CollectionFileName = 'VCV_Rack_Live.json'
$CollectionName = 'VCV Rack Live'
$RackSceneName = 'Rack Live'
$PhoneSceneName = 'Phone Live'
$PhoneSourceName = 'DroidCam Phone'
$PhoneOverlayName = 'Chat Music Overlay Phone'
$ManagedBy = 'vcv-chat-live/scripts/prepare-obs-phone.ps1'
$CanvasWidth = 1080
$CanvasHeight = 1920
$DroidCamSourceId = 'droidcam_obs'
$BrowserSourceId = 'browser_source'
$SceneSourceId = 'scene'
$ForbiddenCaptureIdPattern = '^(?:monitor_capture|display_capture|screen_capture|xshm_input|pipewire-screen-capture-source)$'

function Test-ObsRunning {
  return @(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0
}

function Get-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Set-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()]$Value
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value
  } else {
    $property.Value = $Value
  }
}

function Copy-JsonValue {
  param([Parameter(Mandatory = $true)]$Value)
  return ($Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json)
}

function ConvertTo-CanonicalJson {
  param([Parameter(Mandatory = $true)]$Value)
  return ($Value | ConvertTo-Json -Depth 100 -Compress)
}

function Read-ObsCollection {
  param([Parameter(Mandatory = $true)][string]$Path)

  try {
    return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
  } catch {
    throw "An OBS scene collection is not valid JSON: $([IO.Path]::GetFileName($Path))"
  }
}

function Assert-NoForbiddenCaptureDescriptor {
  param([Parameter(Mandatory = $true)]$Source)

  $sourceId = [string](Get-ObjectProperty -Object $Source -Name 'id')
  $versionedId = [string](Get-ObjectProperty -Object $Source -Name 'versioned_id')
  if ($sourceId -match $ForbiddenCaptureIdPattern -or $versionedId -match $ForbiddenCaptureIdPattern) {
    throw 'Refusing to import a display, monitor, or screen capture source.'
  }

  # A DroidCam source may have plugin-owned filters. Reject nested capture
  # descriptors too, without ever including their settings in diagnostics.
  $sourceJson = ConvertTo-CanonicalJson -Value $Source
  $nestedPattern = '(?i)"(?:id|versioned_id)"\s*:\s*"(?:monitor_capture|display_capture|screen_capture|xshm_input|pipewire-screen-capture-source)"'
  if ($sourceJson -match $nestedPattern) {
    throw 'Refusing to import a source containing a display, monitor, or screen capture descriptor.'
  }
}

function Get-SceneItemForSource {
  param(
    [Parameter(Mandatory = $true)]$Collection,
    [Parameter(Mandatory = $true)][string]$SourceUuid,
    [string]$PreferredScene
  )

  $scenes = @($Collection.sources | Where-Object { $_.id -eq $SceneSourceId })
  if (-not [string]::IsNullOrWhiteSpace($PreferredScene)) {
    $preferred = @($scenes | Where-Object { $_.name -eq $PreferredScene })
    $scenes = @($preferred) + @($scenes | Where-Object { $_.name -ne $PreferredScene })
  }

  foreach ($scene in $scenes) {
    $items = @((Get-ObjectProperty -Object $scene.settings -Name 'items'))
    $match = @($items | Where-Object { $_.source_uuid -eq $SourceUuid -and $_.visible -ne $false })
    if ($match.Count -gt 0) { return $match[0] }
  }

  foreach ($scene in $scenes) {
    $items = @((Get-ObjectProperty -Object $scene.settings -Name 'items'))
    $match = @($items | Where-Object { $_.source_uuid -eq $SourceUuid })
    if ($match.Count -gt 0) { return $match[0] }
  }

  return $null
}

function Get-ActiveDroidCamCandidate {
  param(
    [Parameter(Mandatory = $true)]$Collection,
    [Parameter(Mandatory = $true)][string]$CollectionPath,
    [switch]$AllowInactive
  )

  $droidSources = @($Collection.sources | Where-Object { $_.id -eq $DroidCamSourceId })
  if ($droidSources.Count -eq 0) { return $null }

  $currentScene = [string](Get-ObjectProperty -Object $Collection -Name 'current_scene')
  $activeScene = @($Collection.sources | Where-Object {
    $_.id -eq $SceneSourceId -and $_.name -eq $currentScene
  })
  $activeUuids = @()
  if ($activeScene.Count -eq 1) {
    $activeUuids = @($activeScene[0].settings.items | Where-Object {
      $_.visible -ne $false
    } | ForEach-Object { $_.source_uuid })
  }

  $activeDroidSources = @($droidSources | Where-Object { $_.uuid -in $activeUuids })
  if ($activeDroidSources.Count -gt 1) {
    throw 'The selected OBS collection has multiple active DroidCam sources; keep only one active source.'
  }
  if ($activeDroidSources.Count -eq 1) {
    $source = $activeDroidSources[0]
    Assert-NoForbiddenCaptureDescriptor -Source $source
    return [pscustomobject]@{
      Source = $source
      Transform = Get-SceneItemForSource -Collection $Collection -SourceUuid $source.uuid -PreferredScene $currentScene
      CollectionPath = $CollectionPath
    }
  }

  if ($AllowInactive) {
    if ($droidSources.Count -ne 1) {
      throw 'The selected OBS collection has multiple DroidCam sources and no unique active source.'
    }
    $source = $droidSources[0]
    Assert-NoForbiddenCaptureDescriptor -Source $source
    return [pscustomobject]@{
      Source = $source
      Transform = Get-SceneItemForSource -Collection $Collection -SourceUuid $source.uuid -PreferredScene $currentScene
      CollectionPath = $CollectionPath
    }
  }

  return $null
}

function Resolve-SourceCollectionPath {
  param(
    [Parameter(Mandatory = $true)][string]$Selector,
    [Parameter(Mandatory = $true)][string]$ScenesRoot,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  if ($Selector.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
      $Selector -match '[\\/]' -or $Selector -in @('.', '..')) {
    throw 'DroidCamSourceCollection must be a local OBS collection name, not a path.'
  }

  $selectorBase = if ($Selector.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
    $Selector.Substring(0, $Selector.Length - 5)
  } else {
    $Selector
  }

  $matches = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $ScenesRoot -Filter '*.json' -File)) {
    if ($file.FullName -eq $TargetPath) { continue }
    $collection = Read-ObsCollection -Path $file.FullName
    if ($file.BaseName -eq $selectorBase -or $collection.name -eq $Selector -or $collection.name -eq $selectorBase) {
      $matches += $file.FullName
    }
  }

  $matches = @($matches | Select-Object -Unique)
  if ($matches.Count -ne 1) {
    throw 'DroidCamSourceCollection did not identify exactly one local OBS collection.'
  }
  return $matches[0]
}

function Find-DroidCamCandidate {
  param(
    [Parameter(Mandatory = $true)][string]$ScenesRoot,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$SourceCollection
  )

  if (-not [string]::IsNullOrWhiteSpace($SourceCollection)) {
    $sourcePath = Resolve-SourceCollectionPath -Selector $SourceCollection -ScenesRoot $ScenesRoot -TargetPath $TargetPath
    $sourceCollectionData = Read-ObsCollection -Path $sourcePath
    $candidate = Get-ActiveDroidCamCandidate -Collection $sourceCollectionData -CollectionPath $sourcePath -AllowInactive
    if ($null -eq $candidate) {
      throw 'The selected local OBS collection does not contain a DroidCam source.'
    }
    return $candidate
  }

  $candidates = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $ScenesRoot -Filter '*.json' -File)) {
    if ($file.FullName -eq $TargetPath) { continue }
    $collection = Read-ObsCollection -Path $file.FullName
    $candidate = Get-ActiveDroidCamCandidate -Collection $collection -CollectionPath $file.FullName
    if ($null -ne $candidate) { $candidates += $candidate }
  }

  if ($candidates.Count -eq 0) {
    throw 'No active DroidCam source was found in the local OBS scene collections.'
  }
  if ($candidates.Count -gt 1) {
    throw 'Multiple active DroidCam sources were found; use -DroidCamSourceCollection to select one.'
  }
  return $candidates[0]
}

function New-ObsSource {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Uuid,
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)]$Settings,
    [Parameter(Mandatory = $true)]$Hotkeys,
    [int]$Mixers = 255,
    [ValidateSet(0, 1, 2)][int]$MonitoringType = 0
  )

  return [pscustomobject][ordered]@{
    prev_ver = 536936450
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
    private_settings = [pscustomobject]@{}
  }
}

function New-BaseSceneItem {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$SourceUuid,
    [Parameter(Mandatory = $true)][int]$Id
  )

  return [pscustomobject][ordered]@{
    name = $Name
    source_uuid = $SourceUuid
    visible = $true
    locked = $true
    rot = 0.0
    scale_ref = [pscustomobject]@{ x = $CanvasWidth; y = $CanvasHeight }
    align = 5
    bounds_type = 0
    bounds_align = 0
    bounds_crop = $false
    crop_left = 0
    crop_top = 0
    crop_right = 0
    crop_bottom = 0
    id = $Id
    group_item_backup = $false
    pos = [pscustomobject]@{ x = 0.0; y = 0.0 }
    pos_rel = [pscustomobject]@{ x = (-1.0 * $CanvasWidth / $CanvasHeight); y = -1.0 }
    scale = [pscustomobject]@{ x = 1.0; y = 1.0 }
    scale_rel = [pscustomobject]@{ x = 1.0; y = 1.0 }
    bounds = [pscustomobject]@{ x = 0.0; y = 0.0 }
    bounds_rel = [pscustomobject]@{ x = 0.0; y = 0.0 }
    scale_filter = 'bicubic'
    blend_method = 'default'
    blend_type = 'normal'
    show_transition = [pscustomobject]@{ duration = 0 }
    hide_transition = [pscustomobject]@{ duration = 0 }
    private_settings = [pscustomobject]@{}
  }
}

function New-FallbackDroidCamItem {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$SourceUuid
  )

  $item = New-BaseSceneItem -Name $Name -SourceUuid $SourceUuid -Id 1
  $item.bounds_type = 2
  $item.bounds = [pscustomobject]@{ x = $CanvasWidth; y = 960.0 }
  $item.bounds_rel = [pscustomobject]@{ x = (2.0 * $CanvasWidth / $CanvasHeight); y = 1.0 }
  $item.pos = [pscustomobject]@{ x = 0.0; y = 960.0 }
  $item.pos_rel = [pscustomobject]@{ x = (-1.0 * $CanvasWidth / $CanvasHeight); y = 0.0 }
  return $item
}

function New-DroidCamItemFromTransform {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$SourceUuid,
    $Transform
  )

  if ($null -eq $Transform) {
    return New-FallbackDroidCamItem -Name $Name -SourceUuid $SourceUuid
  }

  $item = Copy-JsonValue -Value $Transform
  Set-ObjectProperty -Object $item -Name 'name' -Value $Name
  Set-ObjectProperty -Object $item -Name 'source_uuid' -Value $SourceUuid
  Set-ObjectProperty -Object $item -Name 'id' -Value 1
  Set-ObjectProperty -Object $item -Name 'visible' -Value $true
  Set-ObjectProperty -Object $item -Name 'locked' -Value $true
  Set-ObjectProperty -Object $item -Name 'scale_ref' -Value ([pscustomobject]@{ x = $CanvasWidth; y = $CanvasHeight })
  Set-ObjectProperty -Object $item -Name 'group_item_backup' -Value $false
  return $item
}

function New-OverlayItem {
  param([Parameter(Mandatory = $true)][string]$SourceUuid)

  $item = New-BaseSceneItem -Name $PhoneOverlayName -SourceUuid $SourceUuid -Id 3
  $item.bounds_type = 2
  $item.bounds_align = 5
  $item.bounds = [pscustomobject]@{ x = $CanvasWidth; y = $CanvasHeight }
  $item.bounds_rel = [pscustomobject]@{
    x = (2.0 * $CanvasWidth / $CanvasHeight)
    y = 2.0
  }
  return $item
}

function Get-PhoneMarker {
  param([Parameter(Mandatory = $true)]$Collection)

  $modules = Get-ObjectProperty -Object $Collection -Name 'modules'
  if ($null -eq $modules) { return $null }
  $vcvModule = Get-ObjectProperty -Object $modules -Name 'vcv-chat-live'
  if ($null -eq $vcvModule) { return $null }
  return Get-ObjectProperty -Object $vcvModule -Name 'phone_live'
}

function Assert-PhoneCollection {
  param(
    [Parameter(Mandatory = $true)]$Collection,
    [Parameter(Mandatory = $true)][string]$RackAudioUuid,
    [Parameter(Mandatory = $true)][string]$OriginalCurrentScene,
    [Parameter(Mandatory = $true)][string]$OriginalProgramScene,
    [Parameter(Mandatory = $true)][hashtable]$OriginalSources,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$AllowedChangedSourceUuids,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$AllowedAddedSourceUuids
  )

  if ($Collection.name -ne $CollectionName -or [int]$Collection.resolution.x -ne $CanvasWidth -or
      [int]$Collection.resolution.y -ne $CanvasHeight) {
    throw 'The managed collection must remain VCV Rack Live at 1080x1920.'
  }
  if ($Collection.current_scene -ne $OriginalCurrentScene -or
      $Collection.current_program_scene -ne $OriginalProgramScene) {
    throw 'Phone scene preparation must not switch the current OBS scene.'
  }

  $uuids = @($Collection.sources | ForEach-Object { [string]$_.uuid })
  if (@($uuids | Select-Object -Unique).Count -ne $uuids.Count) {
    throw 'The edited OBS collection contains duplicate source UUIDs.'
  }
  $names = @($Collection.sources | ForEach-Object { [string]$_.name })
  if (@($names | Select-Object -Unique).Count -ne $names.Count) {
    throw 'The edited OBS collection contains duplicate source names.'
  }

  foreach ($originalUuid in $OriginalSources.Keys) {
    $current = @($Collection.sources | Where-Object { $_.uuid -eq $originalUuid })
    if ($current.Count -ne 1) { throw 'An existing OBS source was removed or duplicated.' }
    if ($originalUuid -notin $AllowedChangedSourceUuids -and
        (ConvertTo-CanonicalJson -Value $current[0]) -ne $OriginalSources[$originalUuid]) {
      throw 'An unrelated existing OBS source was modified.'
    }
  }

  $added = @($Collection.sources | Where-Object { $_.uuid -notin $OriginalSources.Keys })
  if ($added.Count -ne $AllowedAddedSourceUuids.Count -or
      @($added | Where-Object { $_.uuid -notin $AllowedAddedSourceUuids }).Count -ne 0) {
    throw 'Phone preparation added an unexpected OBS source.'
  }
  foreach ($source in $added) {
    if ($source.id -notin @($DroidCamSourceId, $BrowserSourceId, $SceneSourceId) -or
        $source.id -match $ForbiddenCaptureIdPattern) {
      throw 'Phone preparation attempted to add an unintended capture source.'
    }
  }

  $marker = Get-PhoneMarker -Collection $Collection
  if ($null -eq $marker -or $marker.managed -ne $true -or $marker.managed_by -ne $ManagedBy) {
    throw 'The Phone Live module marker is missing or invalid.'
  }

  $droid = @($Collection.sources | Where-Object { $_.uuid -eq $marker.droidcam_source_uuid })
  $overlay = @($Collection.sources | Where-Object { $_.uuid -eq $marker.overlay_source_uuid })
  $phoneScene = @($Collection.sources | Where-Object { $_.uuid -eq $marker.scene_source_uuid })
  if ($droid.Count -ne 1 -or $droid[0].id -ne $DroidCamSourceId -or
      $droid[0].name -ne $PhoneSourceName -or
      [int64]$droid[0].mixers -ne 0 -or [int]$droid[0].monitoring_type -ne 0) {
    throw 'The managed DroidCam source must have stream and monitor audio disabled.'
  }
  Assert-NoForbiddenCaptureDescriptor -Source $droid[0]

  $expectedUrl = "http://127.0.0.1:$OverlayPort/overlay?layout=phone"
  if ($overlay.Count -ne 1 -or $overlay[0].id -ne $BrowserSourceId -or
      $overlay[0].name -ne $PhoneOverlayName -or $overlay[0].settings.url -ne $expectedUrl -or
      [int]$overlay[0].settings.width -ne $CanvasWidth -or
      [int]$overlay[0].settings.height -ne $CanvasHeight -or
      $overlay[0].settings.shutdown -ne $true -or
      $overlay[0].settings.reroute_audio -ne $true -or
      [math]::Abs([double]$overlay[0].volume - 0.72) -gt 0.001) {
    throw 'The Phone Live overlay source failed validation.'
  }

  if ($phoneScene.Count -ne 1 -or $phoneScene[0].id -ne $SceneSourceId -or
      $phoneScene[0].name -ne $PhoneSceneName -or $phoneScene[0].settings.custom_size -ne $true -or
      [int]$phoneScene[0].settings.cx -ne $CanvasWidth -or
      [int]$phoneScene[0].settings.cy -ne $CanvasHeight) {
    throw 'The Phone Live scene failed 1080x1920 validation.'
  }
  $items = @($phoneScene[0].settings.items)
  $expectedItemUuids = @($marker.droidcam_source_uuid, $RackAudioUuid, $marker.overlay_source_uuid)
  if ($items.Count -ne 3 -or @($items | Where-Object { $_.locked -ne $true }).Count -ne 0 -or
      @($items | Where-Object { $_.source_uuid -notin $expectedItemUuids }).Count -ne 0 -or
      @($items | ForEach-Object { $_.source_uuid } | Select-Object -Unique).Count -ne 3) {
    throw 'Phone Live must contain exactly three locked managed items.'
  }
  if ($items[0].source_uuid -ne $marker.droidcam_source_uuid -or
      $items[1].source_uuid -ne $RackAudioUuid -or
      $items[2].source_uuid -ne $marker.overlay_source_uuid) {
    throw 'Phone Live source stacking failed validation.'
  }
  if ($marker.rack_audio_source_uuid -ne $RackAudioUuid) {
    throw 'Phone Live did not reuse the existing Rack Audio source.'
  }

  if (@($Collection.sources | Where-Object {
    $_.id -eq 'wasapi_process_output_capture' -and $_.name -eq 'Rack Audio' -and
    [int64]$_.mixers -ne 0 -and [int]$_.monitoring_type -eq 0
  }).Count -ne 1) {
    throw 'Phone preparation requires one stream-enabled Rack Audio source with local monitoring off.'
  }
  if (@($Collection.sources | Where-Object {
    $_.id -eq $SceneSourceId -and $_.name -eq $RackSceneName
  }).Count -ne 1) {
    throw 'Phone preparation did not preserve the Rack Live scene.'
  }
  if (@($Collection.scene_order | Where-Object { $_.name -eq $PhoneSceneName }).Count -ne 1) {
    throw 'Phone Live must appear exactly once in OBS scene order.'
  }
}

if (Test-ObsRunning) {
  throw 'OBS is running. Exit OBS completely before preparing Phone Live.'
}

$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
if ([string]::IsNullOrWhiteSpace($appData)) {
  throw 'Windows did not provide an ApplicationData path.'
}

$obsRoot = Join-Path $appData 'obs-studio'
$scenesRoot = Join-Path $obsRoot 'basic\scenes'
$profileIniPath = Join-Path $obsRoot "basic\profiles\$ProfileDirectoryName\basic.ini"
$scenePath = Join-Path $scenesRoot $CollectionFileName
if (-not (Test-Path -LiteralPath $profileIniPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $scenePath -PathType Leaf)) {
  throw 'The managed VCV Rack Live profile/collection is missing. Run prepare-obs.ps1 first.'
}

$profileIni = [IO.File]::ReadAllText($profileIniPath)
if ($profileIni -notmatch '(?m)^VCVChatLiveManaged=true\r?$' -or
    $profileIni -notmatch '(?m)^ManagedBy=vcv-chat-live/scripts/prepare-obs\.ps1\r?$' -or
    $profileIni -notmatch '(?m)^BaseCX=1080\r?$' -or
    $profileIni -notmatch '(?m)^BaseCY=1920\r?$') {
  throw 'The target OBS profile is not the managed 1080x1920 VCV Rack Live profile.'
}

$collection = Read-ObsCollection -Path $scenePath
$vcvModule = Get-ObjectProperty -Object (Get-ObjectProperty -Object $collection -Name 'modules') -Name 'vcv-chat-live'
if ($collection.name -ne $CollectionName -or $null -eq $vcvModule -or $vcvModule.managed -ne $true) {
  throw 'The target scene collection is not managed by vcv-chat-live.'
}
if ([int]$collection.resolution.x -ne $CanvasWidth -or [int]$collection.resolution.y -ne $CanvasHeight) {
  throw 'The target VCV Rack Live scene collection is not 1080x1920.'
}

$rackScene = @($collection.sources | Where-Object { $_.id -eq $SceneSourceId -and $_.name -eq $RackSceneName })
$rackAudio = @($collection.sources | Where-Object {
  $_.id -eq 'wasapi_process_output_capture' -and $_.name -eq 'Rack Audio'
})
if ($rackScene.Count -ne 1 -or $rackAudio.Count -ne 1) {
  throw 'The managed Rack Live scene or its reusable Rack Audio source is missing.'
}

$originalCurrentScene = [string]$collection.current_scene
$originalProgramScene = [string]$collection.current_program_scene
$originalSources = @{}
foreach ($source in @($collection.sources)) {
  $originalSources[[string]$source.uuid] = ConvertTo-CanonicalJson -Value $source
}

$existingMarker = Get-PhoneMarker -Collection $collection
if ($null -ne $existingMarker -and -not $RefreshManaged) {
  Assert-PhoneCollection -Collection $collection -RackAudioUuid $rackAudio[0].uuid `
    -OriginalCurrentScene $originalCurrentScene -OriginalProgramScene $originalProgramScene `
    -OriginalSources $originalSources -AllowedChangedSourceUuids @() -AllowedAddedSourceUuids @()
  if ($ValidateOnly) {
    Write-Host '[obs-phone] Validation passed; no files were changed.'
  } else {
    Write-Host '[obs-phone] Managed Phone Live scene already exists; no changes made.'
  }
  exit 0
}

if ($null -eq $existingMarker) {
  $manualSceneCollision = @($collection.sources | Where-Object { $_.name -eq $PhoneSceneName })
  $manualOverlayCollision = @($collection.sources | Where-Object { $_.name -eq $PhoneOverlayName })
  if ($manualSceneCollision.Count -gt 0 -or $manualOverlayCollision.Count -gt 0) {
    throw 'Phone Live names already exist without the managed module marker; refusing to overwrite them.'
  }
}

$droidTransform = $null
$targetDroid = $null
$targetDroidSources = @($collection.sources | Where-Object { $_.id -eq $DroidCamSourceId })
if ($null -ne $existingMarker) {
  $markedDroid = @($targetDroidSources | Where-Object { $_.uuid -eq $existingMarker.droidcam_source_uuid })
  if ($markedDroid.Count -eq 1) { $targetDroid = $markedDroid[0] }
}
if ($null -eq $targetDroid) {
  if ($targetDroidSources.Count -gt 1) {
    throw 'The target collection has multiple DroidCam sources and no unique managed source.'
  }
  if ($targetDroidSources.Count -eq 1) { $targetDroid = $targetDroidSources[0] }
}

$addedUuids = @()
$changedUuids = @()
if ($null -ne $targetDroid) {
  Assert-NoForbiddenCaptureDescriptor -Source $targetDroid
  $droidTransform = Get-SceneItemForSource -Collection $collection -SourceUuid $targetDroid.uuid -PreferredScene $PhoneSceneName
  $changedUuids += [string]$targetDroid.uuid
} else {
  $candidate = Find-DroidCamCandidate -ScenesRoot $scenesRoot -TargetPath $scenePath `
    -SourceCollection $DroidCamSourceCollection
  $targetDroid = Copy-JsonValue -Value $candidate.Source
  Assert-NoForbiddenCaptureDescriptor -Source $targetDroid
  $newDroidUuid = [guid]::NewGuid().ToString()
  Set-ObjectProperty -Object $targetDroid -Name 'name' -Value $PhoneSourceName
  Set-ObjectProperty -Object $targetDroid -Name 'uuid' -Value $newDroidUuid
  Set-ObjectProperty -Object $targetDroid -Name 'id' -Value $DroidCamSourceId
  Set-ObjectProperty -Object $targetDroid -Name 'versioned_id' -Value $DroidCamSourceId
  $droidTransform = $candidate.Transform
  $collection.sources = @($collection.sources) + @($targetDroid)
  $addedUuids += $newDroidUuid
}

# DroidCam contributes video only. Its device configuration remains opaque and
# is copied locally, but neither its audio nor its monitoring reaches an output.
Set-ObjectProperty -Object $targetDroid -Name 'name' -Value $PhoneSourceName
Set-ObjectProperty -Object $targetDroid -Name 'mixers' -Value 0
Set-ObjectProperty -Object $targetDroid -Name 'monitoring_type' -Value 0
Set-ObjectProperty -Object $targetDroid -Name 'muted' -Value $true

$phoneOverlay = $null
if ($null -ne $existingMarker) {
  $markedOverlay = @($collection.sources | Where-Object { $_.uuid -eq $existingMarker.overlay_source_uuid })
  if ($markedOverlay.Count -eq 1) { $phoneOverlay = $markedOverlay[0] }
}
if ($null -eq $phoneOverlay) {
  $namedOverlay = @($collection.sources | Where-Object { $_.name -eq $PhoneOverlayName })
  if ($namedOverlay.Count -gt 1 -or ($namedOverlay.Count -eq 1 -and $namedOverlay[0].id -ne $BrowserSourceId)) {
    throw 'The Phone overlay source name is ambiguous or belongs to another source type.'
  }
  if ($namedOverlay.Count -eq 1) { $phoneOverlay = $namedOverlay[0] }
}
if ($null -eq $phoneOverlay) {
  $overlayUuid = [guid]::NewGuid().ToString()
  $phoneOverlay = New-ObsSource -Name $PhoneOverlayName -Uuid $overlayUuid -Id $BrowserSourceId `
    -Settings ([pscustomobject]@{}) -Hotkeys ([pscustomobject]@{})
  $collection.sources = @($collection.sources) + @($phoneOverlay)
  $addedUuids += $overlayUuid
} else {
  $changedUuids += [string]$phoneOverlay.uuid
}
$browserHotkeys = [pscustomobject][ordered]@{
  'libobs.mute' = @()
  'libobs.unmute' = @()
  'libobs.push-to-mute' = @()
  'libobs.push-to-talk' = @()
  'ObsBrowser.Refresh' = @()
}
Set-ObjectProperty -Object $phoneOverlay -Name 'name' -Value $PhoneOverlayName
Set-ObjectProperty -Object $phoneOverlay -Name 'id' -Value $BrowserSourceId
Set-ObjectProperty -Object $phoneOverlay -Name 'versioned_id' -Value $BrowserSourceId
Set-ObjectProperty -Object $phoneOverlay -Name 'settings' -Value ([pscustomobject][ordered]@{
  url = "http://127.0.0.1:$OverlayPort/overlay?layout=phone"
  width = $CanvasWidth
  height = $CanvasHeight
  shutdown = $true
  restart_when_active = $true
  reroute_audio = $true
  is_local_file = $false
  webpage_control_level = 0
  css = 'html, body { background-color: rgba(0, 0, 0, 0) !important; margin: 0; overflow: hidden; }'
})
Set-ObjectProperty -Object $phoneOverlay -Name 'hotkeys' -Value $browserHotkeys
Set-ObjectProperty -Object $phoneOverlay -Name 'mixers' -Value 255
Set-ObjectProperty -Object $phoneOverlay -Name 'monitoring_type' -Value 0
Set-ObjectProperty -Object $phoneOverlay -Name 'volume' -Value 0.72
Set-ObjectProperty -Object $phoneOverlay -Name 'muted' -Value $false

$phoneScene = $null
if ($null -ne $existingMarker) {
  $markedScene = @($collection.sources | Where-Object { $_.uuid -eq $existingMarker.scene_source_uuid })
  if ($markedScene.Count -eq 1) { $phoneScene = $markedScene[0] }
}
if ($null -eq $phoneScene) {
  $namedScene = @($collection.sources | Where-Object { $_.name -eq $PhoneSceneName })
  if ($namedScene.Count -gt 1 -or ($namedScene.Count -eq 1 -and $namedScene[0].id -ne $SceneSourceId)) {
    throw 'The Phone Live scene name is ambiguous or belongs to another source type.'
  }
  if ($namedScene.Count -eq 1) { $phoneScene = $namedScene[0] }
}
if ($null -eq $phoneScene) {
  $phoneSceneUuid = [guid]::NewGuid().ToString()
  $phoneScene = New-ObsSource -Name $PhoneSceneName -Uuid $phoneSceneUuid -Id $SceneSourceId `
    -Settings ([pscustomobject]@{}) -Hotkeys ([pscustomobject]@{}) -Mixers 0
  $collection.sources = @($collection.sources) + @($phoneScene)
  $addedUuids += $phoneSceneUuid
} else {
  $changedUuids += [string]$phoneScene.uuid
}

$droidItem = New-DroidCamItemFromTransform -Name $targetDroid.name -SourceUuid $targetDroid.uuid -Transform $droidTransform
$rackAudioItem = New-BaseSceneItem -Name $rackAudio[0].name -SourceUuid $rackAudio[0].uuid -Id 2
$overlayItem = New-OverlayItem -SourceUuid $phoneOverlay.uuid
$sceneHotkeys = [pscustomobject][ordered]@{
  'OBSBasic.SelectScene' = @()
  'libobs.show_scene_item.1' = @()
  'libobs.hide_scene_item.1' = @()
  'libobs.show_scene_item.2' = @()
  'libobs.hide_scene_item.2' = @()
  'libobs.show_scene_item.3' = @()
  'libobs.hide_scene_item.3' = @()
}
Set-ObjectProperty -Object $phoneScene -Name 'name' -Value $PhoneSceneName
Set-ObjectProperty -Object $phoneScene -Name 'id' -Value $SceneSourceId
Set-ObjectProperty -Object $phoneScene -Name 'versioned_id' -Value $SceneSourceId
Set-ObjectProperty -Object $phoneScene -Name 'mixers' -Value 0
Set-ObjectProperty -Object $phoneScene -Name 'monitoring_type' -Value 0
Set-ObjectProperty -Object $phoneScene -Name 'hotkeys' -Value $sceneHotkeys
Set-ObjectProperty -Object $phoneScene -Name 'settings' -Value ([pscustomobject][ordered]@{
  custom_size = $true
  cx = $CanvasWidth
  cy = $CanvasHeight
  items = @($droidItem, $rackAudioItem, $overlayItem)
  id_counter = 3
})
$rackCanvasUuid = Get-ObjectProperty -Object $rackScene[0] -Name 'canvas_uuid'
if ($null -ne $rackCanvasUuid) {
  Set-ObjectProperty -Object $phoneScene -Name 'canvas_uuid' -Value $rackCanvasUuid
}

$sceneOrderWithoutPhone = @($collection.scene_order | Where-Object { $_.name -ne $PhoneSceneName })
$collection.scene_order = $sceneOrderWithoutPhone + @([pscustomobject]@{ name = $PhoneSceneName })

$modules = Get-ObjectProperty -Object $collection -Name 'modules'
if ($null -eq $modules) {
  $modules = [pscustomobject]@{}
  Set-ObjectProperty -Object $collection -Name 'modules' -Value $modules
}
$vcvModule = Get-ObjectProperty -Object $modules -Name 'vcv-chat-live'
if ($null -eq $vcvModule) {
  throw 'The vcv-chat-live collection module marker disappeared during preparation.'
}
$phoneMarker = [pscustomobject][ordered]@{
  managed = $true
  schema = 1
  managed_by = $ManagedBy
  scene_name = $PhoneSceneName
  scene_source_uuid = $phoneScene.uuid
  droidcam_source_uuid = $targetDroid.uuid
  overlay_source_uuid = $phoneOverlay.uuid
  rack_audio_source_uuid = $rackAudio[0].uuid
  canvas_width = $CanvasWidth
  canvas_height = $CanvasHeight
}
Set-ObjectProperty -Object $vcvModule -Name 'phone_live' -Value $phoneMarker

$changedUuids = @($changedUuids | Select-Object -Unique)
$addedUuids = @($addedUuids | Select-Object -Unique)
Assert-PhoneCollection -Collection $collection -RackAudioUuid $rackAudio[0].uuid `
  -OriginalCurrentScene $originalCurrentScene -OriginalProgramScene $originalProgramScene `
  -OriginalSources $originalSources -AllowedChangedSourceUuids $changedUuids `
  -AllowedAddedSourceUuids $addedUuids

$sceneJson = $collection | ConvertTo-Json -Depth 100
try {
  $roundTrip = $sceneJson | ConvertFrom-Json
} catch {
  throw 'The generated Phone Live collection failed JSON round-trip validation.'
}
Assert-PhoneCollection -Collection $roundTrip -RackAudioUuid $rackAudio[0].uuid `
  -OriginalCurrentScene $originalCurrentScene -OriginalProgramScene $originalProgramScene `
  -OriginalSources $originalSources -AllowedChangedSourceUuids $changedUuids `
  -AllowedAddedSourceUuids $addedUuids

if ($ValidateOnly) {
  Write-Host '[obs-phone] Validation passed; no files were changed.'
  Write-Host '[obs-phone] Phone Live will use DroidCam video, Rack Audio, and the phone chat overlay.'
  exit 0
}

if (Test-ObsRunning) {
  throw 'OBS started during Phone Live preparation. No collection changes were committed.'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$tempPath = "$scenePath.$([guid]::NewGuid().ToString('N')).tmp"
try {
  [IO.File]::WriteAllText($tempPath, $sceneJson, $utf8NoBom)
  $tempCollection = Read-ObsCollection -Path $tempPath
  Assert-PhoneCollection -Collection $tempCollection -RackAudioUuid $rackAudio[0].uuid `
    -OriginalCurrentScene $originalCurrentScene -OriginalProgramScene $originalProgramScene `
    -OriginalSources $originalSources -AllowedChangedSourceUuids $changedUuids `
    -AllowedAddedSourceUuids $addedUuids
  if (Test-ObsRunning) {
    throw 'OBS started during Phone Live preparation. No collection changes were committed.'
  }
  Move-Item -LiteralPath $tempPath -Destination $scenePath -Force
} finally {
  if (Test-Path -LiteralPath $tempPath -PathType Leaf) {
    Remove-Item -LiteralPath $tempPath -Force
  }
}

Write-Host '[obs-phone] Phone Live was added/refreshed in the managed VCV Rack Live collection.'
Write-Host '[obs-phone] DroidCam audio is disabled; Rack Audio and the phone chat overlay remain stream sources.'
Write-Host '[obs-phone] Rack Live and the current OBS scene were preserved.'

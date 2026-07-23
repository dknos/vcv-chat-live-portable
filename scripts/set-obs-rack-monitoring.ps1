[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('on', 'off')]
  [string]$Mode
)

# Routes the managed Rack Audio source to OBS's configured monitoring device
# while preserving its stream/recording mix. OBS must be closed so it cannot
# overwrite the scene collection during shutdown.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (@(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'OBS is running. Stop streaming/recording and exit OBS before changing Rack monitoring.'
}

$scenePath = Join-Path $env:APPDATA 'obs-studio\basic\scenes\VCV_Rack_Live.json'
$profilePath = Join-Path $env:APPDATA 'obs-studio\basic\profiles\VCV_Rack_Live\basic.ini'
if (-not (Test-Path -LiteralPath $scenePath -PathType Leaf)) {
  throw 'Managed VCV Rack Live scene collection not found.'
}
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  throw 'Managed VCV Rack Live profile not found.'
}

$profile = [IO.File]::ReadAllText($profilePath)
if ($profile -notmatch '(?m)^VCVChatLiveManaged=true\r?$' -or
    $profile -notmatch '(?m)^MonitoringDeviceId=default\r?$') {
  throw 'The VCV Rack Live profile is not managed or does not monitor the Windows default playback device.'
}

$text = [IO.File]::ReadAllText($scenePath)
if ($text -notmatch '"vcv-chat-live"') {
  throw 'Target scene collection is not managed by vcv-chat-live.'
}
$scene = $text | ConvertFrom-Json
$rackAudio = @($scene.sources | Where-Object {
  $_.id -eq 'wasapi_process_output_capture' -and $_.name -eq 'Rack Audio'
})
if ($rackAudio.Count -ne 1) {
  throw "Expected one managed Rack Audio source; found $($rackAudio.Count)."
}
if ([int64]$rackAudio[0].mixers -eq 0) {
  throw 'Rack Audio is absent from every output mix; refusing to configure monitoring.'
}

# OBS_MONITORING_TYPE_NONE=0, OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT=2.
$expected = if ($Mode -eq 'on') { 2 } else { 0 }
$rackAudio[0].monitoring_type = $expected

$json = $scene | ConvertTo-Json -Depth 100
$temporary = "$scenePath.$([guid]::NewGuid().ToString('N')).tmp"
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
  $roundTrip = [IO.File]::ReadAllText($temporary) | ConvertFrom-Json
  $verified = @($roundTrip.sources | Where-Object {
    $_.id -eq 'wasapi_process_output_capture' -and $_.name -eq 'Rack Audio'
  })
  if ($verified.Count -ne 1 -or [int]$verified[0].monitoring_type -ne $expected -or [int64]$verified[0].mixers -eq 0) {
    throw 'Rack Audio monitoring round-trip validation failed.'
  }
  Move-Item -LiteralPath $temporary -Destination $scenePath -Force
} finally {
  if (Test-Path -LiteralPath $temporary -PathType Leaf) {
    Remove-Item -LiteralPath $temporary -Force
  }
}

Write-Host "[obs-monitor] Rack Audio monitor-and-output=$($Mode -eq 'on'); device=Windows Default."

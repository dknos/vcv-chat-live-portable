[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$EnvFile,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (@(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'OBS is running. Exit OBS before configuring its YouTube service.'
}

$profilePath = Join-Path $env:APPDATA 'obs-studio\basic\profiles\VCV_Rack_Live'
$profileIni = Join-Path $profilePath 'basic.ini'
if (-not (Test-Path -LiteralPath $profileIni -PathType Leaf)) {
  throw 'The managed VCV Rack Live OBS profile does not exist. Run prepare-obs.ps1 first.'
}

$profileText = [IO.File]::ReadAllText($profileIni)
if ($profileText -notmatch '(?m)^ManagedBy=vcv-chat-live/scripts/prepare-obs\.ps1$') {
  throw 'The target OBS profile is not managed by vcv-chat-live; refusing to write service.json.'
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Credential env file not found: $EnvFile"
}

$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $settings[$Matches[1]] = $value
  }
}

$streamKey = [string]$settings['YOUTUBE_STREAM_KEY']
if ([string]::IsNullOrWhiteSpace($streamKey) -or $streamKey.Length -gt 256 -or $streamKey -match '[\r\n]') {
  throw 'YOUTUBE_STREAM_KEY is missing or malformed.'
}

$service = [ordered]@{
  type = 'rtmp_common'
  settings = [ordered]@{
    service = 'YouTube - RTMPS'
    protocol = 'RTMPS'
    server = 'rtmps://a.rtmps.youtube.com:443/live2'
    bwtest = $false
    key = $streamKey
    use_auth = $false
  }
}

$json = $service | ConvertTo-Json -Depth 8
$parsed = $json | ConvertFrom-Json
if ($parsed.type -ne 'rtmp_common' -or $parsed.settings.key -ne $streamKey -or
    $parsed.settings.server -notlike 'rtmps://a.rtmps.youtube.com:*') {
  throw 'Generated OBS service configuration failed validation.'
}

if ($ValidateOnly) {
  Write-Host '[obs-youtube] Validation passed; no file was written and no credential was printed.'
  exit 0
}

$target = Join-Path $profilePath 'service.json'
$temporary = Join-Path $profilePath ('.service.' + [guid]::NewGuid().ToString('N') + '.tmp')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
try {
  [IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
  $roundTrip = [IO.File]::ReadAllText($temporary) | ConvertFrom-Json
  if ($roundTrip.settings.key -ne $streamKey) {
    throw 'Temporary OBS service file failed validation.'
  }
  Move-Item -LiteralPath $temporary -Destination $target -Force
} finally {
  if (Test-Path -LiteralPath $temporary -PathType Leaf) {
    Remove-Item -LiteralPath $temporary -Force
  }
}

Write-Host '[obs-youtube] Configured the managed profile for YouTube RTMPS.'
Write-Host '[obs-youtube] The stream key was read locally and was not printed.'

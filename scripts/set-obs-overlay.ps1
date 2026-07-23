[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('show', 'hide')]
  [string]$Mode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (@(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'OBS is running. Exit OBS before changing the managed overlay visibility.'
}

$scenePath = Join-Path $env:APPDATA 'obs-studio\basic\scenes\VCV_Rack_Live.json'
if (-not (Test-Path -LiteralPath $scenePath -PathType Leaf)) {
  throw 'Managed VCV Rack Live scene collection not found.'
}
$text = [IO.File]::ReadAllText($scenePath)
if ($text -notmatch '"vcv-chat-live"') {
  throw 'Target scene collection is not managed by vcv-chat-live.'
}
$scene = $text | ConvertFrom-Json
$sceneSource = @($scene.sources | Where-Object { $_.id -eq 'scene' -and $_.name -eq 'Rack Live' })[0]
if (-not $sceneSource) { throw 'Rack Live scene source not found.' }
$item = @($sceneSource.settings.items | Where-Object { $_.name -eq 'Chat Music Overlay' })[0]
if (-not $item) { throw 'Chat Music Overlay scene item not found.' }
$visible = $Mode -eq 'show'
$item.visible = $visible

$json = $scene | ConvertTo-Json -Depth 100
$temporary = "$scenePath.$([guid]::NewGuid().ToString('N')).tmp"
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
  $roundTrip = [IO.File]::ReadAllText($temporary) | ConvertFrom-Json
  $roundTripScene = @($roundTrip.sources | Where-Object { $_.id -eq 'scene' -and $_.name -eq 'Rack Live' })[0]
  $roundTripItem = @($roundTripScene.settings.items | Where-Object { $_.name -eq 'Chat Music Overlay' })[0]
  if ($roundTripItem.visible -ne $visible) { throw 'Overlay visibility round-trip validation failed.' }
  Move-Item -LiteralPath $temporary -Destination $scenePath -Force
} finally {
  if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary -Force }
}

Write-Host "[obs-overlay] Chat Music Overlay visible=$visible"

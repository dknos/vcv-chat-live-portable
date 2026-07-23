[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('StartRecording', 'StopRecording', 'StartStreaming', 'StopStreaming')]
  [string]$Action,

  [ValidateRange(75, 1000)]
  [int]$HoldMilliseconds = 150,

  [ValidateRange(1, 15)]
  [int]$VerifyTimeoutSeconds = 5,

  [switch]$NoLogVerification
)

# Sends one of the output-control hotkeys owned by the managed VCV Rack Live
# profile. The key is held long enough for OBS's polling hotkey thread to see
# it, so this does not need to restore or focus the minimized OBS window.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$actions = @{
  StartRecording = [pscustomobject]@{
    ConfigName = 'OBSBasic.StartRecording'
    ObsKey = 'OBS_KEY_F9'
    VirtualKey = [byte]0x78
    LogMessage = 'Starting recording due to hotkey'
  }
  StopRecording = [pscustomobject]@{
    ConfigName = 'OBSBasic.StopRecording'
    ObsKey = 'OBS_KEY_F10'
    VirtualKey = [byte]0x79
    LogMessage = 'Stopping recording due to hotkey'
  }
  StartStreaming = [pscustomobject]@{
    ConfigName = 'OBSBasic.StartStreaming'
    ObsKey = 'OBS_KEY_F11'
    VirtualKey = [byte]0x7A
    LogMessage = 'Starting stream due to hotkey'
  }
  StopStreaming = [pscustomobject]@{
    ConfigName = 'OBSBasic.StopStreaming'
    ObsKey = 'OBS_KEY_F12'
    VirtualKey = [byte]0x7B
    LogMessage = 'Stopping stream due to hotkey'
  }
}
$selected = $actions[$Action]

function Read-SharedText {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

$profilePath = Join-Path $env:APPDATA 'obs-studio\basic\profiles\VCV_Rack_Live\basic.ini'
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  throw 'The managed VCV Rack Live OBS profile is missing. Run prepare-obs.ps1 first.'
}

$profileIni = [IO.File]::ReadAllText($profilePath)
if ($profileIni -notmatch '(?m)^Name=VCV Rack Live\r?$' -or
    $profileIni -notmatch '(?m)^VCVChatLiveManaged=true\r?$' -or
    $profileIni -notmatch '(?m)^ManagedBy=vcv-chat-live/scripts/prepare-obs\.ps1\r?$') {
  throw 'The VCV Rack Live profile is not marked as managed; refusing to send a global hotkey.'
}

$entryPattern = '(?m)^' + [regex]::Escape([string]$selected.ConfigName) + '=(?<json>\{[^\r\n]*\})\r?$'
$entryMatches = [regex]::Matches($profileIni, $entryPattern)
if ($entryMatches.Count -ne 1) {
  throw "The managed profile does not contain exactly one '$($selected.ConfigName)' binding."
}

try {
  $hotkeyData = $entryMatches[0].Groups['json'].Value | ConvertFrom-Json
} catch {
  throw "The managed '$($selected.ConfigName)' binding is not valid JSON: $($_.Exception.Message)"
}

$bindings = @($hotkeyData.bindings)
if ($bindings.Count -ne 1) {
  throw "The managed '$($selected.ConfigName)' hotkey must contain exactly one binding."
}
$binding = $bindings[0]
$shiftProperty = $binding.PSObject.Properties['shift']
$controlProperty = $binding.PSObject.Properties['control']
$keyProperty = $binding.PSObject.Properties['key']
if ($null -eq $shiftProperty -or $shiftProperty.Value -isnot [bool] -or -not $shiftProperty.Value -or
    $null -eq $controlProperty -or $controlProperty.Value -isnot [bool] -or -not $controlProperty.Value -or
    $null -eq $keyProperty -or $keyProperty.Value -ne $selected.ObsKey) {
  throw "The managed '$($selected.ConfigName)' binding is not Ctrl+Shift+$($selected.ObsKey.Replace('OBS_KEY_', ''))."
}

$obsProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'obs64.exe'")
if ($obsProcesses.Count -ne 1) {
  throw "Expected exactly one running obs64.exe process; found $($obsProcesses.Count)."
}
$obsProcess = $obsProcesses[0]
$expectedObsExe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
if ([string]::IsNullOrWhiteSpace([string]$obsProcess.ExecutablePath) -or
    [IO.Path]::GetFullPath([string]$obsProcess.ExecutablePath) -ine [IO.Path]::GetFullPath($expectedObsExe)) {
  throw 'The running obs64.exe is not the expected OBS Studio installation.'
}

$managedProfileArgument = '(?i)(?:^|\s)--profile(?:=|\s+)"?VCV Rack Live"?(?=\s+--|$)'
if ([string]::IsNullOrWhiteSpace([string]$obsProcess.CommandLine) -or
    $obsProcess.CommandLine -notmatch $managedProfileArgument) {
  throw 'OBS was not launched with the VCV Rack Live profile; refusing to send a global hotkey.'
}

$userIniPath = Join-Path $env:APPDATA 'obs-studio\user.ini'
if (Test-Path -LiteralPath $userIniPath -PathType Leaf) {
  $userIni = [IO.File]::ReadAllText($userIniPath)
  $focusMatch = [regex]::Match($userIni, '(?m)^HotkeyFocusType=(?<value>[^\r\n]+)\r?$')
  if ($focusMatch.Success -and $focusMatch.Groups['value'].Value -eq 'DisableHotkeysOutOfFocus') {
    throw 'OBS hotkeys are disabled while OBS is out of focus. Set Hotkey Focus Behavior to Never disable hotkeys.'
  }
}

$logDirectory = Join-Path $env:APPDATA 'obs-studio\logs'
$currentLog = $null
$startupText = ''
$startupDeadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $currentLog = Get-ChildItem -LiteralPath $logDirectory -Filter '*.txt' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $obsProcess.CreationDate.AddSeconds(-5) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -ne $currentLog) {
    $startupText = Read-SharedText -Path $currentLog.FullName
    if ($startupText -match '==== Startup complete') {
      break
    }
  }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $startupDeadline)

if ($null -eq $currentLog -or $startupText -notmatch '==== Startup complete') {
  throw 'OBS did not reach Startup complete within 15 seconds; no hotkey was sent.'
}

$priorLogCount = [regex]::Matches($startupText, [regex]::Escape([string]$selected.LogMessage)).Count

if ($null -eq ('VcvChatLive.NativeKeyboard' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace VcvChatLive {
    public static class NativeKeyboard {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int virtualKey);
    }
}
'@
}

$controlKey = [byte]0x11
$shiftKey = [byte]0x10
$keyUp = [uint32]0x0002
foreach ($virtualKey in @($controlKey, $shiftKey, [byte]$selected.VirtualKey)) {
  if (([int][VcvChatLive.NativeKeyboard]::GetAsyncKeyState($virtualKey) -band 0x8000) -ne 0) {
    throw 'Ctrl, Shift, or the target function key is already held; no hotkey was sent.'
  }
}

$controlDown = $false
$shiftDown = $false
$targetDown = $false
try {
  [VcvChatLive.NativeKeyboard]::keybd_event($controlKey, 0, 0, [UIntPtr]::Zero)
  $controlDown = $true
  [VcvChatLive.NativeKeyboard]::keybd_event($shiftKey, 0, 0, [UIntPtr]::Zero)
  $shiftDown = $true

  # OBS polls global key state every 25 ms. Let it see the modifiers first,
  # then hold the function key across several polling intervals.
  Start-Sleep -Milliseconds 75
  [VcvChatLive.NativeKeyboard]::keybd_event([byte]$selected.VirtualKey, 0, 0, [UIntPtr]::Zero)
  $targetDown = $true
  Start-Sleep -Milliseconds $HoldMilliseconds
  [VcvChatLive.NativeKeyboard]::keybd_event([byte]$selected.VirtualKey, 0, $keyUp, [UIntPtr]::Zero)
  $targetDown = $false
  Start-Sleep -Milliseconds 50
} finally {
  if ($targetDown) {
    [VcvChatLive.NativeKeyboard]::keybd_event([byte]$selected.VirtualKey, 0, $keyUp, [UIntPtr]::Zero)
  }
  if ($shiftDown) {
    [VcvChatLive.NativeKeyboard]::keybd_event($shiftKey, 0, $keyUp, [UIntPtr]::Zero)
  }
  if ($controlDown) {
    [VcvChatLive.NativeKeyboard]::keybd_event($controlKey, 0, $keyUp, [UIntPtr]::Zero)
  }
}

if ($NoLogVerification) {
  Write-Host "[obs-hotkey] Sent $Action (Ctrl+Shift+$($selected.ObsKey.Replace('OBS_KEY_', '')))."
  exit 0
}

$verifyDeadline = [DateTime]::UtcNow.AddSeconds($VerifyTimeoutSeconds)
do {
  Start-Sleep -Milliseconds 250
  $updatedLogText = Read-SharedText -Path $currentLog.FullName
  $updatedLogCount = [regex]::Matches($updatedLogText, [regex]::Escape([string]$selected.LogMessage)).Count
  if ($updatedLogCount -gt $priorLogCount) {
    Write-Host "[obs-hotkey] OBS acknowledged $Action (Ctrl+Shift+$($selected.ObsKey.Replace('OBS_KEY_', '')))."
    exit 0
  }
} while ([DateTime]::UtcNow -lt $verifyDeadline)

throw "OBS did not acknowledge $Action in its log within $VerifyTimeoutSeconds seconds. The requested state may already have been active/inactive."

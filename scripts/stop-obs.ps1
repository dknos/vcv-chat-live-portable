[CmdletBinding()]
param(
  [ValidateRange(3, 30)]
  [int]$TimeoutSeconds = 15,

  [ValidateNotNullOrEmpty()]
  [string]$ProfileName = 'VCV Rack Live'
)

# Cleanly closes only an OBS instance launched with the requested profile.
# OBS 32.1.2 on this host can fault while destroying a minimized preview, so
# restore the window before requesting shutdown and never force-close an active
# output.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

$obsProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'obs64.exe'")
if ($obsProcesses.Count -ne 1) {
  throw "Expected exactly one running obs64.exe process; found $($obsProcesses.Count)."
}
$obsInfo = $obsProcesses[0]
$expectedObsExe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
if ([string]::IsNullOrWhiteSpace([string]$obsInfo.ExecutablePath) -or
    [IO.Path]::GetFullPath([string]$obsInfo.ExecutablePath) -ine [IO.Path]::GetFullPath($expectedObsExe)) {
  throw 'The running obs64.exe is not the expected OBS Studio installation.'
}
$profilePattern = '(?i)(?:^|\s)--profile(?:=|\s+)"?' + [Regex]::Escape($ProfileName) + '"?(?=\s+--|$)'
if ([string]::IsNullOrWhiteSpace([string]$obsInfo.CommandLine) -or
    $obsInfo.CommandLine -notmatch $profilePattern) {
  throw "OBS was not launched with the requested '$ProfileName' profile; refusing to close it."
}

$logDirectory = Join-Path $env:APPDATA 'obs-studio\logs'
$currentLog = Get-ChildItem -LiteralPath $logDirectory -Filter '*.txt' -File |
  Where-Object { $_.LastWriteTime -ge $obsInfo.CreationDate.AddSeconds(-5) } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($null -eq $currentLog) {
  throw 'The current OBS log could not be identified; refusing to close OBS.'
}
$logText = Read-SharedText -Path $currentLog.FullName
if ($logText -notmatch '==== Startup complete') {
  throw 'OBS has not reached Startup complete; refusing to close it.'
}

$recordingActive = $logText.LastIndexOf('==== Recording Start') -gt $logText.LastIndexOf('==== Recording Stop')
$streamingActive = $logText.LastIndexOf('==== Streaming Start') -gt $logText.LastIndexOf('==== Streaming Stop')
if ($recordingActive -or $streamingActive) {
  $active = @()
  if ($recordingActive) { $active += 'recording' }
  if ($streamingActive) { $active += 'streaming' }
  throw "OBS still has active output: $($active -join ', '). Stop it with send-obs-hotkey.ps1 first."
}

$rackCaptureScript = Join-Path $PSScriptRoot 'set-rack-capture-window.ps1'
if ($ProfileName -eq 'VCV Rack Live' -and (Test-Path -LiteralPath $rackCaptureScript -PathType Leaf)) {
  & $rackCaptureScript -Action Disable
}

if ($null -eq ('VcvChatLive.ObsWindow' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace VcvChatLive {
    public static class ObsWindow {
        public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    }
}
'@
}

$obs = Get-Process -Id ([int]$obsInfo.ProcessId) -ErrorAction Stop
$handle = $obs.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) {
  $script:obsWindowHandle = [IntPtr]::Zero
  $callback = [VcvChatLive.ObsWindow+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$parameter)

    $windowProcessId = [uint32]0
    [VcvChatLive.ObsWindow]::GetWindowThreadProcessId($window, [ref]$windowProcessId) | Out-Null
    if ($windowProcessId -eq [uint32]$obs.Id) {
      $title = New-Object Text.StringBuilder 512
      [VcvChatLive.ObsWindow]::GetWindowText($window, $title, $title.Capacity) | Out-Null
      if ($title.ToString().StartsWith('OBS Studio')) {
        $script:obsWindowHandle = $window
        return $false
      }
    }
    return $true
  }
  [VcvChatLive.ObsWindow]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  $handle = $script:obsWindowHandle
}
if ($handle -eq [IntPtr]::Zero) {
  throw 'The managed OBS process has no main window.'
}
[VcvChatLive.ObsWindow]::ShowWindow($handle, 9) | Out-Null
[VcvChatLive.ObsWindow]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 750

if (-not [VcvChatLive.ObsWindow]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
  throw 'OBS did not accept the normal close request.'
}
if (-not $obs.WaitForExit($TimeoutSeconds * 1000)) {
  throw "OBS did not exit within $TimeoutSeconds seconds; it was not force-closed."
}

Write-Host "[obs-stop] OBS exited cleanly (PID $($obs.Id))."

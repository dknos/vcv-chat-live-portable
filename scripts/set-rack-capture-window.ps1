[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('Enable', 'Disable')]
  [string]$Action,

  [string]$CaptureMonitorId = '\\.\DISPLAY64',

  [string[]]$AllowedPatchNames = @(
    'ChatRack-Live.vcv',
    'Doom-Jazz-Machine.vcv'
  )
)

# Rack-only compatibility BitBlt is the managed OBS video path. Rack is moved
# to the dedicated 1920x1080 capture display before it is maximized. This keeps
# its client texture small and stable while leaving the primary desktop out of
# the source entirely.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if ($null -eq ('VcvChatLive.RackWindow' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace VcvChatLive {
    public static class RackWindow {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetWindowPos(
            IntPtr window,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags
        );

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsZoomed(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int virtualKey);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        public static bool PostF4(IntPtr window) {
            const uint WM_KEYDOWN = 0x0100;
            const uint WM_KEYUP = 0x0101;
            IntPtr key = new IntPtr(0x73);
            IntPtr down = new IntPtr(0x003e0001);
            IntPtr up = new IntPtr(unchecked((long)0x00000000c03e0001));
            return PostMessage(window, WM_KEYDOWN, key, down)
                && PostMessage(window, WM_KEYUP, key, up);
        }
    }
}
'@
}

$rackProcesses = @(Get-Process -Name 'Rack' -ErrorAction SilentlyContinue)
if ($rackProcesses.Count -ne 1) {
  throw "Expected exactly one running Rack.exe process; found $($rackProcesses.Count)."
}

$rack = $rackProcesses[0]
$rack.Refresh()
if ($rack.MainWindowHandle -eq [IntPtr]::Zero) {
  throw 'Rack.exe has no main window.'
}
$noMoveNoSizeShow = [uint32](0x0001 -bor 0x0002 -bor 0x0040)
if ($Action -eq 'Enable') {
  $allowedTitles = @($AllowedPatchNames | ForEach-Object {
    '^VCV Rack Free 2\.6\.6 - \*?' + [Regex]::Escape($_) + '$'
  })
  $titleAllowed = @($allowedTitles | Where-Object { $rack.MainWindowTitle -match $_ }).Count -gt 0
  if (-not $titleAllowed) {
    throw "Rack is not showing an allowlisted managed patch ($($AllowedPatchNames -join ', ')): '$($rack.MainWindowTitle)'."
  }

  $captureScreens = @([System.Windows.Forms.Screen]::AllScreens | Where-Object {
    $_.DeviceName -ieq $CaptureMonitorId
  })
  if ($captureScreens.Count -ne 1) {
    $available = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName }) -join ', '
    throw "Capture display '$CaptureMonitorId' was not found exactly once. Available: $available"
  }
  $captureScreen = $captureScreens[0]
  if ($captureScreen.Bounds.Width -ne 1920 -or $captureScreen.Bounds.Height -ne 1080) {
    throw "Capture display '$CaptureMonitorId' must be 1920x1080; found $($captureScreen.Bounds.Width)x$($captureScreen.Bounds.Height)."
  }

  # Restore before moving so Windows associates the normal window rectangle
  # with the target display, then maximize into that display's work area.
  [VcvChatLive.RackWindow]::ShowWindow($rack.MainWindowHandle, 9) | Out-Null
  $target = $captureScreen.WorkingArea
  if (-not [VcvChatLive.RackWindow]::SetWindowPos(
      $rack.MainWindowHandle,
      [IntPtr](-1),
      $target.X,
      $target.Y,
      $target.Width,
      $target.Height,
      [uint32]0x0040
    )) {
    throw "Windows refused to move Rack to capture display '$CaptureMonitorId'."
  }
  [VcvChatLive.RackWindow]::ShowWindow($rack.MainWindowHandle, 3) | Out-Null
  if (-not [VcvChatLive.RackWindow]::SetWindowPos(
      $rack.MainWindowHandle,
      [IntPtr](-1),
      0,
      0,
      0,
      0,
      $noMoveNoSizeShow
    )) {
    throw 'Windows refused to make the Rack capture window topmost.'
  }
  [VcvChatLive.RackWindow]::SetForegroundWindow($rack.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 200
  if ([VcvChatLive.RackWindow]::GetForegroundWindow() -ne $rack.MainWindowHandle) {
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate($rack.Id) | Out-Null
    Start-Sleep -Milliseconds 300
  }

  # Rack's F4 command frames all modules in the current client area. This is
  # necessary after moving from the 5120-wide primary display to the 1920-wide
  # capture display, otherwise Rack retains the tiny zoom from the old window.
  if ([VcvChatLive.RackWindow]::GetForegroundWindow() -eq $rack.MainWindowHandle) {
    foreach ($modifier in @(0x10, 0x11, 0x12, 0x5B, 0x5C)) {
      if (([int][VcvChatLive.RackWindow]::GetAsyncKeyState($modifier) -band 0x8000) -ne 0) {
        throw 'A keyboard modifier is held; Rack view framing was not attempted.'
      }
    }
    $f4 = [byte]0x73
    $keyUp = [uint32]0x0002
    [VcvChatLive.RackWindow]::keybd_event($f4, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 75
    [VcvChatLive.RackWindow]::keybd_event($f4, 0, $keyUp, [UIntPtr]::Zero)
  } elseif (-not [VcvChatLive.RackWindow]::PostF4($rack.MainWindowHandle)) {
    throw 'Rack did not become foreground and Windows refused the window-scoped F4 fallback.'
  }
  Start-Sleep -Milliseconds 500
  if ([VcvChatLive.RackWindow]::IsIconic($rack.MainWindowHandle) -or
      -not [VcvChatLive.RackWindow]::IsZoomed($rack.MainWindowHandle)) {
    throw 'Rack did not enter a maximized state.'
  }
  $actualScreen = [System.Windows.Forms.Screen]::FromHandle($rack.MainWindowHandle)
  if ($actualScreen.DeviceName -ine $CaptureMonitorId) {
    throw "Rack landed on '$($actualScreen.DeviceName)' instead of '$CaptureMonitorId'."
  }
  Write-Host "[rack-capture] Rack is framed, maximized, and topmost on $CaptureMonitorId (PID $($rack.Id))."
  exit 0
}

if (-not [VcvChatLive.RackWindow]::SetWindowPos(
    $rack.MainWindowHandle,
    [IntPtr](-2),
    0,
    0,
    0,
    0,
    $noMoveNoSizeShow
  )) {
  throw 'Windows refused to release the Rack capture window from topmost.'
}
Write-Host "[rack-capture] Rack topmost mode is disabled (PID $($rack.Id))."

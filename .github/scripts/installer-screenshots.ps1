# Walks through the Windows installer and the uninstaller and saves a
# screenshot of every page, so a change to the installer's theme can be
# reviewed on real Windows (CI uploads the folder as an artifact).
#
# usage: installer-screenshots.ps1 <setup.exe> <output folder>
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
}
'@
[Win]::SetProcessDPIAware() | Out-Null
$shell = New-Object -ComObject WScript.Shell
New-Item -ItemType Directory -Force $Out | Out-Null

# The installer's window (the uninstaller runs from a copy in %TEMP%, so
# look it up by title rather than by process).
function Find-Window {
  for ($i = 0; $i -lt 60; $i++) {
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like 'MoonTask*' } | Select-Object -First 1
    if ($p) { return $p }
    Start-Sleep -Milliseconds 500
  }
  throw 'The installer window did not appear.'
}

function Save-Page([string] $Name) {
  Start-Sleep -Seconds 2
  $p = Find-Window
  [Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 500
  # DWMWA_EXTENDED_FRAME_BOUNDS: the visible window, without the invisible
  # resize border.
  $r = New-Object Win+RECT
  [Win]::DwmGetWindowAttribute($p.MainWindowHandle, 9, [ref] $r, 16) | Out-Null
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Out "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "Saved $Name ($w x $h)"
}

function Press([string] $Keys) {
  $p = Find-Window
  [Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  $shell.SendKeys($Keys)
}

function Stop-Setup {
  Get-Process | Where-Object { $_.MainWindowTitle -like 'MoonTask*' } | Stop-Process -Force
  Get-Process moontask -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

# A fresh install: welcome, folder, progress, finish.
Start-Process $Setup
Save-Page '1-welcome'
Press '{ENTER}'; Save-Page '2-folder'
Press '{ENTER}'; Start-Sleep -Seconds 8; Save-Page '3-installed'
Press '{ENTER}'; Save-Page '4-finish'
Stop-Setup

# Installing again offers to reinstall or uninstall.
Start-Process $Setup
Start-Sleep -Seconds 1
Press '{ENTER}'; Save-Page '5-already-installed'
Stop-Setup

# The uninstaller's confirmation page (it closes by itself once done).
Start-Process (Join-Path $env:LOCALAPPDATA 'MoonTask\uninstall.exe')
Save-Page '6-uninstall'
Stop-Setup


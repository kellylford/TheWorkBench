# vmtest guest agent. Runs inside the test VM, in the signed-in user's desktop session, started by
# the scheduled task "vmtest-agent". It reads one request from C:\vmtest\request.json, carries it out
# with UI Automation, and writes the answer to C:\vmtest\response.json. The host side is VmTest.psm1.
param([string]$Root = 'C:\vmtest')

$ErrorActionPreference = 'Stop'
$response = [ordered]@{ id = $null; ok = $true }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace VmTest {
    public static class Native {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);

        static INPUT Key(ushort vk, ushort scan, uint flags) {
            INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
        }

        // Types text as Unicode characters, so the result doesn't depend on Shift timing or the keyboard layout.
        public static void TypeText(string text) {
            const uint KEYUP = 0x2, UNICODE = 0x4;
            foreach (char c in text) {
                if (c == '\r') continue;
                INPUT[] pair = c == '\n'
                    ? new[] { Key(0x0D, 0, 0), Key(0x0D, 0, KEYUP) }
                    : new[] { Key(0, c, UNICODE), Key(0, c, UNICODE | KEYUP) };
                if (SendInput(2, pair, Marshal.SizeOf(typeof(INPUT))) != 2) throw new System.ComponentModel.Win32Exception();
                System.Threading.Thread.Sleep(5);
            }
        }
    }
}
'@

$AE = [System.Windows.Automation.AutomationElement]

function Get-Description($el) {
    $c = $el.Current
    $text = "$($c.ControlType.ProgrammaticName -replace '^ControlType\.', '') '$($c.Name)'"
    if ($c.AutomationId) { $text += " id='$($c.AutomationId)'" }
    try { $text += " value='$($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'" } catch {}
    try { $text += " toggle=$($el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState)" } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { $text += ' selected' } } catch {}
    try { $text += " $($el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Current.ExpandCollapseState)".ToLower() } catch {}
    if (-not $c.IsEnabled) { $text += ' disabled' }
    if ($c.HasKeyboardFocus) { $text += ' FOCUSED' }
    $text
}

function Get-TopWindows {
    $AE::RootElement.FindAll('Children', [System.Windows.Automation.Condition]::TrueCondition) |
        Where-Object { $_.Current.Name -and $_.Current.ClassName -notin 'Shell_TrayWnd', 'Progman' }
}

# The window to work in: a process id, part of a title, or (when empty) the window in front.
function Get-TargetWindow([string]$Spec) {
    if (-not $Spec) {
        $hwnd = [VmTest.Native]::GetForegroundWindow()
        if ($hwnd -eq [IntPtr]::Zero) { throw 'No window is in front in the test VM.' }
        return $AE::FromHandle($hwnd)
    }
    $windows = @(Get-TopWindows)
    $match = if ($Spec -match '^\d+$') {
        $windows | Where-Object { $_.Current.ProcessId -eq [int]$Spec } | Select-Object -First 1
    } else {
        $windows | Where-Object { $_.Current.Name -like "*$Spec*" } | Select-Object -First 1
    }
    if (-not $match) {
        $names = ($windows | ForEach-Object { "'$($_.Current.Name)'" }) -join ', '
        throw "No window matches '$Spec'. Open windows: $names"
    }
    $match
}

# A control inside the window: by AutomationId first, then exact name, then part of the name.
function Find-Target($Window, [string]$Target) {
    if (-not $Target) { throw 'Say which control: its AutomationId or its name.' }
    $all = $Window.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($test in @(
            { param($c) $c.AutomationId -eq $Target },
            { param($c) $c.Name -eq $Target },
            { param($c) $c.Name -like "*$Target*" })) {
        foreach ($el in $all) { if (& $test $el.Current) { return $el } }
    }
    throw "No control named '$Target' (AutomationId or name) in '$($Window.Current.Name)'."
}

# Bring the window to the front of the guest desktop, and refuse to go on if it didn't get there,
# so keys are never typed into the wrong window.
function Enter-Window($Window) {
    $hwnd = [IntPtr]$Window.Current.NativeWindowHandle
    if ([VmTest.Native]::IsIconic($hwnd)) { [VmTest.Native]::ShowWindow($hwnd, 9) | Out-Null }
    [VmTest.Native]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    if ([VmTest.Native]::GetForegroundWindow() -ne $hwnd) {
        [VmTest.Native]::ShowWindow($hwnd, 6) | Out-Null   # minimize then restore makes Windows activate it
        [VmTest.Native]::ShowWindow($hwnd, 9) | Out-Null
        Start-Sleep -Milliseconds 500
    }
    if ([VmTest.Native]::GetForegroundWindow() -ne $hwnd) {
        throw "Couldn't bring '$($Window.Current.Name)' to the front, so no keys were sent."
    }
    $focused = $AE::FocusedElement
    if ($focused -and $focused.Current.ProcessId -ne $Window.Current.ProcessId) {
        throw "Keyboard focus is on '$($focused.Current.Name)' in another program, so no keys were sent."
    }
}

function Get-FocusReport {
    $f = $AE::FocusedElement
    if (-not $f) { return '(nothing has keyboard focus)' }
    $top = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $win = $f; $parent = $top.GetParent($win)
    while ($parent -and $parent -ne $AE::RootElement) { $win = $parent; $parent = $top.GetParent($win) }
    "$(Get-Description $f)  [in window '$($win.Current.Name)']"
}

function Get-Tree($Window, [int]$MaxDepth) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $lines = New-Object System.Collections.Generic.List[string]
    $walk = {
        param($el, $depth)
        if ($lines.Count -ge 500) { return }
        $lines.Add(('  ' * $depth) + (Get-Description $el))
        if ($depth -ge $MaxDepth) { return }
        $child = $walker.GetFirstChild($el)
        while ($child) { & $walk $child ($depth + 1); $child = $walker.GetNextSibling($child) }
    }
    & $walk $Window 0
    if ($lines.Count -ge 500) { $lines.Add('... (stopped at 500 controls; ask for a smaller depth or another window)') }
    $lines
}

try {
    $request = Get-Content (Join-Path $Root 'request.json') -Raw | ConvertFrom-Json
    $response.id = $request.id
    switch ($request.op) {
        'launch' {
            $startArgs = @{ FilePath = $request.path; PassThru = $true }
            if ([System.IO.Path]::IsPathRooted($request.path)) {
                if (-not (Test-Path $request.path -PathType Leaf)) {
                    throw "There's no program at $($request.path) in the VM. Copy it in first with 'vmtest deploy'."
                }
                $startArgs.WorkingDirectory = Split-Path $request.path
            }
            if ($request.args) { $startArgs.ArgumentList = $request.args }
            $existing = @(Get-TopWindows | ForEach-Object { $_.Current.NativeWindowHandle })
            $proc = Start-Process @startArgs
            # Wait for the program's window. Some programs (Notepad, packaged apps) are launchers that
            # hand off to another process and exit, so a new top-level window from anyone counts too.
            $win = $null
            $deadline = (Get-Date).AddSeconds(30)
            while (-not $win -and (Get-Date) -lt $deadline) {
                Start-Sleep -Milliseconds 300
                $proc.Refresh()
                if (-not $proc.HasExited -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
                    $win = $AE::FromHandle($proc.MainWindowHandle)
                } elseif ($proc.HasExited) {
                    $win = Get-TopWindows | Where-Object { $existing -notcontains $_.Current.NativeWindowHandle } | Select-Object -First 1
                }
            }
            if (-not $win) {
                if ($proc.HasExited) { throw "The program closed (exit code $($proc.ExitCode)) without showing a window." }
                throw "The program started (process $($proc.Id)) but showed no window within 30 seconds."
            }
            # Bring it to the front, as it would be if a person had opened it. Not fatal if Windows says no.
            try { Enter-Window $win } catch { $response.warning = $_.Exception.Message }
            Start-Sleep -Milliseconds 300
            $response.pid = $win.Current.ProcessId
            $response.title = $win.Current.Name
            $response.focus = Get-FocusReport
        }
        'windows' {
            $response.lines = @(Get-TopWindows | ForEach-Object {
                    $c = $_.Current
                    "pid $($c.ProcessId)  '$($c.Name)'  class=$($c.ClassName)"
                })
            $response.focus = Get-FocusReport
        }
        'tree' {
            $depth = if ($request.depth) { [int]$request.depth } else { 6 }
            $response.lines = @(Get-Tree (Get-TargetWindow $request.window) $depth)
        }
        'focused' { $response.focus = Get-FocusReport }
        'invoke' {
            $el = Find-Target (Get-TargetWindow $request.window) $request.target
            $done = $null
            foreach ($p in @(
                    @([System.Windows.Automation.InvokePattern]::Pattern, { param($x) $x.Invoke() }, 'pressed'),
                    @([System.Windows.Automation.TogglePattern]::Pattern, { param($x) $x.Toggle() }, 'toggled'),
                    @([System.Windows.Automation.SelectionItemPattern]::Pattern, { param($x) $x.Select() }, 'selected'),
                    @([System.Windows.Automation.ExpandCollapsePattern]::Pattern, {
                            param($x) if ($x.Current.ExpandCollapseState -eq 'Collapsed') { $x.Expand() } else { $x.Collapse() } }, 'expanded or collapsed'))) {
                $pattern = $null
                if ($el.TryGetCurrentPattern($p[0], [ref]$pattern)) { & $p[1] $pattern; $done = $p[2]; break }
            }
            if (-not $done) { throw "'$($el.Current.Name)' can't be pressed, toggled, selected or expanded." }
            Start-Sleep -Milliseconds 700
            $response.result = "$done $(Get-Description $el)"
            $response.focus = Get-FocusReport
        }
        'setvalue' {
            $el = Find-Target (Get-TargetWindow $request.window) $request.target
            $pattern = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                throw "'$($el.Current.Name)' doesn't take a typed value."
            }
            $pattern.SetValue([string]$request.value)
            Start-Sleep -Milliseconds 300
            $response.result = Get-Description $el
        }
        'focus' {
            $el = Find-Target (Get-TargetWindow $request.window) $request.target
            $el.SetFocus()
            Start-Sleep -Milliseconds 300
            $response.focus = Get-FocusReport
        }
        'keys' {
            Enter-Window (Get-TargetWindow $request.window)
            [System.Windows.Forms.SendKeys]::SendWait([string]$request.keys)
            Start-Sleep -Milliseconds 500
            $response.focus = Get-FocusReport
        }
        'type' {
            Enter-Window (Get-TargetWindow $request.window)
            [VmTest.Native]::TypeText([string]$request.text)
            Start-Sleep -Milliseconds 500
            $response.focus = Get-FocusReport
        }
        'run' {
            # A command line run by cmd.exe as the signed-in user (where per-user tools like winget work),
            # with its output and exit code handed back.
            $outFile = Join-Path $Root 'run.out'
            $proc = Start-Process cmd.exe -ArgumentList '/d', '/s', '/c', "`"$($request.command) > `"$outFile`" 2>&1`"" `
                -WindowStyle Hidden -PassThru
            $limit = if ($request.timeout) { [int]$request.timeout } else { 600 }
            if (-not $proc.WaitForExit($limit * 1000)) {
                & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null
                $tail = if (Test-Path $outFile) { (Get-Content $outFile -Tail 20) -join "`n" } else { '' }
                throw "The command was still running after $limit seconds and was stopped. Last output:`n$tail"
            }
            $lines = if (Test-Path $outFile) { @(Get-Content $outFile | ForEach-Object { [string]$_ }) } else { @() }
            # Drop the progress-spinner lines tools like winget draw, and keep the end of long output.
            $lines = @($lines | Where-Object { $_ -notmatch '^\s*[-\\|/]?\s*$' -and $_ -notmatch '[\u2588\u2592]' })
            if ($lines.Count -gt 200) { $lines = @("... ($($lines.Count - 200) earlier lines left out)") + $lines[-200..-1] }
            $response.lines = $lines
            $response.result = "Exit code $($proc.ExitCode)"
        }
        'close' {
            $win = Get-TargetWindow $request.window
            $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
            $response.result = "Asked '$($win.Current.Name)' to close."
        }
        'shot' {
            $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
            $g.Dispose()
            $bmp.Save((Join-Path $Root 'shot.png'), [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            $response.result = "$($b.Width)x$($b.Height)"
        }
        default { throw "Unknown request '$($request.op)'." }
    }
} catch {
    $response.ok = $false
    $response.error = $_.Exception.Message
}

# Write to a temporary file and rename it, so the host never reads half an answer.
$temp = Join-Path $Root 'response.tmp'
$response | ConvertTo-Json -Depth 5 | Set-Content $temp -Encoding UTF8
Move-Item $temp (Join-Path $Root 'response.json') -Force

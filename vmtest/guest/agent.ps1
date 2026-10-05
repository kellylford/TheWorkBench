# vmtest guest agent. Runs inside the test VM, in the signed-in user's desktop session, started by
# the scheduled task "vmtest-agent" (or "vmtest-agent-admin" for -Elevated). It reads one request from C:\vmtest\request.json, carries it out
# with UI Automation, and writes the answer to C:\vmtest\response.json. The host side is VmTest.psm1.
param([string]$Root = 'C:\vmtest')

$ErrorActionPreference = 'Stop'
$response = [ordered]@{ id = $null; ok = $true }

# This drives the desktop it runs on, so it only ever runs inside a virtual machine.
if ((Get-CimInstance Win32_ComputerSystem).Model -ne 'Virtual Machine') {
    throw 'The vmtest agent only runs inside a Hyper-V virtual machine.'
}

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
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int size, out int returned);

        // Whether a process runs with admin rights. A process whose token can't even be read is
        // above this one, which for our purposes is the same answer.
        public static bool IsElevated(int pid) {
            IntPtr process = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
            if (process == IntPtr.Zero) return false;
            try {
                IntPtr token;
                if (!OpenProcessToken(process, 0x0008, out token)) return true;   // TOKEN_QUERY
                try {
                    int elevated, size;
                    return GetTokenInformation(token, 20, out elevated, 4, out size) && elevated != 0;   // TokenElevation
                } finally { CloseHandle(token); }
            } finally { CloseHandle(process); }
        }
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

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

# The .NET UI Automation client reports some classic Win32 controls (the buttons in a MessageBox, for
# example) as plain panes. Screen readers announce them by their MSAA role, so ask MSAA too.
Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace VmTest {
    public static class Msaa {
        [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
        [DllImport("oleacc.dll", CharSet = CharSet.Unicode)] static extern uint GetRoleText(uint role, StringBuilder text, uint size);
        static Accessibility.IAccessible Get(IntPtr hwnd) {
            Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
            object obj;
            if (AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref iid, out obj) != 0) return null;
            return obj as Accessibility.IAccessible;
        }
        // The control's MSAA default action (for a button, "Press"). Returns the action's name, or null if it has none.
        public static string DoDefault(IntPtr hwnd) {
            Accessibility.IAccessible acc = Get(hwnd);
            if (acc == null) return null;
            string action = acc.get_accDefaultAction(0);
            if (String.IsNullOrEmpty(action)) return null;
            acc.accDoDefaultAction(0);
            return action;
        }
        public static string Role(IntPtr hwnd) {
            try {
                Accessibility.IAccessible acc = Get(hwnd);
                if (acc == null) return null;
                object role = acc.get_accRole(0);
                if (!(role is int)) return null;
                StringBuilder text = new StringBuilder(64);
                GetRoleText((uint)(int)role, text, 64);
                return text.ToString();
            } catch { return null; }
        }
    }
}
'@

$AE = [System.Windows.Automation.AutomationElement]

function Get-Description($el) {
    $c = $el.Current
    $type = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    if ($type -eq 'Pane' -and $c.NativeWindowHandle) {
        $msaa = [VmTest.Msaa]::Role([IntPtr]$c.NativeWindowHandle)
        if ($msaa -and $msaa -notin 'client', 'pane', 'window', 'grouping') { $type = "Pane [MSAA role: $msaa]" }
    }
    $text = "$type '$($c.Name)'"
    # What a screen reader says for the type, when the app has changed it from the usual.
    $plain = ($c.ControlType.LocalizedControlType)
    if ($c.LocalizedControlType -and $c.LocalizedControlType -ne $plain) { $text += " (announced as '$($c.LocalizedControlType)')" }
    if ($c.AutomationId) { $text += " id='$($c.AutomationId)'" }
    if ($c.HelpText) { $text += " help='$($c.HelpText)'" }
    try { $text += " value='$($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'" } catch {}
    try { $text += " toggle=$($el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState)" } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { $text += ' selected' } } catch {}
    try { $text += " $($el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Current.ExpandCollapseState)".ToLower() } catch {}
    if (-not $c.IsEnabled) { $text += ' disabled' }
    if ($c.IsOffscreen) { $text += ' offscreen' }
    # Controls a keyboard user should be able to reach; say so when they can't.
    if ($c.IsEnabled -and -not $c.IsKeyboardFocusable -and $type -in 'Button', 'CheckBox', 'RadioButton', 'Edit', 'ComboBox', 'Hyperlink', 'Slider') {
        $text += ' not-keyboard-focusable'
    }
    if ($c.HasKeyboardFocus) { $text += ' FOCUSED' }
    $text
}

function Get-TopWindows {
    $AE::RootElement.FindAll('Children', [System.Windows.Automation.Condition]::TrueCondition) |
        Where-Object { $_.Current.Name -and $_.Current.ClassName -notin 'Shell_TrayWnd', 'Progman' }
}

$SelfElevated = [VmTest.Native]::IsElevated($PID)

# Windows quietly drops input and actions sent from a normal program to one running as admin, so
# acting on such a window would report success that didn't happen. Refuse instead.
function Assert-CanDrive($Window) {
    if (-not $SelfElevated -and [VmTest.Native]::IsElevated($Window.Current.ProcessId)) {
        throw "'$($Window.Current.Name)' belongs to a program running as administrator. Add -Elevated to drive it."
    }
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
        $windows | Where-Object { $_.Current.Name.IndexOf($Spec, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1
    }
    if (-not $match) {
        $names = ($windows | ForEach-Object { "'$($_.Current.Name)'" }) -join ', '
        throw "No window matches '$Spec'. Open windows: $names"
    }
    $match
}

# A control inside the window: by AutomationId first, then exact name, then part of the name. When
# several match, an enabled one that's on screen wins, and the answer says how many there were.
function Find-Target($Window, [string]$Target) {
    if (-not $Target) { throw 'Say which control: its AutomationId or its name.' }
    $all = @($Window.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition))
    foreach ($test in @(
            { param($c) $c.AutomationId -eq $Target },
            { param($c) $c.Name -eq $Target },
            { param($c) $c.Name -and $c.Name.IndexOf($Target, [StringComparison]::OrdinalIgnoreCase) -ge 0 })) {
        $found = @($all | Where-Object { & $test $_.Current })
        if ($found.Count) {
            $best = @($found | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen }) + $found | Select-Object -First 1
            if ($found.Count -gt 1) { $script:response.note = "$($found.Count) controls matched '$Target'; used $(Get-Description $best)." }
            return $best
        }
    }
    throw "No control named '$Target' (AutomationId or name) in '$($Window.Current.Name)'."
}

# The top-level window an element belongs to.
function Get-TopLevel($el) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $win = $el; $parent = $walker.GetParent($win)
    while ($parent -and $parent -ne $AE::RootElement) { $win = $parent; $parent = $walker.GetParent($win) }
    $win
}

# Bring the window to the front of the guest desktop, and refuse to go on if it didn't get there,
# so keys are never typed into the wrong window.
function Enter-Window($Window) {
    Assert-CanDrive $Window
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
    # Compare windows, not processes: packaged apps and WebView2 keep focus in a different process
    # from the window that holds them.
    $focused = $AE::FocusedElement
    if ($focused -and (Get-TopLevel $focused).Current.NativeWindowHandle -ne $Window.Current.NativeWindowHandle) {
        throw "Keyboard focus is on '$($focused.Current.Name)' outside '$($Window.Current.Name)', so no keys were sent."
    }
}

function Get-FocusReport {
    $f = $AE::FocusedElement
    if (-not $f) { return '(nothing has keyboard focus)' }
    "$(Get-Description $f)  [in window '$((Get-TopLevel $f).Current.Name)']"
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
            $win = Get-TargetWindow $request.window; Assert-CanDrive $win; $el = Find-Target $win $request.target
            $before = Get-Description $el
            $hwnd = $el.Current.NativeWindowHandle
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
            if (-not $done -and $el.Current.NativeWindowHandle) {
                # Classic Win32 controls the .NET client gives no patterns for: use the MSAA default action.
                $action = [VmTest.Msaa]::DoDefault([IntPtr]$el.Current.NativeWindowHandle)
                if ($action) { $done = "did '$action' (MSAA) on" }
            }
            if (-not $done) { throw "'$($el.Current.Name)' can't be pressed, toggled, selected or expanded." }
            Start-Sleep -Milliseconds 700
            # Describe the control as it is now (its new state), or as it was if pressing it closed it.
            $after = $null
            if (-not $hwnd -or [VmTest.Native]::IsWindow([IntPtr]$hwnd)) { try { $after = Get-Description $el } catch {} }
            $response.result = if ($after) { "$done $after" } else { "$done $before (it has gone now)" }
            $response.focus = Get-FocusReport
        }
        'setvalue' {
            $win = Get-TargetWindow $request.window; Assert-CanDrive $win; $el = Find-Target $win $request.target
            $pattern = $null
            if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                throw "'$($el.Current.Name)' doesn't take a typed value."
            }
            $pattern.SetValue([string]$request.value)
            Start-Sleep -Milliseconds 300
            $response.result = Get-Description $el
        }
        'focus' {
            $win = Get-TargetWindow $request.window; Assert-CanDrive $win; $el = Find-Target $win $request.target
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
            # A script the host put in the VM (.cmd, .bat or .ps1), run as the signed-in user (where per-user
            # tools like winget work), with its output and exit code handed back. Anything it starts and leaves
            # running may be ended with it; 'launch' is the way to start a program that keeps running.
            $script = [string]$request.script
            if (-not (Test-Path $script -PathType Leaf)) { throw "There's no script at $script in the VM." }
            $outFile = Join-Path $Root 'run.out'
            # Start from an empty output file, so an earlier command's output can never be mistaken for this one's.
            Set-Content $outFile '' -Encoding ASCII
            $inner = if ($script -like '*.ps1') {
                # A small wrapper turns off progress records (which come out as CLIXML when output is
                # redirected) and passes the script's exit code, or 1 if it throws, back out.
                $wrapper = Join-Path $Root 'run-wrapper.ps1'
                # The exit code is the script's own 'exit N' or, failing that, that of the last program it ran.
                @(
                    "`$ProgressPreference = 'SilentlyContinue'"
                    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'
                    '$global:LASTEXITCODE = 0'
                    "try { & '$($script -replace "'", "''")' } catch { `$_ | Out-String | Write-Output; exit 1 }"
                    'exit $LASTEXITCODE'
                ) | Set-Content $wrapper -Encoding UTF8
                "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapper`""
            } else {
                # UTF-8 code page first, so text outside ASCII comes back intact.
                "chcp 65001 >nul & `"$script`""
            }
            $proc = Start-Process cmd.exe -ArgumentList '/d', '/s', '/c', "`"$inner > `"$outFile`" 2>&1`"" `
                -WindowStyle Hidden -PassThru
            $limit = if ($request.timeout) { [int]$request.timeout } else { 600 }
            if (-not $proc.WaitForExit($limit * 1000)) {
                # Through cmd, so taskkill's complaints (about children already gone) can't replace this message.
                Start-Process cmd.exe -ArgumentList '/d', '/c', "taskkill /T /F /PID $($proc.Id) >nul 2>&1" -WindowStyle Hidden -Wait
                $tail = if (Test-Path $outFile) { (Get-Content $outFile -Tail 20 -Encoding UTF8) -join "`n" } else { '' }
                throw "The command was still running after $limit seconds and was stopped. Last output:`n$tail"
            }
            $lines = if (Test-Path $outFile) { @(Get-Content $outFile -Encoding UTF8 | ForEach-Object { [string]$_ }) } else { @() }
            # Drop the progress-spinner lines tools like winget draw, and keep the end of long output.
            $lines = @($lines | Where-Object { $_ -notmatch '^\s*[-\\|/]\s*$' -and $_ -notmatch '^\s*[\u2588\u2592]+\s+\S+.*$' })
            if ($lines.Count -gt 200) { $lines = @("... ($($lines.Count - 200) earlier lines left out)") + $lines[-200..-1] }
            $response.lines = $lines
            $response.result = "Exit code $($proc.ExitCode)"
        }
        'close' {
            $win = Get-TargetWindow $request.window; Assert-CanDrive $win
            $name = $win.Current.Name
            $handle = $win.Current.NativeWindowHandle
            $procId = $win.Current.ProcessId
            $waitClosed = {
                param($seconds)
                $deadline = (Get-Date).AddSeconds($seconds)
                do {
                    Start-Sleep -Milliseconds 300
                    $still = @(Get-TopWindows | Where-Object { $_.Current.NativeWindowHandle -eq $handle })
                } while ($still.Count -and (Get-Date) -lt $deadline)
                $still
            }
            $pattern = $null
            if ($win.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) { $pattern.Close() }
            $open = @(& $waitClosed 2)
            if ($open.Count) {
                # Some apps (WPF ones among them) ignore UI Automation's Close. Send what Alt+F4 sends.
                [VmTest.Native]::PostMessage([IntPtr]$handle, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
                $open = @(& $waitClosed 3)
            }
            if ($open.Count) {
                $others = @(Get-TopWindows | Where-Object { $_.Current.ProcessId -eq $procId } | ForEach-Object { "'$($_.Current.Name)'" })
                $response.result = "Asked '$name' to close, but it's still open. Its program's windows now: $($others -join ', '). It may be waiting on a dialog, or a menu may still have the keyboard; try keys '{ESC}' or '%{F4}'."
            } else {
                $response.result = "Closed '$name'."
            }
            $response.focus = Get-FocusReport
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

# Write to a temporary file and rename it, so the host never reads half an answer. The host may be
# reading at that moment, so try a few times.
$temp = Join-Path $Root 'response.tmp'
$response | ConvertTo-Json -Depth 5 | Set-Content $temp -Encoding UTF8
for ($i = 0; $i -lt 20; $i++) {
    try { Move-Item $temp (Join-Path $Root 'response.json') -Force; break } catch { Start-Sleep -Milliseconds 100 }
}

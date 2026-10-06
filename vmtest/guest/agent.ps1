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
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace VmTest {
    public static class Native {
        delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int size);
        [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

        // Every visible top-level window, front to back, including owned dialogs, which UI Automation
        // files under their owner instead. Windows Windows has hidden from view (cloaked) are left out.
        public static IntPtr[] VisibleTopWindows() {
            List<IntPtr> found = new List<IntPtr>();
            EnumWindows(delegate (IntPtr h, IntPtr l) {
                if (IsWindowVisible(h)) {
                    int cloaked;
                    if (DwmGetWindowAttribute(h, 14, out cloaked, 4) != 0) cloaked = 0;   // DWMWA_CLOAKED
                    if (cloaked == 0) found.Add(h);
                }
                return true;
            }, IntPtr.Zero);
            return found.ToArray();
        }
        public static IntPtr Owner(IntPtr hWnd) { return GetWindow(hWnd, 4); }   // GW_OWNER
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
        [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr hWnd);
        // The window that gets a person's keys when they bring this one forward: the window itself,
        // or, while a modal dialog has disabled it, that dialog (and that dialog's own modal, if any).
        public static IntPtr KeyboardTarget(IntPtr hWnd) {
            IntPtr goal = hWnd;
            for (int i = 0; i < 10 && !IsWindowEnabled(goal); i++) {
                IntPtr popup = GetLastActivePopup(goal);
                if (popup == IntPtr.Zero || popup == goal || !IsWindowVisible(popup)) break;
                goal = popup;
            }
            return goal;
        }
        public static IntPtr Root(IntPtr hWnd) { return GetAncestor(hWnd, 2); }        // GA_ROOT: its top-level window
        // The top of a window's owner chain. Walked by hand: GetAncestor(GA_ROOTOWNER) follows parent
        // links, and some owned windows (WinForms forms with an Owner, for one) don't have one.
        public static IntPtr RootOwner(IntPtr hWnd) {
            IntPtr top = Root(hWnd);
            for (int i = 0; i < 50; i++) { IntPtr o = Owner(top); if (o == IntPtr.Zero) break; top = o; }
            return top;
        }
        public static uint ThreadOf(IntPtr hWnd) { int pid; return GetWindowThreadProcessId(hWnd, out pid); }

        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool on);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
        // Windows won't let a background program take the foreground from whatever has it (a
        // notification toast, say). Sharing input with the foreground thread for a moment lifts that.
        public static void ForceForeground(IntPtr hWnd) {
            uint front = ThreadOf(GetForegroundWindow()), me = GetCurrentThreadId();
            bool attached = front != 0 && front != me && AttachThreadInput(me, front, true);
            try { BringWindowToTop(hWnd); SetForegroundWindow(hWnd); }
            finally { if (attached) AttachThreadInput(me, front, false); }
        }

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO {
            public uint cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
        }
        [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
        static GUITHREADINFO Foreground() {
            GUITHREADINFO info = new GUITHREADINFO(); info.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
            if (!GetGUIThreadInfo(0, ref info)) info = new GUITHREADINFO();   // thread 0: the foreground thread
            return info;
        }
        // The window with keyboard focus in the foreground thread, or zero when it's in another thread
        // (packaged apps keep it in a different process from their frame).
        public static IntPtr FocusWindow() { return Foreground().hwndFocus; }
        // While a menu has the keyboard (a menu bar after Alt, or an open popup menu): the window that
        // owns it. Otherwise zero.
        public static IntPtr MenuOwner() { GUITHREADINFO i = Foreground(); return (i.flags & 0x14) != 0 ? i.hwndMenuOwner : IntPtr.Zero; }
        public static bool PopupMenuOpen() { return (Foreground().flags & 0x10) != 0; }   // GUI_POPUPMENUMODE
        public static int ProcessOf(IntPtr hWnd) { int pid; GetWindowThreadProcessId(hWnd, out pid); return pid; }
        public static string ClassOf(IntPtr hWnd) { StringBuilder s = new StringBuilder(256); GetClassName(hWnd, s, 256); return s.ToString(); }

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

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern short VkKeyScanEx(char c, IntPtr layout);
        [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
        [DllImport("user32.dll")] static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr layout);
        [DllImport("user32.dll")] static extern short GetKeyState(int vk);

        // Types text the way a keyboard would: each character the keyboard layout has is sent as its
        // real key, with Shift if needed, all in one SendInput call so nothing can come between them.
        // Only characters the layout can't type go as Unicode packets. A fast run of Unicode packets
        // can come out as the last character repeated in some apps (Windows 11 Notepad, for one).
        // The keyboard layout of the window in front, which is what the keys are meant for.
        public static void TypeText(string text) {
            const uint KEYUP = 0x2, UNICODE = 0x4;
            const ushort SHIFT = 0x10;
            IntPtr layout = GetKeyboardLayout(ThreadOf(GetForegroundWindow()));
            foreach (char c in text) {
                if (c == '\r') continue;
                List<INPUT> keys = new List<INPUT>();
                short code = c == '\n' ? (short)0x0D : VkKeyScanEx(c, layout);
                int vk = code & 0xFF, mods = (code >> 8) & 0xFF;
                // A dead key (an accent that waits for the next letter) would change what follows.
                bool dead = code != -1 && (MapVirtualKeyEx((uint)vk, 2, layout) & 0x80000000) != 0;   // MAPVK_VK_TO_CHAR
                if (code != -1 && (mods & ~1) == 0 && !dead) {
                    // A plain key, or Shift plus a key. (Ctrl or Alt combinations, as AltGr makes, go as Unicode.)
                    bool shift = (mods & 1) != 0;
                    // Caps Lock flips letters, so flip Shift back to get the letter asked for.
                    if (Char.IsLetter(c) && (GetKeyState(0x14) & 1) != 0) shift = !shift;
                    ushort sc = (ushort)MapVirtualKeyEx((uint)vk, 0, layout);   // MAPVK_VK_TO_VSC
                    if (shift) keys.Add(Key(SHIFT, (ushort)MapVirtualKeyEx(SHIFT, 0, layout), 0));
                    keys.Add(Key((ushort)vk, sc, 0));
                    keys.Add(Key((ushort)vk, sc, KEYUP));
                    if (shift) keys.Add(Key(SHIFT, (ushort)MapVirtualKeyEx(SHIFT, 0, layout), KEYUP));
                } else {
                    keys.Add(Key(0, c, UNICODE));
                    keys.Add(Key(0, c, UNICODE | KEYUP));
                }
                INPUT[] batch = keys.ToArray();
                if (SendInput((uint)batch.Length, batch, Marshal.SizeOf(typeof(INPUT))) != batch.Length) throw new System.ComponentModel.Win32Exception();
                System.Threading.Thread.Sleep(15);
            }
        }
    }
}
'@

# The .NET UI Automation client reports some classic Win32 controls (the buttons in a MessageBox, for
# example) as plain panes. Screen readers announce them by their MSAA role, so ask MSAA too.
Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace VmTest {
    public static class Msaa {
        [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
        [DllImport("oleacc.dll", CharSet = CharSet.Unicode)] static extern uint GetRoleText(uint role, StringBuilder text, uint size);
        static Accessibility.IAccessible Get(IntPtr hwnd) { return Get(hwnd, 0xFFFFFFFC); }   // OBJID_CLIENT
        static Accessibility.IAccessible Get(IntPtr hwnd, uint objectId) {
            Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
            object obj;
            if (AccessibleObjectFromWindow(hwnd, objectId, ref iid, out obj) != 0) return null;
            return obj as Accessibility.IAccessible;
        }

        // The items of an open popup menu (a #32768 window), or of a window's menu bar, the way a screen
        // reader gets them: name, keyboard shortcut and state. The .NET UI Automation client shows a
        // popup menu as an empty pane. Each line starts with ! when the item is the highlighted one.
        public static string[] MenuItems(IntPtr hwnd, bool menuBar) {
            List<string> lines = new List<string>();
            try {
                Accessibility.IAccessible menu = Get(hwnd, menuBar ? 0xFFFFFFFD : 0xFFFFFFFC);   // OBJID_MENU or OBJID_CLIENT
                if (menu == null) return lines.ToArray();
                int count = menu.accChildCount;
                for (int i = 1; i <= count; i++) {
                    string name = null, key = null;
                    int state = 0, role = 0;
                    try { name = menu.get_accName(i); } catch { }
                    try { key = menu.get_accKeyboardShortcut(i); } catch { }
                    try { object s = menu.get_accState(i); if (s is int) state = (int)s; } catch { }
                    try { object r = menu.get_accRole(i); if (r is int) role = (int)r; } catch { }
                    if (role == 21) { lines.Add(" (separator)"); continue; }   // ROLE_SYSTEM_SEPARATOR
                    // A real item with no name is what a screen reader gets too, so say so.
                    if (String.IsNullOrEmpty(name)) name = "";
                    StringBuilder line = new StringBuilder();
                    bool hot = (state & 0x80) != 0 || (state & 0x4) != 0;   // HOTTRACKED or FOCUSED
                    line.Append(hot ? "!" : " ").Append("MenuItem '").Append(name.Replace("\t", "  ")).Append("'");
                    if (name.Length == 0) line.Append(" (no accessible name)");
                    if (!String.IsNullOrEmpty(key)) line.Append(" key='").Append(key).Append("'");
                    if ((state & 0x10) != 0) line.Append(" checked");
                    if ((state & 0x1) != 0) line.Append(" disabled");
                    if ((state & 0x40000000) != 0) line.Append(" submenu");
                    if (hot) line.Append(" HIGHLIGHTED");
                    lines.Add(line.ToString());
                }
            } catch { }
            return lines.ToArray();
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
        // The name and value a screen reader gets through MSAA, for controls the .NET client leaves blank.
        public static string Name(IntPtr hwnd) {
            try { Accessibility.IAccessible acc = Get(hwnd); return acc == null ? null : acc.get_accName(0); } catch { return null; }
        }
        public static string Value(IntPtr hwnd) {
            try { Accessibility.IAccessible acc = Get(hwnd); return acc == null ? null : acc.get_accValue(0); } catch { return null; }
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
    $name = $c.Name
    $msaaValue = $null
    if ($type -eq 'Pane' -and $c.NativeWindowHandle) {
        $msaa = [VmTest.Msaa]::Role([IntPtr]$c.NativeWindowHandle)
        if ($msaa -and $msaa -notin 'client', 'pane', 'window', 'grouping') {
            # A classic control the .NET client sees as a blank pane: take its role, name and value
            # from MSAA, as a screen reader would.
            $type = "Pane [MSAA role: $msaa]"
            if (-not $name) { $name = [VmTest.Msaa]::Name([IntPtr]$c.NativeWindowHandle) }
            $msaaValue = [VmTest.Msaa]::Value([IntPtr]$c.NativeWindowHandle)
        }
    }
    $text = "$type '$name'"
    # What a screen reader says for the type, when the app has changed it from the usual.
    $plain = ($c.ControlType.LocalizedControlType)
    if ($c.LocalizedControlType -and $c.LocalizedControlType -ne $plain) { $text += " (announced as '$($c.LocalizedControlType)')" }
    if ($c.AutomationId) { $text += " id='$($c.AutomationId)'" }
    if ($c.HelpText) { $text += " help='$($c.HelpText)'" }
    try { $text += " value='$($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)'" } catch {
        if ($null -ne $msaaValue) { $text += " value='$msaaValue'" }
    }
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

# Visible top-level windows with a title, front to back. Owned dialogs and progress windows are
# included: Windows lists them as top-level even though UI Automation files them under their owner.
function Get-TopWindows {
    foreach ($h in [VmTest.Native]::VisibleTopWindows()) {
        if ([VmTest.Native]::ClassOf($h) -in 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', '#32768') { continue }
        # A window can close while we look at it; skip it rather than fail the whole command.
        try { $el = $AE::FromHandle($h); if ($el.Current.Name) { $el } } catch {}
    }
}

# Open classic popup menus (#32768 windows), front to back. With -Thread, only that thread's: a
# program's menus belong to the thread of the window that owns them.
function Get-OpenMenus([uint32]$Thread = 0) {
    @([VmTest.Native]::VisibleTopWindows() | Where-Object {
            [VmTest.Native]::ClassOf($_) -eq '#32768' -and (-not $Thread -or [VmTest.Native]::ThreadOf($_) -eq $Thread)
        })
}

# An open menu's items as text lines, indented; the highlighted one is marked.
function Get-MenuLines([IntPtr]$Hwnd, [bool]$MenuBar, [string]$Indent) {
    foreach ($item in [VmTest.Msaa]::MenuItems($Hwnd, $MenuBar)) { $Indent + $item.Substring(1) }
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
    # The window in front always counts, even one the list leaves out (a notification toast, say).
    try {
        $frontHwnd = [VmTest.Native]::GetForegroundWindow()
        $front = $AE::FromHandle($frontHwnd)
        if ($front.Current.Name -and [VmTest.Native]::ClassOf($frontHwnd) -notin 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', '#32768' -and
            -not ($windows | Where-Object { $_.Current.NativeWindowHandle -eq $front.Current.NativeWindowHandle })) {
            $windows = @($windows) + $front
        }
    } catch {}
    $match = if ($Spec -match '^\d+$') {
        # The program's main window first: UI Automation shows its owned dialogs inside it.
        $ofPid = @($windows | Where-Object { $_.Current.ProcessId -eq [int]$Spec })
        @($ofPid | Where-Object { [VmTest.Native]::Owner([IntPtr]$_.Current.NativeWindowHandle) -eq [IntPtr]::Zero }) + $ofPid | Select-Object -First 1
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
# 'id:<AutomationId>' matches only the AutomationId and 'name:<name>' only the name, which also lets
# an id that starts with '-' (wxPython's are negative) through PowerShell's parameter parsing.
function Find-Target($Window, [string]$Target) {
    if (-not $Target) { throw 'Say which control: its AutomationId or its name.' }
    $all = @($Window.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition))
    $byId = { param($c) $c.AutomationId -eq $Target }
    # A blank classic control's name comes from MSAA, as a screen reader gets it.
    $nameOf = { param($c) if ($c.Name) { $c.Name } elseif ($c.NativeWindowHandle) { [VmTest.Msaa]::Name([IntPtr]$c.NativeWindowHandle) } }
    $byName = { param($c) (& $nameOf $c) -eq $Target }
    $byPart = { param($c) $n = & $nameOf $c; $n -and $n.IndexOf($Target, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
    $tests = @($byId, $byName, $byPart); $what = 'AutomationId or name'
    if ($Target -match '^id:(.+)$') { $Target = $Matches[1].Trim(); $tests = @($byId); $what = 'AutomationId' }
    elseif ($Target -match '^name:(.+)$') { $Target = $Matches[1].Trim(); $tests = @($byName, $byPart); $what = 'name' }
    foreach ($test in $tests) {
        $found = @($all | Where-Object { & $test $_.Current })
        if ($found.Count) {
            $best = @($found | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen }) + $found | Select-Object -First 1
            if ($found.Count -gt 1) { $script:response.note = "$($found.Count) controls matched '$Target'; used $(Get-Description $best)." }
            return $best
        }
    }
    throw "No control with $what '$Target' in '$($Window.Current.Name)'."
}
# A process and every process it started, and they started, and so on. Only processes started after
# the root count, so an old process whose parent id happens to be reused isn't taken in.
function Get-ProcessFamily([int]$RootPid, [datetime]$Since) {
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate |
            Where-Object { -not $Since -or $_.CreationDate -ge $Since.AddSeconds(-2) })
    $family = New-Object System.Collections.Generic.List[int]
    $family.Add($RootPid)
    for ($i = 0; $i -lt $family.Count; $i++) {
        foreach ($p in $all) { if ($p.ParentProcessId -eq $family[$i] -and -not $family.Contains([int]$p.ProcessId)) { $family.Add([int]$p.ProcessId) } }
    }
    $family
}
# The top-level window an element belongs to.
function Get-TopLevel($el) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $win = $el; $parent = $walker.GetParent($win)
    while ($parent -and $parent -ne $AE::RootElement) { $win = $parent; $parent = $walker.GetParent($win) }
    $win
}

# Bring the window that would get a person's keys to the front, and refuse to go on if it didn't get
# there, so keys are never typed into the wrong window. That window is the target, or, while a modal
# dialog has disabled the target, that dialog. A menu doesn't take the foreground (and moving the
# foreground would close it), so the target's open menu counts as the target.
function Enter-Window($Window) {
    Assert-CanDrive $Window
    $target = [IntPtr]$Window.Current.NativeWindowHandle
    $goal = [VmTest.Native]::KeyboardTarget($target)
    $goalName = if ($goal -eq $target) { $Window.Current.Name } else { try { $AE::FromHandle($goal).Current.Name } catch { '' } }
    if ($goal -ne $target) { $script:response.note = "'$($Window.Current.Name)' is waiting on its dialog '$goalName', so the keys went there, as a person's would." }
    if ([VmTest.Native]::GetForegroundWindow() -ne $goal) {
        if ([VmTest.Native]::IsIconic($goal)) { [VmTest.Native]::ShowWindow($goal, 9) | Out-Null }
        [VmTest.Native]::SetForegroundWindow($goal) | Out-Null
        Start-Sleep -Milliseconds 300
        if ([VmTest.Native]::GetForegroundWindow() -ne $goal) {
            [VmTest.Native]::ForceForeground($goal)
            Start-Sleep -Milliseconds 300
        }
        if ([VmTest.Native]::GetForegroundWindow() -ne $goal) {
            [VmTest.Native]::ShowWindow($goal, 6) | Out-Null   # minimize then restore makes Windows activate it
            [VmTest.Native]::ShowWindow($goal, 9) | Out-Null
            Start-Sleep -Milliseconds 500
        }
        if ([VmTest.Native]::GetForegroundWindow() -ne $goal) {
            $blocker = try { $AE::FromHandle([VmTest.Native]::GetForegroundWindow()).Current.Name } catch { '' }
            throw "Couldn't bring '$goalName' to the front, so no keys were sent. In front instead: '$blocker'. If that's a notification or a dialog, deal with it first (for example keys '{ESC}' -Window '$blocker')."
        }
    }
    # Keyboard focus has to be in that window, or in its open menu.
    $menuOwner = [VmTest.Native]::MenuOwner()
    if ($menuOwner -ne [IntPtr]::Zero -and [VmTest.Native]::Root($menuOwner) -eq $goal) { return }
    $focusWindow = [VmTest.Native]::FocusWindow()
    if ($focusWindow -ne [IntPtr]::Zero) {
        if ([VmTest.Native]::Root($focusWindow) -eq $goal) { return }
        throw "Keyboard focus is in another window than '$goalName', so no keys were sent."
    }
    # No focus window in the foreground thread: packaged apps and WebView2 keep focus in another
    # process, inside the window. Then UI Automation has to show it there.
    $focused = $AE::FocusedElement
    if ($focused -and (Get-TopLevel $focused).Current.NativeWindowHandle -eq $goal) { return }
    $where = if ($focused) { "'$($focused.Current.Name)'" } else { 'nothing' }
    throw "Keyboard focus is on $where, not in '$goalName', so no keys were sent."
}
function Get-FocusReport {
    # While a classic menu has the keyboard, the .NET client reports an empty pane. Name the
    # highlighted item of the menu instead: the deepest open submenu that has one, or the menu bar's
    # after Alt alone.
    $menuOwner = [VmTest.Native]::MenuOwner()
    if ($menuOwner -ne [IntPtr]::Zero) {
        # A context menu's owner can be a control; name its window.
        $owner = try { $AE::FromHandle([VmTest.Native]::Root($menuOwner)).Current.Name } catch { '' }
        # Windows only flags "pop-up menu active" for some menus (not one dropped from a menu bar), so
        # an open menu is a visible menu window on the owner's thread.
        $open = Get-OpenMenus ([VmTest.Native]::ThreadOf($menuOwner))
        if ($open.Count -or [VmTest.Native]::PopupMenuOpen()) {
            foreach ($m in $open) {
                $hot = @([VmTest.Msaa]::MenuItems($m, $false) | Where-Object { $_.StartsWith('!') })
                if ($hot.Count) { return "$($hot[0].Substring(1))  [in an open menu of '$owner']" }
            }
            return "an open menu with no item highlighted yet  [of '$owner']"
        }
        $hot = @([VmTest.Msaa]::MenuItems($menuOwner, $true) | Where-Object { $_.StartsWith('!') })
        if ($hot.Count) { return "$($hot[0].Substring(1))  [on the menu bar of '$owner']" }
        return "the menu bar  [of '$owner']"
    }
    $f = $AE::FocusedElement
    if (-not $f) { return '(nothing has keyboard focus)' }
    # UI Automation files an owned dialog under its owner, so its top-level would name the owner.
    # Name the real top-level window of the focused window when there is one.
    $focusWindow = [VmTest.Native]::FocusWindow()
    $where = if ($focusWindow -ne [IntPtr]::Zero) {
        try { $AE::FromHandle([VmTest.Native]::Root($focusWindow)).Current.Name } catch { (Get-TopLevel $f).Current.Name }
    } else { (Get-TopLevel $f).Current.Name }
    "$(Get-Description $f)  [in window '$where']"
}
function Get-Tree($Window, [int]$MaxDepth) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $lines = New-Object System.Collections.Generic.List[string]
    $shownMenus = New-Object System.Collections.Generic.List[long]
    $walk = {
        param($el, $depth)
        if ($lines.Count -ge 500) { return }
        $lines.Add(('  ' * $depth) + (Get-Description $el))
        $hwnd = $el.Current.NativeWindowHandle
        if ($hwnd -and [VmTest.Native]::ClassOf([IntPtr]$hwnd) -eq '#32768') {
            # An open popup menu: its items, through MSAA.
            foreach ($line in Get-MenuLines ([IntPtr]$hwnd) $false ('  ' * ($depth + 1))) { $lines.Add($line) }
            $shownMenus.Add([long]$hwnd)
            return
        }
        if ($depth -eq 0 -and $hwnd -and [VmTest.Native]::GetMenu([IntPtr]$hwnd) -ne [IntPtr]::Zero) {
            # A classic menu bar, which the .NET client doesn't show.
            $lines.Add('  MenuBar (classic, read through MSAA)')
            foreach ($line in Get-MenuLines ([IntPtr]$hwnd) $true '    ') { $lines.Add($line) }
        }
        if ($depth -ge $MaxDepth) { return }
        $child = $walker.GetFirstChild($el)
        while ($child) { & $walk $child ($depth + 1); $child = $walker.GetNextSibling($child) }
    }
    & $walk $Window 0
    # Open menus are top-level windows of their own; add this window's that the walk didn't reach.
    if ($lines.Count -lt 500) {
        foreach ($m in Get-OpenMenus ([VmTest.Native]::ThreadOf([IntPtr]$Window.Current.NativeWindowHandle))) {
            if ($shownMenus.Contains([long]$m)) { continue }
            $lines.Add('Open menu:')
            foreach ($line in Get-MenuLines $m $false '  ') { $lines.Add($line) }
        }
    }
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
            $existing = @([VmTest.Native]::VisibleTopWindows())
            $started = Get-Date
            $proc = Start-Process @startArgs
            # Wait for the program's window. Some programs hand the window to another process:
            # launchers (Notepad, packaged apps) start it and exit, so once the started process has
            # exited a new window from anyone counts. Others (PyInstaller one-file builds) start a
            # child and wait for it, so a new window from one of its child processes counts too.
            # Windows are compared by handle; UI Automation is only asked about the one that matches.
            $win = $null
            $deadline = (Get-Date).AddSeconds(30)
            while (-not $win -and (Get-Date) -lt $deadline) {
                Start-Sleep -Milliseconds 300
                $proc.Refresh()
                if (-not $proc.HasExited -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
                    $win = $AE::FromHandle($proc.MainWindowHandle)
                    continue
                }
                $new = @([VmTest.Native]::VisibleTopWindows() | Where-Object {
                        $existing -notcontains $_ -and [VmTest.Native]::ClassOf($_) -notin '#32768', 'tooltips_class32', 'IME', 'MSCTFIME UI'
                    })
                if (-not $new.Count) { continue }
                $candidates = if ($proc.HasExited) { $new } else {
                    $mine = @($new | Where-Object { [VmTest.Native]::ProcessOf($_) -eq $proc.Id })
                    if ($mine.Count) { $mine } else {
                        $family = Get-ProcessFamily $proc.Id $started
                        @($new | Where-Object { $family -contains [VmTest.Native]::ProcessOf($_) })
                    }
                }
                # The first with a title: an untitled splash or helper window isn't the program's window.
                foreach ($h in $candidates) {
                    try { $el = $AE::FromHandle($h); if ($el.Current.Name) { $win = $el; break } } catch {}
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
            $wins = @(Get-TopWindows)
            $handles = @($wins | ForEach-Object { [long]$_.Current.NativeWindowHandle })
            $owners = @{}
            foreach ($w in $wins) { $owners[[long]$w.Current.NativeWindowHandle] = [long][VmTest.Native]::Owner([IntPtr]$w.Current.NativeWindowHandle) }
            $lines = New-Object System.Collections.Generic.List[string]
            $listed = New-Object System.Collections.Generic.List[long]
            $describe = { param($w, $indent) $c = $w.Current; "$indent" + "pid $($c.ProcessId)  '$($c.Name)'  class=$($c.ClassName)" }
            # A window, then the windows it owns, indented, however deep the chain goes.
            $show = {
                param($w, $level)
                $h = [long]$w.Current.NativeWindowHandle
                if ($listed.Contains($h)) { return }
                $listed.Add($h)
                $lines.Add((& $describe $w $(if ($level) { ('  ' * $level) + 'owned: ' } else { '' })))
                foreach ($child in $wins) { if ($owners[[long]$child.Current.NativeWindowHandle] -eq $h) { & $show $child ($level + 1) } }
            }
            # Windows without a listed owner first.
            foreach ($w in $wins) { if ($handles -notcontains $owners[[long]$w.Current.NativeWindowHandle]) { & $show $w 0 } }
            foreach ($w in $wins) { & $show $w 0 }   # anything still unlisted, so nothing goes missing
            foreach ($m in Get-OpenMenus) {
                $lines.Add("open menu of pid $([VmTest.Native]::ProcessOf($m)):")
                foreach ($line in Get-MenuLines $m $false '  ') { $lines.Add($line) }
            }
            $response.lines = @($lines)
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

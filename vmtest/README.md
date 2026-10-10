# vmtest

Claude tests Windows apps inside a Hyper-V VM instead of on your PC. Nothing opens on your
desktop, focus never moves, no keys go to your apps, and JAWS stays quiet.

It's made of two parts:

- **On your PC:** `vmtest.ps1` and `VmTest.psm1`. They talk to the VM over PowerShell Direct, which
  needs no network and opens no window.
- **Inside the VM:** `guest\agent.ps1`. It runs in the signed-in user's session, started by a
  scheduled task. It drives apps through UI Automation (and MSAA where that falls short), types,
  takes screenshots and runs command lines, and sends the answers back as files.
  - It only ever runs inside a virtual machine. On a real PC it refuses to start.

## One-time setup

1. Turn on Hyper-V (Windows 11 Pro, Enterprise or Education), then restart. Either use Turn Windows
   features on or off (`appwiz.cpl`, then check Hyper-V), or run this from an administrator PowerShell:
   `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All`.
2. Add your account to the **Hyper-V Administrators** group from an administrator PowerShell, then
   sign out of Windows and back in:
   `Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "$env:USERDOMAIN\$env:USERNAME"`.
   After that, none of this needs elevation.
3. Build a VM named **ClaudeTesting** with Hyper-V Manage, using the defaults (account `vmuser`).
   - Put it on a switch that has a working connection. **External Wi-Fi** is the usual choice.
   - A checkpoint remembers which switch the VM was on, so re-take Clean if you change it.
4. Run `vmtest prepare` once. It:
   - turns on automatic sign-in and turns off Windows' passwordless-only setting, which blocks automatic sign-in;
   - keeps the screen on;
   - switches the VM to Standard checkpoints, so a task comes back with its programs still open;
   - installs the agent;
   - saves the VM as the **Clean** checkpoint.

5. Run `vmtest prepare -Pool` to make the rest of the pool (see "Several VMs" below). It's optional;
   without it, vmtest uses ClaudeTesting alone.

Settings can be changed with environment variables:

| Variable | What it sets | Default |
|---|---|---|
| `VMTEST_VM` | The first VM, the one the others are copied from | `ClaudeTesting` |
| `VMTEST_POOL` | How many VMs (`3`), or their names (`ClaudeTesting,TestB`), the first one first | From this PC's memory and processors, 1 to 3 |
| `VMTEST_STALE_MINUTES` | How long a task can leave its VM unused before another task's `begin` may save it and take it; `0` for never | `120` |
| `VMTEST_RESERVE_GB` | Memory kept for this PC: a VM isn't started unless this much would still be free | `4` |
| `VMTEST_USER`, `VMTEST_PASSWORD` | The VM's test account | `vmuser`, `vmadmin` |
| `VMTEST_STATE` | The folder for the locks | `%LOCALAPPDATA%\vmtest` |

## Getting Claude sessions to use it

Four pieces make every Claude session test Windows apps here without being told each time:

1. **Tell Claude where vmtest is.** Set `VMTEST_HOME` to this folder once, then restart Claude Code:
   `setx VMTEST_HOME "C:\path\to\TheWorkBench\vmtest"`
2. **The skill.** `skill\SKILL.md` teaches a session when and how to use vmtest. Install it for all projects:
   `Copy-Item "$env:VMTEST_HOME\skill" -Destination "$HOME\.claude\skills\vmtest" -Recurse`
   Or, for one project only, copy it to that repo's `.claude\skills\vmtest` folder instead. Claude
   loads it whenever a task involves opening, driving or installing a Windows app. It has nothing
   specific to one person in it. If you want your own rules in it (your screen reader, your apps,
   who to report to), keep your own copy and add them there.
3. **A rule in `~/.claude/CLAUDE.md`,** with your other testing instructions, so it isn't optional:
   "Test Windows desktop apps (anything that opens a window, sends keys, or installs) in the test VM
   with the vmtest skill, never on this PC."
4. **A permission rule,** so vmtest runs without a prompt each time. In `~/.claude/settings.json`,
   under `permissions.allow`, allow the vmtest command the skill runs. For example:
   `"PowerShell(powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"$env:VMTEST_HOME\\vmtest.ps1\":*)"`

## Using it

Run it from the repo you're working in, so the task is named after that repo and branch:

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$env:VMTEST_HOME\vmtest.ps1" <command>
```

| Command | What it does |
|---|---|
| `begin [-VM name] [-Wait]` | Takes a VM for this repo and branch. If this task already has one, carries on from wherever it is, even if the VM was saved or turned off in the meantime. Otherwise it takes a free VM and restores the task's checkpoint, or Clean the first time. `-Wait` keeps trying for up to `-Timeout` seconds (default 600) when every VM is busy. |
| `deploy <path> [-Name n]` | Copies a build folder or file to `C:\vmtest\apps\<name>` in the VM. |
| `push <file> [-Destination dir]` | Copies one file into the VM. The default destination is `C:\vmtest\files`. |
| `run "<cmd>" [-Timeout s]` | Runs a command line as the signed-in user, and returns the output and exit code. The default timeout is 600 seconds, and the most is 3600. See the rules below. |
| `run -ScriptFile <file>` | Copies a `.cmd`, `.bat` or `.ps1` from this PC into the VM and runs it the same way. |
| `launch <exe> [-Arguments "..."]` | Starts a program. Reports its window and where focus is. |
| `windows`, `focused` | Lists the open windows, with dialogs indented under their owner and any open menu's items, or shows what has keyboard focus. |
| `tree [-Window w] [-Depth n]` | Shows the accessibility tree: names, AutomationIds, values, states, help text. |
| `invoke`, `setvalue`, `focus <control>` | Act on a control, found by AutomationId or name. `id:<id>` matches only an AutomationId, which is also how to pass a negative one (`id:-31984`); `name:<name>` matches only a name. |
| `keys "{TAB}"`, `type "text"` | Send keys (SendKeys syntax, so `+` means Shift) or plain text. Each one reports where focus ended up. |
| `close [-Window w]` | Closes a window, then reports whether it really went. |
| `shot <file.png> [-FromHost]` | Takes a picture of the VM's screen. |
| `save` | Checkpoints this task, parks the VM and frees it for other tasks. |
| `end [-Force -VM name]` | Use after the work is merged. Deletes the task's checkpoints from every VM, and puts the VM it holds back to Clean. With `-Force`, it resets `-VM` (or the first VM) even if another task holds it. |
| `status` | Lists each VM: its state, who has it and since when, when they last used it, and its checkpoints. |
| `prepare -Pool [-Force]` | Makes the pool's other VMs from the first VM's Clean. `-Force` remakes the ones made from an older Clean, except any a task is using or has saved state on. |

### Rules worth knowing

- **Test suites count.** A suite in which any test builds a GUI window (wx, WinForms, WPF, Qt...), even briefly, even if it's called a unit test, runs in the VM. Only builds and tests that never create a window stay on your PC. The skill has a recipe for running a repo's tests in the VM: install the runtime with winget, copy the repo in with `git archive`, install dependencies the way CI does, run the tests.
- **One task per VM.** Each VM has its own lock, and a task holds at most one VM. Every command that works inside a VM uses the one its task holds.
  - `begin` takes a free VM. If every VM is busy, it says who holds each one and when they last used it.
  - A task that has left its VM unused for `VMTEST_STALE_MINUTES` (two hours) is saved for it, not thrown away, and its VM goes to the waiting task. Its next `begin` carries on from that save.
  - `-Force` takes the longest-unused VM anyway, and anything that task hadn't saved is lost.
  - Commands that change a VM wait for each other, so two sessions can't take the same one.
- **Admin rights.** Programs run without admin rights by default, the way a normal user would run them.
  - Add `-Elevated` to `run`, `launch` or the UI commands for per-machine installs, or to drive the
    window of a program running as administrator.
  - Windows silently ignores input sent from a normal program to an elevated one. When that would
    happen, vmtest refuses and says to use `-Elevated`, rather than reporting success that didn't happen.
- **Keys are never sent blind.** `keys` and `type` only send when the target window really is in front and focus is inside it.
- **Long commands.** A command that doesn't answer is stopped, with a message saying so. The next request then starts cleanly.
- **What `run` needs to know:**
  - A command line follows batch-file rules: write a literal `%` as `%%`.
  - One cmd line is limited to 8,191 characters. Use `-ScriptFile` for anything longer.
  - Anything a `run` starts may end along with it, so use `launch` for programs that should keep running.
  - A `.ps1` runs with progress records turned off. Its exit code is its own `exit N`, otherwise
    that of the last program it ran, and 1 if it throws.
  - `vmtest run` itself exits with that code.
- **Text that starts with `-`.** Pass it as `-Target "-5"`; otherwise PowerShell takes it as a parameter name. For a control id that starts with `-`, write `id:-31984`.
- **The VM is disposable.** Install, break or reconfigure anything in it; `end` throws it all away. It is on your network, though.
- **Menus and dialogs.** A classic menu opened with `keys` stays open for more `keys`. `tree`, `windows` and focus reports show its items through MSAA, with the highlighted one marked. Owned dialogs appear under their owner in `windows`, and `-Window "<title>"` finds them.
- **Programs that relaunch themselves** (PyInstaller one-file builds, for example) are followed: `launch` reports the window of the child process the launcher starts.
- **Modal and modeless windows.** While a modal dialog has disabled its owner, keys aimed at the owner go to the dialog, as a person's would. A modeless window in front doesn't count; vmtest brings the target forward.
- **Something else in front.** When vmtest can't bring the target forward (Windows protects notification toasts, for example), it refuses and names the window that's in front, so you can deal with it first.
- **Typing.** `type` sends each character as its real key (with Shift as needed), and falls back to Unicode only for characters the keyboard layout lacks. Windows 11 Notepad can still mangle fast input, so check typing in the app under test.
- **Looking at the VM yourself.**
  - Hyper-V Manager's basic (not enhanced) session window leaves the session where it is.
  - A Remote Desktop session takes the VM's screen away from vmtest. Disconnect when you're done.
    The next vmtest command moves the session back to the screen. While you're still connected, vmtest says so and waits for you.

### Several VMs

Several Claude sessions can test at once, each in its own VM. The pool is the first VM
(ClaudeTesting) and copies of it named `ClaudeTesting-2`, `ClaudeTesting-3` and so on.

- **How many.** `VMTEST_POOL` sets it. Unset, it's one VM per 5 GB of memory beyond 12 GB, or one
  per 4 logical processors, whichever is fewer, from 1 to 3. A 16 GB PC keeps one VM; a 32 GB PC with
  12 processors gets three.
- **Making them.** `vmtest prepare -Pool` copies the first VM's Clean checkpoint once into a
  read-only base disk, then makes each copy with a differencing disk on top of it, so each copy costs
  only what it changes. Each copy gets its own Windows computer name and network address, signs in by
  itself, and gets its own Clean. It takes a few minutes per VM, and the other VMs keep working meanwhile.
- **Memory.** Each VM uses about 4 GB while it runs, and a saved VM uses none. `begin` won't start a
  VM unless this PC would still have `VMTEST_RESERVE_GB` free; it says so instead.
- **Checkpoints stay on their VM.** A task's checkpoint lives on the VM it last saved on, and `begin`
  prefers that VM. If it's busy, the task starts from Clean on another VM and `begin` says so; saving
  there replaces the older checkpoint.
- **Copies vmtest didn't make are left alone.** vmtest only ever deletes or remakes a VM whose notes
  say `prepare -Pool` made it.

### Keeping Clean up to date

Clean doesn't get Windows updates by itself. To refresh it, use a throwaway task on the first VM:

1. `vmtest begin -VM ClaudeTesting -Repo vmtest -Branch refresh`, which starts from Clean.
2. Apply updates with `vmtest run ... -Elevated` or Windows Update.
3. `vmtest prepare -Force -Repo vmtest -Branch refresh`. This saves the result as the new Clean and frees the VM.
4. `vmtest prepare -Pool -Force` remakes the copies from the new Clean, so they don't drift apart.
   It skips a copy a task is using, and a copy holding a task's saved state, and names those tasks;
   once they `end` (or `begin` and `save` on another VM), run it again. A copy already made from the
   current Clean is left as it is.

## What it can and can't tell you about accessibility

vmtest reads the VM through the .NET UI Automation client. Screen readers use the native UI
Automation API and MSAA, so what vmtest sees is close to what they use, but not the same.

It reports:

- control type, name, AutomationId, value and states;
- the announced type, when an app changes it;
- help text;
- whether a control is offscreen;
- whether a control that should be reachable from the keyboard can't be focused;
- where focus is after every action.

For classic Win32 controls that the .NET client sees as plain panes (the buttons in a MessageBox,
for example), it adds their MSAA role, and takes their name and value from MSAA when the .NET
client has none, as in `Pane [MSAA role: push button] 'No'`. Classic menus are read the same way:
each item's name, keyboard shortcut and state, with the highlighted one marked.
`invoke` presses such controls through MSAA's default action.

It doesn't tell you:

- **What a screen reader actually says.** "Focus:" is a snapshot after the action.
  - If an app moves focus without the matching event, a screen reader may say nothing.
  - Notifications and live regions aren't recorded.
  - Speech capture with NVDA is issue #141.
- **Whether something works from the keyboard,** when you use `invoke`, `setvalue` or `focus`.
  Those act through the accessibility API directly. Use `keys "{TAB}"` and friends to check keyboard access.
- **Everything a screen reader reads.** `tree` shows the control view. Some text screen readers
  read in browse mode isn't in it. Position in a set ("2 of 5"), heading levels and LabeledBy aren't shown.

## Tests

`Invoke-Pester vmtest\tests` runs these with Pester 3.4, which comes with Windows. Hyper-V is
replaced by a fake that keeps checkpoints in memory, and the VM name points at one that doesn't
exist. They cover:

- every script parses and is plain ASCII;
- checkpoint names, including their hash, and recovering from a save that was cut short;
- `begin`'s resume-or-restore decision, for every VM state;
- the lock, `save`, `end`, `prepare` and `run`'s argument checks;
- the pool: which VM `begin` picks, saving an idle task, the memory check, `-Wait`, per-VM locks,
  the pool's size and names, and that `prepare -Pool` never touches a VM it didn't make;
- reading who is signed in.

What was checked by hand on the Arm64 Surface host (Windows 11 build 26340, VM build 26300):

- **Checkpoints:** begin, save, resume and end, including `begin` after the VM was saved outside vmtest. A resumed task came back with its programs open.
- **Driving programs:**
  - Hyper-V Manage `--demo`, Notepad and Calculator (a packaged app).
  - A WinForms MessageBox, read through MSAA and pressed through MSAA.
  - An administrator-owned window: refused without `-Elevated`, and driven with it.
- **Commands:** winget, exit codes, `%%`, UTF-8 output, scripts that throw, and timeouts.
- **Errors:** a missing program, control or window each gave a clear message, as did a command from a task that doesn't hold the VM.
- **Screenshots:** both from the agent and from the host.
- **A real-world test:** a second Claude session used vmtest to test QuickMail's MSI install, first run and uninstall prompts.

## Known limits

- **Speed:** each request starts a new PowerShell in the VM and compiles a little C#, so a command takes a few seconds.
- **winget local manifests:** `winget install --manifest` stops at the mark-of-the-web step in this
  VM, for any package. Catalog installs work. See issue #142. For now, install an MSI directly with
  `msiexec` through `run`.
- **Host screenshots:** `-FromHost` pictures are 1024x768 at most.
- **WPF menus:** a WPF window whose menu was opened and then closed with Escape can ignore `close`.
  vmtest says so; use `keys '%{F4}'`.

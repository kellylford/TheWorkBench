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

1. Add your account to the **Hyper-V Administrators** group from an administrator PowerShell, then
   sign out of Windows and back in:
   `Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "$env:USERDOMAIN\$env:USERNAME"`.
   After that, none of this needs elevation.
2. Build a VM named **ClaudeTesting** with Hyper-V Manage, using the defaults (account `vmuser`).
   - Put it on a switch that has a working connection. **External Wi-Fi** is the usual choice.
   - A checkpoint remembers which switch the VM was on, so re-take Clean if you change it.
3. Run `vmtest prepare` once. It:
   - turns on automatic sign-in and turns off Windows' passwordless-only setting, which blocks automatic sign-in;
   - keeps the screen on;
   - switches the VM to Standard checkpoints, so a task comes back with its programs still open;
   - installs the agent;
   - saves the VM as the **Clean** checkpoint.

Settings can be changed with environment variables: `VMTEST_VM`, `VMTEST_USER`, `VMTEST_PASSWORD`
and `VMTEST_STATE` (the lock folder, which defaults to `%LOCALAPPDATA%\vmtest`).

## Getting Claude sessions to use it

Three pieces make every Claude session test Windows apps here without being told each time:

1. **The skill.** `skill\SKILL.md` teaches a session when and how to use vmtest. Install it for all projects:
   `Copy-Item vmtest\skill -Destination "$HOME\.claude\skills\vmtest" -Recurse`
   Claude loads it whenever a task involves opening, driving or installing a Windows app.
2. **A rule in `~/.claude/CLAUDE.md`,** under "Build it, then test it hard", so it isn't optional:
   "Test Windows desktop apps (anything that opens a window, sends keys, or installs) in the test VM
   with the vmtest skill, never on this PC."
3. **A permission rule,** so vmtest runs without a prompt each time. In `~/.claude/settings.json`,
   under `permissions.allow`:
   `"PowerShell(powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\Users\\kelly\\GitHub\\TheWorkBench\\vmtest\\vmtest.ps1:*)"`

## Using it

Run it from the repo you're working in, so the task is named after that repo and branch:

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\kelly\GitHub\TheWorkBench\vmtest\vmtest.ps1 <command>
```

| Command | What it does |
|---|---|
| `begin` | Takes the VM for this repo and branch. If this task already has it, carries on from wherever it is, even if the VM was saved or turned off in the meantime. Otherwise it restores the task's checkpoint, or Clean the first time. |
| `deploy <path> [-Name n]` | Copies a build folder or file to `C:\vmtest\apps\<name>` in the VM. |
| `push <file> [-Destination dir]` | Copies one file into the VM. The default destination is `C:\vmtest\files`. |
| `run "<cmd>" [-Timeout s]` | Runs a command line as the signed-in user, and returns the output and exit code. The default timeout is 600 seconds, and the most is 3600. See the rules below. |
| `run -ScriptFile <file>` | Copies a `.cmd`, `.bat` or `.ps1` from this PC into the VM and runs it the same way. |
| `launch <exe> [-Arguments "..."]` | Starts a program. Reports its window and where focus is. |
| `windows`, `focused` | Lists the open windows, or shows the control with keyboard focus. |
| `tree [-Window w] [-Depth n]` | Shows the accessibility tree: names, AutomationIds, values, states, help text. |
| `invoke`, `setvalue`, `focus <control>` | Act on a control, found by AutomationId or name. |
| `keys "{TAB}"`, `type "text"` | Send keys (SendKeys syntax, so `+` means Shift) or plain text. Each one reports where focus ended up. |
| `close [-Window w]` | Closes a window, then reports whether it really went. |
| `shot <file.png> [-FromHost]` | Takes a picture of the VM's screen. |
| `save` | Checkpoints this task, parks the VM and frees it for other tasks. |
| `end [-Force]` | Use after the work is merged. Deletes the task's checkpoint and puts the VM back to Clean. If another task holds the VM, it only deletes this task's checkpoint. With `-Force`, it resets the VM anyway. |
| `status` | Shows who has the VM and lists its checkpoints. |

### Rules worth knowing

- **One task at a time.** Only one task can hold the VM. Every command that works inside the VM checks this.
  - Another task's `begin` is refused until the first one runs `save` or `end`.
  - `-Force` takes the VM anyway, and anything the other task hadn't saved is lost.
  - Commands that change the VM wait for each other, so two sessions can't take it at once.
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
- **Text that starts with `-`.** Pass it as `-Target "-5"`; otherwise PowerShell takes it as a parameter name.
- **Looking at the VM yourself.**
  - Hyper-V Manager's basic (not enhanced) session window leaves the session where it is.
  - A Remote Desktop session takes the VM's screen away from vmtest. Disconnect when you're done.
    The next vmtest command moves the session back to the screen. While you're still connected, vmtest says so and waits for you.

### Keeping Clean up to date

Clean doesn't get Windows updates by itself. To refresh it, use a throwaway task:

1. `vmtest begin -Repo vmtest -Branch refresh`, which starts from Clean.
2. Apply updates with `vmtest run ... -Elevated` or Windows Update.
3. `vmtest prepare -Force -Repo vmtest -Branch refresh`. This saves the result as the new Clean and frees the VM.

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
for example), it adds their MSAA role, as in `Pane [MSAA role: push button] 'No'`.
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

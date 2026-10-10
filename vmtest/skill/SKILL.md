---
name: vmtest
description: Test a Windows desktop app inside a Hyper-V test VM instead of on the user's own PC, so the user's focus, keyboard and screen reader are never disturbed. Use whenever testing would open a window, even for a moment, send keys or clicks, read an app's accessibility tree, take a screenshot of an app, or install or uninstall software (MSI, winget, setup.exe) for a Windows app. That includes automated test suites (pytest, xUnit and so on) in which any test builds a GUI window. Only builds and tests that never create a window stay on the PC. Not needed for web pages, or for iOS or Mac apps.
---

# Testing Windows apps in the test VM (vmtest)

Never launch, click, type into or install a Windows app on the user's own PC to test it. The user
is working on that PC, perhaps with a screen reader, and test windows steal focus, take keystrokes
and get read aloud. Do all of that in the VM with vmtest. Only builds and tests that never create a
window stay on the PC.

**"Unit tests" don't get a pass.** A test suite counts as opening a window if any test in it builds a
GUI window (wx, WinForms, WPF, WinUI, Qt, Tk), even for a moment, even hidden, even if it's called a
unit test. Many check focus, so they Show, Raise and SetFocus on purpose, and parallel runners
(`pytest -n 4`) do it several at a time. Before running a suite on the PC, check it: search the
tests for the GUI toolkit's imports (`import wx`, `System.Windows`, `QApplication`, `tkinter`). See
"Running a repo's tests in the VM" below.

## Finding vmtest

The `VMTEST_HOME` environment variable names the folder that holds `vmtest.ps1` and its README.
If it isn't set, ask the user where vmtest is, and suggest they set it once:
`setx VMTEST_HOME "<the vmtest folder>"`.

Run vmtest from the repo you're working in. The task is named after that repo and branch, and
every command works on the test VM your task holds.

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$env:VMTEST_HOME\vmtest.ps1" <command> [args]
```

If `begin` says there's no test VM, or no Clean checkpoint, the one-time setup in vmtest's README
hasn't been done. Tell the user rather than testing on their PC.

## The flow

The VM is disposable. Install, break or reconfigure anything in it: `begin` starts from this task's
last checkpoint or Clean, and `end` throws it all away. It is on the user's network, though, so that
freedom stops at the VM itself.

1. `begin` takes a free VM from the pool, and says which one.
   - If every VM is busy, it says who holds each one. Don't keep checking back: run
     `begin -Wait -Timeout 3600` in the background, which takes the first VM that frees up. Don't
     use `-Force` unless the user says so.
   - A task that has left its VM unused for two hours is saved for it and its VM handed on, so a
     wait never lasts forever.
   - It carries on from this task's last state, or starts from Clean. If it says this task's
     checkpoint is on a busy VM and it started from Clean, put back what you need, or wait for that
     VM with `begin -VM <name> -Wait`.
2. Put the build in with one of these:
   - `deploy <build folder> -Name MyApp`, which goes to `C:\vmtest\apps\MyApp`;
   - `push <file>`, which goes to `C:\vmtest\files`.
3. Start it with `launch C:\vmtest\apps\MyApp\MyApp.exe [-Arguments "..."]`. Use `run` for installers and other commands that finish:
   - `run "msiexec /i C:\vmtest\files\x.msi /qn" -Timeout 600`
   - `run "winget install --id X -e --silent --accept-source-agreements --accept-package-agreements"`
4. Look and act. `-Window` is part of a window title, or a process id.
   - `windows` lists open windows, with dialogs indented under the window that owns them, any open menu, and what has focus.
   - `tree -Window MyApp -Depth 8` shows names, AutomationIds, values, states and help text.
   - `keys "{TAB}" -Window MyApp` sends SendKeys syntax: `{ENTER} {ESC} ^s %f +{TAB}`. `+` is Shift, so a literal plus is `{+}`.
   - `type "text" -Window MyApp` types plain text.
   - `invoke <AutomationId or name> -Window MyApp`, `setvalue <control> "<value>"`, `focus <control>`. Write `id:<id>` to match only an AutomationId, or `name:<name>` to match only a name.
   - `focused` shows the control with keyboard focus. Every action also reports where focus landed.
   - `shot C:\path\shot.png` saves a picture of the VM's screen, which you can Read to look at.
   - `close -Window MyApp` closes a window and says whether it really closed.
5. When you stop for now, run `save`. It keeps this task's VM state and frees the VM. Save
   whenever you'll be away from the VM for a while, such as waiting on the user, so others can use it.
6. After this task's work has merged, run `end`. It deletes this task's checkpoints and puts its VM back to Clean.

`status` lists every VM, who holds it and when they last used it.

## Running a repo's tests in the VM

- **If the repo marks its GUI tests** (a pytest marker, a separate folder or project), run only the
  windowless ones on the PC, for example `pytest -m "not gui"` or `pytest tests/unit`, and the GUI
  ones in the VM. Check the marker really covers every test that builds a window.
- **If it doesn't**, run the whole suite in the VM. Suggest to the user that the repo gets a marker.
- **Never run GUI tests in parallel** (`-n`) in the VM either: they take focus from each other.

The recipe (Python shown; the same shape works for .NET or Node):

1. `begin`. Then put the runtime in, as the normal user (no `-Elevated`), for example:
   `run "winget install --id Python.Python.3.13 -e --architecture x64 --scope user --silent --accept-source-agreements --accept-package-agreements" -Timeout 900`
   x64 is the safe choice even in an Arm64 VM: more packages have x64 wheels, and Windows emulates them.
   Most native packages (wxPython, PyQt, numpy builds and so on) also need the Visual C++ runtime,
   which a clean Windows doesn't have. Without it, imports fail with "DLL load failed". It's
   per-machine, so: `run "winget install --id Microsoft.VCRedist.2015+.x64 -e --silent --accept-source-agreements --accept-package-agreements" -Elevated`2. Copy in the repo's committed files, not its local virtual environments or build output:
   - `git archive --format zip -o repo.zip HEAD` in the repo (uncommitted changes aren't included;
     commit first, or use `git stash create` to archive the working tree's tracked files);
   - `push repo.zip`;
   - `run "powershell -NoProfile -Command Expand-Archive C:\vmtest\files\repo.zip C:\vmtest\repo -Force"`.
3. Install the dependencies the way the repo's CI does: read its workflow files, put the steps in a
   `.cmd` and `run -ScriptFile setup.cmd -Timeout 2400`. Make a virtual environment in
   `C:\vmtest\repo`, and use the runtime's full path, since PATH may not have caught up yet.
4. Run the tests the way CI does, with `run` and a generous `-Timeout`. Test windows open and close
   on the VM's screen, where they belong.
5. `save` keeps the runtime and dependencies for this task's next `begin`. `end` throws them away.
   If many tasks need the same runtime, put it into Clean once (the README's "Keeping Clean up to date").

## Things that catch people out

- **Admin rights.** Programs run without admin rights by default, like a normal user's.
  - Add `-Elevated` for per-machine installs, or to drive a window of a program running as administrator.
  - vmtest refuses, and says so, when you'd need it.
- **`run` follows batch-file rules.** Write `%` as `%%`. Use `-ScriptFile file.ps1|.cmd` for long commands or tricky quoting.
- **`run` exit codes.** `run` exits with the command's own exit code. Anything a `run` starts may end along with it, so use `launch` for programs that should stay open.
- **Text or ids starting with `-`.** PowerShell reads them as parameter names. Pass text as `-Target "-5"`, and ids as `id:-31984` (wxPython gives most controls negative ids).
- **Menus.** Open one with keys (`keys "%f"`), then keep using `keys` to move and choose. `tree`, `windows` and every focus report show its items, with the highlighted one marked.
- **Dialogs.** `windows` shows a dialog under the window that owns it, and `-Window "<dialog title>"` finds it. `-Window <pid>` means the program's main window, and its tree includes its dialogs. While a modal dialog is up, keys aimed at its owner go to the dialog, as a person's would.
- **Something else in front.** If `keys` says it couldn't bring the window to the front, the message names what's in front instead (often a Windows notification). Deal with that the way a person would, for example `tree -Window "New notification"` and `invoke "No thanks"`, then try again.
- **Classic controls.** Win32 controls the .NET UI Automation client sees as blank panes get their role, name and value from MSAA, as in `Pane [MSAA role: editable text] 'Notes' value='...'`.
- **Windows 11 Notepad isn't a good typing target.** It can mangle fast keyboard input (lost Shift, repeated characters). Test typing in the app under test instead.
- **Keyboard checks.** To check keyboard access, use `keys "{TAB}"` and read where focus lands. `invoke` and `focus` act through the accessibility API, so they don't prove anything works from the keyboard.
- **Classic dialog buttons.** Some classic Win32 controls show as plain panes in UI Automation, so vmtest adds their MSAA role, as in `Pane [MSAA role: push button] 'No'`. `invoke` presses them.
- **What vmtest can't tell you.** It reports roles, names, states and focus, not speech. Tell the user which checks need a person with a screen reader, and what they should hear.
- **winget local manifests.** `winget install --manifest` may stop partway in the VM (TheWorkBench issue #142). Install the MSI directly instead.
- **If vmtest itself misbehaves:**
  - Report the exact command and output to the user. Don't edit vmtest from another project's session.
  - Don't work around it by testing on the user's PC.

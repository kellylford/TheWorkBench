---
name: vmtest
description: Test a Windows desktop app inside the ClaudeTesting Hyper-V VM instead of on Kelly's PC, so focus, keyboard and JAWS on the PC are never disturbed. Use whenever testing would open a window, send keys or clicks, read an app's accessibility tree, take a screenshot of an app, or install/uninstall software (MSI, winget, setup.exe) for a Windows app, including QuickMail, WeatherFast, ClaudeSpeak, Live Captions, IDT and the TheWorkBench apps. Not needed for unit tests or builds that show no window, for web pages (use the browser pane), or for iOS/Mac apps.
---

# Testing Windows apps in the test VM (vmtest)

Never launch, click, type into or install a Windows app on Kelly's PC to test it. Kelly works on
that PC with JAWS, and test windows steal focus, take keystrokes and get read aloud. Do all of that
in the VM with vmtest. Builds and tests that open no window stay on the PC as usual.

The tool is `C:\Users\kelly\GitHub\TheWorkBench\vmtest\vmtest.ps1`, and its README sits next to it.
Run it from the repo you're working in. The task is named after that repo and branch, and every
command checks that your task holds the VM.

```
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\kelly\GitHub\TheWorkBench\vmtest\vmtest.ps1 <command> [args]
```

## The flow

1. `begin` takes the VM.
   - If another task holds it, the command says which one. Wait, or tell Kelly; don't use `-Force` unless Kelly says so.
   - It carries on from this task's last state, or starts from Clean.
2. Put the build in with one of these:
   - `deploy <build folder> -Name MyApp`, which goes to `C:\vmtest\apps\MyApp`;
   - `push <file>`, which goes to `C:\vmtest\files`.
3. Start it with `launch C:\vmtest\apps\MyApp\MyApp.exe [-Arguments "..."]`. Use `run` for installers and other commands that finish:
   - `run "msiexec /i C:\vmtest\files\x.msi /qn" -Timeout 600`
   - `run "winget install --id X -e --silent --accept-source-agreements --accept-package-agreements"`
4. Look and act. `-Window` is part of a window title, or a process id.
   - `windows` lists open windows and what has focus.
   - `tree -Window MyApp -Depth 8` shows names, AutomationIds, values, states and help text.
   - `keys "{TAB}" -Window MyApp` sends SendKeys syntax: `{ENTER} {ESC} ^s %f +{TAB}`. `+` is Shift, so a literal plus is `{+}`.
   - `type "text" -Window MyApp` types plain text.
   - `invoke <AutomationId or name> -Window MyApp`, `setvalue <control> "<value>"`, `focus <control>`.
   - `focused` shows the control with keyboard focus. Every action also reports where focus landed.
   - `shot C:\path\shot.png` saves a picture of the VM's screen, which you can Read to look at.
   - `close -Window MyApp` closes a window and says whether it really closed.
5. When you stop for now, run `save`. It keeps this task's VM state and frees the VM.
6. After this task's PR has merged to main, run `end`. It deletes this task's checkpoint and puts the VM back to Clean.

## Things that catch people out

- **Admin rights.** Programs run without admin rights by default, like a normal user's.
  - Add `-Elevated` for per-machine installs, or to drive a window of a program running as administrator.
  - vmtest refuses, and says so, when you'd need it.
- **`run` follows batch-file rules.** Write `%` as `%%`. Use `-ScriptFile file.ps1|.cmd` for long commands or tricky quoting.
- **`run` exit codes.** `run` exits with the command's own exit code. Anything a `run` starts may end along with it, so use `launch` for programs that should stay open.
- **Text starting with `-`.** Pass it as `-Target "-5"`.
- **Keyboard checks.** To check keyboard access, use `keys "{TAB}"` and read where focus lands. `invoke` and `focus` act through the accessibility API, so they don't prove anything works from the keyboard.
- **Classic dialog buttons.** These show as `Pane [MSAA role: push button] 'No'`; the MSAA role is what a screen reader uses. `invoke` presses them.
- **What vmtest can't tell you.** It reports roles, names, states and focus, not speech. Hand Kelly the screen-reader listening checks (step 4 of Kelly's workflow).
- **winget local manifests.** `winget install --manifest` doesn't work in this VM (TheWorkBench issue #142). Install the MSI directly instead.
- **If vmtest itself misbehaves:**
  - Report the exact command and output in your summary to Kelly. Don't edit vmtest from another project's session.
  - Don't work around it by testing on Kelly's PC.

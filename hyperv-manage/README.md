# Hyper-V Manage

> **Status: in use on real Hyper-V, not yet released.** On 2 October 2026 it built Windows VMs
> end to end on an Arm64 PC and an x64 PC, connected to them with Remote Desktop, opened the
> console, and paused one. Settings, Checkpoint, Apply Checkpoint, Clone and Delete have so far been exercised only
> against the pretend VMs of demo mode. See [Testing it on a real machine](#testing-it-on-a-real-machine).

A Windows app for managing Hyper-V virtual machines, built screen reader first. It is the
Windows counterpart of [Parallels Manager](../parallels-manager/), and it builds new Windows
VMs with [New-HyperVRdpVM.ps1](../hyperv-rdp-vm/), so a VM made from the app is exactly the
VM the script makes: ready to sign in to with Remote Desktop, with sound.

It isn't called Hyper-V Manager because Windows already has a Hyper-V Manager.

## What it does

- Lists every VM with its state, address, network, memory, processors and whether it starts
  with the PC. The list refreshes itself every ten seconds without moving your place in it.
- **Connect with Remote Desktop**, the way to hear a VM with a screen reader. It opens the
  connection file the script left on your desktop if there is one, so the saved sign-in is
  used; otherwise it makes a connection to the VM's name, which keeps working when its address
  changes. Either way, it connects by name only when the name leads to this VM and nothing
  else, and otherwise by address: a VM with the same name on another PC answers to the same
  name, and Remote Desktop could reach that one instead.
- **Save Connection File** puts `<VM name>.rdp` on the desktop, for a VM whose file was lost or
  that you want to connect to from another computer. It never overwrites a desktop file of that
  name that connects somewhere else.
- **Open Console**: the Hyper-V window, for when Windows inside the VM isn't up yet.
- **Screenshot** (Ctrl+Shift+S) takes a picture of a running or paused VM's screen and opens it
  in a viewer, so your screen reader can describe it: JAWS Picture Smart, an NVDA image
  description add-on, or paste it into Be My AI, ChatGPT or Claude. Hyper-V takes the picture
  from outside the VM, so it works when nothing inside can talk to you: Windows setup, a
  BitLocker prompt, a stuck sign-in, a blue screen, or another operating system. Focus goes to the
  picture, named with the VM and the time it was taken, for example "Screen of Win11-RDP, taken
  3:42:10 PM, 1024 by 768"; a picture that is all one color, most often a VM whose display has
  gone to sleep, says "blank" as well. Take Again (F5), Copy (Ctrl+C), Save As (Ctrl+S) and Close
  (Escape) are below it. Taking another picture of the same VM, from the viewer or the main
  window, replaces the one in its open viewer and puts focus back on it. The picture is the
  VM's screen at its own resolution, the console's screen rather than a Remote Desktop
  session's.
- **Start, Shut Down, Turn Off, Save, Pause, Resume, Restart.** Only the ones that make sense for
  the VM's state are available. Shut Down and Restart ask Windows inside the VM, so nothing
  unsaved is lost; Turn Off is the power switch.
- **Settings**: processors, memory, network, whether it starts with the PC, and automatic
  checkpoints. Processors and memory can only change while the VM is off; the window says so
  and keeps the current values readable. If no switch reaches your own network, it offers to
  create one.
- **Checkpoint, Apply Checkpoint, Clone, Delete.**
  - Apply Checkpoint lists the VM's checkpoints, newest first, each with when it was taken, and
    puts the VM back to the one you choose. A running or paused VM is turned off first. Unless
    you uncheck it, how the VM is now is kept as a checkpoint first, so nothing is lost for good.
  - Clone works on a VM that is off or saved, since a copy of a running one would join the
    network as a second machine with the same name. Windows inside the copy keeps the same
    computer name; rename it there before running both.
  - Delete asks first, naming the disk files it will remove. It keeps any disk another VM uses
    or depends on, and only removes a desktop connection file that connects to this VM. It says
    afterwards what it kept and anything it couldn't delete.
- **Windows ISO downloads**: New Virtual Machine has links, under the ISO field, to Microsoft's
  Windows 11 download pages, with the page for this PC's kind of processor first (Hyper-V only
  runs Windows built for it) and the other kind's second. The Help menu has the same two. They
  open in your browser as you, not as administrator.
- **New Virtual Machine**: the script's options in a form, with a name that starts with this
  PC's name (for example `SURFACEPRO7-Win11`) so VMs made on different PCs never share one. Then
  the script's own progress as it
  runs, one line at a time, each one also spoken (PowerShell's own error detail lines stay in the
  log but aren't read out). Closing the window during a build stops it and cleans up what it had
  made: the ISO and disk are unmounted and the half-built disk deleted. If it had already got as
  far as creating the VM, that VM is left in the list to delete. The main window won't close
  while a build runs.

Every action goes through Hyper-V's own PowerShell commands, the way Parallels Manager goes
through `prlctl`, so anything the app does can be repeated by hand.

## Requirements

| Requirement | Notes |
|---|---|
| Windows 10 or 11 Pro, Enterprise or Education | Windows Home doesn't include Hyper-V |
| Hyper-V turned on | The app tells you the command if it isn't |
| Administrator rights | The app asks when it starts, as the script does |
| .NET 10 SDK | Only for building it |

## Using it

Run `HyperVManage.exe` and choose Yes when Windows asks for permission.

Focus starts on the first VM in the list. Each one reads as its name, state, address and
network, for example "Win11-RDP, Running, 10.0.0.41, External Wi-Fi".

### Keyboard

In the list of virtual machines:

| Key | Action |
|---|---|
| Enter | Connect with Remote Desktop |
| Delete | Delete the VM (asks first) |
| Shift+F10 or the Applications key | Every action for the VM |

Anywhere in the window:

| Key | Action |
|---|---|
| Ctrl+N | New virtual machine |
| F5 | Refresh the list |
| Ctrl+Enter | Start |
| Ctrl+Period | Shut down |
| Ctrl+Shift+Period | Turn off |
| Ctrl+U | Save |
| Ctrl+P | Pause |
| Ctrl+Shift+P | Resume |
| Ctrl+R | Restart |
| Alt+Enter | Settings |
| Ctrl+K | Checkpoint |
| Ctrl+Shift+K | Apply a checkpoint |
| Ctrl+D | Clone |
| Ctrl+Shift+S | Screenshot of the VM's screen |

Every action is also on the VM menu (Alt+V) and in the list's context menu. The menu bar is
reached with Alt or F10, never with Tab. Help, then Keyboard Shortcuts opens these as a list, one
shortcut per line and each section's heading a line of its own: arrow through it, and press
Escape to close it.

In the screenshot window:

| Key | Action |
|---|---|
| F5 | Take the picture again |
| Ctrl+C | Copy the picture |
| Ctrl+S | Save the picture as a PNG |
| Escape | Close |

In the Hyper-V console window that Open Console opens:

| Key | Action |
|---|---|
| Ctrl+Alt+Left Arrow | Take the keyboard back from the VM |
| Ctrl+Alt+End | Send Ctrl+Alt+Delete to the VM |
| Ctrl+Alt+Pause | Switch between full screen and a window |

Its View menu has Enhanced Session, which runs the console over Remote Desktop and can carry
sound once Windows in the VM is up. Connect with Remote Desktop is still the dependable way to
hear a VM.

### Remote Desktop asks each time

Windows asks about sharing every time a connection file opens: it lists the sound, microphone
and clipboard the connection uses, and you choose Connect. Recent versions of Windows do this for
every connection file that isn't digitally signed, which a file made on your own PC is not, and
it can't be turned off. The saved sign-in still means you don't type the password.

### What it says

When an action starts and when it finishes or fails, the app reports it through the screen
reader with a UI Automation notification, and shows the same text in the status bar. A failure
carries Hyper-V's own message. Nothing is announced that the screen reader already reports,
such as the selection moving or a check box changing.

### Demo mode

```bat
HyperVManage.exe --demo
```

Three pretend VMs, no Hyper-V, and no administrator rights. Every action and dialog works
against them, and New Virtual Machine prints the script's steps without running anything.
Connect, Open Console and Save Connection File say there is no real VM, rather than reaching a
real one that happens to share a demo VM's name. Screenshot shows a made-up screen: a blue
desktop with a window and a taskbar. Use it to
try the app, or to check the interface on a PC without Hyper-V.

## Building

Open `Build App.cmd`, or run it from a command prompt. It builds one self-contained
`HyperVManage.exe`, with the creation script inside it, in `build\x64\` or `build\arm64\` to
match the PC. Pass `x64` or `arm64` to choose:

```bat
"Build App.cmd" x64
```

### Signing

Builds are signed with Kelly Ford's Azure Artifact Signing certificate (publisher "kelly ford"),
like the other apps; see `The-Idea-Place-Projects/signing/windows.md`.

- **On this PC:** add `sign` to sign the exe after building, or sign any file with
  `Sign Files.ps1`. It needs `winget install Microsoft.Azure.TrustedSigningClientTools` and
  `az login` once, and fails unless every file comes out validly signed and timestamped.

  ```bat
  "Build App.cmd" x64 sign
  powershell -ExecutionPolicy Bypass -File "Sign Files.ps1" build\arm64\HyperVManage.exe
  ```

- **Releases:** pushing a tag `hyperv-manage-v<major>.<minor>.<patch>` runs
  `.github/workflows/release-hyperv-manage.yml`. It tests, builds both apps with the tag as their
  version, signs them and the VM script, checks every signature, and publishes a GitHub release
  with `HyperVManage-x64.exe`, `HyperVManage-arm64.exe` and a zip of the script. A pull request
  touching either project runs the same build and tests, unsigned.

  ```bat
  git tag hyperv-manage-v1.0.0
  git push origin hyperv-manage-v1.0.0
  ```

The repository's `New-HyperVRdpVM.ps1` stays unsigned: the app embeds it and a test checks the
embedded copy byte for byte. Only the copies handed out are signed.

Tests:

```bat
dotnet test tests\HyperVManage.Tests
```

Two tests press real keys at a real window: one checks that the arrow keys move between the
network choices in New Virtual Machine and that Tab into them never changes the choice, the
other that Tab from the VM list never stops on the menu bar. They take focus from whatever else
is on screen, so they only run with `HYPERVMANAGE_RUN_INPUT_TESTS=1` set.

## How it is put together

```
hyperv-manage/
  Build App.cmd                 Builds build\<arch>\HyperVManage.exe
  src/HyperVManage/
    App.xaml.cs                 Elevation, Hyper-V check, --demo
    Models/VmInfo.cs            A VM, and which actions each state allows
    Services/
      PowerShellRunner.cs       Runs powershell.exe; Ps.Quote makes every value a literal
      PowerShellHyperVService   The Hyper-V commands: list, actions, settings, clone, delete
      DemoHyperVService         The pretend VMs
      NewVmScript.cs            Runs the embedded New-HyperVRdpVM.ps1
      RemoteDesktop.cs          Connection files, and choosing a name over an address
      ScreenPicture.cs          Hyper-V's screen pixels made into a PNG
    ViewModels/                 Main list, Settings, New VM, the screenshot viewer
    Views/                      The windows
  tests/HyperVManage.Tests/
```

- **The script is embedded, not copied.** The project embeds
  `../hyperv-rdp-vm/New-HyperVRdpVM.ps1` itself, and a test checks the embedded copy is
  byte-for-byte the one in the repository, so the app and the command line can't drift.
- **No value is ever pasted into PowerShell as code.** Names, paths and passwords go through
  `Ps.Quote`, and a test checks PowerShell's own parser reads each one back unchanged. Another
  test parses every script the app can send.
- **The computer name rule is shared.** The app finds a VM on the network by the Windows
  computer name the script gives it. A test runs the script's own lines for that name in
  PowerShell and checks the app computes the same for each case.
- **Nothing it runs as administrator can be swapped by another program.** The app runs elevated,
  so the creation script is never written to a file, where another program could rewrite it in
  the moment before PowerShell reads it. The app opens a named pipe with a random name that only
  Administrators and SYSTEM can open, starts PowerShell with a short command that reads the
  script from that pipe, and runs it from memory. (Standard input was tried and rejected:
  Windows PowerShell then wraps its messages in XML.) PowerShell, Remote Desktop, the console and
  `cmdkey` are started by their full paths in System32, never by bare name, which would find a
  copy in the app's own folder first.
- **What PowerShell prints is read out as plain text.** With its output captured, Windows
  PowerShell writes some messages as XML ("#< CLIXML"), including a "Preparing modules for first
  use" progress record. The app drops progress records and turns errors back into plain lines
  before showing or speaking them.
- **Still to do before others use it:** the single-file exe unpacks some of .NET's own libraries
  to the user's TEMP when it starts, where another program could replace them. Shipping it
  installed (for example as an MSIX package, as the Microsoft Store does) avoids that.
- **VMs are addressed by id.** Hyper-V allows two VMs with the same name, and `Get-VM -Name`
  reads `* ? [ ]` as wildcards, so names are never used to find a VM to act on.
- **The list is updated in place.** Replacing it would move a screen reader back to the top
  every ten seconds.
- **Screenshots come from Hyper-V's WMI classes**, since no cmdlet takes one:
  `Msvm_VirtualSystemManagementService.GetVirtualSystemThumbnailImage`. Hyper-V refuses a
  picture larger than the VM's screen is now, so the app reads that size from the VM's
  `Msvm_VideoHead` and asks for exactly it (falling back to the same shape within 1024 by 768).
  The pixels come as 16-bit RGB565 after a 4-byte header that holds the data's length; the app
  drops the header only when it says exactly that, and refuses data of any other size rather
  than show a shifted picture.

## Testing it on a real machine

Done so far, on 2 October 2026: building a VM with New Virtual Machine on an Arm64 PC and on an
x64 PC, each on "Your network"; Connect with Remote Desktop; Open Console; Pause.

Still to do, on a PC with Hyper-V:

1. Confirm the list matches `Get-VM`.
2. Start, Shut Down, Save and Resume a test VM, and Turn Off one that is running.
3. Connect with Remote Desktop and confirm sound plays, and that `ipconfig` in the session shows
   the address the list shows.
4. Save Connection File, then open the file from the desktop.
5. In Settings, change the network and the start setting on a running VM; then shut it down
   and change processors and memory.
6. Checkpoint it, change something, Apply Checkpoint and confirm the change is gone. Do it again
   with the VM running, paused and saved, and with the keep-it-first box checked and unchecked.
   Clone it, then Delete the clone and confirm its folder and disk are gone.
7. Connect to a VM from another computer on the network.
8. Screenshot a running VM at its sign-in screen and at the desktop, a paused one, and one
   whose display has gone to sleep (it should say blank). Have JAWS Picture Smart and NVDA
   describe the picture, paste it into a web page, and save it.

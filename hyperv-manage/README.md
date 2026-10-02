# Hyper-V Manage

> **Status: new, tested against pretend VMs only.** The interface, every dialog and the
> creation flow were exercised in demo mode, and the PowerShell it sends to Hyper-V is checked
> by the tests to parse. It has not yet been run against real Hyper-V VMs. See
> [Testing it on a real machine](#testing-it-on-a-real-machine).

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
  changes.
- **Open Console**: the Hyper-V window, for when Windows inside the VM isn't up yet.
- **Start, Shut Down, Turn Off, Save, Pause, Resume, Restart.** Only the ones that make sense for
  the VM's state are available. Shut Down and Restart ask Windows inside the VM, so nothing
  unsaved is lost; Turn Off is the power switch.
- **Settings**: processors, memory, network, whether it starts with the PC, and automatic
  checkpoints. Processors and memory can only change while the VM is off; the window says so
  and keeps the current values readable. If no switch reaches your own network, it offers to
  create one.
- **Checkpoint, Clone, Delete.**
  - Clone works on a VM that is off or saved, since a copy of a running one would join the
    network as a second machine with the same name. Windows inside the copy keeps the same
    computer name; rename it there before running both.
  - Delete asks first, naming the disk files it will remove. It keeps any disk another VM uses
    or depends on, and only removes a desktop connection file that connects to this VM. It says
    afterwards what it kept and anything it couldn't delete.
- **New Virtual Machine**: the script's options in a form, then the script's own progress as it
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
| Ctrl+D | Clone |

Every action is also on the VM menu (Alt+V) and in the list's context menu. Help, then Keyboard
Shortcuts lists these in the app.

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
Connect and Open Console say there is no real VM, rather than reaching a real one that happens
to share a demo VM's name. Use it to
try the app, or to check the interface on a PC without Hyper-V.

## Building

Open `Build App.cmd`, or run it from a command prompt. It builds one self-contained
`HyperVManage.exe`, with the creation script inside it, in `build\x64\` or `build\arm64\` to
match the PC. Pass `x64` or `arm64` to choose:

```bat
"Build App.cmd" x64
```

Tests:

```bat
dotnet test tests\HyperVManage.Tests
```

One test presses real keys at a real window, checking that the arrow keys move between the
network choices in New Virtual Machine and that Tab into them never changes the choice. It takes
focus from whatever else is on screen, so it only runs with `HYPERVMANAGE_RUN_INPUT_TESTS=1` set.

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
    ViewModels/                 Main list, Settings, New VM
    Views/                      The windows
  tests/HyperVManage.Tests/
```

- **The script is embedded, not copied.** The project embeds
  `../hyperv-rdp-vm/New-HyperVRdpVM.ps1` itself, and a test checks the embedded copy is
  byte-for-byte the one in the repository, so the app and the command line can't drift.
- **No value is ever pasted into PowerShell as code.** Names, paths and passwords go through
  `Ps.Quote`, and a test checks PowerShell's own parser reads each one back unchanged. Another
  test parses every script the app can send.
- **VMs are addressed by id.** Hyper-V allows two VMs with the same name, and `Get-VM -Name`
  reads `* ? [ ]` as wildcards, so names are never used to find a VM to act on.
- **The list is updated in place.** Replacing it would move a screen reader back to the top
  every ten seconds.

## Testing it on a real machine

Not yet done. On a PC with Hyper-V:

1. Run the app and confirm the list matches `Get-VM`.
2. Start, Shut Down, Save, Pause and Resume a test VM, and Turn Off one that is running.
3. Connect with Remote Desktop and confirm sound plays.
4. In Settings, change the network and the start setting on a running VM; then shut it down
   and change processors and memory.
5. Checkpoint it, Clone it, then Delete the clone and confirm its folder and disk are gone.
6. Build a VM with New Virtual Machine, choosing "Your network", and connect to it from another
   computer.

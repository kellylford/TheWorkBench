# Hyper-V Windows VM, ready for Remote Desktop

> **Status: works on Arm64; not yet run on x64.** On 1 October 2026 it built a
> VM end to end on a Snapdragon X Elite host running Windows 11 Pro Insider
> (build 26340) from the Arm64 26300 ISO. Remote Desktop signed in on its own
> and sound played on the host. That host needed the manual boot-store
> fallback described below. An x64 host hasn't been tried yet. See
> [Picking this up on a Pro machine](#picking-this-up-on-a-pro-machine) for
> the test plan.
>
> **New and not yet run end to end:** joining your own network by default,
> starting with the PC, and connecting by `.local` name. Each was done by hand
> on that Arm64 host first (an external switch on Wi-Fi, the VM moved onto it,
> `Win11-RDP.local` resolving to its new address and Remote Desktop answering
> there, checked from the host), and the script now does the same steps.

One script that builds a Windows virtual machine in Hyper-V with a fully
unattended install and leaves it ready to sign in to with Remote Desktop, from
this PC or from any other computer on your network.

To do the same from a window instead of the command line, and to manage the VM
afterwards, use [Hyper-V Manage](../hyperv-manage/), which runs this script.

Remote Desktop is the way to get proper audio out of a Hyper-V VM for JAWS,
NVDA or Narrator, so the script finishes by opening a Remote Desktop connection
with sound playing on your PC and your microphone passed through.

Every message it prints is plain text, one line at a time, with no progress
bars.

## What you need

- **Windows 10 or 11 Pro, Enterprise or Education on the host.** Windows Home
  does not include Hyper-V.
- **Hyper-V turned on.** If it isn't, the script tells you the command to run.
- **A Windows ISO** that matches the host's processor: x64 on Intel and AMD
  PCs, Arm64 on Arm PCs. They're on
  [the x64 download page](https://www.microsoft.com/software-download/windows11)
  and [the Arm64 download page](https://www.microsoft.com/software-download/windows11arm64).
  Put it in your Downloads folder and the script finds it on its own. The same
  script works on both kinds of PC: it reads the processor type and sets up the
  VM to match. If Downloads holds both kinds of ISO, it skips the one whose
  file name says it's for the other processor.
- About 20 GB of free disk space. The virtual disk is 128 GB but only grows as
  it fills.

## Running it

Open `Create VM.cmd` in File Explorer, or run this in PowerShell:

```powershell
.\New-HyperVRdpVM.ps1
```

Windows asks for administrator permission, then the script runs in a new
window. It takes 15 to 30 minutes and needs nothing from you. When it finishes
it opens Remote Desktop and signs you in.

## What you get

| Item            | Value                                        |
|-----------------|----------------------------------------------|
| VM name         | Win11-RDP                                    |
| Computer name   | Win11-RDP                                    |
| User name       | vmuser (an administrator)                    |
| Password        | vmadmin                                      |
| Connection file | `Win11-RDP.rdp` on your desktop              |
| Address         | `Win11-RDP.local`, or an IP address          |
| Network         | Your own network, through an external switch |
| Starts          | Whenever this PC starts                      |

The VM joins your own network, so other computers on it can connect with
Remote Desktop too, and it starts whenever your PC does, so turning the PC on
is all it takes. The connection file uses the VM's name, `Win11-RDP.local`,
rather than its address, because your router can give it a new address; other
Windows PCs and Macs on your network can look the name up as well.

The sign-in is saved in Windows Credential Manager, so opening the connection
file logs you straight in.

The password is set never to expire, the VM never sleeps, and automatic
checkpoints are off.

### The network

If this PC has no external switch yet, the script creates one called
`External Network` on the adapter you use for the internet, Wi-Fi or Ethernet.
**This PC's network connection drops for a few seconds while Windows sets it
up**, and the script waits for it to come back. If an external switch already
exists, the script uses it and changes nothing.

To keep the VM private to this PC instead, as earlier versions of the script
did, use `-HostOnly`. It then goes on the Default Switch, where only this PC can
reach it, at `Win11-RDP.mshome.net`.

## Reconnecting later

Open `Win11-RDP.rdp` on your desktop, or connect Remote Desktop to
`Win11-RDP.local` from any computer on your network. Copy the `.rdp` file to
another computer to use it there. The VM starts whenever your PC does; give it
a minute to boot. If you shut the VM itself down, start it from Hyper-V Manage,
or from an administrator PowerShell window:

```powershell
Start-VM Win11-RDP
```

## Options

| Option            | Default                | What it does                                   |
|-------------------|------------------------|------------------------------------------------|
| `-IsoPath`        | newest Windows ISO in Downloads for this PC's processor | The Windows ISO to install from |
| `-VMName`         | Win11-RDP              | VM name, and the computer name (15 characters) |
| `-Edition`        | Windows 11 Pro         | Edition inside the ISO. Home is refused.       |
| `-UserName`       | vmuser                 | Windows account name                           |
| `-Password`       | vmadmin                | Windows account password                       |
| `-ProcessorCount` | 4                      | Virtual processors                             |
| `-MemoryGB`       | 4                      | Starting memory; it can grow to twice this, or 8 GB |
| `-DiskGB`         | 128                    | Virtual disk size                              |
| `-SwitchName`     | an external switch     | Hyper-V virtual switch. Left out, the VM joins your network through an external switch, created if there isn't one |
| `-HostOnly`       | off                    | Use the Default Switch: only this PC can reach the VM |
| `-NoAutoStart`    | off                    | Don't start the VM when this PC starts         |
| `-VhdFolder`      | Hyper-V's disk folder  | Where the virtual disk goes                    |
| `-TimeZone`       | this PC's time zone    | Windows time zone name                         |
| `-NoConnect`      | off                    | Don't open Remote Desktop at the end           |
| `-Remove`         | off                    | Delete the VM, its disk, connection file and saved sign-in |

For example, a second VM with more memory:

```powershell
.\New-HyperVRdpVM.ps1 -VMName Test2 -MemoryGB 8
```

## Starting over

```powershell
.\New-HyperVRdpVM.ps1 -VMName Win11-RDP -Remove
```

## How it works

Windows Setup never runs. The script copies Windows from the ISO straight onto
a new virtual disk, makes the disk bootable, and adds an answer file that the
new Windows reads on first boot. That avoids the "press any key to boot from
CD or DVD" prompt that stops unattended installs on Generation 2 VMs, and it is
quicker than Setup.

The answer file names the computer, creates the account, skips every first-run
screen, and turns on Remote Desktop and its firewall rules. The script then
waits using PowerShell Direct, which reaches the VM through Hyper-V rather
than the network. Once Windows reports setup is finished, it allows audio
playback and microphone redirection over Remote Desktop, makes sure the Windows
Audio service is running, and marks the network as private.

Windows isn't activated. It runs normally; add a product key in Settings if
you want to.

## Troubleshooting

**"Hyper-V isn't available on this PC."** Hyper-V is off, or the PC runs
Windows Home. On Pro, run this in an administrator PowerShell window and
restart:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
```

**"This ISO is for x64 PCs, but this PC is Arm64."** Download the ISO for your
processor. Hyper-V can't run the other kind.

**Remote Desktop asks whether you trust the publisher of the connection.** The
connection file isn't signed. Check "Don't ask me again" and choose Connect.

**Other computers can't reach the VM, or setup never finds its address.**
The VM gets its address from your router. A few routers refuse more than one
address from the same Wi-Fi connection, which is how a VM shares it. Plug the PC
into Ethernet, or start over with `-HostOnly` and connect from this PC.

**The connection file stopped working.** If `Win11-RDP.local` doesn't answer,
your network may not pass names around. Find the VM's current address in
Hyper-V Manage and connect to that; setting up an address reservation for the VM
in your router stops it changing.

**No sound.** In the Remote Desktop window, open Show Options, then Local
Resources, then Remote audio Settings, and make sure "Play on this computer" is
selected. The connection file sets this, but a copy of Remote Desktop that has
its own saved settings can override it.

## Picking this up on a Pro machine

Notes for whoever (person or agent) runs this for the first time.

### Goal

Kelly uses a screen reader. Audio from a Hyper-V VM only works properly over
a real Remote Desktop connection (`mstsc`), not the VMConnect console. The
script has to take a Windows ISO to a VM that Kelly can sign in to with
Remote Desktop as `vmuser` / `vmadmin`, with nothing to click in between, and
with every message readable by a screen reader: plain `Write-Host` lines, no
progress bars, no pop-up dialogs.

### Files

| File                   | Purpose                                             |
|------------------------|-----------------------------------------------------|
| `New-HyperVRdpVM.ps1`  | The whole thing. It elevates itself if needed.      |
| `Create VM.cmd`        | Double-click launcher that bypasses execution policy |
| `README.md`            | This file                                           |

### What the script does, in order

1. Relaunches itself elevated with `-NoExit` if it isn't already.
2. Checks that `New-VM` exists (Hyper-V is on), the VM name and VHDX are
   free, the edition isn't Home, and the ISO's architecture matches the
   host's (`Win32_Processor.Architecture`: 9 is x64, 12 is Arm64, the same
   numbers `Get-WindowsImage` uses). It then picks the switch: `-SwitchName`
   if given, the Default Switch with `-HostOnly`, otherwise the first external
   switch. With none, it finds the internet adapter (the lowest-metric
   `0.0.0.0/0` route on a physical adapter that is up) and creates
   `External Network` on it with `-AllowManagementOS`, before any disk work,
   so a failure there costs nothing.
3. Mounts the ISO, finds `sources\install.wim` or `install.esd`, and picks
   the index whose `ImageName` equals `-Edition`.
4. Creates a dynamic VHDX, mounts it, and initialises it as GPT. Any
   partition that `Initialize-Disk` adds is removed. It then creates a
   260 MB FAT32 partition (made as basic data so it can take a drive
   letter), a 16 MB MSR and an NTFS Windows partition.
5. Runs `Expand-WindowsImage` onto the Windows partition, then the image's
   own `bcdboot.exe /f UEFI`. If bcdboot fails, it builds the boot files
   and store by hand; see [The boot-store fallback](#the-boot-store-fallback).
6. Writes `\Windows\Panther\unattend.xml`, which has only the `specialize`
   and `oobeSystem` passes. It then switches the first partition's GPT type
   to EFI System and dismounts everything. If this stage fails, the
   half-built VHDX is deleted.
7. Creates a Generation 2 VM with dynamic memory and automatic checkpoints
   off, boots from the hard disk first, sets `AutomaticStartAction Start`
   (unless `-NoAutoStart`), and adds a vTPM if it can (a failure only prints a
   note).
8. Polls `Invoke-Command -VMName` (PowerShell Direct) every 15 seconds with
   `COMPUTERNAME\vmuser`. The call fails until the answer file has created
   the account. Once it gets in, it waits until `HKLM\SYSTEM\Setup` shows
   `SystemSetupInProgress` and `OOBEInProgress` at 0. The same call then
   enables RDP and its firewall group (`@FirewallAPI.dll,-28752`, which
   works in any language), sets the RDP audio policies, starts Audiosrv,
   marks the network Private and returns the VM's IPv4 address.
9. Picks a name that resolves to that IP, trying for up to a minute while
   the VM's name registration catches up: `COMPUTERNAME.local` then
   `COMPUTERNAME` on an external switch, `COMPUTERNAME.mshome.net` on the
   Default Switch. Otherwise it uses the IP. It waits for TCP 3389 to answer,
   then writes the `.rdp` file to the desktop, runs
   `cmdkey /generic:TERMSRV/<target>`, and launches `mstsc`.

### Test plan

1. On a Pro, Enterprise or Education host with Hyper-V on, download the
   Windows 11 ISO for the host's architecture into Downloads.
2. Run `Create VM.cmd`. Expect about 30 lines of step messages and a
   "Still setting up" line every 3 minutes. Remote Desktop should then open
   and sign in without asking for anything.
3. In the session, confirm that:
   - you are signed in as `vmuser`, and it's an administrator;
   - sound plays on the host (start Narrator with Ctrl+Win+Enter);
   - `Win11-RDP.rdp` reconnects after closing the session;
   - it still reconnects after restarting the host, when the IP changes;
   - another computer on the network can connect to `Win11-RDP.local`;
   - the VM is running again after the host restarts, without starting it.
4. Run `.\New-HyperVRdpVM.ps1 -Remove` and confirm that the VM, VHDX, `.rdp`
   file and saved credential (`cmdkey /list`) are all gone.
5. If possible, try an `install.esd` ISO (Media Creation Tool) as well as
   an `install.wim` one, and both x64 and Arm64 hosts.

### What the Arm64 run confirmed

All of these worked as designed on the first full run: skipping every
first-run screen (no product key or region page appeared), PowerShell Direct
as `COMPUTERNAME\vmuser`, the disk layout and booting from
`\EFI\Boot\bootaa64.efi` with no NVRAM entry, `InputLocale` as `en-US`, the
`cmdkey` sign-in being used by `mstsc`, `mshome.net` resolving, and the vTPM
(it was added without a note).

Still unchecked: an x64 host, an `install.esd` ISO, and whether bcdboot
works normally on a release (non-Insider) build.

### The boot-store fallback

On the 26340 Insider host, `bcdboot /s` fails with exit code 183 and
`Failed to create a new system store. Status = [c0000035]`. It loads the new
store under `HKLM\BCD00000000`, the key the host's own store already uses.
`/offline` and `/nofirmwaresync` don't help. So when bcdboot fails, the script
does its job by hand. Each step below fixes a failure seen while testing:

1. Copies `Windows\Boot\EFI` and `Fonts` from the applied image to
   `\EFI\Microsoft\Boot`, and `bootmgfw.efi` to `\EFI\Boot\boot<arch>.efi`.
2. Creates the store with `bcdedit /createstore` in `%TEMP%`, which loads it
   under a key of its own.
3. Flags it as the system store at once: `Description` gets `KeyName` =
   `BCD00000000`, `System` = 1 and `TreatAsSystem` = 1. Without the flags, the
   specialize pass logs `BCD: File is not system store` and stops with
   "Windows Setup could not configure Windows to run on this computer's
   hardware". `reg load` refuses BCD files ("The filename or extension is too
   long"), so the script opens a byte copy with `RegLoadAppKey`. That only
   works before bcdedit adds entries; afterwards it is access denied. The
   `Description` key denies Administrators write access, so the write uses
   `REG_OPTION_BACKUP_RESTORE` with the backup and restore privileges. The
   flags are read back before going on.
4. Copies the flagged store to the boot partition and adds `{bootmgr}`
   (`device boot`) and a Windows loader (`device locate`, `osdevice locate`).
   `partition=X:` records the host's view of the disk, and the VM then stops
   at Windows Boot Manager with 0xc000000e. With Secure Boot on, the same
   mistake shows up as the VM turning itself off half a second after it
   starts.

### Where to look when it fails

- **Before the VM exists** (steps 1 to 3 of the script): the error message
  says what's wrong, and the half-built VHDX has already been deleted.
- **VM boots but never finishes:** open the VM in Hyper-V Manager to see the
  screen. Then turn it off, mount the VHDX (`Mount-VHD`) and read:
  - `Windows\Panther\setupact.log` and `setuperr.log`;
  - `Windows\Panther\UnattendGC\setupact.log`, which has the specialize and
    oobeSystem passes and the RunSynchronous commands;
  - `Windows\Panther\unattend.xml`, the answer file exactly as written.
- **Setup finished but there's no sound over Remote Desktop:** in the VM,
  check the `fDisableCam` and `fDisableAudioCapture` values under
  `HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services` (both
  should be 0) and that the Audiosrv service is running.

### Design choices worth keeping

- **Applying the image instead of booting Setup:** a Generation 2 VM
  booting from an ISO shows "press any key to boot from CD or DVD", which
  stops an unattended install. The other fix is rebuilding the ISO with
  `efisys_noprompt.bin`, which needs `oscdimg` from the Windows ADK.
- **The answer file stays minimal:** there is no FirstLogonCommands and no
  AutoLogon, because nobody signs in at the console. All configuration after
  setup goes through PowerShell Direct, where failures show up as errors on
  the host rather than silently inside the VM.
- **Remote Desktop is enabled twice:** once in the answer file and again
  over PowerShell Direct, so a failure in either one is still covered.
- **The Remote Desktop firewall group is named by its resource string**
  (`@FirewallAPI.dll,-28752`) so it works on non-English Windows. A
  `FirewallGroups` component in the answer file was avoided because a wrong
  group name there can fail the specialize pass.

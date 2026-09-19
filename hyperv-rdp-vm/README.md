# Hyper-V Windows VM, ready for Remote Desktop

> **Status: written but never run.** It was written on a Windows 11 Home
> machine (Snapdragon X Elite, Arm64), which has no Hyper-V. Only two checks
> have been done: the PowerShell parser reports no errors, and the answer file
> it generates parses as XML. See
> [Picking this up on a Pro machine](#picking-this-up-on-a-pro-machine) for the
> test plan and the assumptions most likely to be wrong.

One script that builds a Windows virtual machine in Hyper-V with a fully
unattended install and leaves it ready to sign in to with Remote Desktop.

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
  PCs, Arm64 on Arm PCs. Both are on
  [Microsoft's Windows 11 download page](https://www.microsoft.com/software-download/windows11).
  Put it in your Downloads folder and the script finds it on its own.
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
| Address         | `Win11-RDP.mshome.net`, or an IP address     |

The sign-in is saved in Windows Credential Manager, so opening the connection
file logs you straight in. The Default Switch gives the VM a new IP address
when your PC restarts; the `mshome.net` name keeps working, and the script uses
it whenever it resolves.

The password is set never to expire, the VM never sleeps, and automatic
checkpoints are off.

## Options

| Option            | Default                | What it does                                   |
|-------------------|------------------------|------------------------------------------------|
| `-IsoPath`        | newest Windows ISO in Downloads | The Windows ISO to install from       |
| `-VMName`         | Win11-RDP              | VM name, and the computer name (15 characters) |
| `-Edition`        | Windows 11 Pro         | Edition inside the ISO. Home is refused.       |
| `-UserName`       | vmuser                 | Windows account name                           |
| `-Password`       | vmadmin                | Windows account password                       |
| `-ProcessorCount` | 4                      | Virtual processors                             |
| `-MemoryGB`       | 4                      | Starting memory; it can grow to twice this, or 8 GB |
| `-DiskGB`         | 128                    | Virtual disk size                              |
| `-SwitchName`     | Default Switch         | Hyper-V virtual switch                         |
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
   free, the switch exists, the edition isn't Home, and the ISO's
   architecture matches the host's (`Win32_Processor.Architecture`: 9 is
   x64, 12 is Arm64, the same numbers `Get-WindowsImage` uses).
3. Mounts the ISO, finds `sources\install.wim` or `install.esd`, and picks
   the index whose `ImageName` equals `-Edition`.
4. Creates a dynamic VHDX, mounts it, and initialises it as GPT. Any
   partition that `Initialize-Disk` adds is removed. It then creates a
   260 MB FAT32 partition (made as basic data so it can take a drive
   letter), a 16 MB MSR and an NTFS Windows partition.
5. Runs `Expand-WindowsImage` onto the Windows partition, then the image's
   own `bcdboot.exe /f UEFI`.
6. Writes `\Windows\Panther\unattend.xml`, which has only the `specialize`
   and `oobeSystem` passes. It then switches the first partition's GPT type
   to EFI System and dismounts everything. If this stage fails, the
   half-built VHDX is deleted.
7. Creates a Generation 2 VM with dynamic memory and automatic checkpoints
   off, boots from the hard disk first, and adds a vTPM if it can (a
   failure only prints a note).
8. Polls `Invoke-Command -VMName` (PowerShell Direct) every 15 seconds with
   `COMPUTERNAME\vmuser`. The call fails until the answer file has created
   the account. Once it gets in, it waits until `HKLM\SYSTEM\Setup` shows
   `SystemSetupInProgress` and `OOBEInProgress` at 0. The same call then
   enables RDP and its firewall group (`@FirewallAPI.dll,-28752`, which
   works in any language), sets the RDP audio policies, starts Audiosrv,
   marks the network Private and returns the VM's IPv4 address.
9. Uses `COMPUTERNAME.mshome.net` if it resolves to that IP, otherwise the
   IP. It waits for TCP 3389 to answer, then writes the `.rdp` file to the
   desktop, runs `cmdkey /generic:TERMSRV/<target>`, and launches `mstsc`.

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
   - it still reconnects after restarting the host, when the IP changes.
4. Run `.\New-HyperVRdpVM.ps1 -Remove` and confirm that the VM, VHDX, `.rdp`
   file and saved credential (`cmdkey /list`) are all gone.
5. If possible, try an `install.esd` ISO (Media Creation Tool) as well as
   an `install.wim` one, and both x64 and Arm64 hosts.

### Assumptions that haven't been checked

These are the most likely places for the first run to fail, roughly in order:

- **First-run screens:** `SkipMachineOOBE` / `SkipUserOOBE` together with
  `LocalAccounts` should create `vmuser` and skip every first-run screen on
  24H2/25H2 when Windows was applied with DISM rather than Setup. Watch the
  VM in VMConnect during the first run for any screen that stops and waits.
  A product key or region page is the most likely one. If a key page
  appears, add a `ProductKey` element to the specialize-pass Shell-Setup
  component using the generic Pro install key.
- **PowerShell Direct:** it should accept `COMPUTERNAME\vmuser` (a local
  admin that isn't the built-in Administrator) and run elevated enough to
  write HKLM and the firewall. If it keeps failing after the VM reaches the
  sign-in screen, try `.\vmuser` or plain `vmuser`, and check that the
  answer file's `ComputerName` was applied.
- **Disk layout:** `Remove-Partition` should be able to remove the MSR that
  `Initialize-Disk` may create. `Set-Partition -GptType` should work on a
  partition that still has a drive letter. The Hyper-V UEFI firmware should
  boot from `\EFI\Boot\bootx64.efi` (or `bootaa64.efi`) with no NVRAM entry.
- **Language settings:** `InputLocale` should accept a tag like `en-US`
  rather than `0409:00000409`.
- **Saved sign-in:** a credential saved with `cmdkey` from the elevated
  window should be used by `mstsc`, and `mshome.net` should resolve through
  `[Net.Dns]` on the host.
- **vTPM on Arm64:** `Set-VMKeyProtector -NewLocalKeyProtector` and
  `Enable-VMTPM` may not be supported on Arm64 client Hyper-V. Failure is
  caught and only prints a note.

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

# Hyper-V Windows VM, ready for Remote Desktop

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

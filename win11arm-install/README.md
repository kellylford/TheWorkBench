# Windows 11 ARM – Unattended Parallels Install

A single script that downloads Windows 11, creates a virtual machine in
Parallels Desktop, installs Windows completely unattended, and leaves you
at a working Windows desktop ready to use.

Designed for blind and low-vision users who want a Windows VM on an Apple
Silicon Mac without sighted assistance during setup.

---

## Who this is for

- You have a Mac with an Apple Silicon chip (M1, M2, M3, M4, or later).
- You have Parallels Desktop installed (version 18 or later recommended).
- You want a Windows 11 virtual machine without going through a long manual
  installer process.
- You use a screen reader (JAWS or NVDA on Windows, VoiceOver on Mac) and
  want to get straight to a working desktop.

---

## What you need before you start

- **Apple Silicon Mac** – the script will not run on Intel Macs.
- **Parallels Desktop** – installed and licensed. The free trial works.
- **Internet connection** – the script downloads about 5 GB of Windows files.
- **Disk space** – about 10 GB free for the download, plus 128 GB for the VM.
  The 128 GB is a thin-provisioned virtual disk; it grows as you use it and
  does not immediately consume 128 GB on your Mac.
- **Time** – the full process takes 1 to 2 hours, mostly unattended download
  and install time.

---

## Quick start – two ways to run

### Option A: Open from Finder

1. Navigate to the `win11arm-install` folder in Finder.
2. Select **Install Windows (Full).command** and press **Command+O** to open it.
3. macOS will ask if you want to open it. Confirm to proceed.
4. A Terminal window opens and the script starts. Leave it running.

If macOS says the file cannot be opened because it is from an unidentified
developer: in VoiceOver, press **CapsLock+M** (or **Control+Option+M**) on the
file to open the context menu, choose Open, then confirm in the dialog.

### Option B: Run from Terminal

Open Terminal and run:

```
cd /path/to/win11arm-install
bash install-windows-full.sh
```

Replace `/path/to/win11arm-install` with the actual folder path. If you
downloaded the zip to your Downloads folder and unzipped it, the command
would be:

```
cd ~/Downloads/win11arm-install
bash install-windows-full.sh
```

---

## What happens (nothing to do)

The script runs through these steps automatically. You do not interact with
anything after it starts.

1. **Install tools** – Homebrew and a few utilities are installed if missing.
2. **Download Windows** – Windows 11 ARM64 (25H2, the latest stable release)
   is downloaded from uupdump.net and converted to an ISO. This is the big
   download step (~5 GB) and takes 30–90 minutes depending on your connection.
3. **Create the VM** – A new virtual machine named "Windows 11 ARM (Full)" is
   created in Parallels Desktop with 8 GB RAM, 6 CPUs, and a 128 GB disk.
4. **Install Windows** – The VM boots from the ISO and Windows installs itself.
   No license key is needed (Windows 11 runs in a grace period; you can add a
   key later if you want). This takes about 10–15 minutes.
5. **Install Parallels Tools** – The Parallels guest tools are installed so the
   VM integrates well with your Mac (clipboard sharing, folder sharing, etc.).
6. **Finish** – The script prints the VM name, username, and password, and
   opens Parallels Desktop showing your new Windows desktop.

---

## Windows account details

After setup you can log in with:

| Item     | Value        |
|----------|--------------|
| Username | User         |
| Password | Parallels1!  |
| Computer | WinARM       |

---

## After setup – using a screen reader

When the script finishes, Parallels Desktop opens and shows the Windows
desktop. Windows 11 apps including Edge, Calculator, and Photos are included
in the installation and should be available as soon as setup completes.

### JAWS and NVDA

If you use **JAWS** or **NVDA**, you will need to install them inside the VM
as you would on any Windows machine. Once installed, start them as normal.

- JAWS: [https://www.freedomscientific.com/products/software/jaws/](https://www.freedomscientific.com/products/software/jaws/)
- NVDA: [https://www.nvaccess.org/download/](https://www.nvaccess.org/download/)

### Narrator (built-in)

Windows includes Narrator as a basic built-in screen reader. To start it,
press **Windows key + Control + Enter** while the Parallels window is focused.

If that shortcut does not work:

1. Press **Windows key + R** to open Run.
2. Type `narrator` and press Enter.

---

## Customising the install

You can change the defaults by setting environment variables before running
the script. Open Terminal and run something like:

```
VM_NAME="My Windows VM" \
VM_RAM=16384 \
VM_CPUS=8 \
WIN_TZ="Eastern Standard Time" \
bash install-windows-full.sh
```

| Variable     | Default         | Description                        |
|--------------|-----------------|------------------------------------|
| VM_NAME      | Windows 11 ARM (Full) | Name shown in Parallels        |
| VM_RAM       | 8192            | RAM in MB (8192 = 8 GB)            |
| VM_CPUS      | 6               | Number of virtual CPUs             |
| VM_DISK_GB   | 128             | Virtual disk size in GB            |
| WIN_USERNAME | User            | Windows account name               |
| WIN_PASSWORD | Parallels1!     | Windows account password           |
| WIN_COMPUTER | WinARM          | Windows computer name              |
| WIN_TZ       | UTC             | Windows time zone string           |

---

## Troubleshooting

**The script stops at "prlctl not found"**
Parallels Desktop is not installed or `prlctl` is not in your PATH. Install
Parallels Desktop and try again.

**The script stops at "Requires Apple Silicon"**
This script only works on M-series Macs. Intel Macs are not supported.

**macOS says the .command file cannot be opened**
In VoiceOver, press **CapsLock+M** (or **Control+Option+M**) on the file to
open the context menu, choose Open, then confirm in the security dialog.

**The VM is created but Windows never boots**
Open Parallels Desktop, find the "Windows 11 ARM (Full)" VM, and start it manually.
Check that both CD/DVD drives show an ISO attached.

**Apps (Edge, Calculator, etc.) are not showing up**
Edge and the other inbox apps are included in the ISO and should be present
immediately. If they are missing, allow the VM to remain logged in and
connected to the internet for 15–20 minutes. You can check progress in
Settings → Apps → Installed apps.

**You want to start over**
Run these commands in Terminal to remove the VM and cached files, then run
the script again:

```
prlctl stop "Windows 11 ARM (Full)" --kill 2>/dev/null
prlctl delete "Windows 11 ARM (Full)" 2>/dev/null
rm -rf ~/Downloads/win11arm-install/work/answer_full.iso
rm -rf ~/Downloads/win11arm-install/work/answer_src_full
```

The Windows ISO is cached in `work/` and will be reused so you do not have
to re-download it.

---

## Files in this package

| File                            | Purpose                              |
|---------------------------------|--------------------------------------|
| install-windows-full.sh         | The main install script              |
| Install Windows (Full).command  | Launcher – open with Command+O       |
| README.md                       | This file                            |

The `work/` folder is created when you run the script. It holds the
downloaded Windows ISO and log file. You can delete it after setup to
reclaim disk space.

---


## Acknowledgements

Windows 11 ISO is downloaded directly from Microsoft's update servers
using [UUP dump](https://uupdump.net), which assembles official update packages
into a standard ISO. No piracy is involved.

The setup key `VK7JG-NPHTM-C97JM-9MPGT-3V66T` used in the answer file is
Microsoft's own publicly documented **KMS client setup key** for Windows 11 Pro.
It is not a product key and does not activate Windows. It simply tells Windows
Setup which edition to install without prompting for a key. Activation happens
automatically afterward via your device's digital licence.
Source: [Microsoft Learn – KMS client setup keys](https://learn.microsoft.com/en-us/windows-server/get-started/kms-client-setup-keys)

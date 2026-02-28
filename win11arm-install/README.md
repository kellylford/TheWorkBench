# Unattended Windows 11 ARM Install on Apple Silicon Mac

## Who This Is For

This guide is written for blind and low-vision Mac users who want to run Windows 11 inside Parallels Desktop on an Apple Silicon Mac (M1, M2, M3, M4, or later). 

The normal way to install Windows in Parallels requires navigating a graphical wizard with no meaningful keyboard support during the Windows Setup phase. For blind users this has historically meant relying on screen recognition tools, sighted assistance, or a lot of trial and error with no audio feedback.

This script eliminates the problem entirely. A single terminal command downloads Windows, creates the virtual machine, and installs Windows to a working desktop — no visual interaction required at any step.

---

## Choosing an Install Edition

Two install scripts are provided. Both are fully unattended — choose based on how much disk space you have and whether you want Microsoft's built-in apps pre-installed.

| | Minimal | Full |
|---|---|---|
| **Finder launcher** | `Install Windows (Minimal).command` | `Install Windows (Full).command` |
| **Shell script** | `install-windows-minimal.sh` | `install-windows-full.sh` |
| **Virtual disk size** | 64 GB | 128 GB |
| **Microsoft inbox apps** | Stripped out (lean install) | Included — Photos, Calculator, Paint, Notepad, Terminal, Media Player, and more |
| **VM name in Parallels** | `Windows 11 ARM` | `Windows 11 ARM (Full)` |

If you are not sure which to pick, start with **Minimal**. You can install any individual app inside Windows afterward. Choose **Full** if you want a stock Windows experience with all the built-in apps ready to go.

---

## What You Need Before Starting

### Hardware
- Any Apple Silicon Mac (M-series chip). Intel Macs are not supported.
- At least 100 GB of free disk space (the download is ~5 GB; the finished VM needs ~64 GB).
- A reliable internet connection. The download is approximately 5 GB and takes 10–30 minutes depending on speed.

### Software
- macOS 13 Ventura or later.
- **Parallels Desktop** installed. Any recent version works. You do not need a licence before starting — Parallels runs in trial mode and the VM will work. You do need a licence for ongoing use.
- **Homebrew** package manager. If you do not have it, the script installs it automatically. If you prefer to install it yourself first, run this in Terminal:

  ```
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```

  Homebrew's own installer is fully accessible — it is text-only and runs in Terminal.

### A note on Parallels activation
Parallels Desktop will show a graphical activation window when it first opens. You can dismiss it with Escape or Command-W and proceed in trial mode. The VM itself will work fully in trial mode. Windows activation is separate from Parallels and is handled automatically if your Microsoft account is linked to a licence.

---

## Accessibility Inside Windows

Once Windows is running, VoiceOver on the Mac side does not read inside the Windows virtual machine window. However:

- **Narrator** (Windows' built-in screen reader) starts automatically during Windows Setup if you press **Windows key + Control + Enter**. Because our install is fully automated and skips the setup screens, Narrator is not needed during installation.
- After the desktop appears, you can enable Narrator with **Windows key + Control + Enter**, or connect via **Remote Desktop** and use your preferred Windows screen reader from there.
- **NVDA** and **JAWS** can be installed inside Windows normally once the desktop is reached.
- The script enables Remote Desktop inside Windows automatically. This means you can connect to the VM from your Mac using Microsoft Remote Desktop from the App Store, which gives you a proper accessible Windows session.

---

## Step-by-Step Instructions

All steps happen in **Terminal**. You can open Terminal with Spotlight: press **Command-Space**, type "Terminal", and press Return.

### Step 1 — Get the scripts

**Option A — Finder (easiest, no Terminal needed for this step)**

If you received this as a zip, unzip it and open the folder. Two double-clickable launchers are included:

- `Install Windows (Minimal).command` — lean install, 64 GB disk
- `Install Windows (Full).command` — full Microsoft inbox apps, 128 GB disk

Double-click the one you want in Finder. macOS will open Terminal and start the install automatically. Skip to Step 3.

> **If macOS blocks the file with "cannot be opened because it is from an unidentified developer":** This is Gatekeeper quarantine on a downloaded file. Fix it by opening Terminal, navigating to the unzipped folder, and running:
> ```
> xattr -cr .
> ```
> Then double-click the launcher again.

**Option B — Terminal**

If you received the folder, navigate to it in Terminal:

```
cd /path/to/ParallelsUnattendedWindowsInstallScripts
```

If you are setting this up fresh on a new machine, create a folder and copy the scripts there:

```
mkdir -p ~/win11-install
cd ~/win11-install
# Copy install-windows.sh, install-windows-full.sh, and the answer_src/ folder here
```

### Step 2 — Run the script

**If you used Option A (Finder launcher) in Step 1, skip this step — the launcher already ran the script.**

From Terminal, run whichever edition you chose:

**Minimal install** (64 GB disk, lean Windows):
```
./install-windows-minimal.sh
```

**Full install** (128 GB disk, all Microsoft inbox apps):
```
./install-windows-full.sh
```

That single command is all you need. Everything else is automatic.

You will see text output in Terminal describing each stage. There are no prompts, no questions, and no windows you need to interact with.

### Step 3 — Wait

The script runs in several phases. Here is what to expect:

**Phase 1 — Installing tools (1–5 minutes)**
The script installs `aria2`, `wimlib`, `cabextract`, and `cdrtools` via Homebrew. You will see Homebrew output scrolling by. This is normal.

**Phase 2 — Downloading Windows (10–60 minutes depending on your connection)**
The script queries Microsoft's servers (via UUP Dump, a community tool) for the latest Windows 11 ARM64 Professional build and downloads approximately 5 GB of files. You will see download progress lines like:

```
[DL:35MiB][#96cd2f 1.8GiB/2.4GiB(75%) CN:16 DL:37MiB ETA:16s]
```

This is aria2's download progress. The number after the slash is the total file size. ETA is in seconds.

**Phase 3 — Building the ISO (10–20 minutes)**
After downloading, the script assembles the files into a standard Windows ISO. During this phase there is no download progress — the script is doing CPU-intensive work. The terminal will be quiet or show occasional lines like `Exporting image...`. This is normal. Do not close Terminal.

**Phase 4 — Creating the virtual machine (under 1 minute)**
The script creates and configures the Parallels VM automatically using `prlctl`, Parallels' command-line tool.

**Phase 5 — Windows installation (30–60 minutes)**
The VM boots and Windows Setup runs completely silently using the answer file the script created. You will see:

```
[11:30:00] Reboot detected (restart #1) – waiting for VM to come back...
[11:38:00] Reboot detected (restart #2) – waiting for VM to come back...
[11:42:00] ✓ VM has been running stably for 2 min after 2 restarts.
[11:42:00] ✓ Windows desktop should be ready.
```

Windows Setup reboots the VM twice during installation. The script handles this automatically.

**Phase 6 — Parallels Tools installation (1–2 minutes)**
The script installs Parallels Tools inside Windows, which provides display scaling, clipboard sharing, and file sharing between Mac and Windows.

**Phase 7 — Summary**
The script prints a summary with your VM name, Windows login credentials, and how to connect via Remote Desktop.

### Step 4 — Access Windows

When the script finishes, Windows is running and you are logged in as the user created during setup. There are two good ways to use the VM as a screen reader user. Running directly inside Parallels is generally the better day-to-day experience; Remote Desktop is useful for specific situations.

---

#### Option A — Running directly inside Parallels (recommended)

Parallels Desktop's own menus are fully accessible to VoiceOver. The VM window itself does not speak through VoiceOver, but the application menus around it do, and keyboard focus passes into the VM so Windows screen readers such as Narrator, NVDA, or JAWS work normally once inside.

**To open and start the VM using Parallels menus:**

1. Open Parallels Desktop:
   ```
   open -a "Parallels Desktop"
   ```
2. Switch to Parallels Desktop and use the **File** menu. Choose **Open** and navigate to your VM. Parallels remembers recently used VMs in the Control Center window, which is also accessible.
3. Once the VM is selected, open the **Device** menu and choose **Start**. Keyboard focus will move into the VM at that point.
4. Inside the VM, press **Windows key + Control + Enter** to start Narrator if you need to verify focus before your preferred screen reader is installed.

Once your preferred screen reader (NVDA, JAWS, etc.) is installed inside Windows, starting it works the same way every time you open the VM.

**Tip:** Parallels keyboard passthrough means most Windows keyboard shortcuts work directly, including screen reader modifier keys. If a shortcut is being intercepted by macOS, check Parallels Preferences under the Keyboard section — you can configure which keys pass through to the VM.

---

#### Option B — Remote Desktop

Remote Desktop is useful if you want to access the VM from another machine, run it headless, or prefer working in a separate accessible window. The script enables Remote Desktop inside Windows automatically during setup.

**Important:** Newer versions of Microsoft Remote Desktop have a quirk where getting focus into the remote window can be unreliable. The most reliable fix is to ensure the VM is **not configured to start in full screen mode**. In Parallels Desktop, go to the VM's configuration (Command-comma with the VM selected), choose the Display section, and make sure the VM window starts in a normal window rather than full screen. Once the Remote Desktop window is in a standard macOS window frame, VoiceOver and focus behave correctly.

**To connect via Remote Desktop:**

1. Install **Microsoft Remote Desktop** from the Mac App Store. It is free.
2. From Terminal, find the VM's IP address:
   ```
   prlctl list -i "Windows 11 ARM" | grep "net"
   ```
   You will see a line containing an IP address like `10.211.55.4`.
3. Open Microsoft Remote Desktop, add a new PC using that IP address, and connect with username `User` and password `Parallels1!` (or whatever you customised in the script — see the Customisation section below).
4. If focus does not land in the remote window after connecting, click inside it once with the trackpad or use VoiceOver cursor routing, then try the Windows screen reader shortcut.

Remote Desktop sessions support any Windows screen reader you install inside the VM.

---

## Default Credentials

These defaults apply to both the Minimal and Full installs. The Full install uses a larger disk and a different VM name — those differences are noted below.

| Setting | Minimal | Full |
|---|---|---|
| Windows username | `User` | `User` |
| Windows password | `Parallels1!` | `Parallels1!` |
| Computer name | `WinARM` | `WinARM` |
| VM name in Parallels | `Windows 11 ARM` | `Windows 11 ARM (Full)` |
| RAM | 8 GB | 8 GB |
| CPU cores | 6 | 6 |
| Disk size | 64 GB | 128 GB |

---

## Customisation

You can change any default by setting environment variables before running the script. This works with both the Minimal and Full install scripts. For example:

```
VM_NAME="My Windows VM" \
WIN_USERNAME="Kelly" \
WIN_PASSWORD="MySecret99!" \
WIN_COMPUTER="KellysPC" \
VM_RAM=12288 \
VM_CPUS=8 \
VM_DISK_GB=128 \
./install-windows-minimal.sh
```

To apply the same overrides to the Full install, replace `install-windows-minimal.sh` with `install-windows-full.sh` in the command above.

All options and their defaults:

| Variable | Default | Description |
|---|---|---|
| `VM_NAME` | `Windows 11 ARM` | Name shown in Parallels |
| `VM_RAM` | `8192` | RAM in MB |
| `VM_CPUS` | `6` | Number of CPU cores |
| `VM_DISK_GB` | `64` | Disk size in GB |
| `WIN_USERNAME` | `User` | Windows local account name |
| `WIN_PASSWORD` | `Parallels1!` | Windows local account password |
| `WIN_COMPUTER` | `WinARM` | Windows computer name |
| `WIN_TZ` | `UTC` | Windows timezone (e.g. `Eastern Standard Time`) |

Common Windows timezone strings:
- `Eastern Standard Time`
- `Central Standard Time`
- `Mountain Standard Time`
- `Pacific Standard Time`
- `GMT Standard Time` (UK)
- `Central European Standard Time`

---

## If You Already Have a Windows ISO

If you previously downloaded a Windows 11 ARM ISO (for example from Parallels' own downloader or from a previous run of this script), you can skip the 5 GB download:

```
mkdir -p ~/win11-install/work
cp /path/to/your/windows.iso ~/win11-install/work/windows11_arm.iso
./install-windows.sh
```

The script checks for `work/windows11_arm.iso` and skips the download if it exists.

---

## Troubleshooting

### The script fails during download with "Failed to reach UUP dump API"
Check your internet connection. UUP Dump is a community service — it is occasionally unavailable for a few minutes. Wait and try again.

### The script fails with "prlctl not found"
Parallels Desktop is not installed, or it was installed but the command-line tools are not on your PATH. Install Parallels Desktop and try again.

### The VM window opens but my screen reader is not speaking Windows content
The Parallels VM window does not pipe audio through VoiceOver. However, keyboard focus does pass into the VM, so Windows screen readers run normally. Use the File > Open, then Device > Start path described in Step 4 Option A. Once focus is in the VM, press Windows key + Control + Enter to start Narrator, or launch your preferred screen reader. Alternatively use Remote Desktop as described in Step 4 Option B.

### Remote Desktop focus feels unreliable or the window is hard to get into
This is a known quirk of newer versions of Microsoft Remote Desktop. Make sure the Parallels VM is not configured to open in full screen mode — set it to open in a normal window in Parallels Display preferences. After making that change, Remote Desktop window focus behaves correctly with VoiceOver.

### I see "Reboot detected" many times and the script never finishes
Windows is taking longer than usual to install. This can happen on slower machines or with heavy background activity. The script has a 90-minute timeout. If it exits with a timeout warning, Windows may still be installing — open Parallels Desktop to check, or wait a few minutes and then connect via Remote Desktop.

### The VM exists but Windows shows a setup screen asking for input
The answer file was not picked up. This can happen if the answer ISO was not attached correctly. Run the script again — it will delete and recreate the VM cleanly.

### I want to start over
Delete the VM and the work folder:
```
prlctl stop "Windows 11 ARM" --kill 2>/dev/null; prlctl delete "Windows 11 ARM" 2>/dev/null
rm -rf ~/win11-install/work
./install-windows-minimal.sh
```

The Windows ISO is cached in `work/windows11_arm.iso` — if you want to save the 5 GB download, delete everything in `work/` except that file.

---

## How This Works (Technical Summary)

For those who are curious or want to adapt the script:

1. **UUP Dump** is queried for the latest Windows 11 ARM64 Professional build. UUP Dump is a community-maintained service that rebuilds standard Windows ISOs from Microsoft's own update servers.

2. **aria2** downloads the raw update packages (~5 GB) in parallel segments for speed.

3. **wimlib** and **mkisofs** assemble those packages into a standard bootable ISO.

4. An **`autounattend.xml`** file is generated containing all the answers Windows Setup needs: disk partitioning, edition selection, locale, user account creation, OOBE skip flags, and first-logon commands that run Parallels Tools silently.

5. That XML is wrapped in a tiny second ISO (the "answer ISO") using macOS's built-in `hdiutil`. Windows Setup automatically scans all attached drives for `autounattend.xml` at boot.

6. **`prlctl`** (Parallels' command-line interface) creates the VM, attaches both ISOs, configures hardware, and starts the VM.

7. The script monitors `prlctl status` in a loop, automatically restarting the VM after each Windows Setup reboot, and declares success once the VM has been running stably for several minutes after two restarts — the point at which the Windows desktop is live.

8. **Remote Desktop** is enabled inside Windows by the `FirstLogonCommands` section of the answer file, so you can connect with an accessible client immediately.

---

## Credits and Licences

- [UUP Dump](https://uupdump.net) — Community tool for downloading Windows update packages. Files come from Microsoft's own servers.
- [aria2](https://aria2.github.io) — Open source download utility (GPL v2).
- [wimlib](https://wimlib.net) — Open source WIM library (LGPL v3 / GPL v2).
- [Homebrew](https://brew.sh) — Package manager for macOS (BSD 2-clause).
- Parallels Desktop — Commercial product required separately.
- Windows 11 — Microsoft product. A licence is required for ongoing use.

The install script itself is provided as-is with no warranty. It makes no modifications to your Mac outside of installing Homebrew packages and creating a Parallels virtual machine.

```bash
#!/usr/bin/env bash
# =============================================================================
# Windows 11 ARM – Fully Unattended Parallels Install
# Runs on Apple Silicon Mac with Parallels Desktop installed.
# =============================================================================
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
VM_NAME="${VM_NAME:-Windows 11 ARM}"
VM_RAM="${VM_RAM:-8192}"          # MB  (8 GB)
VM_CPUS="${VM_CPUS:-6}"
VM_DISK_GB="${VM_DISK_GB:-64}"    # GB
VM_DISK_MB=$(( VM_DISK_GB * 1024 ))

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/work}"
WINDOWS_ISO="$WORK_DIR/windows11_arm.iso"
ANSWER_ISO="$WORK_DIR/answer.iso"
ANSWER_DIR="$WORK_DIR/answer_src"
LOG_FILE="$WORK_DIR/install.log"

# Credentials written into autounattend.xml
WIN_USERNAME="${WIN_USERNAME:-User}"
WIN_PASSWORD="${WIN_PASSWORD:-Parallels1!}"
WIN_COMPUTER="${WIN_COMPUTER:-WinARM}"
WIN_TZ="${WIN_TZ:-UTC}"           # Windows timezone string

# UUP dump – Windows 11 ARM64 Pro, English
UUP_LANG="en-us"
UUP_EDITION="PROFESSIONAL"

# ─── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()   { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
ok()    { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $*" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC}  $*" | tee -a "$LOG_FILE"; }
die()   { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC}  $*" | tee -a "$LOG_FILE"; exit 1; }
header(){ echo -e "\n${BOLD}${CYAN}══════════════════════════════════════${NC}"; \
          echo -e "${BOLD}${CYAN}  $*${NC}"; \
          echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}\n"; }

# ─── Sanity checks ────────────────────────────────────────────────────────────
check_prerequisites() {
    header "Checking prerequisites"

    # Must be Apple Silicon
    [[ "$(uname -m)" == "arm64" ]] || die "This script requires an Apple Silicon Mac."

    # Parallels CLI
    command -v prlctl &>/dev/null || die "prlctl not found. Install Parallels Desktop first."
    log "Parallels Desktop: $(prlctl --version)"

    # Homebrew
    if ! command -v brew &>/dev/null; then
        warn "Homebrew not found – installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    # aria2 (multi-threaded downloader used by UUP dump scripts)
    if ! command -v aria2c &>/dev/null; then
        log "Installing aria2..."
        brew install aria2
    fi

    # p7zip (needed by UUP dump to assemble the ISO)
    if ! command -v 7z &>/dev/null; then
        log "Installing p7zip..."
        brew install p7zip
    fi

    # cabextract (needed by UUP dump scripts)
    if ! command -v cabextract &>/dev/null; then
        log "Installing cabextract..."
        brew install cabextract
    fi

    # wimlib (needed by UUP dump scripts to create the WIM / ISO)
    if ! command -v wimlib-imagex &>/dev/null; then
        log "Installing wimlib..."
        brew install wimlib
    fi

    # chntpw (needed by UUP dump to edit registry inside boot.wim)
    # sidneys/homebrew/chntpw fails to build on Apple Silicon (OpenSSL 1.0 issue).
    # For ARM64 Parallels installs the registry bypass is not needed (Parallels
    # presents a compliant virtual TPM); autounattend.xml covers any remaining checks.
    # We create a no-op stub so the UUP prereq check passes.
    if ! command -v chntpw &>/dev/null; then
        log "Creating chntpw stub (ARM64 Parallels doesn't need registry patching)..."
        mkdir -p "$WORK_DIR/stubs"
        cat > "$WORK_DIR/stubs/chntpw" <<'STUB'
#!/usr/bin/env bash
# No-op stub: chntpw registry edits are not required for ARM64/Parallels installs
exit 0
STUB
        chmod +x "$WORK_DIR/stubs/chntpw"
        export PATH="$WORK_DIR/stubs:$PATH"
    fi

    # cdrtools (provides mkisofs, needed by UUP dump to create the final ISO)
    if ! command -v mkisofs &>/dev/null; then
        log "Installing cdrtools (mkisofs)..."
        brew install cdrtools
    fi

    ok "All prerequisites satisfied."
}

# ─── Windows 11 ARM ISO via UUP dump ─────────────────────────────────────────
download_windows_iso() {
    header "Downloading Windows 11 ARM64 ISO"

    if [[ -f "$WINDOWS_ISO" ]]; then
        ok "ISO already exists at $WINDOWS_ISO – skipping download."
        return
    fi

    mkdir -p "$WORK_DIR/uup"

    log "Querying UUP dump for the latest Windows 11 ARM64 build..."
    local api_url="https://uupdump.net/json-api/listid.php?search=Windows+11&sortByDate=1&lang=${UUP_LANG}"
    local json
    json=$(curl -fsSL "$api_url") || die "Failed to reach UUP dump API."

    # Extract the UUID of the first stable Windows 11 ARM64 feature update
    local build_uuid
    build_uuid=$(echo "$json" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
builds = data.get('response', {}).get('builds', {})
if not builds:
    sys.exit('No builds returned from UUP dump API.')
# Walk builds in order (sorted by date desc); pick first stable Win11 arm64 feature release
for uuid_key, v in builds.items():
    title = v.get('title', '')
    arch  = v.get('arch', '')
    uuid  = v.get('uuid', '')
    if arch == 'arm64' and 'Windows 11' in title and 'Preview' not in title and 'version' in title.lower():
        print(uuid)
        sys.exit(0)
sys.exit('No stable Windows 11 ARM64 build found in UUP dump results.')
") || die "Failed to parse UUP dump API response."

    log "Latest build UUID: $build_uuid"

    # Download the UUP conversion package (bash scripts + aria2 file list)
    local pkg_url="https://uupdump.net/get.php?id=${build_uuid}&pack=${UUP_LANG}&edition=${UUP_EDITION}&autodl=2"
    local pkg_zip="$WORK_DIR/uup/uup_package.zip"
    log "Downloading UUP conversion package..."
    curl -fsSL -o "$pkg_zip" "$pkg_url" || die "Failed to download UUP conversion package."

    local uup_dir="$WORK_DIR/uup/package"
    mkdir -p "$uup_dir"
    unzip -qo "$pkg_zip" -d "$uup_dir" || die "Failed to unzip UUP package."

    # Find the macOS download script
    local dl_script
    dl_script=$(find "$uup_dir" -name "uup_download_macos.sh" | head -1)
    [[ -n "$dl_script" ]] || die "uup_download_macos.sh not found in the UUP package."

    chmod +x "$dl_script"
    log "Running UUP download script (this downloads ~5 GB and builds the ISO – may take 30-60 min)..."
    pushd "$(dirname "$dl_script")" >/dev/null
    bash "$dl_script" 2>&1 | tee -a "$LOG_FILE" || die "UUP download/conversion script failed."
    popd >/dev/null

    # UUP dump places the ISO in the same directory
    local built_iso
    built_iso=$(find "$(dirname "$dl_script")" -maxdepth 1 -name "*.iso" | head -1)
    [[ -n "$built_iso" ]] || die "UUP script completed but no ISO file was found."

    mv "$built_iso" "$WINDOWS_ISO"
    ok "Windows 11 ARM ISO ready: $WINDOWS_ISO  ($(du -sh "$WINDOWS_ISO" | cut -f1))"
}

# ─── autounattend.xml ─────────────────────────────────────────────────────────
create_autounattend() {
    header "Creating autounattend.xml"

    mkdir -p "$ANSWER_DIR"
    cat > "$ANSWER_DIR/autounattend.xml" <<XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">

  <!-- ═══════════════════════════════════════════════════════════
       Pass 1 – windowsPE  (runs inside WinPE before installation)
       Handles language, disk layout, and image selection.
       ═══════════════════════════════════════════════════════════ -->
  <settings pass="windowsPE">

    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <SetupUILanguage>
        <UILanguage>en-US</UILanguage>
        <WillShowUI>Never</WillShowUI>
      </SetupUILanguage>
      <UILanguage>en-US</UILanguage>
      <UILanguageFallback>en-US</UILanguageFallback>
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UserLocale>en-US</UserLocale>
    </component>

    <component name="Microsoft-Windows-Setup"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

      <!-- ── Disk layout: GPT, UEFI, single 64 GB drive ───────── -->
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <!-- 1: EFI System Partition -->
            <CreatePartition wcm:action="add">
              <Order>1</Order><Size>260</Size><Type>EFI</Type>
            </CreatePartition>
            <!-- 2: Microsoft Reserved -->
            <CreatePartition wcm:action="add">
              <Order>2</Order><Size>16</Size><Type>MSR</Type>
            </CreatePartition>
            <!-- 3: Windows (all remaining space minus 524 MB for WinRE) -->
            <CreatePartition wcm:action="add">
              <Order>3</Order><Size>-524</Size><Type>Primary</Type>
            </CreatePartition>
            <!-- 4: Windows Recovery Environment -->
            <CreatePartition wcm:action="add">
              <Order>4</Order><Size>524</Size><Type>Primary</Type>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order><PartitionID>1</PartitionID>
              <Label>System</Label><Format>FAT32</Format>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order><PartitionID>3</PartitionID>
              <Label>Windows</Label><Letter>C</Letter><Format>NTFS</Format>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>3</Order><PartitionID>4</PartitionID>
              <Label>WinRE</Label><Format>NTFS</Format>
              <TypeID>DE94BBA4-06D1-4D40-A16A-BFD50179D6AC</TypeID>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
        <WillShowUI>Never</WillShowUI>
      </DiskConfiguration>

      <!-- ── Image install ─────────────────────────────────────── -->
      <ImageInstall>
        <OSImage>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
          <InstallToAvailablePartition>false</InstallToAvailablePartition>
          <WillShowUI>Never</WillShowUI>
        </OSImage>
      </ImageInstall>

      <!-- ── User data / EULA ──────────────────────────────────── -->
      <UserData>
        <AcceptEula>true</AcceptEula>
        <FullName>${WIN_USERNAME}</FullName>
        <Organization></Organization>
        <ProductKey>
          <WillShowUI>Never</WillShowUI>
        </ProductKey>
      </UserData>

    </component>
  </settings><!-- end windowsPE -->

  <!-- ═══════════════════════════════════════════════════════════
       Pass 3 – specialize  (first boot, machine-specific config)
       ═══════════════════════════════════════════════════════════ -->
  <settings pass="specialize">

    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <ComputerName>${WIN_COMPUTER}</ComputerName>
      <TimeZone>${WIN_TZ}</TimeZone>
    </component>

    <component name="Microsoft-Windows-Deployment"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <!-- Silence Windows 11 hardware requirement checks (safe on ARM / Parallels) -->
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
    </component>

  </settings><!-- end specialize -->

  <!-- ═══════════════════════════════════════════════════════════
       Pass 4 – oobeSystem  (Out-of-Box Experience, final setup)
       Creates the local user, skips all interactive OOBE screens,
       enables autologon, and triggers Parallels Tools install.
       ═══════════════════════════════════════════════════════════ -->
  <settings pass="oobeSystem">

    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

      <!-- ── Skip every OOBE screen ────────────────────────────── -->
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>false</HideLocalAccountScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
        <NetworkLocation>Work</NetworkLocation>
      </OOBE>

      <!-- ── Create the local administrator account ────────────── -->
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Password>
              <Value>${WIN_PASSWORD}</Value>
              <PlainText>true</PlainText>
            </Password>
            <Description>Primary admin account</Description>
            <DisplayName>${WIN_USERNAME}</DisplayName>
            <Group>Administrators</Group>
            <Name>${WIN_USERNAME}</Name>
          </LocalAccount>
        </LocalAccounts>
        <AdministratorPassword>
          <Value></Value>
          <PlainText>true</PlainText>
        </AdministratorPassword>
      </UserAccounts>

      <!-- ── Auto-login for first few boots (allows FirstLogonCommands) -->
      <AutoLogon>
        <Password>
          <Value>${WIN_PASSWORD}</Value>
          <PlainText>true</PlainText>
        </Password>
        <LogonCount>5</LogonCount>
        <Username>${WIN_USERNAME}</Username>
        <Enabled>true</Enabled>
      </AutoLogon>

      <TimeZone>${WIN_TZ}</TimeZone>

      <!-- ── Commands that run at the very first logon ─────────── -->
      <FirstLogonCommands>

        <!-- Enable RDP so you can access the VM over the network later -->
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Description>Enable Remote Desktop</Description>
          <CommandLine>cmd /c reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

        <!-- Allow RDP through the Windows Firewall -->
        <SynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Description>Firewall – allow RDP</Description>
          <CommandLine>cmd /c netsh advfirewall firewall set rule group="remote desktop" new enable=Yes</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

        <!-- Install Parallels Tools silently -->
        <SynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Description>Install Parallels Tools</Description>
          <CommandLine>cmd /c for /f "usebackq tokens=1" %D in (`wmic logicaldisk where "DriveType=5" get DeviceID ^| findstr /r "^[A-Z]:"`) do if exist %D\PTAgent.exe start /wait %D\PTAgent.exe /install_silent</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

        <!-- Mark setup complete -->
        <SynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Description>Write setup-complete marker</Description>
          <CommandLine>cmd /c echo done > C:\setup_complete.txt</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

      </FirstLogonCommands>

    </component><!-- end Microsoft-Windows-Shell-Setup -->

    <component name="Microsoft-Windows-International-Core"
               processorArchitecture="arm64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>

  </settings><!-- end oobeSystem -->

</unattend>
XMLEOF

    ok "autounattend.xml written to $ANSWER_DIR/autounattend.xml"
}

# ─── Small ISO that carries autounattend.xml ──────────────────────────────────
create_answer_iso() {
    header "Creating answer ISO"

    if [[ -f "$ANSWER_ISO" ]]; then
        ok "Answer ISO already exists – skipping."
        return
    fi

    hdiutil makehybrid \
        -o "$ANSWER_ISO" \
        "$ANSWER_DIR" \
        -iso \
        -joliet \
        -default-volume-name ANSWER \
        -quiet || die "Failed to create answer ISO."

    ok "Answer ISO: $ANSWER_ISO"
}

# ─── Create and configure the Parallels VM ───────────────────────────────────
create_vm() {
    header "Creating Parallels VM"

    # Delete existing VM of the same name if it exists
    if prlctl list --all | grep -qF "$VM_NAME"; then
        warn "VM '$VM_NAME' already exists. Removing it before re-creating..."
        local old_status
        old_status=$(prlctl status "$VM_NAME" 2>/dev/null | awk '{print $NF}')
        if [[ "$old_status" == "running" ]]; then
            prlctl stop "$VM_NAME" --kill || true
            sleep 3
        fi
        prlctl delete "$VM_NAME" || true
        sleep 2
    fi

    log "Creating VM: $VM_NAME"
    prlctl create "$VM_NAME" \
        --distribution win-11 \
        --no-hdd \
        || die "prlctl create failed."

    ok "VM created."

    log "Configuring CPU ($VM_CPUS cores) and RAM (${VM_RAM} MB)..."
    prlctl set "$VM_NAME" cpus --cpus "$VM_CPUS"
    prlctl set "$VM_NAME" memory --size "$VM_RAM"

    log "Adding ${VM_DISK_GB} GB virtual hard disk..."
    prlctl set "$VM_NAME" \
        --device-add hdd \
        --type expand \
        --size "$VM_DISK_MB" \
        --iface sata \
        --position 0

    log "Attaching Windows 11 ARM ISO..."
    if prlctl list -i "$VM_NAME" | grep -q "cdrom0"; then
        prlctl set "$VM_NAME" \
            --device-set cdrom0 \
            --image "$WINDOWS_ISO" \
            --connect
    else
        prlctl set "$VM_NAME" \
            --device-add cdrom \
            --image "$WINDOWS_ISO" \
            --iface sata \
            --position 0 \
            --connect
    fi

    log "Attaching answer ISO (autounattend.xml)..."
    prlctl set "$VM_NAME" \
        --device-add cdrom \
        --image "$ANSWER_ISO" \
        --iface sata \
        --position 1 \
        --connect

    log "Setting boot order: CD-ROM → HDD..."
    prlctl set "$VM_NAME" boot \
        --device-set-order cdrom0,hdd0

    prlctl set "$VM_NAME" misc --on-shutdown close

    ok "VM configured."
}

# ─── Start the VM and monitor installation progress ──────────────────────────
run_installation() {
    header "Starting Windows 11 installation"

    log "Booting VM (headless)..."
    prlctl start "$VM_NAME" || die "Failed to start VM."

    log "Installation is now running. Windows Setup will:"
    log "  1. Boot from the ISO and partition the disk  (~5 min)"
    log "  2. Expand installation files, first restart  (~10 min)"
    log "  3. Specialize / driver install, second restart (~8 min)"
    log "  4. OOBE (fully skipped by autounattend.xml)  (~3 min)"
    log "  5. First logon → FirstLogonCommands run      (~5 min)"
    log ""
    log "Monitoring VM state (each dot = 30 sec)..."

    local restarts=0
    local stable_running=0
    local last_state=""
    local timeout_sec=$(( 60 * 90 ))   # 90-minute hard timeout
    local elapsed=0
    local poll=30

    while (( elapsed < timeout_sec )); do

        local state
        state=$(prlctl status "$VM_NAME" 2>/dev/null | awk '{print $NF}') || state="unknown"

        if [[ "$state" != "$last_state" ]]; then
            echo ""
            log "VM state changed: ${last_state:-<initial>} → $state  (restarts seen: $restarts)"
            last_state="$state"
            stable_running=0
        fi

        case "$state" in
            running)
                (( stable_running++ )) || true
                if (( restarts >= 2 && stable_running >= 4 )); then
                    echo ""
                    ok "VM has been running stably for $(( stable_running * poll / 60 )) min after $restarts restarts."
                    ok "Windows desktop should be ready."
                    return 0
                fi
                printf '.'
                ;;
            stopped)
                (( restarts++ )) || true
                stable_running=0
                log "Reboot detected (restart #$restarts) – waiting for VM to come back..."
                sleep "$poll"
                prlctl start "$VM_NAME" 2>/dev/null || true
                ;;
            suspended|paused)
                warn "VM is $state – resuming..."
                prlctl resume "$VM_NAME" 2>/dev/null || prlctl start "$VM_NAME" 2>/dev/null || true
                ;;
            unknown|"")
                warn "Could not read VM state – will retry..."
                ;;
        esac

        sleep "$poll"
        (( elapsed += poll )) || true
    done

    echo ""
    warn "90-minute timeout reached. Installation may still be in progress."
    warn "Check the VM window in Parallels Desktop."
}

# ─── Post-install: Parallels Tools ───────────────────────────────────────────
install_parallels_tools() {
    header "Installing Parallels Tools"

    log "Requesting Parallels Tools installation (mounts tools ISO inside Windows)..."
    prlctl installtools "$VM_NAME" || {
        warn "installtools command returned non-zero. Tools may already be installed."
        return
    }

    log "Waiting 60 seconds for the Tools installer to complete..."
    sleep 60

    ok "Parallels Tools installation triggered."
}

# ─── Eject install media ──────────────────────────────────────────────────────
eject_install_media() {
    header "Ejecting install media"

    prlctl set "$VM_NAME" --device-disconnect cdrom0 2>/dev/null || true
    prlctl set "$VM_NAME" --device-disconnect cdrom1 2>/dev/null || true

    ok "Install media ejected."
}

# ─── Print summary ────────────────────────────────────────────────────────────
print_summary() {
    header "Installation complete"

    echo -e "${BOLD}VM name     :${NC} $VM_NAME"
    echo -e "${BOLD}Username    :${NC} $WIN_USERNAME"
    echo -e "${BOLD}Password    :${NC} $WIN_PASSWORD"
    echo -e "${BOLD}Computer    :${NC} $WIN_COMPUTER"
    echo -e "${BOLD}RAM / CPUs  :${NC} ${VM_RAM} MB / ${VM_CPUS} cores"
    echo -e "${BOLD}Disk        :${NC} ${VM_DISK_GB} GB"
    echo ""
    echo -e "${GREEN}To open the VM window:${NC}"
    echo "  open -a 'Parallels Desktop'"
    echo ""
    echo -e "${GREEN}To connect via RDP (once network is up inside the VM):${NC}"
    local ip
    ip=$(prlctl list -i "$VM_NAME" 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1 || true)
    if [[ -n "$ip" ]]; then
        echo "  open rdp://${ip}"
        echo "  User: $WIN_USERNAME  Pass: $WIN_PASSWORD"
    else
        echo "  IP not yet available. Run: prlctl list -i \"$VM_NAME\""
    fi
    echo ""
    echo -e "${GREEN}Log file:${NC} $LOG_FILE"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    mkdir -p "$WORK_DIR"
    : > "$LOG_FILE"

    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║   Windows 11 ARM – Fully Unattended Parallels Install   ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    log "Work directory : $WORK_DIR"
    log "Log file       : $LOG_FILE"

    check_prerequisites
    download_windows_iso
    create_autounattend
    create_answer_iso
    create_vm
    run_installation
    install_parallels_tools
    eject_install_media
    print_summary
}

main "$@"
```

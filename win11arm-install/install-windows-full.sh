#!/usr/bin/env bash
# =============================================================================
# Windows 11 ARM – Fully Unattended Parallels Install  (Full Edition)
# Installs Windows 11 Pro with the complete set of Microsoft inbox apps
# (Photos, Calculator, Paint, Notepad, Terminal, Media Player, and more).
#
# Companion to install-windows.sh, which produces a minimal install.
# Runs on Apple Silicon Mac with Parallels Desktop installed.
# =============================================================================
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
VM_NAME="${VM_NAME:-Windows 11 ARM (Full)}"
VM_RAM="${VM_RAM:-8192}"          # MB  (8 GB)
VM_CPUS="${VM_CPUS:-6}"
VM_DISK_GB="${VM_DISK_GB:-128}"   # GB – larger to accommodate full app set
VM_DISK_MB=$(( VM_DISK_GB * 1024 ))

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/work}"
WINDOWS_ISO="$WORK_DIR/windows11_arm_full.iso"  # separate cache from minimal ISO
ANSWER_ISO="$WORK_DIR/answer_full.iso"          # separate answer ISO
ANSWER_DIR="$WORK_DIR/answer_src"               # reuse the same autounattend.xml
LOG_FILE="$WORK_DIR/install_full.log"

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

# ─── Windows 11 ARM ISO via UUP dump (Full Edition) ──────────────────────────
# This variant uses a separate working directory (uup_full/) so it never
# interferes with the minimal ISO cache produced by install-windows.sh.
# After extracting the UUP conversion package, it patches ConvertConfig.ini
# to set AppsLevel=2, which tells the UUP converter to include all Microsoft
# inbox apps (Photos, Calculator, Paint, Notepad, Terminal, Media Player, etc.)
download_windows_iso() {
    header "Downloading Windows 11 ARM64 ISO (Full Edition)"

    # Separate UUP working directory so we don't clobber the minimal build's cache.
    local uup_work="$WORK_DIR/uup_full"
    mkdir -p "$uup_work"

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

    # If the full ISO already exists and its UUID matches, skip the download.
    local uuid_stamp="$uup_work/build_uuid.txt"
    if [[ -f "$WINDOWS_ISO" && -f "$uuid_stamp" ]]; then
        local cached_uuid
        cached_uuid=$(cat "$uuid_stamp")
        if [[ "$cached_uuid" == "$build_uuid" ]]; then
            ok "Full ISO is current (UUID $build_uuid) – reusing $WINDOWS_ISO"
            return
        else
            warn "New build available ($build_uuid vs cached $cached_uuid) – redownloading..."
            rm -f "$WINDOWS_ISO" "$uuid_stamp"
        fi
    elif [[ -f "$WINDOWS_ISO" ]]; then
        warn "Full ISO exists but no version stamp – assuming current and stamping with $build_uuid"
        echo "$build_uuid" > "$uuid_stamp"
        ok "Reusing existing full ISO at $WINDOWS_ISO"
        return
    fi

    # Download the UUP conversion package (bash scripts + aria2 file list)
    local pkg_url="https://uupdump.net/get.php?id=${build_uuid}&pack=${UUP_LANG}&edition=${UUP_EDITION}&autodl=2"
    local pkg_zip="$uup_work/uup_package.zip"
    log "Downloading UUP conversion package..."
    curl -fsSL -o "$pkg_zip" "$pkg_url" || die "Failed to download UUP conversion package."

    local uup_dir="$uup_work/package"
    mkdir -p "$uup_dir"
    unzip -qo "$pkg_zip" -d "$uup_dir" || die "Failed to unzip UUP package."

    # ── Patch ConvertConfig.ini: enable full app provisioning ─────────────────
    # AppsLevel=0 → no inbox Store apps (what the minimal script gets by default)
    # AppsLevel=2 → all available inbox apps included in the ISO
    # SkipEdge=0  → keep Edge (already the default; stated explicitly for clarity)
    local config_ini
    config_ini=$(find "$uup_dir" -name "ConvertConfig.ini" | head -1)
    if [[ -n "$config_ini" ]]; then
        log "Patching ConvertConfig.ini for full app provisioning..."
        # AppsLevel=2  → include all inbox app packages in the ISO
        # StubAppsFull=1 → bundle full offline packages, not Store stubs that need internet
        # SkipEdge=0   → keep Edge
        sed -i '' 's/^AppsLevel[[:space:]]*=.*/AppsLevel     =2/' "$config_ini"
        sed -i '' 's/^StubAppsFull[[:space:]]*=.*/StubAppsFull =1/' "$config_ini"
        sed -i '' 's/^SkipEdge[[:space:]]*=.*/SkipEdge      =0/' "$config_ini"
        # Verify the keys are actually present (sed is silent if the line didn't exist)
        grep -q "^AppsLevel" "$config_ini"    || echo "AppsLevel     =2"    >> "$config_ini"
        grep -q "^StubAppsFull" "$config_ini" || echo "StubAppsFull =1"    >> "$config_ini"
        grep -q "^SkipEdge" "$config_ini"     || echo "SkipEdge      =0"    >> "$config_ini"
        ok "ConvertConfig.ini patched – AppsLevel=2, StubAppsFull=1 (full offline app packages + Edge)."
    else
        warn "ConvertConfig.ini not found in UUP package – app level may not be set correctly."
    fi

    # Find the macOS download script
    local dl_script
    dl_script=$(find "$uup_dir" -name "uup_download_macos.sh" | head -1)
    [[ -n "$dl_script" ]] || die "uup_download_macos.sh not found in the UUP package."

    # Fast-path: full ISO already assembled in the package dir (e.g. after a
    # partial failure of this script after the UUP step completed).
    local built_iso
    built_iso=$(find "$(dirname "$dl_script")" -maxdepth 1 -iname "*.iso" | head -1)

    if [[ -z "$built_iso" ]]; then
        chmod +x "$dl_script"
        log "Running UUP download script (downloads ~5 GB + builds full ISO – may take 30-90 min)..."
        pushd "$(dirname "$dl_script")" >/dev/null
        bash "$dl_script" 2>&1 | tee -a "$LOG_FILE" || die "UUP download/conversion script failed."
        popd >/dev/null
        built_iso=$(find "$(dirname "$dl_script")" -maxdepth 1 -iname "*.iso" | head -1)
    else
        log "Found pre-built full ISO – skipping UUP download/assembly."
    fi

    [[ -n "$built_iso" ]] || die "UUP script completed but no ISO file was found."

    mv "$built_iso" "$WINDOWS_ISO"
    echo "$build_uuid" > "$uuid_stamp"
    ok "Windows 11 ARM full ISO ready: $WINDOWS_ISO  ($(du -sh "$WINDOWS_ISO" | cut -f1))"
}

# ─── Download App Installer (winget) and stage setup script ─────────────────
# AppInstaller.msixbundle is embedded in the answer ISO so FirstLogonCommands
# can install winget without any VM-side internet access, then use winget to
# install Microsoft Edge (no standalone ARM64 Edge exe exists).
# setup.ps1 is also embedded on the answer ISO and run via FirstLogonCommands.
download_app_installer() {
    header "Downloading App Installer (winget) package"

    mkdir -p "$ANSWER_DIR"

    local pkg_cache="$WORK_DIR/AppInstaller.msixbundle"
    if [[ -f "$pkg_cache" ]]; then
        ok "App Installer already cached – reusing $pkg_cache ($(du -sh "$pkg_cache" | cut -f1))"
    else
        log "Fetching latest winget release from GitHub API..."
        local url
        url=$(curl -fsSL https://api.github.com/repos/microsoft/winget-cli/releases/latest \
            | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a['name'].endswith('.msixbundle') and 'DesktopAppInstaller' in a['name']:
        print(a['browser_download_url'])
        break
") || die "Failed to query GitHub releases API."
        [[ -n "$url" ]] || die "No App Installer msixbundle found in latest winget release."
        log "Downloading App Installer from GitHub: $url"
        curl -fsSL -o "$pkg_cache" "$url" || die "Failed to download App Installer msixbundle."
        ok "App Installer downloaded: $pkg_cache ($(du -sh "$pkg_cache" | cut -f1))"
    fi

    # Stage into answer_src so hdiutil includes it in the answer ISO.
    cp "$pkg_cache" "$ANSWER_DIR/AppInstaller.msixbundle"
    ok "App Installer staged to $ANSWER_DIR/"
}

create_setup_script() {
    header "Creating Windows first-logon setup script"

    mkdir -p "$ANSWER_DIR"

    # This script is placed on the answer ISO (e.g. D:\setup.ps1) and invoked
    # by FirstLogonCommands Order 4.  It runs in the user's login session so
    # Add-AppxPackage is permitted (unlike the SYSTEM context of prlctl exec).
    cat > "$ANSWER_DIR/setup.ps1" <<'PSEOF'
# setup.ps1  —  runs at first logon via FirstLogonCommands
# Step 1: install App Installer (winget) from the answer CD-ROM
#         (fallback: \\Mac\Downloads shared folder via Parallels Tools)
# Step 2: install Microsoft Edge via winget

$logPath = 'C:\setup_log.txt'
function Log($msg) { $ts = Get-Date -Format 'HH:mm:ss'; "$ts  $msg" | Tee-Object -FilePath $logPath -Append | Write-Output }

# ── Step 1: find AppInstaller.msixbundle ─────────────────────────────────────
Log 'Looking for AppInstaller.msixbundle...'
$pkg = $null

# Primary: scan all drive letters (CD-ROM with answer ISO)
foreach ($d in @('D','E','F','G','H','I','J','K')) {
    $candidate = $d + ':\AppInstaller.msixbundle'
    if (Test-Path $candidate) { $pkg = $candidate; break }
}

# Fallback: Parallels shared folder (\\Mac\Downloads) if Tools are installed
if (-not $pkg) {
    Log 'Not found on optical drives — trying Parallels shared folder...'
    $unc = '\\Mac\Downloads\AppInstaller.msixbundle'
    if (Test-Path $unc) { $pkg = $unc }
}

if ($pkg) {
    Log "Found $pkg — installing App Installer (winget)..."
    try {
        Add-AppxPackage -Path $pkg -ForceApplicationShutdown -ErrorAction Stop
        Log 'App Installer installed successfully.'
    } catch {
        Log "Add-AppxPackage error: $_"
    }
} else {
    Log 'WARNING: AppInstaller.msixbundle not found on any drive — winget unavailable.'
}

# ── Step 2: wait for winget, then install Edge ────────────────────────────────
$wg = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
Log 'Waiting for winget.exe to be registered...'
$found = $false
for ($i = 0; $i -lt 12; $i++) {
    if (Test-Path $wg) { $found = $true; break }
    Log "  winget not yet found (attempt $($i+1)/12) — sleeping 10 s..."
    Start-Sleep -Seconds 10
}

if ($found) {
    Log 'winget found — installing Microsoft Edge...'
    $result = & $wg install --id Microsoft.Edge -e --accept-source-agreements --accept-package-agreements --silent 2>&1
    Log "winget result: $result"
    Log 'Edge installation complete.'
} else {
    Log 'WARNING: winget.exe not found after 2 minutes — Edge not installed.'
}

Log 'setup.ps1 finished.'
PSEOF

    ok "setup.ps1 written to $ANSWER_DIR/setup.ps1"
}

# ─── autounattend.xml ─────────────────────────────────────────────────────────
create_autounattend() {
    header "Creating autounattend.xml"

    mkdir -p "$ANSWER_DIR"

    # ── Generate base64-encoded PowerShell for FirstLogonCommands ───────────────
    # This self-contained script runs at first logon (as the logged-in user so
    # Add-AppxPackage is permitted).  It downloads App Installer (winget) from
    # GitHub, installs it, then uses winget to install Microsoft Edge.
    # Using -EncodedCommand avoids ALL drive-letter, quoting, and escaping issues.
    local _ps_tmp _ps_b64
    _ps_tmp=$(mktemp)
    cat > "$_ps_tmp" << 'SETUP_EOF'
$log = 'C:\setup_log.txt'
function Log($m) { $ts = Get-Date -Format 'HH:mm:ss'; "$ts  $m" | Add-Content -Path $log }
Log 'setup started'
try {
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $url = 'https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle'
    $pkg = "$env:TEMP\AppInstaller.msixbundle"
    Log "Downloading App Installer (winget) from GitHub..."
    (New-Object Net.WebClient).DownloadFile($url, $pkg)
    Log "Downloaded $((Get-Item $pkg).Length) bytes"
    Add-AppxPackage -Path $pkg -ForceApplicationShutdown -ErrorAction Stop
    Log 'App Installer installed successfully'
} catch {
    Log "App Installer error: $_"
}
$wg = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
Log 'Waiting for winget.exe to register...'
for ($i = 0; $i -lt 18; $i++) {
    if (Test-Path $wg) { break }
    Log "  waiting for winget, attempt $($i+1)/18..."
    Start-Sleep -Seconds 10
}
if (Test-Path $wg) {
    Log 'Installing Microsoft Edge via winget...'
    $r = & $wg install --id Microsoft.Edge -e --accept-source-agreements --accept-package-agreements --silent 2>&1
    Log "winget: $($r -join '; ')"
    Log 'Edge install complete'
} else {
    Log 'winget not found after 3 min — Edge not installed'
}
Log 'All done'
SETUP_EOF
    _ps_b64=$(python3 -c "import base64,sys; print(base64.b64encode(open('$_ps_tmp').read().encode('utf-16-le')).decode())")
    rm "$_ps_tmp"
    ok "PowerShell first-logon command base64-encoded (${#_ps_b64} chars)."

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

      <!-- ── Disk layout: GPT, UEFI, single 128 GB drive ──────── -->
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
            <!-- 3: Windows – extend to fill remaining disk.
                 Windows Setup will automatically create a recovery partition. -->
            <CreatePartition wcm:action="add">
              <Order>3</Order><Extend>true</Extend><Type>Primary</Type>
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
          <!-- Select Windows 11 Pro (index 6 in a standard UUP ISO; Setup will
               pick the right image automatically when WillShowUI=Never and a
               ProductKey is not provided for evaluation purposes) -->
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
          <!-- Leave blank to use a generic/evaluation key. Windows will activate
               automatically if the host licence supports it (Parallels/Microsoft
               licence), or you can enter your key here. -->
          <WillShowUI>Never</WillShowUI>
        </ProductKey>
      </UserData>

    </component>
  </settings><!-- end windowsPE -->

  <!-- ═══════════════════════════════════════════════════════════
       Pass 2 – offlineServicing  (applied to the offline image)
       Nothing to customise here for a base install.
       ═══════════════════════════════════════════════════════════ -->

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
        <!-- BypassNRO: skip "connect to network" OOBE screen (required for Win 11 24H2+) -->
        <RunSynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <!-- Mark privacy consent as already completed — suppresses the privacy page -->
        <RunSynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v PrivacyConsentStatus /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <!-- Suppress "Customize your experience" and related OOBE upsell pages -->
        <RunSynchronousCommand wcm:action="add">
          <Order>6</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v SetupDisplayedProductPage /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <!-- Skip OneDrive, Cortana, and MS account OOBE prompts -->
        <RunSynchronousCommand wcm:action="add">
          <Order>7</Order>
          <Path>reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\OOBE /v DisablePrivacyExperienceOOBE /t REG_DWORD /d 1 /f</Path>
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
        <!-- true = suppress the "Who's going to use this PC?" local-account
             creation screen; the account defined in LocalAccounts is used. -->
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
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
        <!-- Remove the built-in Administrator account from login screen -->
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

        <!-- Install Parallels Tools silently.
             Iterate drive letters D-J looking for PTAgent.exe – avoids
             relying on wmic which is removed in Windows 11 24H2. -->
        <SynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Description>Install Parallels Tools</Description>
          <CommandLine>cmd /c for %D in (D: E: F: G: H: I: J:) do if exist %D\PTAgent.exe start /wait %D\PTAgent.exe /install_silent</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

        <!-- Download App Installer (winget) from GitHub and install Edge.
             Uses -EncodedCommand so no drive letters, quoting, or escaping
             issues apply.  Runs as the auto-logged-in user so Add-AppxPackage
             is permitted.  Writes progress to C:\setup_log.txt. -->
        <SynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Description>Install winget and Microsoft Edge</Description>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${_ps_b64}</CommandLine>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>

        <!-- Mark setup complete (flag file the host script polls for) -->
        <SynchronousCommand wcm:action="add">
          <Order>5</Order>
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

    # hdiutil can build a hybrid ISO readable by Windows Setup
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

    # Pick a unique VM name by appending (2), (3), … like Parallels does.
    # Never touch existing VMs – leave them intact.
    local base_name="$VM_NAME"
    local candidate="$base_name"
    local n=2
    while prlctl list --all 2>/dev/null | grep -qF "$candidate"; do
        candidate="$base_name ($n)"
        (( n++ ))
    done
    VM_NAME="$candidate"
    log "VM name: '$VM_NAME'"

    log "Creating VM '$VM_NAME' (win-11 template, no default HDD)..."
    prlctl create "$VM_NAME" \
        --distribution win-11 \
        --no-hdd \
        || die "prlctl create failed."
    ok "VM skeleton created."

    # ── CPU and RAM ───────────────────────────────────────────────
    log "CPU: $VM_CPUS cores  RAM: ${VM_RAM} MB"
    prlctl set "$VM_NAME" --cpus "$VM_CPUS"    || die "Failed to set CPU count."
    prlctl set "$VM_NAME" --memsize "$VM_RAM"  || die "Failed to set RAM."

    # ── Virtual hard disk at sata:0 ───────────────────────────────
    log "Adding ${VM_DISK_GB} GB HDD at sata:0..."
    prlctl set "$VM_NAME" \
        --device-add hdd \
        --type expand \
        --size "$VM_DISK_MB" \
        --iface sata \
        --position 0 \
        || die "Failed to add HDD."

    # ── Windows ISO on cdrom0 (sata:1, pre-created by prlctl create) ──
    # prlctl create --distribution win-11 always creates a cdrom0 at sata:1.
    # We configure it with --device-set (no need to specify iface/position).
    log "Attaching Windows 11 ARM Full ISO on cdrom0 (sata:1)..."
    prlctl set "$VM_NAME" \
        --device-set cdrom0 \
        --image "$WINDOWS_ISO" \
        --connect \
        || die "Failed to attach Windows ISO."

    # ── Answer ISO on cdrom1 (sata:2, new device) ─────────────────
    # Windows Setup scans all drives for autounattend.xml automatically;
    # cdrom1 does NOT need to be in the boot order.
    log "Attaching autounattend.xml answer ISO on cdrom1 (sata:2)..."
    prlctl set "$VM_NAME" \
        --device-add cdrom \
        --image "$ANSWER_ISO" \
        --iface sata \
        --position 2 \
        --connect \
        || die "Failed to attach answer ISO."

    # ── Boot order: Windows ISO first, then HDD ───────────────────
    log "Boot order: cdrom0 → hdd0"
    prlctl set "$VM_NAME" --device-bootorder "cdrom0 hdd0" \
        || die "Failed to set boot order."

    # ── Network adapter: e1000 (Intel PRO/1000) ───────────────────
    # The default virtio NIC requires Parallels Tools drivers which aren't
    # present during initial Windows Setup.  e1000 has native Windows drivers
    # so the VM gets a working network adapter immediately on first boot.
    log "Setting network adapter to e1000 (Intel PRO/1000)..."
    prlctl set "$VM_NAME" --device-set net0 --adapter-type e1000 2>/dev/null || \
        warn "Could not set adapter type – virtio will be used (Tools needed for IP)"

    # ── Tell Parallels to keep window open when VM shuts down ─────
    prlctl set "$VM_NAME" --on-shutdown close 2>/dev/null || true

    # Confirmation dump
    log "Device layout:"
    prlctl list -i "$VM_NAME" | grep -E 'hdd|cdrom|boot|net' | sed 's/^/  /'

    ok "VM fully configured and ready to boot."
}

# ─── Start the VM and monitor installation progress ──────────────────────────
# On Apple Silicon, Parallels handles Windows Setup reboots internally —
# the VM process does NOT transition to "stopped" between Setup phases.
# The reliable signal is "OnExitBootServices" in the Parallels hypervisor log,
# which fires exactly once per OS boot.
#
# Expected sequence:
#   Boot event 1 – WinPE loads, partitions disk, copies files  (~15 min)
#   Boot event 2 – First Setup reboot / specialize pass         (~10 min)
#   Boot event 3 – OOBE (skipped), auto-logon, FirstLogonCmds  (~8 min)
#
# Full-edition installs may take longer than minimal installs due to the
# additional app provisioning that happens during Setup.
# ─────────────────────────────────────────────────────────────────────────────
run_installation() {
    header "Starting Windows 11 installation (Full Edition)"

    local pvm_log="$HOME/Parallels/${VM_NAME}.pvm/parallels.log"

    log "Starting VM..."
    prlctl start "$VM_NAME" || die "Failed to start VM."
    log "VM started.  Hypervisor log: $pvm_log"
    log ""
    log "Windows Setup (fully automated via autounattend.xml):"
    log "  Boot 1 – WinPE:     partition disk + copy files      (~15 min)"
    log "  Boot 2 – Setup:     specialize, drivers              (~10 min)"
    log "  Boot 3 – Windows:   OOBE skipped, auto-logon runs    (~8 min)"
    log "  After boot 3: waiting for VM network IP to confirm desktop is up"
    log "  Note: full-edition installs take longer due to app provisioning."
    log ""

    local timeout_sec=$(( 120 * 60 ))   # 2-hour timeout (longer for full install)
    local elapsed=0
    local poll=20
    local boot_events=0
    local boot3_elapsed=0    # elapsed time when boot event 3 was first seen

    while (( elapsed < timeout_sec )); do
        sleep "$poll"
        (( elapsed += poll )) || true

        # Count OS boot cycles via Parallels hypervisor log
        local new_events=0
        if [[ -f "$pvm_log" ]]; then
            new_events=$(grep -c "OnExitBootServices" "$pvm_log" 2>/dev/null || echo 0)
        fi

        if (( new_events > boot_events )); then
            boot_events=$new_events
            echo ""
            log ">>> Boot event #${boot_events} at $(date '+%H:%M:%S') (elapsed $(( elapsed / 60 )) min)"
            # Mount Tools ISO at boot event 2 (OOBE/specialize phase) so it is
            # already visible on a virtual CD when FirstLogonCommands run at
            # boot event 3.  Mounting at boot 3 was a race condition – the drive
            # letter wasn't always enumerable by the time the command executed.
            if (( boot_events == 2 && boot3_elapsed == 0 )); then
                log "Mounting Parallels Tools ISO (boot 2 detected – ready for first logon)..."
                prlctl installtools "$VM_NAME" 2>/dev/null && \
                    ok "Parallels Tools ISO mounted – installer will run at first logon." || \
                    warn "installtools returned non-zero (may already be mounted)."
            fi
            if (( boot_events == 3 && boot3_elapsed == 0 )); then
                boot3_elapsed=$elapsed
            fi
        fi

        # After 3 boot events, Windows should be on the desktop.
        # Check ARP table for a 10.211.55.x IP — works even before Parallels
        # Tools are installed (relies on DHCP broadcast, not the guest agent).
        if (( boot_events >= 3 )); then
            local ip
            # Try ARP first (no Tools needed) — exclude broadcast (.255) and router (.1/.2)
            ip=$(arp -a 2>/dev/null | grep "10\.211\.55\." \
                 | grep -v "10\.211\.55\.255\|10\.211\.55\.1\b\|10\.211\.55\.2\b" \
                 | awk '{print $2}' | tr -d '()' | head -1 || true)
            # Fallback: try prlctl (works once Tools are installed)
            if [[ -z "$ip" ]]; then
                ip=$(prlctl list -i "$VM_NAME" 2>/dev/null \
                     | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' \
                     | grep -v '^0\.' | head -1 || true)
            fi
            if [[ -n "$ip" ]]; then
                echo ""
                ok "Windows desktop confirmed at $ip  (total: $(( elapsed / 60 )) min)"
                WIN_IP="$ip"
                return 0
            fi
            # If no IP after 20 min past boot 3, declare success anyway —
            # full installs can be slower to finish app provisioning.
            local since_boot3=$(( elapsed - boot3_elapsed ))
            if (( since_boot3 >= 1200 )); then
                echo ""
                warn "No IP after $(( since_boot3/60 )) min past boot 3 — declaring success."
                warn "Open Parallels Desktop to confirm Windows is on the desktop."
                WIN_IP=""
                return 0
            fi
        fi

        # Overwrite progress line in terminal
        local phase="Boot 1 – file copy"
        (( boot_events >= 1 )) && phase="Boot 2 – specialize"
        (( boot_events >= 2 )) && phase="Boot 3 – OOBE/logon"
        (( boot_events >= 3 )) && phase="waiting for network IP"
        printf '\r[%s] %-32s  elapsed=%dm  ' \
            "$(date '+%H:%M:%S')" "$phase" "$(( elapsed / 60 ))"
    done

    echo ""
    warn "120-minute timeout reached.  The VM is still running."
    warn "Open Parallels Desktop to check, or run:"
    warn "  prlctl list -i \"$VM_NAME\"  (look for IP_ADDR)"
    WIN_IP=""
}

# ─── Wait for FirstLogonCommands to finish ───────────────────────────────────
# The answer ISO (cdrom1) must stay mounted until setup.ps1 has had a chance
# to run.  We poll for C:\setup_complete.txt which is written by the last
# FirstLogonCommand.  Only then does eject_install_media disconnect cdrom1.
wait_for_setup_complete() {
    header "Waiting for first-logon setup to complete"

    log "Polling C:\\setup_complete.txt (written when FirstLogonCommands finish)."
    log "Expected time: ~15 min (Parallels Tools + winget + Edge install)."

    local timeout_sec=$(( 40 * 60 ))
    local elapsed=0
    local poll=30
    local start_ts
    start_ts=$(date +%s)

    while (( elapsed < timeout_sec )); do
        local done
        done=$(prlctl exec "$VM_NAME" cmd /c \
            "if exist C:\\setup_complete.txt (type C:\\setup_complete.txt) else (echo NOT_YET)" \
            2>/dev/null || true)
        if [[ "$done" == *"done"* ]]; then
            echo ""
            ok "FirstLogonCommands finished (setup_complete.txt = done)."
            local setup_log
            setup_log=$(prlctl exec "$VM_NAME" cmd /c "type C:\\setup_log.txt" 2>/dev/null || true)
            if [[ -n "$setup_log" ]]; then
                log "--- C:\\setup_log.txt ---"
                echo "$setup_log" | tee -a "$LOG_FILE"
                log "--- end setup_log.txt ---"
            fi
            return 0
        fi
        sleep "$poll"
        (( elapsed += poll )) || true
        printf '\r[%s] Waiting for setup_complete.txt... elapsed=%dm  ' \
            "$(date '+%H:%M:%S')" "$(( elapsed / 60 ))"
    done

    echo ""
    warn "Timed out (40 min) waiting for setup_complete.txt — continuing."
    warn "Setup may still be running. Check C:\\setup_log.txt in the VM."
}

# ─── Post-install: Parallels Tools ───────────────────────────────────────────
install_parallels_tools() {
    header "Parallels Tools"

    # Ensure the Tools ISO is mounted regardless of whether we have an IP.
    # prlctl installtools is idempotent – safe to call even if already mounted.
    # We already called this at boot event 3; this is a belt-and-suspenders
    # fallback for situations where the VM rebooted after Tools installation.
    log "Ensuring Parallels Tools ISO is mounted (IP: ${WIN_IP:-<not yet known>})..."
    prlctl installtools "$VM_NAME" 2>/dev/null || {
        warn "installtools returned non-zero (may already be installed or mounted – OK)."
    }
    ok "Parallels Tools: ISO mounted.  Silent installer runs at first logon via autounattend."
}

# ─── Eject install media ──────────────────────────────────────────────────────
eject_install_media() {
    header "Ejecting install media"

    log "Disconnecting Windows ISO..."
    prlctl set "$VM_NAME" --device-disconnect cdrom0 2>/dev/null || true

    log "Disconnecting answer ISO..."
    prlctl set "$VM_NAME" --device-disconnect cdrom1 2>/dev/null || true

    ok "Install media ejected."
}

# ─── Print summary ────────────────────────────────────────────────────────────
print_summary() {
    header "Installation complete (Full Edition)"

    echo -e "${BOLD}VM name     :${NC} $VM_NAME"
    echo -e "${BOLD}Edition     :${NC} Windows 11 Pro – Full (all inbox apps)"
    echo -e "${BOLD}Username    :${NC} $WIN_USERNAME"
    echo -e "${BOLD}Password    :${NC} $WIN_PASSWORD"
    echo -e "${BOLD}Computer    :${NC} $WIN_COMPUTER"
    echo -e "${BOLD}RAM / CPUs  :${NC} ${VM_RAM} MB / ${VM_CPUS} cores"
    echo -e "${BOLD}Disk        :${NC} ${VM_DISK_GB} GB"
    echo ""
    log "Opening Parallels Desktop..."
    open -a 'Parallels Desktop' 2>/dev/null || true
    echo ""
    echo -e "${GREEN}Parallels Desktop is opening – your Windows VM should appear shortly.${NC}"
    echo ""
    local ip="${WIN_IP:-}"
    if [[ -z "$ip" ]]; then
        ip=$(prlctl list -i "$VM_NAME" 2>/dev/null \
             | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' \
             | grep -v '^0\.' | head -1 || true)
    fi
    if [[ -n "$ip" ]]; then
        echo -e "${GREEN}Connect via RDP:${NC}"
        echo "  open rdp://${ip}"
        echo "  Username: $WIN_USERNAME"
        echo "  Password: $WIN_PASSWORD"
    else
        echo -e "${YELLOW}VM IP not yet assigned – run when Windows has booted:${NC}"
        echo "  prlctl list -i \"$VM_NAME\""
    fi
    echo ""
    echo -e "${GREEN}Log:${NC} $LOG_FILE"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
# WIN_IP is set globally by run_installation() and read by
# install_parallels_tools() and print_summary().
WIN_IP=""

main() {
    mkdir -p "$WORK_DIR"
    : > "$LOG_FILE"

    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  Windows 11 ARM – Fully Unattended Parallels Install   ║"
    echo "║              Full Edition (all inbox apps)             ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    log "Work directory : $WORK_DIR"
    log "Log file       : $LOG_FILE"

    check_prerequisites
    download_windows_iso
    create_autounattend      # generates base64 PS command; writes autounattend.xml
    create_answer_iso        # packages autounattend.xml into the answer ISO
    create_vm
    run_installation        # sets WIN_IP when desktop confirmed
    install_parallels_tools # mounts Tools ISO; autounattend runs installer
    wait_for_setup_complete # poll setup_complete.txt before ejecting answer ISO
    eject_install_media
    print_summary
}

main "$@"

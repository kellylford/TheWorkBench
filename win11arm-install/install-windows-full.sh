#!/usr/bin/env bash
# =============================================================================
# Windows 11 ARM – Fully Unattended Parallels Install
# Apple Silicon Mac + Parallels Desktop
#
# ISO source:
#   Downloads the current GA ARM64 retail build via uupdump.net and converts
#   it locally.  ConvertConfig is patched (AppsLevel=2, SkipEdge=0,
#   StubAppsFull=1).  The macOS UUP script sometimes fails at the boot.wim
#   step (a legacy BIOS component); that failure is non-fatal because
#   Parallels ARM64 VMs boot via UEFI and don't need boot.wim.
#
# FirstLogonCommands (all unattended):
#   1. Parallels Tools – silent install from PTAgent.exe on the Tools DVD.
#   2. Edge ARM64 – downloaded via Microsoft enterprise API and installed via
#      msiexec (UUP conversion on macOS can't reliably bake Edge in).
#   3. Setup-complete marker – writes C:\setup_complete.txt.
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
VM_NAME="${VM_NAME:-Windows 11 ARM (Full)}"
VM_RAM="${VM_RAM:-8192}"
VM_CPUS="${VM_CPUS:-6}"
VM_DISK_GB="${VM_DISK_GB:-128}"
VM_DISK_MB=$(( VM_DISK_GB * 1024 ))

WIN_USERNAME="${WIN_USERNAME:-User}"
WIN_PASSWORD="${WIN_PASSWORD:-Parallels1!}"
WIN_COMPUTER="${WIN_COMPUTER:-WinARM}"
WIN_TZ="${WIN_TZ:-UTC}"

UUP_LANG="en-us"
UUP_EDITION="PROFESSIONAL"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$SCRIPT_DIR/work}"
WINDOWS_ISO="$WORK_DIR/windows11_arm_full.iso"   # separate cache from minimal-install
ANSWER_ISO="$WORK_DIR/answer_full.iso"
ANSWER_SRC="$WORK_DIR/answer_src_full"
LOG_FILE="$WORK_DIR/install_full.log"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()    { printf "${CYAN}[%s]${NC} %s\n" "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
ok()     { printf "${GREEN}[%s] OK${NC} %s\n" "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
warn()   { printf "${YELLOW}[%s] WARN${NC} %s\n" "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die()    { printf "${RED}[%s] FAIL${NC} %s\n" "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; exit 1; }
banner() { printf "\n${BOLD}${CYAN}== %s ==${NC}\n\n" "$*"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
check_prerequisites() {
    banner "Prerequisites"
    [[ "$(uname -m)" == "arm64" ]] || die "Requires Apple Silicon."
    command -v prlctl &>/dev/null  || die "prlctl not found. Install Parallels Desktop."
    log "Parallels: $(prlctl --version)"

    if ! command -v brew &>/dev/null; then
        warn "Homebrew not found – installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    for pkg in aria2 p7zip cabextract wimlib cdrtools; do
        local cmd="$pkg"
        [[ "$pkg" == "wimlib"   ]] && cmd="wimlib-imagex"
        [[ "$pkg" == "cdrtools" ]] && cmd="mkisofs"
        command -v "$cmd" &>/dev/null && continue
        log "Installing $pkg..."
        brew install "$pkg"
    done

    # chntpw stub – UUP scripts check for it but ARM64/Parallels does not need it
    if ! command -v chntpw &>/dev/null; then
        mkdir -p "$WORK_DIR/stubs"
        printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK_DIR/stubs/chntpw"
        chmod +x "$WORK_DIR/stubs/chntpw"
        export PATH="$WORK_DIR/stubs:$PATH"
    fi

    ok "Prerequisites satisfied."
}

# ── Windows ISO ───────────────────────────────────────────────────────────────
download_windows_iso() {
    banner "Windows 11 ARM64 ISO"

    local uup_work="$WORK_DIR/uup"
    mkdir -p "$uup_work"

    log "Querying UUP dump for latest GA ARM64 build (ring=retail)..."
    # fetchupd.php?arch=arm64&ring=retail returns exactly the current GA retail
    # build — no Insider/Preview/Canary builds ever appear here.
    # The JSON API (/json-api/fetchupd.php) returns HTTP 500 for this ring, so
    # we extract the UUID directly from the HTML response via regex.
    # Retry up to 4 times in case UUP dump rate-limits (HTTP 429).
    local html build_uuid attempt
    for attempt in 1 2 3 4; do
        html=$(curl -fsSL "https://uupdump.net/fetchupd.php?arch=arm64&ring=retail" 2>/dev/null) && break
        warn "UUP dump query attempt $attempt failed. Retrying in 15s..."
        sleep 15
    done
    [[ -n "$html" ]] || die "UUP dump unreachable after 4 attempts."

    build_uuid=$(echo "$html" \
        | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' \
        | head -1)
    [[ -n "$build_uuid" ]] || die "No GA Win11 ARM64 UUID found in UUP response."

    log "UUID: $build_uuid"

    local stamp="$uup_work/uuid.txt"
    if [[ -f "$WINDOWS_ISO" && -f "$stamp" && "$(cat "$stamp")" == "$build_uuid" ]]; then
        ok "ISO current – reusing $(du -sh "$WINDOWS_ISO" | cut -f1)"
        return
    fi
    if [[ -f "$WINDOWS_ISO" && ! -f "$stamp" ]]; then
        warn "ISO found without stamp – accepting."
        echo "$build_uuid" > "$stamp"
        return
    fi

    local pkg_url="https://uupdump.net/get.php?id=${build_uuid}&pack=${UUP_LANG}&edition=${UUP_EDITION}&autodl=2"
    local pkg_zip="$uup_work/pkg.zip"
    local pkg_dir="$uup_work/package"
    log "Downloading UUP conversion package..."
    for attempt in 1 2 3 4; do
        curl -fsSL -o "$pkg_zip" "$pkg_url" 2>/dev/null && break
        warn "UUP package download attempt $attempt failed. Retrying in 15s..."
        sleep 15
    done
    [[ -f "$pkg_zip" ]] || die "UUP package download failed after 4 attempts."
    mkdir -p "$pkg_dir"
    unzip -qo "$pkg_zip" -d "$pkg_dir" || die "Unzip failed."

    local cfg
    cfg=$(find "$pkg_dir" -name "ConvertConfig.ini" | head -1)
    if [[ -n "$cfg" ]]; then
        sed -i '' 's/^AppsLevel[[:space:]]*=.*/AppsLevel=2/' "$cfg"
        sed -i '' 's/^SkipEdge[[:space:]]*=.*/SkipEdge=0/'  "$cfg"
        sed -i '' 's/^StubAppsFull[[:space:]]*=.*/StubAppsFull=1/' "$cfg"
        grep -q "^AppsLevel"    "$cfg" || echo "AppsLevel=2"    >> "$cfg"
        grep -q "^SkipEdge"     "$cfg" || echo "SkipEdge=0"     >> "$cfg"
        grep -q "^StubAppsFull" "$cfg" || echo "StubAppsFull=1" >> "$cfg"
        ok "ConvertConfig.ini patched (AppsLevel=2, SkipEdge=0, StubAppsFull=1)."
    fi

    local built
    built=$(find "$pkg_dir" -maxdepth 1 -iname "*.iso" | head -1)
    if [[ -z "$built" ]]; then
        local dl
        dl=$(find "$pkg_dir" -name "uup_download_macos.sh" | head -1)
        [[ -n "$dl" ]] || die "uup_download_macos.sh not found in package."
        chmod +x "$dl"
        log "Running UUP downloader (~5 GB download, 30-90 min)..."
        pushd "$(dirname "$dl")" >/dev/null
        # The macOS UUP script sometimes exits non-zero when adding the second
        # index to boot.wim (a legacy BIOS-boot component).  ARM64 Parallels VMs
        # use UEFI and don't need it – allow the failure and check for the ISO.
        set +e
        bash "$dl" 2>&1 | tee -a "$LOG_FILE"
        local _uup_rc=${PIPESTATUS[0]}
        set -e
        popd >/dev/null
        built=$(find "$pkg_dir" -maxdepth 1 -iname "*.iso" | head -1)
        if [[ -z "$built" ]]; then
            if (( _uup_rc != 0 )); then
                die "UUP conversion failed (exit $_uup_rc) and produced no ISO. Full log: $LOG_FILE"
            else
                die "UUP script succeeded but no ISO was found in $pkg_dir"
            fi
        fi
        [[ $_uup_rc -ne 0 ]] && warn "UUP script exited $_uup_rc (boot.wim step likely skipped – OK for ARM64 UEFI)"
    fi
    [[ -n "$built" ]] || die "No ISO found."
    mv "$built" "$WINDOWS_ISO"
    echo "$build_uuid" > "$stamp"
    ok "Windows ISO ready: $(du -sh "$WINDOWS_ISO" | cut -f1)"
}

# ── autounattend.xml + answer ISO ─────────────────────────────────────────────
# Uses placeholders in the XML then seds them in afterward.
# This avoids any shell variable expansion conflicts inside the heredoc.
create_answer_iso() {
    banner "Answer ISO"

    if [[ -f "$ANSWER_ISO" ]]; then
        ok "Answer ISO already exists – reusing."
        return
    fi

    mkdir -p "$ANSWER_SRC"

    cat > "$ANSWER_SRC/autounattend.xml" << XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">

  <!-- Pass 1: windowsPE -->
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage>
        <UILanguage>en-US</UILanguage>
        <WillShowUI>Never</WillShowUI>
      </SetupUILanguage>
      <UILanguage>en-US</UILanguage>
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DiskConfiguration>
        <WillShowUI>Never</WillShowUI>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add">
              <Order>1</Order><Size>260</Size><Type>EFI</Type>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>2</Order><Size>16</Size><Type>MSR</Type>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>3</Order><Extend>true</Extend><Type>Primary</Type>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order><PartitionID>1</PartitionID>
              <Format>FAT32</Format><Label>System</Label>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order><PartitionID>3</PartitionID>
              <Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/INDEX</Key>
              <Value>3</Value>
            </MetaData>
          </InstallFrom>
          <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>
          <WillShowUI>Never</WillShowUI>
        </OSImage>
      </ImageInstall>
      <UserData>
        <AcceptEula>true</AcceptEula>
        <ProductKey>
          <!-- KMS client setup key for Windows 11 Pro (publicly documented by Microsoft).
               Not a real product key – does not activate Windows.
               Just tells Setup which edition to install without showing the key prompt.
               Activation happens automatically via digital licence after first boot.
               Source: https://learn.microsoft.com/en-us/windows-server/get-started/kms-client-setup-keys -->
          <Key>VK7JG-NPHTM-C97JM-9MPGT-3V66T</Key>
          <WillShowUI>Never</WillShowUI>
        </ProductKey>
      </UserData>
    </component>
  </settings>

  <!-- Pass 3: specialize -->
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <ComputerName>%%COMPUTER%%</ComputerName>
      <TimeZone>%%TZ%%</TimeZone>
    </component>
    <component name="Microsoft-Windows-Deployment"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
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
        <RunSynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
    </component>
  </settings>

  <!-- Pass 4: oobeSystem -->
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">

      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>

      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>%%USER%%</Name>
            <DisplayName>%%USER%%</DisplayName>
            <Group>Administrators</Group>
            <Password>
              <Value>%%PASS%%</Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>

      <AutoLogon>
        <Enabled>true</Enabled>
        <Username>%%USER%%</Username>
        <Password>
          <Value>%%PASS%%</Value>
          <PlainText>true</PlainText>
        </Password>
        <LogonCount>5</LogonCount>
      </AutoLogon>

      <TimeZone>%%TZ%%</TimeZone>

      <FirstLogonCommands>
        <!-- Install Parallels Tools from the mounted DVD.
             PTAgent.exe /install_silent reboots the VM once – expected and fine. -->
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>cmd /c for %D in (D: E: F: G: H: I: J:) do if exist %D\PTAgent.exe %D\PTAgent.exe /install_silent</CommandLine>
          <Description>Install Parallels Tools</Description>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>
        <!-- Install Microsoft Edge via the official Enterprise MSI (ARM64, no winget needed).
             The UUP converter on macOS cannot reliably bake Edge into the ISO, so we
             download the MSI directly from Microsoft's enterprise API at first logon. -->
        <SynchronousCommand wcm:action="add">
          <Order>2</Order>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -Command "try{\$j=(New-Object Net.WebClient).DownloadString('https://edgeupdates.microsoft.com/api/products?view=enterprise')|ConvertFrom-Json;\$u=(\$j|Where-Object{\$_.Product-eq'Stable'}|Select-Object -First 1).Releases|Where-Object{\$_.Platform-eq'Windows'-and\$_.Architecture-eq'ARM64'}|Select-Object -First 1|ForEach-Object{(\$_.Artifacts|Where-Object{\$_.ArtifactName-eq'msi'}|Select-Object -First 1).Location};\$m='C:\Windows\Temp\EdgeARM64.msi';(New-Object Net.WebClient).DownloadFile(\$u,\$m);Start-Process msiexec -Wait -ArgumentList('/i',\$m,'/quiet','/norestart','ALLUSERS=1')}catch{}"</CommandLine>
          <Description>Install Microsoft Edge ARM64</Description>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>
        <!-- Create Microsoft Edge shortcut on the Public Desktop (all users). -->
        <SynchronousCommand wcm:action="add">
          <Order>3</Order>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -Command "\$ws=New-Object -ComObject WScript.Shell;\$s=\$ws.CreateShortcut([Environment]::GetFolderPath('CommonDesktopDirectory')+'\Microsoft Edge.lnk');\$s.TargetPath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe';\$s.Save()"</CommandLine>
          <Description>Create Edge Desktop shortcut</Description>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>
        <!-- Write setup-complete marker that the host script polls for. -->
        <SynchronousCommand wcm:action="add">
          <Order>4</Order>
          <CommandLine>cmd /c echo done > C:\setup_complete.txt</CommandLine>
          <Description>Write setup-complete marker</Description>
          <RequiresUserInput>false</RequiresUserInput>
        </SynchronousCommand>
      </FirstLogonCommands>

    </component>
    <component name="Microsoft-Windows-International-Core"
               processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
  </settings>

</unattend>
XMLEOF

    # Substitute placeholders with actual values
    sed -i '' \
        -e "s|%%COMPUTER%%|${WIN_COMPUTER}|g" \
        -e "s|%%TZ%%|${WIN_TZ}|g" \
        -e "s|%%USER%%|${WIN_USERNAME}|g" \
        -e "s|%%PASS%%|${WIN_PASSWORD}|g" \
        "$ANSWER_SRC/autounattend.xml"

    log "autounattend.xml:"
    grep -E "ComputerName|Username|Name>" "$ANSWER_SRC/autounattend.xml" | head -6 | sed 's/^/  /'

    hdiutil makehybrid \
        -o "$ANSWER_ISO" "$ANSWER_SRC" \
        -iso -joliet -default-volume-name ANSWER -quiet \
        || die "hdiutil makehybrid failed."

    ok "Answer ISO: $ANSWER_ISO"
}

# ── Create VM ─────────────────────────────────────────────────────────────────
create_vm() {
    banner "Creating VM"

    # If a VM or .pvm bundle with this name already exists, find a unique name
    # by appending (1), (2), … — the same convention Parallels itself uses.
    local _base="$VM_NAME" _n=1
    while prlctl list --all 2>/dev/null | grep -qF "\"${VM_NAME}\"" || \
          [[ -d "$HOME/Parallels/${VM_NAME}.pvm" ]]; do
        VM_NAME="${_base} (${_n})"
        (( _n++ ))
    done
    [[ "$VM_NAME" != "$_base" ]] && log "Name '${_base}' taken — using '${VM_NAME}'"

    log "VM: $VM_NAME"

    prlctl create "$VM_NAME" --distribution win-11 --no-hdd \
        || die "prlctl create failed."
    prlctl set "$VM_NAME" --cpus "$VM_CPUS"  || die "Set CPUs failed."
    prlctl set "$VM_NAME" --memsize "$VM_RAM" || die "Set RAM failed."

    prlctl set "$VM_NAME" \
        --device-add hdd --type expand \
        --size "$VM_DISK_MB" --iface sata --position 0 \
        || die "Add HDD failed."

    prlctl set "$VM_NAME" \
        --device-set cdrom0 --image "$WINDOWS_ISO" --connect \
        || die "Attach Windows ISO failed."

    prlctl set "$VM_NAME" \
        --device-add cdrom --image "$ANSWER_ISO" \
        --iface sata --position 2 --connect \
        || die "Attach answer ISO failed."

    prlctl set "$VM_NAME" --device-bootorder "cdrom0 hdd0" \
        || die "Set boot order failed."

    # e1000 NIC has in-box Windows drivers; no Parallels Tools needed for DHCP
    prlctl set "$VM_NAME" --device-set net0 --adapter-type e1000 2>/dev/null \
        || warn "Could not set NIC to e1000 (non-fatal)."

    ok "VM created."
    prlctl list -i "$VM_NAME" | grep -E "hdd|cdrom|net|boot" | sed 's/^/  /'
}

# ── Boot + wait for desktop ───────────────────────────────────────────────────
# Detects OS boots via OnExitBootServices in the Parallels hypervisor log.
# Boot 1 = WinPE  |  Boot 2 = specialize  |  Boot 3 = OOBE/logon → desktop
run_installation() {
    banner "Installing Windows"

    local pvm_log="$HOME/Parallels/${VM_NAME}.pvm/parallels.log"
    prlctl start "$VM_NAME" || die "Failed to start VM."
    ok "VM started."
    log "Parallels log: $pvm_log"
    log ""
    log "  Boot 1 – WinPE: partition + copy files  (~5 min)"
    log "  Boot 2 – specialize + drivers           (~3 min)"
    log "  Boot 3 – OOBE/logon → desktop           (~3 min)"
    log ""

    local timeout=$(( 90 * 60 )) elapsed=0 poll=15 boots=0 tools_mounted=0

    while (( elapsed < timeout )); do
        sleep $poll
        (( elapsed += poll )) || true

        local count=0
        [[ -f "$pvm_log" ]] && count=$(grep -c "OnExitBootServices" "$pvm_log" 2>/dev/null || true)

        if (( count > boots )); then
            boots=$count
            printf '\n'
            log "Boot $boots at $(date '+%H:%M:%S') (elapsed $(( elapsed/60 ))m)"

            # Mount Tools at Boot 2 so the installer is ready at Boot 3 logon
            if (( boots == 2 && tools_mounted == 0 )); then
                prlctl installtools "$VM_NAME" 2>/dev/null && tools_mounted=1 \
                    || warn "installtools non-zero (may already mounted)"
                log "Parallels Tools ISO mounted."
            fi
        fi

        # After Boot 3, poll for a DHCP lease via ARP
        if (( boots >= 3 )); then
            local ip
            ip=$(arp -a 2>/dev/null \
                | grep "10\.211\.55\." \
                | grep -v "10\.211\.55\.\(1\b\|2\b\|255\)" \
                | awk '{print $2}' | tr -d '()' | head -1 || true)
            [[ -z "$ip" ]] && ip=$(prlctl list -i "$VM_NAME" 2>/dev/null \
                | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' \
                | grep -v '^0\.' | head -1 || true)
            if [[ -n "$ip" ]]; then
                printf '\n'
                ok "Windows desktop up at $ip ($(( elapsed/60 ))m)"
                WIN_IP="$ip"
                return 0
            fi
        fi

        local phase="WinPE"
        (( boots >= 1 )) && phase="specialize"
        (( boots >= 2 )) && phase="OOBE/logon"
        (( boots >= 3 )) && phase="waiting for IP"
        printf '\r[%s] %-20s  boots=%d  elapsed=%dm  ' \
            "$(date '+%H:%M:%S')" "$phase" "$boots" "$(( elapsed/60 ))"
    done

    printf '\n'
    warn "90-min timeout. VM still running – check Parallels Desktop."
    WIN_IP=""
}

# ── Parallels Tools (from macOS host) ────────────────────────────────────────
# We poll prlctl list --info for GuestTools: state=installed.
# We do NOT use prlctl exec – that requires Tools already installed (circular).
install_parallels_tools() {
    banner "Parallels Tools"

    prlctl installtools "$VM_NAME" 2>/dev/null \
        || warn "installtools non-zero (may already mounted)."
    ok "Tools ISO mounted. Installer runs at next auto-logon."
    log "Polling GuestTools state (expected 5-10 min)..."

    local timeout=$(( 70 * 60 )) elapsed=0 poll=15

    while (( elapsed < timeout )); do
        local state
        state=$(prlctl list -i "$VM_NAME" 2>/dev/null | grep "GuestTools:" | head -1 || true)
        if [[ "$state" == *"state=installed"* ]]; then
            printf '\n'
            ok "Parallels Tools installed."
            return 0
        fi
        sleep $poll
        (( elapsed += poll )) || true
        printf '\r[%s] Waiting for Tools  elapsed=%dm  ' \
            "$(date '+%H:%M:%S')" "$(( elapsed/60 ))"
    done

    printf '\n'
    warn "70-min timeout. To install manually: Parallels Desktop > Actions > Install Parallels Tools"
}


eject_media() {
    banner "Ejecting install media"
    prlctl set "$VM_NAME" --device-disconnect cdrom0 2>/dev/null || true
    prlctl set "$VM_NAME" --device-disconnect cdrom1 2>/dev/null || true
    ok "Done."
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
    banner "Complete"
    local ip="${WIN_IP:-}"
    [[ -z "$ip" ]] && ip=$(prlctl list -i "$VM_NAME" 2>/dev/null \
        | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | grep -v '^0\.' | head -1 || true)

    printf "${BOLD}VM       :${NC} %s\n"          "$VM_NAME"
    printf "${BOLD}Username :${NC} %s\n"          "$WIN_USERNAME"
    printf "${BOLD}Password :${NC} %s\n"          "$WIN_PASSWORD"
    printf "${BOLD}RAM/CPUs :${NC} %s MB / %s\n"  "$VM_RAM" "$VM_CPUS"
    printf "${BOLD}Disk     :${NC} %s GB\n"       "$VM_DISK_GB"
    printf "${BOLD}Log      :${NC} %s\n\n"        "$LOG_FILE"

    open -a 'Parallels Desktop' 2>/dev/null || true

    if [[ -n "$ip" ]]; then
        printf "${GREEN}RDP:${NC} open rdp://%s\n     %s / %s\n\n" \
            "$ip" "$WIN_USERNAME" "$WIN_PASSWORD"
    else
        printf "${YELLOW}IP not yet available.${NC}\n  prlctl list -i \"%s\"\n\n" "$VM_NAME"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
WIN_IP=""

main() {
    mkdir -p "$WORK_DIR"
    : > "$LOG_FILE"

    printf "${BOLD}${CYAN}=== Windows 11 ARM – Unattended Parallels Install ===${NC}\n\n"

    check_prerequisites
    download_windows_iso
    create_answer_iso
    create_vm
    run_installation
    install_parallels_tools
    eject_media
    print_summary
}

main "$@"

<#
.SYNOPSIS
    Creates a Hyper-V Windows virtual machine with a fully unattended install,
    ready to sign in to with Remote Desktop.

.DESCRIPTION
    Remote Desktop is the only way to get proper audio out of a Hyper-V virtual
    machine for a screen reader, so this script builds a VM that is ready for it
    the moment the script finishes:

      1. Applies Windows straight from an ISO onto a new virtual disk. Windows
         Setup never runs, so there is no "press any key to boot from CD"
         prompt and nothing to click.
      2. Adds an answer file that names the computer, creates the local
         administrator account, skips every first-run screen, and turns on
         Remote Desktop.
      3. Creates and starts a Generation 2 VM, then waits until Windows has
         finished setting itself up and Remote Desktop is answering.
      4. Allows sound in both directions over Remote Desktop, saves a
         ready-to-use .rdp file on your desktop, stores the sign-in in
         Credential Manager, and opens the connection.

    Every message is plain text, one line at a time, with no progress bars,
    so it reads cleanly with JAWS, NVDA or Narrator.

.PARAMETER IsoPath
    The Windows ISO. If you leave it out, the newest ISO in your Downloads
    folder with "win" in its name is used. The ISO must match this PC's
    processor: an x64 ISO on an Intel or AMD PC, an Arm64 ISO on an Arm PC.

.PARAMETER VMName
    Name of the virtual machine. It is also used, shortened to 15 characters,
    as the Windows computer name.

.PARAMETER Edition
    Which edition in the ISO to install. It must be one that can accept
    Remote Desktop connections, so Home editions are refused.

.PARAMETER Remove
    Deletes the virtual machine named by VMName, its virtual disk, its .rdp
    file and its saved sign-in, so you can start over.

.EXAMPLE
    .\New-HyperVRdpVM.ps1

.EXAMPLE
    .\New-HyperVRdpVM.ps1 -IsoPath D:\ISOs\Win11_24H2_English_x64.iso -VMName Test2 -MemoryGB 8

.EXAMPLE
    .\New-HyperVRdpVM.ps1 -VMName Test2 -Remove
#>
[CmdletBinding()]
param(
    [string]$IsoPath,
    [string]$VMName = 'Win11-RDP',
    [string]$Edition = 'Windows 11 Pro',
    [string]$UserName = 'vmuser',
    [string]$Password = 'vmadmin',
    [ValidateRange(1, 64)]
    [int]$ProcessorCount = 4,
    # Dynamic memory never goes below 2 GB, so the starting memory can't either.
    [ValidateRange(2, 512)]
    [int]$MemoryGB = 4,
    [int]$DiskGB = 128,
    [string]$SwitchName = 'Default Switch',
    [string]$VhdFolder,
    [string]$Locale,
    [string]$TimeZone = (Get-TimeZone).Id,
    [int]$TimeoutMinutes = 45,
    [switch]$NoConnect,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
# Progress bars are noisy with a screen reader and slow down image apply.
$ProgressPreference = 'SilentlyContinue'

function Say([string]$Message) { Write-Host $Message }
function Step([string]$Message) { Write-Host ''; Write-Host $Message }

# --- Run as administrator ----------------------------------------------------
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Say 'This script needs administrator rights. Windows will ask for permission,'
    Say 'then the script carries on in a new PowerShell window.'
    # Quote for the Windows command line: a backslash before a quote, or at the
    # end, has to be doubled, or "D:\VMs\" would swallow the next argument.
    function ConvertTo-QuotedArgument([string]$Value) {
        $escaped = $Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
        "`"$escaped`""
    }
    $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-QuotedArgument $PSCommandPath))
    foreach ($p in $PSBoundParameters.GetEnumerator()) {
        if ($p.Value -is [switch]) {
            if ($p.Value) { $argList += "-$($p.Key)" }
        } else {
            $argList += "-$($p.Key)"
            $argList += ConvertTo-QuotedArgument "$($p.Value)"
        }
    }
    Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $argList
    return
}

# --- Hyper-V must be available ------------------------------------------------
if (-not (Get-Command New-VM -ErrorAction SilentlyContinue)) {
    $os = (Get-CimInstance Win32_OperatingSystem).Caption
    Say "Hyper-V isn't available on this PC ($os)."
    if ($os -match 'Home') {
        Say 'Windows Home editions do not include Hyper-V. You need Windows Pro, Enterprise or Education.'
    } else {
        Say 'Turn it on by running this in an administrator PowerShell window, then restart the PC:'
        Say '    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All'
    }
    return
}

# Windows computer names: letters, digits and hyphens, 15 characters at most.
$ComputerName = ($VMName -replace '[^A-Za-z0-9-]', '')
if ($ComputerName.Length -gt 15) { $ComputerName = $ComputerName.Substring(0, 15) }
if (-not $ComputerName) { throw "Can't make a Windows computer name from the VM name '$VMName'. Use letters and digits." }

$desktop = [Environment]::GetFolderPath('Desktop')
$rdpFile = Join-Path $desktop "$VMName.rdp"

# --- Remove mode --------------------------------------------------------------
if ($Remove) {
    $disks = @()
    $vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
    if ($vm) {
        $disks = @(Get-VMHardDiskDrive -VMName $VMName | Select-Object -ExpandProperty Path)
        if ($vm.State -ne 'Off') { Say "Turning off $VMName."; Stop-VM -Name $VMName -TurnOff -Force }
        Say "Deleting the virtual machine $VMName."
        Remove-VM -Name $VMName -Force
    } else {
        Say "There is no virtual machine named $VMName. Looking for anything a failed run left behind."
    }
    # A run that failed after the disk was built but before the VM existed
    # leaves the disk behind, and the next run refuses to overwrite it. Delete
    # it too, as long as no other virtual machine is using it.
    $folder = if ($VhdFolder) { $VhdFolder } else { (Get-VMHost).VirtualHardDiskPath }
    $leftover = Join-Path $folder "$VMName.vhdx"
    if ((Test-Path -LiteralPath $leftover) -and $disks -notcontains $leftover) {
        $inUse = @(Get-VM | Get-VMHardDiskDrive | Where-Object { $_.Path -eq $leftover })
        if ($inUse) {
            Say "Leaving $leftover alone, because the virtual machine $($inUse[0].VMName) uses it."
        } else {
            $disks += $leftover
        }
    }
    foreach ($d in $disks) { Say "Deleting the virtual disk $d."; Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $rdpFile) {
        foreach ($line in Get-Content -LiteralPath $rdpFile) {
            if ($line -like 'full address:s:*') { cmdkey /delete:"TERMSRV/$($line.Substring(15))" | Out-Null }
        }
        Say "Deleting $rdpFile."
        Remove-Item -LiteralPath $rdpFile -Force
    }
    Say 'Done.'
    return
}

# --- Check everything before touching anything --------------------------------
if ($Locale) {
    try { $null = [Globalization.CultureInfo]::GetCultureInfo($Locale) }
    catch { throw "'$Locale' isn't a language Windows knows. Use a tag such as en-US or en-GB." }
}
if ($Edition -match 'Home') {
    throw "$Edition can't accept Remote Desktop connections. Use a Pro, Enterprise or Education edition."
}
if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) {
    throw "A virtual machine named $VMName already exists. Pick another name with -VMName, or delete it with -Remove."
}
if (-not (Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue)) {
    $names = (Get-VMSwitch | Select-Object -ExpandProperty Name) -join ', '
    throw "There is no Hyper-V virtual switch named '$SwitchName'. Switches on this PC: $names. Pass one with -SwitchName."
}

# Win32_Processor.Architecture uses the same numbers as a Windows image: 9 is x64, 12 is Arm64.
$archNames = @{ 0 = 'x86'; 9 = 'x64'; 12 = 'Arm64' }
$hostArch = [int](Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture

if (-not $IsoPath) {
    # An ISO kept next to the script wins, so a folder carried to another PC
    # (on OneDrive or a USB stick) brings its ISO with it. Downloads is next.
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    $isoFolders = @($PSScriptRoot, $downloads) | Where-Object { $_ } | Select-Object -Unique
    $downloadPage = if ($hostArch -eq 12) { 'https://www.microsoft.com/software-download/windows11arm64' } else { 'https://www.microsoft.com/software-download/windows11' }
    # Microsoft names its ISOs with the processor type, for example
    # Win11_25H2_English_x64.iso and Win11_25H2_English_Arm64.iso. Skip any whose
    # name says it's for the other kind of PC, so one Downloads folder can hold both.
    $otherArch = if ($hostArch -eq 12) { 'x64|amd64' } else { 'arm64|aarch64' }
    $iso = $null
    foreach ($folder in $isoFolders) {
        $iso = Get-ChildItem -LiteralPath $folder -Filter '*.iso' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'win' -and $_.Name -notmatch $otherArch } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($iso) { break }
    }
    if (-not $iso) {
        throw "No $($archNames[$hostArch]) Windows ISO found in $($isoFolders -join ' or '). Download one from $downloadPage and run the script again, or pass its location with -IsoPath."
    }
    $IsoPath = $iso.FullName
}
if (-not (Test-Path -LiteralPath $IsoPath)) { throw "Can't find the ISO $IsoPath." }
$IsoPath = (Resolve-Path -LiteralPath $IsoPath).Path

if (-not $VhdFolder) { $VhdFolder = (Get-VMHost).VirtualHardDiskPath }
New-Item -ItemType Directory -Path $VhdFolder -Force | Out-Null
$vhdPath = Join-Path $VhdFolder "$VMName.vhdx"
if (Test-Path -LiteralPath $vhdPath) {
    throw "The virtual disk $vhdPath already exists. Delete it or pick another VM name."
}

Say "Creating the virtual machine $VMName."
Say "Windows image: $IsoPath"
Say 'This usually takes 15 to 30 minutes. You do not need to do anything until it finishes.'

# --- Build the virtual disk ---------------------------------------------------
$isoMounted = $false
$vhdMounted = $false
$vhdDone = $false
$bcdWork = $null
try {
    Step 'Step 1 of 5: Reading the ISO.'
    # If the ISO is already open in File Explorer, use that copy and leave it
    # mounted afterwards; only dismount what this script mounted.
    $isoImage = Get-DiskImage -ImagePath $IsoPath
    if (-not $isoImage.Attached) {
        $isoImage = Mount-DiskImage -ImagePath $IsoPath -PassThru
        $isoMounted = $true
    }
    $isoLetter = ($isoImage | Get-Volume).DriveLetter
    if (-not $isoLetter) {
        throw "$IsoPath is mounted but has no drive letter. Eject it in File Explorer and run the script again."
    }
    $wim = @("${isoLetter}:\sources\install.wim", "${isoLetter}:\sources\install.esd") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $wim) { throw "$IsoPath doesn't look like a Windows install ISO. There is no sources\install.wim or install.esd on it." }

    $images = Get-WindowsImage -ImagePath $wim
    $match = $images | Where-Object ImageName -eq $Edition | Select-Object -First 1
    if (-not $match) {
        $available = ($images | Select-Object -ExpandProperty ImageName) -join '; '
        throw "The ISO has no edition called '$Edition'. It has: $available. Pass one with -Edition."
    }
    $info = Get-WindowsImage -ImagePath $wim -Index $match.ImageIndex
    if ([int]$info.Architecture -ne $hostArch) {
        throw "This ISO is for $($archNames[[int]$info.Architecture]) PCs, but this PC is $($archNames[$hostArch]). Hyper-V can only run Windows built for the same kind of processor. Download the $($archNames[$hostArch]) ISO."
    }
    $unattendArch = if ($hostArch -eq 12) { 'arm64' } else { 'amd64' }
    $imageLanguage = @($info.Languages)[[int]$info.DefaultLanguageIndex]
    if (-not $Locale) { $Locale = $imageLanguage }
    Say "Found $($info.ImageName), version $($info.Version), language $imageLanguage."

    Step "Step 2 of 5: Creating a $DiskGB GB virtual disk and copying Windows onto it. This is the longest step."
    New-VHD -Path $vhdPath -SizeBytes ([uint64]$DiskGB * 1GB) -Dynamic | Out-Null
    $disk = Mount-VHD -Path $vhdPath -Passthru | Get-Disk
    $vhdMounted = $true
    Initialize-Disk -Number $disk.Number -PartitionStyle GPT
    # Newer Windows adds a reserved partition on initialise; start from an empty disk.
    Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Remove-Partition -Confirm:$false

    $basicData = '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}'
    $msr       = '{e3c9e316-0b5c-4db8-817d-f92df00215ae}'
    $esp       = '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'

    # The boot partition is created as ordinary data so it can be formatted and
    # given a drive letter, and is switched to the EFI type once it is written.
    $sysPart = New-Partition -DiskNumber $disk.Number -Size 260MB -GptType $basicData
    Format-Volume -Partition $sysPart -FileSystem FAT32 -NewFileSystemLabel System -Force -Confirm:$false | Out-Null
    New-Partition -DiskNumber $disk.Number -Size 16MB -GptType $msr | Out-Null
    $winPart = New-Partition -DiskNumber $disk.Number -UseMaximumSize -GptType $basicData
    Format-Volume -Partition $winPart -FileSystem NTFS -NewFileSystemLabel Windows -Force -Confirm:$false | Out-Null

    $sysPart | Add-PartitionAccessPath -AssignDriveLetter
    $winPart | Add-PartitionAccessPath -AssignDriveLetter
    $sysLetter = (Get-Partition -DiskNumber $disk.Number -PartitionNumber $sysPart.PartitionNumber).DriveLetter
    $winLetter = (Get-Partition -DiskNumber $disk.Number -PartitionNumber $winPart.PartitionNumber).DriveLetter

    Expand-WindowsImage -ImagePath $wim -Index $match.ImageIndex -ApplyPath "${winLetter}:\" | Out-Null
    Say 'Windows is copied.'

    Step 'Step 3 of 5: Making the disk bootable and adding the answer file.'
    $efiBoot = "${sysLetter}:\EFI\Microsoft\Boot"
    function Invoke-Bcdedit([string]$Arguments) {
        $out = cmd /c "bcdedit $Arguments 2>&1" | Out-String
        if ($LASTEXITCODE -ne 0) { throw "bcdedit $Arguments failed: $($out.Trim()) (bcdboot said: $($bootOutput.Trim()))" }
        return $out
    }
    # "partition=X:" (or a reference through the VHDX file) records this PC's
    # view of the disk, which the VM can't find: it stops at Windows Boot
    # Manager with 0xc000000e. "boot" and "locate" are resolved at boot time.
    $portableDevices = @('device locate', 'osdevice locate')

    # bcdboot loads the new boot store under the same registry key as this PC's
    # own, and on some builds (seen on 26340 Insider) that collides and it fails
    # with 0xc0000035. Only then, build the same boot files and store by hand:
    # bcdedit /createstore loads the store under a key of its own. Any other
    # bcdboot failure is a real problem, so it stops the script.
    $bootOutput = cmd /c "`"${winLetter}:\Windows\System32\bcdboot.exe`" ${winLetter}:\Windows /s ${sysLetter}: /f UEFI 2>&1" | Out-String
    $bootExit = $LASTEXITCODE
    if ($bootExit -eq 0) {
        Invoke-Bcdedit "/store `"$efiBoot\BCD`" /set {bootmgr} device boot" | Out-Null
        foreach ($setting in $portableDevices) {
            Invoke-Bcdedit "/store `"$efiBoot\BCD`" /set {default} $setting" | Out-Null
        }
    } elseif ($bootOutput -notmatch 'c0000035') {
        throw "bcdboot couldn't make the disk bootable (exit code $bootExit): $($bootOutput.Trim())"
    } else {
        Say "bcdboot couldn't do it (exit code $bootExit), so the boot files are being set up directly instead."
        # Start clean: the failed bcdboot can leave a partial BCD store behind.
        Remove-Item -LiteralPath "${sysLetter}:\EFI" -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $efiBoot, "${sysLetter}:\EFI\Boot" -Force | Out-Null
        Copy-Item -Path "${winLetter}:\Windows\Boot\EFI\*" -Destination $efiBoot -Recurse -Force
        if (Test-Path "${winLetter}:\Windows\Boot\Fonts") {
            Copy-Item -Path "${winLetter}:\Windows\Boot\Fonts" -Destination $efiBoot -Recurse -Force
        }
        # The firmware starts \EFI\Boot\boot<arch>.efi when it has no boot entry of its own.
        $fallbackName = if ($hostArch -eq 12) { 'bootaa64.efi' } else { 'bootx64.efi' }
        Copy-Item -Path "$efiBoot\bootmgfw.efi" -Destination "${sysLetter}:\EFI\Boot\$fallbackName" -Force

        $bcdWork = Join-Path $env:TEMP "NewVmBcd-$([guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Path $bcdWork | Out-Null
        $store = "$bcdWork\BCD"
        Invoke-Bcdedit "/createstore `"$store`"" | Out-Null

        # bcdedit /createstore makes an ordinary store. The specialize pass
        # refuses one that isn't flagged as the system store ("File is not
        # system store", then "could not configure Windows to run on this
        # computer's hardware"), so set the flags bcdboot would have set.
        # reg load refuses BCD files ("The filename or extension is too long"),
        # but RegLoadAppKey opens a byte-for-byte copy with another name. It has
        # to happen now: once bcdedit adds entries, opening it is access denied.
        if (-not ('NewVmAppHive' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
public static class NewVmAppHive {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegLoadAppKey(string file, out IntPtr key, int sam, int options, int reserved);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegCreateKeyEx(SafeRegistryHandle key, string subKey, int reserved, string cls, int options, int sam, IntPtr security, out IntPtr result, out int disposition);
    [DllImport("advapi32.dll")]
    static extern int RegFlushKey(SafeRegistryHandle key);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LookupPrivilegeValue(string system, string name, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokenPrivilege state, int length, IntPtr previous, IntPtr returnLength);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct TokenPrivilege { public int Count; public long Luid; public int Attributes; }
    static void Enable(string name) {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x28, out token)) throw new System.ComponentModel.Win32Exception();
        try {
            TokenPrivilege tp = new TokenPrivilege { Count = 1, Attributes = 2 };
            if (!LookupPrivilegeValue(null, name, out tp.Luid)) throw new System.ComponentModel.Win32Exception();
            if (!AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
            // AdjustTokenPrivileges also succeeds when the account doesn't hold
            // the privilege at all; that only shows up as ERROR_NOT_ALL_ASSIGNED.
            if (Marshal.GetLastWin32Error() == 1300) {
                throw new InvalidOperationException("This account doesn't have " + name + ", which is needed to write the boot store. Run the script from a full administrator account.");
            }
        } finally { CloseHandle(token); }
    }
    public static RegistryKey Open(string file) {
        IntPtr h;
        int rc = RegLoadAppKey(file, out h, 0xF003F, 0, 0);
        if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);
        return RegistryKey.FromHandle(new SafeRegistryHandle(h, true));
    }
    // The store's keys deny Administrators write access. Opening with
    // REG_OPTION_BACKUP_RESTORE and the backup and restore privileges
    // writes regardless of the key's own permissions.
    public static RegistryKey OpenForWrite(RegistryKey parent, string name) {
        Enable("SeBackupPrivilege");
        Enable("SeRestorePrivilege");
        IntPtr h; int disposition;
        int rc = RegCreateKeyEx(parent.Handle, name, 0, null, 4, 0x20006 | 0x0001, IntPtr.Zero, out h, out disposition);
        if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);
        return RegistryKey.FromHandle(new SafeRegistryHandle(h, true));
    }
    public static void Flush(RegistryKey key) { RegFlushKey(key.Handle); }
}
'@
        }
        $hiveFile = "$bcdWork\store.hiv"
        [IO.File]::WriteAllBytes($hiveFile, [IO.File]::ReadAllBytes($store))
        # Every key is closed in a finally: the hive stays loaded, and the file
        # locked, until the last handle to it is gone.
        $root = [NewVmAppHive]::Open($hiveFile)
        $desc = $null
        try {
            $desc = [NewVmAppHive]::OpenForWrite($root, 'Description')
            $desc.SetValue('KeyName', 'BCD00000000', [Microsoft.Win32.RegistryValueKind]::String)
            $desc.SetValue('System', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
            $desc.SetValue('TreatAsSystem', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
            [NewVmAppHive]::Flush($desc)
            [NewVmAppHive]::Flush($root)
        } finally {
            if ($desc) { $desc.Close() }
            $root.Close()
        }
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        $flagged = [IO.File]::ReadAllBytes($hiveFile)

        # Read the flags back so a silent failure shows up here, not at first boot.
        $verifyFile = "$bcdWork\verify.hiv"
        [IO.File]::WriteAllBytes($verifyFile, $flagged)
        $root = [NewVmAppHive]::Open($verifyFile)
        $desc = $null
        try {
            $desc = $root.OpenSubKey('Description')
            if (-not $desc -or [int]$desc.GetValue('System', 0) -ne 1 -or [int]$desc.GetValue('TreatAsSystem', 0) -ne 1) {
                throw "The new boot store didn't keep its system-store flags."
            }
        } finally {
            if ($desc) { $desc.Close() }
            $root.Close()
        }
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()

        # Put the flagged store on the boot partition and add the entries there.
        $store = "$efiBoot\BCD"
        [IO.File]::WriteAllBytes($store, $flagged)

        Invoke-Bcdedit "/store `"$store`" /create {bootmgr} /d `"Windows Boot Manager`"" | Out-Null
        Invoke-Bcdedit "/store `"$store`" /set {bootmgr} device boot" | Out-Null
        Invoke-Bcdedit "/store `"$store`" /set {bootmgr} locale $imageLanguage" | Out-Null
        Invoke-Bcdedit "/store `"$store`" /set {bootmgr} timeout 0" | Out-Null
        $created = Invoke-Bcdedit "/store `"$store`" /create /d `"Windows`" /application osloader"
        $loader = [regex]::Match($created, '\{[0-9a-fA-F-]{36}\}').Value
        if (-not $loader) { throw "bcdedit didn't report the new boot entry: $created" }
        foreach ($setting in $portableDevices + @(
            'path \Windows\system32\winload.efi'
            'systemroot \Windows'
            "locale $imageLanguage"
            'nx OptIn'
        )) {
            Invoke-Bcdedit "/store `"$store`" /set $loader $setting" | Out-Null
        }
        Invoke-Bcdedit "/store `"$store`" /set {bootmgr} default $loader" | Out-Null
        Invoke-Bcdedit "/store `"$store`" /set {bootmgr} displayorder $loader" | Out-Null
    }

    $xUser = [Security.SecurityElement]::Escape($UserName)
    $xPass = [Security.SecurityElement]::Escape($Password)
    $xTz   = [Security.SecurityElement]::Escape($TimeZone)
    $xLocale = [Security.SecurityElement]::Escape($Locale)
    $xLanguage = [Security.SecurityElement]::Escape($imageLanguage)
    $component = "processorArchitecture=`"$unattendArch`" publicKeyToken=`"31bf3856ad364e35`" language=`"neutral`" versionScope=`"nonSxS`""

    # Windows Setup is skipped entirely, so only the specialize and oobeSystem
    # passes are needed. Windows reads this from \Windows\Panther on first boot.
    $unattend = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" $component>
      <ComputerName>$ComputerName</ComputerName>
      <TimeZone>$xTz</TimeZone>
    </component>
    <component name="Microsoft-Windows-TerminalServices-LocalSessionManager" $component>
      <fDenyTSConnections>false</fDenyTSConnections>
    </component>
    <component name="Microsoft-Windows-Deployment" $component>
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Description>Open the firewall for Remote Desktop (group name works in every language)</Description>
          <Path>powershell.exe -NoProfile -Command "Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752' | Enable-NetFirewallRule"</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Description>Stop the password expiring, which would lock Remote Desktop out</Description>
          <Path>cmd.exe /c net accounts /maxpwage:unlimited</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Description>Never sleep</Description>
          <Path>powercfg.exe /change standby-timeout-ac 0</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Description>No hibernation</Description>
          <Path>powercfg.exe /hibernate off</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Description>Skip the network requirement in first-run setup</Description>
          <Path>reg.exe add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" $component>
      <InputLocale>$xLocale</InputLocale>
      <SystemLocale>$xLocale</SystemLocale>
      <UILanguage>$xLanguage</UILanguage>
      <UserLocale>$xLocale</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" $component>
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>$xUser</Name>
            <DisplayName>$xUser</DisplayName>
            <Group>Administrators</Group>
            <Password>
              <Value>$xPass</Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <TimeZone>$xTz</TimeZone>
    </component>
  </settings>
</unattend>
"@
    [xml]$unattend | Out-Null   # fail here, not on first boot, if the XML is malformed
    $panther = "${winLetter}:\Windows\Panther"
    New-Item -ItemType Directory -Path $panther -Force | Out-Null
    [IO.File]::WriteAllText("$panther\unattend.xml", $unattend, (New-Object Text.UTF8Encoding $false))

    Set-Partition -DiskNumber $disk.Number -PartitionNumber $sysPart.PartitionNumber -GptType $esp
    $vhdDone = $true
}
finally {
    if ($bcdWork) {
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        Remove-Item -LiteralPath $bcdWork -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($vhdMounted) { Dismount-VHD -Path $vhdPath -ErrorAction SilentlyContinue }
    if ($isoMounted) { Dismount-DiskImage -ImagePath $IsoPath -ErrorAction SilentlyContinue | Out-Null }
    if (-not $vhdDone -and (Test-Path -LiteralPath $vhdPath)) {
        Remove-Item -LiteralPath $vhdPath -Force -ErrorAction SilentlyContinue
    }
}

# --- Create and start the VM --------------------------------------------------
Step 'Step 4 of 5: Creating the virtual machine and starting it.'
New-VM -Name $VMName -Generation 2 -MemoryStartupBytes ([int64]$MemoryGB * 1GB) -VHDPath $vhdPath -SwitchName $SwitchName | Out-Null
Set-VMProcessor -VMName $VMName -Count $ProcessorCount
Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $true -MinimumBytes 2GB -StartupBytes ([int64]$MemoryGB * 1GB) -MaximumBytes ([int64][Math]::Max($MemoryGB * 2, 8) * 1GB)
Set-VM -Name $VMName -AutomaticCheckpointsEnabled $false
Set-VMFirmware -VMName $VMName -FirstBootDevice (Get-VMHardDiskDrive -VMName $VMName)
try {
    # A virtual TPM keeps Windows 11 happy for future feature updates.
    Set-VMKeyProtector -VMName $VMName -NewLocalKeyProtector
    Enable-VMTPM -VMName $VMName
} catch {
    Say "Note: couldn't add a virtual TPM ($($_.Exception.Message)). Windows still runs without one."
}
Start-VM -Name $VMName
Say 'The virtual machine is running. Windows is now setting itself up and will restart once or twice.'

# --- Wait for Windows to finish, then finish configuring it -------------------
Step 'Step 5 of 5: Waiting for Windows to finish setting up.'

# PowerShell Direct talks to the VM over Hyper-V itself, so it needs no network
# and only succeeds once the account from the answer file exists.
$credential = New-Object PSCredential("$ComputerName\$UserName", (ConvertTo-SecureString $Password -AsPlainText -Force))
$configureGuest = {
    $setup = Get-ItemProperty 'HKLM:\SYSTEM\Setup'
    if ([int]$setup.SystemSetupInProgress -or [int]$setup.OOBEInProgress) {
        return [pscustomobject]@{ Ready = $false }
    }
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
    Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752' | Enable-NetFirewallRule
    # Allow sound to play through, and the microphone to come back, over Remote Desktop.
    $policy = 'HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
    reg.exe add $policy /v fDisableCam /t REG_DWORD /d 0 /f | Out-Null
    reg.exe add $policy /v fDisableAudioCapture /t REG_DWORD /d 0 /f | Out-Null
    Set-Service -Name Audiosrv -StartupType Automatic
    Start-Service -Name Audiosrv -ErrorAction SilentlyContinue
    Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
        Select-Object -First 1 -ExpandProperty IPAddress
    [pscustomobject]@{ Ready = $true; IPAddress = $ip }
}

$started = Get-Date
$deadline = $started.AddMinutes($TimeoutMinutes)
$nextNote = $started.AddMinutes(3)
$guest = $null
while (-not ($guest -and $guest.Ready -and $guest.IPAddress)) {
    if ((Get-Date) -gt $deadline) {
        throw "Windows didn't finish setting up within $TimeoutMinutes minutes. The VM is left running so you can look at it in Hyper-V Manager. Delete it with: .\New-HyperVRdpVM.ps1 -VMName $VMName -Remove"
    }
    if ((Get-VM -Name $VMName).State -eq 'Off') {
        throw "The virtual machine turned itself off during setup. Open it in Hyper-V Manager to see why, or delete it with: .\New-HyperVRdpVM.ps1 -VMName $VMName -Remove"
    }
    if ((Get-Date) -gt $nextNote) {
        Say "Still setting up. $([int]((Get-Date) - $started).TotalMinutes) minutes so far."
        $nextNote = (Get-Date).AddMinutes(3)
    }
    try {
        $guest = Invoke-Command -VMName $VMName -Credential $credential -ScriptBlock $configureGuest -ErrorAction Stop
    } catch {
        $guest = $null
    }
    if (-not ($guest -and $guest.Ready -and $guest.IPAddress)) { Start-Sleep -Seconds 15 }
}
Say "Windows is set up. The virtual machine's address is $($guest.IPAddress)."

# The Default Switch hands out a new address when the host restarts, but it
# also publishes <computer>.mshome.net, which keeps pointing at the VM.
$target = $guest.IPAddress
try {
    $named = [Net.Dns]::GetHostAddresses("$ComputerName.mshome.net") | ForEach-Object IPAddressToString
    if ($named -contains $guest.IPAddress) { $target = "$ComputerName.mshome.net" }
} catch { }

function Test-RdpPort([string]$HostName) {
    $client = New-Object Net.Sockets.TcpClient
    try { return $client.ConnectAsync($HostName, 3389).Wait(3000) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
$rdpDeadline = (Get-Date).AddMinutes(5)
while (-not (Test-RdpPort $target)) {
    if ((Get-Date) -gt $rdpDeadline) {
        throw "Windows is set up, but Remote Desktop isn't answering at $target. Try restarting the VM in Hyper-V Manager, then connect to $target."
    }
    Start-Sleep -Seconds 5
}
Say 'Remote Desktop is answering.'

# --- Connection file and saved sign-in ----------------------------------------
# audiomode 0 plays the VM's sound on this PC; audiocapturemode 1 sends this
# PC's microphone to the VM. Authentication level 0 skips the certificate
# warning that a brand-new VM's self-signed certificate would otherwise raise.
$rdp = @(
    "full address:s:$target"
    "username:s:$ComputerName\$UserName"
    'prompt for credentials:i:0'
    'authentication level:i:0'
    'audiomode:i:0'
    'audiocapturemode:i:1'
    'redirectclipboard:i:1'
    'autoreconnection enabled:i:1'
    'screen mode id:i:2'
)
Set-Content -LiteralPath $rdpFile -Value $rdp -Encoding ASCII
cmdkey /generic:"TERMSRV/$target" /user:"$ComputerName\$UserName" /pass:"$Password" | Out-Null

Write-Host ''
Say 'All done.'
Say "Virtual machine: $VMName"
Say "Connect to: $target"
Say "User name: $UserName"
Say "Password: $Password"
Say "Connection file: $rdpFile"
Say 'The sign-in is saved, so opening the connection file logs you straight in.'

if (-not $NoConnect) {
    Say 'Opening Remote Desktop now.'
    Start-Process -FilePath mstsc.exe -ArgumentList "`"$rdpFile`""
}

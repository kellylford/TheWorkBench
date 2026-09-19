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
    [int]$ProcessorCount = 4,
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
    $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($p in $PSBoundParameters.GetEnumerator()) {
        if ($p.Value -is [switch]) {
            if ($p.Value) { $argList += "-$($p.Key)" }
        } else {
            $argList += "-$($p.Key)"
            $argList += "`"$($p.Value)`""
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
    $vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
    if (-not $vm) { Say "There is no virtual machine named $VMName."; return }
    $disks = @(Get-VMHardDiskDrive -VMName $VMName | Select-Object -ExpandProperty Path)
    if ($vm.State -ne 'Off') { Say "Turning off $VMName."; Stop-VM -Name $VMName -TurnOff -Force }
    Say "Deleting the virtual machine $VMName."
    Remove-VM -Name $VMName -Force
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

if (-not $IsoPath) {
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    $iso = Get-ChildItem -LiteralPath $downloads -Filter '*.iso' -ErrorAction SilentlyContinue |
        Where-Object Name -match 'win' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $iso) {
        throw "No Windows ISO found in $downloads. Download one from https://www.microsoft.com/software-download/windows11 and run the script again, or pass its location with -IsoPath."
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

# Win32_Processor.Architecture uses the same numbers as a Windows image: 9 is x64, 12 is Arm64.
$archNames = @{ 0 = 'x86'; 9 = 'x64'; 12 = 'Arm64' }
$hostArch = [int](Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture

Say "Creating the virtual machine $VMName."
Say "Windows image: $IsoPath"
Say 'This usually takes 15 to 30 minutes. You do not need to do anything until it finishes.'

# --- Build the virtual disk ---------------------------------------------------
$isoMounted = $false
$vhdMounted = $false
$vhdDone = $false
try {
    Step 'Step 1 of 5: Reading the ISO.'
    $isoImage = Mount-DiskImage -ImagePath $IsoPath -PassThru
    $isoMounted = $true
    $isoLetter = ($isoImage | Get-Volume).DriveLetter
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
    & "${winLetter}:\Windows\System32\bcdboot.exe" "${winLetter}:\Windows" /s "${sysLetter}:" /f UEFI | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "bcdboot couldn't make the disk bootable (exit code $LASTEXITCODE)." }

    $xUser = [Security.SecurityElement]::Escape($UserName)
    $xPass = [Security.SecurityElement]::Escape($Password)
    $xTz   = [Security.SecurityElement]::Escape($TimeZone)
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
      <InputLocale>$Locale</InputLocale>
      <SystemLocale>$Locale</SystemLocale>
      <UILanguage>$imageLanguage</UILanguage>
      <UserLocale>$Locale</UserLocale>
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

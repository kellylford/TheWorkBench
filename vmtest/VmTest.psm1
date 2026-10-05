# vmtest: lets Claude test Windows apps inside a Hyper-V VM instead of on the host, so the host's
# focus, keyboard and screen reader are never touched. Host side; the guest side is guest\agent.ps1.
#
# Everything here works without elevation for a member of the Hyper-V Administrators group.
# The VM talks over PowerShell Direct (Invoke-Command -VMName), so it needs no network and opens no window.

$ErrorActionPreference = 'Stop'

$script:GuestRoot = 'C:\vmtest'
$script:AgentTask = 'vmtest-agent'
$script:CleanCheckpoint = 'Clean'

function Get-VmTestConfig {
    [pscustomobject]@{
        VMName   = if ($env:VMTEST_VM) { $env:VMTEST_VM } else { 'ClaudeTesting' }
        UserName = if ($env:VMTEST_USER) { $env:VMTEST_USER } else { 'vmuser' }
        # The test VM's own throwaway account, the default the VM script creates. Not a real password.
        Password = if ($env:VMTEST_PASSWORD) { $env:VMTEST_PASSWORD } else { 'vmadmin' }
        StateDir = if ($env:VMTEST_STATE) { $env:VMTEST_STATE } else { Join-Path $env:LOCALAPPDATA 'vmtest' }
    }
}

function Get-GuestCredential {
    $c = Get-VmTestConfig
    New-Object System.Management.Automation.PSCredential($c.UserName, (ConvertTo-SecureString $c.Password -AsPlainText -Force))
}

# ---- task names and checkpoints ----------------------------------------------------------------

function ConvertTo-TaskCheckpointName {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Branch)
    $clean = { param($s) ($s -replace '[^A-Za-z0-9._-]+', '-').Trim('-') }
    $repoPart = & $clean $Repo
    $branchPart = & $clean $Branch
    if (-not $repoPart -or -not $branchPart) { throw "Can't make a checkpoint name from repo '$Repo' and branch '$Branch'." }
    $name = "task $repoPart $branchPart"
    if ($name.Length -gt 100) { $name = $name.Substring(0, 100) }
    $name
}

# The repo and branch of the folder Claude is working in, when they weren't given.
function Resolve-Task {
    param([string]$Repo, [string]$Branch, [string]$Path = (Get-Location).Path)
    if (-not $Repo -or -not $Branch) {
        $top = git -C $Path rev-parse --show-toplevel 2>$null
        if (-not $Repo) {
            if (-not $top) { throw "Not in a git repository; give -Repo and -Branch." }
            # A worktree's folder is named after the branch, so use the main checkout's folder name.
            $common = git -C $Path rev-parse --path-format=absolute --git-common-dir 2>$null
            $Repo = if ($common -and (Split-Path $common -Leaf) -eq '.git') { Split-Path (Split-Path $common) -Leaf } else { Split-Path $top -Leaf }
        }
        if (-not $Branch) {
            $Branch = git -C $Path branch --show-current 2>$null
            if (-not $Branch) { throw "Can't tell the current branch (detached HEAD?); give -Branch." }
        }
    }
    [pscustomobject]@{ Repo = $Repo; Branch = $Branch; Checkpoint = ConvertTo-TaskCheckpointName $Repo $Branch }
}

# ---- the lock: one task uses the VM at a time --------------------------------------------------

function Get-LockPath { Join-Path (Get-VmTestConfig).StateDir 'lock.json' }

function Get-VmTestLock {
    $p = Get-LockPath
    if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json }
}

function Set-VmTestLock {
    param([Parameter(Mandatory)]$Task, [switch]$Force)
    $held = Get-VmTestLock
    if ($held -and $held.checkpoint -ne $Task.Checkpoint -and -not $Force) {
        throw ("The test VM is in use by $($held.repo) / $($held.branch) since $($held.since). " +
            "That task should run 'vmtest save' or 'vmtest end' first. Use -Force only if that task is abandoned; its unsaved VM state is lost.")
    }
    $dir = Split-Path (Get-LockPath)
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [pscustomobject]@{ repo = $Task.Repo; branch = $Task.Branch; checkpoint = $Task.Checkpoint; since = (Get-Date).ToString('s') } |
        ConvertTo-Json | Set-Content (Get-LockPath) -Encoding UTF8
}

function Clear-VmTestLock {
    $p = Get-LockPath
    if (Test-Path $p) { Remove-Item $p -Force }
}

function Assert-LockedBy {
    param([Parameter(Mandatory)]$Task)
    $held = Get-VmTestLock
    if (-not $held) { throw "No task has the test VM. Run 'vmtest begin' first." }
    if ($held.checkpoint -ne $Task.Checkpoint) {
        throw "The test VM belongs to $($held.repo) / $($held.branch), not $($Task.Repo) / $($Task.Branch)."
    }
}

# ---- the VM ------------------------------------------------------------------------------------

function Get-TestVM {
    $name = (Get-VmTestConfig).VMName
    $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
    if (-not $vm) {
        throw "There's no VM named '$name'. Build one with Hyper-V Manage, then run 'vmtest prepare'."
    }
    $vm
}

function Get-TaskCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    Get-VMSnapshot -VMName (Get-VmTestConfig).VMName -ErrorAction SilentlyContinue | Where-Object Name -eq $Name
}

function Assert-CleanCheckpoint {
    if (-not (Get-TaskCheckpoint $script:CleanCheckpoint)) {
        throw "The test VM has no '$script:CleanCheckpoint' checkpoint. Run 'vmtest prepare' once to make it."
    }
}

# Put the VM back to a checkpoint. The VM's current state is thrown away, which is the point:
# callers hold the lock, and anything worth keeping was saved by 'vmtest save'.
function Restore-TestCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    $vm = Get-TestVM
    $cp = Get-TaskCheckpoint $Name
    if (-not $cp) { throw "The test VM has no checkpoint named '$Name'." }
    if ($vm.State -ne 'Off' -and $vm.State -ne 'Saved') { Stop-VM -VM $vm -TurnOff -Force }
    Restore-VMSnapshot -VMSnapshot $cp -Confirm:$false
}

# Take a checkpoint of the VM as it is now under this name, replacing any older one. The new
# checkpoint is made first under a temporary name, so the old one is only dropped once the new one exists.
function Save-TestCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    $vm = Get-TestVM
    $temp = "$Name (new)"
    Get-TaskCheckpoint $temp | ForEach-Object { Remove-VMSnapshot -VMSnapshot $_ -Confirm:$false }
    $old = Get-TaskCheckpoint $Name
    # Use the object Checkpoint-VM hands back: Get-VMSnapshot can take a moment to list a new checkpoint.
    $new = Checkpoint-VM -VM $vm -SnapshotName $temp -Passthru
    if (-not $new) { throw "Hyper-V didn't make the checkpoint '$temp'." }
    if ($old) { Remove-VMSnapshot -VMSnapshot $old -Confirm:$false }
    Rename-VMSnapshot -VMSnapshot $new -NewName $Name
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Get-TaskCheckpoint $Name)) {
        if ((Get-Date) -gt $deadline) { throw "The checkpoint was made but couldn't be renamed to '$Name'; it's called '$temp'." }
        Start-Sleep -Milliseconds 500
    }
}

function New-GuestSession {
    param([int]$TimeoutSec = 180)
    $name = (Get-VmTestConfig).VMName
    $cred = Get-GuestCredential
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ($true) {
        try { return New-PSSession -VMName $name -Credential $cred -ErrorAction Stop }
        catch {
            if ((Get-Date) -gt $deadline) { throw "Couldn't reach Windows inside '$name' over PowerShell Direct: $($_.Exception.Message)" }
            Start-Sleep -Seconds 5
        }
    }
}

# Wait until the test account is signed in on the VM's console, because apps can only be seen
# and driven in that session.
function Wait-GuestSignedIn {
    param([int]$TimeoutSec = 180)
    $user = (Get-VmTestConfig).UserName
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $session = New-GuestSession -TimeoutSec $TimeoutSec
    try {
        while ($true) {
            $users = Invoke-Command -Session $session -ScriptBlock { (quser 2>&1) -join "`n" }
            if ($users -match "(?m)^\W*$([regex]::Escape($user))\s+console\b.*Active") { return }
            if ((Get-Date) -gt $deadline) {
                throw "'$user' isn't signed in on the test VM's screen. Automatic sign-in may be off; run 'vmtest prepare'."
            }
            Start-Sleep -Seconds 5
        }
    } finally { Remove-PSSession $session }
}

function Install-GuestAgent {
    param([Parameter(Mandatory)]$Session)
    Invoke-Command -Session $Session -ScriptBlock { param($root) New-Item $root -ItemType Directory -Force | Out-Null } -ArgumentList $script:GuestRoot
    Copy-Item (Join-Path $PSScriptRoot 'guest\agent.ps1') -Destination $script:GuestRoot -ToSession $Session -Force
    $user = (Get-VmTestConfig).UserName
    Invoke-Command -Session $Session -ArgumentList $script:GuestRoot, $script:AgentTask, $user -ScriptBlock {
        param($root, $taskName, $user)
        # conhost --headless runs PowerShell with no console window, so the agent never takes focus
        # from the app it is testing.
        $action = New-ScheduledTaskAction -Execute 'conhost.exe' `
            -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $root\agent.ps1"
        $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$user" -LogonType Interactive -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 65) -MultipleInstances IgnoreNew `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    }
}

# Send one request to the agent in the VM and return its answer.
function Invoke-GuestAgent {
    param([Parameter(Mandatory)][hashtable]$Request, [int]$TimeoutSec = 60)
    $Request.id = [guid]::NewGuid().ToString()
    $json = $Request | ConvertTo-Json -Depth 5 -Compress
    $session = New-GuestSession -TimeoutSec 30
    try {
        $raw = Invoke-Command -Session $session -ArgumentList $json, $Request.id, $TimeoutSec, $script:GuestRoot, $script:AgentTask -ScriptBlock {
            param($json, $id, $timeout, $root, $taskName)
            if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
                throw "The vmtest agent isn't installed in the VM. Run 'vmtest begin'."
            }
            Set-Content (Join-Path $root 'request.json') $json -Encoding UTF8
            Start-ScheduledTask -TaskName $taskName
            $deadline = (Get-Date).AddSeconds($timeout)
            $answer = Join-Path $root 'response.json'
            while ((Get-Date) -lt $deadline) {
                if (Test-Path $answer) {
                    $text = Get-Content $answer -Raw
                    if ($text -match [regex]::Escape($id)) { return $text }
                }
                Start-Sleep -Milliseconds 250
            }
            throw "The agent in the VM didn't answer within $timeout seconds."
        }
    } finally { Remove-PSSession $session }
    $response = $raw | ConvertFrom-Json
    if (-not $response.ok) { throw "In the test VM: $($response.error)" }
    $response
}

# ---- commands ----------------------------------------------------------------------------------

function Invoke-VmTestPrepare {
    # One time, on a freshly built VM: sign the test account in automatically, keep the screen on,
    # install the agent, and take the Clean checkpoint every task starts from.
    param([switch]$Force)
    $vm = Get-TestVM
    if ((Get-TaskCheckpoint $script:CleanCheckpoint) -and -not $Force) {
        throw "'$($vm.Name)' already has a Clean checkpoint. Use -Force to replace it."
    }
    if ($vm.State -ne 'Running') { Start-VM -VM $vm }
    $c = Get-VmTestConfig
    $session = New-GuestSession
    try {
        Invoke-Command -Session $session -ArgumentList $c.UserName, $c.Password -ScriptBlock {
            param($user, $password)
            $winlogon = 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
            # Passwordless sign-in (the default on new Windows 11 installs) blocks automatic sign-in.
            reg add 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device' /v DevicePasswordLessBuildVersion /t REG_DWORD /d 0 /f | Out-Null
            reg add $winlogon /v AutoAdminLogon /t REG_SZ /d 1 /f | Out-Null
            reg add $winlogon /v DefaultUserName /t REG_SZ /d $user /f | Out-Null
            reg add $winlogon /v DefaultPassword /t REG_SZ /d $password /f | Out-Null
            reg add $winlogon /v DefaultDomainName /t REG_SZ /d $env:COMPUTERNAME /f | Out-Null
            reg add 'HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization' /v NoLockScreen /t REG_DWORD /d 1 /f | Out-Null
            powercfg /change monitor-timeout-ac 0
            powercfg /change standby-timeout-ac 0
            # Restart from inside Windows: a hard reset from the host can lose registry changes
            # that haven't been written to disk yet.
            shutdown /r /t 5 /f
        }
    } finally { Remove-PSSession $session }
    Start-Sleep -Seconds 30
    Wait-GuestSignedIn -TimeoutSec 300
    $session = New-GuestSession
    try { Install-GuestAgent -Session $session } finally { Remove-PSSession $session }
    Start-Sleep -Seconds 20   # let the desktop settle before it is captured
    Save-TestCheckpoint $script:CleanCheckpoint
    Save-VM -VM $vm
    "Prepared '$($vm.Name)': it signs in by itself, has the agent installed, and is saved as the '$script:CleanCheckpoint' checkpoint."
}

function Invoke-VmTestBegin {
    param([string]$Repo, [string]$Branch, [switch]$Force)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    $vm = Get-TestVM
    Assert-CleanCheckpoint
    $held = Get-VmTestLock
    Set-VmTestLock -Task $task -Force:$Force
    $resumed = $held -and $held.checkpoint -eq $task.Checkpoint -and $vm.State -eq 'Running'
    if ($resumed) {
        $from = 'the running VM (this task already had it)'
    } else {
        $from = if (Get-TaskCheckpoint $task.Checkpoint) { $task.Checkpoint } else { $script:CleanCheckpoint }
        Restore-TestCheckpoint $from
        Start-VM -VM (Get-TestVM)
    }
    Wait-GuestSignedIn
    $session = New-GuestSession
    try { Install-GuestAgent -Session $session } finally { Remove-PSSession $session }
    "The test VM is ready for $($task.Repo) / $($task.Branch), started from $from."
}

function Invoke-VmTestDeploy {
    # Copy a build folder (or one file) into the VM, replacing what an earlier deploy put there.
    param([Parameter(Mandatory)][string]$Path, [string]$Name)
    $source = (Resolve-Path $Path).Path
    if (-not $Name) { $Name = Split-Path $source -Leaf }
    if ($Name -notmatch '^[A-Za-z0-9._-]+$') { throw "Use a simple folder name for -Name (letters, digits, . _ -), not '$Name'." }
    $target = "$script:GuestRoot\apps\$Name"
    $session = New-GuestSession
    try {
        Invoke-Command -Session $session -ArgumentList $target -ScriptBlock {
            param($target)
            if (Test-Path $target) { Remove-Item $target -Recurse -Force }
            New-Item $target -ItemType Directory -Force | Out-Null
        }
        if (Test-Path $source -PathType Container) {
            Copy-Item (Join-Path $source '*') -Destination $target -ToSession $session -Recurse -Force
        } else {
            Copy-Item $source -Destination $target -ToSession $session -Force
        }
        $count = Invoke-Command -Session $session -ArgumentList $target -ScriptBlock { param($t) @(Get-ChildItem $t -Recurse -File).Count }
    } finally { Remove-PSSession $session }
    "Copied $count file(s) to $target in the test VM."
}

function Invoke-VmTestShot {
    # A picture of the VM's screen. By default the agent takes it inside the VM at full size; -FromHost
    # asks Hyper-V instead, which works even when nobody is signed in, up to 1024x768.
    param([Parameter(Mandatory)][string]$Out, [switch]$FromHost)
    $Out = [System.IO.Path]::GetFullPath($Out)
    if ($FromHost) {
        Save-HostScreenshot -Out $Out
        return "Saved the VM's screen, from Hyper-V, to $Out"
    }
    $r = Invoke-GuestAgent @{ op = 'shot' }
    $session = New-GuestSession
    try { Copy-Item "$script:GuestRoot\shot.png" -Destination $Out -FromSession $session -Force } finally { Remove-PSSession $session }
    "Saved the VM's screen ($($r.result)) to $Out"
}

function Save-HostScreenshot {
    param([Parameter(Mandatory)][string]$Out, [int]$Width = 1024, [int]$Height = 768)
    Add-Type -AssemblyName System.Drawing
    $ns = 'root\virtualization\v2'
    $name = (Get-VmTestConfig).VMName
    $system = Get-CimInstance -Namespace $ns -ClassName Msvm_ComputerSystem -Filter "ElementName='$($name -replace "'", "''")'"
    if (-not $system) { throw "Hyper-V doesn't know a VM named '$name'." }
    $settings = Get-CimAssociatedInstance -InputObject $system -ResultClassName Msvm_VirtualSystemSettingData |
        Where-Object VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized'
    $service = Get-CimInstance -Namespace $ns -ClassName Msvm_VirtualSystemManagementService
    $r = Invoke-CimMethod -InputObject $service -MethodName GetVirtualSystemThumbnailImage -Arguments @{
        TargetSystem = $settings; WidthPixels = [uint16]$Width; HeightPixels = [uint16]$Height }
    if ($r.ReturnValue -ne 0) { throw "Hyper-V couldn't take a picture of the VM's screen (code $($r.ReturnValue)). Is it running?" }
    # Hyper-V returns raw 16-bit RGB565 pixels.
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
    try {
        $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)), 'WriteOnly', $bmp.PixelFormat)
        $bytes = [byte[]]$r.ImageData
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, [Math]::Min($bytes.Length, $data.Stride * $Height))
        $bmp.UnlockBits($data)
        $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
}

function Invoke-VmTestSave {
    # Keep this task's VM state (open apps and all) as its checkpoint, park the VM, and free it for other tasks.
    param([string]$Repo, [string]$Branch)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    Assert-LockedBy $task
    Save-TestCheckpoint $task.Checkpoint
    $vm = Get-TestVM
    if ($vm.State -eq 'Running') { Save-VM -VM $vm }
    Clear-VmTestLock
    "Saved the test VM as '$($task.Checkpoint)' and released it. 'vmtest begin' on this branch picks up from here."
}

function Invoke-VmTestEnd {
    # The task is merged: drop its checkpoint and put the VM back to Clean.
    param([string]$Repo, [string]$Branch, [switch]$Force)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    $held = Get-VmTestLock
    if ($held -and $held.checkpoint -ne $task.Checkpoint -and -not $Force) {
        # Another task is using the VM right now. Only drop this task's checkpoint; leave the VM alone.
        $cp = Get-TaskCheckpoint $task.Checkpoint
        if ($cp) { Remove-VMSnapshot -VMSnapshot $cp -Confirm:$false }
        return "Removed '$($task.Checkpoint)'. The VM itself is in use by $($held.repo) / $($held.branch), so it was left as it is."
    }
    Assert-CleanCheckpoint
    $cp = Get-TaskCheckpoint $task.Checkpoint
    if ($cp) { Remove-VMSnapshot -VMSnapshot $cp -Confirm:$false }
    Restore-TestCheckpoint $script:CleanCheckpoint
    Clear-VmTestLock
    $what = if ($cp) { "Removed '$($task.Checkpoint)' and put" } else { 'There was no checkpoint for this task. Put' }
    "$what the test VM back to '$script:CleanCheckpoint'."
}

function Get-VmTestStatus {
    $vm = Get-TestVM
    $held = Get-VmTestLock
    $lines = @("VM '$($vm.Name)': $($vm.State)")
    $lines += if ($held) { "In use by $($held.repo) / $($held.branch) since $($held.since)" } else { 'Free' }
    $cps = @(Get-VMSnapshot -VM $vm)
    $lines += "Checkpoints: " + $(if ($cps) { ($cps | ForEach-Object { $_.Name }) -join ', ' } else { 'none' })
    $lines
}

Export-ModuleMember -Function Get-VmTestConfig, ConvertTo-TaskCheckpointName, Resolve-Task,Get-VmTestLock,
    Set-VmTestLock, Clear-VmTestLock, Assert-LockedBy, Invoke-GuestAgent, Invoke-VmTestPrepare, Invoke-VmTestBegin,
    Invoke-VmTestDeploy, Invoke-VmTestShot, Invoke-VmTestSave, Invoke-VmTestEnd, Get-VmTestStatus

# vmtest: lets Claude test Windows apps inside a Hyper-V VM instead of on the host, so the host's
# focus, keyboard and screen reader are never touched. Host side; the guest side is guest\agent.ps1.
#
# Everything here works without elevation for a member of the Hyper-V Administrators group.
# The VM talks over PowerShell Direct (Invoke-Command -VMName), so it needs no network and opens no window.

$ErrorActionPreference = 'Stop'

$script:GuestRoot = 'C:\vmtest'
$script:AgentTask = 'vmtest-agent'             # runs as the signed-in user, without admin rights
$script:AdminAgentTask = 'vmtest-agent-admin'  # the same, with admin rights, for -Elevated
$script:CleanCheckpoint = 'Clean'
$script:MaxRunSeconds = 3600                   # the agent's scheduled task allows 65 minutes

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

function Get-ShortHash([string]$Text) {
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try { -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))[0..2] | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

# The checkpoint a task's VM state is kept in. The readable part loses characters Hyper-V names
# shouldn't have, so a short hash of the exact repo and branch keeps 'feature/a' and 'feature-a' apart.
function ConvertTo-TaskCheckpointName {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Branch)
    $readable = ConvertTo-LegacyCheckpointName $Repo $Branch
    if ($readable.Length -gt 80) { $readable = $readable.Substring(0, 80) }
    "$readable $(Get-ShortHash "$Repo`n$Branch")"
}

# The name the first version used, without the hash. Kept so its checkpoints are found and renamed.
function ConvertTo-LegacyCheckpointName {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Branch)
    $clean = { param($s) ($s -replace '[^A-Za-z0-9._-]+', '-').Trim('-') }
    $repoPart = & $clean $Repo
    $branchPart = & $clean $Branch
    if (-not $repoPart -or -not $branchPart) { throw "Can't make a checkpoint name from repo '$Repo' and branch '$Branch'." }
    $name = "task $repoPart $branchPart"
    if ($name.Length -gt 100) { $name = $name.Substring(0, 100) }
    $name
}

# Git's answer, or nothing if git fails. Its error text goes nowhere: under 'Stop', Windows PowerShell
# would otherwise turn git's stderr into an error even with 2>$null.
function Invoke-GitQuietly {
    $ErrorActionPreference = 'Continue'
    $out = & git @args 2>$null
    if ($LASTEXITCODE -eq 0) { $out }
}

# The repo and branch of the folder Claude is working in, when they weren't given.
function Resolve-Task {
    param([string]$Repo, [string]$Branch, [string]$Path = (Get-Location).Path)
    if (-not $Repo -or -not $Branch) {
        $top = Invoke-GitQuietly -C $Path rev-parse --show-toplevel
        if (-not $Repo) {
            if (-not $top) { throw "Not in a git repository; give -Repo and -Branch." }
            # A worktree's folder is named after the branch, so use the main checkout's folder name.
            $common = Invoke-GitQuietly -C $Path rev-parse --path-format=absolute --git-common-dir
            $Repo = if ($common -and (Split-Path $common -Leaf) -eq '.git') { Split-Path (Split-Path $common) -Leaf } else { Split-Path $top -Leaf }
        }
        if (-not $Branch) {
            $Branch = Invoke-GitQuietly -C $Path branch --show-current
            if (-not $Branch) { throw "Can't tell the current branch (detached HEAD?); give -Branch." }
        }
    }
    [pscustomobject]@{
        Repo       = $Repo
        Branch     = $Branch
        Checkpoint = ConvertTo-TaskCheckpointName $Repo $Branch
        Legacy     = ConvertTo-LegacyCheckpointName $Repo $Branch
    }
}

# ---- the lock: one task uses the VM at a time --------------------------------------------------

function Get-LockPath { Join-Path (Get-VmTestConfig).StateDir 'lock.json' }

function Get-VmTestLock {
    $p = Get-LockPath
    if (-not (Test-Path $p)) { return }
    try { Get-Content $p -Raw | ConvertFrom-Json }
    catch { throw "The lock file $p is damaged. If no task is using the test VM, delete that file." }
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
    # Write a temporary file and rename it, so a crash never leaves half a lock file.
    $temp = "$(Get-LockPath).tmp"
    [pscustomobject]@{ repo = $Task.Repo; branch = $Task.Branch; checkpoint = $Task.Checkpoint; since = (Get-Date).ToString('s') } |
        ConvertTo-Json | Set-Content $temp -Encoding UTF8
    Move-Item $temp (Get-LockPath) -Force
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

# Commands that change the VM or the lock run one at a time across every vmtest on this PC, so
# two sessions can't both see the VM as free and both take it.
function Use-VmTestMutex {
    param([Parameter(Mandatory)][scriptblock]$Script)
    $mutex = New-Object System.Threading.Mutex($false, 'Local\vmtest-lock')
    try {
        try { $got = $mutex.WaitOne([TimeSpan]::FromMinutes(10)) }
        catch [System.Threading.AbandonedMutexException] { $got = $true }  # a vmtest that crashed held it
        if (-not $got) { throw "Another vmtest command has been changing the test VM for 10 minutes. Try again later." }
        try { & $Script } finally { $mutex.ReleaseMutex() }
    } finally { $mutex.Dispose() }
}

# For commands that work inside the VM: this task must hold it, and it must be running.
function Assert-TaskHasVM {
    param([string]$Repo, [string]$Branch)
    Assert-LockedBy (Resolve-Task -Repo $Repo -Branch $Branch)
    $vm = Get-TestVM
    if ($vm.State -ne 'Running') { throw "The test VM is $($vm.State). Run 'vmtest begin' again." }
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

function Get-CheckpointNames {
    @(Get-VMSnapshot -VMName (Get-VmTestConfig).VMName -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}

function Test-Checkpoint([string]$Name) { (Get-CheckpointNames) -contains $Name }

function Wait-Checkpoint([string]$Name, [int]$Seconds = 20) {
    # Get-VMSnapshot can take a moment to list a checkpoint that was just made or renamed.
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not (Test-Checkpoint $Name)) {
        if ((Get-Date) -gt $deadline) { throw "Hyper-V didn't list the checkpoint '$Name' within $Seconds seconds." }
        Start-Sleep -Milliseconds 500
    }
}

function Rename-TestCheckpoint([string]$Name, [string]$NewName) {
    Rename-VMSnapshot -VMName (Get-VmTestConfig).VMName -Name $Name -NewName $NewName
    Wait-Checkpoint $NewName
}

function Remove-TestCheckpoint([string]$Name) {
    if (Test-Checkpoint $Name) { Remove-VMSnapshot -VMName (Get-VmTestConfig).VMName -Name $Name -Confirm:$false }
}

# Finish a save that was cut short, so a task's state is never left under a name 'begin' won't look
# for: a missing checkpoint is recovered from its '(new)' copy, then '(old)', then the name the first
# version of vmtest used. Leftover copies go only once the real one exists.
function Repair-TaskCheckpoint {
    param([Parameter(Mandatory)][string]$Name, [string]$Legacy)
    $names = Get-CheckpointNames
    if ($names -notcontains $Name) {
        foreach ($candidate in @("$Name (new)", "$Name (old)", $Legacy)) {
            if ($candidate -and $names -contains $candidate) { Rename-TestCheckpoint $candidate $Name; break }
        }
    }
    if (Test-Checkpoint $Name) {
        Remove-TestCheckpoint "$Name (new)"
        Remove-TestCheckpoint "$Name (old)"
    }
}

# Take a checkpoint of the VM as it is now under this name, replacing any older one. Every step
# leaves a state Repair-TaskCheckpoint can finish: the new checkpoint is made first, the old one is
# moved aside, the new one takes the name, and only then is the old one deleted.
function Save-TestCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    $vmName = (Get-VmTestConfig).VMName
    Repair-TaskCheckpoint $Name
    Remove-TestCheckpoint "$Name (new)"
    Checkpoint-VM -Name $vmName -SnapshotName "$Name (new)"
    Wait-Checkpoint "$Name (new)"
    if (Test-Checkpoint $Name) { Rename-TestCheckpoint $Name "$Name (old)" }
    Rename-TestCheckpoint "$Name (new)" $Name
    Remove-TestCheckpoint "$Name (old)"
}

function Assert-CleanCheckpoint {
    Repair-TaskCheckpoint $script:CleanCheckpoint
    if (-not (Test-Checkpoint $script:CleanCheckpoint)) {
        throw "The test VM has no '$script:CleanCheckpoint' checkpoint. Run 'vmtest prepare' once to make it."
    }
}

# Put the VM back to a checkpoint. The VM's current state is thrown away, which is the point:
# callers hold the lock, and anything worth keeping was saved by 'vmtest save'.
function Restore-TestCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    $vm = Get-TestVM
    if (-not (Test-Checkpoint $Name)) { throw "The test VM has no checkpoint named '$Name'." }
    if ($vm.State -ne 'Off' -and $vm.State -ne 'Saved') { Stop-VM -Name $vm.Name -TurnOff -Force }
    Restore-VMSnapshot -VMName $vm.Name -Name $Name -Confirm:$false
}

# Standard checkpoints keep the running VM's memory, so a task comes back with its apps still open.
# New VMs use Production checkpoints, which save a shut-down VM instead.
function Set-StandardCheckpoints {
    $vm = Get-TestVM
    if ($vm.CheckpointType -ne 'Standard') { Set-VM -Name $vm.Name -CheckpointType Standard }
}

function New-GuestSession {
    param([int]$TimeoutSec = 180)
    $name = (Get-VmTestConfig).VMName
    $cred = Get-GuestCredential
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ($true) {
        try { return New-PSSession -VMName $name -Credential $cred -ErrorAction Stop }
        catch {
            $message = $_.Exception.Message
            if ($message -match 'credential|user name or password|logon failure|access is denied') {
                throw "Windows in '$name' refused the test account '$((Get-VmTestConfig).UserName)': $message"
            }
            $state = (Get-VM -Name $name -ErrorAction SilentlyContinue).State
            if ($state -and $state -ne 'Running') { throw "The test VM is $state. Run 'vmtest begin'." }
            if ((Get-Date) -gt $deadline) { throw "Couldn't reach Windows inside '$name' over PowerShell Direct: $message" }
            Start-Sleep -Seconds 5
        }
    }
}

# Wait until the test account is signed in on the VM's own screen, because apps can only be seen and
# driven there. A Remote Desktop visit takes that session away; once it has disconnected, the session
# is moved back to the screen.
function Wait-GuestSignedIn {
    param([int]$TimeoutSec = 180)
    $user = (Get-VmTestConfig).UserName
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $session = New-GuestSession -TimeoutSec $TimeoutSec
    try {
        while ($true) {
            $lines = Invoke-Command -Session $session -ScriptBlock { quser 2>&1 | ForEach-Object { [string]$_ } }
            $state = Get-SignInState -QuserLines $lines -UserName $user
            switch ($state.State) {
                'console' { return }
                'disconnected' {
                    Invoke-Command -Session $session -ArgumentList $state.Id -ScriptBlock { param($id) tscon.exe $id /dest:console 2>&1 | Out-Null }
                }
                'remote' {
                    throw "'$user' is signed in to the test VM over Remote Desktop, which takes its screen away from vmtest. Disconnect Remote Desktop, then try again."
                }
            }
            if ((Get-Date) -gt $deadline) {
                throw "'$user' isn't signed in on the test VM's screen. Automatic sign-in may be off; run 'vmtest prepare'."
            }
            Start-Sleep -Seconds 5
        }
    } finally { Remove-PSSession $session }
}

# Reads quser's table: is the user on the console, in a disconnected session, or in a Remote Desktop one?
function Get-SignInState {
    param([string[]]$QuserLines, [Parameter(Mandatory)][string]$UserName)
    foreach ($line in $QuserLines) {
        if ($line -match "^\W*$([regex]::Escape($UserName))\s+(?:(\S+)\s+)?(\d+)\s+(Active|Disc)\b") {
            $sessionName = $Matches[1]
            $state = if ($Matches[3] -eq 'Disc') { 'disconnected' } elseif ($sessionName -eq 'console') { 'console' } else { 'remote' }
            return [pscustomobject]@{ State = $state; Id = [int]$Matches[2] }
        }
    }
    [pscustomobject]@{ State = 'none'; Id = $null }
}

function Install-GuestAgent {
    param([Parameter(Mandatory)]$Session)
    $user = (Get-VmTestConfig).UserName
    Invoke-Command -Session $Session -ArgumentList $script:GuestRoot, $user -ScriptBlock {
        param($root, $user)
        New-Item $root -ItemType Directory -Force | Out-Null
        # The agent usually runs without admin rights, so the user needs to write here.
        icacls.exe $root /grant "${user}:(OI)(CI)M" /Q | Out-Null
    }
    Copy-Item (Join-Path $PSScriptRoot 'guest\agent.ps1') -Destination $script:GuestRoot -ToSession $Session -Force
    Invoke-Command -Session $Session -ArgumentList $script:GuestRoot, $user, $script:AgentTask, $script:AdminAgentTask -ScriptBlock {
        param($root, $user, $taskName, $adminTaskName)
        # conhost --headless runs PowerShell with no console window, so the agent never takes focus
        # from the app it is testing.
        $action = New-ScheduledTaskAction -Execute 'conhost.exe' `
            -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $root\agent.ps1"
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 65) -MultipleInstances IgnoreNew `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        foreach ($t in @(@($taskName, 'Limited'), @($adminTaskName, 'Highest'))) {
            $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$user" -LogonType Interactive -RunLevel $t[1]
            Register-ScheduledTask -TaskName $t[0] -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        }
    }
}

# Send one request to the agent in the VM and return its answer. -Elevated uses the agent that runs
# with admin rights; programs it starts are elevated too.
function Invoke-GuestAgent {
    param([Parameter(Mandatory)][hashtable]$Request, [int]$TimeoutSec = 60, [switch]$Elevated)
    $Request.id = [guid]::NewGuid().ToString()
    $json = $Request | ConvertTo-Json -Depth 5 -Compress
    $taskName = if ($Elevated) { $script:AdminAgentTask } else { $script:AgentTask }
    $session = New-GuestSession -TimeoutSec 30
    try {
        $answer = Invoke-Command -Session $session -ArgumentList $json, $Request.id, $TimeoutSec, $script:GuestRoot, $taskName, @($script:AgentTask, $script:AdminAgentTask) -ScriptBlock {
            param($json, $id, $timeout, $root, $taskName, $allTasks)
            if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
                throw "The vmtest agent isn't installed in the VM. Run 'vmtest begin'."
            }
            # A still-running agent would make Task Scheduler ignore the new start, so stop it first.
            $note = $null
            foreach ($t in $allTasks) {
                if ((Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue).State -eq 'Running') {
                    Start-Sleep -Seconds 3
                    if ((Get-ScheduledTask -TaskName $t).State -eq 'Running') {
                        Stop-ScheduledTask -TaskName $t
                        $note = 'The agent was still busy with an earlier request, which was stopped.'
                    }
                }
            }
            $responsePath = Join-Path $root 'response.json'
            Remove-Item $responsePath -Force -ErrorAction SilentlyContinue
            Set-Content (Join-Path $root 'request.json') $json -Encoding UTF8
            Start-ScheduledTask -TaskName $taskName
            $deadline = (Get-Date).AddSeconds($timeout)
            while ((Get-Date) -lt $deadline) {
                $text = $null
                try { $text = [System.IO.File]::ReadAllText($responsePath) } catch {}
                if ($text -and $text.Contains($id)) { return @{ text = $text; note = $note } }
                Start-Sleep -Milliseconds 250
            }
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            throw "The agent in the VM didn't answer within $timeout seconds, so it was stopped. The request may have left a dialog or a stuck program open in the VM."
        }
    } finally { Remove-PSSession $session }
    $response = $answer.text | ConvertFrom-Json
    if (-not $response.ok) { throw "In the test VM: $($response.error)" }
    if ($answer.note) {
        $warning = (@($answer.note, $response.warning) | Where-Object { $_ }) -join ' '
        $response | Add-Member -NotePropertyName warning -NotePropertyValue $warning -Force
    }
    $response
}

# ---- commands ----------------------------------------------------------------------------------

function Invoke-VmTestPrepare {
    # One time, on a freshly built VM: sign the test account in automatically, keep the screen on,
    # install the agent, and take the Clean checkpoint every task starts from. Also used to refresh
    # Clean: run it with -Force while the VM is held by a throwaway task (see README).
    param([string]$Repo, [string]$Branch, [switch]$Force)
    Use-VmTestMutex {
        $vm = Get-TestVM
        $held = Get-VmTestLock
        if ($held) {
            $mine = $false
            try { $mine = (Resolve-Task -Repo $Repo -Branch $Branch).Checkpoint -eq $held.checkpoint } catch {}
            if (-not $mine -and -not $Force) {
                throw "The test VM is in use by $($held.repo) / $($held.branch). Prepare reboots it, so wait until that task runs 'vmtest save' or 'vmtest end'."
            }
        }
        if ((Test-Checkpoint $script:CleanCheckpoint) -and -not $Force) {
            throw "'$($vm.Name)' already has a Clean checkpoint. Use -Force to replace it."
        }
        Set-StandardCheckpoints
        if ($vm.State -ne 'Running') { Start-VM -Name $vm.Name }
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
        Save-VM -Name $vm.Name
        Clear-VmTestLock
        "Prepared '$($vm.Name)': it signs in by itself, has the agent installed, and is saved as the '$script:CleanCheckpoint' checkpoint. The VM is free."
    }
}

function Invoke-VmTestBegin {
    param([string]$Repo, [string]$Branch, [switch]$Force)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    Use-VmTestMutex {
        $vm = Get-TestVM
        Assert-CleanCheckpoint
        $held = Get-VmTestLock
        Set-VmTestLock -Task $task -Force:$Force
        Set-StandardCheckpoints
        Repair-TaskCheckpoint $task.Checkpoint $task.Legacy
        if ($held -and $held.checkpoint -eq $task.Checkpoint) {
            # This task already has the VM: carry on from wherever it is, never restore over it.
            switch ($vm.State) {
                'Running' { $from = 'the running VM (this task already had it)' }
                'Paused' { Resume-VM -Name $vm.Name; $from = 'the paused VM (this task already had it)' }
                'Saved' { Start-VM -Name $vm.Name; $from = 'where this task left it (the VM had been saved)' }
                default { Start-VM -Name $vm.Name; $from = "a fresh start: the VM was $($vm.State), so its disk is as this task left it but open programs are gone" }
            }
        } else {
            $from = if (Test-Checkpoint $task.Checkpoint) { "this task's checkpoint '$($task.Checkpoint)'" } else { $script:CleanCheckpoint }
            Restore-TestCheckpoint $(if (Test-Checkpoint $task.Checkpoint) { $task.Checkpoint } else { $script:CleanCheckpoint })
            Start-VM -Name $vm.Name
        }
        Wait-GuestSignedIn
        $session = New-GuestSession
        try { Install-GuestAgent -Session $session } finally { Remove-PSSession $session }
        "The test VM is ready for $($task.Repo) / $($task.Branch), started from $from."
    }
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
            # Each item, hidden ones included ('*' alone skips hidden files).
            Get-ChildItem $source -Force | ForEach-Object { Copy-Item $_.FullName -Destination $target -ToSession $session -Recurse -Force }
        } else {
            Copy-Item $source -Destination $target -ToSession $session -Force
        }
        $count = Invoke-Command -Session $session -ArgumentList $target -ScriptBlock { param($t) @(Get-ChildItem $t -Recurse -File -Force).Count }
    } finally { Remove-PSSession $session }
    "Copied $count file(s) to $target in the test VM."
}

function Invoke-VmTestPush {
    # Copy one file from this PC into the VM. -Destination is a folder in the VM (default C:\vmtest\files).
    param([Parameter(Mandatory)][string]$Path, [string]$Destination = "$script:GuestRoot\files")
    $source = (Resolve-Path $Path).Path
    if (-not (Test-Path $source -PathType Leaf)) { throw "'$Path' isn't a file. Use 'vmtest deploy' for a folder." }
    $session = New-GuestSession
    try {
        Invoke-Command -Session $session -ArgumentList $Destination -ScriptBlock { param($d) New-Item $d -ItemType Directory -Force | Out-Null }
        Copy-Item $source -Destination $Destination -ToSession $session -Force
    } finally { Remove-PSSession $session }
    "Copied $(Split-Path $source -Leaf) to $Destination\$(Split-Path $source -Leaf) in the test VM."
}

function Invoke-VmTestRun {
    # Run a command line, or a .cmd/.bat/.ps1 file from this PC, inside the VM as the signed-in user.
    # The command goes into a script file in the VM rather than onto a command line, so its quotes
    # don't matter. It still follows batch-file rules: % has to be written %%.
    param([string]$Command, [string]$ScriptFile, [int]$Timeout = 600, [switch]$Elevated)
    if ($Command -and $ScriptFile) { throw "Give a command line or -ScriptFile, not both." }
    if (-not $Command -and -not $ScriptFile) { throw "'vmtest run' needs a command line or -ScriptFile." }
    if ($Timeout -lt 1 -or $Timeout -gt $script:MaxRunSeconds) { throw "-Timeout has to be between 1 and $script:MaxRunSeconds seconds." }
    $source = $null
    if ($ScriptFile) {
        $source = (Resolve-Path $ScriptFile).Path
        $ext = [System.IO.Path]::GetExtension($source).ToLower()
        if ($ext -notin '.cmd', '.bat', '.ps1') { throw "-ScriptFile has to be a .cmd, .bat or .ps1 file." }
    }
    $session = New-GuestSession
    try {
        $dir = "$script:GuestRoot\scripts"
        Invoke-Command -Session $session -ArgumentList $dir -ScriptBlock { param($d) New-Item $d -ItemType Directory -Force | Out-Null }
        if ($source) {
            $target = "$dir\script$ext"
            Copy-Item $source -Destination $target -ToSession $session -Force
        } else {
            $target = "$dir\command.cmd"
            Invoke-Command -Session $session -ArgumentList $target, $Command -ScriptBlock {
                param($t, $c)
                [System.IO.File]::WriteAllText($t, "@echo off`r`n$c`r`n", (New-Object System.Text.UTF8Encoding($false)))
            }
        }
    } finally { Remove-PSSession $session }
    Invoke-GuestAgent @{ op = 'run'; script = $target; timeout = $Timeout } -TimeoutSec ($Timeout + 30) -Elevated:$Elevated
}

function Invoke-VmTestShot {
    # A picture of the VM's screen. By default the agent takes it inside the VM at full size; -FromHost
    # asks Hyper-V instead, which works even when nobody is signed in, up to 1024x768.
    param([Parameter(Mandatory)][string]$Out, [switch]$FromHost)
    # Relative to PowerShell's current folder, not .NET's.
    $Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
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
    Use-VmTestMutex {
        Assert-LockedBy $task
        Save-TestCheckpoint $task.Checkpoint
        $vm = Get-TestVM
        if ($vm.State -eq 'Running') { Save-VM -Name $vm.Name }
        Clear-VmTestLock
        "Saved the test VM as '$($task.Checkpoint)' and released it. 'vmtest begin' on this branch picks up from here."
    }
}

function Invoke-VmTestEnd {
    # The task is merged: drop its checkpoint and put the VM back to Clean.
    param([string]$Repo, [string]$Branch, [switch]$Force)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    Use-VmTestMutex {
        Repair-TaskCheckpoint $task.Checkpoint $task.Legacy
        $had = Test-Checkpoint $task.Checkpoint
        $held = Get-VmTestLock
        if ($held -and $held.checkpoint -ne $task.Checkpoint -and -not $Force) {
            # Another task is using the VM right now. Only drop this task's checkpoint; leave the VM alone.
            Remove-TestCheckpoint $task.Checkpoint
            $what = if ($had) { "Removed '$($task.Checkpoint)'" } else { 'There was no checkpoint for this task' }
            return "$what. The VM itself is in use by $($held.repo) / $($held.branch), so it was left as it is."
        }
        Assert-CleanCheckpoint
        Remove-TestCheckpoint $task.Checkpoint
        Restore-TestCheckpoint $script:CleanCheckpoint
        Clear-VmTestLock
        $what = if ($had) { "Removed '$($task.Checkpoint)' and put" } else { 'There was no checkpoint for this task. Put' }
        "$what the test VM back to '$script:CleanCheckpoint'."
    }
}

function Get-VmTestStatus {
    $vm = Get-TestVM
    $held = Get-VmTestLock
    $lines = @("VM '$($vm.Name)': $($vm.State)")
    $lines += if ($held) { "In use by $($held.repo) / $($held.branch) since $($held.since)" } else { 'Free' }
    $names = Get-CheckpointNames
    $lines += "Checkpoints: " + $(if ($names) { $names -join ', ' } else { 'none' })
    $lines
}

Export-ModuleMember -Function Get-VmTestConfig, ConvertTo-TaskCheckpointName, Resolve-Task, Get-VmTestLock,
    Set-VmTestLock, Clear-VmTestLock, Assert-LockedBy, Assert-TaskHasVM, Invoke-GuestAgent, Invoke-VmTestPrepare,
    Invoke-VmTestBegin, Invoke-VmTestDeploy, Invoke-VmTestPush, Invoke-VmTestRun, Invoke-VmTestShot, Invoke-VmTestSave,
    Invoke-VmTestEnd, Get-VmTestStatus

# vmtest: lets Claude test Windows apps inside a Hyper-V VM instead of on the host, so the host's
# focus, keyboard and screen reader are never touched. Host side; the guest side is guest\agent.ps1.
#
# Everything here works without elevation for a member of the Hyper-V Administrators group.
# The VM talks over PowerShell Direct (Invoke-Command -VMName), so it needs no network and opens no window.
#
# The test VMs are a pool: the first one (ClaudeTesting) and copies of it made from its Clean
# checkpoint. Each task holds at most one VM, and each VM has its own lock.

$ErrorActionPreference = 'Stop'

$script:GuestRoot = 'C:\vmtest'
$script:AgentTask = 'vmtest-agent'             # runs as the signed-in user, without admin rights
$script:AdminAgentTask = 'vmtest-agent-admin'  # the same, with admin rights, for -Elevated
$script:CleanCheckpoint = 'Clean'
$script:MaxRunSeconds = 3600                   # the agent's scheduled task allows 65 minutes
$script:CloneNote = 'vmtest pool VM'           # starts the Notes of every VM 'prepare -Pool' makes
$script:CurrentVM = $null                      # the VM this command is working on

function Get-VmTestConfig {
    [pscustomobject]@{
        VMName       = if ($env:VMTEST_VM) { $env:VMTEST_VM } else { 'ClaudeTesting' }
        UserName     = if ($env:VMTEST_USER) { $env:VMTEST_USER } else { 'vmuser' }
        # The test VM's own throwaway account, the default the VM script creates. Not a real password.
        Password     = if ($env:VMTEST_PASSWORD) { $env:VMTEST_PASSWORD } else { 'vmadmin' }
        StateDir     = if ($env:VMTEST_STATE) { $env:VMTEST_STATE } else { Join-Path $env:LOCALAPPDATA 'vmtest' }
        # A task idle this long is saved and its VM handed on when every VM is busy. 0 turns that off.
        StaleMinutes = ConvertTo-Setting 'VMTEST_STALE_MINUTES' 120
        # Memory this PC keeps for itself: a VM isn't started unless this much would be left over.
        ReserveGB    = ConvertTo-Setting 'VMTEST_RESERVE_GB' 4
    }
}

# A number from an environment variable, with a clear message when it isn't one.
function ConvertTo-Setting([string]$Name, [double]$Default) {
    $text = [Environment]::GetEnvironmentVariable($Name)
    if (-not $text) { return $Default }
    $value = 0.0
    if (-not [double]::TryParse($text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or $value -lt 0) {
        throw "$Name is '$text'; it has to be a number, 0 or more."
    }
    $value
}

function Get-GuestCredential {
    $c = Get-VmTestConfig
    New-Object System.Management.Automation.PSCredential($c.UserName, (ConvertTo-SecureString $c.Password -AsPlainText -Force))
}

# ---- the pool ----------------------------------------------------------------------------------

# How many test VMs this PC can run side by side: one per 5 GB of memory beyond 12 GB for the PC
# itself, one per 4 logical processors, three at most, and always at least one.
function Get-DefaultPoolSize {
    $cs = Get-CimInstance Win32_ComputerSystem
    $byMemory = [math]::Floor(($cs.TotalPhysicalMemory / 1GB - 12) / 5)
    $byCores = [math]::Floor($cs.NumberOfLogicalProcessors / 4)
    [int][math]::Max(1, [math]::Min(3, [math]::Min($byMemory, $byCores)))
}

# The pool's VM names, the first VM first. VMTEST_POOL is a count (the first VM, then copies named
# <first>-2, <first>-3...) or a list of names; unset, the count comes from this PC's memory and cores.
function Get-PoolNames {
    $pool = $env:VMTEST_POOL
    if ($pool -and $pool -notmatch '^\s*\d+\s*$') {
        $names = @()
        foreach ($n in @($pool -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
            # Names become folder and file names, so keep them plain.
            if ($n -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $n -like 'base-*') {
                throw "VMTEST_POOL has '$n', which isn't a usable VM name. Use letters, digits, . _ and -, and don't start it with 'base-'."
            }
            if ($names -notcontains $n) { $names += $n }   # -notcontains ignores case, as Hyper-V does
        }
        if (-not $names) { throw "VMTEST_POOL is '$pool', which names no VMs. Use a count, such as 3, or a list of names." }
        return $names
    }
    $first = (Get-VmTestConfig).VMName
    $count = if ($pool) { [int]$pool } else { Get-DefaultPoolSize }
    $names = @($first)
    for ($i = 2; $i -le $count; $i++) { $names += "$first-$i" }
    $names
}

# The VM the others are copied from, where Clean is kept up to date.
function Get-PrimaryName { @(Get-PoolNames)[0] }

# The VM this command works on: the one its task holds, or the first VM.
function Get-VMName { if ($script:CurrentVM) { $script:CurrentVM } else { Get-PrimaryName } }

# Run a script block against another VM, then go back to the one before.
function Use-TestVM {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Script)
    $before = $script:CurrentVM
    $script:CurrentVM = $Name
    try { & $Script } finally { $script:CurrentVM = $before }
}

# The pool's VMs that exist and have a Clean checkpoint, in pool order. One still being made has no
# Clean yet, so it isn't handed out.
function Get-PoolVMs {
    foreach ($name in Get-PoolNames) {
        $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
        if (-not $vm) { continue }
        Use-TestVM $name { Repair-TaskCheckpoint $script:CleanCheckpoint }
        if (Use-TestVM $name { Test-Checkpoint $script:CleanCheckpoint }) { $vm }
    }
}

function Get-HostFreeMemoryBytes { [int64](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1KB }

# Whether this PC has the memory to start a VM and still keep its reserve. A running VM already has it.
function Test-RoomToStart {
    param([Parameter(Mandatory)]$VM)
    if ($VM.State -eq 'Running' -or $VM.State -eq 'Paused') { return $true }
    (Get-HostFreeMemoryBytes) -ge ($VM.MemoryStartup + (Get-VmTestConfig).ReserveGB * 1GB)
}

function Format-GB([double]$Bytes) { '{0:N1} GB' -f ($Bytes / 1GB) }

function Format-Duration([TimeSpan]$Span) {
    $minutes = [int][math]::Floor($Span.TotalMinutes)
    if ($minutes -lt 1) { return 'under a minute' }
    if ($minutes -lt 60) { return "$minutes minute$(if ($minutes -ne 1) { 's' })" }
    $hours = [math]::Floor($minutes / 60)
    $rest = $minutes % 60
    "$hours hour$(if ($hours -ne 1) { 's' })" + $(if ($rest) { " $rest minute$(if ($rest -ne 1) { 's' })" } else { '' })
}

# A lock's time, read aloud easily: "3:34 PM" today, "Oct 9 3:34 PM" another day.
function Format-Since([string]$Since) {
    $t = [datetime]::Parse($Since)
    if ($t.Date -eq (Get-Date).Date) { $t.ToString('h:mm tt') } else { $t.ToString('MMM d h:mm tt') }
}

# An error 'begin -Wait' waits out: every VM is busy, or there's no memory to start a free one.
function New-BusyError([string]$Message) {
    $e = New-Object System.InvalidOperationException $Message
    $e.Data['vmtestBusy'] = $true
    $e
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

# ---- the locks: one task per VM ----------------------------------------------------------------

# VMTEST_VM (ClaudeTesting) keeps the name the lock had when there was only one VM, so a task that
# held it then still holds it.
function Get-LockPath {
    param([string]$VMName = (Get-VMName))
    $dir = (Get-VmTestConfig).StateDir
    if ($VMName -eq (Get-VmTestConfig).VMName) { Join-Path $dir 'lock.json' }
    else { Join-Path $dir "lock-$($VMName -replace '[^A-Za-z0-9._-]', '_').json" }
}

function Get-ActivityPath {
    param([string]$VMName = (Get-VMName))
    Join-Path (Get-VmTestConfig).StateDir "activity-$($VMName -replace '[^A-Za-z0-9._-]', '_').json"
}

function Get-VmTestLock {
    param([string]$VMName = (Get-VMName))
    $p = Get-LockPath $VMName
    if (-not (Test-Path $p)) { return }
    try { $lock = Get-Content $p -Raw | ConvertFrom-Json }
    catch { throw "The lock file $p is damaged. If no task is using '$VMName', delete that file." }
    $lock | Add-Member -NotePropertyName vm -NotePropertyValue $VMName -Force
    $lock
}

function Write-StateFile {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Content)
    $dir = Split-Path $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # Write a temporary file and rename it, so a crash never leaves half a file.
    $temp = "$Path.$PID.tmp"
    $Content | ConvertTo-Json | Set-Content $temp -Encoding UTF8
    Move-Item $temp $Path -Force
}

function Set-VmTestLock {
    param([Parameter(Mandatory)]$Task, [string]$VMName = (Get-VMName), [switch]$Force)
    $held = Get-VmTestLock $VMName
    if ($held -and $held.checkpoint -ne $Task.Checkpoint -and -not $Force) {
        throw ("'$VMName' is in use by $($held.repo) / $($held.branch) since $(Format-Since $held.since). " +
            "That task should run 'vmtest save' or 'vmtest end' first. Use -Force only if that task is abandoned; its unsaved VM state is lost.")
    }
    Write-StateFile (Get-LockPath $VMName) ([pscustomobject]@{
            repo = $Task.Repo; branch = $Task.Branch; checkpoint = $Task.Checkpoint; since = (Get-Date).ToString('s'); v = 2 })
}

function Clear-VmTestLock {
    param([string]$VMName = (Get-VMName))
    foreach ($p in @((Get-LockPath $VMName), (Get-ActivityPath $VMName))) {
        if (Test-Path $p) { Remove-Item $p -Force }
    }
}

# Note that the task holding a VM just used it, so it isn't taken for idle. Written without the
# mutex, so commands never wait for a 'begin'; a note from a task that no longer holds the VM is ignored.
function Set-TaskActivity {
    param([Parameter(Mandatory)]$Task, [string]$VMName = (Get-VMName))
    try { Write-StateFile (Get-ActivityPath $VMName) ([pscustomobject]@{ checkpoint = $Task.Checkpoint; at = (Get-Date).ToString('s') }) }
    catch { }   # never fail a command over a note
}

# When the task holding a VM last used it: its last command, or when it took the VM.
function Get-LastActivity {
    param([Parameter(Mandatory)]$Lock)
    $last = [datetime]::Parse($Lock.since)
    $p = Get-ActivityPath $Lock.vm
    if (Test-Path $p) {
        try {
            $a = Get-Content $p -Raw | ConvertFrom-Json
            if ($a.checkpoint -eq $Lock.checkpoint -and [datetime]::Parse($a.at) -gt $last) { $last = [datetime]::Parse($a.at) }
        } catch { }
    }
    $last
}

function Test-LockStale {
    param([Parameter(Mandatory)]$Lock)
    # A lock from before the pool has no record of use, so it never looks idle until its task's
    # first command under this version notes one.
    if (-not $Lock.v -and (Get-LastActivity $Lock) -eq [datetime]::Parse($Lock.since)) { return $false }
    $minutes = (Get-VmTestConfig).StaleMinutes
    $minutes -gt 0 -and ((Get-Date) - (Get-LastActivity $Lock)).TotalMinutes -ge $minutes
}

# The pool VM this task holds, or nothing.
function Find-TaskVM {
    param([Parameter(Mandatory)]$Task)
    foreach ($name in Get-PoolNames) {
        $held = Get-VmTestLock $name
        if ($held -and $held.checkpoint -eq $Task.Checkpoint) { return $name }
    }
}

# This task must hold a VM. From here on the command works on that VM.
function Assert-LockedBy {
    param([Parameter(Mandatory)]$Task)
    $name = Find-TaskVM $Task
    if (-not $name) {
        throw ("$($Task.Repo) / $($Task.Branch) doesn't hold a test VM. Run 'vmtest begin' first; it carries on from " +
            "this task's last save, including one made for it after it sat idle.")
    }
    $script:CurrentVM = $name
    $name
}

# Commands that change a VM or a lock run one at a time across every vmtest on this PC, so two
# sessions can't both see a VM as free and both take it.
function Use-VmTestMutex {
    param([Parameter(Mandatory)][scriptblock]$Script, [string]$MutexName = 'Local\vmtest-lock', [int]$WaitMinutes = 10,
        [string]$BusyMessage = "Another vmtest command has been changing the test VMs for $WaitMinutes minutes. Try again later.")
    $mutex = New-Object System.Threading.Mutex($false, $MutexName)
    try {
        try { $got = $mutex.WaitOne([TimeSpan]::FromMinutes($WaitMinutes)) }
        catch [System.Threading.AbandonedMutexException] { $got = $true }  # a vmtest that crashed held it
        if (-not $got) { throw (New-BusyError $BusyMessage) }
        try { & $Script } finally { $mutex.ReleaseMutex() }
    } finally { $mutex.Dispose() }
}

# For commands that work inside the VM: this task must hold one, and it must be running.
function Assert-TaskHasVM {
    param([string]$Repo, [string]$Branch)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    $name = Assert-LockedBy $task
    $vm = Get-TestVM
    if ($vm.State -ne 'Running') { throw "The test VM '$name' is $($vm.State). Run 'vmtest begin' again." }
    Set-TaskActivity $task
}

# ---- the VM ------------------------------------------------------------------------------------

function Get-TestVM {
    param([string]$Name = (Get-VMName))
    $vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
    if (-not $vm) {
        if ($Name -eq (Get-PrimaryName)) { throw "There's no VM named '$Name'. Build one with Hyper-V Manage, then run 'vmtest prepare'." }
        throw "There's no VM named '$Name'. 'vmtest prepare -Pool' makes the pool's VMs."
    }
    $vm
}

function Get-CheckpointNames {
    @(Get-VMSnapshot -VMName (Get-VMName) -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
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
    Rename-VMSnapshot -VMName (Get-VMName) -Name $Name -NewName $NewName
    Wait-Checkpoint $NewName
}

function Remove-TestCheckpoint([string]$Name) {
    if (Test-Checkpoint $Name) { Remove-VMSnapshot -VMName (Get-VMName) -Name $Name -Confirm:$false }
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
    Repair-TaskCheckpoint $Name
    Remove-TestCheckpoint "$Name (new)"
    Checkpoint-VM -Name (Get-VMName) -SnapshotName "$Name (new)"
    Wait-Checkpoint "$Name (new)"
    if (Test-Checkpoint $Name) { Rename-TestCheckpoint $Name "$Name (old)" }
    Rename-TestCheckpoint "$Name (new)" $Name
    Remove-TestCheckpoint "$Name (old)"
}

# Keep a task's state on the VM it holds, park the VM and free it. A copy of the task's state on
# another VM is older, so it goes.
function Save-TaskState {
    param([Parameter(Mandatory)][string]$Checkpoint, [Parameter(Mandatory)][string]$VMName)
    Use-TestVM $VMName {
        Save-TestCheckpoint $Checkpoint
        $vm = Get-TestVM
        if ($vm.State -eq 'Running') { Save-VM -Name $vm.Name }
    }
    foreach ($other in Get-PoolNames) {
        if ($other -eq $VMName -or -not (Get-VM -Name $other -ErrorAction SilentlyContinue)) { continue }
        Use-TestVM $other { Repair-TaskCheckpoint $Checkpoint; Remove-TestCheckpoint $Checkpoint }
    }
    Clear-VmTestLock $VMName
}

function Assert-CleanCheckpoint {
    Repair-TaskCheckpoint $script:CleanCheckpoint
    if (-not (Test-Checkpoint $script:CleanCheckpoint)) {
        throw "The test VM '$(Get-VMName)' has no '$script:CleanCheckpoint' checkpoint. Run 'vmtest prepare' once to make it."
    }
}

# Put the VM back to a checkpoint. The VM's current state is thrown away, which is the point:
# callers hold the lock, and anything worth keeping was saved by 'vmtest save'.
function Restore-TestCheckpoint {
    param([Parameter(Mandatory)][string]$Name)
    $vm = Get-TestVM
    if (-not (Test-Checkpoint $Name)) { throw "The test VM '$($vm.Name)' has no checkpoint named '$Name'." }
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
    $name = Get-VMName
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
            if ($state -and $state -ne 'Running') { throw "The test VM '$name' is $state. Run 'vmtest begin'." }
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
                    throw "'$user' is signed in to the test VM '$(Get-VMName)' over Remote Desktop, which takes its screen away from vmtest. Disconnect Remote Desktop, then try again."
                }
            }
            if ((Get-Date) -gt $deadline) {
                throw "'$user' isn't signed in on the screen of the test VM '$(Get-VMName)'. Automatic sign-in may be off; run 'vmtest prepare'."
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

# Make Windows in the current VM ready for vmtest: sign the test account in automatically, keep the
# screen on, restart, install the agent. -ComputerName also renames Windows, so copies of the first
# VM don't share its name on the network.
function Initialize-TestVM {
    param([string]$ComputerName)
    $c = Get-VmTestConfig
    $session = New-GuestSession -TimeoutSec 300
    try {
        Invoke-Command -Session $session -ArgumentList $c.UserName, $c.Password, $ComputerName -ScriptBlock {
            param($user, $password, $newName)
            $domain = $env:COMPUTERNAME
            if ($newName -and $newName -ne $env:COMPUTERNAME) {
                Rename-Computer -NewName $newName -Force -WarningAction SilentlyContinue
                $domain = $newName
            }
            $winlogon = 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
            # Passwordless sign-in (the default on new Windows 11 installs) blocks automatic sign-in.
            reg add 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device' /v DevicePasswordLessBuildVersion /t REG_DWORD /d 0 /f | Out-Null
            reg add $winlogon /v AutoAdminLogon /t REG_SZ /d 1 /f | Out-Null
            reg add $winlogon /v DefaultUserName /t REG_SZ /d $user /f | Out-Null
            reg add $winlogon /v DefaultPassword /t REG_SZ /d $password /f | Out-Null
            reg add $winlogon /v DefaultDomainName /t REG_SZ /d $domain /f | Out-Null
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
}

# ---- commands ----------------------------------------------------------------------------------

function Invoke-VmTestPrepare {
    # One time, on a freshly built VM: sign the test account in automatically, keep the screen on,
    # install the agent, and take the Clean checkpoint every task starts from. Also used to refresh
    # Clean: run it with -Force while the VM is held by a throwaway task (see README). It works on
    # the VM this task holds, -VM, or the first VM. -Pool makes the pool's other VMs instead.
    param([string]$Repo, [string]$Branch, [string]$VM, [switch]$Pool, [switch]$Force)
    $script:CurrentVM = $null
    if ($Pool) { return Invoke-VmTestPreparePool -Force:$Force }
    Use-VmTestMutex {
        $task = $null
        try { $task = Resolve-Task -Repo $Repo -Branch $Branch } catch {}
        $name = if ($VM) { $VM } elseif ($task -and (Find-TaskVM $task)) { Find-TaskVM $task } else { Get-PrimaryName }
        $script:CurrentVM = $name
        $vm = Get-TestVM
        $held = Get-VmTestLock
        if ($held -and -not ($task -and $task.Checkpoint -eq $held.checkpoint) -and -not $Force) {
            throw "'$name' is in use by $($held.repo) / $($held.branch). Prepare reboots it, so wait until that task runs 'vmtest save' or 'vmtest end'."
        }
        if ((Test-Checkpoint $script:CleanCheckpoint) -and -not $Force) {
            throw "'$name' already has a Clean checkpoint. Use -Force to replace it."
        }
        Set-StandardCheckpoints
        if ($vm.State -ne 'Running') { Start-VM -Name $vm.Name }
        Initialize-TestVM
        Save-TestCheckpoint $script:CleanCheckpoint
        Save-VM -Name $vm.Name
        Clear-VmTestLock
        $more = if ($name -eq (Get-PrimaryName) -and @(Get-PoolNames).Count -gt 1) { " To bring the pool's other VMs up to this Clean, run 'vmtest prepare -Pool -Force'." } else { '' }
        "Prepared '$name': it signs in by itself, has the agent installed, and is saved as the '$script:CleanCheckpoint' checkpoint. The VM is free.$more"
    }
}

# Windows' name for a pool VM: letters, digits and hyphens, 15 characters at most.
function ConvertTo-ComputerName([string]$VMName) {
    $n = ($VMName -replace '[^A-Za-z0-9-]', '').Trim('-')
    if ($n.Length -gt 15) { $n = "vmtest-$(Get-ShortHash $VMName)" }
    $n
}

# The copy of Clean an earlier 'prepare -Pool' made from this same checkpoint, if one is complete.
function Find-PoolBase {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$CleanId)
    foreach ($b in @(Get-ChildItem $Root -Directory -Filter 'base-*' -ErrorAction SilentlyContinue)) {
        $idFile = Join-Path $b.FullName 'clean-id.txt'
        if ((Test-Path $idFile) -and (Get-Content $idFile -Raw).Trim() -eq $CleanId -and (Test-Path (Join-Path $b.FullName 'Clean.vhdx'))) {
            return $b.FullName
        }
    }
}

# Turn an export of Clean into a base the pool's VMs are made from. The export is saved with Clean's
# memory, and Hyper-V won't change the disk of a saved VM, even before it's imported. So Clean's disk
# moves aside to be the shared read-only parent, and a differencing disk on it takes its place:
# importing then copies only that small disk. clean-id.txt, written last, marks the base complete.
function New-PoolBase {
    param([Parameter(Mandatory)][string]$Base, [Parameter(Mandatory)][string]$CleanId)
    $vmcx = @(Get-ChildItem $Base -Recurse -Filter *.vmcx)
    $disks = @(Get-ChildItem $Base -Recurse -Include *.vhdx, *.avhdx)
    if ($vmcx.Count -ne 1 -or $disks.Count -ne 1) {
        throw "The copy of Clean in $Base should have one settings file and one disk; it has $($vmcx.Count) and $($disks.Count). vmtest only copies a VM with one disk."
    }
    $exported = $disks[0].FullName
    $parent = Join-Path $Base 'Clean.vhdx'
    Move-Item $exported $parent
    New-VHD -Path $exported -ParentPath $parent -Differencing | Out-Null
    try { Set-ItemProperty $parent -Name IsReadOnly -Value $true } catch { }   # many VMs read it; none may write it
    Set-Content (Join-Path $Base 'clean-id.txt') $CleanId
}

# Make the pool's other VMs from the first VM's Clean checkpoint. They share one read-only copy of
# that disk and each writes only its own changes (a differencing disk), so they cost little space
# and start out identical. -Force remakes the ones no task holds, for after Clean was refreshed.
function Invoke-VmTestPreparePool {
    param([switch]$Force)
    $primary = Get-PrimaryName
    $names = @(Get-PoolNames | Select-Object -Skip 1)
    if (-not $names) {
        return "The pool is just '$primary', so there's nothing to make. Set VMTEST_POOL to a count or a list of names for more."
    }
    Use-VmTestMutex -MutexName 'Local\vmtest-pool' -WaitMinutes 0 -BusyMessage "Another 'vmtest prepare -Pool' is already making VMs." {
        Use-TestVM $primary { Get-TestVM | Out-Null; Assert-CleanCheckpoint }
        $cleanId = "$((Get-VMSnapshot -VMName $primary -Name $script:CleanCheckpoint).Id)"
        $cleanNote = "Clean $cleanId"
        $notes = @()
        $todo = @()
        foreach ($n in $names) {
            $existing = Get-VM -Name $n -ErrorAction SilentlyContinue
            if (-not $existing) { $todo += $n; continue }
            $ours = "$($existing.Notes)".StartsWith($script:CloneNote)
            $checkpoints = @(Use-TestVM $n { Get-CheckpointNames })
            $complete = $checkpoints -contains $script:CleanCheckpoint
            $saved = @($checkpoints | Where-Object { $_ -ne $script:CleanCheckpoint })
            if (-not $ours) {
                $notes += "'$n' already exists and wasn't made by vmtest, so it was left alone."
                if (-not $complete) { $notes += "It has no Clean checkpoint, so it isn't used until 'vmtest prepare -VM $n' gives it one." }
            } elseif ($complete -and "$($existing.Notes)".Contains($cleanNote)) {
                $notes += "'$n' is already made from the current Clean."
            } elseif ($complete -and -not $Force) {
                $notes += "'$n' is made from an older Clean. 'vmtest prepare -Pool -Force' remakes it."
            } elseif (Get-VmTestLock $n) {
                $notes += "'$n' is in use by $((Get-VmTestLock $n).repo) / $((Get-VmTestLock $n).branch), so it wasn't remade."
            } elseif ($saved) {
                # Remaking it would delete these, and they're often a task's only saved state.
                $notes += ("'$n' has saved state for other tasks ($($saved -join ', ')), so it wasn't remade. " +
                    "Each of those tasks can run 'vmtest end' if its work is merged, or 'vmtest begin' then 'vmtest save' to keep it; then run this again.")
            } else { $todo += $n }
        }
        if (-not $todo) { return $notes }

        $root = Join-Path (Get-VMHost).VirtualHardDiskPath 'vmtest'
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        # Under the main lock: check again that no task took a VM being remade, and delete those
        # VMs, so no 'begin' can hand one out from here on. Then copy Clean out, so no 'begin',
        # 'save' or 'end' changes the first VM's checkpoints under the copy. Commands inside a VM
        # don't wait for any of this.
        $plan = Use-VmTestMutex -WaitMinutes 30 -BusyMessage "'vmtest prepare -Pool' waited 30 minutes for other vmtest commands to finish. Try again later." {
            $go = @()
            $later = @()
            foreach ($n in $todo) {
                $held = Get-VmTestLock $n
                if ($held) { $later += "'$n' was taken by $($held.repo) / $($held.branch) meanwhile, so it wasn't remade."; continue }
                Remove-PoolClone $n
                $go += $n
            }
            $base = $null
            if ($go) {
                # A copy of this same Clean, from an earlier run, is used again rather than copied twice.
                $base = Find-PoolBase -Root $root -CleanId $cleanId
                if (-not $base) {
                    $base = Join-Path $root "base-$stamp"
                    Export-VMSnapshot -VMName $primary -Name $script:CleanCheckpoint -Path $base
                    New-PoolBase -Base $base -CleanId $cleanId
                }
            }
            @{ Go = $go; Later = $later; Base = $base }
        }
        $notes += $plan.Later
        if (-not $plan.Go) { return $notes }
        $vmcx = Get-ChildItem $plan.Base -Recurse -Filter *.vmcx | Select-Object -First 1

        $made = @()
        foreach ($n in $plan.Go) {
            try {
                New-PoolClone -Name $n -Primary $primary -Vmcx $vmcx.FullName -Dir (Join-Path $root $n) -Notes "$script:CloneNote, made from $primary's $cleanNote on $stamp. 'vmtest prepare -Pool -Force' remakes it."
            } catch {
                # Leave nothing running. The half-made VM has no Clean, so it's never handed out,
                # and the next 'prepare -Pool' remakes it.
                $half = Get-VM -Name $n -ErrorAction SilentlyContinue
                if ($half -and $half.State -ne 'Off') { Stop-VM -VM $half -TurnOff -Force }
                $done = if ($made) { " Made before it: $($made -join ', ')." } else { '' }
                throw "Making '$n' failed: $($_.Exception.Message)$done Run 'vmtest prepare -Pool' again to finish."
            }
            $made += $n
        }
        Remove-UnusedPoolBases $root
        @("Made $($made -join ', ') from $primary's Clean checkpoint. They're free; 'vmtest begin' hands out whichever is free.") + $notes
    }
}

# Import one pool VM from a base, start it, give Windows its own name, and take its Clean.
function New-PoolClone {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Primary, [Parameter(Mandatory)][string]$Vmcx,
        [Parameter(Mandatory)][string]$Dir, [Parameter(Mandatory)][string]$Notes)
    # Named before it's registered, so there's never a second VM with the first one's name.
    $report = Compare-VM -Path $Vmcx -Copy -GenerateNewId -VirtualMachinePath $Dir -SnapshotFilePath $Dir -SmartPagingFilePath $Dir -VhdDestinationPath $Dir
    if ($report.Incompatibilities) {
        throw "Hyper-V can't copy '$Primary' as '$Name': $(($report.Incompatibilities | ForEach-Object { $_.Message }) -join ' ')"
    }
    $report.VM | Rename-VM -NewName $Name
    $report.VM | Set-VM -Notes $Notes
    $vm = Import-VM -CompatibilityReport $report
    # Start Windows fresh from the disk rather than from the first VM's memory, so the copy
    # gets its own network address before it ever runs.
    if ($vm.State -eq 'Saved') { Remove-VMSavedState -VM $vm }
    Set-UniqueMacAddress $vm
    Use-TestVM $Name {
        if (-not (Test-RoomToStart (Get-TestVM))) {
            throw "this PC has $(Format-GB (Get-HostFreeMemoryBytes)) of memory free, not enough to start it and keep $((Get-VmTestConfig).ReserveGB) GB for the PC."
        }
        Start-VM -Name $Name
        Initialize-TestVM -ComputerName (ConvertTo-ComputerName $Name)
        # A 'begin' repairs Clean on every pool VM, so the checkpoint is taken under the main lock.
        Use-VmTestMutex { Save-TestCheckpoint $script:CleanCheckpoint; Save-VM -Name $Name }
    }
}

# A copy with the same network address as another VM would fight it for the network.
function Set-UniqueMacAddress {
    param([Parameter(Mandatory)]$VM)
    $others = @(Get-VM | Where-Object { $_.Id -ne $VM.Id } | Get-VMNetworkAdapter | ForEach-Object { $_.MacAddress })
    foreach ($a in @(Get-VMNetworkAdapter -VM $VM)) {
        if ($a.MacAddress -ne '000000000000' -and $others -contains $a.MacAddress) {
            $mac = '00155D' + (-join (1..3 | ForEach-Object { '{0:X2}' -f (Get-Random -Maximum 256) }))
            Set-VMNetworkAdapter -VMNetworkAdapter $a -StaticMacAddress $mac
        }
    }
}

# Delete a VM 'prepare -Pool' made, with its disk and checkpoints. Never one it didn't make.
function Remove-PoolClone {
    param([Parameter(Mandatory)][string]$Name)
    $vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
    $dir = Join-Path (Join-Path (Get-VMHost).VirtualHardDiskPath 'vmtest') $Name
    $held = Get-VmTestLock $Name
    if ($held) { throw "'$Name' is in use by $($held.repo) / $($held.branch), so it won't be deleted." }
    if ($vm) {
        if (-not "$($vm.Notes)".StartsWith($script:CloneNote)) { throw "'$Name' wasn't made by vmtest, so it won't be deleted." }
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force }
        Remove-VM -VM $vm -Force
    }
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    Clear-VmTestLock $Name
}

# A copy of Clean no VM's disk is made from any more takes up space for nothing. If any disk's
# parents can't be read, nothing is deleted: a VM whose parent disk is gone can't start.
function Remove-UnusedPoolBases {
    param([Parameter(Mandatory)][string]$Root)
    $inUse = @()
    foreach ($drive in @(Get-VM | Get-VMHardDiskDrive)) {
        $p = $drive.Path
        while ($p) {
            $inUse += $p
            try { $p = (Get-VHD -Path $p).ParentPath } catch { return }
        }
    }
    foreach ($b in @(Get-ChildItem $Root -Directory -Filter 'base-*' -ErrorAction SilentlyContinue)) {
        $used = $inUse | Where-Object { $_ -like "$($b.FullName)\*" }
        if (-not $used) {
            Get-ChildItem $b.FullName -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
            Remove-Item $b.FullName -Recurse -Force
        }
    }
}

# Which VM 'begin' gives a task that doesn't hold one, in order of preference.
function Select-VMForTask {
    param([Parameter(Mandatory)]$Task, [Parameter(Mandatory)][object[]]$Candidates, [Parameter(Mandatory)][object[]]$Pool,
        [Parameter(Mandatory)][hashtable]$Locks, [switch]$Force)
    # Which VMs have this task's checkpoint, across the whole pool, so -VM still notices one elsewhere.
    $hasMine = @{}
    foreach ($v in $Pool) { $hasMine[$v.Name] = [bool](Use-TestVM $v.Name { Test-Checkpoint $Task.Checkpoint }) }
    $free = @($Candidates | Where-Object { -not $Locks[$_.Name] })
    $held = @($Candidates | Where-Object { $Locks[$_.Name] } | Sort-Object { Get-LastActivity $Locks[$_.Name] })
    $stale = @($held | Where-Object { Test-LockStale $Locks[$_.Name] })
    $roomy = @($free | Where-Object { Test-RoomToStart $_ })

    # 1. A free VM with this task's checkpoint. 2. The idle-held VM with it. 3. Any free VM, from
    # Clean. 4. The VM that has been idle longest. 5. With -Force, the longest-idle VM even so.
    $pick = @($roomy | Where-Object { $hasMine[$_.Name] })[0]
    if ($pick) { return @{ VM = $pick } }
    $pick = @($stale | Where-Object { $hasMine[$_.Name] })[0]
    if ($pick) { return @{ VM = $pick; Stale = $Locks[$pick.Name] } }
    $pick = $roomy[0]
    if ($pick) {
        $elsewhere = @($Pool | Where-Object { $hasMine[$_.Name] })[0]
        return @{ VM = $pick; Elsewhere = $elsewhere }
    }
    if ($stale) { return @{ VM = $stale[0]; Stale = $Locks[$stale[0].Name] } }
    if ($Force -and $held) { return @{ VM = $held[0]; Forced = $Locks[$held[0].Name] } }

    # Nothing to give: say why, and when that changes.
    $lines = @()
    if ($free) {
        $lines += ("$(($free | ForEach-Object { "'$($_.Name)'" }) -join ' and ') $(if ($free.Count -eq 1) { 'is' } else { 'are' }) free, " +
            "but this PC has $(Format-GB (Get-HostFreeMemoryBytes)) of memory free and starting one needs " +
            "$(Format-GB ($free[0].MemoryStartup + (Get-VmTestConfig).ReserveGB * 1GB)), its own memory and the PC's reserve.")
    }
    foreach ($v in $held) {
        $l = $Locks[$v.Name]
        $lines += "'$($v.Name)' is in use by $($l.repo) / $($l.branch) since $(Format-Since $l.since), last used $(Format-Duration ((Get-Date) - (Get-LastActivity $l))) ago."
    }
    $minutes = (Get-VmTestConfig).StaleMinutes
    # A lock from before the pool is never taken for idle (see Test-LockStale), so it isn't promised.
    $first = @($held | Where-Object { $l = $Locks[$_.Name]; $l.v -or (Get-LastActivity $l) -ne [datetime]::Parse($l.since) })[0]
    if ($first -and $minutes -gt 0) {
        $next = (Get-LastActivity $Locks[$first.Name]).AddMinutes($minutes)
        $lines += "If '$($first.Name)' is still idle at $(Format-Since $next.ToString('s')), the next 'vmtest begin' saves it for its task and takes it."
    }
    $lines += "Wait with 'vmtest begin -Wait', or ask the user."
    throw (New-BusyError ($lines -join ' '))
}

function Invoke-VmTestBegin {
    # -VM asks for one VM in particular. -WaitSeconds keeps trying while every VM is busy.
    param([string]$Repo, [string]$Branch, [string]$VM, [switch]$Force, [int]$WaitSeconds = 0)
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ($true) {
        try { return Start-TaskOnVM -Task $task -VM $VM -Force:$Force }
        catch {
            if (-not $_.Exception.Data['vmtestBusy'] -or (Get-Date) -ge $deadline) { throw }
            Write-Host "No test VM is free yet; trying again in 30 seconds."
            Start-Sleep -Seconds 30
        }
    }
}

function Start-TaskOnVM {
    param([Parameter(Mandatory)]$Task, [string]$VM, [switch]$Force)
    $script:CurrentVM = $null
    Use-VmTestMutex {
        $pool = @(Get-PoolVMs)
        if (-not $pool) {
            Use-TestVM (Get-PrimaryName) { Get-TestVM | Out-Null; Assert-CleanCheckpoint }
        }
        if ($VM -and @($pool | ForEach-Object Name) -notcontains $VM) {
            throw "'$VM' isn't one of the test VMs ready to use: $(($pool | ForEach-Object { "'$($_.Name)'" }) -join ', ')."
        }
        $locks = @{}
        foreach ($v in $pool) { $locks[$v.Name] = Get-VmTestLock $v.Name }
        foreach ($v in $pool) { Use-TestVM $v.Name { Repair-TaskCheckpoint $Task.Checkpoint $Task.Legacy } }
        $mine = @($pool | Where-Object { $locks[$_.Name] -and $locks[$_.Name].checkpoint -eq $Task.Checkpoint })[0]
        if ($mine -and $VM -and $mine.Name -ne $VM) {
            throw "$($Task.Repo) / $($Task.Branch) already has '$($mine.Name)'. Run 'vmtest save' first, then 'vmtest begin -VM $VM'."
        }

        $note = ''
        if ($mine) {
            # This task already has the VM: carry on from wherever it is, never restore over it.
            $script:CurrentVM = $mine.Name
            if (-not (Test-RoomToStart $mine)) {
                throw (New-BusyError "This task has '$($mine.Name)', but this PC has $(Format-GB (Get-HostFreeMemoryBytes)) of memory free, not enough to start it.")
            }
            Set-StandardCheckpoints
            switch ($mine.State) {
                'Running' { $from = 'the running VM (this task already had it)' }
                'Paused' { Resume-VM -Name $mine.Name; $from = 'the paused VM (this task already had it)' }
                'Saved' { Start-VM -Name $mine.Name; $from = 'where this task left it (the VM had been saved)' }
                default { Start-VM -Name $mine.Name; $from = "a fresh start: the VM was $($mine.State), so its disk is as this task left it but open programs are gone" }
            }
        } else {
            $candidates = if ($VM) { @($pool | Where-Object Name -eq $VM) } else { $pool }
            $choice = Select-VMForTask -Task $Task -Candidates $candidates -Pool $pool -Locks $locks -Force:$Force
            $target = $choice.VM
            if ($choice.Stale) {
                $s = $choice.Stale
                Save-TaskState -Checkpoint $s.checkpoint -VMName $target.Name
                $note = " $($s.repo) / $($s.branch) had held it unused for $(Format-Duration ((Get-Date) - (Get-LastActivity $s))), so its state was saved first; 'vmtest begin' there carries on from it."
            } elseif ($choice.Forced) {
                $note = " It was taken from $($choice.Forced.repo) / $($choice.Forced.branch) with -Force; that task's unsaved state is lost."
            } elseif ($choice.Elsewhere) {
                $note = " This task's checkpoint is on '$($choice.Elsewhere.Name)', which is busy, so this started from Clean. Saving here replaces that checkpoint."
            }
            $script:CurrentVM = $target.Name
            Set-VmTestLock -Task $Task -Force
            Set-StandardCheckpoints
            $own = Test-Checkpoint $Task.Checkpoint
            $from = if ($own) { "this task's checkpoint '$($Task.Checkpoint)'" } else { $script:CleanCheckpoint }
            Restore-TestCheckpoint $(if ($own) { $Task.Checkpoint } else { $script:CleanCheckpoint })
            Start-VM -Name $target.Name
        }
        Wait-GuestSignedIn
        $session = New-GuestSession
        try { Install-GuestAgent -Session $session } finally { Remove-PSSession $session }
        Set-TaskActivity $Task
        "The test VM '$(Get-VMName)' is ready for $($Task.Repo) / $($Task.Branch), started from $from.$note"
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
        return "Saved the screen of '$(Get-VMName)', from Hyper-V, to $Out"
    }
    $r = Invoke-GuestAgent @{ op = 'shot' }
    $session = New-GuestSession
    try { Copy-Item "$script:GuestRoot\shot.png" -Destination $Out -FromSession $session -Force } finally { Remove-PSSession $session }
    "Saved the VM's screen ($($r.result)) to $Out"
}

# Which VM 'shot -FromHost' looks at: -VM, the one this task holds, or the first VM. Looking needs no lock.
function Select-VMToLookAt {
    param([string]$Repo, [string]$Branch, [string]$VM)
    $script:CurrentVM = if ($VM) { $VM } else {
        $task = $null
        try { $task = Resolve-Task -Repo $Repo -Branch $Branch } catch {}
        if ($task) { Find-TaskVM $task }
    }
}

function Save-HostScreenshot {
    param([Parameter(Mandatory)][string]$Out, [int]$Width = 1024, [int]$Height = 768)
    Add-Type -AssemblyName System.Drawing
    $ns = 'root\virtualization\v2'
    $name = Get-VMName
    $system = Get-CimInstance -Namespace $ns -ClassName Msvm_ComputerSystem -Filter "ElementName='$($name -replace "'", "''")'"
    if (-not $system) { throw "Hyper-V doesn't know a VM named '$name'." }
    $settings = Get-CimAssociatedInstance -InputObject $system -ResultClassName Msvm_VirtualSystemSettingData |
        Where-Object VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized'
    $service = Get-CimInstance -Namespace $ns -ClassName Msvm_VirtualSystemManagementService
    $r = Invoke-CimMethod -InputObject $service -MethodName GetVirtualSystemThumbnailImage -Arguments @{
        TargetSystem = $settings; WidthPixels = [uint16]$Width; HeightPixels = [uint16]$Height }
    if ($r.ReturnValue -ne 0) { throw "Hyper-V couldn't take a picture of the screen of '$name' (code $($r.ReturnValue)). Is it running?" }
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
    $script:CurrentVM = $null
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    Use-VmTestMutex {
        $name = Assert-LockedBy $task
        Save-TaskState -Checkpoint $task.Checkpoint -VMName $name
        "Saved the test VM '$name' as '$($task.Checkpoint)' and released it. 'vmtest begin' on this branch picks up from here."
    }
}

function Invoke-VmTestEnd {
    # The task is merged: drop its checkpoints, and put the VM it holds back to Clean. -Force with
    # -VM resets that VM even when another task holds it.
    param([string]$Repo, [string]$Branch, [string]$VM, [switch]$Force)
    $script:CurrentVM = $null
    $task = Resolve-Task -Repo $Repo -Branch $Branch
    Use-VmTestMutex {
        $had = @(Get-PoolNames | Where-Object { Get-VM -Name $_ -ErrorAction SilentlyContinue } | Where-Object {
                Use-TestVM $_ { Repair-TaskCheckpoint $task.Checkpoint $task.Legacy; Test-Checkpoint $task.Checkpoint } })
        $mine = Find-TaskVM $task
        if ($VM -and @(Get-PoolNames) -notcontains $VM) { throw "'$VM' isn't one of the pool's test VMs: $((Get-PoolNames) -join ', ')." }
        if ($VM -and $mine -and $VM -ne $mine) { throw "This task holds '$mine', not '$VM'. Run 'vmtest end' without -VM." }
        $reset = if ($mine) { $mine } elseif ($Force) { if ($VM) { $VM } else { Get-PrimaryName } }
        $evicted = if ($reset -and $reset -ne $mine) { Get-VmTestLock $reset }
        foreach ($name in $had) { if ($name -ne $reset) { Use-TestVM $name { Remove-TestCheckpoint $task.Checkpoint } } }
        $what = if ($had) { "Removed '$($task.Checkpoint)' from $(($had | ForEach-Object { "'$_'" }) -join ' and ')." } else { 'There was no checkpoint for this task.' }
        if (-not $reset) { return "$what This task held no test VM, so none was reset." }
        $script:CurrentVM = $reset
        Assert-CleanCheckpoint
        Remove-TestCheckpoint $task.Checkpoint
        Restore-TestCheckpoint $script:CleanCheckpoint
        Clear-VmTestLock
        $lost = if ($evicted) { " It was in use by $($evicted.repo) / $($evicted.branch), whose unsaved state is lost." } else { '' }
        "$what Put '$reset' back to '$script:CleanCheckpoint' and freed it.$lost"
    }
}

function Get-VmTestStatus {
    $script:CurrentVM = $null
    $names = @(Get-PoolNames)
    $lines = @("Test VMs: $($names.Count) in the pool. This PC has $(Format-GB (Get-HostFreeMemoryBytes)) of memory free.")
    $any = $false
    foreach ($name in $names) {
        $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
        if (-not $vm) {
            $lines += if ($name -eq (Get-PrimaryName)) { "'$name': doesn't exist. Build it with Hyper-V Manage, then run 'vmtest prepare'." }
            else { "'$name': not made yet. 'vmtest prepare -Pool' makes it from $(Get-PrimaryName)'s Clean." }
            continue
        }
        $any = $true
        $held = Get-VmTestLock $name
        $who = if ($held) {
            $idle = (Get-Date) - (Get-LastActivity $held)
            "in use by $($held.repo) / $($held.branch) since $(Format-Since $held.since), last used $(Format-Duration $idle) ago" +
                $(if (Test-LockStale $held) { '; idle long enough that the next begin with no free VM saves it and takes it' } else { '' })
        } else { 'free' }
        $checkpoints = Use-TestVM $name { Get-CheckpointNames }
        if ($checkpoints -notcontains $script:CleanCheckpoint) { $who += "; no Clean checkpoint yet, so it isn't handed out" }
        $lines += "'$name': $($vm.State), $who."
        $lines += "  Checkpoints: " + $(if ($checkpoints) { $checkpoints -join ', ' } else { 'none' })
    }
    if (-not $any) { Get-TestVM -Name (Get-PrimaryName) | Out-Null }
    $lines
}

Export-ModuleMember -Function Get-VmTestConfig, Get-PoolNames, ConvertTo-TaskCheckpointName, Resolve-Task, Get-VmTestLock,
    Set-VmTestLock, Clear-VmTestLock, Assert-LockedBy, Assert-TaskHasVM, Find-TaskVM, Invoke-GuestAgent, Invoke-VmTestPrepare,
    Invoke-VmTestBegin, Invoke-VmTestDeploy, Invoke-VmTestPush, Invoke-VmTestRun, Invoke-VmTestShot, Select-VMToLookAt,
    Invoke-VmTestSave, Invoke-VmTestEnd, Get-VmTestStatus

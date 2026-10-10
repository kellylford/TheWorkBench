# Pester 3.4 tests (the version that ships with Windows). Run: Invoke-Pester vmtest\tests
# These need no VM. Hyper-V is replaced by a small fake that keeps VMs and checkpoints in memory, and
# the VM names point at ones that don't exist, so a mistake here can never reach a real test VM.
$root = Split-Path $PSScriptRoot
$env:VMTEST_VM = 'vmtest-pester-no-such-vm'
$env:VMTEST_POOL = '1'
$second = "$env:VMTEST_VM-2"
Import-Module (Join-Path $root 'VmTest.psm1') -Force

# ---- the fake Hyper-V --------------------------------------------------------------------------
# $global:Fake.VMs holds each fake VM's state and checkpoints. $global:Fake.Checkpoints, .Calls and
# FakeVM are the first VM's, which is all the one-VM tests look at.
function New-FakeVM([string[]]$Checkpoints = @('Clean'), [string]$State = 'Saved', [string]$CheckpointType = 'Standard', [string]$Notes = '') {
    @{ Checkpoints = [System.Collections.Generic.List[string]]@($Checkpoints); State = $State; CheckpointType = $CheckpointType
        Calls = New-Object System.Collections.Generic.List[string]; Notes = $Notes }
}
function FakeVM([string]$Name = $env:VMTEST_VM) { $global:Fake.VMs[$Name] }
function Use-FakePool {
    param([Parameter(Mandatory)][hashtable]$VMs, [double]$FreeGB = 64)
    $global:Fake = @{ VMs = $VMs; FreeMemory = [int64]($FreeGB * 1GB); Calls = New-Object System.Collections.Generic.List[string] }
    if ($VMs[$env:VMTEST_VM]) { $global:Fake.Checkpoints = $VMs[$env:VMTEST_VM].Checkpoints; $global:Fake.Calls = $VMs[$env:VMTEST_VM].Calls }
    Mock -ModuleName VmTest Get-VM {
        $names = if ($Name) { $Name } else { $global:Fake.VMs.Keys }
        foreach ($n in $names) {
            $v = $global:Fake.VMs[$n]
            if ($v) { [pscustomobject]@{ Name = $n; State = $v.State; CheckpointType = $v.CheckpointType; MemoryStartup = 4GB; Notes = $v.Notes; Id = $n } }
        }
    }
    Mock -ModuleName VmTest Get-VMSnapshot {
        $v = $global:Fake.VMs["$VMName"]
        if ($v) { $v.Checkpoints | Where-Object { -not $Name -or $Name -contains $_ } | ForEach-Object { [pscustomobject]@{ Name = $_; Id = "id-$_" } } }
    }
    Mock -ModuleName VmTest Checkpoint-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add("checkpoint $SnapshotName"); $v.Checkpoints.Add($SnapshotName) }
    Mock -ModuleName VmTest Rename-VMSnapshot {
        $v = $global:Fake.VMs["$VMName"]; $v.Calls.Add("rename $Name -> $NewName")
        $i = $v.Checkpoints.IndexOf($Name); $v.Checkpoints[$i] = $NewName
    }
    Mock -ModuleName VmTest Remove-VMSnapshot { $v = $global:Fake.VMs["$VMName"]; $v.Calls.Add("remove $Name"); [void]$v.Checkpoints.Remove($Name) }
    Mock -ModuleName VmTest Restore-VMSnapshot { $v = $global:Fake.VMs["$VMName"]; $v.Calls.Add("restore $Name"); $v.State = 'Saved' }
    Mock -ModuleName VmTest Stop-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add('turn off'); $v.State = 'Off' }
    Mock -ModuleName VmTest Start-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add('start'); $v.State = 'Running' }
    Mock -ModuleName VmTest Resume-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add('resume'); $v.State = 'Running' }
    Mock -ModuleName VmTest Save-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add('save vm'); $v.State = 'Saved' }
    Mock -ModuleName VmTest Set-VM { $v = $global:Fake.VMs["$Name"]; $v.Calls.Add("set $CheckpointType") }
    Mock -ModuleName VmTest Get-HostFreeMemoryBytes { $global:Fake.FreeMemory }
    # The guest side: signed in, agent installs fine.
    Mock -ModuleName VmTest Wait-GuestSignedIn {}
    Mock -ModuleName VmTest New-GuestSession { 'session' }
    Mock -ModuleName VmTest Remove-PSSession {}
    Mock -ModuleName VmTest Install-GuestAgent {}
}
function Use-FakeHyperV {
    param([string[]]$Checkpoints = @('Clean'), [string]$State = 'Running', [string]$CheckpointType = 'Standard')
    Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM -Checkpoints $Checkpoints -State $State -CheckpointType $CheckpointType) }
}
# Every call made to any fake VM, as "<vm>: <call>".
function Get-AllCalls { foreach ($k in $global:Fake.VMs.Keys) { foreach ($c in $global:Fake.VMs[$k].Calls) { "${k}: $c" } } }

Describe 'scripts' {
    $files = Get-ChildItem $root -Recurse -Include *.ps1, *.psm1
    foreach ($file in $files) {
        It "$($file.Name) parses" {
            $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors) | Out-Null
            @($errors).Count | Should Be 0
        }
        It "$($file.Name) is plain ASCII (Windows PowerShell reads files without a BOM as ANSI)" {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            @($bytes | Where-Object { $_ -gt 127 }).Count | Should Be 0
        }
    }
    It "the agent's C# compiles (Windows PowerShell 5.1, C# 5)" {
        # Each Add-Type here-string, compiled in a fresh PowerShell so the types don't stay loaded here.
        $agent = Get-Content (Join-Path $root 'guest\agent.ps1') -Raw
        $blocks = [regex]::Matches($agent, "Add-Type(?<refs> -ReferencedAssemblies \w+)? -TypeDefinition @'\r?\n(?<code>.*?)\r?\n'@", 'Singleline')
        $blocks.Count | Should Be 2
        foreach ($b in $blocks) {
            $file = Join-Path $TestDrive "block$([guid]::NewGuid()).cs"
            [System.IO.File]::WriteAllText($file, $b.Groups['code'].Value)
            $refs = if ($b.Groups['refs'].Success) { $b.Groups['refs'].Value } else { '' }
            $out = & powershell.exe -NoProfile -NonInteractive -Command "try { Add-Type$refs -TypeDefinition ([IO.File]::ReadAllText('$file')) -ErrorAction Stop; 'compiled' } catch { `$_.Exception.Message }"
            ($out -join ' ') | Should Be 'compiled'
        }
    }
    It 'the agent refuses to run anywhere but a VM' {
        (Get-Content (Join-Path $root 'guest\agent.ps1') -Raw) | Should Match "Model -ne 'Virtual Machine'"
    }
}

Describe 'checkpoint names' {
    It 'start with a readable repo and branch' {
        ConvertTo-TaskCheckpointName 'QuickMail' 'main' | Should Match '^task QuickMail main [0-9a-f]{6}$'
    }
    It 'keep branches apart that read the same' {
        (ConvertTo-TaskCheckpointName 'r' 'feature/a') | Should Not Be (ConvertTo-TaskCheckpointName 'r' 'feature-a')
    }
    It 'keep long branches apart that share their first 100 characters' {
        $long = 'x' * 120
        (ConvertTo-TaskCheckpointName 'r' "$long-one") | Should Not Be (ConvertTo-TaskCheckpointName 'r' "$long-two")
    }
    It 'stay short enough for the temporary names' {
        ("$(ConvertTo-TaskCheckpointName 'r' ('x' * 300)) (new)").Length -le 100 | Should Be $true
    }
    It 'are the same every time' {
        ConvertTo-TaskCheckpointName 'r' 'b' | Should Be (ConvertTo-TaskCheckpointName 'r' 'b')
    }
    It 'refuse names with nothing usable in them' {
        { ConvertTo-TaskCheckpointName 'r' '///' } | Should Throw
    }
}

Describe 'Resolve-Task' {
    It 'uses the repo and branch it is given' {
        $t = Resolve-Task -Repo 'QuickMail' -Branch 'fix/x'
        $t.Repo | Should Be 'QuickMail'
        $t.Branch | Should Be 'fix/x'
        $t.Checkpoint | Should Be (ConvertTo-TaskCheckpointName 'QuickMail' 'fix/x')
        $t.Legacy | Should Be 'task QuickMail fix-x'
    }
    It 'reads them from a git folder' {
        $branch = git -C $root branch --show-current
        if (-not $branch) { Set-TestInconclusive 'detached HEAD (as in CI)'; return }
        $t = Resolve-Task -Path $root
        $t.Repo | Should Be 'TheWorkBench'
        $t.Branch | Should Be $branch
    }
    It 'says what to do outside a git folder' {
        { Resolve-Task -Path $env:SystemRoot } | Should Throw 'give -Repo and -Branch'
    }
}

Describe 'the lock' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'state'
    $a = Resolve-Task -Repo 'A' -Branch 'one'
    $b = Resolve-Task -Repo 'B' -Branch 'two'

    It 'starts free' {
        Clear-VmTestLock
        Get-VmTestLock | Should BeNullOrEmpty
    }
    It 'records who holds it' {
        Set-VmTestLock -Task $a
        (Get-VmTestLock).repo | Should Be 'A'
        (Get-VmTestLock).checkpoint | Should Be $a.Checkpoint
    }
    It 'lets the same task take it again' {
        { Set-VmTestLock -Task $a } | Should Not Throw
    }
    It 'refuses another task' {
        { Set-VmTestLock -Task $b } | Should Throw "'vmtest-pester-no-such-vm' is in use by A / one"
        (Get-VmTestLock).repo | Should Be 'A'
    }
    It 'gives way to -Force' {
        Set-VmTestLock -Task $b -Force
        (Get-VmTestLock).repo | Should Be 'B'
    }
    It 'checks the holder' {
        { Assert-LockedBy -Task $b } | Should Not Throw
        { Assert-LockedBy -Task $a } | Should Throw "A / one doesn't hold a test VM"
    }
    It 'can be released' {
        Clear-VmTestLock
        Get-VmTestLock | Should BeNullOrEmpty
        { Assert-LockedBy -Task $a } | Should Throw "Run 'vmtest begin' first"
    }
    It 'says which file to delete when it is damaged' {
        New-Item -ItemType Directory $env:VMTEST_STATE -Force | Out-Null
        Set-Content (Join-Path $env:VMTEST_STATE 'lock.json') '{ not json'
        { Get-VmTestLock } | Should Throw 'is damaged'
        Clear-VmTestLock
    }
    Remove-Item Env:\VMTEST_STATE
}

Describe 'saving a checkpoint' {
    It 'makes the new one before dropping the old one' {
        Use-FakeHyperV -Checkpoints 'Clean', 'task r b'
        InModuleScope VmTest { Save-TestCheckpoint 'task r b' }
        $global:Fake.Checkpoints -contains 'task r b' | Should Be $true
        $global:Fake.Checkpoints.Count | Should Be 2
        ($global:Fake.Calls -join '; ') | Should Be 'checkpoint task r b (new); rename task r b -> task r b (old); rename task r b (new) -> task r b; remove task r b (old)'
    }
    It 'works the first time, with no old one' {
        Use-FakeHyperV -Checkpoints 'Clean'
        InModuleScope VmTest { Save-TestCheckpoint 'task r b' }
        @($global:Fake.Checkpoints) -join ',' | Should Be 'Clean,task r b'
    }
    It 'recovers a save that stopped after making the new one' {
        Use-FakeHyperV -Checkpoints 'Clean', 'task r b (new)'
        InModuleScope VmTest { Repair-TaskCheckpoint 'task r b' }
        @($global:Fake.Checkpoints) -join ',' | Should Be 'Clean,task r b'
    }
    It 'recovers a save that stopped after moving the old one aside' {
        Use-FakeHyperV -Checkpoints 'Clean', 'task r b (old)', 'task r b (new)'
        InModuleScope VmTest { Repair-TaskCheckpoint 'task r b' }
        @($global:Fake.Checkpoints) -join ',' | Should Be 'Clean,task r b'
        $global:Fake.Calls[0] | Should Be 'rename task r b (new) -> task r b'
    }
    It 'never deletes a leftover copy while the real one is missing' {
        Use-FakeHyperV -Checkpoints 'Clean', 'task r b (old)'
        InModuleScope VmTest { Repair-TaskCheckpoint 'task r b' }
        @($global:Fake.Checkpoints) -join ',' | Should Be 'Clean,task r b'
    }
    It "renames a first-version checkpoint to today's name" {
        Use-FakeHyperV -Checkpoints 'Clean', 'task QuickMail main'
        $t = Resolve-Task -Repo 'QuickMail' -Branch 'main'
        $global:PesterTask = $t
        InModuleScope VmTest { Repair-TaskCheckpoint $global:PesterTask.Checkpoint $global:PesterTask.Legacy }
        $global:Fake.Checkpoints -contains $t.Checkpoint | Should Be $true
        $global:Fake.Checkpoints -contains 'task QuickMail main' | Should Be $false
    }
}

Describe 'begin' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'begin'

    It "starts a new task from Clean" {
        Use-FakeHyperV -Checkpoints 'Clean' -State 'Saved'
        Clear-VmTestLock
        Invoke-VmTestBegin -Repo 'r' -Branch 'b' | Should Match 'started from Clean'
        $global:Fake.Calls -contains 'restore Clean' | Should Be $true
        (Get-VmTestLock).repo | Should Be 'r'
    }
    It "restores the task's own checkpoint when it has one" {
        $t = Resolve-Task -Repo 'r' -Branch 'b'
        Use-FakeHyperV -Checkpoints 'Clean', $t.Checkpoint -State 'Saved'
        Clear-VmTestLock
        Invoke-VmTestBegin -Repo 'r' -Branch 'b' | Should Match "this task's checkpoint"
        $global:Fake.Calls -contains "restore $($t.Checkpoint)" | Should Be $true
    }
    foreach ($state in 'Running', 'Saved', 'Paused', 'Off') {
        It "never restores over the task's own VM when it is $state" {
            Use-FakeHyperV -Checkpoints 'Clean' -State $state
            Set-VmTestLock -Task (Resolve-Task -Repo 'r' -Branch 'b') -Force
            Invoke-VmTestBegin -Repo 'r' -Branch 'b' | Out-Null
            @($global:Fake.Calls | Where-Object { $_ -like 'restore*' }).Count | Should Be 0
            (FakeVM).State | Should Be 'Running'
        }
    }
    It 'turns on Standard checkpoints so open programs survive' {
        Use-FakeHyperV -Checkpoints 'Clean' -CheckpointType 'Production'
        Clear-VmTestLock
        Invoke-VmTestBegin -Repo 'r' -Branch 'b' | Out-Null
        $global:Fake.Calls -contains 'set Standard' | Should Be $true
    }
    It 'refuses while another task has the VM, and leaves it alone' {
        Use-FakeHyperV -Checkpoints 'Clean'
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -Force
        { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } | Should Throw 'is in use by Other / work'
        $global:Fake.Calls.Count | Should Be 0
        (Get-VmTestLock).repo | Should Be 'Other'
    }
    It 'says how to build the VM' {
        Mock -ModuleName VmTest Get-VM { $null }
        Clear-VmTestLock
        { Invoke-VmTestBegin -Repo 'r' -Branch 'b' } | Should Throw 'Build one with Hyper-V Manage'
    }
    It 'says how to make Clean, and takes no lock' {
        Use-FakeHyperV -Checkpoints @()
        Clear-VmTestLock
        { Invoke-VmTestBegin -Repo 'r' -Branch 'b' } | Should Throw "Run 'vmtest prepare'"
        Get-VmTestLock | Should BeNullOrEmpty
    }
    Clear-VmTestLock
    Remove-Item Env:\VMTEST_STATE
}

Describe 'save and end' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'saveend'
    $mine = Resolve-Task -Repo 'Mine' -Branch 'x'

    It "save refuses when another task has the VM" {
        Use-FakeHyperV
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -Force
        { Invoke-VmTestSave -Repo 'Mine' -Branch 'x' } | Should Throw "Mine / x doesn't hold a test VM"
        $global:Fake.Calls.Count | Should Be 0
    }
    It 'save keeps the state, parks the VM and frees it' {
        Use-FakeHyperV
        Set-VmTestLock -Task $mine -Force
        Invoke-VmTestSave -Repo 'Mine' -Branch 'x' | Out-Null
        $global:Fake.Checkpoints -contains $mine.Checkpoint | Should Be $true
        (FakeVM).State | Should Be 'Saved'
        Get-VmTestLock | Should BeNullOrEmpty
    }
    It "end from another task only drops its own checkpoint" {
        Use-FakeHyperV -Checkpoints 'Clean', $mine.Checkpoint
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -Force
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' | Should Match 'held no test VM, so none was reset'
        $global:Fake.Checkpoints -contains $mine.Checkpoint | Should Be $false
        @($global:Fake.Calls | Where-Object { $_ -like 'restore*' }).Count | Should Be 0
        (Get-VmTestLock).repo | Should Be 'Other'
    }
    It 'end by the holder drops its checkpoint, goes back to Clean and frees the VM' {
        Use-FakeHyperV -Checkpoints 'Clean', $mine.Checkpoint
        Set-VmTestLock -Task $mine -Force
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' | Should Match "back to 'Clean' and freed it"
        $global:Fake.Checkpoints -contains $mine.Checkpoint | Should Be $false
        $global:Fake.Calls -contains 'restore Clean' | Should Be $true
        Get-VmTestLock | Should BeNullOrEmpty
    }
    Clear-VmTestLock
    Remove-Item Env:\VMTEST_STATE
}

Describe 'commands inside the VM' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'inside'
    It 'need the task to hold the VM' {
        Use-FakeHyperV
        Clear-VmTestLock
        { Assert-TaskHasVM -Repo 'r' -Branch 'b' } | Should Throw "Run 'vmtest begin' first"
    }
    It 'need the VM to be running' {
        Use-FakeHyperV -State 'Saved'
        Set-VmTestLock -Task (Resolve-Task -Repo 'r' -Branch 'b') -Force
        { Assert-TaskHasVM -Repo 'r' -Branch 'b' } | Should Throw 'is Saved'
    }
    It 'run wants a command line or a script, not both and not neither' {
        { Invoke-VmTestRun } | Should Throw 'needs a command line'
        { Invoke-VmTestRun -Command 'x' -ScriptFile 'y.ps1' } | Should Throw 'not both'
    }
    It 'run keeps -Timeout inside what the agent can wait for' {
        { Invoke-VmTestRun -Command 'x' -Timeout 5400 } | Should Throw 'between 1 and 3600'
    }
    It 'run only takes .cmd, .bat or .ps1 files' {
        $f = Join-Path $TestDrive 'x.txt'; Set-Content $f 'x'
        { Invoke-VmTestRun -ScriptFile $f } | Should Throw '.cmd, .bat or .ps1'
    }
    Clear-VmTestLock
    Remove-Item Env:\VMTEST_STATE
}

Describe 'prepare' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'prepare'
    It 'refuses while another task has the VM, because it reboots it' {
        Use-FakeHyperV
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -Force
        { Invoke-VmTestPrepare -Repo 'r' -Branch 'b' } | Should Throw 'Prepare reboots it'
        $global:Fake.Calls.Count | Should Be 0
    }
    It 'refuses to replace Clean without -Force' {
        Use-FakeHyperV
        Clear-VmTestLock
        { Invoke-VmTestPrepare } | Should Throw 'already has a Clean checkpoint'
    }
    Clear-VmTestLock
    Remove-Item Env:\VMTEST_STATE
}

Describe 'the pool' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'pool'
    $first = $env:VMTEST_VM
    $mine = Resolve-Task -Repo 'Mine' -Branch 'x'
    $other = Resolve-Task -Repo 'Other' -Branch 'work'
    $third = Resolve-Task -Repo 'Third' -Branch 'y'
    function Reset-Locks { foreach ($n in $first, $second) { Clear-VmTestLock -VMName $n } }
    # Make a task's lock on a VM look as if it was taken this many minutes ago.
    function Set-HeldSince([string]$VMName, $Task, [int]$MinutesAgo) {
        Set-VmTestLock -Task $Task -VMName $VMName -Force
        $p = Join-Path $env:VMTEST_STATE $(if ($VMName -eq $first) { 'lock.json' } else { "lock-$VMName.json" })
        $l = Get-Content $p -Raw | ConvertFrom-Json
        $l.since = (Get-Date).AddMinutes(-$MinutesAgo).ToString('s')
        $l | ConvertTo-Json | Set-Content $p
    }

    Context 'naming' {
        It 'is the first VM and numbered copies for a count' {
            $env:VMTEST_POOL = '3'
            (Get-PoolNames) -join ',' | Should Be "$first,$first-2,$first-3"
            $env:VMTEST_POOL = '1'
        }
        It 'takes a list of names, the first one first' {
            $env:VMTEST_POOL = 'A, B;C'
            (Get-PoolNames) -join ',' | Should Be 'A,B,C'
            $env:VMTEST_POOL = '1'
        }
        It 'never has fewer than one' {
            $env:VMTEST_POOL = '0'
            (Get-PoolNames) -join ',' | Should Be $first
            $env:VMTEST_POOL = '1'
        }
        foreach ($case in @(@(16, 8, 1), @(24, 8, 2), @(32, 12, 3), @(64, 32, 3), @(64, 4, 1))) {
            It "defaults to $($case[2]) on a PC with $($case[0]) GB and $($case[1]) processors" {
                $global:PesterCase = $case
                Mock -ModuleName VmTest Get-CimInstance { [pscustomobject]@{ TotalPhysicalMemory = $global:PesterCase[0] * 1GB; NumberOfLogicalProcessors = $global:PesterCase[1] } }
                InModuleScope VmTest { Get-DefaultPoolSize } | Should Be $case[2]
            }
        }
        It "keeps the first VM's lock in lock.json, so a task that held it before the pool still holds it" {
            New-Item -ItemType Directory $env:VMTEST_STATE -Force | Out-Null
            @{ repo = 'Mine'; branch = 'x'; checkpoint = $mine.Checkpoint; since = (Get-Date).ToString('s') } | ConvertTo-Json |
                Set-Content (Join-Path $env:VMTEST_STATE 'lock.json')
            $env:VMTEST_POOL = '2'
            Find-TaskVM $mine | Should Be $first
            Clear-VmTestLock -VMName $first
        }
        It 'gives Windows in a copy a name it accepts' {
            InModuleScope VmTest { ConvertTo-ComputerName 'ClaudeTesting-2' } | Should Be 'ClaudeTesting-2'
            (InModuleScope VmTest { ConvertTo-ComputerName 'A very long VM name 2' }).Length -le 15 | Should Be $true
        }
    }

    $env:VMTEST_POOL = '2'
    function Use-TwoVMs([string[]]$FirstCheckpoints = @('Clean'), [string[]]$SecondCheckpoints = @('Clean'), [double]$FreeGB = 64) {
        Use-FakePool -FreeGB $FreeGB @{ $first = (New-FakeVM -Checkpoints $FirstCheckpoints -State 'Running'); $second = (New-FakeVM -Checkpoints $SecondCheckpoints) }
    }

    It 'gives a second task the free VM while the first is in use' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 5
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match "'$second' is ready for Mine / x, started from Clean"
        Find-TaskVM $mine | Should Be $second
        (Get-VmTestLock -VMName $first).repo | Should Be 'Other'
        @(Get-AllCalls | Where-Object { $_ -like "${first}:*" }).Count | Should Be 0
    }
    It "prefers the free VM that has this task's checkpoint" {
        Use-TwoVMs -SecondCheckpoints 'Clean', $mine.Checkpoint; Reset-Locks
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match "'$second' .* this task's checkpoint"
        (FakeVM $second).Calls -contains "restore $($mine.Checkpoint)" | Should Be $true
    }
    It "starts from Clean elsewhere when its checkpoint's VM is busy, says so, and save drops the older copy" {
        Use-TwoVMs -FirstCheckpoints 'Clean', $mine.Checkpoint; Reset-Locks
        Set-HeldSince $first $other 5
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match "checkpoint is on '$first', which is busy, so this started from Clean"
        Invoke-VmTestSave -Repo 'Mine' -Branch 'x' | Out-Null
        (FakeVM $second).Checkpoints -contains $mine.Checkpoint | Should Be $true
        (FakeVM $first).Checkpoints -contains $mine.Checkpoint | Should Be $false
        (Get-VmTestLock -VMName $first).repo | Should Be 'Other'
    }
    It 'says who holds every VM when all are busy, as an error -Wait waits out, and touches nothing' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 5
        Set-HeldSince $second $third 10
        $err = $null
        try { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } catch { $err = $_ }
        $err.Exception.Message | Should Match "'$first' is in use by Other / work"
        $err.Exception.Message | Should Match "'$second' is in use by Third / y .* last used 10 minutes ago"
        $err.Exception.Message | Should Match "If '$second' is still idle at"
        $err.Exception.Data['vmtestBusy'] | Should Be $true
        @(Get-AllCalls).Count | Should Be 0
    }
    It 'saves an idle task for it and takes its VM when none is free' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 5
        Set-HeldSince $second $third 200
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match 'Third / y had held it unused for 3 hours 20 minutes, so its state was saved first'
        (FakeVM $second).Checkpoints -contains $third.Checkpoint | Should Be $true
        Find-TaskVM $mine | Should Be $second
        Find-TaskVM $third | Should BeNullOrEmpty
        (Get-VmTestLock -VMName $first).repo | Should Be 'Other'
    }
    It 'counts a recent command, not just when the VM was taken' {
        Reset-Locks
        Use-FakePool -FreeGB 64 @{ $first = (New-FakeVM -State 'Running'); $second = (New-FakeVM -State 'Running') }
        Set-HeldSince $first $other 300
        Set-HeldSince $second $third 300
        Assert-TaskHasVM -Repo 'Other' -Branch 'work'
        Assert-TaskHasVM -Repo 'Third' -Branch 'y'
        { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } | Should Throw 'last used under a minute ago'
    }
    It 'ignores a note of use from a task that no longer holds the VM' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $second $third 300
        InModuleScope VmTest { Set-TaskActivity -Task (Resolve-Task -Repo 'Gone' -Branch 'z') -VMName "$env:VMTEST_VM-2" }
        InModuleScope VmTest { Test-LockStale (Get-VmTestLock "$env:VMTEST_VM-2") } | Should Be $true
    }
    It 'never takes an idle VM when VMTEST_STALE_MINUTES is 0' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 500
        Set-HeldSince $second $third 500
        $env:VMTEST_STALE_MINUTES = '0'
        try { { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } | Should Throw 'is in use by' }
        finally { Remove-Item Env:\VMTEST_STALE_MINUTES }
    }
    It "takes an idle VM that has this task's checkpoint before a free one without it" {
        Use-TwoVMs -FirstCheckpoints 'Clean', $mine.Checkpoint; Reset-Locks
        Set-HeldSince $first $other 300
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match "'$first' .* this task's checkpoint"
        (FakeVM $first).Checkpoints -contains $other.Checkpoint | Should Be $true
    }
    It "won't start a VM without the memory for it, and says so" {
        Use-TwoVMs -FreeGB 5; Reset-Locks
        Set-HeldSince $first $other 5
        $err = $null
        try { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } catch { $err = $_ }
        $err.Exception.Message | Should Match "'$second' is free, but this PC has 5.0 GB of memory free and starting one needs 8.0 GB"
        $err.Exception.Data['vmtestBusy'] | Should Be $true
        @(Get-AllCalls).Count | Should Be 0
    }
    It 'with -Force takes the longest-idle VM and says what was lost' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 5
        Set-HeldSince $second $third 30
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' -Force | Should Match 'taken from Third / y with -Force'
        Find-TaskVM $mine | Should Be $second
    }
    It 'gives the VM asked for with -VM, and refuses one that is not in the pool' {
        Use-TwoVMs; Reset-Locks
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' -VM $second | Should Match "'$second' is ready"
        Reset-Locks
        { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' -VM 'nope' } | Should Throw "'nope' isn't one of the test VMs"
    }
    It 'skips a VM that has no Clean yet (still being made)' {
        Use-TwoVMs -SecondCheckpoints @(); Reset-Locks
        Set-HeldSince $first $other 5
        { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } | Should Throw "'$first' is in use by Other / work"
    }
    It 'carries on with the VM this task holds, whichever it is' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $second $mine 5
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' | Should Match "'$second' .* where this task left it"
        @(Get-AllCalls | Where-Object { $_ -like '*restore*' }).Count | Should Be 0
    }
    It 'waits with -WaitSeconds until a VM is free' {
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $first $other 5
        Set-HeldSince $second $third 5
        Mock -ModuleName VmTest Start-Sleep { Clear-VmTestLock -VMName "$env:VMTEST_VM-2" }
        Mock -ModuleName VmTest Write-Host {}
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' -WaitSeconds 60 | Should Match "'$second' is ready"
        Assert-MockCalled -ModuleName VmTest Start-Sleep -Times 1 -Exactly
    }
    It 'commands work on the VM the task holds' {
        Reset-Locks
        Use-FakePool -FreeGB 64 @{ $first = (New-FakeVM -State 'Running'); $second = (New-FakeVM -State 'Running') }
        Set-HeldSince $second $mine 5
        Assert-TaskHasVM -Repo 'Mine' -Branch 'x'
        InModuleScope VmTest { Get-VMName } | Should Be $second
    }
    It 'end drops the checkpoint from every VM but resets only the one this task holds' {
        Use-TwoVMs -FirstCheckpoints 'Clean', $mine.Checkpoint -SecondCheckpoints 'Clean', $mine.Checkpoint; Reset-Locks
        Set-HeldSince $first $other 5
        Set-HeldSince $second $mine 5
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' | Should Match "Put '$second' back to 'Clean'"
        (FakeVM $first).Checkpoints -contains $mine.Checkpoint | Should Be $false
        (FakeVM $second).Checkpoints -contains $mine.Checkpoint | Should Be $false
        @((FakeVM $first).Calls | Where-Object { $_ -like 'restore*' }).Count | Should Be 0
        (Get-VmTestLock -VMName $first).repo | Should Be 'Other'
        Get-VmTestLock -VMName $second | Should BeNullOrEmpty
    }
    It 'status lists each VM, who holds it, and the ones not made yet' {
        $env:VMTEST_POOL = '3'
        Use-TwoVMs; Reset-Locks
        Set-HeldSince $second $third 300
        $s = (Get-VmTestStatus) -join "`n"
        $s | Should Match "'$first': Running, free"
        $s | Should Match "'$second': Saved, in use by Third / y .* idle long enough"
        $s | Should Match "'$first-3': not made yet"
        $env:VMTEST_POOL = '2'
    }
    It "says when -VM starts from Clean while this task's checkpoint is on another VM" {
        Use-TwoVMs -FirstCheckpoints 'Clean', $mine.Checkpoint; Reset-Locks
        Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' -VM $second | Should Match "checkpoint is on '$first'"
    }
    It "never takes a lock from before the pool for idle, until its task's first command notes a use" {
        Use-TwoVMs; Reset-Locks
        New-Item -ItemType Directory $env:VMTEST_STATE -Force | Out-Null
        @{ repo = 'Other'; branch = 'work'; checkpoint = $other.Checkpoint; since = (Get-Date).AddHours(-5).ToString('s') } | ConvertTo-Json |
            Set-Content (Join-Path $env:VMTEST_STATE 'lock.json')
        InModuleScope VmTest { Test-LockStale (Get-VmTestLock $env:VMTEST_VM) } | Should Be $false
    }
    It 'end -VM refuses a VM outside the pool, and -Force names the task that lost its state' {
        Use-TwoVMs; Reset-Locks
        { Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' -VM 'SomeoneElsesVM' -Force } | Should Throw "isn't one of the pool's test VMs"
        Set-HeldSince $second $other 5
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' -VM $second -Force | Should Match 'in use by Other / work, whose unsaved state is lost'
    }
    It 'shows the time a VM was taken in a form that reads aloud well' {
        $t = (Get-Date).Date.AddHours(15).AddMinutes(4).ToString('s')
        $global:PesterTime = $t
        InModuleScope VmTest { Format-Since $global:PesterTime } | Should Be (Get-Date $t).ToString('h:mm tt')
    }
    Reset-Locks
    $env:VMTEST_POOL = '1'
    Remove-Item Env:\VMTEST_STATE
}

Describe 'settings' {
    It 'says what is wrong with a setting that is not a number' {
        $env:VMTEST_STALE_MINUTES = 'two hours'
        try { { Get-VmTestConfig } | Should Throw "VMTEST_STALE_MINUTES is 'two hours'" } finally { Remove-Item Env:\VMTEST_STALE_MINUTES }
    }
    It 'refuses pool names that could reach outside its folders' {
        $env:VMTEST_POOL = 'ClaudeTesting,..\x'
        try { { Get-PoolNames } | Should Throw "isn't a usable VM name" } finally { $env:VMTEST_POOL = '1' }
    }
    It 'counts names that differ only in case once' {
        $env:VMTEST_POOL = 'A,a,B'
        try { (Get-PoolNames) -join ',' | Should Be 'A,B' } finally { $env:VMTEST_POOL = '1' }
    }
}

Describe 'making the pool' {
    $env:VMTEST_STATE = Join-Path $TestDrive 'making'
    It 'has nothing to make for a pool of one' {
        Use-FakeHyperV
        Invoke-VmTestPrepare -Pool | Should Match 'nothing to make'
    }
    It "leaves alone a VM with a pool name that vmtest didn't make" {
        $env:VMTEST_POOL = '2'
        Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM); $second = (New-FakeVM -Notes 'Somebody else') }
        Mock -ModuleName VmTest Remove-VM { throw 'must not be called' }
        Mock -ModuleName VmTest Export-VMSnapshot { throw 'must not be called' }
        (Invoke-VmTestPrepare -Pool -Force) -join ' ' | Should Match "wasn't made by vmtest, so it was left alone"
        { InModuleScope VmTest { Remove-PoolClone "$env:VMTEST_VM-2" } } | Should Throw "wasn't made by vmtest"
        $env:VMTEST_POOL = '1'
    }
    It "doesn't remake a copy a task is using" {
        $env:VMTEST_POOL = '2'
        Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM); $second = (New-FakeVM -Notes 'vmtest pool VM, made from x') }
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -VMName $second -Force
        Mock -ModuleName VmTest Export-VMSnapshot { throw 'must not be called' }
        (Invoke-VmTestPrepare -Pool -Force) -join ' ' | Should Match "in use by Other / work, so it wasn't remade"
        Clear-VmTestLock -VMName $second
        $env:VMTEST_POOL = '1'
    }
    It "doesn't remake a copy that has a task's saved state, and names it" {
        $env:VMTEST_POOL = '2'
        Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM); $second = (New-FakeVM -Checkpoints 'Clean', 'task AIChat x 123abc' -Notes 'vmtest pool VM, made from x') }
        Mock -ModuleName VmTest Export-VMSnapshot { throw 'must not be called' }
        Mock -ModuleName VmTest Remove-VM { throw 'must not be called' }
        (Invoke-VmTestPrepare -Pool -Force) -join ' ' | Should Match "has saved state for other tasks \(task AIChat x 123abc\), so it wasn't remade"
        $env:VMTEST_POOL = '1'
    }
    It "with -Force, skips a copy already made from the current Clean" {
        $env:VMTEST_POOL = '2'
        Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM); $second = (New-FakeVM -Notes 'vmtest pool VM, made from P''s Clean id-Clean on 1.') }
        Mock -ModuleName VmTest Export-VMSnapshot { throw 'must not be called' }
        (Invoke-VmTestPrepare -Pool -Force) -join ' ' | Should Match 'already made from the current Clean'
        $env:VMTEST_POOL = '1'
    }
    It 'never deletes a copy a task holds' {
        $env:VMTEST_POOL = '2'
        Use-FakePool @{ $env:VMTEST_VM = (New-FakeVM); $second = (New-FakeVM -Notes 'vmtest pool VM') }
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -VMName $second -Force
        Mock -ModuleName VmTest Remove-VM { throw 'must not be called' }
        { InModuleScope VmTest { Remove-PoolClone "$env:VMTEST_VM-2" } } | Should Throw 'in use by Other / work'
        Clear-VmTestLock -VMName $second
        $env:VMTEST_POOL = '1'
    }
    It 'uses an earlier copy of the same Clean again, but never a half-made one' {
        $r = Join-Path $TestDrive 'bases'
        $half = Join-Path $r 'base-1'; $done = Join-Path $r 'base-2'; $older = Join-Path $r 'base-3'
        New-Item -ItemType Directory $half, $done, $older -Force | Out-Null
        foreach ($b in $half, $done, $older) { Set-Content (Join-Path $b 'Clean.vhdx') 'x' }
        Set-Content (Join-Path $done 'clean-id.txt') 'id-now'
        Set-Content (Join-Path $older 'clean-id.txt') 'id-before'
        $global:PesterRoot = $r
        InModuleScope VmTest { Find-PoolBase -Root $global:PesterRoot -CleanId 'id-now' } | Should Be $done
        InModuleScope VmTest { Find-PoolBase -Root $global:PesterRoot -CleanId 'id-other' } | Should BeNullOrEmpty
    }
    Context 'cleaning up copies of Clean' {
        $vhdRoot = Join-Path $TestDrive 'vhd'
        $used = Join-Path $vhdRoot 'base-1'; $unused = Join-Path $vhdRoot 'base-2'
        New-Item -ItemType Directory $used, $unused -Force | Out-Null
        Set-Content (Join-Path $used 'p.vhdx') 'x'; Set-Content (Join-Path $unused 'p.vhdx') 'x'
        Mock -ModuleName VmTest Get-VM { [pscustomobject]@{ Name = 'clone' } }
        Mock -ModuleName VmTest Get-VMHardDiskDrive { [pscustomobject]@{ Path = 'C:\x\clone.vhdx' } }
        It "keeps everything when a disk's parent can't be read" {
            Mock -ModuleName VmTest Get-VHD { throw 'no access' }
            $global:PesterRoot = $vhdRoot; InModuleScope VmTest { Remove-UnusedPoolBases $global:PesterRoot }
            Test-Path $unused | Should Be $true
            Test-Path $used | Should Be $true
        }
        It 'deletes only the copy no disk is made from' {
            $global:PesterUsed = Join-Path $used 'p.vhdx'
            Mock -ModuleName VmTest Get-VHD { if ($Path -eq 'C:\x\clone.vhdx') { [pscustomobject]@{ ParentPath = $global:PesterUsed } } else { [pscustomobject]@{ ParentPath = '' } } }
            $global:PesterRoot = $vhdRoot; InModuleScope VmTest { Remove-UnusedPoolBases $global:PesterRoot }
            Test-Path $unused | Should Be $false
            Test-Path $used | Should Be $true
        }
    }
    Remove-Item Env:\VMTEST_STATE
}

Describe 'reading who is signed in' {
    $header = ' USERNAME              SESSIONNAME        ID  STATE   IDLE TIME  LOGON TIME'
    It 'sees the console' {
        $s = InModuleScope VmTest { Get-SignInState -QuserLines @(' USERNAME  SESSIONNAME  ID  STATE', '>vmuser                console             1  Active      none   10/5/2026 7:25 AM') -UserName vmuser }
        $s.State | Should Be 'console'
    }
    It 'sees a disconnected session and its id' {
        $s = InModuleScope VmTest { Get-SignInState -QuserLines @('vmuser                                    2  Disc        5  10/5/2026 9:00 AM') -UserName vmuser }
        $s.State | Should Be 'disconnected'
        $s.Id | Should Be 2
    }
    It 'sees Remote Desktop' {
        $s = InModuleScope VmTest { Get-SignInState -QuserLines @('>vmuser                rdp-tcp#0           2  Active      none   10/5/2026 9:00 AM') -UserName vmuser }
        $s.State | Should Be 'remote'
    }
    It 'sees nobody' {
        (InModuleScope VmTest { Get-SignInState -QuserLines @('No User exists for *') -UserName vmuser }).State | Should Be 'none'
    }
}

Remove-Item Env:\VMTEST_VM
Remove-Item Env:\VMTEST_POOL

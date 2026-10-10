# Pester 3.4 tests (the version that ships with Windows). Run: Invoke-Pester vmtest\tests
# These need no VM. Hyper-V is replaced by a small fake that keeps checkpoints in memory, and the VM
# name points at one that doesn't exist, so a mistake here can never reach the real test VM.
$root = Split-Path $PSScriptRoot
$env:VMTEST_VM = 'vmtest-pester-no-such-vm'
Import-Module (Join-Path $root 'VmTest.psm1') -Force

# ---- the fake Hyper-V --------------------------------------------------------------------------
function Use-FakeHyperV {
    param([string[]]$Checkpoints = @('Clean'), [string]$State = 'Running', [string]$CheckpointType = 'Standard')
    $global:Fake = @{ Checkpoints = [System.Collections.Generic.List[string]]$Checkpoints; State = $State; Calls = New-Object System.Collections.Generic.List[string] }
    Mock -ModuleName VmTest Get-VM { [pscustomobject]@{ Name = $env:VMTEST_VM; State = $global:Fake.State; CheckpointType = $CheckpointType } }
    Mock -ModuleName VmTest Get-VMSnapshot { $global:Fake.Checkpoints | ForEach-Object { [pscustomobject]@{ Name = $_ } } }
    Mock -ModuleName VmTest Checkpoint-VM { $global:Fake.Calls.Add("checkpoint $SnapshotName"); $global:Fake.Checkpoints.Add($SnapshotName) }
    Mock -ModuleName VmTest Rename-VMSnapshot {
        $global:Fake.Calls.Add("rename $Name -> $NewName")
        $i = $global:Fake.Checkpoints.IndexOf($Name); $global:Fake.Checkpoints[$i] = $NewName
    }
    Mock -ModuleName VmTest Remove-VMSnapshot { $global:Fake.Calls.Add("remove $Name"); [void]$global:Fake.Checkpoints.Remove($Name) }
    Mock -ModuleName VmTest Restore-VMSnapshot { $global:Fake.Calls.Add("restore $Name"); $global:Fake.State = 'Saved' }
    Mock -ModuleName VmTest Stop-VM { $global:Fake.Calls.Add('turn off'); $global:Fake.State = 'Off' }
    Mock -ModuleName VmTest Start-VM { $global:Fake.Calls.Add('start'); $global:Fake.State = 'Running' }
    Mock -ModuleName VmTest Resume-VM { $global:Fake.Calls.Add('resume'); $global:Fake.State = 'Running' }
    Mock -ModuleName VmTest Save-VM { $global:Fake.Calls.Add('save vm'); $global:Fake.State = 'Saved' }
    Mock -ModuleName VmTest Set-VM { $global:Fake.Calls.Add("set $CheckpointType") }
    # The guest side: signed in, agent installs fine.
    Mock -ModuleName VmTest Wait-GuestSignedIn {}
    Mock -ModuleName VmTest New-GuestSession { 'session' }
    Mock -ModuleName VmTest Remove-PSSession {}
    Mock -ModuleName VmTest Install-GuestAgent {}
}

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
        { Set-VmTestLock -Task $b } | Should Throw 'in use by A / one'
        (Get-VmTestLock).repo | Should Be 'A'
    }
    It 'gives way to -Force' {
        Set-VmTestLock -Task $b -Force
        (Get-VmTestLock).repo | Should Be 'B'
    }
    It 'checks the holder' {
        { Assert-LockedBy -Task $b } | Should Not Throw
        { Assert-LockedBy -Task $a } | Should Throw 'belongs to B / two'
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
            $global:Fake.State | Should Be 'Running'
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
        { Invoke-VmTestBegin -Repo 'Mine' -Branch 'x' } | Should Throw 'in use by Other / work'
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
        { Invoke-VmTestSave -Repo 'Mine' -Branch 'x' } | Should Throw 'belongs to Other / work'
        $global:Fake.Calls.Count | Should Be 0
    }
    It 'save keeps the state, parks the VM and frees it' {
        Use-FakeHyperV
        Set-VmTestLock -Task $mine -Force
        Invoke-VmTestSave -Repo 'Mine' -Branch 'x' | Out-Null
        $global:Fake.Checkpoints -contains $mine.Checkpoint | Should Be $true
        $global:Fake.State | Should Be 'Saved'
        Get-VmTestLock | Should BeNullOrEmpty
    }
    It "end from another task only drops its own checkpoint" {
        Use-FakeHyperV -Checkpoints 'Clean', $mine.Checkpoint
        Set-VmTestLock -Task (Resolve-Task -Repo 'Other' -Branch 'work') -Force
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' | Should Match 'left as it is'
        $global:Fake.Checkpoints -contains $mine.Checkpoint | Should Be $false
        @($global:Fake.Calls | Where-Object { $_ -like 'restore*' }).Count | Should Be 0
        (Get-VmTestLock).repo | Should Be 'Other'
    }
    It 'end by the holder drops its checkpoint, goes back to Clean and frees the VM' {
        Use-FakeHyperV -Checkpoints 'Clean', $mine.Checkpoint
        Set-VmTestLock -Task $mine -Force
        Invoke-VmTestEnd -Repo 'Mine' -Branch 'x' | Should Match "back to 'Clean'"
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

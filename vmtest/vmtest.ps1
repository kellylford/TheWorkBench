<#
.SYNOPSIS
Test a Windows app inside the ClaudeTesting Hyper-V VM instead of on this PC.

.DESCRIPTION
A task (a repo and branch) takes the VM with 'begin', works in it, and either 'save's it (keep the
state for next time) or 'end's it (after merge: back to Clean). Repo and branch come from the
current git folder unless -Repo and -Branch are given.

  prepare [-Force]                 one time: automatic sign-in, agent, Clean checkpoint
  status                           VM state, who has it, checkpoints
  begin [-Force]                   take the VM; restore this task's checkpoint, or Clean
  deploy <path> [-Name n]          copy a build folder or file to C:\vmtest\apps\<name>
  launch <exe> [-Arguments "a b"] start a program in the VM (path inside the VM)
  windows                          list open windows and what has focus
  tree [-Window w] [-Depth n]      UI Automation tree of a window (default: the one in front)
  focused                          the control with keyboard focus
  invoke <control> [-Window w]     press, toggle, select or expand a control (AutomationId or name)
  setvalue <control> <value>       set a text box's value
  focus <control> [-Window w]      move keyboard focus to a control
  keys <keys> [-Window w]          send keys, SendKeys syntax: {TAB} {ENTER} ^s %f +{TAB}
  type <text> [-Window w]          type plain text
  run <command> [-Timeout s]       run a command line as the signed-in user (e.g. winget); default 600 s
  close [-Window w]                close a window
  shot <out.png> [-FromHost]       picture of the VM's screen
  save                             checkpoint this task, park the VM, release it
  end [-Force]                     after merge: delete this task's checkpoint, back to Clean

-Window is a process id or part of a window title.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory)]
    [ValidateSet('prepare', 'status', 'begin', 'deploy', 'launch', 'windows', 'tree', 'focused', 'invoke',
        'setvalue', 'focus', 'keys', 'type', 'run', 'close', 'shot', 'save', 'end')]
    [string]$Command,
    [Parameter(Position = 1)][string]$Target,
    [Parameter(Position = 2)][string]$Value,
    [string]$Repo,
    [string]$Branch,
    [string]$Name,
    [string]$Arguments,
    [string]$Window,
    [int]$Depth = 6,
    [int]$Timeout = 600,
    [switch]$FromHost,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'VmTest.psm1') -Force

function Need([string]$what) { if (-not $Target) { throw "'vmtest $Command' needs $what." } }

function Show-Answer($r) {
    if ($r.result) { $r.result }
    if ($r.title) { "Window: $($r.title)" }
    if ($r.pid) { "Process id: $($r.pid)" }
    if ($r.lines) { $r.lines }
    if ($r.focus) { "Focus: $($r.focus)" }
    if ($r.warning) { "Note: $($r.warning)" }
}

try {
    switch ($Command) {
        'prepare' { Invoke-VmTestPrepare -Force:$Force }
        'status' { Get-VmTestStatus }
        'begin' { Invoke-VmTestBegin -Repo $Repo -Branch $Branch -Force:$Force }
        'deploy' { Need 'a folder or file to copy'; Invoke-VmTestDeploy -Path $Target -Name $Name }
        'launch' { Need 'the program path inside the VM'; Show-Answer (Invoke-GuestAgent @{ op = 'launch'; path = $Target; args = $Arguments }) }
        'windows' { Show-Answer (Invoke-GuestAgent @{ op = 'windows' }) }
        'tree' { Show-Answer (Invoke-GuestAgent @{ op = 'tree'; window = $Window; depth = $Depth }) }
        'focused' { Show-Answer (Invoke-GuestAgent @{ op = 'focused' }) }
        'invoke' { Need 'a control (AutomationId or name)'; Show-Answer (Invoke-GuestAgent @{ op = 'invoke'; window = $Window; target = $Target }) }
        'setvalue' { Need 'a control (AutomationId or name)'; Show-Answer (Invoke-GuestAgent @{ op = 'setvalue'; window = $Window; target = $Target; value = $Value }) }
        'focus' { Need 'a control (AutomationId or name)'; Show-Answer (Invoke-GuestAgent @{ op = 'focus'; window = $Window; target = $Target }) }
        'keys' { Need 'keys to send'; Show-Answer (Invoke-GuestAgent @{ op = 'keys'; window = $Window; keys = $Target }) }
        'type' { Need 'text to type'; Show-Answer (Invoke-GuestAgent @{ op = 'type'; window = $Window; text = $Target }) }
        'run' { Need 'a command line'; Show-Answer (Invoke-GuestAgent @{ op = 'run'; command = $Target; timeout = $Timeout } -TimeoutSec ($Timeout + 30)) }
        'close' { Show-Answer (Invoke-GuestAgent @{ op = 'close'; window = $Window }) }
        'shot' { Need 'a file to save the picture to'; Invoke-VmTestShot -Out $Target -FromHost:$FromHost }
        'save' { Invoke-VmTestSave -Repo $Repo -Branch $Branch }
        'end' { Invoke-VmTestEnd -Repo $Repo -Branch $Branch -Force:$Force }
    }
} catch {
    Write-Host "vmtest $Command failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ClaudeSpeak installer.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#
# Copies the scripts and the skill into your Claude Code folder and adds the Stop hook to
# settings.json, merging with whatever is already there rather than replacing it.
#
# -DestRoot lets you install somewhere else (used by the tests). -WhatIf reports what would
# happen and changes nothing.

param(
    [string]$DestRoot = (Join-Path $env:USERPROFILE '.claude'),
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say([string]$m) { Write-Host $m }
function Act([string]$m) { if ($WhatIf) { Write-Host "would: $m" } else { Write-Host $m } }

Say ''
Say 'ClaudeSpeak installer'
Say "  source: $here"
Say "  target: $DestRoot"
Say ''

# --- scripts ----------------------------------------------------------------------------
$scripts = Get-ChildItem (Join-Path $here 'scripts') -Filter '*.ps1' -ErrorAction SilentlyContinue
if (-not $scripts) { throw "No scripts found in $here\scripts - run this from inside the ClaudeSpeak folder." }

if (-not $WhatIf -and -not (Test-Path $DestRoot)) { New-Item -ItemType Directory -Path $DestRoot -Force | Out-Null }
foreach ($s in $scripts) {
    Act "copy $($s.Name)"
    if (-not $WhatIf) { Copy-Item $s.FullName (Join-Path $DestRoot $s.Name) -Force }
}

# --- skill ------------------------------------------------------------------------------
$skillSrc = Join-Path $here 'skills\voice-setup'
if (Test-Path $skillSrc) {
    $skillDest = Join-Path $DestRoot 'skills\voice-setup'
    Act "install skill -> skills\voice-setup\SKILL.md"
    if (-not $WhatIf) {
        New-Item -ItemType Directory -Path $skillDest -Force | Out-Null
        Copy-Item (Join-Path $skillSrc '*') $skillDest -Recurse -Force
    }
}

# --- config -----------------------------------------------------------------------------
# Only seeded if absent: re-running the installer must never overwrite someone's choices.
$cfgPath = Join-Path $DestRoot 'speak-config.json'
if (Test-Path $cfgPath) {
    Say 'speak-config.json already exists - left alone'
} else {
    Act 'create speak-config.json (engine: auto)'
    if (-not $WhatIf) {
        $seed = '{
  "engine": "auto",
  "voice": "",
  "rate": null,
  "interrupt": true,
  "nvdaClientDll": ""
}'
        [System.IO.File]::WriteAllText($cfgPath, $seed, (New-Object System.Text.UTF8Encoding($false)))
    }
}

# --- settings.json ----------------------------------------------------------------------
# Merged, never replaced. A settings file is the user's, and it usually has other things in
# it; clobbering it to add one hook would be a poor trade.
$settingsPath = Join-Path $DestRoot 'settings.json'
$hookCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $DestRoot 'speak-response.ps1')

$settings = $null
if (Test-Path $settingsPath) {
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Say ''
        Say "WARNING: $settingsPath is not valid JSON, so it was left untouched."
        Say 'Fix it, then re-run this installer. Add this by hand if you prefer:'
        Say ''
        Say '  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "<the command below>", "async": true, "timeout": 30 } ] } ] }'
        Say ''
        Say "  command: $hookCommand"
        exit 1
    }
}
if (-not $settings) { $settings = [pscustomobject]@{} }

$already = $false
if ($settings.PSObject.Properties.Name -contains 'hooks' -and $settings.hooks.PSObject.Properties.Name -contains 'Stop') {
    foreach ($group in @($settings.hooks.Stop)) {
        foreach ($h in @($group.hooks)) {
            if ($h.command -and $h.command -like '*speak-response.ps1*') { $already = $true }
        }
    }
}

if ($already) {
    Say 'Stop hook already present - left alone'
} else {
    Act 'add the Stop hook to settings.json'
    if (-not $WhatIf) {
        $entry = [pscustomobject]@{
            hooks = @([pscustomobject]@{
                type    = 'command'
                command = $hookCommand
                async   = $true
                timeout = 30
            })
        }
        if ($settings.PSObject.Properties.Name -notcontains 'hooks' -or -not $settings.hooks) {
            $settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([pscustomobject]@{}) -Force
        }

        # Build the array explicitly rather than through a pipeline. Piping collapses a
        # one-element result to a scalar, and ConvertTo-Json then emits Stop as an object
        # instead of an array - which does not match the hook schema and silently does nothing.
        $stopList = New-Object System.Collections.ArrayList
        if ($settings.hooks.PSObject.Properties.Name -contains 'Stop' -and $settings.hooks.Stop) {
            foreach ($g in @($settings.hooks.Stop)) { if ($g) { [void]$stopList.Add($g) } }
        }
        [void]$stopList.Add($entry)
        $settings.hooks | Add-Member -NotePropertyName 'Stop' -NotePropertyValue $stopList.ToArray() -Force

        # Back up before writing. This file often holds settings that took a while to get right.
        Copy-Item $settingsPath "$settingsPath.claudespeak-backup" -Force -ErrorAction SilentlyContinue

        # WriteAllText with an explicit no-BOM encoding: Set-Content -Encoding UTF8 emits a BOM
        # on Windows PowerShell, and a BOM at the head of settings.json can break JSON parsers.
        $json = $settings | ConvertTo-Json -Depth 12
        [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    }
}

Say ''
Say 'Done.'
Say ''
Say 'Restart Claude Code - hooks and skills are both read at session start.'
Say 'Then ask it anything, and it should speak.'
Say ''
Say 'To change the voice, rate, or what gets read aloud: type /voice-setup,'
Say 'or just say "change the voice Claude reads with".'
Say ''

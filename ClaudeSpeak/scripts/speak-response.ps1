# speak-response.ps1
# Claude Code Stop hook: speak Claude's reply aloud with a OneCore voice.
#
# Costs nothing in Claude usage — the harness runs this, so the text is read out of the
# transcript rather than produced a second time by the model.
#
# The hook JSON arrives on stdin. Never throws: a speech failure must not disrupt the session.
# Transcript parsing mirrors claude-chat-logger.ps1, which already solved the same problem.
$ErrorActionPreference = 'SilentlyContinue'

try {
    # Windows PowerShell decodes stdin as the console's OEM codepage unless told otherwise.
    # Must be set before [Console]::In is first touched, since the reader is built once.
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $hook = $raw | ConvertFrom-Json
} catch { exit 0 }

if ($hook.hook_event_name -ne 'Stop') { exit 0 }

$tp = [string]$hook.transcript_path
if (-not $tp -or -not (Test-Path -LiteralPath $tp)) { exit 0 }

$objs = @()
# -Encoding UTF8 is not optional: PowerShell 5.1 reads as the system ANSI codepage by
# default, which turns every em dash and curly quote in the transcript into mojibake that
# the synthesiser then tries to pronounce.
foreach ($ln in (Get-Content -LiteralPath $tp -Encoding UTF8)) {
    if ([string]::IsNullOrWhiteSpace($ln)) { $objs += , $null; continue }
    try { $objs += , ($ln | ConvertFrom-Json) } catch { $objs += , $null }
}

# Index of the last genuine user prompt (skip tool_result carriers).
$lastUser = -1
for ($i = 0; $i -lt $objs.Count; $i++) {
    $o = $objs[$i]
    if ($o -and $o.type -eq 'user' -and $o.message) {
        $c = $o.message.content
        $isTool = $false
        if ($c -is [System.Array]) {
            foreach ($it in $c) { if ($it.type -eq 'tool_result') { $isTool = $true; break } }
        }
        if (-not $isTool) { $lastUser = $i }
    }
}

# Every assistant text block after that prompt — skips thinking blocks and tool calls, so
# only what Claude actually "said" gets spoken.
$parts = @()
for ($i = $lastUser + 1; $i -lt $objs.Count; $i++) {
    $o = $objs[$i]
    if ($o -and $o.type -eq 'assistant' -and $o.message -and $o.message.content) {
        foreach ($it in $o.message.content) {
            if ($it.type -eq 'text' -and -not [string]::IsNullOrWhiteSpace($it.text)) {
                $parts += [string]$it.text
            }
        }
    }
}
if ($parts.Count -eq 0) { exit 0 }

$text = $parts -join "`n`n"

# What gets spoken is the user's call, not a hardcoded guess. Defaults below reproduce the
# original behaviour, so an absent or partial config changes nothing.
$content = $null
$cfgPath = Join-Path $env:USERPROFILE '.claude\speak-config.json'
if (Test-Path -LiteralPath $cfgPath) {
    try { $content = (Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).content } catch { }
}
function Opt($name, $default) {
    if ($content -and ($content.PSObject.Properties.Name -contains $name) -and $null -ne $content.$name) {
        return $content.$name
    }
    return $default
}
$optCode   = [string](Opt 'codeBlocks' 'announce')   # announce | omit | read
$optTables = [string](Opt 'tables'     'omit')       # omit | read
$optUrls   = [string](Opt 'urls'       'link')       # link | omit | read
$optFirst  = [bool]  (Opt 'firstParagraphOnly' $false)
$optMax    = [int]   (Opt 'maxChars'   0)            # 0 = no limit

# Markdown reads terribly aloud. Drop what is meant to be looked at rather than heard, and
# strip the punctuation that marks it up.
switch ($optCode) {
    'omit'   { $text = [regex]::Replace($text, '(?s)```.*?```', ' ') }
    'read'   { $text = [regex]::Replace($text, '(?s)```(\w*)\r?\n(.*?)```', ' $2 ') }
    default  { $text = [regex]::Replace($text, '(?s)```.*?```', ' Code block omitted. ') }
}
if ($optTables -ne 'read') {
    $text = [regex]::Replace($text, '(?m)^\s*\|.*$', '')                    # table rows
    $text = [regex]::Replace($text, '(?m)^\s*[-:|\s]+$', '')                # table rules
}
$text = [regex]::Replace($text, '\[([^\]]+)\]\([^)]*\)', '$1')              # links -> label
switch ($optUrls) {
    'omit'   { $text = [regex]::Replace($text, 'https?://\S+', ' ') }
    'read'   { }
    default  { $text = [regex]::Replace($text, 'https?://\S+', ' link ') }
}
$text = $text -replace '`', ''                                              # inline code ticks
$text = [regex]::Replace($text, '(?m)^\s{0,3}#{1,6}\s*', '')                # ATX headings
# Underscores are deliberately left alone: stripping them mangles identifiers like
# MSTTS_V110_enUS_ZiraM, and underscore emphasis is vanishingly rare here.
$text = [regex]::Replace($text, '(\*\*|\*|~~)', '')                         # emphasis
$text = [regex]::Replace($text, '(?m)^\s*>\s?', '')                         # block quotes
$text = [regex]::Replace($text, '(?m)^\s*[-*+]\s+', '')                     # bullet markers
$text = [regex]::Replace($text, '\n{3,}', "`n`n")
$text = $text.Trim()

# Length controls, applied last so they act on what would actually have been spoken.
if ($optFirst) { $text = ($text -split "`n`n")[0].Trim() }
if ($optMax -gt 0 -and $text.Length -gt $optMax) {
    $text = $text.Substring(0, $optMax).Trim() + '. Response truncated.'
}

if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

$dir = Join-Path $env:TEMP 'claude-speak'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

# Stop whatever the previous reply was still saying, so replies never overlap.
$pidFile = Join-Path $dir 'speaker.pid'
if (Test-Path $pidFile) {
    $old = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
    if ($old) { Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue }
}

$txtFile = Join-Path $dir 'response.txt'
[System.IO.File]::WriteAllText($txtFile, $text, (New-Object System.Text.UTF8Encoding($false)))

# Detached, so a long reply never holds up the session.
# speak-engine.ps1 is a drop-in for speak-onecore.ps1 (same -Path) that honours
# speak-config.json, so the route can change without editing this file again.
$speaker = Join-Path $env:USERPROFILE '.claude\speak-engine.ps1'
$proc = Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$speaker`"", '-Path', "`"$txtFile`""
)
if ($proc) { Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii }

exit 0

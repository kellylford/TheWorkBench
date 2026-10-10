# Make Claude Code read its responses aloud

Claude Code does not speak. This setup makes it read each reply out loud automatically, using
a system voice you choose, at whatever rate you like.

It works by hooking the event that fires when Claude finishes a reply, pulling the text out of
the session transcript, and handing it to the speech engine. **Claude itself is not involved**,
which matters: it costs nothing in tokens or usage. Asking Claude to speak its own responses
does cost tokens, because the text has to be written out a second time as a tool call.

Written for Windows. A shorter macOS/Linux version is at the end.

---

## What you need

- Claude Code
- Windows 10 or 11 (Windows PowerShell 5.1 is fine — no install needed)
- A voice. Windows ships several; the setup below defaults to the OneCore Zira voice.

**A note on voices.** Windows has two separate sets, and they sound different:

- **"Desktop" voices** (`Microsoft Zira Desktop`) — the older SAPI 5 set
- **OneCore voices** (`MSTTS_V110_enUS_ZiraM`) — newer, cleaner

Most PowerShell speech examples you will find online use `System.Speech`, which **can only see
the Desktop voices.** OneCore voices are reachable only through WinRT. The script below takes
the WinRT route, which is why it is longer than the usual one-liner.

To see what you have:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens' | ForEach-Object { $_.PSChildName }
```

More voices install under **Settings → Time & language → Speech → Manage voices**.

---

## Step 1 — the speaking script

Save as `%USERPROFILE%\.claude\speak-onecore.ps1`:

```powershell
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$VoiceMatch = 'ZiraM',
    [double]$Rate = 6.0        # WinRT SpeakingRate range is 0.5-6.0; 6 is maximum
)

$ErrorActionPreference = 'Stop'

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

    # PowerShell 5.1 has no await, so unwrap IAsyncOperation<T> by hand via AsTask.
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    function Await($operation, $resultType) {
        $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.Wait(-1) | Out-Null
        $task.Result
    }

    $text = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

    $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
             Where-Object { $_.Id -like "*$VoiceMatch*" } | Select-Object -First 1
    if ($voice) { $synth.Voice = $voice }
    $synth.Options.SpeakingRate = $Rate

    $stream = Await $synth.SynthesizeTextToStreamAsync($text) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    Await $reader.LoadAsync([uint32]$stream.Size) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $stream.Size
    $reader.ReadBytes($bytes)

    # Per-process WAV name: a second reply can start rendering while this one still plays.
    $wav = [System.IO.Path]::Combine($env:TEMP, "claude-speak-$PID.wav")
    [System.IO.File]::WriteAllBytes($wav, $bytes)

    $player = New-Object System.Media.SoundPlayer $wav
    $player.PlaySync()
    $player.Dispose()
    $synth.Dispose()
    Remove-Item -LiteralPath $wav -Force -ErrorAction SilentlyContinue
} catch {
    exit 0
}
```

## Step 2 — the hook script

Save as `%USERPROFILE%\.claude\speak-response.ps1`:

<!-- Fenced with four backticks: the script itself contains a triple-backtick regex. -->

````powershell
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
# default, which turns every em dash and curly quote into mojibake the synthesiser then
# tries to pronounce.
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

# Every assistant text block after that prompt - skips thinking blocks and tool calls, so
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

# Markdown reads terribly aloud. Drop what is meant to be looked at rather than heard, and
# strip the punctuation that marks it up.
$text = [regex]::Replace($text, '(?s)```.*?```', ' Code block omitted. ')
$text = [regex]::Replace($text, '(?m)^\s*\|.*$', '')
$text = [regex]::Replace($text, '(?m)^\s*[-:|\s]+$', '')
$text = [regex]::Replace($text, '\[([^\]]+)\]\([^)]*\)', '$1')
$text = [regex]::Replace($text, 'https?://\S+', ' link ')
$text = $text -replace '`', ''
$text = [regex]::Replace($text, '(?m)^\s{0,3}#{1,6}\s*', '')
# Underscores are deliberately left alone: stripping them mangles identifiers.
$text = [regex]::Replace($text, '(\*\*|\*|~~)', '')
$text = [regex]::Replace($text, '(?m)^\s*>\s?', '')
$text = [regex]::Replace($text, '(?m)^\s*[-*+]\s+', '')
$text = [regex]::Replace($text, '\n{3,}', "`n`n")
$text = $text.Trim()

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
$speaker = Join-Path $env:USERPROFILE '.claude\speak-onecore.ps1'
$proc = Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$speaker`"", '-Path', "`"$txtFile`""
)
if ($proc) { Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii }

exit 0
````

## Step 3 — register the hook

Edit `%USERPROFILE%\.claude\settings.json`. If the file already has settings, **add the
`hooks` key alongside them** — do not replace the file.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\\Users\\YOURNAME\\.claude\\speak-response.ps1\"",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `YOURNAME`. The path must be absolute — `%USERPROFILE%` is not expanded here.

Putting it in `%USERPROFILE%\.claude\settings.json` applies it to every project. For a single
project, use that project's `.claude/settings.json` instead.

## Step 4 — restart Claude Code

Settings changes are not always picked up mid-session. Start a new session and ask Claude
anything. It should speak.

---

## Adjusting it

**A different voice** — change `-VoiceMatch` in step 1's `param` block, or pass it from the
hook command. It matches against the voice Id, so `DavidM`, `MarkM`, `ZiraM` all work.

**Speed** — change `$Rate`. The WinRT range is `0.5` to `6.0`. `6.0` is maximum; `1.0` is
normal. Fast speech is a big win once you are used to it.

**What gets skipped** — the block of regexes in step 2. As written it drops code blocks
(replaced with "Code block omitted"), tables, and URLs (read as "link"), on the grounds that
those are meant to be looked at rather than heard. Delete any line you disagree with.

**Turning it off** — delete the `hooks` block from `settings.json`, or set
`"disableAllHooks": true` alongside it to suspend all hooks at once.

---

## When it does not work

**Nothing is spoken at all.** Test the hook by hand — take a `transcript_path` from
`%USERPROFILE%\.claude\projects\<project>\*.jsonl` and run:

```powershell
'{"hook_event_name":"Stop","transcript_path":"FULL\\PATH\\TO\\SESSION.jsonl"}' | powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\speak-response.ps1"
```

Then check that `%TEMP%\claude-speak\response.txt` contains the reply. If the file is right
but nothing is audible, the problem is in step 1's script. Run it directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\speak-onecore.ps1" -Path "$env:TEMP\claude-speak\response.txt"
```

**It reads mojibake** — "ΓÇö" instead of a dash, "caf├⌐" instead of "café". An encoding line
is missing. Both are needed and they fix different things: `[Console]::InputEncoding` covers
what arrives on stdin, `Get-Content -Encoding UTF8` covers the transcript file. Windows
PowerShell defaults to the OEM codepage for one and ANSI for the other, and neither is UTF-8.

**"No OneCore voice matching..."** — the voice is not installed, or the Id does not contain
your `-VoiceMatch` string. List what you have with the registry command near the top.

**Two replies talk over each other** — the previous speaker was not killed. Check that
`%TEMP%\claude-speak\speaker.pid` is being written.

**It hangs the session** — remove `"async": true` only if you want the opposite; that flag is
what keeps it from blocking. The script already detaches the speaker, so this should not
happen.

---

## Using a screen reader as well

This is deliberately independent of any screen reader. Claude's reply is spoken by the system
voice while your screen reader keeps doing its own job, so you are not relying on the terminal
being navigable to hear what was said.

If both talking at once is too much, lower the rate here, or drop `AnnounceStatus`-style
chatter by trimming the regex block so only the first paragraph is read:

```powershell
$text = ($text -split "`n`n")[0]
```

Claude Code also has a built-in `axScreenReader` setting that flattens its output (no
decorative borders or animations). Worth turning on separately:

```json
{ "axScreenReader": true }
```

---

## macOS and Linux

Much simpler, because both ship a command-line speech tool. Save as
`~/.claude/speak-response.sh`, `chmod +x` it:

````bash
#!/usr/bin/env bash
# Reads the hook JSON on stdin, speaks Claude's last reply.
set -uo pipefail

payload=$(cat)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty')
[ -z "$transcript" ] || [ ! -f "$transcript" ] && exit 0

text=$(jq -rs '
  (map(select(.type == "user" and (.message.content | type == "string"))) | length) as $_ |
  [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text]
  | last // empty
' "$transcript")

[ -z "$text" ] && exit 0

# Strip markdown that reads badly aloud.
text=$(printf '%s' "$text" \
  | perl -0777 -pe 's/```.*?```/ Code block omitted. /gs' \
  | perl -pe 's/\[([^\]]+)\]\([^)]*\)/$1/g; s{https?://\S+}{ link }g; s/[`*_~#>]//g')

pkill -f 'claude-speak-voice' 2>/dev/null

if command -v say >/dev/null; then          # macOS
  ( exec -a claude-speak-voice say -r 400 "$text" ) &
elif command -v spd-say >/dev/null; then    # Linux, speech-dispatcher
  ( exec -a claude-speak-voice spd-say -r 100 -w "$text" ) &
fi
exit 0
````

Register it the same way, with `"command": "$HOME/.claude/speak-response.sh"`.

On macOS, `say -v ?` lists voices; add `-v Samantha` to pick one. `-r` is words per minute —
`400` is very fast, `175` is default. Requires `jq` and `perl`.

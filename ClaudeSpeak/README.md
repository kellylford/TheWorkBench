# ClaudeSpeak

Make Claude Code read its responses aloud — through a Windows voice, or through JAWS or NVDA
so it uses the speech settings you already have.

Claude Code has no speech of its own. This hooks the event that fires when Claude finishes a
reply, pulls the text out of the session transcript, and hands it to a speech engine.

**Claude is not involved, so this costs nothing in tokens or usage.** That is the point of
doing it as a hook. Asking Claude to speak its own replies does cost tokens, because the text
has to be written out a second time as a tool call.

## Quick start

1. Copy everything in `scripts/` to `%USERPROFILE%\.claude\`.
2. Add this to `%USERPROFILE%\.claude\settings.json`, merging with whatever is already there:

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

3. Restart Claude Code and ask it anything.

That gets you a Windows system voice at maximum rate. To use your screen reader instead, or to
pick a different voice, see below.

## What is here

| Path | Role |
|---|---|
| [SETUP.md](SETUP.md) | Full instructions, customizing, troubleshooting, macOS/Linux |
| [SCREEN-READERS.md](SCREEN-READERS.md) | Routing speech through JAWS or NVDA |
| `scripts/speak-response.ps1` | The Stop hook. Extracts the reply, strips markdown, calls a speaker. |
| `scripts/speak-onecore.ps1` | Minimal speaker — Windows OneCore voices only |
| `scripts/speak-engine.ps1` | Configurable speaker — JAWS, NVDA, OneCore, or SAPI |
| `scripts/speak-voices.ps1` | Reports what is installed on this machine, as JSON |
| `skills/voice-setup/` | A Claude Code skill that configures it all conversationally |
| `speak-config.example.json` | Config template for `speak-engine.ps1` |

`speak-onecore.ps1` and `speak-engine.ps1` are interchangeable — same `-Path` parameter.
Start with the first, switch to the second when you want choices.

## Choosing a route

**Through your screen reader** (JAWS or NVDA) — Claude's replies use your voice, your rate,
and your punctuation level, and your usual silence key interrupts them. Nothing to configure.

**A separate system voice** — independent of the screen reader, keeps working when it is off,
and can be set to sound distinct so Claude is unmistakable.

Neither is correct in general. Try both; the trade-off is real in both directions.

To switch, copy `speak-config.example.json` to `%USERPROFILE%\.claude\speak-config.json`, set
`engine`, and point the hook's speaker line at `speak-engine.ps1`:

```powershell
$speaker = Join-Path $env:USERPROFILE '.claude\speak-engine.ps1'
```

Or install the skill and just say "change the voice Claude reads with".

## Status

- **JAWS** (`FreedomSci.JawsApi` COM) — verified working.
- **NVDA** (`nvdaControllerClient64.dll`) — written to NV Access's documented interface and
  compiles, but **not verified against a live NVDA**. The DLL does not ship with NVDA; it
  comes from their controller-client package separately.
- **OneCore** and **SAPI** voices — verified working.
- Windows only for the PowerShell scripts. `SETUP.md` has a shorter macOS/Linux version using
  `say` / `spd-say`.

## Design notes

Things that were not obvious and cost time to find:

- **`System.Speech` cannot see the OneCore voices.** Nearly every PowerShell speech example
  online uses it, which limits you to the older "Desktop" voices. OneCore is reachable only
  through WinRT, which is why `speak-onecore.ps1` is longer than a one-liner.
- **Two separate encoding traps.** Windows PowerShell decodes stdin as the OEM codepage and
  files as ANSI — neither is UTF-8. Miss either and the speech engine tries to pronounce
  mojibake. Both fixes are in `speak-response.ps1` and explained in `SETUP.md`.
- **Rate is never set for a screen-reader route.** Overriding a rate the user already chose is
  an accessibility defect, not a feature.
- **The engine always falls through** to another route if the configured one is unavailable.
  Consequence: a clean exit only means *something* spoke, not that your chosen route was used.
  Verify by listening.

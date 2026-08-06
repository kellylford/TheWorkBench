# ClaudeSpeak

Make Claude Code read its responses aloud — through a Windows voice, or through JAWS or NVDA
so it uses the speech settings you already have.

Claude Code has no speech of its own. This hooks the event that fires when Claude finishes a
reply, pulls the text out of the session transcript, and hands it to a speech engine.

**Claude is not involved, so this costs nothing in tokens or usage.** That is the point of
doing it as a hook. Asking Claude to speak its own replies does cost tokens, because the text
has to be written out a second time as a tool call.

## Download

[**Latest release**](https://github.com/kellylford/TheWorkBench/releases?q=claudespeak&expanded=true)
— a zip of just this folder. GitHub cannot download a single directory, so without it you
would have to clone the whole repository.

TheWorkBench holds several unrelated projects, so ClaudeSpeak releases are tagged
`claudespeak-v*`.

## Quick start

Extract the zip, then run **`install.bat`** from inside the ClaudeSpeak folder. It copies the scripts, installs the skill, seeds a
config, and adds the hook to your Claude Code `settings.json` — merging with whatever is
already there rather than replacing it, and backing the file up first. Then restart Claude
Code.

It is safe to re-run: an existing config or hook is left alone. If `settings.json` is not
valid JSON it refuses to touch the file and prints what to add by hand.

```
install.bat
```

To see what it would do without changing anything:

```
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -WhatIf
```

### Doing it by hand

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

With no config file, the engine runs in `auto`: it speaks through **JAWS or NVDA if one is
running**, and otherwise falls back to a Windows voice at maximum rate. So for most people
the quick start is the whole setup. Read on to pin a specific route or voice.

## What gets read aloud, and what does not

**Always spoken** — Claude's own prose from the reply just finished.

**Never spoken, regardless of settings:**

- Thinking blocks
- Tool calls and their arguments
- Tool output — file contents, command results, search hits
- Anything from earlier in the conversation. Only the newest reply is read.

That is a deliberate floor, not a setting. The point is to hear what Claude *said*, not to
have the machinery narrated at you.

**Configurable**, via the `content` block in `speak-config.json`:

| Setting | Default | Options |
|---|---|---|
| `codeBlocks` | `announce` | `announce` says "Code block omitted", `omit` skips silently, `read` speaks the code |
| `tables` | `omit` | `omit`, or `read` to hear the rows |
| `urls` | `link` | `link` says the word "link", `omit` drops them, `read` spells out the whole URL |
| `firstParagraphOnly` | `false` | Speak only the opening paragraph |
| `maxChars` | `0` | Stop after N characters and say "Response truncated". 0 = no limit |

Markdown punctuation — asterisks, backticks, heading hashes, bullet markers, blockquote
carets — is always stripped, because it is markup rather than words.

The skill can set all of these conversationally: "don't read code blocks", "just read me the
first paragraph", "read the full URLs".

## Replacing the echo, not adding to it

The obvious reading of this is "an extra voice on top of my screen reader". It can be the
opposite, and that turned out to be the better way to use it.

Turn **screen reader echo off in the terminal** and let Claude's speech be the only channel
there. Nothing competes, nothing talks over anything, and the terminal stops being a thing you
navigate and becomes a thing that talks to you. With speech routed through your screen reader,
your normal silence key still interrupts, so you keep full control.

Worth trying before assuming you want a second voice.

Screen reading users of Claude's terminal may also want to try a new screen reader mode
setting as well. Details on what it does and how to enable it are at:

https://support.claude.com/en/articles/15924927-use-claude-code-cli-with-a-screen-reader

That setting and ClaudeSpeak address different halves of the same problem — one changes what
Claude Code renders, the other changes how the reply reaches you. They are worth trying
together rather than instead of each other.

## What this covers, and what it does not

**This is Claude Code only.** The hook lives in Claude Code's `settings.json` and is run by
Claude Code. Putting it in `%USERPROFILE%\.claude\settings.json` — as the quick start does —
means it applies to **every Claude Code session on this machine, in every project and every
directory**. You set it up once.

It does **not** affect:

- **The Claude app or claude.ai in a browser.** Different product, no hooks, nothing local to
  run. Your normal screen reader is what reads those.
- **Claude on mobile.**
- **Sessions running in the cloud** (claude.ai/code, or an agent on a remote machine). The
  hook would have to run on the machine doing the speaking, and that is not yours.

Anything that is Claude Code running locally and reading your `~/.claude/settings.json` —
terminal, desktop app, IDE extension — uses it.

To scope it to one project instead of everything, put the same `hooks` block in that
project's `.claude/settings.json` rather than in your home directory.

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
`speak-response.ps1` ships pointing at the engine; `speak-onecore.ps1` is kept as the minimal
reference version, in case you want to read one short script rather than a router.

## Contributions welcome

Particularly:

- **Confirm NVDA on other architectures.** It is verified on ARM64 Windows with NVDA 2026.1.1.
  Plain x64 Windows *should* be the easier case, but nobody has actually run it there.
- **Other screen readers** — Narrator, VoiceOver, Orca. None are wired up.
- **macOS and Linux.** `SETUP.md` has a `say` / `spd-say` version that is far less developed
  than the Windows side.
- **Better markdown-to-speech.** The current stripping is a block of regexes and a set of
  judgement calls (code blocks dropped, tables dropped, URLs read as "link"). Those are
  guesses about what people want to hear, not findings.

Open an issue or a PR on [TheWorkBench](https://github.com/kellylford/TheWorkBench).

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

## Installing the skill

A **skill** is a folder containing a `SKILL.md` file. The frontmatter gives it a name and a
description; the body is instructions Claude follows when the skill is invoked. Claude Code
finds them automatically — there is no install command and nothing to register.

Copy the folder to one of two places, depending on how widely you want it:

| Put it here | Available in |
|---|---|
| `%USERPROFILE%\.claude\skills\voice-setup\` | every project, on this machine |
| `<project>\.claude\skills\voice-setup\` | that project only (and it can be committed, so your team gets it) |

For this one you almost certainly want the first:

```
xcopy /E /I skills\voice-setup "%USERPROFILE%\.claude\skills\voice-setup"
```

The result must be `...\skills\voice-setup\SKILL.md` — one folder per skill, with the file
named exactly `SKILL.md`.

**Restart Claude Code.** Skills are read at session start, so a newly added one is not visible
in a session that was already running.

Then use it either way:

- **By name**: type `/voice-setup`.
- **By asking**: say "change the voice Claude reads with", or "what voices do I have". Claude
  matches your request against the skill's `description` field, which is why that field lists
  trigger phrases rather than just explaining what the skill does.

Same rules apply to any skill, not just this one — the layout, the two locations, and the
restart are how Claude Code skills work generally.

## Status

- **JAWS** (`FreedomSci.JawsApi` COM) — verified working.
- **NVDA** (`nvdaControllerClient.dll`) — verified working, on NVDA 2026.1.1. Two things to
  know: the DLL **does not ship with NVDA** (it comes from NV Access's controller-client
  package), and it must match the architecture of **PowerShell**, not of NVDA. See
  [SCREEN-READERS.md](SCREEN-READERS.md).
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

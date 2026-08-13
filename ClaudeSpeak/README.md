# ClaudeSpeak

Make Claude Code read its responses aloud — through a system voice, or through your screen
reader so it uses the speech settings you already have.

**Windows** — a Windows voice, or JAWS or NVDA.
**macOS** — a `say` voice, or VoiceOver.

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

Extract the zip, then run the installer for your platform from inside the ClaudeSpeak folder.
It copies the scripts, installs the skill, seeds a config, and adds the hook to your Claude
Code `settings.json` — merging with whatever is already there rather than replacing it, and
backing the file up first. Then restart Claude Code.

It is safe to re-run: an existing config or hook is left alone. If `settings.json` is not
valid JSON it refuses to touch the file and prints what to add by hand.

**Windows:**

```
install.bat
```

**macOS:**

```bash
./install.sh
```

To see what either would do without changing anything:

```
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -WhatIf
```

```bash
./install.sh --dry-run
```

macOS needs `jq` and `perl`. Both ship with macOS 15 (Sequoia) and later; on 13 or 14,
`brew install jq`. The installer checks and stops with that message rather than letting you
discover it as silence.

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

That is the Windows path; the macOS equivalent is in [SETUP-macos.md](SETUP-macos.md).

With no config file, the engine runs in `auto`: it speaks through **your screen reader if one
is running** — JAWS or NVDA on Windows, VoiceOver on macOS — and otherwise falls back to a
system voice. So for most people the quick start is the whole setup. Read on to pin a specific
route or voice.

**One macOS gotcha worth knowing up front.** The VoiceOver route needs *VoiceOver Utility →
General → "Allow VoiceOver to be controlled with AppleScript"*, which is off by default. With
it off the route is silent **and reports success** — no error, exit status 0. Check that box
first if nothing speaks. Details in [VOICEOVER.md](VOICEOVER.md).

## What gets read aloud, and what does not

**Always spoken** — Claude's own prose from the reply just finished.

**Never spoken, regardless of settings:**

- Thinking blocks
- Tool calls and their arguments
- Tool output — file contents, command results, search hits
- Subagent chatter (macOS build; the Windows scripts do not yet filter this)
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

Shared:

| Path | Role |
|---|---|
| [SETUP.md](SETUP.md) | Windows: full instructions, customizing, troubleshooting |
| [SETUP-macos.md](SETUP-macos.md) | macOS: the same, for the shell scripts |
| [SCREEN-READERS.md](SCREEN-READERS.md) | Routing speech through JAWS or NVDA |
| [VOICEOVER.md](VOICEOVER.md) | Routing speech through VoiceOver |

Windows:

| Path | Role |
|---|---|
| `install.bat` / `install.ps1` | Installer |
| `scripts/speak-response.ps1` | The Stop hook. Extracts the reply, strips markdown, calls a speaker. |
| `scripts/speak-onecore.ps1` | Minimal speaker — Windows OneCore voices only |
| `scripts/speak-engine.ps1` | Configurable speaker — JAWS, NVDA, OneCore, or SAPI |
| `scripts/speak-voices.ps1` | Reports what is installed on this machine, as JSON |
| `skills/voice-setup/` | The skill that configures it all conversationally |
| `speak-config.example.json` | Config template |

macOS:

| Path | Role |
|---|---|
| `install.sh` | Installer |
| `scripts-macos/speak-response.sh` | The Stop hook. Extracts the reply, strips markdown, calls the engine. |
| `scripts-macos/speak-engine.sh` | Configurable speaker — VoiceOver or `say` |
| `scripts-macos/speak-voices.sh` | Reports what is installed on this machine, as JSON |
| `skills-macos/voice-setup/` | The skill, macOS wording |
| `speak-config.macos.example.json` | Config template |

The two sides are deliberately independent — same design, same config shape, no shared code.
A PowerShell script and a shell script have little to gain from being merged, and plenty to
lose in readability.

`speak-onecore.ps1` and `speak-engine.ps1` are interchangeable — same `-Path` parameter.
`speak-response.ps1` ships pointing at the engine; `speak-onecore.ps1` is kept as the minimal
reference version, in case you want to read one short script rather than a router.

## Contributions welcome

Particularly:

- **Confirm NVDA on other architectures.** It is verified on ARM64 Windows with NVDA 2026.1.1.
  Plain x64 Windows *should* be the easier case, but nobody has actually run it there.
- **Confirm the macOS side anywhere else.** It is verified on exactly one machine: Apple
  silicon, macOS 27, VoiceOver with Eloquence. Intel, older macOS, and the `say` route as a
  daily driver are all unexercised.
- **Other screen readers** — Narrator, Orca. Neither is wired up.
- **Linux.** Nothing here. `SETUP.md` has an `spd-say` sketch that has never been run.
- **Drop the `jq` dependency on macOS.** `jq` only ships with macOS 15 and later, so 13 and 14
  need Homebrew for what should be a zero-install tool. Perl is present on every Mac and has
  `JSON::PP` in core, so the extraction could be done without `jq` at all.
- **Subagent filtering on Windows.** The macOS hook skips `isSidechain` transcript entries so
  subagent chatter is never spoken. The PowerShell hook does not, and probably should.
- **Better markdown-to-speech.** The current stripping is a block of regexes and a set of
  judgement calls (code blocks dropped, tables dropped, URLs read as "link"). Those are
  guesses about what people want to hear, not findings.

Open an issue or a PR on [TheWorkBench](https://github.com/kellylford/TheWorkBench).

## Choosing a route

The real question is not which voice. It is whether Claude should sound **like** your screen
reader or deliberately **unlike** it.

**Through your screen reader** (JAWS, NVDA, VoiceOver) — Claude's replies use your voice, your
rate, and your punctuation level, and your usual silence key interrupts them. Nothing to
configure, and it follows along if you change your screen reader's voice later. On macOS this
is also the only route that can reach **Eloquence**, which is a VoiceOver-only synthesiser and
does not appear in `say -v '?'` at all.

There is no voice setting on this route, by design — there is nothing to pick, and a screen
reader's voice is a global setting rather than a Claude preference.

**A separate system voice** — independent of the screen reader, keeps working when it is off,
and can be set to sound distinct so Claude is unmistakable. This is the only route where
choosing a voice means anything.

Neither is correct in general. Try both; the trade-off is real in both directions.

To switch on Windows, copy `speak-config.example.json` to
`%USERPROFILE%\.claude\speak-config.json`, set `engine`, and point the hook's speaker line at
`speak-engine.ps1`:

```powershell
$speaker = Join-Path $env:USERPROFILE '.claude\speak-engine.ps1'
```

On macOS, copy `speak-config.macos.example.json` to `~/.claude/speak-config.json` and set
`engine` to `voiceover`, `say`, or `auto`. Nothing else to repoint.

Or install the skill and just say "change the voice Claude reads with".

## Installing the skill

A **skill** is a folder containing a `SKILL.md` file. The frontmatter gives it a name and a
description; the body is instructions Claude follows when the skill is invoked. Claude Code
finds them automatically — there is no install command and nothing to register.

Copy the folder to one of two places, depending on how widely you want it:

| Put it here | Available in |
|---|---|
| `~/.claude/skills/voice-setup/` | every project, on this machine |
| `<project>/.claude/skills/voice-setup/` | that project only (and it can be committed, so your team gets it) |

For this one you almost certainly want the first:

```
xcopy /E /I skills\voice-setup "%USERPROFILE%\.claude\skills\voice-setup"
```

```bash
mkdir -p ~/.claude/skills/voice-setup
cp skills-macos/voice-setup/SKILL.md ~/.claude/skills/voice-setup/
```

The result must be `.../skills/voice-setup/SKILL.md` — one folder per skill, with the file
named exactly `SKILL.md`. Install the one for your platform; they are the same skill with
different instructions, and the installers already do this for you.

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

**Windows**

- **JAWS** (`FreedomSci.JawsApi` COM) — verified working.
- **NVDA** (`nvdaControllerClient.dll`) — verified working, on NVDA 2026.1.1. Two things to
  know: the DLL **does not ship with NVDA** (it comes from NV Access's controller-client
  package), and it must match the architecture of **PowerShell**, not of NVDA. See
  [SCREEN-READERS.md](SCREEN-READERS.md).
- **OneCore** and **SAPI** voices — verified working.

**macOS**

- **VoiceOver** (AppleScript `output`) — verified working, including Eloquence and Control to
  interrupt. Needs one checkbox; see [VOICEOVER.md](VOICEOVER.md).
- **`say` voices** — verified working.
- Verified on exactly one machine: Apple silicon, macOS 27, one Claude Code version. The
  installer was exercised against fresh installs, merging into an existing settings file,
  adding alongside someone else's Stop hook, repeat runs, and malformed JSON — but never on
  anyone else's setup.
- Needs `jq` and `perl`. Both ship with macOS 15 and later; on 13 or 14, `brew install jq`.

**Linux** — nothing. `SETUP.md` has an `spd-say` sketch that has never been run.

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
  Verify by listening, or read `last-route.log`.
- **VoiceOver's `output` fails silently when AppleScript control is off.** Exit status 0, no
  error, and property queries like `get version` keep answering — so the probe cannot tell the
  difference and neither can anything else. An hour went into debugging a config that was
  correct the whole time. It is now the first line of every macOS troubleshooting list here.
- **Eloquence is unreachable outside VoiceOver on macOS.** It is absent from `say -v '?'` and
  ships no assets on disk. The confusing part is that `say` *does* list Reed, Shelley, Bobby
  and Rocko — Apple novelty voices that happen to share names with Eloquence variants, and
  sound nothing like them.
- **An apostrophe inside a single-quoted `jq` program ends the program.** `VoiceOver's` in a
  note string broke `speak-voices.sh` in a way whose error message pointed at a line five below
  the actual fault.
- **`say -v '?'` pads the voice name to a fixed column**, so a long name leaves exactly *one*
  space before the locale. Parsing on a run of two-or-more spaces looks right, works on most
  lines, and silently drops 160 of 422 voices — Samantha included. Parse from the right.
- **jq's `//` treats `false` as absent.** `.interrupt // empty` reads back as the default on
  `"interrupt": false`, so a boolean setting can appear to work while being impossible to
  turn off.
- **`shift 2` with one argument left is a no-op in bash 3.2**, which is the only bash on macOS.
  In an option-parsing `while` loop that is an infinite spin, not an error.
- **bash slices strings by byte unless the locale is UTF-8**, and a hook inherits whatever
  environment the terminal had. `maxChars` cut mid-codepoint and produced bytes the synthesiser
  refused, which presents as silence rather than as a mangled word.

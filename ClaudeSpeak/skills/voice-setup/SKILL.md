---
name: voice-setup
description: Configure how Claude Code reads its responses aloud — choose the speech route (JAWS, NVDA, or a Windows system voice), the specific voice, and the rate. Use when the user wants to change the speaking voice, change how fast it talks, route speech through their screen reader, turn read-aloud on or off, or set it up for the first time. Triggers include "change the voice", "read faster", "use JAWS instead", "what voices do I have", "stop reading responses aloud".
---

# Voice setup

Configures the read-aloud Stop hook. Everything lives in `~/.claude/`:

| File | Role |
|---|---|
| `speak-voices.ps1` | Reports what is installed, as JSON. Read-only. |
| `speak-engine.ps1` | Speaks a text file via the configured route. Never throws. |
| `speak-config.json` | The user's choice. This is what you edit. |
| `speak-response.ps1` | The Stop hook. Extracts the reply, strips markdown, calls a speaker. |
| `speak-onecore.ps1` | The original OneCore-only speaker. Superseded by `speak-engine.ps1`. |

## Always ask with question cards

**Every choice you put to the user MUST go through the `AskUserQuestion` tool.** Never ask in
prose, never present options as a numbered list in your reply, and never assume an answer
because it seems obvious from context.

This is not a style preference. The user drives this skill by keyboard with a screen reader,
and the question card is a real control they can arrow through and select. A question written
into prose is something they have to find in a transcript, parse, and answer by typing — which
is exactly the friction this whole project exists to remove.

Batch related questions into a single `AskUserQuestion` call rather than asking one, waiting,
asking the next.

**The card has hard limits: 1–4 questions, and 2–4 options per question.** Four is a cap, not a
target, and it applies to `multiSelect` exactly as it does to a single choice. Exceed it and
the call is rejected. `Other` is added for you — never write one yourself. Plan the options
against that ceiling *before* writing the call, because the repair when it fails is to drop
something, and dropping the option the user wanted is the failure this skill exists to avoid.
When a fifth option will not fit, a second question is the room you have — questions are the
cheaper axis.

**Every `multiSelect` needs an explicit decline option, and it costs one of the four options.**
Without one, saying "none of these" means either tabbing past every option to reach Submit and
confirming through a warning, or typing it into `Other` — a lot of work for the most ordinary
answer there is. Make it the first option and name it for what it does: `Leave it as it is`.
So a `multiSelect` offers **at most three** real choices. Pick the three that fit what the user
is actually doing and say in your reply that the rest can be had by asking in words.

If the decline option somehow arrives selected alongside real changes, the real changes are the
answer; apply them and say which you applied.

**Put the consequence of an option in its `description`.** That renders in every case. A
`preview` is worth adding on single-choice questions — it is where a config snippet belongs —
but do not rely on it to carry anything the user must read, and do not count on it appearing on
a `multiSelect` at all.

Word the question to match the options on the card. Do not write "pick any, or none" unless a
*none* option is actually there — the instruction and the card have to agree, or the user is
hunting for a control that does not exist. If you had to drop a choice to fit the cap, do not
describe the card as if it were still on there.

The only things that do not need a card are reporting what you found and confirming what you
did.

## Ground rules

- **Never state what a voice sounds like, or which is "better".** Offer a preview and let the
  user decide. You cannot hear it; they can.
- **Never set a rate for a screen-reader route.** When speech goes through JAWS or NVDA, the
  voice, rate, and punctuation level are the user's own configured settings. Overriding them
  is an accessibility defect, not a feature. `rate` in the config applies only to `onecore`
  and `sapi`.
- **Never assume what is installed.** Run the probe. NVDA in particular needs a DLL that does
  *not* ship with NVDA itself.
- Do not describe how screen readers work to the user. If they report a problem, fix it.

## Steps

### 1. See what is actually available

```
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\speak-voices.ps1"
```

Returns `screenReaders` (with `available` and `running`), `systemVoices` (each with a `match`
string and its engine's `rateRange`), and `notes`.

### 2. Ask what they want — with a question card

Call `AskUserQuestion`. Offer **only** routes the probe actually found; never list NVDA if the
probe says there is no usable controller client, and never list a voice that is not installed.

A good first call asks two questions at once:

1. **Speech route** — one option per available route, plus `auto`. All four routes plus `auto`
   is five, one over the cap, so this only fits because the probe rules some out. If it still
   does not fit, drop `sapi` — `onecore` is the same idea and the probe's own note says it
   generally sounds cleaner.
2. **What gets read aloud** — a `multiSelect`, `Leave it as it is` first, then **three** of the
   trims people ask for: skip code blocks, skip tables, read full URLs, first paragraph only.
   Four plus the decline option does not fit; choose the three that suit what the user is
   doing, and mention in your reply that the fourth is available by asking. Skip this question
   entirely if the user already told you what they want.

Frame the real trade-off in the route descriptions:

- **Through their screen reader** (`jaws` / `nvda`) — their voice and rate, and their usual
  silence key interrupts it. Nothing to tune here.
- **A separate system voice** (`onecore` / `sapi`) — independent of the screen reader, keeps
  working when it is off, and can be set to a different voice so Claude is distinguishable
  from everything else on screen. Needs a voice and rate chosen.

If they pick a system voice, follow up with **another card** — voice and rate as two questions
in one call, one option per installed voice **of the chosen engine only** (listing both sets
can run past four options, and they are different voices anyway). `onecore` runs 0.5–6.0 (6 is
fastest); `sapi` runs -10 to 10. Do not ask about rate at all when the route is `jaws` or
`nvda`.

These are single-choice questions, so give every option a `preview` showing the resulting
config, e.g.:

```
engine: onecore
voice:  MSTTS_V110_enUS_ZiraM
rate:   6.0  (0.5-6.0, 6 = fastest)
```

### 3. Preview before committing

Write a config to a temp path and speak a sample with it — do not overwrite their working
config to audition something:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\speak-engine.ps1" -Path <sample.txt> -ConfigPath <temp-config.json>
```

Offer to try a couple of candidates back to back. Ask which they preferred rather than
guessing from the exit code — a successful exit only means something spoke.

### 4. Write the config

`~/.claude/speak-config.json`:

```json
{
  "engine": "jaws",
  "voice": "",
  "rate": null,
  "interrupt": true,
  "nvdaClientDll": ""
}
```

| Field | Meaning |
|---|---|
| `engine` | `jaws`, `nvda`, `onecore`, `sapi`, or `auto` (a running screen reader, else onecore) |
| `voice` | Substring of the voice's `match` value from the probe. Ignored for screen readers. |
| `rate` | `onecore` 0.5–6.0, `sapi` -10..10. Ignored for screen readers. |
| `interrupt` | Whether a new reply cuts off the previous one still speaking |
| `nvdaClientDll` | Full path to `nvdaControllerClient64.dll`, if not auto-found |

The engine always falls through to other routes if the configured one is unavailable, so a
config naming an uninstalled voice still speaks — it just will not sound like what was asked
for. Check the probe rather than trusting that speech happened.

### 4b. Offer control over what is spoken, not just how

Users often want less read at them rather than a different voice. These live in the `content`
block of the same config and are read by `speak-response.ps1`:

| Setting | Default | Options |
|---|---|---|
| `codeBlocks` | `announce` | `announce` / `omit` / `read` |
| `tables` | `omit` | `omit` / `read` |
| `urls` | `link` | `link` / `omit` / `read` |
| `firstParagraphOnly` | `false` | `true` speaks only the opening paragraph |
| `maxChars` | `0` | stop after N characters; 0 = no limit |

Map plain requests onto these rather than making the user learn the field names — "stop
reading me code" is `codeBlocks: omit`, "just the gist" is `firstParagraphOnly: true`, "read
the actual links" is `urls: read`.

When the user has *not* already said what they want, offer these as a `multiSelect` question
card rather than describing them and waiting for a reply. Five settings do not fit a four-option
card, and one of those four has to be `Leave it as it is` — so offer the three that suit what
they are doing and let the rest be asked for in words. See the card rules at the top; they are
the binding version.

State the floor when it is relevant: thinking blocks, tool calls and tool output are **never**
spoken whatever these are set to, and only the newest reply is read. Users sometimes assume
the opposite and are asking you to fix a problem they do not have.

### 5. Make sure the hook uses the engine

`speak-response.ps1` may still point at the original `speak-onecore.ps1`, which ignores the
config entirely. Check:

```
Select-String -Path "$env:USERPROFILE\.claude\speak-response.ps1" -Pattern "speak-onecore|speak-engine"
```

If it says `speak-onecore.ps1`, tell the user that config changes will have no effect until
that line points at `speak-engine.ps1`, and offer to change it. **Do not change it without
asking** — it is a working setup.

### 6. Confirm out loud

Speak a short confirmation through the new config. That is the only real proof, and it lands
in the channel the user is actually using.

## Turning it off

Remove the `Stop` block from `~/.claude/settings.json`, or set `"disableAllHooks": true`
alongside it to suspend every hook. Do not delete the scripts — turning it back on should not
mean rebuilding it.

## NVDA specifics

NVDA speech needs `nvdaControllerClient64.dll`, which is **not** installed with NVDA. It comes
from NV Access's controller-client package. If the probe reports NVDA running but the DLL
missing, tell the user to download it and drop it in `%USERPROFILE%\.claude\` — the engine
searches there first.

This route is written but has not been verified on this machine, since NVDA is not installed
here. Say so if the user relies on it, rather than reporting it as known-good.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing speaks | Hook not registered, or session needs restarting after a settings change |
| Wrong voice speaks | Config names a voice that is not installed; the engine fell through |
| Speech is mojibake | An encoding line is missing — see the ClaudeSpeak SETUP.md |
| Two replies overlap | `interrupt` is false, or the previous speaker process was not killed |
| Rate setting ignored | Route is `jaws` or `nvda`, where rate is the user's own setting. Working as intended. |

The hook writes the exact text it is about to speak to `%TEMP%\claude-speak\response.txt`.
Read that first when diagnosing — it separates "extracted the wrong text" from "failed to
speak the right text".

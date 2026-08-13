---
name: voice-setup
description: Configure how Claude Code reads its responses aloud on macOS — choose the speech route (VoiceOver, or a separate system voice via `say`), the specific voice, the rate, and what gets read. Use when the user wants to change the speaking voice, change how fast it talks, route speech through VoiceOver, use Eloquence, turn read-aloud on or off, or set it up for the first time. Triggers include "change the voice", "read faster", "use VoiceOver instead", "what voices do I have", "stop reading responses aloud", "read me the code blocks too".
---

# Voice setup (macOS)

Configures the read-aloud Stop hook. Everything lives in `~/.claude/`:

| File | Role |
|---|---|
| `speak-voices.sh` | Reports what is installed, as JSON. Read-only. |
| `speak-engine.sh` | Speaks a text file via the configured route. Never throws. |
| `speak-config.json` | The user's choice. This is what you edit. |
| `speak-response.sh` | The Stop hook. Extracts the reply, strips markdown, calls the engine. |

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
- **Never set a rate for the VoiceOver route.** When speech goes through VoiceOver, the voice,
  rate and punctuation level are the user's own configured settings. Overriding them is an
  accessibility defect, not a feature. `rate` in the config applies only to `say`.
- **Never assume what is installed.** Run the probe.
- **A clean exit only means *something* spoke, not that the chosen route spoke.** The engine
  falls through on purpose. Verify by asking the user what they heard, never by exit code.
- Do not describe how screen readers work to the user. If they report a problem, fix it.

## The two routes

The choice between them is not really about voices. It is: **should Claude sound like the
user's screen reader, or deliberately unlike it?**

**`voiceover`** — hands the text to VoiceOver via its AppleScript `output` command. Claude
speaks in **whatever voice VoiceOver is already set to**, at the user's rate and punctuation
level, and their usual silence key interrupts it. If they change their VoiceOver voice later,
Claude follows automatically with no config edit.

There is **no voice setting for this route, by design.** `voice` and `rate` in the config are
ignored here. Do not ask the user to pick a voice when they are on `voiceover` — there is
nothing to pick. VoiceOver's voice is not in its AppleScript dictionary, so it cannot be set
from here, and it should not be: it is a global setting governing everything they do, not a
Claude preference.

*Consequence worth knowing:* this is also the only route that can reach **Eloquence**, which is
a VoiceOver-only synthesiser on macOS — absent from `say -v '?'`, with no assets outside
VoiceOver. Mention this only if the user asks about Eloquence specifically. Do not present the
route as being "for Eloquence"; it is for using their own voice, whatever that is.

**`say`** — a separate system voice, independent of VoiceOver. Keeps working when VoiceOver is
off, and can be set to sound distinct so Claude is unmistakable against the screen reader.
**This is the only route where a voice choice exists**, so all the voice-selection cards below
belong to it. With `voice` empty it uses the machine's default Spoken Content voice, which is a
perfectly good answer and the right starting point.

**`auto`** — `voiceover` if VoiceOver is running, else `say`.

Neither route is correct in general. The trade-off is real in both directions.

## Steps

### 1. See what is actually available

```
~/.claude/speak-voices.sh
```

Returns `screenReaders` (VoiceOver, with `available`, `running`, `addressable`), `systemVoices`
(each with a `match` string), `rateRange`, and `notes`. It lists `en_*` voices only unless you
pass `--all`; with 400+ installed, dumping every language is noise.

`addressable` means Apple Events reach VoiceOver. It does **not** mean speech will be heard —
see the AppleScript gate below.

### 2. Ask what they want — with a question card

Call `AskUserQuestion`. Offer **only** routes the probe actually found.

A good first call asks two questions at once:

1. **Speech route** — `voiceover`, `say`, `auto`. Three options fits comfortably.
2. **What gets read aloud** — a `multiSelect`, `Leave it as it is` first, then **three** of the
   trims people ask for: skip code blocks, skip tables, read full URLs, first paragraph only.
   Four plus the decline option does not fit; choose the three that suit what the user is
   doing, and mention in your reply that the fourth is available by asking. Skip this question
   entirely if the user already told you what they want.

**Do not ask about voice or rate at all when the route is `voiceover`.** There is nothing to
set; see the routes section above.

### 2b. Choosing a `say` voice — narrow, then audition

Only for the `say` route. There are ~80 English voices and the card caps at four options, so a
flat list is impossible. Narrow in rounds, and **let them hear it before they commit** — you
cannot judge a voice and they can.

If the user already named a voice they know, skip straight to auditioning it. Do not make
somebody who said "use Alex" walk a decision tree.

**Round 1 — a card to narrow the field.** Group what the probe found. On a typical machine:

| Group | Examples |
|---|---|
| Keep the system default | whatever `voice: ""` already gives them |
| Standard | Alex, Samantha, Victoria, Tom, Karen, Daniel, Moira |
| Enhanced / Premium | Ava, Zoe, Karen, Allison, Nathan — higher quality, bigger download |
| Novelty | Bells, Zarvox, Trinoids, Whisper, Bad News |

Only offer groups the probe actually found, and say in the option `description` what the group
costs or gains.

**Round 2 — speak the candidates, then card.** Pick three from the chosen group, and speak each
one saying its own name, at the rate they are likely to use rather than the default:

```
~/.claude/speak-engine.sh --path <sample.txt> --config <temp-config.json>
```

Give each sample two or three sentences. A voice that is fine on "hello" often falls apart on a
paragraph, which is what they will actually be hearing. Then a card asking which they preferred
— never infer it from an exit code, and never say which one you think is better.

**Round 3 — rate.** Speak the chosen voice at two or three rates back to back and card it.
`say` rate is words per minute, roughly 90–720, default 175. Fast-speech users typically land
between 300 and 450, but ask; do not assume.

Every one of these is a single-choice question, so give each option a `preview` showing the
resulting config:

```
engine: say
voice:  Alex
rate:   400   (90-720 wpm, 175 = default)
```

### 3. Preview before committing

Write a config to a temp path and speak a sample with it — do not overwrite their working
config to audition something:

```
~/.claude/speak-engine.sh --path <sample.txt> --config <temp-config.json>
```

Use a sample long enough to judge — two or three sentences, not two words. A rate that is
comfortable on "hello" is often wrong on a paragraph.

Offer to try a couple of candidates back to back. Ask which they preferred rather than guessing
from the exit code.

### 4. Write the config

`~/.claude/speak-config.json`:

```json
{
  "engine": "voiceover",
  "voice": "",
  "rate": null,
  "interrupt": true,
  "content": {
    "codeBlocks": "announce",
    "tables": "omit",
    "urls": "link",
    "firstParagraphOnly": false,
    "maxChars": 0
  }
}
```

| Field | Meaning |
|---|---|
| `engine` | `voiceover`, `say`, or `auto` |
| `voice` | A `say` voice name from the probe's `match` field. Empty = the machine's default Spoken Content voice. Ignored for `voiceover`. |
| `rate` | `say` words per minute, ~90–720. Empty/null = the `say` default of 175. Ignored for `voiceover`. |
| `interrupt` | Whether a new reply cuts off the previous one still speaking. `say` route only — on `voiceover` the user's own silence key is the control, and nothing here can reach VoiceOver's speech queue. Do not offer this as a fix for overlap on that route. |

### 4b. Offer control over what is spoken, not just how

Users often want less read at them rather than a different voice. These live in the `content`
block and are read by `speak-response.sh`:

| Setting | Default | Options |
|---|---|---|
| `codeBlocks` | `announce` | `announce` / `omit` / `read` |
| `tables` | `omit` | `omit` / `read` |
| `urls` | `link` | `link` / `omit` / `read` |
| `firstParagraphOnly` | `false` | `true` speaks only the opening paragraph |
| `maxChars` | `0` | stop after N characters; 0 = no limit |

Map plain requests onto these rather than making the user learn the field names — "stop reading
me code" is `codeBlocks: omit`, "just the gist" is `firstParagraphOnly: true`, "read the actual
links" is `urls: read`.

When the user has *not* already said what they want, offer these as a `multiSelect` question
card rather than describing them and waiting for a reply. See the card rules at the top; they
are the binding version.

State the floor when it is relevant: thinking blocks, tool calls, tool output and subagent
chatter are **never** spoken whatever these are set to, and only the newest reply is read.
Users sometimes assume the opposite and are asking you to fix a problem they do not have.

### 5. Confirm out loud

Speak a short confirmation through the new config. That is the only real proof, and it lands in
the channel the user is actually using.

## The AppleScript gate

The `voiceover` route needs **VoiceOver Utility → General → "Allow VoiceOver to be controlled
with AppleScript"**. It is off by default.

The failure mode is nasty and worth recognising fast: with it off, the `output` command
**returns success and produces no sound**. No error, no warning, exit code 0. Property queries
like `get version` keep working, so the probe's `addressable` flag stays true. Nothing in
software can tell the difference.

So when a user reports silence on the `voiceover` route, send them to that checkbox first. Do
not go hunting through the config, the hook or the transcript — this is the cause the great
majority of the time.

Do not toggle it for them. It is a system accessibility setting and it is theirs to set.

## Turning it off

Remove the `Stop` block from `~/.claude/settings.json`, or set `"disableAllHooks": true`
alongside it to suspend every hook. Do not delete the scripts — turning it back on should not
mean rebuilding it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing speaks, route is `voiceover` | The AppleScript checkbox above. Check it first. |
| Nothing speaks at all | Hook not registered, or the session needs restarting after a settings change |
| Wrong voice speaks | The configured route was unavailable and the engine fell through to `say` |
| Two replies overlap, route is `say` | `interrupt` is false, or the previous speaker was not killed |
| Two replies overlap, route is `voiceover` | `interrupt` does not apply there. VoiceOver owns its own queue; the silence key is the control. |
| Voice or rate setting ignored | Route is `voiceover`, where both are the user's own VoiceOver settings. Working as intended. |
| Wants Claude to sound different from their screen reader | Route is `voiceover`, which by definition cannot. Switch to `say` and run the voice cards. |
| Wants Eloquence, or any specific VoiceOver voice | Route must be `voiceover`, and the voice is changed in VoiceOver Utility, not here. |

The hook writes the exact text it is about to speak to `$TMPDIR/claude-speak/response.txt`.
Read that first when diagnosing — it separates "extracted the wrong text" from "failed to speak
the right text".

To exercise the hook by hand, feed it the JSON it expects:

```
printf '{"hook_event_name":"Stop","transcript_path":"/full/path/to/session.jsonl"}' | ~/.claude/speak-response.sh
```

Transcripts live in `~/.claude/projects/<project>/*.jsonl`.

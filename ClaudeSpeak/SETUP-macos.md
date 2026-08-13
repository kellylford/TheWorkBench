# Make Claude Code read its responses aloud — macOS

Claude Code does not speak. This setup makes it read each reply out loud automatically, either
through VoiceOver or through a separate system voice.

It works by hooking the event that fires when Claude finishes a reply, pulling the text out of
the session transcript, and handing it to a speech engine. **Claude itself is not involved**,
which matters: it costs nothing in tokens or usage. Asking Claude to speak its own responses
does cost tokens, because the text has to be written out a second time as a tool call.

The Windows version is in [SETUP.md](SETUP.md).

---

## What you need

- Claude Code
- macOS with `jq` and `perl`. Both ship with macOS 15 (Sequoia) and later. On 13 or 14,
  `brew install jq` — perl has always been there.
- For the VoiceOver route: VoiceOver, and one checkbox described below.
- For the `say` route: nothing. Every Mac has 400+ voices already.

## Quick start

From inside the ClaudeSpeak folder:

```bash
./install.sh
```

It copies the scripts, installs the skill, seeds a config, and adds the hook to your Claude
Code `settings.json` — merging with whatever is already there rather than replacing it, and
backing the file up first. Then restart Claude Code.

It is safe to re-run: an existing config or hook is left alone. If `settings.json` is not valid
JSON it refuses to touch the file and prints what to add by hand.

To see what it would do without changing anything:

```bash
./install.sh --dry-run
```

The default engine is `auto` — VoiceOver if it is running, otherwise a system voice.

---

## Choosing a route

**`voiceover`** — Claude speaks in whatever voice VoiceOver is already set to, at your rate and
punctuation level, and your usual Control key interrupts it. Nothing to configure, and it
follows along if you change your VoiceOver voice later. This is also the only way to reach
Eloquence, which is a VoiceOver-only synthesiser on macOS.

**`say`** — a separate system voice, independent of VoiceOver. Keeps working when VoiceOver is
off, and can be set to sound distinct so Claude is unmistakable. This is the only route where
choosing a voice means anything.

**`auto`** — `voiceover` if VoiceOver is running, else `say`.

The real question is not which voice but whether Claude should sound *like* your screen reader
or deliberately *unlike* it. Try both; the trade-off is real in both directions.

[VOICEOVER.md](VOICEOVER.md) covers the VoiceOver route in full — including the AppleScript
checkbox, which is off by default and fails silently.

---

## The AppleScript checkbox

If you pick the VoiceOver route, turn on:

**VoiceOver Utility → General → "Allow VoiceOver to be controlled with AppleScript"**

With it off, speech is silent and every command still reports success — no error, exit status
0, and property queries keep answering. Nothing in software can detect it. Check this first if
the VoiceOver route is quiet.

---

## Doing it by hand

1. Copy everything in `scripts-macos/` to `~/.claude/` and `chmod +x` it:

   ```bash
   cp scripts-macos/*.sh ~/.claude/ && chmod +x ~/.claude/speak-*.sh
   ```

2. Copy the skill:

   ```bash
   mkdir -p ~/.claude/skills/voice-setup
   cp skills-macos/voice-setup/SKILL.md ~/.claude/skills/voice-setup/
   ```

3. Add this to `~/.claude/settings.json`, merging with whatever is already there:

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "/Users/YOURNAME/.claude/speak-response.sh",
               "async": true,
               "timeout": 30
             }
           ]
         }
       ]
     }
   }
   ```

   Replace `YOURNAME`. The path must be absolute — `~` and `$HOME` are not expanded here.

4. Restart Claude Code and ask it anything.

Putting it in `~/.claude/settings.json` applies it to every project on this machine. For a
single project, use that project's `.claude/settings.json` instead.

---

## Adjusting it

Everything lives in `~/.claude/speak-config.json`. See
[speak-config.macos.example.json](speak-config.macos.example.json) for an annotated copy, or
just say "change the voice Claude reads with" and let the skill do it.

| Setting | Default | Options |
|---|---|---|
| `engine` | `auto` | `voiceover`, `say`, `auto` |
| `voice` | `""` | A `say` voice name. Empty = the system default. Ignored for `voiceover`. |
| `rate` | `null` | `say` words per minute, ~90–720. Ignored for `voiceover`. |
| `interrupt` | `true` | Whether a new reply cuts off the previous one still speaking |

And under `content`:

| Setting | Default | Options |
|---|---|---|
| `codeBlocks` | `announce` | `announce` / `omit` / `read` |
| `tables` | `omit` | `omit` / `read` |
| `urls` | `link` | `link` / `omit` / `read` |
| `firstParagraphOnly` | `false` | `true` speaks only the opening paragraph |
| `maxChars` | `0` | stop after N characters; 0 = no limit |

To see what voices you have:

```bash
~/.claude/speak-voices.sh          # English only — there are usually 400+ in total
~/.claude/speak-voices.sh --all
```

**Turning it off** — remove the `Stop` block from `settings.json`, or set
`"disableAllHooks": true` alongside it to suspend all hooks at once. Do not delete the scripts;
turning it back on should not mean rebuilding it.

---

## When it does not work

**Nothing is spoken, and the route is `voiceover`.** The AppleScript checkbox above. This is
the cause the great majority of the time.

**Nothing is spoken at all.** Test the hook by hand — take a transcript from
`~/.claude/projects/<project>/*.jsonl` and run:

```bash
printf '{"hook_event_name":"Stop","transcript_path":"/full/path/to/session.jsonl"}' | ~/.claude/speak-response.sh
```

Then check that `$TMPDIR/claude-speak/response.txt` contains the reply. If the file is right
but nothing is audible, the problem is in the engine, not the extraction. Run it directly:

```bash
~/.claude/speak-engine.sh --path "$TMPDIR/claude-speak/response.txt"
```

**The wrong voice speaks.** The engine falls through when a route is unavailable. Check which
one actually ran:

```bash
cat "$TMPDIR/claude-speak/last-route.log"
```

**Two replies talk over each other.** `interrupt` is false, or the previous speaker was not
killed. Check that `$TMPDIR/claude-speak/speaker.pid` is being written.

**The rate setting is ignored.** The route is `voiceover`, where rate is your own VoiceOver
setting. Working as intended.

**`jq: command not found`.** macOS 13 or 14. `brew install jq`.

---

## What gets read aloud, and what does not

**Always spoken** — Claude's own prose from the reply just finished.

**Never spoken, regardless of settings:** thinking blocks, tool calls and their arguments, tool
output, subagent chatter, and anything from earlier in the conversation. Only the newest reply
is read. That is a deliberate floor, not a setting.

Markdown punctuation is always stripped, because it is markup rather than words. Underscores
are deliberately left alone — stripping them mangles identifiers.

---

## Using it alongside VoiceOver

Worth trying before assuming you want a second voice: turn **VoiceOver echo off in the
terminal** and let Claude's speech be the only channel there. Nothing competes, nothing talks
over anything, and the terminal stops being a thing you navigate and becomes a thing that talks
to you. On the `voiceover` route your Control key still interrupts, so you keep full control.

Claude Code also has a screen reader mode that changes what it renders — a different half of
the same problem, and worth turning on separately:

https://support.claude.com/en/articles/15924927-use-claude-code-cli-with-a-screen-reader

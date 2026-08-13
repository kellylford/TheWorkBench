# Routing speech through VoiceOver

The macOS counterpart to [SCREEN-READERS.md](SCREEN-READERS.md), which covers JAWS and NVDA on
Windows.

VoiceOver has an AppleScript `output` command. ClaudeSpeak hands Claude's reply to it, so the
reply is spoken by VoiceOver itself rather than by a second voice alongside it.

## What that buys

**Your voice, whatever it is.** There is no voice setting for this route, by design. VoiceOver
speaks in whatever voice, rate and punctuation level you already configured. Change your
VoiceOver voice next month and Claude follows, with no config edit and nothing to remember.

**Your silence key.** Control interrupts Claude exactly as it interrupts anything else. This is
the part that is hard to appreciate until you have it — a second voice you cannot stop mid-reply
gets old fast, and no amount of rate tuning fixes it.

**Eloquence, if you use it.** Eloquence is a VoiceOver-only synthesiser on macOS. It does not
appear in `say -v '?'` and ships no assets outside VoiceOver, so this route is the only way
Claude can reach it. The same is true of any other voice you have set up inside VoiceOver but
not system-wide.

The trade is that Claude then sounds exactly like your screen reader. If you would rather it be
unmistakable — a different voice, so you always know which is which — that is the `say` route,
and it is the only one where a voice choice exists at all. Neither is correct in general.

## The switch you have to turn on

**VoiceOver Utility → General → "Allow VoiceOver to be controlled with AppleScript."**

It is off by default. Open VoiceOver Utility with **VO-F8** while VoiceOver is running, or from
System Settings → Accessibility → VoiceOver.

**With it off, the route is silent and reports success.** No error, no warning, exit status 0.
Property queries like `get version` keep answering, so nothing in software can tell the
difference between "switched off" and "working". This is worth knowing before you spend an
evening debugging a config that was right the whole time.

So: if the `voiceover` route is quiet, check that box first, before anything else.

## Checking what you have

```bash
~/.claude/speak-voices.sh
```

Reports VoiceOver as `available`, `running` and `addressable`. Note that `addressable` only
means Apple Events are reaching VoiceOver — it goes true whether or not the AppleScript switch
is on, for the reason above. It is a necessary condition, not a sufficient one.

The only real test is listening:

```bash
osascript -e 'tell application "VoiceOver" to output "if you can hear this, the route works"'
```

## Which route actually spoke

The engine falls through to `say` when the configured route is unavailable, so a clean exit
only proves that *something* spoke. To see what:

```bash
cat "${TMPDIR:-/tmp}/claude-speak/last-route.log"
```

```
2026-08-13 10:52:01  requested=voiceover  used=voiceover  voice=<system default>  rate=<default>
```

`requested` is your config; `used` is what ran. When they differ, the route you asked for was
not available.

## Turning VoiceOver off

The `voiceover` route needs VoiceOver running. With `engine: auto` the engine falls back to a
`say` voice when VoiceOver is off, so speech does not simply stop — it changes character. With
`engine: voiceover` it falls back the same way rather than going quiet, on the grounds that
losing the reply entirely is the worse failure.

## What is not possible

**Setting the VoiceOver voice from here.** It is not in VoiceOver's AppleScript dictionary —
the commands are `output`, `click`, `move`, `select` and similar, with nothing for speech
settings. It should not be there either: the VoiceOver voice is a global setting governing
everything you do, not a Claude preference. Change it in VoiceOver Utility → Speech.

**Knowing whether VoiceOver actually spoke.** `output` returns the same success whether it
spoke, was interrupted, or was silently discarded. Everything downstream of it is inference.

## Other macOS screen readers

There are none in wide use. If you use something else and it has a scripting interface, the
engine is one `speak_*` function and a `case` arm — see `scripts-macos/speak-engine.sh`. Pull
requests welcome.

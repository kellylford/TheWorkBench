#!/usr/bin/env bash
# ClaudeSpeak installer (macOS).
#
#   ./install.sh
#
# Copies the scripts and the skill into your Claude Code folder and adds the Stop hook to
# settings.json, merging with whatever is already there rather than replacing it.
#
# --dest lets you install somewhere else (used by the tests). --dry-run reports what would
# happen and changes nothing.
set -uo pipefail

DEST="$HOME/.claude"
DRY=false

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run|-n) DRY=true; shift ;;
        --dest)       DEST="${2:-}"; shift 2 ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say_()  { printf '%s\n' "$*"; }
act()   { if [ "$DRY" = true ]; then printf 'would: %s\n' "$*"; else printf '%s\n' "$*"; fi; }

say_ ''
say_ 'ClaudeSpeak installer (macOS)'
say_ "  source: $here"
say_ "  target: $DEST"
say_ ''

# --- dependencies -------------------------------------------------------------------------
# jq ships with macOS 15 and later. On 13 and 14 it does not, and the hook is useless without
# it, so this is a hard stop rather than a warning discovered later as silence.
missing=""
command -v jq   >/dev/null 2>&1 || missing="$missing jq"
command -v perl >/dev/null 2>&1 || missing="$missing perl"
if [ -n "$missing" ]; then
    say_ "ERROR: missing required command(s):$missing"
    say_ ''
    case "$missing" in
        *jq*) say_ '  jq ships with macOS 15 (Sequoia) and later. On earlier versions:'
              say_ '    brew install jq'
              say_ '' ;;
    esac
    exit 1
fi

# --- scripts ------------------------------------------------------------------------------
src_scripts="$here/scripts-macos"
if ! ls "$src_scripts"/*.sh >/dev/null 2>&1; then
    say_ "ERROR: no scripts found in $src_scripts"
    say_ 'Run this from inside the ClaudeSpeak folder.'
    exit 1
fi

[ "$DRY" = true ] || mkdir -p "$DEST"
for s in "$src_scripts"/*.sh; do
    act "copy $(basename "$s")"
    if [ "$DRY" != true ]; then
        cp "$s" "$DEST/$(basename "$s")"
        chmod +x "$DEST/$(basename "$s")"
    fi
done

# --- skill --------------------------------------------------------------------------------
skill_src="$here/skills-macos/voice-setup"
if [ -d "$skill_src" ]; then
    act 'install skill -> skills/voice-setup/SKILL.md'
    if [ "$DRY" != true ]; then
        mkdir -p "$DEST/skills/voice-setup"
        cp -R "$skill_src/." "$DEST/skills/voice-setup/"
    fi
fi

# --- config -------------------------------------------------------------------------------
# Only seeded if absent: re-running the installer must never overwrite someone's choices.
cfg="$DEST/speak-config.json"
if [ -f "$cfg" ]; then
    say_ 'speak-config.json already exists - left alone'
else
    act 'create speak-config.json (engine: auto)'
    if [ "$DRY" != true ]; then
        cat > "$cfg" <<'JSON'
{
  "engine": "auto",
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
JSON
    fi
fi

# --- settings.json ------------------------------------------------------------------------
# Merged, never replaced. A settings file is the user's, and it usually has other things in
# it; clobbering it to add one hook would be a poor trade.
settings="$DEST/settings.json"
hook_cmd="$DEST/speak-response.sh"

manual_instructions() {
    say_ ''
    say_ 'Add this by hand if you prefer:'
    say_ ''
    say_ '  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "<the command below>", "async": true, "timeout": 30 } ] } ] }'
    say_ ''
    say_ "  command: $hook_cmd"
}

if [ -f "$settings" ] && ! jq -e . "$settings" >/dev/null 2>&1; then
    say_ ''
    say_ "WARNING: $settings is not valid JSON, so it was left untouched."
    say_ 'Fix it, then re-run this installer.'
    manual_instructions
    exit 1
fi

already=false
if [ -f "$settings" ]; then
    if jq -e --arg c 'speak-response.sh' \
        '[ (.hooks.Stop // [])[] | (.hooks // [])[] | .command // "" ]
         | map(select(contains($c))) | length > 0' "$settings" >/dev/null 2>&1; then
        already=true
    fi
fi

if [ "$already" = true ]; then
    say_ 'Stop hook already present - left alone'
else
    act 'add the Stop hook to settings.json'
    if [ "$DRY" != true ]; then
        # Back up before writing. This file often holds settings that took a while to get right.
        [ -f "$settings" ] && cp "$settings" "$settings.claudespeak-backup"
        [ -f "$settings" ] || printf '{}\n' > "$settings"

        tmp="$settings.claudespeak-tmp"
        if jq --arg c "$hook_cmd" '
              .hooks = (.hooks // {})
            | .hooks.Stop = ((.hooks.Stop // []) + [{
                hooks: [{ type: "command", command: $c, async: true, timeout: 30 }]
              }])
            ' "$settings" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
            mv "$tmp" "$settings"
        else
            rm -f "$tmp"
            say_ ''
            say_ "WARNING: could not update $settings automatically."
            manual_instructions
            exit 1
        fi
    fi
fi

say_ ''
say_ 'Done.'
say_ ''
say_ 'Restart Claude Code - hooks and skills are both read at session start.'
say_ 'Then ask it anything, and it should speak.'
say_ ''
say_ 'The default engine is auto: VoiceOver if it is running, else a system voice.'
say_ 'If VoiceOver is running but nothing is spoken, turn on'
say_ '  VoiceOver Utility > General > "Allow VoiceOver to be controlled with AppleScript"'
say_ 'That switch is off by default, and with it off the route is silent with no error.'
say_ ''
say_ 'To change the voice, rate, or what gets read aloud: type /voice-setup,'
say_ 'or just say "change the voice Claude reads with".'
say_ ''

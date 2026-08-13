#!/usr/bin/env bash
# ClaudeSpeak speaker (macOS). Speaks a text file through the configured route.
#
# Routes:
#   voiceover  - hands the text to VoiceOver, so it uses the user's own voice,
#                rate and punctuation level, and their usual silence key stops it.
#                Requires "Allow VoiceOver to be controlled with AppleScript"
#                (VoiceOver Utility > General).
#   say        - a separate system voice, independent of any screen reader.
#   auto       - voiceover if VoiceOver is running, else say.
#
# Never throws: a speech failure must not break the session.
set -uo pipefail

CLAUDE_DIR="$HOME/.claude"
path=""
config="$CLAUDE_DIR/speak-config.json"

# "shift; shift" rather than "shift 2": in bash 3.2, which is the only bash on macOS, "shift 2"
# with one argument left fails and shifts nothing, so a trailing "--path" spins forever.
while [ $# -gt 0 ]; do
    case "$1" in
        --path|-Path|-p)         path="${2:-}"; shift; shift ;;
        --config|-ConfigPath|-c) config="${2:-}"; shift; shift ;;
        *) [ -z "$path" ] && path="$1"; shift ;;
    esac
done

[ -n "$path" ] && [ -s "$path" ] || exit 0

jqv() { jq -r "$1 // empty" "$config" 2>/dev/null; }

# auto, not say: with no config file at all the documented behaviour is "your screen reader if
# one is running". Defaulting to say would put a second voice on top of VoiceOver, which is the
# exact failure this is meant to avoid.
engine=$(jqv '.engine'); : "${engine:=auto}"
engine=$(printf '%s' "$engine" | tr '[:upper:]' '[:lower:]')
voice=$(jqv '.voice')
rate=$(jqv '.rate')

vo_running() {
    pgrep -f 'VoiceOver.app/Contents/MacOS/VoiceOver' >/dev/null 2>&1
}

# The engine falls through on purpose, so a clean exit only proves that *something* spoke.
# This records which route was actually taken, which is the difference between "your config
# is wrong" and "your config is right and the route was unavailable". Written before exec,
# because after exec there is no more script.
WORKDIR="${TMPDIR:-/tmp}/claude-speak"
log_route() {
    mkdir -p "$WORKDIR" 2>/dev/null || return 0
    printf '%s  requested=%s  used=%s  voice=%s  rate=%s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$engine" "$1" "${voice:-<system default>}" "${rate:-<default>}" \
        > "$WORKDIR/last-route.log" 2>/dev/null || true
}

# Deliberately not exec, unlike speak_say. VoiceOver speaks in its own process, so the pid the
# hook records could never interrupt it anyway - the user's silence key is the real mechanism
# there. Returning instead means a refused Apple Event (say, VoiceOver running but AppleScript
# control switched off, or TCC denying automation) still falls through to a system voice rather
# than losing the reply.
speak_voiceover() {
    log_route voiceover
    /usr/bin/osascript - "$path" <<'APPLESCRIPT'
on run argv
    set p to item 1 of argv
    set t to (read POSIX file p as «class utf8»)
    tell application "VoiceOver" to output t
end run
APPLESCRIPT
}

speak_say() {
    log_route say
    local args=()
    [ -n "$voice" ] && args+=(-v "$voice")
    if [ -n "$rate" ] && [ "$rate" != "null" ]; then args+=(-r "$rate"); fi
    args+=(-f "$path")
    exec /usr/bin/say "${args[@]}"
}

case "$engine" in
    say) ;;
    *)   # voiceover, auto, and anything unrecognised
         if vo_running && speak_voiceover; then exit 0; fi ;;
esac

# Fall through: the configured route was unavailable. Something should still speak.
speak_say
exit 0

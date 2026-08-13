#!/usr/bin/env bash
# ClaudeSpeak Stop hook (macOS).
#
# Fires when Claude finishes a reply. Pulls that reply out of the session
# transcript, strips markdown, hands it to speak-engine.sh. Claude itself is
# never involved, so this costs nothing in tokens or usage.
#
# Always spoken:  Claude's own prose from the reply just finished.
# Never spoken:   thinking blocks, tool calls, tool output, subagent chatter,
#                 anything from earlier in the conversation. That is a floor,
#                 not a setting.
set -uo pipefail

CLAUDE_DIR="$HOME/.claude"
CONFIG="$CLAUDE_DIR/speak-config.json"
WORKDIR="${TMPDIR:-/tmp}/claude-speak"

payload=$(cat)
[ -n "$payload" ] || exit 0

event=$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null)
[ "$event" = "Stop" ] || exit 0

transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -n "$transcript" ] || exit 0
[ -f "$transcript" ] || exit 0

cfg() {
    local v
    v=$(jq -r "$1 // empty" "$CONFIG" 2>/dev/null)
    [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$2"
}

codeBlocks=$(cfg '.content.codeBlocks' 'announce')
tables=$(cfg '.content.tables' 'omit')
urls=$(cfg '.content.urls' 'link')
firstPara=$(cfg '.content.firstParagraphOnly' 'false')
maxChars=$(cfg '.content.maxChars' '0')
interrupt=$(cfg '.interrupt' 'true')

# Find the last genuine user prompt, then take every assistant text block after
# it. A "user" entry carrying a tool_result is the harness feeding output back,
# not the person typing, so it does not count as the start of a new reply.
#
# The first jq is tolerant: one malformed transcript line should not cost the
# user their speech.
text=$(jq -Rc 'fromjson? // empty' "$transcript" 2>/dev/null | jq -rs '
    ([ to_entries[]
       | select(.value.type == "user")
       | select(.value.isSidechain != true)
       | select(.value.message != null)
       | select(
           ((.value.message.content | type) == "string")
           or (([ .value.message.content[]? | select(.type == "tool_result") ] | length) == 0)
         )
       | .key ] | last) as $lu
    | (if $lu == null then 0 else $lu + 1 end) as $from
    | [ .[$from:][]
        | select(.type == "assistant")
        | select(.isSidechain != true)
        | .message.content[]?
        | select(.type == "text")
        | .text
        | select(type == "string")
        | select(test("^\\s*$") | not) ]
    | join("\n\n")
' 2>/dev/null)

[ -n "$text" ] || exit 0

# Markdown reads terribly aloud. Drop what is meant to be looked at rather than
# heard, and strip the punctuation that marks it up. Byte-level on purpose: the
# patterns are all ASCII, so no decoding layer can mangle the text.
text=$(printf '%s' "$text" | \
    CS_CODEBLOCKS="$codeBlocks" CS_TABLES="$tables" CS_URLS="$urls" \
    perl -e '
        local $/;
        my $t = <STDIN>;
        exit 0 unless defined $t;

        my $cb = $ENV{CS_CODEBLOCKS} || "announce";
        my $tb = $ENV{CS_TABLES}     || "omit";
        my $ur = $ENV{CS_URLS}       || "link";

        if    ($cb eq "omit") { $t =~ s/```.*?```//gs }
        elsif ($cb eq "read") { $t =~ s/```[^\n]*\n(.*?)```/$1/gs }
        else                  { $t =~ s/```.*?```/ Code block omitted. /gs }

        if ($tb eq "read") {
            $t =~ s/^[ \t]*[-:|\s]+$//gm;      # separator rows carry no words
            $t =~ s/^[ \t]*\|[ \t]*//gm;
            $t =~ s/[ \t]*\|[ \t]*$//gm;
            $t =~ s/[ \t]*\|[ \t]*/, /g;
        } else {
            $t =~ s/^[ \t]*\|.*$//gm;
            $t =~ s/^[ \t]*[-:|\s]+$//gm;
        }

        $t =~ s/\[([^\]]+)\]\([^)]*\)/$1/g;    # keep the label, drop the target

        if    ($ur eq "omit") { $t =~ s{https?://\S+}{}g }
        elsif ($ur eq "read") { }
        else                  { $t =~ s{https?://\S+}{ link }g }

        $t =~ s/`//g;
        $t =~ s/^[ \t]{0,3}#{1,6}[ \t]*//gm;
        # Underscores are deliberately left alone: stripping them mangles identifiers.
        $t =~ s/(\*\*|\*|~~)//g;
        $t =~ s/^[ \t]*>[ \t]?//gm;
        $t =~ s/^[ \t]*[-*+][ \t]+//gm;
        $t =~ s/\n{3,}/\n\n/g;
        $t =~ s/\A\s+//; $t =~ s/\s+\z//;
        print $t;
    ' 2>/dev/null)

[ -n "$text" ] || exit 0

if [ "$firstPara" = "true" ]; then
    text=$(printf '%s\n' "$text" | awk 'BEGIN{RS=""} NR==1{print; exit}')
fi

case "$maxChars" in
    ''|*[!0-9]*) maxChars=0 ;;
esac
if [ "$maxChars" -gt 0 ] && [ "${#text}" -gt "$maxChars" ]; then
    text="${text:0:$maxChars} Response truncated."
fi

[ -n "$text" ] || exit 0

mkdir -p "$WORKDIR" 2>/dev/null || exit 0

# Stop whatever the previous reply was still saying, so replies never overlap.
pidfile="$WORKDIR/speaker.pid"
if [ "$interrupt" != "false" ] && [ -f "$pidfile" ]; then
    old=$(cat "$pidfile" 2>/dev/null)
    case "$old" in
        ''|*[!0-9]*) ;;
        *) kill "$old" 2>/dev/null || true ;;
    esac
fi

# The exact text about to be spoken. Read this first when diagnosing: it
# separates "extracted the wrong text" from "failed to speak the right text".
txtfile="$WORKDIR/response.txt"
printf '%s' "$text" > "$txtfile"

# Detached, so a long reply never holds up the session.
nohup "$CLAUDE_DIR/speak-engine.sh" --path "$txtfile" --config "$CONFIG" \
    >/dev/null 2>&1 &
printf '%s' "$!" > "$pidfile"

exit 0

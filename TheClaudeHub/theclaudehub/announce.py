"""What gets said when a session replies or finishes a turn.

Pure text decisions, separate from speaking them, so they can be tested.
The level comes from the speech settings: full, summary or silent.
"""
from __future__ import annotations

import re
from typing import Optional

from .speech import ANNOUNCE_FULL, ANNOUNCE_SILENT, ANNOUNCE_SUMMARY, strip_for_speech
from .sessions import NEEDS_YOU


def first_sentence(text: str, limit: int = 200) -> str:
    stripped = " ".join((text or "").split())
    for end in (". ", "? ", "! "):
        index = stripped.find(end)
        if 0 < index < limit:
            return stripped[: index + 1]
    if len(stripped) <= limit:
        return stripped
    return stripped[:limit].rstrip() + "…"


def reply_text(title: str, reply: str, level: str) -> Optional[str]:
    """A session's reply. None means say nothing."""
    if level == ANNOUNCE_SILENT or not (reply or "").strip():
        return None
    if level == ANNOUNCE_SUMMARY:
        words = len(reply.split())
        return f"{title} replied: {first_sentence(reply)} {words} words."
    return f"{title} replied. {reply.strip()}"


def turn_end_text(title: str, state: str, detail: str, reply: str, level: str) -> Optional[str]:
    """A session finished a turn (used for sessions TheClaudeHub only watches)."""
    if level == ANNOUNCE_SILENT:
        return None
    head = f"{title} finished"
    if state == NEEDS_YOU:
        head = f"{title} needs you" + (f": {detail}" if detail else "")
    head += "."
    if not (reply or "").strip():
        return head
    if level == ANNOUNCE_SUMMARY:
        return f"{head} {first_sentence(reply)}"
    return f"{head} {reply.strip()}"


#: The most of Kelly's own message read back at the full level. It's an echo
#: of what he just typed, not news: a pasted log shouldn't talk for minutes.
OWN_LIMIT = 300

_LIST_MARKER = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def _end_sentence(text: str) -> str:
    text = text.rstrip(" ,;:")
    return text if text[-1:] in (".", "?", "!", "…") else text + "."


def _own_words(message: str, level: str, read_back: bool) -> Optional[str]:
    """The part of Kelly's own message to read back. None means don't.

    Markdown is stripped while the lines are still lines (headings and code
    fences are matched per line). A line ends as a sentence, so a list or
    a heading doesn't run into the next line, unless it's prose that
    carries on in lowercase on the next line. Then the summary level takes
    the first sentence and the full level caps the length.
    """
    if not read_back or level == ANNOUNCE_SILENT:
        return None
    lines = []  # (text, is a list item)
    for line in strip_for_speech(message or "").splitlines():
        item = bool(_LIST_MARKER.match(line))
        line = " ".join(_LIST_MARKER.sub("", line).split())
        if line.rstrip(" .,;:"):
            lines.append((line, item))
    if not lines:
        return None
    parts = []
    for index, (line, item) in enumerate(lines):
        following = lines[index + 1] if index + 1 < len(lines) else None
        carries_on = (following is not None and not item and not following[1]
                      and following[0][:1].islower())
        parts.append(line if carries_on else _end_sentence(line))
    flat = " ".join(parts)
    if level == ANNOUNCE_SUMMARY:
        return _end_sentence(first_sentence(flat))
    # The limit counts the words, not the full stop added after them.
    if len(flat.rstrip(".")) <= OWN_LIMIT:
        return flat
    head = flat[:OWN_LIMIT]
    # On a word boundary, unless one long word (a URL, say) fills the limit.
    cut = (head.rsplit(" ", 1)[0] if " " in head else head).rstrip(" ,;:.")
    more = len(flat.split()) - len(cut.split())
    if more <= 0:
        return f"{cut}…"
    return f"{cut}… and {more} more word{'s' if more != 1 else ''}."


def sent_text(title: str, message: str, level: str, read_back: bool,
              queued: bool = False) -> str:
    """Confirmation that Kelly's message went to Claude. Which session comes
    first, so it's heard even if the read-back is cut short. A queued
    message was read back when it was queued, so it isn't read again."""
    if queued:
        return f"Sent your queued message. {title} is working."
    words = _own_words(message, level, read_back)
    if words is None:
        return f"Sent. {title} is working."
    return f"Sent to {title}: {words}"


def queued_text(title: str, message: str, level: str, read_back: bool,
                added: bool = False) -> str:
    """Confirmation that Kelly's message waits for the running turn."""
    words = _own_words(message, level, read_back)
    if words is None:
        head = "Added to the queued message" if added else "Queued"
        return f"{head}. It will be sent when {title} finishes."
    head = "Added to the queued message for" if added else "Queued for"
    return f"{head} {title}: {words}"


def status_text(text: str, limit: int = 150) -> str:
    """The same news, short enough for the status bar."""
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


__all__ = ["first_sentence", "reply_text", "turn_end_text", "status_text",
           "sent_text", "queued_text",
           "ANNOUNCE_FULL", "ANNOUNCE_SUMMARY", "ANNOUNCE_SILENT"]

"""What gets said when a session replies or finishes a turn.

Pure text decisions, separate from speaking them, so they can be tested.
The level comes from the speech settings: full, summary or silent.
"""
from __future__ import annotations

from typing import Optional

from .speech import ANNOUNCE_FULL, ANNOUNCE_SILENT, ANNOUNCE_SUMMARY
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


def _own_words(message: str, level: str, read_back: bool) -> Optional[str]:
    """The part of Kelly's own message to read back, ending in a full stop
    (or its own ? or !). None means don't read it."""
    if not read_back or level == ANNOUNCE_SILENT:
        return None
    flat = " ".join((message or "").split())
    if not flat:
        return None
    words = first_sentence(flat) if level == ANNOUNCE_SUMMARY else flat
    return words if words[-1] in ".?!…" else words + "."


def sent_text(title: str, message: str, level: str, read_back: bool) -> str:
    """Confirmation that Kelly's message went to Claude."""
    words = _own_words(message, level, read_back)
    if words is None:
        return f"Sent. {title} is working."
    return f"Sent: {words} {title} is working."


def queued_text(title: str, message: str, level: str, read_back: bool,
                added: bool = False) -> str:
    """Confirmation that Kelly's message waits for the running turn."""
    words = _own_words(message, level, read_back)
    head = "Added to the queued message" if added else "Queued"
    if words is None:
        return f"{head}. It will be sent when {title} finishes."
    return f"{head}: {words} It will be sent when {title} finishes."


def status_text(text: str, limit: int = 150) -> str:
    """The same news, short enough for the status bar."""
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


__all__ = ["first_sentence", "reply_text", "turn_end_text", "status_text",
           "sent_text", "queued_text",
           "ANNOUNCE_FULL", "ANNOUNCE_SUMMARY", "ANNOUNCE_SILENT"]

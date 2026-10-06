"""Text the UI shows that is worth testing without wx."""
from __future__ import annotations

from typing import List

#: Every shortcut, grouped. The Help dialog and the README both list these.
SHORTCUTS = [
    ("Session list", [
        ("Enter", "Open the selected session"),
        ("Ctrl+O", "Open the selected session in the Claude desktop app"),
        ("Ctrl+N", "New TheClaudeHub session"),
        ("F5", "Refresh the list now and put it back in order (it also refreshes itself "
               "every few seconds, without moving rows while you're in it)"),
        ("Delete", "Forget the selected TheClaudeHub session (asks first)"),
    ]),
    ("Session view", [
        ("Escape, or Backspace outside the reply box", "Back to the session list"),
        ("Ctrl+1", "Chat tab"),
        ("Ctrl+2", "Reply tab"),
        ("Ctrl+Tab, Ctrl+Shift+Tab", "Next or previous tab"),
        ("Enter on a message", "Move to the full text of that message"),
        ("Ctrl+C on a message", "Copy the whole message"),
        ("End", "Newest message"),
        ("Ctrl+T", "Show or hide tool activity"),
        ("Ctrl+O", "Open this session in the Claude desktop app"),
        ("Ctrl+Enter in the reply box", "Send (TheClaudeHub sessions only)"),
        ("Ctrl+Period", "Stop the running turn"),
        ("Ctrl+Shift+T", "Turn status: how long Claude has been working, and on what"),
    ]),
    ("Anywhere", [
        ("F1", "This list of shortcuts"),
        ("Ctrl+Comma", "Settings (announcements and speech)"),
        ("Ctrl+Shift+R", "Repeat the last announcement"),
        ("Alt+F4", "Quit"),
    ]),
]


def shortcuts_text() -> str:
    lines: List[str] = []
    for group, items in SHORTCUTS:
        lines.append(f"{group}:")
        for key, action in items:
            lines.append(f"  {key}: {action}")
        lines.append("")
    return "\n".join(lines).rstrip()

"""Text the UI shows that is worth testing without wx."""
from __future__ import annotations

from typing import List

#: The window, in Tab order. The Help dialog and the README both describe it.
LAYOUT = (
    "One window, three parts, in Tab order: the session list; the messages of the "
    "loaded session; and the reply box with Send and Stop (for a Claude desktop app "
    "session, a read-only note and Open in Claude in the same place). Shift+Tab goes "
    "back the same way."
)

#: Every shortcut, grouped. The Help dialog and the README both list these.
SHORTCUTS = [
    ("Moving around", [
        ("Tab, Shift+Tab", "Session list, messages, reply box, and back"),
        ("Ctrl+1", "Go to the session list"),
        ("Ctrl+2", "Go to the messages"),
        ("Ctrl+3", "Go to the reply box (or the note, for a desktop session)"),
        ("Escape in the messages or the reply box",
         "Back to the session list, on the same session"),
        ("Backspace in the messages", "Also back to the session list"),
    ]),
    ("Session list", [
        ("Enter", "Load that session and move to its messages"),
        ("Ctrl+O", "Open the selected session in the Claude desktop app"),
        ("Ctrl+N", "New TheClaudeHub session"),
        ("F5", "Refresh the list now and put it back in order (it also refreshes itself "
               "every few seconds, without moving rows while you're in it)"),
        ("Delete", "Forget the selected TheClaudeHub session (asks first)"),
    ]),
    ("Messages", [
        ("Enter, or Applications key / Shift+F10 then Read Full Message",
         "Read the whole message in a text box; Escape comes back to it"),
        ("Ctrl+C", "Copy the whole message"),
        ("End", "Newest message"),
        ("Ctrl+T", "Show or hide tool activity"),
        ("Ctrl+O", "Open this session in the Claude desktop app"),
    ]),
    ("Reply box", [
        ("Ctrl+Enter", "Send (TheClaudeHub sessions only); you stay in the reply box. "
                       "During a turn it queues the message and sends it when the turn ends"),
        ("Ctrl+Period", "Stop the running turn; a queued message goes back in the reply box"),
        ("Ctrl+Shift+T", "Turn status: how long Claude has been working, on what, "
                         "and whether a message is queued"),
    ]),
    ("Anywhere", [
        ("Ctrl+Shift+A", "Answer Claude: approve or deny a tool, answer its questions, or "
                         "approve its plan (the loaded session first, then the one that has "
                         "waited longest). Escape in the dialog answers later"),
        ("F1", "This list of shortcuts"),
        ("Ctrl+Comma", "Settings (announcements and speech)"),
        ("Ctrl+Shift+R", "Repeat the last announcement"),
        ("Alt+F4", "Quit"),
    ]),
]


def shortcuts_text() -> str:
    lines: List[str] = [LAYOUT, ""]
    for group, items in SHORTCUTS:
        lines.append(f"{group}:")
        for key, action in items:
            lines.append(f"  {key}: {action}")
        lines.append("")
    return "\n".join(lines).rstrip()

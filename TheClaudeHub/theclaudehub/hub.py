"""Gathering the whole session list in one pass, and noticing turn endings.

Runs on a background thread (it reads ~200 small files); returns plain data
the UI applies on the main thread.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from . import platform_paths
from .own_store import OwnSession
from .sessions import (NEEDS_YOU, WORKING, DesktopLoadResult, LiveStatus, SessionInfo,
                       load_desktop_sessions, load_live_status, sort_sessions)
from .transcript import TranscriptParser, split_jsonl


@dataclass
class Snapshot:
    sessions: List[SessionInfo] = field(default_factory=list)
    desktop_cli_ids: Set[str] = field(default_factory=set)
    live: Dict[str, LiveStatus] = field(default_factory=dict)
    unreadable_files: int = 0


def collect(own: Iterable[OwnSession], running_own_ids: Set[str],
            desktop_dir: Optional[Path] = None,
            live_dir: Optional[Path] = None,
            alive=platform_paths.pid_alive,
            waiting: Optional[Dict[str, str]] = None) -> Snapshot:
    """``waiting`` maps a running own session to what Claude is waiting for
    (a permission request, question or plan): it needs you, not working."""
    live = load_live_status(live_dir, alive=alive)
    desktop: DesktopLoadResult = load_desktop_sessions(desktop_dir, live)
    sessions = list(desktop.sessions)
    waiting = waiting or {}
    for item in own:
        info = item.to_info()
        if item.cli_session_id in running_own_ids and waiting.get(item.cli_session_id):
            info.state, info.detail = NEEDS_YOU, waiting[item.cli_session_id]
        elif item.cli_session_id in running_own_ids:
            info.state, info.detail = WORKING, ""
        elif (live.get(item.cli_session_id) is not None
              and live[item.cli_session_id].status == "busy"):
            # Someone resumed it elsewhere (a terminal); it is busy there.
            info.state, info.detail = WORKING, "running outside TheClaudeHub"
        sessions.append(info)
    return Snapshot(sessions=sort_sessions(sessions),
                    desktop_cli_ids=desktop.desktop_cli_ids,
                    live=live,
                    unreadable_files=desktop.unreadable_files)


def finished_turns(previous: Dict[str, str], current: Iterable[SessionInfo]) -> List[SessionInfo]:
    """Sessions that were working last time and are not now.

    ``previous`` maps session key -> state from the last snapshot. A session
    that has vanished (archived) is not reported.
    """
    ended = []
    for info in current:
        if previous.get(info.key) == WORKING and info.state != WORKING:
            ended.append(info)
    return ended


def last_reply_from_tail(path: Path, max_bytes: int = 512 * 1024) -> str:
    """The most recent reply in a transcript, reading only its last part.

    Transcripts can be tens of megabytes; the last reply is near the end. The
    first (probably partial) line of the tail is dropped.
    """
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as handle:
            start = max(0, size - max_bytes)
            handle.seek(start)
            data = handle.read()
    except OSError:
        return ""
    lines = split_jsonl(data)
    if start > 0 and lines:
        lines = lines[1:]
    parser = TranscriptParser()
    parser.feed(lines)
    reply = parser.transcript.last_reply()
    return reply.text if reply else ""

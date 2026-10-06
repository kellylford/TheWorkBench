"""TheClaudeHub's own sessions: the ones it started, and so the only ones it
may send messages into.

Kept in one small JSON file, ``%APPDATA%\\TheClaudeHub\\sessions.json``. It is
the only session data TheClaudeHub ever writes. Writes go to a temporary file
first and replace the real one, so a crash mid-write cannot lose the list.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Dict, List, Optional

from . import platform_paths
from .sessions import IDLE, OWN, SessionInfo


@dataclass
class OwnSession:
    cli_session_id: str
    title: str
    cwd: str
    permission_mode: str = "auto"
    created_ms: int = 0
    last_activity_ms: int = 0
    desktop_session_id: str = ""   # set only if the desktop app ever adopts it
    state: str = IDLE              # idle / needs you (working is never stored)
    detail: str = ""
    unread: bool = False
    #: False until the CLI has reported the session (its first turn got as far
    #: as system/init). Until then the session doesn't exist in Claude Code,
    #: and the next Send starts it again instead of resuming it.
    started: bool = True

    def to_info(self) -> SessionInfo:
        return SessionInfo(
            source=OWN,
            key=f"own:{self.cli_session_id}",
            title=self.title,
            cwd=self.cwd,
            cli_session_id=self.cli_session_id,
            desktop_session_id=self.desktop_session_id,
            last_activity_ms=self.last_activity_ms or self.created_ms,
            state=self.state,
            detail=self.detail,
            permission_mode=self.permission_mode,
            unread=self.unread,
        )


_FIELDS = {f.name for f in fields(OwnSession)}
_TYPES = {f.name: f.type for f in fields(OwnSession)}
_DEFAULTS = {f.name: f.default for f in fields(OwnSession)}


def _session_from_dict(item: dict) -> Optional[OwnSession]:
    """A stored session, or None. Wrong-typed optional fields fall back to
    their defaults; a wrong-typed id, title or folder drops the entry."""
    cli_id = item.get("cli_session_id")
    if not isinstance(cli_id, str) or not platform_paths.is_safe_id(cli_id):
        return None
    if not isinstance(item.get("title"), str) or not isinstance(item.get("cwd"), str):
        return None
    values = {}
    for name in _FIELDS:
        if name not in item:
            continue
        value = item[name]
        kind = _TYPES[name]
        if kind in ("str", str):
            ok = isinstance(value, str)
        elif kind in ("bool", bool):
            ok = isinstance(value, bool)
        elif kind in ("int", int):
            ok = isinstance(value, int) and not isinstance(value, bool)
        else:
            ok = True
        values[name] = value if ok else _DEFAULTS[name]
    return OwnSession(**values)


class OwnSessionStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = Path(path) if path else platform_paths.app_data_dir() / "sessions.json"
        self._sessions: Dict[str, OwnSession] = {}
        self.load_error = ""
        self._save_blocked = False
        self.load()

    # -- persistence ----------------------------------------------------------

    def load(self) -> None:
        self._sessions = {}
        self.load_error = ""
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except OSError as exc:
            # Locked or unreadable right now (antivirus, a sync tool): the
            # data may be fine, so never save over it this run.
            self.load_error = (f"Couldn't read TheClaudeHub's session list ({self.path}): "
                               f"{exc}. Changes won't be saved until TheClaudeHub is "
                               "restarted and can read it.")
            self._save_blocked = True
            return
        except ValueError as exc:
            self._set_aside(f"isn't valid JSON ({exc})")
            return
        items = raw.get("sessions") if isinstance(raw, dict) else None
        if not isinstance(items, list):
            self._set_aside("isn't in the expected format")
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            session = _session_from_dict(item)
            if session is not None:
                self._sessions[session.cli_session_id] = session

    def _set_aside(self, why: str) -> None:
        """Move an unreadable store out of the way, so the next save can't
        overwrite whatever is in it, and say where it went."""
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = self.path.with_name(f"{self.path.name}.bad-{stamp}")
        try:
            os.replace(self.path, backup)
            self.load_error = (f"TheClaudeHub's session list ({self.path}) {why}. It was "
                               f"moved to {backup.name} in the same folder, and TheClaudeHub "
                               "started a new list. Its sessions' transcripts are untouched.")
        except OSError as exc:
            self.load_error = (f"TheClaudeHub's session list ({self.path}) {why}, and it "
                               f"couldn't be moved aside ({exc}). Changes won't be saved "
                               "until it is fixed or removed.")
            self._save_blocked = True

    def save(self) -> None:
        if self._save_blocked:
            raise OSError(f"Not saving over the unreadable {self.path}.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1,
                   "sessions": [asdict(s) for s in self._sessions.values()]}
        fd, tmp = tempfile.mkstemp(prefix="sessions-", suffix=".tmp",
                                   dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
            os.replace(tmp, self.path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # -- access -----------------------------------------------------------------

    def all(self) -> List[OwnSession]:
        return list(self._sessions.values())

    def get(self, cli_session_id: str) -> Optional[OwnSession]:
        return self._sessions.get(cli_session_id)

    def contains(self, cli_session_id: str) -> bool:
        return cli_session_id in self._sessions

    def add(self, session: OwnSession) -> None:
        if not platform_paths.is_safe_id(session.cli_session_id):
            raise ValueError("Not a valid session id.")
        now = int(time.time() * 1000)
        session.created_ms = session.created_ms or now
        session.last_activity_ms = session.last_activity_ms or now
        self._sessions[session.cli_session_id] = session
        self.save()

    def rename_id(self, old_id: str, new_id: str) -> None:
        """Claude reported a different session id than the one we asked for."""
        session = self._sessions.pop(old_id, None)
        if session is None or not platform_paths.is_safe_id(new_id):
            return
        session.cli_session_id = new_id
        self._sessions[new_id] = session
        self.save()

    def update(self, cli_session_id: str, **changes) -> None:
        session = self._sessions.get(cli_session_id)
        if session is None:
            return
        for name, value in changes.items():
            if name in _FIELDS and name != "cli_session_id":
                setattr(session, name, value)
        self.save()

    def remove(self, cli_session_id: str) -> None:
        """Forget a session (its transcript is left alone)."""
        if self._sessions.pop(cli_session_id, None) is not None:
            self.save()

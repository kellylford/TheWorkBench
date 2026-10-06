"""Everything that knows which operating system it is running on.

The rest of the app asks this module where things live and how to do the
few OS-level things it needs (is a process alive, open a URL with the shell).
A Mac port should only have to touch this file and the speech scripts.

Locations, as found on Windows with Claude Code 2.1 and the Claude desktop
app (none of this is documented, so every caller treats it as best effort):

* Desktop app session metadata:
  ``%APPDATA%\\Claude\\claude-code-sessions\\<id>\\<orgId>\\local_<id>.json``
* Transcripts: ``%USERPROFILE%\\.claude\\projects\\<encoded cwd>\\<cliSessionId>.jsonl``
* Live sessions: ``%USERPROFILE%\\.claude\\sessions\\<pid>.json``
* TheClaudeHub's own files: ``%APPDATA%\\TheClaudeHub\\``
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Optional

APP_DIR_NAME = "TheClaudeHub"


def claude_home() -> Path:
    """``~/.claude`` (honours CLAUDE_CONFIG_DIR, as Claude Code does)."""
    override = os.environ.get("CLAUDE_CONFIG_DIR")
    if override:
        return Path(override)
    return Path.home() / ".claude"


def projects_dir() -> Path:
    return claude_home() / "projects"


def live_sessions_dir() -> Path:
    return claude_home() / "sessions"


def _roaming_dir() -> Path:
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata)
        return Path.home() / "AppData" / "Roaming"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")


def desktop_sessions_dir() -> Path:
    """Where the Claude desktop app keeps one JSON file per Code session."""
    return _roaming_dir() / "Claude" / "claude-code-sessions"


def app_data_dir() -> Path:
    """TheClaudeHub's own settings and session store."""
    return _roaming_dir() / APP_DIR_NAME


def default_projects_root() -> Path:
    """Where the New Session folder picker starts."""
    github = Path.home() / "GitHub"
    return github if github.is_dir() else Path.home()


_NON_ALNUM = re.compile(r"[^A-Za-z0-9]")


def encode_cwd(cwd: str) -> str:
    """The folder name Claude Code uses for a working directory's transcripts.

    Every character that is not an ASCII letter or digit becomes ``-``, so
    ``C:\\Users\\kelly\\GitHub\\QuickMail`` is ``C--Users-kelly-GitHub-QuickMail``.
    Verified against every transcript on Kelly's PC on 2026-10-06 (87 of 87
    existing transcripts matched; the rest had been deleted by retention).
    """
    return _NON_ALNUM.sub("-", cwd or "")


# Session ids end up in file names, glob patterns and command lines. Refuse
# anything that is not a plain id, so a malformed metadata file cannot point us
# at another file, and an id can never be read as a command-line flag (it must
# not start with "-").
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")


def transcript_path(cwd: str, cli_session_id: str,
                    root: Optional[Path] = None) -> Optional[Path]:
    """Find a session's transcript, or None when it no longer exists.

    The encoded-cwd mapping is tried first; if it misses (a format change, a
    very long path Claude Code shortened), every project folder is searched for
    the session id, which is unique on its own.
    """
    if not cli_session_id or not _SAFE_ID.match(cli_session_id):
        return None
    root = root or projects_dir()
    direct = root / encode_cwd(cwd) / f"{cli_session_id}.jsonl"
    if direct.is_file():
        return direct
    try:
        for candidate in root.glob(f"*/{cli_session_id}.jsonl"):
            if candidate.is_file():
                return candidate
    except OSError:
        pass
    return None




def is_safe_id(value: str) -> bool:
    return bool(value) and bool(_SAFE_ID.match(value))


def pid_alive(pid: int) -> bool:
    """True if a process with this id is running.

    Not ``os.kill(pid, 0)``: on Windows signal 0 is CTRL_C_EVENT, and that call
    would interrupt the process instead of probing it.
    """
    if not isinstance(pid, int) or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE,
                                                ctypes.POINTER(wintypes.DWORD)]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            # Access denied still means the process exists.
            return ctypes.get_last_error() == 5
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def open_url(url: str) -> None:
    """Hand a URL to the shell (the Claude desktop app owns ``claude://``)."""
    if sys.platform == "win32":
        os.startfile(url)  # type: ignore[attr-defined]  # noqa: S606
    elif sys.platform == "darwin":
        import subprocess

        subprocess.Popen(["open", url])
    else:
        import subprocess

        subprocess.Popen(["xdg-open", url])


def claude_executable() -> Optional[str]:
    """Path to the ``claude`` command, or None if it is not installed."""
    import shutil

    found = shutil.which("claude")
    if found:
        return found
    candidates = [Path.home() / ".local" / "bin" / ("claude.exe" if sys.platform == "win32" else "claude")]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def hidden_window_flags() -> int:
    """creationflags that keep a console window from flashing up on Windows."""
    if sys.platform == "win32":
        import subprocess

        return subprocess.CREATE_NO_WINDOW
    return 0

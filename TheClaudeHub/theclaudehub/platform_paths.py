"""Everything that knows which operating system it is running on.

The rest of the app asks this module where things live and how to do the
few OS-level things it needs (is a process alive, open a URL with the shell).
A Mac port should only have to touch this file and the speech scripts.

Locations, as found on Windows with Claude Code 2.1 and the Claude desktop
app (none of this is documented, so every caller treats it as best effort):

* Desktop app session metadata:
  ``%APPDATA%\\Claude\\claude-code-sessions\\<id>\\<orgId>\\local_<id>.json``,
  or for the Microsoft Store version
  ``%LOCALAPPDATA%\\Packages\\Claude_<id>\\LocalCache\\Roaming\\Claude\\claude-code-sessions``
* Transcripts: ``%USERPROFILE%\\.claude\\projects\\<encoded cwd>\\<cliSessionId>.jsonl``
* Live sessions: ``%USERPROFILE%\\.claude\\sessions\\<pid>.json``
* TheClaudeHub's own files: ``%APPDATA%\\TheClaudeHub\\``
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import List, Optional

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
    """Where the Claude desktop app keeps one JSON file per Code session, when
    it was installed with its own installer."""
    return _roaming_dir() / "Claude" / "claude-code-sessions"


def _store_app_sessions_dirs() -> List[Path]:
    """The same folder for the Microsoft Store (MSIX) version of the desktop
    app (issue #183). Windows redirects a packaged app's AppData writes into
    its package folder, so ``%APPDATA%\\Claude`` doesn't exist there. Matched
    on ``Claude_*`` rather than the package id seen on Kelly's PCs
    (``Claude_pzs8sxrjxfjjc``), in case it differs."""
    if sys.platform != "win32":
        return []
    local = os.environ.get("LOCALAPPDATA")
    packages = Path(local) / "Packages" if local else Path.home() / "AppData" / "Local" / "Packages"
    try:
        return sorted(p / "LocalCache" / "Roaming" / "Claude" / "claude-code-sessions"
                      for p in packages.glob("Claude_*"))
    except OSError:
        return []


def desktop_sessions_dirs() -> List[Path]:
    """Every folder that holds desktop app session files, that exists. Both
    kinds of install can be present (switching from one to the other leaves
    the old folder behind); callers read all of them."""
    candidates = [desktop_sessions_dir(), *_store_app_sessions_dirs()]
    return [path for path in candidates if path.is_dir()]


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


class ClaudeLookup:
    """Where ``claude`` is, or why it can't be used."""

    def __init__(self, path: Optional[str] = None, problem: str = "") -> None:
        self.path = path
        self.problem = problem


_SCRIPT_SUFFIXES = (".cmd", ".bat", ".ps1")


def find_claude(which=None, native_candidates=None) -> ClaudeLookup:
    """Find the native ``claude`` executable.

    A ``claude.cmd`` / ``.bat`` (the npm install) is refused on purpose: Windows
    runs those through cmd.exe, which re-parses the command line, so a session
    title containing ``&`` or ``"`` could run a second command. The native
    installer's ``claude.exe`` takes its arguments as they are.
    """
    import shutil

    which = which or shutil.which
    if native_candidates is None:
        name = "claude.exe" if sys.platform == "win32" else "claude"
        native_candidates = [Path.home() / ".local" / "bin" / name]
    found = which("claude")
    if found and not found.lower().endswith(_SCRIPT_SUFFIXES):
        return ClaudeLookup(found)
    for candidate in native_candidates:
        if Path(candidate).is_file():
            return ClaudeLookup(str(candidate))
    if found:
        return ClaudeLookup(None, (
            f"The claude command on this PC is a script ({found}), from the npm install. "
            "TheClaudeHub needs the native claude.exe, because a script would let a session "
            "title be read as a command. Install Claude Code with the native installer "
            "(https://code.claude.com/docs/en/setup), sign in once in a terminal, and try again."))
    return ClaudeLookup(None, (
        "The claude command wasn't found. Install Claude Code with the native installer, "
        "sign in once in a terminal, then try again."))


def claude_executable() -> Optional[str]:
    """Path to the native ``claude`` command, or None (see ``find_claude``)."""
    return find_claude().path


CREATE_SUSPENDED = 0x00000004


class ProcessTree:
    """Lets a child process be killed together with everything it started.

    On Windows the child goes into a Job Object with KILL_ON_JOB_CLOSE, so
    terminating the job, closing it when the turn ends, or TheClaudeHub
    exiting ends the whole tree: claude runs tools as child processes, and
    killing only claude.exe would leave a long build or test run going. It
    also means anything Claude started and left running ends with the turn.

    The child is created suspended and only resumed once it is in the job, so
    nothing it starts can escape the job in between. If the job can't be set
    up the child is still resumed, and ``kill`` falls back to
    ``taskkill /T /F``. Elsewhere the child gets its own process group.
    """

    def __init__(self) -> None:
        self._job = None
        self._pid: Optional[int] = None

    @staticmethod
    def popen_kwargs() -> dict:
        if sys.platform == "win32":
            return {"creationflags": hidden_window_flags() | CREATE_SUSPENDED}
        return {"start_new_session": True}

    def attach(self, process) -> None:
        """Put a (suspended) child into the job, then let it run. Raises if a
        real Windows child can't be resumed, after killing it, so a turn never
        hangs on a process that was never started."""
        self._pid = getattr(process, "pid", None)
        handle = getattr(process, "_handle", None)
        if sys.platform != "win32" or not isinstance(self._pid, int) or handle is None:
            return
        try:
            self._job = _create_kill_on_close_job()
            if self._job is not None and not _assign_to_job(self._job, int(handle)):
                _close_handle(self._job)
                self._job = None
        except Exception:  # noqa: BLE001 - fall back to taskkill
            self._job = None
        if not _resume_process(int(handle)):
            try:
                process.kill()
            except OSError:
                pass
            raise OSError("Couldn't start claude (it could not be resumed).")

    def kill(self) -> None:
        if self._pid is None:
            return
        if sys.platform == "win32":
            if self._job is not None and _kernel32().TerminateJobObject(self._job, 1):
                return
            import subprocess

            subprocess.run(["taskkill", "/T", "/F", "/PID", str(self._pid)],
                           capture_output=True, creationflags=hidden_window_flags())
            return
        import signal

        try:
            os.killpg(self._pid, signal.SIGKILL)
        except OSError:
            pass

    def close(self) -> None:
        """Close the job. KILL_ON_JOB_CLOSE ends anything still in it."""
        if self._job is not None:
            _close_handle(self._job)
            self._job = None


_K32 = None


def _kernel32():
    """kernel32 with argument and result types declared, so 64-bit handles
    are passed whole instead of being truncated to C ints."""
    global _K32
    if _K32 is not None:
        return _K32
    import ctypes
    from ctypes import wintypes

    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    k.CreateJobObjectW.restype = wintypes.HANDLE
    k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                          wintypes.LPVOID, wintypes.DWORD]
    k.SetInformationJobObject.restype = wintypes.BOOL
    k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k.AssignProcessToJobObject.restype = wintypes.BOOL
    k.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    k.TerminateJobObject.restype = wintypes.BOOL
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    k.CloseHandle.restype = wintypes.BOOL
    _K32 = k
    return k


def _resume_process(handle: int) -> bool:
    """Resume a process created with CREATE_SUSPENDED (its only thread)."""
    import ctypes
    from ctypes import wintypes

    ntdll = ctypes.WinDLL("ntdll")
    ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
    ntdll.NtResumeProcess.restype = ctypes.c_long
    return ntdll.NtResumeProcess(handle) == 0


def _create_kill_on_close_job():
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                    ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t),
                    ("PriorityClass", wintypes.DWORD),
                    ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k = _kernel32()
    job = k.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXTENDED()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k.SetInformationJobObject(job, 9,  # JobObjectExtendedLimitInformation
                                     ctypes.byref(info), ctypes.sizeof(info)):
        _close_handle(job)
        return None
    return job


def _assign_to_job(job, process_handle: int) -> bool:
    return bool(_kernel32().AssignProcessToJobObject(job, process_handle))


def _close_handle(handle) -> None:
    _kernel32().CloseHandle(handle)


def bring_window_forward(title_matches) -> bool:
    """Bring the first top-level window whose title satisfies ``title_matches``
    to the front. Windows only; returns False elsewhere or if none matched."""
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if title_matches(buffer.value):
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(callback, 0)
    if not found:
        return False
    hwnd = found[0]
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    return bool(user32.SetForegroundWindow(hwnd))


def hidden_window_flags() -> int:
    """creationflags that keep a console window from flashing up on Windows."""
    if sys.platform == "win32":
        import subprocess

        return subprocess.CREATE_NO_WINDOW
    return 0

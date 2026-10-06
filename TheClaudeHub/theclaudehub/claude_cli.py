"""Running turns of TheClaudeHub's own sessions through the ``claude`` command.

Why the command line, and how it stays on the subscription
---------------------------------------------------------
``claude -p`` (print / headless mode) runs a turn under the same login as
the desktop app and the terminal, so it costs nothing beyond the
subscription. The things that would change that are all ruled out here:

* **Never ``--bare``.** Bare mode skips the OAuth login and requires an API key.
* **No CLAUDE_* / ANTHROPIC_* variables reach the child.** If TheClaudeHub is
  started from inside a Claude Code session (a terminal tab in the desktop app,
  say), it inherits that session's variables: ``ANTHROPIC_BASE_URL`` pointing at
  the desktop app's local proxy, ``CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`` and
  friends that tell the CLI a host will refresh its OAuth token. A child run
  with those waits on a token refresh that never comes (the lock seen during
  the investigation for issue #168). Stripping them also removes any
  ``ANTHROPIC_API_KEY``, which would otherwise switch the CLI to per-use
  billing. ``CLAUDE_CONFIG_DIR`` is kept: it says where the login lives.
* **The run is stopped if the CLI says it is using an API key.** The first
  stream-json event (``system/init``) reports ``apiKeySource``; on a
  subscription login it is ``"none"``. Anything else ends the turn before a
  request is made.

Never into a desktop session
----------------------------
Two clients resuming one session interleave their turns into one transcript.
So ``--resume`` is only ever built for a session in TheClaudeHub's own store,
and is refused for any id the desktop app knows about or any ``local_`` id
(``ResumeRefused``). That check lives in ``build_resume_command`` so no caller
can skip it.

Prompts go in on stdin, not the command line: a message that begins with
``-`` cannot be mistaken for a flag, and there is no command-line length limit.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from typing import Callable, Collection, Dict, List, Optional

from . import platform_paths

#: (value passed to --permission-mode, label shown in the New Session dialog)
PERMISSION_MODES = [
    ("auto", "Auto: Claude decides what is safe to run without asking"),
    ("acceptEdits", "Accept edits: file edits allowed, commands that need approval are refused"),
    ("default", "Default: anything that needs approval is refused"),
    ("plan", "Plan: Claude plans but does not change anything"),
]
PERMISSION_MODE_VALUES = [value for value, _label in PERMISSION_MODES]
DEFAULT_PERMISSION_MODE = "auto"

#: Environment variables that are kept even though they match the prefixes.
_ENV_KEEP = {"CLAUDE_CONFIG_DIR"}
_ENV_STRIP_PREFIXES = ("CLAUDE", "ANTHROPIC")


class ResumeRefused(ValueError):
    """--resume was asked for a session TheClaudeHub does not own."""


def child_environment(base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """The environment for a ``claude`` child process (see module docstring)."""
    base = dict(os.environ if base is None else base)
    return {k: v for k, v in base.items()
            if k.upper() in _ENV_KEEP
            or not k.upper().startswith(_ENV_STRIP_PREFIXES)}


def _common_flags(permission_mode: str) -> List[str]:
    if permission_mode not in PERMISSION_MODE_VALUES:
        raise ValueError(f"Unknown permission mode: {permission_mode!r}")
    return ["-p", "--output-format", "stream-json", "--verbose",
            "--permission-mode", permission_mode]


def new_session_id() -> str:
    return str(uuid.uuid4())


def build_new_command(executable: str, session_id: str, title: str,
                      permission_mode: str) -> List[str]:
    """Command for the first turn of a new session. The prompt goes on stdin."""
    if not platform_paths.is_safe_id(session_id):
        raise ValueError("Not a valid session id.")
    command = [executable, *_common_flags(permission_mode), "--session-id", session_id]
    title = " ".join((title or "").split())
    if title:
        command += ["--name", title]
    return command


def check_resume_allowed(session_id: str, own_ids: Collection[str],
                         desktop_ids: Collection[str]) -> None:
    """Raise ResumeRefused unless ``session_id`` is one of TheClaudeHub's own."""
    if not session_id or not platform_paths.is_safe_id(session_id):
        raise ResumeRefused("That is not a valid session id.")
    if session_id.startswith("local_"):
        raise ResumeRefused(
            "That is a Claude desktop app session id. Desktop sessions are read-only "
            "in TheClaudeHub; reply to them in Claude.")
    if session_id in desktop_ids:
        raise ResumeRefused(
            "That session belongs to the Claude desktop app. Sending into it from here "
            "could run two turns at once and tangle its transcript; reply in Claude.")
    if session_id not in own_ids:
        raise ResumeRefused("TheClaudeHub only sends messages to sessions it started.")


def build_resume_command(executable: str, session_id: str, permission_mode: str,
                         own_ids: Collection[str],
                         desktop_ids: Collection[str]) -> List[str]:
    """Command for a later turn. Refuses anything but TheClaudeHub's own sessions."""
    check_resume_allowed(session_id, own_ids, desktop_ids)
    return [executable, *_common_flags(permission_mode), "--resume", session_id]


# ---------------------------------------------------------------------------
# stream-json events
# ---------------------------------------------------------------------------


@dataclass
class TurnEvent:
    """One thing that happened during a turn, already made readable."""

    kind: str               # started | text | tool | denied | finished | failed | notice
    text: str = ""
    session_id: str = ""
    is_error: bool = False
    denials: List[str] = field(default_factory=list)
    raw_type: str = ""


def describe_denial(denial: dict) -> str:
    """A permission denial from the result event, as words."""
    if not isinstance(denial, dict):
        return "A tool was refused."
    name = str(denial.get("tool_name") or "A tool")
    tool_input = denial.get("tool_input") if isinstance(denial.get("tool_input"), dict) else {}
    target = ""
    for key in ("command", "file_path", "path", "url", "pattern"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            target = " ".join(value.split())
            if len(target) > 160:
                target = target[:159] + "…"
            break
    return f"{name} was refused: {target}" if target else f"{name} was refused"


class StreamParser:
    """Turns ``claude -p --output-format stream-json --verbose`` lines into
    ``TurnEvent``s. Unknown event types are ignored; bad lines are counted."""

    def __init__(self) -> None:
        self.session_id = ""
        self.api_key_source: Optional[str] = None
        self.bad_lines = 0
        self.finished = False

    def feed(self, line: str) -> List[TurnEvent]:
        line = line.strip()
        if not line:
            return []
        try:
            event = json.loads(line)
        except ValueError:
            self.bad_lines += 1
            return []
        if not isinstance(event, dict):
            self.bad_lines += 1
            return []
        try:
            return self._event(event)
        except Exception:  # noqa: BLE001 - a format change must not kill the turn
            self.bad_lines += 1
            return []

    def _event(self, event: dict) -> List[TurnEvent]:
        etype = str(event.get("type") or "")
        subtype = str(event.get("subtype") or "")
        sid = event.get("session_id")
        if isinstance(sid, str) and sid:
            self.session_id = sid

        if etype == "system" and subtype == "init":
            source = event.get("apiKeySource")
            self.api_key_source = source if isinstance(source, str) else None
            return [TurnEvent("started", session_id=self.session_id, raw_type="init",
                              text=str(event.get("permissionMode") or ""))]
        if etype == "system" and subtype == "permission_denied":
            name = str(event.get("tool_name") or "A tool")
            message = str(event.get("message") or "").strip()
            text = f"{name}: {message}" if message else f"{name} was refused"
            return [TurnEvent("denied", text=text, session_id=self.session_id)]
        if etype == "assistant" and not event.get("parent_tool_use_id"):
            message = event.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            events: List[TurnEvent] = []
            if isinstance(content, str) and content.strip():
                events.append(TurnEvent("text", text=content.strip()))
            elif isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and str(block.get("text") or "").strip():
                        events.append(TurnEvent("text", text=str(block["text"]).strip()))
                    elif block.get("type") == "tool_use":
                        events.append(TurnEvent("tool", text=str(block.get("name") or "tool")))
            return events
        if etype == "result":
            self.finished = True
            denials = event.get("permission_denials")
            denial_text = [describe_denial(d) for d in denials] if isinstance(denials, list) else []
            is_error = bool(event.get("is_error")) or (subtype not in ("", "success"))
            text = event.get("result")
            if not isinstance(text, str) or not text.strip():
                errors = event.get("errors")
                if isinstance(errors, list) and errors:
                    text = "; ".join(str(e) for e in errors)
                else:
                    text = "" if not is_error else f"The turn ended with an error ({subtype or 'unknown'})."
            return [TurnEvent("finished", text=text.strip(), session_id=self.session_id,
                              is_error=is_error, denials=denial_text, raw_type=subtype)]
        return []


def api_key_problem(source: Optional[str]) -> Optional[str]:
    """A message if the CLI is about to bill an API key instead of the subscription."""
    if source is None or source in ("", "none"):
        return None
    return (f"Claude would have used an API key ({source}) instead of your subscription "
            "login, so TheClaudeHub stopped the turn before anything was sent. Remove "
            "that key from the environment or settings that set it, then try again.")


# ---------------------------------------------------------------------------
# Running a turn
# ---------------------------------------------------------------------------


class TurnRunner:
    """Runs one turn in a background thread and reports ``TurnEvent``s.

    ``on_event`` is called from the worker thread; the UI marshals it onto the
    main thread (``wx.CallAfter``). Exactly one ``finished`` or ``failed``
    event is always delivered last, whatever happens.
    """

    def __init__(self, command: List[str], cwd: str, prompt: str,
                 on_event: Callable[[TurnEvent], None],
                 popen: Callable[..., subprocess.Popen] = subprocess.Popen,
                 env: Optional[Dict[str, str]] = None) -> None:
        self.command = command
        self.cwd = cwd
        self.prompt = prompt
        self.on_event = on_event
        self._popen = popen
        self._env = env if env is not None else child_environment()
        self._process: Optional[subprocess.Popen] = None
        self._cancelled = False
        self._stopped_for_key = False
        self._thread: Optional[threading.Thread] = None
        self.parser = StreamParser()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="claude-turn", daemon=True)
        self._thread.start()

    def join(self, timeout: Optional[float] = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def cancel(self) -> None:
        self._cancelled = True
        self._kill()

    def _kill(self) -> None:
        process = self._process
        if process is not None:
            try:
                if process.poll() is None:
                    process.kill()
            except Exception:  # noqa: BLE001
                pass

    def _emit(self, event: TurnEvent) -> None:
        try:
            self.on_event(event)
        except Exception:  # noqa: BLE001 - a UI bug must not wedge the worker
            pass

    def _run(self) -> None:
        stderr_lines: List[str] = []
        final: Optional[TurnEvent] = None
        try:
            if not os.path.isdir(self.cwd):
                raise FileNotFoundError(f"The folder {self.cwd} doesn't exist.")
            self._process = self._popen(
                self.command,
                cwd=self.cwd,
                env=self._env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding="utf-8",
                errors="replace",
                creationflags=platform_paths.hidden_window_flags(),
            )
            process = self._process

            def drain_stderr() -> None:
                try:
                    for err_line in process.stderr:
                        if len(stderr_lines) < 200:
                            stderr_lines.append(err_line.rstrip())
                except Exception:  # noqa: BLE001
                    pass

            err_thread = threading.Thread(target=drain_stderr, daemon=True)
            err_thread.start()
            try:
                process.stdin.write(self.prompt)
                process.stdin.close()
            except (OSError, ValueError):
                pass  # the process died early; its exit code tells us why

            for line in process.stdout:
                for event in self.parser.feed(line):
                    if event.kind == "started":
                        problem = api_key_problem(self.parser.api_key_source)
                        if problem:
                            self._stopped_for_key = True
                            self._kill()
                            final = TurnEvent("failed", text=problem, is_error=True,
                                              session_id=self.parser.session_id)
                            break
                    if event.kind == "finished":
                        final = event
                    else:
                        self._emit(event)
                if self._stopped_for_key:
                    break
            process.wait()
            err_thread.join(timeout=2)
            if final is None:
                if self._cancelled:
                    final = TurnEvent("failed", text="Stopped.", is_error=True,
                                      session_id=self.parser.session_id)
                else:
                    detail = next((l for l in reversed(stderr_lines) if l.strip()), "")
                    message = f"Claude exited without finishing the turn (exit code {process.returncode})."
                    if detail:
                        message += f" {detail}"
                    final = TurnEvent("failed", text=message, is_error=True,
                                      session_id=self.parser.session_id)
        except FileNotFoundError as exc:
            final = TurnEvent("failed", text=str(exc) or "The claude command was not found.",
                              is_error=True)
        except Exception as exc:  # noqa: BLE001
            final = TurnEvent("failed", text=f"Couldn't run claude: {exc}", is_error=True)
        if not final.session_id:
            final.session_id = self.parser.session_id
        self._emit(final)

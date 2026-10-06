"""Running turns of TheClaudeHub's own sessions through the ``claude`` command.

Why the command line, and how it stays on the subscription
---------------------------------------------------------
``claude -p`` (print / headless mode) runs a turn under the same login as
the desktop app and the terminal, so it costs nothing beyond the
subscription. The things that would change that are all ruled out here:

* **Never ``--bare``.** Bare mode skips the OAuth login and requires an API key.
* **A host session's variables don't reach the child.** If TheClaudeHub is
  started from inside a Claude Code session (a terminal tab in the desktop app,
  say), it inherits variables that session injected: ``ANTHROPIC_BASE_URL``
  pointing at the desktop app's local proxy, ``CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH``
  and friends that tell the CLI a host will refresh its OAuth token. A child
  run with those waits on a token refresh that never comes (the lock seen
  during the investigation for issue #168). Those are removed by name
  (``SESSION_INJECTED_VARS``), as are the variables that would move billing
  off the subscription (``BILLING_VARS``: API keys, auth tokens, a different
  endpoint, Bedrock/Vertex/Foundry). Everything else is kept, including
  settings the user chose such as ``CLAUDE_CODE_GIT_BASH_PATH``,
  ``CLAUDE_CONFIG_DIR``, proxies and timeouts.
* **Permission prompts are refused, never waited on.** ``--permission-prompts
  none`` tells the CLI nobody is there to answer, so anything that would ask
  is denied at once and the turn carries on.
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

Prompts go in on stdin, as UTF-8 bytes with the newlines exactly as typed, not
on the command line: a message that begins with ``-`` cannot be mistaken for a
flag, and there is no command-line length limit. Output is read as bytes and
split only on newline bytes.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Collection, Dict, List, Optional

from . import platform_paths

#: (value passed to --permission-mode, label shown in the New Session dialog)
PERMISSION_MODES = [
    ("auto", "Auto: Claude decides what is safe to run without asking"),
    ("acceptEdits", "Accept edits: file edits allowed, commands that need approval are refused"),
    ("manual", "Manual: anything that needs approval is refused"),
    ("plan", "Plan: Claude plans but does not change anything"),
]
PERMISSION_MODE_VALUES = [value for value, _label in PERMISSION_MODES]
DEFAULT_PERMISSION_MODE = "auto"
#: Older names the CLI still accepts; stored sessions may carry them.
_MODE_ALIASES = {"default": "manual"}

#: Set by a host Claude Code session (seen in the desktop app's terminal on
#: Claude Code 2.1.289). They describe *that* session, and some of them make a
#: child wait for the host to refresh its login.
SESSION_INJECTED_VARS = frozenset({
    "CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_AGENT_SDK_VERSION",
    "CLAUDE_PREVIEW_CLASSIFIER_FLOOR",
    "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_HOST_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH", "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_ACCOUNT_UUID", "CLAUDE_CODE_ORGANIZATION_UUID", "CLAUDE_CODE_USER_EMAIL",
    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_DESKTOP_APP_VERSION", "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES", "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
    "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "CLAUDE_CODE_REPORT_FINDINGS",
    "CLAUDE_CODE_EAGER_FLUSH", "CLAUDE_CODE_DISABLE_CRON",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "CLAUDE_CODE_TERMINAL_MCP_TOOLS",
})

#: Would take the turn off the subscription login (per-use billing or a cloud
#: provider), or point it at another endpoint.
BILLING_VARS = frozenset({
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL",
    "ANTHROPIC_VERTEX_PROJECT_ID", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
})

_STRIP = SESSION_INJECTED_VARS | BILLING_VARS

#: Whole families a host session sets, including names newer Claude Code
#: versions add. User settings (CLAUDE_CODE_GIT_BASH_PATH and the like) don't
#: use these prefixes.
SESSION_INJECTED_PREFIXES = ("CLAUDE_CODE_SDK_", "CLAUDE_CODE_HOST_",
                             "CLAUDE_CODE_MESSAGING_")


class ResumeRefused(ValueError):
    """--resume was asked for a session TheClaudeHub does not own."""


def child_environment(base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """The environment for a ``claude`` child process (see module docstring)."""
    base = dict(os.environ if base is None else base)
    return {k: v for k, v in base.items()
            if k.upper() not in _STRIP
            and not k.upper().startswith(SESSION_INJECTED_PREFIXES)}


def normalize_permission_mode(mode: str) -> str:
    return _MODE_ALIASES.get(mode, mode)


#: The model choices for a session: ``--model`` value and what the picker
#: says. Aliases, so each means that family's latest model. "" passes no
#: ``--model`` at all, leaving it to Claude Code's own setting.
MODELS = [
    ("", "Default (your Claude Code setting)"),
    ("fable", "Fable"),
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
]
MODEL_LABELS = dict(MODELS)
# A full model name ("claude-opus-5-5") may be stored by hand; nothing that
# could read as another option.
_SAFE_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._\[\]-]{0,99}")


def model_label(model: str) -> str:
    """How a session's model is named to Kelly."""
    return MODEL_LABELS.get(model, model) if model else "Default model"


def _common_flags(permission_mode: str, model: str = "") -> List[str]:
    permission_mode = normalize_permission_mode(permission_mode)
    if permission_mode not in PERMISSION_MODE_VALUES:
        raise ValueError(f"Unknown permission mode: {permission_mode!r}")
    flags = ["-p", "--output-format", "stream-json", "--verbose",
             "--permission-mode", permission_mode, "--permission-prompts", "none"]
    if model:
        if not _SAFE_MODEL.fullmatch(model):
            raise ValueError(f"Not a valid model name: {model!r}")
        # Every turn, not just the first. Checked with Claude Code: a resumed
        # session keeps its model without this, but saying it each time keeps
        # the session on Kelly's choice whatever the default becomes, and lets
        # a later change of model take effect on the next turn.
        flags += ["--model", model]
    return flags


def new_session_id() -> str:
    return str(uuid.uuid4())


def build_new_command(executable: str, session_id: str, title: str,
                      permission_mode: str, model: str = "") -> List[str]:
    """Command for the first turn of a new session. The prompt goes on stdin."""
    if not platform_paths.is_safe_id(session_id):
        raise ValueError("Not a valid session id.")
    command = [executable, *_common_flags(permission_mode, model),
               "--session-id", session_id]
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
                         desktop_ids: Collection[str], model: str = "") -> List[str]:
    """Command for a later turn. Refuses anything but TheClaudeHub's own sessions."""
    check_resume_allowed(session_id, own_ids, desktop_ids)
    return [executable, *_common_flags(permission_mode, model), "--resume", session_id]


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


def describe_elapsed(seconds: float) -> str:
    """'40 seconds', '3 minutes 5 seconds', '1 hour 2 minutes'."""
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)

    def unit(n, word):
        return f"{n} {word}" + ("s" if n != 1 else "")
    if hours:
        return unit(hours, "hour") + (" " + unit(minutes, "minute") if minutes else "")
    if minutes:
        return unit(minutes, "minute") + (" " + unit(secs, "second") if secs else "")
    return unit(secs, "second")


class TurnRunner:
    """Runs one turn in a background thread and reports ``TurnEvent``s.

    ``on_event`` is called from the worker thread; the UI marshals it onto the
    main thread (``wx.CallAfter``). Exactly one ``finished`` or ``failed``
    event is always delivered last, whatever happens.

    There is deliberately no time limit: a long build or test run is a normal
    turn. ``elapsed`` and ``last_activity`` let the UI say how long it has been
    going and what it was last doing, when asked; Stop ends it.
    """

    def __init__(self, command: List[str], cwd: str, prompt: str,
                 on_event: Callable[[TurnEvent], None],
                 popen: Callable[..., subprocess.Popen] = subprocess.Popen,
                 env: Optional[Dict[str, str]] = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.command = command
        self.cwd = cwd
        self.prompt = prompt
        self.on_event = on_event
        self._popen = popen
        self._env = env if env is not None else child_environment()
        self._process: Optional[subprocess.Popen] = None
        self._tree = platform_paths.ProcessTree()
        self._lock = threading.Lock()
        self._cancelled = False
        self._stopped_for_key = False
        self._thread: Optional[threading.Thread] = None
        self._clock = clock
        self.started_at = clock()
        self.last_activity = "starting"
        #: True once the CLI reported the session (system/init): from then on
        #: the session exists and later turns must --resume it.
        self.session_started = False
        self.parser = StreamParser()

    def elapsed(self) -> float:
        return self._clock() - self.started_at

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="claude-turn", daemon=True)
        self._thread.start()

    def join(self, timeout: Optional[float] = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
        self._kill()

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def _kill(self) -> None:
        process = self._process
        if process is None:
            return
        try:
            if process.poll() is None:
                self._tree.kill()
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
            if self._cancelled:
                raise _Cancelled()
            # Bytes in and out: text mode on Windows would turn the prompt's
            # newlines into CRLF, and splitting decoded text on every Unicode
            # line break would cut JSON lines that contain U+2028.
            process = self._popen(
                self.command,
                cwd=self.cwd,
                env=self._env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                **platform_paths.ProcessTree.popen_kwargs(),
            )
            with self._lock:
                self._process = process
                self._tree.attach(process)
                cancelled_early = self._cancelled
            if cancelled_early:
                # cancel() ran between the check above and Popen returning.
                self._kill()

            def drain_stderr() -> None:
                try:
                    for raw in iter(process.stderr.readline, b""):
                        if len(stderr_lines) < 200:
                            stderr_lines.append(_decode(raw).rstrip())
                except Exception:  # noqa: BLE001
                    pass

            err_thread = threading.Thread(target=drain_stderr, daemon=True)
            err_thread.start()
            try:
                process.stdin.write(self.prompt.encode("utf-8"))
                process.stdin.close()
            except (OSError, ValueError):
                pass  # the process died early; its exit code tells us why

            for raw in iter(process.stdout.readline, b""):
                for event in self.parser.feed(_decode(raw)):
                    if event.kind == "started":
                        self.session_started = True
                        problem = api_key_problem(self.parser.api_key_source)
                        if problem:
                            self._stopped_for_key = True
                            self._kill()
                            final = TurnEvent("failed", text=problem, is_error=True,
                                              session_id=self.parser.session_id)
                            break
                    if event.kind == "tool":
                        self.last_activity = f"using {event.text}"
                    elif event.kind == "text":
                        self.last_activity = "writing a reply"
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
                    detail = next((x for x in reversed(stderr_lines) if x.strip()), "")
                    message = ("Claude exited without finishing the turn "
                               f"(exit code {process.returncode}).")
                    if detail:
                        message += f" {detail}"
                    final = TurnEvent("failed", text=message, is_error=True,
                                      session_id=self.parser.session_id)
        except _Cancelled:
            final = TurnEvent("failed", text="Stopped.", is_error=True)
        except FileNotFoundError as exc:
            final = TurnEvent("failed", text=str(exc) or "The claude command was not found.",
                              is_error=True)
        except Exception as exc:  # noqa: BLE001
            final = TurnEvent("failed", text=f"Couldn't run claude: {exc}", is_error=True)
        finally:
            self._tree.close()
        if not final.session_id:
            final.session_id = self.parser.session_id
        self._emit(final)


class _Cancelled(Exception):
    pass


def _decode(raw) -> str:
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)

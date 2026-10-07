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
* **Permission prompts come to TheClaudeHub** (issues #187, #188), over the
  same pipes, with the control protocol the Agent SDK uses:
  ``--input-format stream-json --permission-prompts host
  --permission-prompt-tool stdio``. Anything that would ask arrives as a
  ``control_request`` (``can_use_tool``) and the turn waits until it is
  answered with a ``control_response``: allow (optionally with the input
  changed, which is how Claude's questions are answered), or deny with a
  reason Claude reads. Nothing is ever answered by timing out; Stop ends the
  turn. Claude's questions (AskUserQuestion) and plans (ExitPlanMode) come
  the same way. Checked against Claude Code 2.1.286.
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

Prompts go in on stdin, as a stream-json user message (UTF-8, the newlines
exactly as typed, escaped by JSON), not on the command line: a message that
begins with ``-`` cannot be mistaken for a flag, and there is no command-line
length limit. Stdin stays open for the turn, for answers to permission
requests, and is closed when the result arrives so the CLI exits. Output is
read as bytes and split only on newline bytes.
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
#:
#: Fable is left out on purpose. Claude Code's docs: on some plans Fable
#: bills to usage credits, and in ``-p`` mode (every TheClaudeHub turn) it
#: does so without asking. TheClaudeHub must never cost extra, and the
#: ``apiKeySource`` check can't catch this (it's still the subscription
#: login). Add it only once Kelly's plan is known to include it.
MODELS = [
    ("", "Default (your Claude Code setting)"),
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
]
MODEL_LABELS = dict(MODELS)
# A full model name ("claude-opus-5-5") may be stored by hand; nothing that
# could read as another option. No brackets: "sonnet[1m]" (1M context) needs
# usage credits on every subscription plan. No "@" or ":": those are Vertex
# and Bedrock ids, and their switches are stripped anyway.
_SAFE_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")


def is_safe_model(model: str) -> bool:
    """Whether ``model`` may be passed as ``--model`` ("" means none)."""
    return not model or bool(_SAFE_MODEL.fullmatch(model))


def model_label(model: str) -> str:
    """How a session's model is named to Kelly."""
    return MODEL_LABELS.get(model, model) if model else "the default model"


#: A permission rule as Claude Code writes them: ``Tool`` or
#: ``Tool(content)``, one line. Rules come from Claude Code's own suggestions,
#: and must never read as a flag.
_SAFE_RULE = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,99}(\([^\r\n]{0,500}\))?")


def is_safe_rule(rule: str) -> bool:
    return isinstance(rule, str) and bool(_SAFE_RULE.fullmatch(rule))


def _common_flags(permission_mode: str, model: str = "",
                  allowed_tools: Collection[str] = ()) -> List[str]:
    permission_mode = normalize_permission_mode(permission_mode)
    if permission_mode not in PERMISSION_MODE_VALUES:
        raise ValueError(f"Unknown permission mode: {permission_mode!r}")
    flags = ["-p", "--input-format", "stream-json", "--output-format", "stream-json",
             "--verbose", "--permission-mode", permission_mode,
             "--permission-prompts", "host", "--permission-prompt-tool", "stdio"]
    if model:
        if not is_safe_model(model):
            raise ValueError(f"Not a valid model name: {model!r}")
        # Every turn, not just the first. Checked with Claude Code: a resumed
        # session keeps its model without this, but saying it each time keeps
        # the session on Kelly's choice whatever Claude Code does later.
        flags += ["--model", model]
    rules = [rule for rule in allowed_tools if is_safe_rule(rule)]
    if rules:
        # "Allow for this session" (#187). Claude Code keeps a session-scoped
        # rule only for the life of the process, and every turn here is a new
        # process, so the rules are kept with the session and given again
        # each turn. The option takes several values; the flag after it ends
        # the list.
        flags += ["--allowedTools", *rules]
    return flags


def new_session_id() -> str:
    return str(uuid.uuid4())


def build_new_command(executable: str, session_id: str, title: str,
                      permission_mode: str, model: str = "",
                      allowed_tools: Collection[str] = ()) -> List[str]:
    """Command for the first turn of a new session. The prompt goes on stdin."""
    if not platform_paths.is_safe_id(session_id):
        raise ValueError("Not a valid session id.")
    command = [executable, *_common_flags(permission_mode, model, allowed_tools),
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


def build_fork_command(executable: str, source_id: str, new_id: str, title: str,
                       permission_mode: str, model: str = "",
                       taken_ids: Collection[str] = ()) -> List[str]:
    """Command for the first turn of a copy of another session (#189), such
    as a desktop app session, to carry on in TheClaudeHub.

    ``--resume <source> --fork-session --session-id <new>``: Claude Code reads
    the source's history and writes only to the new session. Checked with
    Claude Code 2.1.286: the source transcript was byte for byte the same
    afterwards, the new id was the one asked for, and Claude knew the earlier
    conversation. So this is allowed for desktop sessions, where a plain
    ``--resume`` is not; the new id must be one nobody has.
    """
    if not platform_paths.is_safe_id(source_id) or source_id.startswith("local_"):
        raise ResumeRefused("That is not a session id Claude Code can continue from.")
    if not platform_paths.is_safe_id(new_id) or new_id == source_id or new_id in taken_ids:
        raise ValueError("The new session needs an id of its own.")
    command = [executable, *_common_flags(permission_mode, model),
               "--resume", source_id, "--fork-session", "--session-id", new_id]
    title = " ".join((title or "").split())
    if title:
        command += ["--name", title]
    return command


def build_resume_command(executable: str, session_id: str, permission_mode: str,
                         own_ids: Collection[str],
                         desktop_ids: Collection[str], model: str = "",
                         allowed_tools: Collection[str] = ()) -> List[str]:
    """Command for a later turn. Refuses anything but TheClaudeHub's own sessions."""
    check_resume_allowed(session_id, own_ids, desktop_ids)
    return [executable, *_common_flags(permission_mode, model, allowed_tools),
            "--resume", session_id]


# ---------------------------------------------------------------------------
# stream-json events
# ---------------------------------------------------------------------------


INIT_REQUEST_ID = "theclaudehub-init"


def stdin_lines(prompt: str) -> bytes:
    """What starts a turn on stdin: the ``initialize`` control request (its
    answer lists the slash commands and skills) and the user's message."""
    initialize = {"type": "control_request", "request_id": INIT_REQUEST_ID,
                  "request": {"subtype": "initialize", "hooks": None}}
    message = {"type": "user", "session_id": "", "parent_tool_use_id": None,
               "message": {"role": "user", "content": prompt}}
    return (json.dumps(initialize) + "\n" + json.dumps(message, ensure_ascii=False)
            + "\n").encode("utf-8")


QUESTION_TOOL = "AskUserQuestion"
PLAN_TOOL = "ExitPlanMode"
SHELL_TOOLS = ("Bash", "PowerShell")


def _tool_target(tool_input: dict, limit: int = 160) -> str:
    """The one value that says what a tool call is about: its command, file,
    URL or pattern, on one line."""
    for key in ("command", "file_path", "notebook_path", "path", "url", "pattern", "query"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            target = " ".join(value.split())
            return target if len(target) <= limit else target[: limit - 1] + "…"
    return ""


def describe_tool_use(name: str, tool_input: dict) -> str:
    """A tool call as words: "run npm init -y", "edit README.md"."""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    target = _tool_target(tool_input)
    if name in SHELL_TOOLS and target:
        return f"run {target}"
    verbs = {"Write": "write", "Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit",
             "Read": "read", "WebFetch": "fetch", "WebSearch": "search the web for"}
    if name in verbs and target:
        if name in ("Write", "Edit", "MultiEdit", "NotebookEdit", "Read"):
            target = os.path.basename(target.rstrip("\\/")) or target
        return f"{verbs[name]} {target}"
    return f"use {name}: {target}" if target else f"use {name}"


def describe_denial(denial: dict) -> str:
    """A permission denial from the result event, as words."""
    if not isinstance(denial, dict):
        return "A tool was refused."
    name = str(denial.get("tool_name") or "A tool")
    tool_input = denial.get("tool_input") if isinstance(denial.get("tool_input"), dict) else {}
    target = _tool_target(tool_input)
    return f"{name} was refused: {target}" if target else f"{name} was refused"


@dataclass
class PermissionRequest:
    """Claude Code asking TheClaudeHub before a tool runs (a ``can_use_tool``
    control request). Claude's questions and plans come this way too."""

    request_id: str
    tool_name: str
    input: dict = field(default_factory=dict)
    description: str = ""
    suggestions: list = field(default_factory=list)
    tool_use_id: str = ""

    @property
    def is_question(self) -> bool:
        return self.tool_name == QUESTION_TOOL

    @property
    def is_plan(self) -> bool:
        return self.tool_name == PLAN_TOOL

    def questions(self) -> List[dict]:
        items = self.input.get("questions")
        return [q for q in items if isinstance(q, dict) and isinstance(q.get("question"), str)] \
            if isinstance(items, list) else []

    def plan(self) -> str:
        plan = self.input.get("plan")
        return plan if isinstance(plan, str) else ""

    def summary(self) -> str:
        """One line, for announcements: what Claude is waiting for."""
        if self.is_question:
            questions = self.questions()
            first = questions[0]["question"] if questions else "a question"
            more = f" (and {len(questions) - 1} more)" if len(questions) > 1 else ""
            return f"Claude asks: {first}{more}"
        if self.is_plan:
            return "Claude's plan is ready for you to approve"
        return f"Claude wants to {describe_tool_use(self.tool_name, self.input)}"

    def detail(self) -> str:
        """Everything about the request, to read by line."""
        lines = [self.summary() + "."]
        if self.description and self.description not in lines[0]:
            lines.append(f"Why: {self.description}")
        if self.tool_name in SHELL_TOOLS:
            lines += ["", f"{self.tool_name} command:", str(self.input.get("command", ""))]
            return "\n".join(lines)
        if self.tool_name == "Write":
            lines += ["", f"File: {self.input.get('file_path', '')}", "", "Content:",
                      str(self.input.get("content", ""))]
            return "\n".join(lines)
        if self.tool_name == "Edit":
            lines += ["", f"File: {self.input.get('file_path', '')}", "", "Replace:",
                      str(self.input.get("old_string", "")), "", "With:",
                      str(self.input.get("new_string", ""))]
            return "\n".join(lines)
        lines.append("")
        for key, value in self.input.items():
            if isinstance(value, str):
                lines.append(f"{key}: {value}")
            else:
                lines.append(f"{key}: {json.dumps(value, ensure_ascii=False, indent=2)}")
        return "\n".join(lines)

    def session_rules(self) -> List[str]:
        """The rules Claude Code suggests for not asking again, as
        ``Tool(content)`` strings."""
        rules = []
        for suggestion in self.suggestions:
            if not isinstance(suggestion, dict) or suggestion.get("type") != "addRules":
                continue
            if suggestion.get("behavior", "allow") != "allow":
                continue
            for rule in suggestion.get("rules") or []:
                if not isinstance(rule, dict) or not isinstance(rule.get("toolName"), str):
                    continue
                content = rule.get("ruleContent")
                text = f"{rule['toolName']}({content})" if isinstance(content, str) and content \
                    else rule["toolName"]
                if is_safe_rule(text):
                    rules.append(text)
        return rules

    def session_mode(self) -> str:
        """A permission mode Claude Code suggests switching to instead
        ("acceptEdits" for a file edit), or ""."""
        for suggestion in self.suggestions:
            if isinstance(suggestion, dict) and suggestion.get("type") == "setMode" \
                    and suggestion.get("mode") in PERMISSION_MODE_VALUES:
                return suggestion["mode"]
        return ""

    def allow_for_session_label(self) -> str:
        """What "Allow for this session" means for this request, or "" when
        Claude Code has nothing to suggest."""
        mode = self.session_mode()
        if mode == "acceptEdits":
            return "Allow, and accept all file edits for the rest of this session"
        if mode:
            return f"Allow, and switch this session to {mode} mode"
        rules = self.session_rules()
        if rules:
            return "Allow, and don't ask again this session for " + ", ".join(rules)
        return ""


def allow_response(request: PermissionRequest, updated_input: Optional[dict] = None,
                   for_session: bool = False, mode: str = "") -> dict:
    """The answer that lets the tool run. ``for_session`` applies Claude
    Code's suggestion for the rest of this turn (the caller keeps it for
    later turns); ``mode`` switches the permission mode (approving a plan)."""
    response = {"behavior": "allow",
                "updatedInput": updated_input if updated_input is not None else request.input}
    updates = []
    if mode:
        updates.append({"type": "setMode", "mode": mode, "destination": "session"})
    elif for_session:
        session_mode = request.session_mode()
        if session_mode:
            updates.append({"type": "setMode", "mode": session_mode, "destination": "session"})
        else:
            rules = []
            for rule in request.session_rules():
                name, _, content = rule.partition("(")
                entry = {"toolName": name}
                if content:
                    entry["ruleContent"] = content[:-1]
                rules.append(entry)
            if rules:
                updates.append({"type": "addRules", "rules": rules, "behavior": "allow",
                                "destination": "session"})
    if updates:
        response["updatedPermissions"] = updates
    return response


def deny_response(message: str = "") -> dict:
    """The answer that refuses; Claude reads ``message`` as the reason."""
    return {"behavior": "deny",
            "message": message.strip() or "The user refused this. Don't try it another way "
                                           "without asking."}


def answer_questions_response(request: PermissionRequest, answers: Dict[str, str]) -> dict:
    """Claude's questions answered: the tool runs with the answers added."""
    return allow_response(request, updated_input={**request.input, "answers": answers})


@dataclass
class TurnEvent:
    """One thing that happened during a turn, already made readable."""

    kind: str               # started | text | tool | denied | permission | finished | failed
    text: str = ""
    session_id: str = ""
    is_error: bool = False
    denials: List[str] = field(default_factory=list)
    raw_type: str = ""
    request: Optional[PermissionRequest] = None


class StreamParser:
    """Turns ``claude -p --output-format stream-json --verbose`` lines into
    ``TurnEvent``s. Unknown event types are ignored; bad lines are counted."""

    def __init__(self) -> None:
        self.session_id = ""
        self.api_key_source: Optional[str] = None
        self.bad_lines = 0
        self.finished = False
        #: Slash commands and skills, from the answer to ``initialize``:
        #: dicts with ``name``, ``description`` and ``argumentHint``.
        self.commands: List[dict] = []
        #: Control requests TheClaudeHub can't answer (not ``can_use_tool``);
        #: the runner refuses them so the CLI doesn't wait.
        self.unsupported_requests: List[str] = []

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

        if etype == "control_request":
            request_id = str(event.get("request_id") or "")
            request = event.get("request") if isinstance(event.get("request"), dict) else {}
            if request.get("subtype") == "can_use_tool" and request_id:
                tool_input = request.get("input") if isinstance(request.get("input"), dict) else {}
                suggestions = request.get("permission_suggestions")
                permission = PermissionRequest(
                    request_id=request_id,
                    tool_name=str(request.get("tool_name") or "a tool"),
                    input=tool_input,
                    description=str(request.get("description") or ""),
                    suggestions=suggestions if isinstance(suggestions, list) else [],
                    tool_use_id=str(request.get("tool_use_id") or ""))
                return [TurnEvent("permission", text=permission.summary(),
                                  session_id=self.session_id, request=permission)]
            if request_id:
                self.unsupported_requests.append(request_id)
            return []
        if etype == "control_response":
            response = event.get("response") if isinstance(event.get("response"), dict) else {}
            if response.get("request_id") == INIT_REQUEST_ID:
                body = response.get("response") if isinstance(response.get("response"), dict) \
                    else {}
                commands = body.get("commands")
                if isinstance(commands, list):
                    self.commands = [c for c in commands
                                     if isinstance(c, dict) and isinstance(c.get("name"), str)]
            return []
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
        #: Permission requests sent to the UI and not yet answered.
        self.pending: Dict[str, PermissionRequest] = {}
        self._stdin_open = False

    def elapsed(self) -> float:
        return self._clock() - self.started_at

    def respond(self, request_id: str, response: dict) -> bool:
        """Answer a permission request (from the UI thread). False if the turn
        is already over or the request isn't waiting."""
        with self._lock:
            request = self.pending.pop(request_id, None)
            if request is None:
                return False
            ok = self._write_line({"type": "control_response", "response": {
                "subtype": "success", "request_id": request_id, "response": response}})
            if ok:
                self.last_activity = (
                    "working" if response.get("behavior") == "allow"
                    else f"carrying on after you refused {request.tool_name}")
            return ok

    def _write_line(self, obj: dict) -> bool:
        """Write one JSON line to the CLI's stdin. Call with ``_lock`` held."""
        process = self._process
        if process is None or not self._stdin_open:
            return False
        try:
            process.stdin.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
            process.stdin.flush()
            return True
        except (OSError, ValueError):
            return False

    def _close_stdin(self) -> None:
        with self._lock:
            if not self._stdin_open or self._process is None:
                return
            self._stdin_open = False
            try:
                self._process.stdin.close()
            except (OSError, ValueError):
                pass

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
            with self._lock:
                try:
                    process.stdin.write(stdin_lines(self.prompt))
                    process.stdin.flush()
                    self._stdin_open = True
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
                    elif event.kind == "permission":
                        with self._lock:
                            self.pending[event.request.request_id] = event.request
                        self.last_activity = f"waiting for you: {event.request.summary()}"
                    if event.kind == "finished":
                        final = event
                        # The turn is over: closing stdin lets the CLI exit.
                        self._close_stdin()
                    else:
                        self._emit(event)
                self._refuse_unsupported()
                if self._stopped_for_key:
                    break
            self._close_stdin()
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
            with self._lock:
                self.pending.clear()
        if not final.session_id:
            final.session_id = self.parser.session_id
        self._emit(final)

    def _refuse_unsupported(self) -> None:
        """Control requests other than permission checks (hooks, MCP
        messages): TheClaudeHub registers none, so say so at once rather than
        leave the CLI waiting."""
        while self.parser.unsupported_requests:
            request_id = self.parser.unsupported_requests.pop(0)
            with self._lock:
                self._write_line({"type": "control_response", "response": {
                    "subtype": "error", "request_id": request_id,
                    "error": "TheClaudeHub doesn't support this request."}})


class _Cancelled(Exception):
    pass


def _decode(raw) -> str:
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)

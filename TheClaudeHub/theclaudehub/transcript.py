"""Turn a Claude Code transcript (``<session>.jsonl``) into a readable chat.

The transcript format is internal to Claude Code and changes between
versions (https://code.claude.com/docs/en/sessions), so this module is the one
place that knows it, and it is written to survive change:

* **Unknown record types are skipped silently.** There are many (attachment,
  custom-title, pr-link, queue-operation, mode, ...) and new ones appear; none
  of them is conversation.
* **A line that will not parse, or a user/assistant record shaped in a way we
  do not expect, is counted, never raised.** The UI says "couldn't read N
  lines" instead of crashing.
* ``message.content`` may be a plain string or a list of blocks; both work.

What the chat shows, and why:

* ``You`` and ``Claude`` text. Assistant replies are written one content block
  per record, so records sharing a ``message.id`` are merged back into one
  message.
* Question cards (``AskUserQuestion``) and their answers, permission denials,
  plans (``ExitPlanMode``), API errors and interruptions are shown, because
  they explain where the conversation went.
* Tool calls, tool results, thinking, meta/context records, compaction
  summaries and harness events (``<task-notification>`` and friends) are
  "activity": hidden unless the reader turns on Show Tool Activity.
* Sidechain (subagent) records are left out; they live in their own files.

No wx imports: everything here is testable on its own.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

# Message kinds. The label is what a screen reader hears first on each line.
USER = "user"
ASSISTANT = "assistant"
QUESTION = "question"
ANSWER = "answer"
DENIED = "denied"
PLAN = "plan"
ERROR = "error"
INTERRUPTED = "interrupted"
TOOL = "tool"
TOOL_RESULT = "tool_result"
CONTEXT = "context"
EVENT = "event"

LABELS = {
    USER: "You",
    ASSISTANT: "Claude",
    QUESTION: "Claude asked",
    ANSWER: "You answered",
    DENIED: "Permission denied",
    PLAN: "Claude's plan",
    ERROR: "Error",
    INTERRUPTED: "Interrupted",
    TOOL: "Tool",
    TOOL_RESULT: "Tool result",
    CONTEXT: "Context",
    EVENT: "Event",
}

#: Kinds hidden unless "show tool activity" is on.
ACTIVITY_KINDS = frozenset({TOOL, TOOL_RESULT, CONTEXT, EVENT})


@dataclass
class ChatMessage:
    kind: str
    text: str
    timestamp: str = ""
    key: str = ""  # stable identity (record uuid, or message id for merged replies)

    @property
    def label(self) -> str:
        return LABELS.get(self.kind, self.kind.capitalize())

    @property
    def is_activity(self) -> bool:
        return self.kind in ACTIVITY_KINDS

    def first_line(self, limit: int = 300) -> str:
        for line in self.text.splitlines():
            line = line.strip()
            if line:
                return line if len(line) <= limit else line[: limit - 1] + "…"
        return "(empty)"

    def list_line(self) -> str:
        """One line for the chat list: who spoke, then the first line."""
        return f"{self.label}: {self.first_line()}"

    def full_text(self) -> str:
        return f"{self.label}:\n{self.text}"


@dataclass
class Transcript:
    messages: List[ChatMessage] = field(default_factory=list)
    unreadable_lines: int = 0
    lines_read: int = 0

    def visible(self, show_activity: bool = False) -> List[ChatMessage]:
        if show_activity:
            return list(self.messages)
        return [m for m in self.messages if not m.is_activity]

    def last_reply(self) -> Optional[ChatMessage]:
        for message in reversed(self.messages):
            if message.kind in (ASSISTANT, QUESTION, PLAN, ERROR):
                return message
        return None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_HARNESS_TAG = re.compile(r"^\s*<([A-Za-z][A-Za-z0-9_-]*)>")
_SYSTEM_REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)
_ANY_TAG = re.compile(r"</?[A-Za-z][A-Za-z0-9_-]*>")
_INTERRUPT = re.compile(r"^\[Request interrupted by user[^\]]*\]", re.IGNORECASE)

# Tool input fields worth naming in a one-line activity summary, in order.
_TOOL_SUMMARY_FIELDS = ("description", "command", "file_path", "path", "pattern",
                        "url", "query", "prompt", "skill", "subject")


class _Unreadable(Exception):
    """A user/assistant record whose shape we do not understand."""


class TranscriptParser:
    """Incremental parser: ``feed`` lines as the file grows.

    State carried between calls lets a tail of new lines be parsed without
    re-reading a 20 MB file: which tool calls were question cards, and which
    assistant message id the last reply belonged to.
    """

    def __init__(self) -> None:
        self.transcript = Transcript()
        self._tool_names: Dict[str, str] = {}  # tool_use_id -> tool name
        self._last_assistant_id: Optional[str] = None

    # -- public -------------------------------------------------------------

    def feed(self, lines: Iterable[str]) -> List[ChatMessage]:
        """Parse more lines; returns the messages added or changed by them."""
        touched: List[ChatMessage] = []
        for line in lines:
            if not line.strip():
                continue
            self.transcript.lines_read += 1
            try:
                record = json.loads(line)
            except (ValueError, TypeError):
                self.transcript.unreadable_lines += 1
                continue
            if not isinstance(record, dict):
                self.transcript.unreadable_lines += 1
                continue
            try:
                touched.extend(self._record(record))
            except _Unreadable:
                self.transcript.unreadable_lines += 1
            except Exception:  # noqa: BLE001 - a format change must never crash the app
                self.transcript.unreadable_lines += 1
        return touched

    # -- records ------------------------------------------------------------

    def _record(self, record: dict) -> List[ChatMessage]:
        kind = record.get("type")
        if kind not in ("user", "assistant"):
            return []  # attachment, custom-title, pr-link, ...: not conversation
        if record.get("isSidechain"):
            return []
        message = record.get("message")
        if not isinstance(message, dict):
            raise _Unreadable()
        content = message.get("content")
        if kind == "user":
            self._last_assistant_id = None
            return self._user(record, content)
        return self._assistant(record, message, content)

    def _add(self, kind: str, text: str, record: dict, key: str = "") -> ChatMessage:
        item = ChatMessage(kind=kind, text=text.strip(),
                           timestamp=str(record.get("timestamp") or ""),
                           key=key or str(record.get("uuid") or ""))
        self.transcript.messages.append(item)
        return item

    # user ------------------------------------------------------------------

    def _user(self, record: dict, content) -> List[ChatMessage]:
        added: List[ChatMessage] = []
        if record.get("isCompactSummary"):
            added.append(self._add(CONTEXT, "Summary of the earlier conversation:\n"
                                   + _plain_text(content), record))
            return added
        if record.get("isMeta"):
            text = _plain_text(content)
            if text.strip():
                added.append(self._add(CONTEXT, text, record))
            return added

        if isinstance(content, str):
            added.extend(self._user_text(content, record))
            return added
        if not isinstance(content, list):
            raise _Unreadable()

        texts: List[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                texts.append(str(block.get("text") or ""))
            elif btype == "image":
                texts.append("[image]")
            elif btype == "tool_result":
                added.append(self._tool_result(block, record))
        if texts:
            added.extend(self._user_text("\n".join(texts), record))
        return added

    def _user_text(self, text: str, record: dict) -> List[ChatMessage]:
        tag = _HARNESS_TAG.match(text)
        if tag:
            # <task-notification>, <ci-monitor-event>, <command-name>, ...:
            # written by the harness, not typed by the person.
            body = _ANY_TAG.sub(" ", _SYSTEM_REMINDER.sub("", text))
            body = re.sub(r"[ \t]+", " ", body).strip()
            name = tag.group(1).replace("-", " ")
            return [self._add(EVENT, f"{name}: {body}" if body else name, record)]
        text = _SYSTEM_REMINDER.sub("", text).strip()
        if not text:
            return []
        if _INTERRUPT.match(text):
            return [self._add(INTERRUPTED, "You stopped Claude.", record)]
        return [self._add(USER, text, record)]

    def _tool_result(self, block: dict, record: dict) -> ChatMessage:
        tool_id = str(block.get("tool_use_id") or "")
        name = self._tool_names.get(tool_id, "")
        body = _plain_text(block.get("content"))
        if name == "AskUserQuestion":
            return self._add(ANSWER, _format_answers(record.get("toolUseResult"), body),
                             record, key=f"{record.get('uuid')}:{tool_id}")
        denial = record.get("toolDenialKind")
        if block.get("is_error") and denial:
            reason = _first_nonblank(body) or str(denial)
            what = f"{name}: " if name else ""
            return self._add(DENIED, f"{what}{reason}", record,
                             key=f"{record.get('uuid')}:{tool_id}")
        label = f"{name} " if name else ""
        prefix = "failed" if block.get("is_error") else "returned"
        return self._add(TOOL_RESULT, f"{label}{prefix}: {body}".strip(), record,
                         key=f"{record.get('uuid')}:{tool_id}")

    # assistant ---------------------------------------------------------------

    def _assistant(self, record: dict, message: dict, content) -> List[ChatMessage]:
        msg_id = str(message.get("id") or record.get("uuid") or "")
        if record.get("isApiErrorMessage"):
            self._last_assistant_id = None
            return [self._add(ERROR, _plain_text(content) or "Claude reported an error.",
                              record)]
        if isinstance(content, str):
            blocks = [{"type": "text", "text": content}]
        elif isinstance(content, list):
            blocks = content
        else:
            raise _Unreadable()

        touched: List[ChatMessage] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                text = str(block.get("text") or "")
                if not text.strip():
                    continue
                last = self.transcript.messages[-1] if self.transcript.messages else None
                if (last is not None and last.kind == ASSISTANT
                        and self._last_assistant_id == msg_id and msg_id):
                    last.text = f"{last.text}\n\n{text.strip()}"
                    touched.append(last)
                else:
                    touched.append(self._add(ASSISTANT, text, record, key=msg_id))
                    self._last_assistant_id = msg_id
            elif btype == "tool_use":
                touched.append(self._tool_use(block, record))
                # A tool call ends the text run: text after it is a new message.
                self._last_assistant_id = None
            # thinking, redacted_thinking and unknown blocks: not shown
        return touched

    def _tool_use(self, block: dict, record: dict) -> ChatMessage:
        name = str(block.get("name") or "tool")
        tool_id = str(block.get("id") or "")
        if tool_id:
            self._tool_names[tool_id] = name
        tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
        key = f"{record.get('uuid')}:{tool_id}"
        if name == "AskUserQuestion":
            return self._add(QUESTION, _format_questions(tool_input), record, key=key)
        if name == "ExitPlanMode":
            plan = str(tool_input.get("plan") or "").strip()
            return self._add(PLAN, plan or "Claude proposed a plan.", record, key=key)
        return self._add(TOOL, _summarize_tool(name, tool_input), record, key=key)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _plain_text(content) -> str:
    """Text out of a string, a list of blocks, or anything else."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
                elif block.get("type") == "image":
                    parts.append("[image]")
                elif block.get("type") == "tool_reference":
                    parts.append(f"[tool {block.get('tool_name', '')}]")
        return "\n".join(p for p in parts if p)
    return str(content)


def _first_nonblank(text: str) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def _format_questions(tool_input: dict) -> str:
    """A question card as words: the question, then its options."""
    questions = tool_input.get("questions")
    if not isinstance(questions, list) or not questions:
        return "Claude asked a question (its contents could not be read)."
    parts = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        text = str(q.get("question") or q.get("header") or "").strip()
        options = []
        for opt in q.get("options") or []:
            if isinstance(opt, dict):
                label = str(opt.get("label") or "").strip()
                desc = str(opt.get("description") or "").strip()
                if label:
                    options.append(f"{label} ({desc})" if desc else label)
            elif isinstance(opt, str):
                options.append(opt)
        line = text
        if options:
            many = " Choose any." if q.get("multiSelect") else ""
            line += f"\nOptions: {'; '.join(options)}.{many}"
        parts.append(line)
    return "\n\n".join(parts) or "Claude asked a question."


def _format_answers(tool_use_result, fallback: str) -> str:
    if isinstance(tool_use_result, dict):
        answers = tool_use_result.get("answers")
        if isinstance(answers, dict) and answers:
            return "\n".join(f"{q} — {a}" for q, a in answers.items())
    text = fallback.strip()
    prefix = "Your questions have been answered:"
    if text.startswith(prefix):
        text = text[len(prefix):].strip()
    return text or "(answered)"


def _summarize_tool(name: str, tool_input: dict) -> str:
    for key in _TOOL_SUMMARY_FIELDS:
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            value = " ".join(value.split())
            if len(value) > 160:
                value = value[:159] + "…"
            return f"{name}: {value}"
    return name


# ---------------------------------------------------------------------------
# Reading files
# ---------------------------------------------------------------------------


class TranscriptReader:
    """Reads a transcript file and keeps up with it as it grows.

    Only whole lines are parsed. A line still being written (no newline yet)
    waits for the next ``refresh``, so a live session never shows a spurious
    "couldn't read" count. If the file shrinks it was rewritten, and the reader
    starts over. Opens the file read-only, always.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._offset = 0
        self._parser = TranscriptParser()

    @property
    def transcript(self) -> Transcript:
        return self._parser.transcript

    def refresh(self) -> bool:
        """Read anything new. Returns True if the transcript changed."""
        try:
            size = self.path.stat().st_size
        except OSError:
            return False
        if size < self._offset:
            self._offset = 0
            self._parser = TranscriptParser()
        if size == self._offset:
            return False
        with open(self.path, "rb") as handle:
            handle.seek(self._offset)
            data = handle.read(size - self._offset)
        end = data.rfind(b"\n")
        if end < 0:
            return False
        complete = data[: end + 1]
        self._offset += len(complete)
        lines = split_jsonl(complete)
        before = (len(self.transcript.messages), self.transcript.unreadable_lines)
        touched = self._parser.feed(lines)
        after = (len(self.transcript.messages), self.transcript.unreadable_lines)
        return bool(touched) or before != after


def split_jsonl(data: bytes) -> List[str]:
    """Lines of a JSONL file, split on newline bytes only.

    Not ``str.splitlines()``: that also splits on U+2028, U+2029 and U+0085,
    which JSON writers leave raw inside strings, and so would cut a record in
    half and lose the message.
    """
    return [raw.decode("utf-8", errors="replace").rstrip("\r")
            for raw in data.split(b"\n")]


def read_transcript(path: Path) -> Transcript:
    reader = TranscriptReader(path)
    reader.refresh()
    return reader.transcript


def parse_lines(lines: Iterable[str]) -> Transcript:
    parser = TranscriptParser()
    parser.feed(lines)
    return parser.transcript

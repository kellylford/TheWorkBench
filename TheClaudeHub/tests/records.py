"""Synthetic transcript records, shaped like Claude Code 2.1's.

Every record here is invented. The shapes (field names, nesting, one content
block per assistant record sharing a message id) are modelled on real
transcripts; no real conversation content is copied.
"""
from __future__ import annotations

import itertools
import json

_counter = itertools.count(1)


def _uuid() -> str:
    return f"00000000-0000-4000-8000-{next(_counter):012d}"


def _base(kind: str, **extra) -> dict:
    record = {
        "parentUuid": None,
        "isSidechain": False,
        "type": kind,
        "uuid": _uuid(),
        "timestamp": "2026-10-06T12:00:00.000Z",
        "userType": "external",
        "entrypoint": "claude-desktop",
        "cwd": "C:\\Users\\someone\\GitHub\\Example",
        "sessionId": "11111111-2222-4333-8444-555555555555",
        "version": "2.1.289",
        "gitBranch": "main",
    }
    record.update(extra)
    return record


def user_text(text, **extra) -> dict:
    return _base("user", message={"role": "user", "content": text}, **extra)


def user_blocks(blocks, **extra) -> dict:
    return _base("user", message={"role": "user", "content": blocks}, **extra)


def assistant_block(block, message_id="msg_A", **extra) -> dict:
    return _base("assistant", message={
        "id": message_id, "type": "message", "role": "assistant",
        "model": "claude-opus-5-5", "content": [block],
        "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 1},
    }, requestId="req_x", **extra)


def text_block(text) -> dict:
    return {"type": "text", "text": text}


def thinking_block() -> dict:
    return {"type": "thinking", "thinking": "", "signature": "abc"}


def tool_use_block(name, tool_input, tool_id="toolu_1") -> dict:
    return {"type": "tool_use", "id": tool_id, "name": name, "input": tool_input,
            "caller": {"type": "direct"}}


def tool_result(tool_id, content, is_error=False, **extra) -> dict:
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": content}
    if is_error:
        block["is_error"] = True
    return user_blocks([block], sourceToolAssistantUUID=_uuid(), **extra)


def other(kind, **extra) -> dict:
    return {"type": kind, "sessionId": "11111111-2222-4333-8444-555555555555", **extra}


def lines(*records) -> list:
    return [json.dumps(r) for r in records]

"""A stand-in for `claude -p --output-format stream-json`, for tests.

Reads the prompt from stdin as raw bytes, records what it got, and writes
stream-json to stdout as raw UTF-8 (with a raw U+2028 inside one string, as
JSON writers leave it). FAKE_CLAUDE_MODE=hang starts a grandchild process and
waits, so a test can check that cancelling kills the whole tree.
"""
import json
import os
import subprocess
import sys
import time

prompt = sys.stdin.buffer.read().decode("utf-8")
log = os.environ.get("FAKE_CLAUDE_LOG")
if log:
    with open(log, "w", encoding="utf-8") as handle:
        json.dump({"prompt": prompt, "args": sys.argv[1:],
                   "claude_env": sorted(k for k in os.environ
                                        if k.upper() in ("CLAUDECODE", "ANTHROPIC_API_KEY"))},
                  handle)


def out(**data):
    sys.stdout.buffer.write(json.dumps(data, ensure_ascii=False).encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()


out(type="system", subtype="init", session_id="abc-1", apiKeySource="none")
if os.environ.get("FAKE_CLAUDE_MODE") == "hang":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    with open(os.path.join(os.getcwd(), "grandchild.pid"), "w") as handle:
        handle.write(str(child.pid))
    time.sleep(120)
out(type="assistant", parent_tool_use_id=None,
    message={"content": [{"type": "text", "text": "reply with a line separator"}]})
out(type="result", subtype="success", is_error=False, result="done", session_id="abc-1")

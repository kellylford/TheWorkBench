"""A stand-in for `claude -p --input-format stream-json --output-format stream-json`,
for tests.

Reads stream-json lines from stdin as raw bytes until the user's message,
records what it got, and writes stream-json to stdout as raw UTF-8 (with a raw
U+2028 inside one string, as JSON writers leave it). FAKE_CLAUDE_MODE=hang
starts a grandchild process and waits, so a test can check that cancelling
kills the whole tree. FAKE_CLAUDE_MODE=ask sends a permission request and
waits for the answer, which goes in the result. After the result it waits for
stdin to close, as the real CLI does.
"""
import json
import os
import subprocess
import sys
import time

received = []
prompt = None
for raw in iter(sys.stdin.buffer.readline, b""):
    message = json.loads(raw.decode("utf-8"))
    received.append(message)
    if message.get("type") == "user":
        prompt = message["message"]["content"]
        break


def log(**extra):
    path = os.environ.get("FAKE_CLAUDE_LOG")
    if path:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"prompt": prompt, "args": sys.argv[1:],
                       "received": [m.get("type") for m in received],
                       "claude_env": sorted(k for k in os.environ
                                            if k.upper() in ("CLAUDECODE", "ANTHROPIC_API_KEY")),
                       **extra}, handle)


def out(**data):
    sys.stdout.buffer.write(json.dumps(data, ensure_ascii=False).encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()


log()
out(type="system", subtype="init", session_id="abc-1", apiKeySource="none")
mode = os.environ.get("FAKE_CLAUDE_MODE")
if mode == "hang":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    with open(os.path.join(os.getcwd(), "grandchild.pid"), "w") as handle:
        handle.write(str(child.pid))
    time.sleep(120)
result = "done"
if mode == "ask":
    out(type="control_request", request_id="req-1",
        request={"subtype": "can_use_tool", "tool_name": "Bash",
                 "input": {"command": "git push"}, "tool_use_id": "t1"})
    answer = json.loads(sys.stdin.buffer.readline().decode("utf-8"))
    log(answer=answer)
    result = answer["response"]["response"]["behavior"]
out(type="assistant", parent_tool_use_id=None,
    message={"content": [{"type": "text", "text": "reply with a line separator"}]})
out(type="result", subtype="success", is_error=False, result=result, session_id="abc-1")
sys.stdin.buffer.read()  # until TheClaudeHub closes stdin

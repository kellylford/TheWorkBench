import io
import json
import sys
import threading
from pathlib import Path

import pytest

from theclaudehub import claude_cli as cli
from theclaudehub import platform_paths
from theclaudehub.claude_cli import (ResumeRefused, StreamParser, TurnRunner,
                                     build_new_command, build_resume_command,
                                     check_resume_allowed, child_environment)

EXE = "C:\\bin\\claude.exe"
OWN = {"aaaa-1111"}
DESKTOP = {"dddd-2222"}
FLAGS = ["-p", "--output-format", "stream-json", "--verbose"]


# -- command construction --------------------------------------------------------


def test_new_command():
    command = build_new_command(EXE, "aaaa-1111", "  My   title ", "auto")
    assert command == [EXE, *FLAGS, "--permission-mode", "auto",
                       "--permission-prompts", "none",
                       "--session-id", "aaaa-1111", "--name", "My title"]


def test_new_command_without_title_and_other_modes():
    for mode in ("acceptEdits", "manual", "plan"):
        command = build_new_command(EXE, "aaaa-1111", "", mode)
        assert "--name" not in command
        assert command[command.index("--permission-mode") + 1] == mode


def test_old_default_mode_name_becomes_manual():
    command = build_resume_command(EXE, "aaaa-1111", "default", OWN, DESKTOP)
    assert command[command.index("--permission-mode") + 1] == "manual"


def test_never_bare_prompts_refused_and_prompt_not_on_command_line():
    for command in (build_new_command(EXE, "aaaa-1111", "t", "auto"),
                    build_resume_command(EXE, "aaaa-1111", "auto", OWN, DESKTOP)):
        assert "--bare" not in command
        assert "-p" in command
        assert command[command.index("--permission-prompts") + 1] == "none"


def test_unknown_permission_mode_refused():
    with pytest.raises(ValueError):
        build_new_command(EXE, "aaaa-1111", "t", "bypassPermissions")
    with pytest.raises(ValueError):
        build_resume_command(EXE, "aaaa-1111", "yolo", OWN, DESKTOP)


def test_new_command_rejects_bad_id():
    with pytest.raises(ValueError):
        build_new_command(EXE, "--resume", "t", "auto")


def test_resume_command_for_own_session():
    assert build_resume_command(EXE, "aaaa-1111", "plan", OWN, DESKTOP) == [
        EXE, *FLAGS, "--permission-mode", "plan", "--permission-prompts", "none",
        "--resume", "aaaa-1111"]


def test_model_goes_on_every_turn():
    new = build_new_command(EXE, "aaaa-1111", "t", "auto", "opus")
    resumed = build_resume_command(EXE, "aaaa-1111", "auto", OWN, DESKTOP, model="opus")
    for command in (new, resumed):
        assert command[command.index("--model") + 1] == "opus"
    # A full model name works too.
    command = build_resume_command(EXE, "aaaa-1111", "auto", OWN, DESKTOP,
                                   model="claude-opus-5-5")
    assert command[command.index("--model") + 1] == "claude-opus-5-5"


def test_default_model_passes_no_model_flag():
    assert "--model" not in build_new_command(EXE, "aaaa-1111", "t", "auto", "")
    assert "--model" not in build_resume_command(EXE, "aaaa-1111", "auto", OWN, DESKTOP)


@pytest.mark.parametrize("model", ["--dangerously-skip-permissions", "-x", "opus sonnet",
                                   "a;b", "x" * 101, "sonnet[1m]",
                                   "claude-opus-4-1@20250805",
                                   "us.anthropic.claude-opus-4-1-v1:0"])
def test_unsafe_model_name_refused(model):
    with pytest.raises(ValueError):
        build_new_command(EXE, "aaaa-1111", "t", "auto", model)


def test_model_labels():
    assert cli.model_label("") == "the default model"
    assert cli.model_label("opus") == "Opus"
    assert cli.model_label("claude-opus-5-5") == "claude-opus-5-5"
    assert [value for value, _label in cli.MODELS] == ["", "opus", "sonnet", "haiku"]
    # Fable can bill usage credits without asking in -p mode.
    assert "fable" not in cli.MODEL_LABELS


# -- the desktop --resume guard ------------------------------------------------------


def test_resume_refused_for_desktop_cli_id():
    with pytest.raises(ResumeRefused, match="desktop app"):
        build_resume_command(EXE, "dddd-2222", "auto", OWN | DESKTOP, DESKTOP)


def test_resume_refused_for_local_id_even_if_listed_as_own():
    with pytest.raises(ResumeRefused, match="desktop app session id"):
        build_resume_command(EXE, "local_abc", "auto", {"local_abc"}, set())


def test_resume_refused_for_unknown_session():
    with pytest.raises(ResumeRefused, match="only sends"):
        check_resume_allowed("eeee-3333", OWN, DESKTOP)


@pytest.mark.parametrize("bad", ["", "../x", "--print", "a b", None])
def test_resume_refused_for_malformed_ids(bad):
    with pytest.raises(ResumeRefused):
        check_resume_allowed(bad, OWN | {bad} if bad else OWN, DESKTOP)


# -- environment ---------------------------------------------------------------------


def test_child_environment_strips_session_and_billing_vars_only():
    env = child_environment({
        "PATH": "x", "USERPROFILE": "u",
        "ANTHROPIC_API_KEY": "secret", "ANTHROPIC_AUTH_TOKEN": "t",
        "ANTHROPIC_BASE_URL": "http://localhost", "CLAUDE_CODE_USE_BEDROCK": "1",
        "CLAUDECODE": "1", "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH": "1",
        "CLAUDE_CODE_SESSION_ID": "s", "CLAUDE_CODE_OAUTH_TOKEN": "o",
        "claude_code_entrypoint": "lower",
        # Families a host session sets, including names not in the list yet.
        "CLAUDE_CODE_SDK_FUTURE_THING": "1", "CLAUDE_CODE_HOST_PORT": "1",
        "claude_code_messaging_new": "1",
        "CLAUDE_CODE_GIT_BASH_PATH_EXTRA": "kept",
        # Chosen by the user: kept.
        "CLAUDE_CONFIG_DIR": "D:/c", "CLAUDE_CODE_GIT_BASH_PATH": "C:/Git/bash.exe",
        "HTTPS_PROXY": "http://proxy", "API_TIMEOUT_MS": "60000",
        "ANTHROPIC_MODEL": "opus",
    })
    assert env == {"PATH": "x", "USERPROFILE": "u", "CLAUDE_CONFIG_DIR": "D:/c",
                   "CLAUDE_CODE_GIT_BASH_PATH_EXTRA": "kept",
                   "CLAUDE_CODE_GIT_BASH_PATH": "C:/Git/bash.exe",
                   "HTTPS_PROXY": "http://proxy", "API_TIMEOUT_MS": "60000",
                   "ANTHROPIC_MODEL": "opus"}


# -- finding claude ----------------------------------------------------------------------


def test_find_claude_prefers_native_exe(tmp_path):
    lookup = platform_paths.find_claude(which=lambda n: "C:\\x\\claude.exe",
                                        native_candidates=[])
    assert lookup.path == "C:\\x\\claude.exe"


@pytest.mark.parametrize("script", ["C:\\npm\\claude.CMD", "C:\\npm\\claude.bat",
                                    "C:\\npm\\claude.ps1"])
def test_find_claude_refuses_scripts(script, tmp_path):
    lookup = platform_paths.find_claude(which=lambda n: script, native_candidates=[])
    assert lookup.path is None and "native" in lookup.problem
    native = tmp_path / "claude.exe"
    native.write_bytes(b"")
    lookup = platform_paths.find_claude(which=lambda n: script, native_candidates=[native])
    assert lookup.path == str(native)


def test_find_claude_missing():
    lookup = platform_paths.find_claude(which=lambda n: None, native_candidates=[])
    assert lookup.path is None and "wasn't found" in lookup.problem


# -- stream-json events ---------------------------------------------------------------


def ev(**data):
    return json.dumps(data)


def test_stream_parser_happy_path():
    parser = StreamParser()
    events = []
    for line in [
        ev(type="system", subtype="session_title_changed", title="t", session_id="s1"),
        ev(type="system", subtype="init", session_id="s1", apiKeySource="none",
           permissionMode="auto", tools=[]),
        ev(type="assistant", session_id="s1", parent_tool_use_id=None,
           message={"content": [{"type": "thinking", "thinking": ""}]}),
        ev(type="assistant", session_id="s1", parent_tool_use_id=None,
           message={"content": [{"type": "text", "text": "Working on it."}]}),
        ev(type="assistant", session_id="s1", parent_tool_use_id=None,
           message={"content": [{"type": "tool_use", "name": "Bash", "input": {}}]}),
        ev(type="assistant", session_id="s1", parent_tool_use_id="toolu_sub",
           message={"content": [{"type": "text", "text": "subagent chatter"}]}),
        ev(type="rate_limit_event", rate_limit_info={}),
        ev(type="result", subtype="success", is_error=False, result="pong",
           session_id="s1", permission_denials=[]),
    ]:
        events.extend(parser.feed(line))
    assert [(e.kind, e.text) for e in events] == [
        ("started", "auto"), ("text", "Working on it."), ("tool", "Bash"),
        ("finished", "pong")]
    assert parser.session_id == "s1" and parser.api_key_source == "none"
    assert not events[-1].is_error and parser.finished


def test_stream_parser_permission_denials():
    parser = StreamParser()
    denied = parser.feed(ev(type="system", subtype="permission_denied", tool_name="Write",
                            message="Claude requested permissions to write to x.txt"))
    assert denied[0].kind == "denied"
    assert denied[0].text == "Write: Claude requested permissions to write to x.txt"
    result = parser.feed(ev(type="result", subtype="success", is_error=False, result="Done",
                            permission_denials=[
                                {"tool_name": "Write", "tool_use_id": "t",
                                 "tool_input": {"file_path": "C:/x/probe.txt"}},
                                {"tool_name": "Bash", "tool_input": {"command": "rm -rf  /"}},
                                {"tool_name": "WebFetch"}, "junk"]))
    assert result[0].denials == ["Write was refused: C:/x/probe.txt",
                                 "Bash was refused: rm -rf /",
                                 "WebFetch was refused", "A tool was refused."]


def test_stream_parser_error_results():
    parser = StreamParser()
    err = parser.feed(ev(type="result", subtype="error_max_turns", is_error=True))[0]
    assert err.is_error and "error_max_turns" in err.text
    err2 = StreamParser().feed(ev(type="result", subtype="error_during_execution",
                                  errors=["boom", "bang"]))[0]
    assert err2.is_error and err2.text == "boom; bang"


def test_stream_parser_tolerates_garbage():
    parser = StreamParser()
    assert parser.feed("not json") == []
    assert parser.feed("[1]") == []
    assert parser.feed("") == []
    assert parser.feed(ev(type="assistant", message="odd")) == []
    assert parser.feed(ev(type="brand_new_event", x=1)) == []
    assert parser.bad_lines == 2


@pytest.mark.parametrize("source,problem", [
    ("none", False), (None, False), ("", False),
    ("ANTHROPIC_API_KEY", True), ("apiKeyHelper", True)])
def test_api_key_problem(source, problem):
    assert (cli.api_key_problem(source) is not None) is problem


# -- TurnRunner with a fake process -------------------------------------------------------


class FakeProcess:
    """Byte pipes, like the real Popen the runner makes."""

    def __init__(self, stdout_lines, returncode=0, stderr_lines=()):
        self.stdout = io.BytesIO("".join(x + "\n" for x in stdout_lines).encode("utf-8"))
        self.stderr = io.BytesIO("".join(x + "\n" for x in stderr_lines).encode("utf-8"))
        self.stdin = io.BytesIO()
        self.pid = None
        self.returncode = None
        self._final = returncode
        self.killed = False
        self.written = None
        original_close = self.stdin.close

        def close():
            self.written = self.stdin.getvalue()
            original_close()
        self.stdin.close = close

    def poll(self):
        return self.returncode

    def wait(self):
        self.returncode = -9 if self.killed else self._final
        return self.returncode

    def kill(self):
        self.killed = True


def run_turn(process, tmp_path, command=None, prompt="Hello -p --bare"):
    captured = {}
    events = []
    done = threading.Event()

    def popen(cmd, **kwargs):
        captured["cmd"] = cmd
        captured.update(kwargs)
        return process

    def on_event(event):
        events.append(event)
        if event.kind in ("finished", "failed"):
            done.set()

    runner = TurnRunner(command or ["claude", "-p"], str(tmp_path), prompt,
                        on_event, popen=popen, env={"PATH": "x"})
    runner.start()
    assert done.wait(5)
    runner.join(5)
    return runner, events, captured


def test_runner_sends_prompt_on_stdin_and_reports_events(tmp_path):
    process = FakeProcess([
        ev(type="system", subtype="init", session_id="s1", apiKeySource="none"),
        ev(type="assistant", message={"content": [{"type": "text", "text": "pong"}]}),
        ev(type="result", subtype="success", result="pong", session_id="s1"),
    ])
    runner, events, captured = run_turn(process, tmp_path)
    assert process.written == b"Hello -p --bare"
    assert captured["cwd"] == str(tmp_path)
    assert captured["env"] == {"PATH": "x"}
    assert "encoding" not in captured and "text" not in captured  # byte pipes
    assert [e.kind for e in events] == ["started", "text", "finished"]
    assert events[-1].session_id == "s1"
    assert runner.session_started


def test_runner_stops_when_an_api_key_would_be_billed(tmp_path):
    process = FakeProcess([
        ev(type="system", subtype="init", session_id="s1", apiKeySource="ANTHROPIC_API_KEY"),
        ev(type="assistant", message={"content": [{"type": "text", "text": "billed!"}]}),
        ev(type="result", subtype="success", result="billed!"),
    ])
    _runner, events, _ = run_turn(process, tmp_path)
    assert process.killed
    assert [e.kind for e in events] == ["failed"]
    assert "API key" in events[0].text


def test_runner_reports_exit_without_result(tmp_path):
    process = FakeProcess([], returncode=1, stderr_lines=["Error: not logged in"])
    runner, events, _ = run_turn(process, tmp_path)
    assert [e.kind for e in events] == ["failed"]
    assert "exit code 1" in events[0].text and "not logged in" in events[0].text
    assert not runner.session_started


def test_runner_missing_folder(tmp_path):
    events = []
    done = threading.Event()
    runner = TurnRunner(["claude"], str(tmp_path / "gone"), "hi",
                        lambda e: (events.append(e), done.set()),
                        popen=lambda *a, **k: pytest.fail("must not start"), env={})
    runner.start()
    assert done.wait(5)
    assert events[0].kind == "failed" and "doesn't exist" in events[0].text


def test_runner_claude_not_found(tmp_path):
    events = []
    done = threading.Event()

    def popen(*a, **k):
        raise FileNotFoundError("claude not found")
    runner = TurnRunner(["claude"], str(tmp_path), "hi",
                        lambda e: (events.append(e), done.set()), popen=popen, env={})
    runner.start()
    assert done.wait(5)
    assert events[0].kind == "failed"


def test_runner_cancel(tmp_path):
    process = FakeProcess([])
    runner = TurnRunner(["claude"], str(tmp_path), "hi", lambda e: None,
                        popen=lambda *a, **k: process, env={})
    runner._process = process
    runner.cancel()
    assert process.killed


def test_cancel_during_popen_kills_at_once(tmp_path):
    """cancel() landing while Popen is still starting the process."""
    process = FakeProcess([])
    events = []
    done = threading.Event()
    holder = {}

    def popen(*a, **k):
        holder["runner"].cancel()  # arrives mid-start, before _process is set
        return process
    runner = TurnRunner(["claude"], str(tmp_path), "hi",
                        lambda e: (events.append(e), done.set()), popen=popen, env={})
    holder["runner"] = runner
    runner.start()
    assert done.wait(5)
    assert process.killed
    assert events[-1].kind == "failed" and events[-1].text == "Stopped."


def test_cancel_before_start_never_launches(tmp_path):
    events = []
    done = threading.Event()
    runner = TurnRunner(["claude"], str(tmp_path), "hi",
                        lambda e: (events.append(e), done.set()),
                        popen=lambda *a, **k: pytest.fail("must not start"), env={})
    runner.cancel()
    runner.start()
    assert done.wait(5)
    assert events[0].text == "Stopped."


def test_runner_survives_a_broken_callback(tmp_path):
    process = FakeProcess([ev(type="result", subtype="success", result="ok")])
    calls = []

    def on_event(event):
        calls.append(event.kind)
        raise RuntimeError("UI bug")
    runner = TurnRunner(["claude"], str(tmp_path), "hi", on_event,
                        popen=lambda *a, **k: process, env={})
    runner.start()
    runner.join(5)
    assert calls == ["finished"]


def test_runner_tracks_activity_and_elapsed(tmp_path):
    times = iter([100.0, 165.0])
    process = FakeProcess([
        ev(type="system", subtype="init", session_id="s1", apiKeySource="none"),
        ev(type="assistant", message={"content": [{"type": "tool_use", "name": "Bash"}]}),
        ev(type="result", subtype="success", result="ok"),
    ])
    runner = TurnRunner(["claude"], str(tmp_path), "hi", lambda e: None,
                        popen=lambda *a, **k: process, env={}, clock=lambda: next(times))
    runner.start()
    runner.join(5)
    assert runner.session_started and runner.last_activity == "using Bash"
    assert runner.elapsed() == 65.0


@pytest.mark.parametrize("seconds,words", [
    (0, "0 seconds"), (1, "1 second"), (65, "1 minute 5 seconds"), (120, "2 minutes"),
    (3600, "1 hour"), (3725, "1 hour 2 minutes")])
def test_describe_elapsed(seconds, words):
    assert cli.describe_elapsed(seconds) == words


def test_permission_modes_offered():
    assert cli.PERMISSION_MODE_VALUES == ["auto", "acceptEdits", "manual", "plan"]
    assert cli.DEFAULT_PERMISSION_MODE == "auto"


# -- a real child process ---------------------------------------------------------------------

FAKE_CLAUDE = Path(__file__).with_name("fake_claude.py")


def wait_for_pid_file(path, timeout=20.0):
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return int(path.read_text().strip())
        except (OSError, ValueError):
            time.sleep(0.05)
    raise AssertionError(f"{path} never appeared")


def run_real(tmp_path, prompt, mode="normal", cancel_when_started=False):
    log = tmp_path / "fake.log"
    env = {**child_environment(), "FAKE_CLAUDE_LOG": str(log), "FAKE_CLAUDE_MODE": mode,
           "CLAUDECODE": "1"}
    env = child_environment(env)
    events = []
    done = threading.Event()

    def on_event(event):
        events.append(event)
        if event.kind in ("finished", "failed"):
            done.set()
    runner = TurnRunner([sys.executable, str(FAKE_CLAUDE), "--session-id", "abc-1"],
                        str(tmp_path), prompt, on_event, env=env)
    runner.start()
    if cancel_when_started:
        # Cancel only once the grandchild really exists.
        wait_for_pid_file(tmp_path / "grandchild.pid")
        runner.cancel()
    assert done.wait(30)
    runner.join(10)
    return events, (json.loads(log.read_text(encoding="utf-8")) if log.exists() else None)


def test_real_child_process_pipes_bytes_exactly(tmp_path):
    prompt = "line one\nline two \u2014 caf\u00e9 \u2028 end"
    events, seen = run_real(tmp_path, prompt)
    assert seen["prompt"] == prompt          # no CRLF, no mangled UTF-8
    assert seen["claude_env"] == []           # CLAUDECODE was stripped
    kinds = [e.kind for e in events]
    assert kinds == ["started", "text", "finished"]
    # The reply carries a raw U+2028 inside the JSON line; it must survive.
    assert events[1].text == "reply\u2028with a line separator"
    assert events[-1].text == "done"


def test_real_child_process_cancel_kills_the_tree(tmp_path):
    events, seen = run_real(tmp_path, "wait", mode="hang", cancel_when_started=True)
    assert events[-1].kind == "failed" and events[-1].text == "Stopped."
    grandchild = int((tmp_path / "grandchild.pid").read_text())
    import time
    deadline = time.time() + 5
    while platform_paths.pid_alive(grandchild) and time.time() < deadline:
        time.sleep(0.1)
    assert not platform_paths.pid_alive(grandchild)

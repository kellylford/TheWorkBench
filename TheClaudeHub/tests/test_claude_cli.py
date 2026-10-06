import io
import json
import threading

import pytest

from theclaudehub import claude_cli as cli
from theclaudehub.claude_cli import (ResumeRefused, StreamParser, TurnRunner,
                                     build_new_command, build_resume_command,
                                     check_resume_allowed, child_environment)

EXE = "C:\\bin\\claude.exe"
OWN = {"aaaa-1111"}
DESKTOP = {"dddd-2222"}


# -- command construction --------------------------------------------------------


def test_new_command():
    command = build_new_command(EXE, "aaaa-1111", "  My   title ", "auto")
    assert command == [EXE, "-p", "--output-format", "stream-json", "--verbose",
                       "--permission-mode", "auto", "--session-id", "aaaa-1111",
                       "--name", "My title"]


def test_new_command_without_title_and_other_modes():
    for mode in ("acceptEdits", "default", "plan"):
        command = build_new_command(EXE, "aaaa-1111", "", mode)
        assert "--name" not in command
        assert command[command.index("--permission-mode") + 1] == mode


def test_never_bare_and_prompt_not_on_command_line():
    for command in (build_new_command(EXE, "aaaa-1111", "t", "auto"),
                    build_resume_command(EXE, "aaaa-1111", "auto", OWN, DESKTOP)):
        assert "--bare" not in command
        assert "-p" in command


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
        EXE, "-p", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "plan", "--resume", "aaaa-1111"]


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


def test_child_environment_strips_claude_and_anthropic_vars():
    env = child_environment({
        "PATH": "x", "USERPROFILE": "u",
        "ANTHROPIC_API_KEY": "secret", "ANTHROPIC_BASE_URL": "http://localhost",
        "CLAUDECODE": "1", "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH": "1",
        "claude_code_entrypoint": "lower", "CLAUDE_CONFIG_DIR": "D:\\c",
    })
    assert env == {"PATH": "x", "USERPROFILE": "u", "CLAUDE_CONFIG_DIR": "D:\\c"}


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
                                 "tool_input": {"file_path": "C:\\x\\probe.txt"}},
                                {"tool_name": "Bash", "tool_input": {"command": "rm -rf  /"}},
                                {"tool_name": "WebFetch"}, "junk"]))
    assert result[0].denials == ["Write was refused: C:\\x\\probe.txt",
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
    def __init__(self, stdout_lines, returncode=0, stderr_lines=(), hang=False):
        self.stdout = io.StringIO("".join(l + "\n" for l in stdout_lines))
        self.stderr = io.StringIO("".join(l + "\n" for l in stderr_lines))
        self.stdin = io.StringIO()
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


def run_turn(process, tmp_path, command=None):
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

    runner = TurnRunner(command or ["claude", "-p"], str(tmp_path), "Hello -p --bare",
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
    _runner, events, captured = run_turn(process, tmp_path)
    assert process.written == "Hello -p --bare"
    assert captured["cwd"] == str(tmp_path)
    assert captured["env"] == {"PATH": "x"}
    assert captured["stdin"] is not None
    assert [e.kind for e in events] == ["started", "text", "finished"]
    assert events[-1].session_id == "s1"


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
    _runner, events, _ = run_turn(process, tmp_path)
    assert [e.kind for e in events] == ["failed"]
    assert "exit code 1" in events[0].text and "not logged in" in events[0].text


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


def test_permission_modes_offered():
    assert cli.PERMISSION_MODE_VALUES == ["auto", "acceptEdits", "default", "plan"]
    assert cli.DEFAULT_PERMISSION_MODE == "auto"

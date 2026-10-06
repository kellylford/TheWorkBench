"""The window's logic, exercised on a frame that is never shown.

No window appears on screen: the frame is created hidden and destroyed at the
end, and speech is replaced by a recorder. The real look and sound with JAWS
and NVDA is checked by hand (see the README).
"""
import json
import time

import pytest

wx = pytest.importorskip("wx")

from theclaudehub import hub, platform_paths, speech  # noqa: E402
from theclaudehub.claude_cli import TurnEvent  # noqa: E402
from theclaudehub.own_store import OwnSession, OwnSessionStore  # noqa: E402
from theclaudehub.sessions import NEEDS_YOU  # noqa: E402

from records import assistant_block, lines, text_block, tool_use_block, user_text  # noqa: E402


def now_ms():
    return int(time.time() * 1000)


@pytest.fixture(scope="module")
def app():
    instance = wx.App(False)
    yield instance


@pytest.fixture
def env(tmp_path, monkeypatch, app):
    desktop = tmp_path / "desktop"
    live = tmp_path / "live"
    projects = tmp_path / "projects"
    for folder in (desktop, live, projects):
        folder.mkdir()
    monkeypatch.setattr(platform_paths, "desktop_sessions_dir", lambda: desktop)
    monkeypatch.setattr(platform_paths, "live_sessions_dir", lambda: live)
    monkeypatch.setattr(platform_paths, "projects_dir", lambda: projects)
    monkeypatch.setattr(speech, "DEFAULT_SETTINGS_PATH", tmp_path / "speech.json")
    spoken = []
    feedback = []

    def speak(text, settings, interrupt=True):
        (spoken if interrupt else feedback).append(text)
    monkeypatch.setattr(speech.speaker, "speak", speak)
    from theclaudehub.ui import main_frame
    monkeypatch.setattr(main_frame, "list_speech_options", lambda: speech.default_options())
    opened = []
    monkeypatch.setattr(platform_paths, "open_url", lambda url: opened.append(url))
    boxes = []
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: boxes.append(a[0]) or wx.YES)
    return {"desktop": desktop, "projects": projects, "spoken": spoken,
            "feedback": feedback, "opened": opened, "boxes": boxes, "tmp": tmp_path,
            "live": live}


def add_desktop(env, local, cli, title, cwd="C:\\G\\Repo", ago=60_000, **extra):
    folder = env["desktop"] / local / "org"
    folder.mkdir(parents=True, exist_ok=True)
    data = {"sessionId": local, "cliSessionId": cli, "cwd": cwd, "title": title,
            "isArchived": False, "lastActivityAt": now_ms() - ago}
    data.update(extra)
    (folder / f"{local}.json").write_text(json.dumps(data), encoding="utf-8")


def add_transcript(env, cwd, cli, records):
    folder = env["projects"] / platform_paths.encode_cwd(cwd)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{cli}.jsonl"
    path.write_text("\n".join(lines(*records)) + "\n", encoding="utf-8")
    return path


def pump(condition, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        wx.GetApp().ProcessPendingEvents()
        wx.YieldIfNeeded()
        if condition():
            return True
        time.sleep(0.02)
    return False


def settle(frame):
    """Let any background list refresh land."""
    pump(lambda: not frame._snapshot_busy and frame._pending_refresh is None)


@pytest.fixture
def frame(env):
    from theclaudehub.ui.main_frame import MainFrame
    add_desktop(env, "local_a", "cli-a", "Quiet one")
    add_desktop(env, "local_b", "cli-b", "Blocked one",
                postTurnSummary={"status_category": "blocked", "needs_action": "Pick a name"})
    store = OwnSessionStore(env["tmp"] / "own.json")
    store.add(OwnSession("own-1", "Hub probe", "C:\\G\\Scratch", last_activity_ms=now_ms()))
    window = MainFrame(store=store)
    assert not window.IsShown()
    assert pump(lambda: window.session_list.GetCount() == 3)
    yield window
    window._runners.clear()
    window._list_timer.Stop()
    window._chat_timer.Stop()
    window._pool.shutdown(wait=True)
    window.Destroy()
    wx.GetApp().ProcessPendingEvents()


def select(frame, title):
    for i in range(frame.session_list.GetCount()):
        if frame.session_list.GetString(i).startswith(title):
            frame.session_list.SetSelection(i)
            return i
    raise AssertionError(f"{title} not in list")


class FakeRunner:
    instances = []

    def __init__(self, command, cwd, prompt, on_event):
        self.command, self.cwd, self.prompt, self.on_event = command, cwd, prompt, on_event
        self.session_started = False
        self.cancelled = False
        self.last_activity = "starting"
        FakeRunner.instances.append(self)

    def start(self):
        pass

    def elapsed(self):
        return 75.0

    def cancel(self):
        self.cancelled = True


@pytest.fixture
def fake_runner(monkeypatch):
    from theclaudehub.ui import main_frame
    FakeRunner.instances = []
    monkeypatch.setattr(main_frame, "TurnRunner", FakeRunner)
    monkeypatch.setattr(platform_paths, "find_claude",
                        lambda: platform_paths.ClaudeLookup("claude.exe"))
    return FakeRunner


# -- list ------------------------------------------------------------------------------


def test_list_order_and_lines(frame):
    items = list(frame.session_list.GetStrings())
    assert items[0].startswith("Blocked one, Repo, needs you: Pick a name")
    assert items[1].startswith("Hub probe, Scratch, idle")
    assert items[1].endswith("TheClaudeHub session")
    assert items[2].startswith("Quiet one, Repo, idle, active 1 minute ago")
    assert frame.session_list.GetSelection() == 0


def test_refresh_keeps_selection_on_same_session(frame, env):
    select(frame, "Quiet one")
    add_desktop(env, "local_c", "cli-c", "Newcomer",
                postTurnSummary={"status_category": "blocked"})
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    assert frame.session_list.GetStringSelection().startswith("Quiet one")


def test_focused_list_keeps_its_order_until_f5(frame, env, monkeypatch):
    monkeypatch.setattr(wx.Window, "FindFocus", staticmethod(lambda: frame.session_list))
    select(frame, "Quiet one")
    before = [s.split(",")[0] for s in frame.session_list.GetStrings()]
    # Quiet one now needs Kelly, which would sort it first.
    add_desktop(env, "local_a", "cli-a", "Quiet one",
                postTurnSummary={"status_category": "blocked", "needs_action": "Look"})
    add_desktop(env, "local_d", "cli-d", "Brand new")
    frame.refresh_sessions()
    assert pump(lambda: frame.session_list.GetCount() == 4)
    settle(frame)
    rows = [s.split(",")[0] for s in frame.session_list.GetStrings()]
    assert rows == before + ["Brand new"]           # nothing moved, new one at the end
    assert frame.session_list.GetStringSelection().startswith("Quiet one, Repo, needs you")
    frame.refresh_sessions(force=True, resort=True)  # F5
    assert pump(lambda: frame.session_list.GetString(0).startswith("Quiet one"))
    assert frame.session_list.GetStringSelection().startswith("Quiet one")


def test_focused_list_removes_vanished_rows_in_place(frame, env, monkeypatch):
    monkeypatch.setattr(wx.Window, "FindFocus", staticmethod(lambda: frame.session_list))
    index = select(frame, "Hub probe")
    frame.store.remove("own-1")
    frame.refresh_sessions()
    assert pump(lambda: frame.session_list.GetCount() == 2)
    assert frame.session_list.GetSelection() == min(index, 1)


# -- session view ----------------------------------------------------------------------


def test_open_desktop_session_shows_chat_and_read_only_reply(frame, env):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Please check the build"),
        assistant_block(text_block("It passes.\nAll green."), "m1"),
    ])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert frame.book.GetSelection() == 1
    assert pump(lambda: frame.chat_list.GetCount() == 2 and frame._chat_loaded)
    assert list(frame.chat_list.GetStrings()) == ["You: Please check the build",
                                                  "Claude: It passes."]
    assert frame.chat_list.GetSelection() == 1
    assert frame.message_text.GetValue() == "Claude:\nIt passes.\nAll green."
    assert not frame.own_reply.IsShown() and frame.desktop_reply.IsShown()
    # State and read-only are in the list's label, which is its accessible name.
    assert frame.messages_label.GetLabel() == "&Messages in Quiet one (idle, read-only):"
    assert frame.chat_list.GetName() == "Messages in Quiet one (idle, read-only)"
    assert env["feedback"][-1] == "2 messages."
    frame.on_send()  # must do nothing for a desktop session
    assert frame._runners == {}
    frame.on_open_in_claude()
    assert env["opened"] == ["claude://claude.ai/epitaxy/local_a"]
    assert env["feedback"][-1] == "Opened Quiet one in Claude."
    frame.show_list()
    assert frame.book.GetSelection() == 0
    assert frame.session_list.GetStringSelection().startswith("Quiet one")


def test_needs_you_state_is_in_the_label(frame):
    select(frame, "Blocked one")
    frame.on_open_session()
    assert "needs you: Pick a name, read-only" in frame.messages_label.GetLabel()


def test_new_message_in_open_session_is_announced(frame, env):
    path = add_transcript(env, "C:\\G\\Repo", "cli-a", [user_text("Go")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    frame.chat_list.SetSelection(0)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(assistant_block(text_block("Finished the job."), "m2")) + "\n")
    frame._refresh_chat()
    assert pump(lambda: frame.chat_list.GetCount() == 2)
    assert env["spoken"][-1] == "Quiet one replied. Finished the job."
    assert frame.chat_list.GetSelection() == 0  # the reader stays put


def test_live_refresh_does_not_move_the_caret_in_the_message_text(frame, env, monkeypatch):
    path = add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Go"), assistant_block(text_block("Line one\nLine two\nLine three"), "m1")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    frame.message_text.SetInsertionPoint(15)  # Kelly reading line two
    monkeypatch.setattr(wx.Window, "FindFocus", staticmethod(lambda: frame.message_text))
    # More of the same reply streams in (same message id)...
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(assistant_block(text_block("Line four"), "m1")) + "\n")
    frame._refresh_chat()
    assert pump(lambda: frame._chat_messages and "Line four" in frame._chat_messages[-1].text)
    assert frame.message_text.GetInsertionPoint() == 15
    # ...then an unrelated new message arrives.
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(user_text("Another")) + "\n")
    frame._refresh_chat()
    assert pump(lambda: frame.chat_list.GetCount() == 3)
    assert frame.message_text.GetInsertionPoint() == 15


def test_missing_transcript_says_so(frame):
    select(frame, "Blocked one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    assert frame.chat_list.GetString(0).startswith("No transcript")


def test_tool_activity_toggle_keeps_the_place(frame, env):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("q"),
        assistant_block(tool_use_block("Bash", {"command": "ls"}, "t1"), "m1"),
        assistant_block(text_block("done"), "m2"),
        user_text("thanks"),
    ])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    assert frame.chat_list.GetCount() == 3
    frame.chat_list.SetSelection(0)  # "You: q"
    frame._set_activity(True)
    assert list(frame.chat_list.GetStrings()) == ["You: q", "Tool: Bash: ls",
                                                  "Claude: done", "You: thanks"]
    assert frame.chat_list.GetStringSelection() == "You: q"
    assert env["feedback"][-1] == "Tool activity shown."
    frame.chat_list.SetSelection(1)  # on the tool call, then hide tools
    frame._set_activity(False)
    assert frame.chat_list.GetCount() == 3
    assert frame.chat_list.GetStringSelection() == "You: q"  # nearest before it


# -- own sessions ------------------------------------------------------------------------


def test_own_session_turn_finish_with_denials(frame, env):
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.own_reply.IsShown() and not frame.desktop_reply.IsShown()
    frame._runners["own-1"] = FakeRunner([], "", "", None)
    frame._denials["own-1"] = []
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent(
        "finished", text="I couldn't write the file.",
        denials=["Write was refused: C:/x/probe.txt"]))
    assert frame._runners == {}
    session = frame.store.get("own-1")
    assert session.state == NEEDS_YOU and session.detail == "1 tool was refused"
    assert not session.unread  # it was open
    assert env["spoken"][-1] == ("Hub probe replied. I couldn't write the file. 1 tool was "
                                 "refused: Write was refused: C:/x/probe.txt")
    assert frame.send_btn.IsEnabled()


def test_open_in_claude_refused_for_own_session(frame, env):
    select(frame, "Hub probe")
    frame.on_open_in_claude()
    assert env["opened"] == []
    assert "started by TheClaudeHub" in env["boxes"][0]


def test_send_speaks_confirmation_and_one_turn_at_a_time(frame, env, fake_runner):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("Next step please")
    frame.on_send()
    runner = fake_runner.instances[0]
    assert runner.command[-2:] == ["--resume", "own-1"]
    assert (runner.cwd, runner.prompt) == ("C:\\G\\Scratch", "Next step please")
    assert env["feedback"][-1] == "Sent. Hub probe is working."
    assert not frame.send_btn.IsEnabled()
    assert frame.turn_status.GetLabel() == "Claude is working (1 minute 15 seconds)."
    frame.reply_text.SetValue("again")
    frame.on_send()
    assert len(fake_runner.instances) == 1
    assert env["feedback"][-1] == "Claude is still working on the last message."
    frame.on_turn_status()
    assert env["feedback"][-1] == ("Hub probe: Claude has been working for 1 minute "
                                   "15 seconds, last starting.")


def test_send_refused_when_busy_elsewhere(frame, env, fake_runner, monkeypatch):
    (env["live"] / "4242.json").write_text(json.dumps(
        {"pid": 4242, "sessionId": "own-1", "status": "busy"}))
    original = hub.load_live_status
    monkeypatch.setattr(hub, "load_live_status",
                        lambda directory=None, alive=None: original(directory,
                                                                    alive=lambda pid: True))
    frame.refresh_sessions(force=True)
    assert pump(lambda: "own-1" in frame._snapshot.live)
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("hello")
    frame.on_send()
    assert fake_runner.instances == []
    assert "running somewhere else" in env["boxes"][-1]


def test_send_refused_for_a_desktop_id_even_in_own_store(frame, env, fake_runner):
    # A corrupted store claims a desktop session's id as its own.
    frame.store.add(OwnSession("cli-a", "Imposter", "C:\\G\\Repo", last_activity_ms=1))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Imposter")
    frame.on_open_session()
    frame.reply_text.SetValue("hello")
    frame.on_send()
    assert fake_runner.instances == []
    assert "desktop app" in env["boxes"][-1]
    assert frame.reply_text.GetValue() == "hello"  # nothing lost


def test_first_turn_failure_restores_message_and_starts_again(frame, env, fake_runner):
    frame.store.add(OwnSession("new-1", "Fresh", "C:\\G\\Scratch", started=False,
                               last_activity_ms=now_ms()))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Fresh")
    frame.on_open_session()
    frame.reply_text.SetValue("Build the thing")
    frame.on_send()
    first = fake_runner.instances[0]
    assert "--session-id" in first.command and "--resume" not in first.command
    assert frame.reply_text.GetValue() == ""
    # It fails before Claude ever created the session.
    frame._on_turn_event({"id": "new-1"}, "Fresh", TurnEvent(
        "failed", text="Claude exited (exit code 1). Not logged in.", is_error=True))
    assert frame.reply_text.GetValue() == "Build the thing"
    assert frame.send_btn.IsEnabled()
    frame.on_send()
    second = fake_runner.instances[1]
    assert "--session-id" in second.command and "--resume" not in second.command
    # This time it starts: the next send resumes.
    frame._on_turn_event({"id": "new-1"}, "Fresh", TurnEvent("started", session_id="new-1"))
    assert frame.store.get("new-1").started
    frame._on_turn_event({"id": "new-1"}, "Fresh", TurnEvent("finished", text="ok"))
    frame.reply_text.SetValue("more")
    frame.on_send()
    assert fake_runner.instances[2].command[-2:] == ["--resume", "new-1"]


def test_renamed_session_id_resets_the_reader(frame, env, fake_runner):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("go")
    frame.on_send()
    frame._reader = object()  # stand-in for a reader on the old id
    generation = frame._open_generation
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("started", session_id="own-9"))
    assert frame._reader is None and frame._open_generation == generation + 1
    assert frame._open.cli_session_id == "own-9" and "own-9" in frame._runners
    assert frame.store.get("own-9") is not None


def test_stop_cancels_and_stopped_turn_is_reported(frame, env, fake_runner):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("long job")
    frame.on_send()
    frame.on_stop()
    runner = fake_runner.instances[0]
    assert runner.cancelled
    assert env["feedback"][-1] == "Stopping."
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("failed", text="Stopped.", is_error=True))
    assert env["spoken"][-1] == "Hub probe: the turn failed. Stopped."
    assert frame.reply_text.GetValue() == ""  # Kelly stopped it: don't refill the box
    assert frame.send_btn.IsEnabled()


def test_close_during_turn_asks_and_stops(frame, env, fake_runner):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("long job")
    frame.on_send()
    event = wx.CloseEvent(wx.wxEVT_CLOSE_WINDOW)
    event.SetCanVeto(True)
    frame._on_close(event)
    assert "Quit anyway" in env["boxes"][-1]
    assert fake_runner.instances[0].cancelled


def test_store_write_failure_is_reported_and_send_state_still_updates(frame, env,
                                                                       monkeypatch):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame._runners["own-1"] = FakeRunner([], "", "", None)

    def broken(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(frame.store, "update", broken)
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="Done."))
    assert frame.send_btn.IsEnabled()
    assert any("disk full" in s for s in env["spoken"])


def test_reply_draft_stays_with_its_session(frame, env):
    frame.store.add(OwnSession("own-2", "Second", "C:\\G\\Two", last_activity_ms=now_ms() - 5))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("draft for one")
    frame.show_list()
    settle(frame)
    select(frame, "Second")
    frame.on_open_session()
    assert frame.reply_text.GetValue() == ""
    frame.show_list()
    settle(frame)
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.reply_text.GetValue() == "draft for one"
    frame.show_list()
    settle(frame)
    select(frame, "Quiet one")
    frame.on_open_session()
    assert frame.reply_text.GetValue() == ""


def test_silent_level_still_puts_the_reply_in_the_status_bar(frame, env):
    frame.speech.announce = speech.ANNOUNCE_SILENT
    frame._runners["own-1"] = FakeRunner([], "", "", None)
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("finished", text="All good. More text."))
    assert env["spoken"] == []
    assert frame.GetStatusBar().GetStatusText() == "Hub probe finished. All good."


# -- forget --------------------------------------------------------------------------------


def test_forget_keeps_the_place_and_desktop_delete_is_spoken(frame, env):
    select(frame, "Blocked one")
    frame.on_forget(None)
    assert env["boxes"] == []  # no modal for a desktop session
    assert "Only sessions TheClaudeHub started" in env["feedback"][-1]
    index = select(frame, "Hub probe")
    frame.on_forget(None)  # MessageBox stub answers Yes
    assert frame.store.get("own-1") is None
    assert frame.session_list.GetSelection() == index
    assert frame.session_list.GetStringSelection().startswith("Quiet one")
    assert env["feedback"][-1] == "Forgot Hub probe."

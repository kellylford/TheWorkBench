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
    monkeypatch.setattr(platform_paths, "desktop_sessions_dirs", lambda: [desktop])
    monkeypatch.setattr(platform_paths, "live_sessions_dir", lambda: live)
    monkeypatch.setattr(platform_paths, "projects_dir", lambda: projects)
    monkeypatch.setattr(speech, "DEFAULT_SETTINGS_PATH", tmp_path / "speech.json")
    spoken = []
    feedback = []

    def speak(text, settings, interrupt=True):
        (spoken if interrupt else feedback).append(text)
    monkeypatch.setattr(speech.speaker, "speak", speak)
    from theclaudehub.ui import dialogs, main_frame
    monkeypatch.setattr(main_frame, "list_speech_options", lambda: speech.default_options())
    # No real web page: it would open modal and wait. Tests that want the
    # formatted view put a fake in.
    monkeypatch.setattr(main_frame, "formatted_view_available", lambda: False)
    monkeypatch.setattr(dialogs, "formatted_view_available", lambda: False)
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
    window = MainFrame(store=store, check_updates_at_start=False)
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

    def respond(self, request_id, response):
        self.responses = getattr(self, "responses", []) + [(request_id, response)]
        return not getattr(self, "ended", False)


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


def tab_order(frame):
    """The focusable controls in Tab order, as the window would visit them."""
    order = []

    def walk(window):
        for child in window.GetChildren():
            if isinstance(child, wx.TopLevelWindow) or not child.IsShown():
                continue
            if isinstance(child, wx.Panel):
                walk(child)  # a container: its controls are the Tab stops
            elif child.AcceptsFocusFromKeyboard() and child.IsEnabled():
                order.append(child)
            else:
                walk(child)
    walk(frame)
    return order


def test_desktop_session_loads_in_the_same_window(frame, env):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Please check the build"),
        assistant_block(text_block("It passes.\nAll green."), "m1"),
    ])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame.chat_list.GetCount() == 2 and frame._chat_loaded)
    assert list(frame.chat_list.GetStrings()) == ["You: Please check the build",
                                                  "Claude: It passes."]
    assert frame.chat_list.GetSelection() == 1
    # The session list is still there, on the same session.
    assert frame.session_list.IsShown()
    assert frame.session_list.GetStringSelection().startswith("Quiet one")
    assert not frame.own_reply.IsShown() and frame.desktop_reply.IsShown()
    # State and read-only are in the list's label, which is its accessible name.
    assert frame.messages_label.GetLabel() == "&Messages in Quiet one (idle, read-only):"
    assert frame.chat_list.GetName() == "Messages in Quiet one (idle, read-only)"
    assert env["feedback"][-1] == "Loaded Quiet one, 2 messages."
    frame.on_send()  # must do nothing for a desktop session
    assert frame._runners == {}
    frame.on_open_in_claude()
    assert env["opened"] == ["claude://claude.ai/epitaxy/local_a"]
    assert env["feedback"][-1] == "Opened Quiet one in Claude."


def test_tab_order_own_session(frame):
    select(frame, "Hub probe")
    frame.on_open_session()
    order = tab_order(frame)
    assert order == [frame.session_list, frame.chat_list, frame.reply_text, frame.send_btn,
                     frame.stop_btn, frame.activity_check, frame.new_btn, frame.refresh_btn]
    frame._runners["own-1"] = FakeRunner([], "", "", None)
    frame._update_send_state()
    # Issue #175: a running turn doesn't move anything. Tab, Enter from the
    # reply box is Send, never Stop.
    assert tab_order(frame) == order


def test_tab_order_desktop_session_puts_the_note_where_the_reply_box_is(frame):
    select(frame, "Quiet one")
    frame.on_open_session()
    order = tab_order(frame)
    assert order == [frame.session_list, frame.chat_list, frame.desktop_note,
                     frame.reply_claude_btn, frame.continue_btn, frame.activity_check,
                     frame.new_btn, frame.refresh_btn]


def test_nothing_loaded_at_start(frame):
    assert frame._open is None
    assert frame.chat_list.GetString(0).startswith("No session loaded")
    assert not frame.own_reply.IsShown() and not frame.desktop_reply.IsShown()


def test_arrowing_the_session_list_does_not_load(frame):
    select(frame, "Quiet one")
    frame.session_list.SetSelection(0)
    wx.GetApp().ProcessPendingEvents()
    assert frame._open is None


def test_escape_and_ctrl_shortcuts_move_between_the_three_parts(frame, monkeypatch):
    select(frame, "Hub probe")
    frame.on_open_session()
    focused = []
    for name in ("session_list", "chat_list", "reply_text", "desktop_note"):
        control = getattr(frame, name)
        monkeypatch.setattr(control, "SetFocus",
                            lambda n=name: focused.append(n), raising=False)
    frame.focus_sessions()
    frame.focus_messages()
    frame.focus_reply()
    assert focused == ["session_list", "chat_list", "reply_text"]
    # Escape from the reply box goes to the session list, still on Hub probe.
    monkeypatch.setattr(wx.Window, "FindFocus", staticmethod(lambda: frame.reply_text))
    event = wx.KeyEvent(wx.wxEVT_CHAR_HOOK)
    event.SetKeyCode(wx.WXK_ESCAPE)
    frame._on_char_hook(event)
    assert focused[-1] == "session_list"
    assert frame.session_list.GetStringSelection().startswith("Hub probe")
    assert frame._open is not None  # still loaded


def test_enter_on_a_message_opens_its_full_text_and_returns_to_it(frame, env, monkeypatch):
    from theclaudehub.ui import main_frame
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("First"), assistant_block(text_block("Line one\nLine two"), "m1"),
        user_text("Third")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    frame.chat_list.SetSelection(1)
    shown = []

    class FakeMessageDialog:
        def __init__(self, parent, label, text):
            shown.append((label, text))

        def ShowModal(self):
            return wx.ID_CANCEL  # Escape

        def Destroy(self):
            pass
    monkeypatch.setattr(main_frame, "MessageDialog", FakeMessageDialog)
    monkeypatch.setattr(wx.Window, "FindFocus", staticmethod(lambda: frame.chat_list))
    event = wx.KeyEvent(wx.wxEVT_CHAR_HOOK)
    event.SetKeyCode(wx.WXK_RETURN)
    frame._on_char_hook(event)
    assert shown == [("Claude", "Line one\nLine two")]
    assert frame.chat_list.GetSelection() == 1  # same message


def test_message_dialog_is_a_labelled_read_only_rich_edit(frame):
    from theclaudehub.ui.dialogs import MessageDialog
    dialog = MessageDialog(frame, "Claude", "Line one\nLine two")
    try:
        assert dialog.text.GetValue() == "Line one\nLine two"
        assert not dialog.text.IsEditable()
        assert dialog.text.GetWindowStyle() & wx.TE_RICH2
        assert dialog.text.GetName() == "Claude said"
        assert dialog.GetEscapeId() == wx.ID_CANCEL
    finally:
        dialog.Destroy()


def test_live_refresh_keeps_the_selected_message(frame, env):
    path = add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Go"), assistant_block(text_block("Line one\nLine two"), "m1")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    frame.chat_list.SetSelection(0)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(assistant_block(text_block("Line three"), "m1")) + "\n")
        handle.write(json.dumps(user_text("Another")) + "\n")
    frame._refresh_chat()
    assert pump(lambda: frame.chat_list.GetCount() == 3)
    assert frame.chat_list.GetSelection() == 0


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
    assert env["feedback"][-1] == "Sent to Hub probe: Next step please."
    assert frame.send_btn.IsEnabled() and frame.stop_btn.IsEnabled()
    assert frame.turn_status.GetLabel() == "Claude is working (1 minute 15 seconds)."
    frame.reply_text.SetValue("again")
    frame.on_send()
    assert len(fake_runner.instances) == 1  # queued, not a second turn
    assert env["feedback"][-1] == "Queued for Hub probe: again."
    frame.on_turn_status()
    assert env["feedback"][-1] == ("Hub probe: Claude has been working for 1 minute "
                                   "15 seconds, last starting. A message is queued.")


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
                               last_activity_ms=now_ms(), model="sonnet"))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Fresh")
    frame.on_open_session()
    assert frame.chat_list.GetName() == "Messages in Fresh (idle, on Sonnet)"
    frame.reply_text.SetValue("Build the thing")
    frame.on_send()
    first = fake_runner.instances[0]
    assert "--session-id" in first.command and "--resume" not in first.command
    # Starting it again keeps the model too.
    assert first.command[first.command.index("--model") + 1] == "sonnet"
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
    frame.focus_sessions()
    settle(frame)
    select(frame, "Second")
    frame.on_open_session()
    assert frame.reply_text.GetValue() == ""
    frame.focus_sessions()
    settle(frame)
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.reply_text.GetValue() == "draft for one"
    frame.focus_sessions()
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


def test_new_session_view_says_claude_is_starting(frame, env, fake_runner, monkeypatch):
    from theclaudehub.ui import main_frame

    class FakeDialog:
        def __init__(self, parent, folder):
            pass

        def ShowModal(self):
            return wx.ID_OK

        def values(self):
            return ("C:/G/Brand", "Brand new work", "auto", "Start the thing", "opus")

        def Destroy(self):
            pass
    monkeypatch.setattr(main_frame, "NewSessionDialog", FakeDialog)
    frame.on_new_session()
    runner = fake_runner.instances[0]
    assert "--session-id" in runner.command and runner.prompt == "Start the thing"
    assert runner.command[runner.command.index("--model") + 1] == "opus"
    session_id = runner.command[runner.command.index("--session-id") + 1]
    assert frame.store.get(session_id).model == "opus"
    assert frame.session_heading.GetLabel().endswith("TheClaudeHub session on Opus.")
    # Read back first, then the new session's view is announced after it.
    assert env["feedback"][-2:] == [
        "Sent to Brand new work: Start the thing.",
        "Loaded Brand new work. No messages yet. Claude is starting this session."]
    assert frame._open is not None
    assert frame._open.title == "Brand new work"
    frame._refresh_chat()
    assert frame.chat_list.GetString(0) == "No messages yet. Claude is starting this session."
    assert not frame._chat_loaded          # keeps looking for the transcript
    assert frame.send_btn.IsEnabled()  # its first turn is running; Send would queue
    # Before the transcript exists, later ticks don't rewrite (and re-read) the list.
    frame.chat_list.SetSelection(0)
    frame._refresh_chat()
    assert frame.chat_list.GetSelection() == 0
    # The first turn fails before Claude creates the session.
    frame._on_turn_event({"id": runner.command[runner.command.index("--session-id") + 1]},
                         "Brand new work",
                         TurnEvent("failed", text="Not logged in.", is_error=True))
    frame._refresh_chat()
    assert frame.chat_list.GetString(0).startswith("No messages yet. The first message "
                                                   "didn't reach Claude")
    assert frame.reply_text.GetValue() == "Start the thing"


def test_focus_stays_in_the_reply_box_after_sending(frame, env, fake_runner, monkeypatch):
    select(frame, "Hub probe")
    frame.on_open_session()
    calls = []
    monkeypatch.setattr(frame.reply_text, "SetFocus", lambda: calls.append("reply"))
    frame.reply_text.SetValue("hello")
    frame.on_send()
    assert fake_runner.instances and calls[-1] == "reply"
    assert frame.reply_text.GetValue() == ""


def test_loading_another_session_announces_it(frame, env):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [user_text("Hi")])
    select(frame, "Blocked one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    assert env["feedback"][-1].startswith("Loaded Blocked one. No transcript")
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded and frame._open.title == "Quiet one")
    assert env["feedback"][-1] == "Loaded Quiet one, 1 message."


# -- review of PR #172 ---------------------------------------------------------------------


def test_enter_on_the_loaded_session_goes_back_without_reloading(frame, env, monkeypatch):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("One"), assistant_block(text_block("Two"), "m1"), user_text("Three")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    frame.chat_list.SetSelection(0)  # Kelly was reading the first message
    generation = frame._open_generation
    focused = []
    monkeypatch.setattr(frame.chat_list, "SetFocus", lambda: focused.append("messages"))
    frame.on_open_session()          # Enter on the same session again
    assert frame._open_generation == generation   # not reloaded
    assert frame.chat_list.GetSelection() == 0
    assert frame.chat_list.GetCount() == 3
    assert focused == ["messages"]
    assert env["feedback"][-1] == "Back in Quiet one."


def test_forgetting_the_loaded_session_moves_focus_to_the_session_list(frame, env,
                                                                       monkeypatch):
    select(frame, "Hub probe")
    frame.on_open_session()
    focused = []
    monkeypatch.setattr(frame.session_list, "SetFocus", lambda: focused.append("sessions"))
    frame.on_forget(None)            # MessageBox stub answers Yes
    assert frame._open is None
    assert not frame.own_reply.IsShown()
    assert focused == ["sessions"]


def test_message_menu_binds_on_the_menu_and_opens_at_the_message(frame, env, monkeypatch):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [user_text("Hello")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    read = []
    monkeypatch.setattr(frame, "on_read_message", lambda: read.append(True))
    menu = frame._message_menu()
    try:
        item = menu.FindItemByPosition(0)
        assert item.GetItemLabelText() == "Read Full Message"
        event = wx.CommandEvent(wx.wxEVT_MENU, item.GetId())
        menu.ProcessEvent(event)
        assert read == [True]
    finally:
        menu.Destroy()
    # Nothing was bound on the frame, so repeated menus don't pile up handlers.
    frame.ProcessEvent(wx.CommandEvent(wx.wxEVT_MENU, item.GetId()))
    assert read == [True]
    # Opened from the keyboard: at the selected message, not wherever the mouse is.
    keyboard = wx.ContextMenuEvent(wx.wxEVT_CONTEXT_MENU, frame.chat_list.GetId(),
                                   wx.DefaultPosition)
    point = frame._message_menu_position(keyboard)
    size = frame.chat_list.GetClientSize()
    assert 0 <= point.x <= max(size.width, 8) and 0 <= point.y <= max(size.height, 40)


def test_a_stale_load_starts_the_current_one_straight_away(frame, monkeypatch):
    select(frame, "Quiet one")
    frame.on_open_session()
    calls = []
    monkeypatch.setattr(frame, "_refresh_chat", lambda: calls.append(True))
    frame._apply_chat(frame._open_generation - 1, True, [], 0, None)
    assert calls == [True]


def test_a_turn_ending_in_an_unloaded_session_marks_it_and_leaves_the_loaded_one(
        frame, env, fake_runner, monkeypatch):
    frame.store.add(OwnSession("own-2", "Second", "C:\\G\\Two", started=False,
                               last_activity_ms=now_ms()))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    # Start a turn in Second, then load Hub probe and type there.
    select(frame, "Second")
    frame.on_open_session()
    frame.reply_text.SetValue("first message for Second")
    frame.on_send()
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("typing in Hub probe")
    refreshed = []
    monkeypatch.setattr(frame, "_refresh_chat", lambda: refreshed.append(True))
    # Second's first turn fails before reaching Claude.
    frame._on_turn_event({"id": "own-2"}, "Second",
                         TurnEvent("failed", text="Not logged in.", is_error=True))
    second = frame.store.get("own-2")
    assert second.unread and second.state == NEEDS_YOU
    assert frame._drafts["own-2"] == "first message for Second"   # kept for Second
    assert frame.reply_text.GetValue() == "typing in Hub probe"   # Hub probe untouched
    assert refreshed == []                                        # loaded chat not reloaded
    assert frame._open.title == "Hub probe"


# -- updates ---------------------------------------------------------------------------------


class FakeUpdates:
    def __init__(self, result, download_ok=True, apply_ok=True, during_download=None):
        self.result = result
        self.download_ok = download_ok
        self.apply_ok = apply_ok
        self.during_download = during_download
        self.calls = []

    def check(self, manual=True):
        self.calls.append("check" if manual else "quiet check")
        return self.result

    def download(self):
        self.calls.append("download")
        if self.during_download:
            wx.CallAfter(self.during_download)
            # Let the UI thread run it before the download "finishes".
            import time
            time.sleep(0.3)
        return self.download_ok

    def apply_and_restart(self):
        self.calls.append("apply")
        return self.apply_ok


def run_check(frame, manual=True):
    frame.check_for_updates(manual)
    assert pump(lambda: not frame._update_busy)


def test_manual_check_with_no_releases_says_so(frame, env):
    from theclaudehub.updater import NO_RELEASES, CheckResult
    frame.updates = FakeUpdates(CheckResult(NO_RELEASES, "0.1.0"))
    run_check(frame)
    assert env["spoken"][-1].startswith("No TheClaudeHub release has been published yet.")
    assert frame._last_announcement == env["spoken"][-1]    # Ctrl+Shift+R repeats it
    assert env["boxes"] == []


def test_manual_check_result_is_spoken_even_when_announcements_are_silent(frame, env):
    from theclaudehub.speech import ANNOUNCE_SILENT
    from theclaudehub.updater import FAILED, CheckResult
    frame.speech.announce = ANNOUNCE_SILENT
    frame.updates = FakeUpdates(CheckResult(FAILED, "0.1.0", detail="GitHub couldn't be reached"))
    run_check(frame)
    assert env["spoken"][-1].startswith("Couldn't check for updates: GitHub couldn't be reached")


def test_startup_check_is_quiet_unless_there_is_an_update(frame, env):
    from theclaudehub.updater import CURRENT, FAILED, NO_RELEASES, NOT_INSTALLED, CheckResult
    for status in (CURRENT, NO_RELEASES, NOT_INSTALLED, FAILED):
        frame.updates = FakeUpdates(CheckResult(status, "0.1.0", "0.1.0"))
        before = (list(env["feedback"]), list(env["spoken"]))
        run_check(frame, manual=False)
        assert (env["feedback"], env["spoken"]) == before
        assert frame.updates.calls == ["quiet check"]


def test_startup_check_announces_an_update_but_never_opens_a_dialog(frame, env):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    run_check(frame, manual=False)
    assert env["spoken"][-1] == ("TheClaudeHub 0.2.0 is available. You have 0.1.0. "
                                 "Help, Check for Updates installs it.")
    assert env["boxes"] == []
    assert frame.updates.calls == ["quiet check"]


def test_available_update_is_asked_about_with_no_as_the_default(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    asked = []
    monkeypatch.setattr(wx, "MessageBox",
                        lambda text, caption, style, *a, **k: asked.append((text, style)) or wx.NO)
    spoken_before = list(env["spoken"])
    run_check(frame)
    text, style = asked[-1]
    assert text.startswith("TheClaudeHub 0.2.0 is available. You have 0.1.0.")
    assert "Install it now?" in text and "sessions and settings are kept" in text
    assert style & wx.NO_DEFAULT
    assert env["spoken"] == spoken_before     # the dialog is read; nothing said over it
    assert frame.updates.calls == ["check"]   # No: nothing downloaded
    assert env["feedback"][-1].startswith("Not now.")


def test_yes_downloads_then_applies(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    run_check(frame)
    assert pump(lambda: frame.updates.calls == ["check", "download", "apply"])
    assert env["spoken"][-1] == "Installing TheClaudeHub 0.2.0 and restarting."


def test_failed_apply_restarts_the_timers_and_says_so(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"), apply_ok=False)
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    run_check(frame)
    assert pump(lambda: "apply" in frame.updates.calls and not frame._update_busy)
    assert env["spoken"][-1].startswith("Couldn't install the update.")
    assert frame._list_timer.IsRunning()


def test_unsent_text_is_warned_about(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue("half a thought")
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    asked = []
    monkeypatch.setattr(wx, "MessageBox", lambda text, *a, **k: asked.append(text) or wx.NO)
    run_check(frame)
    assert "haven't sent" in asked[-1]


def test_text_typed_during_the_download_is_asked_about_again(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"),
                                during_download=lambda: frame.reply_text.SetValue("typing"))
    asked = []

    def box(text, *a, **k):
        asked.append(text)
        return wx.YES if len(asked) == 1 else wx.NO
    monkeypatch.setattr(wx, "MessageBox", box)
    run_check(frame)
    assert pump(lambda: "download" in frame.updates.calls and not frame._update_busy)
    assert len(asked) == 2 and "Restart now to install it?" in asked[1]
    assert "apply" not in frame.updates.calls
    assert "installed the next time TheClaudeHub starts" in env["spoken"][-1]


def test_a_turn_started_during_the_download_postpones_the_install(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult

    def start_turn():
        frame._runners["own-1"] = FakeRunner([], "", "", None)
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"),
                                during_download=start_turn)
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    run_check(frame)
    assert pump(lambda: "download" in frame.updates.calls and not frame._update_busy)
    assert "apply" not in frame.updates.calls
    assert "installed the next time TheClaudeHub starts" in env["spoken"][-1]
    frame._runners.clear()


def test_a_turn_started_while_the_install_is_announced_postpones_it(frame, env, monkeypatch):
    from theclaudehub import speech
    from theclaudehub.updater import AVAILABLE, CheckResult
    busy = iter([True])

    def still_speaking():
        # The announcement is playing; Kelly sends a reply meanwhile.
        frame._runners["own-1"] = FakeRunner([], "", "", None)
        return next(busy, False)
    monkeypatch.setattr(speech.speaker, "busy", still_speaking)
    # pump() doesn't run wx timers; the 200 ms re-check runs straight away here.
    monkeypatch.setattr(wx, "CallLater", lambda ms, fn, *args: wx.CallAfter(fn, *args))
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    run_check(frame)
    assert pump(lambda: "installed the next time" in (env["spoken"] or [""])[-1])
    assert "apply" not in frame.updates.calls
    assert frame._list_timer.IsRunning()
    frame._runners.clear()


def test_no_update_is_applied_while_claude_is_working(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame._runners["own-1"] = FakeRunner([], "", "", None)
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"))
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: pytest.fail("must not ask"))
    spoken_before = len(env["spoken"])
    run_check(frame)
    assert frame.updates.calls == ["check"]
    assert "once Claude finishes" in env["spoken"][-1]
    assert len(env["spoken"]) == spoken_before + 1     # said once, not twice
    frame._runners.clear()


def test_failed_download_is_reported_and_nothing_applied(frame, env, monkeypatch):
    from theclaudehub.updater import AVAILABLE, CheckResult
    frame.updates = FakeUpdates(CheckResult(AVAILABLE, "0.1.0", "0.2.0"), download_ok=False)
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: wx.YES)
    run_check(frame)
    assert pump(lambda: "download" in frame.updates.calls and not frame._update_busy)
    assert "apply" not in frame.updates.calls
    assert env["spoken"][-1].startswith("Couldn't download TheClaudeHub 0.2.0.")

# -- queued messages (issue #175) -----------------------------------------------------------


def _start(frame, fake_runner, text="first"):
    select(frame, "Hub probe")
    frame.on_open_session()
    frame.reply_text.SetValue(text)
    frame.on_send()
    return fake_runner.instances[-1]


def test_send_during_a_turn_queues_and_goes_when_it_ends(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("second")
    frame.on_send()
    assert frame.reply_text.GetValue() == ""
    assert frame._queued == {"own-1": "second"}
    assert frame.turn_status.GetLabel().endswith("A message is queued.")
    frame.reply_text.SetValue("third")
    frame.on_send()
    assert env["feedback"][-1] == "Added to the queued message for Hub probe: third."
    assert len(fake_runner.instances) == 1
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="Done."))
    # The reply is announced first, then the queued message goes as one turn.
    assert env["spoken"][-1] == "Hub probe replied. Done."
    assert len(fake_runner.instances) == 2
    assert fake_runner.instances[1].prompt == "second\n\nthird"
    assert env["feedback"][-1] == "Sent your queued message. Hub probe is working."
    assert frame._queued == {}
    assert "own-1" in frame._runners
    assert env["boxes"] == []


def test_queued_message_goes_despite_the_lists_stale_busy_status(frame, env, fake_runner,
                                                                 monkeypatch):
    # During the turn, TheClaudeHub's own `claude -p` writes a busy pid file
    # for the session, and the list's snapshot keeps it up to 5 seconds after
    # the process has exited.
    _start(frame, fake_runner)
    (env["live"] / "4242.json").write_text(json.dumps(
        {"pid": 4242, "sessionId": "own-1", "status": "busy"}))
    claude_running = {"yes": True}
    original = hub.load_live_status
    monkeypatch.setattr(hub, "load_live_status",
                        lambda directory=None, alive=None: original(
                            directory, alive=lambda pid: claude_running["yes"]))
    frame.refresh_sessions(force=True)
    assert pump(lambda: "own-1" in frame._snapshot.live)
    frame.reply_text.SetValue("second")
    frame.on_send()
    claude_running["yes"] = False  # the turn's process has exited
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="Done."))
    assert "own-1" in frame._snapshot.live  # the snapshot is still stale
    assert env["boxes"] == []
    assert fake_runner.instances[-1].prompt == "second"


def test_stop_gives_the_queued_message_back(frame, env, fake_runner):
    runner = _start(frame, fake_runner)
    frame.reply_text.SetValue("queued words")
    frame.on_send()
    frame.reply_text.SetValue("half typed")
    frame.reply_text.SetInsertionPointEnd()
    frame.on_stop()
    assert runner.cancelled
    assert frame._queued == {}
    # In the order written, with the caret still where Kelly was typing.
    assert frame.reply_text.GetValue() == "queued words\n\nhalf typed"
    assert frame.reply_text.GetInsertionPoint() == frame.reply_text.GetLastPosition()
    assert env["feedback"][-1] == "Stopping. Your queued message is back in the message box."
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("failed", text="Stopped.", is_error=True))
    assert len(fake_runner.instances) == 1  # nothing sent after a stop


def test_send_while_stopping_keeps_the_text(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.on_stop()
    frame.reply_text.SetValue("do this instead")
    frame.on_send()
    assert frame._queued == {}
    assert frame.reply_text.GetValue() == "do this instead"
    assert env["feedback"][-1] == "Still stopping. Send again in a moment."
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("failed", text="Stopped.", is_error=True))
    frame.on_send()
    assert fake_runner.instances[-1].prompt == "do this instead"


def test_queued_message_is_not_sent_after_a_failed_turn(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("follow up")
    frame.on_send()
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("finished", text="API error", is_error=True))
    assert len(fake_runner.instances) == 1
    assert frame.reply_text.GetValue() == "follow up"
    assert env["feedback"][-1] == ("Your queued message for Hub probe wasn't sent: the turn "
                                   "before it failed. It's back in the message box.")


def test_queued_message_refused_at_send_time_is_spoken_and_goes_to_its_draft(
        frame, env, fake_runner, monkeypatch):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("later")
    frame.on_send()
    frame._drafts["own-1"] = "typed elsewhere"
    frame._open = None  # Kelly has moved on to another session
    monkeypatch.setattr(platform_paths, "find_claude",
                        lambda: platform_paths.ClaudeLookup(None, "Claude Code isn't installed."))
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="ok"))
    assert len(fake_runner.instances) == 1
    assert env["boxes"] == []  # no dialog he didn't ask for
    assert env["feedback"][-1] == ("Your queued message for Hub probe wasn't sent: Claude "
                                   "Code isn't installed. It's back in the message box.")
    assert frame._drafts["own-1"] == "later\n\ntyped elsewhere"
    assert frame._last_announcement == env["feedback"][-1]  # Ctrl+Shift+R repeats it


def test_queued_send_leaves_the_open_sessions_reply_box_alone(frame, env, fake_runner):
    frame.store.add(OwnSession("own-2", "Second", "C:\\G\\Two", last_activity_ms=now_ms() - 5))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    _start(frame, fake_runner)
    frame.reply_text.SetValue("queued")
    frame.on_send()
    frame.focus_sessions()
    settle(frame)
    select(frame, "Second")
    frame.on_open_session()
    frame.reply_text.SetValue("for second")
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="ok"))
    assert fake_runner.instances[-1].prompt == "queued"
    assert fake_runner.instances[-1].cwd == "C:\\G\\Scratch"
    assert frame.reply_text.GetValue() == "for second"


def test_failed_first_turn_gives_back_both_messages_in_order(frame, env, fake_runner):
    frame.store.add(OwnSession("new-1", "Fresh", "C:\\G\\Scratch", started=False,
                               last_activity_ms=now_ms()))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Fresh")
    frame.on_open_session()
    frame.reply_text.SetValue("first")
    frame.on_send()
    frame.reply_text.SetValue("queued")
    frame.on_send()
    frame.reply_text.SetValue("typing more")
    frame._on_turn_event({"id": "new-1"}, "Fresh", TurnEvent(
        "failed", text="Not logged in.", is_error=True))
    assert frame.reply_text.GetValue() == "first\n\nqueued\n\ntyping more"
    assert len(fake_runner.instances) == 1


def test_failed_first_turn_with_the_session_closed_keeps_its_draft(frame, env, fake_runner):
    frame.store.add(OwnSession("new-1", "Fresh", "C:\\G\\Scratch", started=False,
                               last_activity_ms=now_ms()))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    select(frame, "Fresh")
    frame.on_open_session()
    frame.reply_text.SetValue("first")
    frame.on_send()
    frame._open = None
    frame._drafts["new-1"] = "draft text"
    frame._on_turn_event({"id": "new-1"}, "Fresh", TurnEvent(
        "failed", text="Not logged in.", is_error=True))
    assert frame._drafts["new-1"] == "first\n\ndraft text"


def test_turn_status_mentions_a_queued_message(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("more")
    frame.on_send()
    frame.on_turn_status()
    assert env["feedback"][-1] == ("Hub probe: Claude has been working for 1 minute "
                                   "15 seconds, last starting. A message is queued.")


def test_queued_message_follows_a_renamed_session_id(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("next")
    frame.on_send()
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("started", session_id="own-9"))
    assert frame._queued == {"own-9": "next"}
    frame._on_turn_event({"id": "own-9"}, "Hub probe", TurnEvent("finished", text="ok"))
    assert fake_runner.instances[-1].prompt == "next"
    assert fake_runner.instances[-1].command[-2:] == ["--resume", "own-9"]


def test_stop_with_nothing_running_says_so(frame, env):
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.stop_btn.IsEnabled()
    frame.on_stop()
    assert env["feedback"][-1] == "Nothing is running."


def test_quit_prompt_mentions_queued_messages(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("pending")
    frame.on_send()
    event = wx.CloseEvent(wx.wxEVT_CLOSE_WINDOW)
    event.SetCanVeto(True)
    frame._on_close(event)
    assert "queued messages will not be sent" in env["boxes"][-1]


# -- reading your own messages back (issue #178) ------------------------------------------


def test_own_messages_not_read_back_when_turned_off(frame, env, fake_runner):
    frame.speech.announce_own = False
    _start(frame, fake_runner, "private words")
    assert env["feedback"][-1] == "Sent. Hub probe is working."
    frame.reply_text.SetValue("more private words")
    frame.on_send()
    assert env["feedback"][-1] == "Queued. It will be sent when Hub probe finishes."


def test_summary_level_reads_back_the_first_sentence(frame, env, fake_runner):
    frame.speech.announce = speech.ANNOUNCE_SUMMARY
    _start(frame, fake_runner, "Fix the build. Then run every test and report back.")
    assert env["feedback"][-1] == "Sent to Hub probe: Fix the build."


def test_silent_level_reads_nothing_back(frame, env, fake_runner):
    frame.speech.announce = speech.ANNOUNCE_SILENT
    _start(frame, fake_runner, "quiet please")
    assert env["feedback"] == []  # silent speaks no confirmations at all
    assert frame.GetStatusBar().GetStatusText() == "Sent. Hub probe is working."


def test_queued_message_is_read_once(frame, env, fake_runner):
    _start(frame, fake_runner)
    frame.reply_text.SetValue("the follow up")
    frame.on_send()
    assert env["feedback"][-1] == "Queued for Hub probe: the follow up."
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="ok"))
    assert env["feedback"][-1] == "Sent your queued message. Hub probe is working."
    assert sum("the follow up" in f for f in env["feedback"]) == 1


def test_settings_dialog_has_the_read_back_checkbox(frame):
    from theclaudehub.ui.dialogs import SettingsDialog
    settings = speech.SpeechSettings(announce_own=False)
    dialog = SettingsDialog(frame, settings, speech.default_options())
    try:
        box = dialog.own_messages
        assert box.GetLabel() == "Read your own &messages back when they're sent"
        assert not box.GetValue() and not dialog.get_settings().announce_own
        box.SetValue(True)
        assert dialog.get_settings().announce_own
    finally:
        dialog.Destroy()


# -- choosing the model (issue #180) --------------------------------------------------------


def test_a_later_turn_keeps_the_sessions_model(frame, env, fake_runner):
    frame.store.update("own-1", model="sonnet")
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.session_heading.GetLabel().endswith("TheClaudeHub session on Sonnet.")
    frame.reply_text.SetValue("next")
    frame.on_send()
    command = fake_runner.instances[-1].command
    assert command[-2:] == ["--resume", "own-1"]
    assert command[command.index("--model") + 1] == "sonnet"


def test_an_old_session_without_a_model_uses_the_default(frame, env, fake_runner):
    select(frame, "Hub probe")
    frame.on_open_session()
    assert frame.session_heading.GetLabel().endswith("TheClaudeHub session on the default model.")
    frame.reply_text.SetValue("next")
    frame.on_send()
    assert "--model" not in fake_runner.instances[-1].command


def test_new_session_dialog_offers_the_models(frame):
    from theclaudehub.ui.dialogs import NewSessionDialog
    dialog = NewSessionDialog(frame, "C:\\G")
    try:
        assert dialog.model.GetStringSelection() == "Default (your Claude Code setting)"
        assert dialog.model.GetCount() == 4
        assert "Fable" not in dialog.model.GetStrings()
        dialog.message.SetValue("hello")
        assert dialog.values()[4] == ""
        dialog.model.SetStringSelection("Opus")
        assert dialog.values()[4] == "opus"
        # Its label (and Alt+D) comes right before it, after Title.
        labels = [c for c in dialog.GetChildren() if isinstance(c, wx.StaticText)]
        assert "Mo&del:" in [c.GetLabel() for c in labels]
        order = list(dialog.GetChildren())
        assert order.index(dialog.title_text) < order.index(dialog.model) < \
            order.index(dialog.mode)
    finally:
        dialog.Destroy()


# -- answering Claude (#187, #188) ------------------------------------------------------


def _request(request_id="r1", tool="Bash", tool_input=None, suggestions=None):
    from theclaudehub.claude_cli import PermissionRequest
    return PermissionRequest(request_id, tool, tool_input or {"command": "git push"},
                             suggestions=suggestions or [])


def _waiting_turn(frame, *requests):
    select(frame, "Hub probe")
    frame.on_open_session()
    runner = FakeRunner([], "", "", None)
    frame._runners["own-1"] = runner
    for request in requests:
        frame._on_turn_event({"id": "own-1"}, "Hub probe",
                             TurnEvent("permission", text=request.summary(), request=request))
    return runner


def test_permission_request_is_announced_and_the_session_needs_you(frame, env):
    _waiting_turn(frame, _request())
    assert env["spoken"][-1] == ("Hub probe needs you. Claude wants to run git push. "
                                 "Ctrl+Shift+A answers.")
    assert frame.turn_status.GetLabel() == ("Waiting for you: Claude wants to run git push. "
                                            "Ctrl+Shift+A answers.")
    settle(frame)
    row = [s for s in frame.session_list.GetStrings() if s.startswith("Hub probe")][0]
    assert "needs you: Claude wants to run git push" in row
    frame.on_turn_status()
    assert env["feedback"][-1].startswith("Hub probe is waiting for you: Claude wants to run")


def test_answering_sends_the_response_and_announces_the_next(frame, env, monkeypatch):
    from theclaudehub.claude_cli import allow_response
    first, second = _request("r1"), _request("r2", tool_input={"command": "git tag v1"})
    runner = _waiting_turn(frame, first, second)
    monkeypatch.setattr(frame, "_ask", lambda title, request, own: (
        allow_response(request), "Allowed.", {}))
    frame.on_answer()
    assert runner.responses == [("r1", {"behavior": "allow", "updatedInput": first.input})]
    assert env["feedback"][-1] == ("Allowed. Next: Claude wants to run git tag v1. "
                                   "Ctrl+Shift+A answers.")
    frame.on_answer()
    assert [r[0] for r in runner.responses] == ["r1", "r2"]
    assert frame._pending["own-1"] == []
    frame.on_answer()
    assert env["feedback"][-1] == "Claude isn't waiting for an answer."


def test_answer_later_leaves_it_waiting(frame, env, monkeypatch):
    runner = _waiting_turn(frame, _request())
    monkeypatch.setattr(frame, "_ask", lambda *a: None)
    frame.on_answer()
    assert not hasattr(runner, "responses")
    assert len(frame._pending["own-1"]) == 1
    assert "still waiting" in env["feedback"][-1]


def test_allow_for_session_keeps_the_rule_for_later_turns(frame, env, fake_runner, monkeypatch):
    from theclaudehub.ui import dialogs
    request = _request(suggestions=[{"type": "addRules", "behavior": "allow",
                                     "destination": "localSettings",
                                     "rules": [{"toolName": "Bash",
                                                "ruleContent": "git push:*"}]}])
    runner = _waiting_turn(frame, request)

    class Picks(dialogs.PermissionDialog):
        def ShowModal(self):
            self.choice = dialogs.ALLOW_SESSION
            return wx.ID_OK
    monkeypatch.setattr("theclaudehub.ui.main_frame.PermissionDialog", Picks)
    frame.on_answer()
    response = runner.responses[0][1]
    assert response["updatedPermissions"][0]["destination"] == "session"
    assert frame.store.get("own-1").allowed_tools == ["Bash(git push:*)"]
    # The turn ends; the next one is given the rule.
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("finished", text="Pushed."))
    frame.reply_text.SetValue("and tag it")
    frame.on_send()
    command = fake_runner.instances[-1].command
    assert command[command.index("--allowedTools") + 1] == "Bash(git push:*)"


def test_plan_approval_keeps_the_new_mode(frame, env, monkeypatch):
    from theclaudehub.ui import dialogs
    frame.store.update("own-1", permission_mode="plan")
    runner = _waiting_turn(frame, _request("p1", "ExitPlanMode", {"plan": "# Plan\n1. Go"}))
    assert "plan is ready" in env["spoken"][-1]

    class Approves(dialogs.PlanDialog):
        def ShowModal(self):
            assert self.plan_text.GetValue() == "# Plan\n1. Go"
            assert self.mode.GetStringSelection().startswith("Accept edits")
            self.approved = True
            return wx.ID_OK
    monkeypatch.setattr("theclaudehub.ui.main_frame.PlanDialog", Approves)
    frame.on_answer()
    assert runner.responses[0][1]["updatedPermissions"] == [
        {"type": "setMode", "mode": "acceptEdits", "destination": "session"}]
    assert frame.store.get("own-1").permission_mode == "acceptEdits"
    assert env["feedback"][-1] == "Plan approved. Claude is carrying on in accept edits mode."


def test_question_answers_go_back_to_claude(frame, env, monkeypatch):
    from theclaudehub.ui import dialogs
    questions = [{"question": "Which color?", "header": "Color",
                  "options": [{"label": "Red", "description": "Warm"}, {"label": "Blue"}]},
                 {"question": "Which toppings?", "multiSelect": True,
                  "options": [{"label": "Cheese"}, {"label": "Olives"}]}]
    request = _request("q1", "AskUserQuestion", {"questions": questions})
    runner = _waiting_turn(frame, request)

    class Answers(dialogs.QuestionDialog):
        def ShowModal(self):
            color, toppings = self._controls
            assert [c.GetLabel() for c in color[1]] == ["Red: Warm", "Blue",
                                                        "Other (type below)"]
            color[1][1].SetValue(True)
            toppings[1][0].SetValue(True)
            toppings[2].SetValue("anchovies")  # typing ticks Other
            assert toppings[1][2].GetValue()
            return wx.ID_OK
    monkeypatch.setattr("theclaudehub.ui.main_frame.QuestionDialog", Answers)
    frame.on_answer()
    sent = runner.responses[0][1]
    assert sent["updatedInput"]["answers"] == {"Which color?": "Blue",
                                               "Which toppings?": "Cheese, anchovies"}
    assert env["feedback"][-1] == "Answer sent."


def test_turn_end_clears_waiting_and_a_late_answer_says_so(frame, env, monkeypatch):
    from theclaudehub.claude_cli import allow_response
    runner = _waiting_turn(frame, _request())
    request = frame._pending["own-1"][0]
    frame._on_turn_event({"id": "own-1"}, "Hub probe", TurnEvent("failed", text="Stopped.",
                                                                 is_error=True))
    assert "own-1" not in frame._pending
    runner.ended = True
    frame._runners["own-1"] = runner
    frame._apply_answer("own-1", request, allow_response(request), "Allowed.", {})
    assert env["feedback"][-1] == "That isn't waiting any more: the turn has ended."


def test_permission_dialog_buttons(frame):
    from theclaudehub.ui.dialogs import PermissionDialog
    plain = PermissionDialog(frame, "Hub probe", _request(tool="WebFetch",
                                                          tool_input={"url": "https://x"}))
    try:
        assert plain.session_button is None
        assert plain.request_text.GetValue().startswith("Claude wants to fetch https://x.")
        default = plain.GetDefaultItem()
        assert default.GetLabel() == "&Deny"
    finally:
        plain.Destroy()
    with_rule = PermissionDialog(frame, "Hub probe", _request(suggestions=[
        {"type": "addRules", "behavior": "allow",
         "rules": [{"toolName": "Bash", "ruleContent": "git push:*"}]}]))
    try:
        assert with_rule.session_button.GetName() == (
            "Allow, and don't ask again this session for Bash(git push:*)")
    finally:
        with_rule.Destroy()


# -- Continue Here (#189) ------------------------------------------------------------------


def _continue(frame, env, monkeypatch, message="Carry on from here"):
    from theclaudehub.ui import dialogs
    seen = {}

    class Fills(dialogs.NewSessionDialog):
        def ShowModal(self):
            seen["title"] = self.GetTitle()
            seen["folder_editable"] = self.folder.IsEditable()
            seen["name"] = self.title_text.GetValue()
            self.message.SetValue(message)
            return wx.ID_OK
    monkeypatch.setattr("theclaudehub.ui.main_frame.NewSessionDialog", Fills)
    frame.on_continue_here()
    return seen


def test_continue_here_forks_a_desktop_session(frame, env, fake_runner, monkeypatch):
    folder = env["tmp"] / "repo"
    folder.mkdir()
    add_desktop(env, "local_c", "cli-c", "Desktop work", cwd=str(folder))
    add_transcript(env, str(folder), "cli-c", [user_text("Earlier question")])
    frame.refresh_sessions(force=True, resort=True)
    settle(frame)
    select(frame, "Desktop work")
    frame.on_open_session()
    assert frame.continue_btn.IsShown()
    seen = _continue(frame, env, monkeypatch)
    assert seen == {"title": "Continue Here: Desktop work", "folder_editable": False,
                    "name": "Desktop work (continued)"}
    runner = fake_runner.instances[-1]
    command = runner.command
    assert command[command.index("--resume") + 1] == "cli-c"
    assert "--fork-session" in command
    new_id = command[command.index("--session-id") + 1]
    assert new_id != "cli-c"
    assert runner.cwd == str(folder) and runner.prompt == "Carry on from here"
    own = frame.store.get(new_id)
    assert own.fork_source == "cli-c" and own.forked_from == "Desktop work"
    assert frame._open.cli_session_id == new_id
    assert frame.session_heading.GetLabel().endswith(", continued from Desktop work.")
    # If that first turn never got going, Send copies the session again.
    frame._on_turn_event({"id": new_id}, "Desktop work (continued)",
                         TurnEvent("failed", text="not signed in", is_error=True))
    frame.reply_text.SetValue("again")
    frame.on_send()
    again = fake_runner.instances[-1].command
    assert again[again.index("--resume") + 1] == "cli-c" and "--fork-session" in again
    assert again[again.index("--session-id") + 1] == new_id


def test_continue_here_needs_a_transcript_and_a_desktop_session(frame, env, fake_runner,
                                                                monkeypatch):
    select(frame, "Quiet one")  # no transcript on disk
    frame.on_continue_here()
    assert "no longer on disk" in env["boxes"][-1]
    select(frame, "Hub probe")
    frame.on_continue_here()
    assert env["feedback"][-1] == ("Hub probe is already a TheClaudeHub session; "
                                   "reply to it here.")
    assert fake_runner.instances == []


# -- full messages as a formatted page (#190) ----------------------------------------------


def _load_reply(frame, env, text):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Show me"), assistant_block(text_block(text), "m1")])
    select(frame, "Quiet one")
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded and frame.chat_list.GetCount() == 2)


def _fake_viewer(monkeypatch, result):
    from theclaudehub.ui import main_frame
    shown = []

    class FakeViewer:
        def __init__(self, parent, title, page):
            shown.append((title, page))

        def ShowModal(self):
            return result

        def Destroy(self):
            pass
    monkeypatch.setattr(main_frame, "formatted_view_available", lambda: True)
    monkeypatch.setattr(main_frame, "FormattedMessageDialog", FakeViewer)
    return shown


def test_full_message_opens_as_a_formatted_page(frame, env, monkeypatch):
    _load_reply(frame, env, "## Result\n\n| a | b |\n|---|---|\n| 1 | 2 |")
    shown = _fake_viewer(monkeypatch, wx.ID_CANCEL)
    plain = []
    monkeypatch.setattr("theclaudehub.ui.main_frame.MessageDialog",
                        lambda *a: plain.append(a) or pytest.fail("plain text opened"))
    frame.on_read_message()
    title, page = shown[0]
    assert title == "Message from Claude"
    assert "<h2>Result</h2>" in page and "<th>a</th>" in page and "<td>2</td>" in page


def test_read_as_plain_text_and_the_setting_open_the_text_box(frame, env, monkeypatch):
    from theclaudehub.ui.dialogs import ID_PLAIN_TEXT, MessageDialog
    _load_reply(frame, env, "## Result")
    shown = _fake_viewer(monkeypatch, ID_PLAIN_TEXT)
    opened = []

    class Plain(MessageDialog):
        def ShowModal(self):
            opened.append(self.text.GetValue())
            return wx.ID_CANCEL
    monkeypatch.setattr("theclaudehub.ui.main_frame.MessageDialog", Plain)
    frame.on_read_message()
    assert len(shown) == 1 and opened == ["## Result"]
    frame.speech.formatted_messages = False
    frame.on_read_message()
    assert len(shown) == 1 and len(opened) == 2  # straight to the text box


def test_settings_dialog_has_the_formatted_page_choice(frame):
    from theclaudehub.ui.dialogs import SettingsDialog
    dialog = SettingsDialog(frame, speech.SpeechSettings(formatted_messages=False),
                            speech.default_options())
    try:
        assert not dialog.formatted.GetValue()
        dialog.formatted.SetValue(True)
        assert dialog.get_settings().formatted_messages
    finally:
        dialog.Destroy()

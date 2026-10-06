"""The window's logic, exercised on a frame that is never shown.

No window appears on screen: the frame is created hidden and destroyed at the
end, and speech is replaced by a recorder. The real look and sound with JAWS
and NVDA is checked by hand (see the README).
"""
import json
import time

import pytest

wx = pytest.importorskip("wx")

from theclaudehub import platform_paths, speech  # noqa: E402
from theclaudehub.claude_cli import TurnEvent  # noqa: E402
from theclaudehub.own_store import OwnSession, OwnSessionStore  # noqa: E402
from theclaudehub.sessions import NEEDS_YOU  # noqa: E402

from records import assistant_block, lines, text_block, user_text  # noqa: E402

NOW = int(time.time() * 1000)


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
    monkeypatch.setattr(speech.speaker, "speak", lambda text, settings: spoken.append(text))
    from theclaudehub.ui import main_frame
    monkeypatch.setattr(main_frame, "list_speech_options", lambda: speech.default_options())
    opened = []
    monkeypatch.setattr(platform_paths, "open_url", lambda url: opened.append(url))
    return {"desktop": desktop, "projects": projects, "spoken": spoken, "opened": opened,
            "tmp": tmp_path}


def add_desktop(env, local, cli, title, cwd="C:\\G\\Repo", **extra):
    folder = env["desktop"] / local / "org"
    folder.mkdir(parents=True)
    data = {"sessionId": local, "cliSessionId": cli, "cwd": cwd, "title": title,
            "isArchived": False, "lastActivityAt": NOW - 60_000}
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


@pytest.fixture
def frame(env):
    from theclaudehub.ui.main_frame import MainFrame
    add_desktop(env, "local_a", "cli-a", "Quiet one")
    add_desktop(env, "local_b", "cli-b", "Blocked one",
                postTurnSummary={"status_category": "blocked", "needs_action": "Pick a name"})
    store = OwnSessionStore(env["tmp"] / "own.json")
    store.add(OwnSession("own-1", "Hub probe", "C:\\G\\Scratch", last_activity_ms=NOW))
    window = MainFrame(store=store)
    assert not window.IsShown()
    assert pump(lambda: window.session_list.GetCount() == 3)
    yield window
    window._list_timer.Stop()
    window._chat_timer.Stop()
    window._pool.shutdown(wait=True)
    window.Destroy()
    wx.GetApp().ProcessPendingEvents()


def test_list_order_and_lines(frame):
    items = list(frame.session_list.GetStrings())
    assert items[0].startswith("Blocked one, Repo, needs you: Pick a name")
    assert items[1].startswith("Hub probe, Scratch, idle")
    assert items[1].endswith("TheClaudeHub session")
    assert items[2].startswith("Quiet one, Repo, idle, active 1 minute ago")
    assert frame.session_list.GetSelection() == 0


def test_refresh_keeps_selection_on_same_session(frame, env):
    frame.session_list.SetSelection(2)  # Quiet one
    add_desktop(env, "local_c", "cli-c", "Newcomer",
                postTurnSummary={"status_category": "blocked"})
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    assert frame.session_list.GetStringSelection().startswith("Quiet one")


def test_open_desktop_session_shows_chat_and_read_only_reply(frame, env):
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("Please check the build"),
        assistant_block(text_block("It passes.\nAll green."), "m1"),
    ])
    frame.session_list.SetSelection(2)
    frame.on_open_session()
    assert frame.book.GetSelection() == 1
    assert pump(lambda: frame.chat_list.GetCount() == 2 and frame._chat_loaded)
    assert list(frame.chat_list.GetStrings()) == ["You: Please check the build",
                                                  "Claude: It passes."]
    assert frame.chat_list.GetSelection() == 1
    assert frame.message_text.GetValue() == "Claude:\nIt passes.\nAll green."
    assert not frame.own_reply.IsShown() and frame.desktop_reply.IsShown()
    frame.on_send()  # must do nothing for a desktop session
    assert frame._runners == {}
    frame.on_open_in_claude()
    assert env["opened"] == ["claude://claude.ai/epitaxy/local_a"]
    frame.show_list()
    assert frame.book.GetSelection() == 0
    assert frame.session_list.GetStringSelection().startswith("Quiet one")


def test_new_message_in_open_session_is_announced(frame, env):
    path = add_transcript(env, "C:\\G\\Repo", "cli-a", [user_text("Go")])
    frame.session_list.SetSelection(2)
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
    frame.session_list.SetSelection(0)
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    assert frame.chat_list.GetString(0).startswith("No transcript")


def test_tool_activity_toggle(frame, env):
    from records import tool_use_block
    add_transcript(env, "C:\\G\\Repo", "cli-a", [
        user_text("q"),
        assistant_block(tool_use_block("Bash", {"command": "ls"}, "t1"), "m1"),
        assistant_block(text_block("done"), "m2"),
    ])
    frame.session_list.SetSelection(2)
    frame.on_open_session()
    assert pump(lambda: frame._chat_loaded)
    assert frame.chat_list.GetCount() == 2
    frame._set_activity(True)
    assert list(frame.chat_list.GetStrings()) == ["You: q", "Tool: Bash: ls", "Claude: done"]
    assert frame.chat_list.GetStringSelection() == "Claude: done"
    frame._set_activity(False)
    assert frame.chat_list.GetCount() == 2


def test_own_session_turn_finish_with_denials(frame, env):
    frame.session_list.SetSelection(1)
    frame.on_open_session()
    assert frame.own_reply.IsShown() and not frame.desktop_reply.IsShown()
    holder = {"id": "own-1"}
    frame._runners["own-1"] = object()
    frame._denials["own-1"] = []
    frame._on_turn_event(holder, "Hub probe", TurnEvent(
        "finished", text="I couldn't write the file.",
        denials=["Write was refused: C:\\x\\probe.txt"]))
    assert frame._runners == {}
    session = frame.store.get("own-1")
    assert session.state == NEEDS_YOU and session.detail == "1 tool was refused"
    assert not session.unread  # it was open
    assert env["spoken"][-1] == ("Hub probe replied. I couldn't write the file. 1 tool was "
                                 "refused: Write was refused: C:\\x\\probe.txt")
    assert frame.send_btn.IsEnabled()


def test_open_in_claude_refused_for_own_session(frame, env, monkeypatch):
    shown = []
    monkeypatch.setattr(wx, "MessageBox", lambda *a, **k: shown.append(a[0]))
    frame.session_list.SetSelection(1)
    frame.on_open_in_claude()
    assert env["opened"] == []
    assert "started by TheClaudeHub" in shown[0]


def test_send_refuses_while_running_and_builds_resume(frame, env, monkeypatch):
    started = []
    from theclaudehub.ui import main_frame
    monkeypatch.setattr(main_frame.platform_paths, "claude_executable", lambda: "claude.exe")

    class FakeRunner:
        def __init__(self, command, cwd, prompt, on_event):
            started.append((command, cwd, prompt))

        def start(self):
            pass

    monkeypatch.setattr(main_frame, "TurnRunner", FakeRunner)
    frame.session_list.SetSelection(1)
    frame.on_open_session()
    frame.reply_text.SetValue("Next step please")
    frame.on_send()
    assert started[0][0][-2:] == ["--resume", "own-1"]
    assert started[0][1:] == ("C:\\G\\Scratch", "Next step please")
    assert not frame.send_btn.IsEnabled()
    frame.reply_text.SetValue("again")
    frame.on_send()
    assert len(started) == 1  # one turn at a time


def test_reply_draft_stays_with_its_session(frame, env):
    store = frame.store
    store.add(OwnSession("own-2", "Second", "C:\\G\\Two", last_activity_ms=NOW - 5))
    frame.refresh_sessions(force=True)
    assert pump(lambda: frame.session_list.GetCount() == 4)
    keys = frame._list_keys
    frame.session_list.SetSelection(keys.index("own:own-1"))
    frame.on_open_session()
    frame.reply_text.SetValue("draft for one")
    frame.show_list()
    frame.session_list.SetSelection(keys.index("own:own-2"))
    frame.on_open_session()
    assert frame.reply_text.GetValue() == ""
    frame.show_list()
    frame.session_list.SetSelection(keys.index("own:own-1"))
    frame.on_open_session()
    assert frame.reply_text.GetValue() == "draft for one"
    frame.show_list()
    frame.session_list.SetSelection(keys.index("local_a"))
    frame.on_open_session()
    assert frame.reply_text.GetValue() == ""


def test_silent_level_still_puts_the_reply_in_the_status_bar(frame, env):
    frame.speech.announce = speech.ANNOUNCE_SILENT
    frame._runners["own-1"] = object()
    frame._on_turn_event({"id": "own-1"}, "Hub probe",
                         TurnEvent("finished", text="All good. More text."))
    assert env["spoken"] == []
    assert frame.GetStatusBar().GetStatusText() == "Hub probe finished. All good."

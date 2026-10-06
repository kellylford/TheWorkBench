import json

import pytest

from theclaudehub import platform_paths
from theclaudehub.own_store import OwnSession, OwnSessionStore
from theclaudehub.sessions import NEEDS_YOU


@pytest.mark.parametrize("cwd,expected", [
    ("C:\\Users\\kelly\\GitHub\\QuickMail", "C--Users-kelly-GitHub-QuickMail"),
    ("C:\\Users\\kelly\\GitHub\\TheWorkBench\\.claude\\worktrees\\brave-cat-1",
     "C--Users-kelly-GitHub-TheWorkBench--claude-worktrees-brave-cat-1"),
    ("/Users/kelly/My Repo_2", "-Users-kelly-My-Repo-2"),
    ("C:\\Users\\kelly\\café", "C--Users-kelly-caf-"),
    ("", ""),
])
def test_encode_cwd(cwd, expected):
    assert platform_paths.encode_cwd(cwd) == expected


def test_transcript_path_direct_and_fallback(tmp_path):
    folder = tmp_path / "C--G-Repo"
    folder.mkdir()
    (folder / "abc-123.jsonl").write_text("")
    assert platform_paths.transcript_path("C:\\G\\Repo", "abc-123", tmp_path) == \
        folder / "abc-123.jsonl"
    # The cwd mapping misses (e.g. a shortened folder name): search by id.
    other = tmp_path / "shortened-name"
    other.mkdir()
    (other / "def-456.jsonl").write_text("")
    assert platform_paths.transcript_path("C:\\G\\Repo", "def-456", tmp_path) == \
        other / "def-456.jsonl"


def test_transcript_path_missing_and_unsafe(tmp_path):
    assert platform_paths.transcript_path("C:\\G", "nope", tmp_path) is None
    assert platform_paths.transcript_path("C:\\G", "", tmp_path) is None
    assert platform_paths.transcript_path("C:\\G", "../x", tmp_path) is None
    assert platform_paths.transcript_path("C:\\G", "*", tmp_path) is None


def test_claude_home_honours_config_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path))
    assert platform_paths.projects_dir() == tmp_path / "projects"
    assert platform_paths.live_sessions_dir() == tmp_path / "sessions"


def test_app_dirs_under_appdata(monkeypatch, tmp_path):
    monkeypatch.setattr(platform_paths.sys, "platform", "win32")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert platform_paths.app_data_dir() == tmp_path / "TheClaudeHub"
    assert platform_paths.desktop_sessions_dir() == tmp_path / "Claude" / "claude-code-sessions"


# -- own store ------------------------------------------------------------------


def test_store_round_trip(tmp_path):
    path = tmp_path / "hub" / "sessions.json"
    store = OwnSessionStore(path)
    store.add(OwnSession("id-1", "First", "C:\\a", permission_mode="plan"))
    store.update("id-1", state=NEEDS_YOU, detail="1 tool was refused", unread=True,
                 not_a_field="ignored")
    again = OwnSessionStore(path)
    session = again.get("id-1")
    assert (session.title, session.permission_mode, session.state, session.unread) == \
        ("First", "plan", NEEDS_YOU, True)
    assert session.created_ms > 0
    info = session.to_info()
    assert info.key == "own:id-1" and info.is_own and not info.can_open_in_claude


def test_store_rename_and_remove(tmp_path):
    store = OwnSessionStore(tmp_path / "s.json")
    store.add(OwnSession("old", "T", "C:\\a"))
    store.rename_id("old", "new")
    assert not store.contains("old") and store.contains("new")
    store.remove("new")
    assert OwnSessionStore(tmp_path / "s.json").all() == []


def test_store_rejects_unsafe_id(tmp_path):
    store = OwnSessionStore(tmp_path / "s.json")
    with pytest.raises(ValueError):
        store.add(OwnSession("../x", "T", "C:\\a"))


def test_store_survives_bad_files(tmp_path):
    path = tmp_path / "s.json"
    path.write_text(json.dumps({"sessions": [
        {"cli_session_id": "ok", "title": "T", "cwd": "C:\\", "future_field": 1},
        {"cli_session_id": "../bad", "title": "T", "cwd": "C:\\"},
        {"title": "no id"}, "junk",
        {"cli_session_id": "missing-title"},
        {"cli_session_id": "bad-title", "title": 5, "cwd": "C:\\"},
        {"cli_session_id": "odd-types", "title": "T", "cwd": "C:\\", "unread": "yes",
         "created_ms": "soon", "state": None, "started": 1, "last_activity_ms": True},
    ]}), encoding="utf-8")
    store = OwnSessionStore(path)
    assert sorted(s.cli_session_id for s in store.all()) == ["odd-types", "ok"]
    odd = store.get("odd-types")
    assert (odd.unread, odd.created_ms, odd.state, odd.started, odd.last_activity_ms) == \
        (False, 0, "idle", True, 0)
    assert store.load_error == ""


@pytest.mark.parametrize("content,why", [("{broken", "valid JSON"),
                                         (json.dumps({"sessions": "nope"}), "expected format")])
def test_corrupt_store_is_set_aside_not_overwritten(tmp_path, content, why):
    path = tmp_path / "sessions.json"
    path.write_text(content, encoding="utf-8")
    store = OwnSessionStore(path)
    assert store.all() == []
    assert why in store.load_error and "moved to sessions.json.bad-" in store.load_error
    backups = list(tmp_path.glob("sessions.json.bad-*"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == content
    store.add(OwnSession("new", "T", "C:\\"))  # saving now can't destroy the old file
    assert backups[0].read_text(encoding="utf-8") == content


def test_store_that_cannot_be_set_aside_refuses_to_save(tmp_path, monkeypatch):
    import theclaudehub.own_store as own_store
    path = tmp_path / "sessions.json"
    path.write_text("{broken", encoding="utf-8")

    def refuse(*a):
        raise OSError("locked")
    monkeypatch.setattr(own_store.os, "replace", refuse)
    store = OwnSessionStore(path)
    assert "couldn't be moved aside" in store.load_error
    with pytest.raises(OSError):
        store.add(OwnSession("new", "T", "C:\\"))
    assert path.read_text(encoding="utf-8") == "{broken"


def test_store_missing_file_is_empty_without_error(tmp_path):
    store = OwnSessionStore(tmp_path / "none.json")
    assert store.all() == [] and store.load_error == ""

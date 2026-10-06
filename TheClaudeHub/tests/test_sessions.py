import json

import pytest

from theclaudehub import hub, platform_paths
from theclaudehub.own_store import OwnSession
from theclaudehub.sessions import (DESKTOP, IDLE, NEEDS_YOU, OWN, WORKING, LiveStatus,
                                   SessionInfo, describe_age, desktop_state,
                                   load_desktop_sessions, load_live_status, sort_sessions)

NOW = 1_800_000_000_000


def metadata(local="local_aaa", cli="cli-aaa", title="Fix the build", cwd="C:\\G\\Repo",
             archived=False, activity=NOW - 60_000, **extra):
    data = {"sessionId": local, "cliSessionId": cli, "cwd": cwd, "originCwd": cwd,
            "title": title, "isArchived": archived, "lastActivityAt": activity,
            "createdAt": activity - 1000, "permissionMode": "auto", "model": "m"}
    data.update(extra)
    return data


def write_meta(root, data, org="org1"):
    folder = root / data["sessionId"].replace("local_", "") / org
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{data['sessionId']}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


# -- metadata loading -----------------------------------------------------------


def test_loads_desktop_sessions_and_skips_archived(tmp_path):
    write_meta(tmp_path, metadata())
    write_meta(tmp_path, metadata(local="local_bbb", cli="cli-bbb", archived=True))
    result = load_desktop_sessions(tmp_path, {})
    assert [s.key for s in result.sessions] == ["local_aaa"]
    info = result.sessions[0]
    assert (info.source, info.title, info.repo, info.cli_session_id) == \
        (DESKTOP, "Fix the build", "Repo", "cli-aaa")
    # Archived ids are still known to the --resume guard.
    assert result.desktop_cli_ids == {"cli-aaa", "cli-bbb"}


def test_bad_metadata_files_are_counted(tmp_path):
    write_meta(tmp_path, metadata())
    bad = tmp_path / "x" / "org"
    bad.mkdir(parents=True)
    (bad / "local_bad.json").write_text("{nope", encoding="utf-8")
    (bad / "local_list.json").write_text("[]", encoding="utf-8")
    result = load_desktop_sessions(tmp_path, {})
    assert len(result.sessions) == 1
    assert result.unreadable_files == 2


def test_metadata_with_unsafe_or_missing_ids_is_skipped(tmp_path):
    write_meta(tmp_path, metadata(local="local_ok", cli="../../evil"))
    data = metadata(local="local_x")
    data["sessionId"] = None
    folder = tmp_path / "y" / "org"
    folder.mkdir(parents=True)
    (folder / "local_y.json").write_text(json.dumps(data), encoding="utf-8")
    result = load_desktop_sessions(tmp_path, {})
    assert [s.key for s in result.sessions] == ["local_ok"]
    assert result.sessions[0].cli_session_id == ""


def test_missing_directory_gives_empty_list(tmp_path):
    assert load_desktop_sessions(tmp_path / "nope", {}).sessions == []


def test_untitled_and_worktree_repo_names():
    info = SessionInfo(source=DESKTOP, key="k", title="", cwd=(
        "C:\\Users\\k\\GitHub\\TheWorkBench\\.claude\\worktrees\\brave-cat-1"),
        cli_session_id="c")
    assert info.repo == "TheWorkBench worktree"
    assert info.list_line(NOW).startswith("Untitled session, TheWorkBench worktree, idle")
    assert SessionInfo(DESKTOP, "k", "t", "", "c").repo == "unknown folder"


# -- state ----------------------------------------------------------------------


def test_busy_live_status_means_working():
    live = LiveStatus(status="busy", pid=1)
    assert desktop_state(metadata(), live) == (WORKING, "")


def test_post_turn_summary_needs_action():
    data = metadata(postTurnSummary={"status_category": "completed",
                                     "needs_action": "Approve the release",
                                     "summarizes_uuid": "u1"})
    assert desktop_state(data, LiveStatus("idle", 1)) == (NEEDS_YOU, "Approve the release")


@pytest.mark.parametrize("category", ["blocked", "review_ready"])
def test_blocked_and_review_ready_need_you(category):
    data = metadata(postTurnSummary={"status_category": category, "needs_action": "",
                                     "status_detail": "PR 12 ready"})
    assert desktop_state(data, None) == (NEEDS_YOU, "PR 12 ready")


def test_completed_is_idle_and_stale_summary_is_ignored():
    done = metadata(postTurnSummary={"status_category": "completed", "needs_action": ""})
    assert desktop_state(done, None) == (IDLE, "")
    stale = metadata(lastAssistantUuid="new",
                     postTurnSummary={"status_category": "blocked", "summarizes_uuid": "old"})
    assert desktop_state(stale, None) == (IDLE, "")


def test_garbage_summary_is_ignored():
    assert desktop_state(metadata(postTurnSummary="weird"), None) == (IDLE, "")
    assert desktop_state(metadata(postTurnSummary={"needs_action": 5}), None) == (NEEDS_YOU, "5")


def test_live_status_matches_cli_or_local_id(tmp_path):
    write_meta(tmp_path / "d", metadata())
    write_meta(tmp_path / "d", metadata(local="local_bbb", cli="cli-bbb"))
    live = {"cli-aaa": LiveStatus("busy", 1), "local_bbb": LiveStatus("busy", 2)}
    result = load_desktop_sessions(tmp_path / "d", live)
    assert {s.state for s in result.sessions} == {WORKING}


def test_load_live_status_skips_dead_and_bad_files(tmp_path):
    (tmp_path / "100.json").write_text(json.dumps(
        {"pid": 100, "sessionId": "cli-1", "hostSessionId": "local_1", "status": "busy"}))
    (tmp_path / "200.json").write_text(json.dumps(
        {"pid": 200, "sessionId": "cli-2", "status": "busy"}))
    (tmp_path / "300.json").write_text("{bad")
    (tmp_path / "400.json").write_text(json.dumps({"sessionId": "cli-4", "status": "idle"}))
    (tmp_path / "100.abc.key").write_text("not json")
    live = load_live_status(tmp_path, alive=lambda pid: pid in (100, 400))
    assert set(live) == {"cli-1", "local_1", "cli-4"}
    assert live["cli-1"].status == "busy"
    assert live["cli-4"].pid == 400  # pid from the file name


def test_pid_alive_for_this_process_and_nonsense():
    import os
    assert platform_paths.pid_alive(os.getpid()) is True
    assert platform_paths.pid_alive(0) is False
    assert platform_paths.pid_alive(-5) is False
    assert platform_paths.pid_alive("12") is False


# -- sorting and wording --------------------------------------------------------


def _info(key, state, activity):
    return SessionInfo(source=DESKTOP, key=key, title=key, cwd="C:\\r", cli_session_id=key,
                       state=state, last_activity_ms=activity)


def test_sort_needs_you_then_working_then_newest():
    sessions = [_info("old-idle", IDLE, 1), _info("new-idle", IDLE, 9),
                _info("working", WORKING, 2), _info("needs-old", NEEDS_YOU, 3),
                _info("needs-new", NEEDS_YOU, 8)]
    assert [s.key for s in sort_sessions(sessions)] == [
        "needs-new", "needs-old", "working", "new-idle", "old-idle"]


@pytest.mark.parametrize("delta,expected", [
    (5_000, "active just now"),
    (60_000, "active 1 minute ago"),
    (5 * 60_000, "active 5 minutes ago"),
    (3_600_000, "active 1 hour ago"),
    (5 * 3_600_000, "active 5 hours ago"),
    (25 * 3_600_000, "active yesterday"),
    (3 * 86_400_000, "active 3 days ago"),
    (65 * 86_400_000, "active 2 months ago"),
    (-10_000, "active just now"),
])
def test_describe_age(delta, expected):
    assert describe_age(NOW - delta, NOW) == expected


def test_describe_age_without_time():
    assert describe_age(0, NOW) == "no activity recorded"


def test_list_line_reads_every_part():
    info = SessionInfo(source=OWN, key="own:x", title="Probe", cwd="C:\\G\\Repo",
                       cli_session_id="x", state=NEEDS_YOU, detail="2 tools were refused",
                       last_activity_ms=NOW - 120_000, unread=True)
    assert info.list_line(NOW) == ("Probe, Repo, needs you: 2 tools were refused, new reply, "
                                   "active 2 minutes ago, TheClaudeHub session")


# -- hub.collect ------------------------------------------------------------------


def test_collect_merges_own_sessions_with_running_state(tmp_path):
    write_meta(tmp_path / "d", metadata(postTurnSummary={"status_category": "blocked"}))
    own_idle = OwnSession("own-1", "Mine", "C:\\G\\Mine", last_activity_ms=NOW)
    own_running = OwnSession("own-2", "Running", "C:\\G\\Mine", last_activity_ms=1)
    snap = hub.collect([own_idle, own_running], {"own-2"}, desktop_dir=tmp_path / "d",
                       live_dir=tmp_path / "none")
    assert [s.key for s in snap.sessions] == ["local_aaa", "own:own-2", "own:own-1"]
    assert snap.sessions[1].state == WORKING
    assert snap.sessions[2].is_own and not snap.sessions[2].can_open_in_claude
    assert snap.desktop_cli_ids == {"cli-aaa"}


def test_collect_marks_own_session_busy_elsewhere(tmp_path):
    (tmp_path / "live").mkdir()
    (tmp_path / "live" / "7.json").write_text(json.dumps(
        {"pid": 7, "sessionId": "own-1", "status": "busy"}))
    snap = hub.collect([OwnSession("own-1", "Mine", "C:\\x")], set(),
                       desktop_dir=tmp_path / "d", live_dir=tmp_path / "live",
                       alive=lambda pid: True)
    assert snap.sessions[0].state == WORKING
    assert "outside" in snap.sessions[0].detail


def test_finished_turns():
    previous = {"a": WORKING, "b": WORKING, "c": IDLE}
    current = [_info("a", IDLE, 1), _info("b", WORKING, 1), _info("c", NEEDS_YOU, 1),
               _info("d", IDLE, 1)]
    assert [s.key for s in hub.finished_turns(previous, current)] == ["a"]


def test_last_reply_from_tail_reads_only_the_end(tmp_path):
    from records import assistant_block, lines, text_block, user_text
    path = tmp_path / "t.jsonl"
    filler = lines(*[user_text("x" * 500) for _ in range(50)])
    tail = lines(user_text("question"), assistant_block(text_block("the reply"), "m9"))
    path.write_text("\n".join(filler + tail) + "\n", encoding="utf-8")
    assert hub.last_reply_from_tail(path, max_bytes=2000) == "the reply"
    assert hub.last_reply_from_tail(tmp_path / "missing.jsonl") == ""

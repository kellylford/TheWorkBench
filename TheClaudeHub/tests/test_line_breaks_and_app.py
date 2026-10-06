"""Unicode line separators in transcripts, and the app's startup helpers."""
import json
import sys

from theclaudehub import app, hub
from theclaudehub.transcript import TranscriptReader, read_transcript, split_jsonl

from records import assistant_block, text_block, user_text

LS, PS, NEL = " ", " ", "\u0085"


def raw_line(record) -> bytes:
    # ensure_ascii=False leaves U+2028/U+2029/U+0085 raw, as JSON.stringify does.
    return json.dumps(record, ensure_ascii=False).encode("utf-8") + b"\n"


def test_split_jsonl_only_splits_on_newline():
    data = f'{{"a": "x{LS}y{PS}z{NEL}w"}}\r\n{{"b": 1}}\n'.encode("utf-8")
    assert split_jsonl(data) == [f'{{"a": "x{LS}y{PS}z{NEL}w"}}', '{"b": 1}', ""]


def test_reader_keeps_messages_containing_unicode_line_separators(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_bytes(raw_line(user_text(f"a{LS}b"))
                     + raw_line(assistant_block(text_block(f"one{PS}two{NEL}three"), "m")))
    tr = read_transcript(path)
    assert tr.unreadable_lines == 0
    assert [m.text for m in tr.visible()] == [f"a{LS}b", f"one{PS}two{NEL}three"]


def test_incremental_reader_with_separators(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_bytes(raw_line(user_text("first")))
    reader = TranscriptReader(path)
    reader.refresh()
    with open(path, "ab") as handle:
        handle.write(raw_line(assistant_block(text_block(f"x{LS}y"), "m")))
    assert reader.refresh() is True
    assert reader.transcript.unreadable_lines == 0
    assert reader.transcript.visible()[-1].text == f"x{LS}y"


def test_last_reply_from_tail_with_separators(tmp_path):
    path = tmp_path / "t.jsonl"
    path.write_bytes(raw_line(user_text("q"))
                     + raw_line(assistant_block(text_block(f"the{LS}reply"), "m")))
    assert hub.last_reply_from_tail(path) == f"the{LS}reply"


def test_crlf_transcripts_still_parse(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_bytes(json.dumps(user_text("hi")).encode() + b"\r\n")
    assert read_transcript(path).visible()[0].text == "hi"


# -- app startup helpers ------------------------------------------------------------------


def test_log_exception_writes_traceback(tmp_path):
    log = tmp_path / "logs" / "error.log"
    try:
        raise ValueError("boom")
    except ValueError:
        app.log_exception(*sys.exc_info(), where="test", path=log)
    text = log.read_text(encoding="utf-8")
    assert "TheClaudeHub" in text and "ValueError: boom" in text and "test" in text


def test_log_exception_never_raises(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    app.log_exception(ValueError, ValueError("x"), None, path=blocker / "sub" / "e.log")


def test_install_error_logging_routes_hooks(tmp_path, monkeypatch):
    import threading
    seen = []
    monkeypatch.setattr(app, "log_exception", lambda *a, **k: seen.append(a[3] if len(a) > 3
                                                                           else k.get("where")))
    monkeypatch.setattr(sys, "excepthook", lambda *a: None)
    monkeypatch.setattr(threading, "excepthook", threading.excepthook)
    app.install_error_logging()
    sys.excepthook(ValueError, ValueError("x"), None)
    thread = threading.Thread(target=lambda: 1 / 0, name="worker")
    thread.start()
    thread.join()
    assert seen == ["main thread", "thread worker"]


def test_hub_window_title_matching():
    assert app.is_hub_window_title("TheClaudeHub")
    assert app.is_hub_window_title("Fix the build — TheClaudeHub")
    assert not app.is_hub_window_title("TheClaudeHub notes.txt - Notepad")

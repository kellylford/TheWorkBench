import json

from theclaudehub import transcript as t
from theclaudehub.transcript import (TranscriptParser, TranscriptReader, parse_lines,
                                     read_transcript)

from records import (assistant_block, lines, other, text_block, thinking_block,
                     tool_result, tool_use_block, user_blocks, user_text)


def kinds(tr, show_activity=False):
    return [m.kind for m in tr.visible(show_activity)]


def test_plain_conversation_string_and_block_content():
    tr = parse_lines(lines(
        user_text("Hello there"),
        assistant_block(text_block("Hi! How can I help?"), "msg_1"),
        user_blocks([{"type": "text", "text": "Second question"}]),
        assistant_block(text_block("Answer two"), "msg_2"),
    ))
    assert [m.list_line() for m in tr.visible()] == [
        "You: Hello there", "Claude: Hi! How can I help?",
        "You: Second question", "Claude: Answer two"]
    assert tr.unreadable_lines == 0


def test_split_assistant_records_with_one_message_id_merge():
    tr = parse_lines(lines(
        user_text("q"),
        assistant_block(thinking_block(), "msg_1"),
        assistant_block(text_block("Part one."), "msg_1"),
        assistant_block(text_block("Part two."), "msg_1"),
    ))
    assert kinds(tr) == ["user", "assistant"]
    assert tr.visible()[1].text == "Part one.\n\nPart two."


def test_tool_calls_and_results_are_activity_only():
    tr = parse_lines(lines(
        user_text("Run the tests"),
        assistant_block(text_block("Let me run them."), "msg_1"),
        assistant_block(tool_use_block("Bash", {"command": "pytest -q",
                                                "description": "Run tests"}, "toolu_9"),
                        "msg_1"),
        tool_result("toolu_9", "3 passed"),
        assistant_block(text_block("All three pass."), "msg_2"),
    ))
    assert kinds(tr) == ["user", "assistant", "assistant"]
    assert kinds(tr, True) == ["user", "assistant", "tool", "tool_result", "assistant"]
    tool = tr.visible(True)[2]
    assert tool.list_line() == "Tool: Bash: Run tests"
    assert tr.visible(True)[3].text == "Bash returned: 3 passed"


def test_text_after_a_tool_call_in_same_message_is_a_new_message():
    tr = parse_lines(lines(
        assistant_block(text_block("Before."), "msg_1"),
        assistant_block(tool_use_block("Read", {"file_path": "a.txt"}, "toolu_1"), "msg_1"),
        assistant_block(text_block("After."), "msg_1"),
    ))
    assert [m.text for m in tr.visible()] == ["Before.", "After."]


def test_question_card_and_answer_read_as_words():
    question = {"questions": [{
        "question": "Which colour?", "header": "Colour", "multiSelect": False,
        "options": [{"label": "Red", "description": "warm"},
                    {"label": "Blue", "description": ""}]}]}
    tr = parse_lines(lines(
        assistant_block(tool_use_block("AskUserQuestion", question, "toolu_q"), "msg_1"),
        tool_result("toolu_q", 'Your questions have been answered: "Which colour?"="Red"',
                    toolUseResult={"questions": [], "answers": {"Which colour?": "Red"}}),
    ))
    visible = tr.visible()
    assert [m.kind for m in visible] == [t.QUESTION, t.ANSWER]
    assert visible[0].text == "Which colour?\nOptions: Red (warm); Blue."
    assert visible[0].list_line() == "Claude asked: Which colour?"
    assert visible[1].list_line() == "You answered: Which colour? — Red"


def test_question_answer_falls_back_to_result_text():
    tr = parse_lines(lines(
        assistant_block(tool_use_block("AskUserQuestion", {"questions": "bad"}, "q"), "m"),
        tool_result("q", "Your questions have been answered: blue"),
    ))
    assert tr.visible()[0].text.startswith("Claude asked a question")
    assert tr.visible()[1].text == "blue"


def test_permission_denial_is_shown():
    tr = parse_lines(lines(
        assistant_block(tool_use_block("Write", {"file_path": "x.txt"}, "toolu_w"), "m"),
        tool_result("toolu_w", "Claude requested permissions to write to x.txt, but you "
                               "haven't granted it yet.", is_error=True,
                    toolDenialKind="user-rejected"),
    ))
    visible = tr.visible()
    assert [m.kind for m in visible] == [t.DENIED]
    assert visible[0].list_line().startswith("Permission denied: Write: Claude requested")


def test_tool_error_without_denial_is_activity():
    tr = parse_lines(lines(
        assistant_block(tool_use_block("Bash", {"command": "false"}, "toolu_b"), "m"),
        tool_result("toolu_b", "exit 1", is_error=True),
    ))
    assert kinds(tr) == []
    assert tr.visible(True)[1].text == "Bash failed: exit 1"


def test_plan_error_interrupt():
    tr = parse_lines(lines(
        assistant_block(tool_use_block("ExitPlanMode", {"plan": "1. Do it"}, "p"), "m"),
        _api_error(),
        user_blocks([{"type": "text", "text": "[Request interrupted by user]"}]),
    ))
    assert kinds(tr) == [t.PLAN, t.ERROR, t.INTERRUPTED]
    assert tr.visible()[0].text == "1. Do it"


def _api_error():
    record = assistant_block(text_block("API Error: overloaded"), "m_err")
    record["isApiErrorMessage"] = True
    return record


def test_harness_events_meta_and_compaction_are_activity():
    tr = parse_lines(lines(
        user_text("<task-notification>\n<status>completed</status>\n</task-notification>"),
        user_text("Skill instructions here", isMeta=True),
        user_text("Earlier we did X", isCompactSummary=True),
        user_text("Real question"),
    ))
    assert kinds(tr) == [t.USER]
    activity = tr.visible(True)
    assert activity[0].kind == t.EVENT
    assert activity[0].text.startswith("task notification: completed")
    assert activity[1].kind == t.CONTEXT
    assert activity[2].text.startswith("Summary of the earlier conversation")


def test_system_reminder_is_stripped_from_user_text():
    tr = parse_lines(lines(user_text(
        "Fix it<system-reminder>internal</system-reminder>")))
    assert tr.visible()[0].text == "Fix it"


def test_sidechain_and_unknown_records_are_skipped_silently():
    side = user_text("subagent prompt")
    side["isSidechain"] = True
    tr = parse_lines(lines(
        other("attachment", attachment={"type": "x"}),
        other("custom-title", customTitle="t"),
        other("some-future-record", data=[1, 2]),
        side,
        user_text("Visible"),
    ))
    assert kinds(tr) == [t.USER]
    assert tr.unreadable_lines == 0


def test_malformed_lines_are_counted_not_raised():
    good = json.dumps(user_text("ok"))
    tr = parse_lines([
        "{not json", good, "[1,2,3]", "",
        json.dumps({"type": "user", "message": "not a dict"}),
        json.dumps({"type": "assistant", "message": {"content": 42}}),
        json.dumps({"type": "user", "message": {"content": {"odd": True}}}),
    ])
    assert kinds(tr) == [t.USER]
    assert tr.unreadable_lines == 5


def test_images_and_odd_blocks_do_not_crash():
    tr = parse_lines(lines(
        user_blocks([{"type": "image", "source": {}}, "stray string", {"type": "text"}]),
        assistant_block({"type": "redacted_thinking"}, "m"),
        assistant_block("not a dict", "m"),
    ))
    assert tr.visible()[0].text == "[image]"
    assert tr.unreadable_lines == 0


def test_last_reply():
    tr = parse_lines(lines(
        user_text("q"), assistant_block(text_block("final answer"), "m"),
        user_text("<ci-monitor-event>x</ci-monitor-event>")))
    assert tr.last_reply().text == "final answer"


def test_long_first_line_is_trimmed_and_full_text_kept():
    long = "word " * 200
    tr = parse_lines(lines(assistant_block(text_block(long + "\nsecond line"), "m")))
    message = tr.visible()[0]
    assert len(message.first_line()) <= 300
    assert message.full_text().startswith("Claude:\n")
    assert message.full_text().endswith("second line")


def test_empty_message_reads_empty():
    msg = t.ChatMessage(kind=t.USER, text="   ")
    assert msg.list_line() == "You: (empty)"


# -- reading files ------------------------------------------------------------


def test_reader_is_incremental_and_waits_for_whole_lines(tmp_path):
    path = tmp_path / "s.jsonl"
    first = json.dumps(user_text("one")) + "\n"
    path.write_text(first, encoding="utf-8")
    reader = TranscriptReader(path)
    assert reader.refresh() is True
    assert kinds(reader.transcript) == [t.USER]
    assert reader.refresh() is False

    partial = json.dumps(assistant_block(text_block("two"), "m"))
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(partial[:20])  # a line still being written
    assert reader.refresh() is False
    assert reader.transcript.unreadable_lines == 0
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(partial[20:] + "\n")
    assert reader.refresh() is True
    assert kinds(reader.transcript) == [t.USER, t.ASSISTANT]


def test_reader_merges_split_reply_across_refreshes(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text(json.dumps(assistant_block(text_block("A"), "m1")) + "\n",
                    encoding="utf-8")
    reader = TranscriptReader(path)
    reader.refresh()
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(assistant_block(text_block("B"), "m1")) + "\n")
    assert reader.refresh() is True
    assert [m.text for m in reader.transcript.visible()] == ["A\n\nB"]


def test_reader_starts_over_when_file_shrinks(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text("\n".join(lines(user_text("a"), user_text("b"))) + "\n", encoding="utf-8")
    reader = TranscriptReader(path)
    reader.refresh()
    path.write_text(json.dumps(user_text("c")) + "\n", encoding="utf-8")
    reader.refresh()
    assert [m.text for m in reader.transcript.visible()] == ["c"]


def test_reader_missing_file_is_not_an_error(tmp_path):
    reader = TranscriptReader(tmp_path / "gone.jsonl")
    assert reader.refresh() is False
    assert reader.transcript.messages == []


def test_reader_never_writes(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_text(json.dumps(user_text("a")) + "\n", encoding="utf-8")
    before = path.stat().st_mtime_ns, path.read_bytes()
    read_transcript(path)
    assert (path.stat().st_mtime_ns, path.read_bytes()) == before


def test_invalid_utf8_is_replaced_not_fatal(tmp_path):
    path = tmp_path / "s.jsonl"
    path.write_bytes(b'{"type":"user","message":{"content":"caf\xff"}}\n')
    tr = read_transcript(path)
    assert tr.visible()[0].text.startswith("caf")


def test_parser_state_survives_feeds():
    parser = TranscriptParser()
    parser.feed(lines(assistant_block(tool_use_block("AskUserQuestion", {
        "questions": [{"question": "Go?", "options": [{"label": "Yes"}]}]}, "q1"), "m")))
    parser.feed(lines(tool_result("q1", "Your questions have been answered: Yes")))
    assert [m.kind for m in parser.transcript.messages] == [t.QUESTION, t.ANSWER]

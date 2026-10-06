import json

import pytest

from theclaudehub import announce
from theclaudehub.sessions import IDLE, NEEDS_YOU
from theclaudehub.speech import (ANNOUNCE_FULL, ANNOUNCE_SILENT, ANNOUNCE_SUMMARY,
                                 SpeechSettings, strip_for_speech)
from theclaudehub.ui_text import shortcuts_text


def test_reply_levels():
    reply = "Done. The build passes now. Three files changed."
    assert announce.reply_text("Build", reply, ANNOUNCE_FULL) == f"Build replied. {reply}"
    assert announce.reply_text("Build", reply, ANNOUNCE_SUMMARY) == \
        "Build replied: Done. 8 words."
    assert announce.reply_text("Build", reply, ANNOUNCE_SILENT) is None
    assert announce.reply_text("Build", "  ", ANNOUNCE_FULL) is None


def test_turn_end_levels():
    assert announce.turn_end_text("QM", IDLE, "", "", ANNOUNCE_FULL) == "QM finished."
    assert announce.turn_end_text("QM", NEEDS_YOU, "Approve it", "Ready? Yes.",
                                  ANNOUNCE_SUMMARY) == "QM needs you: Approve it. Ready?"
    assert announce.turn_end_text("QM", IDLE, "", "All done.", ANNOUNCE_FULL) == \
        "QM finished. All done."
    assert announce.turn_end_text("QM", IDLE, "", "x", ANNOUNCE_SILENT) is None


def test_first_sentence_and_status_text():
    assert announce.first_sentence("No full stop here") == "No full stop here"
    assert announce.first_sentence("a" * 300).endswith("…")
    assert len(announce.status_text("x " * 200)) == 150


def test_own_message_read_back_follows_the_level_and_setting():
    message = "Fix the build.  Then run\nthe tests"
    # Which session comes first, so it's heard even if the rest is cut off.
    assert announce.sent_text("QM", message, ANNOUNCE_FULL, True) == \
        "Sent to QM: Fix the build. Then run the tests."
    assert announce.sent_text("QM", message, ANNOUNCE_SUMMARY, True) == \
        "Sent to QM: Fix the build."
    assert announce.sent_text("QM", message, ANNOUNCE_FULL, False) == "Sent. QM is working."
    assert announce.sent_text("QM", message, ANNOUNCE_SILENT, True) == "Sent. QM is working."
    assert announce.sent_text("QM", "Is it done?", ANNOUNCE_FULL, True) == \
        "Sent to QM: Is it done?"
    assert announce.sent_text("QM", "x", ANNOUNCE_FULL, True, queued=True) == \
        "Sent your queued message. QM is working."
    assert announce.queued_text("QM", "and the docs", ANNOUNCE_FULL, True) == \
        "Queued for QM: and the docs."
    assert announce.queued_text("QM", "more", ANNOUNCE_FULL, True, added=True) == \
        "Added to the queued message for QM: more."
    assert announce.queued_text("QM", "more", ANNOUNCE_FULL, False) == \
        "Queued. It will be sent when QM finishes."


def spoken(text):
    """What the speaker actually says: the engine gets strip_for_speech's output."""
    return strip_for_speech(text)


def test_own_message_markdown_is_read_as_words():
    fenced = "Look at this:\n```python\nx = 1. y = 2\n```"
    assert spoken(announce.sent_text("QM", fenced, ANNOUNCE_SUMMARY, True)) == \
        "Sent to QM: Look at this."
    assert spoken(announce.sent_text("QM", fenced, ANNOUNCE_FULL, True)) == \
        "Sent to QM: Look at this. Code block omitted."
    plan = "Plan\n## Steps\n- do **this**\n- then that\n1. last"
    assert spoken(announce.sent_text("QM", plan, ANNOUNCE_FULL, True)) == \
        "Sent to QM: Plan. Steps. do this. then that. last."
    assert spoken(announce.sent_text("QM", "```\nonly code\n```", ANNOUNCE_FULL, True)) == \
        "Sent to QM: Code block omitted."
    assert announce.sent_text("QM", "```\n```", ANNOUNCE_FULL, True) == \
        "Sent to QM: Code block omitted."
    assert announce.sent_text("QM", "  \n ", ANNOUNCE_FULL, True) == "Sent. QM is working."


def test_long_own_message_is_capped_at_the_full_level():
    text = announce.sent_text("QM", "word " * 120, ANNOUNCE_FULL, True)
    assert len(text) < announce.OWN_LIMIT + 60
    assert text.endswith("word… and 60 more words.")
    # 301 characters: everything but the last word fits.
    assert announce.sent_text("QM", "a " * 150 + "b", ANNOUNCE_FULL, True).endswith(
        "… and 1 more word.")
    short = "x" * announce.OWN_LIMIT
    assert announce.sent_text("QM", short, ANNOUNCE_FULL, True) == f"Sent to QM: {short}."
    # One word longer than the limit is still cut.
    url = "https://example.com/" + "x" * 400
    assert announce.sent_text("QM", url, ANNOUNCE_FULL, True) == \
        f"Sent to QM: {url[:announce.OWN_LIMIT]}…"


def test_speech_settings_defaults_and_round_trip(tmp_path):
    path = tmp_path / "speech.json"
    settings = SpeechSettings.load(path)
    assert settings.announce == ANNOUNCE_FULL and settings.enabled
    assert settings.announce_all_sessions
    assert settings.announce_own  # on unless Kelly turns it off
    settings.announce = ANNOUNCE_SILENT
    settings.announce_all_sessions = False
    settings.announce_own = False
    settings.save(path)
    again = SpeechSettings.load(path)
    assert again.announce == ANNOUNCE_SILENT and not again.enabled
    assert not again.announce_all_sessions
    assert not again.announce_own
    assert "enabled" not in json.loads(path.read_text())


def test_speech_settings_bad_values(tmp_path):
    path = tmp_path / "speech.json"
    path.write_text(json.dumps({"announce": "shout", "rate_preset": "warp"}))
    settings = SpeechSettings.load(path)
    assert settings.announce == ANNOUNCE_FULL and settings.rate_preset == "default"
    path.write_text("garbage")
    assert SpeechSettings.load(path).announce == ANNOUNCE_FULL


def test_shortcut_list_has_the_essentials():
    text = shortcuts_text()
    for needle in ("Enter", "Ctrl+O", "Ctrl+N", "F5", "Escape", "Ctrl+Enter", "F1", "Ctrl+T"):
        assert needle in text


@pytest.mark.parametrize("message, level, heard", [
    # Abbreviations and initials don't end the first sentence.
    ("Use e.g. the docs. Then go", ANNOUNCE_SUMMARY, "Use e.g. the docs."),
    ("Dr. Smith said hi. Then left", ANNOUNCE_SUMMARY, "Dr. Smith said hi."),
    ("J. Smith wrote it. Read it", ANNOUNCE_SUMMARY, "J. Smith wrote it."),
    # Wrapped prose reads on, whatever the next line starts with.
    ("When the build is done\nI want you to run the tests\nQuickMail first", ANNOUNCE_FULL,
     "When the build is done I want you to run the tests QuickMail first."),
    ("Call me at\n555-1234", ANNOUNCE_FULL, "Call me at 555-1234."),
    ("Mr. Smith\nwent home", ANNOUNCE_SUMMARY, "Mr. Smith went home."),
    # Blank lines, headings, list items, quotes and rules end a sentence.
    ("First paragraph here\n\nSecond paragraph", ANNOUNCE_FULL,
     "First paragraph here. Second paragraph."),
    ("> I said this\nI disagree", ANNOUNCE_FULL, "I said this. I disagree."),
    ("> line one\n> line two\nMy answer", ANNOUNCE_FULL, "line one line two. My answer."),
    ("text\n---\nmore", ANNOUNCE_FULL, "text. more."),
    ("- [ ] task one\n- [x] task two", ANNOUNCE_FULL, "task one. task two."),
    ("1. first\n2. second", ANNOUNCE_FULL, "first. second."),
    # A year or a big number isn't a list marker.
    ("2026. That was the year.", ANNOUNCE_FULL, "2026. That was the year."),
    ("100) things", ANNOUNCE_FULL, "100) things."),
    # An unclosed fence is still a code block.
    ("Unclosed fence\n```\ncode here\nmore code", ANNOUNCE_FULL,
     "Unclosed fence. Code block omitted."),
    # Emphasis across a line break, and Windows line endings.
    ("**a\nb**", ANNOUNCE_FULL, "a b."),
    ("Fix it.\r\nThen test.", ANNOUNCE_FULL, "Fix it. Then test."),
])
def test_own_message_reads_as_written(message, level, heard):
    assert spoken(announce.sent_text("QM", message, level, True)) == f"Sent to QM: {heard}"


@pytest.mark.parametrize("message", ["- ", "- \n- \n- ", "- -", "*", "***", "_", "1. ",
                                     "1.\n2.\n3.", "", "  \n\t "])
def test_marks_alone_are_not_read_back(message):
    assert announce.sent_text("QM", message, ANNOUNCE_FULL, True) == "Sent. QM is working."


def test_cap_counts_words_and_code_blocks_separately():
    text = announce.sent_text("QM", "word " * 60 + "\n```\nx\n```", ANNOUNCE_FULL, True)
    assert text.endswith("word… and 1 more word and a code block.")
    two = "word " * 70 + "\n```\nx\n```\n```\ny\n```"
    assert announce.sent_text("QM", two, ANNOUNCE_FULL, True).endswith(
        "… and 10 more words and 2 code blocks.")


def test_summary_cut_is_on_a_word_boundary():
    text = announce.first_sentence("word, " * 60)
    assert text.endswith("word…") and len(text) <= 201


def test_replies_lose_quote_markers_rules_and_unclosed_fences():
    assert strip_for_speech("> quoted\n\n---\n\nAfter") == "quoted\n\n\n\nAfter"
    assert strip_for_speech("Here:\n```\nhalf a snippet") == "Here:\n Code block omitted."
    assert strip_for_speech("***bold***") == "bold"  # emphasis, not a rule

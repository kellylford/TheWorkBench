import json

from theclaudehub import announce
from theclaudehub.sessions import IDLE, NEEDS_YOU
from theclaudehub.speech import (ANNOUNCE_FULL, ANNOUNCE_SILENT, ANNOUNCE_SUMMARY,
                                 SpeechSettings)
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
    assert announce.sent_text("QM", message, ANNOUNCE_FULL, True) == \
        "Sent: Fix the build. Then run the tests. QM is working."
    assert announce.sent_text("QM", message, ANNOUNCE_SUMMARY, True) == \
        "Sent: Fix the build. QM is working."
    assert announce.sent_text("QM", message, ANNOUNCE_FULL, False) == "Sent. QM is working."
    assert announce.sent_text("QM", message, ANNOUNCE_SILENT, True) == "Sent. QM is working."
    assert announce.sent_text("QM", "Is it done?", ANNOUNCE_FULL, True) == \
        "Sent: Is it done? QM is working."
    assert announce.queued_text("QM", "and the docs", ANNOUNCE_FULL, True) == \
        "Queued: and the docs. It will be sent when QM finishes."
    assert announce.queued_text("QM", "more", ANNOUNCE_FULL, True, added=True) == \
        "Added to the queued message: more. It will be sent when QM finishes."
    assert announce.queued_text("QM", "more", ANNOUNCE_FULL, False) == \
        "Queued. It will be sent when QM finishes."


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

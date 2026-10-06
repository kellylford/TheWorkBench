"""The speaker queues utterances and stops all of them on an interruption."""
import json
import threading
import time

from theclaudehub import speech
from theclaudehub.speech import Speaker, SpeechSettings


class FakeEngine:
    """An engine process that 'speaks' until released or killed."""

    started = []

    def __init__(self, command, **kwargs):
        self.command = command
        self.config = json.loads(open(command[command.index("-ConfigPath") + 1]
                                      if "-ConfigPath" in command
                                      else command[command.index("--config") + 1],
                                      encoding="utf-8").read())
        self.done = threading.Event()
        self.killed = False
        FakeEngine.started.append(self)

    def poll(self):
        return 0 if self.done.is_set() else None

    def wait(self, timeout=None):
        if not self.done.wait(timeout):
            raise TimeoutError
        return 0

    def kill(self):
        self.killed = True
        self.done.set()


def wait_until(condition, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if condition():
            return True
        time.sleep(0.01)
    return False


def make(tmp_path, monkeypatch):
    FakeEngine.started = []
    monkeypatch.setattr(speech.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(Speaker, "_command",
                        lambda self, t, c: ["engine", "-Path", str(t), "-ConfigPath", str(c)])
    return Speaker(popen=FakeEngine)


def test_confirmations_queue_instead_of_overlapping(tmp_path, monkeypatch):
    s = make(tmp_path, monkeypatch)
    settings = SpeechSettings()
    assert s.speak("first", settings, interrupt=False)
    assert s.speak("second", settings, interrupt=False)
    assert wait_until(lambda: len(FakeEngine.started) == 1)
    time.sleep(0.1)
    assert len(FakeEngine.started) == 1          # second waits for the first
    assert FakeEngine.started[0].config["interrupt"] is False
    FakeEngine.started[0].done.set()
    assert wait_until(lambda: len(FakeEngine.started) == 2)
    FakeEngine.started[1].done.set()
    assert wait_until(lambda: not s.busy())


def test_an_announcement_stops_everything_in_flight_and_queued(tmp_path, monkeypatch):
    s = make(tmp_path, monkeypatch)
    settings = SpeechSettings()
    s.speak("confirmation one", settings, interrupt=False)
    s.speak("confirmation two", settings, interrupt=False)
    assert wait_until(lambda: len(FakeEngine.started) == 1)
    first = FakeEngine.started[0]
    s.speak("Session replied", settings, interrupt=True)
    assert first.killed                           # in-flight speech stopped
    assert wait_until(lambda: len(FakeEngine.started) == 2)
    announcement = FakeEngine.started[1]
    assert announcement.config["interrupt"] is True
    text_file = announcement.command[announcement.command.index("-Path") + 1]
    assert open(text_file, encoding="utf-8").read() == "Session replied"
    announcement.done.set()
    assert wait_until(lambda: not s.busy())
    assert len(FakeEngine.started) == 2           # the queued confirmation was dropped


def test_stop_kills_every_running_engine(tmp_path, monkeypatch):
    s = make(tmp_path, monkeypatch)
    s.speak("one", SpeechSettings(), interrupt=False)
    assert wait_until(lambda: len(FakeEngine.started) == 1)
    s.stop()
    assert FakeEngine.started[0].killed
    assert wait_until(lambda: not s.busy())


def test_empty_text_is_not_spoken(tmp_path, monkeypatch):
    s = make(tmp_path, monkeypatch)
    assert s.speak("   ", SpeechSettings()) is False
    assert FakeEngine.started == []

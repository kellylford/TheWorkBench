"""Speak announcements through the user's screen reader or a system voice.

Adapted from Image Description Toolkit's ``shared/speech_engine.py`` (Kelly's
own code), which in turn bundles ClaudeSpeak's engine scripts. Changes for
TheClaudeHub: settings live in ``%APPDATA%/TheClaudeHub/speech.json`` and
carry the announcement level (full / summary / silent) and whether turn
endings in every listed session are announced; the temp folder is
``theclaudehub-speak``. Speech is on by default, through the screen reader
when one is running, because announcements are the point of this app.

The actual speech routing is ClaudeSpeak's (TheWorkBench repo), bundled
verbatim (IDT's copy, with its middle-of-the-scale default rates):
``theclaudehub/speech/speak-engine.ps1`` routes JAWS → NVDA → OneCore →
SAPI on Windows, ``theclaudehub/speech/speak-engine.sh`` routes VoiceOver → say on
macOS. Both were verified on real hardware there; this module is only the
harness around them — settings, engine/voice enumeration, the detached
speaker process, and interruption by killing the previous speaker before
starting the next (the same process model ClaudeSpeak uses for its Claude
Code hook).

Design rules inherited from that investigation, kept on purpose:

* **Screen-reader routes never set voice or rate.** The user already chose
  those in JAWS/NVDA/VoiceOver; overriding them is an accessibility defect,
  not a feature.
* **Speech never blocks and never raises.** The speaker is a detached hidden
  process; a failure leaves at most ``last-route.log`` in the temp dir.
* **A clean exit only proves something spoke.** The engine scripts log which
  route actually ran, because a broken route falling back to a system voice
  is indistinguishable by ear.

No wx imports here: the module is used by the wx app but testable without it.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

__all__ = [
    "SpeechOption",
    "SpeechSettings",
    "Speaker",
    "RATE_PRESETS",
    "default_options",
    "list_speech_options",
    "strip_for_speech",
    "speaker",
    "ANNOUNCE_FULL",
    "ANNOUNCE_SUMMARY",
    "ANNOUNCE_SILENT",
    "ANNOUNCE_LEVELS",
    "ANNOUNCE_LABELS",
]

from .platform_paths import app_data_dir  # noqa: E402

DEFAULT_SETTINGS_PATH = app_data_dir() / "speech.json"

#: Bytes ``speech.log`` may reach before its older half is dropped.
LOG_LIMIT = 200_000

#: How much is said when a session replies or finishes a turn.
ANNOUNCE_FULL = "full"
ANNOUNCE_SUMMARY = "summary"
ANNOUNCE_SILENT = "silent"
ANNOUNCE_LEVELS = [ANNOUNCE_FULL, ANNOUNCE_SUMMARY, ANNOUNCE_SILENT]
ANNOUNCE_LABELS = {
    ANNOUNCE_FULL: "Full: read the whole reply",
    ANNOUNCE_SUMMARY: "Summary: the session's name and the reply's first sentence",
    ANNOUNCE_SILENT: "Silent: status bar only",
}

#: Preset -> per-engine rate value. Scales differ per engine (OneCore 0.5–6,
#: SAPI -10..10, `say` words per minute), so presets are the shared language
#: and the number is resolved at speak time. "default" means "let the engine
#: decide", and screen-reader routes ignore rate entirely.
RATE_PRESETS = {
    "onecore": {"slow": 1.0, "normal": 3.0, "fast": 4.5, "fastest": 6.0},
    "sapi": {"slow": -5, "normal": 0, "fast": 5, "fastest": 10},
    "say": {"slow": 120, "normal": 175, "fast": 300, "fastest": 450},
}

RATE_PRESET_LABELS = ["default", "slow", "normal", "fast", "fastest"]

_SCREEN_READER_ENGINES = {"auto", "jaws", "nvda", "voiceover"}


@dataclass
class SpeechOption:
    """One selectable entry for the Speech settings tab."""

    engine: str  # auto | jaws | nvda | onecore | sapi | voiceover | say
    voice: str  # match string for voice engines, "" otherwise
    label: str  # what the picker shows

    @property
    def is_screen_reader(self) -> bool:
        return self.engine in _SCREEN_READER_ENGINES

    @property
    def has_rate(self) -> bool:
        return self.engine in RATE_PRESETS


@dataclass
class SpeechSettings:
    """What the user chose. Persisted as one small JSON file."""

    announce: str = ANNOUNCE_FULL
    announce_all_sessions: bool = True
    #: Read Kelly's own message back when it's sent or queued (issue #178).
    announce_own: bool = True
    engine: str = "auto"
    voice: str = ""
    rate_preset: str = "default"

    @property
    def enabled(self) -> bool:
        return self.announce != ANNOUNCE_SILENT

    def resolved_rate(self):
        """The engine-scale rate number, or None for "engine default"."""
        return RATE_PRESETS.get(self.engine, {}).get(self.rate_preset)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "SpeechSettings":
        path = path or DEFAULT_SETTINGS_PATH
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception:
            return cls()
        if not isinstance(raw, dict):
            return cls()
        settings = cls()
        level = str(raw.get("announce", ANNOUNCE_FULL))
        settings.announce = level if level in ANNOUNCE_LEVELS else ANNOUNCE_FULL
        settings.announce_all_sessions = bool(raw.get("announce_all_sessions", True))
        settings.announce_own = bool(raw.get("announce_own", True))
        settings.engine = str(raw.get("engine", "auto")) or "auto"
        settings.voice = str(raw.get("voice", ""))
        preset = str(raw.get("rate_preset", "default"))
        settings.rate_preset = preset if preset in RATE_PRESET_LABELS else "default"
        return settings

    def save(self, path: Optional[Path] = None) -> None:
        path = Path(path or DEFAULT_SETTINGS_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Bundled script location
# ---------------------------------------------------------------------------


def _script_dir() -> Path:
    if getattr(sys, "frozen", False):
        # `Path(x) or fallback` never reaches the fallback: Path("") is
        # Path("."), which is truthy, so a missing _MEIPASS resolved the
        # scripts against the current working directory. Test the string.
        meipass = getattr(sys, "_MEIPASS", "")
        base = Path(meipass) if meipass else Path(sys.executable).parent
        return base / "theclaudehub" / "speech"
    return Path(__file__).resolve().parent / "speech"


# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------


def default_options() -> List[SpeechOption]:
    """What the picker offers when probing fails or has not finished.

    "Automatic" always works — the engine scripts fall through to a system
    voice on their own — so a failed probe degrades to fewer choices, never
    to a broken feature.
    """
    options = [
        SpeechOption("auto", "", "Automatic (screen reader first, then a system voice)")
    ]
    if sys.platform == "win32":
        options += [
            SpeechOption("jaws", "", "JAWS screen reader"),
            SpeechOption("nvda", "", "NVDA screen reader"),
        ]
    elif sys.platform == "darwin":
        options += [
            SpeechOption("voiceover", "", "VoiceOver"),
            SpeechOption("say", "", "macOS system voice (default)"),
        ]
    return options


def _parse_windows_probe(raw: str) -> List[SpeechOption]:
    data = json.loads(raw)
    options = [
        SpeechOption("auto", "", "Automatic (screen reader first, then a system voice)")
    ]

    def _as_list(value):
        # PowerShell 5.1 serialises a one-element array as a bare object.
        if isinstance(value, dict):
            return [value]
        return value or []

    for reader in _as_list(data.get("screenReaders")):
        if not reader.get("available"):
            continue
        name = reader.get("name") or reader.get("engine", "").upper()
        suffix = "" if reader.get("running") else " (not running right now)"
        options.append(
            SpeechOption(reader.get("engine", ""), "", f"{name} screen reader{suffix}")
        )

    for voice in _as_list(data.get("systemVoices")):
        engine = voice.get("engine", "")
        if engine not in ("onecore", "sapi"):
            continue
        display = voice.get("displayName", "") or voice.get("match", "")
        kind = "OneCore" if engine == "onecore" else "SAPI"
        options.append(
            SpeechOption(engine, voice.get("match", display),
                         f"{display} — Windows voice ({kind})")
        )
    return options


def _parse_mac_voices(raw: str) -> List[SpeechOption]:
    """Voices out of ``say -v '?'`` lines, English only (there are 400+)."""
    options: List[SpeechOption] = []
    for line in raw.splitlines():
        match = re.match(r"^(.*?)\s{2,}([a-z]{2}[_-][A-Z]{2})\s+#", line)
        if not match:
            continue
        name, locale = match.group(1).strip(), match.group(2)
        if not locale.startswith("en"):
            continue
        options.append(SpeechOption("say", name, f"{name} ({locale}) — macOS voice"))
    return options


def list_speech_options(timeout: float = 25.0) -> List[SpeechOption]:
    """Probe this machine for speech routes. Falls back to defaults on error.

    Windows runs the bundled ClaudeSpeak probe (JAWS COM registration, NVDA
    controller DLL with a PE-architecture check, OneCore and SAPI voice
    lists). macOS asks ``say`` directly and checks for VoiceOver — no shell
    probe, so there is no jq dependency for enumeration.
    """
    try:
        if sys.platform == "win32":
            probe = _script_dir() / "speak-voices.ps1"
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                 "-File", str(probe)],
                capture_output=True, text=True, timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            if result.returncode == 0 and result.stdout.strip():
                return _parse_windows_probe(result.stdout)
        elif sys.platform == "darwin":
            options = [
                SpeechOption("auto", "",
                             "Automatic (VoiceOver if running, else a system voice)"),
                SpeechOption("voiceover", "", "VoiceOver"),
            ]
            result = subprocess.run(
                ["/usr/bin/say", "-v", "?"],
                capture_output=True, text=True, timeout=timeout,
            )
            if result.returncode == 0:
                options.extend(_parse_mac_voices(result.stdout))
            return options
    except Exception:
        # A failed probe (no PowerShell, timeout, malformed JSON) must
        # degrade to the static defaults below, never break the settings UI.
        pass
    return default_options()


# ---------------------------------------------------------------------------
# Speaking
# ---------------------------------------------------------------------------

#: What a code block is read as.
CODE_NOTE = "Code block omitted."
# An unclosed fence (a pasted, truncated snippet) runs to the end of the text.
_FENCED_CODE = re.compile(r"```.*?(?:```|\Z)", re.DOTALL)
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_HEADING = re.compile(r"^#{1,6}\s*", re.MULTILINE)
_QUOTE = re.compile(r"^[ \t]*(?:>[ \t]?)+", re.MULTILINE)
_RULE = re.compile(r"^[ \t]*(?:[-*_][ \t]*){3,}$", re.MULTILINE)
_EMPHASIS = re.compile(r"(\*{1,3})(\S(?:.*?\S)?)\1")
# Underscores only count as emphasis at a word boundary. Without the
# lookarounds this ate the internal underscores of snake_case identifiers:
# "MAX_TOOL_ROUNDS" was spoken as "MAXTOOLROUNDS" and "some_var_name" as
# "somevarname" — names that do not exist in the code being discussed.
_EMPHASIS_UNDERSCORE = re.compile(r"(?<!\w)(_{1,3})(\S(?:.*?\S)?)\1(?!\w)")


def without_code_blocks(text: str, replacement: str) -> str:
    """Fenced code blocks, closed or not, replaced by ``replacement``."""
    return _FENCED_CODE.sub(replacement, text)


def strip_for_speech(text: str) -> str:
    """Markdown → something worth hearing.

    Code blocks become a short note instead of minutes of punctuation
    soup; links keep their text and lose their URL; heading and emphasis
    markers vanish, and so do quote markers and horizontal rules.
    Deliberately light-handed — the goal is listenable, not a full renderer.
    """
    text = without_code_blocks(text or "", f" {CODE_NOTE} ")
    text = _INLINE_CODE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _HEADING.sub("", text)
    text = _QUOTE.sub("", text)
    text = _RULE.sub("", text)
    text = _EMPHASIS.sub(r"\2", text)
    text = _EMPHASIS_UNDERSCORE.sub(r"\2", text)
    text = text.replace("|", " ")
    return text.strip()


class Speaker:
    """Runs the bundled engine script, one utterance at a time.

    Utterances are queued and spoken in order by a background thread, each
    engine process finishing before the next starts, so two system-voice
    utterances never talk over each other. An interrupting utterance (an
    announcement) first stops everything: the queue is emptied and every
    engine process still running is killed (ClaudeSpeak's model, held
    in-process). A non-interrupting one (a short confirmation) waits its turn.
    For screen-reader routes the interrupt also happens at the API level —
    ``SayString(text, true)`` / ``nvdaController_cancelSpeech()`` — because
    killing our process cannot silence speech the reader already queued.
    """

    def __init__(self, popen=subprocess.Popen):
        self._popen = popen
        self._lock = threading.Lock()
        self._queue: "deque[list]" = deque()
        self._running: List[subprocess.Popen] = []
        self._worker: Optional[threading.Thread] = None
        self._generation = 0

    @property
    def workdir(self) -> Path:
        path = Path(tempfile.gettempdir()) / "theclaudehub-speak"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _command(self, text_file: Path, config_file: Path) -> Optional[list]:
        script_dir = _script_dir()
        if sys.platform == "win32":
            return [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(script_dir / "speak-engine.ps1"),
                "-Path", str(text_file), "-ConfigPath", str(config_file),
            ]
        if sys.platform == "darwin":
            return [
                "/bin/bash", str(script_dir / "speak-engine.sh"),
                "--path", str(text_file), "--config", str(config_file),
            ]
        return None

    def speak(self, text: str, settings: SpeechSettings, interrupt: bool = True) -> bool:
        """Queue ``text``; returns False when speech is unavailable.

        Never raises and never blocks. ``interrupt=True`` stops whatever is
        being said or waiting first; ``interrupt=False`` (TheClaudeHub's short
        confirmations) waits for it, and asks a screen reader to queue rather
        than cut itself off.
        """
        spoken = strip_for_speech(text)
        if not spoken:
            return False
        if interrupt:
            self.stop()
        try:
            # One file pair per utterance: two utterances close together
            # must not overwrite each other's text before it is read.
            self._sweep_old_files()
            stem = f"say-{time.time_ns()}"
            text_file = self.workdir / f"{stem}.txt"
            config_file = self.workdir / f"{stem}.json"
            # UTF-8 without BOM on purpose: the engine scripts read UTF-8,
            # and a BOM breaks ConvertFrom-Json in Windows PowerShell.
            text_file.write_text(spoken, encoding="utf-8")
            config_file.write_text(
                json.dumps(
                    {
                        "engine": settings.engine,
                        "voice": settings.voice,
                        "rate": settings.resolved_rate(),
                        "interrupt": interrupt,
                        "nvdaClientDll": "",
                    }
                ),
                encoding="utf-8",
            )
            command = self._command(text_file, config_file)
            if command is None:
                return False
        except Exception:
            return False
        self._log(spoken, settings, interrupt)
        with self._lock:
            self._queue.append(command)
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._drain, name="speech",
                                                daemon=True)
                self._worker.start()
        return True

    def _drain(self) -> None:
        while True:
            with self._lock:
                if not self._queue:
                    self._worker = None
                    return
                command = self._queue.popleft()
                generation = self._generation
            kwargs = {}
            if sys.platform == "win32":
                kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            try:
                process = self._popen(command, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL,
                                      stdin=subprocess.DEVNULL, **kwargs)
            except Exception:
                continue
            with self._lock:
                if generation != self._generation:
                    # stop() ran while this one was starting.
                    _kill_quietly(process)
                    continue
                self._running.append(process)
            # No timeout: a system voice reading a long reply at the "Full"
            # level can take minutes, and cutting it off mid-sentence is worse
            # than waiting. stop() (an interrupting announcement, or closing
            # the app) kills it when it needs to end early.
            try:
                process.wait()
            except Exception:
                _kill_quietly(process)
            with self._lock:
                if process in self._running:
                    self._running.remove(process)

    def busy(self) -> bool:
        with self._lock:
            return bool(self._queue or self._running)

    def stop(self) -> None:
        """Empty the queue and kill every engine process. Never raises.

        Stops system-voice audio immediately (the synthesizer lives in those
        processes). Speech already queued inside JAWS/NVDA/VoiceOver keeps
        their own silence key as the off switch — same behaviour as
        ClaudeSpeak.
        """
        with self._lock:
            self._generation += 1
            self._queue.clear()
            running, self._running = self._running, []
        for process in running:
            _kill_quietly(process)

    def _log(self, text: str, settings: SpeechSettings, interrupt: bool) -> None:
        """One line per utterance in ``speech.log`` beside the engine files.

        TheClaudeHub's own record of what it handed to the engine and when;
        a later interrupting utterance can still cut one off, so a line is not
        proof it was heard. The engine script's ``last-route.log`` can't
        serve: ClaudeSpeak's hook
        writes the same file, and it holds only the latest utterance. Kept
        under ``LOG_LIMIT`` bytes by dropping the older half.
        """
        try:
            path = self.workdir / "speech.log"
            flat = " ".join(text.split())
            opening = flat if len(flat) <= 80 else flat[:79] + "…"
            line = (f"{time.strftime('%Y-%m-%d %H:%M:%S')} "
                    f"{'interrupt' if interrupt else 'queue'} {settings.engine} "
                    f"{len(text)} chars: {opening}\n")
            if path.exists() and path.stat().st_size > LOG_LIMIT:
                kept = path.read_text(encoding="utf-8", errors="replace")[-(LOG_LIMIT // 2):]
                kept = kept[kept.find("\n") + 1:]  # start on a whole line
                path.write_text(kept, encoding="utf-8")
            with path.open("a", encoding="utf-8") as log:
                log.write(line)
        except Exception:  # noqa: BLE001 - a log must never stop speech
            pass

    def _sweep_old_files(self, max_age: float = 300.0) -> None:
        cutoff = time.time() - max_age
        try:
            for old in self.workdir.glob("say-*"):
                try:
                    if old.stat().st_mtime < cutoff:
                        old.unlink()
                except OSError:
                    pass
        except OSError:
            pass


def _kill_quietly(process) -> None:
    try:
        if process.poll() is None:
            process.kill()
    except Exception:
        # It may have exited between poll and kill, or the OS may refuse;
        # either way there is nothing further to stop.
        pass


#: Module-level speaker shared by the app — one voice at a time is the point.
speaker = Speaker()

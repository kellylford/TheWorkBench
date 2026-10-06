"""Start TheClaudeHub."""
from __future__ import annotations

import getpass
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Optional

from . import __version__, platform_paths

APP_TITLE = "TheClaudeHub"


def error_log_path() -> Path:
    return platform_paths.app_data_dir() / "error.log"


def log_exception(exc_type, exc, tb, where: str = "", path: Optional[Path] = None) -> None:
    """Append an unhandled exception to error.log. Never raises."""
    path = path or error_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            handle.write(f"--- {stamp} TheClaudeHub {__version__} {where}\n")
            handle.write("".join(traceback.format_exception(exc_type, exc, tb)))
    except Exception:  # noqa: BLE001
        pass


def install_error_logging() -> None:
    """Unhandled exceptions (main thread, worker threads, wx handlers) go to
    error.log in TheClaudeHub's folder as well as stderr, which pythonw drops."""
    previous = sys.excepthook

    def hook(exc_type, exc, tb):
        log_exception(exc_type, exc, tb, "main thread")
        try:
            previous(exc_type, exc, tb)
        except Exception:  # noqa: BLE001
            pass

    def thread_hook(args):
        log_exception(args.exc_type, args.exc_value, args.exc_traceback,
                      f"thread {getattr(args.thread, 'name', '?')}")

    sys.excepthook = hook
    threading.excepthook = thread_hook


def is_hub_window_title(title: str) -> bool:
    return title == APP_TITLE or title.endswith(f" — {APP_TITLE}")


def main() -> int:
    install_error_logging()
    try:
        import wx
    except ImportError:
        print("TheClaudeHub needs wxPython: pip install -r requirements.txt", file=sys.stderr)
        return 1
    from .ui.main_frame import MainFrame

    app = wx.App(False)
    app.SetAppName(APP_TITLE)
    # One copy at a time: two would both run turns, announce everything
    # twice, and write the same session list.
    checker = wx.SingleInstanceChecker(f"TheClaudeHub-{getpass.getuser()}")
    if checker.IsAnotherRunning():
        if not platform_paths.bring_window_forward(is_hub_window_title):
            wx.MessageBox("TheClaudeHub is already running. Switch to it with Alt+Tab.",
                          APP_TITLE, wx.OK | wx.ICON_INFORMATION)
        return 0
    frame = MainFrame()
    frame.Centre()
    frame.Show()
    app.MainLoop()
    del checker
    return 0


if __name__ == "__main__":
    sys.exit(main())

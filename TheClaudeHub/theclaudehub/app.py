"""Start TheClaudeHub."""
from __future__ import annotations

import sys


def main() -> int:
    try:
        import wx
    except ImportError:
        print("TheClaudeHub needs wxPython: pip install -r requirements.txt", file=sys.stderr)
        return 1
    from .ui.main_frame import MainFrame

    app = wx.App(False)
    app.SetAppName("TheClaudeHub")
    frame = MainFrame()
    frame.Centre()
    frame.Show()
    app.MainLoop()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""TheClaudeHub's dialogs: New Session, Settings, Keyboard Shortcuts."""
from __future__ import annotations

import os

import wx

from ..claude_cli import DEFAULT_PERMISSION_MODE, PERMISSION_MODES
from ..speech import (ANNOUNCE_LABELS, ANNOUNCE_LEVELS, RATE_PRESET_LABELS,
                      SpeechSettings)
from ..ui_text import shortcuts_text
from .a11y import set_accessible_name


class ShortcutsDialog(wx.Dialog):
    def __init__(self, parent):
        super().__init__(parent, title="Keyboard Shortcuts", size=(620, 520),
                         style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(wx.StaticText(self, label="&Shortcuts:"), 0, wx.LEFT | wx.TOP, 8)
        text = wx.TextCtrl(self, value=shortcuts_text(),
                           style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2)
        set_accessible_name(text, "Keyboard shortcuts")
        sizer.Add(text, 1, wx.EXPAND | wx.ALL, 8)
        close = wx.Button(self, wx.ID_CANCEL, "&Close")
        close.SetDefault()
        sizer.Add(close, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        self.SetSizer(sizer)
        self.SetEscapeId(wx.ID_CANCEL)
        wx.CallAfter(text.SetFocus)


PERMISSION_NOTE = (
    "Nobody can approve a permission prompt while TheClaudeHub runs a turn, so "
    "anything that would ask is refused straight away, and the chat and the "
    "announcement say what was refused.")


class NewSessionDialog(wx.Dialog):
    """Folder, title, permission mode, first message."""

    def __init__(self, parent, default_folder: str):
        super().__init__(parent, title="New TheClaudeHub Session", size=(640, 520),
                         style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        outer = wx.BoxSizer(wx.VERTICAL)
        grid = wx.FlexGridSizer(cols=2, vgap=8, hgap=8)
        grid.AddGrowableCol(1, 1)

        grid.Add(wx.StaticText(self, label="&Folder:"), 0, wx.ALIGN_CENTER_VERTICAL)
        folder_row = wx.BoxSizer(wx.HORIZONTAL)
        self.folder = wx.TextCtrl(self, value=default_folder)
        set_accessible_name(self.folder, "Folder")
        folder_row.Add(self.folder, 1, wx.EXPAND | wx.RIGHT, 6)
        browse = wx.Button(self, label="&Browse...")
        folder_row.Add(browse, 0)
        grid.Add(folder_row, 1, wx.EXPAND)

        grid.Add(wx.StaticText(self, label="&Title:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.title_text = wx.TextCtrl(self)
        set_accessible_name(self.title_text, "Title (optional)")
        grid.Add(self.title_text, 1, wx.EXPAND)

        grid.Add(wx.StaticText(self, label="Permission m&ode:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.mode = wx.Choice(self, choices=[label for _v, label in PERMISSION_MODES])
        set_accessible_name(self.mode, "Permission mode")
        values = [v for v, _l in PERMISSION_MODES]
        self.mode.SetSelection(values.index(DEFAULT_PERMISSION_MODE))
        grid.Add(self.mode, 1, wx.EXPAND)
        outer.Add(grid, 0, wx.EXPAND | wx.ALL, 10)

        # A read-only text box rather than a static label, so it is in the tab
        # order and a screen reader reaches it.
        outer.Add(wx.StaticText(self, label="About &permissions:"), 0, wx.LEFT, 10)
        note = wx.TextCtrl(self, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2,
                           value=PERMISSION_NOTE)
        set_accessible_name(note, "About permissions")
        note.SetMinSize((-1, 60))
        outer.Add(note, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 10)

        outer.Add(wx.StaticText(self, label="First &message:"), 0, wx.LEFT | wx.TOP, 10)
        self.message = wx.TextCtrl(self, style=wx.TE_MULTILINE | wx.TE_RICH2)
        set_accessible_name(self.message, "First message")
        outer.Add(self.message, 1, wx.EXPAND | wx.ALL, 10)

        buttons = wx.StdDialogButtonSizer()
        ok = wx.Button(self, wx.ID_OK, "&Start")
        ok.SetDefault()
        buttons.AddButton(ok)
        buttons.AddButton(wx.Button(self, wx.ID_CANCEL))
        buttons.Realize()
        outer.Add(buttons, 0, wx.EXPAND | wx.ALL, 8)
        self.SetSizer(outer)

        browse.Bind(wx.EVT_BUTTON, self._on_browse)
        ok.Bind(wx.EVT_BUTTON, self._on_ok)
        self.Bind(wx.EVT_CHAR_HOOK, self._on_char_hook)
        wx.CallAfter(self.folder.SetFocus)

    def _on_char_hook(self, event):
        # Ctrl+Enter starts the session from anywhere, as Send does elsewhere.
        if event.GetKeyCode() in (wx.WXK_RETURN, wx.WXK_NUMPAD_ENTER) and event.ControlDown():
            self._on_ok(None)
            return
        event.Skip()

    def _on_browse(self, _event):
        start = self.folder.GetValue().strip()
        with wx.DirDialog(self, "Choose the folder Claude works in",
                          defaultPath=start if os.path.isdir(start) else "",
                          style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dlg:
            if dlg.ShowModal() == wx.ID_OK:
                self.folder.SetValue(dlg.GetPath())
        self.folder.SetFocus()

    def _on_ok(self, _event):
        folder = self.folder.GetValue().strip()
        if not folder or not os.path.isdir(folder):
            wx.MessageBox("That folder doesn't exist. Choose an existing folder.",
                          "New Session", wx.OK | wx.ICON_WARNING, self)
            self.folder.SetFocus()
            return
        if not self.message.GetValue().strip():
            wx.MessageBox("Type the first message for Claude.", "New Session",
                          wx.OK | wx.ICON_WARNING, self)
            self.message.SetFocus()
            return
        self.EndModal(wx.ID_OK)

    def values(self):
        folder = os.path.abspath(self.folder.GetValue().strip())
        message = self.message.GetValue().strip()
        title = " ".join(self.title_text.GetValue().split())
        if not title:
            words = message.split()
            title = " ".join(words[:8]) + ("…" if len(words) > 8 else "")
        index = self.mode.GetSelection()
        mode = PERMISSION_MODES[index][0] if 0 <= index < len(PERMISSION_MODES) \
            else DEFAULT_PERMISSION_MODE
        return folder, title, mode, message


class SettingsDialog(wx.Dialog):
    """Announcements and speech (the Speech tab of IDT's settings, adapted)."""

    def __init__(self, parent, speech: SpeechSettings, options):
        super().__init__(parent, title="Settings", size=(660, 500))
        self._options = list(options)
        outer = wx.BoxSizer(wx.VERTICAL)

        self.level = wx.RadioBox(
            self, label="Announcements",
            choices=[ANNOUNCE_LABELS[level] for level in ANNOUNCE_LEVELS],
            majorDimension=1, style=wx.RA_SPECIFY_COLS)
        self.level.SetSelection(ANNOUNCE_LEVELS.index(speech.announce)
                                if speech.announce in ANNOUNCE_LEVELS else 0)
        outer.Add(self.level, 0, wx.EXPAND | wx.ALL, 10)

        self.all_sessions = wx.CheckBox(
            self, label="Announce when &any listed session finishes a turn, "
                        "not just the open one")
        self.all_sessions.SetValue(speech.announce_all_sessions)
        outer.Add(self.all_sessions, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        self.own_messages = wx.CheckBox(
            self, label="Read your own &messages back when they're sent")
        self.own_messages.SetValue(speech.announce_own)
        outer.Add(self.own_messages, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        grid = wx.FlexGridSizer(rows=2, cols=2, vgap=8, hgap=8)
        grid.AddGrowableCol(1, 1)
        grid.Add(wx.StaticText(self, label="Speech &engine:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.engine_choice = wx.Choice(self, choices=[o.label for o in self._options])
        set_accessible_name(self.engine_choice, "Speech engine")
        grid.Add(self.engine_choice, 1, wx.EXPAND)
        grid.Add(wx.StaticText(self, label="Speaking &rate:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.rate_choice = wx.Choice(
            self, choices=[label.capitalize() for label in RATE_PRESET_LABELS])
        set_accessible_name(self.rate_choice, "Speaking rate")
        grid.Add(self.rate_choice, 0)
        outer.Add(grid, 0, wx.EXPAND | wx.ALL, 10)

        self.rate_note = wx.StaticText(self, label="")
        outer.Add(self.rate_note, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        buttons = wx.StdDialogButtonSizer()
        ok = wx.Button(self, wx.ID_OK)
        ok.SetDefault()
        buttons.AddButton(ok)
        buttons.AddButton(wx.Button(self, wx.ID_CANCEL))
        buttons.Realize()
        outer.Add(buttons, 0, wx.EXPAND | wx.ALL, 8)
        self.SetSizer(outer)

        selected = 0
        for i, option in enumerate(self._options):
            if option.engine == speech.engine and option.voice == speech.voice:
                selected = i
                break
        self.engine_choice.SetSelection(selected)
        try:
            self.rate_choice.SetSelection(RATE_PRESET_LABELS.index(speech.rate_preset))
        except ValueError:
            self.rate_choice.SetSelection(0)
        self.engine_choice.Bind(wx.EVT_CHOICE, lambda e: self._update_rate_state())
        self._update_rate_state()
        wx.CallAfter(self.level.SetFocus)

    def _selected_option(self):
        index = self.engine_choice.GetSelection()
        if index == wx.NOT_FOUND or index >= len(self._options):
            return self._options[0]
        return self._options[index]

    def _update_rate_state(self):
        option = self._selected_option()
        self.rate_choice.Enable(option.has_rate)
        if option.is_screen_reader:
            self.rate_note.SetLabel("Voice and rate follow your screen reader's own settings.")
        elif option.has_rate:
            self.rate_note.SetLabel("")
        else:
            self.rate_note.SetLabel("This engine uses its default rate.")
        self.Layout()

    def get_settings(self) -> SpeechSettings:
        option = self._selected_option()
        index = self.rate_choice.GetSelection()
        preset = RATE_PRESET_LABELS[index] if 0 <= index < len(RATE_PRESET_LABELS) else "default"
        level_index = self.level.GetSelection()
        level = ANNOUNCE_LEVELS[level_index] if 0 <= level_index < len(ANNOUNCE_LEVELS) \
            else ANNOUNCE_LEVELS[0]
        return SpeechSettings(announce=level,
                              announce_all_sessions=self.all_sessions.GetValue(),
                              announce_own=self.own_messages.GetValue(),
                              engine=option.engine, voice=option.voice,
                              rate_preset=preset)


class MessageDialog(wx.Dialog):
    """One message's full text, read-only, to read by line, word and character.

    A RichEdit, like the reply box: checked in the vmtest VM, a RichEdit takes
    its accessible name from the label before it, where a plain multiline
    EDIT reports its contents instead. Escape (or Close) returns to the list,
    on the same message.
    """

    def __init__(self, parent, speaker_label: str, text: str):
        super().__init__(parent, title=f"Message from {speaker_label}"
                         if speaker_label in ("Claude", "You") else speaker_label,
                         size=(720, 520), style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        sizer = wx.BoxSizer(wx.VERTICAL)
        label = f"{speaker_label} said:" if speaker_label in ("Claude", "You") \
            else f"{speaker_label}:"
        sizer.Add(wx.StaticText(self, label="&" + label), 0, wx.LEFT | wx.TOP, 8)
        self.text = wx.TextCtrl(self, value=text,
                                style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2)
        set_accessible_name(self.text, label.rstrip(":"))
        sizer.Add(self.text, 1, wx.EXPAND | wx.ALL, 8)
        close = wx.Button(self, wx.ID_CANCEL, "&Close")
        sizer.Add(close, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        self.SetSizer(sizer)
        self.SetEscapeId(wx.ID_CANCEL)
        self.text.SetInsertionPoint(0)
        wx.CallAfter(self.text.SetFocus)

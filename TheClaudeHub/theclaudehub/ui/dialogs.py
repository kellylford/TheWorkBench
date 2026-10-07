"""TheClaudeHub's dialogs: New Session, Settings, Keyboard Shortcuts."""
from __future__ import annotations

import os

import wx

from ..claude_cli import DEFAULT_PERMISSION_MODE, MODELS, PERMISSION_MODES
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
    "The permission mode decides what Claude may do without asking. When Claude "
    "asks for permission, asks you a question or has a plan for you to approve, "
    "the turn waits: TheClaudeHub announces it, the session shows as needing "
    "you, and Ctrl+Shift+A answers.")


class NewSessionDialog(wx.Dialog):
    """Folder, title, model, permission mode, first message."""

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

        grid.Add(wx.StaticText(self, label="Mo&del:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.model = wx.Choice(self, choices=[label for _v, label in MODELS])
        set_accessible_name(self.model, "Model")
        self.model.SetSelection(0)  # Claude Code's own default
        grid.Add(self.model, 1, wx.EXPAND)

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
        index = self.model.GetSelection()
        model = MODELS[index][0] if 0 <= index < len(MODELS) else ""
        return folder, title, mode, message, model


class SettingsDialog(wx.Dialog):
    """Announcements and speech (the Speech tab of IDT's settings, adapted)."""

    def __init__(self, parent, speech: SpeechSettings, options):
        super().__init__(parent, title="Settings", size=(660, 460))
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


# -- Claude is waiting for an answer (#187, #188) ---------------------------------------
#
# Shared rules: Escape (Answer Later) closes without answering, so the turn
# keeps waiting and Ctrl+Shift+A comes back to it. Nothing refuses or approves
# by accident: Enter's default button is always the harmless choice.

ALLOW, ALLOW_SESSION, DENY = "allow", "session", "deny"
ID_ALLOW = wx.NewIdRef()
ID_ALLOW_SESSION = wx.NewIdRef()
ID_DENY = wx.NewIdRef()


def _read_only_text(parent, value: str, name: str, min_height: int = 160) -> wx.TextCtrl:
    text = wx.TextCtrl(parent, value=value,
                       style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2)
    set_accessible_name(text, name)
    text.SetMinSize((-1, min_height))
    text.SetInsertionPoint(0)
    return text


class PermissionDialog(wx.Dialog):
    """Claude wants to use a tool: Allow, Allow for this session, Deny.

    The request is in a read-only box to read by line (the whole command, or
    the file and what would change). Deny is the default button, so a stray
    Enter refuses; a reason typed for Deny goes back to Claude.
    """

    def __init__(self, parent, session_title: str, request):
        super().__init__(parent, title=f"Claude needs permission: {session_title}",
                         size=(700, 540), style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        self.choice = ""
        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(wx.StaticText(self, label="&Request:"), 0, wx.LEFT | wx.TOP, 8)
        self.request_text = _read_only_text(self, request.detail(), "Request")
        sizer.Add(self.request_text, 1, wx.EXPAND | wx.ALL, 8)
        sizer.Add(wx.StaticText(self, label="&Reason to give Claude if you deny (optional):"),
                  0, wx.LEFT, 8)
        self.reason = wx.TextCtrl(self)
        set_accessible_name(self.reason, "Reason to give Claude if you deny (optional)")
        sizer.Add(self.reason, 0, wx.EXPAND | wx.ALL, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        allow = wx.Button(self, ID_ALLOW, "&Allow")
        row.Add(allow, 0, wx.RIGHT, 6)
        session_label = request.allow_for_session_label()
        if session_label:
            self.session_button = wx.Button(self, ID_ALLOW_SESSION, "Allow for this &session")
            # The button says what it does in full to a screen reader.
            self.session_button.SetToolTip(session_label)
            set_accessible_name(self.session_button, session_label)
            row.Add(self.session_button, 0, wx.RIGHT, 6)
        else:
            self.session_button = None
        deny = wx.Button(self, ID_DENY, "&Deny")
        deny.SetDefault()
        row.Add(deny, 0, wx.RIGHT, 6)
        row.Add(wx.Button(self, wx.ID_CANCEL, "Answer &Later"), 0)
        sizer.Add(row, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        self.SetSizer(sizer)
        self.SetEscapeId(wx.ID_CANCEL)
        for button_id, choice in ((ID_ALLOW, ALLOW), (ID_ALLOW_SESSION, ALLOW_SESSION),
                                  (ID_DENY, DENY)):
            self.Bind(wx.EVT_BUTTON, lambda e, c=choice: self._choose(c), id=button_id)
        wx.CallAfter(self.request_text.SetFocus)

    def _choose(self, choice: str):
        self.choice = choice
        self.EndModal(wx.ID_OK)

    def reason_text(self) -> str:
        return self.reason.GetValue().strip()


OTHER = "Other"


class QuestionDialog(wx.Dialog):
    """Claude's questions (AskUserQuestion), one group per question: the
    options as radio buttons (check boxes when several may be chosen), each
    with its description, and Other with a text box. Send Answers is the
    default button."""

    def __init__(self, parent, session_title: str, request):
        super().__init__(parent, title=f"Claude asks: {session_title}", size=(700, 560),
                         style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        self._questions = request.questions()
        self._controls = []  # per question: (kind, [controls], other text)
        outer = wx.BoxSizer(wx.VERTICAL)
        panel = wx.ScrolledWindow(self, style=wx.VSCROLL)
        panel.SetScrollRate(0, 20)
        sizer = wx.BoxSizer(wx.VERTICAL)
        first = None
        for number, question in enumerate(self._questions, start=1):
            header = str(question.get("header") or f"Question {number}")
            # The question is the group's label: a screen reader reads it on
            # arriving at the first option, which a text above it is not.
            box = wx.StaticBoxSizer(wx.VERTICAL, panel, f"{header}: {question['question']}")
            parent_window = box.GetStaticBox()
            options = [o for o in question.get("options") or [] if isinstance(o, dict)]
            multi = bool(question.get("multiSelect"))
            controls = []
            for index, option in enumerate(options):
                label = str(option.get("label") or f"Option {index + 1}")
                description = str(option.get("description") or "")
                text = f"{label}: {description}" if description else label
                if multi:
                    control = wx.CheckBox(parent_window, label=text)
                else:
                    style = wx.RB_GROUP if index == 0 else 0
                    control = wx.RadioButton(parent_window, label=text, style=style)
                    control.SetValue(False)
                control._hub_label = label
                controls.append(control)
                box.Add(control, 0, wx.ALL, 4)
                first = first or control
            if multi:
                other = wx.CheckBox(parent_window, label=f"{OTHER} (type below)")
            else:
                other = wx.RadioButton(parent_window, label=f"{OTHER} (type below)",
                                       style=0 if controls else wx.RB_GROUP)
                other.SetValue(False)
            other._hub_label = OTHER
            controls.append(other)
            box.Add(other, 0, wx.ALL, 4)
            other_text = wx.TextCtrl(parent_window)
            set_accessible_name(other_text, f"{header}: your own answer")
            box.Add(other_text, 0, wx.EXPAND | wx.ALL, 4)
            other_text.Bind(wx.EVT_TEXT, lambda e, o=other: o.SetValue(True)
                            if e.GetString().strip() else None)
            self._controls.append(("multi" if multi else "single", controls, other_text))
            sizer.Add(box, 0, wx.EXPAND | wx.ALL, 6)
            first = first or other
        panel.SetSizer(sizer)
        outer.Add(panel, 1, wx.EXPAND | wx.ALL, 4)

        row = wx.BoxSizer(wx.HORIZONTAL)
        send = wx.Button(self, wx.ID_OK, "&Send Answers")
        send.SetDefault()
        row.Add(send, 0, wx.RIGHT, 6)
        decline = wx.Button(self, ID_DENY, "&Don't Answer")
        row.Add(decline, 0, wx.RIGHT, 6)
        row.Add(wx.Button(self, wx.ID_CANCEL, "Answer &Later"), 0)
        outer.Add(row, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        self.SetSizer(outer)
        self.SetEscapeId(wx.ID_CANCEL)
        self.declined = False
        send.Bind(wx.EVT_BUTTON, self._on_send)
        decline.Bind(wx.EVT_BUTTON, self._on_decline)
        if first is not None:
            wx.CallAfter(first.SetFocus)

    def _on_decline(self, _event):
        self.declined = True
        self.EndModal(wx.ID_OK)

    def _on_send(self, _event):
        for (_kind, _controls, other_text), question in zip(self._controls, self._questions):
            if not self._answer_for(_controls, other_text):
                wx.MessageBox(f"Choose an answer for: {question['question']}",
                              self.GetTitle(), wx.OK | wx.ICON_WARNING, self)
                (_controls[0] if _controls else other_text).SetFocus()
                return
        self.EndModal(wx.ID_OK)

    @staticmethod
    def _answer_for(controls, other_text) -> str:
        chosen = []
        for control in controls:
            if not control.GetValue():
                continue
            if control._hub_label == OTHER:
                typed = " ".join(other_text.GetValue().split())
                if typed:
                    chosen.append(typed)
            else:
                chosen.append(control._hub_label)
        return ", ".join(chosen)

    def answers(self):
        """{question text: answer} as Claude Code expects it; several
        choices are joined with commas."""
        return {question["question"]: self._answer_for(controls, other_text)
                for (_kind, controls, other_text), question
                in zip(self._controls, self._questions)}


class PlanDialog(wx.Dialog):
    """Claude's plan, to read, then Approve (choosing the permission mode to
    carry on in) or Keep Planning with a note. Keep Planning is the default
    button: approving starts real changes, so it needs a deliberate press."""

    def __init__(self, parent, session_title: str, request, modes, default_mode: str):
        super().__init__(parent, title=f"Claude's plan: {session_title}", size=(760, 600),
                         style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER)
        self._modes = list(modes)  # (value, label)
        self.approved = False
        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(wx.StaticText(self, label="&Plan:"), 0, wx.LEFT | wx.TOP, 8)
        self.plan_text = _read_only_text(self, request.plan() or "(Claude sent no plan text.)",
                                         "Plan", min_height=260)
        sizer.Add(self.plan_text, 1, wx.EXPAND | wx.ALL, 8)

        grid = wx.FlexGridSizer(cols=2, vgap=8, hgap=8)
        grid.AddGrowableCol(1, 1)
        grid.Add(wx.StaticText(self, label="If approved, carry on &in:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.mode = wx.Choice(self, choices=[label for _v, label in self._modes])
        set_accessible_name(self.mode, "If approved, carry on in")
        values = [v for v, _l in self._modes]
        self.mode.SetSelection(values.index(default_mode) if default_mode in values else 0)
        grid.Add(self.mode, 1, wx.EXPAND)
        grid.Add(wx.StaticText(self, label="&What to change (for Keep Planning):"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.note = wx.TextCtrl(self)
        set_accessible_name(self.note, "What to change (for Keep Planning)")
        grid.Add(self.note, 1, wx.EXPAND)
        sizer.Add(grid, 0, wx.EXPAND | wx.ALL, 8)

        row = wx.BoxSizer(wx.HORIZONTAL)
        approve = wx.Button(self, ID_ALLOW, "&Approve")
        row.Add(approve, 0, wx.RIGHT, 6)
        keep = wx.Button(self, ID_DENY, "&Keep Planning")
        keep.SetDefault()
        row.Add(keep, 0, wx.RIGHT, 6)
        row.Add(wx.Button(self, wx.ID_CANCEL, "Answer &Later"), 0)
        sizer.Add(row, 0, wx.ALIGN_RIGHT | wx.ALL, 8)
        self.SetSizer(sizer)
        self.SetEscapeId(wx.ID_CANCEL)
        approve.Bind(wx.EVT_BUTTON, lambda e: self._finish(True))
        keep.Bind(wx.EVT_BUTTON, lambda e: self._finish(False))
        wx.CallAfter(self.plan_text.SetFocus)

    def _finish(self, approved: bool):
        self.approved = approved
        self.EndModal(wx.ID_OK)

    def chosen_mode(self) -> str:
        index = self.mode.GetSelection()
        return self._modes[index][0] if 0 <= index < len(self._modes) else self._modes[0][0]

    def note_text(self) -> str:
        return self.note.GetValue().strip()

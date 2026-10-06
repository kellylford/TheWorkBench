"""TheClaudeHub's window: the session list, and the session view.

Accessibility decisions, and why
--------------------------------
* **Both lists are ``wx.ListBox``.** One tab stop, arrow keys, and every item
  is one string a screen reader reads whole (IDT's chat app made the same
  choice). A session reads "title, repo, state, age"; a message reads
  "You: first line" or "Claude: first line".
* **The full message is a read-only multiline text box** under the list, so
  it can be read by line, word and character. Enter on a message moves there.
* **Two pages in one window** (a ``wx.Simplebook``) rather than a second
  window: Escape goes back and the list keeps its place.
* **Mnemonics stay off the menu bar's letters.** Menus are Session, View and
  Help, so no control on a page uses Alt+S, Alt+V or Alt+H (a panel mnemonic
  would take the letter away from the menu).
* **Refreshes do not move the reader.** The list is only rewritten where it
  changed, and the selection follows the same session, not the same row.
* **Announcements are spoken through the screen reader** (or a system
  voice) by the speech engine, never by moving focus, and also go to the
  status bar.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

import wx

from .. import __version__, announce, platform_paths
from ..claude_cli import (ResumeRefused, TurnEvent, TurnRunner,
                          build_new_command, build_resume_command, new_session_id)
from ..hub import Snapshot, collect, finished_turns, last_reply_from_tail
from ..own_store import OwnSession, OwnSessionStore
from ..sessions import IDLE, NEEDS_YOU, WORKING, SessionInfo
from ..speech import SpeechSettings, default_options, list_speech_options, speaker
from ..transcript import ASSISTANT, ERROR, PLAN, QUESTION, ChatMessage, TranscriptReader
from .a11y import set_accessible_name
from .dialogs import NewSessionDialog, SettingsDialog, ShortcutsDialog

APP_NAME = "TheClaudeHub"
LIST_REFRESH_MS = 5000
CHAT_REFRESH_MS = 2000

_REPLY_KINDS = (ASSISTANT, QUESTION, PLAN, ERROR)


def claude_link(desktop_session_id: str) -> str:
    return f"claude://claude.ai/epitaxy/{desktop_session_id}"


class MainFrame(wx.Frame):
    def __init__(self, store: Optional[OwnSessionStore] = None):
        super().__init__(None, title=APP_NAME, size=_fitting_size(1000, 720))
        self.store = store or OwnSessionStore()
        self.speech = SpeechSettings.load()
        self._speech_options = None
        threading.Thread(target=self._probe_speech, daemon=True).start()

        self._pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="hub")
        self._snapshot = Snapshot()
        self._snapshot_busy = False
        self._previous_states: Dict[str, str] = {}
        self._first_snapshot = True
        self._list_keys: List[str] = []
        self._runners: Dict[str, TurnRunner] = {}
        self._denials: Dict[str, List[str]] = {}
        self._pending_refresh: Optional[bool] = None
        self._last_announcement = ""

        # Session view state.
        self._open: Optional[SessionInfo] = None
        self._open_generation = 0
        self._reader: Optional[TranscriptReader] = None
        self._reader_busy = False
        self._chat_messages: List[ChatMessage] = []
        self._chat_loaded = False
        self._show_activity = False
        self._drafts: Dict[str, str] = {}  # unsent reply text, per session

        self._build_menu()
        self._build_ui()
        self.CreateStatusBar(1)
        self.SetStatusText("Loading sessions…")
        self.Bind(wx.EVT_CHAR_HOOK, self._on_char_hook)
        self.Bind(wx.EVT_CLOSE, self._on_close)

        self._list_timer = wx.Timer(self)
        self.Bind(wx.EVT_TIMER, lambda e: self.refresh_sessions(), self._list_timer)
        self._list_timer.Start(LIST_REFRESH_MS)
        self._chat_timer = wx.Timer(self)
        self.Bind(wx.EVT_TIMER, lambda e: self._refresh_chat(), self._chat_timer)

        if self.store.load_error:
            wx.CallAfter(wx.MessageBox, self.store.load_error, APP_NAME,
                         wx.OK | wx.ICON_WARNING, self)
        self.refresh_sessions()
        self.session_list.SetFocus()

    # ------------------------------------------------------------------ menus

    def _build_menu(self):
        bar = wx.MenuBar()
        session = wx.Menu()
        # Enter is handled on the list itself (a menu accelerator for Enter
        # would steal it from every button and text box in the window).
        self._item(session, "&Open Session", self.on_open_session)
        self._item(session, "Open in &Claude\tCtrl+O", self.on_open_in_claude)
        self._item(session, "&New Session...\tCtrl+N", self.on_new_session)
        self._item(session, "&Refresh\tF5", lambda e: self.refresh_sessions(force=True))
        self._item(session, "&Forget TheClaudeHub Session...", self.on_forget)
        session.AppendSeparator()
        self._item(session, "&Settings...\tCtrl+,", self.on_settings, wx.ID_PREFERENCES)
        session.AppendSeparator()
        self._item(session, "E&xit", lambda e: self.Close(), wx.ID_EXIT)
        bar.Append(session, "&Session")

        view = wx.Menu()
        self._item(view, "&Back to Session List", lambda e: self.show_list())
        self._item(view, "C&hat Tab\tCtrl+1", lambda e: self._select_tab(0))
        self._item(view, "&Reply Tab\tCtrl+2", lambda e: self._select_tab(1))
        self.activity_item = view.AppendCheckItem(wx.ID_ANY, "Show &Tool Activity\tCtrl+T")
        self.Bind(wx.EVT_MENU, self.on_toggle_activity_menu, self.activity_item)
        self._item(view, "Sto&p Running Turn\tCtrl+.", self.on_stop)
        self._item(view, "Repeat &Last Announcement\tCtrl+Shift+R",
                   lambda e: self._say(self._last_announcement, force=True))
        bar.Append(view, "&View")

        help_menu = wx.Menu()
        self._item(help_menu, "&Keyboard Shortcuts\tF1",
                   lambda e: self._modal(ShortcutsDialog(self)))
        self._item(help_menu, "&About", self.on_about, wx.ID_ABOUT)
        bar.Append(help_menu, "&Help")
        self.SetMenuBar(bar)

    def _item(self, menu, label, handler, item_id=wx.ID_ANY):
        item = menu.Append(item_id, label)
        self.Bind(wx.EVT_MENU, handler, item)
        return item

    # --------------------------------------------------------------------- UI

    def _build_ui(self):
        self.book = wx.Simplebook(self)

        # Page 0: session list.
        page = wx.Panel(self.book)
        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(wx.StaticText(page, label="Session &list:"), 0, wx.LEFT | wx.TOP, 8)
        self.session_list = wx.ListBox(page, style=wx.LB_SINGLE, name="Session list")
        set_accessible_name(self.session_list, "Session list")
        sizer.Add(self.session_list, 1, wx.EXPAND | wx.ALL, 8)
        row = wx.BoxSizer(wx.HORIZONTAL)
        open_btn = wx.Button(page, label="&Open")
        claude_btn = wx.Button(page, label="Open in &Claude")
        new_btn = wx.Button(page, label="&New Session...")
        refresh_btn = wx.Button(page, label="&Refresh")
        for button in (open_btn, claude_btn, new_btn, refresh_btn):
            row.Add(button, 0, wx.RIGHT, 6)
        sizer.Add(row, 0, wx.ALL, 8)
        page.SetSizer(sizer)
        open_btn.Bind(wx.EVT_BUTTON, self.on_open_session)
        claude_btn.Bind(wx.EVT_BUTTON, self.on_open_in_claude)
        new_btn.Bind(wx.EVT_BUTTON, self.on_new_session)
        refresh_btn.Bind(wx.EVT_BUTTON, lambda e: self.refresh_sessions(force=True))
        self.session_list.Bind(wx.EVT_LISTBOX_DCLICK, self.on_open_session)
        self.book.AddPage(page, "Sessions")

        # Page 1: session view.
        view = wx.Panel(self.book)
        vsizer = wx.BoxSizer(wx.VERTICAL)
        self.session_heading = wx.StaticText(view, label="")
        vsizer.Add(self.session_heading, 0, wx.LEFT | wx.TOP | wx.RIGHT, 8)
        self.notebook = wx.Notebook(view, name="Session tabs")
        set_accessible_name(self.notebook, "Session tabs")
        vsizer.Add(self.notebook, 1, wx.EXPAND | wx.ALL, 8)

        # Chat tab.
        chat = wx.Panel(self.notebook)
        csizer = wx.BoxSizer(wx.VERTICAL)
        self.messages_label = wx.StaticText(chat, label="&Messages:")
        csizer.Add(self.messages_label, 0, wx.LEFT | wx.TOP, 6)
        self.chat_list = wx.ListBox(chat, style=wx.LB_SINGLE, name="Messages")
        set_accessible_name(self.chat_list, "Messages")
        csizer.Add(self.chat_list, 2, wx.EXPAND | wx.ALL, 6)
        csizer.Add(wx.StaticText(chat, label="Message &text:"), 0, wx.LEFT, 6)
        self.message_text = wx.TextCtrl(
            chat, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2 | wx.TE_NOHIDESEL)
        set_accessible_name(self.message_text, "Message text")
        csizer.Add(self.message_text, 1, wx.EXPAND | wx.ALL, 6)
        crow = wx.BoxSizer(wx.HORIZONTAL)
        self.activity_check = wx.CheckBox(chat, label="Show tool &activity")
        crow.Add(self.activity_check, 0, wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 12)
        self.chat_claude_btn = wx.Button(chat, label="Open in &Claude")
        crow.Add(self.chat_claude_btn, 0, wx.RIGHT, 6)
        back_btn = wx.Button(chat, label="&Back to Sessions")
        crow.Add(back_btn, 0)
        csizer.Add(crow, 0, wx.ALL, 6)
        chat.SetSizer(csizer)
        self.notebook.AddPage(chat, "Chat")
        self.chat_list.Bind(wx.EVT_LISTBOX, self._on_message_selected)
        self.activity_check.Bind(wx.EVT_CHECKBOX, self.on_toggle_activity_check)
        self.chat_claude_btn.Bind(wx.EVT_BUTTON, self.on_open_in_claude)
        back_btn.Bind(wx.EVT_BUTTON, lambda e: self.show_list())

        # Reply tab: one panel for TheClaudeHub's sessions, one for desktop ones.
        reply = wx.Panel(self.notebook)
        rsizer = wx.BoxSizer(wx.VERTICAL)

        self.own_reply = wx.Panel(reply)
        osizer = wx.BoxSizer(wx.VERTICAL)
        osizer.Add(wx.StaticText(self.own_reply,
                                 label="&Your message (Ctrl+Enter sends):"), 0, wx.ALL, 6)
        self.reply_text = wx.TextCtrl(self.own_reply, style=wx.TE_MULTILINE)
        set_accessible_name(self.reply_text, "Your message")
        osizer.Add(self.reply_text, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)
        orow = wx.BoxSizer(wx.HORIZONTAL)
        self.send_btn = wx.Button(self.own_reply, label="Sen&d")
        self.stop_btn = wx.Button(self.own_reply, label="Sto&p")
        orow.Add(self.send_btn, 0, wx.RIGHT, 6)
        orow.Add(self.stop_btn, 0, wx.RIGHT, 12)
        self.turn_status = wx.StaticText(self.own_reply, label="")
        orow.Add(self.turn_status, 1, wx.ALIGN_CENTER_VERTICAL)
        osizer.Add(orow, 0, wx.EXPAND | wx.ALL, 6)
        self.own_reply.SetSizer(osizer)
        self.send_btn.Bind(wx.EVT_BUTTON, self.on_send)
        self.stop_btn.Bind(wx.EVT_BUTTON, self.on_stop)

        self.desktop_reply = wx.Panel(reply)
        dsizer = wx.BoxSizer(wx.VERTICAL)
        # A read-only text box, not a static label: it is focusable, so the
        # explanation is the first thing heard on Ctrl+Tab into this tab.
        dsizer.Add(wx.StaticText(self.desktop_reply, label="About replying:"), 0,
                   wx.LEFT | wx.TOP, 6)
        self.desktop_note = wx.TextCtrl(
            self.desktop_reply, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_NO_VSCROLL,
            value=("This session belongs to the Claude desktop app, so you reply to it "
                   "in Claude. TheClaudeHub only reads it: sending from here while the "
                   "desktop app has it open could run two turns at once and tangle "
                   "the conversation. Open in Claude switches the desktop app to it."))
        set_accessible_name(self.desktop_note, "Replying to this session")
        dsizer.Add(self.desktop_note, 0, wx.EXPAND | wx.ALL, 6)
        self.desktop_note.SetMinSize((-1, 90))
        self.reply_claude_btn = wx.Button(self.desktop_reply, label="Open in &Claude")
        dsizer.Add(self.reply_claude_btn, 0, wx.ALL, 6)
        self.desktop_reply.SetSizer(dsizer)
        self.reply_claude_btn.Bind(wx.EVT_BUTTON, self.on_open_in_claude)

        rsizer.Add(self.own_reply, 1, wx.EXPAND)
        rsizer.Add(self.desktop_reply, 1, wx.EXPAND)
        reply.SetSizer(rsizer)
        self.reply_page = reply
        self.notebook.AddPage(reply, "Reply")

        view.SetSizer(vsizer)
        self.book.AddPage(view, "Session")

        frame_sizer = wx.BoxSizer(wx.VERTICAL)
        frame_sizer.Add(self.book, 1, wx.EXPAND)
        self.SetSizer(frame_sizer)

    # ------------------------------------------------------------ helpers

    def _modal(self, dialog):
        try:
            return dialog.ShowModal()
        finally:
            dialog.Destroy()

    def _status(self, text: str):
        self.SetStatusText(announce.status_text(text))

    def _say(self, text: Optional[str], force: bool = False):
        """Speak an announcement (per the level) and put it in the status bar."""
        if not text:
            return
        self._last_announcement = text
        self._status(text)
        if force or self.speech.enabled:
            speaker.speak(text, self.speech)

    def _probe_speech(self):
        try:
            self._speech_options = list_speech_options()
        except Exception:  # noqa: BLE001
            self._speech_options = None

    def _selected_session(self) -> Optional[SessionInfo]:
        if self.book.GetSelection() == 1 and self._open is not None:
            return self._current_info(self._open.key) or self._open
        index = self.session_list.GetSelection()
        if index == wx.NOT_FOUND or index >= len(self._list_keys):
            return None
        return self._current_info(self._list_keys[index])

    def _current_info(self, key: str) -> Optional[SessionInfo]:
        for info in self._snapshot.sessions:
            if info.key == key:
                return info
        return None

    # ----------------------------------------------------------- session list

    def refresh_sessions(self, force: bool = False):
        if self._snapshot_busy:
            # Run again when the current pass lands, so F5 is never lost.
            self._pending_refresh = bool(force or self._pending_refresh)
            return
        self._snapshot_busy = True
        own = [OwnSession(**vars(s)) for s in self.store.all()]
        running = set(self._runners)

        def work():
            try:
                snap = collect(own, running)
                ended = finished_turns(self._previous_states, snap.sessions)
                replies = {}
                if not self._first_snapshot and self.speech.announce_all_sessions:
                    for info in ended:
                        if info.is_own or not info.cli_session_id:
                            continue  # own sessions announce from their own turn
                        path = platform_paths.transcript_path(info.cwd, info.cli_session_id)
                        replies[info.key] = last_reply_from_tail(path) if path else ""
                wx.CallAfter(self._apply_snapshot, snap, ended, replies, force)
            except Exception as exc:  # noqa: BLE001
                wx.CallAfter(self._snapshot_failed, exc)

        self._pool.submit(work)

    def _snapshot_failed(self, exc):
        self._snapshot_busy = False
        self._status(f"Couldn't read the session list: {exc}")
        self._run_pending_refresh()

    def _run_pending_refresh(self):
        if self._pending_refresh is not None:
            force, self._pending_refresh = self._pending_refresh, None
            self.refresh_sessions(force=force)

    def _apply_snapshot(self, snap: Snapshot, ended, replies, force):
        self._snapshot_busy = False
        if not self:
            return
        self._snapshot = snap
        self._previous_states = {s.key: s.state for s in snap.sessions}
        first = self._first_snapshot
        self._first_snapshot = False
        self._update_session_list(snap.sessions)

        if not first and self.speech.announce_all_sessions:
            for info in ended:
                if info.is_own:
                    continue
                if self._open is not None and info.key == self._open.key:
                    continue  # the open session announces its own messages
                text = announce.turn_end_text(info.title, info.state, info.detail,
                                              replies.get(info.key, ""), self.speech.announce)
                if text:
                    self._say(text)
                else:
                    self._status(f"{info.title} finished.")

        if self._open is not None:
            current = self._current_info(self._open.key)
            if current is not None:
                self._open = current
                self._update_heading()
        if first or force:
            waiting = sum(1 for s in snap.sessions if s.state == NEEDS_YOU)
            working = sum(1 for s in snap.sessions if s.state == WORKING)
            text = (f"{len(snap.sessions)} sessions: {waiting} need you, "
                    f"{working} working.")
            if snap.unreadable_files:
                text += f" Couldn't read {snap.unreadable_files} session files."
            self._status(text)
        self._run_pending_refresh()

    def _update_session_list(self, sessions: List[SessionInfo]):
        """Rewrite only what changed, keeping the selection on the same session."""
        now = int(time.time() * 1000)
        keys = [s.key for s in sessions]
        lines = [s.list_line(now) for s in sessions]
        selected_key = None
        index = self.session_list.GetSelection()
        if index != wx.NOT_FOUND and index < len(self._list_keys):
            selected_key = self._list_keys[index]

        if keys == self._list_keys:
            for i, line in enumerate(lines):
                if self.session_list.GetString(i) == line:
                    continue
                if i == index and _same_but_age(self.session_list.GetString(i), line):
                    continue  # don't make the reader re-read for a clock tick
                self.session_list.SetString(i, line)
            return

        self.session_list.Set(lines)
        self._list_keys = keys
        if not lines:
            return
        if selected_key in keys:
            self.session_list.SetSelection(keys.index(selected_key))
        else:
            self.session_list.SetSelection(0)

    def on_forget(self, _event):
        info = self._selected_session()
        if info is None or not info.is_own:
            wx.MessageBox("Only sessions TheClaudeHub started can be forgotten. "
                          "Desktop app sessions are managed in Claude.",
                          APP_NAME, wx.OK | wx.ICON_INFORMATION, self)
            return
        if info.cli_session_id in self._runners:
            wx.MessageBox("A turn is running in that session. Stop it first.",
                          APP_NAME, wx.OK | wx.ICON_INFORMATION, self)
            return
        answer = wx.MessageBox(
            f"Remove \"{info.title}\" from TheClaudeHub's list? Its transcript stays on "
            "disk; this only stops TheClaudeHub listing it.",
            "Forget Session", wx.YES_NO | wx.NO_DEFAULT | wx.ICON_QUESTION, self)
        if answer != wx.YES:
            return
        self.store.remove(info.cli_session_id)
        if self._open is not None and self._open.key == info.key:
            self.show_list()
        self.refresh_sessions(force=True)

    # ----------------------------------------------------------- session view

    def on_open_session(self, _event=None):
        if self.book.GetSelection() == 1:
            return
        info = self._selected_session()
        if info is None:
            self._status("No session selected.")
            return
        self.open_session(info)

    def _save_draft(self):
        if self._open is not None and self._open.is_own:
            self._drafts[self._open.cli_session_id] = self.reply_text.GetValue()

    def open_session(self, info: SessionInfo):
        self._save_draft()
        self._open = info
        self.reply_text.SetValue(self._drafts.get(info.cli_session_id, "") if info.is_own else "")
        self._open_generation += 1
        self._reader = None
        self._chat_messages = []
        self._chat_loaded = False
        if info.is_own and info.unread:
            self.store.update(info.cli_session_id, unread=False)
            info.unread = False
        self.chat_list.Set(["Loading messages…"])
        self.chat_list.SetSelection(0)
        self.message_text.SetValue("")
        self.messages_label.SetLabel(f"&Messages in {info.title}:")
        set_accessible_name(self.chat_list, f"Messages in {info.title}")
        self.own_reply.Show(info.is_own)
        self.desktop_reply.Show(not info.is_own)
        self.reply_page.Layout()
        self._update_heading()
        self._update_send_state()
        self.notebook.SetSelection(0)
        self.book.SetSelection(1)
        self.SetTitle(f"{info.title} — {APP_NAME}")
        self.chat_list.SetFocus()
        self._refresh_chat()
        self._chat_timer.Start(CHAT_REFRESH_MS)

    def show_list(self):
        if self.book.GetSelection() == 0:
            return
        self._chat_timer.Stop()
        self._save_draft()
        self._open = None
        self._open_generation += 1
        self._reader = None
        self.book.SetSelection(0)
        self.SetTitle(APP_NAME)
        self.refresh_sessions()
        self.session_list.SetFocus()

    def _update_heading(self):
        info = self._open
        if info is None:
            return
        kind = "TheClaudeHub session" if info.is_own else "Claude desktop app session, read-only"
        state = info.state + (f": {info.detail}" if info.detail else "")
        self.session_heading.SetLabel(f"{info.title}, {info.repo}, {state}. {kind}.")

    def _select_tab(self, index: int):
        if self.book.GetSelection() != 1:
            return
        self.notebook.SetSelection(index)
        if index == 0:
            self.chat_list.SetFocus()
        elif self._open is not None and self._open.is_own:
            self.reply_text.SetFocus()
        else:
            self.desktop_note.SetFocus()

    def _refresh_chat(self):
        info = self._open
        if info is None or self._reader_busy:
            return
        generation = self._open_generation
        if self._reader is None:
            path = platform_paths.transcript_path(info.cwd, info.cli_session_id)
            if path is None:
                self._show_missing_transcript(info)
                return
            self._reader = TranscriptReader(path)
        reader = self._reader
        self._reader_busy = True

        def work():
            try:
                changed = reader.refresh()
                transcript = reader.transcript
                copies = [ChatMessage(m.kind, m.text, m.timestamp, m.key)
                          for m in transcript.messages]
                wx.CallAfter(self._apply_chat, generation, changed, copies,
                             transcript.unreadable_lines, None)
            except Exception as exc:  # noqa: BLE001
                wx.CallAfter(self._apply_chat, generation, False, [], 0, exc)

        self._pool.submit(work)

    def _show_missing_transcript(self, info: SessionInfo):
        if self._chat_loaded:
            return
        self._chat_loaded = True
        if info.is_own and info.cli_session_id in self._runners:
            line = "No messages yet. Claude is starting this session."
            self._chat_loaded = False  # keep looking until it appears
        elif info.is_own:
            line = ("No transcript found for this session. Claude Code may not have "
                    "saved it, or it was deleted.")
        else:
            line = ("No transcript: this session's history is no longer on disk. Claude "
                    "Code deletes transcripts after its retention period (cleanupPeriodDays "
                    "in Claude's settings).")
        self.chat_list.Set([line])
        self.chat_list.SetSelection(0)
        self.message_text.SetValue(line)

    def _apply_chat(self, generation, changed, messages, unreadable, error):
        self._reader_busy = False
        if not self or generation != self._open_generation or self._open is None:
            return
        if error is not None:
            if not self._chat_loaded:
                self.chat_list.Set([f"Couldn't read this transcript: {error}"])
                self.chat_list.SetSelection(0)
                self._chat_loaded = True
            return
        first_load = not self._chat_loaded
        if not changed and not first_load:
            return
        before_keys = {m.key for m in self._chat_messages}
        self._chat_messages = messages
        self._rebuild_chat_list(focus_newest=first_load)
        self._chat_loaded = True
        if first_load:
            note = f" Couldn't read {unreadable} lines." if unreadable else ""
            self._status(f"{len(self._visible_messages())} messages.{note}")
            return
        if self._open.is_own:
            return  # its turn announces the reply when it finishes
        fresh = [m for m in messages if m.key not in before_keys and m.kind in _REPLY_KINDS]
        if fresh:
            text = announce.reply_text(self._open.title, fresh[-1].text, self.speech.announce)
            if text:
                self._say(text)
            else:
                self._status(f"{self._open.title}: new message.")

    def _visible_messages(self) -> List[ChatMessage]:
        if self._show_activity:
            return list(self._chat_messages)
        return [m for m in self._chat_messages if not m.is_activity]

    def _rebuild_chat_list(self, focus_newest: bool = False):
        visible = self._visible_messages()
        lines = [m.list_line() for m in visible]
        if not lines:
            lines = ["No messages yet."]
        index = self.chat_list.GetSelection()
        old_keys = getattr(self, "_chat_keys", [])
        selected_key = old_keys[index] if 0 <= index < len(old_keys) else None
        keys = [m.key for m in visible]

        current = list(self.chat_list.GetStrings())
        if not focus_newest and keys[: len(old_keys)] == old_keys and len(current) == len(old_keys):
            # Grew or changed in place: update rows, append new ones, leave the
            # selection (and the reader) where it is.
            for i, line in enumerate(lines[: len(old_keys)]):
                if current[i] != line:
                    self.chat_list.SetString(i, line)
            if len(lines) > len(old_keys):
                self.chat_list.Append(lines[len(old_keys):])
        else:
            self.chat_list.Set(lines)
            if focus_newest or selected_key not in keys:
                self.chat_list.SetSelection(len(lines) - 1)
            else:
                self.chat_list.SetSelection(keys.index(selected_key))
        self._chat_keys = keys
        self._show_message(self.chat_list.GetSelection())

    def _on_message_selected(self, _event):
        self._show_message(self.chat_list.GetSelection())

    def _show_message(self, index: int):
        visible = self._visible_messages()
        if 0 <= index < len(visible):
            self.message_text.SetValue(visible[index].full_text())
        else:
            self.message_text.SetValue(self.chat_list.GetStringSelection() or "")
        self.message_text.SetInsertionPoint(0)

    def on_toggle_activity_menu(self, _event):
        self._set_activity(self.activity_item.IsChecked())

    def on_toggle_activity_check(self, _event):
        self._set_activity(self.activity_check.GetValue())

    def _set_activity(self, show: bool):
        self._show_activity = show
        self.activity_item.Check(show)
        self.activity_check.SetValue(show)
        if self._open is not None and self._chat_loaded and self._chat_messages:
            self._chat_keys = []
            self._rebuild_chat_list()
        self._status("Tool activity shown." if show else "Tool activity hidden.")

    # ------------------------------------------------------- open in Claude

    def on_open_in_claude(self, _event=None):
        info = self._selected_session()
        if info is None:
            self._status("No session selected.")
            return
        if not info.can_open_in_claude:
            wx.MessageBox(
                "This session was started by TheClaudeHub, so the Claude desktop app "
                "doesn't list it and it can't be opened there. Read and reply to it "
                "here.", APP_NAME, wx.OK | wx.ICON_INFORMATION, self)
            return
        try:
            platform_paths.open_url(claude_link(info.desktop_session_id))
            self._status(f"Opened {info.title} in Claude.")
        except OSError as exc:
            wx.MessageBox(f"Couldn't open the Claude desktop app: {exc}", APP_NAME,
                          wx.OK | wx.ICON_ERROR, self)

    # ------------------------------------------------------------- sending

    def _update_send_state(self):
        info = self._open
        running = info is not None and info.cli_session_id in self._runners
        self.send_btn.Enable(bool(info and info.is_own and not running))
        self.stop_btn.Enable(bool(running))
        if info is not None and info.is_own:
            self.turn_status.SetLabel("Claude is working." if running else "Ready.")

    def on_new_session(self, _event=None):
        exe = platform_paths.claude_executable()
        if not exe:
            wx.MessageBox("The claude command wasn't found. Install Claude Code, sign in "
                          "once in a terminal, then try again.", APP_NAME,
                          wx.OK | wx.ICON_ERROR, self)
            return
        dialog = NewSessionDialog(self, str(platform_paths.default_projects_root()))
        try:
            if dialog.ShowModal() != wx.ID_OK:
                return
            folder, title, mode, message = dialog.values()
        finally:
            dialog.Destroy()
        session_id = new_session_id()
        command = build_new_command(exe, session_id, title, mode)
        own = OwnSession(cli_session_id=session_id, title=title, cwd=folder,
                         permission_mode=mode)
        self.store.add(own)
        self._start_turn(own.cli_session_id, command, folder, message, title)
        self.refresh_sessions()
        self.open_session(own.to_info())

    def on_send(self, _event=None):
        info = self._open
        if info is None or not info.is_own:
            return
        message = self.reply_text.GetValue().strip()
        if not message:
            self._status("Type a message first.")
            self.reply_text.SetFocus()
            return
        if info.cli_session_id in self._runners:
            self._status("Claude is still working on the last message.")
            return
        live = self._snapshot.live.get(info.cli_session_id)
        if live is not None and live.status == "busy":
            wx.MessageBox("This session is running somewhere else right now, so "
                          "TheClaudeHub won't send into it.", APP_NAME,
                          wx.OK | wx.ICON_INFORMATION, self)
            return
        exe = platform_paths.claude_executable()
        if not exe:
            wx.MessageBox("The claude command wasn't found.", APP_NAME,
                          wx.OK | wx.ICON_ERROR, self)
            return
        own = self.store.get(info.cli_session_id)
        if own is None:
            return
        try:
            command = build_resume_command(
                exe, own.cli_session_id, own.permission_mode,
                own_ids={s.cli_session_id for s in self.store.all()},
                desktop_ids=self._snapshot.desktop_cli_ids)
        except ResumeRefused as exc:
            wx.MessageBox(str(exc), APP_NAME, wx.OK | wx.ICON_WARNING, self)
            return
        self.reply_text.SetValue("")
        self._drafts.pop(own.cli_session_id, None)
        self._start_turn(own.cli_session_id, command, own.cwd, message, own.title)

    def _start_turn(self, session_id: str, command, cwd: str, prompt: str, title: str):
        holder = {"id": session_id}

        def on_event(event: TurnEvent):
            wx.CallAfter(self._on_turn_event, holder, title, event)

        runner = TurnRunner(command, cwd, prompt, on_event)
        self._runners[session_id] = runner
        self.store.update(session_id, state=IDLE, detail="",
                          last_activity_ms=int(time.time() * 1000))
        runner.start()
        self._update_send_state()
        self._status(f"Sent. {title} is working.")
        self._denials[session_id] = []

    def _on_turn_event(self, holder, title, event: TurnEvent):
        if not self:
            return
        session_id = holder["id"]
        if event.kind == "started":
            reported = event.session_id
            if reported and reported != session_id and session_id in self._runners:
                # Claude chose a different id than the one we asked for.
                self.store.rename_id(session_id, reported)
                self._runners[reported] = self._runners.pop(session_id)
                self._denials[reported] = self._denials.pop(session_id, [])
                if self._open is not None and self._open.cli_session_id == session_id:
                    self._open.cli_session_id = reported
                    self._open.key = f"own:{reported}"
                holder["id"] = reported
            self._status(f"{title}: Claude is working.")
            return
        if event.kind == "tool":
            self._status(f"{title}: Claude is using {event.text}.")
            return
        if event.kind == "text":
            self._status(f"{title}: {announce.first_sentence(event.text)}")
            return
        if event.kind == "denied":
            self._denials.setdefault(session_id, []).append(event.text)
            self._status(f"{title}: permission denied, {event.text}")
            return
        if event.kind in ("finished", "failed"):
            self._runners.pop(session_id, None)
            denials = event.denials or self._denials.pop(session_id, [])
            self._denials.pop(session_id, None)
            is_open = self._open is not None and self._open.cli_session_id == session_id
            if event.kind == "failed" or event.is_error:
                state, detail = NEEDS_YOU, announce.status_text(event.text or "error", 120)
            elif denials:
                count = len(denials)
                state = NEEDS_YOU
                detail = f"{count} tool{'s were' if count != 1 else ' was'} refused"
            else:
                state, detail = IDLE, ""
            self.store.update(session_id, state=state, detail=detail,
                              unread=not is_open,
                              last_activity_ms=int(time.time() * 1000))
            if event.kind == "failed" or event.is_error:
                spoken = f"{title}: the turn failed. {event.text}"
                self._say(spoken)
            else:
                text = announce.reply_text(title, event.text, self.speech.announce)
                if denials and self.speech.enabled:
                    text = (text or f"{title} finished.") + f" {detail}: " + "; ".join(denials)
                if text:
                    self._say(text)
                else:
                    reply = announce.first_sentence(event.text) if event.text else ""
                    self._status(f"{title} finished. {reply}".strip())
            self._update_send_state()
            if is_open:
                self._refresh_chat()
            self.refresh_sessions()

    def on_stop(self, _event=None):
        info = self._open
        runner = self._runners.get(info.cli_session_id) if info else None
        if runner is None:
            self._status("Nothing is running.")
            return
        runner.cancel()
        self._status("Stopping…")

    # ------------------------------------------------------- settings, about

    def on_settings(self, _event=None):
        options = self._speech_options or default_options()
        dialog = SettingsDialog(self, self.speech, options)
        try:
            if dialog.ShowModal() != wx.ID_OK:
                return
            self.speech = dialog.get_settings()
        finally:
            dialog.Destroy()
        try:
            self.speech.save()
        except OSError as exc:
            wx.MessageBox(f"Couldn't save settings: {exc}", APP_NAME,
                          wx.OK | wx.ICON_WARNING, self)
        self._status("Settings saved.")

    def on_about(self, _event=None):
        wx.MessageBox(
            f"{APP_NAME} {__version__}\n\nA keyboard and screen reader friendly reader "
            "for Claude Code sessions, on your existing Claude subscription.",
            f"About {APP_NAME}", wx.OK | wx.ICON_INFORMATION, self)

    # ------------------------------------------------------------- keyboard

    def _on_char_hook(self, event: wx.KeyEvent):
        key = event.GetKeyCode()
        focus = wx.Window.FindFocus()
        ctrl = event.ControlDown()
        on_view = self.book.GetSelection() == 1

        if key in (wx.WXK_RETURN, wx.WXK_NUMPAD_ENTER):
            if ctrl and focus is self.reply_text:
                self.on_send()
                return
            if not ctrl and not event.AltDown() and focus is self.session_list:
                self.on_open_session()
                return
            if not ctrl and focus is self.chat_list:
                self.message_text.SetFocus()
                self.message_text.SetInsertionPoint(0)
                return
        if key == wx.WXK_ESCAPE and on_view:
            self.show_list()
            return
        if key == wx.WXK_BACK and on_view and not ctrl and focus is not self.reply_text:
            self.show_list()
            return
        if key == wx.WXK_DELETE and focus is self.session_list:
            self.on_forget(None)
            return
        if ctrl and key in (ord("C"), ord("c")) and focus is self.chat_list:
            self._copy_message()
            return
        event.Skip()

    def _copy_message(self):
        visible = self._visible_messages()
        index = self.chat_list.GetSelection()
        if not (0 <= index < len(visible)):
            return
        if wx.TheClipboard.Open():
            try:
                wx.TheClipboard.SetData(wx.TextDataObject(visible[index].full_text()))
            finally:
                wx.TheClipboard.Close()
            self._status("Message copied.")

    # ---------------------------------------------------------------- close

    def _on_close(self, event: wx.CloseEvent):
        if self._runners and event.CanVeto():
            count = len(self._runners)
            answer = wx.MessageBox(
                f"Claude is working in {count} TheClaudeHub session"
                f"{'s' if count != 1 else ''}. Quit anyway? The running turn"
                f"{'s' if count != 1 else ''} will be stopped.",
                f"Quit {APP_NAME}", wx.YES_NO | wx.NO_DEFAULT | wx.ICON_QUESTION, self)
            if answer != wx.YES:
                event.Veto()
                return
        for runner in list(self._runners.values()):
            runner.cancel()
        self._list_timer.Stop()
        self._chat_timer.Stop()
        speaker.stop()
        self._pool.shutdown(wait=False, cancel_futures=True)
        event.Skip()


def _fitting_size(width: int, height: int):
    """The preferred size, shrunk to fit a small screen (such as 1024 by 768)."""
    try:
        area = wx.Display(0).GetClientArea()
        return (min(width, area.width - 40), min(height, area.height - 40))
    except Exception:  # noqa: BLE001
        return (width, height)


def _same_but_age(old: str, new: str) -> bool:
    """True when two list lines differ only in their "active ... ago" part."""
    def strip(line: str) -> str:
        return ", ".join(p for p in line.split(", ") if not p.startswith("active "))
    return strip(old) == strip(new)

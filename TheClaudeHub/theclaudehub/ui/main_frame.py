"""TheClaudeHub's window: sessions, messages and reply, all in one view.

Accessibility decisions, and why
--------------------------------
* **One window, three parts, in Tab order** (issue #171): the sessions list,
  the loaded session's messages, then the reply box (or, for a desktop
  session, a read-only note and Open in Claude in the same place) and Send
  and Stop. Nothing is hidden behind a tab or a second screen: Shift+Tab
  from the messages goes back to the sessions list, still on the same
  session. Enter in the sessions list loads that session and moves to its
  messages; arrowing doesn't load anything.
* **Send and Stop never move** (issue #175). Both stay enabled, so Tab from
  the reply box is always Send, then Stop: Kelly tabs and presses Enter from
  habit, and a disabled Send once made that Tab land on Stop and cancel the
  turn. Send during a turn queues the message and sends it when the turn
  ends, as Claude Code does; Stop with nothing running just says so.
* **Both lists are ``wx.ListBox``.** One tab stop, arrow keys, and every item
  is one string a screen reader reads whole (IDT's chat app made the same
  choice). A session reads "title, repo, state, age"; a message reads
  "You: first line" or "Claude: first line".
* **The full message opens from the list** (Enter, or the context menu) in a
  read-only multiline text box in a dialog, to read by line, word and
  character. Escape closes it, back on the same message.
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

from .. import __version__, announce, hub, platform_paths
from ..claude_cli import (ResumeRefused, TurnEvent, TurnRunner, build_new_command,
                          build_resume_command, describe_elapsed, new_session_id)
from ..hub import Snapshot, collect, finished_turns, last_reply_from_tail
from ..own_store import OwnSession, OwnSessionStore
from ..sessions import IDLE, NEEDS_YOU, WORKING, SessionInfo
from ..speech import SpeechSettings, default_options, list_speech_options, speaker
from ..transcript import ASSISTANT, ERROR, PLAN, QUESTION, ChatMessage, TranscriptReader
from .a11y import set_accessible_name
from .dialogs import MessageDialog, NewSessionDialog, SettingsDialog, ShortcutsDialog

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
        self._queued: Dict[str, str] = {}  # sent during a turn, goes when it ends
        self._chat_keys: List[str] = []
        self._announce_load = False  # say "Loaded X" once its chat arrives

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
        self.Bind(wx.EVT_TIMER, self._on_chat_timer, self._chat_timer)

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
        self._item(session, "&Load Session", self.on_open_session)
        self._item(session, "Open in &Claude\tCtrl+O", self.on_open_in_claude)
        self._item(session, "&New Session...\tCtrl+N", self.on_new_session)
        self._item(session, "&Refresh\tF5",
                   lambda e: self.refresh_sessions(force=True, resort=True))
        self._item(session, "&Forget TheClaudeHub Session...", self.on_forget)
        session.AppendSeparator()
        self._item(session, "&Settings...\tCtrl+,", self.on_settings, wx.ID_PREFERENCES)
        session.AppendSeparator()
        self._item(session, "E&xit", lambda e: self.Close(), wx.ID_EXIT)
        bar.Append(session, "&Session")

        view = wx.Menu()
        self._item(view, "Go to &Sessions\tCtrl+1", lambda e: self.focus_sessions())
        self._item(view, "Go to &Messages\tCtrl+2", lambda e: self.focus_messages())
        self._item(view, "Go to &Reply\tCtrl+3", lambda e: self.focus_reply())
        self._item(view, "Read &Full Message", lambda e: self.on_read_message())
        self.activity_item = view.AppendCheckItem(wx.ID_ANY, "Show &Tool Activity\tCtrl+T")
        self.Bind(wx.EVT_MENU, self.on_toggle_activity_menu, self.activity_item)
        self._item(view, "Sto&p Running Turn\tCtrl+.", self.on_stop)
        self._item(view, "T&urn Status\tCtrl+Shift+T", self.on_turn_status)
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
        """Sessions on the left, the loaded session on the right. Tab order is
        creation order: sessions list, messages, reply (or the desktop note),
        Send and Stop, then the rest."""
        root = wx.Panel(self)
        outer = wx.BoxSizer(wx.HORIZONTAL)

        left = wx.BoxSizer(wx.VERTICAL)
        left.Add(wx.StaticText(root, label="Session &list:"), 0, wx.LEFT | wx.TOP, 8)
        self.session_list = wx.ListBox(root, style=wx.LB_SINGLE, name="Session list")
        set_accessible_name(self.session_list, "Session list")
        left.Add(self.session_list, 1, wx.EXPAND | wx.ALL, 8)
        self.session_list.Bind(wx.EVT_LISTBOX_DCLICK, self.on_open_session)
        outer.Add(left, 2, wx.EXPAND)

        vsizer = wx.BoxSizer(wx.VERTICAL)
        self.session_heading = wx.StaticText(root, label="")
        vsizer.Add(self.session_heading, 0, wx.LEFT | wx.TOP | wx.RIGHT, 8)

        self.messages_label = wx.StaticText(root, label="&Messages:")
        vsizer.Add(self.messages_label, 0, wx.LEFT | wx.TOP, 8)
        self.chat_list = wx.ListBox(root, style=wx.LB_SINGLE, name="Messages")
        set_accessible_name(self.chat_list, "Messages")
        vsizer.Add(self.chat_list, 1, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
        self.chat_list.Bind(wx.EVT_CONTEXT_MENU, self._on_message_menu)
        self.chat_list.Bind(wx.EVT_LISTBOX_DCLICK, lambda e: self.on_read_message())

        # Where the reply goes: one panel for TheClaudeHub's sessions, one for
        # desktop ones, in the same place so the layout is the same.
        self.own_reply = wx.Panel(root)
        osizer = wx.BoxSizer(wx.VERTICAL)
        osizer.Add(wx.StaticText(self.own_reply,
                                 label="&Your message (Ctrl+Enter sends):"), 0, wx.BOTTOM, 4)
        # TE_RICH2 on purpose: checked in the vmtest VM (wxPython 4.3.1), a
        # plain multiline EDIT reports its contents as its accessible name,
        # while a RichEdit takes its name from the label before it.
        self.reply_text = wx.TextCtrl(self.own_reply, style=wx.TE_MULTILINE | wx.TE_RICH2)
        set_accessible_name(self.reply_text, "Your message")
        self.reply_text.SetMinSize((-1, 90))
        osizer.Add(self.reply_text, 1, wx.EXPAND)
        orow = wx.BoxSizer(wx.HORIZONTAL)
        self.send_btn = wx.Button(self.own_reply, label="Sen&d")
        self.stop_btn = wx.Button(self.own_reply, label="Sto&p")
        orow.Add(self.send_btn, 0, wx.RIGHT, 6)
        orow.Add(self.stop_btn, 0, wx.RIGHT, 12)
        self.turn_status = wx.StaticText(self.own_reply, label="")
        orow.Add(self.turn_status, 1, wx.ALIGN_CENTER_VERTICAL)
        osizer.Add(orow, 0, wx.EXPAND | wx.TOP, 6)
        self.own_reply.SetSizer(osizer)
        self.send_btn.Bind(wx.EVT_BUTTON, self.on_send)
        self.stop_btn.Bind(wx.EVT_BUTTON, self.on_stop)

        self.desktop_reply = wx.Panel(root)
        dsizer = wx.BoxSizer(wx.VERTICAL)
        # A read-only text box, not a static label: it is focusable, so the
        # explanation is what's heard on tabbing to where the reply box would be.
        dsizer.Add(wx.StaticText(self.desktop_reply, label="About replying:"), 0, wx.BOTTOM, 4)
        self.desktop_note = wx.TextCtrl(
            self.desktop_reply, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_RICH2,
            value=("This session belongs to the Claude desktop app, so you reply to it "
                   "in Claude. TheClaudeHub only reads it: sending from here while the "
                   "desktop app has it open could run two turns at once and tangle "
                   "the conversation. Open in Claude switches the desktop app to it."))
        set_accessible_name(self.desktop_note, "About replying")
        self.desktop_note.SetMinSize((-1, 90))
        dsizer.Add(self.desktop_note, 1, wx.EXPAND)
        self.reply_claude_btn = wx.Button(self.desktop_reply, label="Open in &Claude")
        dsizer.Add(self.reply_claude_btn, 0, wx.TOP, 6)
        self.desktop_reply.SetSizer(dsizer)
        self.reply_claude_btn.Bind(wx.EVT_BUTTON, self.on_open_in_claude)

        vsizer.Add(self.own_reply, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)
        vsizer.Add(self.desktop_reply, 0, wx.EXPAND | wx.LEFT | wx.RIGHT, 8)

        crow = wx.BoxSizer(wx.HORIZONTAL)
        self.activity_check = wx.CheckBox(root, label="Show tool &activity")
        crow.Add(self.activity_check, 0, wx.ALIGN_CENTER_VERTICAL)
        vsizer.Add(crow, 0, wx.ALL, 8)
        self.activity_check.Bind(wx.EVT_CHECKBOX, self.on_toggle_activity_check)
        self.session_view = root

        # Session-list commands come last in the Tab order; all of them are
        # also on the Session menu with shortcuts.
        row = wx.BoxSizer(wx.HORIZONTAL)
        self.new_btn = new_btn = wx.Button(root, label="&New Session...")
        self.refresh_btn = refresh_btn = wx.Button(root, label="&Refresh")
        row.Add(new_btn, 0, wx.RIGHT, 6)
        row.Add(refresh_btn, 0)
        vsizer.Add(row, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)
        new_btn.Bind(wx.EVT_BUTTON, self.on_new_session)
        refresh_btn.Bind(wx.EVT_BUTTON,
                         lambda e: self.refresh_sessions(force=True, resort=True))

        outer.Add(vsizer, 3, wx.EXPAND)
        root.SetSizer(outer)
        frame_sizer = wx.BoxSizer(wx.VERTICAL)
        frame_sizer.Add(root, 1, wx.EXPAND)
        self.SetSizer(frame_sizer)
        self._show_no_session()

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

    def _feedback(self, text: str):
        """The answer to something Kelly just did: status bar, and spoken
        briefly without interrupting the screen reader (unless announcements
        are set to silent). Background news uses ``_say`` or ``_status``."""
        if not text:
            return
        self._status(text)
        if self.speech.enabled:
            speaker.speak(text, self.speech, interrupt=False)

    def _store_write(self, method, *args, **kwargs) -> bool:
        """Call a store method that writes; report a failed write instead of
        letting it escape an event handler (which would leave the UI half
        updated)."""
        try:
            method(*args, **kwargs)
            return True
        except OSError as exc:
            self._say(f"Couldn't save TheClaudeHub's session list: {exc}")
            return False

    def _probe_speech(self):
        try:
            self._speech_options = list_speech_options()
        except Exception:  # noqa: BLE001
            self._speech_options = None

    def _selected_session(self) -> Optional[SessionInfo]:
        """The session a command means: the highlighted one in the sessions
        list while that has focus (or nothing is loaded), otherwise the
        loaded one."""
        if self._open is not None and wx.Window.FindFocus() is not self.session_list:
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

    def refresh_sessions(self, force: bool = False, resort: bool = False):
        """Reload the list in the background.

        ``force`` reports the totals; ``resort`` puts the list back in its
        proper order even while it has focus (F5, and coming back from a
        session). Otherwise a list with focus keeps its order, so nothing moves
        under Kelly while he arrows.
        """
        if self._snapshot_busy:
            # Run again when the current pass lands, so F5 is never lost.
            previous = self._pending_refresh or (False, False)
            self._pending_refresh = (force or previous[0], resort or previous[1])
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
                wx.CallAfter(self._apply_snapshot, snap, ended, replies, force, resort)
            except Exception as exc:  # noqa: BLE001
                wx.CallAfter(self._snapshot_failed, exc)

        self._pool.submit(work)

    def _snapshot_failed(self, exc):
        self._snapshot_busy = False
        self._status(f"Couldn't read the session list: {exc}")
        self._run_pending_refresh()

    def _run_pending_refresh(self):
        if self._pending_refresh is not None:
            (force, resort), self._pending_refresh = self._pending_refresh, None
            self.refresh_sessions(force=force, resort=resort)

    def _apply_snapshot(self, snap: Snapshot, ended, replies, force, resort=False):
        self._snapshot_busy = False
        if not self:
            return
        self._snapshot = snap
        self._previous_states = {s.key: s.state for s in snap.sessions}
        first = self._first_snapshot
        self._first_snapshot = False
        keep_order = (not resort and not first
                      and wx.Window.FindFocus() is self.session_list)
        self._update_session_list(snap.sessions, keep_order=keep_order)

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
            if force and not first:
                self._feedback(text)  # F5: Kelly asked
            else:
                self._status(text)
        self._run_pending_refresh()

    def _update_session_list(self, sessions: List[SessionInfo], keep_order: bool = False):
        """Rewrite only what changed, keeping the selection on the same session.

        With ``keep_order`` the rows stay where they are (new sessions are
        added at the end, vanished ones removed), so a refresh never moves the
        row under the reader. The proper order comes back on F5, on returning
        from a session, or on a refresh while the list doesn't have focus.
        """
        now = int(time.time() * 1000)
        by_key = {s.key: s for s in sessions}
        index = self.session_list.GetSelection()
        selected_key = (self._list_keys[index]
                        if index != wx.NOT_FOUND and index < len(self._list_keys) else None)

        if keep_order:
            keys = [k for k in self._list_keys if k in by_key]
            keys += [s.key for s in sessions if s.key not in set(self._list_keys)]
        else:
            keys = [s.key for s in sessions]
        lines = [by_key[k].list_line(now) for k in keys]

        if keys == self._list_keys:
            for i, line in enumerate(lines):
                if self.session_list.GetString(i) == line:
                    continue
                if i == index and _same_but_age(self.session_list.GetString(i), line):
                    continue  # don't make the reader re-read for a clock tick
                self.session_list.SetString(i, line)
            return

        if keep_order:
            # Remove vanished rows from the bottom up, then update and append.
            for i in range(len(self._list_keys) - 1, -1, -1):
                if self._list_keys[i] not in by_key:
                    self.session_list.Delete(i)
            kept = [k for k in self._list_keys if k in by_key]
            for i, key in enumerate(kept):
                line = by_key[key].list_line(now)
                if self.session_list.GetString(i) != line and not (
                        key == selected_key
                        and _same_but_age(self.session_list.GetString(i), line)):
                    self.session_list.SetString(i, line)
            if len(keys) > len(kept):
                self.session_list.Append(lines[len(kept):])
            self._list_keys = keys
            if selected_key in keys:
                if self.session_list.GetSelection() != keys.index(selected_key):
                    self.session_list.SetSelection(keys.index(selected_key))
            elif keys:
                old = self._list_keys_before_delete(index, len(keys))
                self.session_list.SetSelection(old)
            return

        self.session_list.Set(lines)
        self._list_keys = keys
        if not lines:
            return
        if selected_key in keys:
            self.session_list.SetSelection(keys.index(selected_key))
        else:
            self.session_list.SetSelection(min(max(index, 0), len(keys) - 1))

    @staticmethod
    def _list_keys_before_delete(index: int, count: int) -> int:
        """Where the selection goes when its row vanished: the row that took
        its place, or the new last row."""
        return min(max(index, 0), count - 1)

    def on_forget(self, _event):
        info = self._selected_session()
        if info is None:
            self._feedback("No session selected.")
            return
        if not info.is_own:
            self._feedback("Only sessions TheClaudeHub started can be forgotten. "
                           "Desktop app sessions are managed in Claude.")
            return
        if info.cli_session_id in self._runners:
            self._feedback("A turn is running in that session. Stop it first.")
            return
        answer = wx.MessageBox(
            f"Remove \"{info.title}\" from TheClaudeHub's list? Its transcript stays on "
            "disk; this only stops TheClaudeHub listing it.",
            "Forget Session", wx.YES_NO | wx.NO_DEFAULT | wx.ICON_QUESTION, self)
        if answer != wx.YES:
            return
        if not self._store_write(self.store.remove, info.cli_session_id):
            return
        if self._open is not None and self._open.key == info.key:
            self.unload_session()
            # Its messages and reply box are gone: don't leave focus on them.
            self.session_list.SetFocus()
        # Keep the place: the neighbour moves into the forgotten row.
        index = self._list_keys.index(info.key) if info.key in self._list_keys else -1
        if index >= 0:
            self.session_list.Delete(index)
            del self._list_keys[index]
            if self._list_keys:
                self.session_list.SetSelection(min(index, len(self._list_keys) - 1))
        self._feedback(f"Forgot {info.title}.")
        self.refresh_sessions()

    # ----------------------------------------------------------- session view

    def on_open_session(self, _event=None):
        index = self.session_list.GetSelection()
        info = (self._current_info(self._list_keys[index])
                if index != wx.NOT_FOUND and index < len(self._list_keys) else None)
        if info is None:
            self._feedback("No session selected.")
            return
        if self._open is not None and info.key == self._open.key:
            # Already loaded: go back to it as it was, without reloading.
            self.chat_list.SetFocus()
            self._feedback(f"Back in {info.title}.")
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
        self._chat_keys = []
        self._chat_loaded = False
        self._announce_load = True
        if info.is_own and info.unread:
            self._store_write(self.store.update, info.cli_session_id, unread=False)
            info.unread = False
        self.chat_list.Set(["Loading messages\u2026"])
        self.chat_list.SetSelection(0)
        self._update_messages_label()
        self.own_reply.Show(info.is_own)
        self.desktop_reply.Show(not info.is_own)
        self.session_view.Layout()
        self._update_heading()
        self._update_send_state()
        if info.key in self._list_keys:
            row = self._list_keys.index(info.key)
            if self.session_list.GetSelection() != row:
                self.session_list.SetSelection(row)
        self.SetTitle(f"{info.title} \u2014 {APP_NAME}")
        self.chat_list.SetFocus()
        self._refresh_chat()
        self._chat_timer.Start(CHAT_REFRESH_MS)

    def unload_session(self):
        """Nothing loaded (the loaded session was forgotten)."""
        self._chat_timer.Stop()
        self._open = None
        self._open_generation += 1
        self._reader = None
        self._chat_messages = []
        self._chat_keys = []
        self.SetTitle(APP_NAME)
        self._show_no_session()

    def _show_no_session(self):
        self.messages_label.SetLabel("&Messages:")
        set_accessible_name(self.chat_list, "Messages")
        self.chat_list.Set(["No session loaded. Choose one in the session list and "
                            "press Enter."])
        self.chat_list.SetSelection(0)
        self.session_heading.SetLabel("")
        self.own_reply.Hide()
        self.desktop_reply.Hide()
        self.session_view.Layout()

    def focus_sessions(self):
        """Back to the sessions list, still on the same session."""
        self._save_draft()
        self.session_list.SetFocus()

    def focus_messages(self):
        self.chat_list.SetFocus()

    def focus_reply(self):
        if self._open is None:
            self._feedback("No session loaded.")
            self.session_list.SetFocus()
        elif self._open.is_own:
            self.reply_text.SetFocus()
        else:
            self.desktop_note.SetFocus()

    def _update_heading(self):
        info = self._open
        if info is None:
            return
        kind = "TheClaudeHub session" if info.is_own else "Claude desktop app session, read-only"
        state = info.state + (f": {info.detail}" if info.detail else "")
        self.session_heading.SetLabel(f"{info.title}, {info.repo}, {state}. {kind}.")
        self._update_messages_label()

    def _update_messages_label(self):
        """The chat list's label (its accessible name) carries the session's
        state and whether it is read-only, so it is heard on arriving there."""
        info = self._open
        if info is None:
            return
        state = info.state + (f": {info.detail}" if info.detail else "")
        kind = "" if info.is_own else ", read-only"
        label = f"Messages in {info.title} ({state}{kind})"
        if self.messages_label.GetLabel() != f"&{label}:":
            self.messages_label.SetLabel(f"&{label}:")
            set_accessible_name(self.chat_list, label)

    def _on_chat_timer(self, _event=None):
        self._update_send_state()
        self._refresh_chat()

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
        own = self.store.get(info.cli_session_id) if info.is_own else None
        if info.is_own and (info.cli_session_id in self._runners
                            or (own is not None and not own.started)):
            line = ("No messages yet. Claude is starting this session."
                    if info.cli_session_id in self._runners else
                    "No messages yet. The first message didn't reach Claude; send it again "
                    "from the reply box.")
            self._chat_loaded = False  # keep looking until it appears
        elif info.is_own:
            line = ("No transcript found for this session. Claude Code may not have "
                    "saved it, or it was deleted.")
        else:
            line = ("No transcript: this session's history is no longer on disk. Claude "
                    "Code deletes transcripts after its retention period (cleanupPeriodDays "
                    "in Claude's settings).")
        if self._announce_load:
            self._announce_load = False
            self._feedback(f"Loaded {info.title}. {line}")
        if list(self.chat_list.GetStrings()) == [line]:
            return  # already showing it: don't make the reader re-read every tick
        self.chat_list.Set([line])
        self.chat_list.SetSelection(0)

    def _apply_chat(self, generation, changed, messages, unreadable, error):
        self._reader_busy = False
        if not self or self._open is None:
            return
        if generation != self._open_generation:
            # A load for a session that is no longer loaded: start the
            # current one's now rather than waiting for the next tick.
            self._refresh_chat()
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
            count = len(self._visible_messages())
            if self._announce_load:
                self._announce_load = False
                self._feedback(f"Loaded {self._open.title}, {count} "
                               f"message{'s' if count != 1 else ''}.{note}")
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

    def _rebuild_chat_list(self, focus_newest: bool = False,
                           keep_key: Optional[str] = None):
        """Bring the list up to date without moving the reader.

        Rows are updated in place and new ones appended; the selection stays on
        the same message. ``keep_key`` asks for that message (or the nearest
        one still visible) to be selected after a full rebuild.
        """
        visible = self._visible_messages()
        lines = [m.list_line() for m in visible] or ["No messages yet."]
        keys = [m.key for m in visible]
        index = self.chat_list.GetSelection()
        old_keys = self._chat_keys
        selected_key = keep_key or (old_keys[index] if 0 <= index < len(old_keys) else None)

        current = list(self.chat_list.GetStrings())
        if (not focus_newest and keep_key is None and old_keys
                and keys[: len(old_keys)] == old_keys and len(current) == len(old_keys)):
            for i, line in enumerate(lines[: len(old_keys)]):
                if current[i] != line:
                    self.chat_list.SetString(i, line)
            if len(lines) > len(old_keys):
                self.chat_list.Append(lines[len(old_keys):])
        else:
            self.chat_list.Set(lines)
            if focus_newest or not keys:
                self.chat_list.SetSelection(len(lines) - 1)
            elif selected_key in keys:
                self.chat_list.SetSelection(keys.index(selected_key))
            else:
                self.chat_list.SetSelection(self._nearest_visible(selected_key, keys))
        self._chat_keys = keys

    def _nearest_visible(self, key: Optional[str], visible_keys: List[str]) -> int:
        """Row of the last visible message at or before ``key`` in the full
        transcript; the newest if ``key`` is unknown."""
        if not visible_keys:
            return 0
        order = [m.key for m in self._chat_messages]
        if key not in order:
            return len(visible_keys) - 1
        position = order.index(key)
        best = 0
        for row, visible_key in enumerate(visible_keys):
            if visible_key in order and order.index(visible_key) <= position:
                best = row
        return best

    def _selected_message(self) -> Optional[ChatMessage]:
        visible = self._visible_messages()
        index = self.chat_list.GetSelection()
        return visible[index] if 0 <= index < len(visible) else None

    def on_read_message(self):
        """The selected message's full text, in a read-only box to read by
        line, word and character. Closing it returns to the same message."""
        message = self._selected_message()
        if message is None:
            self._feedback("No message selected.")
            return
        dialog = MessageDialog(self, message.label, message.text)
        try:
            dialog.ShowModal()
        finally:
            dialog.Destroy()
        self.chat_list.SetFocus()

    def _message_menu(self) -> wx.Menu:
        """The messages list's context menu. Its handlers are bound on the
        menu itself, so nothing accumulates on the frame."""
        menu = wx.Menu()
        read = menu.Append(wx.ID_ANY, "Read &Full Message\tEnter")
        copy = menu.Append(wx.ID_ANY, "&Copy Message\tCtrl+C")
        enabled = self._selected_message() is not None
        read.Enable(enabled)
        copy.Enable(enabled)
        menu.Bind(wx.EVT_MENU, lambda e: self.on_read_message(), read)
        menu.Bind(wx.EVT_MENU, lambda e: self._copy_message(), copy)
        return menu

    def _message_menu_position(self, event=None) -> wx.Point:
        """Where the menu opens: at the mouse for a right-click, at the
        selected message for the Applications key or Shift+F10."""
        position = event.GetPosition() if event is not None else wx.DefaultPosition
        if position != wx.DefaultPosition:
            return self.chat_list.ScreenToClient(position)
        index = self.chat_list.GetSelection()
        try:
            rect = self.chat_list.GetItemRect(max(index, 0))
            if rect.height > 0:
                return wx.Point(rect.x + 8, rect.y + rect.height)
        except (AttributeError, NotImplementedError):
            pass
        return wx.Point(8, 8)

    def _on_message_menu(self, event=None):
        menu = self._message_menu()
        try:
            self.chat_list.PopupMenu(menu, self._message_menu_position(event))
        finally:
            menu.Destroy()

    def on_toggle_activity_menu(self, _event):
        self._set_activity(self.activity_item.IsChecked())

    def on_toggle_activity_check(self, _event):
        self._set_activity(self.activity_check.GetValue())

    def _set_activity(self, show: bool):
        self._show_activity = show
        self.activity_item.Check(show)
        self.activity_check.SetValue(show)
        if self._open is not None and self._chat_loaded and self._chat_messages:
            index = self.chat_list.GetSelection()
            keep = self._chat_keys[index] if 0 <= index < len(self._chat_keys) else None
            self._rebuild_chat_list(keep_key=keep or "")
        self._feedback("Tool activity shown." if show else "Tool activity hidden.")

    # ------------------------------------------------------- open in Claude

    def on_open_in_claude(self, _event=None):
        info = self._selected_session()
        if info is None:
            self._feedback("No session selected.")
            return
        if not info.can_open_in_claude:
            wx.MessageBox(
                "This session was started by TheClaudeHub, so the Claude desktop app "
                "doesn't list it and it can't be opened there. Read and reply to it "
                "here.", APP_NAME, wx.OK | wx.ICON_INFORMATION, self)
            return
        try:
            platform_paths.open_url(claude_link(info.desktop_session_id))
            self._feedback(f"Opened {info.title} in Claude.")
        except OSError as exc:
            wx.MessageBox(f"Couldn't open the Claude desktop app: {exc}", APP_NAME,
                          wx.OK | wx.ICON_ERROR, self)

    # ------------------------------------------------------------- sending

    def _update_send_state(self):
        info = self._open
        running = info is not None and info.cli_session_id in self._runners
        # Always enabled: a disabled button drops out of the Tab order, and
        # Send and Stop must stay where Kelly's fingers expect them.
        own = bool(info and info.is_own)
        self.send_btn.Enable(own)
        self.stop_btn.Enable(own)
        if info is not None and info.is_own:
            if running:
                elapsed = describe_elapsed(self._runners[info.cli_session_id].elapsed())
                label = f"Claude is working ({elapsed})."
                if info.cli_session_id in self._queued:
                    label += " A message is queued."
            else:
                label = "Ready."
            if self.turn_status.GetLabel() != label:
                self.turn_status.SetLabel(label)

    def on_turn_status(self, _event=None):
        """How long the running turn has taken, and what it is doing."""
        info = self._open
        runner = self._runners.get(info.cli_session_id) if info else None
        if runner is not None:
            waiting = (" A message is queued." if info.cli_session_id in self._queued
                       else "")
            self._feedback(f"{info.title}: Claude has been working for "
                           f"{describe_elapsed(runner.elapsed())}, last {runner.last_activity}."
                           f"{waiting}")
            return
        if not self._runners:
            self._feedback("No turns are running.")
            return
        parts = []
        for session_id, other in self._runners.items():
            own = self.store.get(session_id)
            name = own.title if own else "A session"
            parts.append(f"{name}, {describe_elapsed(other.elapsed())}")
        self._feedback("Working: " + "; ".join(parts) + ".")

    def on_new_session(self, _event=None):
        lookup = platform_paths.find_claude()
        if not lookup.path:
            wx.MessageBox(lookup.problem, APP_NAME, wx.OK | wx.ICON_ERROR, self)
            return
        exe = lookup.path
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
                         permission_mode=mode, started=False)
        if not self._store_write(self.store.add, own):
            return
        # Start the turn first, so the session view sees it running.
        self._start_turn(own.cli_session_id, command, folder, message, title)
        self.open_session(own.to_info())
        self.refresh_sessions()

    def on_send(self, _event=None):
        info = self._open
        if info is None or not info.is_own:
            return
        message = self.reply_text.GetValue().strip()
        if not message:
            self._feedback("Type a message first.")
            self.reply_text.SetFocus()
            return
        session_id = info.cli_session_id
        runner = self._runners.get(session_id)
        if runner is not None and runner.cancelled:
            # Queuing behind a stopped turn would only bounce back when the
            # stop lands, so keep the text and say why.
            self._feedback("Still stopping. Send again in a moment.")
            self.reply_text.SetFocus()
            return
        if runner is not None:
            # Queue it rather than refuse: the turn's reply comes first, then
            # this goes. More while one waits joins it as one message.
            waiting = self._queued.get(session_id)
            self._queued[session_id] = f"{waiting}\n\n{message}" if waiting else message
            self.reply_text.SetValue("")
            self._drafts.pop(session_id, None)
            self._update_send_state()
            if waiting:
                self._feedback(f"Added to the queued message. It will be sent when "
                               f"{info.title} finishes.")
            else:
                self._feedback(f"Queued. It will be sent when {info.title} finishes.")
            self.reply_text.SetFocus()
            return
        problem = self._send_now(session_id, message)
        if problem:
            wx.MessageBox(problem, APP_NAME, wx.OK | wx.ICON_WARNING, self)
            return
        self.reply_text.SetValue("")
        self._drafts.pop(session_id, None)
        # Stay in the reply box; new messages arrive at the end of the list.
        self.reply_text.SetFocus()

    def _send_now(self, session_id: str, message: str, queued: bool = False) -> Optional[str]:
        """Start a turn with ``message``. Returns why it can't, or None once
        sent; the caller decides how to say it (a dialog when Kelly pressed
        Send, speech for a queued message going out on its own)."""
        # Read fresh, not from the list's snapshot: up to 5 seconds old, it
        # still shows TheClaudeHub's own just-finished turn as busy.
        live = hub.load_live_status().get(session_id)
        if live is not None and live.status == "busy":
            return ("This session is running somewhere else right now, so "
                    "TheClaudeHub won't send into it.")
        lookup = platform_paths.find_claude()
        if not lookup.path:
            return lookup.problem
        exe = lookup.path
        own = self.store.get(session_id)
        if own is None:
            return "That session is no longer in TheClaudeHub's list."
        try:
            if self._session_exists(own):
                command = build_resume_command(
                    exe, own.cli_session_id, own.permission_mode,
                    own_ids={s.cli_session_id for s in self.store.all()},
                    desktop_ids=self._snapshot.desktop_cli_ids)
            else:
                # The first turn never got as far as creating the session:
                # start it again rather than resume something that isn't there.
                if own.cli_session_id in self._snapshot.desktop_cli_ids:
                    raise ResumeRefused("That id belongs to a Claude desktop app session.")
                command = build_new_command(exe, own.cli_session_id, own.title,
                                            own.permission_mode)
        except (ResumeRefused, ValueError) as exc:
            return str(exc)
        self._start_turn(own.cli_session_id, command, own.cwd, message, own.title,
                         queued=queued)
        return None

    def _session_exists(self, own: OwnSession) -> bool:
        if own.started:
            return True
        return platform_paths.transcript_path(own.cwd, own.cli_session_id) is not None

    def _start_turn(self, session_id: str, command, cwd: str, prompt: str, title: str,
                    queued: bool = False):
        holder = {"id": session_id}

        def on_event(event: TurnEvent):
            wx.CallAfter(self._on_turn_event, holder, title, event)

        runner = TurnRunner(command, cwd, prompt, on_event)
        self._runners[session_id] = runner
        self._denials[session_id] = []
        runner.start()
        self._update_send_state()
        self._feedback(f"Sent your queued message. {title} is working." if queued
                       else f"Sent. {title} is working.")
        self._store_write(self.store.update, session_id, state=IDLE, detail="",
                          last_activity_ms=int(time.time() * 1000))

    def _on_turn_event(self, holder, title, event: TurnEvent):
        if not self:
            return
        session_id = holder["id"]
        if event.kind == "started":
            reported = event.session_id
            if reported and reported != session_id and session_id in self._runners:
                # Claude chose a different id than the one we asked for.
                self._store_write(self.store.rename_id, session_id, reported)
                self._runners[reported] = self._runners.pop(session_id)
                self._denials[reported] = self._denials.pop(session_id, [])
                for per_session in (self._drafts, self._queued):
                    if session_id in per_session:
                        per_session[reported] = per_session.pop(session_id)
                if self._open is not None and self._open.cli_session_id == session_id:
                    self._open.cli_session_id = reported
                    self._open.key = f"own:{reported}"
                    # The old reader points at the old id's transcript.
                    self._reader = None
                    self._open_generation += 1
                    self._chat_loaded = False
                holder["id"] = reported
                session_id = reported
            own = self.store.get(session_id)
            if own is not None and not own.started:
                self._store_write(self.store.update, session_id, started=True)
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
            # UI first, store writes after: a failed write must not leave the
            # session looking busy for good.
            runner = self._runners.pop(session_id, None)
            denials = event.denials or self._denials.pop(session_id, [])
            self._denials.pop(session_id, None)
            is_open = self._open is not None and self._open.cli_session_id == session_id
            self._update_send_state()
            # Text to give back, oldest first: a first message that never
            # reached Claude, then anything queued behind it.
            unsent = []
            if (event.kind == "failed" and runner is not None
                    and not runner.session_started and not runner.cancelled):
                unsent.append(runner.prompt)
            queued = self._queued.pop(session_id, None)
            if event.kind == "failed" or event.is_error:
                state, detail = NEEDS_YOU, announce.status_text(event.text or "error", 120)
            elif denials:
                count = len(denials)
                state = NEEDS_YOU
                detail = f"{count} tool{'s were' if count != 1 else ' was'} refused"
            else:
                state, detail = IDLE, ""
            self._store_write(self.store.update, session_id, state=state, detail=detail,
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
            if is_open:
                self._refresh_chat()
            if queued:
                # After a failure the queued message goes back instead: what
                # it follows didn't happen. Before the list refresh, so the
                # list sees the new turn running.
                problem = "the turn before it failed"
                if event.kind != "failed" and not event.is_error:
                    problem = self._send_now(session_id, queued, queued=True)
                if problem:
                    unsent.append(queued)
                    # Spoken, not a dialog: this send wasn't Kelly pressing a
                    # key, and he may be in another session or another app.
                    # Feedback queues behind the reply instead of cutting it
                    # off; Ctrl+Shift+R must still repeat it if a keypress
                    # silenced it.
                    refused = (f"Your queued message for {title} wasn't sent: "
                               f"{problem.rstrip('.')}. It's back in the message box.")
                    self._feedback(refused)
                    self._last_announcement = refused
            if unsent:
                self._give_back(session_id, "\n\n".join(unsent), is_open)
            self._update_send_state()
            self.refresh_sessions()

    def _give_back(self, session_id: str, message: str, is_open: bool):
        """Put ``message`` back in the session's reply box, before anything
        typed since (it was written first), so nothing is lost. The caret
        stays at the end, where Kelly was typing."""
        if is_open:
            typed = self.reply_text.GetValue()
            self.reply_text.SetValue(f"{message}\n\n{typed.lstrip()}" if typed.strip()
                                     else message)
            self.reply_text.SetInsertionPointEnd()
        else:
            typed = self._drafts.get(session_id, "")
            self._drafts[session_id] = (f"{message}\n\n{typed.lstrip()}" if typed.strip()
                                        else message)

    def on_stop(self, _event=None):
        info = self._open
        runner = self._runners.get(info.cli_session_id) if info else None
        if runner is None:
            self._feedback("Nothing is running.")
            return
        runner.cancel()
        queued = self._queued.pop(info.cli_session_id, None)
        if queued:
            self._give_back(info.cli_session_id, queued, True)
            self._update_send_state()
            self._feedback("Stopping. Your queued message is back in the message box.")
            return
        self._feedback("Stopping.")

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
        self._feedback("Settings saved.")

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
        in_session = focus is not None and focus is not self.session_list and \
            self._is_in_session_view(focus)

        if key in (wx.WXK_RETURN, wx.WXK_NUMPAD_ENTER):
            if ctrl and focus is self.reply_text:
                self.on_send()
                return
            if not ctrl and not event.AltDown() and focus is self.session_list:
                self.on_open_session()
                return
            if not ctrl and focus is self.chat_list:
                self.on_read_message()
                return
        if key == wx.WXK_ESCAPE and in_session:
            self.focus_sessions()
            return
        if key == wx.WXK_BACK and not ctrl and focus is self.chat_list:
            self.focus_sessions()
            return
        if key == wx.WXK_DELETE and focus is self.session_list:
            self.on_forget(None)
            return
        if ctrl and key in (ord("C"), ord("c")) and focus is self.chat_list:
            self._copy_message()
            return
        event.Skip()

    def _is_in_session_view(self, window) -> bool:
        """True for the messages list, the reply area and the controls after
        them (everything but the sessions list)."""
        return window is not None and window.GetTopLevelParent() is self

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
            self._feedback("Message copied.")

    # ---------------------------------------------------------------- close

    def _on_close(self, event: wx.CloseEvent):
        if self._runners and event.CanVeto():
            count = len(self._runners)
            answer = wx.MessageBox(
                f"Claude is working in {count} TheClaudeHub session"
                f"{'s' if count != 1 else ''}. Quit anyway? The running turn"
                f"{'s' if count != 1 else ''} will be stopped"
                f"{', and queued messages will not be sent.' if self._queued else '.'}",
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

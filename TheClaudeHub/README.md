# TheClaudeHub

> **Status: version 1, not yet released.** The backend has been run for real against Claude Code
> 2.1.289 on Windows (a new session and a reply, on the subscription login). The window has been
> driven by keyboard in the vmtest VM with made-up sessions. It has not yet had a pass with JAWS
> or NVDA.

A keyboard and screen reader friendly reader for Claude Code sessions. It lists every session the
Claude desktop app has open, shows each one as a conversation you can arrow through, tells you
when a session answers, and switches the desktop app to a session when you need the real thing.
It can also start sessions of its own, which you can read and reply to entirely from here.

It runs on your existing Claude subscription. It never uses an API key and costs nothing extra.

## What it does

One window, three parts, in Tab order: the **session list**, the **messages** of the loaded
session, and the **reply box** with Send and Stop. Shift+Tab goes back the same way, and the
session list is always there.

- **Session list.** Each item reads its title, its repo folder, its state (needs you, working or
  idle), and when it was last active: "Fix the release build, QuickMail, needs you: Choose a
  version number, active 1 minute ago". Sessions that need you come first, then working ones, then
  the rest, newest first. The list refreshes itself every five seconds. While you're in the list,
  rows don't move: a changed session is updated where it is and a new one is added at the end.
  F5, or a refresh while you're elsewhere, puts it back in order, keeping you on the same session.
  Arrowing doesn't load anything; **Enter loads that session** into the messages list, moves you
  there, and says "Loaded Quiet one, 12 messages."
- **Messages:** newest last, with focus on the newest. Each reads "You:" or "Claude:" and its
  first line, and the list's name says the session's state and whether it's read-only. **Enter**
  (or the context menu's Read Full Message, with the Applications key or Shift+F10) shows the
  whole message in a read-only text box, to read by line, word and character; Escape closes it,
  back on the same message. Question cards read as "Claude asked: Which version?" with the
  options in the full text, then "You answered: ...". Refused tools read "Permission denied:
  ...". Tool calls and tool results are hidden unless you turn on Show Tool Activity (Ctrl+T).
  New messages arrive at the end without moving you.
- **Reply box:** for TheClaudeHub's own sessions, type and press Ctrl+Enter (or Send). You stay in
  the reply box. For desktop app sessions the same place holds a read-only note saying why
  replying happens in Claude, and an Open in Claude button.
- **Escape** in the messages or the reply box (or Backspace in the messages) goes back to the
  session list, on the same session. Enter there on the session that's already loaded takes you
  back to its messages where you left them, without reloading.
- **Open in Claude** (Ctrl+O) switches the desktop app to the session, for approving a permission
  prompt or answering a question card there.
- **New Session** (Ctrl+N) starts a session of TheClaudeHub's own: choose a folder, a title, a
  permission mode (auto by default; accept edits, manual and plan are offered) and the first
  message. If that first message never reaches Claude (Claude Code not signed in, say), it goes
  back into the reply box and Send starts the session again.
- **Announcements.** When the open session gets a new reply, or one of TheClaudeHub's sessions
  finishes a turn, or any listed session stops working, it's announced through your screen reader
  (or a system voice) and put on the status bar. Settings (Ctrl+Comma) chooses full (the whole
  reply), summary (the session's name and the first sentence) or silent (status bar only), whether
  every listed session is announced or just the open one, and the speech route. Ctrl+Shift+R
  repeats the last announcement.
- **Answers to what you do are spoken too**, briefly and without cutting off your screen reader:
  "Sent. Hub probe is working.", "Tool activity shown.", "Message copied.", and so on (unless
  announcements are set to silent).
- **Turn Status** (Ctrl+Shift+T) says how long Claude has been working on the current turn and what
  it last did. There's no time limit on a turn; Stop (Ctrl+Period) ends it, along with anything it
  started, such as a build.

## Install and run

You need Windows, Python 3.11 or later, and Claude Code installed and signed in (the `claude`
command, the same login the desktop app uses).

```
cd TheWorkBench\TheClaudeHub
pip install -r requirements.txt
pythonw TheClaudeHub.pyw
```

`python -m theclaudehub` also works. To run the tests: `pip install -r requirements-dev.txt`, then
`python -m pytest tests`.

## Keyboard shortcuts

The same list is in the app under Help, Keyboard Shortcuts (F1).

| Where | Key | What it does |
|---|---|---|
| Anywhere | Tab, Shift+Tab | Session list, messages, reply box, and back |
| Anywhere | Ctrl+1, Ctrl+2, Ctrl+3 | Go to the session list, the messages, the reply box |
| Messages or reply box | Escape | Back to the session list, on the same session |
| Messages | Backspace | Also back to the session list |
| Session list | Enter | Load that session and move to its messages |
| Session list | Ctrl+O | Open the selected session in the Claude desktop app |
| Session list | Ctrl+N | New TheClaudeHub session |
| Session list | F5 | Refresh the list now and put it in order |
| Session list | Delete | Forget the selected TheClaudeHub session (asks first; its transcript is kept) |
| Messages | Enter, or Applications key then Read Full Message | Read the whole message; Escape comes back to it |
| Messages | Ctrl+C | Copy the whole message |
| Messages | Ctrl+T | Show or hide tool activity |
| Messages | Ctrl+O | Open this session in the Claude desktop app |
| Reply box | Ctrl+Enter | Send (TheClaudeHub sessions only); you stay in the reply box |
| Reply box | Ctrl+Period | Stop the running turn |
| Reply box | Ctrl+Shift+T | Turn status: how long it has been working, and on what |
| Anywhere | F1 | Keyboard shortcuts |
| Anywhere | Ctrl+Comma | Settings |
| Anywhere | Ctrl+Shift+R | Repeat the last announcement |
| Anywhere | Alt+F4 | Quit |

Menus are Session (Alt+S), View (Alt+V) and Help (Alt+H). Controls have their own Alt letters
(Alt+L the session list, Alt+M the messages, Alt+Y the reply box, Alt+D Send), and none of them
takes a menu's letter.

## How it works

Everything it reads is on your own PC, so reading costs nothing.

| What | Where |
|---|---|
| The desktop app's sessions | `%APPDATA%\Claude\claude-code-sessions\<id>\<org>\local_<id>.json`: title, folder, last activity, archived, and sometimes a summary of the last turn that says whether it needs you. Archived sessions are left out. |
| Whether a session is working | `%USERPROFILE%\.claude\sessions\<pid>.json`, which says busy or idle while Claude Code runs it. Files whose process has gone are ignored. |
| The conversation | `%USERPROFILE%\.claude\projects\<folder>\<session>.jsonl`, where `<folder>` is the session's folder with every character that isn't a letter or digit turned into `-`. This was checked against every transcript on Kelly's PC; if it ever misses, the app searches all the project folders for the session id instead. |
| TheClaudeHub's own sessions | `%APPDATA%\TheClaudeHub\sessions.json` (and `speech.json` for settings). If `sessions.json` can't be read, it's renamed to `sessions.json.bad-<date>` rather than overwritten, and the app says so. |
| Errors | `%APPDATA%\TheClaudeHub\error.log`: anything that went wrong unexpectedly, with its traceback |

None of these formats is documented, and Claude Code says the transcript format changes between
versions. So all the knowledge of it is in one small module (`theclaudehub/transcript.py`) that
skips record types it doesn't know, never crashes on a line it can't read, and says "couldn't read
N lines" instead. A long transcript is read once, then only its new lines as it grows.

**TheClaudeHub never writes to the desktop app's files or to any transcript.** The only files it
writes are its own, in `%APPDATA%\TheClaudeHub`. Only one copy runs at a time; starting a second
brings the first to the front.

### Its own sessions, and why desktop sessions are read-only

TheClaudeHub drives its own sessions with the `claude` command in print mode:
`claude -p --output-format stream-json --verbose --permission-mode <mode> --permission-prompts none`,
with `--session-id` and `--name` for the first message and `--resume <id>` for each reply. The
message goes in on standard input, byte for byte. That runs under the same login as the desktop
app, which is why it costs nothing extra.

- It never uses `--bare`, which needs an API key.
- It needs the native `claude.exe`. The npm install's `claude.cmd` is refused, because Windows runs
  a `.cmd` through `cmd.exe`, which would let characters in a session title run a command.
- Before starting `claude` it removes two named sets of environment variables, and keeps the rest
  (your `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CONFIG_DIR`, proxy and timeout settings). The first set
  is what a Claude session puts in the environment of anything started inside it: started from
  there, the app would otherwise pass on variables that point `claude` at the desktop app's local
  proxy and tell it someone else will refresh its sign-in, and the run then waits for a refresh
  that never comes. The second is anything that would move billing off the subscription:
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and the Bedrock, Vertex and
  Foundry switches. Both lists are in `claude_cli.py`.
- As a second check, `claude` reports where its credentials came from before it sends anything.
  If that's an API key rather than the subscription login, TheClaudeHub stops the run and says so.

Desktop app sessions are read-only because two programs resuming one session run their turns into
the same transcript at once and tangle it. Only the desktop app writes to its sessions, and only
TheClaudeHub writes to its own. The rule is enforced in code: TheClaudeHub refuses to build a
`--resume` command for any session it didn't start, any session the desktop app knows about
(archived ones included), or any `local_` id, and there are tests for each. It also won't send
into one of its own sessions while that session is running somewhere else. One turn runs at a time
per session. Send during a turn queues the message: TheClaudeHub says "Queued", and once the
turn's reply has been announced, it sends the message. More messages sent while one is waiting
join it, and they go together as one message. Turn status (Ctrl+Shift+T) says when a message is
queued. If the turn fails, or you press Stop, the queued text goes back in the message box
instead, ahead of anything typed since, with the cursor left at the end. While one of
TheClaudeHub's sessions is loaded, Send and Stop are never disabled, so from the message box, Tab
is always Send and the next Tab is always Stop. When a turn is running, Tab doesn't jump past
Send to Stop.

Every announcement is also written to `speech.log` in `%TEMP%\theclaudehub-speak` (on a Mac,
`$TMPDIR/theclaudehub-speak`), one line each: the time, whether it interrupts or waits its turn,
the speech engine, and its opening words. A line means the text was handed to the speech engine,
not that it was heard: a later announcement that interrupts can cut it off. The log shows
whether a reply went to the screen reader at all when you didn't hear it.

A turn runs `claude` in a Windows job object, so Stop, or quitting the app, ends `claude` and every
program it started (a build or test run, say), not just `claude` itself. The same happens when a
turn finishes normally: anything Claude started and left running, such as a development server,
ends with the turn. (Ask Claude to start long-running servers in a terminal of your own instead.)
`claude` is started suspended and only let run once it's in the job, so nothing it starts can
slip out first.

### What headless sessions do with questions and permissions

Checked with Claude Code 2.1.289:

- **Question cards don't happen.** In print mode Claude Code doesn't offer the AskUserQuestion
  tool at all, so Claude asks its question in ordinary words and you answer in the reply box.
  Question cards in desktop app sessions are shown as text in the chat ("Claude asked: ...,
  Options: ...", then "You answered: ...").
- **Nothing can approve a permission prompt**, so `--permission-prompts none` refuses anything
  that would ask, straight away; the turn carries on rather than waiting. (Checked in manual mode:
  the refused Write came back at once and Claude finished the turn explaining it.) Claude is
  told and usually says what it couldn't do. TheClaudeHub adds the refused tools to the
  announcement ("1 tool was refused: Write was refused: C:\...\probe.txt"), marks the session
  "needs you", and the chat shows a "Permission denied" line. In auto mode, Claude's safety check
  decides most of what would otherwise ask, so refusals are rarer there.

## Limitations

- Windows only for now. The OS-specific parts are in `theclaudehub/platform_paths.py` and the
  speech scripts, so a Mac version mostly means changing those.
- "Needs you" for desktop sessions depends on the desktop app's turn summary, which it doesn't
  always write. A session without one shows as idle once it stops working.
- A desktop session's transcript can be gone if it's older than Claude Code's retention period
  (`cleanupPeriodDays`, 90 days on Kelly's PC). The chat says so.
- TheClaudeHub's own sessions don't appear in the desktop app, so Open in Claude doesn't work for
  them; the app says so.
- Subagent conversations are left out of the chat.
- Turns of TheClaudeHub's own sessions are also spoken by ClaudeSpeak's Stop hook, if that's
  installed, since `claude -p` runs hooks; so a reply can be heard twice.
- The desktop app's file formats are undocumented and could change with any update.

## Files

| Path | What |
|---|---|
| `TheClaudeHub.pyw` | Double-click launcher |
| `theclaudehub/transcript.py` | Transcript parser |
| `theclaudehub/sessions.py` | Desktop metadata, live state, sorting, the list wording |
| `theclaudehub/own_store.py` | TheClaudeHub's own sessions |
| `theclaudehub/claude_cli.py` | `claude` commands, the `--resume` guard, the environment, stream-json events, running a turn |
| `theclaudehub/hub.py` | Gathering the list, noticing finished turns |
| `theclaudehub/announce.py` | What gets announced |
| `theclaudehub/speech.py`, `theclaudehub/speech/` | Speech, adapted from Image Description Toolkit (ClaudeSpeak's engine scripts) |
| `theclaudehub/platform_paths.py` | Every path and OS call |
| `theclaudehub/ui/` | The wxPython window and dialogs |
| `tests/` | pytest tests, built on made-up records shaped like the real ones |

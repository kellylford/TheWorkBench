# TheClaudeHub

> **Status: version 0.1.0, ready for its first release.** Used with JAWS on Kelly's PC; the
> installer, uninstaller and update check have been tested in the vmtest VM. Downloading and
> installing an update needs two published releases, so it is first tried with 0.1.1. It has not
> yet had a pass with NVDA.

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
  prompt or answering a question card in a desktop app session.
- **Continue Here** (Ctrl+Shift+N, or the button beside Open in Claude) carries a desktop app
  session on in TheClaudeHub, as a copy: a new TheClaudeHub session in the same folder, with the
  whole conversation so far in its messages, that you reply to here. You type its first message
  in the same dialog as New Session; the title starts as "<title> (continued)". The desktop app
  session isn't changed, and what you do in the copy doesn't appear in it.
- **New Session** (Ctrl+N) starts a session of TheClaudeHub's own: choose a folder, a title,
  the model (Alt+D), a permission mode (auto by default; accept edits, manual and plan are
  offered) and the first message. The models are Default (your Claude Code setting), Opus,
  Sonnet and Haiku, each the latest of its family. The model is kept with the session and
  passed to every turn. Arriving in the messages, you hear it ("Messages in Build (idle, on
  Opus)"). Fable isn't offered: on some plans it bills to usage credits, and in the headless
  mode TheClaudeHub uses, Claude Code does that without asking. If that first message never reaches Claude (Claude Code not signed in, say), it goes
  back into the reply box and Send starts the session again.
- **Claude asks, you answer.** In TheClaudeHub's own sessions, when Claude needs permission
  for something the permission mode doesn't allow, asks you a question, or has a plan for you
  to approve, the turn waits for you. It's announced ("Build needs you. Claude wants to run
  git push. Ctrl+Shift+A answers."), and the session shows as needing you in the list.
  **Ctrl+Shift+A** opens the answer:
  - **Permission:** the whole request (the command, or the file and what would change) to
    read by line, then **Allow**, **Allow for this session** (shown when Claude Code suggests
    a rule, and named in full, such as "don't ask again this session for Bash(git push:*)"),
    or **Deny**, which is the default button and can carry a reason Claude reads.
  - **Questions:** each question is a group of options with their descriptions, with Other
    and a box to type your own answer; Send Answers, or Don't Answer.
  - **Plan:** the plan to read, then **Approve**, choosing the mode to carry on in (accept
    edits, auto or manual), or **Keep Planning** with what to change, which is the default.

  Escape in any of them answers later; nothing is approved or refused by waiting. "For this
  session" lasts for the session, not just the turn: TheClaudeHub keeps the rule with the
  session and gives it to every later turn. It never writes Claude Code's settings files.
- **Announcements.** When the open session gets a new reply, or one of TheClaudeHub's sessions
  finishes a turn, or any listed session stops working, it's announced through your screen reader
  (or a system voice) and put on the status bar. Settings (Ctrl+Comma) chooses full (the whole
  reply), summary (the session's name and the first sentence) or silent (status bar only), whether
  every listed session is announced or just the open one, and the speech route. Ctrl+Shift+R
  repeats the last announcement.
- **Answers to what you do are spoken too**, briefly and without cutting off your screen reader:
  "Tool activity shown.", "Message copied.", and so on (unless announcements are set to silent).
- **Your own message is read back when it's sent**, so you hear what actually went to Claude,
  and where: "Sent to Hub probe: Fix the build." During a turn it's "Queued for Hub probe: …",
  and when the queued message goes out you hear only "Sent your queued message", not the
  message again. It follows the announcement level: at full, the message up to about 300
  characters, then "… and 412 more words"; at summary, its first sentence; at silent, nothing.
  Markdown is read as words: a code block is "Code block omitted", and headings and list items
  are read as separate sentences. Turn it off in Settings with "Read your own messages back when
  they're sent" (Alt+M), and you hear just "Sent. Hub probe is working."
- **Turn Status** (Ctrl+Shift+T) says how long Claude has been working on the current turn and what
  it last did. There's no time limit on a turn; Stop (Ctrl+Period) ends it, along with anything it
  started, such as a build.

## Install

You need Windows 10 or 11 and **Claude Code installed with its native installer and signed in**
to a Claude subscription (the `claude` command, the same login the desktop app uses).

Download `TheClaudeHub-theclaudehub-Setup.exe` from the newest **TheClaudeHub** release on
[TheWorkBench's releases page](https://github.com/kellylford/TheWorkBench/releases) and run it.
It installs for you only, with no administrator rights, adds TheClaudeHub to the Start menu, and
starts it. The portable zip from the same release runs without installing, but doesn't update
itself.

The app is built for x64; Arm PCs run it under Windows's x64 emulation.

## Updates

The installed app checks for a new version a few seconds after it starts, and whenever you choose
Help, Check for Updates. At start it only speaks up when there is a new version, and then only
says so: it never opens a dialog you didn't ask for. From Help it always says what it found ("up to
date", "no release has been published yet", or an error), even with announcements set to silent.

From Help, a new version is offered in a Yes/No dialog where No is the default. If you choose Yes,
it downloads the update, closes, and starts the new version. It won't install while Claude is
working in one of its sessions, and it warns you if a reply box holds text you haven't sent. If a
turn starts, a dialog opens, or you type a reply while it downloads, it asks again or leaves the
update to be installed the next time TheClaudeHub starts.

**Updating never touches your sessions or settings.** The app lives in
`%LOCALAPPDATA%\TheClaudeHub`, which Velopack replaces on update and removes on uninstall. Your
data is in `%APPDATA%\TheClaudeHub`, a different folder that neither goes near, and the updater
refuses to run if that were ever not so. What the updater did is logged in
`%APPDATA%\TheClaudeHub\update.log`.

The version is in Help, About. Releases come from tags named `theclaudehub-v<version>` in
TheWorkBench, which holds several apps, so TheClaudeHub publishes its update feed on its own
Velopack channel (`releases.theclaudehub.json`). The updater finds the newest
`theclaudehub-v*` release itself and reads the feed from that release only, so however many
other apps' releases come after it, an update is never missed.

## Run from source (development)

You need Python 3.11 or later.

```
cd TheWorkBench\TheClaudeHub
pip install -r requirements-dev.txt
pythonw TheClaudeHub.pyw
python -m pytest tests
```

`python -m theclaudehub` also works. A copy run from source doesn't update itself; Help, Check
for Updates says so, and names the newest release.

### Releasing

The version lives in one place, `__version__` in `theclaudehub/__init__.py`. To release:

1. Set `__version__`, and write `release-notes/v<version>.md` (what it is, what's new, downloads,
   requirements), in one commit on main.
2. Tag it `theclaudehub-v<version>` and push the tag.

`.github/workflows/release-theclaudehub.yml` then runs the tests, fails if the tag and
`__version__` disagree, builds the app with PyInstaller, smoke-tests the built exe, signs it with
Azure Artifact Signing, packs the Velopack installer, portable zip and update feed (signing
Setup, the updater and the launcher too), checks every signature, and publishes a GitHub release
(a pre-release before 1.0). Run by hand or for a pull request, it does everything but publish,
and keeps the files as a workflow artifact; tick "sign" on a hand run to sign and check them too.

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
| Anywhere | Ctrl+Shift+N | Continue the selected (or loaded) desktop app session here, as a copy |
| Session list | F5 | Refresh the list now and put it in order |
| Session list | Delete | Forget the selected TheClaudeHub session (asks first; its transcript is kept) |
| Messages | Enter, or Applications key then Read Full Message | Read the whole message; Escape comes back to it |
| Messages | Ctrl+C | Copy the whole message |
| Messages | Ctrl+T | Show or hide tool activity |
| Messages | Ctrl+O | Open this session in the Claude desktop app |
| Reply box | Ctrl+Enter | Send (TheClaudeHub sessions only); you stay in the reply box |
| Reply box | Ctrl+Period | Stop the running turn |
| Reply box | Ctrl+Shift+T | Turn status: how long it has been working, and on what |
| Anywhere | Ctrl+Shift+A | Answer Claude: a permission request, a question or a plan |
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
| The desktop app's sessions | `%APPDATA%\Claude\claude-code-sessions\<id>\<org>\local_<id>.json`: title, folder, last activity, archived, and sometimes a summary of the last turn that says whether it needs you. Archived sessions are left out. The Microsoft Store version of the desktop app keeps the same files in `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude-code-sessions`; both places are read, and a session in both is read from the newer copy. |
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

TheClaudeHub drives its own sessions with the `claude` command in print (headless) mode:
`claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode <mode>
--permission-prompts host --permission-prompt-tool stdio`, with `--session-id` and `--name` for the
first message and `--resume <id>` for each reply, plus `--allowedTools` with any rules you chose
"for this session". The message goes in on standard input as a stream-json message, and standard
input stays open for the turn so TheClaudeHub can answer what Claude asks; it's closed when the
turn's result arrives. That runs under the same login as the desktop app, which is why it costs
nothing extra.

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
into one of its own sessions while that session is running somewhere else. Continue Here is the
one exception that reads a desktop session through `claude`, and it doesn't write to it:
`--resume <desktop id> --fork-session --session-id <new id>` copies the history into a new
session. Checked with Claude Code 2.1.286: the desktop session's transcript was byte for byte the
same afterwards, and Claude knew the earlier conversation. One turn runs at a time
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

Checked with Claude Code 2.1.286 (issues #187 and #188):

- **Permission prompts, questions and plans come to TheClaudeHub.** With
  `--permission-prompts host --permission-prompt-tool stdio`, anything that would ask arrives on
  the turn's output as a `can_use_tool` request, the same control protocol the Agent SDK uses,
  and the turn waits for the answer on its input. AskUserQuestion and ExitPlanMode come the same
  way: a question is answered by allowing the tool with the answers added to its input, a plan
  is approved by allowing it with a switch of permission mode, and Keep Planning denies it with
  your note. Each was checked against the real CLI: an allowed Write wrote its file; a denied
  one didn't, and Claude quoted the reason it was given; an approved plan carried on in accept
  edits without asking again.
- **Refusals still happen without asking** where Claude Code's own rules say so (a write outside
  the session's folder, say, or auto mode's safety check). TheClaudeHub adds those to the
  announcement ("1 tool was refused: ..."), marks the session "needs you", and the chat shows a
  "Permission denied" line.
- Question cards in desktop app sessions are shown as text in the chat ("Claude asked: ...,
  Options: ...", then "You answered: ...") and answered in Claude.

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
| `theclaudehub/updater.py` | Velopack updates, adapted from GHManage's updater |
| `tools/check_version.py` | Prints the version; checks a release tag against it |
| `tools/make_version_info.py` | The Windows version resource for the built exe |
| `release-notes/` | One file per release, used as the GitHub release's notes and the update's notes |

# Sheephead Multiplayer — implementation plan

Tracking: [issue #58](https://github.com/kellylford/TheWorkBench/issues/58).
Scoping and cost analysis: [issue #20](https://github.com/kellylford/TheWorkBench/issues/20).

This plan has been through **four review passes** — one on the first draft, then three independent
reviewers who were not told what the earlier passes found. Where a review contradicted the plan, the
plan was wrong, and it says so rather than quietly correcting itself. The corrections are the most
useful part of this document.

Every code claim below was verified against the source before it was written down.

## Goal

People in different places play Sheephead against each other in a browser, with the existing AI
filling any seat nobody is sitting in. Fully playable by keyboard and screen reader, to the same
standard as the single-player game.

Table sizes stay what the engine supports: **three to six seats**. The number of *humans* can be two
upwards — two people at a three-seat table means one bot. (An earlier draft said "two to six people",
which read as a table size and was wrong: there is no two-handed Sheephead.)

## Non-goals for the first milestone

Accounts, passwords, email. Persistent cross-session scoreboards. Spectators. Matchmaking with
strangers or public table lists. Mobile app anything.

## The hard constraint

`sheephead/` is not modified. It stays static, dependency-free, and playable from a folder with no
server. All work happens in `sheephead-multiplayer/`, forked at `160ff33`.

**This constraint needed enforcing, not just stating.** A reviewer pointed out that nothing checked
it: the commit claimed the new CI job would catch a violation, and it would not have. There is now a
guard step that diffs `sheephead/` against `main`.

**It also leaked in a way nobody predicted.** `localStorage` is scoped to the *origin*, not the path.
Both builds publish under `kellylford.github.io`, so the fork inherited `sheephead.settings.v4` and
shared it with the live game — and `loadSettings()` calls `removeItem` on everything in
`OLD_STORE_KEYS`, so the first time this fork bumped its schema it would have **deleted a player's
real settings**. Fixed: the fork uses `sheephead-mp.settings.v1` with an empty `OLD_STORE_KEYS`.
Nothing beginning `sheephead.settings.` may ever appear in this directory again.

Same class of problem, also fixed: bug reports from this build were titled `[sheephead]` and pointed
at the stable game's URL, and exported logs were named `sheephead-log-*` and collided in Downloads.

## Architecture

```
Browser (static, GitHub Pages)          Cloudflare Worker + Durable Object
┌────────────────────────────┐          ┌──────────────────────────────────┐
│ cards.js  game.js  ai.js   │          │ cards.js  game.js  ai.js         │  ← both modified
│ ui.js                      │          │ view.js   (projection)           │    for privacy
│ table.js (the seam)        │◄────────►│ auth.js   (action authorization) │
│ net.js   (transport)       │ WebSocket│ room.js   (Durable Object)       │
│                            │          │   - authoritative FULL state     │
│ offline: engine runs local │          │   - AI on full state, never view │
└────────────────────────────┘          │   - alarms drive every timeout   │
                                        └──────────────────────────────────┘
```

**Correction from review — the engine is not shared unmodified.** The first draft claimed the three
engine files would run on both sides with only their `})(window)` tail changed, citing
`tests/hidden-information.js` as proof. That citation was wrong: the test does `sandbox.window =
sandbox`, so it *provides* a window rather than proving the tail can change. Loading needs no engine
change (the Worker sets `globalThis.window = globalThis`); **privacy does**.

---

# 1. Action authorization — the hole the first three drafts missed

`doBury(state, cardIds)` ([game.js:194](js/game.js:194)) **takes no actor parameter**. It checks
`state.phase === 'bury'` and nothing else, then operates on `state.players[state.picker]` regardless
of who asked. `doPick(state, p)` and `doPlay(state, p, cardId)` both verify `state.turn === p`;
`doBury` verifies nothing.

Harmless in single-player, where the UI only calls it for seat 0 when seat 0 is the picker. Online it
means any connected client can send a bury and play another player's turn. **This voids the entire
authoritative-server premise**, which is why it is section 1.

Required, in M2 alongside the projection:

- `applyAction(state, seat, action)` in `auth.js` is the **only** path into the engine. Nothing else
  may call `doPick`/`doPass`/`doBury`/`doPlay`.
- It rejects `seat !== state.turn` for pick, pass and play, and `seat !== state.picker` for bury.
- Either `doBury` gains a seat argument, or the gate owns the check as a documented invariant. Prefer
  the seat argument — an invariant that lives only in a comment is the thing that just failed.
- **A test that seat A cannot act as seat B.** The security tests previously listed were all about
  *seat ownership* (two clients claiming a seat, a replayed reconnect token). *Action authorization*
  is a different axis and is the one that matters most.
- A hostile-payload test: `doPick(state, 99)` throws on `state.players[99].name`, and an unhandled
  throw inside the Durable Object kills the room for everyone.

---

# 2. Engine privacy surgery

Two places build public and private text into a **single string**, gated on `isHuman` — and online
every seat is human:

1. **`assignPartner`** ([game.js:254](js/game.js:254)) appends "You have the Jack of Diamonds
   yourself…" onto the public picker announcement. One event, two audiences.
2. **`computeDoublers`** ([game.js:292](js/game.js:292)) emits "You hold both black queens…" for any
   seat where `isHuman` is true — online, once per holder, into shared state.

Fix: split both into a public event and a private one, and extend `ev()` with an audience tag.

**Two details that would have bitten:**

- `ev(state, kind, text, extra)` **copies every key of `extra` straight onto the event**
  ([game.js:130](js/game.js:130)) — and `doPlay` and `resolveTrick` already use it for `{player,
  card, textPlain}` and `{winner, points}`. So `audience` must coexist with those *and be stripped
  before delivery*, or it ships to clients and tells them an event was targeted.
- **`textPlain` must survive projection.** `drain()` picks `e.textPlain` when `!settings.verbose`
  ([ui.js:275](js/ui.js:275)), and verbosity stays per-client, so every entitled seat needs both
  strings.

**`state.events` has a destructive consumer.** `drain()` splices it empty ([ui.js:272](js/ui.js:272)).
Nothing drains it server-side, so it grows for the room's lifetime and is serialized on every
hibernation. Needs a monotonic index, per-seat cursors and truncation. The index is also the reconnect
mechanism — re-delivering announcements a returning player already heard is an accessibility failure.

**`isHuman` is the wrong concept entirely.** `createGame` hardcodes `isHuman: i === 0`
([game.js:35](js/game.js:35)). What the server needs is per-seat **occupancy**: human, bot, or away.
Sites: `createGame:35`, `assignPartner:256`, `computeDoublers:291`, `scoreNormal:624`,
`transcript:735` (the `(you)`/`(computer)` labels) and `pushInProgress:822`.

---

# 3. Per-seat projection

`viewFor(state, seat)` returns a new object built by **allowlist**. Never a deny-list over a copy.

**The table below is the spec, and it must be complete.** A reviewer's sharpest structural point: a
partial table *is* a deny-list wearing an allowlist's clothes. `state` has 24 top-level fields and 7
per player; every one needs a decision.

| Field | Rule |
|---|---|
| `players[i].hand` | Own hand only. Others become placeholders — shape spec below. |
| `players[i].name`, `index`, `tricksWon`, `points`, `score` | Public. |
| `players[i].isHuman` | Replaced by occupancy (human / bot / away). |
| `dealt` | Every hand at deal time. **Only at `handOver`.** This is the reveal channel for the blind. |
| `blind` | **Send `length` only, always.** See correction below. |
| `buried` | Picker only, until `handOver`. |
| `pickedUp` | Literally the blind's contents. Picker only; cleared at bury. |
| `alone`, `partner` | Hidden until `partnerRevealed`. |
| `doublers` | Entries carry `player: i` — **names who holds the queen pair.** Withhold until `handOver`. |
| doubler *factor* | Also withheld: a hand visibly worth 2× says a pair exists. |
| `redealDoubler` | Public (this hand is doubled). **Distinct from `config.redealDoubler`, the rule.** Easy to conflate; dropping it breaks `doublerFactor` client-side. |
| `nextHandDoubler` | Public. |
| `result` | Structurally intact — see the summary correction below. |
| `history` | **Not in `view` at all.** See §4. |
| `events` | Audience-filtered, delivered by cursor, both `text` and `textPlain`. |
| `config` | Allowlist. `onStart` copies **every** settings key in, including `name`, `pace`, `skin`. |
| `phase`, `turn`, `leader`, `dealer`, `handNumber`, `passCount`, `isLeaster`, `trick`, `lastTrick`, `played`, `trickLog`, `pickLog`, `revealInfo` | Public. |

### Correction: the blind rule was wrong, and the right rule is simpler

The previous draft said "hidden until picked, then picker-only; in a leaster it stays populated all
hand". Both halves are wrong:

- `doPick` sets `state.blind = []` ([game.js:157](js/game.js:157)). After a pick there is no blind to
  be picker-only about — the contents live in `pickedUp` and in the picker's hand.
- In a leaster, `resolveTrick` sets `state.blind = []` on the final trick
  ([game.js:397](js/game.js:397)).

So **`blind` is empty at `handOver` on every path**, and revealing it there reveals nothing. The
actual reveal channel is `dealt.blind`. One rule — send `blind.length` only, always; send `dealt` at
`handOver` — replaces two, and the leaster special case disappears.

### Correction: `result.summary` must be seat-neutral in the engine

The previous draft offered a choice: per-seat inside `viewFor`, or seat-neutral in the engine. **Only
the second works.** `endHand` → `recordHand` stores `result: state.result` **by reference** into
`state.history` ([game.js:460](js/game.js:460)), and `transcript` prints `h.result.summary` verbatim.
Rewriting the summary per seat corrupts the permanent record for everyone but one player. `auditHand`
also reads `result.pickerPts`/`oppPts`, so the object must stay structurally intact. If a personalised
sentence is wanted, the *client* composes it from `result.deltas`.

### The placeholder shape is not free

"Opaque placeholders cost zero UI changes" is true for `p.hand.length`, and false beyond it. At
`handOver` `renderPlayers` calls `C.sumPoints` on card objects, which indexes `POINTS[c.r]`;
`sortHand` reads `.r`/`.s`; `renderHand` reads `.id`. A placeholder without `.r` yields `NaN` in the
totals row and trips the `bad-total` warning. **Specify the exact placeholder shape and assert it in
the test.**

### The counterfactual test needs a construction rule

"`JSON.stringify` identical between picker-alone and not" is the right instinct and unbuildable as
written — you cannot hold everything equal while moving the Jack of Diamonds, because the deal itself
differs. The counterfactuals must be **constructed**: same deal, JD swapped between two seats that
are neither the viewer nor the picker, compared for the viewer only. Otherwise the test is flaky or
vacuous.

Run at **every phase transition**, across every table size. Serialized comparison matters because
leaks happen through absence — `partner: -1` versus the key omitted, `buried: []` versus `undefined`,
array lengths, key order.

**What it cannot catch:** timing leaks (bot decision paths differ in length by hidden state, so
latency carries information) and leaks through derived client behaviour — `roleTags()` and the Role
column are the candidates.

---

# 4. State size, storage and the Durable Object

Measured by a reviewer, 5-player, `JSON.stringify(state)`: **≈2.1 KB per hand**, driven by
`recordHand` storing full `dealt.hands`, every trick, and the summary.

| hands | state JSON |
|---|---|
| 25 | 55.6 KB |
| 50 | 107.9 KB |
| 100 | 212.0 KB |
| 200 | 421.2 KB |

The Durable Object **per-value storage limit is 128 KiB**. A single-blob `state` write starts failing
around hand 60. `tests/transcript.js` already builds 300-hand histories, so this is not a
hypothetical session length for this codebase.

- History is **not** part of `view`. The client reads it in exactly two places — the export dialog and
  the bug summary ([ui.js:1406, 1542](js/ui.js:1406)) — and otherwise needs only `history.length` and
  the failed-audit count.
- Store history as **per-hand keys**, not one blob. Fetch on demand at export.
- Add room expiry and `deleteAll` GC. Abandoned rooms otherwise accumulate storage forever.

## What must be persisted, and which failures are silent

The in-process server (`js/localserver.js`) keeps room bookkeeping in a single
`room` object precisely so the Durable Object has one thing to persist. Losing any
part of it produces a **wrong game that looks like a working one**, which is worse
than a crash and much harder to diagnose:

| Lost on wake | What the player sees |
|---|---|
| `room.version` (resets to 0) | Clients hold versions in the hundreds, so every later view is discarded as stale. **The board freezes with no error and no timeout** — views keep arriving, they are just dropped. |
| `room.cursors` | The entire game's event log is replayed to every seat, so a screen reader re-announces the whole hand. |
| `room.lastSeq` | A retried frame plays a second card. |
| `connections` | The map is empty while the hibernated sockets are alive: moves apply and **nobody is told**. Must be rebuilt from `ctx.getWebSockets()`, with the seat in the socket attachment. |
| `state` itself | Eviction loses the game mid-hand. And `applyAction`'s `fatal` contract means "reload from the last known-good checkpoint" — there has to *be* a checkpoint. |

Three of those five are silent. None of them is caught by a test that runs in one
process without eviction, so M4 needs an explicit hibernate/wake test that
serializes everything, drops the in-memory objects, restores, and continues the
hand.

## Hibernation kills timers — the plan needs Alarms

The plan leans on WebSocket Hibernation and simultaneously requires a room-level bot delay, a
disconnect grace period, a ready-gate timeout and per-IP lockout windows. **A hibernated Durable
Object has no `setTimeout`.** Every one of those needs `storage.setAlarm()` and an `alarm()` handler,
which appeared nowhere.

Concrete failure: all humans away, a bot's turn — nothing arrives to wake the object, and the hand
stalls forever. That is the "everyone disconnects" open question, except it also happens when only
*some* disconnect.

Also: hibernation requires `state.acceptWebSocket()` and `webSocketMessage/Close/Error`, and per-socket
data survives only via `serializeAttachment` (2 KiB). **Per-seat cursors, the seat map and sequence
numbers cannot live in instance fields** — they are gone on wake. Say where they live.

Cheap test worth pinning now: `JSON.parse(JSON.stringify(state))` mid-hand, continue play, assert the
audit still passes. A reviewer ran it and it passes today — card objects are shared `BY_ID` singletons
that survive as value-equal copies and nothing depends on identity. Exactly the kind of property to
pin before it stops being true.

---

# 5. The AI server-side

- **The AI must run on full authoritative state, never on a projection.** `unseenFor` reads
  `state.buried` when the bot is the picker ([ai.js:22](js/ai.js:22)); `allyProb` reads
  `state.alone`/`state.partner` ([game.js:693](js/game.js:693)). Feeding it a view silently degrades
  it — placeholder hands give `TRUMP_VALUE[undefined]` and `C.points(undefined)`.
- The "AI never reads other hands" property is enforced **by convention inside `ai.js` only**, and no
  test asserts it under a bots-in-any-seat regime. Add one.
- **RNG: six sites, not two.** The previous draft cited `C.shuffle` and `newHand`'s first-dealer call.
  There are four more, all in the AI: difficulty jitter ([ai.js:114](js/ai.js:114)) and the easy-mode
  random card ([ai.js:166](js/ai.js:166)). "Seedable for deterministic replay" is false until all six
  take an injected `rng`.
- Swapping `crypto.getRandomValues` into the engine **breaks every existing test**: the `vm` sandboxes
  in `hidden-information.js`, `randomness.js` and `transcript.js` provide `{console, Math, Date, JSON,
  setTimeout, Set}` and no `crypto`.
- **No milestone owns bot seat control** — which seats are bots, scheduling their turns, handing a
  seat back on reclaim. Now M4.

---

# 6. The client rewrite

A **seat rewrite**, not a `tick()` rewrite.

- **~35 sites hardcode seat 0**: `isHumanTurn`, `trickNumber`, `textHand`, `textScores`, `textTeams`,
  `textCount`, `textOrder`, `hasPartnerCard`, `partnerCardMeaning`, `roleTags`, `renderStatus`,
  `renderHand`, `renderActions`, `resultHeadline`, `resultChips`, `activateCard`, `idleReason`.
- **`settings.numPlayers` appears 17 times in `ui.js`; `config.numPlayers` appears zero times.** Online
  the room decides table size. A client whose localStorage says 5, joining a 6-seat room, mis-renders
  everywhere.
- **`dealNext()` re-applies rules from local settings at every hand boundary** —
  `RULE_FIELDS.forEach(k => state.config[k] = settings[k])` ([ui.js:274](js/ui.js:274)). Left in
  place, every client silently overwrites the room's rules from its own localStorage on every deal.
  This line must be deleted in online mode.

**The seam is a deliverable.** A `Table` facade — `Table.requestPlay(id)`, `Table.onView(cb)` —
synchronous locally, asynchronous online. Without it, `if (online)` spreads across all 35 sites.

### Three client problems, all real

**The 60ms announce race will silently eat messages.** `announce()` blanks the live region then sets
text on a 60ms timeout ([ui.js:331](js/ui.js:331)). Two views 20ms apart means the second clear runs
before the first timeout fires and **the first message is never spoken**. `alert_()` has the identical
race and the previous draft only named `announce()` — the queue must cover **both regions**.

**Pacing currently drives the engine.** The pace timer is what makes bots act. Online, bot timing is a
room-level decision. What changes meaning or dies: `stepOnce()`, the Continue button, the `N` key,
`actionsKey()`'s `'waiting'`/`'continue'` branches, `#pace-hint`.

**No pending state, and optimistic updates are forbidden.** Pressing a card changes nothing until the
server replies — **indistinguishable from a dropped keypress** for a screen reader user.

### Flow with no online owner

- **"Deal next hand" is a local button.** One player pressing `N` rips state from five others. Needs a
  ready-gate.
- **`doPass` with `allPass: 'redeal'` calls `newHand()` inline** ([game.js:184](js/game.js:184)) — a
  whole new deal inside one player's pass, replacing everyone's view with no boundary.
- **The export/transcript feature (`E`) has no online story at all.** `transcript` prints every hand's
  full deal from `history` and labels seats via `isHuman`. On a projection with no history it produces
  an empty log. A shipped, tested feature that would silently disappear.

---

# 7. Accessibility

## Corrections to the previous draft's own proposals

**The status column fights a table that is destroyed on every render.** `renderPlayers` does
`tbody.innerHTML = ''` ([ui.js:1123](js/ui.js:1123)) and rebuilds every row. Today renders are
quiescent between user actions; online every remote action broadcasts a view, so a table being read
with table-navigation commands is wiped underneath the reader and the review cursor is lost.
"Reviewable at leisure" is precisely what this breaks. **Update cell text in place**, touching only
cells whose text differs. Prerequisite, not polish. Also: the `<caption>` enumerates the columns, so
it must be rewritten — and seven columns is heavy to walk, so consider folding connection state into
the existing Role column instead.

**Routing "your turn" to the assertive region breaks Repeat.** `announce()` sets `lastSpoken`;
`alert_()` does not ([ui.js:331-341](js/ui.js:331)). Route the most important message there and it
becomes the one message a user cannot ask to hear again. Either `alert_` sets `lastSpoken` too, or
the message is duplicated into the polite queue.

**`#alerts` is already busy.** It carries "Queen of Clubs selected", "You cannot play X". A turn alert
will cut off an `H` hand read mid-sentence. Keep the assertive message to two words ("Your turn."),
put detail in the polite queue, and **never let an automatic announcement preempt a user-initiated
review** — buffer and deliver after. This is the most important rule in the design and the previous
draft's "supersede rule" left it unspecified.

**The key namespace is not nearly full — 14 letters are free.** Taken: `0-9`, `C E G H L N O P R S T`,
`?`. Free: `A D F I J K M Q U V W X Y Z`. Proposed:
- **`W` — Who is at the table.** Connection health, then per seat: name, position relative to you,
  connected/away/bot, whose turn and how long they have been thinking.
- **`M` — Messages.** Sends a canned message *and* lists recent ones. Chat needs a reviewable history.

**A new key is a four-place change**, not one: `onGlobalKeys`, a toolbar button with
`aria-keyshortcuts` (single letters do not reach the page in browse mode — the project's own rule),
the README key table, and the Accessibility hints dialog.

## Gaps the previous draft did not mention at all

**Nothing tells a blind player what silence means.** Waiting is bounded today by `settings.pace`;
online it is unbounded. A player cannot distinguish "Anna is thinking" from "Anna's tab froze" from
"the socket dropped". Needs a health indicator that changes independently of game state, and `W`
reporting elapsed time on the current turn.

**`mayTakeFocus()` returns false whenever any dialog is open** ([ui.js:1309](js/ui.js:1309)), not just
for INPUT. A chat or lobby dialog would suppress turn focus permanently. Worse, a careful reader sits
in the log by design — combine that with an AI-takeover grace period and **the player loses their seat
for doing what the UI encourages**. Needs a "your seat will be played for you in N seconds" warning
through the assertive region, once, regardless of focus policy.

**No focus restoration on rejection.** Today `activateCard` rejects locally and synchronously and
focus never moves. Online the server can reject after a re-render, dropping focus to `<body>` — the
worst outcome for a screen reader user. On rejection: restore focus to the attempted card, name it,
say what to do.

**Input locking must be exposed, not just implemented.** Ignoring keypresses in flight is
indistinguishable from dropping them. Cards become `aria-disabled` with a reason, or the hand region
`aria-busy` — and whichever is chosen must not rebuild the hand DOM.

**State the log-completeness invariant as testable:** the announcer may batch and elide; **the log is
complete, unbatched, and carries connection events, chat, reconnect summaries and errors.** `drain()`
currently guarantees log and speech get identical text; batching breaks that, so the replacement needs
a test.

**Slow is not broken.** The failure model is binary; the middle state — three-second round trips —
produces the worst experience. Specify degraded mode.

**Chat's receiving half is undesigned.** Sending is the easy part. Chat is polite, batched with
everything else, **always logged**, never assertive, and mutable.

## Regressions to avoid in the fork's offline mode

- **A minimum-gap queue must be pass-through when nothing is in flight**, or single-player instant
  pace gets slower than it is today. Test the no-overlap case fires with zero added delay.
- **Manual pace is an accessibility control, not a speed preference.** It means "let me hear each thing
  before the next arrives", and that *is* achievable per-client online: hold the announcement queue
  until Continue, while the game proceeds. A batching *window* is a timer, not a gate. Without the
  gate, online mode is less accessible than the game it forked from.

## A pre-existing bug this surfaced

**`B` is advertised and not bound.** [index.html:140](index.html:140) sets `aria-keyshortcuts="B"` and
shows `<kbd>B</kbd>` on Report a bug; there is no `b` case in `onGlobalKeys`. A screen reader
announces "Report a bug button, B" and the key does nothing. **This is in the live single-player game
too** and wants its own issue — it is not multiplayer work.

---

# 8. Rooms, lobby, protocol

The lobby is **a whole new screen and the first one a user meets** — create, join by code, seat list,
ready, offline-vs-online. Its own keyboard and screen-reader design, its own milestone.

**Join codes**: no 0/O, no 1/l/I. Case-insensitive, ignores spaces and hyphens, speaks back what was
typed, states which characters are never used. **Five characters minimum with per-IP limiting and
lockout, in M4** — four from a ~23-letter alphabet is ~280k combinations, trivially walkable.

**Seat identity and table lifecycle**, all previously undesigned:

- `players[i].score` accumulates across hands, so **a new person taking an abandoned seat inherits its
  running score.** Intended or not, decide.
- **Table size is immutable** — `createGame` fixes `numPlayers`. A 6-seat room with three arrivals has
  four bots forever; a fifth friend at a 4-seat table has no way in.
- **Every seat needs a non-empty name.** `vb()` does `state.players[i].name.toLowerCase()`
  ([game.js:141](js/game.js:141)) — a missing name throws inside the engine on the first `newHand`.
- **`vb()` breaks on a remote player named "You"** — and "You" is the default name. The server reserves
  it, enforces uniqueness, and caps length and character set; the 16-char cap in `readForm` is
  client-side only.

**Protocol.** Client → server: `join`, `sit`, `ready`, `action` (with sequence number), `chat`.
Server → client: `view` (**with a monotonic version number** — the client drops anything not newer),
`events` (by cursor), `seats`, `error`.

Actions are requests, never applied locally first.

**Transport work with no home in the previous draft:**
- **An `Origin` check on the WebSocket upgrade.** WebSockets bypass CORS, so without it any page
  anywhere can open a socket to a room. Cheapest abuse defence there is.
- **How the static client learns the Worker URL.** No build step means no env substitution and no
  cache-busting; a cached `net.js` against a redeployed Worker breaks silently. Hardcoded URL plus a
  protocol version in `join` and an explicit "please reload" error.
- **Keepalive.** Ping/pong and reconnect-on-silent-close. On a game where someone thinks for two
  minutes about a bury, this decides whether the feature works at all.
- **Durable Object class migrations** (`new_sqlite_classes`) in `wrangler.toml`, or the deploy fails.

---

# 9. Testing

- Engine, projection, event audience, **action authorization**: pure Node, deterministic.
- Announcement queue: jsdom, two views 10ms apart, both announced; and the no-overlap case with zero
  added delay.
- A scripted fake client through a full hand, asserting each seat's view — **wired into CI**.
- Hibernate/wake round-trip; hostile payloads; a soak test for state and message size.
- Seat security: mid-bury, mid-trick and `handOver` disconnects; two clients on one seat; **replayed
  reconnect token**; and **an action sent as another seat**.
- Two real players in two locations from M4. Manual, so it supplements the suites — this repo's
  strongest habit has been converting manual checks into tests.

**Inherited tests that break at M2**, beyond the browser suites:
- **`tests/hidden-information.js` asserts the `assignPartner` message verbatim** (`const NEUTRAL = 'P0
  is the picker. The Jack of Diamonds is the partner card.'`, line 166) and requires an exact
  `includes`. Splitting that message breaks it. It also sets `players[0].isHuman = false` (line 144),
  meaningless once `isHuman` is replaced.
- `npm test` does **not** include `tests/layout.js` or `tests/balance.js` — only CI runs layout.
- CI already runs `npm test` twice per job at a 25-minute timeout. Adding generative projection tests
  across every table size and phase is a real schedule risk.

**Nothing tests `thecardplace.html` at all** — no contrast, overflow or heading-order check covers the
page that fronts all three games, though `Cribbage/tests/audit.js` applies exactly those checks to
game pages. Two defects in this fork's own landing-page copy had to be caught by reading.

---

# 10. Milestones

The previous M4 bundled the Durable Object, the lobby, join codes, rate limiting *and* the first
two-human demo — by far the largest item and the first that can fail visibly. Split. And M3's pending
state exists for asynchrony, so it needs a **deliberately-delayed fake transport** to be testable
before real transport exists.

| # | Deliverable | Demo-able as |
|---|---|---|
| 1 | **Done.** Fork, Card Place entry, publishing, CI, isolation fixes | Plays as today, offline |
| 2 | `applyAction` gate, engine privacy surgery, occupancy, seat generalization, `Table` seam, `viewFor` + projection and authorization tests | Nothing visible; the safety net exists |
| 3 | Announcement queue (both regions), pending state, input locking, pacing split, fake delayed transport | Offline still perfect, asynchrony proven |
| 4 | Durable Object, alarms, storage design, bot seat control, `Origin` check, keepalive | Server runs a table against scripted clients |
| 5 | Lobby screen, join codes, rate limiting | **Kelly plus one remote player, one full hand** |
| 6 | Reconnect, timeout, AI takeover, seat-theft defence, ready-gate | Close a tab mid-hand, resume |
| 7 | Accessibility pass: in-place table updates, `W` and `M` keys, silence design, focus restoration | Full screen reader run, two humans |
| 8 | Hardening: privacy statement, error surfaces, abuse limits, transcript online story | Shareable with a group |

---

# 11. Deployment, cost, publishing

**Publishing hazard, verified against the live `gh-pages` branch.** `publish-guide.yml` rsyncs the
**entire repo** and then deletes `_site/.gitignore` — the **root** file only. Nested `.gitignore`
files survive (confirmed: `sheephead/.gitignore` and others are present on `gh-pages`). No leak today,
because the publish job runs on a fresh checkout with no `npm install`. But the asymmetry lands
squarely on this fork: when `wrangler.toml` or `.dev.vars` appear here, the instinctive fix — add
`.env` to the *root* `.gitignore` — is precisely the file the job deletes. **Secret patterns must go
in `sheephead-multiplayer/.gitignore`, never the root.** Better: stop deleting the root file wholesale
and force-add the one generated artifact instead.

`publish-guide.yml` also has **no concurrency group** while force-pushing an orphan branch. Two merges
close together race, and last writer wins — which may be the older checkout. This fork adds a third
trigger path, increasing how often it fires.

**Cost**, verified against Cloudflare's current published pricing: Durable Objects **are** on the
Workers Free plan (SQLite backend) at 100,000 requests and 13,000 GB-s per day; Paid is $5/month with
1M requests and 400,000 GB-s. A reviewer flagged that DOs historically required Workers Paid — true
once, not now.

The first draft's ~36 messages/hand counted inbound actions only; each action broadcasts a view to
every seat, so 150+ outbound per hand. DO request billing counts inbound, and even the pessimistic
figure sits far inside the free tier. **Hibernation is load-bearing** — without it an idle table bills
for the whole time a socket is open.

**Privacy.** Today the game sends nothing anywhere and the bug dialog says so. Online mode puts
display names and IP addresses on a third-party server. State that in the UI and README, and decide
what the Durable Object logs and retains.

---

# 12. Risks

1. **Action authorization.** `doBury` has no actor. Found on the fourth review pass, which is the
   argument for the `applyAction` gate being the only door.
2. **Projection leak.** Allowlist, complete field table, constructed counterfactuals, every phase.
3. **State growth versus the 128 KiB value limit.** Fails around hand 60 if history stays in one blob.
4. **Hibernation versus timers.** Everything time-based needs alarms, or hands stall silently.
5. **The client seat rewrite** — 35 sites in working, tested code. The `Table` seam is the mitigation.
6. **Accessibility of waiting.** Deferred cheaply, discovered expensively.
7. **Fork drift.** Accepted; the CI guard and the fork's own job are what surface it.
8. **Cloudflare lock-in.** Engine, projection and the auth gate stay portable; only `room.js` would be
   rewritten.

# Sheephead Multiplayer — implementation plan

Tracking: [issue #58](https://github.com/kellylford/TheWorkBench/issues/58).
Scoping and cost analysis: [issue #20](https://github.com/kellylford/TheWorkBench/issues/20).

This plan has been through one adversarial review pass. Where the review contradicted the first
draft, the draft was wrong and this version says so rather than quietly correcting itself — the
reasoning is worth keeping.

## Goal

Two to six people in different places play Sheephead against each other in a browser, with the
existing AI filling any seat nobody is sitting in. Fully playable by keyboard and screen reader, to
the same standard as the single-player game.

## Non-goals for the first milestone

Accounts, passwords, email, password reset, account deletion. Persistent cross-session scoreboards.
Spectators. Matchmaking with strangers or public table lists. Mobile app anything.

## The hard constraint

`sheephead/` is not modified. Not one line. It stays static, dependency-free, and playable from a
folder with no server. All work happens in `sheephead-multiplayer/`, copied from it at `160ff33` and
diverging independently.

This is a deliberate fork. It costs duplicated maintenance and accepts drift. In exchange the
working game cannot regress, and the experimental one can be broken freely. Whether to merge them
later is explicitly deferred.

## Architecture

```
Browser (static, GitHub Pages)          Cloudflare Worker + Durable Object
┌────────────────────────────┐          ┌──────────────────────────────────┐
│ cards.js  game.js  ai.js   │          │ cards.js  game.js  ai.js         │  ← same files,
│ ui.js                      │          │ view.js   (projection)           │    both modified
│ table.js (new: the seam)   │◄────────►│ room.js   (Durable Object)       │    for privacy
│ net.js   (new: transport)  │ WebSocket│   - authoritative state          │
│                            │          │   - AI for empty/dropped seats   │
│ offline mode: engine runs  │          │   - hibernates between messages  │
│ locally, as today          │          └──────────────────────────────────┘
└────────────────────────────┘
```

**The server is authoritative, not a peer.** Hidden information must be enforced somewhere a player
cannot reach. Anything else is a trust exercise.

**Correction from review — the engine is not shared unmodified.** The first draft claimed the same
three engine files would run on both sides with only their `})(window)` tail changed, and cited
`tests/hidden-information.js` as proof. That citation was wrong: the test does `sandbox.window =
sandbox`, so it *provides* a window rather than proving the tail can change. Two consequences:

- **Loading** needs no engine change at all. The Worker sets `globalThis.window = globalThis` before
  importing. `ui.js` is the only file that would care, and it never loads server-side.
- **Privacy does** require engine changes — see below. They are small but they are real, and they are
  the first genuine divergence from `sheephead/`.

## Engine privacy surgery

Two places make per-seat event filtering *structurally impossible*, because they build public and
private text into a single string, gated on `isHuman` — and online, every seat is human.

1. **`assignPartner`** ([game.js:254](js/game.js:254)) appends "You have the Jack of Diamonds
   yourself…" onto the public picker announcement. One event, two audiences.
2. **`computeDoublers`** ([game.js:292](js/game.js:292)) emits "You hold both black queens…" for any
   seat where `isHuman` is true. Online that fires once per holder, into shared state.

Fix: extend `ev()` to `ev(state, kind, text, {audience: seat})`, defaulting to public, and split both
messages into a public event and a private one. Everything downstream — the log, the announcer, the
transcript — already treats events as a list, so the change is contained.

Related: `state.events` is a push-array with a **destructive** consumer — `drain()`
([ui.js:272](js/ui.js:272)) splices it empty. Nothing drains it server-side, so it would grow for the
Durable Object's lifetime and be serialized into storage on every hibernation. Needs a monotonic
event index, per-seat cursors, and explicit truncation. The index is also the reconnect mechanism:
re-delivering announcements a returning player already heard is an accessibility failure, not just
noise.

## Per-seat projection — the security-critical piece

`viewFor(state, seat)` returns a new object built by **allowlist**. Never a deny-list over a copy: a
deny-list breaks silently the day someone adds a field.

| Field | Rule |
|---|---|
| `players[i].hand` | Own hand only. Others become opaque placeholders — see shape note below. |
| `dealt` | Snapshot of **every hand at deal time**. Never sent until `handOver`. |
| `blind` | Hidden until picked, then picker-only. **In a leaster nobody picks** — it stays populated all hand and is consumed by `resolveTrick` on the last trick, so it is hidden from *everyone* until `handOver`. |
| `buried` | Picker only, until `handOver`. |
| `pickedUp` | Literally the blind's contents. Picker only; cleared at bury. |
| `alone`, `partner` | Hidden until `partnerRevealed`. The entire point of the jack of diamonds. |
| `doublers` | Entries carry `player: i` — **this names who holds the queen pair**. Redact entirely until `handOver`. Worse than the partner leak: nothing ever reveals it mid-hand. |
| doubler *factor* | Also withheld. A hand visibly worth 2× tells everyone a pair exists. |
| `result.summary` | Written from one seat's point of view — `scoreNormal` finds `humanSeat` via `isHuman` to pick "your team". Generate per-seat inside `viewFor`, or make it seat-neutral in the engine. |
| `config` | `onStart` copies **every** settings key in, including `name`, `pace`, `skin`. Allowlist it; only room-level rules belong here. |
| `events` | Per-seat filtered by the new `audience` tag, delivered by cursor. |
| `history` | Only ever appended in `endHand`. Always safe to send whole. |
| `pickLog` | `{player, action}` only. Always safe. |
| `revealInfo` | Created at the moment of reveal. Safe. |
| `trickLog`, `played`, `result.deltas` | Public. |

**Redacted hand shape.** `p.hand.length` is read by `renderPlayers`, `renderSeats`, `trickNumber`,
the `cardsLeft` total and `isLastTrickOfHand`. Keeping `hand` as an array of opaque placeholders
costs zero UI changes; a count field costs about six call sites. Going with placeholders.

**The test.** Generative, across every table size, at **every phase transition** — not only before
reveal. Assert (a) no seat's view contains a card id it is not entitled to, and (b) `JSON.stringify`
of the view is **identical** between counterfactual states: picker alone vs. not, each possible
doubler holder, each possible bury. Serialized comparison matters because leaks happen through
*absence* — `partner: -1` versus the key being omitted, `buried: []` versus `undefined`, array
lengths, key order.

**What the test cannot catch**, and so needs separate attention: timing leaks (bot decision paths
differ in length depending on hidden state, so response latency can carry information), and leaks
through derived client behaviour rather than raw state — `roleTags()` and the role column in
`renderPlayers` are the candidates.

**RNG.** `C.shuffle` accepts an injectable `rng`, but `deal()` ignores it and `newHand` calls
`Math.random()` directly for the first dealer. Server uses `crypto.getRandomValues`, seedable for
deterministic replay in tests.

## The client rewrite — larger than "rewriting tick()"

The review's correction: this is a **seat rewrite**, and `tick()` is one of its smaller pieces.

- **~35 sites hardcode seat 0**: `isHumanTurn` (three), `trickNumber`, `textHand`, `textScores`,
  `textTeams`, `textCount`, `textOrder`, `hasPartnerCard`, `partnerCardMeaning`, `roleTags`,
  `renderStatus`, `renderHand`, `renderActions`, `resultHeadline`, `resultChips`, `activateCard`,
  `idleReason`, plus `pushInProgress` in game.js.
- **~15 sites read `settings.numPlayers` where `state.config.numPlayers` belongs.** Online the room
  decides table size. A client whose localStorage says 5, joining a 6-player room, mis-renders
  everywhere.

**The seam is a deliverable, not an implementation detail.** A `Table` facade —
`Table.requestPlay(id)`, `Table.onView(cb)` — synchronous locally, asynchronous online. Without it,
`if (online)` spreads across all 35 sites and the two modes drift, which is the exact failure the
fork was meant to prevent.

### Three client problems the first draft missed entirely

**The 60ms announce race will silently eat messages.** `announce()`
([ui.js:331](js/ui.js:331)) blanks the live region, then sets text on a 60ms `setTimeout`. Today
messages only arrive on a user action or a pace timer, so they never overlap. Over a socket, two
views 20ms apart mean the second clear runs before the first timeout fires and **the first message is
never spoken**. Needs a serialized announcement queue with a minimum gap and a supersede rule, plus a
jsdom test that delivers two views 10ms apart and asserts both are announced.

**Pacing does not survive the network, and the draft had it backwards.** `settings.pace` currently
*drives the engine* — the pace timer is what makes bots act. Online, bot timing is a **room-level**
decision on the server; a per-client setting cannot control it. What changes meaning or dies:
`stepOnce()`, the Continue button, the `N` key and `data-advance`, `actionsKey()`'s
`'waiting'`/`'continue'` branches, and the `#pace-hint` copy. **Manual pace has no online
equivalent.** Split explicitly into a room-level bot delay and a per-client announcement-batching
window, and do not leave the settings dialog offering a control that silently does nothing.

**There is no pending state, and this plan forbids optimistic updates.** Every action site today is
`G.doX(state, …); drain(); tick();`. Online, pressing a card changes nothing and says nothing until
the server replies — **for a screen reader user that is indistinguishable from a dropped keypress.**
Needs a "sent, waiting" affordance, input locking (the digit keys in `onGlobalKeys` fire instantly
and will double-send), and a timeout message.

### Two flow problems with no online owner

- **"Deal next hand" is a local button.** One player pressing `N` while five others are still reading
  the result rips the state out from under them. Needs a ready-gate: all seats ready, or a generous
  timeout.
- **`doPass` with `allPass: 'redeal'` calls `newHand()` inline** ([game.js:184](js/game.js:184)). A
  whole new deal lands inside one player's pass, replacing everyone's view with no boundary. Needs an
  announced interstitial.

Also: `mayTakeFocus()` returns false whenever focus is in an `INPUT`. The moment a chat box exists,
turn focus is permanently suppressed.

## Accessibility

This is the part that is easy to defer and expensive to discover late. Concrete decisions, not
stated concerns:

- **Connection and away status is a column in the existing `#players-table`** — a real table with row
  headers, reviewable at leisure, no live region. State *changes* announce once via the polite
  region.
- **"It is now your turn" routes to the assertive `#alerts` region.** The polite announcer is
  coalesced and can be lost — this is the one message that must not be.
- **One new review key** for "who is at this table and what are they doing". The namespace is nearly
  full (H T L S C O P R, plus N G E B ? and 0–9), so a key-map review is a design item, not polish.
- **`vb()` breaks on a remote player named "You".** It switches to second person on
  `name.toLowerCase() === 'you'` ([game.js:140](js/game.js:140)) — and "You" is the *default* name.
  Every seat would hear second-person sentences about someone else. The server reserves "You",
  enforces uniqueness, and caps length and character set; the 16-char cap in `readForm` is
  client-side only.
- **Chat cannot be "later".** A player reading their hand back needs a way to say "one moment" —
  otherwise the only available signal is silence, which is exactly what a disconnect sounds like.
  Minimum: a small canned-message set on one key, through the same announcement queue, not a second
  live region.
- **Reconnect summary needs a destination.** The log is deliberately not a live region, so a log
  entry alone is silent. One announcement plus a log entry, length-capped.
- **Batching versus the log.** Five remote plays in two seconds must batch like AI plays do today —
  but then announcer and log diverge, and `R` only repeats the last spoken message. Specify the
  window; confirm `R` still behaves.

## Room lifecycle and the lobby

The lobby is **a whole new screen, and the first one a user meets** — create a table, enter a code,
see the seat list, ready up, choose offline or online. It has its own keyboard and screen-reader
design and its own milestone. The first draft had no client lobby work at all.

**Join codes must be speakable**: no 0/O, no 1/l/I. Read aloud over a phone and typed by someone
else without confusion. The field is case-insensitive, ignores spaces and hyphens, speaks back what
was typed, and states which characters are never used.

**Five characters minimum, with per-IP join-attempt limiting and lockout — in the room-service
milestone, not in hardening.** Four characters from a ~23-letter alphabet is ~280k combinations;
walking into "private tables among friends" would be trivial.

Rules options (`allPass`, doublers, difficulty) become room-level, fixed at creation. Verbosity,
skin, focus behaviour and the announcement window stay per-client. Pace splits, per above.

## Protocol

Client → server: `join` (code, name, reconnect token), `sit`, `ready`, `action` (pick/pass/bury/play
with a sequence number), `chat`.

Server → client: `view` (projected state, **with a monotonic version number**), `events` (filtered,
by cursor), `seats`, `error`.

Actions are requests, never applied locally first. No optimistic updates — slower, and the only
version that cannot desynchronise. Sequence numbers make duplicate delivery harmless. The `view`
version number is what stops duplicate or out-of-order delivery rolling the UI backwards; the client
drops anything not newer.

## Reconnect, timeout, AI takeover

- Every client gets a **reconnect token**; returning with it restores the seat.
- Disconnect does not end the table — the seat is marked away, and after a grace period the AI plays
  it. The player reclaims it on return.
- A returning player is told what happened while they were gone, summarised, via the event cursor —
  not by replaying every announcement.
- The Durable Object holds state across disconnects; hibernation means an idle table costs nothing.
- **Open question:** what happens when everyone disconnects mid-hand.

## Testing

- Engine, projection and event-audience: pure Node, deterministic, in the existing suite's style.
- Announcement queue: jsdom, two views 10ms apart, both announced.
- A scripted fake client driving a room through a full hand, asserting each seat's view — **wired
  into CI**, not run by hand.
- **Reconnect and seat security**: socket closed mid-bury, mid-trick and at `handOver`; two clients
  claiming one seat; and **a reconnect token replayed from a second browser — seat theft.** That last
  is a security test and was missing entirely.
- Two real players in two locations from M4 onward. Kelly can also drive two seats from different
  browsers or machines. Manual, so it supplements the suites rather than replacing them — this
  repo's strongest habit has been converting manual checks into tests.

**The inherited suites stop running unchanged at M2.** `tests/ui-dom.js` drives the real
`index.html`, clicks real buttons and assumes seat 0 is human; `layout.js`, `appearance.js` and
`contrast.js` will need updating once a lobby screen exists. Budgeted, not assumed away.

## Milestones

| # | Deliverable | Demo-able as |
|---|---|---|
| 1 | **Done.** Scaffold, own Card Place entry, publishing and CI wired | Plays exactly like today, offline |
| 2 | Engine privacy surgery, seat generalization, `Table` seam, `viewFor` + projection test | Nothing visible; the safety net exists |
| 3 | Announcement queue, pending/sent state, input locking, pacing split | Offline game still perfect, now network-ready |
| 4 | Durable Object room, lobby screen, join codes, rate limiting; two humans + bots | **Kelly plus one remote player, one full hand** |
| 5 | Reconnect, timeout, AI takeover, seat-theft defence, ready-gate for next hand | Close a tab mid-hand, come back, resume |
| 6 | Accessibility pass: status column, review key, assertive turn alert, canned chat | Full screen reader run with two humans |
| 7 | Hardening: privacy statement, error surfaces, abuse limits | Shareable with a group |

## Deployment and cost

Client publishes through the existing `gh-pages` workflow. Server deploys by Wrangler — which needs
its own CI job, an API-token secret, and a `wrangler.toml`.

**Security note on publishing.** `publish-guide.yml` does `rsync -a --exclude='_site' . _site/` and
then deletes `_site/.gitignore` — it publishes the **entire repo** to a public branch. Anything
landing in `sheephead-multiplayer/` (`wrangler.toml`, a `.dev.vars`, a stray token) goes public.
Explicit rsync excludes are required before any server config is committed.

**Cost.** Verified against Cloudflare's current published pricing rather than memory: Durable Objects
**are** on the Workers Free plan (SQLite backend) at 100,000 requests and 13,000 GB-s per day; the
Paid plan is $5/month including 1M requests and 400,000 GB-s. The review flagged that DOs
historically required Workers Paid — that was true once and is not now.

The review also noted the first draft's ~36 messages/hand counted inbound actions only, and that each
action broadcasts a view to every seat: 150+ outbound messages per hand. Fair, though DO request
billing counts inbound requests rather than the fan-out, and even the pessimistic figure sits far
inside the free tier. **WebSocket Hibernation is load-bearing** — without it an idle table bills for
the whole time a socket is open, which for a game where someone is thinking about their bury is
essentially all of it.

**Privacy.** Today the game sends nothing anywhere, and the bug dialog says so explicitly. Online
mode puts display names and IP addresses on a third-party server. That needs stating plainly in the
UI and README, plus a decision on what the Durable Object logs and retains.

## Risks

1. **Projection leak.** Highest severity. Allowlist, serialized-shape test, every phase transition.
2. **Private text baked into public strings.** Now understood; fixed by audience-tagged events.
3. **The client seat rewrite** — 35 sites in code that currently works and is well tested. The
   `Table` seam is the mitigation.
4. **Accessibility of waiting.** Deferred cheaply, discovered expensively.
5. **Fork drift.** Accepted deliberately; the fork's CI job is what will surface it.
6. **Cloudflare lock-in.** Engine and projection stay portable; only `room.js` would need rewriting.

# What every card game here looks like

Five games share this site. A player who learns the pace control, the settings,
or the log in one of them should not have to learn it again in the next — and
for a while they did, because each game passed its own suite while the set of
them drifted apart. Nothing was checking the games against *each other*.

This file is that agreement written down. `shared/tests/browser/shape.js`
enforces the parts a machine can check; this explains the parts it cannot, and
why each rule is here rather than being obvious.

**None of it is a style guide.** Every rule below exists because the games
disagreed about it and a player noticed.

---

## The pace ladder

Five rungs, the same values and the same words in every game:

| Value | Label |
|---|---|
| `0` | Immediate |
| `900` | Brisk |
| `2500` | Comfortable |
| `4000` | Relaxed |
| `-1` | Wait for me to continue |

`-1` is not a duration and must never be treated as one — it means the game
waits for a button, however long that takes.

It used to be two ladders. Hearts and spades offered Comfortable / Brisk /
Immediate / Wait at 900ms, 450ms, 0 and manual; euchre, cribbage and sheephead
offered Instant / Four seconds / Ten seconds / Manual. Same control, different
words, and **defaults that differed ninefold**, so somebody who set a
comfortable pace in one game got something nine times faster in the next.

**The default may differ per game** and does: hearts and spades open on Brisk,
the other three on Relaxed. That is not drift — euchre and sheephead say more
per play, so they need more room. What must not differ is what a rung *means*.

Two functions are needed, not one, and conflating them is the mistake to avoid:

- `PACE_NAMES[value]` — the rung's name, for choosing by.
- `paceWords()` — the wait as a **duration**, for the sentence that says one is
  coming. "The next play comes on its own after four seconds." The name cannot
  be used here: *"comes on its own after relaxed"* is not a sentence.

And `normalisePace(stored)` snaps a value saved before this ladder existed to
the nearest rung, ties going to the slower one. Without it a stored `450` or
`10000` matches no option, the select silently falls back to its first entry,
and a choice the player did make is replaced by one they did not.

## The settings

**One set of controls, in a dialog. Never two.**

- The start screen carries the player's **name** and nothing else adjustable.
- Below it, a **summary** of the current settings (`#settings-summary`) and a
  **`#setup-settings`** button that opens the dialog.
- During a game, **`#btn-settings`** in the toolbar opens *the same dialog*.
- Every control lives in `#settings-dialog` and is called `opt-*`.

Hearts and spades used to put four controls inline on the start screen *and*
keep a second copy in the dialog, synced by hand. The comment on the syncing
function said the quiet part out loud — "two forms that disagree about the
current pace is worse than one form" — and the answer to that is one form.

`opt-*` and not `set-*`: the shared browser harness finds these by id anywhere
in the document, so a control in a closed dialog is still reachable by a test.
Two spellings meant the harness could drive three games and not the other two.

Anything that is a **rule of the table** goes in the dialog, including ones only
one game has — sheephead's player count and what happens when everybody passes,
hearts' and spades' target score. The start screen is not the place to make a
rules decision look like a preference.

## The log

- Headed **"What has happened"**, with `<kbd aria-hidden="true">G</kbd>` after
  it, so the shortcut is advertised rather than hidden.
- The `<ul id="log">` carries `aria-labelledby="log-h"`.
- Newest first. One roving tab stop for the whole list; arrows, Home and End
  move within it.
- **Never a live region.** It carries the same words the announcer speaks, and
  making it live says everything twice.

"Game log" is what three of them called it. It is a fine name and it describes
the mechanism; "What has happened" describes what you want from it.

## The tab order, which is the part that gets forgotten

**The hand is one tab stop.** A roving `tabindex`, arrows to move within it.
Thirteen tab stops is thirteen presses to get past your own cards.

**The log is the very next tab stop after the hand.** Zero focusable things in
between — a player asked for it to be one tab past their cards, and it should
be.

This is why **the toolbar goes above the game content**, not beside or below the
hand. In three games it sat under the score table, which put all seventeen
review buttons between the cards and the log. Nothing about the markup shows
that; it only appears when you count what is actually focusable, which is why
`shape.js` measures it in a real browser rather than reading the HTML.

The same rule in the other direction: **nothing between the hand and the thing
you do with it.** The primary action sits immediately before the hand, so one
shift+tab from a card reaches it.

## Keys

Every shortcut is also a button on screen, and every button is also a shortcut —
a shortcut with no button and a button with no shortcut are both half-built.

Shared across all five: `H` hand · `T` trick · `L` last trick · `S` scores ·
`C` cards played · `O` play order · `W` who is here · `R` repeat · `N` move on ·
`G` log · `E` export · `?` accessibility hints.

**A game may take a letter for something it needs more**, and spades does: `B`
reads the contract instead of opening the bug reporter, because in spades the
contract is asked for more than anything else. When that happens the displaced
control keeps a home (`Shift+B`), and both the page and a test say so. A
deliberate inconsistency is indistinguishable from a mistake without one.

## Announcements

- Exactly **one** `aria-live="polite"` region and **one** `aria-live="assertive"`,
  and everything spoken goes through a single queue that serialises per region.
  Two regions racing is how a screen reader reads the second half of one
  sentence and the first half of another.
- A **request preempts** a game event, and the event is **requeued, not dropped**.
- The status line is **not** a live region either, for the same reason as the log.
- No `role="application"`. The page stays in browse mode.

## Unavailable things

`aria-disabled`, never the `disabled` attribute — a disabled button cannot be
focused, so a screen reader user tabbing past never learns it exists or why it
is unavailable. Give it a reason in `title`, and read the **live** attribute in
the click handler rather than a boolean captured when the button was built.

**But do not mark things unavailable when the answer is not wanted.** Spades
marked all thirteen cards unavailable during the bidding, with ", not yet — the
bidding comes first" on each. Reading the hand *is* the activity of that phase;
the answer to "can I play this yet" is not wanted thirteen times while you count
your spades. The test is whether the name alone would mislead.

---

## Adding a sixth game

1. `js/config.js` — the game's name and its own Worker hostname. No two games
   may share a room service; `shared/tests/wiring.js` checks it.
2. An engine exporting `createGame`, `applyAction`, `eventsFor`, `seatToAct`,
   `canDeal`, `note`, `vb`. `shared/tests/engine-contract.js` holds you to it.
   `canDeal` must be **exactly** the set of phases `applyAction` accepts a
   `nextHand` in — too broad and the player gets a raw refusal while a hand is
   visibly being dealt, too narrow and the deal is swallowed in silence. Both
   have happened here.
3. `js/view.js` — a per-seat projection built as an **allowlist**. A deny-list
   fails towards leaking, quietly, in code nobody is looking at.
4. `tests/drive.js` — how the shared browser audits start and play it.
5. Add the directory to `GAMES` in `wiring.js`, `engine-contract.js` and
   `shape.js`, to the path filters in both workflows, and give it a job in
   `card-games-tests.yml` and a deploy workflow.
6. Read every configurable rule from `config` **at the point of use**. Hearts
   shipped a "short game to fifty" that was offered on two screens, stored, sent
   to every seat, and then compared against a module constant — so it ran to a
   hundred with a fifty on the screen and nothing said so.
7. Have the rules oracle take those values **from the config it built the game
   with**, never from the engine's own constants. A suite that asks the engine
   for the number and then checks the engine against it agrees with any bug that
   reads the same wrong number twice.

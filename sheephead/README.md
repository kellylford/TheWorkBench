# Sheephead

A web-based Sheephead (Schafkopf) card game built to be fully playable with a keyboard and a
screen reader. Pick a table size from three to six and play against that many computer opponents.

No build step, no dependencies, no server. Open `index.html` in a browser and play.

```bash
start index.html
```

## Accessibility

The game is designed so that nothing is conveyed by sight alone.

**Everything is a real control.** Cards are `<button>` elements with descriptive labels
("Queen of Clubs, trump, 3 points, card 1 of 6"). Cards you may not play right now are marked
`aria-disabled` and say why — "cannot be played, you must follow trump" — rather than vanishing
from the list, so you can still review your whole hand on your turn.

**Announcements are batched.** A run of opponent turns is collected and spoken as a single polite
live-region message, so nothing gets cut off part way through by the next play. Errors go to a
separate assertive region. The visible game log is deliberately *not* a live region, so it is
never spoken twice.

**The game log is a plain focusable list.** Press <kbd>G</kbd> to jump to the newest entry, then
<kbd>Up</kbd>/<kbd>Down</kbd> to move one entry at a time, <kbd>Page Up</kbd>/<kbd>Page Down</kbd>
for ten, <kbd>Home</kbd>/<kbd>End</kbd> for the newest and oldest. Each entry is an ordinary list
item that takes real DOM focus — the screen reader reads it because focus moved there, not because
of any live region or label trickery. Number keys are ignored inside the log so you cannot play a
card by accident while reading back.

**The blind is shown, not summarised.** When a hand ends, the actual cards are laid out — what was
in the blind, and separately what the picker buried. "21 points buried" tells you nothing about
what actually went down. In a leaster the blind is shown with who took it on the last trick.

**Freshly picked cards are obvious.** After picking, the two cards from the blind sit at the front
of the hand, outlined and badged, until the bury is committed — then the hand sorts normally. The
announcement leads with them too: "From the blind: Ace of Spades, Ten of Spades. Then your hand…"

**The jack of diamonds is called out.** Whenever you hold the partner card it is marked in your
hand and says what it means for you — that you are the picker's partner, or that you picked and are
therefore playing alone. Only ever about your own position, never anyone else's.

**Focus is never stolen out from under you.** Focus moves to your cards when it becomes your turn,
but not while you are in a text field, reading the help, or reading back through the log. The
announcement still tells you it is your turn. You can turn the behaviour off entirely in setup.

**Pace is configurable.** Opponent turns can advance instantly, after a short or long pause, or
only when you press a Continue button. Manual mode announces each play individually as it happens.

**Screen reader modes are left alone.** Nothing here is marked `role="application"`, so browse,
focus and forms modes behave normally and the user decides when to switch. Everything is a plain
button, list, table or dialog.

The trade-off is deliberate: in browse mode the screen reader keeps single-letter keys for its own
quick navigation, so the game's letter shortcuts will not reach the page. That is why every single
one of them also exists as a button in the "Review the game" group — nothing depends on a shortcut
being available, and `Tab`/`Enter`/`Space` alone are enough to play a whole game.

Also: visible focus outlines, no colour-only meaning (trump is labelled as well as tinted), a skip
link, semantic headings and tables, and support for `prefers-reduced-motion`, `prefers-contrast`
and forced-colours mode.

### Keys

| Key | Action |
| --- | --- |
| <kbd>Tab</kbd> | Move between controls |
| <kbd>←</kbd> <kbd>→</kbd> | Move card to card within your hand |
| <kbd>Home</kbd> <kbd>End</kbd> | First / last card |
| <kbd>Enter</kbd> <kbd>Space</kbd> | Play the focused card, or select it while burying |
| <kbd>1</kbd>–<kbd>9</kbd> <kbd>0</kbd> | Jump straight to that card (<kbd>0</kbd> is the tenth) |
| <kbd>H</kbd> | Your hand, grouped by trump and fail suit |
| <kbd>T</kbd> | The current trick |
| <kbd>L</kbd> | The last completed trick |
| <kbd>S</kbd> | Points this hand and running scores |
| <kbd>P</kbd> | Who picked, and what is known about the partner |
| <kbd>C</kbd> | Counting aid: trump played, highest cards not yet seen |
| <kbd>O</kbd> | Play order for this trick, and where the picker sits in it |
| <kbd>G</kbd> | Jump into the game log |
| <kbd>E</kbd> | Export the game log |
| <kbd>B</kbd> | Report a bug |
| <kbd>N</kbd> | Advance: Continue in manual mode, or deal the next hand |
| <kbd>R</kbd> | Repeat the last announcement |
| <kbd>?</kbd> | Accessibility hints |

## Help is split in two

The game ships two separate help screens rather than one mixed page, because the two audiences
want different things:

- **How to play Sheephead** — the rules, for anyone who has never played. Trump order, the deal,
  the partner card, following suit, scoring, leasters.
- **Accessibility hints** — keyboard, screen reader modes, pacing, and how to review the game
  state. Nothing about the rules.

Both are reachable from the setup screen and from the in-game toolbar, and each offers the other
at the bottom so neither is a dead end. <kbd>?</kbd> opens the accessibility hints.

## Rules as implemented

Trump is a single fourteen-card suit: all four queens, then all four jacks, then the whole diamond
suit. Fail suits are clubs, spades and hearts, ranked A, 10, K, 9, 8, 7. Card values are ace 11,
ten 10, king 4, queen 3, jack 2 — 120 points in the deck.

| Players | Deck | Hand | Blind | Partner |
| --- | --- | --- | --- | --- |
| 3 | 32 | 10 | 2 | none, the picker is always alone |
| 4 | 30 | 7 | 2 | jack of diamonds |
| 5 | 32 | 6 | 2 | jack of diamonds |
| 6 | 32 | 5 | 2 | jack of diamonds |

Four players uses a thirty-card deck — the seven and eight of diamonds come out — so that a full
hand still leaves a two-card blind. Both are worth nothing, so a hand is 120 points at every table
size. A four-card blind was tried first and gave the picker a decisive edge: burying four cards
voids two suits and stashes about twenty points, and the picker's team won 85% of hands no matter
how selective the computer players were about picking.

The picker's team needs 61 points. A normal win pays one unit, 91 or more pays two, taking every
trick pays three. A picker who falls short pays double, more if held to 30 or fewer, more again for
taking no tricks. Each opponent settles for two units times the multiplier; the picker takes about
two thirds of the pot and the partner one third.

If everyone passes you get a leaster (or a redeal, your choice): no picker, everyone for
themselves, the blind goes to whoever wins the last trick, and the *fewest* points wins — but you
must have taken at least one trick to be eligible.

### Exporting a game log

Press <kbd>E</kbd> (or the "Export log" button) for a complete written account of the session:
every finished hand with who was dealt what, who picked and passed, what was buried, every card of
every trick, the points, and the score change. Download it as a text file or copy it.

Every hand is audited the moment it finishes. The audit does not trust the running totals — it
re-adds the card values straight from the recorded tricks and checks that the deal matches the
deck, that no card was played twice, that the trick count is right, that points total 120, that
each player's total matches the tricks they actually took, and that the score changes are zero
sum. If anything fails, it is written into the on-screen log immediately and flagged at the top of
the export. The players table also carries a Total row showing the sums, so a discrepancy is
visible rather than buried in a plausible-looking column.

Exporting part way through a hand only reports what you can see from your own seat, so it cannot
be used to look at other players' cards.

### Reporting a bug

Press <kbd>B</kbd> (or the "Report a bug" button). Describe what went wrong and it assembles a
report: your description, the game setup, the automatic accounting check, your browser, and the
full game log. A read-only box shows exactly what will be copied — nothing is hidden and nothing
is sent anywhere on its own.

"Copy report and open GitHub" puts the whole report on the clipboard and opens a prefilled
`issues/new` on `kellylford/TheWorkBench`; paste the log in and post it. The link carries the
summary only, because a full transcript runs to tens of thousands of characters and would blow
past the URL limit — hence the clipboard. There is no server, no API token and no telemetry
anywhere in this; posting the issue is entirely the user's own action and needs a GitHub account.

### Hidden information

Whether the picker kept or buried the jack of diamonds is private. The sides only become public
when that card is actually played: if somebody else plays it they are the partner, and if the
picker plays it themselves that is the moment everyone learns the picker is alone. If the picker
buried it, nobody finds out until the hand is scored.

The announcement when somebody picks is worded identically either way, and the computer players
infer teammates from what their seat is entitled to know — weighing the chance that the picker is
secretly alone — rather than reading the flag. You are told your own situation, never anyone
else's. `tests/hidden-information.js` asserts all of this.

## Layout

```
index.html      markup, help dialog
styles.css      presentation
js/cards.js     deck, ranking, trump ordering, card values
js/game.js      rules engine and scoring; no DOM access
js/ai.js        computer players; reads only public information
js/ui.js        rendering, keyboard handling, announcements
tests/          node scripts, no dependencies
```

## Tests

```bash
npm test
```

- `tests/engine-invariants.js` — plays 3,600 hands with every seat driven by the AI across all
  table sizes, rule options and difficulties. Checks that the AI never chooses an illegal card or
  fails to follow suit, that every hand accounts for exactly 120 points, that no card is played
  twice, that the trick count matches the hand size, and that scoring is always zero-sum.
- `tests/hidden-information.js` — checks that nothing observable changes based on whether the
  picker is secretly alone: identical event wording, identical opponent inference, correct reveal
  on the play of the jack, and silence for a whole hand when the jack is buried. The computer
  players never bury trump, so that path is forced by hand.
- `tests/transcript.js` — audits 1,200 played hands across all table sizes, checks that the audit
  actually catches deliberately corrupted hands (wrong totals, a duplicated card, a missing trick,
  non-zero-sum scores), and verifies that a mid-hand export never shows a card still in somebody
  else's hand.
- `tests/ui-dom.js` — drives the real `index.html` through jsdom and plays four hands at every
  table size by clicking the actual buttons. Checks that focus lands on a card that can actually
  be played, that blocked cards explain themselves and refuse to be played, and that the bury
  selection enforces its limit. Needs `npm install --no-save jsdom`; it skips cleanly without it.
- `tests/balance.js` — sweeps the pick threshold per table size and reports pick rate, leaster
  rate, picker win rate and picker expected value. Used to tune `PICK_BASE` in `js/ai.js` so that
  picking is close to break-even against the payout table rather than reflexive. Not part of
  `npm test`; it takes a few minutes.

As tuned, the picker wins roughly 60–70% of hands depending on table size, which is about right
given that going down costs double.

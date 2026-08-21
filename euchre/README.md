# Euchre

Euchre for four, built to be fully playable with a keyboard and a screen reader.
Play against three computer opponents, or open a table and play with other people
— any seat nobody is sitting in is played by the computer, so a table works with
two people, or three, or four.

No build step, no dependencies. Open `index.html` in a browser and play.

```bash
start index.html
```

Playing with other people needs the room service, which lives in `worker/` and is
deployed to Cloudflare from CI. Everything else runs in the browser.

## The one rule this game is built around

Once a suit is trump, the two highest cards in the game are the **right bower**
(the jack of trump) and the **left bower** — the jack of the *other suit of the
same colour*. And while it is the left bower, **it is not a card of its printed
suit at all**. With spades trump, the jack of clubs is a spade: it follows
spades, and you may not play it on a club lead if you hold any spade.

A sighted player absorbs that from five cards at a glance. Read out card by card,
it is a memory exercise with a colour rule in it, performed while three other
people wait. So:

- **Both bowers are named as bowers** wherever a card is read out — in your hand,
  in the trick, in the log. "Jack of Clubs" on its own is actively misleading
  when clubs are not trump.
- **The hand read does the mapping during the bidding.** Press <kbd>H</kbd> while
  deciding and it tells you what your trump *would* be if you took the suit on
  offer, which jack would become the left bower, and how many trump that gives
  you. In the second round it does the same for all three suits still available.
- **Both bowers are marked visually too**, so neither audience depends on the
  other's channel.

This is not coaching. It tells you nothing you could not derive; it removes a
workload that only exists if you cannot see the cards.

## Accessibility

Nothing is conveyed by sight alone.

**Everything is a real control.** Cards are `<button>` elements with descriptive
labels ("Jack of Clubs, left bower, second highest trump, counts as spades, card
2 of 5"). Cards you may not play right now are marked `aria-disabled` and say why
— "cannot be played, you must follow hearts — you hold the Ace of Hearts" —
rather than vanishing from the list, so you can still review your whole hand on
your turn.

**Announcements are batched and queued.** A run of computer turns is collected
and spoken as a single polite message, so nothing gets cut off part way through
by the next play. Anything you asked to hear jumps ahead of anything the game
wanted to say, and the game's message is *put back in the queue* rather than
thrown away. Errors and direct replies to a keypress go to a separate assertive
region. The visible game log is deliberately *not* a live region, so it is never
spoken twice.

**The game log is a plain focusable list.** Press <kbd>G</kbd> to jump to the
newest entry, then <kbd>Up</kbd>/<kbd>Down</kbd> to move one entry at a time,
<kbd>Page Up</kbd>/<kbd>Page Down</kbd> for ten, <kbd>Home</kbd>/<kbd>End</kbd>
for the newest and oldest. Each entry is an ordinary list item that takes real
DOM focus — the screen reader reads it because focus moved there, not because of
any live region trickery. Number keys are ignored inside the log so you cannot
play a card by accident while reading back.

**The score belongs to a side, and is presented that way.** Euchre is scored by
partnership, so the score is its own two-row table rather than a column repeated
down a per-player table — a number printed twice invites being read as two
numbers. <kbd>S</kbd> says the tricks each side has this hand, the game score,
the match, and how many more tricks you need to make it or to euchre them.

**The dealer's discard is shown, not summarised.** When a hand ends, the actual
cards are laid out: the upcard, what the dealer put back, and the three cards
nobody ever sees at a real table. "The dealer discarded" tells you nothing.

**A seat sitting out is described as sitting out**, not as a seat with five cards
it will never play. Its Cards column says "out".

**Focus is never stolen out from under you.** It moves to your cards when it
becomes your turn — and to the bidding buttons when the decision is a bid rather
than a card — but not while you are in a text field, reading the help, or reading
back through the log. The announcement still tells you it is your turn. You can
turn the behaviour off in Settings.

**Pace is configurable, in real seconds.** Computer turns can advance instantly,
after four seconds, after ten, or only when you press Continue. The timed
settings are a ceiling rather than a wait you are held to — Continue is on screen
there as well, and taking it drops the pending pause.

**Screen reader modes are left alone.** Nothing is marked `role="application"`,
so browse, focus and forms modes behave normally and you decide when to switch.
Everything is a plain button, list, table or dialog.

The trade-off is deliberate: in browse mode the screen reader keeps single-letter
keys for its own quick navigation, so the game's letter shortcuts will not reach
the page. That is why **every single one of them also exists as a button** in the
toolbar under the table — nothing depends on a shortcut being available, and
<kbd>Tab</kbd>, <kbd>Enter</kbd> and <kbd>Space</kbd> alone are enough to play a
whole game.

Also: visible focus outlines, no colour-only meaning (trump is labelled as well
as tinted), a skip link, semantic headings and tables, and support for
`prefers-reduced-motion`, `prefers-contrast` and forced-colours mode.

### Keys

| Key | Action |
| --- | --- |
| <kbd>Tab</kbd> | Move between controls |
| <kbd>←</kbd> <kbd>→</kbd> | Move card to card within your hand |
| <kbd>Home</kbd> <kbd>End</kbd> | First / last card |
| <kbd>Enter</kbd> <kbd>Space</kbd> | Play the focused card, or select it to put back |
| <kbd>1</kbd>–<kbd>6</kbd> | Jump straight to that card |
| <kbd>H</kbd> | Your hand, grouped by trump and suit — and during the bidding, what it would be worth |
| <kbd>T</kbd> | The current trick |
| <kbd>L</kbd> | The last completed trick |
| <kbd>S</kbd> | Tricks this hand, the game score, and games won |
| <kbd>P</kbd> | Trump, who made it, who your partner is, who is sitting out |
| <kbd>O</kbd> | Play order for this trick, and where you sit in it |
| <kbd>C</kbd> | Counting aid: trump gone, highest cards not yet seen |
| <kbd>W</kbd> | Who is at the table, and whether they are still connected |
| <kbd>G</kbd> | Jump into the game log |
| <kbd>E</kbd> | Export the game log |
| <kbd>B</kbd> | Report a bug |
| <kbd>N</kbd> | Advance: Continue wherever it is offered, or deal the next hand |
| <kbd>R</kbd> | Repeat the last announcement |
| <kbd>?</kbd> | Accessibility hints |

## Help is split in two

Two separate screens rather than one mixed page, because the two audiences want
different things:

- **How to play Euchre** — the rules, for anyone who has never played. The deck,
  the bowers, both rounds of bidding, going alone, following suit, scoring.
- **Accessibility hints** — keyboard, screen reader modes, pacing, and how to
  review the game state. Nothing about the rules.

Both are reachable from the setup screen and from the in-game toolbar, and each
offers the other at the bottom so neither is a dead end. <kbd>?</kbd> opens the
accessibility hints.

## Rules as implemented

Twenty-four cards: nine, ten, jack, queen, king and ace in each suit. Four seats
in two fixed partnerships — seats 1 and 3 against seats 2 and 4. Five cards each;
four are left over and the top one is turned face up as the **upcard**.

**Round one.** Starting to the dealer's left, each player may order the upcard up
— making its suit trump — or pass. Whoever orders it up, *the dealer* takes the
upcard and puts one card back face down. **Round two.** If all four pass, the
upcard is turned down and its suit is out for the hand; each player in turn may
name any other suit, or pass. If everybody passes again the hand is thrown in and
redealt, unless *stick the dealer* is on.

Whoever settles trump is the **maker**, and their side must take at least three
of the five tricks. The maker may play **alone**: their partner sits the hand
out, so it is one against two.

| The makers take | Score |
| --- | --- |
| Three or four tricks | 1 to the makers |
| All five | 2 to the makers |
| All five, playing alone | 4 to the makers |
| Three or four, playing alone | 1 to the makers |
| Fewer than three — euchred | 2 to the other side |

First side to ten points wins. Games to 5, 11 or 15 are offered in settings, as
is stick the dealer and turning going-alone off.

Not implemented, and they are all real house rules somewhere: defending alone,
the farmer's hand, no-trump, and six-handed euchre.

### How it actually plays

Measured over 4,000 hands per row against the hard opponents (`npm run balance`):

| | A suit is named | Makers euchred | March | Somebody alone | Dealer's side makes it |
| --- | --- | --- | --- | --- | --- |
| easy | 98.6% | 19.4% | 15.9% | 9.5% | 68.5% |
| normal | 95.5% | 13.8% | 12.2% | 8.1% | 67.2% |
| hard | 94.1% | 12.9% | 14.2% | 9.1% | 65.3% |

Those are the numbers a euchre player would recognise, and they are the reason
`tests/balance.js` exists. The first draft of the bidding thresholds threw more
than two hands in five straight in the bin — a game nobody would sit through, and
completely invisible to every test that only checks the rules are obeyed.

## Playing with other people

**Start a new table** makes a room and gives you a five-character code to read
out. Anyone who types it joins that table. No accounts, no sign-up. The code
alphabet has no O, I or L and no zero or one, because a code gets read down a
phone and "was that a one or an I" is a poor first experience of a game built for
exactly that person. The code is spelled out when spoken — "P, 4, K, 7, M" — and
it stays on the game screen for the whole session, because a code you cannot
check is a code you cannot share.

**The server owns the game.** Your browser holds only a projection of what your
seat is entitled to see; a move is a request that may be refused. There are no
optimistic updates — and because "nothing happened" is exactly what a dropped
keypress feels like to somebody who cannot see the screen, a refusal always says
why, and focus is put back on the card you tried to play.

**Silence is explained.** Waiting is unbounded online, so the game says what it
means: whose turn it is, how long they have been thinking, whether their browser
is still answering, and whether the connection is healthy. <kbd>W</kbd> gives the
full picture at any time. If your connection drops, the computer plays your seat
so the table does not stall — and making any move takes it straight back.

**Rules belong to the table**, fixed when it is made. The rule controls are
disabled and say so at an online table, rather than silently doing nothing.

## Layout

```
index.html          markup, and the two help dialogs
styles.css          presentation
js/cards.js         the deck, the bowers, trump ordering
js/game.js          rules engine, scoring, the audit; no DOM access
js/ai.js            computer players; reads only what its own seat may see
js/view.js          per-seat projection — the allowlist
js/table.js         the seam: local game or remote room, one interface
js/net.js           the WebSocket, pings, and connection state
js/localserver.js   an authoritative server that happens to be in this tab
js/room.js          the room, with nothing platform-specific in it
js/ui.js            rendering, keyboard handling, announcements
worker/             the Cloudflare edge: accept a socket, route it to a room
tests/              node scripts, no dependencies beyond jsdom and puppeteer
```

The architecture is the one worked out in `sheephead-multiplayer/`, and
[its PLAN.md](../sheephead-multiplayer/PLAN.md) is worth reading for the
reasoning — particularly on why the projection is an allowlist, why the
authorization gate exists, and what a Durable Object silently loses when it is
evicted.

**The offline game renders from the projection too.** It would be quicker to draw
straight from the authoritative state, which is right there. Rendering from
`view.js` instead means every single-player hand exercises the projection: a
field missing from it becomes a broken screen on somebody's first deal, rather
than an online-only bug found six weeks later by the one person who hit it.

## Tests

```bash
npm install --no-save jsdom puppeteer
npm test
```

About 592,000 assertions. In the order they run:

- **`tests/rules-oracle.js`** — the only test that knows what euchre *is*. The
  rules are written out by hand from the How to Play dialog as literal data: the
  trump order for each suit as seven literal card ids, the non-trump order with
  the left bower removed, the follow-suit rule, the scoring table as five rows.
  It may not call `isTrump`, `power`, `beats`, `effSuit`, `legalPlays` or
  `trickWinnerIndex`, because those are the things on trial. Every ordered pair
  of the 24 cards under each of the four trump suits, 20,000 random tricks scored
  independently, 4,000 follow-suit positions, and 1,200 complete hands re-derived
  from the rules text.

  **Why it exists.** Everything else checks the game is consistent *with itself*,
  which is much weaker than it sounds: swap two entries in a rank table and the
  same cards still exist, five tricks are still taken, one side still scores, the
  audit still balances, and the computer's move is still validated against the
  function that produced it. Every self-consistency check passes while the wrong
  player wins every trick. This file was tested against five deliberate rule
  breaks — swapping the king and queen of trump, making the left bower stop being
  trump, paying three for a march, paying one for a euchre, and not enforcing
  follow-suit — and caught all five.

- **`tests/authorization.js`** — can seat A act as seat B? Every action, every
  phase, every wrong seat, with the state compared before and after so a refusal
  that quietly changed something is caught. Includes 25 hostile payloads
  (`__proto__`, `constructor`, seat 99, seat 1.5, a card that is an object)
  because an unhandled throw inside a Durable Object kills the room for everybody
  at the table. **The euchre-specific trap:** the discard belongs to the *dealer*,
  who is usually not the seat on turn, so a gate checking "is it your turn" would
  look right and let the player who ordered it up throw a card out of the
  dealer's hand.

- **`tests/projection.js`** — holds a written ruling for every top-level field of
  the state and fails if the engine grows one that has never been considered.
  Then 27,000 full-view sweeps at every phase transition, checking that no seat
  can see a card it is not entitled to; the placeholder shape asserted exactly;
  and two constructed counterfactuals — two games differing only in which card
  the dealer put back must be byte-identical to every other seat.

- **`tests/hidden-information.js`** — does the computer cheat? While a bot decides
  its move, every other seat's hand sits behind a getter that records the access.
  5,800 decisions watched. Also: the same two-world counterfactual, checking that
  no other seat's *decisions* or *announcements* differ depending on the hidden
  discard. Matters more online than off — at a table with one person and three
  computers, a cheating AI is three players colluding against them, and it would
  be invisible, because it plays legal cards and simply wins more than it should.

- **`tests/online.js`** — whole sessions over a jittered in-process wire, played
  from views alone. Proves the projection is sufficient (if this can play a hand,
  the views carry everything the interface needs), and that a client cannot act
  as another seat by putting a seat number in a message, that one move is in
  flight at a time, that duplicates are harmless, and that stale and
  version-less frames are dropped.

- **`tests/room.js`** — **eviction**, which cannot be tested any other way. A
  whole session is played with the room hibernated and woken between *every
  single move*, through a storage that serializes on the way in like the real
  one. Three of the things a Durable Object loses produce a wrong game rather
  than an obvious failure, and all three are silent: a reset version counter
  freezes every client's board with no error, reset cursors make a screen reader
  recite the whole hand again, and a reset sequence number plays a second card.
  Also the turn clock in both directions — a seat that goes silent is played by
  the computer, and a seat whose browser is still answering is *not* timed out
  for spending five minutes on a bid.

- **`tests/engine-invariants.js`** — 3,600 hands across every combination of
  difficulty, stick-the-dealer and going-alone. The computer never plays an
  illegal card, five tricks are taken every hand, exactly one side scores and by
  1, 2 or 4, four points only ever follow somebody going alone, and the game
  never stops making progress.

- **`tests/transcript.js`** — audits 400 hands, then takes real recorded hands and
  breaks them ten different ways — a trick given to the wrong player, a card
  played twice, a missing trick, a score that does not follow from the tricks,
  both sides scoring, a card that is not in the deck — and fails if the audit
  does not notice each one. An audit that only ever passes is indistinguishable
  from no audit at all. Also checks that a mid-hand export never prints a card
  still in somebody else's hand, across 2,000 positions.

- **`tests/ui-dom.js`** — drives the real `index.html` through jsdom and plays
  twelve hands by clicking the actual buttons, on manual pacing so nothing
  depends on a timer. Checks that every card's accessible name names the card and
  its place in the hand, that bowers are named as bowers, that unplayable cards
  say why *and refuse to be played*, that focus lands on a card that can actually
  be played, that the go-alone checkbox rewrites the label of the button beside
  it, that the discard enforces exactly one card, and that the decorative seats
  are hidden from assistive technology. Deliberately forces a hand played alone
  and a hand where we are the dealer, because leaving those to chance leaves them
  untested on most runs while the suite reports green.

- **`tests/announcements.js`** — the announcement queue, by sampling what the live
  regions actually said. Two messages twenty milliseconds apart must both be
  spoken; a request must jump ahead of a queued game event and the event must be
  *requeued rather than dropped*; a newer request supersedes an older one; the two
  regions are independent; Repeat works for both; and the same message sent twice
  is still spoken twice, which is the whole reason the region is blanked between
  writes.

Two more, not in `npm test`:

- **`tests/layout.js`** — real headless Chrome across six viewports from 320px to
  1920px, at default and 150% text, failing on any horizontal overflow, any card
  under 40px or out of shape, and any tap target under the 24px WCAG 2.2 minimum.
  Measured range: 56px cards on a 320px phone, 120px at 150% text on a desktop,
  never a horizontal scrollbar. It found a real failure on its first run — the
  footer link was 21px tall.
- **`tests/balance.js`** — not an assertion, a measurement. Reports how often a
  suit gets named, how often the makers are euchred and so on, and can sweep the
  two bidding thresholds in `js/ai.js`. Those are the only numbers in this
  project arrived at by measurement rather than by reasoning, and a tuning knob
  with no way to measure it is a knob nobody will ever turn again.

## Exporting a game log

Press <kbd>E</kbd> (or the "Export log" button) for a complete written account:
every finished hand with who was dealt what, the upcard and what happened to it,
who bid and who passed, what the dealer put back, every card of every trick, and
the score change. Download it as a text file or copy it.

Every hand is audited the moment it finishes, and the audit does not trust the
running totals — it re-wins each trick from the recorded cards, re-adds the trick
counts, and re-applies the scoring table. If anything fails it is written into
the on-screen log immediately and flagged at the top of the export.

Exporting part way through a hand only reports what you can see from your own
seat, so it cannot be used to look at other players' cards.

## Reporting a bug

Press <kbd>B</kbd>. Describe what went wrong and it assembles a report: your
description, the table setup, the accounting check, your browser, and the full
game log. A read-only box shows exactly what will be copied — nothing is hidden
and nothing is sent anywhere on its own.

"Copy report and open GitHub" puts the whole report on the clipboard and opens a
prefilled `issues/new`; paste the log in and post it. The link carries the summary
only, because a full transcript runs to tens of thousands of characters and would
blow past the URL limit — hence the clipboard. There is no server, no API token
and no telemetry anywhere in this; posting the issue is entirely your own action
and needs a GitHub account.

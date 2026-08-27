> **This is the multiplayer fork.** It was copied in behaviour, not in code, from
> `Cribbage/`. The stable single-player game is **not modified** by any work here
> — that is the whole point of the fork, so the game people actually play cannot
> regress while multiplayer is built. A CI guard fails the build if a branch
> touching this directory also touches `Cribbage/`.

# Cribbage

Cribbage for two, built to be fully playable with a keyboard and a screen
reader. Play against the computer, or open a table and play with another person
— if the other seat is empty the computer takes it, so a table works with one
person or two.

No build step, no dependencies. Open `index.html` in a browser and play.

```bash
start index.html
```

## Why this is a rewrite and not a copy

`Cribbage/` is one 1,543-line file with the rules, the strategy and the DOM
mixed together. Three things in it cannot survive being put on a server, and
finding them is most of what this fork is.

**1. The computer reads your hand.** `selectBestPlayCard` has this:

```js
const opponentHand = this.player.hand.filter(...)
if (opponentHand.some(c => newCount + c.value === 31)) score -= 15;
if (opponentHand.some(c => newCount + c.value === 15)) score -= 8;
if (opponentHand.some(c => c.rank === card.rank))      score -= 5;
```

In a single-player game that is a quality problem — the opponent is uncannily
good at not setting you up. At a table where a bot can fill the seat opposite a
stranger it is cheating, and *invisible* cheating: every card it lays is legal
and it simply wins more than it should.

The replacement plays the same idea honestly. Instead of "can my opponent make
thirty-one", it asks "how many of the cards I have not seen would make
thirty-one" — which is what a good player does, is often wrong, and is wrong the
way a person is wrong. `tests/hidden-information.js` watches 25,000 decisions
with a recorder on everything the computer may not see.

**2. The count reset lived in the browser.** Reaching thirty-one or a mutual go
left the engine in a PAUSE state and `handleContinue` cleared the pile:
`game.playedPile = []`. Invisible in one tab and fatal on a server, which has no
interface to do it — pairs and runs would go on scanning backwards across a
reset, so a five laid after the count went back to nothing would pair with a five
from before it. Here the reset is the engine's, and the pile is never destroyed:
`runStart` marks where the current sequence began, so the full play stays on
record for the log and the audit while scoring only looks back as far as it
should.

**3. The discard cannot be simultaneous any more.** `discardToCrib` took the
human's two cards and chose the computer's in the same call. Two people cannot be
made to move in one function call, so each seat sends its own throw and the hand
waits until both are in. That wait is the only genuinely new state in the game,
and the interface has to describe it — "your two are in the crib, waiting for
Ruth" — rather than looking stuck.

## Accessibility

Nothing is conveyed by sight alone.

**Every count is broken down.** "You scored eight" is something a sighted player
checks against the cards in front of them in about a second, and something you
either trust or do not if you cannot. So every score is read out in its parts:
*two fifteens for four, a pair of fives for two, and one for his nob — seven.*
The whole pleasure of cribbage is in the counting, and handing over a total is
handing over the game. You count your own hand, as you would at a table.

**The arithmetic of the play is done for you.** During the pegging every card in
your hand is labelled with what it is worth, what count it would make, and what
it would score: *"Seven of Clubs, worth seven, makes twenty-two, and scores a
pair for two, card 2 of 4."* A sighted player reads that off the table in a
second; by ear it is a running sum plus four subtractions on every single turn.
It is not coaching — it tells you nothing you could not work out from cards that
are face up in front of everybody — it removes arithmetic, not judgement.

**Everything is a real control.** Cards are `<button>` elements. A card you
cannot play is marked `aria-disabled` and says why — "cannot be played, it would
take the count to thirty-four, past thirty-one" — rather than vanishing, so you
can still review your whole hand on your turn.

**Announcements are queued, not raced.** A run of computer turns is spoken as one
polite message. Anything you asked to hear jumps ahead of anything the game
wanted to say, and the game's message is *put back in the queue* rather than
thrown away. Errors go to a separate assertive region. The game log is
deliberately not a live region, so it is never spoken twice.

**The board is decoration.** The pegged track is `aria-hidden` entirely; the
Score table beside it carries both scores and how far each player still has to
go, which is the same information without a hundred and twenty-one holes to walk
through.

**Screen reader modes are left alone.** Nothing is `role="application"`. The
trade-off is that single-letter shortcuts do not reach the page in browse mode —
which is why **every one of them is also a button** in the toolbar, and
<kbd>Tab</kbd>, <kbd>Enter</kbd> and <kbd>Space</kbd> alone are enough to play a
whole game.

### Keys

| Key | Action |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> | Move card to card within your hand |
| <kbd>Enter</kbd> <kbd>Space</kbd> | Play the focused card, or select it to throw |
| <kbd>1</kbd>–<kbd>6</kbd> | Jump straight to that card |
| <kbd>H</kbd> | Your hand, with what each card is worth and what it would make |
| <kbd>T</kbd> | The play: the count, what is down, and what you could score |
| <kbd>L</kbd> | The last count that was read out |
| <kbd>S</kbd> | Both scores, and how far each of you has to go |
| <kbd>P</kbd> | Who dealt, whose crib it is, and the starter |
| <kbd>C</kbd> | Counting aid: what you have seen and what is still out |
| <kbd>W</kbd> | Who is at the table, and whether they are still connected |
| <kbd>G</kbd> | Jump into the game log |
| <kbd>E</kbd> | Export the game log |
| <kbd>B</kbd> | Report a bug |
| <kbd>N</kbd> | Advance: Continue, count, or deal the next hand |
| <kbd>R</kbd> | Repeat the last announcement |
| <kbd>?</kbd> | Accessibility hints |

## Rules as implemented

Fifty-two cards, two players, 121 points (61 is offered as a shorter game). Cut
for deal — lower card deals and takes the first crib. Six cards each; both throw
two to the dealer's crib; the starter is turned, and a jack turned is two for his
heels.

The play: alternate, calling the running total, never past 31. Fifteen 2,
thirty-one 2, a pair 2, three of a kind 6, four 12, a run of three or more one
per card. One for the go, one for the last card. When neither can play the count
resets and whoever did *not* lay last leads.

The count: non-dealer's hand, then the dealer's, then the crib, each with the
starter as a fifth card. Fifteens 2 each, pairs 2 each, runs one per card scored
once for *every* distinct set that makes them, a flush of four 4 and five 5 — **in
the crib it must be all five or it scores nothing** — and one for his nob.

**The game ends the moment somebody reaches the target**, not at the end of the
hand. A non-dealer who pegs out during the play wins before the dealer ever
counts.

Not implemented: muggins, three and four handed cribbage. A skunk is reported
when it happens but counts as one game, not two.

### Two numbers on every card

A card's **counting value** is what it adds during the play and towards a
fifteen: ace one, and the ten, jack, queen and king all ten. A card's **order**
is where it sits in a run: ace one, king thirteen, so a ten really is lower than
a jack. `Cribbage/` had exactly this confusion at the cut for deal, comparing by
counting value, which made a ten, jack, queen and king all equal and pushed the
tie rate from 5.9% to 13%. They are separately named fields here so it cannot
happen again, and `tests/engine-invariants.js` measures the tie rate.

## Playing with somebody else

**Start a new table** makes a room and gives you a five-character code to read
out. The alphabet has no O, I or L and no zero or one, because a code gets read
down a phone. It is spelled out when spoken — "P, 4, K, 7, M" — and stays on the
game screen for the whole session.

**The server owns the game.** Your browser holds only a projection of what your
seat may see; a move is a request that may be refused. There are no optimistic
updates — and because "nothing happened" is exactly what a dropped keypress feels
like to somebody who cannot see the screen, a refusal always says why and focus
goes back to the card you tried to play.

**Silence is explained.** <kbd>W</kbd> says whose turn it is, how long they have
been thinking, and whether the connection is healthy. If your connection drops
the computer plays your seat so the table does not stall, and any move takes it
straight back.

## Layout

```
index.html          markup and the two help dialogs
styles.css          presentation, including the board
js/cards.js         the deck, and the two numbers on every card
js/game.js          rules, scoring with breakdowns, the audit; no DOM access
js/ai.js            the computer player; reads only what its own seat may see
js/view.js          per-seat projection — the allowlist
js/table.js         the seam: local game or remote room, one interface
js/net.js           the WebSocket, pings, and connection state
js/localserver.js   an authoritative server that happens to be in this tab
js/room.js          the room, with nothing platform-specific in it
js/ui.js            rendering, keyboard handling, announcements
worker/             the Cloudflare edge
tests/              node scripts; jsdom and puppeteer for two of them
```

The architecture is the one `sheephead-multiplayer/PLAN.md` worked out and
`euchre/` refined. Four of those files — `table.js`, `net.js`, `localserver.js`
and `room.js` — arrived here as near-verbatim copies, which is the strongest
evidence yet that they want to be a shared library rather than three copies.

**One copied constant proved that the hard way.** `room.js` carried
`state.phase !== 'handOver'` in its handling of "deal the next hand" — Euchre's
phase name. Cribbage calls it `roundOver`, so the condition was true at every
moment and **every deal sent over the wire was silently swallowed and answered
with a re-sent view**. Online play could not get past hand one and nothing said
why. The room now asks the engine (`G.canDeal(state)`) instead of naming a phase.

## Tests

```bash
npm install --no-save jsdom puppeteer
npm test
```

About **419,000 assertions**.

- **`tests/rules-oracle.js`** — the only test that knows what cribbage *is*, and
  it re-implements the scoring **by deliberately different algorithms**: fifteens
  by recursion where the engine uses a bitmask, runs by rank histogram and
  multiplicity where the engine enumerates subsets, pairs by the combination
  formula. Two implementations that agree on 60,000 hands and 30,000 plays are
  unlikely to be wrong in the same direction; two copies of one implementation
  agree on everything. Mutation tested against six deliberate rule breaks —
  including the double-run under-count that the stable game actually had, and the
  count-reset bug this fork exists to fix — and catches all six.
- **`tests/authorization.js`** — can seat A act as seat B, with the state
  compared before and after every refusal. The cribbage traps are the
  **simultaneous discard** (neither seat is "on turn", so a gate written around
  `turn` is meaningless) and the **count**, where one player running the whole
  thing means the other never hears their own hand read out.
- **`tests/projection.js`** — a written ruling for every state field. `deck` is
  the dangerous one and is unique to this game: forty undealt cards give away the
  opponent's hand by elimination, and there is no phase at which that stops being
  true, so it is never sent — not even at the end of the hand, when every other
  secret is released. Also checks that the two hands and the crib come up in
  counting order and not a step earlier.
- **`tests/hidden-information.js`** — the headline claim. 25,000 decisions with a
  recorder on the opponent's hand, their kept cards, their discard, the crib and
  the undealt pack.
- **`tests/online.js`** and **`tests/room.js`** — the wire, and eviction. A
  session is played with the room hibernated and woken between *every single
  move*.
- **`tests/engine-invariants.js`** — 1,639 hands across 240 complete games, every
  difficulty and both targets.
- **`tests/ui-dom.js`** and **`tests/lobby.js`** — twelve hands played by
  clicking real buttons, and the whole make-a-table → read the code → start →
  play path. `ui-dom.js` found a real bug on its first run: after winning a game,
  "Start a new game" did nothing and said nothing.
- **`tests/announcements.js`** — what the live regions actually said, sampled.
- **`tests/layout.js`** — real headless Chrome, six viewports, two text sizes,
  failing on any horizontal overflow or any tap target under the 24px WCAG 2.2
  minimum. It found one on its first run.

## How it plays

Measured over 2,249 hands: the average hand counts **8.11** and the average crib
**4.69**, both within a whisker of the published figures for cribbage. That is
the strongest single piece of evidence that the scoring is right, and it is the
sort of thing no rules test can tell you.

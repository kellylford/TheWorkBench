# Testing the card games

What is covered, what is not, and — more usefully — what each test exists *because of*. Every
suite here was written after something got through, and the note on each one says what.

Two games, two rule sets, one shared conviction: **a test that cannot fail is not evidence.**

- **Sheephead** — `sheephead/` → https://kellylford.github.io/TheWorkBench/sheephead/
- **Cribbage** — `Cribbage/` → https://kellylford.github.io/TheWorkBench/Cribbage/
- **Sheephead Multiplayer** — `sheephead-multiplayer/` → https://kellylford.github.io/TheWorkBench/sheephead-multiplayer/

The third is a fork of the first and currently runs the same suites against a near-identical copy,
which is deliberate: while the two are meant to behave the same, a divergence is a signal. Its CI
job carries one extra check the other two do not — that the branch has not modified `sheephead/`.

---

## Running everything

```bash
cd sheephead && npm test
```

```bash
cd Cribbage && npm test
```

Two Sheephead suites are deliberately outside `npm test`: `layout.js` needs a headless browser, and
`balance.js` takes minutes.

```bash
cd sheephead && npm install --no-save puppeteer && npm run test:layout
```

**Always check the real exit code.** A suite was once shipped red because the command was piped
through `grep`, and `set -e` saw grep's exit status rather than the test's. `npm test` returning 0
is the only thing that counts.

---

## The categories, and why there are four of them

Each layer catches a class of fault the others structurally cannot. That is the whole argument for
having more than one.

| Layer | Question it answers | What it cannot see |
|---|---|---|
| **Rules oracle** | Does it play the right game? | Anything about the screen |
| **Invariants** | Is it self-consistent over many hands? | Whether the rules are right |
| **Interface** | Does the announced, focusable, keyboard-driven thing behave? | Whether it looks right |
| **Geometry & contrast** | Is it legible and reachable at real sizes? | Whether it plays right |

---

## 1. Rules oracles — does it play the right game?

**`sheephead/tests/rules-oracle.js`** · ~47,000 assertions · `npm run test:rules`
**`Cribbage/tests/rules-oracle.js`** · ~50,000 assertions · `npm run test:rules`

Both write the rules out **by hand from the game's own rules page** — the text a player is shown and
is entitled to rely on — and measure the engine against it.

The discipline that makes them worth anything: **an oracle may not call the function it is
testing to decide what it expects.** Sheephead's may not call `isTrump`, `power`, `beats`,
`effSuit`, `points` or `legalPlays`. Cribbage's may not call `scoreHand`, `scorePlay`,
`findBestRun` or `isRun`. Those are the things on trial. The moment a test borrows them it stops
being evidence and starts being a tautology.

Both also carry an **`ORACLE IS WRONG` guard**: each hand-written expected value is checked against
the oracle's own computation *before* it is compared to the engine, so a mistake in the test is
reported as a mistake in the test. This earns its keep — writing the Cribbage cases, it caught
**eleven** wrong expected values of mine, several of which would otherwise have been filed as
engine bugs.

### Why they exist

Everything in section 2 checks that a game is consistent **with itself**. Those checks are
conservation laws, and they hold perfectly while the game plays the wrong game.

Demonstrated, not assumed. Two entries in Sheephead's `TRUMP_ORDER` were swapped so the eight of
diamonds beat the nine, and the whole suite was run:

```
All invariants held across 3600 hands.
No hidden information leaked.
Transcript and audit behave correctly.
Doublers behave as specified.
```

Twenty-five thousand simulated hands, the wrong player taking tricks throughout, and **nothing
noticed** — the same cards still exist so the points still total 120, the transfer is still
zero-sum, and the legality check validated the AI's move against the very function that produced
it.

### What they cover

**Sheephead:** the deck per table size (including the 7D/8D removal at four players and 120 points
at every size); the card values; the fourteen-card trump order typed out literally; **every ordered
pair of the 32 cards** against an independent reading of "highest trump takes it, otherwise highest
of the led suit"; eleven written trick cases plus 20,000 random tricks; seven legality cases plus
3,000 random hands (including that the queen of clubs does not follow a lead of clubs); and 6,000
complete hands whose winner, picker's points and per-opponent stake are re-derived from the rules.

**Cribbage:** card values; seventeen hands whose scores are common knowledge (the 29 hand, the
double-double run, the crib flush rule); **30,000 random hands** scored independently; thirteen
pegging sequences plus 20,000 random ones; and the last-card point.

Both **report which thresholds they actually reached and fail if the interesting ones never came
up.** A scoring test that never lands on 60/61 is not testing the 61-point rule; a Cribbage sweep
that never sees a double run is not testing runs.

### What they found

Sheephead's engine was **correct on every rule checked** — trump order, points, trick winner,
thresholds, multipliers, deck composition, partner card. The oracle changed nothing; it is the
difference between believing that and knowing it.

Cribbage's found three real bugs, all now fixed:

| Bug | Effect |
|---|---|
| `findBestRun` returned the longest run's length **once** | Every double, triple and quadruple run under-scored. **4.9% of all hands wrong**, by 3–9 points |
| Pegging looked at `playedPile.slice(-4)` | Runs of five, six or seven during the play could never score their length |
| `playCard` checked `checkPlayComplete()` before `switchTurn()` | **The last card of every hand scored nothing.** The point is awarded in `switchTurn()`, which that branch returns before reaching |

The first is worth dwelling on: a 4-5-6-6 hand scored 9 instead of 12, and had done since the game
was written. It is not subtle, it is not rare, and no amount of accessibility auditing, geometry
measurement or interface testing would ever have found it — because the game announced its wrong
answer perfectly clearly, in a well-labelled live region, at 4.5:1 contrast.

### Mutation tested

An oracle that never fails is worthless, so both were run against deliberate rule breaks.

**Sheephead — 11 of 11 caught:** two trump-order swaps, king worth 3, ten worth 4, fail cards
ignoring suit, trump following its printed suit, the win threshold at 60, schneider at 90,
no-tricks paying 2, the wrong cards removed at four players, the wrong partner card.

**Cribbage — 3 of 3 caught:** each of the three fixes above, re-broken.

---

## 2. Invariants and simulation — is it self-consistent?

Both games now have this layer. Cribbage also has `simulate.js`, which plays full games to 121
against a deliberately plain baseline opponent and reports win rates — useful for balance, but it
asserts nothing.

| Suite | Scale | Guards |
|---|---|---|
| `engine-invariants.js` | 3,600 hands | 3/4/5/6 players × leaster/redeal × easy/normal/hard. No illegal card, follow-suit enforced, right trick count, no duplicate or lost card, **120 points every hand**, **zero-sum scoring**, dealer rotation and random first dealer |
| `hidden-information.js` | ~19,000 hands | Nothing observable changes on whether the picker is secretly alone; identical wording, identical opponent inference, correct reveal on the jack, silence when it is buried |
| `transcript.js` | 1,800 hands | Per-hand accounting audit — **and deliberately corrupts hands to prove the audit catches them** |
| `doublers.js` | ~1,000 hands | House rules played out to a scored result; zero-sum with doublers on |
| `Cribbage/tests/invariants.js` | 1,200 games | Scores never move backwards, every game terminates and ends past 121, the deal alternates, no card is in two places at once, the count never passes 31, and the engine REFUSES an over-31 card, a repeat card and an out-of-turn play — offered on purpose, because a driver that only ever plays legal cards is testing its own filter |
| `balance.js` | 144,000 hands | Pick rate, picker win rate, expected value. Used to tune `PICK_BASE`; not in `npm test` |

`transcript.js` is the model to copy: it does not merely run the audit, it **breaks things on
purpose and checks the audit complains.** Most tests only ever prove that healthy input passes.

---

## 3. Interface — does the thing a player actually touches behave?

**`sheephead/tests/ui-dom.js`** — drives the real `index.html` through jsdom, playing four hands at
every table size by clicking the actual buttons.

Announcements and labels, focus landing on a playable card, blocked cards explaining themselves and
refusing to be played, bury limits, the settings dialog persisting, hidden information never
reaching the DOM, region naming, and both pacing modes.

Every one of these exists because of a specific complaint from playing the game:

- **`role="application"`** must never appear — it forces a screen reader out of browse mode, taking
  a decision away from the user that is theirs to make.
- **No keyboard instructions inside the hand region** — they were read out on every single card.
- **Cards must not claim "not your turn" when it is your turn** — true in one phase, false in
  another, and only findable by listening.
- **The Continue button must not be rebuilt between opponent turns** — a fresh element takes focus
  and gets announced again, so twenty hands meant twenty "Continue button".

**`Cribbage/tests/ui-dom.js`** does the same for Cribbage, and the checks are deliberately the
same ones — there is no reason to learn each lesson twice. It found four real defects on its first
run:

| Defect | Effect |
|---|---|
| `createCardElement` returned `role="button"` for every card it made | Every card already on the table was offered as a control to activate |
| `aria-pressed` set on cards during the play | Each card announced as "not pressed" on a turn where nothing can be toggled |
| Revealed cards had their control semantics stripped back off | A default pointing the wrong way — readable is the sane default, operable the exception |
| `announce()` armed a fresh one-second clear timer per call | An older timer wiped a newer message. Selecting two cards for the crib in quick succession cut the second announcement off every time |

The first three share a root cause and were fixed together: a card is now readable by default and
upgraded to a control only where one genuinely exists.

### A test that could not fail

Worth recording as a method, not just a war story. A check was written that Continue cancels the
pending timer: press it, wait 250 ms, assert nothing further happened. It passed — and it passed
just as happily with the cancellation deleted, because a stale timer is still armed for its
original five-second deadline and never fires inside 250 ms.

**Every new assertion should be run against the bug it claims to catch.** It now takes the step and
waits the deadline out, and it does catch the fault.

---

## 4. Geometry and contrast — is it legible and reachable?

| Suite | Guards |
|---|---|
| `sheephead/tests/layout.js` | Horizontal overflow, card size and aspect ratio, tap targets, the setup screen, two-column reading order — 6 viewports × 2 font sizes |
| `sheephead/tests/card-overlap.js` | Every index, pip and court glyph measured for intersection |
| `sheephead/tests/appearance.js` | Both skins × both colour schemes: the chosen skin actually applies, red suits render red, an unplayable card keeps its colour and has nothing painted over it, a played card is readable at half size, and a blocked card still looks different from a playable one |
| `sheephead/tests/contrast.js` | Every text element's real colour against what is actually painted behind it, WCAG AA by size |
| `Cribbage/tests/audit.js` | **Both pages** — overflow, card geometry and collisions, contrast, tap targets, duplicate ids, heading order, main landmark, table captions, `th` scope, emoji or arrows in link text |

These found a formal accessibility audit's blind spot: Cribbage scored 78/100 in a review that
never noticed its cards were **100×40 pixels — landscape bars** — because it checked ARIA and
semantics, not shape.

### Four lessons these encode

1. **Test the states users land on.** `layout.js` started a game before measuring, so it never once
   looked at the setup screen — the first screen every player sees, overflowing by up to 293px on a
   phone, for weeks, while the suite reported green.
2. **Measure the axis you changed.** Overflow tests are horizontal by nature. A toolbar regression
   that made the page 586px tall passed every check.
3. **Measure more than one property of the same thing.** `card-overlap.js` passed happily while
   cards were stretched into unusable ribbons, because flinging things apart also means they do not
   overlap.
4. **Look at rendered screenshots.** Three real bugs — a display mode that silently never applied,
   unplayable cards rendering as green mud, black hearts and diamonds in the default card skin —
   were invisible to every assertion and obvious in a picture.

### The `cqw` / `cqh` trap, made twice

- `cqh` does not exist under `container-type: inline-size`. It escapes to the **viewport** and
  stretched every Sheephead card into a tall ribbon.
- `cqw` on the container **itself** does the same — an element is a container for its *descendants*,
  not for itself. Used for a Cribbage card's own padding, it inflated the card to 158px against a
  72px ceiling.

Container units are for children only, and always assert a measured size afterwards.

---

## Flaky tests are worse than missing ones

A test that fails for a reason that was never a bug teaches you to ignore failures. Three were
found and fixed; all three were **test** bugs.

| Test | Rate | Cause |
|---|---|---|
| `doublers.js` | ~23% of runs | Two blocks placed the black queens and counted the result while leaving the *red* doubler switched on. A red pair lands together about one deal in six, adding a second — entirely correct — doubler the count did not expect. It was measuring two rules while claiming to measure one |
| `hidden-information.js` | ~5% | Asserted the Jack of Diamonds is *always* played. The picker burying it is legal — about one deal in 300,000. **"Effectively never" is not "never."** Now allowed, counted, and capped so a real regression still fails loudly |
| `ui-dom.js` timed pacing | ~33% | A focus assertion placed *after* a 5.6-second wait. The game moved on during it, correctly, and the test blamed the app for what it had caused by looking too late. **Capture and assert in the same breath** |

---

## Known gaps

Listed because an undocumented gap reads as coverage.

### Cribbage

- **The AI is weak.** Over 300 full games it wins 38% against a baseline that discards its two
  lowest cards and always plays its highest legal one. `simulate.js` measures this; nothing asserts
  on it, because what the right number is, is a design decision rather than a correctness one.
- **The play-phase reset lives in the UI.** `currentCount = 0` and `playedPile = []` after a 31 or a
  go happen in `GameUI.handleContinue`, not in the engine, so anything headless has to replicate it.
  `simulate.js` does, in a function named `resumeAfterPause`, which is the one place it has to know
  something about the interface. Worth moving into the engine.
- `WEB-ACCESSIBILITY-AUDIT.md` still lists open items — board focus indicator, redundant ARIA,
  focus restoration, and no textual cue as the count approaches 31. Its remediation-status section
  records what has been closed and what guards it.

### Sheephead

- **The AI is tested for legality, not quality.** Nothing checks that it plays *well* — only that it
  never plays an illegal card. `balance.js` measures outcomes in aggregate, which is a different
  claim.
- **No test covers a full game to 121 / a target score**, only individual hands.
- `max-width: 88rem` works backwards at large text: at 1920px with a 24px root it becomes 2112px,
  the cap stops binding, and the layout goes full-bleed.
- `rem` in media queries does not scale with user font size — `(max-width: 48rem)` is always 768px,
  so narrow-screen savings never engage for a desktop user who has scaled text up.

### Both

- **No pixel-level screenshot comparison.** `sheephead/tests/appearance.js` guards the specific
  properties the three real visual bugs violated — a skin silently not applying, a card painted over
  until unreadable, hearts rendering black — but nothing compares rendered images, so a layout that
  looks wrong in a *new* way still needs a person to notice. Cribbage has no equivalent.

  Two things that suite learned the hard way, worth knowing before extending it. **A CSS filter is
  invisible to `getComputedStyle`** — it changes the pixels and nothing else, so a greyscale that
  flattens the red suits cannot be found by reading colours; the filter itself has to be asserted
  on. And **measuring only the first suit glyph on a card missed a real break**, because a card
  shows its suit in three places and the corner index was still red while the pips were not.
- **No shared harness.** The measurement logic in `sheephead/tests/*.js` and `Cribbage/tests/audit.js`
  is nearly identical; only "get the game into a playable state" and "where do cards live" differ.
  That is the natural seam — a shared harness plus a small per-game adapter. The reusable asset is
  **the harness, not a card component**: "here is a measurable definition of an accessible card
  game, and here is what proves it" travels further than a UI library.

---

## Adding a test

1. **Write it before the fix** where you can, and watch it fail. `card-overlap.js` was written
   before the pips were separated, so it was known to reproduce the fault.
2. **Then break the fix again** and confirm the test still catches it. This is the step that
   catches a test which cannot fail.
3. **Never let a test derive its expectation from the code under test.** If it needs a rule, write
   the rule out.
4. **Say what was not covered.** If a suite bounds its work — top-N, sampling, no retry — `log()`
   what was dropped. Silent truncation reads as "covered everything".
5. **Check the exit code**, not the output.

# The engine contract

Five games, one shape. The app drives every engine through the same handful of
functions, so a player who learns the pace control, the log, or the review
buttons in one game does not learn them again in the next. This file is that
shape written down. It is the Swift twin of the browser games' `game.js` /
`ai.js` / `view.js` contract under `thecardplace/<game>/js/`, and each engine is
a **faithful port** of its browser original — same rules, same AI heuristics,
same difficulty levels, same wording in the events wherever the sentence makes
sense on a phone. The words matter: a screen reader user plays entirely by what
these engines say.

## Where things live

```
Sources/CardCore/            Card, Suit, Rank, RandomSource, EventLog, GameEvent,
                             ActionResult, Occupant, Difficulty, Pace, Prose
Sources/<Game>Engine/        one target per game, depends only on CardCore
Tests/<Game>EngineTests/     XCTest; runs with `swift test --filter <Game>EngineTests`
```

An engine target imports `CardCore` and **nothing else** — no Foundation types
beyond what `String`/`Array` need, no SwiftUI, no UIKit, no Combine. It must
build and test on macOS with `swift test` from `thecardplace/ios/CardGamesKit`.

## Every engine exposes these

Names are shown for Hearts; substitute the game.

```swift
public struct HeartsConfig: Codable, Hashable, Sendable {
    public var names: [String]        // one per seat, seat 0 is the person playing
    public var difficulty: Difficulty // how the computer plays
    // …the game's own rule options, each with a default matching the web
    // settings dialog (e.g. pointsToWin, stickTheDealer, allowAlone, doublers)
    public init(...)                  // memberwise-ish with defaults
}

public struct HeartsPlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant     // .human for seat 0, .bot otherwise
    public var hand: [Card]
    // …whatever the game tracks per seat (taken cards, score, tricks, bid…)
}

public enum HeartsPhase: String, Hashable, Sendable { case idle, passing, play, handOver, gameOver /* … */ }

public struct HeartsState: Hashable, Sendable {
    public var phase: HeartsPhase
    public var players: [HeartsPlayer]
    public var config: HeartsConfig
    public var log: EventLog          // every engine writes events here and nowhere else
    // …the rest of the game: trick, turn, leader, dealer, history, winner…
    // All stored properties are `public var` or `public private(set) var`
    // so the interface can render them. Nothing is hidden from the human's
    // *own* seat; what other seats may not see is the interface's job to
    // not show (hands of other players are simply never rendered).
}

public enum HeartsAction: Hashable, Sendable {
    case start                        // deal the first hand from .idle
    case play(Card)
    // …pass([Card]), bid(Int), orderUp, pass, callSuit(Suit), discard(Card)…
    case nextHand                     // only when canDeal(state)
    case newGame                      // from .gameOver back to a fresh .idle-equivalent, keeping names/config
}

public enum HeartsGame {
    public static let seats: Int  // or a function of config for sheephead

    public static func createGame(_ config: HeartsConfig) -> HeartsState

    /// THE ONLY WAY IN. Validates the seat, the phase and the action, and
    /// refuses with a reason in the words of the rule ("you must follow
    /// hearts", "hearts have not been broken"). Never traps on bad input.
    /// Mutates the state, appends events, and returns .ok or .refused(reason).
    /// A caught internal inconsistency returns .faulted(...).
    public static func applyAction(_ state: inout HeartsState, seat: Int,
                                   action: HeartsAction, rng: inout RandomSource) -> ActionResult

    /// Which seat must act now; nil when nobody (handOver, gameOver, idle).
    /// For simultaneous phases (hearts passing, cribbage discard) return the
    /// lowest seat that has not acted yet.
    public static func seatToAct(_ state: HeartsState) -> Int?

    /// Exactly the set of phases in which applyAction accepts .nextHand.
    public static func canDeal(_ state: HeartsState) -> Bool

    /// The cards this seat may play right now; empty if it is not their turn.
    public static func legalPlays(_ state: HeartsState, seat: Int) -> [Card]

    /// Why a card in this seat's hand cannot be played now, or nil if it can.
    /// Said in the words of the rule, never "illegal move".
    public static func whyNot(_ state: HeartsState, seat: Int, card: Card) -> String?
}

public enum HeartsAI {
    /// The computer's move for this seat, reading ONLY what that seat may see:
    /// its own hand, the table, the tricks taken, what it was passed/told.
    /// Never another seat's hand, the undealt deck, the blind, or the crib.
    /// Returns nil if the seat has nothing to decide.
    public static func decide(_ state: HeartsState, seat: Int, rng: inout RandomSource) -> HeartsAction?
}
```

### Card text belongs to the engine

Each engine has a `<Game>Cards` enum (port of `cards.js`) with the game's own
ordering and description functions, e.g. `EuchreCards.describe(card, trump:)`
→ "Jack of Clubs, left bower, second highest trump, counts as spades", or
`SheepheadCards.describe(card)` → "Queen of Clubs, trump, 3 points". The app
uses these verbatim as accessibility labels. `role(...)` returns "" for a card
with nothing worth saying beyond its name (see the long comment in
`hearts/js/cards.js` about why).

Also provide `sortHand(_:)` for the game's display order.

### Review text belongs to the engine too

Port the review sentences from `ui.js` — the strings behind the H/T/L/S/P/C/O
buttons — into a `<Game>Review` enum of pure functions from state + seat to
`String`. They are what a screen reader user asks for most, they are pure text,
and they are testable here. At minimum: `hand`, `trick`, `lastTrick`, `scores`,
plus the game's own (euchre `trumpAndPartner`, hearts `pointsSoFar`, spades
`contract`, cribbage `countingAid`, sheephead `picker`, all `playOrder`,
`cardsPlayed`). Also `status(state, seat)` — one sentence for the status line:
"Your turn. Ruth led the Ten of Hearts." / "Waiting for Ruth to bid."

Wherever the web wording refers to keys or the mouse, drop it; the app has
buttons. Use "tap" only where needed, and prefer "choose".

### Rules help text

Put the "How to play" text (from each game's `index.html` rules dialog) into
`<Game>Help.rules: [(heading: String, body: String)]` in the engine target so the
app shows it offline. Plain sentences; no HTML.

## Events

`state.log.add(kind, text, seat:, cards:, audience:)`. Everything the player
needs to know is an event; the app speaks the events for seat 0 as they arrive
and writes them into the log. Use `audience:` for anything only one seat may
hear ("You were passed …"). Use `cards:` for the cards a line is about so the
app can show them next to the sentence. Use `.error` for nothing — refusals
come back in `ActionResult.reason`, they are not events.

Kinds: `.deal .info .play .trick .hand .game .you .bid .score .moon .pick .count`.
Add cases to `GameEvent.Kind` in CardCore only if a game genuinely needs one.

## Seats and the human

Seat 0 is the person; every other seat is a bot. The engine still checks the
seat on every action — the gate exists so the interface cannot accidentally act
for a bot, and so a multiplayer v2 does not have to retrofit it.

## Determinism

Everything random takes `inout RandomSource`. No `Int.random`, no `shuffled()`
without the generator, no `Date()`. A game created with `RandomSource(seed:)`
and driven by seeded AI must replay identically.

## Tests

Each engine ships an XCTest target with at least:

1. **Rules oracle** — the game's rules written out as literal data (trump
   order as a literal list of cards, the scoring table as literal rows) and
   the engine checked against them, without calling the functions on trial.
2. **Invariants** — a few hundred complete hands played by the AI on every
   difficulty with seeded randomness: never an illegal play, every card
   accounted for once, points/tricks total what they must, scoring is what the
   table says, the game always reaches an end.
3. **Refusals** — the wrong seat, the wrong phase, a card not held, each
   refused with a reason and the state unchanged (compare before/after).
4. **Hidden information** — the AI's decision for seat N is identical when
   every other seat's hand is replaced by a different plausible hand of the
   same size (or the crib/blind/deck is scrambled), for a sample of positions.
5. **Review text** — a handful of exact-string checks on the review sentences
   from constructed positions.

Keep the whole target under about twenty seconds on a Mac.

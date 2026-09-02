import CardCore

// Hearts - the rules, and the only door into them. A port of `hearts/js/game.js`.
//
// Four players, thirteen tricks, no trump. Every heart is worth a point and the
// queen of spades is worth thirteen, and the object is to take none of them. The
// game ends when somebody reaches the target; the LOWEST score wins.
//
// The four rules that are actually the game:
//
// 1. The two of clubs leads the first trick. Whoever holds it plays it.
// 2. Nothing scoring on the first trick, unless a player has nothing else.
// 3. Hearts must be broken before they can be led — unless a player holds
//    nothing but hearts. The rule yields rather than deadlocking.
// 4. Shooting the moon: take all twenty-six and everybody else takes
//    twenty-six instead.
//
// Passing is simultaneous: the engine holds four sets of three and swaps them
// only when all four are in.

/// The rule options a table is made with. Defaults match the web settings
/// dialog: the standard hundred-point game.
public struct HeartsConfig: Codable, Hashable, Sendable {
    public var names: [String]
    public var difficulty: Difficulty
    /// The game ends when somebody reaches this. The web dialog offers 50 and 100.
    public var pointsToWin: Int

    public init(names: [String] = ["North", "East", "South", "West"],
                difficulty: Difficulty = .hard,
                pointsToWin: Int = 100) {
        self.names = names
        self.difficulty = difficulty
        self.pointsToWin = pointsToWin
    }
}

/// Where the three cards go this hand. The hold hand is not decoration: a
/// four-hand cycle with no hold means the deal number and the direction stay
/// in lockstep for ever.
public enum HeartsPassDirection: String, CaseIterable, Codable, Hashable, Sendable {
    case left, right, across, hold

    /// How many seats to the left the cards travel.
    public var offset: Int {
        switch self {
        case .left: return 1
        case .right: return HeartsGame.seats - 1
        case .across: return 2
        case .hold: return 0
        }
    }

    /// "the left", "the right", "the player across" — for "Pass three cards to …".
    public var recipientPhrase: String {
        switch self {
        case .left: return "the left"
        case .right: return "the right"
        case .across: return "the player across"
        case .hold: return "nobody"
        }
    }
}

public struct HeartsPlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant
    public var hand: [Card]
    /// Cards won in tricks this hand.
    public var taken: [Card]
    /// Running total; lowest wins.
    public var score: Int
    /// This hand only, after the moon adjustment.
    public var handPoints: Int

    public init(index: Int, name: String, occupant: Occupant, hand: [Card] = [],
                taken: [Card] = [], score: Int = 0, handPoints: Int = 0) {
        self.index = index
        self.name = name
        self.occupant = occupant
        self.hand = hand
        self.taken = taken
        self.score = score
        self.handPoints = handPoints
    }

    /// Points taken so far this hand, from the tricks won. Public information:
    /// everybody watched every trick.
    public var takenPoints: Int { HeartsGame.pointsOf(taken) }

    /// Public by construction: everybody watched the trick she fell in.
    public var hasQueen: Bool { taken.contains(HeartsCards.queenOfSpades) }
}

public enum HeartsPhase: String, Hashable, Sendable {
    case idle, passing, play, handOver, gameOver
}

/// One card on the table, and who put it there.
public struct HeartsTrickPlay: Hashable, Sendable {
    public let seat: Int
    public let card: Card
    public init(seat: Int, card: Card) {
        self.seat = seat
        self.card = card
    }
}

/// A completed trick.
public struct HeartsLastTrick: Hashable, Sendable {
    public let cards: [HeartsTrickPlay]
    public let winner: Int
    public let points: Int
    public init(cards: [HeartsTrickPlay], winner: Int, points: Int) {
        self.cards = cards
        self.winner = winner
        self.points = points
    }
}

/// One finished hand, for the history table.
public struct HeartsHandRecord: Hashable, Sendable {
    public let deal: Int
    public let passDirection: HeartsPassDirection
    /// Each seat's points for the hand, after the moon adjustment.
    public let points: [Int]
    /// The seat that shot the moon, if anybody did.
    public let shooter: Int?
    /// Running totals after this hand.
    public let scores: [Int]
    public init(deal: Int, passDirection: HeartsPassDirection, points: [Int], shooter: Int?, scores: [Int]) {
        self.deal = deal
        self.passDirection = passDirection
        self.points = points
        self.shooter = shooter
        self.scores = scores
    }
}

public struct HeartsState: Hashable, Sendable {
    public var phase: HeartsPhase
    public var players: [HeartsPlayer]
    public var config: HeartsConfig
    public var log: EventLog

    public var dealNumber: Int
    public var passDirection: HeartsPassDirection
    /// Each seat's chosen three, held here until all four are in. Nil for a
    /// seat that has not chosen yet. The interface must never show another
    /// seat's entry; whether it is nil is the only public part.
    public var passing: [[Card]?]
    /// What each seat was handed, after the swap. One seat's own row only.
    public var received: [[Card]?]
    public var turn: Int
    public var leader: Int
    public var trick: [HeartsTrickPlay]
    public var tricksPlayed: Int
    public var heartsBroken: Bool
    public var lastTrick: HeartsLastTrick?
    public var history: [HeartsHandRecord]
    /// The seat with the lowest score once the game is over; nil before then
    /// and for a tie.
    public var winner: Int?

    /// Who has finished choosing — visible at a real table, because you can
    /// see three cards go face down.
    public var passedIn: [Bool] { passing.map { $0 != nil } }
}

public enum HeartsAction: Hashable, Sendable {
    /// Deal the first hand, from `.idle`.
    case start
    /// Give exactly three cards from your hand, during the pass.
    case pass([Card])
    case play(Card)
    /// Deal the next hand; accepted exactly when `canDeal`.
    case nextHand
    /// Back to a fresh `.idle` with the scores reset and the config kept.
    case newGame
}

public enum HeartsGame {
    public static let seats = 4
    public static let handSize = 13
    public static let passCount = 3
    public static let defaultTarget = 100
    public static let moon = 26

    /// left, right, across, hold — and the hold hand is why this is length four.
    public static let passOrder: [HeartsPassDirection] = [.left, .right, .across, .hold]

    // MARK: - Creation

    public static func createGame(_ config: HeartsConfig) -> HeartsState {
        var players: [HeartsPlayer] = []
        for i in 0..<seats {
            let name = i < config.names.count ? config.names[i] : "Seat \(i + 1)"
            players.append(HeartsPlayer(index: i, name: name, occupant: i == 0 ? .human : .bot))
        }
        return HeartsState(
            phase: .idle,
            players: players,
            config: config,
            log: EventLog(),
            dealNumber: 0,
            passDirection: passOrder[0],
            passing: Array(repeating: nil, count: seats),
            received: Array(repeating: nil, count: seats),
            turn: 0,
            leader: 0,
            trick: [],
            tricksPlayed: 0,
            heartsBroken: false,
            lastTrick: nil,
            history: [],
            winner: nil
        )
    }

    /// The target this table agreed on, not the one this file happens to prefer.
    public static func target(of state: HeartsState) -> Int {
        state.config.pointsToWin > 0 ? state.config.pointsToWin : defaultTarget
    }

    static func name(_ state: HeartsState, _ seat: Int) -> String {
        seat >= 0 && seat < state.players.count ? state.players[seat].name : "seat \(seat)"
    }

    // MARK: - Scoring facts

    public static func isScoring(_ c: Card) -> Bool {
        c.suit == .hearts || c == HeartsCards.queenOfSpades
    }

    public static func pointsOf(_ cards: [Card]) -> Int {
        var n = 0
        for c in cards {
            if c.suit == .hearts { n += 1 } else if c == HeartsCards.queenOfSpades { n += 13 }
        }
        return n
    }

    // MARK: - The only way in

    /// Validates the seat, the phase and the action, and refuses with a reason
    /// in the words of the rule. Never traps on bad input. Everything is
    /// validated before anything is written, so a refusal genuinely means
    /// nothing changed.
    public static func applyAction(_ state: inout HeartsState, seat: Int,
                                   action: HeartsAction, rng: inout RandomSource) -> ActionResult {
        guard state.players.count == seats,
              state.passing.count == seats, state.received.count == seats else {
            return .faulted("the table does not have four seats")
        }
        guard seat >= 0 && seat < seats else { return .refused("not a seat at this table") }

        switch action {
        case .start:
            // Deal the FIRST hand, when the people at the table say they are ready.
            guard state.phase == .idle else { return .refused("the game has already started") }
            state.phase = .handOver   // so newHand's own gate is the only one
            return newHand(&state, rng: &rng)

        case .pass(let cards):
            return doPass(&state, seat: seat, cards: cards)

        case .play(let card):
            return doPlay(&state, seat: seat, card: card)

        case .nextHand:
            guard canDeal(state) else { return .refused("the hand is not over") }
            return newHand(&state, rng: &rng)

        case .newGame:
            guard state.phase != .idle else { return .refused("the game has not started") }
            state = createGame(state.config)
            state.log.add(.game, "New game. Every score is back to nothing.")
            return .ok
        }
    }

    /// EXACTLY the phases applyAction accepts a nextHand in. idle belongs to
    /// the start action.
    public static func canDeal(_ state: HeartsState) -> Bool {
        state.phase == .handOver
    }

    /// Passing has no single seat to act — all four choose at once — so this
    /// answers with the first seat that has not passed.
    public static func seatToAct(_ state: HeartsState) -> Int? {
        switch state.phase {
        case .passing:
            return state.passing.firstIndex { $0 == nil }
        case .play:
            return state.turn
        default:
            return nil
        }
    }

    // MARK: - Dealing

    private static func newHand(_ state: inout HeartsState, rng: inout RandomSource) -> ActionResult {
        guard canDeal(state) else { return .refused("the hand is not over") }

        let deck = Card.fullDeck.shuffled(with: &rng)
        guard deck.count == seats * handSize else { return .faulted("the pack is not fifty-two cards") }
        for i in 0..<seats {
            state.players[i].hand = HeartsCards.sortHand(Array(deck[(i * handSize)..<((i + 1) * handSize)]))
            state.players[i].taken = []
            state.players[i].handPoints = 0
        }

        state.dealNumber += 1
        state.passDirection = passOrder[(state.dealNumber - 1) % passOrder.count]
        state.passing = Array(repeating: nil, count: seats)
        state.received = Array(repeating: nil, count: seats)
        state.trick = []
        state.tricksPlayed = 0
        state.heartsBroken = false
        state.lastTrick = nil

        state.log.add(.deal, "Hand \(state.dealNumber) dealt.")

        if state.passDirection == .hold {
            state.log.add(.info, "Nobody passes this hand.")
            beginPlay(&state)
        } else {
            state.phase = .passing
            state.log.add(.info, "Pass three cards to \(state.passDirection.recipientPhrase).")
        }
        return .ok
    }

    // MARK: - Passing

    private static func doPass(_ state: inout HeartsState, seat: Int, cards: [Card]) -> ActionResult {
        guard state.phase == .passing else { return .refused("nothing is being passed") }
        guard state.passing[seat] == nil else { return .refused("you have already passed") }
        guard cards.count == passCount else { return .refused("pass exactly \(passCount) cards") }
        guard Set(cards).count == cards.count else { return .refused("the same card twice") }
        let hand = state.players[seat].hand
        guard cards.allSatisfy({ hand.contains($0) }) else { return .refused("you do not hold that card") }

        // Kept in the order they sit in the hand, so the sentence reads the way
        // the hand does.
        let chosen = hand.filter { cards.contains($0) }
        state.passing[seat] = chosen

        state.log.add(.you, "You passed \(chosen.spokenList).", seat: seat, cards: chosen, audience: seat)

        // Everyone is told THAT a seat has passed, and nothing about what.
        state.log.add(.info, "\(name(state, seat)) has passed.", seat: seat)

        if state.passing.allSatisfy({ $0 != nil }) { swapPasses(&state) }
        return .ok
    }

    private static func swapPasses(_ state: inout HeartsState) {
        let offset = state.passDirection.offset
        let moving: [(from: Int, to: Int, cards: [Card])] = (0..<seats).map { from in
            (from: from, to: (from + offset) % seats, cards: state.passing[from] ?? [])
        }
        // Removed from every hand BEFORE anything is added to any hand. With
        // `across`, seats 0 and 2 hand each other three cards, and a sequential
        // loop would give seat 0 its own cards back.
        for m in moving {
            state.players[m.from].hand.removeAll { m.cards.contains($0) }
        }
        for m in moving {
            state.players[m.to].hand = HeartsCards.sortHand(state.players[m.to].hand + m.cards)
            state.received[m.to] = m.cards
            state.log.add(.you, "\(name(state, m.from)) passed you \(m.cards.spokenList).",
                          seat: m.from, cards: m.cards, audience: m.to)
        }
        state.passing = Array(repeating: nil, count: seats)
        beginPlay(&state)
    }

    // MARK: - Play

    private static func beginPlay(_ state: inout HeartsState) {
        state.phase = .play
        state.leader = holderOfTwoOfClubs(state)
        state.turn = state.leader
        state.trick = []
        state.log.add(.info, "\(name(state, state.leader)) has the two of clubs and leads.", seat: state.leader)
    }

    public static func holderOfTwoOfClubs(_ state: HeartsState) -> Int {
        state.players.firstIndex { $0.hand.contains(HeartsCards.twoOfClubs) } ?? 0
    }

    /// Which cards this seat may legally play right now. The three yielding
    /// rules all live here, and they all yield the same way: if applying the
    /// restriction would leave nothing, the restriction does not apply.
    public static func legalPlays(_ state: HeartsState, seat: Int) -> [Card] {
        guard state.phase == .play, state.turn == seat,
              seat >= 0, seat < state.players.count else { return [] }
        let hand = state.players[seat].hand
        if hand.isEmpty { return [] }

        let firstTrick = state.tricksPlayed == 0
        let leading = state.trick.isEmpty

        if leading {
            if firstTrick {
                let two = hand.filter { $0 == HeartsCards.twoOfClubs }
                if !two.isEmpty { return two }          // not a choice
            }
            if !state.heartsBroken {
                let notHearts = hand.filter { $0.suit != .hearts }
                if !notHearts.isEmpty { return notHearts }
                return hand                             // nothing but hearts: the rule yields
            }
            return hand
        }

        let led = state.trick[0].card.suit
        let follow = hand.filter { $0.suit == led }
        if !follow.isEmpty { return follow }

        if firstTrick {
            let safe = hand.filter { !isScoring($0) }
            if !safe.isEmpty { return safe }
            return hand                                 // all points: the rule yields
        }
        return hand
    }

    /// Why a card in your hand cannot be played, said in the words of the rule.
    /// Nil when it can.
    public static func whyNot(_ state: HeartsState, seat: Int, card: Card) -> String? {
        guard seat >= 0, seat < state.players.count else { return "not a seat at this table" }
        guard state.phase == .play else { return "no trick is in progress" }
        guard state.turn == seat else { return "not your turn" }
        guard state.players[seat].hand.contains(card) else { return "you do not hold that card" }
        if legalPlays(state, seat: seat).contains(card) { return nil }

        let leading = state.trick.isEmpty
        if !leading {
            let led = state.trick[0].card.suit
            let canFollow = state.players[seat].hand.contains { $0.suit == led }
            if canFollow && card.suit != led {
                return "you must follow \(led.lowerName)"
            }
            if state.tricksPlayed == 0 && isScoring(card) {
                return "no points on the first trick"
            }
            return "not a legal card here"
        }
        if state.tricksPlayed == 0 { return "the two of clubs must be led first" }
        if card.suit == .hearts && !state.heartsBroken { return "hearts have not been broken" }
        return "not a legal card here"
    }

    private static func doPlay(_ state: inout HeartsState, seat: Int, card: Card) -> ActionResult {
        guard state.phase == .play else { return .refused("no trick is in progress") }
        guard state.turn == seat else { return .refused("not your turn") }

        let legal = legalPlays(state, seat: seat)
        guard legal.contains(card) else {
            let held = state.players[seat].hand.contains(card)
            return .refused(held ? (whyNot(state, seat: seat, card: card) ?? "not a legal card here")
                                 : "you do not hold that card")
        }

        state.players[seat].hand.removeAll { $0 == card }
        state.trick.append(HeartsTrickPlay(seat: seat, card: card))

        if card.suit == .hearts && !state.heartsBroken {
            state.heartsBroken = true
            state.log.add(.info, "Hearts are broken.")
        }

        state.log.add(.play, "\(name(state, seat)) played the \(HeartsCards.name(card)).",
                      seat: seat, cards: [card])

        if state.trick.count == seats { return finishTrick(&state) }

        state.turn = (state.turn + 1) % seats
        return .ok
    }

    private static func finishTrick(_ state: inout HeartsState) -> ActionResult {
        guard state.trick.count == seats else { return .faulted("a trick finished with \(state.trick.count) cards") }
        var best = state.trick[0]
        for t in state.trick.dropFirst() where HeartsCards.beats(t.card, best.card) { best = t }
        let cards = state.trick.map(\.card)
        let pts = pointsOf(cards)

        state.players[best.seat].taken += cards
        state.lastTrick = HeartsLastTrick(cards: state.trick, winner: best.seat, points: pts)
        state.tricksPlayed += 1

        state.log.add(.trick, "\(name(state, best.seat)) took the trick\(pointsTail(pts)).",
                      seat: best.seat, cards: cards)

        state.trick = []
        state.leader = best.seat
        state.turn = best.seat

        if state.tricksPlayed == handSize { return finishHand(&state) }
        return .ok
    }

    /// " with 3 points" / " with 1 point" / ", no points".
    public static func pointsTail(_ pts: Int) -> String {
        pts > 0 ? " with \(Prose.count(pts, "point"))" : ", no points"
    }

    private static func finishHand(_ state: inout HeartsState) -> ActionResult {
        let raw = state.players.map { pointsOf($0.taken) }
        let total = raw.reduce(0, +)
        guard total == moon else { return .faulted("a finished hand is worth \(total) points, not \(moon)") }

        // The moon. Checked against the total rather than a count of hearts so
        // that a bug in pointsOf cannot make a false moon.
        var shooter: Int? = nil
        if total == moon {
            for i in 0..<seats where raw[i] == moon { shooter = i }
        }

        for i in 0..<seats {
            let pts: Int
            if let s = shooter { pts = i == s ? 0 : moon } else { pts = raw[i] }
            state.players[i].handPoints = pts
            state.players[i].score += pts
        }

        if let s = shooter {
            state.log.add(.moon, "\(name(state, s)) shot the moon — everybody else takes \(moon).", seat: s)
        }

        state.history.append(HeartsHandRecord(
            deal: state.dealNumber,
            passDirection: state.passDirection,
            points: state.players.map(\.handPoints),
            shooter: shooter,
            scores: state.players.map(\.score)))

        state.log.add(.hand, "Hand \(state.dealNumber) over. "
            + state.players.map { "\($0.name) \($0.handPoints)" }.joined(separator: ", ") + ".")

        let target = target(of: state)
        if state.players.contains(where: { $0.score >= target }) {
            let low = state.players.map(\.score).min() ?? 0
            let winners = state.players.filter { $0.score == low }
            state.winner = winners.count == 1 ? winners[0].index : nil
            state.phase = .gameOver
            if winners.count == 1 {
                state.log.add(.game, "\(winners[0].name) wins with \(low). Lowest score wins.", seat: winners[0].index)
            } else {
                state.log.add(.game, "Tied on \(low): " + winners.map(\.name).joined(separator: " and ") + ".")
            }
        } else {
            state.phase = .handOver
        }
        return .ok
    }
}

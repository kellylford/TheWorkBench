import CardCore

/// The rule options, each defaulting to the browser game's settings dialog.
public struct CribbageConfig: Codable, Hashable, Sendable {
    /// One per seat; seat 0 is the person playing.
    public var names: [String]
    public var difficulty: Difficulty
    /// 121 is the standard game; 61 is once round the board.
    public var targetScore: Int

    public static let targets: [Int] = [121, 61]
    public static let defaultNames = ["You", "Ruth"]

    public init(names: [String] = CribbageConfig.defaultNames,
                difficulty: Difficulty = .normal,
                targetScore: Int = 121) {
        self.names = names
        self.difficulty = difficulty
        self.targetScore = targetScore
    }
}

public struct CribbagePlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant
    /// Cards not yet played.
    public var hand: [Card]
    /// The four kept after the discard; what gets counted.
    public var kept: [Card]
    /// Played this hand, in order.
    public var played: [Card]
    public var score: Int

    public init(index: Int, name: String, occupant: Occupant,
                hand: [Card] = [], kept: [Card] = [], played: [Card] = [], score: Int = 0) {
        self.index = index
        self.name = name
        self.occupant = occupant
        self.hand = hand
        self.kept = kept
        self.played = played
        self.score = score
    }
}

/// The phases of `game.js`, by the same names.
public enum CribbagePhase: String, Hashable, Sendable {
    case idle, cutForDeal, discard, play, count, roundOver, gameOver
}

/// One card laid during the play.
public struct CribbagePilePlay: Hashable, Sendable {
    public let player: Int
    public let card: Card
    public init(player: Int, card: Card) {
        self.player = player
        self.card = card
    }
}

/// The cut for deal. Both cards are announced and both stay on record while a
/// tie is being re-cut.
public struct CribbageCut: Hashable, Sendable {
    public let cuts: [Card]
    public let tie: Bool
    public init(cuts: [Card], tie: Bool) {
        self.cuts = cuts
        self.tie = tie
    }
}

public enum CribbageCountKind: String, Hashable, Sendable {
    case hand, crib
}

/// One stage of the count, as it was read out.
public struct CribbageCountResult: Hashable, Sendable {
    public let who: Int
    public let kind: CribbageCountKind
    public let result: ScoreBreakdown
    public init(who: Int, kind: CribbageCountKind, result: ScoreBreakdown) {
        self.who = who
        self.kind = kind
        self.result = result
    }
}

/// A skunk is being left under half way, a double skunk under a quarter.
/// Reported, not scored: it counts one game won either way.
public enum CribbageSkunk: String, Hashable, Sendable {
    case skunk, doubleSkunk
    public var words: String { self == .skunk ? "skunk" : "double skunk" }
}

public struct CribbageHandResult: Hashable, Sendable {
    public let gameOver: Bool
    public let winner: Int?
    public let scores: [Int]
    public let skunk: CribbageSkunk?
    public let counts: [CribbageCountResult]
    public init(gameOver: Bool, winner: Int?, scores: [Int], skunk: CribbageSkunk?, counts: [CribbageCountResult]) {
        self.gameOver = gameOver
        self.winner = winner
        self.scores = scores
        self.skunk = skunk
        self.counts = counts
    }
}

/// What was dealt, for the record.
public struct CribbageDeal: Hashable, Sendable {
    public var hands: [[Card]]
    public var crib: [Card]
    public var starter: Card?
    public init(hands: [[Card]], crib: [Card] = [], starter: Card? = nil) {
        self.hands = hands
        self.crib = crib
        self.starter = starter
    }
}

/// The permanent record of one hand, audited.
public struct CribbageHandRecord: Hashable, Sendable {
    public let handNumber: Int
    public let gameNumber: Int
    public let dealer: Int
    public let starter: Card?
    public let dealt: CribbageDeal?
    public let discarded: [[Card]?]
    public let kept: [[Card]]
    public let crib: [Card]
    public let pile: [CribbagePilePlay]
    public let counts: [CribbageCountResult]
    public let scores: [Int]
    public let result: CribbageHandResult?
    public var problems: [String]

    public init(handNumber: Int, gameNumber: Int, dealer: Int, starter: Card?, dealt: CribbageDeal?,
                discarded: [[Card]?], kept: [[Card]], crib: [Card], pile: [CribbagePilePlay],
                counts: [CribbageCountResult], scores: [Int], result: CribbageHandResult?, problems: [String] = []) {
        self.handNumber = handNumber
        self.gameNumber = gameNumber
        self.dealer = dealer
        self.starter = starter
        self.dealt = dealt
        self.discarded = discarded
        self.kept = kept
        self.crib = crib
        self.pile = pile
        self.counts = counts
        self.scores = scores
        self.result = result
        self.problems = problems
    }
}

public struct CribbageState: Hashable, Sendable {
    public var phase: CribbagePhase
    public var players: [CribbagePlayer]
    public var config: CribbageConfig
    /// Every engine writes events here and nowhere else.
    public var log: EventLog

    public var gamesWon: [Int]
    public var gameNumber: Int
    public var gameOver: Bool
    public var gameWinner: Int?

    /// Nil until the cut for deal has decided it.
    public var dealer: Int?
    public var handNumber: Int
    /// Whose move. Nobody is "on turn" during the discard — both seats choose
    /// at once — so there it names the seat still being waited for.
    public var turn: Int

    public var cutForDeal: CribbageCut?

    /// The undealt remainder. The interface must never show it: forty cards
    /// give away the opponent's hand by elimination.
    public var deck: [Card]

    /// Face down until the count — including to the dealer whose crib it is.
    public var crib: [Card]
    /// What each seat threw, private to that seat until the hand is over.
    public var discarded: [[Card]?]
    /// The cut card, public the moment it is turned.
    public var starter: Card?

    /// Every card played this hand, in order, never truncated; `runStart` is
    /// the index where the current count sequence began.
    public var pile: [CribbagePilePlay]
    public var runStart: Int
    public var count: Int
    public var goSaid: [Bool]
    public var lastPlayer: Int?

    /// 0 non-dealer's hand, 1 dealer's hand, 2 the crib, 3 done.
    public var countStage: Int
    public var countResults: [CribbageCountResult]

    public var dealt: CribbageDeal?
    public var result: CribbageHandResult?
    public var history: [CribbageHandRecord]

    /// The seats that have not yet thrown to the crib.
    public var seatsOutstanding: [Int] {
        (0..<players.count).filter { discarded[$0] == nil }
    }

    public func hasDiscarded(_ seat: Int) -> Bool {
        discarded.indices.contains(seat) && discarded[seat] != nil
    }

    /// The cards in the current count sequence, which is what pairs and runs
    /// may look back at — and no further.
    public var runCards: [Card] {
        pile.count > runStart ? pile[runStart...].map(\.card) : []
    }

    public var target: Int { config.targetScore }
}

public enum CribbageAction: Hashable, Sendable {
    /// From idle to the cut for deal.
    case start
    /// Cut for deal; either seat may.
    case cut
    /// Exactly two cards to the crib. Simultaneous: each seat's two are held
    /// until both are in.
    case discard([Card])
    case play(Card)
    /// Only for a seat that genuinely cannot play.
    case go
    /// Count the next hand or crib; the seat whose count it is presses it.
    case next
    /// Deal the next hand, when `canDeal`. From gameOver this starts another
    /// game straight away, as the browser game does.
    case nextHand
    /// From gameOver back to idle, keeping names, config and games won.
    case newGame
}

public enum CribbageGame {
    public static let seats = 2
    public static let dealt = 6
    public static let kept = 4
    public static let cribSize = 4

    public static func other(_ i: Int) -> Int { 1 - i }

    public static func createGame(_ config: CribbageConfig) -> CribbageState {
        var cfg = config
        while cfg.names.count < seats {
            cfg.names.append(CribbageConfig.defaultNames[cfg.names.count])
        }
        let players = (0..<seats).map {
            CribbagePlayer(index: $0, name: cfg.names[$0], occupant: $0 == 0 ? .human : .bot)
        }
        return CribbageState(
            phase: .idle, players: players, config: cfg, log: EventLog(),
            gamesWon: [0, 0], gameNumber: 0, gameOver: false, gameWinner: nil,
            dealer: nil, handNumber: 0, turn: 0, cutForDeal: nil, deck: [],
            crib: [], discarded: [nil, nil], starter: nil,
            pile: [], runStart: 0, count: 0, goSaid: [false, false], lastPlayer: nil,
            countStage: 0, countResults: [], dealt: nil, result: nil, history: [])
    }

    // MARK: - Words

    static func nameOf(_ s: CribbageState, _ i: Int) -> String { s.players[i].name }

    /// Keeps messages grammatical when a player is named "You".
    static func vb(_ s: CribbageState, _ i: Int, _ third: String, _ second: String) -> String {
        s.players[i].name.lowercased() == "you" ? second : third
    }

    /// The possessive: "your", "Ruth’s".
    static func poss(_ s: CribbageState, _ i: Int) -> String {
        let n = s.players[i].name
        return n.lowercased() == "you" ? "your" : n + "’s"
    }

    static func cap(_ s: String) -> String {
        guard let f = s.first else { return s }
        return f.uppercased() + s.dropFirst()
    }

    static func scoreLine(_ s: CribbageState) -> String {
        "\(nameOf(s, 0)) \(s.players[0].score), \(nameOf(s, 1)) \(s.players[1].score)."
    }

    // MARK: - Whose move

    /// Exactly the phases applyAction accepts a nextHand in. Idle belongs to
    /// `start`: a table that has never dealt is started deliberately.
    public static func canDeal(_ state: CribbageState) -> Bool {
        state.phase == .roundOver || state.phase == .gameOver
    }

    /// Not simply `turn`: during the discard it is the lowest seat still to
    /// throw, and between hands it is nobody.
    public static func seatToAct(_ state: CribbageState) -> Int? {
        switch state.phase {
        case .cutForDeal: return state.turn
        case .discard: return state.seatsOutstanding.first
        case .play, .count: return state.turn
        default: return nil
        }
    }

    // MARK: - The play, as questions

    /// The cards in this seat's hand that fit under thirty-one, whether or
    /// not it is their turn.
    public static func playable(_ state: CribbageState, seat: Int) -> [Card] {
        guard state.players.indices.contains(seat) else { return [] }
        return state.players[seat].hand.filter { state.count + CribbageCards.value($0) <= 31 }
    }

    public static func canPlay(_ state: CribbageState, seat: Int) -> Bool {
        !playable(state, seat: seat).isEmpty
    }

    public static func legalPlays(_ state: CribbageState, seat: Int) -> [Card] {
        guard state.phase == .play, state.turn == seat else { return [] }
        return playable(state, seat: seat)
    }

    /// Why a card cannot be played now, in the words of the rule; nil if it can.
    public static func whyNot(_ state: CribbageState, seat: Int, card: Card) -> String? {
        if state.phase != .play { return "it is not the play" }
        if state.turn != seat { return "it is not your turn" }
        guard state.players.indices.contains(seat) else { return "that is not a seat at this table" }
        if !state.players[seat].hand.contains(card) { return "that card is not in your hand" }
        let to = state.count + CribbageCards.value(card)
        if to > 31 {
            return "it would take the count to " + CribbageCards.numberWord(to) + ", past thirty-one"
        }
        return nil
    }

    /// What laying `card` on the current sequence would score, and why.
    public static func pointsForPlay(_ state: CribbageState, card: Card) -> PlayScore {
        CribbageScoring.pointsForPlay(sequence: state.runCards, count: state.count, card: card)
    }

    // MARK: - The only way in

    public static func applyAction(_ state: inout CribbageState, seat: Int,
                                   action: CribbageAction, rng: inout RandomSource) -> ActionResult {
        guard state.players.count == seats, state.discarded.count == seats, state.goSaid.count == seats else {
            return .faulted("the game state is not a two-seat cribbage game")
        }
        guard seat >= 0, seat < state.players.count else {
            return .refused("not a seat at this table")
        }

        switch action {
        case .start:
            if state.phase != .idle { return .refused("the game has already started") }
            state.phase = .cutForDeal
            state.turn = 0
            state.log.add(.info, "Cut for deal. The lower card deals first and takes the first crib.")
            return .ok

        case .cut:
            if state.phase != .cutForDeal { return .refused("there is nothing to cut for") }
            return doCut(&state, rng: &rng)

        case .discard(let cards):
            if state.phase != .discard { return .refused("it is not the discard") }
            if state.hasDiscarded(seat) { return .refused("you have already thrown to the crib") }
            if cards.count != 2 { return .refused("choose exactly two cards") }
            if cards[0] == cards[1] { return .refused("choose two different cards") }
            for c in cards where !state.players[seat].hand.contains(c) {
                return .refused("the \(c.name) is not in your hand")
            }
            return doDiscard(&state, seat: seat, cards: cards)

        case .play(let card):
            if state.phase != .play { return .refused("it is not the play") }
            if state.turn != seat { return .refused("not your turn") }
            if let why = whyNot(state, seat: seat, card: card) { return .refused(why) }
            return doPlay(&state, seat: seat, card: card)

        case .go:
            if state.phase != .play { return .refused("it is not the play") }
            if state.turn != seat { return .refused("not your turn") }
            if canPlay(state, seat: seat) {
                return .refused("you have a card you can play, so you must play it")
            }
            return doGo(&state, seat: seat)

        case .next:
            if state.phase != .count { return .refused("there is nothing to count") }
            if state.turn != seat { return .refused("it is not your count") }
            return doNext(&state)

        case .nextHand:
            if !canDeal(state) { return .refused("the hand is not over") }
            return newHand(&state, rng: &rng)

        case .newGame:
            if state.phase != .gameOver { return .refused("the game is not over") }
            return doNewGame(&state)
        }
    }

    // MARK: - Cutting for deal

    private static func doCut(_ state: inout CribbageState, rng: inout RandomSource) -> ActionResult {
        // Both players cut the SAME deck, as they would at a table.
        let deck = Card.fullDeck.shuffled(with: &rng)
        let a = deck[0], b = deck[1]
        state.cutForDeal = CribbageCut(cuts: [a, b], tie: false)
        state.log.add(.deal, nameOf(state, 0) + vb(state, 0, " cuts", " cut") + " the " + a.name + ". " +
                      nameOf(state, 1) + vb(state, 1, " cuts", " cut") + " the " + b.name + ".",
                      cards: [a, b])

        // Compared by RUN ORDER, not by counting value: a ten is lower than a jack.
        if CribbageCards.order(a) == CribbageCards.order(b) {
            state.cutForDeal = CribbageCut(cuts: [a, b], tie: true)
            state.log.add(.info, "A tie. Cut again.")
            return .ok
        }
        let dealer = CribbageCards.order(a) < CribbageCards.order(b) ? 0 : 1
        state.dealer = dealer
        state.log.add(.info, nameOf(state, dealer) + vb(state, dealer, " has", " have") +
                      " the lower card and " + vb(state, dealer, "deals", "deal") + " first.", seat: dealer)
        return newHand(&state, rng: &rng)
    }

    // MARK: - Dealing

    private static func newHand(_ state: inout CribbageState, rng: inout RandomSource) -> ActionResult {
        guard var dealer = state.dealer else { return .faulted("no dealer has been decided") }
        if state.gameOver {
            state.players[0].score = 0
            state.players[1].score = 0
            state.gameOver = false
            state.gameWinner = nil
            state.handNumber = 0
            state.gameNumber += 1
            state.log.add(.info, "A new game. Both scores back to nothing, and " + nameOf(state, dealer) +
                          vb(state, dealer, " deals", " deal") + ".")
        }
        if state.gameNumber == 0 { state.gameNumber = 1 }
        dealer = state.dealer ?? dealer

        state.handNumber += 1
        state.phase = .discard
        state.crib = []
        state.discarded = [nil, nil]
        state.starter = nil
        state.pile = []
        state.runStart = 0
        state.count = 0
        state.goSaid = [false, false]
        state.lastPlayer = nil
        state.countStage = 0
        state.countResults = []
        state.result = nil

        let deck = Card.fullDeck.shuffled(with: &rng)
        var at = 0
        for i in 0..<seats {
            state.players[i].hand = []
            state.players[i].kept = []
            state.players[i].played = []
        }
        // Alternating, one at a time, the way it is dealt at a table.
        for _ in 0..<dealt {
            for k in 0..<seats {
                let seat = (dealer + 1 + k) % seats
                state.players[seat].hand.append(deck[at])
                at += 1
            }
        }
        state.deck = Array(deck[at...])
        state.dealt = CribbageDeal(hands: state.players.map(\.hand))

        // Nobody is "on turn" during the discard; `turn` names the seat still
        // being waited for, the non-dealer while both are outstanding.
        state.turn = other(dealer)

        state.log.add(.deal, "Hand \(state.handNumber). " + nameOf(state, dealer) +
                      vb(state, dealer, " deals", " deal") + ", so it is " + poss(state, dealer) +
                      " crib. Both players throw two cards to it.", seat: dealer)
        for q in 0..<seats {
            let sorted = CribbageCards.sortHand(state.players[q].hand)
            state.log.add(.you, "Your six cards: " + CribbageCards.listNames(sorted) + ".",
                          seat: q, cards: sorted, audience: q)
        }
        return .ok
    }

    private static func doNewGame(_ state: inout CribbageState) -> ActionResult {
        state.players[0].score = 0
        state.players[1].score = 0
        for i in 0..<seats {
            state.players[i].hand = []
            state.players[i].kept = []
            state.players[i].played = []
        }
        state.gameOver = false
        state.gameWinner = nil
        state.handNumber = 0
        state.gameNumber += 1
        state.phase = .idle
        state.turn = 0
        state.dealer = nil
        state.cutForDeal = nil
        state.deck = []
        state.crib = []
        state.discarded = [nil, nil]
        state.starter = nil
        state.pile = []
        state.runStart = 0
        state.count = 0
        state.goSaid = [false, false]
        state.lastPlayer = nil
        state.countStage = 0
        state.countResults = []
        state.dealt = nil
        state.result = nil
        state.log.add(.info, "A new game. Both scores back to nothing. Cut for deal to begin.")
        return .ok
    }

    // MARK: - The discard

    private static func doDiscard(_ state: inout CribbageState, seat p: Int, cards chosen: [Card]) -> ActionResult {
        guard let dealer = state.dealer else { return .faulted("no dealer has been decided") }
        state.players[p].hand.removeAll { chosen.contains($0) }
        state.players[p].kept = state.players[p].hand
        state.discarded[p] = chosen

        state.log.add(.you, "You threw the " + CribbageCards.listNames(chosen) + " to " +
                      (dealer == p ? "your own crib" : poss(state, dealer) + " crib") +
                      ". You keep " + CribbageCards.listNames(CribbageCards.sortHand(state.players[p].kept)) + ".",
                      seat: p, cards: chosen, audience: p)
        // Public that it happened, private what it was.
        state.log.add(.info, nameOf(state, p) + vb(state, p, " has thrown", " have thrown") +
                      " two cards to the crib.", seat: p)

        let waiting = state.seatsOutstanding
        if let first = waiting.first {
            state.turn = first
            return .ok
        }

        // Both in. Form the crib, turn the starter, pay his heels.
        var crib: [Card] = []
        for s in 0..<seats { crib += state.discarded[s] ?? [] }
        state.crib = crib

        guard !state.deck.isEmpty else { return .faulted("the pack is empty at the cut") }
        let starter = state.deck.removeFirst()
        state.starter = starter
        state.log.add(.deal, "The starter is the " + CribbageCards.describe(starter) + ".", cards: [starter])

        state.dealt?.crib = crib
        state.dealt?.starter = starter

        if starter.rank == .jack {
            award(&state, dealer, 2, "two for his heels")
            if state.gameOver { return .ok }
        }

        state.phase = .play
        state.turn = other(dealer)
        state.log.add(.info, nameOf(state, state.turn) + vb(state, state.turn, " leads", " lead") +
                      ". The count starts at nothing.", seat: state.turn)
        return .ok
    }

    // MARK: - Scoring, and the only way anybody gains a point

    /// `phrase` is the whole of what the points were for, in the words a
    /// cribbage player would use — "two for his heels", "fifteen for two and
    /// a pair for two", "one for the go".
    private static func award(_ state: inout CribbageState, _ p: Int, _ points: Int, _ phrase: String) {
        if points == 0 { return }
        state.players[p].score += points
        state.log.add(.score, nameOf(state, p) + vb(state, p, " scores ", " score ") + phrase + ". " + scoreLine(state), seat: p)
        checkWinner(&state)
    }

    /// The game stops THE MOMENT somebody reaches the target — not at the end
    /// of the hand. A non-dealer who pegs out during the play wins before the
    /// dealer ever counts.
    @discardableResult
    private static func checkWinner(_ state: inout CribbageState) -> Bool {
        if state.gameOver { return true }
        let target = state.config.targetScore
        for i in 0..<seats where state.players[i].score >= target {
            let loser = other(i)
            let theirs = state.players[loser].score
            var skunk: CribbageSkunk? = nil
            if theirs < target / 2 + 1 {
                skunk = theirs < target / 4 + 1 ? .doubleSkunk : .skunk
            }
            state.gameOver = true
            state.gameWinner = i
            state.gamesWon[i] += 1
            state.phase = .gameOver
            state.result = CribbageHandResult(gameOver: true, winner: i,
                                              scores: [state.players[0].score, state.players[1].score],
                                              skunk: skunk, counts: state.countResults)
            state.log.add(.game, nameOf(state, i) + vb(state, i, " wins", " win") + ", " +
                          "\(state.players[i].score) to \(theirs)" +
                          (skunk.map { " — a " + $0.words + "." } ?? ".") +
                          " Games: " + nameOf(state, 0) + " \(state.gamesWon[0]), " +
                          nameOf(state, 1) + " \(state.gamesWon[1]). Deal to start another.", seat: i)
            recordHand(&state)
            // THE DEAL PASSES HOWEVER THE HAND ENDED. Rotated after the record
            // so the record names the dealer of the hand it describes.
            if let d = state.dealer {
                state.dealer = other(d)
                state.turn = other(d)
            }
            return true
        }
        return false
    }

    // MARK: - The play

    private static func handFinished(_ state: CribbageState) -> Bool {
        state.players[0].hand.isEmpty && state.players[1].hand.isEmpty
    }

    private static func resetCount(_ state: inout CribbageState, leader: Int, why: String) {
        state.count = 0
        state.runStart = state.pile.count
        state.goSaid = [false, false]
        state.turn = leader
        if !handFinished(state) {
            state.log.add(.info, why + " The count goes back to nothing, and " + nameOf(state, leader) +
                          vb(state, leader, " leads", " lead") + ".", seat: leader)
        }
    }

    private static func doPlay(_ state: inout CribbageState, seat p: Int, card: Card) -> ActionResult {
        guard let at = state.players[p].hand.firstIndex(of: card) else {
            return .refused("that card is not in your hand")
        }
        state.players[p].hand.remove(at: at)

        // Worked out BEFORE the card joins the pile; pointsForPlay appends the
        // candidate itself, so scoring after the push would count it twice.
        let got = pointsForPlay(state, card: card)

        state.players[p].played.append(card)
        state.pile.append(CribbagePilePlay(player: p, card: card))
        state.count += CribbageCards.value(card)
        state.lastPlayer = p

        state.log.add(.play, nameOf(state, p) + vb(state, p, " plays", " play") + " the " + card.name +
                      ". The count is \(state.count).", seat: p, cards: [card])

        let was31 = state.count == 31
        if got.total > 0 { award(&state, p, got.total, got.phrase) }
        if state.gameOver { return .ok }

        if handFinished(state) {
            // The last card of the play is worth one — unless it made exactly
            // thirty-one, already paid two.
            if !was31 { award(&state, p, 1, "one for the last card") }
            if state.gameOver { return .ok }
            endPlay(&state)
            return .ok
        }

        if was31 {
            resetCount(&state, leader: other(p), why: "Thirty-one.")
            return .ok
        }

        // The opponent moves next if they can. If they cannot they will have
        // to say go, which is their action to take.
        state.turn = other(p)
        return .ok
    }

    private static func doGo(_ state: inout CribbageState, seat p: Int) -> ActionResult {
        state.goSaid[p] = true
        state.log.add(.info, nameOf(state, p) + vb(state, p, " says", " say") + " go.", seat: p)

        let opp = other(p)
        if canPlay(state, seat: opp) {
            state.turn = opp
            return .ok
        }

        // Neither can play. The last card laid takes one for the go — unless
        // the count is exactly thirty-one, already paid two.
        guard let last = state.lastPlayer else { return .faulted("a go with nothing played") }
        if state.count != 31 {
            award(&state, last, 1, "one for the go")
            if state.gameOver { return .ok }
        }
        if handFinished(state) { endPlay(&state); return .ok }
        // Whoever did NOT lay the last card leads the next sequence.
        resetCount(&state, leader: other(last), why: "Neither of you can play.")
        return .ok
    }

    private static func endPlay(_ state: inout CribbageState) {
        guard let dealer = state.dealer else { return }
        state.phase = .count
        state.countStage = 0
        state.countResults = []
        state.turn = other(dealer)
        state.log.add(.info, "The play is over. " + nameOf(state, state.turn) +
                      vb(state, state.turn, " counts", " count") + " first.", seat: state.turn)
    }

    // MARK: - The count

    /// Stepped, and each seat counts its own hand, which is what happens at a
    /// real table.
    private static func doNext(_ state: inout CribbageState) -> ActionResult {
        guard let dealer = state.dealer, let starter = state.starter else {
            return .faulted("the count has no starter")
        }
        let nonDealer = other(dealer)

        func countHand(_ who: Int) -> Bool {
            let r = CribbageScoring.scoreHand(state.players[who].kept, starter: starter, isCrib: false)
            state.countResults.append(CribbageCountResult(who: who, kind: .hand, result: r))
            let cards = CribbageCards.sortHand(state.players[who].kept)
            state.log.add(.count, cap(poss(state, who)) + " hand: " + CribbageCards.listNames(cards) +
                          " with the " + starter.name + ". " + cap(r.spoken) + ".", seat: who, cards: cards)
            award(&state, who, r.total, CribbageCards.numberWord(r.total) + " for the hand")
            return state.gameOver
        }

        if state.countStage == 0 {
            if countHand(nonDealer) { return .ok }
            state.countStage = 1
            state.turn = dealer
            return .ok
        }
        if state.countStage == 1 {
            if countHand(dealer) { return .ok }
            state.countStage = 2
            state.turn = dealer
            return .ok
        }

        // The crib, which nobody has seen until this moment.
        let c = CribbageScoring.scoreHand(state.crib, starter: starter, isCrib: true)
        state.countResults.append(CribbageCountResult(who: dealer, kind: .crib, result: c))
        let cribCards = CribbageCards.sortHand(state.crib)
        state.log.add(.count, cap(poss(state, dealer)) + " crib: " + CribbageCards.listNames(cribCards) +
                      " with the " + starter.name + ". " + cap(c.spoken) + ".", seat: dealer, cards: cribCards)
        award(&state, dealer, c.total, CribbageCards.numberWord(c.total) + " for the crib")
        if state.gameOver { return .ok }

        state.countStage = 3
        state.phase = .roundOver
        state.result = CribbageHandResult(gameOver: false, winner: nil,
                                          scores: [state.players[0].score, state.players[1].score],
                                          skunk: nil, counts: state.countResults)
        // Recorded BEFORE the deal passes, so the record names the dealer of
        // the hand it describes.
        recordHand(&state)
        state.dealer = other(dealer)
        state.turn = other(dealer)
        state.log.add(.info, "Hand \(state.handNumber) complete. " + scoreLine(state) + " " +
                      nameOf(state, state.turn) + vb(state, state.turn, " deals", " deal") + " next.", seat: state.turn)
        return .ok
    }

    // MARK: - The permanent record

    private static func recordHand(_ state: inout CribbageState) {
        var rec = CribbageHandRecord(
            handNumber: state.handNumber, gameNumber: state.gameNumber,
            dealer: state.dealer ?? 0, starter: state.starter, dealt: state.dealt,
            discarded: state.discarded, kept: state.players.map(\.kept), crib: state.crib,
            pile: state.pile, counts: state.countResults,
            scores: [state.players[0].score, state.players[1].score], result: state.result)
        rec.problems = auditHand(rec)
        if !rec.problems.isEmpty {
            state.log.add(.info, "Accounting check failed on hand \(rec.handNumber): " +
                          rec.problems.joined(separator: "; ") + ".")
        }
        state.history.append(rec)
    }

    /// Re-derive the hand from the cards rather than trusting what was
    /// recorded. A hand cut short by somebody winning is checked for what it
    /// did contain rather than for what a complete hand would.
    public static func auditHand(_ rec: CribbageHandRecord) -> [String] {
        var bad: [String] = []

        // Every card accounted for exactly once.
        var seen = Set<Card>()
        var dup = 0, count = 0
        func note(_ c: Card) {
            count += 1
            if !seen.insert(c).inserted { dup += 1 }
        }
        let hands = rec.dealt?.hands ?? []
        for h in hands { h.forEach(note) }
        if let s = rec.starter { note(s) }
        if dup > 0 { bad.append("\(dup) card" + (dup == 1 ? " was" : "s were") + " dealt twice") }
        if hands.count == seats {
            for (k, h) in hands.enumerated() where h.count != dealt {
                bad.append("seat \(k + 1) was dealt \(h.count) cards")
            }
            if count != seats * dealt + (rec.starter == nil ? 0 : 1) {
                bad.append("the deal accounts for \(count) cards")
            }
        }

        // Kept plus discarded equals dealt, per seat, with nothing invented.
        for i in 0..<seats {
            guard let thrown = rec.discarded[i] else { continue }
            let keptCards = rec.kept.indices.contains(i) ? rec.kept[i] : []
            if keptCards.count != kept { bad.append("seat \(i + 1) kept \(keptCards.count) cards") }
            if thrown.count != 2 { bad.append("seat \(i + 1) threw \(thrown.count) cards") }
            let dealtTo = hands.indices.contains(i) ? hands[i] : []
            for c in keptCards + thrown where !dealtTo.contains(c) {
                bad.append("seat \(i + 1) held the \(c.id), which was not dealt to them")
            }
        }

        // The crib is exactly the four thrown cards.
        if let a = rec.discarded[0], let b = rec.discarded[1] {
            if Set(a + b) != Set(rec.crib) { bad.append("the crib is not what was thrown to it") }
            if rec.crib.count != cribSize { bad.append("the crib holds \(rec.crib.count) cards") }
        }

        // No card played twice, and only cards that seat kept.
        var playedSeen = Set<Card>()
        for e in rec.pile {
            if !playedSeen.insert(e.card).inserted { bad.append("the \(e.card.id) was played twice") }
            let k = rec.kept.indices.contains(e.player) ? rec.kept[e.player] : []
            if !k.isEmpty && !k.contains(e.card) {
                bad.append("seat \(e.player + 1) played the \(e.card.id), which they did not keep")
            }
        }

        // The count never passed thirty-one, re-added from the cards.
        var running = 0
        for e in rec.pile {
            let v = CribbageCards.value(e.card)
            if running + v > 31 { running = 0 }
            running += v
            if running > 31 { bad.append("the count reached \(running)") }
        }

        // Every recorded count re-scores to the same number.
        if let starter = rec.starter {
            for c in rec.counts {
                let cards = c.kind == .crib ? rec.crib : (rec.kept.indices.contains(c.who) ? rec.kept[c.who] : [])
                if cards.count != kept { continue }
                let again = CribbageScoring.scoreHand(cards, starter: starter, isCrib: c.kind == .crib).total
                if again != c.result.total {
                    bad.append("the \(c.kind.rawValue) for seat \(c.who + 1) was recorded as \(c.result.total) but re-scores to \(again)")
                }
            }
        }

        for (k, s) in rec.scores.enumerated() where s < 0 {
            bad.append("seat \(k + 1) has a negative score")
        }
        return bad
    }
}

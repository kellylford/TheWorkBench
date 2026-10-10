import CardCore

// MARK: - Configuration

/// The rules a table plays by. Defaults match the browser game's settings
/// dialog: ten points, stick the dealer off, going alone allowed, normal
/// opponents.
public struct EuchreConfig: Codable, Hashable, Sendable {
    /// One per seat; seat 0 is the person playing.
    public var names: [String]
    public var difficulty: Difficulty
    /// 10 is the standard game; 5, 11 and 15 are offered too.
    public var pointsToWin: Int
    /// If everybody passes twice the dealer must name a suit, so no hand is
    /// ever thrown in.
    public var stickTheDealer: Bool
    /// Whoever makes trump may send their partner out of the hand, for four
    /// points if they take all five tricks.
    public var allowAlone: Bool

    public static let defaultNames = ["You", "Ruth", "Dale", "Marta"]

    /// The choices the settings dialog offers, in its order.
    public static let pointsToWinChoices = [10, 11, 15, 5]

    /// Names for the computer players, short and distinct so they stay quick
    /// to hear and easy to tell apart when announced.
    public static let crewNames = [
        "Ruth", "Marta", "Dale", "Otis", "Winnie", "Hal", "June", "Cyrus",
        "Pearl", "Vernon", "Della", "Amos", "Nell", "Gus", "Iris", "Roy",
        "Bea", "Walt", "Etta", "Merle", "Faye", "Cliff", "Norma", "Lloyd",
    ]

    public init(names: [String] = EuchreConfig.defaultNames,
                difficulty: Difficulty = .normal,
                pointsToWin: Int = 10,
                stickTheDealer: Bool = false,
                allowAlone: Bool = true) {
        var n = Array(names.prefix(EuchreGame.seats))
        while n.count < EuchreGame.seats { n.append(EuchreConfig.defaultNames[n.count]) }
        self.names = n
        self.difficulty = difficulty
        self.pointsToWin = pointsToWin > 0 ? pointsToWin : 10
        self.stickTheDealer = stickTheDealer
        self.allowAlone = allowAlone
    }
}

// MARK: - Pieces of the state

public struct EuchrePlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant
    public var hand: [Card]
    public var tricksWon: Int

    public init(index: Int, name: String, occupant: Occupant, hand: [Card] = [], tricksWon: Int = 0) {
        self.index = index
        self.name = name
        self.occupant = occupant
        self.hand = hand
        self.tricksWon = tricksWon
    }
}

public enum EuchrePhase: String, Codable, Hashable, Sendable {
    case idle, bid1, bid2, discard, play, handOver, gameOver
}

/// Where the upcard is. It stays public for the whole hand — everybody at the
/// table saw it, so its identity is common knowledge from the moment it lands.
public enum EuchreUpcardStatus: String, Codable, Hashable, Sendable {
    case none, up, taken, turnedDown
}

public struct EuchrePlay: Hashable, Sendable {
    public let player: Int
    public let card: Card
    public init(player: Int, card: Card) {
        self.player = player
        self.card = card
    }
}

public struct EuchreTrick: Hashable, Sendable {
    public let number: Int
    public let plays: [EuchrePlay]
    public let winner: Int
    public init(number: Int, plays: [EuchrePlay], winner: Int) {
        self.number = number
        self.plays = plays
        self.winner = winner
    }
}

/// One thing somebody said in the bidding.
public struct EuchreBid: Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case pass, orderUp, call }
    public let player: Int
    public let kind: Kind
    /// 1 while the upcard is on offer, 2 once it has been turned down.
    public let round: Int
    public let suit: Suit?
    public let alone: Bool
    /// The words used in the log: "orders it up", "takes it up", "names hearts".
    public let words: String
    public init(player: Int, kind: Kind, round: Int, suit: Suit? = nil, alone: Bool = false, words: String) {
        self.player = player
        self.kind = kind
        self.round = round
        self.suit = suit
        self.alone = alone
        self.words = words
    }
}

/// The deal as it left the dealer's hands, kept for the end-of-hand review.
public struct EuchreDeal: Hashable, Sendable {
    public let hands: [[Card]]
    public let upcard: Card
    public let kitty: [Card]
    public init(hands: [[Card]], upcard: Card, kitty: [Card]) {
        self.hands = hands
        self.upcard = upcard
        self.kitty = kitty
    }
}

public struct EuchreResult: Hashable, Sendable {
    public var thrownIn: Bool
    public var makerTeam: Int?
    public var made: Int
    public var euchred: Bool
    public var alone: Bool
    public var trump: Suit?
    public var maker: Int?
    /// Points to each side, in team order.
    public var deltas: [Int]
    public var label: String
    public var summary: String
    public var scores: [Int]
    public var gameOver: Bool
    public var gameWinner: Int?

    public init(thrownIn: Bool = false, makerTeam: Int? = nil, made: Int = 0, euchred: Bool = false,
                alone: Bool = false, trump: Suit? = nil, maker: Int? = nil, deltas: [Int] = [0, 0],
                label: String = "", summary: String = "", scores: [Int] = [0, 0],
                gameOver: Bool = false, gameWinner: Int? = nil) {
        self.thrownIn = thrownIn
        self.makerTeam = makerTeam
        self.made = made
        self.euchred = euchred
        self.alone = alone
        self.trump = trump
        self.maker = maker
        self.deltas = deltas
        self.label = label
        self.summary = summary
        self.scores = scores
        self.gameOver = gameOver
        self.gameWinner = gameWinner
    }
}

/// The permanent record of one finished hand, audited the moment it ends.
public struct EuchreHandRecord: Hashable, Sendable {
    public let handNumber: Int
    public let gameNumber: Int
    public let dealer: Int
    public let trump: Suit?
    public let maker: Int?
    public let alone: Bool
    public let sittingOut: Int?
    public let upcard: Card?
    public let turnedDown: Bool
    public let discard: Card?
    public let kitty: [Card]
    public let dealt: [[Card]]
    public let tricks: [EuchreTrick]
    public let tricksWon: [Int]
    public let result: EuchreResult
    public let scores: [Int]
    /// Empty when the accounting check passed.
    public var problems: [String]
}

// MARK: - State

public struct EuchreState: Hashable, Sendable {
    public var phase: EuchrePhase
    public var players: [EuchrePlayer]
    public var config: EuchreConfig
    /// Every engine writes events here and nowhere else.
    public var log: EventLog

    /// Per SIDE, and reset when somebody wins; `gamesWon` is the running match
    /// and is not.
    public var scores: [Int]
    public var gamesWon: [Int]
    public var gameNumber: Int
    public var gameWinner: Int?

    public var dealer: Int?
    public var handNumber: Int
    public var turn: Int
    public var leader: Int

    /// nil during the bidding; every card helper answers sensibly with nil.
    public var trump: Suit?
    public var maker: Int?
    public var alone: Bool
    /// The maker's partner, while somebody plays alone.
    public var sittingOut: Int?

    public var upcard: Card?
    public var upcardStatus: EuchreUpcardStatus
    /// The turned-down suit, which may not be named in round two.
    public var deniedSuit: Suit?
    /// The three face-down leftovers. Nobody sees these until the hand is over.
    public var kitty: [Card]
    /// What the dealer put back. The dealer's business only, until the hand is over.
    public var discard: Card?

    public var trick: [EuchrePlay]
    public var lastTrick: EuchreTrick?
    public var played: [Card]
    public var trickLog: [EuchreTrick]
    public var bidLog: [EuchreBid]

    public var dealt: EuchreDeal?
    public var result: EuchreResult?
    public var history: [EuchreHandRecord]

    public init(players: [EuchrePlayer], config: EuchreConfig) {
        self.phase = .idle
        self.players = players
        self.config = config
        self.log = EventLog()
        self.scores = [0, 0]
        self.gamesWon = [0, 0]
        self.gameNumber = 0
        self.gameWinner = nil
        self.dealer = nil
        self.handNumber = 0
        self.turn = 0
        self.leader = 0
        self.trump = nil
        self.maker = nil
        self.alone = false
        self.sittingOut = nil
        self.upcard = nil
        self.upcardStatus = .none
        self.deniedSuit = nil
        self.kitty = []
        self.discard = nil
        self.trick = []
        self.lastTrick = nil
        self.played = []
        self.trickLog = []
        self.bidLog = []
        self.dealt = nil
        self.result = nil
        self.history = []
    }

    public var gameOver: Bool { phase == .gameOver }
}

// MARK: - Actions

public enum EuchreAction: Hashable, Sendable {
    /// Deal the first hand from `.idle`.
    case start
    /// Round one: take the upcard's suit as trump. The dealer takes the card.
    case orderUp(alone: Bool)
    case pass
    /// Round two: name any suit but the one turned down.
    case callSuit(Suit, alone: Bool)
    /// The dealer puts one card back after taking the upcard.
    case discard(Card)
    case play(Card)
    /// Only when `canDeal`.
    case nextHand
    /// From `.gameOver` back to a fresh idle table, keeping names, config and
    /// the games-won record.
    case newGame
}

// MARK: - The engine

/// The rules — the port of `euchre/js/game.js`.
///
/// Four seats, two fixed partnerships: seats 0 and 2 against seats 1 and 3.
/// That is not configurable and should not become so — the whole shape of the
/// game, from going alone to the scoring table, is built on partners sitting
/// opposite.
public enum EuchreGame {
    public static let seats = 4
    public static let handSize = 5
    public static let kittySize = 3

    public static func teamOf(_ i: Int) -> Int { ((i % seats) + seats) % seats % 2 }
    public static func partnerOf(_ i: Int) -> Int { (i + 2) % seats }

    public static func createGame(_ config: EuchreConfig) -> EuchreState {
        let cfg = EuchreConfig(names: config.names, difficulty: config.difficulty,
                               pointsToWin: config.pointsToWin, stickTheDealer: config.stickTheDealer,
                               allowAlone: config.allowAlone)
        var players: [EuchrePlayer] = []
        for i in 0..<seats {
            players.append(EuchrePlayer(index: i, name: cfg.names[i], occupant: i == 0 ? .human : .bot))
        }
        var s = EuchreState(players: players, config: cfg)
        introduce(&s)
        return s
    }

    /// Who sits where, told to each seat as the game opens.
    static func introduce(_ s: inout EuchreState) {
        for i in 0..<seats {
            let partner = partnerOf(i)
            let others = (0..<seats).filter { teamOf($0) != teamOf(i) }
            s.log.add(.info,
                      "Euchre to \(s.config.pointsToWin) points. You are in seat \(i + 1); " +
                      "\(name(s, partner)) is your partner, across the table. " +
                      "\(name(s, others[0])) and \(name(s, others[1])) are against you.",
                      seat: i, audience: i)
        }
    }

    // MARK: The only way in

    /// Validates the seat, the phase and the action, and refuses with a reason
    /// in the words of the rule. Never traps on bad input.
    public static func applyAction(_ state: inout EuchreState, seat: Int,
                                   action: EuchreAction, rng: inout RandomSource) -> ActionResult {
        guard seat >= 0, seat < state.players.count else { return .refused("not a seat at this table") }

        switch action {
        case .start:
            guard state.phase == .idle else { return .refused("the game has already started") }
            return newHand(&state, rng: &rng)

        case .nextHand:
            if state.phase == .gameOver { return .refused("the game is over — start a new game") }
            guard state.phase == .handOver else { return .refused("the hand is not over") }
            return newHand(&state, rng: &rng)

        case .newGame:
            guard state.phase == .gameOver else { return .refused("the game is not over") }
            newGame(&state)
            return .ok

        case .orderUp(let alone):
            guard state.phase == .bid1 else { return .refused("the upcard is not on offer") }
            guard state.turn == seat else { return .refused("not your turn to bid") }
            return doOrder(&state, seat, alone: alone)

        case .callSuit(let suit, let alone):
            guard state.phase == .bid2 else { return .refused("not the naming round") }
            guard state.turn == seat else { return .refused("not your turn to bid") }
            if suit == state.deniedSuit {
                return .refused("\(suit.lowerName) was turned down and cannot be named this hand")
            }
            return doCall(&state, seat, suit, alone: alone)

        case .pass:
            guard state.phase == .bid1 || state.phase == .bid2 else {
                return .refused("there is nothing to pass on")
            }
            guard state.turn == seat else { return .refused("not your turn to bid") }
            if state.phase == .bid2, seat == state.dealer, state.config.stickTheDealer {
                return .refused("stick the dealer is on, so you must name a suit")
            }
            return doPass(&state, seat)

        case .discard(let card):
            guard state.phase == .discard else { return .refused("nothing to discard") }
            guard seat == state.dealer else { return .refused("only the dealer discards") }
            guard state.players[seat].hand.contains(card) else { return .refused("that card is not in your hand") }
            return doDiscard(&state, seat, card)

        case .play(let card):
            guard state.phase == .play else { return .refused("not the playing phase") }
            if state.sittingOut == seat { return .refused("you are sitting out this hand") }
            guard state.turn == seat else { return .refused("not your turn") }
            if let why = illegalReason(state, seat: seat, card: card) { return .refused(why) }
            return doPlay(&state, seat, card)
        }
    }

    /// Whose move the table is waiting for, or nil if it is waiting for nobody.
    ///
    /// Not simply `state.turn`: the discard belongs to the dealer, who may not
    /// be the seat on turn, and between hands nobody is on move at all.
    public static func seatToAct(_ state: EuchreState) -> Int? {
        switch state.phase {
        case .bid1, .bid2, .play: return state.turn
        case .discard: return state.dealer
        case .idle, .handOver, .gameOver: return nil
        }
    }

    /// Exactly the phases in which `.nextHand` is accepted. idle belongs to
    /// `.start`, and a finished game to `.newGame`.
    public static func canDeal(_ state: EuchreState) -> Bool { state.phase == .handOver }

    /// The cards this seat may play right now; empty if it is not their turn.
    public static func legalPlays(_ state: EuchreState, seat: Int) -> [Card] {
        guard seat >= 0, seat < state.players.count else { return [] }
        guard state.phase == .play, state.turn == seat, state.sittingOut != seat else { return [] }
        return followingPlays(state, seat: seat)
    }

    /// The follow-suit rule on its own, without the turn check: what this seat
    /// could play to the trick as it stands.
    static func followingPlays(_ state: EuchreState, seat: Int) -> [Card] {
        let hand = state.players[seat].hand
        if state.sittingOut == seat { return [] }
        guard let first = state.trick.first else { return hand }
        let led = EuchreCards.effectiveSuit(first.card, trump: state.trump)
        let follow = hand.filter { EuchreCards.effectiveSuit($0, trump: state.trump) == led }
        return follow.isEmpty ? hand : follow
    }

    /// Why a card cannot be played by this seat to the trick as it stands, or
    /// nil if it can. Assumes it is the seat's turn; `whyNot` adds the rest.
    public static func illegalReason(_ state: EuchreState, seat: Int, card: Card) -> String? {
        guard seat >= 0, seat < state.players.count else { return "not a seat at this table" }
        if state.sittingOut == seat { return "you are sitting out this hand" }
        let hand = state.players[seat].hand
        guard hand.contains(card) else { return "that card is not in your hand" }
        guard let first = state.trick.first else { return nil }
        let led = EuchreCards.effectiveSuit(first.card, trump: state.trump)
        if EuchreCards.effectiveSuit(card, trump: state.trump) == led { return nil }
        /* Named precisely, because the left bower is exactly where this goes
         * wrong. "You must follow clubs" while holding the jack of clubs and
         * clubs are not trump is a message that reads as a bug unless it says
         * why. */
        let mine = hand.filter { EuchreCards.effectiveSuit($0, trump: state.trump) == led }
        guard !mine.isEmpty else { return nil }
        let ledWord = led == state.trump ? "trump" : led.lowerName
        return "you must follow \(ledWord) — you hold " + mine.spokenList
    }

    /// Why a card in this seat's hand cannot be played now, or nil if it can.
    /// Never says "not your turn" when it IS your turn — while deciding on a bid
    /// the cards are for review, which is a different thing and worth saying.
    public static func whyNot(_ state: EuchreState, seat: Int, card: Card) -> String? {
        guard seat >= 0, seat < state.players.count else { return "not a seat at this table" }
        switch state.phase {
        case .idle:
            return "no hand has been dealt yet"
        case .bid1, .bid2:
            return state.turn == seat
                ? "for review while you decide your bid"
                : "for review, \(name(state, state.turn)) is bidding"
        case .discard:
            return state.dealer == seat
                ? "for review while you choose what to put back"
                : "for review, \(name(state, state.dealer ?? state.turn)) is putting a card back"
        case .handOver:
            return "the hand is over"
        case .gameOver:
            return "the game is over"
        case .play:
            if state.sittingOut == seat {
                return "you are sitting out while \(name(state, state.maker ?? state.turn)) plays alone"
            }
            if state.turn != seat { return "not your turn, \(name(state, state.turn)) is to play" }
            return illegalReason(state, seat: seat, card: card)
        }
    }

    // MARK: Names and sides

    static func name(_ s: EuchreState, _ i: Int) -> String {
        guard i >= 0, i < s.players.count else { return "the table" }
        return s.players[i].name
    }

    /// Keeps messages grammatical when a player has left their name as "You".
    static func vb(_ s: EuchreState, _ i: Int, _ third: String, _ second: String) -> String {
        guard i >= 0, i < s.players.count else { return third }
        return s.players[i].name.lowercased() == "you" ? second : third
    }

    /// Who a side is, by the names of the two people in it. "Seats 1 and 3" is
    /// accurate and unmemorable; "you and Skipper" is what a player is actually
    /// keeping track of.
    public static func sideWords(_ s: EuchreState, team: Int) -> String {
        (0..<seats).filter { teamOf($0) == team }.map { name(s, $0) }.joined(separator: " and ")
    }

    /// Numbers a screen reader says as words, for the only sentence that says
    /// who won.
    static func pointWords(_ n: Int) -> String {
        let w = ["no points", "one point", "two points", "three points", "four points"]
        return (0..<w.count).contains(n) ? w[n] : "\(n) points"
    }

    // MARK: Seating and turn order

    public static func isActive(_ s: EuchreState, _ i: Int) -> Bool { i != s.sittingOut }

    /// The next seat that is actually holding cards. While somebody plays alone
    /// their partner is skipped entirely — not given an empty turn, skipped.
    public static func nextActive(_ s: EuchreState, _ i: Int) -> Int {
        var j = i
        for _ in 0..<seats {
            j = (j + 1) % seats
            if isActive(s, j) { return j }
        }
        return i
    }

    static func firstActive(_ s: EuchreState, _ i: Int) -> Int { isActive(s, i) ? i : nextActive(s, i) }

    public static func activeCount(_ s: EuchreState) -> Int { s.sittingOut != nil ? seats - 1 : seats }

    // MARK: Dealing

    static func deal(_ s: inout EuchreState, dealer: Int, rng: inout RandomSource) -> Bool {
        let deck = EuchreCards.deck.shuffled(with: &rng)
        for i in 0..<seats { s.players[i].hand = [] }
        /* Three and two, the way it is actually dealt at a table. It makes no
         * difference to a shuffled deck, and it is what somebody learning the
         * game from this program will see described everywhere else. */
        let order = [3, 2]
        var at = 0
        for round in 0..<2 {
            for k in 0..<seats {
                let seat = (dealer + 1 + k) % seats
                let n = order[(round + k) % 2]
                for _ in 0..<n {
                    s.players[seat].hand.append(deck[at])
                    at += 1
                }
            }
        }
        for q in 0..<seats where s.players[q].hand.count != handSize { return false }
        let up = deck[at]
        at += 1
        s.upcard = up
        s.kitty = Array(deck[at..<(at + kittySize)])
        s.dealt = EuchreDeal(hands: s.players.map(\.hand), upcard: up, kitty: s.kitty)
        return true
    }

    static func newHand(_ s: inout EuchreState, rng: inout RandomSource) -> ActionResult {
        if s.gameNumber == 0 { s.gameNumber = 1 }
        let dealer: Int
        if let d = s.dealer { dealer = (d + 1) % seats } else { dealer = rng.nextInt(below: seats) }
        s.dealer = dealer

        s.handNumber += 1
        s.phase = .bid1
        s.trump = nil
        s.maker = nil
        s.alone = false
        s.sittingOut = nil
        s.upcardStatus = .up
        s.deniedSuit = nil
        s.discard = nil
        s.trick = []
        s.lastTrick = nil
        s.played = []
        s.trickLog = []
        s.bidLog = []
        s.result = nil
        for i in 0..<seats { s.players[i].tricksWon = 0 }

        guard deal(&s, dealer: dealer, rng: &rng), let up = s.upcard else {
            return .faulted("the deal did not give everybody five cards")
        }

        s.leader = (dealer + 1) % seats
        s.turn = s.leader

        s.log.add(.deal,
                  "Hand \(s.handNumber). \(name(s, dealer))\(vb(s, dealer, " deals", " deal")). " +
                  "The upcard is the \(up.name). \(name(s, s.turn))\(vb(s, s.turn, " bids", " bid")) first.",
                  seat: dealer, cards: [up])

        /* Each seat is told its own cards, privately. One event per seat means
         * every seat gets exactly one, so the shape of the log gives nothing
         * away either. */
        for i in 0..<seats {
            let sorted = EuchreCards.sortHand(s.players[i].hand, trump: nil)
            s.log.add(.you, "Your hand: " + sorted.map(\.name).joined(separator: ", ") + ".",
                      seat: i, cards: sorted, audience: i)
        }
        return .ok
    }

    /// A finished game starts a fresh one rather than continuing past the
    /// target. Scores go back to nothing; the match record does not, and the
    /// deal keeps rotating.
    static func newGame(_ s: inout EuchreState) {
        s.scores = [0, 0]
        s.gameWinner = nil
        s.handNumber = 0
        s.gameNumber += 1
        s.phase = .idle
        s.trump = nil
        s.maker = nil
        s.alone = false
        s.sittingOut = nil
        s.upcard = nil
        s.upcardStatus = .none
        s.deniedSuit = nil
        s.kitty = []
        s.discard = nil
        s.trick = []
        s.lastTrick = nil
        s.played = []
        s.trickLog = []
        s.bidLog = []
        s.dealt = nil
        s.result = nil
        for i in 0..<seats {
            s.players[i].hand = []
            s.players[i].tricksWon = 0
        }
        s.log.add(.game, "A new game, to \(s.config.pointsToWin) points. Games won: " +
                  "\(sideWords(s, team: 0)) \(s.gamesWon[0]), \(sideWords(s, team: 1)) \(s.gamesWon[1]).")
    }

    // MARK: Bidding

    static func beginPlay(_ s: inout EuchreState) {
        s.phase = .play
        s.leader = firstActive(s, ((s.dealer ?? 0) + 1) % seats)
        s.turn = s.leader
        s.trick = []
        s.log.add(.info, "\(name(s, s.leader))\(vb(s, s.leader, " leads", " lead")) to the first trick.",
                  seat: s.leader)
    }

    /// Somebody has decided what trump is. The one place that happens, so the
    /// "going alone" bookkeeping cannot end up done twice or not at all.
    static func makeTrump(_ s: inout EuchreState, _ p: Int, _ suit: Suit, alone: Bool,
                          how: String, kind: EuchreBid.Kind, round: Int) {
        s.trump = suit
        s.maker = p
        s.alone = alone && s.config.allowAlone

        var msg = "\(name(s, p)) \(how). \(suit.name) are trump."
        if s.alone {
            let out = partnerOf(p)
            s.sittingOut = out
            msg += " \(name(s, p))\(vb(s, p, " is", " are")) going alone, so " +
                "\(name(s, out))\(vb(s, out, " sits", " sit")) out this hand."
        }
        s.log.add(.bid, msg, seat: p)
        s.bidLog.append(EuchreBid(player: p, kind: kind, round: round, suit: suit, alone: s.alone, words: how))

        /* Everybody is told what the left bower now is, because it has changed
         * which suit two cards belong to and that is the single commonest way
         * to lose a trick you meant to win. */
        s.log.add(.info,
                  "The right bower is the Jack of \(suit.name); the left bower is the Jack of " +
                  "\(suit.sameColour.name), which counts as \(suit.lowerName) for this hand.",
                  cards: [Card(.jack, suit), Card(.jack, suit.sameColour)])
    }

    /// Round one: take the upcard, which makes its suit trump and hands the
    /// card to the dealer.
    static func doOrder(_ s: inout EuchreState, _ p: Int, alone: Bool) -> ActionResult {
        guard let dealer = s.dealer, let up = s.upcard else { return .faulted("no upcard to order up") }
        let how = p == dealer ? "takes it up"
            : p == partnerOf(dealer) ? "orders it up for \(name(s, dealer))"
            : "orders it up"
        makeTrump(&s, p, up.suit, alone: alone, how: how, kind: .orderUp, round: 1)

        /* The dealer takes the upcard whoever ordered it. Even when the dealer
         * is sitting out because their partner went alone — they still pick up
         * and discard, which is the rule most often got wrong. */
        s.players[dealer].hand.append(up)
        s.log.add(.info, "\(name(s, dealer))\(vb(s, dealer, " takes", " take")) the \(up.name) and must discard.",
                  seat: dealer, cards: [up])
        s.log.add(.you, "You took the \(up.name). Choose a card to put back — you have six and may keep only five.",
                  seat: dealer, cards: [up], audience: dealer)
        s.upcardStatus = .taken
        s.phase = .discard
        s.turn = dealer
        return .ok
    }

    /// Round two: name any suit but the one that was turned down.
    static func doCall(_ s: inout EuchreState, _ p: Int, _ suit: Suit, alone: Bool) -> ActionResult {
        makeTrump(&s, p, suit, alone: alone, how: "names \(suit.lowerName)", kind: .call, round: 2)
        beginPlay(&s)
        return .ok
    }

    static func doPass(_ s: inout EuchreState, _ p: Int) -> ActionResult {
        guard let dealer = s.dealer, let up = s.upcard else { return .faulted("no hand in progress") }
        let round = s.phase == .bid1 ? 1 : 2
        s.bidLog.append(EuchreBid(player: p, kind: .pass, round: round, words: "pass"))
        s.log.add(.bid, "\(name(s, p))\(vb(s, p, " passes", " pass")).", seat: p)

        if p != dealer {
            s.turn = (p + 1) % seats
            return .ok
        }

        if s.phase == .bid1 {
            s.phase = .bid2
            s.upcardStatus = .turnedDown
            s.deniedSuit = up.suit
            s.turn = (dealer + 1) % seats
            s.log.add(.info,
                      "Everybody passed. The \(up.name) is turned down, so \(up.suit.lowerName) cannot be named. " +
                      "\(name(s, s.turn)) may name any other suit, or pass." +
                      (s.config.stickTheDealer ? " The dealer must name a suit if it comes round to them." : ""),
                      cards: [up])
            return .ok
        }

        // Round two, everybody passed, and the dealer was allowed to.
        s.phase = .handOver
        s.result = EuchreResult(thrownIn: true, deltas: [0, 0], label: "thrown in",
                                summary: "Everybody passed twice. The hand is thrown in and nobody scores.",
                                scores: s.scores)
        s.log.add(.hand, "Everybody passed twice. The hand is thrown in and nobody scores. " +
                  "\(name(s, (dealer + 1) % seats)) deals the next one.")
        recordHand(&s)
        return .ok
    }

    /// The dealer puts one card back after taking the upcard.
    static func doDiscard(_ s: inout EuchreState, _ p: Int, _ card: Card) -> ActionResult {
        guard s.players[p].hand.count == handSize + 1 else {
            return .faulted("the dealer holds \(s.players[p].hand.count) cards, not six")
        }
        s.players[p].hand = s.players[p].hand.removing(card)
        s.discard = card
        /* Public that it happened, private what it was. Everybody at a real
         * table watches the dealer put a card back and nobody sees which. */
        s.log.add(.info, "\(name(s, p))\(vb(s, p, " discards", " discard")) a card face down.", seat: p)
        s.log.add(.you, "You put back the \(card.name).", seat: p, cards: [card], audience: p)
        beginPlay(&s)
        return .ok
    }

    // MARK: Playing

    public static func trickWinnerIndex(_ plays: [EuchrePlay], trump: Suit?) -> Int {
        var best = 0
        if plays.isEmpty { return 0 }
        for i in 1..<plays.count where EuchreCards.beats(plays[i].card, plays[best].card, trump: trump) {
            best = i
        }
        return best
    }

    static func doPlay(_ s: inout EuchreState, _ p: Int, _ card: Card) -> ActionResult {
        s.players[p].hand = s.players[p].hand.removing(card)
        s.trick.append(EuchrePlay(player: p, card: card))
        s.played.append(card)

        s.log.add(.play, "\(name(s, p))\(vb(s, p, " plays", " play")) the \(EuchreCards.describe(card, trump: s.trump)).",
                  seat: p, cards: [card])

        if s.trick.count == activeCount(s) {
            resolveTrick(&s)
            return .ok
        }
        s.turn = nextActive(s, p)
        return .ok
    }

    static func resolveTrick(_ s: inout EuchreState) {
        let wi = trickWinnerIndex(s.trick, trump: s.trump)
        let winner = s.trick[wi].player
        s.players[winner].tricksWon += 1
        let number = s.trickLog.count + 1
        let done = EuchreTrick(number: number, plays: s.trick, winner: winner)
        s.lastTrick = done
        s.trickLog.append(done)

        s.log.add(.trick, "\(name(s, winner))\(vb(s, winner, " takes", " take")) trick \(number) with the " +
                  "\(EuchreCards.describe(s.trick[wi].card, trump: s.trump)).",
                  seat: winner, cards: [s.trick[wi].card])

        s.trick = []
        if s.trickLog.count == handSize {
            endHand(&s)
            return
        }
        s.leader = winner
        s.turn = winner
    }

    // MARK: Scoring

    /// The whole scoring table, written out rather than computed:
    ///
    ///   makers take 3 or 4                        1
    ///   makers take all 5                         2
    ///   makers take all 5, playing alone          4
    ///   makers take 3 or 4, playing alone         1
    ///   makers take fewer than 3 — euchred        2, to the other side
    ///
    /// Returns (to the makers, to the other side).
    public static func scoreTable(made: Int, alone: Bool) -> (makers: Int, others: Int) {
        if made >= 3 {
            return (made == handSize ? (alone ? 4 : 2) : 1, 0)
        }
        return (0, 2)
    }

    static func scoreHand(_ s: EuchreState) -> EuchreResult {
        let maker = s.maker ?? 0
        let makerTeam = teamOf(maker)
        let made = (0..<seats).filter { teamOf($0) == makerTeam }.reduce(0) { $0 + s.players[$1].tricksWon }

        var deltas = [0, 0]
        let label: String
        var euchred = false
        let table = scoreTable(made: made, alone: s.alone)
        if made >= 3 {
            deltas[makerTeam] = table.makers
            label = made == handSize
                ? (s.alone ? "a march, alone — four" : "a march — two")
                : "made it with \(made) — one"
        } else {
            euchred = true
            deltas[1 - makerTeam] = table.others
            label = "euchred — two to the other side"
        }
        return EuchreResult(thrownIn: false, makerTeam: makerTeam, made: made, euchred: euchred,
                            alone: s.alone, trump: s.trump, maker: maker, deltas: deltas, label: label)
    }

    static func endHand(_ s: inout EuchreState) {
        var r = scoreHand(s)
        s.scores[0] += r.deltas[0]
        s.scores[1] += r.deltas[1]

        let target = s.config.pointsToWin
        var winSide: Int? = nil
        if s.scores[0] >= target, s.scores[0] > s.scores[1] { winSide = 0 }
        else if s.scores[1] >= target, s.scores[1] > s.scores[0] { winSide = 1 }
        else if s.scores[0] >= target, s.scores[1] >= target {
            /* Both over the line at once cannot happen — only one side scores
             * on a hand — but if it ever does, the higher score wins. */
            winSide = s.scores[0] >= s.scores[1] ? 0 : 1
        }

        let maker = r.maker ?? 0
        let makerTeam = r.makerTeam ?? 0
        let trumpWord = s.trump?.lowerName ?? "trump"
        var summary = "\(name(s, maker))\(vb(s, maker, " made", " made")) \(trumpWord)" +
            (s.alone ? " alone" : "") + " and took \(r.made)" + (r.made == 1 ? " trick" : " tricks") + ". "
        if r.euchred {
            summary += "\(name(s, maker))\(vb(s, maker, " was", " were")) euchred: two points to " +
                "\(sideWords(s, team: 1 - makerTeam))."
        } else {
            summary += "\(pointWords(r.deltas[makerTeam])) to \(sideWords(s, team: makerTeam))."
        }
        summary += " Score: \(sideWords(s, team: 0)) \(s.scores[0]), \(sideWords(s, team: 1)) \(s.scores[1])."

        r.summary = summary
        r.scores = s.scores
        s.result = r
        s.phase = .handOver

        s.log.add(.hand, summary, seat: maker)

        if let win = winSide {
            s.phase = .gameOver
            s.gameWinner = win
            s.gamesWon[win] += 1
            s.result?.gameOver = true
            s.result?.gameWinner = win
            s.log.add(.game,
                      "\(sideWords(s, team: win)) win game \(s.gameNumber), \(s.scores[win]) to \(s.scores[1 - win]). " +
                      "Games: \(sideWords(s, team: 0)) \(s.gamesWon[0]), \(sideWords(s, team: 1)) \(s.gamesWon[1]). " +
                      "Start a new game to play another.")
        }
        recordHand(&s)
    }

    // MARK: The permanent record

    static func recordHand(_ s: inout EuchreState) {
        guard let result = s.result else { return }
        var rec = EuchreHandRecord(
            handNumber: s.handNumber,
            gameNumber: s.gameNumber,
            dealer: s.dealer ?? 0,
            trump: s.trump,
            maker: s.maker,
            alone: s.alone,
            sittingOut: s.sittingOut,
            upcard: s.dealt?.upcard,
            turnedDown: s.upcardStatus == .turnedDown,
            discard: s.discard,
            kitty: s.dealt?.kitty ?? [],
            dealt: s.dealt?.hands ?? [],
            tricks: s.trickLog,
            tricksWon: s.players.map(\.tricksWon),
            result: result,
            scores: s.scores,
            problems: [])
        rec.problems = auditHand(rec)
        if !rec.problems.isEmpty {
            s.log.add(.info, "Accounting check failed on hand \(rec.handNumber): " +
                      rec.problems.joined(separator: "; ") + ".")
        }
        s.history.append(rec)
    }

    /// Re-derive the hand from the cards rather than trusting the running
    /// totals. The point of an audit is that it must be able to disagree with
    /// the thing it is auditing.
    public static func auditHand(_ rec: EuchreHandRecord) -> [String] {
        var bad: [String] = []

        if rec.result.thrownIn {
            if !rec.tricks.isEmpty { bad.append("a thrown-in hand recorded \(rec.tricks.count) tricks") }
            if rec.result.deltas[0] != 0 || rec.result.deltas[1] != 0 { bad.append("a thrown-in hand scored") }
            return bad
        }

        if rec.tricks.count != handSize {
            bad.append("recorded \(rec.tricks.count) tricks instead of \(handSize)")
        }

        var seen = Set<Card>()
        var dup = 0, total = 0
        let expectPerTrick = rec.sittingOut != nil ? seats - 1 : seats
        for t in rec.tricks {
            if t.plays.count != expectPerTrick {
                bad.append("trick \(t.number) has \(t.plays.count) cards, expected \(expectPerTrick)")
            }
            for pl in t.plays {
                total += 1
                if seen.contains(pl.card) { dup += 1 }
                seen.insert(pl.card)
                if pl.player == rec.sittingOut { bad.append("a seat that was sitting out played a card") }
            }
        }
        if dup > 0 { bad.append("\(dup) card" + (dup == 1 ? " was" : "s were") + " played more than once") }
        if total != handSize * expectPerTrick {
            bad.append("\(total) cards played, expected \(handSize * expectPerTrick)")
        }

        // The deal must be a subset of the deck with nothing repeated.
        var dealtSeen = Set<Card>()
        var dealtDup = 0, dealtCount = 0
        let deckSet = Set(EuchreCards.deck)
        for h in rec.dealt {
            for c in h {
                dealtCount += 1
                if dealtSeen.contains(c) { dealtDup += 1 }
                dealtSeen.insert(c)
                if !deckSet.contains(c) { bad.append("\(c.id) is not a card in the deck") }
            }
        }
        for c in rec.kitty {
            dealtCount += 1
            if dealtSeen.contains(c) { dealtDup += 1 }
            dealtSeen.insert(c)
        }
        if let up = rec.upcard {
            dealtCount += 1
            if dealtSeen.contains(up) { dealtDup += 1 }
            dealtSeen.insert(up)
        }
        if dealtDup > 0 { bad.append("\(dealtDup) card" + (dealtDup == 1 ? "" : "s") + " dealt twice") }
        if dealtCount != EuchreCards.deckSize {
            bad.append("the deal accounts for \(dealtCount) cards, not \(EuchreCards.deckSize)")
        }

        // Trick counts must match who actually took them.
        var counted = [Int](repeating: 0, count: seats)
        for t in rec.tricks where t.winner >= 0 && t.winner < seats { counted[t.winner] += 1 }
        for i in 0..<seats where i < rec.tricksWon.count && counted[i] != rec.tricksWon[i] {
            bad.append("seat \(i + 1) is credited with \(rec.tricksWon[i]) tricks but took \(counted[i])")
        }
        let sum = counted.reduce(0, +)
        if sum != handSize { bad.append("tricks taken total \(sum) instead of \(handSize)") }

        // And the score must follow from those tricks, re-derived from the table.
        if let maker = rec.maker {
            let mt = teamOf(maker)
            let made = (0..<seats).filter { teamOf($0) == mt }.reduce(0) { $0 + counted[$1] }
            var want = [0, 0]
            let table = scoreTable(made: made, alone: rec.alone)
            if made >= 3 { want[mt] = table.makers } else { want[1 - mt] = table.others }
            if want != rec.result.deltas {
                bad.append("the score change was \(rec.result.deltas.map(String.init).joined(separator: "/")) " +
                           "but the tricks give \(want.map(String.init).joined(separator: "/"))")
            }
            if want[0] != 0 && want[1] != 0 { bad.append("both sides scored on one hand") }
        }
        return bad
    }
}

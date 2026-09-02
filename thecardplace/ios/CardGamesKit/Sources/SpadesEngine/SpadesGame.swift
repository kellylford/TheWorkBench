import CardCore

// The rules of spades, and the only door into them — the port of
// `spades/js/game.js`.
//
// Four players in two fixed partnerships: seats 0 and 2 against seats 1 and 3.
// Thirteen tricks a hand, spades always trump. Everybody bids the number of
// tricks they expect to take, and a partnership either makes what the two of
// them promised between them or loses it all.
//
// The four rules that are actually the game:
//
// 1. THE BID IS A PARTNERSHIP CONTRACT, not a personal one. Two bids are added
//    together and the pair is judged on the total.
// 2. MISSING THE CONTRACT COSTS THE WHOLE BID. Not the difference.
// 3. OVERTRICKS ARE WORTH ONE POINT AND ARE A LIABILITY. Each is a bag; ten
//    bags costs a hundred points.
// 4. NIL. A bid of zero, scored on its own: a hundred if that player takes no
//    trick, minus a hundred if they take one. A failed nil's tricks still count
//    towards the partner's contract.

/// The rules this table plays by. Every default matches the web settings
/// dialog; the web offers 250 or 500 points, and the other three numbers are
/// the constants `game.js` names as defaults.
public struct SpadesConfig: Codable, Hashable, Sendable {
    public var names: [String]
    /// Carried for the shared contract. `ai.js` never reads it — the web
    /// passes 'hard' unconditionally and has no control for it — so every
    /// level plays the same game.
    public var difficulty: Difficulty
    public var pointsToWin: Int
    /// Bags per penalty.
    public var bagLimit: Int
    /// What a full bag bin costs. Zero is a coherent choice: count the bags,
    /// do not punish them.
    public var bagPenalty: Int
    public var nilValue: Int

    public static let defaultNames = ["You", "East", "South", "West"]

    public init(names: [String] = SpadesConfig.defaultNames,
                difficulty: Difficulty = .normal,
                pointsToWin: Int = 500,
                bagLimit: Int = 10,
                bagPenalty: Int = 100,
                nilValue: Int = 100) {
        self.names = names
        self.difficulty = difficulty
        self.pointsToWin = pointsToWin
        self.bagLimit = bagLimit
        self.bagPenalty = bagPenalty
        self.nilValue = nilValue
    }
}

public struct SpadesPlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant
    public var hand: [Card]
    /// Nil until this seat has bid. Not zero — zero is a nil bid, which is a
    /// real and very consequential bid.
    public var bid: Int?
    public var tricks: Int

    /// Seats 0 and 2 are team 0; seats 1 and 3 are team 1.
    public var team: Int { SpadesGame.teamOf(index) }

    public init(index: Int, name: String, occupant: Occupant, hand: [Card] = [], bid: Int? = nil, tricks: Int = 0) {
        self.index = index
        self.name = name
        self.occupant = occupant
        self.hand = hand
        self.bid = bid
        self.tricks = tricks
    }
}

public enum SpadesPhase: String, Hashable, Sendable {
    case idle, bidding, play, handOver, gameOver
}

/// One card on the table and who put it there.
public struct SpadesPlay: Hashable, Sendable {
    public let seat: Int
    public let card: Card
    public init(seat: Int, card: Card) {
        self.seat = seat
        self.card = card
    }
}

/// The trick that has just gone: its four cards, and who took it.
public struct SpadesCompletedTrick: Hashable, Sendable {
    public let cards: [SpadesPlay]
    public let winner: Int
    public init(cards: [SpadesPlay], winner: Int) {
        self.cards = cards
        self.winner = winner
    }
}

/// One finished hand, as the history table shows it. Bids and tricks are by
/// seat; delta, scores and bags are by team.
public struct SpadesHandRecord: Hashable, Sendable {
    public let deal: Int
    public let dealer: Int
    public let bids: [Int]
    public let tricks: [Int]
    public let delta: [Int]
    public let scores: [Int]
    public let bags: [Int]
}

/// How one seat's nil came out.
public struct SpadesNilResult: Hashable, Sendable {
    public let seat: Int
    public let made: Bool
    public let tricks: Int
}

/// One partnership's share of a hand's score, term by term, so the interface
/// can explain a score without recomputing it a second way.
public struct SpadesTeamScore: Hashable, Sendable {
    public let team: Int
    public let contract: Int
    public let took: Int
    public let nils: [SpadesNilResult]
    public let made: Bool
    public let base: Int
    public let overtricks: Int
    public let nilPoints: Int
    public let bagPenalty: Int
}

/// What a hand was worth: per-team deltas, the new bag counts, and the detail.
public struct SpadesHandScore: Hashable, Sendable {
    public let delta: [Int]
    public let bags: [Int]
    public let detail: [SpadesTeamScore]
}

public struct SpadesState: Hashable, Sendable {
    public var phase: SpadesPhase
    public var players: [SpadesPlayer]
    public var config: SpadesConfig
    /// Every engine writes events here and nowhere else.
    public var log: EventLog

    /// Nil until the first hand is dealt; the very first dealer is drawn.
    public var dealer: Int?
    public var dealNumber: Int
    public var turn: Int
    public var leader: Int

    public var trick: [SpadesPlay]
    public var tricksPlayed: Int
    public var spadesBroken: Bool
    public var lastTrick: SpadesCompletedTrick?
    /// Every card that has reached the table this hand, in the order played.
    /// Public information — every card is played face up — kept for the
    /// review text. The computer players deliberately do not read it: `ai.js`
    /// tracks only the current trick and the last one, and the port keeps that
    /// weaker memory so the bots play the game the web bots play.
    public var playedThisHand: [Card]

    /// Per TEAM, not per player, because the contract is the partnership's.
    public var scores: [Int]
    public var bags: [Int]

    public var history: [SpadesHandRecord]
    /// The winning team, or nil for nobody yet.
    public var winner: Int?
}

public enum SpadesAction: Hashable, Sendable {
    /// Deal the first hand from `.idle`.
    case start
    /// Zero is nil, exactly as `game.js` represents it.
    case bid(Int)
    case play(Card)
    /// Only when `canDeal(state)`.
    case nextHand
    /// Back to a fresh `.idle`, keeping the names and the rules.
    case newGame

    /// The nil bid, spelled out.
    public static var nilBid: SpadesAction { .bid(0) }
}

public enum SpadesGame {
    public static let seats = 4
    public static let handSize = 13
    public static let teams = 2

    /// Defaults, and only defaults. What a given table plays by is in config.
    public static let defaultTarget = 500
    public static let defaultBagLimit = 10
    public static let defaultBagPenalty = 100
    public static let defaultNilValue = 100

    /// Seats 0 and 2 against 1 and 3. Sitting opposite your partner is the
    /// definition here — everything from the play order to the scoring
    /// assumes it.
    public static func teamOf(_ seat: Int) -> Int { seat % teams }
    public static func partnerOf(_ seat: Int) -> Int { (seat + 2) % seats }

    // MARK: - The rules this table plays by

    // Read from config every time they are needed, and a nonsense number falls
    // back to the default — the same guard `ruleNumber` gives the web.

    public static func target(of state: SpadesState) -> Int {
        state.config.pointsToWin > 0 ? state.config.pointsToWin : defaultTarget
    }
    public static func bagLimit(of state: SpadesState) -> Int {
        state.config.bagLimit > 0 ? state.config.bagLimit : defaultBagLimit
    }
    /// Zero is allowed: a table that counts bags but does not punish them.
    public static func bagPenalty(of state: SpadesState) -> Int {
        state.config.bagPenalty >= 0 ? state.config.bagPenalty : defaultBagPenalty
    }
    public static func nilValue(of state: SpadesState) -> Int {
        state.config.nilValue > 0 ? state.config.nilValue : defaultNilValue
    }

    // MARK: - Creating a game

    public static func createGame(_ config: SpadesConfig) -> SpadesState {
        var players: [SpadesPlayer] = []
        for i in 0..<seats {
            let name = i < config.names.count && !config.names[i].isEmpty
                ? config.names[i] : SpadesConfig.defaultNames[i]
            players.append(SpadesPlayer(index: i, name: name, occupant: i == 0 ? .human : .bot))
        }
        return SpadesState(
            phase: .idle, players: players, config: config, log: EventLog(),
            dealer: nil, dealNumber: 0, turn: 0, leader: 0,
            trick: [], tricksPlayed: 0, spadesBroken: false, lastTrick: nil, playedThisHand: [],
            scores: [0, 0], bags: [0, 0], history: [], winner: nil)
    }

    // MARK: - Prose helpers

    /// A seat's name, for a sentence.
    public static func vb(_ state: SpadesState, _ seat: Int) -> String {
        seat >= 0 && seat < state.players.count ? state.players[seat].name : "seat \(seat)"
    }

    /// "You and South" — a partnership named by its people rather than a
    /// number.
    public static func teamName(_ state: SpadesState, _ team: Int) -> String {
        (0..<seats).filter { teamOf($0) == team }.map { vb(state, $0) }.joined(separator: " and ")
    }

    /// The partnership's contract: the two bids added together, counting only
    /// seats that have bid.
    public static func contractOf(_ state: SpadesState, team: Int) -> Int {
        var n = 0
        for i in 0..<seats where teamOf(i) == team {
            if let b = state.players[i].bid { n += b }
        }
        return n
    }

    /// The tricks the partnership has taken this hand.
    public static func tricksOf(_ state: SpadesState, team: Int) -> Int {
        var n = 0
        for i in 0..<seats where teamOf(i) == team { n += state.players[i].tricks }
        return n
    }

    // MARK: - Dealing

    private static func newHand(_ state: inout SpadesState, rng: inout RandomSource) {
        let deck = SpadesCards.newDeck().shuffled(with: &rng)
        for i in 0..<seats {
            state.players[i].hand = SpadesCards.sortHand(Array(deck[(i * handSize)..<((i + 1) * handSize)]))
            state.players[i].bid = nil
            state.players[i].tricks = 0
        }

        state.dealNumber += 1
        // The very first dealer is drawn at random, then the deal rotates. The
        // dealer bids last, which is the only positional advantage in the game.
        // Drawn from the same generator as the shuffle, after it, so the hands
        // a given seed produces do not move.
        if let d = state.dealer {
            state.dealer = (d + 1) % seats
        } else {
            state.dealer = rng.nextInt(below: seats)
        }
        state.trick = []
        state.tricksPlayed = 0
        state.spadesBroken = false
        state.lastTrick = nil
        state.playedThisHand = []

        // Bidding starts to the dealer's left and goes once around.
        state.phase = .bidding
        state.leader = (state.dealer! + 1) % seats
        state.turn = state.leader

        state.log.add(.deal, "Hand \(state.dealNumber) dealt. \(vb(state, state.dealer!)) dealt; \(vb(state, state.turn)) bids first.",
                      seat: state.dealer)
    }

    /// EXACTLY the phases applyAction accepts a nextHand in. Idle belongs to
    /// the start action.
    public static func canDeal(_ state: SpadesState) -> Bool {
        state.phase == .handOver
    }

    // MARK: - Bidding

    /// Every bid this seat may make: zero through thirteen, always.
    public static func legalBids(_ state: SpadesState, seat: Int) -> [Int] {
        guard state.phase == .bidding, state.turn == seat else { return [] }
        return Array(0...handSize)
    }

    private static func doBid(_ state: inout SpadesState, seat: Int, _ n: Int) -> ActionResult {
        if state.phase != .bidding { return .refused("nobody is bidding") }
        if state.turn != seat { return .refused("not your turn to bid") }
        if n < 0 || n > handSize { return .refused("a bid is a whole number from zero to \(handSize)") }
        if state.players[seat].bid != nil { return .refused("you have already bid") }

        state.players[seat].bid = n
        state.log.add(.bid, "\(vb(state, seat)) bid \(n == 0 ? "nil" : String(n)).", seat: seat)

        // Round the table once, then play. Counting the bids in rather than
        // counting seats round means an engine that somehow bid twice for one
        // seat stops here instead of dealing a hand nobody bid on.
        if state.players.allSatisfy({ $0.bid != nil }) {
            beginPlay(&state)
            return .ok
        }
        state.turn = (state.turn + 1) % seats
        return .ok
    }

    private static func beginPlay(_ state: inout SpadesState) {
        state.phase = .play
        state.leader = ((state.dealer ?? -1) + 1) % seats
        state.turn = state.leader
        state.trick = []

        let t0 = contractOf(state, team: 0), t1 = contractOf(state, team: 1)
        state.log.add(.info, "Bidding is done. \(teamName(state, 0)) for \(t0), \(teamName(state, 1)) for \(t1). "
                      + tableShape(t0 + t1) + " \(vb(state, state.leader)) leads.")
    }

    /// Said out loud because it is the single most useful fact about the hand
    /// about to be played: over is a scramble, under means tricks are going
    /// begging.
    static func tableShape(_ total: Int) -> String {
        if total > handSize { return "That is \(total - handSize) over the \(handSize) available." }
        if total < handSize { return "That leaves \(handSize - total) spare." }
        return "Exactly \(handSize) bid."
    }

    // MARK: - Play

    /// Which cards this seat may legally play right now. Two rules, and both
    /// yield rather than deadlock: follow the suit led if you hold it, and do
    /// not LEAD a spade until spades are broken unless spades are all you have.
    public static func legalPlays(_ state: SpadesState, seat: Int) -> [Card] {
        guard state.phase == .play, state.turn == seat, seat >= 0, seat < state.players.count else { return [] }
        let hand = state.players[seat].hand
        if hand.isEmpty { return [] }

        if state.trick.isEmpty {
            if state.spadesBroken { return hand }
            let notTrump = hand.filter { !SpadesCards.isTrump($0) }
            return notTrump.isEmpty ? hand : notTrump
        }

        let led = state.trick[0].card.suit
        let follow = hand.filter { $0.suit == led }
        // Void in the led suit: anything, and that explicitly includes
        // trumping in.
        return follow.isEmpty ? hand : follow
    }

    /// Why a card cannot be played now, in the words of the rule, or nil if it
    /// can. A card the seat does not hold gets one fixed answer whatever
    /// anybody else holds, so the refusals are not an oracle for the other
    /// three hands.
    public static func whyNot(_ state: SpadesState, seat: Int, card: Card) -> String? {
        guard seat >= 0, seat < state.players.count else { return "not a seat at this table" }
        if state.phase != .play { return "no trick is in progress" }
        if state.turn != seat { return "not your turn" }
        if legalPlays(state, seat: seat).contains(card) { return nil }
        if !state.players[seat].hand.contains(card) { return "you do not hold that card" }
        return ruleStopping(state, seat: seat, card: card)
    }

    /// The `whyNot` of `game.js`: only ever asked about a card the seat holds.
    private static func ruleStopping(_ state: SpadesState, seat: Int, card: Card) -> String {
        if state.trick.isEmpty {
            if SpadesCards.isTrump(card) && !state.spadesBroken { return "spades have not been broken" }
            return "not a legal card here"
        }
        let led = state.trick[0].card.suit
        let canFollow = state.players[seat].hand.contains { $0.suit == led }
        if canFollow && card.suit != led { return "you must follow \(led.lowerName)" }
        return "not a legal card here"
    }

    private static func doPlay(_ state: inout SpadesState, seat: Int, _ card: Card) -> ActionResult {
        if state.phase != .play { return .refused("no trick is in progress") }
        if state.turn != seat { return .refused("not your turn") }

        let legal = legalPlays(state, seat: seat)
        if !legal.contains(card) {
            let held = state.players[seat].hand.contains(card)
            return .refused(held ? ruleStopping(state, seat: seat, card: card) : "you do not hold that card")
        }

        state.players[seat].hand = state.players[seat].hand.removing(card)

        // ANY spade reaching the table breaks them — including one LED by a
        // player holding nothing else. Checked before the card joins the trick.
        if SpadesCards.isTrump(card) && !state.spadesBroken {
            state.spadesBroken = true
            state.log.add(.info, "Spades are broken.")
        }

        state.trick.append(SpadesPlay(seat: seat, card: card))
        state.playedThisHand.append(card)

        state.log.add(.play, "\(vb(state, seat)) played the \(card.name).", seat: seat, cards: [card])

        if state.trick.count == seats { return finishTrick(&state) }

        state.turn = (state.turn + 1) % seats
        return .ok
    }

    /// Who takes these cards: the first card, unless something later beats it.
    public static func trickWinner(_ plays: [SpadesPlay]) -> SpadesPlay? {
        guard var best = plays.first else { return nil }
        for p in plays.dropFirst() where SpadesCards.beats(p.card, best.card) { best = p }
        return best
    }

    private static func finishTrick(_ state: inout SpadesState) -> ActionResult {
        guard let best = trickWinner(state.trick), state.trick.count == seats else {
            return .faulted("the game hit a fault and cannot continue")
        }

        state.players[best.seat].tricks += 1
        state.lastTrick = SpadesCompletedTrick(cards: state.trick, winner: best.seat)
        state.tricksPlayed += 1

        state.log.add(.trick, "\(vb(state, best.seat)) took the trick with the \(best.card.name).",
                      seat: best.seat, cards: [best.card])

        // A nil going down is the loudest thing that happens in this game and
        // it happens silently otherwise. Said the moment it is certain.
        if state.players[best.seat].bid == 0 && state.players[best.seat].tricks == 1 {
            state.log.add(.bid, "\(vb(state, best.seat)) bid nil and has taken a trick.", seat: best.seat)
        }

        state.trick = []
        state.leader = best.seat
        state.turn = best.seat

        if state.tricksPlayed == handSize { return finishHand(&state) }
        return .ok
    }

    // MARK: - Scoring

    /// A pure function of a hand's bids and tricks, so the oracle can check it
    /// against worked examples without playing a hand to get there.
    ///
    /// - bids: four bids, by seat (zero is nil)
    /// - tricks: four trick counts, by seat
    /// - bagsIn: the two bag counts BEFORE this hand
    public static func scoreHand(bids: [Int], tricks: [Int], bagsIn: [Int],
                                 bagLimit: Int, bagPenalty: Int, nilValue: Int) -> SpadesHandScore {
        var delta = [0, 0]
        var bags = [bagsIn.count > 0 ? bagsIn[0] : 0, bagsIn.count > 1 ? bagsIn[1] : 0]
        var detail: [SpadesTeamScore] = []

        for team in 0..<teams {
            var contract = 0, took = 0
            var nils: [SpadesNilResult] = []
            for i in 0..<seats where teamOf(i) == team {
                let b = i < bids.count ? bids[i] : 0
                let t = i < tricks.count ? tricks[i] : 0
                contract += b
                took += t
                if b == 0 { nils.append(SpadesNilResult(seat: i, made: t == 0, tricks: t)) }
            }

            // Rule 2: the whole contract, not the difference. A contract of
            // zero — both partners nil — is made by definition.
            let made = took >= contract
            let base = made ? 10 * contract : -10 * contract
            let overtricks = made ? took - contract : 0

            // Rule 4: nil is its own bet, settled separately.
            var nilPoints = 0
            for n in nils { nilPoints += n.made ? nilValue : -nilValue }

            // Rule 3. Bags are only earned on a made contract. The penalty can
            // fire more than once in a hand: eight bags plus five overtricks is
            // one bin emptied and three left over.
            var penalty = 0
            bags[team] += overtricks
            while bagLimit > 0 && bags[team] >= bagLimit {
                bags[team] -= bagLimit
                penalty += bagPenalty
            }

            delta[team] = base + overtricks + nilPoints - penalty
            detail.append(SpadesTeamScore(team: team, contract: contract, took: took, nils: nils,
                                          made: made, base: base, overtricks: overtricks,
                                          nilPoints: nilPoints, bagPenalty: penalty))
        }
        return SpadesHandScore(delta: delta, bags: bags, detail: detail)
    }

    private static func finishHand(_ state: inout SpadesState) -> ActionResult {
        let bids = state.players.map { $0.bid ?? 0 }
        let tricks = state.players.map { $0.tricks }
        guard state.players.allSatisfy({ $0.bid != nil }), tricks.reduce(0, +) == handSize else {
            return .faulted("the game hit a fault and cannot continue")
        }

        let r = scoreHand(bids: bids, tricks: tricks, bagsIn: state.bags,
                          bagLimit: bagLimit(of: state), bagPenalty: bagPenalty(of: state),
                          nilValue: nilValue(of: state))

        state.scores[0] += r.delta[0]
        state.scores[1] += r.delta[1]
        state.bags = r.bags

        for d in r.detail {
            let who = teamName(state, d.team)
            state.log.add(.score, "\(who) bid \(d.contract), took \(d.took) — \(d.made ? "made it" : "set"), \(signed(r.delta[d.team])).")
            for n in d.nils {
                state.log.add(.bid, "\(vb(state, n.seat))’s nil " + (n.made ? "came in." : "went down on \(Prose.count(n.tricks, "trick"))."),
                              seat: n.seat)
            }
            if d.bagPenalty != 0 {
                state.log.add(.score, "\(who) filled the bag bin — \(d.bagPenalty) off.")
            }
        }

        state.history.append(SpadesHandRecord(deal: state.dealNumber, dealer: state.dealer ?? 0,
                                              bids: bids, tricks: tricks, delta: r.delta,
                                              scores: state.scores, bags: state.bags))

        state.log.add(.hand, "Hand \(state.dealNumber) over. \(teamName(state, 0)) \(state.scores[0]), \(teamName(state, 1)) \(state.scores[1]).")

        let target = target(of: state)
        let over0 = state.scores[0] >= target, over1 = state.scores[1] >= target
        if over0 || over1 {
            // Both across the line in the same hand is possible; the higher
            // score wins. Equal and both over is a genuine tie and plays
            // another hand rather than inventing a winner.
            if over0 && over1 && state.scores[0] == state.scores[1] {
                state.log.add(.info, "Both partnerships passed \(target) and are level. Another hand decides it.")
                state.phase = .handOver
                return .ok
            }
            let w = state.scores[0] > state.scores[1] ? 0 : 1
            state.winner = w
            state.phase = .gameOver
            state.log.add(.game, "\(teamName(state, w)) win, \(state.scores[w]) to \(state.scores[1 - w]).")
        } else {
            state.phase = .handOver
        }
        return .ok
    }

    static func signed(_ n: Int) -> String { n >= 0 ? "+\(n)" : String(n) }

    // MARK: - Who is to move

    /// Nil for nobody, and the dead phases matter: a room that asks a bot to
    /// move during handOver gets a seat number still valid from the last trick.
    public static func seatToAct(_ state: SpadesState) -> Int? {
        switch state.phase {
        case .bidding, .play: return state.turn
        case .idle, .handOver, .gameOver: return nil
        }
    }

    // MARK: - The only way in

    public static func applyAction(_ state: inout SpadesState, seat: Int,
                                   action: SpadesAction, rng: inout RandomSource) -> ActionResult {
        guard state.players.count == seats, state.scores.count == teams, state.bags.count == teams else {
            return .faulted("the table is not four seats in two partnerships")
        }
        guard seat >= 0, seat < seats else { return .refused("not a seat at this table") }

        switch action {
        case .start:
            // Deal the FIRST hand, when the people at the table say they are
            // ready.
            if state.phase != .idle { return .refused("the game has already started") }
            newHand(&state, rng: &rng)
            return .ok

        case .bid(let n):
            return doBid(&state, seat: seat, n)

        case .play(let card):
            return doPlay(&state, seat: seat, card)

        case .nextHand:
            if !canDeal(state) { return .refused("the hand is not over") }
            newHand(&state, rng: &rng)
            return .ok

        case .newGame:
            if state.phase == .idle { return .refused("the game has not started") }
            state = createGame(state.config)
            state.log.add(.info, "A new game is ready.")
            return .ok
        }
    }
}

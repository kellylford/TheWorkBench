import CardCore

// MARK: - Configuration

/// The rule options from the web game's settings dialog, with the same defaults.
public struct SheepheadConfig: Codable, Hashable, Sendable {
    /// What happens when everybody passes.
    public enum AllPass: String, Codable, Hashable, Sendable, CaseIterable {
        /// No picker, everyone for themselves, fewest points wins.
        case leaster
        /// Throw the hand in and deal again.
        case redeal
    }

    public static let defaultNames = ["You", "Alice", "Ben", "Cara", "Elle", "Finn"]

    /// One per seat; seat 0 is the person playing. Padded from `defaultNames`
    /// if too short for the table.
    public var names: [String]
    /// Table size, three to six.
    public var players: Int
    public var difficulty: Difficulty
    public var allPass: AllPass
    /// Both black queens in one hand after burying doubles the hand.
    public var blackQueenDoubler: Bool
    /// Both red queens in one hand doubles the hand.
    public var redQueenDoubler: Bool
    /// A redeal doubles the next hand; repeated redeals do not stack.
    public var redealDoubler: Bool

    public init(names: [String] = SheepheadConfig.defaultNames,
                players: Int = 5,
                difficulty: Difficulty = .normal,
                allPass: AllPass = .leaster,
                blackQueenDoubler: Bool = false,
                redQueenDoubler: Bool = false,
                redealDoubler: Bool = false) {
        self.names = names
        self.players = players
        self.difficulty = difficulty
        self.allPass = allPass
        self.blackQueenDoubler = blackQueenDoubler
        self.redQueenDoubler = redQueenDoubler
        self.redealDoubler = redealDoubler
    }
}

/// How a table of a given size is dealt.
public struct SheepheadDealSpec: Hashable, Sendable {
    /// Cards per player.
    public let hand: Int
    /// Cards in the blind.
    public let blind: Int
    /// Whether the jack of diamonds names a partner.
    public let partner: Bool
    /// Cards left out of the deck.
    public let exclude: [Card]
}

// MARK: - State

public struct SheepheadPlayer: Hashable, Sendable {
    public let index: Int
    public var name: String
    public var occupant: Occupant
    public var hand: [Card]
    public var tricksWon: Int
    /// Card points taken in tricks this hand.
    public var points: Int
    /// Running game score, in scoring units.
    public var score: Int

    public init(index: Int, name: String, occupant: Occupant, hand: [Card] = [], tricksWon: Int = 0, points: Int = 0, score: Int = 0) {
        self.index = index
        self.name = name
        self.occupant = occupant
        self.hand = hand
        self.tricksWon = tricksWon
        self.points = points
        self.score = score
    }
}

public enum SheepheadPhase: String, Hashable, Sendable {
    case idle, pick, bury, play, handOver
}

/// One card on the table.
public struct SheepheadPlay: Hashable, Sendable {
    public let player: Int
    public let card: Card
    public init(player: Int, card: Card) {
        self.player = player
        self.card = card
    }
}

/// A completed trick.
public struct SheepheadTrick: Hashable, Sendable {
    public let plays: [SheepheadPlay]
    public let winner: Int
    /// Points to the winner, including any from the blind.
    public let points: Int
    /// The leaster's blind, counted on the last trick.
    public let fromBlind: Int
    public init(plays: [SheepheadPlay], winner: Int, points: Int, fromBlind: Int) {
        self.plays = plays
        self.winner = winner
        self.points = points
        self.fromBlind = fromBlind
    }
}

public struct SheepheadPickEntry: Hashable, Sendable {
    public let player: Int
    public let picked: Bool
    public init(player: Int, picked: Bool) {
        self.player = player
        self.picked = picked
    }
}

public struct SheepheadDoubler: Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case black, red, redeal }
    public let kind: Kind
    /// Who held the pair; nil for the redeal doubler.
    public let player: Int?
    /// "both black queens", "the redeal".
    public let text: String
}

/// When and how the sides became public.
public struct SheepheadReveal: Hashable, Sendable {
    public let trick: Int
    public let player: Int
    public let alone: Bool
}

/// The deal as it was made, so a finished hand can be shown in full.
public struct SheepheadDeal: Hashable, Sendable {
    public let hands: [[Card]]
    public let blind: [Card]
}

public struct SheepheadResult: Hashable, Sendable {
    public let leaster: Bool
    public let pickerPoints: Int
    public let opponentPoints: Int
    public let buriedPoints: Int
    public let pickerWins: Bool
    /// 1, 2 or 3 for a win; 2, 3 or 4 for a loss. 1 for a leaster.
    public let multiplier: Int
    /// The doubler factor: 1, 2 or 4.
    public let factor: Int
    /// "a normal win", "schneider", "the picker went down" …
    public let label: String
    /// Score change per seat; always sums to zero.
    public let deltas: [Int]
    /// The leaster's winner, or the picker's side.
    public let winners: [Int]
    /// The full accounting, as read out.
    public let summary: String
}

/// One audited record per completed hand.
public struct SheepheadHandRecord: Hashable, Sendable {
    public let handNumber: Int
    public let dealer: Int
    public let names: [String]
    public let dealt: SheepheadDeal
    public let pickLog: [SheepheadPickEntry]
    public let picker: Int?
    public let partner: Int?
    public let alone: Bool
    public let isLeaster: Bool
    public let buried: [Card]
    public let buriedPoints: Int
    public let blindLeft: [Card]
    public let reveal: SheepheadReveal?
    public let tricks: [SheepheadTrick]
    public let points: [Int]
    public let tricksWon: [Int]
    public let result: SheepheadResult
    public let scoresAfter: [Int]
    /// Empty when the hand adds up.
    public let problems: [String]
}

public struct SheepheadState: Hashable, Sendable {
    public var phase: SheepheadPhase
    public var players: [SheepheadPlayer]
    public var config: SheepheadConfig
    public var log: EventLog

    /// Nil until the first hand is dealt; the first dealer is drawn at random.
    public var dealer: Int?
    public var handNumber: Int
    public var turn: Int
    public var blind: [Card]
    public var buried: [Card]
    public var picker: Int?
    /// The seat holding the jack of diamonds when there is one and the picker
    /// does not. Private until `partnerRevealed`.
    public var partner: Int?
    /// The ground truth, private until the jack is played or the hand scored.
    public var alone: Bool
    public var partnerRevealed: Bool
    public var isLeaster: Bool
    public var passCount: Int
    public var trick: [SheepheadPlay]
    public var leader: Int
    public var lastTrick: SheepheadTrick?
    public var played: [Card]
    public var result: SheepheadResult?
    public var history: [SheepheadHandRecord]
    public var dealt: SheepheadDeal?
    public var pickLog: [SheepheadPickEntry]
    /// The blind as the picker took it, in front of the hand until the bury.
    public var pickedUp: [Card]
    public var trickLog: [SheepheadTrick]
    public var doublers: [SheepheadDoubler]
    /// This hand is doubled because the last one was thrown in.
    public var redealDoubler: Bool
    public var nextHandDoubler: Bool
    public var revealInfo: SheepheadReveal?

    public var seats: Int { players.count }
    public var spec: SheepheadDealSpec { SheepheadGame.dealSpec(for: players.count) }
}

// MARK: - Actions

public enum SheepheadAction: Hashable, Sendable {
    case start
    case pick
    case pass
    case bury([Card])
    case play(Card)
    case nextHand
    case newGame
}

/// Which side a seat is on.
public enum SheepheadTeam: String, Hashable, Sendable {
    case picker, opponent, solo
}

// MARK: - The engine

public enum SheepheadGame {
    public static let partnerCard = SheepheadCards.partnerCard

    /// Three to six seats; anything else is clamped.
    public static func seats(for config: SheepheadConfig) -> Int {
        min(6, max(3, config.players))
    }

    public static func dealSpec(for players: Int) -> SheepheadDealSpec {
        switch min(6, max(3, players)) {
        case 3: return SheepheadDealSpec(hand: 10, blind: 2, partner: false, exclude: [])
        case 4: return SheepheadDealSpec(hand: 7, blind: 2, partner: true, exclude: [Card(.seven, .diamonds), Card(.eight, .diamonds)])
        case 5: return SheepheadDealSpec(hand: 6, blind: 2, partner: true, exclude: [])
        default: return SheepheadDealSpec(hand: 5, blind: 2, partner: true, exclude: [])
        }
    }

    public static func createGame(_ config: SheepheadConfig) -> SheepheadState {
        let n = seats(for: config)
        var cfg = config
        cfg.players = n
        var names = Array(config.names.prefix(n))
        while names.count < n {
            let fallback = SheepheadConfig.defaultNames[names.count % SheepheadConfig.defaultNames.count]
            names.append(names.contains(fallback) ? "Player \(names.count + 1)" : fallback)
        }
        cfg.names = names
        let players = (0..<n).map { SheepheadPlayer(index: $0, name: names[$0], occupant: $0 == 0 ? .human : .bot) }
        return SheepheadState(
            phase: .idle, players: players, config: cfg, log: EventLog(),
            dealer: nil, handNumber: 0, turn: 0, blind: [], buried: [],
            picker: nil, partner: nil, alone: false, partnerRevealed: false, isLeaster: false,
            passCount: 0, trick: [], leader: 0, lastTrick: nil, played: [], result: nil,
            history: [], dealt: nil, pickLog: [], pickedUp: [], trickLog: [], doublers: [],
            redealDoubler: false, nextHandDoubler: false, revealInfo: nil)
    }

    // MARK: Queries

    public static func seatToAct(_ state: SheepheadState) -> Int? {
        switch state.phase {
        case .idle, .handOver: return nil
        case .bury: return state.picker
        case .pick, .play: return state.turn
        }
    }

    public static func canDeal(_ state: SheepheadState) -> Bool {
        state.phase == .handOver
    }

    /// The cards a seat may play now; empty when it is not their turn.
    public static func legalPlays(_ state: SheepheadState, seat: Int) -> [Card] {
        guard state.phase == .play, state.turn == seat, state.players.indices.contains(seat) else { return [] }
        return legalCards(state, seat: seat)
    }

    /// The follow-suit rule alone, without the turn check.
    static func legalCards(_ state: SheepheadState, seat: Int) -> [Card] {
        let hand = state.players[seat].hand
        guard let first = state.trick.first else { return hand }
        let led = SheepheadCards.effectiveSuit(first.card)
        let match = hand.filter { SheepheadCards.effectiveSuit($0) == led }
        return match.isEmpty ? hand : match
    }

    /// Why a card in this seat's hand cannot be played now, or nil if it can.
    public static func whyNot(_ state: SheepheadState, seat: Int, card: Card) -> String? {
        guard state.players.indices.contains(seat) else { return "That is not a seat at this table." }
        guard state.players[seat].hand.contains(card) else { return "You do not hold the \(card.name)." }
        switch state.phase {
        case .idle: return "The hand has not been dealt."
        case .handOver: return "The hand is over."
        case .pick:
            return state.turn == seat
                ? "Cards are for review while you decide whether to pick."
                : "Cards are for review; \(name(state, state.turn)) is deciding whether to pick."
        case .bury:
            return state.picker == seat
                ? "Cards are for review while you choose what to bury."
                : "Cards are for review; \(name(state, state.picker ?? 0)) is burying."
        case .play:
            if state.turn != seat { return "It is not your turn; \(name(state, state.turn)) is to play." }
            if legalCards(state, seat: seat).contains(card) { return nil }
            return followReason(state)
        }
    }

    /// "You must follow trump." / "You must follow clubs."
    static func followReason(_ state: SheepheadState) -> String {
        guard let first = state.trick.first else { return "That card cannot be played." }
        return "You must follow \(SheepheadCards.effectiveSuit(first.card).lowerName)."
    }

    public static func trickWinnerIndex(_ plays: [SheepheadPlay]) -> Int {
        var best = 0
        for i in plays.indices.dropFirst() where SheepheadCards.beats(plays[i].card, plays[best].card) {
            best = i
        }
        return best
    }

    /// Which side a seat is on, from the ground truth. Public information only
    /// once the sides are revealed; the AI goes through `SheepheadAI` instead,
    /// which reads only what its seat may see.
    public static func team(_ state: SheepheadState, seat: Int) -> SheepheadTeam {
        if state.isLeaster { return .solo }
        if seat == state.picker { return .picker }
        if !state.alone, seat == state.partner { return .picker }
        return .opponent
    }

    // MARK: The gate

    public static func applyAction(_ state: inout SheepheadState, seat: Int, action: SheepheadAction, rng: inout RandomSource) -> ActionResult {
        guard state.players.indices.contains(seat) else { return .refused("That is not a seat at this table.") }
        switch action {
        case .start:
            guard state.phase == .idle else { return .refused("The game has already started.") }
            startHand(&state, rng: &rng)
            return .ok

        case .pick:
            guard state.phase == .pick else { return .refused("It is not the picking round.") }
            guard state.turn == seat else { return .refused("It is not your turn.") }
            doPick(&state, seat)
            return .ok

        case .pass:
            guard state.phase == .pick else { return .refused("It is not the picking round.") }
            guard state.turn == seat else { return .refused("It is not your turn.") }
            doPass(&state, seat, rng: &rng)
            return .ok

        case .bury(let cards):
            guard state.phase == .bury else { return .refused("There is nothing to bury.") }
            guard state.picker == seat else { return .refused("Only the picker buries.") }
            let want = state.spec.blind
            guard cards.count == want else { return .refused("Bury exactly \(Prose.count(want, "card")).") }
            var seen: [Card] = []
            for c in cards {
                if seen.contains(c) { return .refused("The \(c.name) was named twice.") }
                guard state.players[seat].hand.contains(c) else { return .refused("You do not hold the \(c.name).") }
                seen.append(c)
            }
            doBury(&state, seat, cards)
            return .ok

        case .play(let card):
            guard state.phase == .play else { return .refused("It is not time to play a card.") }
            guard state.turn == seat else { return .refused("It is not your turn.") }
            guard state.players[seat].hand.contains(card) else { return .refused("You do not hold the \(card.name).") }
            guard legalCards(state, seat: seat).contains(card) else { return .refused(followReason(state)) }
            return doPlay(&state, seat, card)

        case .nextHand:
            guard canDeal(state) else { return .refused("The hand is not over.") }
            startHand(&state, rng: &rng)
            return .ok

        case .newGame:
            guard state.phase == .idle || state.phase == .handOver else { return .refused("The hand is not over.") }
            state = createGame(state.config)
            return .ok
        }
    }

    // MARK: Prose helpers

    static func name(_ state: SheepheadState, _ i: Int) -> String { state.players[i].name }

    /// Keeps messages grammatical when the player has left their name as "You".
    static func vb(_ state: SheepheadState, _ i: Int, _ third: String, _ second: String) -> String {
        state.players[i].name.lowercased() == "you" ? second : third
    }

    // MARK: Dealing

    static func deal(_ state: inout SheepheadState, rng: inout RandomSource) {
        let n = state.seats
        let d = state.spec
        let deck = SheepheadCards.deck(for: n).shuffled(with: &rng)
        var pos = 0
        for i in 0..<n {
            state.players[i].hand = SheepheadCards.sortHand(Array(deck[pos..<pos + d.hand]))
            state.players[i].tricksWon = 0
            state.players[i].points = 0
            pos += d.hand
        }
        state.blind = Array(deck[pos..<pos + d.blind])
        state.dealt = SheepheadDeal(hands: state.players.map(\.hand), blind: state.blind)
    }

    /// Deal a hand, unconditionally. The callers are the start and nextHand
    /// actions and the redeal path in doPass, which legitimately deals from
    /// mid-pick when everybody has passed.
    static func startHand(_ state: inout SheepheadState, rng: inout RandomSource) {
        let n = state.seats
        state.handNumber += 1
        // The very first dealer is drawn at random, then the deal rotates.
        if let d = state.dealer {
            state.dealer = (d + 1) % n
        } else {
            state.dealer = rng.nextInt(below: n)
        }
        state.buried = []
        state.picker = nil
        state.partner = nil
        state.alone = false
        state.partnerRevealed = false
        state.isLeaster = false
        state.passCount = 0
        state.trick = []
        state.lastTrick = nil
        state.played = []
        state.result = nil
        state.pickLog = []
        state.pickedUp = []
        state.trickLog = []
        state.doublers = []
        // A redeal doubles the hand that follows it; it does not compound.
        state.redealDoubler = state.nextHandDoubler
        state.nextHandDoubler = false
        state.revealInfo = nil
        deal(&state, rng: &rng)
        state.phase = .pick
        let dealer = state.dealer!
        state.leader = (dealer + 1) % n
        state.turn = state.leader
        state.log.add(.deal, "Hand \(state.handNumber). \(name(state, dealer))\(vb(state, dealer, " deals.", " deal."))", seat: dealer)
    }

    // MARK: Picking

    static func doPick(_ state: inout SheepheadState, _ p: Int) {
        let d = state.spec
        state.picker = p
        // The blind goes to the front of the hand, unsorted, so the picker can see
        // at a glance what they just took. The hand is sorted properly after burying.
        state.pickedUp = state.blind
        state.players[p].hand = state.blind + SheepheadCards.sortHand(state.players[p].hand)
        state.pickLog.append(SheepheadPickEntry(player: p, picked: true))
        state.log.add(.pick, "\(name(state, p))\(vb(state, p, " picks", " pick")) up the blind (\(d.blind) cards).", seat: p)
        state.log.add(.you, "From the blind: \(state.blind.map(\.name).joined(separator: ", ")).", seat: p, cards: state.blind, audience: p)
        state.blind = []
        state.phase = .bury
        state.turn = p
    }

    static func doPass(_ state: inout SheepheadState, _ p: Int, rng: inout RandomSource) {
        let n = state.seats
        state.pickLog.append(SheepheadPickEntry(player: p, picked: false))
        state.log.add(.pick, "\(name(state, p))\(vb(state, p, " passes.", " pass."))", seat: p)
        state.passCount += 1
        if state.passCount >= n {
            if state.config.allPass == .leaster {
                state.isLeaster = true
                state.phase = .play
                state.leader = (state.dealer! + 1) % n
                state.turn = state.leader
                state.log.add(.info, "Everyone passed. This hand is a leaster: no picker, everyone plays for themselves, "
                    + "and the fewest points wins. You must take at least one trick to win. "
                    + "The blind goes to whoever takes the last trick.")
                computeDoublers(&state)
            } else {
                let willDouble = state.config.redealDoubler
                if willDouble { state.nextHandDoubler = true }
                state.log.add(.info, "Everyone passed. Redealing."
                    + (willDouble ? " The next hand is a doubler, worth twice as much." : ""))
                startHand(&state, rng: &rng)
            }
        } else {
            state.turn = (p + 1) % n
        }
    }

    // MARK: Burying

    static func doBury(_ state: inout SheepheadState, _ p: Int, _ cards: [Card]) {
        let d = state.spec
        var hand = state.players[p].hand
        for c in cards { hand = hand.removing(c) }
        state.buried = cards
        state.players[p].hand = SheepheadCards.sortHand(hand)
        state.pickedUp = []
        state.log.add(.pick, "\(name(state, p))\(vb(state, p, " buries ", " bury "))\(d.blind) cards.", seat: p)
        state.log.add(.you, "You buried \(Prose.count(SheepheadCards.sumPoints(cards), "point")).", seat: p, cards: cards, audience: p)

        assignPartner(&state)
        computeDoublers(&state)

        state.phase = .play
        state.leader = (state.dealer! + 1) % state.seats
        state.turn = state.leader
    }

    /// `alone` is the ground truth and must stay private: whether the picker
    /// kept or buried the jack of diamonds is nobody else's business until the
    /// card shows up, or until the hand is scored. The only exception is a table
    /// with no partner card at all, where playing alone is a rule everyone
    /// knows in advance.
    static func assignPartner(_ state: inout SheepheadState) {
        let d = state.spec
        let picker = state.picker!
        if !d.partner {
            state.alone = true
            state.partner = nil
            state.partnerRevealed = true
            state.log.add(.info, "\(name(state, picker))\(vb(state, picker, " is", " are")) the picker and \(vb(state, picker, "plays", "play")) alone.", seat: picker)
            return
        }

        let holder = state.players.firstIndex { $0.hand.contains(partnerCard) }
        let buriedPartnerCard = state.buried.contains(partnerCard)
        if holder == nil || holder == picker || buriedPartnerCard {
            state.alone = true
            state.partner = nil
        } else {
            state.alone = false
            state.partner = holder
        }
        state.partnerRevealed = false

        // Deliberately identical wording either way, so the log gives nothing away.
        state.log.add(.info, "\(name(state, picker))\(vb(state, picker, " is", " are")) the picker. The Jack of Diamonds is the partner card.", seat: picker)

        // And what only the picker is told.
        state.log.add(.you, state.alone
            ? "You have the Jack of Diamonds yourself, so you are playing alone — nobody else knows that yet."
            : "Somebody else holds it and is your secret partner.",
            seat: picker, audience: picker)
    }

    // MARK: Doublers

    private struct QueenPair {
        let kind: SheepheadDoubler.Kind
        let cards: [Card]
        let text: String
    }

    private static let queenPairs = [
        QueenPair(kind: .black, cards: [Card(.queen, .clubs), Card(.queen, .spades)], text: "both black queens"),
        QueenPair(kind: .red, cards: [Card(.queen, .hearts), Card(.queen, .diamonds)], text: "both red queens"),
    ]

    /// A pair only counts in one player's own hand, and only once the hands are
    /// final — the picker's changes when they bury. Who holds what is private
    /// until scoring; the only thing said is to the holder, about their own hand.
    static func computeDoublers(_ state: inout SheepheadState) {
        state.doublers = []
        for pair in queenPairs {
            let on = pair.kind == .black ? state.config.blackQueenDoubler : state.config.redQueenDoubler
            guard on else { continue }
            for i in state.players.indices {
                let hand = state.players[i].hand
                if hand.contains(pair.cards[0]) && hand.contains(pair.cards[1]) {
                    state.doublers.append(SheepheadDoubler(kind: pair.kind, player: i, text: pair.text))
                    state.log.add(.you, "You hold \(pair.text), so this hand counts double.", seat: i, cards: pair.cards, audience: i)
                    break   // a pair can only sit in one hand
                }
            }
        }
    }

    /// Everything that multiplies this hand, including the redeal doubler.
    public static func doublerList(_ state: SheepheadState) -> [SheepheadDoubler] {
        var out = state.doublers
        if state.redealDoubler { out.append(SheepheadDoubler(kind: .redeal, player: nil, text: "the redeal")) }
        return out
    }

    public static func doublerFactor(_ state: SheepheadState) -> Int {
        1 << doublerList(state).count
    }

    static func doublerText(_ state: SheepheadState) -> String {
        let list = doublerList(state)
        if list.isEmpty { return "" }
        let bits = list.map { dbl -> String in
            if let p = dbl.player { return name(state, p) + " held " + dbl.text }
            return dbl.text
        }
        return " Doubled by " + bits.joined(separator: " and ") + ", so the hand is worth \(doublerFactor(state)) times."
    }

    // MARK: Playing

    static func doPlay(_ state: inout SheepheadState, _ p: Int, _ card: Card) -> ActionResult {
        state.players[p].hand = state.players[p].hand.removing(card)
        state.trick.append(SheepheadPlay(player: p, card: card))
        state.played.append(card)

        var text = "\(name(state, p))\(vb(state, p, " plays ", " play "))\(SheepheadCards.describe(card))."
        // The partner card hitting the table is what makes the sides public. If the
        // picker plays it themselves, that is the moment everyone learns they are alone.
        if card == partnerCard, !state.partnerRevealed, !state.isLeaster, state.spec.partner {
            state.partnerRevealed = true
            let alone = p == state.picker
            state.revealInfo = SheepheadReveal(trick: state.trickLog.count + 1, player: p, alone: alone)
            text += alone
                ? " That is the picker's own partner card, so \(name(state, p))\(vb(state, p, " is", " are")) playing alone."
                : " \(name(state, p))\(vb(state, p, " is", " are")) the picker's partner."
        }
        state.log.add(.play, text, seat: p, cards: [card])

        if state.trick.count == state.seats {
            return resolveTrick(&state)
        }
        state.turn = (p + 1) % state.seats
        return .ok
    }

    static func resolveTrick(_ state: inout SheepheadState) -> ActionResult {
        let plays = state.trick
        let wi = trickWinnerIndex(plays)
        let winner = plays[wi].player
        let pts = SheepheadCards.sumPoints(plays.map(\.card))
        let isFinal = state.players[winner].hand.isEmpty

        var extra = 0
        if isFinal, state.isLeaster, !state.blind.isEmpty {
            extra = SheepheadCards.sumPoints(state.blind)
            state.blind = []   // consumed: those points now belong to the trick winner
        }

        state.players[winner].tricksWon += 1
        state.players[winner].points += pts + extra

        let record = SheepheadTrick(plays: plays, winner: winner, points: pts + extra, fromBlind: extra)
        state.lastTrick = record
        state.trickLog.append(record)
        state.trick = []
        state.turn = winner
        state.leader = winner

        var msg = "\(name(state, winner))\(vb(state, winner, " takes", " take")) the trick, \(pts + extra) points."
        if extra > 0 { msg += " That includes \(extra) points from the blind." }
        state.log.add(.trick, msg, seat: winner, cards: plays.map(\.card))

        if isFinal { return endHand(&state) }
        return .ok
    }

    // MARK: Scoring

    static func endHand(_ state: inout SheepheadState) -> ActionResult {
        state.phase = .handOver
        state.partnerRevealed = true   // scoring makes the sides public either way
        let result = state.isLeaster ? scoreLeaster(state) : scoreNormal(state)
        state.result = result
        for i in state.players.indices {
            state.players[i].score += result.deltas[i]
        }
        state.log.add(.score, result.summary, cards: (state.dealt?.blind ?? []) + state.buried)

        let record = recordHand(state)
        state.history.append(record)
        if !record.problems.isEmpty {
            return .faulted("Accounting problem in hand \(record.handNumber): " + record.problems.joined(separator: " "))
        }
        return .ok
    }

    static func recordHand(_ state: SheepheadState) -> SheepheadHandRecord {
        let problems = audit(state)
        return SheepheadHandRecord(
            handNumber: state.handNumber,
            dealer: state.dealer ?? 0,
            names: state.players.map(\.name),
            dealt: state.dealt ?? SheepheadDeal(hands: [], blind: []),
            pickLog: state.pickLog,
            picker: state.picker,
            partner: state.partner,
            alone: state.alone,
            isLeaster: state.isLeaster,
            buried: state.buried,
            buriedPoints: SheepheadCards.sumPoints(state.buried),
            blindLeft: state.blind,
            reveal: state.revealInfo,
            tricks: state.trickLog,
            points: state.players.map(\.points),
            tricksWon: state.players.map(\.tricksWon),
            result: state.result!,
            scoresAfter: state.players.map(\.score),
            problems: problems)
    }

    /// Independent re-check of a finished hand. This does not trust the running
    /// totals: it re-adds the card values straight from the recorded tricks.
    static func audit(_ state: SheepheadState) -> [String] {
        var problems: [String] = []
        let n = state.seats
        let d = state.spec
        guard let dealt = state.dealt, let result = state.result else {
            return ["The hand was never dealt."]
        }

        let all = dealt.hands.flatMap { $0 } + dealt.blind
        if Set(all) != Set(SheepheadCards.deck(for: n)) || all.count != SheepheadCards.deck(for: n).count {
            problems.append("The deal does not match the deck.")
        }

        var byPlayer = Array(repeating: 0, count: n)
        var playedCards: [Card] = []
        for t in state.trickLog {
            var sum = 0
            for pl in t.plays {
                playedCards.append(pl.card)
                sum += SheepheadCards.points(pl.card)
            }
            if sum + t.fromBlind != t.points {
                problems.append("Trick points do not add up (\(sum) plus \(t.fromBlind) from the blind is not \(t.points)).")
            }
            byPlayer[t.winner] += t.points
        }

        if state.trickLog.count != d.hand {
            problems.append("Expected \(d.hand) tricks but recorded \(state.trickLog.count).")
        }
        if playedCards.count != n * d.hand {
            problems.append("Expected \(n * d.hand) cards played but recorded \(playedCards.count).")
        }
        if Set(playedCards).count != playedCards.count { problems.append("A card was played more than once.") }

        for i in 0..<n where byPlayer[i] != state.players[i].points {
            problems.append("Recorded points for \(name(state, i)) (\(state.players[i].points)) do not match the tricks they took (\(byPlayer[i])).")
        }

        let taken = state.players.reduce(0) { $0 + $1.points }
        let buriedPts = SheepheadCards.sumPoints(state.buried)
        let left = SheepheadCards.sumPoints(state.blind)
        let total = taken + buriedPts + left
        if total != SheepheadCards.totalPoints {
            problems.append("Points do not total \(SheepheadCards.totalPoints): \(taken) taken plus \(buriedPts) buried plus \(left) left in the blind is \(total).")
        }

        if result.deltas.reduce(0, +) != 0 {
            problems.append("Score changes are not zero sum (they total \(result.deltas.reduce(0, +))).")
        }

        if !state.isLeaster, let picker = state.picker {
            var pickerPts = buriedPts + state.players[picker].points
            if !state.alone, let partner = state.partner { pickerPts += state.players[partner].points }
            if pickerPts != result.pickerPoints {
                problems.append("The picker total in the summary (\(result.pickerPoints)) does not match the tricks and bury (\(pickerPts)).")
            }
            if result.pickerPoints + result.opponentPoints != SheepheadCards.totalPoints {
                problems.append("The two sides in the summary total \(result.pickerPoints + result.opponentPoints), not \(SheepheadCards.totalPoints).")
            }
        }
        return problems
    }

    static func scoreLeaster(_ state: SheepheadState) -> SheepheadResult {
        let n = state.seats
        var best = -1
        for i in 0..<n {
            let pl = state.players[i]
            if pl.tricksWon == 0 { continue }
            if best < 0 { best = i; continue }
            let b = state.players[best]
            if pl.points < b.points || (pl.points == b.points && pl.tricksWon < b.tricksWon) { best = i }
        }
        if best < 0 { best = 0 }
        let lf = doublerFactor(state)
        let deltas = (0..<n).map { ($0 == best ? (n - 1) : -1) * lf }

        let lines = state.players.map { p in
            p.name + " \(p.points)" + (p.tricksWon == 0 ? " (no tricks, not eligible)" : "")
        }.joined(separator: ", ")

        // The blind was never picked up, so nobody has seen it until now.
        var blindText = ""
        if let dealt = state.dealt, !dealt.blind.isEmpty {
            let last = state.trickLog.last
            blindText = " The blind held " + dealt.blind.map(\.name).joined(separator: " and ")
                + ", worth \(SheepheadCards.sumPoints(dealt.blind)), and went to "
                + (last.map { name(state, $0.winner) } ?? "the last trick") + " with the last trick."
        }

        let summary = "Leaster result: " + lines + "." + blindText + " " + state.players[best].name
            + " takes the fewest points and wins, \((n - 1) * lf) points." + doublerText(state)
        return SheepheadResult(
            leaster: true, pickerPoints: 0, opponentPoints: 0, buriedPoints: 0, pickerWins: false,
            multiplier: 1, factor: lf, label: "leaster", deltas: deltas, winners: [best], summary: summary)
    }

    static func scoreNormal(_ state: SheepheadState) -> SheepheadResult {
        let n = state.seats
        let picker = state.picker!
        let buriedPts = SheepheadCards.sumPoints(state.buried)
        var pickerTeam = [picker]
        if !state.alone, let partner = state.partner { pickerTeam.append(partner) }

        var pickerPts = buriedPts
        var pickerTricks = 0
        for s in pickerTeam {
            pickerPts += state.players[s].points
            pickerTricks += state.players[s].tricksWon
        }
        let oppPts = SheepheadCards.totalPoints - pickerPts
        let totalTricks = state.spec.hand

        let pickerWins: Bool
        let mult: Int
        let label: String
        if pickerPts >= 61 {
            pickerWins = true
            if pickerTricks == totalTricks { mult = 3; label = "no tricks for the other team" }
            else if pickerPts >= 91 { mult = 2; label = "schneider" }
            else { mult = 1; label = "a normal win" }
        } else {
            pickerWins = false
            if pickerTricks == 0 { mult = 4; label = "the picker took no tricks" }
            else if pickerPts <= 30 { mult = 3; label = "schneider against the picker" }
            else { mult = 2; label = "the picker went down" }
        }

        let isOpp = (0..<n).map { !pickerTeam.contains($0) }
        let oppCount = isOpp.filter { $0 }.count

        // Doublers multiply the whole hand, win or lose, rather than rewarding the
        // holder — so holding both black queens and going down costs double too.
        let factor = doublerFactor(state)
        let stake = 2 * mult * factor
        let pot = stake * oppCount
        let partnerShare = pickerTeam.count > 1 ? pot / 3 : 0
        let pickerShare = pot - partnerShare

        var deltas = Array(repeating: 0, count: n)
        let sign = pickerWins ? 1 : -1
        deltas[picker] = sign * pickerShare
        if pickerTeam.count > 1 { deltas[pickerTeam[1]] = sign * partnerShare }
        for m in 0..<n where isOpp[m] { deltas[m] = -sign * stake }

        // The defending side is named neutrally: there is one summary and it
        // outlives the moment, so it has to be true from every seat.
        let defenceText = "the defenders"

        var teamText = state.alone
            ? name(state, picker) + " alone"
            : name(state, picker) + " and " + name(state, state.partner!)
        if state.alone, state.spec.partner, state.buried.contains(partnerCard) {
            teamText += " (the Jack of Diamonds was buried)"
        }

        // Name the cards, not just the total — at hand end everything is public, and
        // "21 buried" tells you nothing about what actually went down.
        let buriedText = state.buried.isEmpty ? ""
            : " Buried: " + state.buried.map(\.name).joined(separator: ", ") + " (\(Prose.count(buriedPts, "point")))."
        let blindText: String
        if let dealt = state.dealt, !dealt.blind.isEmpty {
            blindText = " The blind held " + dealt.blind.map(\.name).joined(separator: " and ") + "."
        } else {
            blindText = ""
        }

        let summary = "Hand over. " + teamText + " took \(pickerPts) points (including \(buriedPts) buried); "
            + defenceText + " took \(oppPts)." + blindText + buriedText + " "
            + (pickerWins ? "The picker's team wins" : "The picker's team loses") + " — " + label + "."
            + doublerText(state) + " "
            + state.players.enumerated().map { i, p in
                p.name + " " + (deltas[i] >= 0 ? "+" : "") + "\(deltas[i])"
            }.joined(separator: ", ") + "."

        return SheepheadResult(
            leaster: false, pickerPoints: pickerPts, opponentPoints: oppPts, buriedPoints: buriedPts,
            pickerWins: pickerWins, multiplier: mult, factor: factor, label: label, deltas: deltas,
            winners: pickerWins ? pickerTeam : (0..<n).filter { isOpp[$0] }, summary: summary)
    }
}

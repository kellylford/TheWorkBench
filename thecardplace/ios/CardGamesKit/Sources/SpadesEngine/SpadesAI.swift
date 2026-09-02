import CardCore

// The computer players — the port of `spades/js/ai.js`.
//
// Spades is a game about a promise you made before you saw a single card
// played, and every heuristic below is downstream of that. "Playing well"
// means steering towards a number, and the same card is right or wrong
// depending on how many tricks this seat still needs.
//
// WHAT IT PLAYS HONESTLY WITH: only what its seat can see. Its own hand, the
// bids (public — spoken aloud in order), the cards on the table, the trick
// that has just gone, and how many tricks each seat has taken. Not the other
// three hands, and not `playedThisHand` either: `ai.js` remembers only the
// current trick and the last one, and a bot that tracked more here would play
// a different — better — game than the one on the web.
//
// DIFFICULTY: `ai.js` never reads it. The web passes 'hard' for every table
// and offers no control. Easy, normal and hard therefore play identically,
// which is faithful rather than an omission.
public enum SpadesAI {
    typealias G = SpadesGame
    typealias C = SpadesCards

    // MARK: - The one entry point

    /// The computer's move for this seat, reading only what that seat may
    /// see. Nil if the seat has nothing to decide.
    public static func decide(_ state: SpadesState, seat: Int, rng: inout RandomSource) -> SpadesAction? {
        guard G.seatToAct(state) == seat else { return nil }
        switch state.phase {
        case .bidding:
            return .bid(chooseBid(state, seat: seat))
        case .play:
            guard let c = chooseCard(state, seat: seat) else { return nil }
            return .play(c)
        default:
            return nil
        }
    }

    // MARK: - What this seat has not seen

    /// The pack minus this seat's hand minus every card it has watched hit the
    /// table: the current trick and the last completed one. Deliberately
    /// weaker than a person tracking every card — the failure direction is a
    /// bot that plays a bit loosely, not one that knows things it never saw.
    public static func unseen(_ state: SpadesState, seat: Int) -> [Card] {
        var gone = Set<Card>()
        for c in state.players[seat].hand { gone.insert(c) }
        for t in state.trick { gone.insert(t.card) }
        if let lt = state.lastTrick { for t in lt.cards { gone.insert(t.card) } }
        return C.newDeck().filter { !gone.contains($0) }
    }

    static func suitCards(_ cards: [Card], _ s: Suit) -> [Card] { cards.filter { $0.suit == s } }

    // MARK: - Bidding

    /// Roughly how many tricks this hand takes, in halves so that the rounding
    /// is an explicit decision rather than a side effect of integer arithmetic.
    /// Calibrated so that flooring it is right: the table comes to just under
    /// thirteen and the floor takes it to about twelve, which is what real
    /// tables bid.
    public static func handStrength(_ hand: [Card]) -> Double {
        var half = 0
        let trumps = suitCards(hand, C.trump)

        // Trump honours are close to certain.
        for c in trumps {
            switch c.rank {
            case .ace, .king: half += 2
            case .queen: half += 1
            default: break
            }
        }

        // Length: every trump past the third is a trick on its own.
        if trumps.count > 3 { half += (trumps.count - 3) * 2 }

        for s in C.suitOrder where s != C.trump {
            let cards = suitCards(hand, s)
            let len = cards.count

            for c in cards {
                switch c.rank {
                case .ace: half += 2
                // A king needs cover.
                case .king: half += len >= 3 ? 2 : 1
                // A queen needs two cards behind it to be worth anything.
                case .queen: if len >= 3 { half += 1 }
                default: break
                }
            }

            // Short side suits plus trump means ruffing — while the trumps last.
            if trumps.count >= 3 {
                if len == 0 { half += trumps.count >= 4 ? 2 : 1 }
                else if len == 1 && trumps.count >= 4 { half += 1 }
            }

            // A long side suit takes late tricks — but only from the sixth card.
            if len > 5 { half += len - 5 }
        }

        return Double(half) / 2
    }

    /// Can this hand duck thirteen tricks? Deliberately strict.
    public static func nilWorthy(_ hand: [Card]) -> Bool {
        let trumps = suitCards(hand, C.trump)
        if trumps.count > 3 { return false }
        if trumps.contains(where: { C.power($0) > C.power(Card(.nine, .spades)) }) { return false }

        var bad = 0
        for s in C.suitOrder where s != C.trump {
            let cards = suitCards(hand, s)
            for c in cards {
                switch c.rank {
                case .ace: bad += 3
                case .king: bad += cards.count >= 4 ? 1 : 3
                case .queen: bad += cards.count >= 3 ? 0 : 2
                default: break
                }
            }
        }
        return bad == 0
    }

    public static func chooseBid(_ state: SpadesState, seat: Int) -> Int {
        let hand = state.players[seat].hand

        if nilWorthy(hand) { return 0 }

        var n = Int(handStrength(hand).rounded(.down))

        // If the partner (or anybody) has spoken and the table would be well
        // over thirteen, shade down by one. Read from bids, the only honest
        // source.
        var table = 0, spoken = 0
        for p in state.players {
            if let b = p.bid { table += b; spoken += 1 }
        }
        if spoken > 0 && table + n > G.handSize + 1 { n = max(1, n - 1) }

        // A partner sitting on nil needs cover, not ambition.
        if state.players[G.partnerOf(seat)].bid == 0 { n = max(1, n - 1) }

        // Never nil by accident.
        if n < 1 { n = 1 }
        if n > G.handSize { n = G.handSize }
        return n
    }

    // MARK: - Playing

    /// How many more tricks this seat's PARTNERSHIP wants. Negative means it is
    /// already over and every further trick is a bag.
    public static func stillNeeds(_ state: SpadesState, seat: Int) -> Int {
        let team = G.teamOf(seat)
        return G.contractOf(state, team: team) - G.tricksOf(state, team: team)
    }

    static func isNil(_ state: SpadesState, _ seat: Int) -> Bool { state.players[seat].bid == 0 }

    public static func chooseCard(_ state: SpadesState, seat: Int) -> Card? {
        let legal = G.legalPlays(state, seat: seat)
        if legal.isEmpty { return nil }
        if legal.count == 1 { return legal[0] }

        // On nil, the whole plan is different: take nothing, ever.
        if isNil(state, seat) { return nilPlay(state, seat, legal) }

        // Partner is on nil: their tricks are the disaster.
        if isNil(state, G.partnerOf(seat)) { return coverPlay(state, seat, legal) }

        return state.trick.isEmpty ? chooseLead(state, seat, legal) : chooseFollow(state, seat, legal)
    }

    // MARK: Playing a nil

    static func nilPlay(_ state: SpadesState, _ seat: Int, _ legal: [Card]) -> Card {
        if state.trick.isEmpty {
            // Lead the lowest thing available.
            return lowest(legal)
        }
        let winning = currentWinner(state)
        let losing = legal.filter { !C.beats($0, winning.card) }
        // The highest card that still loses.
        if !losing.isEmpty { return highest(losing) }
        // Forced to win. Do it with the cheapest card.
        return lowest(legal)
    }

    // MARK: Covering a partner's nil

    static func coverPlay(_ state: SpadesState, _ seat: Int, _ legal: [Card]) -> Card {
        if state.trick.isEmpty {
            // Lead high. Taking the trick yourself is how the partner never has to.
            return highest(legal)
        }
        let winning = currentWinner(state)
        let partner = G.partnerOf(seat)
        let partnerIn = state.trick.contains { $0.seat == partner }
        let partnerWinning = winning.seat == partner

        if partnerWinning {
            // Take it off them, as cheaply as possible.
            let over = legal.filter { C.beats($0, winning.card) }
            if !over.isEmpty { return lowest(over) }
            return lowest(legal)
        }

        // Partner still to play: cover by taking it now if that is cheap.
        if !partnerIn {
            let beat = legal.filter { C.beats($0, winning.card) }
            if !beat.isEmpty { return lowest(beat) }
        }
        return lowest(legal)
    }

    // MARK: The ordinary case

    static func currentWinner(_ state: SpadesState) -> SpadesPlay {
        var best = state.trick[0]
        for t in state.trick.dropFirst() where C.beats(t.card, best.card) { best = t }
        return best
    }

    static func chooseLead(_ state: SpadesState, _ seat: Int, _ legal: [Card]) -> Card {
        let need = stillNeeds(state, seat: seat)
        let out = unseen(state, seat: seat)

        var best: Card? = nil
        var bestScore = -Double.infinity
        for c in legal {
            var score = 0.0
            let outHigher = out.filter { $0.suit == c.suit && C.power($0) > C.power(c) }.count

            if need > 0 {
                // Chasing tricks: lead winners.
                score += Double((13 - outHigher) * 6 + C.power(c))
                // Do not lead trump while chasing unless it is genuinely high.
                if C.isTrump(c) { score += C.power(c) > 11 ? 10 : -30 }
            } else {
                // At or past the contract: every further trick is a bag.
                score += Double(outHigher * 8 - C.power(c) * 3)
                if C.isTrump(c) { score -= 60 }   // never spend trump when ducking
            }

            if score > bestScore { bestScore = score; best = c }
        }
        return best ?? legal[0]
    }

    static func chooseFollow(_ state: SpadesState, _ seat: Int, _ legal: [Card]) -> Card {
        let need = stillNeeds(state, seat: seat)
        let winning = currentWinner(state)
        let partnerWinning = winning.seat == G.partnerOf(seat)

        let canBeat = legal.filter { C.beats($0, winning.card) }
        let canDuck = legal.filter { !C.beats($0, winning.card) }

        // The partner has it. Do not take a trick off your own side.
        if partnerWinning && !canDuck.isEmpty { return lowest(canDuck) }

        if need > 0 {
            if canBeat.isEmpty { return lowest(legal) }
            // Take it as cheaply as it can be taken.
            return lowest(canBeat)
        }

        // At or over the contract: duck everything possible.
        if !canDuck.isEmpty { return highest(canDuck) }
        return lowest(legal)
    }

    static func highest(_ cards: [Card]) -> Card {
        cards.dropFirst().reduce(cards[0]) { C.power($1) > C.power($0) ? $1 : $0 }
    }
    static func lowest(_ cards: [Card]) -> Card {
        cards.dropFirst().reduce(cards[0]) { C.power($1) < C.power($0) ? $1 : $0 }
    }
}

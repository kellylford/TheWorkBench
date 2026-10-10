import CardCore

// Hearts - the computer players. A port of `hearts/js/ai.js`.
//
// Hearts is an avoidance game: there is no trick you want to win. Every
// heuristic here is about ducking — getting under the trick, getting rid of
// dangerous cards while somebody else is committed, and above all not being
// the one holding the queen of spades when she falls.
//
// ONLY WHAT ITS SEAT CAN SEE. Its own hand, the cards on the table, the tricks
// that have been taken, and what it was passed. Not the other three hands.
// `unseen` is the honest substitute: the whole pack, minus what this seat
// holds, minus everything already played.
//
// The browser AI has no difficulty branching — ui.js always sends 'hard' and
// ai.js never reads it — so neither does this one. It is also fully
// deterministic; `rng` is accepted for the contract and never consulted.
public enum HeartsAI {
    /// The computer's move for this seat. Nil if the seat has nothing to decide.
    public static func decide(_ state: HeartsState, seat: Int, rng: inout RandomSource) -> HeartsAction? {
        guard seat >= 0, seat < state.players.count else { return nil }
        switch state.phase {
        case .passing:
            guard state.passing[seat] == nil else { return nil }
            return .pass(choosePass(state, seat: seat))
        case .play:
            guard let c = chooseCard(state, seat: seat) else { return nil }
            return .play(c)
        default:
            return nil
        }
    }

    /// Everything this seat has not seen: the pack minus its own hand minus
    /// every card that has hit the table. Cards in other hands and cards not
    /// yet played are indistinguishable from here, which is exactly the point.
    public static func unseen(_ state: HeartsState, seat: Int) -> [Card] {
        var gone = Set(state.players[seat].hand)
        for p in state.players { gone.formUnion(p.taken) }
        for t in state.trick { gone.insert(t.card) }
        return Card.fullDeck.filter { !gone.contains($0) }
    }

    // MARK: - Passing

    public static func choosePass(_ state: HeartsState, seat: Int) -> [Card] {
        let hand = state.players[seat].hand
        let spades = hand.count(of: .spades)
        // Highest risk first; ties keep hand order, as the browser's stable sort did.
        let scored = hand.enumerated().map { (i: $0.offset, c: $0.element, risk: passRisk($0.element, hand: hand, spades: spades)) }
        let ordered = scored.sorted { a, b in
            if a.risk != b.risk { return a.risk > b.risk }
            return a.i < b.i
        }
        return ordered.prefix(HeartsGame.passCount).map(\.c)
    }

    static func passRisk(_ c: Card, hand: [Card], spades: Int) -> Int {
        // The queen first, and her guards with her. With three or more spades
        // below her you can afford to hold her; with fewer, she comes down on
        // somebody's ace.
        if c == HeartsCards.queenOfSpades { return spades >= 4 ? 60 : 100 }
        if c.suit == .spades && HeartsCards.power(c) > HeartsCards.power(HeartsCards.queenOfSpades) {
            return spades >= 4 ? 55 : 90
        }

        let len = hand.count(of: c.suit)
        let high = HeartsCards.power(c)

        // A high card in a short suit is a trick you cannot avoid winning.
        var risk = high * 2 - len * 6

        // Hearts are kept unless they are genuinely high. Passing low hearts
        // away is how the seat on your left ends up with the material to shoot.
        if c.suit == .hearts { risk = high >= 12 ? high * 2 - len * 4 : high - 20 }

        return risk
    }

    // MARK: - Playing

    public static func chooseCard(_ state: HeartsState, seat: Int) -> Card? {
        let legal = HeartsGame.legalPlays(state, seat: seat)
        guard !legal.isEmpty else { return nil }
        if legal.count == 1 { return legal[0] }
        return state.trick.isEmpty ? chooseLead(state, seat: seat, legal: legal)
                                   : chooseFollow(state, seat: seat, legal: legal)
    }

    static func chooseLead(_ state: HeartsState, seat: Int, legal: [Card]) -> Card {
        let hand = state.players[seat].hand
        let out = unseen(state, seat: seat)

        // If the queen is still out there and this seat does not hold her,
        // leading spades from below her is how she gets flushed.
        let queenGone = !out.contains(HeartsCards.queenOfSpades) && !hand.contains(HeartsCards.queenOfSpades)

        var best = legal[0]
        var bestScore = Int.min
        for c in legal {
            var score = 0
            let outHigher = out.filter { $0.suit == c.suit && HeartsCards.power($0) > HeartsCards.power(c) }.count

            // Low is good: the more of the suit above it, the less likely this
            // seat takes the trick.
            score += outHigher * 8 - HeartsCards.power(c) * 2

            if c.suit == .hearts { score -= 25 }                                   // leading hearts gives points away
            if c == HeartsCards.queenOfSpades { score -= 200 }                     // never
            if c.suit == .spades && !queenGone && HeartsCards.power(c) > 12 { score -= 60 }

            // Leading a suit this seat is short in is how you get a void.
            let len = hand.count(of: c.suit)
            if len <= 2 && c.suit != .hearts { score += 12 }

            if score > bestScore { bestScore = score; best = c }
        }
        return best
    }

    static func chooseFollow(_ state: HeartsState, seat: Int, legal: [Card]) -> Card {
        let led = state.trick[0].card.suit
        var winning = state.trick[0].card
        for t in state.trick where HeartsCards.beats(t.card, winning) { winning = t.card }

        let following = legal.filter { $0.suit == led }

        if !following.isEmpty {
            let under = following.filter { !HeartsCards.beats($0, winning) }
            // Duck as high as you can safely go.
            if !under.isEmpty { return highest(under) }
            // Forced to win. Take it with the lowest card that does.
            return lowest(following)
        }

        // A discard. The best moment in the game to be rid of something.
        if let qs = legal.first(where: { $0 == HeartsCards.queenOfSpades }) { return qs }

        let spadesHigh = legal.filter { $0.suit == .spades && HeartsCards.power($0) > HeartsCards.power(HeartsCards.queenOfSpades) }
        if !spadesHigh.isEmpty { return highest(spadesHigh) }

        let hearts = legal.filter { $0.suit == .hearts }
        if !hearts.isEmpty { return highest(hearts) }

        return highest(legal)
    }

    /// First wins ties, as the browser's reduce did.
    static func highest(_ cards: [Card]) -> Card {
        cards.dropFirst().reduce(cards[0]) { HeartsCards.power($1) > HeartsCards.power($0) ? $1 : $0 }
    }

    static func lowest(_ cards: [Card]) -> Card {
        cards.dropFirst().reduce(cards[0]) { HeartsCards.power($1) < HeartsCards.power($0) ? $1 : $0 }
    }
}

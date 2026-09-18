import CardCore

/// The computer player: a port of `cribbage-multiplayer/js/ai.js`.
///
/// THE RULE THIS FILE EXISTS TO KEEP: IT READS ONLY WHAT ITS OWN SEAT IS
/// ENTITLED TO. Its own hand, its own discard, everything on the table, the
/// starter. Never the crib, never the undealt remainder, never the other
/// seat's hand. Instead of asking "can my opponent make thirty-one" it asks
/// "how many of the cards I have not seen would make thirty-one" — which is
/// what a good human player does, is often wrong, and is wrong the way a
/// person is wrong. `HiddenInformationTests` enforces it with a recorder on
/// everything the computer may not see.
public enum CribbageAI {
    /// Everything this seat has not seen: the whole deck, less its own cards,
    /// less its own discard, less everything on the table.
    public static func unseen(_ state: CribbageState, seat p: Int) -> [Card] {
        var seen = Set<Card>()
        let me = state.players[p]
        seen.formUnion(me.hand)
        seen.formUnion(me.kept)
        seen.formUnion(me.played)
        seen.formUnion(state.pile.map(\.card))
        if let d = state.discarded[p] { seen.formUnion(d) }
        if let s = state.starter { seen.insert(s) }
        return Card.fullDeck.filter { !seen.contains($0) }
    }

    // MARK: - The discard

    /// What four kept cards are worth AVERAGED OVER EVERY STARTER THAT COULD
    /// STILL COME, rather than on the bare four, because a hand's value in
    /// cribbage is mostly about what it can become.
    public static func averageHandValue(kept: [Card], unseen: [Card]) -> Double {
        if unseen.isEmpty {
            return Double(CribbageScoring.quickTotal(kept, starter: nil, isCrib: false))
        }
        var total = 0
        for s in unseen { total += CribbageScoring.quickTotal(kept, starter: s, isCrib: false) }
        return Double(total) / Double(unseen.count)
    }

    /// What two cards are worth going into a crib, before anything joins
    /// them. A small heuristic: fives are the whole story; touching cards and
    /// pairs are most of the rest.
    public static func cribValue(_ a: Card, _ b: Card) -> Double {
        var v = 0.0
        let va = CribbageCards.value(a), vb = CribbageCards.value(b)
        if va + vb == 15 { v += 2.5 }
        if a.rank == b.rank { v += 2.2 }
        let gap = abs(CribbageCards.order(a) - CribbageCards.order(b))
        if gap == 1 { v += 1.4 }        // touching: a run is one card away
        else if gap == 2 { v += 0.7 }   // a gap a single card fills
        if a.rank == .five { v += 1.9 }
        if b.rank == .five { v += 1.9 }
        // A jack in the crib is a nob about one time in four.
        if a.rank == .jack { v += 0.25 }
        if b.rank == .jack { v += 0.25 }
        return v
    }

    /// Fifteen ways to throw two of six, each judged on what the four kept are
    /// worth, then the crib added or subtracted depending on whose it is.
    public static func chooseDiscard(_ state: CribbageState, seat p: Int) -> [Card] {
        let hand = state.players[p].hand
        guard hand.count >= 2 else { return hand }
        let unseenCards = unseen(state, seat: p)
        let mine = state.dealer == p
        var best: (score: Double, thrown: [Card])? = nil

        for i in 0..<hand.count {
            for j in (i + 1)..<hand.count {
                let thrown = [hand[i], hand[j]]
                let kept = hand.filter { $0 != thrown[0] && $0 != thrown[1] }
                let value = averageHandValue(kept: kept, unseen: unseenCards)
                let crib = cribValue(thrown[0], thrown[1])
                let score = value + (mine ? crib : -crib)
                if best == nil || score > best!.score { best = (score, thrown) }
            }
        }
        return best?.thrown ?? Array(hand.prefix(2))
    }

    // MARK: - The play

    /// How many unseen cards would take a count of `from` to exactly `to`.
    /// The honest version of "can my opponent make thirty-one".
    static func unseenMaking(_ unseen: [Card], from: Int, to: Int) -> Int {
        unseen.reduce(0) { $0 + (from + CribbageCards.value($1) == to ? 1 : 0) }
    }

    static func unseenOfRank(_ unseen: [Card], _ r: Rank) -> Int {
        unseen.reduce(0) { $0 + ($1.rank == r ? 1 : 0) }
    }

    /// The card to lay, or nil when nothing fits under thirty-one.
    public static func chooseCard(_ state: CribbageState, seat p: Int, rng: inout RandomSource) -> Card? {
        let legal = CribbageGame.legalPlays(state, seat: p)
        if legal.isEmpty { return nil }
        if legal.count == 1 { return legal[0] }

        switch state.config.difficulty {
        case .easy:
            if rng.chance(0.35) { return legal[rng.nextInt(below: legal.count)] }
        case .normal:
            if rng.chance(0.12) { return legal[rng.nextInt(below: legal.count)] }
        case .hard:
            break
        }

        let unseenCards = unseen(state, seat: p)
        let scale = max(1.0, Double(unseenCards.count) / 10.0)
        var best: (score: Double, card: Card)? = nil

        for card in legal {
            let newCount = state.count + CribbageCards.value(card)
            var score = Double(CribbageGame.pointsForPlay(state, card: card).total) * 10

            // THE TWO COUNTS NEVER TO LEAVE. Five or twenty-one hands the
            // opponent a fifteen or a thirty-one with any of the sixteen
            // ten-cards in the deck.
            if newCount == 5 || newCount == 21 { score -= 9 }

            // Everything else, priced by how many unseen cards would punish it.
            score -= Double(unseenMaking(unseenCards, from: newCount, to: 31)) * (6 / scale)
            score -= Double(unseenMaking(unseenCards, from: newCount, to: 15)) * (4 / scale)
            score -= Double(unseenOfRank(unseenCards, card.rank)) * 0.6   // they may pair it

            // Leading. A low card keeps the count out of range of a fifteen
            // and leaves room to answer; a five led is a present.
            if state.count == 0 {
                if card.rank == .five { score -= 8 }
                score -= Double(CribbageCards.value(card)) * 0.25
                // Leading from a pair is good: if they pair it, you take three
                // of a kind for six.
                let mineSame = state.players[p].hand.reduce(0) { $0 + ($1.rank == card.rank ? 1 : 0) }
                if mineSame >= 2 { score += 2.5 }
            }

            // Keeping something playable afterwards. Being forced to say go
            // hands over a point and the lead.
            let left = state.players[p].hand.filter { $0 != card }
            let stillPlayable = left.filter { newCount + CribbageCards.value($0) <= 31 }.count
            if !left.isEmpty && stillPlayable == 0 && newCount < 31 { score -= 4 }
            else { score += Double(stillPlayable) * 0.6 }

            if best == nil || score > best!.score { best = (score, card) }
        }
        return best?.card
    }

    // MARK: - Taking a turn

    /// The computer's move for this seat, or nil if the seat has nothing to
    /// decide right now.
    public static func decide(_ state: CribbageState, seat: Int, rng: inout RandomSource) -> CribbageAction? {
        guard state.players.indices.contains(seat), CribbageGame.seatToAct(state) == seat else { return nil }
        switch state.phase {
        case .cutForDeal: return .cut
        case .discard: return .discard(chooseDiscard(state, seat: seat))
        case .count: return .next
        case .play:
            // No playable card means the only legal thing to do is say go. The
            // engine refuses a go from somebody who can play, so this cannot be
            // used to duck a turn.
            if let card = chooseCard(state, seat: seat, rng: &rng) { return .play(card) }
            return .go
        default: return nil
        }
    }

    /// Take one turn for whoever is on move, through the gate like anybody
    /// else. Returns the seat acted for, or nil if nobody is on move or the
    /// gate refused — a refused bot move is a bug, and the result says so.
    @discardableResult
    public static func act(_ state: inout CribbageState, rng: inout RandomSource) -> (seat: Int, result: ActionResult)? {
        guard let p = CribbageGame.seatToAct(state) else { return nil }
        guard let action = decide(state, seat: p, rng: &rng) else {
            return (p, .faulted("the computer had no move at phase \(state.phase.rawValue)"))
        }
        let r = CribbageGame.applyAction(&state, seat: p, action: action, rng: &rng)
        return (p, r)
    }
}

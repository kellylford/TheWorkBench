import CardCore

/// The computer players — the port of `euchre/js/ai.js`.
///
/// IT READS ONLY WHAT ITS OWN SEAT IS ENTITLED TO. Its own hand, the cards
/// already played, the upcard everybody saw, the trump everybody was told, and
/// — if it is the dealer — the card it discarded itself. It never looks at
/// another seat's hand, the kitty, or another seat's discard, and the hidden
/// information test asserts that by scrambling everything it may not see and
/// checking the decision does not change.
///
/// Every heuristic, threshold and difficulty behaviour is the browser game's,
/// including the two bidding thresholds that were arrived at by measurement
/// rather than by reasoning.
public enum EuchreAI {
    // MARK: Valuing a hand

    /// Roughly "tricks I expect this card to be worth", so the numbers can be
    /// reasoned about rather than tuned blind.
    public static func cardValue(_ c: Card, trump: Suit) -> Double {
        switch EuchreCards.bower(c, trump: trump) {
        case .right: return 1.0
        case .left: return 0.85
        case nil: break
        }
        if EuchreCards.isTrump(c, trump: trump) {
            switch c.rank {
            case .ace: return 0.65
            case .king: return 0.45
            case .queen: return 0.30
            default: return 0.20            // ten, nine: they still draw trump out
            }
        }
        if c.rank == .ace { return 0.50 }   // an off-suit ace usually takes a trick
        if c.rank == .king { return 0.15 }
        return 0.02
    }

    /// What a hand is worth with a given suit as trump.
    ///
    /// Voids are counted, and only voids: a short suit is worth something
    /// because it lets you trump in, and that is only true once you are
    /// actually out of it.
    public static func handValue(_ cards: [Card], trump: Suit) -> Double {
        var total = 0.0
        for c in cards { total += cardValue(c, trump: trump) }

        var have: [Suit: Int] = [:]
        for c in cards { have[EuchreCards.effectiveSuit(c, trump: trump), default: 0] += 1 }
        let trumps = have[trump] ?? 0
        if trumps > 0 {
            for s in EuchreCards.suits where s != trump && (have[s] ?? 0) == 0 {
                total += 0.22               // void, and something to trump it with
            }
        }
        /* Four or five trump is worth more than the sum of its parts: you can
         * draw everything and the last two are winners by exhaustion. */
        if trumps >= 4 { total += 0.45 }
        else if trumps == 3 { total += 0.15 }
        return total
    }

    static func trumpCount(_ cards: [Card], trump: Suit) -> Int {
        cards.reduce(0) { $0 + (EuchreCards.isTrump($1, trump: trump) ? 1 : 0) }
    }

    // MARK: The bidding

    /// The two numbers that decide how often anybody bids at all, in expected
    /// tricks. `order` is lower than `call` on purpose: in round one somebody is
    /// about to be handed a known card; by round two everybody has passed once,
    /// which is real evidence that the hands around the table are poor.
    public static let orderThreshold = 2.00
    public static let callThreshold = 2.20

    /// How much a bid threshold moves for this difficulty, plus a little noise
    /// so three computer seats at one table do not all make identical decisions
    /// from identical positions.
    static func bidBias(_ difficulty: Difficulty, rng: inout RandomSource) -> Double {
        switch difficulty {
        case .easy: return -0.45 + rng.nextUnit() * 0.5      // bids on too little
        case .hard: return (rng.nextUnit() - 0.5) * 0.12
        case .normal: return (rng.nextUnit() - 0.5) * 0.30
        }
    }

    /// Whether a hand is worth playing without a partner: a top trump, real
    /// length in it, and a hand that is already strong. Both bowers, or a bower
    /// and the ace of trump, is the hand people actually declare on.
    static func goAlone(_ cards: [Card], trump: Suit, value: Double) -> Bool {
        if trumpCount(cards, trump: trump) < 3 { return false }
        let right = cards.contains { EuchreCards.bower($0, trump: trump) == .right }
        let left = cards.contains { EuchreCards.bower($0, trump: trump) == .left }
        let aceTrump = cards.contains { EuchreCards.isTrump($0, trump: trump) && $0.rank == .ace }
        let top = (right && left) || (right && aceTrump) || (left && aceTrump)
        return top && value >= 3.10
    }

    /// Round one. The upcard's suit is on offer, and the dealer gets the card —
    /// which is the whole of round one strategy: the same hand is a clear order
    /// when your partner is dealing and a clear pass when the seat on your left
    /// is, because the card changes hands either way.
    static func bidRound1(_ state: EuchreState, _ p: Int, rng: inout RandomSource) -> EuchreAction {
        guard let up = state.upcard, let dealer = state.dealer else { return .pass }
        let hand = state.players[p].hand
        let trump = up.suit
        var value = handValue(hand, trump: trump)

        if p == dealer {
            /* We will hold the upcard and put our worst card back, so value the
             * hand as it will actually be, not as it is. */
            let withCard = hand + [up]
            let worst = worstDiscard(withCard, trump: trump)
            value = handValue(withCard.removing(worst), trump: trump)
        } else if EuchreGame.partnerOf(p) == dealer {
            value += cardValue(up, trump: trump) * 0.55       // it helps our side
        } else {
            value -= cardValue(up, trump: trump) * 0.75       // it helps theirs
        }

        let bias = bidBias(state.config.difficulty, rng: &rng)
        let order = value >= orderThreshold + bias

        var alone = false
        if order && state.config.allowAlone {
            /* Judged on the hand as it will BE, not as it is: the dealer's
             * upcard may be the right bower. */
            let effective = p == dealer ? hand + [up] : hand
            alone = goAlone(effective, trump: trump, value: value)
        }
        return order ? .orderUp(alone: alone) : .pass
    }

    /// Round two. Any suit but the one turned down.
    static func bidRound2(_ state: EuchreState, _ p: Int, rng: inout RandomSource) -> EuchreAction {
        let hand = state.players[p].hand
        var best: (suit: Suit, value: Double)? = nil
        for s in EuchreCards.suits where s != state.deniedSuit {
            var v = handValue(hand, trump: s)
            /* CALLING NEXT. The turned-down suit's own colour is the suit to
             * prefer: everybody just declined the upcard, which is weak
             * evidence that its bowers are not out there. Small, and real. */
            if let denied = state.deniedSuit, s == denied.sameColour { v += 0.18 }
            if best == nil || v > best!.value { best = (s, v) }
        }
        guard let choice = best else { return .pass }

        let forced = p == state.dealer && state.config.stickTheDealer
        let bias = bidBias(state.config.difficulty, rng: &rng)
        /* Higher than round one: nobody gets a card, and having passed once
         * already everybody has told you something about their hand. */
        if !forced && choice.value < callThreshold + bias { return .pass }

        let alone = state.config.allowAlone && goAlone(hand, trump: choice.suit, value: choice.value)
        return .callSuit(choice.suit, alone: alone)
    }

    // MARK: The discard

    /// Void yourself if you can do it cheaply, otherwise throw the lowest card
    /// you hold. Never throw trump, and never throw an off-suit ace to make a
    /// void — the ace is usually a trick and the void is usually worth less.
    public static func worstDiscard(_ cards: [Card], trump: Suit) -> Card {
        var counts: [Suit: Int] = [:]
        for c in cards { counts[EuchreCards.effectiveSuit(c, trump: trump), default: 0] += 1 }

        var best: (card: Card, score: Double)? = nil
        for c in cards {
            if EuchreCards.isTrump(c, trump: trump) { continue }   // never put trump back
            var score = cardValue(c, trump: trump)
            /* A singleton that is not an ace is the cheapest void available, so
             * it is worth a small discount rather than a large one. */
            if counts[EuchreCards.effectiveSuit(c, trump: trump)] == 1 && c.rank != .ace { score -= 0.12 }
            if best == nil || score < best!.score { best = (c, score) }
        }
        if let b = best { return b.card }

        /* A hand of nothing but trump. Rare, excellent, and it still has to put
         * one back: the lowest trump. */
        return lowest(cards, trump: trump) ?? cards[0]
    }

    // MARK: Playing a card

    /// Cards this seat has not seen: the whole deck, less its own hand, less
    /// everything played, less the upcard if its whereabouts are known, less
    /// its own discard. Public information and its own, and nothing else.
    public static func unseen(_ state: EuchreState, seat p: Int) -> [Card] {
        var seen = Set<Card>()
        for c in state.players[p].hand { seen.insert(c) }
        for c in state.played { seen.insert(c) }
        for t in state.trick { seen.insert(t.card) }
        if let up = state.upcard, state.upcardStatus != .none { seen.insert(up) }
        if p == state.dealer, let d = state.discard { seen.insert(d) }
        return EuchreCards.deck.filter { !seen.contains($0) }
    }

    /// The first card of the highest power, in hand order — the same answer a
    /// stable sort gives, without depending on one.
    static func highest(_ cards: [Card], trump: Suit?) -> Card? {
        var best: Card? = nil
        for c in cards where best == nil || EuchreCards.power(c, trump: trump) > EuchreCards.power(best!, trump: trump) {
            best = c
        }
        return best
    }

    static func lowest(_ cards: [Card], trump: Suit?) -> Card? {
        var best: Card? = nil
        for c in cards where best == nil || EuchreCards.power(c, trump: trump) < EuchreCards.power(best!, trump: trump) {
            best = c
        }
        return best
    }

    /// A stable sort, so ties keep hand order the way the browser's sort does.
    static func stableSorted(_ cards: [Card], by less: (Card, Card) -> Bool) -> [Card] {
        cards.enumerated().sorted { a, b in
            if less(a.element, b.element) { return true }
            if less(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// The cheapest card to throw away when this trick is lost or already won.
    /// Off-suit first, lowest first, and hold trump back.
    static func throwAway(_ cards: [Card], trump: Suit?) -> Card? {
        let off = cards.filter { !EuchreCards.isTrump($0, trump: trump) }
        if !off.isEmpty, let t = trump {
            /* Keep aces, and keep the last card of a suit you might otherwise
             * still guard. Sorting by value rather than by rank is what stops it
             * pitching an off-suit ace to keep a nine. */
            return stableSorted(off) { cardValue($0, trump: t) < cardValue($1, trump: t) }.first
        }
        return lowest(cards, trump: trump)
    }

    /// Is the trick currently being won by my partner?
    static func partnerWinning(_ state: EuchreState, _ p: Int) -> Bool {
        guard !state.trick.isEmpty else { return false }
        let wi = EuchreGame.trickWinnerIndex(state.trick, trump: state.trump)
        return state.trick[wi].player == EuchreGame.partnerOf(p)
    }

    /// Can anybody still to play in this trick beat what is winning it?
    /// Answered from unseen cards and from who has yet to play, never by
    /// looking at their hands. Wrong sometimes, which is the point.
    static func safeToDuck(_ state: EuchreState, _ p: Int) -> Bool {
        let yetToPlay = EuchreGame.activeCount(state) - state.trick.count - 1
        if yetToPlay <= 0 { return true }
        guard let first = state.trick.first else { return false }
        let wi = EuchreGame.trickWinnerIndex(state.trick, trump: state.trump)
        let winning = state.trick[wi].card
        let led = EuchreCards.effectiveSuit(first.card, trump: state.trump)
        let beaters = unseen(state, seat: p).filter { c in
            if EuchreCards.isTrump(c, trump: state.trump) { return EuchreCards.beats(c, winning, trump: state.trump) }
            return EuchreCards.effectiveSuit(c, trump: state.trump) == led && EuchreCards.beats(c, winning, trump: state.trump)
        }
        return beaters.isEmpty
    }

    static func chooseLead(_ state: EuchreState, _ p: Int) -> Card? {
        let hand = state.players[p].hand
        let trump = state.trump
        let mine = hand.filter { EuchreCards.isTrump($0, trump: trump) }
        let off = hand.filter { !EuchreCards.isTrump($0, trump: trump) }
        let iAmMaker = state.maker.map { EuchreGame.teamOf(p) == EuchreGame.teamOf($0) } ?? false
        let haveRight = mine.contains { EuchreCards.bower($0, trump: trump) == .right }

        /* The makers lead trump to draw it out, provided they have enough of it
         * that running out first is not the likely outcome. */
        if iAmMaker && mine.count >= 3 { return highest(mine, trump: trump) }
        if iAmMaker && haveRight && mine.count >= 2 { return highest(mine, trump: trump) }

        /* Otherwise cash an off-suit ace while it is still good. */
        if let ace = off.first(where: { $0.rank == .ace }) { return ace }

        /* Defending, with the right bower and nothing else to do: take it out
         * from under whoever is counting on it. */
        if !iAmMaker && haveRight && mine.count >= 3 { return highest(mine, trump: trump) }

        if !off.isEmpty {
            /* Lead from a short suit rather than a long one: it gets us void
             * sooner. Among equals, the lowest card. */
            var counts: [Suit: Int] = [:]
            for c in off { counts[c.suit, default: 0] += 1 }
            return stableSorted(off) { a, b in
                let ca = counts[a.suit] ?? 0, cb = counts[b.suit] ?? 0
                if ca != cb { return ca < cb }
                return EuchreCards.power(a, trump: trump) < EuchreCards.power(b, trump: trump)
            }.first
        }
        return lowest(mine, trump: trump)
    }

    static func chooseFollow(_ state: EuchreState, _ p: Int) -> Card? {
        let trump = state.trump
        let legal = EuchreGame.followingPlays(state, seat: p)
        guard let first = state.trick.first else { return nil }
        let wi = EuchreGame.trickWinnerIndex(state.trick, trump: trump)
        let winning = state.trick[wi].card
        let winners = legal.filter { EuchreCards.beats($0, winning, trump: trump) }
        let last = state.trick.count == EuchreGame.activeCount(state) - 1

        if partnerWinning(state, p) {
            /* Partner has it. Do not overtrump your own side; throw the cheapest
             * thing that is not trump — unless partner's card is weak and
             * somebody after us is likely to take it anyway. */
            if last || safeToDuck(state, p) { return throwAway(legal, trump: trump) }
            if !winners.isEmpty { return lowest(winners, trump: trump) }
            return throwAway(legal, trump: trump)
        }

        if winners.isEmpty { return throwAway(legal, trump: trump) }

        /* Playing last, take it as cheaply as possible. */
        if last { return lowest(winners, trump: trump) }

        /* Somebody is still to play. Winning cheaply invites being overtrumped,
         * so take it with something that will hold up: the lowest card that
         * nothing unseen beats, or failing that the highest we have. */
        let unseenCards = unseen(state, seat: p)
        let led = EuchreCards.effectiveSuit(first.card, trump: trump)
        let ranked = stableSorted(winners) { EuchreCards.power($0, trump: trump) < EuchreCards.power($1, trump: trump) }
        for cand in ranked {
            let beatable = unseenCards.contains { o in
                EuchreCards.isTrump(o, trump: trump)
                    ? EuchreCards.beats(o, cand, trump: trump)
                    : (EuchreCards.effectiveSuit(o, trump: trump) == led && EuchreCards.beats(o, cand, trump: trump))
            }
            if !beatable { return cand }
        }
        return highest(winners, trump: trump)
    }

    static func chooseCard(_ state: EuchreState, _ p: Int, rng: inout RandomSource) -> Card? {
        let legal = EuchreGame.followingPlays(state, seat: p)
        guard !legal.isEmpty else { return nil }

        /* Easy opponents throw a legal card at random some of the time.
         * Deliberately a legal one: an opponent who revokes is not an easier
         * opponent, it is a broken game. */
        if state.config.difficulty == .easy && rng.nextUnit() < 0.30 {
            return legal[rng.nextInt(below: legal.count)]
        }
        if state.config.difficulty == .normal && rng.nextUnit() < 0.10 {
            return legal[rng.nextInt(below: legal.count)]
        }

        var pick = state.trick.isEmpty ? chooseLead(state, p) : chooseFollow(state, p)
        /* Belt and braces. Everything above is written to return a legal card;
         * falling back to one is a much better failure than a refused move. */
        if pick == nil || !legal.contains(pick!) { pick = legal[0] }
        return pick
    }

    // MARK: Taking a turn

    /// The computer's move for this seat, reading only what that seat may see.
    /// Nil if the seat has nothing to decide.
    public static func decide(_ state: EuchreState, seat: Int, rng: inout RandomSource) -> EuchreAction? {
        guard seat >= 0, seat < state.players.count, EuchreGame.seatToAct(state) == seat else { return nil }
        switch state.phase {
        case .bid1:
            return bidRound1(state, seat, rng: &rng)
        case .bid2:
            return bidRound2(state, seat, rng: &rng)
        case .discard:
            guard let trump = state.trump else { return nil }
            return .discard(worstDiscard(state.players[seat].hand, trump: trump))
        case .play:
            return chooseCard(state, seat, rng: &rng).map { .play($0) }
        case .idle, .handOver, .gameOver:
            return nil
        }
    }
}

import CardCore

/// The computer players: a port of `sheephead-multiplayer/js/ai.js`.
///
/// The AI only ever looks at information a person in that seat would have:
/// its own hand, the cards already played, the public identity of the picker,
/// and (if it is the picker) its own buried cards. It never reads other hands,
/// the blind, or the hidden `alone` and `partner` fields — what it knows about
/// the sides it works out from the jack of diamonds in its own hand, or from
/// the reveal everyone saw.
public enum SheepheadAI {
    private typealias C = SheepheadCards

    // MARK: Driver

    public static func decide(_ state: SheepheadState, seat: Int, rng: inout RandomSource) -> SheepheadAction? {
        guard SheepheadGame.seatToAct(state) == seat else { return nil }
        switch state.phase {
        case .pick: return shouldPick(state, seat: seat, rng: &rng) ? .pick : .pass
        case .bury: return .bury(chooseBury(state, seat: seat))
        case .play: return .play(chooseCard(state, seat: seat, rng: &rng))
        case .idle, .handOver: return nil
        }
    }

    // MARK: Shared helpers

    /// Cards this seat has not seen: the whole deck minus own hand, minus
    /// everything played so far, minus own buried cards. For anyone but the
    /// picker the blind is correctly still "unseen".
    public static func unseen(_ state: SheepheadState, seat: Int) -> [Card] {
        var seen = Set(state.players[seat].hand)
        seen.formUnion(state.played)
        if seat == state.picker { seen.formUnion(state.buried) }
        return C.deck(for: state.seats).filter { !seen.contains($0) }
    }

    /// True when nothing still out there can beat this card if it were leading.
    public static func isBoss(_ card: Card, unseen: [Card]) -> Bool {
        !unseen.contains { C.beats($0, card) }
    }

    /// The first element, in the array's own order, that is smallest under the
    /// ordering — what a stable sort followed by `[0]` gives in the original.
    private static func firstMin(_ cards: [Card], _ less: (Card, Card) -> Bool) -> Card? {
        var best: Card?
        for c in cards {
            if let b = best, !less(c, b) { continue }
            best = c
        }
        return best
    }

    private static func lowestByPoints(_ cards: [Card]) -> Card {
        firstMin(cards) { a, b in
            let d = C.points(a) - C.points(b)
            return d != 0 ? d < 0 : C.power(a) < C.power(b)
        }!
    }

    private static func highestByPoints(_ cards: [Card]) -> Card {
        firstMin(cards) { a, b in
            let d = C.points(b) - C.points(a)
            return d != 0 ? d < 0 : C.power(b) < C.power(a)
        }!
    }

    /// Prefer winning with a fail card; among equals use the weakest card that still wins.
    private static func cheapestWinner(_ cards: [Card]) -> Card {
        firstMin(cards) { a, b in
            let ta = C.isTrump(a) ? 1 : 0, tb = C.isTrump(b) ? 1 : 0
            if ta != tb { return ta < tb }
            return C.power(a) < C.power(b)
        }!
    }

    private static func highestPower(_ cards: [Card]) -> Card {
        firstMin(cards) { C.power($0) > C.power($1) }!
    }

    private static func bySuit(_ hand: [Card], _ suit: Suit) -> [Card] {
        hand.filter { !C.isTrump($0) && $0.suit == suit }
    }

    private static func trumpOf(_ hand: [Card]) -> [Card] { hand.filter(C.isTrump) }
    private static func failOf(_ hand: [Card]) -> [Card] { hand.filter { !C.isTrump($0) } }

    private static func trickPoints(_ trick: [SheepheadPlay]) -> Int {
        C.sumPoints(trick.map(\.card))
    }

    private static func currentBest(_ trick: [SheepheadPlay]) -> SheepheadPlay {
        trick[SheepheadGame.trickWinnerIndex(trick)]
    }

    // MARK: What a seat may know about the sides

    /// Which side this seat is on, from its own cards and public information
    /// only. The picker knows they picked; whoever holds the jack of diamonds
    /// knows they are the partner; after the reveal everybody knows.
    public static func side(_ state: SheepheadState, seat: Int) -> SheepheadTeam {
        if state.isLeaster { return .solo }
        if seat == state.picker { return .picker }
        if state.partnerRevealed { return SheepheadGame.team(state, seat: seat) }
        if state.spec.partner, state.players[seat].hand.contains(C.partnerCard) { return .picker }
        return .opponent
    }

    /// How likely `other` is an ally, judged only from what `viewer` is
    /// entitled to know. Deliberately does not consult the hidden `alone` and
    /// `partner` fields until the sides have been revealed; the picker reads
    /// their own hand and bury instead, and the partner their own hand.
    public static func allyProbability(_ state: SheepheadState, viewer: Int, other: Int) -> Double {
        if viewer == other { return 1 }
        if state.isLeaster { return 0 }
        guard let picker = state.picker else { return 0 }

        let n = state.seats
        let d = state.spec

        // Public knowledge: the sides are out, or this table has no partner card.
        if state.partnerRevealed || !d.partner {
            return SheepheadGame.team(state, seat: viewer) == SheepheadGame.team(state, seat: other) ? 1 : 0
        }

        if viewer == picker {
            // The picker can see their own hand and their own bury.
            let keptIt = state.players[viewer].hand.contains(C.partnerCard) || state.buried.contains(C.partnerCard)
            if keptIt { return 0 }
            return 1 / Double(n - 1)             // one of the others holds the card
        }
        if state.players[viewer].hand.contains(C.partnerCard) {
            return other == picker ? 1 : 0       // the partner knows both sides
        }

        // A plain opponent. They know they do not hold the partner card themselves,
        // but not whether the picker kept it. Weigh the two possibilities.
        if other == picker { return 0 }
        let u = n - 2
        if u <= 0 { return 0 }
        let pAlone = Double(d.hand + d.blind) / Double(C.deck(for: n).count - d.hand)
        return 1 - (1 - pAlone) / Double(u)
    }

    // MARK: Picking

    public static let trumpValue: [String: Double] = [
        "QC": 4.5, "QS": 4.0, "QH": 3.6, "QD": 3.2,
        "JC": 2.5, "JS": 2.3, "JH": 2.1, "JD": 1.9,
        "AD": 1.6, "TD": 1.2, "KD": 0.9, "9D": 0.6, "8D": 0.5, "7D": 0.4,
    ]

    public static func handStrength(_ hand: [Card]) -> Double {
        var score = 0.0
        let t = trumpOf(hand)
        for c in t { score += trumpValue[c.id] ?? 0.5 }
        if t.count >= 4 { score += Double(t.count - 3) * 0.8 }

        for s in C.failSuits {
            let cards = bySuit(hand, s)
            if cards.isEmpty { score += 0.7; continue }        // void: free trumping chance
            if cards.count == 1, cards[0].rank != .ace { score += 0.35 }
            for c in cards {
                if c.rank == .ace { score += cards.count <= 2 ? 0.9 : 0.7 }
                else if c.rank == .ten { score += cards.count <= 2 ? 0.25 : 0.15 }
            }
        }
        return score
    }

    /// Bar for taking the blind, one figure per table size, tuned by simulation
    /// until picking came out close to break-even against the payout table.
    public static let pickBase: [Int: Double] = [3: 12.0, 4: 7.0, 5: 8.75, 6: 8.75]

    public static func shouldPick(_ state: SheepheadState, seat: Int, rng: inout RandomSource) -> Bool {
        let n = state.seats
        let raw = handStrength(state.players[seat].hand)

        // Later seats have less to lose by taking a marginal hand.
        let frac = n > 1 ? Double(state.passCount) / Double(n - 1) : 0
        var threshold = (pickBase[n] ?? 8.5) - 1.5 * frac

        switch state.config.difficulty {
        case .easy: threshold += rng.nextUnit() * 3 - 1.5
        case .normal: threshold += rng.nextUnit() * 1.2 - 0.6
        case .hard: break
        }
        return raw >= threshold
    }

    // MARK: Burying

    private static func combinations(_ arr: [Card], _ k: Int) -> [[Card]] {
        var out: [[Card]] = []
        var cur: [Card] = []
        func rec(_ start: Int) {
            if cur.count == k { out.append(cur); return }
            if start >= arr.count { return }
            for i in start..<arr.count {
                cur.append(arr[i])
                rec(i + 1)
                cur.removeLast()
            }
        }
        rec(0)
        return out
    }

    public static func chooseBury(_ state: SheepheadState, seat: Int) -> [Card] {
        let hand = state.players[seat].hand
        let k = state.spec.blind
        var best: [Card]?
        var bestScore = -Double.infinity

        for set in combinations(hand, k) {
            var score = 0.0
            for c in set {
                score += Double(C.points(c))
                if C.isTrump(c) { score -= 45 }        // trump is far too useful to throw away
            }
            let kept = hand.filter { !set.contains($0) }
            for s in C.failSuits {
                let had = bySuit(hand, s).count
                if had > 0, bySuit(kept, s).isEmpty { score += 7 }   // a fresh void
            }
            if score > bestScore { bestScore = score; best = set }
        }
        return best ?? Array(hand.prefix(k))
    }

    // MARK: Playing

    public static func chooseCard(_ state: SheepheadState, seat: Int, rng: inout RandomSource) -> Card {
        let legal = SheepheadGame.legalCards(state, seat: seat)
        if legal.count == 1 { return legal[0] }

        if state.config.difficulty == .easy, rng.chance(0.28) {
            return legal[rng.nextInt(below: legal.count)]
        }

        let unseen = unseen(state, seat: seat)
        if state.isLeaster { return leasterCard(state, seat, legal, unseen) }
        if state.trick.isEmpty { return leadCard(state, seat, legal, unseen) }
        return followCard(state, seat, legal, unseen)
    }

    private static func isLastTrickOfHand(_ state: SheepheadState, _ p: Int) -> Bool {
        state.players[p].hand.count == 1
    }

    // MARK: Leading

    private static func leadCard(_ state: SheepheadState, _ p: Int, _ legal: [Card], _ unseen: [Card]) -> Card {
        let team = side(state, seat: p)
        let trump = trumpOf(legal)
        let fail = failOf(legal)

        // A boss trump is always a fine lead: it drags out trump and cannot be beaten.
        let bossTrump = trump.filter { isBoss($0, unseen: unseen) }
        let trumpOutstanding = unseen.filter(C.isTrump).count

        if team == .picker {
            if let b = bossTrump.first, trumpOutstanding > 0 { return b }
            if trump.count >= 3 { return highestPower(trump) }
            // Short on trump: cash a fail ace if it is likely to stand.
            if let ace = fail.first(where: { $0.rank == .ace && isBoss($0, unseen: unseen) }) { return ace }
            if !fail.isEmpty { return lowestByPoints(fail) }
            return highestPower(trump)
        }

        // Defence. Pull the picker's trump only when holding the top of what is left.
        if let b = bossTrump.first, trumpOutstanding > 0, trump.count >= 3 { return b }

        let safeAce = fail.filter { $0.rank == .ace && isBoss($0, unseen: unseen) }
        if !safeAce.isEmpty {
            // Lead the ace from the longest such suit; it is least likely to be trumped.
            return firstMin(safeAce) { bySuit(legal, $0.suit).count > bySuit(legal, $1.suit).count }!
        }
        if !fail.isEmpty {
            // Lead a low card from the suit where a partner is most likely to help.
            let pool = fail.filter { C.points($0) == 0 }
            if !pool.isEmpty {
                return firstMin(pool) { bySuit(legal, $0.suit).count > bySuit(legal, $1.suit).count }!
            }
            return lowestByPoints(fail)
        }
        return lowestByPoints(legal)
    }

    // MARK: Following

    private static func followCard(_ state: SheepheadState, _ p: Int, _ legal: [Card], _ unseen: [Card]) -> Card {
        let best = currentBest(state.trick)
        let pts = trickPoints(state.trick)
        let isLast = state.trick.count == state.seats - 1
        let prob = allyProbability(state, viewer: p, other: best.player)
        let allyWinning = prob >= 0.55
        let winners = legal.filter { C.beats($0, best.card) }
        let losers = legal.filter { !C.beats($0, best.card) }
        let lastTrick = isLastTrickOfHand(state, p)

        if allyWinning {
            // "Safe" means no card still unaccounted for — including my own — can beat it.
            let safe = isLast || isBoss(best.card, unseen: unseen + state.players[p].hand)
            if !losers.isEmpty, safe || pts >= 4 { return highestByPoints(losers) }
            if !losers.isEmpty {
                // Not confident the trick is theirs yet — feed a middling card, keep the ace.
                let modest = losers.filter { C.points($0) < 10 }
                return highestByPoints(modest.isEmpty ? losers : modest)
            }
            return lowestByPoints(legal)   // forced to overtake a friend
        }

        if !winners.isEmpty {
            let take = cheapestWinner(winners)
            let gain = pts + C.points(take)
            let costlyTrump = C.isTrump(take) && C.power(take) >= C.power(C.partnerCard)
            var worth =
                lastTrick ||
                (isLast && pts >= 4) ||
                !C.isTrump(take) ||                        // winning in suit costs nothing
                gain >= 10 ||
                (isBoss(take, unseen: unseen) && pts >= 4) ||
                (side(state, seat: p) == .picker && pts >= 7)
            if costlyTrump, pts < 7, !lastTrick, !isBoss(take, unseen: unseen) { worth = false }
            if worth { return take }
        }

        if !losers.isEmpty { return lowestByPoints(losers) }
        return lowestByPoints(legal)
    }

    // MARK: Leaster: take as few points as possible, but take one trick

    private static func leasterCard(_ state: SheepheadState, _ p: Int, _ legal: [Card], _ unseen: [Card]) -> Card {
        let me = state.players[p]
        let lastTrick = isLastTrickOfHand(state, p)
        let mustWin = lastTrick && me.tricksWon == 0

        if state.trick.isEmpty {
            if mustWin {
                let boss = legal.filter { isBoss($0, unseen: unseen) }
                if !boss.isEmpty { return lowestByPoints(boss) }
            }
            let zero = legal.filter { C.points($0) == 0 }
            return firstMin(zero.isEmpty ? legal : zero) { C.power($0) < C.power($1) }!
        }

        let best = currentBest(state.trick)
        let winners = legal.filter { C.beats($0, best.card) }
        let losers = legal.filter { !C.beats($0, best.card) }

        if mustWin, !winners.isEmpty { return cheapestWinner(winners) }
        if !losers.isEmpty { return highestByPoints(losers) }   // dump points on somebody else
        return lowestByPoints(winners.isEmpty ? legal : winners)
    }
}

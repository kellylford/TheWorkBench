import CardCore

/// One part of a count, in the words a cribbage player uses: "two fifteens for
/// four", "a pair of fives for two", "a run of three for three".
public struct ScoreItem: Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable {
        case fifteen, thirtyOne, pair, run, flush, nob
    }

    public let kind: Kind
    /// The words: "fifteen for two", "three fives for six", "one for his nob".
    public let label: String
    public let points: Int
    /// How many: fifteens found, cards of the same rank, or runs of the
    /// longest length. One for a flush or a nob.
    public let count: Int

    public init(kind: Kind, label: String, points: Int, count: Int = 1) {
        self.kind = kind
        self.label = label
        self.points = points
        self.count = count
    }
}

/// A score as its parts, not as a number.
///
/// "You scored eight" is a fact a sighted player can check against the cards in
/// front of them in about a second. Read out on its own it is something you
/// either trust or do not, and cribbage is a game where the whole pleasure is
/// in the counting. So every scoring function returns the parts as well as the
/// total, and the interface reads them out.
public struct ScoreBreakdown: Hashable, Sendable {
    public let items: [ScoreItem]
    public let total: Int

    public init(items: [ScoreItem], total: Int) {
        self.items = items
        self.total = total
    }

    public init(items: [ScoreItem]) {
        self.init(items: items, total: items.reduce(0) { $0 + $1.points })
    }

    public static let nothing = ScoreBreakdown(items: [], total: 0)

    /// Said the way a person counts a hand out loud: "two fifteens for four, a
    /// pair of fives for two, one for his nob — seven", or "nothing".
    public var spoken: String {
        if total == 0 { return "nothing" }
        return items.map(\.label).joined(separator: ", ") + " — " + CribbageCards.numberWord(total)
    }
}

/// What laying one card on the current count sequence would score.
public struct PlayScore: Hashable, Sendable {
    public let breakdown: ScoreBreakdown
    /// The count the card would make.
    public let count: Int

    public init(breakdown: ScoreBreakdown, count: Int) {
        self.breakdown = breakdown
        self.count = count
    }

    public var total: Int { breakdown.total }

    /// "fifteen for two and a pair for two" — the shout, without the name or
    /// the running score around it. Empty when nothing is scored.
    public var phrase: String { breakdown.items.map(\.label).joined(separator: " and ") }
}

public enum CribbageScoring {
    /// Score four cards with the starter as a fifth. `isCrib` switches on the
    /// crib's flush rule: all five or nothing.
    public static func scoreHand(_ cards4: [Card], starter: Card?, isCrib: Bool) -> ScoreBreakdown {
        var cards = cards4
        if let s = starter { cards.append(s) }
        let n = cards.count
        let vals = cards.map(CribbageCards.value)
        let ords = cards.map(CribbageCards.order)
        var items: [ScoreItem] = []
        var total = 0

        // Fifteens. Every subset, because 5-5-5-J is four of them and no
        // shortcut finds all four.
        var fifteens = 0
        if n > 0 {
            for mask in 1..<(1 << n) {
                var sum = 0, size = 0
                for j in 0..<n where mask & (1 << j) != 0 {
                    sum += vals[j]
                    size += 1
                }
                if size >= 2 && sum == 15 { fifteens += 1 }
            }
        }
        if fifteens > 0 {
            let pts = fifteens * 2
            total += pts
            let label = fifteens == 1 ? "fifteen for two"
                : CribbageCards.numberWord(fifteens) + " fifteens for " + CribbageCards.numberWord(pts)
            items.append(ScoreItem(kind: .fifteen, label: label, points: pts, count: fifteens))
        }

        // Pairs, described by rank rather than as a bare count: "three fives
        // for six" is what a cribbage player says and what they can check.
        var byRank: [Rank: Int] = [:]
        for c in cards { byRank[c.rank, default: 0] += 1 }
        for rank in byRank.keys.sorted(by: { CribbageCards.order(Card($0, .clubs)) < CribbageCards.order(Card($1, .clubs)) }) {
            let k = byRank[rank]!
            if k < 2 { continue }
            let pts = k == 2 ? 2 : k == 3 ? 6 : 12
            total += pts
            let plural = CribbageCards.plural(of: rank).lowercased()
            let label = k == 2 ? "a pair of " + plural + " for two"
                : CribbageCards.numberWord(k) + " " + plural + " for " + CribbageCards.numberWord(pts)
            items.append(ScoreItem(kind: .pair, label: label, points: pts, count: k))
        }

        // Runs. A run scores once for EVERY distinct set of cards that forms
        // it: 4-5-6-6 is two runs of three for six. Only maximal runs count,
        // which is why the multiplicity is counted at the longest length only.
        var longest = 0, howMany = 0
        if n > 0 {
            for mask in 1..<(1 << n) {
                let size = mask.nonzeroBitCount
                if size < 3 || size < longest { continue }
                var bits = 0
                for j in 0..<n where mask & (1 << j) != 0 { bits |= 1 << ords[j] }
                // Distinct and consecutive: as many bits as cards, and contiguous.
                if bits.nonzeroBitCount != size { continue }
                let low = bits & -bits
                let shifted = bits / low
                if shifted & (shifted + 1) != 0 { continue }
                if size > longest { longest = size; howMany = 1 } else { howMany += 1 }
            }
        }
        if longest >= 3 {
            let pts = longest * howMany
            total += pts
            let label = howMany == 1
                ? "a run of " + CribbageCards.numberWord(longest) + " for " + CribbageCards.numberWord(longest)
                : CribbageCards.numberWord(howMany) + " runs of " + CribbageCards.numberWord(longest) + " for " + CribbageCards.numberWord(pts)
            items.append(ScoreItem(kind: .run, label: label, points: pts, count: howMany))
        }

        // A flush. Four in the hand is four, and the starter matching makes
        // five. IN THE CRIB IT IS ALL FIVE OR NOTHING.
        if cards4.count == CribbageGame.kept, let first = cards4.first,
           cards4.allSatisfy({ $0.suit == first.suit }) {
            let withStarter = starter?.suit == first.suit
            if isCrib {
                if withStarter {
                    total += 5
                    items.append(ScoreItem(kind: .flush, label: "a flush of five for five", points: 5))
                }
            } else {
                let pts = withStarter ? 5 : 4
                total += pts
                let w = CribbageCards.numberWord(pts)
                items.append(ScoreItem(kind: .flush, label: "a flush of " + w + " for " + w, points: pts))
            }
        }

        // One for his nob: the jack of the starter's suit, held in the hand.
        // Not the starter itself — that is his heels, paid at the cut.
        if let s = starter, cards4.contains(where: { $0.rank == .jack && $0.suit == s.suit }) {
            total += 1
            items.append(ScoreItem(kind: .nob, label: "one for his nob", points: 1))
        }

        return ScoreBreakdown(items: items, total: total)
    }

    /// The total alone, by a different route — a subset-sum table for the
    /// fifteens and a rank histogram for the pairs and runs — with no
    /// breakdown built. The computer averages a kept four over every starter
    /// that could still come, forty-six times fifteen ways per discard, and
    /// building words for each of them is most of the cost of a decision.
    /// `RulesOracleTests` holds this equal to `scoreHand(...).total`.
    public static func quickTotal(_ cards4: [Card], starter: Card?, isCrib: Bool) -> Int {
        var vals = [Int](repeating: 0, count: 5)
        var hist = [Int](repeating: 0, count: 14)
        var n = 0
        for c in cards4 { vals[n] = CribbageCards.value(c); hist[CribbageCards.order(c)] += 1; n += 1 }
        if let s = starter { vals[n] = CribbageCards.value(s); hist[CribbageCards.order(s)] += 1; n += 1 }

        // Fifteens: ways[t] = number of subsets summing to t.
        var ways = [Int](repeating: 0, count: 16)
        ways[0] = 1
        for i in 0..<n {
            let v = vals[i]
            if v > 15 { continue }
            var t = 15
            while t >= v { ways[t] += ways[t - v]; t -= 1 }
        }
        var total = ways[15] * 2

        // Pairs from the histogram: 2 per pair, C(k,2) * 2 = k(k-1).
        for r in 1...13 { total += hist[r] * (hist[r] - 1) }

        // Runs: every maximal stretch of consecutive ranks three or more
        // long, once for each way of choosing one card from each rank.
        var at = 1
        while at <= 13 {
            if hist[at] == 0 { at += 1; continue }
            var end = at, mult = 1
            while end <= 13 && hist[end] > 0 { mult *= hist[end]; end += 1 }
            let len = end - at
            if len >= 3 { total += len * mult }
            at = end
        }

        if cards4.count == CribbageGame.kept, let first = cards4.first,
           cards4.allSatisfy({ $0.suit == first.suit }) {
            let withStarter = starter?.suit == first.suit
            if isCrib { if withStarter { total += 5 } }
            else { total += withStarter ? 5 : 4 }
        }
        if let s = starter, cards4.contains(where: { $0.rank == .jack && $0.suit == s.suit }) { total += 1 }
        return total
    }

    /// Distinct, consecutive run orders. Duplicates fail naturally: two fives
    /// sort to 5,5 and 5 is not 5+1.
    public static func isRun(_ cards: [Card]) -> Bool {
        let v = cards.map(CribbageCards.order).sorted()
        if v.count < 2 { return true }
        for i in 1..<v.count where v[i] != v[i - 1] + 1 { return false }
        return true
    }

    /// What laying `card` after `sequence` (the current count sequence, never
    /// the whole pile) at `count` would score, and why. PURE: it awards
    /// nothing and says nothing, which is what lets the engine, the computer
    /// and the interface share it.
    public static func pointsForPlay(sequence: [Card], count: Int, card: Card) -> PlayScore {
        let seq = sequence + [card]
        let newCount = count + CribbageCards.value(card)
        var items: [ScoreItem] = []
        var total = 0

        if newCount == 15 { total += 2; items.append(ScoreItem(kind: .fifteen, label: "fifteen for two", points: 2)) }
        if newCount == 31 { total += 2; items.append(ScoreItem(kind: .thirtyOne, label: "thirty-one for two", points: 2)) }

        // Pairs, walking back through cards of the same rank. Stops at the
        // first different one, so there is no way to over-count.
        if seq.count >= 2 {
            var same = 1
            var i = seq.count - 2
            while i >= 0 {
                if seq[i].rank == card.rank { same += 1 } else { break }
                i -= 1
            }
            if same == 2 { total += 2; items.append(ScoreItem(kind: .pair, label: "a pair for two", points: 2, count: 2)) }
            else if same == 3 { total += 6; items.append(ScoreItem(kind: .pair, label: "three of a kind for six", points: 6, count: 3)) }
            else if same == 4 { total += 12; items.append(ScoreItem(kind: .pair, label: "four of a kind for twelve", points: 12, count: 4)) }
        }

        // Runs during the play do not have to arrive in order — 5, 3, 4 is a
        // run of three — but they must be the last N cards with nothing
        // repeated. Longest wins.
        var len = seq.count
        while len >= 3 {
            if isRun(Array(seq.suffix(len))) {
                total += len
                let w = CribbageCards.numberWord(len)
                items.append(ScoreItem(kind: .run, label: "a run of " + w + " for " + w, points: len))
                break
            }
            len -= 1
        }
        return PlayScore(breakdown: ScoreBreakdown(items: items, total: total), count: newCount)
    }
}

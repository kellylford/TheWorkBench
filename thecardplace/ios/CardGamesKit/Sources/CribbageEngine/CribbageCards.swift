import CardCore

/// Cribbage's card model: a port of `cribbage-multiplayer/js/cards.js`.
///
/// A whole 52-card deck and no trump: cribbage is the odd one out among the
/// games here in that no suit ever outranks another. Suits matter in exactly
/// two places — a flush, and one for his nob — and nowhere else.
///
/// Two different numbers live on every card, and confusing them is the single
/// commonest cribbage bug:
///
///   value  what it counts for during the play and for fifteens. Ace is one,
///          and the ten, jack, queen and king are ALL ten.
///   order  where it sits in a run, and which card is lower when cutting for
///          deal. Ace is one and the king is thirteen, so a ten is genuinely
///          lower than a jack.
///
/// Keeping the two as separately named functions, rather than one with a flag,
/// is the cheapest way to stop the confusion happening again.
public enum CribbageCards {
    /// What a card counts for. Ace one, court cards ten.
    public static func value(_ c: Card) -> Int {
        switch c.rank {
        case .ace: return 1
        case .ten, .jack, .queen, .king: return 10
        default: return c.rank.rawValue
        }
    }

    /// Where a card sits in a run, and which is lower at the cut. Ace one,
    /// king thirteen. NOT the same as `value`, and the difference is
    /// load-bearing.
    public static func order(_ c: Card) -> Int {
        c.rank == .ace ? 1 : c.rank.rawValue
    }

    /// The suit order a hand is sorted by within a rank, so a hand reads the
    /// same way twice.
    public static let suitOrder: [Suit] = [.clubs, .spades, .hearts, .diamonds]

    /// Ascending by run order, then by suit. Cribbage hands are counted, not
    /// played competitively by suit, so low-to-high is what a player expects
    /// to hear — the opposite of the trick games next door.
    public static func sortHand(_ cards: [Card]) -> [Card] {
        cards.sorted { a, b in
            if order(a) != order(b) { return order(a) < order(b) }
            return suitIndex(a.suit) < suitIndex(b.suit)
        }
    }

    private static func suitIndex(_ s: Suit) -> Int { suitOrder.firstIndex(of: s) ?? 0 }

    /// A card is its name. Nothing else. Knowing that a king counts ten IS
    /// cribbage; a player who needs telling is being told the game instead of
    /// playing it.
    public static func describe(_ c: Card) -> String { c.name }

    /// Nothing worth saying beyond the name: no card in cribbage has a role.
    public static func role(_ c: Card) -> String { "" }

    public static func sumValue(_ cards: [Card]) -> Int {
        cards.reduce(0) { $0 + value($1) }
    }

    /// A list of cards, said the way a person would say it: "the Ace of
    /// Spades", "the Ace of Spades and the Five of Hearts", "A, B and C" —
    /// and "nothing" for an empty list. Used everywhere a score is broken
    /// down, which is most of cribbage.
    public static func listNames(_ cards: [Card]) -> String {
        if cards.isEmpty { return "nothing" }
        return Prose.list(cards.map(\.name))
    }

    /// "Fives", "Sixes", "Jacks" — the plural a cribbage player says.
    public static func plural(of rank: Rank) -> String {
        rank == .six ? "Sixes" : rank.name + "s"
    }

    /// Numbers as words. The browser game stops at twenty-nine, because that
    /// is the best hand in cribbage; this goes to ninety-nine because a card
    /// label also says what count a card would make — "makes thirty-four" —
    /// and the count can be pushed to forty by a refused play.
    public static func numberWord(_ n: Int) -> String {
        let ones = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
        let teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                     "seventeen", "eighteen", "nineteen"]
        let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
        if n < 0 { return String(n) }
        if n < 10 { return ones[n] }
        if n < 20 { return teens[n - 10] }
        if n < 100 {
            let t = tens[n / 10], o = n % 10
            return o == 0 ? t : t + "-" + ones[o]
        }
        return String(n)
    }

    /// "no points", "one point", "two points" …
    public static func pointWords(_ n: Int) -> String {
        n == 1 ? "one point" : numberWord(n) + " points"
    }
}

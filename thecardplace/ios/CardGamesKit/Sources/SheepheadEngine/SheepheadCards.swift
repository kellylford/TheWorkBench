import CardCore

/// The sheephead card model: a port of `sheephead-multiplayer/js/cards.js`.
///
/// Trump is a single fourteen-card suit — every queen, then every jack, then
/// the whole diamond suit — and it outranks every fail card. Fail suits are
/// clubs, spades and hearts, ranked ace, ten, king, nine, eight, seven.
public enum SheepheadCards {
    /// Seven up to ace: the thirty-two card pack.
    public static let ranks: [Rank] = [.seven, .eight, .nine, .ten, .jack, .queen, .king, .ace]

    /// The suits that are not trump, in the order a hand is read out.
    public static let failSuits: [Suit] = [.clubs, .spades, .hearts]

    /// Trump, highest first.
    public static let trumpOrder: [Card] = [
        "QC", "QS", "QH", "QD", "JC", "JS", "JH", "JD", "AD", "TD", "KD", "9D", "8D", "7D",
    ].map { Card(id: $0)! }

    /// Within a fail suit, highest first. The ten sits above the king.
    public static let failRankOrder: [Rank] = [.ace, .ten, .king, .nine, .eight, .seven]

    public static let totalPoints = 120

    /// The jack of diamonds: whoever holds it is the picker's partner at four
    /// players or more.
    public static let partnerCard = Card(.jack, .diamonds)

    /// All thirty-two cards.
    public static let fullDeck: [Card] = Card.deck(ranks: ranks)

    /// The suit a card follows. Trump is its own suit: the queen of clubs does
    /// not follow a lead of clubs.
    public enum EffectiveSuit: Hashable, Sendable {
        case trump
        case fail(Suit)

        /// "trump" or "clubs", as it reads mid-sentence.
        public var lowerName: String {
            switch self {
            case .trump: return "trump"
            case .fail(let s): return s.lowerName
            }
        }

        /// "Trump" or "Clubs", as it reads at the start of a sentence.
        public var name: String {
            switch self {
            case .trump: return "Trump"
            case .fail(let s): return s.name
            }
        }
    }

    public static func isTrump(_ c: Card) -> Bool {
        c.rank == .queen || c.rank == .jack || c.suit == .diamonds
    }

    /// A single comparable number: every trump outranks every fail card.
    public static func power(_ c: Card) -> Int {
        if let i = trumpOrder.firstIndex(of: c) { return 200 - i }
        return 100 - (failRankOrder.firstIndex(of: c.rank) ?? 99)
    }

    public static func effectiveSuit(_ c: Card) -> EffectiveSuit {
        isTrump(c) ? .trump : .fail(c.suit)
    }

    public static func points(_ c: Card) -> Int {
        switch c.rank {
        case .ace: return 11
        case .ten: return 10
        case .king: return 4
        case .queen: return 3
        case .jack: return 2
        default: return 0
        }
    }

    public static func sumPoints(_ cards: [Card]) -> Int {
        cards.reduce(0) { $0 + points($1) }
    }

    /// "trump, 3 points" or "Clubs fail, 11 points". Every sheephead card has
    /// something worth saying beyond its name, so this is never empty.
    public static func role(_ c: Card) -> String {
        let p = points(c)
        return (isTrump(c) ? "trump" : c.suit.name + " fail") + ", " + Prose.count(p, "point")
    }

    /// "Queen of Clubs, trump, 3 points".
    public static func describe(_ c: Card) -> String {
        c.name + ", " + role(c)
    }

    /// Does `c` beat `b`, given that `b` is the card currently winning the trick?
    public static func beats(_ c: Card, _ b: Card) -> Bool {
        if isTrump(c) { return !isTrump(b) || power(c) > power(b) }
        return !isTrump(b) && c.suit == b.suit && power(c) > power(b)
    }

    /// The deck for a table: thirty-two cards, or thirty at four players, where
    /// the seven and eight of diamonds come out so a full hand still leaves a
    /// two-card blind. Both are worth nothing, so a hand is 120 points at every
    /// table size.
    public static func deck(for players: Int) -> [Card] {
        let exclude = SheepheadGame.dealSpec(for: players).exclude
        return fullDeck.filter { !exclude.contains($0) }
    }

    private static func group(_ c: Card) -> Int {
        if isTrump(c) { return 0 }
        switch c.suit {
        case .clubs: return 1
        case .spades: return 2
        default: return 3
        }
    }

    /// Trump high-to-low, then clubs, spades and hearts, each high-to-low.
    public static func sortHand(_ cards: [Card]) -> [Card] {
        cards.sorted { a, b in
            let ga = group(a), gb = group(b)
            if ga != gb { return ga < gb }
            return power(a) > power(b)
        }
    }
}

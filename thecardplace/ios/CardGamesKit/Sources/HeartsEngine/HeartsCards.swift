import CardCore

/// Hearts - card model. A port of `hearts/js/cards.js`.
///
/// There is no trump. Every card follows its printed suit, a trick is won by
/// the highest card of the suit led, and nothing ever beats a suit it does not
/// belong to. So `power` and `beats` take a card and nothing else: in hearts a
/// card's rank is a property of the card.
///
/// The two cards that matter more than their rank suggests — the queen of
/// spades at thirteen points and every heart at one — are NOT special-cased
/// here. They are worth points, which is scoring, and scoring lives in
/// `HeartsGame`.
public enum HeartsCards {
    /// Clubs, diamonds, spades, hearts: alternating colours, hearts last
    /// because they are what the hand is about.
    public static let suitOrder: [Suit] = [.clubs, .diamonds, .spades, .hearts]

    public static let twoOfClubs = Card(.two, .clubs)
    public static let queenOfSpades = Card(.queen, .spades)

    /// Comparable within a suit only. Ace high, deuce low.
    public static func power(_ c: Card) -> Int { c.rank.rawValue }

    public static func name(_ c: Card) -> String { c.name }

    /// A card is its name. Nothing else. This used to add "one point" to
    /// every heart and "thirteen points" to the queen of spades — that is the
    /// entire game stated back to the player on most of the cards in the deck.
    /// The test is whether the name alone would mislead, and in hearts it never
    /// does.
    public static func role(_ c: Card) -> String { "" }

    public static func describe(_ c: Card) -> String {
        let r = role(c)
        return r.isEmpty ? name(c) : name(c) + ", " + r
    }

    /// Does `c` beat `b`, where `b` is the card currently winning the trick?
    /// A card that is not of the led suit cannot win, however high.
    public static func beats(_ c: Card, _ b: Card) -> Bool {
        guard c.suit == b.suit else { return false }
        return power(c) > power(b)
    }

    /// Clubs, diamonds, spades, hearts; high to low within each.
    public static func sortHand(_ cards: [Card]) -> [Card] {
        cards.sorted { a, b in
            let ga = suitOrder.firstIndex(of: a.suit) ?? 0
            let gb = suitOrder.firstIndex(of: b.suit) ?? 0
            if ga != gb { return ga < gb }
            return power(a) > power(b)
        }
    }
}

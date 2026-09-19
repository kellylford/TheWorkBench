import CardCore

/// The card model for spades — the port of `spades/js/cards.js`.
///
/// What makes this different from the other games in the package: the trump
/// suit is a constant. Not chosen at the deal like euchre's, not a fourteen-card
/// construction like sheephead's, not absent like hearts'. Spades are trump, in
/// every hand, for ever. So `beats` knows about spades because in this game
/// every card comparison does, and nothing here takes a trump argument because
/// there is nothing to pass.
public enum SpadesCards {
    /// Named once. Everything below that needs to know reads this.
    public static let trump: Suit = .spades

    /// Clubs, diamonds, hearts, spades: the order a hand is shown and read in.
    /// Trump last, deliberately — spades are the resource, and a player deciding
    /// whether to bid four wants to find their trump length in one place, at the
    /// end, where the hand ends.
    public static let suitOrder: [Suit] = [.clubs, .diamonds, .hearts, .spades]

    /// Ace high, deuce low, as the numbers a player says aloud.
    public static let rankOrder: [Rank] = [.ace, .king, .queen, .jack, .ten, .nine, .eight,
                                           .seven, .six, .five, .four, .three, .two]

    public static let deckSize = 52
    public static let handSize = 13

    public static func isTrump(_ c: Card) -> Bool { c.suit == trump }

    /// Comparable within a suit only. Deliberately NOT comparable across suits:
    /// the two of spades beats the ace of hearts and no single number can
    /// express that while also ranking the ace above the king. `beats` is the
    /// function that knows what a trick means.
    public static func power(_ c: Card) -> Int { c.rank.rawValue }

    public static func name(_ c: Card) -> String { c.name }

    /// What is worth saying about a card beyond its name: "trump" on every
    /// spade, and nothing on anything else. A player hearing "the two of spades"
    /// while holding the ace of hearts needs to know which of those takes the
    /// trick, and in this game it is the two.
    public static func role(_ c: Card) -> String { isTrump(c) ? "trump" : "" }

    /// "Two of Spades, trump" or "Ace of Hearts".
    public static func describe(_ c: Card) -> String {
        let r = role(c)
        return r.isEmpty ? c.name : c.name + ", " + r
    }

    public static func shortText(_ c: Card) -> String { c.shortText }

    /// Does `c` beat `b`, where `b` is the card currently winning the trick?
    ///
    /// Three cases and they have to be in this order: a trump against a
    /// non-trump wins, whatever the ranks; a non-trump against a trump loses,
    /// whatever the ranks; otherwise the suits must match and the higher rank
    /// wins. The suit check is against the winning card rather than a
    /// remembered lead because the winning card is always either of the led
    /// suit or a trump — nothing else can have taken the lead.
    public static func beats(_ c: Card, _ b: Card) -> Bool {
        if isTrump(c) && !isTrump(b) { return true }
        if !isTrump(c) && isTrump(b) { return false }
        if c.suit != b.suit { return false }
        return power(c) > power(b)
    }

    /// Fifty-two cards in the order `cards.js` builds them: clubs, diamonds,
    /// hearts, spades; ace down to two within each.
    public static func newDeck() -> [Card] {
        suitOrder.flatMap { s in rankOrder.map { Card($0, s) } }
    }

    /// Clubs, diamonds, hearts, spades; high to low within each.
    public static func sortHand(_ cards: [Card]) -> [Card] {
        cards.sorted { a, b in
            let ga = suitIndex(a.suit), gb = suitIndex(b.suit)
            if ga != gb { return ga < gb }
            return power(a) > power(b)
        }
    }

    static func suitIndex(_ s: Suit) -> Int { suitOrder.firstIndex(of: s) ?? 0 }
}

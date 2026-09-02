import CardCore

/// The deck, the bowers and trump ordering — the port of `euchre/js/cards.js`.
///
/// THE ONE THING THAT MAKES EUCHRE DIFFERENT FROM EVERY OTHER TRICK GAME, and
/// the reason almost every function here takes a `trump` argument:
///
///   The jack of the trump suit is the highest card (the RIGHT BOWER), and the
///   jack of the other suit of the same colour is the second highest (the LEFT
///   BOWER) — and while it is the left bower it is not a card of its printed
///   suit at all. With spades trump, the jack of clubs is a spade. It follows
///   spades, it may not be played on a club lead if you hold a spade, and a
///   player who thinks of it as a club will revoke.
///
/// `trump` is Optional, and nil is a real state rather than an oversight — while
/// the bidding is going on nobody knows what trump is. With nil trump nothing is
/// trump, every card follows its printed suit, and a hand sorts by suit. That is
/// exactly what a player looking at their cards before bidding needs.
public enum EuchreCards {
    /// Nine up to ace in each suit.
    public static let ranks: [Rank] = [.nine, .ten, .jack, .queen, .king, .ace]

    /// The twenty-four cards.
    public static let deck: [Card] = Card.deck(ranks: ranks)

    public static let deckSize = 24

    /// The suits in the order the browser game lists them. It decides the
    /// display order of a hand and the order in which the computer considers
    /// suits in round two, so it is kept as data rather than left to `Suit`.
    public static let suits: [Suit] = [.clubs, .spades, .hearts, .diamonds]

    public enum Bower: String, Hashable, Sendable {
        case right, left
    }

    /// The suit whose jack becomes the left bower, or nil while trump is unknown.
    public static func leftBowerSuit(_ trump: Suit?) -> Suit? { trump?.sameColour }

    /// Right, left, or nil. Nothing is a bower while trump is unknown.
    public static func bower(_ c: Card, trump: Suit?) -> Bower? {
        guard let trump = trump, c.rank == .jack else { return nil }
        if c.suit == trump { return .right }
        if c.suit == trump.sameColour { return .left }
        return nil
    }

    public static func isTrump(_ c: Card, trump: Suit?) -> Bool {
        guard let trump = trump else { return false }
        return c.suit == trump || bower(c, trump: trump) == .left
    }

    /// The suit a card belongs to for the purposes of following. The left bower
    /// answers with the trump suit, which is the entire point.
    public static func effectiveSuit(_ c: Card, trump: Suit?) -> Suit {
        if let trump = trump, isTrump(c, trump: trump) { return trump }
        return c.suit
    }

    /// Rank order within a suit, highest first, for cards that are not bowers.
    private static let plainOrder: [Rank] = [.ace, .king, .queen, .jack, .ten, .nine]
    /// The jack has left; it is the right bower.
    private static let trumpPlainOrder: [Rank] = [.ace, .king, .queen, .ten, .nine]

    /// A single comparable number, meaningful only within one trump suit.
    ///
    /// Every trump outranks every non-trump, so the two bands cannot collide,
    /// and the bowers sit above the ace of trump because that is what they are.
    /// A rank outside the euchre deck sorts below the nine rather than trapping.
    public static func power(_ c: Card, trump: Suit?) -> Int {
        switch bower(c, trump: trump) {
        case .right: return 300
        case .left: return 290
        case nil: break
        }
        if isTrump(c, trump: trump) {
            let i = trumpPlainOrder.firstIndex(of: c.rank) ?? trumpPlainOrder.count
            return 200 + (trumpPlainOrder.count - i)
        }
        let i = plainOrder.firstIndex(of: c.rank) ?? plainOrder.count
        return 100 + (plainOrder.count - i)
    }

    /// What is worth SAYING about a card beyond its name, given what trump is.
    ///
    /// Empty for an ordinary card, and that is deliberate. The name already
    /// contains the suit, so appending it again produced "Queen of Hearts,
    /// hearts" on every single play — a redundancy that is merely untidy on
    /// screen and genuinely wearing when every card of every trick is read
    /// aloud.
    ///
    /// The bowers are always named as bowers, because "Jack of Clubs" is
    /// actively misleading when clubs are not trump and that jack is the second
    /// highest card in the game.
    public static func role(_ c: Card, trump: Suit?) -> String {
        switch bower(c, trump: trump) {
        case .right: return "right bower, the highest trump"
        case .left: return "left bower, second highest trump, counts as " + (trump?.lowerName ?? "")
        case nil: break
        }
        if isTrump(c, trump: trump) { return "trump" }
        return ""
    }

    /// "Jack of Clubs, left bower, second highest trump, counts as spades".
    public static func describe(_ c: Card, trump: Suit?) -> String {
        let r = role(c, trump: trump)
        return r.isEmpty ? c.name : c.name + ", " + r
    }

    /// Does `c` beat `b`, given that `b` is the card currently winning the trick?
    public static func beats(_ c: Card, _ b: Card, trump: Suit?) -> Bool {
        let ct = isTrump(c, trump: trump), bt = isTrump(b, trump: trump)
        if ct { return !bt || power(c, trump: trump) > power(b, trump: trump) }
        if bt { return false }
        return c.suit == b.suit && power(c, trump: trump) > power(b, trump: trump)
    }

    static func suitGroup(_ s: Suit, trump: Suit?) -> Int {
        if let trump = trump, s == trump { return -1 }
        return suits.firstIndex(of: s) ?? suits.count
    }

    /// Trump high to low, then the other suits high to low in a fixed order.
    ///
    /// The left bower sorts into the trump group, which is where a player
    /// expects to find it and where a screen reader will read it out. A hand
    /// sorted by printed suit would file it under its own colour and quietly
    /// hide the second best card in the game among the rubbish.
    public static func sortHand(_ cards: [Card], trump: Suit? = nil) -> [Card] {
        cards.sorted { a, b in
            let ga = suitGroup(effectiveSuit(a, trump: trump), trump: trump)
            let gb = suitGroup(effectiveSuit(b, trump: trump), trump: trump)
            if ga != gb { return ga < gb }
            return power(a, trump: trump) > power(b, trump: trump)
        }
    }
}

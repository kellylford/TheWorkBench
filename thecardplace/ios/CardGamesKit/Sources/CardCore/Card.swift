import Foundation

/// The four suits. The raw value is the single letter used in card ids, so
/// "QS" is the queen of spades and "TD" the ten of diamonds — the same ids the
/// browser games and their logs use, so a transcript reads the same in both.
public enum Suit: String, CaseIterable, Codable, Hashable, Sendable {
    case clubs = "C", diamonds = "D", hearts = "H", spades = "S"

    public var name: String {
        switch self {
        case .clubs: return "Clubs"
        case .diamonds: return "Diamonds"
        case .hearts: return "Hearts"
        case .spades: return "Spades"
        }
    }

    /// The name as it appears mid-sentence: "you must follow hearts".
    public var lowerName: String { name.lowercased() }

    public var symbol: String {
        switch self {
        case .clubs: return "♣"
        case .diamonds: return "♦"
        case .hearts: return "♥"
        case .spades: return "♠"
        }
    }

    public var isRed: Bool { self == .hearts || self == .diamonds }

    /// The other suit of the same colour. This is the whole of euchre's left
    /// bower rule in one table, and sheephead's black and red queen doublers
    /// use it too, so it lives here rather than in either engine.
    public var sameColour: Suit {
        switch self {
        case .clubs: return .spades
        case .spades: return .clubs
        case .hearts: return .diamonds
        case .diamonds: return .hearts
        }
    }
}

/// Ranks two to ace. The raw value is the ace-high order a player says aloud —
/// two is 2, ace is 14 — so within a plain suit `rank < rank` is the comparison
/// every game means. Games with their own order (euchre's bowers, sheephead's
/// trump, cribbage's counting values) build their own tables on top.
public enum Rank: Int, CaseIterable, Codable, Hashable, Comparable, Sendable {
    case two = 2, three, four, five, six, seven, eight, nine, ten, jack, queen, king, ace

    public static func < (a: Rank, b: Rank) -> Bool { a.rawValue < b.rawValue }

    public var name: String {
        switch self {
        case .two: return "Two"
        case .three: return "Three"
        case .four: return "Four"
        case .five: return "Five"
        case .six: return "Six"
        case .seven: return "Seven"
        case .eight: return "Eight"
        case .nine: return "Nine"
        case .ten: return "Ten"
        case .jack: return "Jack"
        case .queen: return "Queen"
        case .king: return "King"
        case .ace: return "Ace"
        }
    }

    /// The single character used in ids; the ten is "T".
    public var letter: String {
        switch self {
        case .ten: return "T"
        case .jack: return "J"
        case .queen: return "Q"
        case .king: return "K"
        case .ace: return "A"
        default: return String(rawValue)
        }
    }

    /// The text printed on a card face; the ten is "10".
    public var shortText: String {
        switch self {
        case .ten: return "10"
        default: return letter
        }
    }

    public init?(letter: String) {
        guard let r = Rank.allCases.first(where: { $0.letter == letter }) else { return nil }
        self = r
    }
}

/// A playing card. Equality is by rank and suit; there is exactly one of each
/// in a pack, so a card is its own identity and `id` is the two-letter form.
public struct Card: Hashable, Codable, Identifiable, Sendable, CustomStringConvertible {
    public let rank: Rank
    public let suit: Suit

    public init(_ rank: Rank, _ suit: Suit) {
        self.rank = rank
        self.suit = suit
    }

    /// "QS", "TD", "9C". Nil for anything that is not a card.
    public init?(id: String) {
        guard id.count == 2 else { return nil }
        let r = String(id.prefix(1)), s = String(id.suffix(1))
        guard let rank = Rank(letter: r), let suit = Suit(rawValue: s) else { return nil }
        self.init(rank, suit)
    }

    public var id: String { rank.letter + suit.rawValue }

    /// "Queen of Spades" — what a card is called when it is read out.
    public var name: String { "\(rank.name) of \(suit.name)" }

    /// "Q♠" — what a card face shows.
    public var shortText: String { rank.shortText + suit.symbol }

    public var isRed: Bool { suit.isRed }

    public var description: String { id }

    /// Fifty-two cards: clubs, diamonds, hearts, spades, two up to ace within
    /// each. Games that use fewer cards take a subset with `deck(ranks:)`.
    public static let fullDeck: [Card] = deck(ranks: Rank.allCases)

    public static func deck(ranks: [Rank], suits: [Suit] = Suit.allCases) -> [Card] {
        suits.flatMap { s in ranks.map { Card($0, s) } }
    }
}

extension Array where Element == Card {
    public var ids: [String] { map(\.id) }

    /// "Ace of Spades, Ten of Spades and King of Hearts" — or the one name, or
    /// nothing at all for an empty list.
    public var spokenList: String { Prose.list(map(\.name)) }

    public func contains(id: String) -> Bool { contains { $0.id == id } }

    public func removing(_ card: Card) -> [Card] { filter { $0 != card } }

    public func count(of suit: Suit) -> Int { reduce(0) { $0 + ($1.suit == suit ? 1 : 0) } }
}

import Foundation

/// One thing that happened, in words. The engine writes these; the interface
/// speaks them and writes them into the log. Nothing is ever conveyed to the
/// player that did not first pass through here as text, which is what makes a
/// game playable without seeing it.
public struct GameEvent: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable {
        case deal, info, play, trick, hand, game, you, bid, score, moon, pick, count, error
    }

    public let id: Int
    public let kind: Kind
    public let text: String
    /// The seat the event is about, if it is about one.
    public let seat: Int?
    /// The cards the event concerns, so the interface can show them as well as
    /// read the sentence — a played card, the cards in a discard.
    public let cards: [Card]
    /// Nil for everybody. A number means only that seat may ever receive it:
    /// "you passed the queen" is written for one chair and must not reach the
    /// others even in a log they can scroll.
    public let audience: Int?

    public init(id: Int, kind: Kind, text: String, seat: Int? = nil, cards: [Card] = [], audience: Int? = nil) {
        self.id = id
        self.kind = kind
        self.text = text
        self.seat = seat
        self.cards = cards
        self.audience = audience
    }
}

/// The event stream every engine keeps. Append-only; ids increase by one, so
/// a reader that remembers the last id it saw can ask for what is new.
public struct EventLog: Hashable, Sendable {
    public private(set) var events: [GameEvent] = []
    private var nextId = 1

    public init() {}

    @discardableResult
    public mutating func add(_ kind: GameEvent.Kind, _ text: String, seat: Int? = nil, cards: [Card] = [], audience: Int? = nil) -> GameEvent {
        let e = GameEvent(id: nextId, kind: kind, text: text, seat: seat, cards: cards, audience: audience)
        nextId += 1
        events.append(e)
        return e
    }

    /// What one seat is entitled to hear, newer than `since`.
    public func events(for seat: Int, since: Int = 0) -> [GameEvent] {
        events.filter { $0.id > since && ($0.audience == nil || $0.audience == seat) }
    }

    public var lastId: Int { events.last?.id ?? 0 }
}

/// The answer to every action. `ok` means it happened. A refusal always says
/// why, in the words of the rule, because "nothing happened" is exactly what a
/// dropped tap feels like to somebody who cannot see the screen. `fault` means
/// the engine itself broke and the state can no longer be trusted.
public struct ActionResult: Equatable, Sendable {
    public let ok: Bool
    public let reason: String?
    public let fault: Bool

    public static let ok = ActionResult(ok: true, reason: nil, fault: false)
    public static func refused(_ reason: String) -> ActionResult { ActionResult(ok: false, reason: reason, fault: false) }
    public static func faulted(_ reason: String) -> ActionResult { ActionResult(ok: false, reason: reason, fault: true) }
}

/// Who is in a chair. A table asks whether anybody is sitting here, not
/// whether this is "the" human; a boolean true for one seat cannot answer it.
public enum Occupant: String, Codable, Hashable, Sendable {
    case human, bot
}

/// How well the computer plays. Every engine's AI takes one of these.
public enum Difficulty: String, CaseIterable, Codable, Hashable, Sendable, Identifiable {
    case easy, normal, hard
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .easy: return "Easy"
        case .normal: return "Normal"
        case .hard: return "Hard"
        }
    }
}

/// How fast the computer players move. Five rungs, the same values and words
/// in every game, so a pace chosen in one means the same in the next. The raw
/// value is milliseconds; -1 is not a duration and must never be slept on — it
/// means the game waits for a button, however long that takes.
public enum Pace: Int, CaseIterable, Codable, Hashable, Sendable, Identifiable {
    case immediate = 0
    case brisk = 900
    case comfortable = 2500
    case relaxed = 4000
    case waitForMe = -1

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .immediate: return "Immediate"
        case .brisk: return "Brisk"
        case .comfortable: return "Comfortable"
        case .relaxed: return "Relaxed"
        case .waitForMe: return "Wait for me to continue"
        }
    }

    /// The wait as a duration, for the sentence that says one is coming: "the
    /// next play comes on its own after four seconds." The label cannot be used
    /// there — "comes on its own after relaxed" is not a sentence.
    public var words: String {
        switch self {
        case .immediate: return "immediately"
        case .brisk: return "after about a second"
        case .comfortable: return "after two and a half seconds"
        case .relaxed: return "after four seconds"
        case .waitForMe: return "when you press Continue"
        }
    }

    /// Nil for wait-for-me, which is a button and not a timer.
    public var delay: Duration? {
        rawValue < 0 ? nil : .milliseconds(rawValue)
    }
}

/// Small pieces of English the engines share, so a list of cards or a plural
/// reads the same way in every game.
public enum Prose {
    /// "A", "A and B", "A, B and C".
    public static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        default: return items.dropLast().joined(separator: ", ") + " and " + items[items.count - 1]
        }
    }

    /// "1 point", "2 points".
    public static func count(_ n: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(n) " + (n == 1 ? singular : (plural ?? singular + "s"))
    }

    /// "one", "two" … up to twenty, then digits. For sentences that read
    /// better with the number spelled out.
    public static func number(_ n: Int) -> String {
        let words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                     "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
        return (0...20).contains(n) ? words[n] : String(n)
    }

    /// "first", "second", "third" … for positions in a trick or a hand.
    public static func ordinal(_ n: Int) -> String {
        let words = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]
        if (0...10).contains(n) { return words[n] }
        let suffix: String
        switch n % 100 {
        case 11, 12, 13: suffix = "th"
        default:
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }
}

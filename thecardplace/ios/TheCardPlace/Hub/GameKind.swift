import SwiftUI
import CardCore

/// The five games, and what the hub says about each.
enum GameKind: String, CaseIterable, Identifiable, Codable, Hashable {
    case hearts, euchre, spades, cribbage, sheephead

    var id: String { rawValue }

    var title: String {
        switch self {
        case .hearts: return "Hearts"
        case .euchre: return "Euchre"
        case .spades: return "Spades"
        case .cribbage: return "Cribbage"
        case .sheephead: return "Sheephead"
        }
    }

    /// One sentence for the hub, the same as the landing page.
    var tagline: String {
        switch self {
        case .hearts:
            return "Four players. Every heart is a point and the queen of spades is thirteen, and the lowest score wins."
        case .euchre:
            return "Four players in two partnerships, first to ten. The jack of trump and its colour partner are the two highest cards."
        case .spades:
            return "Four players in two partnerships. Bid before a card is played; missing the contract costs the whole bid."
        case .cribbage:
            return "Two players. Pegging, fifteens, runs and the crib, scored to 121 — and every count is read out in its parts."
        case .sheephead:
            return "Three to six players. Queens and jacks are trump, the picker takes the blind, and the jack of diamonds is a secret partner."
        }
    }

    var playersDescription: String {
        switch self {
        case .hearts, .euchre, .spades: return "Four players"
        case .cribbage: return "Two players"
        case .sheephead: return "Three to six players"
        }
    }

    /// SF Symbol for the hub row. Decorative; the row's label is the title.
    var symbol: String {
        switch self {
        case .hearts: return "suit.heart.fill"
        case .euchre: return "suit.club.fill"
        case .spades: return "suit.spade.fill"
        case .cribbage: return "number"
        case .sheephead: return "suit.diamond.fill"
        }
    }

    /// Hearts and spades open on Brisk; the other three say more per play and
    /// need more room, so they open on Relaxed.
    var defaultPace: Pace {
        switch self {
        case .hearts, .spades: return .brisk
        case .euchre, .cribbage, .sheephead: return .relaxed
        }
    }
}

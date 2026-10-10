import SwiftUI

/// The seams between the shared screens and each game's own code. Each case
/// is filled in by that game's folder under Games/.
@MainActor
enum GameRules {
    /// One sentence about this game's rule options, for the setup summary.
    static func summary(for game: GameKind, settings: AppSettings) -> String? {
        switch game {
        case .hearts: return HeartsRules.summary(settings)
        case .euchre: return EuchreRules.summary(settings)
        case .spades: return SpadesRules.summary(settings)
        case .cribbage: return CribbageRules.summary(settings)
        case .sheephead: return SheepheadRules.summary(settings)
        }
    }
}

/// The rule controls for one game, inside the settings form.
struct GameRulesSection: View {
    let game: GameKind

    var body: some View {
        switch game {
        case .hearts: HeartsRulesSection()
        case .euchre: EuchreRulesSection()
        case .spades: SpadesRulesSection()
        case .cribbage: CribbageRulesSection()
        case .sheephead: SheepheadRulesSection()
        }
    }
}

/// How to play one game.
struct GameRulesView: View {
    let game: GameKind

    var body: some View {
        switch game {
        case .hearts: HeartsRulesView()
        case .euchre: EuchreRulesView()
        case .spades: SpadesRulesView()
        case .cribbage: CribbageRulesView()
        case .sheephead: SheepheadRulesView()
        }
    }
}

/// The table for one game.
struct GameTableView: View {
    let game: GameKind

    var body: some View {
        switch game {
        case .hearts: HeartsTableView()
        case .euchre: EuchreTableView()
        case .spades: SpadesTableView()
        case .cribbage: CribbageTableView()
        case .sheephead: SheepheadTableView()
        }
    }
}

import SwiftUI
import CardCore
import HeartsEngine

/// The hearts table, on the shared screen: after the hand come this trick,
/// the last trick, the players, and the hands played. Pass, Deal and Start a
/// new game are the primary control at the lower left.
struct HeartsTableView: View {
    var body: some View {
        GameHost(make: { HeartsSession(settings: $0) }) { session, focus in
            GameScreen(game: .hearts, session: session, focusedCard: focus) {
                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                AccessibleTable(title: "Players",
                                columns: ["Player", "Score", "This hand", "Tricks"],
                                rows: session.playerRows)

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }
            }
        }
    }
}

// MARK: - rules, settings, help

@MainActor
enum HeartsRules {
    static func summary(_ settings: AppSettings) -> String? {
        let r = settings.rules(for: .hearts, default: HeartsRulesOptions())
        return "Game to \(r.pointsToWin) points."
    }
}

struct HeartsRulesSection: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Section {
            Picker("Game ends when somebody reaches", selection: Binding(
                get: { settings.rules(for: .hearts, default: HeartsRulesOptions()).pointsToWin },
                set: { settings.setRules(HeartsRulesOptions(pointsToWin: $0), for: .hearts) }
            )) {
                Text("50 points, a short game").tag(50)
                Text("100 points, the standard game").tag(100)
            }
            .pickerStyle(.inline)
        } header: {
            Text("Rules of the table")
        } footer: {
            Text("Takes effect from the next game.")
        }
    }
}

struct HeartsRulesView: View {
    var body: some View {
        HelpView(title: "How to play Hearts",
                 sections: HeartsHelp.rules.map { HelpSection(heading: $0.heading, body: $0.body) })
    }
}

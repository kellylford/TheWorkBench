import SwiftUI
import CardCore
import SpadesEngine

/// The spades table, on the shared screen: after the hand come this trick,
/// the last trick, the sides, the players, and the hands played. Bid is the
/// primary control at the lower left, with the bid stepper and Bid nil
/// beside it while it is your turn to bid.
struct SpadesTableView: View {
    var body: some View {
        GameHost(make: { SpadesSession(settings: $0) }) { session, focus in
            GameScreen(game: .spades, session: session, focusedCard: focus) {
                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                AccessibleTable(title: "Sides",
                                columns: ["Side", "Score", "Bags", "Bid this hand", "Tricks this hand"],
                                rows: session.sideRows)

                AccessibleTable(title: "Players",
                                columns: ["Player", "Bid", "Tricks"],
                                rows: session.playerRows)

                AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows,
                                empty: "No hand has been played yet.")
            } extras: {
                if session.state.phase == .bidding, session.isMyTurn {
                    BidStepper(session: session, focus: focus)
                }
            }
        }
    }
}

/// The number to bid, one to thirteen. Nil is its own button so it can never
/// be reached by accident.
private struct BidStepper: View {
    let session: SpadesSession
    var focus: AccessibilityFocusState<String?>.Binding

    var body: some View {
        Stepper(value: Binding(get: { session.bidValue }, set: { session.bidValue = $0 }),
                in: session.bidRange) {
            Text("Bid: \(session.bidValue)")
        }
        .fixedSize()
        .accessibilityLabel("Your bid")
        .accessibilityValue(Prose.count(session.bidValue, "trick"))
        .accessibilityFocused(focus, equals: SpadesSession.bidFocus)
    }
}

// MARK: - rules, settings, help

@MainActor
enum SpadesRules {
    static func summary(_ settings: AppSettings) -> String? {
        let r = settings.rules(for: .spades, default: SpadesRulesOptions())
        return "Game to \(r.pointsToWin) points."
    }
}

struct SpadesRulesSection: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Section {
            Picker("Game ends when a partnership reaches", selection: Binding(
                get: { settings.rules(for: .spades, default: SpadesRulesOptions()).pointsToWin },
                set: { settings.setRules(SpadesRulesOptions(pointsToWin: $0), for: .spades) }
            )) {
                Text("250 points, a short game").tag(250)
                Text("500 points, the standard game").tag(500)
            }
            .pickerStyle(.inline)
        } header: {
            Text("Rules of the table")
        } footer: {
            Text("Takes effect from the next game.")
        }
    }
}

struct SpadesRulesView: View {
    var body: some View {
        HelpView(title: "How to play Spades",
                 sections: SpadesHelp.rules.map { HelpSection(heading: $0.heading, body: $0.body) })
    }
}

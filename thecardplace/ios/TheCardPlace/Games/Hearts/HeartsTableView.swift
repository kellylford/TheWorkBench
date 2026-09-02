import SwiftUI
import CardCore
import HeartsEngine

/// The hearts table. Reading order, top to bottom: the status, the last
/// announcement, what you can do, your hand, this trick, the last trick, the
/// players, the hands played, and the log. Every part is under a heading.
struct HeartsTableView: View {
    @Environment(AppSettings.self) private var settings
    @State private var session: HeartsSession?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                HeartsTable(session: session, focusedCard: $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = HeartsSession(settings: settings) }
        }
        .onDisappear { session?.stop() }
    }
}

private struct HeartsTable: View {
    let session: HeartsSession
    var focusedCard: AccessibilityFocusState<String?>.Binding

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                StatusLine(text: session.status)
                AnnouncementLine(announcer: session.announcer)

                SectionHeader("What you can do")
                actions

                SectionHeader("Your hand")
                HandView(items: session.handItems, hint: session.handHint, focus: focusedCard) { item in
                    session.tap(item)
                }

                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                AccessibleTable(title: "Players",
                                columns: ["Player", "Score", "This hand", "Tricks"],
                                rows: session.playerRows,
                                footnote: "Lowest score wins. The game ends when somebody reaches \(HeartsGame.target(of: session.state)).")

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }

                LogSection(entries: session.log)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .gameChrome(game: .hearts, reviews: session.reviews, announcer: session.announcer) {
            session.newGame()
        }
        .onChange(of: session.focusTick) {
            focusedCard.wrappedValue = session.focusCard
        }
    }

    @ViewBuilder
    private var actions: some View {
        let state = session.state
        switch state.phase {
        case .passing:
            if state.passing[HeartsSession.me] == nil {
                Text("Choose three cards below to pass \(state.passDirection == .across ? "across" : "to the \(state.passDirection.rawValue)"), then Pass.")
                PrimaryButton(title: "Pass \(session.selected.count) of 3", enabled: session.selected.count == HeartsGame.passCount) {
                    session.passSelected()
                }
            } else {
                Text("Your cards are in. Waiting for the others to pass.")
            }
        case .play:
            if session.isMyTurn {
                Text("Choose a card to play.")
            } else {
                Text("Waiting for \(session.name(state.turn)).")
                ContinueBar(gate: session.gate, pace: session.pace)
            }
        case .handOver:
            PrimaryButton(title: "Deal the next hand", key: "n") { session.nextHand() }
        case .gameOver:
            PrimaryButton(title: "Start a new game") { session.newGame() }
        case .idle:
            Text("Dealing…")
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

import SwiftUI
import CardCore
import SpadesEngine

/// The spades table. Reading order, top to bottom: the status, the last
/// announcement, what you can do, your hand, this trick, the last trick, the
/// sides, the players, the hands played, and the log. Every part is under a
/// heading.
struct SpadesTableView: View {
    @Environment(AppSettings.self) private var settings
    @State private var session: SpadesSession?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                SpadesTable(session: session, focusedCard: $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = SpadesSession(settings: settings) }
        }
        .onDisappear { session?.stop() }
    }
}

private struct SpadesTable: View {
    let session: SpadesSession
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

                AccessibleTable(title: "Sides",
                                columns: ["Side", "Score", "Bags", "Bid this hand", "Tricks this hand"],
                                rows: session.sideRows,
                                footnote: "Ten points a trick for a made contract, the whole bid off for a missed one. Every trick over the bid is a bag; \(SpadesGame.bagLimit(of: session.state)) bags cost \(SpadesGame.bagPenalty(of: session.state)) points. The game ends when a side reaches \(SpadesGame.target(of: session.state)).")

                AccessibleTable(title: "Players",
                                columns: ["Player", "Bid", "Tricks"],
                                rows: session.playerRows)

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }

                LogSection(entries: session.log)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .gameChrome(game: .spades, reviews: session.reviews, announcer: session.announcer) {
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
        case .bidding:
            if session.isMyTurn {
                bidding
            } else {
                Text("Waiting for \(session.name(state.turn)) to bid.")
            }
        case .play:
            if session.isMyTurn {
                Text("Choose a card to play.")
            } else {
                Text("Waiting for \(session.name(state.turn)).")
                ContinueBar(gate: session.gate, pace: session.pace)
            }
        case .handOver:
            Text("Hand \(state.dealNumber) is over. \(session.handResult)")
            PrimaryButton(title: "Deal the next hand", key: "n") { session.nextHand() }
        case .gameOver:
            PrimaryButton(title: "Start a new game") { session.newGame() }
        case .idle:
            Text("Dealing…")
        }
    }

    /// The bid: a stepper for one to thirteen, a button that says the number
    /// it will bid, and nil on its own so it can never be reached by accident.
    @ViewBuilder
    private var bidding: some View {
        let partner = session.partner
        Text("How many tricks will you take? Read your hand below, then Bid.")
        if let b = partner.bid {
            Text("\(partner.name), your partner, bid \(session.bidWord(b)).")
        } else {
            Text("\(partner.name), your partner, has not bid yet.")
        }
        Stepper(value: Binding(get: { session.bidValue }, set: { session.bidValue = $0 }),
                in: session.bidRange) {
            Text("Your bid: \(session.bidValue)")
        }
        .accessibilityLabel("Your bid")
        .accessibilityValue(Prose.count(session.bidValue, "trick"))
        .accessibilityFocused(focusedCard, equals: SpadesSession.bidFocus)
        PrimaryButton(title: "Bid \(session.bidValue)") { session.bid() }
        Button {
            session.bidNil()
        } label: {
            Text("Bid nil")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .accessibilityHint("Promises to take no tricks at all: \(SpadesGame.nilValue(of: session.state)) points if you manage it, \(SpadesGame.nilValue(of: session.state)) off if you take one")
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

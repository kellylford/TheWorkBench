import SwiftUI
import CardCore
import EuchreEngine

/// The euchre table. Reading order, top to bottom: the status, the last
/// announcement, what you can do, your hand, the dealer's discard once the
/// hand is over, this trick, the last trick, the scores by side, the players,
/// the hands played, and the log. Every part is under a heading.
struct EuchreTableView: View {
    @Environment(AppSettings.self) private var settings
    @State private var session: EuchreSession?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                EuchreTable(session: session, focusedCard: $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = EuchreSession(settings: settings) }
        }
        .onDisappear { session?.stop() }
    }
}

private struct EuchreTable: View {
    let session: EuchreSession
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

                if let reveal = session.revealText {
                    RevealSection(text: reveal, cards: session.revealCards)
                }

                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                AccessibleTable(title: "Scores",
                                columns: EuchreSession.sideColumns,
                                rows: session.sideRows,
                                footnote: "First side to \(session.state.config.pointsToWin) points wins. Three tricks make it; all five is a march.")

                AccessibleTable(title: "Players",
                                columns: EuchreSession.playerColumns,
                                rows: session.playerRows)

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: EuchreSession.historyColumns, rows: session.historyRows)
                }

                LogSection(entries: session.log)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .gameChrome(game: .euchre, reviews: session.reviews, announcer: session.announcer) {
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
        case .idle:
            Text("Dealing…")

        case .bid1:
            if session.isMyTurn, let up = state.upcard {
                Text("The \(up.name) is on offer. \(session.isDealer ? "Pick it up" : "Order it up") to make \(up.suit.lowerName) trump, or pass.")
                PrimaryButton(title: session.isDealer ? "Pick it up" : "Order it up") {
                    session.orderUp(alone: false)
                }
                if session.allowAlone {
                    PrimaryButton(title: "\(session.isDealer ? "Pick it up" : "Order it up") and go alone") {
                        session.orderUp(alone: true)
                    }
                }
                PrimaryButton(title: "Pass") { session.pass() }
            } else {
                Text("Waiting for \(session.waitingFor ?? "the table") to bid.")
            }

        case .bid2:
            if session.isMyTurn {
                @Bindable var session = session
                Text("\(state.deniedSuit?.name ?? "The upcard") cannot be named. Call a suit, or pass.")
                if session.allowAlone {
                    Toggle("Go alone", isOn: $session.goAlone)
                        .accessibilityHint("Applies to the suit you call")
                }
                ForEach(session.callableSuits, id: \.self) { suit in
                    PrimaryButton(title: "Call \(suit.lowerName)") { session.callSuit(suit) }
                }
                if session.mustCall {
                    Text("Stick the dealer is on. You are the dealer and everybody passed, so you must name a suit; Pass is not available.")
                        .font(.callout)
                }
                PrimaryButton(title: "Pass", enabled: !session.mustCall) { session.pass() }
            } else {
                Text("Waiting for \(session.waitingFor ?? "the table") to bid.")
            }

        case .discard:
            if session.isDealer {
                Text("Choose the card to put back. You hold six and may keep five.")
            } else {
                Text("Waiting for \(session.waitingFor ?? "the dealer") to put a card back.")
            }

        case .play:
            if session.isSittingOut {
                Text("You are sitting out this hand while \(session.makerName) plays alone. The others play it out.")
                ContinueBar(gate: session.gate, pace: session.pace)
            } else if session.isMyTurn {
                Text("Choose a card to play.")
                if !session.playHint.isEmpty {
                    Text(session.playHint).font(.callout).foregroundStyle(.secondary)
                }
            } else {
                Text("Waiting for \(session.name(state.turn)).")
                ContinueBar(gate: session.gate, pace: session.pace)
            }

        case .handOver:
            if !session.handResult.isEmpty {
                Text(session.handResult)
            }
            PrimaryButton(title: "Deal the next hand", key: "n") { session.nextHand() }

        case .gameOver:
            if !session.handResult.isEmpty {
                Text(session.handResult)
            }
            PrimaryButton(title: "Start a new game") { session.newGame() }
        }
    }
}

/// What was face down, once the hand is over: the upcard, the card the dealer
/// put back, and the kitty. One row per card, each a single sentence to
/// VoiceOver: "Put back: Nine of Clubs".
private struct RevealSection: View {
    let text: String
    let cards: [PlayedCard]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader("The dealer's discard")
            Text(text).font(.callout)
            ForEach(cards) { row in
                HStack(spacing: 10) {
                    if let card = row.card {
                        CardFace(card: card, compact: true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.player).font(.subheadline.weight(.semibold))
                        Text(row.description).font(.subheadline)
                        if let note = row.note {
                            Text(note).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.player + ": " + row.description + (row.note.map { ", " + $0 } ?? ""))
            }
        }
    }
}

// MARK: - rules, settings, help

@MainActor
enum EuchreRules {
    static func summary(_ settings: AppSettings) -> String? {
        let r = settings.rules(for: .euchre, default: EuchreRulesOptions())
        return "Game to \(r.pointsToWin) points. Stick the dealer \(r.stickTheDealer ? "on" : "off"). " +
            (r.allowAlone ? "Going alone allowed." : "No going alone.")
    }
}

struct EuchreRulesSection: View {
    @Environment(AppSettings.self) private var settings

    private var rules: EuchreRulesOptions {
        settings.rules(for: .euchre, default: EuchreRulesOptions())
    }

    private func update(_ change: (inout EuchreRulesOptions) -> Void) {
        var r = rules
        change(&r)
        settings.setRules(r, for: .euchre)
    }

    var body: some View {
        Section {
            Picker("Game is played to", selection: Binding(
                get: { rules.pointsToWin },
                set: { v in update { $0.pointsToWin = v } }
            )) {
                Text("5 points, a quick game").tag(5)
                Text("10 points, the standard game").tag(10)
                Text("11 points").tag(11)
                Text("15 points, a longer game").tag(15)
            }
            .pickerStyle(.inline)
            Toggle("Stick the dealer", isOn: Binding(
                get: { rules.stickTheDealer },
                set: { v in update { $0.stickTheDealer = v } }
            ))
            Toggle("Allow going alone", isOn: Binding(
                get: { rules.allowAlone },
                set: { v in update { $0.allowAlone = v } }
            ))
        } header: {
            Text("Rules of the table")
        } footer: {
            Text("Stick the dealer: if everybody passes twice the dealer must name a suit, so no hand is thrown in. Going alone: whoever makes trump may send their partner out, for four points if they take all five tricks. Takes effect from the next game.")
        }
    }
}

struct EuchreRulesView: View {
    var body: some View {
        HelpView(title: "How to play Euchre",
                 sections: EuchreHelp.rules.map { HelpSection(heading: $0.heading, body: $0.body) })
    }
}

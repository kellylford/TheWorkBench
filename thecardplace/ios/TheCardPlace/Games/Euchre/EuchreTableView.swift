import SwiftUI
import CardCore
import EuchreEngine

/// The euchre table, on the shared screen: after the hand come the dealer's
/// discard once the hand is over, this trick, the last trick, the scores by
/// side, the players, and the hands played. Pass is the primary control at
/// the lower left while bidding; ordering up, calling a suit and going alone
/// are the choices beside it.
struct EuchreTableView: View {
    var body: some View {
        GameHost(make: { EuchreSession(settings: $0) }) { session, focus in
            GameScreen(game: .euchre, session: session, focusedCard: focus) {
                RevealSection(text: session.revealText, cards: session.revealCards)

                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                AccessibleTable(title: "Scores",
                                columns: EuchreSession.sideColumns,
                                rows: session.sideRows)

                AccessibleTable(title: "Players",
                                columns: EuchreSession.playerColumns,
                                rows: session.playerRows)

                AccessibleTable(title: "Hands played", columns: EuchreSession.historyColumns, rows: session.historyRows,
                                empty: "No hand has been played yet.")
            } extras: {
                if session.state.phase == .bid2, session.isMyTurn, session.allowAlone {
                    GoAloneToggle(session: session)
                }
            }
        }
    }
}

/// The "Go alone" switch in the naming round. Applies to the suit you call.
private struct GoAloneToggle: View {
    let session: EuchreSession

    var body: some View {
        @Bindable var session = session
        Toggle("Go alone", isOn: $session.goAlone)
            .fixedSize()
            .accessibilityHint("Applies to the suit you call")
    }
}

/// What was face down, once the hand is over: the upcard, the card the dealer
/// put back, and the kitty. One row per card, each a single sentence to
/// VoiceOver: "Put back: Nine of Clubs". The section is on screen from the
/// deal, so it is always in the same place; it just has nothing to say yet.
private struct RevealSection: View {
    let text: String?
    let cards: [PlayedCard]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader("The dealer's discard")
            if let text {
                Text(text).font(.callout)
            } else {
                Text("Shown once the hand is over.").foregroundStyle(.secondary)
            }
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

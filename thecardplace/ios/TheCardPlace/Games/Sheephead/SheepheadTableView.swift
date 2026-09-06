import SwiftUI
import CardCore
import SheepheadEngine

/// The sheephead table, on the shared screen: after the hand come this trick,
/// the last trick, the blind and the bury once the hand is over, the players,
/// and the hands played. Pass is the primary control at the lower left while
/// picking, with Pick up the blind beside it; Bury and Deal take its place in
/// their phases.
struct SheepheadTableView: View {
    var body: some View {
        GameHost(make: { SheepheadSession(settings: $0) }) { session, focus in
            GameScreen(game: .sheephead, session: session, focusedCard: focus) {
                TrickList(title: "This trick", plays: session.trickPlays)
                TrickList(title: "Last completed trick", plays: session.lastTrickPlays, empty: "No trick has been completed yet.")

                if session.state.phase == .handOver {
                    BlindAndBury(session: session)
                }

                AccessibleTable(title: "Players",
                                columns: ["Player", "Role", "Tricks", "Points this hand", "Score"],
                                rows: session.playerRows)

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }
            }
        }
    }
}

/// Once the hand is scored, the blind as it was dealt and what the picker
/// buried, card by card. During play it is nobody's business, and the
/// session gives nothing back until then.
private struct BlindAndBury: View {
    let session: SheepheadSession

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("The blind and the bury")
            Text(session.blindReveal)
                .font(.callout)
            CardRow(title: "Blind", cards: session.revealedBlind, empty: "Nothing.")
            if !session.revealedBury.isEmpty {
                CardRow(title: "Buried", cards: session.revealedBury, empty: "Nothing was buried.")
            }
        }
    }
}

/// A short row of cards with a caption, read as one sentence:
/// "Blind: Ace of Clubs, trump, 11 points; Nine of Hearts, Hearts fail, 0 points."
private struct CardRow: View {
    let title: String
    let cards: [Card]
    var empty: String = "Nothing."

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold))
            if cards.isEmpty {
                Text(empty).font(.subheadline).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 8) {
                    ForEach(cards) { card in
                        VStack(spacing: 2) {
                            CardFace(card: card, badge: SheepheadCards.isTrump(card) ? "trump" : "\(SheepheadCards.points(card)) pts")
                            Text(card.name).font(.caption2)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String {
        if cards.isEmpty { return "\(title): \(empty)" }
        return "\(title): " + cards.map(SheepheadCards.describe).joined(separator: "; ") + "."
    }
}

// MARK: - rules, settings, help

@MainActor
enum SheepheadRules {
    static func summary(_ settings: AppSettings) -> String? {
        let r = settings.rules(for: .sheephead, default: SheepheadRulesOptions())
        var parts = ["\(Prose.number(r.players).capitalized) players."]
        parts.append(r.allPass == .leaster ? "If everyone passes, a leaster." : "If everyone passes, the hand is redealt.")
        var doublers: [String] = []
        if r.blackQueenDoubler { doublers.append("black queens") }
        if r.redQueenDoubler { doublers.append("red queens") }
        if r.redealDoubler { doublers.append("a redeal") }
        if !doublers.isEmpty { parts.append("Doublers: " + Prose.list(doublers) + ".") }
        return parts.joined(separator: " ")
    }
}

struct SheepheadRulesSection: View {
    @Environment(AppSettings.self) private var settings

    private var options: Binding<SheepheadRulesOptions> {
        Binding(
            get: { settings.rules(for: .sheephead, default: SheepheadRulesOptions()) },
            set: { settings.setRules($0, for: .sheephead) }
        )
    }

    var body: some View {
        Section {
            Picker("Players at the table", selection: options.players) {
                Text("3 players, ten cards each, the picker always alone").tag(3)
                Text("4 players, seven cards each").tag(4)
                Text("5 players, six cards each, the usual game").tag(5)
                Text("6 players, five cards each").tag(6)
            }
            .pickerStyle(.inline)
        } header: {
            Text("Rules of the table")
        } footer: {
            Text("Takes effect from the next game.")
        }

        Section {
            Picker("When everyone passes", selection: options.allPass) {
                Text("Leaster: no picker, everyone for themselves, fewest points wins").tag(SheepheadConfig.AllPass.leaster)
                Text("Throw the hand in and deal again").tag(SheepheadConfig.AllPass.redeal)
            }
            .pickerStyle(.inline)
        } header: {
            Text("When everyone passes")
        }

        Section {
            Toggle("Both black queens double the hand", isOn: options.blackQueenDoubler)
            Toggle("Both red queens double the hand", isOn: options.redQueenDoubler)
            Toggle("A redeal doubles the next hand", isOn: options.redealDoubler)
        } header: {
            Text("Doublers")
        } footer: {
            Text("A pair of queens counts only in one player's own hand after the bury. Doublers stack to four times, never more.")
        }
    }
}

struct SheepheadRulesView: View {
    var body: some View {
        HelpView(title: "How to play Sheephead",
                 sections: SheepheadHelp.rules.map { HelpSection(heading: $0.heading, body: $0.body) })
    }
}

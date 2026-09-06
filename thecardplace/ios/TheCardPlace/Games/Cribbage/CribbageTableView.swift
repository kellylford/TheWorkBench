import SwiftUI
import CardCore
import CribbageEngine

/// The cribbage table, on the shared screen: after the hand come the play,
/// the starter, the crib, the count while hands are being counted, the
/// scores, and the hands played. Cut, Throw, Go, Next and Deal take turns as
/// the primary control at the lower left.
struct CribbageTableView: View {
    var body: some View {
        GameHost(make: { CribbageSession(settings: $0) }) { session, focus in
            GameScreen(game: .cribbage, session: session, focusedCard: focus) {
                PlayPile(title: "The play", count: session.countText, plays: session.runPlays, empty: session.playEmptyText)

                SectionHeader("The starter")
                CardLine(card: session.state.starter, text: session.starterText)

                SectionHeader("The crib")
                if session.cribRevealed {
                    CardRow(cards: CribbageCards.sortHand(session.state.crib), text: session.cribText)
                } else {
                    Text(session.cribText)
                }

                if session.state.phase == .count {
                    CountSection(session: session)
                }

                AccessibleTable(title: "Scores",
                                columns: ["Player", "Score", "To go"],
                                rows: session.scoreRows)
                if let games = session.gamesWonText {
                    Text(games).font(.callout)
                }
                if let last = session.lastCountText {
                    Text("Last count: \(last)")
                        .font(.callout)
                        .accessibilityLabel("Last count. \(last)")
                }

                if !session.historyRows.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }
            }
        }
    }
}

/// While the hands are counted: whose cards are up next, the cards when they
/// are face up, and each count so far as it was read out.
private struct CountSection: View {
    let session: CribbageSession

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader("The count")
            Text(session.countStageText)
            if !session.countStageCards.isEmpty {
                CardRow(cards: session.countStageCards, text: nil)
            }
            ForEach(Array(session.countBreakdowns.enumerated()), id: \.offset) { _, line in
                Text(line).font(.callout)
            }
        }
    }
}

/// The cards down this sequence, one row per play, each row a single
/// sentence to VoiceOver: "Ruth: Ten of Hearts, led". The running count sits
/// under the heading, before the cards, because it is what a player asks
/// first.
private struct PlayPile: View {
    let title: String
    let count: String
    let plays: [PlayedCard]
    var empty: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title)
            Text(count).font(.body.weight(.medium))
            if plays.isEmpty {
                Text(empty).foregroundStyle(.secondary)
            } else {
                ForEach(plays) { play in
                    HStack(spacing: 10) {
                        if let card = play.card {
                            CardFace(card: card, compact: true)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(play.player).font(.subheadline.weight(.semibold))
                            Text(play.description).font(.subheadline)
                            if let note = play.note {
                                Text(note).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(play.note.map { "\(play.player): \(play.description), \($0)" } ?? "\(play.player): \(play.description)")
                }
            }
        }
    }
}

/// One card with a sentence beside it: the starter. The sentence is the
/// label; the picture is decoration.
private struct CardLine: View {
    let card: Card?
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            if let card {
                CardFace(card: card, compact: true)
            }
            Text(text)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

/// A row of face-up cards nobody can act on — a hand being counted, the crib
/// once it is turned. Read as one sentence.
private struct CardRow: View {
    let cards: [Card]
    let text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let text { Text(text) }
            FlowLayout(spacing: 6) {
                ForEach(cards, id: \.id) { card in
                    CardFace(card: card, compact: true)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text ?? CribbageCards.listNames(cards))
    }
}

// MARK: - rules, settings, help

@MainActor
enum CribbageRules {
    static func summary(_ settings: AppSettings) -> String? {
        let r = settings.rules(for: .cribbage, default: CribbageRulesOptions())
        return "Game to \(r.targetScore)."
    }
}

struct CribbageRulesSection: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Section {
            Picker("Game ends when somebody reaches", selection: Binding(
                get: { settings.rules(for: .cribbage, default: CribbageRulesOptions()).targetScore },
                set: { settings.setRules(CribbageRulesOptions(targetScore: $0), for: .cribbage) }
            )) {
                Text("121, the standard game").tag(121)
                Text("61, once round the board").tag(61)
            }
            .pickerStyle(.inline)
        } header: {
            Text("Rules of the table")
        } footer: {
            Text("Takes effect from the next game.")
        }
    }
}

struct CribbageRulesView: View {
    var body: some View {
        HelpView(title: "How to play Cribbage",
                 sections: CribbageHelp.rules.map { HelpSection(heading: $0.heading, body: $0.body) })
    }
}

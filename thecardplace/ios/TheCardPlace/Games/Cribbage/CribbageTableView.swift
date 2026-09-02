import SwiftUI
import CardCore
import CribbageEngine

/// The cribbage table. Reading order, top to bottom: the status, the last
/// announcement, what you can do, your hand, the play, the starter, the crib,
/// the scores, the hands played, and the log. Every part is under a heading.
struct CribbageTableView: View {
    @Environment(AppSettings.self) private var settings
    @State private var session: CribbageSession?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                CribbageTable(session: session, focusedCard: $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = CribbageSession(settings: settings) }
        }
        .onDisappear { session?.stop() }
    }
}

private struct CribbageTable: View {
    let session: CribbageSession
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

                PlayPile(title: "The play", count: session.countText, plays: session.runPlays, empty: session.playEmptyText)

                SectionHeader("The starter")
                CardLine(card: session.state.starter, text: session.starterText)

                SectionHeader("The crib")
                if session.cribRevealed {
                    CardRow(cards: CribbageCards.sortHand(session.state.crib), text: session.cribText)
                } else {
                    Text(session.cribText)
                }

                AccessibleTable(title: "Scores",
                                columns: ["Player", "Score", "To go"],
                                rows: session.scoreRows,
                                footnote: "First to \(session.target) wins; the game ends the moment somebody reaches it.")
                if let games = session.gamesWonText {
                    Text(games).font(.callout)
                }
                if let last = session.lastCountText {
                    Text("Last count: \(last)")
                        .font(.callout)
                        .accessibilityLabel("Last count. \(last)")
                }

                if !session.historyRows.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows,
                                    footnote: "The scores at the end of each hand.")
                }

                LogSection(entries: session.log)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .gameChrome(game: .cribbage, reviews: session.reviews, announcer: session.announcer) {
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
            Text("Starting…")
        case .cutForDeal:
            Text(state.cutForDeal?.tie == true
                 ? "That was a tie. Cut again; the lower card deals."
                 : "Cut for deal. The lower card deals and takes the first crib.")
            PrimaryButton(title: "Cut for deal") { session.cut() }
        case .discard:
            if !session.hasThrown {
                Text("Choose two cards to throw to \(session.cribOwner), then Throw.")
                PrimaryButton(title: "Throw \(session.selected.count) of 2 to the crib", enabled: session.selected.count == 2) {
                    session.throwSelected()
                }
            } else {
                Text("Your two are in the crib. Waiting for \(session.opponent.name).")
            }
        case .play:
            if session.isMyTurn {
                if session.mustSayGo {
                    Text("You cannot play under thirty-one. Say Go.")
                    PrimaryButton(title: "Go") { session.sayGo() }
                } else {
                    Text("Choose a card to play.")
                }
            } else {
                Text("Waiting for \(session.name(state.turn)).")
                ContinueBar(gate: session.gate, pace: session.pace)
            }
        case .count:
            if session.isMyTurn {
                Text(session.countStageText)
                if !session.countStageCards.isEmpty {
                    CardRow(cards: session.countStageCards, text: nil)
                }
                ForEach(Array(session.countBreakdowns.enumerated()), id: \.offset) { _, line in
                    Text(line).font(.callout)
                }
                PrimaryButton(title: "Next", key: "n") { session.next() }
                Text(state.countStage == 2 ? "Next turns the crib over and counts it." : "Next counts this hand and reads the score out in its parts.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Waiting for \(session.name(state.turn)) to count.")
                ForEach(Array(session.countBreakdowns.enumerated()), id: \.offset) { _, line in
                    Text(line).font(.callout)
                }
                ContinueBar(gate: session.gate, pace: session.pace)
            }
        case .roundOver:
            Text(CribbageReview.handSummary(state, seat: CribbageSession.me).sentenceCased)
            PrimaryButton(title: "Deal the next hand", key: "n") { session.nextHand() }
        case .gameOver:
            Text(CribbageReview.handSummary(state, seat: CribbageSession.me).sentenceCased)
            if let games = session.gamesWonText { Text(games) }
            PrimaryButton(title: "Deal another game", key: "n") { session.nextHand() }
            Button("Start over from the cut") { session.newGame() }
                .frame(minHeight: 44)
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

import SwiftUI
import CardCore
import SheepheadEngine

/// The sheephead table. Reading order, top to bottom: the status, the last
/// announcement, what you can do, your hand, this trick, the last trick, the
/// blind and the bury once the hand is over, the players, the hands played,
/// and the log. Every part is under a heading.
struct SheepheadTableView: View {
    @Environment(AppSettings.self) private var settings
    @State private var session: SheepheadSession?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                SheepheadTable(session: session, focusedCard: $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = SheepheadSession(settings: settings) }
        }
        .onDisappear { session?.stop() }
    }
}

private struct SheepheadTable: View {
    let session: SheepheadSession
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

                if session.state.phase == .handOver {
                    blindAndBury
                }

                AccessibleTable(title: "Players",
                                columns: ["Player", "Role", "Tricks", "Points this hand", "Score"],
                                rows: session.playerRows,
                                footnote: "The picker's side needs 61 of the 120 points. Partner and alone are shown only once the Jack of Diamonds has been played, or for your own seat.")

                if !session.state.history.isEmpty {
                    AccessibleTable(title: "Hands played", columns: session.historyColumns, rows: session.historyRows)
                }

                LogSection(entries: session.log)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .gameChrome(game: .sheephead, reviews: session.reviews, announcer: session.announcer) {
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
        case .pick:
            if session.isMyTurn {
                Text("The blind has \(Prose.count(state.spec.blind, "card")). Pick it up and become the picker, or pass.")
                PrimaryButton(title: "Pick up the blind") { session.pick() }
                Button {
                    session.pass()
                } label: {
                    Text("Pass")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            } else {
                Text("Waiting for \(session.name(state.turn)) to pick or pass.")
            }
        case .bury:
            if session.isPicker {
                Text("Choose \(Prose.number(session.buryCount)) cards to bury, then Bury.")
                PrimaryButton(title: "Bury \(session.selected.count) of \(session.buryCount)",
                              enabled: session.selected.count == session.buryCount) {
                    session.burySelected()
                }
            } else {
                Text("Waiting for \(session.name(state.picker ?? state.turn)) to bury.")
            }
        case .play:
            if session.isMyTurn {
                Text("Choose a card to play.")
            } else {
                Text("Waiting for \(session.name(state.turn)).")
                ContinueBar(gate: session.gate, pace: session.pace)
            }
        case .handOver:
            if !session.resultHeadline.isEmpty {
                Text(session.resultHeadline)
                    .font(.body.weight(.medium))
            }
            PrimaryButton(title: "Deal the next hand", key: "n") { session.nextHand() }
        case .idle:
            Text("Dealing…")
        }
    }

    /// Once the hand is scored, the blind as it was dealt and what the picker
    /// buried, card by card. During play it is nobody's business, and the
    /// session gives nothing back until then.
    @ViewBuilder
    private var blindAndBury: some View {
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

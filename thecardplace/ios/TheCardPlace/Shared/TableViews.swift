import SwiftUI
import CardCore

/// A heading VoiceOver can jump to with the rotor. Every part of a game
/// screen — what you can do, your hand, the trick, the scores, the log — sits
/// under one, so a player can move between them without swiping through
/// everything in between.
struct SectionHeader: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.title3.weight(.semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 10)
            .accessibilityAddTraits(.isHeader)
    }
}

/// One sentence about where the game is. Not a live region: the announcer
/// already says what changed, and reading the status as well would say it
/// twice.
struct StatusLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("Status. \(text)")
    }
}

/// The most recent announcement, as text, with a button to hear it again.
/// For a sighted player it is the running commentary; for a VoiceOver user
/// it is where to look for the message that was interrupted.
struct AnnouncementLine: View {
    let announcer: Announcer

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Last announcement")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(announcer.lastText.isEmpty ? "Nothing yet." : announcer.lastText)
                    .font(.callout)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            Button {
                announcer.repeatLast()
            } label: {
                Label("Repeat", systemImage: "arrow.counterclockwise")
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Repeat the last announcement")
            .keyboardShortcut("r", modifiers: [])
        }
    }
}

/// A card somebody played, for the trick and the last trick.
struct PlayedCard: Identifiable, Equatable {
    let id: String
    /// Who played it.
    let player: String
    let card: Card?
    /// The card as read out, from the engine.
    let description: String
    /// "winning so far", "took the trick", "led".
    var note: String? = nil

    init(id: String, player: String, card: Card?, description: String, note: String? = nil) {
        self.id = id
        self.player = player
        self.card = card
        self.description = description
        self.note = note
    }
}

/// The cards on the table, one row per play, each row a single sentence to
/// VoiceOver: "Ruth: Ten of Hearts, winning so far".
struct TrickList: View {
    let title: String
    let plays: [PlayedCard]
    var empty: String = "Nothing played yet."

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title)
            if plays.isEmpty {
                Text(empty)
                    .foregroundStyle(.secondary)
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
                    .accessibilityLabel(rowLabel(play))
                }
            }
        }
    }

    private func rowLabel(_ play: PlayedCard) -> String {
        var s = "\(play.player): \(play.description)"
        if let note = play.note { s += ", \(note)" }
        return s
    }
}

/// A small table read row by row: "Ruth: score 12, tricks 3". A number that
/// belongs to a player is read with the player, not as a column of numbers.
struct AccessibleTable: View {
    let title: String
    let columns: [String]
    let rows: [[String]]
    var footnote: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title)
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                GridRow {
                    ForEach(columns, id: \.self) { c in
                        Text(c).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Columns: " + columns.joined(separator: ", "))
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { i, cell in
                            Text(cell).font(i == 0 ? .body.weight(.semibold) : .body)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(rowLabel(row))
                }
            }
            if let footnote {
                Text(footnote).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func rowLabel(_ row: [String]) -> String {
        guard !row.isEmpty else { return "" }
        var parts: [String] = []
        for i in 1..<min(row.count, columns.count) {
            parts.append("\(columns[i]) \(row[i])")
        }
        return row[0] + (parts.isEmpty ? "" : ": " + parts.joined(separator: ", "))
    }
}

/// One line of the log.
struct LogEntry: Identifiable, Equatable {
    let id: Int
    let text: String
}

/// "What has happened", newest first. Deliberately not a live region: it
/// carries the same words the announcer speaks, and making it live would say
/// everything twice.
struct LogSection: View {
    let entries: [LogEntry]
    @State private var showAll = false
    private let visible = 40

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader("What has happened")
            if entries.isEmpty {
                Text("Nothing yet.").foregroundStyle(.secondary)
            }
            ForEach(showAll ? entries : Array(entries.prefix(visible))) { entry in
                Text(entry.text)
                    .font(.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !showAll, entries.count > visible {
                Button("Show all \(entries.count) entries") { showAll = true }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What has happened, newest first")
    }
}

/// One of the things a player can ask to hear. The key is for a hardware
/// keyboard; the button in the Review menu is for everybody else.
struct ReviewItem: Identifiable {
    let id: String
    let title: String
    let key: Character?
    let text: () -> String

    init(_ title: String, key: Character? = nil, text: @escaping () -> String) {
        self.id = title
        self.title = title
        self.key = key
        self.text = text
    }
}

/// The Review menu: everything a screen reader user asks for most, as buttons.
struct ReviewMenu: View {
    let items: [ReviewItem]
    let announcer: Announcer

    var body: some View {
        Menu {
            ForEach(items) { item in
                Button(item.title) {
                    announcer.request(item.text())
                }
                .keyboardShortcut(item.key.map { KeyboardShortcut(KeyEquivalent($0), modifiers: []) })
            }
            Divider()
            Button("Repeat the last announcement") { announcer.repeatLast() }
        } label: {
            Label("Review", systemImage: "text.bubble")
        }
        .accessibilityHint("Read out the hand, the trick, the scores and more")
    }
}

/// Shown while the game is paused between computer turns.
struct ContinueBar: View {
    let gate: PaceGate
    let pace: Pace
    var label: String = "Continue"

    var body: some View {
        if gate.waiting {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    gate.continueNow()
                } label: {
                    Text(label)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut("n", modifiers: [])
                Text(pace == .waitForMe
                     ? "The game waits until you press Continue."
                     : "The next play comes on its own \(pace.words). Continue does not wait.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// A big obvious action: Pass, Deal, Bid.
///
/// `enabled: false` dims it but does not disable it. A disabled control is one
/// VoiceOver may skip and can never explain itself; this one stays a button,
/// says it is not ready in its hint, and leaves the tap to the action, which
/// announces why — "Choose exactly three cards to pass."
struct PrimaryButton: View {
    let title: String
    var key: Character? = nil
    var enabled = true
    var notReadyHint = "Not ready yet"
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                // The accent is dark in light mode and light in dark mode, so
                // the label flips with it: 9.8:1 and 10:1 respectively.
                .foregroundStyle(scheme == .dark ? Color.black : Color.white)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .tint(enabled ? Color.accentColor : Color.gray)
        .accessibilityHint(enabled ? "" : notReadyHint)
        .keyboardShortcut(key.map { KeyboardShortcut(KeyEquivalent($0), modifiers: []) })
    }
}

/// The title bar every game shares: the Review menu, and a More menu with
/// settings, help, and starting over.
struct GameChrome: ViewModifier {
    let game: GameKind
    let reviews: [ReviewItem]
    let announcer: Announcer
    let onNewGame: () -> Void

    @State private var showingSettings = false
    @State private var showingRules = false
    @State private var showingHints = false
    @State private var confirmingNewGame = false

    func body(content: Content) -> some View {
        content
            .navigationTitle(game.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    ReviewMenu(items: reviews, announcer: announcer)
                    Menu {
                        Button("Game settings") { showingSettings = true }
                        Button("How to play \(game.title)") { showingRules = true }
                        Button("Accessibility hints") { showingHints = true }
                        Divider()
                        Button("Start a new game", role: .destructive) { confirmingNewGame = true }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingSettings) {
                GameSettingsSheet(game: game)
            }
            .sheet(isPresented: $showingRules) {
                NavigationStack {
                    GameRulesView(game: game)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingRules = false } } }
                }
            }
            .sheet(isPresented: $showingHints) {
                NavigationStack {
                    AccessibilityHintsView()
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingHints = false } } }
                }
            }
            .confirmationDialog("Start a new game?", isPresented: $confirmingNewGame, titleVisibility: .visible) {
                Button("Start a new game", role: .destructive) { onNewGame() }
                Button("Keep playing", role: .cancel) {}
            } message: {
                Text("The scores go back to nothing. The log is kept.")
            }
    }
}

extension View {
    func gameChrome(game: GameKind, reviews: [ReviewItem], announcer: Announcer, onNewGame: @escaping () -> Void) -> some View {
        modifier(GameChrome(game: game, reviews: reviews, announcer: announcer, onNewGame: onNewGame))
    }
}

extension String {
    /// The first letter up, for a phrase the engine wrote for mid-sentence use.
    var sentenceCased: String {
        guard let f = first else { return self }
        return f.uppercased() + dropFirst()
    }
}

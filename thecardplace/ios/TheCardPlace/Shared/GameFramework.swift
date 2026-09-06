import SwiftUI
import CardCore

// The shape every game screen shares. A game supplies its session, the
// sections of its table, and the buttons its current phase offers; this file
// puts them where a VoiceOver player expects to find them.
//
// The layout, top to bottom, is the same in all five games:
//
//   status line, last announcement
//   Your hand
//   the game's own sections: the trick, the play, the scores…
//   ---------------------------- pinned to the bottom edge ----------------
//   Controls (heading)
//     the phase's choices, when it has any: Pass, Bid nil, Call hearts…
//     [primary action]                                    [Log] [Repeat]
//
// The primary action — Cut, Throw, Next, Deal, Continue — is always the
// button in the lower left corner of the screen, so it can be found by touch
// without exploring. The controls used in every game sit at the lower right.
// Nothing on the table tells the player what to do; the button says what it
// does, and the status line says where the game is.

/// One thing a player can press. The screen draws it; the session says what
/// it is called and what it does.
struct GameControl: Identifiable {
    let id: String
    let title: String
    /// A hardware-keyboard shortcut, without modifiers.
    var key: Character?
    /// False dims the button but does not disable it: a disabled control is
    /// one VoiceOver may skip and can never explain itself. The action still
    /// runs, and says why nothing happened.
    var enabled: Bool
    /// Spoken as the hint while the control is dimmed.
    var hint: String
    let action: () -> Void

    init(_ title: String, id: String? = nil, key: Character? = nil, enabled: Bool = true,
         hint: String = "", action: @escaping () -> Void) {
        self.id = id ?? title
        self.title = title
        self.key = key
        self.enabled = enabled
        self.hint = hint
        self.action = action
    }
}

/// What a game session must offer for the shared screen to draw it.
@MainActor
protocol GameSession: AnyObject, Observable {
    var status: String { get }
    var announcer: Announcer { get }
    var gate: PaceGate { get }
    var pace: Pace { get }
    /// Newest first.
    var log: [LogEntry] { get }
    var reviews: [ReviewItem] { get }
    var handItems: [HandCardItem] { get }
    var handHint: String { get }
    var focusCard: String? { get }
    var focusTick: Int { get }
    /// The button in the lower left corner: whatever moves the game on right
    /// now. When there is nothing to press, a dimmed button that says what
    /// the game is waiting for, and reads the status when tapped.
    var primary: GameControl { get }
    /// The phase's other choices, as buttons: Pass, Bid nil, Call hearts.
    var secondary: [GameControl] { get }
    func tap(_ item: HandCardItem)
    func newGame()
    func stop()
}

extension GameSession {
    var secondary: [GameControl] { [] }

    /// A dimmed primary for a phase with nothing to press — "Play a card",
    /// "Waiting for Ruth". Tapping it reads the status line.
    func idle(_ title: String, hint: String = "") -> GameControl {
        GameControl(title, id: "idle", enabled: false, hint: hint) { [weak self] in
            guard let self else { return }
            self.announcer.request(self.status)
        }
    }

    /// The dimmed primary while a computer player is thinking. While the
    /// pace gate is open the screen shows Continue in its place.
    func waiting(for name: String) -> GameControl {
        idle("Waiting for \(name)")
    }

    /// "Play a card": the move is in the hand, not on a button.
    var playACard: GameControl {
        idle("Play a card", hint: "Choose a card from your hand")
    }
}

/// Makes the session when the screen appears, stops it when the screen goes,
/// and holds the VoiceOver focus state the hand is driven by.
struct GameHost<Session: GameSession, Content: View>: View {
    let make: (AppSettings) -> Session
    @ViewBuilder let content: (Session, AccessibilityFocusState<String?>.Binding) -> Content

    @Environment(AppSettings.self) private var settings
    @State private var session: Session?
    @AccessibilityFocusState private var focusedCard: String?

    var body: some View {
        Group {
            if let session {
                content(session, $focusedCard)
            } else {
                ProgressView("Dealing…")
            }
        }
        .task {
            if session == nil { session = make(settings) }
        }
        .onDisappear { session?.stop() }
    }
}

/// The screen every game is drawn on. See the note at the top of this file
/// for the layout.
struct GameScreen<Session: GameSession, Table: View, Extras: View>: View {
    let game: GameKind
    let session: Session
    var focusedCard: AccessibilityFocusState<String?>.Binding
    /// The game's own sections, each under a heading.
    @ViewBuilder let table: () -> Table
    /// Controls for the phase that are not plain buttons — a bid stepper, a
    /// Go-alone switch. Shown with the secondary buttons, before them.
    @ViewBuilder let extras: () -> Extras

    init(game: GameKind, session: Session, focusedCard: AccessibilityFocusState<String?>.Binding,
         @ViewBuilder table: @escaping () -> Table,
         @ViewBuilder extras: @escaping () -> Extras = { EmptyView() }) {
        self.game = game
        self.session = session
        self.focusedCard = focusedCard
        self.table = table
        self.extras = extras
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                StatusLine(text: session.status)
                AnnouncementLine(announcer: session.announcer)

                SectionHeader("Your hand")
                HandView(items: session.handItems, hint: session.handHint, focus: focusedCard) { item in
                    session.tap(item)
                }

                table()
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ControlBar(primary: session.primary,
                       secondary: session.secondary,
                       gate: session.gate,
                       announcer: session.announcer,
                       log: session.log,
                       extras: extras)
        }
        .gameChrome(game: game, reviews: session.reviews, announcer: session.announcer) {
            session.newGame()
        }
        .onChange(of: session.focusTick) {
            focusedCard.wrappedValue = session.focusCard
        }
    }
}

/// The bottom edge of every game: a Controls heading, the phase's choices,
/// then the primary action at the left and the Log and Repeat buttons at the
/// right. Pinned, so it never scrolls away.
///
/// VoiceOver reads it heading first, then the primary action, then the
/// choices, then Log and Repeat — the order a player wants them in — while
/// the primary stays in the corner on screen.
struct ControlBar<Extras: View>: View {
    let primary: GameControl
    let secondary: [GameControl]
    let gate: PaceGate
    let announcer: Announcer
    let log: [LogEntry]
    @ViewBuilder let extras: () -> Extras
    @Environment(\.dynamicTypeSize) private var typeSize

    private var hasChoices: Bool { !secondary.isEmpty || Extras.self != EmptyView.self }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Controls")
                .padding(.top, 0)
                .accessibilitySortPriority(5)
            if hasChoices {
                FlowLayout(spacing: 8) {
                    extras()
                    ForEach(secondary) { control in
                        SecondaryButton(control: control)
                    }
                }
                .accessibilitySortPriority(3)
            }
            // One row at ordinary text sizes. At the accessibility sizes the
            // labels would wrap letter by letter, so the primary takes the
            // whole width and Log and Repeat sit under it — still the lower
            // left, still the lower right.
            if typeSize.isAccessibilitySize {
                PrimaryButton(control: gate.waiting ? continueControl : primary)
                    .accessibilitySortPriority(4)
                HStack(spacing: 8) {
                    LogButton(entries: log, announcer: announcer)
                        .accessibilitySortPriority(2)
                    Spacer(minLength: 0)
                    RepeatButton(announcer: announcer)
                        .accessibilitySortPriority(1)
                }
            } else {
                HStack(alignment: .center, spacing: 8) {
                    PrimaryButton(control: gate.waiting ? continueControl : primary)
                        .accessibilitySortPriority(4)
                    LogButton(entries: log, announcer: announcer)
                        .accessibilitySortPriority(2)
                    RepeatButton(announcer: announcer)
                        .accessibilitySortPriority(1)
                }
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
        .accessibilityElement(children: .contain)
    }

    /// While the game is paused between computer turns, Continue takes the
    /// primary's place. Timed paces move on without it; Wait for me does not.
    private var continueControl: GameControl {
        GameControl("Continue", id: "continue", key: "n") { gate.continueNow() }
    }
}

/// A big obvious action: Pass, Deal, Bid, Continue. Stretches to fill the
/// room it is given, so in the control bar it is always the lower left corner.
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

    init(title: String, key: Character? = nil, enabled: Bool = true, notReadyHint: String = "Not ready yet",
         action: @escaping () -> Void) {
        self.title = title
        self.key = key
        self.enabled = enabled
        self.notReadyHint = notReadyHint
        self.action = action
    }

    init(control: GameControl) {
        self.init(title: control.title, key: control.key, enabled: control.enabled,
                  notReadyHint: control.hint.isEmpty ? "Not ready yet" : control.hint,
                  action: control.action)
    }

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
        // Dimmed is a grey that still carries the label at 6.7:1 (light) and
        // 7.8:1 (dark); the accent carries it at 9.8:1 and 10:1.
        .tint(enabled ? Color.accentColor : Color(white: scheme == .dark ? 0.62 : 0.36))
        .accessibilityHint(enabled ? "" : notReadyHint)
        .keyboardShortcut(key.map { KeyboardShortcut(KeyEquivalent($0), modifiers: []) })
    }
}

/// One of the phase's other choices: bordered, at least 44 points tall.
struct SecondaryButton: View {
    let control: GameControl

    var body: some View {
        Button(action: control.action) {
            Text(control.title)
                .font(.headline)
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .opacity(control.enabled ? 1 : 0.6)
        .accessibilityHint(control.enabled ? "" : (control.hint.isEmpty ? "Not ready yet" : control.hint))
        .keyboardShortcut(control.key.map { KeyboardShortcut(KeyEquivalent($0), modifiers: []) })
    }
}

/// Say the last announcement again. R on a keyboard.
struct RepeatButton: View {
    let announcer: Announcer

    var body: some View {
        Button {
            announcer.repeatLast()
        } label: {
            Label("Repeat", systemImage: "arrow.counterclockwise")
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Repeat the last announcement")
        .keyboardShortcut("r", modifiers: [])
    }
}

/// The log, behind a button, so the table carries nothing that is spoken
/// anyway. Three ways in:
///
/// - Tap: the whole log, newest first, as a sheet.
/// - Press and hold: the last few entries, with Show full log at the end.
/// - VoiceOver actions: the same few entries, so a player can flick through
///   what just happened without leaving the button, and Show full log last.
struct LogButton: View {
    let entries: [LogEntry]
    let announcer: Announcer
    @State private var showingLog = false

    /// How many entries the preview and the actions carry.
    static let recentCount = 5

    private var recent: [LogEntry] { Array(entries.prefix(Self.recentCount)) }

    var body: some View {
        Menu {
            if recent.isEmpty {
                Button("Nothing has happened yet") { announcer.request("Nothing has happened yet.") }
            }
            ForEach(recent) { entry in
                Button(entry.text) { announcer.request(entry.text) }
            }
            Divider()
            Button("Show full log") { showingLog = true }
        } label: {
            Label("Log", systemImage: "list.bullet")
                .frame(minHeight: 44)
        } primaryAction: {
            showingLog = true
        }
        .menuOrder(.fixed)
        .buttonStyle(.bordered)
        .accessibilityLabel("Log")
        .accessibilityHint("Opens the full log. Swipe up or down for the last few entries.")
        .accessibilityActions {
            ForEach(recent) { entry in
                Button(entry.text) { announcer.request(entry.text) }
            }
            Button("Show full log") { showingLog = true }
        }
        .sheet(isPresented: $showingLog) {
            LogSheet(entries: entries)
        }
    }
}

/// The whole log, newest first. Plain text, not a live region: every line
/// was announced when it happened.
struct LogSheet: View {
    let entries: [LogEntry]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if entries.isEmpty {
                        Text("Nothing yet.").foregroundStyle(.secondary)
                    }
                    ForEach(entries) { entry in
                        Text(entry.text)
                    }
                } header: {
                    Text("Newest first")
                }
            }
            .listStyle(.plain)
            .navigationTitle("Log")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

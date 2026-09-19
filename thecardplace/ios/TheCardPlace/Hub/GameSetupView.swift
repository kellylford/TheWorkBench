import SwiftUI
import CardCore

/// The start screen for one game: your name, a summary of the settings, and
/// Deal pinned to the bottom edge where the game's primary button will be.
/// Every rule of the table lives in the settings sheet rather than here, so a
/// rules decision never looks like a preference.
struct GameSetupView: View {
    let game: GameKind
    @Environment(AppSettings.self) private var settings
    @State private var showingSettings = false
    @State private var playing = false

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                Text(game.tagline)
            } header: {
                Text(game.playersDescription)
            }

            Section {
                TextField("Your name", text: $settings.playerName)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
            } header: {
                Text("Your name")
            } footer: {
                Text("This is what the computer players call you in the log.")
            }

            Section {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Change game settings") { showingSettings = true }
            } header: {
                Text("Settings")
            }

            Section {
                NavigationLink("How to play \(game.title)") {
                    GameRulesView(game: game)
                }
                NavigationLink("Accessibility hints") {
                    AccessibilityHintsView()
                }
            }
        }
        // Deal is where the game's primary button will be: the lower left.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BottomBar {
                PrimaryButton(title: "Deal", key: "n") { playing = true }
            }
        }
        .navigationTitle(game.title)
        .navigationDestination(isPresented: $playing) {
            GameTableView(game: game)
        }
        .sheet(isPresented: $showingSettings) {
            GameSettingsSheet(game: game)
        }
    }

    private var summary: String {
        var parts = [
            "Pace: \(settings.pace(for: game).label).",
            game.hasDifficulty ? "Computer players: \(settings.difficulty.label)." : "",
            settings.autofocus ? "VoiceOver moves to your cards on your turn." : "VoiceOver stays where it is on your turn."
        ]
        if let rules = GameRules.summary(for: game, settings: settings) { parts.insert(rules, at: 0) }
        return parts.joined(separator: " ")
    }
}

import SwiftUI

/// The opening screen: pick a game.
struct HubView: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(GameKind.allCases) { game in
                        NavigationLink(value: game) {
                            GameRow(game: game)
                        }
                    }
                } header: {
                    Text("Pick a game")
                } footer: {
                    Text("Every game is played against the computer and works entirely offline. All of them are built to be fully playable with VoiceOver.")
                }

                Section {
                    NavigationLink {
                        AccessibilityHintsView()
                    } label: {
                        Label("How the games work with VoiceOver", systemImage: "accessibility")
                    }
                    NavigationLink {
                        AppSettingsView()
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                }
            }
            .navigationTitle("The Card Place")
            .navigationDestination(for: GameKind.self) { game in
                GameSetupView(game: game)
            }
        }
    }
}

private struct GameRow: View {
    let game: GameKind

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: game.symbol)
                .font(.title2)
                .frame(width: 32)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(game.title)
                    .font(.headline)
                Text(game.tagline)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

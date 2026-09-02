import SwiftUI
import CardCore

/// The settings that mean the same in every game.
struct SharedSettingsSections: View {
    let game: GameKind?
    @Environment(AppSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings

        if let game {
            Section {
                Picker("How fast the computer players move", selection: Binding(
                    get: { settings.pace(for: game) },
                    set: { settings.setPace($0, for: game) }
                )) {
                    ForEach(Pace.allCases) { pace in
                        Text(pace.label).tag(pace)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("How fast the computer players move")
            } footer: {
                Text("The timed settings are a ceiling. Continue is on screen during every pause and moves on at once.")
            }
        } else {
            Section {
                ForEach(GameKind.allCases) { g in
                    Picker(g.title, selection: Binding(
                        get: { settings.pace(for: g) },
                        set: { settings.setPace($0, for: g) }
                    )) {
                        ForEach(Pace.allCases) { pace in
                            Text(pace.label).tag(pace)
                        }
                    }
                }
            } header: {
                Text("How fast the computer players move")
            } footer: {
                Text("Each game remembers its own pace. Hearts and spades open on Brisk; the other three say more per play and open on Relaxed.")
            }
        }

        Section {
            Picker("Computer players", selection: $settings.difficulty) {
                ForEach(Difficulty.allCases) { d in
                    Text(d.label).tag(d)
                }
            }
            .pickerStyle(.segmented)
        } header: {
            Text("Computer players")
        } footer: {
            Text("Takes effect from the next hand.")
        }

        Section {
            Toggle("Move to my cards on my turn", isOn: $settings.autofocus)
            Toggle("Announce every computer play separately", isOn: $settings.speakEveryPlay)
        } header: {
            Text("VoiceOver")
        } footer: {
            Text("With every play announced separately there is a pause between them so each can finish. Turned off, a run of computer plays is gathered into one message. Immediate pace always gathers them.")
        }
    }
}

/// Settings from the hub: the name, and everything shared.
struct AppSettingsView: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                TextField("Your name", text: $settings.playerName)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
            } header: {
                Text("Your name")
            }
            SharedSettingsSections(game: nil)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One game's settings, as a sheet: the shared ones and that game's rules.
struct GameSettingsSheet: View {
    let game: GameKind
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                GameRulesSection(game: game)
                SharedSettingsSections(game: game)
            }
            .navigationTitle("\(game.title) settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

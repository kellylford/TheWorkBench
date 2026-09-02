import SwiftUI
import CardCore

/// Everything the player has chosen, remembered between launches.
///
/// One store for all five games: the name, the pace and the focus behaviour
/// are the same idea in every game and should not have to be set five times.
/// Each game keeps its own rule options under its own key.
@MainActor
@Observable
final class AppSettings {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        playerName = defaults.string(forKey: Keys.playerName) ?? "Player"
        autofocus = defaults.object(forKey: Keys.autofocus) as? Bool ?? true
        speakEveryPlay = defaults.object(forKey: Keys.speakEveryPlay) as? Bool ?? true
        difficulty = Difficulty(rawValue: defaults.string(forKey: Keys.difficulty) ?? "") ?? .normal
    }

    /// What everybody at the table calls the player. Kept short in the log.
    var playerName: String {
        didSet { defaults.set(playerName, forKey: Keys.playerName) }
    }

    /// Move VoiceOver to the cards when it becomes the player's turn. On by
    /// default; a player who would rather keep their place can turn it off.
    var autofocus: Bool {
        didSet { defaults.set(autofocus, forKey: Keys.autofocus) }
    }

    /// Announce each computer play as it happens (true) or gather a run of
    /// them into one message (false). Immediate pace always batches, because
    /// there is no time between plays for a separate sentence to finish.
    var speakEveryPlay: Bool {
        didSet { defaults.set(speakEveryPlay, forKey: Keys.speakEveryPlay) }
    }

    var difficulty: Difficulty {
        didSet { defaults.set(difficulty.rawValue, forKey: Keys.difficulty) }
    }

    /// The pace for one game. Defaults differ per game — hearts and spades say
    /// less per play than euchre or sheephead — but what a rung means does not.
    func pace(for game: GameKind) -> Pace {
        let stored = defaults.object(forKey: Keys.pace(game)) as? Int
        return stored.flatMap(Pace.init(rawValue:)) ?? game.defaultPace
    }

    func setPace(_ pace: Pace, for game: GameKind) {
        defaults.set(pace.rawValue, forKey: Keys.pace(game))
        version += 1
    }

    /// A game's own rule options, as whatever Codable struct it keeps.
    func rules<T: Codable>(for game: GameKind, default value: T) -> T {
        guard let data = defaults.data(forKey: Keys.rules(game)),
              let decoded = try? JSONDecoder().decode(T.self, from: data) else { return value }
        return decoded
    }

    func setRules<T: Codable>(_ rules: T, for game: GameKind) {
        if let data = try? JSONEncoder().encode(rules) {
            defaults.set(data, forKey: Keys.rules(game))
        }
        version += 1
    }

    /// Bumped on every per-game write so views observing the store refresh.
    private(set) var version = 0

    /// The names the computer players sit down with, none of them the
    /// player's own. The same list the browser games use.
    static let crew = ["Ruth", "Marta", "Dale", "Otis", "Winnie", "Hal", "June", "Cyrus"]

    func names(seats: Int) -> [String] {
        let me = playerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let mine = me.isEmpty ? "Player" : me
        var out = [mine]
        for n in Self.crew where out.count < seats {
            if n.caseInsensitiveCompare(mine) != .orderedSame { out.append(n) }
        }
        return out
    }

    private enum Keys {
        static let playerName = "playerName"
        static let autofocus = "autofocus"
        static let speakEveryPlay = "speakEveryPlay"
        static let difficulty = "difficulty"
        static func pace(_ g: GameKind) -> String { "pace.\(g.rawValue)" }
        static func rules(_ g: GameKind) -> String { "rules.\(g.rawValue)" }
    }
}

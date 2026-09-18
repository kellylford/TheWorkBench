import XCTest
import CardCore
@testable import CribbageEngine

/// Whole games played by the computer on both seats, with seeded randomness,
/// shared by the test classes so the simulation runs once.
enum Sim {
    struct Played {
        let seed: UInt64
        let difficulty: Difficulty
        let target: Int
        let state: CribbageState
        let refusals: [String]
        let steps: Int
    }

    static func config(_ difficulty: Difficulty, _ target: Int) -> CribbageConfig {
        CribbageConfig(names: ["You", "Ruth"], difficulty: difficulty, targetScore: target)
    }

    /// Drive one game to the end. `observe` sees the state before every
    /// computer decision, with the seat about to act.
    static func play(seed: UInt64, difficulty: Difficulty, target: Int, maxSteps: Int = 8000,
                     observe: ((CribbageState, Int) -> Void)? = nil) -> Played {
        var rng = RandomSource(seed: seed)
        var state = CribbageGame.createGame(config(difficulty, target))
        var refusals: [String] = []
        var steps = 0
        let r0 = CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
        if !r0.ok { refusals.append("start: \(r0.reason ?? "")") }
        while !state.gameOver && steps < maxSteps {
            steps += 1
            if state.phase == .roundOver {
                let r = CribbageGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng)
                if !r.ok { refusals.append("nextHand: \(r.reason ?? "")") }
                continue
            }
            guard let seat = CribbageGame.seatToAct(state) else {
                refusals.append("nobody to act at \(state.phase)")
                break
            }
            observe?(state, seat)
            guard let acted = CribbageAI.act(&state, rng: &rng) else {
                refusals.append("the computer had nobody to act for at \(state.phase)")
                break
            }
            if !acted.result.ok {
                refusals.append("seat \(acted.seat) at \(state.phase): \(acted.result.reason ?? "no reason")")
                break
            }
        }
        return Played(seed: seed, difficulty: difficulty, target: target, state: state, refusals: refusals, steps: steps)
    }

    static let perCombination = 20

    /// Every difficulty and both targets.
    static let games: [Played] = {
        var out: [Played] = []
        var seed: UInt64 = 1000
        for target in CribbageConfig.targets {
            for difficulty in Difficulty.allCases {
                for _ in 0..<perCombination {
                    out.append(play(seed: seed, difficulty: difficulty, target: target))
                    seed += 1
                }
            }
        }
        return out
    }()

    /// Every finished hand from every game, in order.
    static var hands: [CribbageHandRecord] { games.flatMap { $0.state.history } }
}

func card(_ id: String) -> Card {
    guard let c = Card(id: id) else { fatalError("\(id) is not a card") }
    return c
}

func cards(_ ids: String...) -> [Card] { ids.map(card) }

/// Drive with the computer on both seats until the predicate holds or the
/// game ends. Returns false if it never held.
@discardableResult
func advance(_ state: inout CribbageState, _ rng: inout RandomSource, limit: Int = 4000,
             until stop: (CribbageState) -> Bool) -> Bool {
    var steps = 0
    while !stop(state) && steps < limit {
        steps += 1
        if state.gameOver { return false }
        if state.phase == .idle {
            _ = CribbageGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
            continue
        }
        if state.phase == .roundOver {
            _ = CribbageGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng)
            continue
        }
        guard let acted = CribbageAI.act(&state, rng: &rng), acted.result.ok else { return false }
    }
    return stop(state)
}

import XCTest
import CardCore
import SpadesEngine

/// "AS", "TD" — a card from its id, for literal positions in tests.
func card(_ id: String) -> Card {
    guard let c = Card(id: id) else { fatalError("not a card: \(id)") }
    return c
}

func cards(_ ids: String) -> [Card] {
    ids.split(separator: " ").map { card(String($0)) }
}

let testNames = ["North", "East", "South", "West"]

/// Drives games with the computer players, seeded, so a failure can be
/// replayed.
enum Drive {
    static func newGame(_ config: SpadesConfig = SpadesConfig(names: testNames), seed: UInt64) -> (SpadesState, RandomSource) {
        var rng = RandomSource(seed: seed)
        var state = SpadesGame.createGame(config)
        let r = SpadesGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
        precondition(r.ok, "start refused: \(r.reason ?? "")")
        return (state, rng)
    }

    /// One step: the computer's move for the seat to act, or the next deal.
    /// Returns the result, or nil when the game is over.
    @discardableResult
    static func step(_ state: inout SpadesState, rng: inout RandomSource) -> ActionResult? {
        if state.phase == .gameOver { return nil }
        if state.phase == .handOver {
            return SpadesGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng)
        }
        guard let seat = SpadesGame.seatToAct(state) else { return nil }
        guard let action = SpadesAI.decide(state, seat: seat, rng: &rng) else {
            return .faulted("the computer had no move at \(state.phase)")
        }
        return SpadesGame.applyAction(&state, seat: seat, action: action, rng: &rng)
    }

    /// Start a game and bid it through with the computer, leaving the play
    /// about to begin.
    static func toPlay(_ config: SpadesConfig = SpadesConfig(names: testNames), seed: UInt64) -> (SpadesState, RandomSource) {
        var (state, rng) = newGame(config, seed: seed)
        while state.phase == .bidding { step(&state, rng: &rng) }
        return (state, rng)
    }

    /// Play a whole game out, checking nothing. Returns the finished state.
    static func playGame(_ config: SpadesConfig = SpadesConfig(names: testNames), seed: UInt64, guardSteps: Int = 40_000) -> SpadesState {
        var (state, rng) = newGame(config, seed: seed)
        var guardCount = 0
        while state.phase != .gameOver && guardCount < guardSteps {
            guardCount += 1
            guard let r = step(&state, rng: &rng) else { break }
            precondition(r.ok, "the computer's move was refused: \(r.reason ?? "") at \(state.phase)")
        }
        return state
    }
}

/// A play-phase position built by hand: bids and trick counts per seat, the
/// hands, who leads, and how many tricks have gone. Everything else takes the
/// value a real game would have.
func position(bids: [Int], tricks: [Int], hands: [String], leader: Int,
              tricksPlayed: Int, spadesBroken: Bool = false,
              scores: [Int] = [0, 0], bags: [Int] = [0, 0],
              config: SpadesConfig = SpadesConfig()) -> SpadesState {
    var state = SpadesGame.createGame(config)
    state.phase = .play
    state.dealer = (leader + 3) % 4
    state.dealNumber = 1
    for i in 0..<4 {
        state.players[i].bid = bids[i]
        state.players[i].tricks = tricks[i]
        state.players[i].hand = SpadesCards.sortHand(cards(hands[i]))
    }
    state.leader = leader
    state.turn = leader
    state.tricksPlayed = tricksPlayed
    state.spadesBroken = spadesBroken
    state.scores = scores
    state.bags = bags
    return state
}

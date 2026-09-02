import XCTest
import CardCore
@testable import SheepheadEngine

func card(_ id: String) -> Card { Card(id: id)! }
func cards(_ ids: String...) -> [Card] { ids.map(card) }

func newGame(players: Int, allPass: SheepheadConfig.AllPass = .leaster, difficulty: Difficulty = .hard,
             doublers: Bool = false, seed: UInt64) -> (SheepheadState, RandomSource) {
    let config = SheepheadConfig(players: players, difficulty: difficulty, allPass: allPass,
                                 blackQueenDoubler: doublers, redQueenDoubler: doublers, redealDoubler: doublers)
    var rng = RandomSource(seed: seed)
    var state = SheepheadGame.createGame(config)
    XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .start, rng: &rng), .ok)
    return (state, rng)
}

/// Drives every seat with the AI until the hand is over. `onStep` sees the
/// state before each decision and the generator as the AI received it, so a
/// test can check the position it was made in or replay the decision.
@discardableResult
func playHand(_ state: inout SheepheadState, rng: inout RandomSource,
              onStep: ((SheepheadState, Int, SheepheadAction, RandomSource) -> Void)? = nil) -> ActionResult {
    var guardCount = 0
    while state.phase != .handOver {
        guardCount += 1
        if guardCount > 500 { XCTFail("stuck in \(state.phase)"); return .refused("stuck") }
        guard let seat = SheepheadGame.seatToAct(state) else { XCTFail("nobody to act in \(state.phase)"); return .refused("nobody") }
        let beforeDecision = rng   // what the AI was handed, for a test that wants to replay it
        guard let action = SheepheadAI.decide(state, seat: seat, rng: &rng) else { XCTFail("AI had nothing to decide"); return .refused("no decision") }
        onStep?(state, seat, action, beforeDecision)
        let before = "\(state.phase):\(state.turn):\(state.players.map { $0.hand.count })"
        let r = SheepheadGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        if !r.ok { XCTFail("AI action \(action) refused: \(r.reason ?? "")"); return r }
        let after = "\(state.phase):\(state.turn):\(state.players.map { $0.hand.count })"
        XCTAssertNotEqual(before, after, "no progress at \(before)")
    }
    return .ok
}

/// A five-player game with seat 4 dealing, so seat 0 leads and picks first,
/// and the default names You, Alice, Ben, Cara, Elle.
func fiveHanded(seed: UInt64 = 1) -> (SheepheadState, RandomSource) {
    var (state, rng) = newGame(players: 5, seed: seed)
    state.dealer = 4
    state.leader = 0
    state.turn = 0
    return (state, rng)
}

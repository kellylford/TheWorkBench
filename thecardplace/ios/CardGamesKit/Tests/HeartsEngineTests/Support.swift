import XCTest
import CardCore
@testable import HeartsEngine

/// Shared scaffolding for the hearts tests: a seeded game driver and a way to
/// build a position by hand.
enum Support {
    static let names = ["North", "East", "South", "West"]

    static func config(_ difficulty: Difficulty = .hard, pointsToWin: Int = 100) -> HeartsConfig {
        HeartsConfig(names: names, difficulty: difficulty, pointsToWin: pointsToWin)
    }

    static func card(_ id: String) -> Card {
        guard let c = Card(id: id) else { fatalError("not a card id: \(id)") }
        return c
    }

    static func cards(_ ids: [String]) -> [Card] { ids.map(card) }

    /// Plays one whole game with the AI in every seat. `inspect` sees the
    /// state before every action; `afterMove` sees it after each accepted one.
    @discardableResult
    static func playGame(seed: UInt64, config: HeartsConfig, maxSteps: Int = 8000,
                         inspect: ((HeartsState) -> Void)? = nil,
                         afterMove: ((HeartsState, Int, HeartsAction) -> Void)? = nil,
                         file: StaticString = #filePath, line: UInt = #line) -> HeartsState {
        var rng = RandomSource(seed: seed)
        var state = HeartsGame.createGame(config)
        let started = HeartsGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
        XCTAssertTrue(started.ok, "start refused: \(started.reason ?? "")", file: file, line: line)
        var steps = 0
        while state.phase != .gameOver && steps < maxSteps {
            steps += 1
            inspect?(state)
            if state.phase == .handOver {
                let r = HeartsGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng)
                XCTAssertTrue(r.ok, "nextHand refused: \(r.reason ?? "")", file: file, line: line)
                if !r.ok { break }
                continue
            }
            guard let seat = HeartsGame.seatToAct(state) else {
                XCTFail("nobody to act in \(state.phase)", file: file, line: line)
                break
            }
            guard let action = HeartsAI.decide(state, seat: seat, rng: &rng) else {
                XCTFail("the computer had no move at phase \(state.phase) for seat \(seat)", file: file, line: line)
                break
            }
            let r = HeartsGame.applyAction(&state, seat: seat, action: action, rng: &rng)
            XCTAssertTrue(r.ok, "the computer's move was refused: \(r.reason ?? "") (\(action) at \(state.phase), seat \(seat))",
                          file: file, line: line)
            if !r.ok { break }
            afterMove?(state, seat, action)
        }
        XCTAssertEqual(state.phase, .gameOver, "the game did not finish within \(maxSteps) steps", file: file, line: line)
        return state
    }

    /// A play-phase position built by hand. Hands are given as card ids per
    /// seat; the trick as (seat, id) pairs already on the table.
    static func playState(hands: [[String]], turn: Int, leader: Int? = nil,
                          trick: [(Int, String)] = [], tricksPlayed: Int = 0,
                          heartsBroken: Bool = false, taken: [[String]] = [[], [], [], []],
                          config: HeartsConfig = Support.config()) -> HeartsState {
        var s = HeartsGame.createGame(config)
        s.phase = .play
        s.dealNumber = 1
        for i in 0..<4 {
            s.players[i].hand = HeartsCards.sortHand(cards(hands[i]))
            s.players[i].taken = cards(taken[i])
        }
        s.turn = turn
        s.leader = leader ?? trick.first?.0 ?? turn
        s.trick = trick.map { HeartsTrickPlay(seat: $0.0, card: card($0.1)) }
        s.tricksPlayed = tricksPlayed
        s.heartsBroken = heartsBroken
        return s
    }

    /// Every card at the table: hands, taken piles and the trick.
    static func allCards(_ s: HeartsState) -> [Card] {
        var all: [Card] = []
        for p in s.players { all += p.hand; all += p.taken }
        all += s.trick.map(\.card)
        return all
    }

    /// Has any heart hit the table this hand, worked out from the cards rather
    /// than from the engine's flag?
    static func heartEverPlayed(_ s: HeartsState) -> Bool {
        if s.trick.contains(where: { $0.card.suit == .hearts }) { return true }
        return s.players.contains { $0.taken.contains { $0.suit == .hearts } }
    }
}

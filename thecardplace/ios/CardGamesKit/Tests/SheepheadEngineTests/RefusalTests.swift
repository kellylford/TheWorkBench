import XCTest
import CardCore
@testable import SheepheadEngine

final class RefusalTests: XCTestCase {
    private func refuse(_ state: inout SheepheadState, seat: Int, _ action: SheepheadAction, _ reason: String,
                        file: StaticString = #filePath, line: UInt = #line) {
        let before = state
        var rng = RandomSource(seed: 1)
        let r = SheepheadGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        XCTAssertEqual(r, .refused(reason), file: file, line: line)
        XCTAssertEqual(state, before, "state changed on refusal", file: file, line: line)
    }

    func testIdleAndStart() {
        var rng = RandomSource(seed: 1)
        var state = SheepheadGame.createGame(SheepheadConfig())
        XCTAssertNil(SheepheadGame.seatToAct(state))
        XCTAssertFalse(SheepheadGame.canDeal(state))
        refuse(&state, seat: 0, .nextHand, "The hand is not over.")
        refuse(&state, seat: 0, .pick, "It is not the picking round.")
        refuse(&state, seat: 0, .play(card("QC")), "It is not time to play a card.")
        refuse(&state, seat: 9, .start, "That is not a seat at this table.")
        refuse(&state, seat: -1, .start, "That is not a seat at this table.")
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .start, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .pick)
        refuse(&state, seat: 0, .start, "The game has already started.")
    }

    func testPickingRound() {
        var (state, _) = fiveHanded()
        refuse(&state, seat: 1, .pick, "It is not your turn.")
        refuse(&state, seat: 1, .pass, "It is not your turn.")
        refuse(&state, seat: 0, .bury([]), "There is nothing to bury.")
        refuse(&state, seat: 0, .play(state.players[0].hand[0]), "It is not time to play a card.")
        refuse(&state, seat: 0, .nextHand, "The hand is not over.")
        refuse(&state, seat: 0, .newGame, "The hand is not over.")
        XCTAssertEqual(SheepheadGame.legalPlays(state, seat: 0), [])
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: state.players[0].hand[0]),
                       "Cards are for review while you decide whether to pick.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 1, card: state.players[1].hand[0]),
                       "Cards are for review; You is deciding whether to pick.")
    }

    func testBurying() {
        var (state, rng) = fiveHanded()
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .pick, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .bury)
        XCTAssertEqual(SheepheadGame.seatToAct(state), 0)
        XCTAssertEqual(state.players[0].hand.count, 8)
        let hand = state.players[0].hand
        let notHeld = SheepheadCards.deck(for: 5).first { !hand.contains($0) }!
        refuse(&state, seat: 1, .bury([hand[0], hand[1]]), "Only the picker buries.")
        refuse(&state, seat: 0, .bury([hand[0]]), "Bury exactly 2 cards.")
        refuse(&state, seat: 0, .bury([hand[0], hand[1], hand[2]]), "Bury exactly 2 cards.")
        refuse(&state, seat: 0, .bury([hand[0], hand[0]]), "The \(hand[0].name) was named twice.")
        refuse(&state, seat: 0, .bury([hand[0], notHeld]), "You do not hold the \(notHeld.name).")
        refuse(&state, seat: 0, .pick, "It is not the picking round.")
        refuse(&state, seat: 0, .play(hand[0]), "It is not time to play a card.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: hand[0]), "Cards are for review while you choose what to bury.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 1, card: state.players[1].hand[0]), "Cards are for review; You is burying.")
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .bury([hand[6], hand[7]]), rng: &rng), .ok)
        XCTAssertEqual(state.buried, [hand[6], hand[7]])
        XCTAssertEqual(state.players[0].hand.count, 6)
        XCTAssertEqual(state.phase, .play)
        XCTAssertEqual(state.turn, 0)
    }

    func testPlaying() {
        var (state, _) = fiveHanded()
        state.phase = .play
        state.picker = 1
        state.partner = 2
        state.players[0].hand = cards("QC", "AC", "KC", "9H")
        state.players[1].hand = cards("TC", "AS", "7H", "JD")
        state.trick = [SheepheadPlay(player: 4, card: card("TS")), SheepheadPlay(player: 0, card: card("KC"))]
        state.turn = 1
        refuse(&state, seat: 0, .play(card("AC")), "It is not your turn.")
        refuse(&state, seat: 1, .play(card("QS")), "You do not hold the Queen of Spades.")
        refuse(&state, seat: 1, .play(card("TC")), "You must follow spades.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 1, card: card("TC")), "You must follow spades.")
        XCTAssertNil(SheepheadGame.whyNot(state, seat: 1, card: card("AS")))
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: card("AC")), "It is not your turn; Alice is to play.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: card("QS")), "You do not hold the Queen of Spades.")
        XCTAssertEqual(SheepheadGame.legalPlays(state, seat: 1), cards("AS"))
        XCTAssertEqual(SheepheadGame.legalPlays(state, seat: 0), [])

        // A trump lead: queens and jacks must follow, and the reason says trump.
        state.trick = [SheepheadPlay(player: 4, card: card("9D"))]
        refuse(&state, seat: 1, .play(card("AS")), "You must follow trump.")
        XCTAssertEqual(SheepheadGame.legalPlays(state, seat: 1), cards("JD"))
        state.turn = 0
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: card("AC")), "You must follow trump.")
        XCTAssertNil(SheepheadGame.whyNot(state, seat: 0, card: card("QC")))
    }

    func testHandOverAndNewGame() {
        var (state, rng) = newGame(players: 4, seed: 2)
        playHand(&state, rng: &rng)
        XCTAssertNil(SheepheadGame.seatToAct(state))
        refuse(&state, seat: 0, .pick, "It is not the picking round.")
        refuse(&state, seat: 0, .play(card("QC")), "It is not time to play a card.")
        refuse(&state, seat: 0, .start, "The game has already started.")
        XCTAssertEqual(SheepheadGame.whyNot(state, seat: 0, card: card("QC")), "You do not hold the Queen of Clubs.")
        let names = state.players.map(\.name)
        let config = state.config
        XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .newGame, rng: &rng), .ok)
        XCTAssertEqual(state.phase, .idle)
        XCTAssertEqual(state.handNumber, 0)
        XCTAssertEqual(state.players.map(\.name), names)
        XCTAssertEqual(state.config, config)
        XCTAssertTrue(state.players.allSatisfy { $0.score == 0 && $0.hand.isEmpty })
        XCTAssertTrue(state.log.events.isEmpty)
    }

    func testConfigIsClamped() {
        XCTAssertEqual(SheepheadGame.seats(for: SheepheadConfig(players: 2)), 3)
        XCTAssertEqual(SheepheadGame.seats(for: SheepheadConfig(players: 9)), 6)
        let s = SheepheadGame.createGame(SheepheadConfig(names: ["Kelly"], players: 6))
        XCTAssertEqual(s.players.count, 6)
        XCTAssertEqual(s.players[0].name, "Kelly")
        XCTAssertEqual(s.players[0].occupant, .human)
        XCTAssertTrue(s.players.dropFirst().allSatisfy { $0.occupant == .bot })
        XCTAssertEqual(Set(s.players.map(\.name)).count, 6, "names are distinct")
        let d = SheepheadConfig()
        XCTAssertEqual(d.players, 5)
        XCTAssertEqual(d.difficulty, .normal)
        XCTAssertEqual(d.allPass, .leaster)
        XCTAssertFalse(d.blackQueenDoubler || d.redQueenDoubler || d.redealDoubler)
    }
}

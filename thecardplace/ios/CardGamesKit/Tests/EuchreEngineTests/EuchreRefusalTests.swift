import XCTest
import CardCore
@testable import EuchreEngine

/// The wrong seat, the wrong phase, a card not held: each refused with a reason
/// in the words of the rule, and the state compared before and after so a
/// refusal that quietly changed something is caught.
final class EuchreRefusalTests: XCTestCase {
    var rng = RandomSource(seed: 4242)

    func assertRefused(_ s: inout EuchreState, seat: Int, _ action: EuchreAction, _ reason: String,
                       file: StaticString = #filePath, line: UInt = #line) {
        let before = s
        let r = EuchreGame.applyAction(&s, seat: seat, action: action, rng: &rng)
        XCTAssertFalse(r.ok, "\(action) by seat \(seat) at \(before.phase) should have been refused", file: file, line: line)
        XCTAssertFalse(r.fault, file: file, line: line)
        XCTAssertEqual(r.reason, reason, file: file, line: line)
        XCTAssertEqual(s, before, "a refusal changed the state", file: file, line: line)
    }

    func testNothingWorksBeforeTheFirstDeal() {
        var s = EuchreGame.createGame(Support.config())
        let card = Support.card("AS")
        assertRefused(&s, seat: 0, .nextHand, "the hand is not over")
        assertRefused(&s, seat: 0, .newGame, "the game is not over")
        assertRefused(&s, seat: 0, .play(card), "not the playing phase")
        assertRefused(&s, seat: 0, .pass, "there is nothing to pass on")
        assertRefused(&s, seat: 0, .orderUp(alone: false), "the upcard is not on offer")
        assertRefused(&s, seat: 0, .callSuit(.hearts, alone: false), "not the naming round")
        assertRefused(&s, seat: 0, .discard(card), "nothing to discard")
        assertRefused(&s, seat: 4, .start, "not a seat at this table")
        assertRefused(&s, seat: -1, .start, "not a seat at this table")
        XCTAssertEqual(EuchreGame.legalPlays(s, seat: 0), [])
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 0, card: card), "no hand has been dealt yet")
    }

    func testRoundOne() {
        var s = EuchreGame.createGame(Support.config())
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let turn = s.turn, other = (turn + 1) % 4
        assertRefused(&s, seat: 0, .start, "the game has already started")
        assertRefused(&s, seat: 0, .nextHand, "the hand is not over")
        assertRefused(&s, seat: other, .orderUp(alone: false), "not your turn to bid")
        assertRefused(&s, seat: other, .pass, "not your turn to bid")
        assertRefused(&s, seat: turn, .callSuit(.hearts, alone: false), "not the naming round")
        assertRefused(&s, seat: s.dealer!, .discard(s.players[s.dealer!].hand[0]), "nothing to discard")
        assertRefused(&s, seat: turn, .play(s.players[turn].hand[0]), "not the playing phase")
        XCTAssertEqual(EuchreGame.legalPlays(s, seat: turn), [], "no card is playable while bidding")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: turn, card: s.players[turn].hand[0]), "for review while you decide your bid")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: other, card: s.players[other].hand[0]),
                       "for review, \(s.players[turn].name) is bidding")
    }

    func testRoundTwo() {
        var s = EuchreGame.createGame(Support.config())
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        for _ in 0..<4 { XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.turn, action: .pass, rng: &rng).ok) }
        XCTAssertEqual(s.phase, .bid2)
        let denied = s.deniedSuit!
        assertRefused(&s, seat: s.turn, .callSuit(denied, alone: false),
                      "\(denied.lowerName) was turned down and cannot be named this hand")
        assertRefused(&s, seat: s.turn, .orderUp(alone: false), "the upcard is not on offer")
        assertRefused(&s, seat: (s.turn + 1) % 4, .callSuit(denied.sameColour, alone: false), "not your turn to bid")
        assertRefused(&s, seat: s.turn, .discard(s.players[s.turn].hand[0]), "nothing to discard")
    }

    func testTheDiscard() {
        var s = EuchreGame.createGame(Support.config())
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: s.turn, action: .orderUp(alone: false), rng: &rng).ok)
        XCTAssertEqual(s.phase, .discard)
        let dealer = s.dealer!, other = (dealer + 1) % 4
        /* The euchre-specific trap: the discard belongs to the dealer, who is
         * usually not the seat that ordered it up. */
        assertRefused(&s, seat: other, .discard(s.players[dealer].hand[0]), "only the dealer discards")
        assertRefused(&s, seat: dealer, .discard(s.players[other].hand[0]), "that card is not in your hand")
        assertRefused(&s, seat: dealer, .play(s.players[dealer].hand[0]), "not the playing phase")
        assertRefused(&s, seat: dealer, .pass, "there is nothing to pass on")
        assertRefused(&s, seat: dealer, .orderUp(alone: false), "the upcard is not on offer")
        assertRefused(&s, seat: 0, .nextHand, "the hand is not over")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: dealer, card: s.players[dealer].hand[0]),
                       "for review while you choose what to put back")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: other, card: s.players[other].hand[0]),
                       "for review, \(s.players[dealer].name) is putting a card back")
    }

    func testThePlay() {
        var s = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades,
                                 hands: [["AS", "9H", "TC", "KD", "QD"], ["JC", "9D", "TD", "AH", "KH"],
                                         ["JS", "QH", "JH", "AD", "9C"], ["9S", "TS", "QS", "KS", "TH"]],
                                 upcard: "9S", upcardStatus: .taken, maker: 0)
        let ah = Support.card("AH"), jc = Support.card("JC")
        assertRefused(&s, seat: 1, .play(jc), "not your turn")
        assertRefused(&s, seat: 0, .play(ah), "that card is not in your hand")
        assertRefused(&s, seat: 0, .play(Support.card("2C")), "that card is not in your hand")
        assertRefused(&s, seat: 0, .orderUp(alone: false), "the upcard is not on offer")
        assertRefused(&s, seat: 0, .pass, "there is nothing to pass on")
        assertRefused(&s, seat: 3, .discard(Support.card("9S")), "nothing to discard")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 1, card: jc), "not your turn, You is to play")

        // Lead the ace of spades; seat 1 holds the left bower, so it must follow trump.
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .play(Support.card("AS")), rng: &rng).ok)
        XCTAssertEqual(s.turn, 1)
        assertRefused(&s, seat: 1, .play(ah), "you must follow trump — you hold Jack of Clubs")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 1, card: ah), "you must follow trump — you hold Jack of Clubs")
        XCTAssertNil(EuchreGame.whyNot(s, seat: 1, card: jc))
        XCTAssertEqual(EuchreGame.legalPlays(s, seat: 1), [jc])
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 1, action: .play(jc), rng: &rng).ok)

        // Seat 2 holds the right bower and must follow with it, not a heart.
        assertRefused(&s, seat: 2, .play(Support.card("QH")), "you must follow trump — you hold Jack of Spades")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 2, action: .play(Support.card("JS")), rng: &rng).ok)
        // Seat 3 has four spades; the reason names all of them.
        assertRefused(&s, seat: 3, .play(Support.card("TH")),
                      "you must follow trump — you hold Nine of Spades, Ten of Spades, Queen of Spades and King of Spades")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 3, action: .play(Support.card("9S")), rng: &rng).ok)
        XCTAssertEqual(s.lastTrick?.winner, 2)
        XCTAssertEqual(s.turn, 2)

        // A plain-suit lead: hearts led, and trump may not be thrown while a heart is held.
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 2, action: .play(Support.card("QH")), rng: &rng).ok)
        assertRefused(&s, seat: 3, .play(Support.card("QS")), "you must follow hearts — you hold Ten of Hearts")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 3, action: .play(Support.card("TH")), rng: &rng).ok)
        // And seat 0, holding one heart, must follow with it.
        assertRefused(&s, seat: 0, .play(Support.card("KD")), "you must follow hearts — you hold Nine of Hearts")
    }

    func testASeatSittingOutMayNotPlay() {
        var s = Support.position(phase: .play, dealer: 3, turn: 1, trump: .hearts,
                                 hands: [["AS", "9H", "TH", "KD", "QD"], ["JC", "9D", "TD", "AH", "KH"],
                                         ["JS", "QH", "JH", "AD", "9C"], ["9S", "TS", "QS", "KS", "TC"]],
                                 upcard: "9H", upcardStatus: .taken, maker: 1, alone: true, sittingOut: 3)
        assertRefused(&s, seat: 3, .play(Support.card("9S")), "you are sitting out this hand")
        XCTAssertEqual(EuchreGame.legalPlays(s, seat: 3), [])
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 3, card: Support.card("9S")), "you are sitting out while Ruth plays alone")
        XCTAssertEqual(EuchreGame.activeCount(s), 3)
        XCTAssertEqual(EuchreGame.nextActive(s, 2), 0)
    }

    func testBetweenHands() {
        var s = EuchreGame.createGame(Support.config())
        Support.playHand(&s, rng: &rng)
        XCTAssertEqual(s.phase, .handOver, "a game to ten cannot end on hand one")
        guard s.phase == .handOver else { return }
        XCTAssertNil(EuchreGame.seatToAct(s))
        assertRefused(&s, seat: 0, .start, "the game has already started")
        assertRefused(&s, seat: 0, .newGame, "the game is not over")
        assertRefused(&s, seat: 0, .pass, "there is nothing to pass on")
        assertRefused(&s, seat: 0, .play(Support.card("AS")), "not the playing phase")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 0, card: Support.card("AS")), "the hand is over")
        XCTAssertTrue(EuchreGame.canDeal(s))
        assertRefused(&s, seat: 9, .nextHand, "not a seat at this table")
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 2, action: .nextHand, rng: &rng).ok, "any seat may deal")
    }

    func testAfterTheGameEnds() {
        var s = EuchreGame.createGame(Support.config(points: 5))
        while s.phase != .gameOver { Support.playHand(&s, rng: &rng) }
        assertRefused(&s, seat: 0, .nextHand, "the game is over — start a new game")
        assertRefused(&s, seat: 0, .start, "the game has already started")
        assertRefused(&s, seat: 0, .play(Support.card("AS")), "not the playing phase")
        XCTAssertEqual(EuchreGame.whyNot(s, seat: 0, card: Support.card("AS")), "the game is over")
        XCTAssertFalse(EuchreGame.canDeal(s))
    }
}

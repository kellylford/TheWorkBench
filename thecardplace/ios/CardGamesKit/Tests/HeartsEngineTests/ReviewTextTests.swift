import XCTest
import CardCore
@testable import HeartsEngine

/// Exact-string checks on the review sentences from constructed positions.
final class ReviewTextTests: XCTestCase {

    func testHandIsGroupedBySuitHighToLowWithCounts() {
        let s = Support.playState(hands: [["2H", "AS", "TD", "QS", "3C", "KH", "AC", "9D", "2S", "JC"], [], [], []], turn: 0)
        XCTAssertEqual(HeartsReview.hand(s, seat: 0),
                       "Three clubs: Ace, Jack and Three. Two diamonds: Ten and Nine. Three spades: Ace, Queen and Two. Two hearts: King and Two.")
        let one = Support.playState(hands: [["7H"], ["2C"], [], []], turn: 0)
        XCTAssertEqual(HeartsReview.hand(one, seat: 0), "One heart: Seven.")
        XCTAssertEqual(HeartsReview.hand(one, seat: 1), "One club: Two.")
        XCTAssertEqual(HeartsReview.hand(one, seat: 2), "Your hand is empty.")
    }

    func testTrick() {
        let empty = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0)
        XCTAssertEqual(HeartsReview.trick(empty, seat: 0), "Nothing has been played to this trick yet.")
        let s = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 2, trick: [(0, "TH"), (1, "AH")], tricksPlayed: 4, heartsBroken: true)
        XCTAssertEqual(HeartsReview.trick(s, seat: 0), "North played the Ten of Hearts, East played the Ace of Hearts. Hearts was led.")
    }

    func testLastTrick() {
        var s = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0)
        XCTAssertEqual(HeartsReview.lastTrick(s, seat: 0), "No trick has been completed yet.")
        s.lastTrick = HeartsLastTrick(cards: [
            HeartsTrickPlay(seat: 3, card: Support.card("9S")),
            HeartsTrickPlay(seat: 0, card: Support.card("QS")),
            HeartsTrickPlay(seat: 1, card: Support.card("KS")),
            HeartsTrickPlay(seat: 2, card: Support.card("2S")),
        ], winner: 1, points: 13)
        XCTAssertEqual(HeartsReview.lastTrick(s, seat: 0),
                       "West played the Nine of Spades, North played the Queen of Spades, East played the King of Spades, South played the Two of Spades. East took it with 13 points.")
        s.lastTrick = HeartsLastTrick(cards: [
            HeartsTrickPlay(seat: 0, card: Support.card("2C")),
            HeartsTrickPlay(seat: 1, card: Support.card("3C")),
            HeartsTrickPlay(seat: 2, card: Support.card("4C")),
            HeartsTrickPlay(seat: 3, card: Support.card("2H")),
        ], winner: 2, points: 1)
        XCTAssertTrue(HeartsReview.lastTrick(s, seat: 0).hasSuffix("South took it with 1 point."))
        s.lastTrick = HeartsLastTrick(cards: s.lastTrick!.cards.dropLast() + [HeartsTrickPlay(seat: 3, card: Support.card("5C"))], winner: 3, points: 0)
        XCTAssertTrue(HeartsReview.lastTrick(s, seat: 0).hasSuffix("West took it, no points."))
    }

    func testScoresAndPointsSoFar() {
        var s = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0,
                                  taken: [["AH", "KH", "3D"], [], ["QS", "2C", "3C", "4C"], ["2H"]])
        s.players[0].score = 12
        s.players[2].score = 30
        s.players[3].score = 4
        XCTAssertEqual(HeartsReview.scores(s, seat: 0), "North 12, East 0, South 30, West 4. Lowest wins.")
        XCTAssertEqual(HeartsReview.pointsSoFar(s, seat: 0),
                       "This hand: North 2 points, East 0 points, South 13 points, West 1 point. South has the queen of spades.")
        s.players[2].taken = []
        XCTAssertEqual(HeartsReview.pointsSoFar(s, seat: 0),
                       "This hand: North 2 points, East 0 points, South 0 points, West 1 point. The queen of spades has not been played.")
    }

    func testCardsPlayed() {
        let fresh = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0)
        XCTAssertEqual(HeartsReview.cardsPlayed(fresh, seat: 0),
                       "0 tricks played, 13 to go. Hearts have not been broken. The queen of spades is still out. None of the high hearts have gone.")
        let mid = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 1, trick: [(0, "AH")], tricksPlayed: 1, heartsBroken: true,
                                    taken: [[], ["2C", "3C", "KH", "QS"], [], []])
        XCTAssertEqual(HeartsReview.cardsPlayed(mid, seat: 0),
                       "1 trick played, 12 to go. Hearts are broken. The queen of spades has gone. Played so far: two clubs, one spade and two hearts. Of the high hearts, the Ace and King have gone; the Queen and Jack are still out.")
        let late = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0, tricksPlayed: 2, heartsBroken: true,
                                     taken: [["AH", "KH", "QH", "JH"], ["2D", "3D", "4D", "5D"], [], []])
        XCTAssertEqual(HeartsReview.cardsPlayed(late, seat: 0),
                       "2 tricks played, 11 to go. Hearts are broken. The queen of spades is still out. Played so far: four diamonds and four hearts. All four high hearts have gone.")
        let single = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0, tricksPlayed: 1, heartsBroken: true,
                                       taken: [["JH", "2C", "3C", "4C"], [], [], []])
        XCTAssertTrue(HeartsReview.cardsPlayed(single, seat: 0).hasSuffix("Of the high hearts, the Jack has gone; the Ace, King and Queen are still out."))
    }

    func testPlayOrder() {
        let lead = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 2, leader: 2)
        XCTAssertEqual(HeartsReview.playOrder(lead, seat: 0), "Play goes South, then West, then North, then East.")
        let mid = Support.playState(hands: [["2C"], ["3C"], ["4C"], ["5C"]], turn: 0, trick: [(3, "9D")], tricksPlayed: 2)
        XCTAssertEqual(HeartsReview.playOrder(mid, seat: 0), "Play goes West, then North, then East, then South.")
    }

    func testWho() {
        let s = HeartsGame.createGame(Support.config())
        XCTAssertEqual(HeartsReview.who(s, seat: 0), "North, you. East, computer. South, computer. West, computer.")
    }

    func testStatusInEveryPhase() {
        var rng = RandomSource(seed: 5)
        var s = HeartsGame.createGame(Support.config())
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "Choose Start to deal the first hand.")

        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "Choose three cards to pass to the left.")
        s.passDirection = .right
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "Choose three cards to pass to the right.")
        s.passDirection = .across
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "Choose three cards to pass across.")
        s.passDirection = .left
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .pass(Array(s.players[0].hand.prefix(3))), rng: &rng).ok)
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "You have passed. Waiting for 3 players.")
        XCTAssertEqual(HeartsReview.status(s, seat: 1), "Choose three cards to pass to the left.")
        for seat in 1...2 {
            XCTAssertTrue(HeartsGame.applyAction(&s, seat: seat, action: HeartsAI.decide(s, seat: seat, rng: &rng)!, rng: &rng).ok)
        }
        XCTAssertEqual(HeartsReview.status(s, seat: 0), "You have passed. Waiting for 1 player.")

        let play = Support.playState(hands: [["2C", "3D"], ["9C", "AH"], ["4C", "2D"], ["5C", "4D"]], turn: 0)
        XCTAssertEqual(HeartsReview.status(play, seat: 0), "Your turn. You lead.")
        XCTAssertEqual(HeartsReview.status(play, seat: 1), "Waiting for North.")
        let following = Support.playState(hands: [["2C", "3D"], ["9C", "AH"], ["4C", "2D"], ["5C", "4D"]], turn: 0,
                                          trick: [(3, "TH")], tricksPlayed: 3, heartsBroken: true)
        XCTAssertEqual(HeartsReview.status(following, seat: 0), "Your turn. West led the Ten of Hearts.")
        XCTAssertEqual(HeartsReview.status(following, seat: 2), "Waiting for North.")

        var over = HeartsGame.createGame(Support.config())
        over.phase = .handOver
        over.dealNumber = 3
        over.players[1].score = 7
        over.players[3].score = 26
        XCTAssertEqual(HeartsReview.status(over, seat: 0), "Hand 3 is over. North 0, East 7, South 0, West 26. Lowest wins.")

        over.phase = .gameOver
        over.players[0].score = 45
        over.players[2].score = 100
        over.winner = 1
        XCTAssertEqual(HeartsReview.status(over, seat: 0), "East wins with 7.")
        over.winner = nil
        over.players[0].score = 7
        XCTAssertEqual(HeartsReview.status(over, seat: 0), "The game is over. Tied on 7: North and East.")
    }

    func testRulesHelpIsPlainText() {
        XCTAssertEqual(HeartsHelp.rules.map(\.heading), ["The object", "Passing", "The play", "Shooting the moon"])
        for r in HeartsHelp.rules {
            XCTAssertFalse(r.body.contains("<"), r.heading)
            XCTAssertFalse(r.body.lowercased().contains("press"), r.heading)
            XCTAssertTrue(r.body.hasSuffix("."), r.heading)
        }
    }
}

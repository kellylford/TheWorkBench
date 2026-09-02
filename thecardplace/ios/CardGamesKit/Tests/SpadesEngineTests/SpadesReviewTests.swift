import XCTest
import CardCore
import SpadesEngine

/// Exact-string checks on the review sentences from constructed positions.
final class SpadesReviewTests: XCTestCase {

    let names = ["You", "East", "South", "West"]

    func testHand() {
        var state = SpadesGame.createGame(SpadesConfig(names: names))
        state.players[0].hand = SpadesCards.sortHand(cards("QS 4C AC 9H 2H TC KD 9S"))
        XCTAssertEqual(SpadesReview.hand(state, seat: 0),
                       "Clubs: Ace, Ten and Four. Diamonds: King. Hearts: Nine and Two. Spades (trump): Queen and Nine. 2 spades.")
        state.players[0].hand = cards("AH")
        XCTAssertEqual(SpadesReview.hand(state, seat: 0), "Hearts: Ace. No spades.")
        state.players[0].hand = cards("3S")
        XCTAssertEqual(SpadesReview.hand(state, seat: 0), "Spades (trump): Three. 1 spade.")
        state.players[0].hand = []
        XCTAssertEqual(SpadesReview.hand(state, seat: 0), "Your hand is empty.")
    }

    func testTrickAndLastTrick() {
        var state = position(bids: [3, 3, 3, 3], tricks: [0, 0, 0, 0],
                             hands: ["2H 3C", "KH 4C", "2S 5C", "AH 6C"], leader: 0, tricksPlayed: 0,
                             config: SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.trick(state), "Nothing has been played to this trick yet.")
        XCTAssertEqual(SpadesReview.lastTrick(state), "No trick has been completed yet.")
        var rng = RandomSource(seed: 1)
        _ = SpadesGame.applyAction(&state, seat: 0, action: .play(card("2H")), rng: &rng)
        _ = SpadesGame.applyAction(&state, seat: 1, action: .play(card("KH")), rng: &rng)
        XCTAssertEqual(SpadesReview.trick(state),
                       "You played the Two of Hearts, East played the King of Hearts. Hearts was led. East is winning it.")
        _ = SpadesGame.applyAction(&state, seat: 2, action: .play(card("2S")), rng: &rng)
        XCTAssertEqual(SpadesReview.trick(state),
                       "You played the Two of Hearts, East played the King of Hearts, South played the Two of Spades. Hearts was led. South is winning it.")
        XCTAssertEqual(SpadesReview.playOrder(state), "Play goes You, then East, then South, then West.")
        _ = SpadesGame.applyAction(&state, seat: 3, action: .play(card("AH")), rng: &rng)
        XCTAssertEqual(SpadesReview.lastTrick(state),
                       "You played the Two of Hearts, East played the King of Hearts, South played the Two of Spades, West played the Ace of Hearts. South took it.")
        XCTAssertEqual(SpadesReview.trick(state), "Nothing has been played to this trick yet.")
        XCTAssertEqual(SpadesReview.playOrder(state), "Play goes South, then West, then You, then East.")
    }

    func testScores() {
        var state = SpadesGame.createGame(SpadesConfig(names: names))
        state.scores = [120, 80]
        state.bags = [2, 1]
        XCTAssertEqual(SpadesReview.scores(state),
                       "You and South 120 with 2 bags, East and West 80 with 1 bag. Playing to 500.")
        state.config.pointsToWin = 250
        state.bags = [0, 0]
        XCTAssertEqual(SpadesReview.scores(state),
                       "You and South 120 with 0 bags, East and West 80 with 0 bags. Playing to 250.")
    }

    func testContractDuringTheBidding() {
        var state = SpadesGame.createGame(SpadesConfig(names: names))
        state.phase = .bidding
        state.dealer = 0
        state.turn = 1
        XCTAssertEqual(SpadesReview.contract(state, seat: 0), "Nobody has bid yet.")
        state.players[1].bid = 3
        state.players[2].bid = 0
        state.turn = 3
        XCTAssertEqual(SpadesReview.contract(state, seat: 0), "East 3, South nil.")
    }

    func testContractDuringPlay() {
        var state = position(bids: [3, 4, 2, 3], tricks: [2, 4, 1, 4],
                             hands: ["2C", "3C", "4C", "5C"], leader: 0, tricksPlayed: 11,
                             config: SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.contract(state, seat: 0),
                       "You and South bid 5, took 3 — 2 more tricks needed. East and West bid 7, took 8 — 1 over, 1 bag so far.")
        // The other side hears its own contract first.
        XCTAssertEqual(SpadesReview.contract(state, seat: 1),
                       "East and West bid 7, took 8 — 1 over, 1 bag so far. You and South bid 5, took 3 — 2 more tricks needed.")
        state.players[0].tricks = 4
        XCTAssertEqual(SpadesReview.contract(state, seat: 0),
                       "You and South bid 5, took 5 — made it exactly. East and West bid 7, took 8 — 1 over, 1 bag so far.")
        state.players[2].tricks = 2
        state.players[0].tricks = 5
        XCTAssertEqual(SpadesReview.contract(state, seat: 0),
                       "You and South bid 5, took 7 — 2 over, 2 bags so far. East and West bid 7, took 8 — 1 over, 1 bag so far.")
    }

    func testContractNamesANilAndWhetherItIsIntact() {
        var state = position(bids: [3, 4, 0, 3], tricks: [2, 4, 0, 4],
                             hands: ["2C", "3C", "4C", "5C"], leader: 0, tricksPlayed: 10,
                             config: SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.contract(state, seat: 0),
                       "You and South bid 3, took 2 — 1 more trick needed. East and West bid 7, took 8 — 1 over, 1 bag so far. South bid nil and has not taken a trick.")
        state.players[2].tricks = 2
        XCTAssertEqual(SpadesReview.contract(state, seat: 0),
                       "You and South bid 3, took 4 — 1 over, 1 bag so far. East and West bid 7, took 8 — 1 over, 1 bag so far. South bid nil and has taken 2 tricks.")
    }

    func testCardsPlayed() {
        var state = position(bids: [3, 3, 3, 3], tricks: [0, 0, 0, 0],
                             hands: ["AS 2C 3D 4H", "3C 4D KH 2S", "5C 6C QH 3S", "7D 8D JH 4S"], leader: 0, tricksPlayed: 0,
                             config: SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.cardsPlayed(state, seat: 0),
                       "0 tricks played, 13 to go. Spades have not been broken. No spades have gone. Highest still out: Ace of Clubs, Ace of Diamonds, Ace of Hearts and King of Spades.")
        var rng = RandomSource(seed: 1)
        for (seat, id) in ["2C", "3C", "5C", "4S"].enumerated() {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .play(card(id)), rng: &rng).ok)
        }
        XCTAssertEqual(state.tricksPlayed, 1)
        XCTAssertEqual(SpadesReview.cardsPlayed(state, seat: 0),
                       "1 trick played, 12 to go. Spades are broken. 1 spade gone. Highest still out: Ace of Clubs, Ace of Diamonds, Ace of Hearts and King of Spades.")
        // East, who does not hold the ace of spades, is told it is still out.
        XCTAssertEqual(SpadesReview.cardsPlayed(state, seat: 1),
                       "1 trick played, 12 to go. Spades are broken. 1 spade gone. Highest still out: Ace of Clubs, Ace of Diamonds, Ace of Hearts and Ace of Spades.")
    }

    func testWhoIsHere() {
        let state = SpadesGame.createGame(SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.whoIsHere(state, seat: 0),
                       "You (a person) and South (computer), your side. Against: East (computer) and West (computer).")
    }

    func testStatusInEveryPhase() {
        var state = SpadesGame.createGame(SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Ready to start.")

        state.phase = .bidding
        state.dealer = 3
        state.dealNumber = 1
        state.turn = 0
        XCTAssertEqual(SpadesReview.status(state, seat: 0),
                       "Your bid. How many tricks will you take? Your partner has not bid yet.")
        state.turn = 2
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Waiting for South to bid.")
        state.players[2].bid = 0
        state.turn = 0
        state.dealer = 1
        XCTAssertEqual(SpadesReview.status(state, seat: 0),
                       "Your bid. How many tricks will you take? South bid nil.")
        state.players[2].bid = 4
        XCTAssertEqual(SpadesReview.status(state, seat: 0),
                       "Your bid. How many tricks will you take? South bid 4.")

        state = position(bids: [3, 4, 2, 3], tricks: [2, 4, 1, 4],
                         hands: ["2C", "3C", "4C", "5C"], leader: 0, tricksPlayed: 11,
                         config: SpadesConfig(names: names))
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Your turn. You lead. You need 2 more.")
        var rng = RandomSource(seed: 1)
        _ = SpadesGame.applyAction(&state, seat: 0, action: .play(card("2C")), rng: &rng)
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Waiting for East. You need 2 more.")
        XCTAssertEqual(SpadesReview.status(state, seat: 1), "Your turn. Clubs was led. 1 bag over.")
        state.players[0].tricks = 4
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Waiting for East. Your contract is made.")
        state.players[0].tricks = 6
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "Waiting for East. 2 bags over.")

        state.phase = .handOver
        state.dealNumber = 3
        state.scores = [50, 80]
        XCTAssertEqual(SpadesReview.status(state, seat: 0),
                       "Hand 3 is over. You and South 50 with 0 bags, East and West 80 with 0 bags. Playing to 500.")

        state.phase = .gameOver
        state.winner = 1
        state.scores = [380, 510]
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "East and West win, 510 to 380.")
        state.winner = nil
        XCTAssertEqual(SpadesReview.status(state, seat: 0), "The game is over.")
    }
}

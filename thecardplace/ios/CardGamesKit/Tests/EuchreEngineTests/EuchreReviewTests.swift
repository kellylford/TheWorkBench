import XCTest
import CardCore
@testable import EuchreEngine

/// Exact-string checks on the card descriptions and the review sentences from
/// constructed positions. Seat 0 is "You"; Ruth is on the left, Dale is the
/// partner across the table, Marta is on the right.
final class EuchreReviewTests: XCTestCase {
    let c = Support.card

    // MARK: Card text

    func testDescribeNamesBothBowers() {
        XCTAssertEqual(EuchreCards.describe(c("JC"), trump: .spades),
                       "Jack of Clubs, left bower, second highest trump, counts as spades")
        XCTAssertEqual(EuchreCards.describe(c("JS"), trump: .spades), "Jack of Spades, right bower, the highest trump")
        XCTAssertEqual(EuchreCards.describe(c("AS"), trump: .spades), "Ace of Spades, trump")
        XCTAssertEqual(EuchreCards.describe(c("AH"), trump: .spades), "Ace of Hearts")
        XCTAssertEqual(EuchreCards.describe(c("JC"), trump: nil), "Jack of Clubs")
        XCTAssertEqual(EuchreCards.describe(c("JH"), trump: .diamonds),
                       "Jack of Hearts, left bower, second highest trump, counts as diamonds")
        XCTAssertEqual(EuchreCards.role(c("AH"), trump: .spades), "")
        XCTAssertEqual(EuchreCards.role(c("9S"), trump: .spades), "trump")
    }

    func testSortHandFilesTheLeftBowerUnderTrump() {
        let hand = Support.cards(["9H", "JC", "AS", "KD", "JS"])
        XCTAssertEqual(EuchreCards.sortHand(hand, trump: .spades).ids, ["JS", "JC", "AS", "9H", "KD"])
        XCTAssertEqual(EuchreCards.sortHand(hand, trump: nil).ids, ["JC", "AS", "JS", "9H", "KD"])
        XCTAssertEqual(EuchreCards.sortHand(hand, trump: .hearts).ids, ["9H", "JC", "AS", "JS", "KD"])
    }

    // MARK: H — the hand

    let bidHand = ["JC", "AS", "9H", "KD", "TD"]

    func testHandDuringRoundOneMapsTheBowers() {
        let s = Support.position(phase: .bid1, dealer: 3, turn: 0, hands: [bidHand, [], [], []],
                                 upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.hand(s, seat: 0),
                       "With spades as trump you would hold two trump. Trump: Jack of Clubs, the left bower, Ace of Spades. " +
                       "The rest: Hearts: Nine of Hearts. Diamonds: King of Diamonds, Ten of Diamonds. " +
                       "Marta is dealing, so the Jack of Spades would go to the other side.")

        let partnerDeals = Support.position(phase: .bid1, dealer: 2, turn: 3, hands: [bidHand, [], [], []],
                                            upcard: "JS", upcardStatus: .up)
        XCTAssertTrue(EuchreReview.hand(partnerDeals, seat: 0).hasSuffix(
            "Your partner is dealing, so the Jack of Spades would go to them."))

        let youDeal = Support.position(phase: .bid1, dealer: 0, turn: 1, hands: [bidHand, [], [], []],
                                       upcard: "JS", upcardStatus: .up)
        XCTAssertTrue(EuchreReview.hand(youDeal, seat: 0).hasSuffix(
            "You are the dealer, so the Jack of Spades would come to you and you would put a card back."))

        let none = Support.position(phase: .bid1, dealer: 3, turn: 0, hands: [["9H", "TH", "KD", "QD", "9C"], [], [], []],
                                    upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.hand(none, seat: 0),
                       "With spades as trump you would hold no trump. The rest: Clubs: Nine of Clubs. " +
                       "Hearts: Ten of Hearts, Nine of Hearts. Diamonds: King of Diamonds, Queen of Diamonds. " +
                       "Marta is dealing, so the Jack of Spades would go to the other side.")

        let allTrump = Support.position(phase: .bid1, dealer: 3, turn: 0, hands: [["JS", "JC", "AS", "KS", "9S"], [], [], []],
                                        upcard: "TS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.hand(allTrump, seat: 0),
                       "With spades as trump you would hold five trump. Trump: Jack of Spades, the right bower, " +
                       "Jack of Clubs, the left bower, Ace of Spades, King of Spades, Nine of Spades. Nothing else. " +
                       "Marta is dealing, so the Ten of Spades would go to the other side.")
    }

    func testHandDuringRoundTwoCountsEachSuit() {
        let s = Support.position(phase: .bid2, dealer: 3, turn: 0, hands: [bidHand, [], [], []],
                                 upcard: "JS", upcardStatus: .turnedDown, deniedSuit: .spades)
        XCTAssertEqual(EuchreReview.hand(s, seat: 0),
                       "Your hand: Clubs: Jack of Clubs. Spades: Ace of Spades. Hearts: Nine of Hearts. " +
                       "Diamonds: King of Diamonds, Ten of Diamonds. Spades cannot be named. " +
                       "Trump you would hold: clubs 1, hearts 1, diamonds 2.")
    }

    func testHandDuringPlayAndWhileDiscarding() {
        let play = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades, hands: [bidHand, [], [], []],
                                    upcard: "JS", upcardStatus: .taken, maker: 1)
        XCTAssertEqual(EuchreReview.hand(play, seat: 0),
                       "Your hand, five cards. Trump: Jack of Clubs, the left bower, Ace of Spades. " +
                       "Hearts: Nine of Hearts. Diamonds: King of Diamonds, Ten of Diamonds.")

        let discard = Support.position(phase: .discard, dealer: 0, turn: 0, trump: .spades,
                                       hands: [bidHand + ["JS"], [], [], []], upcard: "JS", upcardStatus: .taken, maker: 1)
        XCTAssertEqual(EuchreReview.hand(discard, seat: 0),
                       "You took the Jack of Spades. Your hand, six cards. Trump: Jack of Spades, the right bower, " +
                       "Jack of Clubs, the left bower, Ace of Spades. Hearts: Nine of Hearts. " +
                       "Diamonds: King of Diamonds, Ten of Diamonds.")

        let out = Support.position(phase: .play, dealer: 3, turn: 1, trump: .spades, hands: [bidHand, [], [], []],
                                   upcard: "JS", upcardStatus: .taken, maker: 2, alone: true, sittingOut: 0)
        XCTAssertTrue(EuchreReview.hand(out, seat: 0).hasSuffix(
            " These are out of play this hand — Dale is playing alone."))

        XCTAssertEqual(EuchreReview.hand(Support.position(phase: .handOver), seat: 0), "Your hand is empty.")
    }

    // MARK: T, L — the trick and the last trick

    func testTrick() {
        let empty = Support.position(phase: .play, dealer: 0, turn: 1, trump: .spades)
        XCTAssertEqual(EuchreReview.trick(empty, seat: 0), "Trick 1 of 5. Nothing played yet. Ruth to lead.")

        let s = Support.position(phase: .play, dealer: 0, turn: 3, leader: 1, trump: .spades,
                                 trick: [(1, "AS"), (2, "9S")])
        XCTAssertEqual(EuchreReview.trick(s, seat: 0),
                       "Trick 1 of 5. Ruth, Ace of Spades, trump. Dale, Nine of Spades, trump. " +
                       "Trump led. Ruth is winning with the Ace of Spades, trump.")

        let plain = Support.position(phase: .play, dealer: 0, turn: 0, leader: 2, trump: .spades,
                                     trick: [(2, "KH"), (3, "JC")])
        XCTAssertEqual(EuchreReview.trick(plain, seat: 0),
                       "Trick 1 of 5. Dale, King of Hearts. Marta, Jack of Clubs, left bower, second highest trump, counts as spades. " +
                       "Hearts led. Marta is winning with the Jack of Clubs, left bower, second highest trump, counts as spades.")
    }

    func testLastTrick() {
        var s = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades)
        XCTAssertEqual(EuchreReview.lastTrick(s, seat: 0), "No trick has been completed yet this hand.")
        s.lastTrick = EuchreTrick(number: 1, plays: [
            EuchrePlay(player: 1, card: c("AS")), EuchrePlay(player: 2, card: c("9S")),
            EuchrePlay(player: 3, card: c("KH")), EuchrePlay(player: 0, card: c("JC")),
        ], winner: 0)
        XCTAssertEqual(EuchreReview.lastTrick(s, seat: 0),
                       "Trick 1. Ruth, Ace of Spades. Dale, Nine of Spades. Marta, King of Hearts. You, Jack of Clubs. You took it.")
    }

    // MARK: S — the score

    func testScores() {
        var s = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades, maker: 1)
        s.players[0].tricksWon = 1
        s.players[1].tricksWon = 1
        s.scores = [3, 2]
        XCTAssertEqual(EuchreReview.scores(s, seat: 0),
                       "Tricks this hand: you and Dale 1, Ruth and Marta 1. Game 1 to 10: you 3, them 2. " +
                       "They need two more tricks; two more tricks euchres them.")
        s.maker = 0
        XCTAssertEqual(EuchreReview.scores(s, seat: 0),
                       "Tricks this hand: you and Dale 1, Ruth and Marta 1. Game 1 to 10: you 3, them 2. " +
                       "You need two more tricks to make it.")
        s.players[2].tricksWon = 2
        s.gamesWon = [1, 0]
        XCTAssertEqual(EuchreReview.scores(s, seat: 0),
                       "Tricks this hand: you and Dale 3, Ruth and Marta 1. Game 1 to 10: you 3, them 2. " +
                       "Games won: you 1, them 0. You have made it.")
        // From Ruth's chair the same position reads the other way round.
        XCTAssertEqual(EuchreReview.scores(s, seat: 1),
                       "Tricks this hand: you and Marta 1, You and Dale 3. Game 1 to 10: you 2, them 3. " +
                       "Games won: you 0, them 1. They have made it.")
    }

    // MARK: P — trump and partners

    func testTrumpAndPartner() {
        let alone = Support.position(phase: .play, dealer: 2, turn: 3, trump: .spades, upcard: "JS",
                                     upcardStatus: .taken, maker: 1, alone: true, sittingOut: 3)
        XCTAssertEqual(EuchreReview.trumpAndPartner(alone, seat: 0),
                       "Your partner is Dale, in seat 3. Spades are trump, made by Ruth, against you. " +
                       "The right bower is the Jack of Spades and the left bower is the Jack of Clubs. " +
                       "Ruth is playing alone, so Marta is sitting this hand out. The upcard was the Jack of Spades, taken by Dale.")

        let named = Support.position(phase: .play, dealer: 2, turn: 3, trump: .hearts, upcard: "JS",
                                     upcardStatus: .turnedDown, deniedSuit: .spades, maker: 0)
        XCTAssertEqual(EuchreReview.trumpAndPartner(named, seat: 0),
                       "Your partner is Dale, in seat 3. Hearts are trump, made by you, on your side. " +
                       "The right bower is the Jack of Hearts and the left bower is the Jack of Diamonds. " +
                       "The upcard was the Jack of Spades, turned down.")

        var bid1 = Support.position(phase: .bid1, dealer: 3, turn: 2, upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.trumpAndPartner(bid1, seat: 0),
                       "Your partner is Dale, in seat 3. The upcard is the Jack of Spades, so spades are on offer. " +
                       "Marta is dealing. Nobody has bid yet this round.")
        bid1.bidLog = [EuchreBid(player: 0, kind: .pass, round: 1, words: "pass"),
                       EuchreBid(player: 1, kind: .pass, round: 1, words: "pass")]
        XCTAssertTrue(EuchreReview.trumpAndPartner(bid1, seat: 0).hasSuffix("Marta is dealing. You, Ruth have passed."))

        let bid2 = Support.position(phase: .bid2, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .turnedDown,
                                    deniedSuit: .spades, config: Support.config(stick: true))
        XCTAssertEqual(EuchreReview.trumpAndPartner(bid2, seat: 0),
                       "Your partner is Dale, in seat 3. The Jack of Spades was turned down, so spades cannot be named. " +
                       "Marta is dealing and must name a suit if it reaches them. Nobody has bid yet this round.")
    }

    // MARK: C — cards played

    func testCardsPlayed() {
        var s = Support.position(phase: .play, dealer: 3, turn: 1, trump: .spades, upcard: "JS", upcardStatus: .taken, maker: 0)
        s.played = Support.cards(["AS", "9S", "KH", "JC"])
        XCTAssertEqual(EuchreReview.cardsPlayed(s, seat: 0),
                       "Trump played: 3 of 7. Clubs: no cards played. Hearts: one card played. Diamonds: no cards played. " +
                       "The upcard was the Jack of Spades.")
        let bidding = Support.position(phase: .bid1, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.cardsPlayed(bidding, seat: 0),
                       "Trump has not been decided yet, so there is nothing to count. The upcard is the Jack of Spades.")
    }

    // MARK: O — play order

    func testPlayOrder() {
        let s = Support.position(phase: .play, dealer: 0, turn: 2, leader: 1, trump: .spades, maker: 1, trick: [(1, "AS")])
        XCTAssertEqual(EuchreReview.playOrder(s, seat: 0),
                       "Play order for this trick, starting with the lead. 1, Ruth, maker, played the Ace of Spades. " +
                       "2, Dale, your partner, to play. 3, Marta, to play. 4, You, dealer, to play. You play last. " +
                       "The maker plays three places before you. Nobody plays after you.")

        let lead = Support.position(phase: .play, dealer: 3, turn: 1, leader: 1, trump: .hearts, maker: 2, alone: true,
                                    sittingOut: 0, config: Support.config(names: ["Kim", "Ruth", "Dale", "Marta"]))
        XCTAssertEqual(EuchreReview.playOrder(lead, seat: 0),
                       "Play order for this trick, starting with the lead. 1, Ruth, to play. 2, Dale, maker, alone, your partner, to play. " +
                       "3, Marta, dealer, to play. You are sitting out, so there are only three cards to this trick.")
        XCTAssertEqual(EuchreReview.playOrder(lead, seat: 1),
                       "Play order for this trick, starting with the lead. 1, Ruth, to play. 2, Dale, maker, alone, to play. " +
                       "3, Marta, dealer, your partner, to play. Kim is sitting out, so there are only three cards to this trick. " +
                       "You lead. The maker plays one place after you. 2 players play after you: Dale, Marta.")

        let bidding = Support.position(phase: .bid1, dealer: 3, turn: 2, upcard: "JS", upcardStatus: .up)
        var b = bidding
        b.bidLog = [EuchreBid(player: 0, kind: .pass, round: 1, words: "pass"),
                    EuchreBid(player: 1, kind: .pass, round: 1, words: "pass")]
        XCTAssertEqual(EuchreReview.playOrder(b, seat: 0),
                       "Bidding order, starting to the dealer's left. 1, You, passed. 2, Ruth, passed. " +
                       "3, Dale, your partner, deciding now. 4, Marta, dealer, still to decide.")

        let discard = Support.position(phase: .discard, dealer: 1, turn: 1, trump: .spades, maker: 3)
        XCTAssertEqual(EuchreReview.playOrder(discard, seat: 0),
                       "Seating order: You, Ruth, dealer, Dale, your partner, Marta, maker.")
    }

    // MARK: The status line and the turn prompt

    func testStatusVariants() {
        XCTAssertEqual(EuchreReview.status(EuchreGame.createGame(Support.config()), seat: 0), "No hand has been dealt yet.")

        let bid1You = Support.position(phase: .bid1, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.status(bid1You, seat: 0),
                       "Bidding, round one. The upcard is the Jack of Spades. Your turn: order it up or pass?")
        let bid1Ruth = Support.position(phase: .bid1, dealer: 3, turn: 1, upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.status(bid1Ruth, seat: 0),
                       "Bidding, round one. The upcard is the Jack of Spades. Waiting for Ruth.")

        let bid2 = Support.position(phase: .bid2, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .turnedDown, deniedSuit: .spades)
        XCTAssertEqual(EuchreReview.status(bid2, seat: 0), "Bidding, round two. Spades turned down. Your turn: name a suit or pass?")
        XCTAssertEqual(EuchreReview.status(bid2, seat: 2), "Bidding, round two. Spades turned down. Waiting for You.")

        XCTAssertEqual(EuchreReview.status(Support.position(phase: .discard, dealer: 0, turn: 0, trump: .spades), seat: 0),
                       "You took the upcard. Put one card back.")
        XCTAssertEqual(EuchreReview.status(Support.position(phase: .discard, dealer: 1, turn: 1, trump: .spades), seat: 0),
                       "Ruth took the upcard and is putting a card back.")

        let play = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades, maker: 0)
        XCTAssertEqual(EuchreReview.status(play, seat: 0), "Spades are trump — trick 1 of 5 — your turn to play.")
        var later = play
        later.turn = 1
        later.trickLog = [EuchreTrick(number: 1, plays: [], winner: 1), EuchreTrick(number: 2, plays: [], winner: 1)]
        XCTAssertEqual(EuchreReview.status(later, seat: 0), "Spades are trump — trick 3 of 5 — Ruth to play.")
        let out = Support.position(phase: .play, dealer: 3, turn: 1, trump: .spades, maker: 2, alone: true, sittingOut: 0)
        XCTAssertEqual(EuchreReview.status(out, seat: 0), "Spades are trump — trick 1 of 5 — you are sitting out this hand.")

        var over = Support.position(phase: .handOver)
        over.handNumber = 3
        over.scores = [4, 2]
        XCTAssertEqual(EuchreReview.status(over, seat: 0), "Hand 3 complete. Score 4 to 2.")
        XCTAssertEqual(EuchreReview.status(over, seat: 1), "Hand 3 complete. Score 2 to 4.")

        var won = Support.position(phase: .gameOver)
        won.handNumber = 9
        won.scores = [10, 7]
        won.gameWinner = 0
        XCTAssertEqual(EuchreReview.status(won, seat: 0), "Hand 9 complete. Game over — You and Dale win, 10 to 7.")
    }

    func testTurnPrompt() {
        let bid1 = Support.position(phase: .bid1, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .up)
        XCTAssertEqual(EuchreReview.turnPrompt(bid1, seat: 0),
                       "Your turn to bid. The upcard is the Jack of Spades. Order it up to make spades trump, or pass.")
        XCTAssertEqual(EuchreReview.turnPrompt(bid1, seat: 1), "")
        let bid2 = Support.position(phase: .bid2, dealer: 3, turn: 0, upcard: "JS", upcardStatus: .turnedDown, deniedSuit: .spades)
        XCTAssertEqual(EuchreReview.turnPrompt(bid2, seat: 0), "Your turn to bid. Spades were turned down. Name another suit, or pass.")
        XCTAssertEqual(EuchreReview.turnPrompt(Support.position(phase: .discard, dealer: 0, turn: 0, trump: .spades), seat: 0),
                       "You took the upcard. Choose one card to put back.")
        XCTAssertEqual(EuchreReview.turnPrompt(Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades, maker: 0), seat: 0),
                       "Your lead. Trick 1 of 5.")
        let follow = Support.position(phase: .play, dealer: 3, turn: 0, leader: 1, trump: .spades, maker: 1, trick: [(1, "KH"), (2, "AH"), (3, "9H")])
        XCTAssertEqual(EuchreReview.turnPrompt(follow, seat: 0),
                       "Your turn to play. Hearts led. Dale is winning with the Ace of Hearts.")
        XCTAssertEqual(EuchreReview.turnPrompt(Support.position(phase: .handOver), seat: 0), "Choose Deal next hand.")
        XCTAssertEqual(EuchreReview.turnPrompt(Support.position(phase: .gameOver), seat: 0), "Choose Start a new game.")
        let out = Support.position(phase: .play, dealer: 3, turn: 1, trump: .spades, maker: 2, alone: true, sittingOut: 0)
        XCTAssertEqual(EuchreReview.turnPrompt(out, seat: 0), "You are sitting out this hand while Dale plays alone.")
    }

    // MARK: The end of the hand

    func testHandResultAndTheDealReveal() {
        var s = Support.position(phase: .handOver, dealer: 1, trump: .spades, upcard: "JS", upcardStatus: .taken, maker: 0, alone: true)
        s.discard = c("9H")
        s.dealt = EuchreDeal(hands: [[], [], [], []], upcard: c("JS"), kitty: Support.cards(["TC", "QD", "AH"]))
        s.result = EuchreResult(thrownIn: false, makerTeam: 0, made: 5, euchred: false, alone: true, trump: .spades,
                                maker: 0, deltas: [4, 0], label: "a march, alone — four", scores: [4, 0])
        XCTAssertEqual(EuchreReview.handResult(s, seat: 0), "You made spades, alone and took five tricks. Four points to you.")
        XCTAssertEqual(EuchreReview.handResult(s, seat: 1), "You made spades, alone and took five tricks. Four points to them.")
        XCTAssertEqual(EuchreReview.dealReveal(s),
                       "Ruth took the Jack of Spades and put back the Nine of Hearts. " +
                       "Upcard: Jack of Spades, right bower, the highest trump. Put back: Nine of Hearts. " +
                       "Kitty: Ten of Clubs, Queen of Diamonds and Ace of Hearts.")

        s.result = EuchreResult(thrownIn: false, makerTeam: 1, made: 2, euchred: true, alone: false, trump: .spades,
                                maker: 1, deltas: [2, 0], label: "euchred — two to the other side", scores: [2, 0])
        s.maker = 1
        s.alone = false
        XCTAssertEqual(EuchreReview.handResult(s, seat: 0), "Ruth made spades and took two tricks. Euchred — two points to you.")
        XCTAssertEqual(EuchreReview.handResult(s, seat: 1), "You made spades and took two tricks. You were euchred — two points against you.")

        var thrown = Support.position(phase: .handOver, dealer: 1, upcard: "JS", upcardStatus: .turnedDown, deniedSuit: .spades)
        thrown.dealt = EuchreDeal(hands: [[], [], [], []], upcard: c("JS"), kitty: Support.cards(["TC", "QD", "AH"]))
        thrown.result = EuchreResult(thrownIn: true, label: "thrown in")
        XCTAssertEqual(EuchreReview.handResult(thrown, seat: 0), "Everybody passed twice, so the hand was thrown in. Nobody scored.")
        XCTAssertEqual(EuchreReview.dealReveal(thrown),
                       "Nobody took the Jack of Spades and nobody named a suit, so the hand was thrown in. " +
                       "Upcard: Jack of Spades. Kitty: Ten of Clubs, Queen of Diamonds and Ace of Hearts.")

        XCTAssertNil(EuchreReview.dealReveal(Support.position(phase: .play, trump: .spades)))
    }

    func testDealRevealAfterARealHand() {
        var rng = RandomSource(seed: 8)
        var s = EuchreGame.createGame(Support.config())
        Support.playHand(&s, rng: &rng)
        guard let text = EuchreReview.dealReveal(s), let dealt = s.dealt else { return XCTFail("no reveal") }
        for k in dealt.kitty { XCTAssertTrue(text.contains(k.name), "the kitty card \(k.name) is not shown") }
        XCTAssertTrue(text.contains(dealt.upcard.name))
        if let d = s.discard { XCTAssertTrue(text.contains("put back the \(d.name)")) }
    }

    func testHandSummaryEventWording() {
        var s = Support.position(phase: .play, dealer: 3, turn: 0, trump: .spades, hands: [["AS"], ["9H"], ["TH"], ["KD"]],
                                 upcard: "TS", upcardStatus: .taken, maker: 1)
        s.trickLog = (1...4).map { EuchreTrick(number: $0, plays: [], winner: 0) }
        s.players[0].tricksWon = 4
        var rng = RandomSource(seed: 1)
        for (seat, id) in [(0, "AS"), (1, "9H"), (2, "TH"), (3, "KD")] {
            XCTAssertTrue(EuchreGame.applyAction(&s, seat: seat, action: .play(c(id)), rng: &rng).ok)
        }
        XCTAssertEqual(s.phase, .handOver)
        XCTAssertEqual(s.result?.deltas, [2, 0])
        XCTAssertEqual(s.log.events.last(where: { $0.kind == .hand })?.text,
                       "Ruth made spades and took 0 tricks. Ruth was euchred: two points to You and Dale. " +
                       "Score: You and Dale 2, Ruth and Marta 0.")
    }

    func testWhoIsHere() {
        let s = Support.position(phase: .play, dealer: 3, turn: 1, trump: .spades, maker: 0)
        XCTAssertEqual(EuchreReview.whoIsHere(s, seat: 0),
                       "You are playing against the computer. Your partner is Dale. Seat 1, You, you. " +
                       "Seat 2, Ruth, the computer, against you. Seat 3, Dale, the computer, your partner. " +
                       "Seat 4, Marta, the computer, against you. Waiting for Ruth.")
    }

    func testHelpTextIsPlainAndComplete() {
        XCTAssertEqual(EuchreHelp.rules.count, 9)
        XCTAssertEqual(EuchreHelp.rules.first?.heading, "How to play Euchre")
        for r in EuchreHelp.rules {
            XCTAssertFalse(r.body.contains("<"), "markup in help text")
            XCTAssertFalse(r.body.lowercased().contains("press "), "key reference in help text")
        }
        XCTAssertTrue(EuchreHelp.rules.contains { $0.body.contains("All five, playing alone: 4 points to the makers.") })
    }
}

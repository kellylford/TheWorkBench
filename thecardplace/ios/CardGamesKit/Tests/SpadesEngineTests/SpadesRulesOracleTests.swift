import XCTest
import CardCore
import SpadesEngine

/// The rules written out as literal data and re-derived by a different method
/// from the one the engine uses, then compared after every move — the port of
/// `spades/tests/rules-oracle.js`.
final class SpadesRulesOracleTests: XCTestCase {

    // MARK: - The trump order and what beats what, as literal lists

    /// Spades, highest first. Every spade beats every non-spade; within any
    /// suit the earlier rank wins; across two plain suits nothing beats
    /// anything.
    let spadesHighToLow = ["AS", "KS", "QS", "JS", "TS", "9S", "8S", "7S", "6S", "5S", "4S", "3S", "2S"]
    let ranksHighToLow = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]

    func testTrumpOrderIsTheLiteralList() {
        let spades = spadesHighToLow.map(card)
        for i in 0..<spades.count {
            for j in 0..<spades.count where i != j {
                XCTAssertEqual(SpadesCards.beats(spades[i], spades[j]), i < j,
                               "\(spades[i].id) against \(spades[j].id)")
            }
        }
        // Every spade beats every card of every other suit, and nothing else
        // ever beats a spade.
        for s in spades {
            for other in SpadesCards.newDeck() where other.suit != .spades {
                XCTAssertTrue(SpadesCards.beats(s, other), "\(s.id) should beat \(other.id)")
                XCTAssertFalse(SpadesCards.beats(other, s), "\(other.id) must not beat \(s.id)")
            }
        }
    }

    func testPlainSuitsRankAceHighAndNeverCrossSuits() {
        for suit in ["C", "D", "H"] {
            let run = ranksHighToLow.map { card($0 + suit) }
            for i in 0..<run.count {
                for j in 0..<run.count where i != j {
                    XCTAssertEqual(SpadesCards.beats(run[i], run[j]), i < j)
                }
            }
        }
        // The ace of hearts does not beat the two of clubs, nor the reverse.
        XCTAssertFalse(SpadesCards.beats(card("AH"), card("2C")))
        XCTAssertFalse(SpadesCards.beats(card("2C"), card("AH")))
        // But the two of spades beats the ace of hearts.
        XCTAssertTrue(SpadesCards.beats(card("2S"), card("AH")))
    }

    func testDescribeAndRole() {
        XCTAssertEqual(SpadesCards.role(card("2S")), "trump")
        XCTAssertEqual(SpadesCards.role(card("AH")), "")
        XCTAssertEqual(SpadesCards.describe(card("2S")), "Two of Spades, trump")
        XCTAssertEqual(SpadesCards.describe(card("AH")), "Ace of Hearts")
    }

    func testSortHandIsClubsDiamondsHeartsSpadesHighToLow() {
        let sorted = SpadesCards.sortHand(cards("2S AH 3C KC 9D AS QD"))
        XCTAssertEqual(sorted.ids, ["KC", "3C", "QD", "9D", "AH", "AS", "2S"])
    }

    // MARK: - The oracle's own idea of the rules

    /// Legal plays by elimination rather than construction: start from the
    /// whole hand, remove what the rules forbid, put everything back if
    /// nothing survives. `spadesBroken` is re-derived from the plays watched.
    func oracleLegal(_ state: SpadesState, seat: Int, broken: Bool) -> [String] {
        let hand = state.players[seat].hand
        var allowed = hand
        if state.trick.isEmpty {
            if !broken {
                let notTrump = allowed.filter { $0.suit != .spades }
                if !notTrump.isEmpty { allowed = notTrump }
            }
        } else {
            let led = state.trick[0].card.suit
            if hand.contains(where: { $0.suit == led }) { allowed = allowed.filter { $0.suit == led } }
        }
        if allowed.isEmpty { allowed = hand }
        return allowed.ids.sorted()
    }

    /// Replay the cards of a trick as two passes: highest spade if any spade
    /// is present, otherwise the highest card of the suit led.
    func oracleTrickWinner(_ plays: [SpadesPlay]) -> Int {
        let trumps = plays.filter { $0.card.suit == .spades }
        if let t = trumps.max(by: { $0.card.rank < $1.card.rank }) { return t.seat }
        let led = plays[0].card.suit
        return plays.filter { $0.card.suit == led }.max(by: { $0.card.rank < $1.card.rank })!.seat
    }

    struct Seen {
        var nilBid = 0, nilMade = 0, nilBroken = 0, setHands = 0, madeHands = 0
        var bagPenalties = 0, trumped = 0, spadeLeads = 0, voidDiscards = 0
        var tricks = 0, hands = 0, games = 0, bothOver = 0
        var targets = Set<Int>()
    }
    var seen = Seen()

    func playGames(_ n: Int, _ config: SpadesConfig, seedBase: UInt64) {
        for g in 0..<n {
            var (state, rng) = Drive.newGame(config, seed: seedBase &+ UInt64(g))
            let target = config.pointsToWin > 0 ? config.pointsToWin : 500
            let bagLimit = config.bagLimit > 0 ? config.bagLimit : 10
            let bagPenalty = config.bagPenalty >= 0 ? config.bagPenalty : 100
            let nilValue = config.nilValue > 0 ? config.nilValue : 100
            seen.targets.insert(target)

            var broken = false
            var handBids: [Int]? = nil
            var guardCount = 0

            while state.phase != .gameOver && guardCount < 40_000 {
                guardCount += 1
                if state.phase == .bidding {
                    guard let seat = SpadesGame.seatToAct(state) else { XCTFail("bidding with nobody to act"); return }
                    // Bidding goes round from the dealer's left; re-derived
                    // from the dealer rather than read from turn.
                    let expected = (state.dealer! + 1 + state.players.filter { $0.bid != nil }.count) % 4
                    XCTAssertEqual(seat, expected, "bidding out of order")

                    let bid = SpadesAI.chooseBid(state, seat: seat)
                    XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .bid(bid), rng: &rng).ok)
                    let again = SpadesGame.applyAction(&state, seat: seat, action: .bid(1), rng: &rng)
                    XCTAssertFalse(again.ok, "a second bid from seat \(seat) was accepted")

                    if state.phase == .play {
                        broken = false
                        handBids = state.players.map { $0.bid! }
                        seen.hands += 1
                        for b in handBids! where b == 0 { seen.nilBid += 1 }
                    }
                    continue
                }

                if state.phase == .play {
                    let seat = SpadesGame.seatToAct(state)!
                    XCTAssertEqual(seat, state.turn)
                    checkPlayPhase(state, broken: broken)

                    let legal = SpadesGame.legalPlays(state, seat: seat)
                    XCTAssertFalse(legal.isEmpty, "no legal play for seat \(seat)")
                    guard let pick = SpadesAI.chooseCard(state, seat: seat) else { XCTFail("no card chosen"); return }
                    XCTAssertTrue(legal.contains(pick), "the computer chose an illegal card \(pick.id)")

                    let trickBefore = state.trick
                    let leadSuit = trickBefore.first?.card.suit
                    let heldLed = leadSuit.map { s in state.players[seat].hand.contains { $0.suit == s } } ?? false

                    if pick.suit == .spades { broken = true }
                    if let ls = leadSuit, !heldLed {
                        seen.voidDiscards += 1
                        if pick.suit == .spades && ls != .spades { seen.trumped += 1 }
                    }
                    if trickBefore.isEmpty && pick.suit == .spades { seen.spadeLeads += 1 }

                    let before = state.tricksPlayed
                    let r = SpadesGame.applyAction(&state, seat: seat, action: .play(pick), rng: &rng)
                    XCTAssertTrue(r.ok, "play refused: \(r.reason ?? "")")
                    XCTAssertEqual(state.spadesBroken, broken, "spadesBroken drifted at trick \(state.tricksPlayed)")

                    if state.tricksPlayed == before + 1 {
                        seen.tricks += 1
                        let plays = trickBefore + [SpadesPlay(seat: seat, card: pick)]
                        XCTAssertEqual(state.lastTrick?.winner, oracleTrickWinner(plays),
                                       "trick winner for \(plays.map { $0.card.id })")
                    }
                    continue
                }

                if state.phase == .handOver {
                    if let hb = handBids {
                        checkHandScored(state, bids: hb, bagLimit: bagLimit, bagPenalty: bagPenalty, nilValue: nilValue)
                        handBids = nil
                    }
                    XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .nextHand, rng: &rng).ok)
                    continue
                }
                break
            }

            // The last hand of the game, which the loop above cannot reach.
            if let hb = handBids {
                checkHandScored(state, bids: hb, bagLimit: bagLimit, bagPenalty: bagPenalty, nilValue: nilValue)
            }

            XCTAssertEqual(state.phase, .gameOver, "game did not finish")
            if state.phase == .gameOver {
                seen.games += 1
                XCTAssertTrue(state.scores[0] >= target || state.scores[1] >= target)
                let hi = state.scores[0] >= state.scores[1] ? 0 : 1
                XCTAssertEqual(state.winner, hi, "the winner is not the higher score")
                XCTAssertGreaterThanOrEqual(state.scores[state.winner!], target)
                // Every hand but the last leaves both sides under the line,
                // except a level tie which plays on.
                for h in state.history.dropLast() {
                    let over = h.scores.filter { $0 >= target }
                    if over.count == 2 && h.scores[0] == h.scores[1] { seen.bothOver += 1; continue }
                    XCTAssertEqual(over.count, 0, "hand \(h.deal) passed the target and the game carried on")
                }
            }
        }
    }

    func checkPlayPhase(_ state: SpadesState, broken: Bool) {
        let seat = state.turn
        let mine = SpadesGame.legalPlays(state, seat: seat).ids.sorted()
        let theirs = oracleLegal(state, seat: seat, broken: broken)
        XCTAssertEqual(mine, theirs, "legal plays differ for seat \(seat)")

        // Hands are the same size, or one apart mid-trick.
        let sizes = state.players.map { $0.hand.count }
        XCTAssertLessThanOrEqual(sizes.max()! - sizes.min()!, 1, "hand sizes drifted: \(sizes)")

        // No card exists twice, anywhere.
        var all = Set<Card>()
        var dupes = 0
        for p in state.players { for c in p.hand { if !all.insert(c).inserted { dupes += 1 } } }
        for t in state.trick { if !all.insert(t.card).inserted { dupes += 1 } }
        XCTAssertEqual(dupes, 0, "the same card is in play twice")
    }

    /// Re-derive the score by a method that shares nothing with scoreHand.
    func checkHandScored(_ state: SpadesState, bids: [Int], bagLimit: Int, bagPenalty: Int, nilValue: Int) {
        guard let h = state.history.last else { XCTFail("no history row"); return }
        XCTAssertEqual(h.tricks.reduce(0, +), 13)
        XCTAssertEqual(h.bids, bids)

        for team in 0..<2 {
            let seats = [team, team + 2]
            let contract = seats.reduce(0) { $0 + bids[$1] }
            let took = seats.reduce(0) { $0 + h.tricks[$1] }
            if took >= contract { seen.madeHands += 1 } else { seen.setHands += 1 }

            var want = 0, over = 0
            if took >= contract { want += 10 * contract; over = took - contract; want += over }
            else { want -= 10 * contract }
            for s in seats where bids[s] == 0 {
                let made = h.tricks[s] == 0
                want += made ? nilValue : -nilValue
                if made { seen.nilMade += 1 } else { seen.nilBroken += 1 }
            }
            let prev = state.history.count > 1 ? state.history[state.history.count - 2].bags[team] : 0
            var bags = prev + over
            var penalties = 0
            while bagLimit > 0 && bags >= bagLimit { bags -= bagLimit; penalties += bagPenalty }
            want -= penalties
            if penalties > 0 { seen.bagPenalties += 1 }

            XCTAssertEqual(h.delta[team], want, "hand \(h.deal) team \(team): bids \(bids) tricks \(h.tricks)")
            XCTAssertEqual(h.bags[team], bags, "hand \(h.deal) team \(team) bags")
        }
        for team in 0..<2 {
            let total = state.history.reduce(0) { $0 + $1.delta[team] }
            XCTAssertEqual(h.scores[team], total, "the running score drifted from the sum of the hands")
        }
    }

    func testEngineAgreesWithTheOracleAcrossManyGames() {
        seen = Seen()
        playGames(30, SpadesConfig(names: testNames), seedBase: 20260825)
        playGames(10, SpadesConfig(names: testNames, pointsToWin: 250), seedBase: 991)
        playGames(6, SpadesConfig(names: testNames, pointsToWin: 250, bagLimit: 5, bagPenalty: 50, nilValue: 50), seedBase: 4242)
        playGames(4, SpadesConfig(names: testNames, pointsToWin: 250, bagPenalty: 0), seedBase: 777)

        // A run that never met the interesting cases has not tested them.
        XCTAssertEqual(seen.nilMade + seen.nilBroken, seen.nilBid, "some hands were never scored")
        XCTAssertGreaterThan(seen.hands, 0)
        XCTAssertGreaterThan(seen.setHands, 0, "no contract was ever set")
        XCTAssertGreaterThan(seen.madeHands, 0, "no contract was ever made")
        XCTAssertGreaterThan(seen.nilBid, 0, "nobody ever bid nil")
        XCTAssertGreaterThan(seen.nilMade, 0, "no nil ever came in")
        XCTAssertGreaterThan(seen.nilBroken, 0, "no nil was ever broken")
        XCTAssertGreaterThan(seen.bagPenalties, 0, "the bag bin never filled")
        XCTAssertGreaterThan(seen.trumped, 0, "nobody ever ruffed")
        XCTAssertGreaterThan(seen.spadeLeads, 0, "a spade was never led")
        XCTAssertGreaterThanOrEqual(seen.targets.count, 2, "every game ran to the same target")
    }

    // MARK: - The forced spade lead

    func testAHandOfNothingButSpadesMayLeadOneAndThatBreaksThem() {
        var (state, rng) = Drive.newGame(seed: 5)
        while state.phase == .bidding {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: state.turn, action: .bid(2), rng: &rng).ok)
        }
        let lead = state.turn
        let rest = (0..<4).filter { $0 != lead }
        state.players[lead].hand = cards("2S 3S")
        state.players[rest[0]].hand = cards("AS 4S KH")
        state.players[rest[1]].hand = cards("QS QH")
        state.players[rest[2]].hand = cards("JS JH")

        XCTAssertEqual(SpadesGame.legalPlays(state, seat: lead).ids.sorted(), ["2S", "3S"])
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: lead, action: .play(card("2S")), rng: &rng).ok)
        XCTAssertTrue(state.spadesBroken, "a spade was led and spades are still not broken")

        for _ in 0..<3 {
            let seat = state.turn
            let sp = state.players[seat].hand.first { $0.suit == .spades }!
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .play(sp), rng: &rng).ok)
        }
        // The winner, holding a spade and a heart, may now lead either.
        let winner = state.turn
        XCTAssertEqual(SpadesGame.legalPlays(state, seat: winner).count, state.players[winner].hand.count)
    }

    // MARK: - canDeal and seatToAct through every phase

    func testCanDealIsExactlyWhatApplyActionAccepts() {
        var (state, rng) = Drive.newGame(SpadesConfig(names: testNames, pointsToWin: 100), seed: 11)
        var phases = Set<SpadesPhase>()
        func probe(_ s: SpadesState) {
            phases.insert(s.phase)
            var copy = s
            var r2 = RandomSource(seed: 1)
            let did = SpadesGame.applyAction(&copy, seat: 0, action: .nextHand, rng: &r2).ok
            XCTAssertEqual(SpadesGame.canDeal(s), did, "canDeal disagrees with applyAction at \(s.phase)")
        }
        probe(SpadesGame.createGame(SpadesConfig()))
        var guardCount = 0
        while state.phase != .gameOver && guardCount < 40_000 {
            guardCount += 1
            probe(state)
            Drive.step(&state, rng: &rng)
        }
        probe(state)
        XCTAssertEqual(phases, [.idle, .bidding, .play, .handOver, .gameOver])
    }

    func testSeatToActIsNilInEveryDeadPhase() {
        XCTAssertNil(SpadesGame.seatToAct(SpadesGame.createGame(SpadesConfig())))
        var (state, rng) = Drive.newGame(SpadesConfig(names: testNames, pointsToWin: 100), seed: 12)
        var guardCount = 0
        while state.phase != .gameOver && guardCount < 40_000 {
            guardCount += 1
            let s = SpadesGame.seatToAct(state)
            if state.phase == .bidding || state.phase == .play {
                XCTAssertNotNil(s)
                XCTAssertEqual(s, state.turn)
            } else {
                XCTAssertNil(s, "seatToAct answered at \(state.phase)")
            }
            Drive.step(&state, rng: &rng)
        }
        XCTAssertNil(SpadesGame.seatToAct(state))
    }

    // MARK: - Event wording

    func testDealAndBidEvents() {
        var rng = RandomSource(seed: 3)
        var state = SpadesGame.createGame(SpadesConfig(names: testNames))
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .start, rng: &rng).ok)
        let dealer = state.dealer!
        let first = (dealer + 1) % 4
        XCTAssertEqual(state.log.events.last?.text,
                       "Hand 1 dealt. \(testNames[dealer]) dealt; \(testNames[first]) bids first.")
        XCTAssertEqual(state.log.events.last?.kind, .deal)

        XCTAssertTrue(SpadesGame.applyAction(&state, seat: first, action: .nilBid, rng: &rng).ok)
        XCTAssertEqual(state.log.events.last?.text, "\(testNames[first]) bid nil.")
        XCTAssertEqual(state.log.events.last?.kind, .bid)
        XCTAssertEqual(state.players[first].bid, 0, "a nil bid was not recorded as zero")

        XCTAssertTrue(SpadesGame.applyAction(&state, seat: (first + 1) % 4, action: .bid(4), rng: &rng).ok)
        XCTAssertEqual(state.log.events.last?.text, "\(testNames[(first + 1) % 4]) bid 4.")
    }

    func testBiddingDoneEventSaysTheTableShape() {
        var rng = RandomSource(seed: 9)
        var state = SpadesGame.createGame(SpadesConfig(names: testNames))
        _ = SpadesGame.applyAction(&state, seat: 0, action: .start, rng: &rng)
        let dealer = state.dealer!
        let order = (1...4).map { (dealer + $0) % 4 }
        let bids = [3, 4, 3, 5]   // in bidding order
        for (i, seat) in order.enumerated() {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .bid(bids[i]), rng: &rng).ok)
        }
        XCTAssertEqual(state.phase, .play)
        let t0 = SpadesGame.contractOf(state, team: 0), t1 = SpadesGame.contractOf(state, team: 1)
        XCTAssertEqual(t0 + t1, 15)
        XCTAssertEqual(state.log.events.last?.text,
                       "Bidding is done. North and South for \(t0), East and West for \(t1). That is 2 over the 13 available. \(testNames[order[0]]) leads.")
        XCTAssertEqual(state.leader, order[0])
    }

    func testPlayTrickAndScoreEventsAtTheEndOfAHand() {
        // Bids 3,4,2,4; tricks before the last one 3,4,2,3; West takes the
        // last trick with the ace of clubs, so both sides make exactly.
        var state = position(bids: [3, 4, 2, 4], tricks: [3, 4, 2, 3],
                             hands: ["2C", "3C", "4C", "AC"], leader: 0, tricksPlayed: 12,
                             config: SpadesConfig(names: testNames))
        var rng = RandomSource(seed: 1)
        for (seat, id) in ["2C", "3C", "4C", "AC"].enumerated() {
            let r = SpadesGame.applyAction(&state, seat: seat, action: .play(card(id)), rng: &rng)
            XCTAssertTrue(r.ok, r.reason ?? "")
        }
        let texts = state.log.events.map { $0.text }
        XCTAssertTrue(texts.contains("North played the Two of Clubs."))
        XCTAssertTrue(texts.contains("West took the trick with the Ace of Clubs."))
        XCTAssertTrue(texts.contains("North and South bid 5, took 5 — made it, +50."))
        XCTAssertTrue(texts.contains("East and West bid 8, took 8 — made it, +80."))
        XCTAssertTrue(texts.contains("Hand 1 over. North and South 50, East and West 80."))
        XCTAssertEqual(state.phase, .handOver)
        XCTAssertEqual(state.scores, [50, 80])
        XCTAssertEqual(state.history.count, 1)
        let play = state.log.events.first { $0.kind == .play }!
        XCTAssertEqual(play.cards, [card("2C")])
        XCTAssertEqual(play.seat, 0)
    }

    func testNilBagAndGameOverEvents() {
        // South is on nil and takes the last trick: the nil goes down, said
        // the moment it is certain and again at the scoring. North and South
        // are set (bid 5, took 3+1=4). East and West, bid 4, took 9: five
        // overtricks on eight bags fills the bin.
        var state = position(bids: [5, 2, 0, 2], tricks: [3, 4, 0, 5],
                             hands: ["2H", "3H", "AH", "4H"], leader: 0, tricksPlayed: 12,
                             scores: [400, 480], bags: [0, 8],
                             config: SpadesConfig(names: testNames))
        var rng = RandomSource(seed: 1)
        for (seat, id) in ["2H", "3H", "AH", "4H"].enumerated() {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .play(card(id)), rng: &rng).ok)
        }
        let texts = state.log.events.map { $0.text }
        XCTAssertTrue(texts.contains("South bid nil and has taken a trick."))
        XCTAssertTrue(texts.contains("North and South bid 5, took 4 — set, -150."))
        XCTAssertTrue(texts.contains("South’s nil went down on 1 trick."))
        XCTAssertTrue(texts.contains("East and West bid 4, took 9 — made it, -55."))
        XCTAssertTrue(texts.contains("East and West filled the bag bin — 100 off."))
        XCTAssertTrue(texts.contains("Hand 1 over. North and South 250, East and West 425."))
        XCTAssertEqual(state.bags, [0, 3])
        XCTAssertEqual(state.phase, .handOver)
    }

    func testGameOverEventAndWinner() {
        var state = position(bids: [3, 4, 2, 4], tricks: [3, 4, 2, 3],
                             hands: ["2C", "3C", "4C", "AC"], leader: 0, tricksPlayed: 12,
                             scores: [460, 300], config: SpadesConfig(names: testNames))
        var rng = RandomSource(seed: 1)
        for (seat, id) in ["2C", "3C", "4C", "AC"].enumerated() {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .play(card(id)), rng: &rng).ok)
        }
        XCTAssertEqual(state.phase, .gameOver)
        XCTAssertEqual(state.winner, 0)
        XCTAssertEqual(state.log.events.last?.text, "North and South win, 510 to 380.")
        XCTAssertEqual(state.log.events.last?.kind, .game)
        XCTAssertNil(SpadesGame.seatToAct(state))
    }

    func testBothOverAndLevelPlaysAnotherHand() {
        var state = position(bids: [3, 4, 2, 4], tricks: [3, 4, 2, 3],
                             hands: ["2C", "3C", "4C", "AC"], leader: 0, tricksPlayed: 12,
                             scores: [480, 450], config: SpadesConfig(names: testNames))
        var rng = RandomSource(seed: 1)
        for (seat, id) in ["2C", "3C", "4C", "AC"].enumerated() {
            XCTAssertTrue(SpadesGame.applyAction(&state, seat: seat, action: .play(card(id)), rng: &rng).ok)
        }
        XCTAssertEqual(state.scores, [530, 530])
        XCTAssertEqual(state.phase, .handOver)
        XCTAssertNil(state.winner)
        XCTAssertEqual(state.log.events.last?.text,
                       "Both partnerships passed 500 and are level. Another hand decides it.")
        XCTAssertTrue(SpadesGame.canDeal(state))
    }

    func testSpadesBrokenEventComesBeforeThePlay() {
        var state = position(bids: [3, 3, 3, 3], tricks: [0, 0, 0, 0],
                             hands: ["2C 3D", "AS 4D", "5C 6C", "7C 8C"], leader: 0, tricksPlayed: 0,
                             config: SpadesConfig(names: testNames))
        var rng = RandomSource(seed: 1)
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .play(card("2C")), rng: &rng).ok)
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 1, action: .play(card("AS")), rng: &rng).ok)
        let texts = state.log.events.suffix(2).map { $0.text }
        XCTAssertEqual(texts, ["Spades are broken.", "East played the Ace of Spades."])
        XCTAssertTrue(state.spadesBroken)
    }

    func testNewGameKeepsNamesAndRulesAndGoesBackToIdle() {
        let config = SpadesConfig(names: testNames, pointsToWin: 250, bagLimit: 5)
        var state = Drive.playGame(config, seed: 21)
        XCTAssertEqual(state.phase, .gameOver)
        var rng = RandomSource(seed: 1)
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .newGame, rng: &rng).ok)
        XCTAssertEqual(state.phase, .idle)
        XCTAssertEqual(state.config, config)
        XCTAssertEqual(state.players.map { $0.name }, testNames)
        XCTAssertEqual(state.scores, [0, 0])
        XCTAssertTrue(state.history.isEmpty)
        XCTAssertNil(state.dealer)
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .start, rng: &rng).ok)
        XCTAssertEqual(state.dealNumber, 1)
    }

    func testRulesOfTheTableFallBackFromNonsense() {
        let s = SpadesGame.createGame(SpadesConfig(pointsToWin: 0, bagLimit: -1, bagPenalty: -5, nilValue: 0))
        XCTAssertEqual(SpadesGame.target(of: s), 500)
        XCTAssertEqual(SpadesGame.bagLimit(of: s), 10)
        XCTAssertEqual(SpadesGame.bagPenalty(of: s), 100)
        XCTAssertEqual(SpadesGame.nilValue(of: s), 100)
        let zero = SpadesGame.createGame(SpadesConfig(bagPenalty: 0))
        XCTAssertEqual(SpadesGame.bagPenalty(of: zero), 0, "a zero bag penalty is a real choice")
    }

    func testHelpTextIsPresentAndPlain() {
        XCTAssertEqual(SpadesHelp.rules.map { $0.heading }, ["The object", "The bidding", "The play", "The scoring", "Nil"])
        for r in SpadesHelp.rules {
            XCTAssertFalse(r.body.contains("<"), "HTML in the help text")
            XCTAssertFalse(r.body.lowercased().contains("press "), "a key reference in the help text")
        }
    }
}

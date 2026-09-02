import XCTest
import CardCore
@testable import SheepheadEngine

/// The rules written out as literal data, from the game's own How to Play, and
/// the engine measured against them. Nothing here asks `isTrump`, `power`,
/// `beats`, `effectiveSuit`, `points` or `legalPlays` what to expect: those
/// are the things on trial.
final class RulesOracleTests: XCTestCase {
    static let suits = ["C", "S", "H", "D"]
    static let ranks = ["7", "8", "9", "T", "J", "Q", "K", "A"]
    static let deck: [String] = suits.flatMap { s in ranks.map { $0 + s } }
    static let points: [Character: Int] = ["A": 11, "T": 10, "K": 4, "Q": 3, "J": 2, "9": 0, "8": 0, "7": 0]

    /// Highest first. Typed out by hand from the sentence in How to Play.
    static let trump = [
        "QC", "QS", "QH", "QD",
        "JC", "JS", "JH", "JD",
        "AD", "TD", "KD", "9D", "8D", "7D",
    ]
    static let failRanks: [Character] = ["A", "T", "K", "9", "8", "7"]

    static func isTrump(_ id: String) -> Bool { trump.contains(id) }
    static func pts(_ id: String) -> Int { points[id.first!]! }
    static func suitLed(_ id: String) -> String { isTrump(id) ? "TRUMP" : String(id.last!) }
    static func rank(_ id: String) -> Int {
        isTrump(id) ? trump.firstIndex(of: id)! : failRanks.firstIndex(of: id.first!)!
    }

    /// "Highest trump takes the trick; if no trump is played, the highest card
    /// of the led suit takes it."
    static func trickWinner(_ ids: [String]) -> Int {
        let led = suitLed(ids[0])
        let trumps = ids.filter(isTrump)
        let pool = trumps.isEmpty ? ids.filter { suitLed($0) == led } : trumps
        var best = pool[0]
        for id in pool where rank(id) < rank(best) { best = id }
        return ids.firstIndex(of: best)!
    }

    /// "You must follow the suit that was led if you can."
    static func legal(_ hand: [String], _ led: String?) -> [String] {
        guard let led = led else { return hand }
        let following = hand.filter { suitLed($0) == suitLed(led) }
        return following.isEmpty ? hand : following
    }

    /// The scoring thresholds from How to Play.
    static func score(_ pickerPts: Int, _ pickerTricks: Int, _ totalTricks: Int) -> (win: Bool, mult: Int) {
        if pickerPts >= 61 {
            if pickerTricks == totalTricks { return (true, 3) }
            if pickerPts >= 91 { return (true, 2) }
            return (true, 1)
        }
        if pickerTricks == 0 { return (false, 4) }
        if pickerPts <= 30 { return (false, 3) }
        return (false, 2)
    }

    func testDeck() {
        let three = SheepheadCards.deck(for: 3).map(\.id)
        XCTAssertEqual(three.count, 32)
        XCTAssertEqual(Set(three), Set(Self.deck))
        let four = SheepheadCards.deck(for: 4).map(\.id)
        XCTAssertEqual(four.count, 30)
        XCTAssertFalse(four.contains("7D"))
        XCTAssertFalse(four.contains("8D"))
        for n in 3...6 {
            XCTAssertEqual(SheepheadCards.deck(for: n).reduce(0) { $0 + Self.pts($1.id) }, 120, "\(n) players")
        }
    }

    func testCardValues() {
        for id in Self.deck {
            XCTAssertEqual(SheepheadCards.points(card(id)), Self.pts(id), id)
        }
    }

    func testTrumpOrder() {
        XCTAssertEqual(SheepheadCards.trumpOrder.map(\.id), Self.trump)
        XCTAssertEqual(Self.trump.count, 14)
        for id in Self.deck {
            XCTAssertEqual(SheepheadCards.isTrump(card(id)), Self.isTrump(id), id)
        }
        XCTAssertNotEqual(SheepheadCards.effectiveSuit(card("QC")), SheepheadCards.effectiveSuit(card("AC")))
        XCTAssertEqual(SheepheadCards.effectiveSuit(card("QC")), SheepheadCards.effectiveSuit(card("7D")))
    }

    func testBeatsEveryOrderedPair() {
        var pairs = 0
        for a in Self.deck {
            for b in Self.deck where a != b {
                let expected = Self.isTrump(a)
                    ? (!Self.isTrump(b) || Self.rank(a) < Self.rank(b))
                    : (!Self.isTrump(b) && a.last == b.last && Self.rank(a) < Self.rank(b))
                XCTAssertEqual(SheepheadCards.beats(card(a), card(b)), expected, "\(a) over \(b)")
                pairs += 1
            }
        }
        XCTAssertEqual(pairs, 32 * 31)
        XCTAssertTrue(SheepheadCards.beats(card("7D"), card("AC")))
        XCTAssertFalse(SheepheadCards.beats(card("AC"), card("7D")))
        XCTAssertTrue(SheepheadCards.beats(card("QC"), card("QS")))
        XCTAssertTrue(SheepheadCards.beats(card("TC"), card("KC")), "the ten outranks the king")
        XCTAssertFalse(SheepheadCards.beats(card("AS"), card("KC")), "a spade cannot beat a winning club")
        XCTAssertTrue(SheepheadCards.beats(card("JD"), card("AD")))
    }

    func testTrickWinnerCases() {
        let cases: [([String], Int, String)] = [
            (["AC", "TC", "KC"], 0, "ace is the highest club"),
            (["KC", "TC", "AC"], 2, "ace still wins from third seat"),
            (["AC", "TC", "7D"], 2, "the lowest trump beats every fail card"),
            (["AC", "QC", "KC"], 1, "the queen of clubs is trump, not a club"),
            (["AC", "AS", "AH"], 0, "off-suit aces cannot win"),
            (["QD", "QC"], 1, "queen of clubs is the highest card in the deck"),
            (["7D", "AD", "JD"], 2, "jacks outrank the ace of diamonds"),
            (["JD", "QD"], 1, "every queen outranks every jack"),
            (["TS", "KS", "9S"], 0, "the ten is the top card left in a fail suit"),
            (["9H", "8H", "7H"], 0, "nine is the highest of three worthless hearts"),
            (["AH", "7C", "8S"], 0, "nobody followed hearts, so the lead holds"),
        ]
        for (ids, win, why) in cases {
            let plays = ids.enumerated().map { SheepheadPlay(player: $0.offset, card: card($0.element)) }
            XCTAssertEqual(SheepheadGame.trickWinnerIndex(plays), win, why)
        }
        var rng = RandomSource(seed: 20260811)
        for _ in 0..<5000 {
            let size = 3 + rng.nextInt(below: 4)
            let ids = Array(Self.deck.shuffled(with: &rng).prefix(size))
            let plays = ids.enumerated().map { SheepheadPlay(player: $0.offset, card: card($0.element)) }
            XCTAssertEqual(SheepheadGame.trickWinnerIndex(plays), Self.trickWinner(ids), ids.joined(separator: " "))
        }
    }

    private func legalFrom(_ hand: [String], _ led: String?) -> [String] {
        var (state, _) = fiveHanded()
        state.phase = .play
        state.players[0].hand = hand.map(card)
        state.trick = led.map { [SheepheadPlay(player: 1, card: card($0))] } ?? []
        state.turn = 0
        return SheepheadGame.legalPlays(state, seat: 0).map(\.id).sorted()
    }

    func testLegalPlays() {
        let cases: [([String], String, [String], String)] = [
            (["AC", "KC", "AS"], "TC", ["AC", "KC"], "must follow clubs"),
            (["AC", "KC", "AS"], "QH", [], "no trump in hand, so anything goes"),
            (["QC", "JS", "9D", "AC"], "TD", ["QC", "JS", "9D"], "a diamond lead is a trump lead"),
            (["QC", "AC", "KC"], "AS", [], "no spades, and the queen of clubs is not a club"),
            (["QC", "AC", "KC"], "TC", ["AC", "KC"], "the queen of clubs does not follow clubs"),
            (["JD"], "AC", [], "the only card is always playable"),
            (["AH", "7H", "QD"], "9H", ["AH", "7H"], "must follow hearts"),
        ]
        for (hand, led, want, why) in cases {
            XCTAssertEqual(legalFrom(hand, led), (want.isEmpty ? hand : want).sorted(), why)
        }
        var rng = RandomSource(seed: 77777)
        for _ in 0..<1000 {
            let pool = Self.deck.shuffled(with: &rng)
            let size = 1 + rng.nextInt(below: 7)
            let hand = Array(pool.prefix(size))
            let led = pool[size]
            XCTAssertEqual(legalFrom(hand, led), Self.legal(hand, led).sorted(), "hand \(hand) led \(led)")
        }
    }

    func testPartnerCardAndDeal() {
        XCTAssertEqual(SheepheadGame.partnerCard.id, "JD")
        XCTAssertFalse(SheepheadGame.dealSpec(for: 3).partner)
        for n in 4...6 { XCTAssertTrue(SheepheadGame.dealSpec(for: n).partner) }
        let hands = [3: 10, 4: 7, 5: 6, 6: 5]
        for n in 3...6 {
            let d = SheepheadGame.dealSpec(for: n)
            XCTAssertEqual(d.hand, hands[n])
            XCTAssertEqual(d.blind, 2)
            XCTAssertEqual(d.hand * n + d.blind, SheepheadCards.deck(for: n).count, "\(n) players")
        }
    }

    /// The payout table as literal rows: picker points, picker tricks, hand
    /// size, then the outcome How to Play promises. Five players, a partner,
    /// no doublers: each of three opponents settles two units times the
    /// multiplier, the partner gets a third of the pot, the picker the rest.
    func testScoringTable() {
        let rows: [(pts: Int, tricks: Int, win: Bool, mult: Int, picker: Int, partner: Int, opp: Int)] = [
            (61, 3, true, 1, 4, 2, -2),
            (60, 3, false, 2, -8, -4, 4),
            (91, 5, true, 2, 8, 4, -4),
            (90, 5, true, 1, 4, 2, -2),
            (120, 6, true, 3, 12, 6, -6),
            (100, 6, true, 3, 12, 6, -6),
            (30, 1, false, 3, -12, -6, 6),
            (31, 1, false, 2, -8, -4, 4),
            (0, 0, false, 4, -16, -8, 8),
            (20, 0, false, 4, -16, -8, 8),
        ]
        for row in rows {
            var (state, _) = fiveHanded()
            state.phase = .play
            state.picker = 1
            state.partner = 2
            state.alone = false
            state.buried = []
            for i in 0..<5 { state.players[i].points = 0; state.players[i].tricksWon = 0 }
            state.players[1].points = row.pts
            state.players[1].tricksWon = row.tricks
            state.players[0].points = 120 - row.pts
            state.players[0].tricksWon = 6 - row.tricks
            let r = SheepheadGame.scoreNormal(state)
            let want = Self.score(row.pts, row.tricks, 6)
            XCTAssertEqual(r.pickerWins, want.win, "\(row.pts) points")
            XCTAssertEqual(r.multiplier, want.mult, "\(row.pts) points")
            XCTAssertEqual(r.pickerWins, row.win)
            XCTAssertEqual(r.multiplier, row.mult)
            XCTAssertEqual(r.deltas, [row.opp, row.picker, row.partner, row.opp, row.opp], "\(row.pts) points")
            XCTAssertEqual(r.deltas.reduce(0, +), 0)
        }
        // Alone: the picker takes the whole pot from four opponents.
        var (state, _) = fiveHanded()
        state.phase = .play
        state.picker = 1
        state.partner = nil
        state.alone = true
        state.players[1].points = 70
        state.players[1].tricksWon = 4
        state.players[0].points = 50
        state.players[0].tricksWon = 2
        let r = SheepheadGame.scoreNormal(state)
        XCTAssertEqual(r.deltas, [-2, 8, -2, -2, -2])
    }

    func testScoringRederivedOverPlay() {
        var scored = 0, wins = 0, losses = 0, schneiders = 0
        for n in 3...6 {
            for i in 0..<120 {
                var (state, rng) = newGame(players: n, seed: UInt64(1000 * n + i))
                playHand(&state, rng: &rng)
                if state.isLeaster { continue }
                let r = state.result!
                var team = [state.picker!]
                if !state.alone, let p = state.partner { team.append(p) }
                var pts = state.buried.reduce(0) { $0 + Self.pts($1.id) }
                var tricks = 0
                for s in team { pts += state.players[s].points; tricks += state.players[s].tricksWon }
                let want = Self.score(pts, tricks, SheepheadGame.dealSpec(for: n).hand)
                scored += 1
                if want.win { wins += 1; if want.mult == 2 { schneiders += 1 } } else { losses += 1 }
                XCTAssertEqual(r.pickerWins, want.win, "\(n)p: picker had \(pts) in \(tricks) tricks")
                XCTAssertEqual(r.multiplier, want.mult)
                XCTAssertEqual(r.pickerPoints, pts)
                let stake = 2 * want.mult * r.factor
                for seat in 0..<n where !team.contains(seat) {
                    XCTAssertEqual(abs(r.deltas[seat]), stake, "\(n)p opponent stake")
                }
                XCTAssertEqual(want.win, r.deltas[state.picker!] > 0)
            }
        }
        XCTAssertGreaterThan(scored, 300)
        XCTAssertGreaterThan(wins, 0)
        XCTAssertGreaterThan(losses, 0, "the picker never lost, so the losing multipliers went untested")
        XCTAssertGreaterThan(schneiders, 0, "never saw a schneider")
    }
}

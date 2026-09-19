import XCTest
import CardCore
@testable import EuchreEngine

/// The only test that knows what euchre IS.
///
/// The rules are written out BY HAND from the How to play text as literal
/// data — the trump order for each suit as seven literal card ids, the
/// non-trump order with the left bower removed, the follow-suit rule and the
/// trick winner re-implemented from the sentence in the rules, the scoring
/// table as literal rows — and the engine is measured against them. Nothing in
/// here calls `isTrump`, `power`, `beats`, `effectiveSuit`, `legalPlays` or
/// `trickWinnerIndex` to build its own answers; those are the things on trial.
final class EuchreRulesOracleTests: XCTestCase {
    static let suits: [Suit] = [.clubs, .spades, .hearts, .diamonds]
    static let ranks = ["A", "K", "Q", "J", "T", "9"]

    /// "the jack of the other suit of the same colour"
    static let sameColour: [Suit: Suit] = [.clubs: .spades, .spades: .clubs, .hearts: .diamonds, .diamonds: .hearts]

    /// "with spades trump the order is: jack of spades, jack of clubs, ace, king,
    ///  queen, ten, nine of spades — then everything else"
    static let trumpOrder: [Suit: [String]] = [
        .spades: ["JS", "JC", "AS", "KS", "QS", "TS", "9S"],
        .clubs: ["JC", "JS", "AC", "KC", "QC", "TC", "9C"],
        .hearts: ["JH", "JD", "AH", "KH", "QH", "TH", "9H"],
        .diamonds: ["JD", "JH", "AD", "KD", "QD", "TD", "9D"],
    ]

    /// The whole 24-card deck, built from the rules text rather than from the engine.
    static let deckIds: [String] = suits.flatMap { s in ranks.map { $0 + s.rawValue } }

    /// The scoring table, as literal rows: what the makers took, whether they
    /// were alone, and what each side gets.
    static let scoringTable: [(made: Int, alone: Bool, makers: Int, others: Int)] = [
        (3, false, 1, 0), (4, false, 1, 0),
        (5, false, 2, 0),
        (5, true, 4, 0),
        (3, true, 1, 0), (4, true, 1, 0),
        (0, false, 0, 2), (1, false, 0, 2), (2, false, 0, 2),
        (0, true, 0, 2), (1, true, 0, 2), (2, true, 0, 2),
    ]

    /// "Clubs are down to six cards, because their jack has left."
    static func plainOrder(_ suit: Suit, trump: Suit) -> [String] {
        let all = ranks.map { $0 + suit.rawValue }
        if suit == sameColour[trump] { return all.filter { $0 != "J" + suit.rawValue } }
        return all
    }

    /// What suit a card counts as. The left bower answers "trump".
    static func oracleSuit(_ id: String, trump: Suit?) -> String {
        guard let t = trump else { return String(id.suffix(1)) }
        if trumpOrder[t]!.contains(id) { return "trump" }
        return String(id.suffix(1))
    }

    /// Where a card sits in its own order. Lower is stronger.
    static func oracleRank(_ id: String, trump: Suit) -> Int {
        if let t = trumpOrder[trump]!.firstIndex(of: id) { return t }
        let suit = Suit(rawValue: String(id.suffix(1)))!
        return plainOrder(suit, trump: trump).firstIndex(of: id)!
    }

    /// "Highest trump takes the trick; with no trump in it, the highest card of
    ///  the suit led." Expressed as: does a beat b, where b is currently winning?
    static func oracleBeats(_ a: String, _ b: String, trump: Suit) -> Bool {
        let sa = oracleSuit(a, trump: trump), sb = oracleSuit(b, trump: trump)
        if sa == "trump" && sb != "trump" { return true }
        if sa != "trump" && sb == "trump" { return false }
        if sa != sb { return false }
        return oracleRank(a, trump: trump) < oracleRank(b, trump: trump)
    }

    /// "You must follow the suit that was led if you can — remembering that the
    ///  left bower counts as trump. If you cannot follow, you may play anything."
    static func oracleLegal(_ hand: [String], led: String?, trump: Suit) -> [String] {
        guard let led = led else { return hand }
        let ledSuit = oracleSuit(led, trump: trump)
        let can = hand.filter { oracleSuit($0, trump: trump) == ledSuit }
        return can.isEmpty ? hand : can
    }

    static func oracleTrickWinner(_ ids: [String], trump: Suit) -> Int {
        var best = 0
        for i in 1..<ids.count where oracleBeats(ids[i], ids[best], trump: trump) { best = i }
        return best
    }

    static func oracleScore(made: Int, alone: Bool) -> (makers: Int, others: Int) {
        for row in scoringTable where row.made == made && row.alone == alone {
            return (row.makers, row.others)
        }
        XCTFail("the scoring table has no row for \(made) tricks, alone \(alone)")
        return (0, 0)
    }

    // MARK: 1. The deck

    func testTheDeckIsTheTwentyFourCardsTheRulesDescribe() {
        XCTAssertEqual(EuchreCards.deck.count, 24)
        XCTAssertEqual(Set(EuchreCards.deck.ids), Set(Self.deckIds))
        XCTAssertEqual(Set(EuchreCards.deck).count, 24, "the deck contains a duplicate")
    }

    // MARK: 2. Every ordered pair, under every trump

    func testEveryOrderedPairUnderEveryTrump() {
        var checks = 0
        for trump in Self.suits {
            for a in Self.deckIds {
                for b in Self.deckIds where a != b {
                    let want = Self.oracleBeats(a, b, trump: trump)
                    let got = EuchreCards.beats(Support.card(a), Support.card(b), trump: trump)
                    XCTAssertEqual(got, want, "beats(\(a), \(b)) with \(trump.name) trump: engine says \(got), the rules say \(want)")
                    checks += 1
                }
            }
        }
        XCTAssertEqual(checks, 24 * 23 * 4)
    }

    func testTheSuitEachCardFollows() {
        for trump in Self.suits {
            for id in Self.deckIds {
                let want = Self.oracleSuit(id, trump: trump)
                let wantSuit = want == "trump" ? trump : Suit(rawValue: want)!
                let c = Support.card(id)
                XCTAssertEqual(EuchreCards.effectiveSuit(c, trump: trump), wantSuit,
                               "effectiveSuit(\(id)) with \(trump.name) trump")
                XCTAssertEqual(EuchreCards.isTrump(c, trump: trump), want == "trump",
                               "isTrump(\(id)) with \(trump.name) trump disagrees with the rules")
            }
            // With no trump decided, every card is its printed suit and nothing is trump.
            for id in Self.deckIds {
                let c = Support.card(id)
                XCTAssertEqual(EuchreCards.effectiveSuit(c, trump: nil), c.suit)
                XCTAssertFalse(EuchreCards.isTrump(c, trump: nil))
                XCTAssertNil(EuchreCards.bower(c, trump: nil))
            }
        }
    }

    /// The left bower, specifically and by name, because it is the rule
    /// everybody gets wrong and the one worth naming in a failure message.
    func testTheLeftBowerByName() {
        for trump in Self.suits {
            let other = Self.sameColour[trump]!
            let left = Support.card("J" + other.rawValue)
            let right = Support.card("J" + trump.rawValue)
            let aceTrump = Support.card("A" + trump.rawValue)
            let aceOther = Support.card("A" + other.rawValue)
            XCTAssertEqual(EuchreCards.effectiveSuit(left, trump: trump), trump,
                           "\(left.id) must count as \(trump.name) when \(trump.name) is trump")
            XCTAssertEqual(EuchreCards.bower(left, trump: trump), .left)
            XCTAssertEqual(EuchreCards.bower(right, trump: trump), .right)
            XCTAssertTrue(EuchreCards.beats(right, left, trump: trump), "the right bower must beat the left bower")
            XCTAssertTrue(EuchreCards.beats(left, aceTrump, trump: trump), "the left bower must beat the ace of trump")
            XCTAssertFalse(EuchreCards.beats(aceOther, left, trump: trump),
                           "the ace of \(other.name) must not beat the left bower when \(trump.name) is trump")
            XCTAssertEqual(EuchreCards.leftBowerSuit(trump), other)
        }
    }

    // MARK: 3. Tricks, scored independently

    func testRandomTricksScoredIndependently() {
        var rng = RandomSource(seed: 424242)
        for _ in 0..<6000 {
            let trump = Self.suits[rng.nextInt(below: 4)]
            let size = 3 + rng.nextInt(below: 2)         // three cards when somebody is alone
            let picked = Array(Self.deckIds.shuffled(with: &rng).prefix(size))
            let want = Self.oracleTrickWinner(picked, trump: trump)
            let plays = picked.enumerated().map { EuchrePlay(player: $0.offset, card: Support.card($0.element)) }
            let got = EuchreGame.trickWinnerIndex(plays, trump: trump)
            XCTAssertEqual(got, want, "trick winner with \(trump.name) trump for \(picked.joined(separator: " "))")
        }
    }

    // MARK: 4. Following suit

    func testFollowingSuit() {
        var rng = RandomSource(seed: 8675309)
        for _ in 0..<2500 {
            let trump = Self.suits[rng.nextInt(below: 4)]
            let pool = Self.deckIds.shuffled(with: &rng)
            let led = pool[0]
            let hand = Array(pool[1..<6])
            let s = Support.position(phase: .play, dealer: 0, turn: 1, leader: 0, trump: trump,
                                     hands: [[], hand, [], []], trick: [(0, led)])
            let want = Self.oracleLegal(hand, led: led, trump: trump).sorted()
            let got = EuchreGame.legalPlays(s, seat: 1).ids.sorted()
            XCTAssertEqual(got, want, "legal plays on a \(led) lead with \(trump.name) trump holding \(hand.joined(separator: " "))")
            // And whyNot agrees card by card.
            for id in hand {
                let ok = want.contains(id)
                let why = EuchreGame.whyNot(s, seat: 1, card: Support.card(id))
                XCTAssertEqual(why == nil, ok, "whyNot(\(id)) on a \(led) lead with \(trump.name) trump: \(why ?? "nil")")
            }
        }
    }

    // MARK: 5. The scoring table

    func testTheScoringTable() {
        for row in Self.scoringTable {
            let got = EuchreGame.scoreTable(made: row.made, alone: row.alone)
            XCTAssertEqual(got.makers, row.makers, "makers took \(row.made)\(row.alone ? " alone" : ""): to the makers")
            XCTAssertEqual(got.others, row.others, "makers took \(row.made)\(row.alone ? " alone" : ""): to the other side")
        }
    }

    // MARK: 6. Whole hands, re-scored from the rules

    /// Every finished hand is re-derived: the tricks are re-won from the
    /// recorded plays using the oracle's own comparison, the makers' count is
    /// re-added, and the score is looked up in the literal table. Nothing here
    /// reads the engine's verdict except to disagree with it.
    func testWholeHandsRescoredFromTheRules() {
        var reached = ["one": 0, "march": 0, "aloneMarch": 0, "aloneOne": 0, "euchred": 0,
                       "thrown": 0, "leftBowerPlayed": 0, "leftBowerWon": 0]

        for g in 0..<360 {
            var rng = RandomSource(seed: 100_000 + UInt64(g))
            var s = EuchreGame.createGame(Support.config(
                difficulty: Difficulty.allCases[g % 3], stick: g % 3 == 0, alone: true, names: ["N", "E", "S", "W"]))
            Support.playHand(&s, rng: &rng)
            XCTAssertTrue(Support.handIsOver(s), "a hand never finished")
            guard let h = s.history.last else { XCTFail("no record of the hand"); return }

            if h.result.thrownIn {
                reached["thrown"]! += 1
                XCTAssertTrue(h.tricks.isEmpty, "a thrown-in hand recorded tricks")
                XCTAssertEqual(h.result.deltas, [0, 0], "a thrown-in hand scored")
                XCTAssertNil(h.trump)
                continue
            }
            guard let trump = h.trump, let maker = h.maker else {
                XCTFail("hand \(h.handNumber) finished with no trump or maker")
                continue
            }

            var counted = [0, 0, 0, 0]
            var leader = h.tricks.first?.plays.first?.player ?? -1
            for t in h.tricks {
                let ids = t.plays.map(\.card.id)
                let wi = Self.oracleTrickWinner(ids, trump: trump)
                let winner = t.plays[wi].player
                XCTAssertEqual(winner, t.winner,
                               "hand \(h.handNumber) trick \(t.number): engine gave it to seat \(t.winner + 1), " +
                               "the rules give it to seat \(winner + 1) (\(ids.joined(separator: " ")), \(trump.name) trump)")
                counted[winner] += 1

                XCTAssertEqual(t.plays.first?.player, leader,
                               "hand \(h.handNumber) trick \(t.number) was led by the wrong seat")
                leader = winner

                let ledSuit = Self.oracleSuit(ids[0], trump: trump)
                for pl in t.plays where Self.oracleSuit(pl.card.id, trump: trump) != ledSuit {
                    /* Not following. Legal only if that seat held nothing of the led
                     * suit at that moment — reconstructed from the deal and what they
                     * had already played. */
                    var dealt = h.dealt[pl.player].ids
                    if pl.player == h.dealer, let up = h.upcard, !h.turnedDown { dealt.append(up.id) }
                    var alreadyPlayed: [String] = []
                    for earlier in h.tricks where earlier.number < t.number {
                        for p2 in earlier.plays where p2.player == pl.player { alreadyPlayed.append(p2.card.id) }
                    }
                    let held = dealt.filter { $0 != h.discard?.id && !alreadyPlayed.contains($0) }
                    let couldFollow = held.contains { Self.oracleSuit($0, trump: trump) == ledSuit }
                    XCTAssertFalse(couldFollow,
                                   "hand \(h.handNumber) trick \(t.number): seat \(pl.player + 1) played \(pl.card.id) " +
                                   "off a \(ledSuit) lead while holding \(held.filter { Self.oracleSuit($0, trump: trump) == ledSuit })")
                }

                let leftId = "J" + Self.sameColour[trump]!.rawValue
                if ids.contains(leftId) {
                    reached["leftBowerPlayed"]! += 1
                    if ids[wi] == leftId { reached["leftBowerWon"]! += 1 }
                }
            }

            XCTAssertEqual(counted.reduce(0, +), 5, "hand \(h.handNumber) accounted for the wrong number of tricks")

            let makerTeam = maker % 2
            let made = counted[makerTeam] + counted[makerTeam + 2]
            let table = Self.oracleScore(made: made, alone: h.alone)
            var want = [0, 0]
            want[makerTeam] = table.makers
            want[1 - makerTeam] = table.others
            XCTAssertEqual(h.result.deltas, want,
                           "hand \(h.handNumber): makers took \(made)\(h.alone ? " alone" : ""), the table says \(want)")

            if table.others == 2 { reached["euchred"]! += 1 }
            else if made == 5 { reached[h.alone ? "aloneMarch" : "march"]! += 1 }
            else if h.alone { reached["aloneOne"]! += 1 }
            else { reached["one"]! += 1 }

            if h.alone {
                XCTAssertEqual(h.sittingOut, (maker + 2) % 4, "hand \(h.handNumber): the wrong seat sat out")
                for t in h.tricks {
                    XCTAssertEqual(t.plays.count, 3, "hand \(h.handNumber): an alone hand had \(t.plays.count) cards in a trick")
                }
            }
        }

        /* A scoring branch that never came up has not been tested, however green
         * the run looks. */
        for (name, min) in [("one", 20), ("march", 8), ("euchred", 8), ("aloneMarch", 1), ("thrown", 2), ("leftBowerWon", 8)] {
            XCTAssertGreaterThanOrEqual(reached[name]!, min,
                                        "only \(reached[name]!) hands reached the \"\(name)\" case; that branch is effectively untested")
        }
    }
}

import XCTest
import CardCore
@testable import EuchreEngine

/// Does the computer cheat? For a sample of positions the decision for seat N
/// must be identical when every other seat's hand, the kitty and the dealer's
/// discard are replaced by a different plausible arrangement of the same
/// cards. Matters more with three computers and one person at the table than
/// it sounds: a cheating AI plays legal cards and simply wins more than it
/// should, and nothing else would notice.
final class EuchreHiddenInformationTests: XCTestCase {
    func testDecisionsDoNotDependOnCardsTheSeatCannotSee() {
        var positions = 0
        var byPhase: [EuchrePhase: Int] = [:]
        var dealerDiscardPositions = 0

        for g in 0..<15 {
            var rng = RandomSource(seed: 5000 + UInt64(g))
            var s = EuchreGame.createGame(Support.config(
                difficulty: Difficulty.allCases[g % 3], stick: g % 2 == 0, alone: true))
            XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)

            while s.phase != .gameOver && positions < 3000 {
                if s.phase == .handOver {
                    XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .nextHand, rng: &rng).ok)
                    continue
                }
                guard let seat = EuchreGame.seatToAct(s) else { XCTFail("nobody to act"); return }

                /* The decision under test, made from a fixed seed so the AI's own
                 * noise is the same in both worlds. */
                let decisionSeed: UInt64 = 777 + UInt64(positions)
                var r1 = RandomSource(seed: decisionSeed)
                let a1 = EuchreAI.decide(s, seat: seat, rng: &r1)
                XCTAssertNotNil(a1)

                for k in 0..<3 {
                    var scrambleRng = RandomSource(seed: 9000 + UInt64(positions * 3 + k))
                    let alt = Support.scramble(s, keeping: seat, rng: &scrambleRng)
                    XCTAssertEqual(alt.players[seat].hand, s.players[seat].hand)
                    XCTAssertEqual(Set(alt.players.flatMap(\.hand) + alt.kitty + [alt.discard].compactMap { $0 }),
                                   Set(s.players.flatMap(\.hand) + s.kitty + [s.discard].compactMap { $0 }),
                                   "the scramble must move cards, not invent them")
                    var r2 = RandomSource(seed: decisionSeed)
                    let a2 = EuchreAI.decide(alt, seat: seat, rng: &r2)
                    XCTAssertEqual(a1, a2,
                                   "seat \(seat) at \(s.phase) decided \(String(describing: a1)) but " +
                                   "\(String(describing: a2)) when the cards it cannot see were rearranged")
                }
                positions += 1
                byPhase[s.phase, default: 0] += 1
                if s.phase == .play, s.discard != nil, seat != s.dealer { dealerDiscardPositions += 1 }

                guard let action = EuchreAI.decide(s, seat: seat, rng: &rng) else { XCTFail("no move"); return }
                let r = EuchreGame.applyAction(&s, seat: seat, action: action, rng: &rng)
                XCTAssertTrue(r.ok, r.reason ?? "")
                if !r.ok { return }
            }
        }
        XCTAssertGreaterThan(positions, 1500)
        for phase in [EuchrePhase.bid1, .bid2, .discard, .play] {
            XCTAssertGreaterThan(byPhase[phase] ?? 0, 20, "too few \(phase) positions were watched")
        }
        XCTAssertGreaterThan(dealerDiscardPositions, 200,
                             "the dealer's discard was rarely in play when another seat decided")
    }

    /// Two worlds differing only in which card the dealer put back: every other
    /// seat's next decision, and every public event, must be identical.
    func testTheDealersDiscardIsInvisibleToTheOtherSeats() {
        var checked = 0
        for g in 0..<40 {
            var rng = RandomSource(seed: 31_000 + UInt64(g))
            var s = EuchreGame.createGame(Support.config(difficulty: .hard))
            XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
            Support.drive(&s, rng: &rng) { $0.phase != .bid1 }
            guard s.phase == .discard, let dealer = s.dealer else { continue }
            let hand = s.players[dealer].hand
            let choices = hand.filter { !EuchreCards.isTrump($0, trump: s.trump) }
            guard choices.count >= 2 else { continue }

            var a = s, b = s
            var ra = RandomSource(seed: 1), rb = RandomSource(seed: 1)
            XCTAssertTrue(EuchreGame.applyAction(&a, seat: dealer, action: .discard(choices[0]), rng: &ra).ok)
            XCTAssertTrue(EuchreGame.applyAction(&b, seat: dealer, action: .discard(choices[1]), rng: &rb).ok)
            XCTAssertNotEqual(a.discard, b.discard)

            for seat in 0..<4 where seat != dealer {
                XCTAssertEqual(a.log.events(for: seat).map(\.text), b.log.events(for: seat).map(\.text),
                               "seat \(seat) heard something different depending on the dealer's discard")
            }
            // Play on until the dealer is about to play; every other seat's decision must match.
            while a.phase == .play, a.turn != dealer, b.turn == a.turn {
                var da = RandomSource(seed: 2), db = RandomSource(seed: 2)
                let ma = EuchreAI.decide(a, seat: a.turn, rng: &da)
                let mb = EuchreAI.decide(b, seat: b.turn, rng: &db)
                XCTAssertEqual(ma, mb, "seat \(a.turn) played differently depending on the dealer's hidden discard")
                checked += 1
                guard let m = ma else { break }
                XCTAssertTrue(EuchreGame.applyAction(&a, seat: a.turn, action: m, rng: &ra).ok)
                XCTAssertTrue(EuchreGame.applyAction(&b, seat: b.turn, action: m, rng: &rb).ok)
            }
        }
        XCTAssertGreaterThan(checked, 20)
    }

    /// The AI's own knowledge, by contrast, is used: the dealer remembers its
    /// discard and does not count it among the unseen cards.
    func testUnseenCardsAreExactlyWhatTheSeatCannotSee() {
        var rng = RandomSource(seed: 64)
        var s = EuchreGame.createGame(Support.config())
        XCTAssertTrue(EuchreGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        Support.drive(&s, rng: &rng) { $0.phase == .play || Support.handIsOver($0) }
        guard s.phase == .play else { return }
        for seat in 0..<4 {
            let u = Set(EuchreAI.unseen(s, seat: seat))
            for c in s.players[seat].hand { XCTAssertFalse(u.contains(c)) }
            for c in s.played { XCTAssertFalse(u.contains(c)) }
            XCTAssertFalse(u.contains(s.upcard!))
            if let d = s.discard {
                XCTAssertEqual(u.contains(d), seat != s.dealer, "only the dealer knows the discard")
            }
            // What the seat has seen: its hand, the upcard (which may be in that hand), and its own discard.
            var seen = Set(s.players[seat].hand + s.played + [s.upcard!])
            if seat == s.dealer, let d = s.discard { seen.insert(d) }
            XCTAssertEqual(u.count, 24 - seen.count, "seat \(seat) unseen count")
            XCTAssertTrue(u.isDisjoint(with: seen))
        }
    }
}

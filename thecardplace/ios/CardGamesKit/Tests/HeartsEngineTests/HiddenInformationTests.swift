import XCTest
import CardCore
@testable import HeartsEngine

/// The AI's decision for seat N is identical when every other seat's hand is
/// replaced by a different plausible hand of the same size, and when what the
/// other seats chose to pass or were handed is scrambled. A bot that peeks
/// does not throw and does not fail any other test; it simply plays
/// impossibly well.
final class HiddenInformationTests: XCTestCase {

    /// Redistribute the other three hands among themselves at random, keeping
    /// sizes; scramble the other seats' private pass rows the same way.
    static func scramble(_ s: HeartsState, keeping seat: Int, rng: inout RandomSource) -> HeartsState {
        var t = s
        let others = (0..<4).filter { $0 != seat }
        var pool: [Card] = []
        for i in others { pool += t.players[i].hand }
        pool = pool.shuffled(with: &rng)
        for i in others {
            let n = t.players[i].hand.count
            t.players[i].hand = HeartsCards.sortHand(Array(pool.prefix(n)))
            pool.removeFirst(n)
            if t.passing[i] != nil {
                t.passing[i] = Array(t.players[i].hand.prefix(3))
            }
            if t.received[i] != nil {
                t.received[i] = Array(t.players[i].hand.suffix(3))
            }
        }
        return t
    }

    func testDecisionsDoNotDependOnOtherHands() {
        var positions = 0
        var passes = 0
        var differing = 0
        for seed: UInt64 in 1...12 {
            var scrambleRng = RandomSource(seed: seed &+ 1000)
            var decideRng = RandomSource(seed: 1)
            Support.playGame(seed: seed, config: Support.config(), inspect: { s in
                guard let seat = HeartsGame.seatToAct(s) else { return }
                guard let want = HeartsAI.decide(s, seat: seat, rng: &decideRng) else { return }
                for _ in 0..<3 {
                    let alt = Self.scramble(s, keeping: seat, rng: &scrambleRng)
                    XCTAssertEqual(alt.players[seat], s.players[seat], "the deciding seat must be untouched")
                    XCTAssertEqual(Set(Support.allCards(alt)), Set(Support.allCards(s)), "the scramble lost a card")
                    let got = HeartsAI.decide(alt, seat: seat, rng: &decideRng)
                    if got != want { differing += 1 }
                    XCTAssertEqual(got, want, "seed \(seed): seat \(seat)'s \(s.phase) decision changed when other hands changed")
                    if alt.players.enumerated().contains(where: { $0.offset != seat && $0.element.hand != s.players[$0.offset].hand }) {
                        positions += 1
                    }
                }
                if case .pass = want { passes += 1 }
            })
        }
        XCTAssertGreaterThan(positions, 500, "too few genuinely different positions were sampled")
        XCTAssertGreaterThan(passes, 30, "the pass was not sampled")
        XCTAssertEqual(differing, 0)
    }

    func testTheHandsAreNotEvenReadOnTheWayToUnseen() {
        // unseen() is what the AI tracks cards with. It must be the pack minus
        // this seat's hand minus what is on the table or taken — and nothing
        // about the other hands can be inferred from it.
        var rng = RandomSource(seed: 3)
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        let out = HeartsAI.unseen(s, seat: 0)
        XCTAssertEqual(out.count, 39)
        XCTAssertTrue(Set(out).isDisjoint(with: s.players[0].hand))
        var alt = s
        alt.players[1].hand = HeartsCards.sortHand(s.players[2].hand)
        alt.players[2].hand = HeartsCards.sortHand(s.players[1].hand)
        XCTAssertEqual(HeartsAI.unseen(alt, seat: 0), out)
    }

    func testAIPassesAreDeterministicAndFromItsOwnHand() {
        var rng = RandomSource(seed: 44)
        var s = HeartsGame.createGame(Support.config())
        XCTAssertTrue(HeartsGame.applyAction(&s, seat: 0, action: .start, rng: &rng).ok)
        for seat in 0..<4 {
            let a = HeartsAI.decide(s, seat: seat, rng: &rng)
            guard case .pass(let cards)? = a else { XCTFail("expected a pass"); return }
            XCTAssertEqual(cards.count, 3)
            XCTAssertEqual(Set(cards).count, 3)
            XCTAssertTrue(cards.allSatisfy { s.players[seat].hand.contains($0) })
            var again = RandomSource(seed: 999)
            XCTAssertEqual(HeartsAI.decide(s, seat: seat, rng: &again), a, "the pass does not depend on the generator")
        }
    }
}

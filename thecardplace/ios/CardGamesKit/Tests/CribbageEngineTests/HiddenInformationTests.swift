import XCTest
import CardCore
@testable import CribbageEngine

/// The headline claim: the computer reads only what its own seat may see. Its
/// decision is identical when the other seat's hand, kept cards and discard,
/// the crib and the undealt pack are all replaced by different plausible
/// cards of the same size.
final class HiddenInformationTests: XCTestCase {
    struct Position {
        let state: CribbageState
        let seat: Int
    }

    static let positions: [Position] = {
        var out: [Position] = []
        var seed: UInt64 = 5000
        for difficulty in Difficulty.allCases {
            for _ in 0..<4 {
                _ = Sim.play(seed: seed, difficulty: difficulty, target: 121) { state, seat in
                    guard state.phase == .discard || state.phase == .play else { return }
                    if state.phase == .play && CribbageGame.legalPlays(state, seat: seat).count < 2 { return }
                    out.append(Position(state: state, seat: seat))
                }
                seed += 1
            }
        }
        return out
    }()

    /// Everything the seat may not see, dealt out again at random into the
    /// same places.
    static func scramble(_ state: CribbageState, seat p: Int, rng: inout RandomSource) -> CribbageState {
        var s = state
        let o = 1 - p
        let opp = s.players[o]
        var pool = opp.hand + (s.discarded[o] ?? []) + s.crib + s.deck
        // The crib holds this seat's own discard too; that stays where it is.
        pool.removeAll { (s.discarded[p] ?? []).contains($0) }
        pool = pool.shuffled(with: &rng)
        var at = 0
        func take(_ n: Int) -> [Card] {
            let slice = Array(pool[at..<(at + n)])
            at += n
            return slice
        }
        let newHand = take(opp.hand.count)
        s.players[o].hand = newHand
        s.players[o].kept = opp.kept.isEmpty ? [] : opp.played + newHand
        if let d = s.discarded[o] {
            let nd = take(d.count)
            s.discarded[o] = nd
            s.crib = (s.discarded[p] ?? []) + nd
        }
        s.deck = take(pool.count - at)
        return s
    }

    func testTheComputerNeverReadsWhatItCannotSee() {
        let positions = Self.positions
        XCTAssertGreaterThan(positions.count, 500)
        var compared = 0
        var scrambler = RandomSource(seed: 99)
        for pos in positions {
            let baseRng = RandomSource(seed: 4321)
            var r1 = baseRng
            let original = CribbageAI.decide(pos.state, seat: pos.seat, rng: &r1)
            XCTAssertNotNil(original)
            for _ in 0..<3 {
                let other = Self.scramble(pos.state, seat: pos.seat, rng: &scrambler)
                // What this seat can see is untouched.
                XCTAssertEqual(other.players[pos.seat], pos.state.players[pos.seat])
                XCTAssertEqual(other.pile, pos.state.pile)
                XCTAssertEqual(other.starter, pos.state.starter)
                XCTAssertEqual(other.discarded[pos.seat], pos.state.discarded[pos.seat])
                XCTAssertEqual(Set(other.deck + other.crib + other.players[1 - pos.seat].hand + (other.discarded[1 - pos.seat] ?? [])),
                               Set(pos.state.deck + pos.state.crib + pos.state.players[1 - pos.seat].hand + (pos.state.discarded[1 - pos.seat] ?? [])))
                var r2 = baseRng
                let again = CribbageAI.decide(other, seat: pos.seat, rng: &r2)
                XCTAssertEqual(original, again, "the computer's move changed when the hidden cards changed (seat \(pos.seat), \(pos.state.phase))")
                compared += 1
            }
        }
        XCTAssertGreaterThan(compared, 1500)
    }

    func testUnseenIsExactlyTheDeckLessWhatTheSeatHasSeen() {
        var rng = RandomSource(seed: 8)
        var state = CribbageGame.createGame(Sim.config(.hard, 121))
        XCTAssertTrue(advance(&state, &rng) { $0.phase == .play && $0.pile.count >= 3 })
        for p in 0..<2 {
            let unseen = CribbageAI.unseen(state, seat: p)
            let me = state.players[p]
            let seen = Set(me.hand + me.kept + me.played + state.pile.map(\.card) + (state.discarded[p] ?? []) + [state.starter!])
            XCTAssertEqual(Set(unseen), Set(Card.fullDeck).subtracting(seen))
            // Nothing of the other seat's, the crib's or the pack's is excluded.
            let o = 1 - p
            for c in state.players[o].hand where !state.pile.map(\.card).contains(c) {
                XCTAssertTrue(unseen.contains(c), "the computer knows the \(c.id) is in the other hand")
            }
            for c in state.discarded[o]! { XCTAssertTrue(unseen.contains(c)) }
            for c in state.deck { XCTAssertTrue(unseen.contains(c)) }
        }
    }

    func testDifficultyOnlyChangesHowOftenItPlaysAtRandom() {
        // On hard, no randomness is drawn: the decision never depends on the
        // generator. On easy and normal a random play is sometimes taken.
        let positions = Self.positions.filter { $0.state.phase == .play }
        var differed = [Difficulty.easy: 0, .normal: 0, .hard: 0]
        for (i, pos) in positions.prefix(400).enumerated() {
            for d in Difficulty.allCases {
                var s = pos.state
                s.config.difficulty = d
                var a = RandomSource(seed: UInt64(2 * i + 1)), b = RandomSource(seed: UInt64(2 * i + 2))
                let x = CribbageAI.decide(s, seat: pos.seat, rng: &a)
                let y = CribbageAI.decide(s, seat: pos.seat, rng: &b)
                if x != y { differed[d]! += 1 }
            }
        }
        XCTAssertEqual(differed[.hard], 0)
        XCTAssertGreaterThan(differed[.easy]!, differed[.normal]!)
        XCTAssertGreaterThan(differed[.normal]!, 0)
    }
}

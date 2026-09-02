import XCTest
import CardCore
import SpadesEngine

/// The computer's decision for a seat is identical when every other seat's
/// hand is replaced by a different plausible hand of the same size. A bot that
/// peeks does not throw and does not fail a rules test; it simply plays
/// impossibly well.
final class SpadesHiddenInfoTests: XCTestCase {

    /// The other three hands, redealt among themselves in a different order
    /// so each seat still holds the right number of cards.
    func scramble(_ state: SpadesState, keeping seat: Int, rng: inout RandomSource) -> SpadesState {
        var copy = state
        var pool: [Card] = []
        for i in 0..<4 where i != seat { pool += copy.players[i].hand }
        pool = pool.shuffled(with: &rng)
        var k = 0
        for i in 0..<4 where i != seat {
            let n = copy.players[i].hand.count
            copy.players[i].hand = SpadesCards.sortHand(Array(pool[k..<(k + n)]))
            k += n
        }
        return copy
    }

    func testDecisionsDoNotDependOnOtherHands() {
        var positions = 0
        var biddingPositions = 0
        var scrambleRng = RandomSource(seed: 2026)
        for g in 0..<6 {
            var (state, rng) = Drive.newGame(SpadesConfig(names: testNames, pointsToWin: 250), seed: UInt64(300 + g))
            var guardCount = 0
            while state.phase != .gameOver && guardCount < 40_000 {
                guardCount += 1
                if let seat = SpadesGame.seatToAct(state) {
                    var r1 = RandomSource(seed: 7)
                    let original = SpadesAI.decide(state, seat: seat, rng: &r1)
                    for _ in 0..<3 {
                        let other = scramble(state, keeping: seat, rng: &scrambleRng)
                        var r2 = RandomSource(seed: 7)
                        let again = SpadesAI.decide(other, seat: seat, rng: &r2)
                        XCTAssertEqual(original, again, "seat \(seat) decided differently when other hands changed (\(state.phase))")
                    }
                    positions += 1
                    if state.phase == .bidding { biddingPositions += 1 }
                }
                Drive.step(&state, rng: &rng)
            }
        }
        XCTAssertGreaterThan(positions, 500)
        XCTAssertGreaterThan(biddingPositions, 40)
    }

    func testUnseenIsThePackLessOwnHandAndTheTable() {
        var state = position(bids: [3, 3, 3, 3], tricks: [0, 0, 0, 0],
                             hands: ["AS 2C 3D", "3C 4D KH", "5C 6C QH", "7C 8C JH"], leader: 0, tricksPlayed: 0)
        var rng = RandomSource(seed: 1)
        XCTAssertTrue(SpadesGame.applyAction(&state, seat: 0, action: .play(card("2C")), rng: &rng).ok)
        let out = SpadesAI.unseen(state, seat: 1)
        XCTAssertEqual(out.count, 52 - 3 - 1)
        XCTAssertFalse(out.contains(card("2C")))
        XCTAssertFalse(out.contains(card("KH")))
        // The ace of spades is in North's hand — and East cannot know that.
        XCTAssertTrue(out.contains(card("AS")))
    }
}

import XCTest
import CardCore
@testable import SheepheadEngine

/// Nothing observable to a seat may depend on what that seat cannot see:
/// other hands, the blind, the picker's bury, or whether the picker is
/// secretly alone.
final class HiddenInformationTests: XCTestCase {
    func testAllyProbabilityIgnoresTheHiddenAloneFlag() {
        for n in 4...6 {
            var (state, _) = newGame(players: n, seed: UInt64(n))
            state.phase = .play
            state.picker = 1
            state.partnerRevealed = false
            // Seat 2 is a plain opponent looking at seat 3; make sure neither holds the jack.
            for i in 0..<n { state.players[i].hand = state.players[i].hand.removing(SheepheadCards.partnerCard) }
            state.alone = false
            state.partner = n - 1
            state.players[n - 1].hand.append(SheepheadCards.partnerCard)
            let withPartner = SheepheadAI.allyProbability(state, viewer: 2, other: 3)
            state.alone = true
            state.partner = nil
            state.players[n - 1].hand = state.players[n - 1].hand.removing(SheepheadCards.partnerCard)
            state.buried.append(SheepheadCards.partnerCard)
            let whenAlone = SheepheadAI.allyProbability(state, viewer: 2, other: 3)
            XCTAssertEqual(withPartner, whenAlone, "\(n)p")
            XCTAssertTrue(whenAlone > 0 && whenAlone < 1, "\(n)p: hidden partner should be uncertain")
            XCTAssertEqual(SheepheadAI.allyProbability(state, viewer: 2, other: 1), 0, "the picker is never an ally of a plain opponent")
        }
    }

    /// Replace everything the seat cannot see with a different plausible
    /// arrangement and the decision must not move.
    private func scrambled(_ state: SheepheadState, viewer: Int, flipAlone: Bool, seed: UInt64) -> SheepheadState {
        var s = state
        var rng = RandomSource(seed: seed)
        let isPicker = viewer == state.picker
        var pool = SheepheadAI.unseen(state, seat: viewer)   // includes other hands, blind, and the bury unless I am the picker
        pool = pool.shuffled(with: &rng)
        var pos = 0
        for i in 0..<state.seats where i != viewer {
            let k = state.players[i].hand.count
            s.players[i].hand = SheepheadCards.sortHand(Array(pool[pos..<pos + k]))
            pos += k
        }
        if !isPicker {
            let k = state.buried.count
            s.buried = Array(pool[pos..<pos + k])
            pos += k
        }
        s.blind = Array(pool[pos...])
        XCTAssertEqual(s.blind.count, state.blind.count)
        // Keep the hidden fields plausible for the new arrangement, or flip them.
        if !state.partnerRevealed, !state.isLeaster, state.spec.partner, let picker = state.picker {
            let holder = s.players.firstIndex { $0.hand.contains(SheepheadCards.partnerCard) }
            if flipAlone {
                s.alone = !state.alone
                s.partner = s.alone ? nil : (holder ?? (0..<state.seats).first { $0 != picker && $0 != viewer })
            } else {
                s.alone = holder == nil || holder == picker || s.buried.contains(SheepheadCards.partnerCard)
                s.partner = s.alone ? nil : holder
            }
        }
        return s
    }

    func testDecisionsDoNotDependOnWhatTheSeatCannotSee() {
        var positions = 0
        for n in 3...6 {
            for difficulty in [Difficulty.hard, .normal] {
                for i in 0..<10 {
                    var (state, rng) = newGame(players: n, difficulty: difficulty, seed: UInt64(n * 100 + i))
                    playHand(&state, rng: &rng) { st, seat, action, rng in
                        let viewerHoldsJack = st.players[seat].hand.contains(SheepheadCards.partnerCard)
                        let mayFlip = seat != st.picker && !viewerHoldsJack
                        for flip in (mayFlip ? [false, true] : [false]) {
                            let other = self.scrambled(st, viewer: seat, flipAlone: flip, seed: UInt64(positions + 7))
                            XCTAssertEqual(other.players[seat], st.players[seat])
                            var r1 = rng, r2 = rng
                            let again = SheepheadAI.decide(st, seat: seat, rng: &r1)
                            let scrambledDecision = SheepheadAI.decide(other, seat: seat, rng: &r2)
                            XCTAssertEqual(again, action, "the decision must replay")
                            XCTAssertEqual(scrambledDecision, action, "\(n)p \(st.phase) seat \(seat): decision changed when unseen cards changed (flip \(flip))")
                        }
                        positions += 1
                    }
                }
            }
        }
        XCTAssertGreaterThan(positions, 500)
    }

    func testNoEventLeaksTheSidesBeforeTheReveal() {
        var aloneHands = 0, partneredHands = 0
        for n in 4...6 {
            for i in 0..<60 {
                var (state, rng) = newGame(players: n, seed: UInt64(n * 1000 + i))
                var visible: [GameEvent] = []
                var lastId = state.log.lastId
                var revealedAt: Int?
                playHand(&state, rng: &rng) { st, _, _, _ in
                    if revealedAt == nil, st.partnerRevealed, st.picker != nil { revealedAt = st.log.lastId }
                }
                if state.isLeaster { continue }
                let picker = state.picker!
                let bystander = picker == 0 ? 1 : 0
                let cutoff = revealedAt ?? state.log.events.first { $0.kind == .score }!.id
                visible = state.log.events(for: bystander, since: lastId).filter { $0.id < cutoff }
                lastId = cutoff
                // The reveal itself is a play event that is allowed to say it; stop before it.
                let text = visible.filter { !($0.kind == .play && $0.cards == [SheepheadCards.partnerCard]) }
                    .map(\.text).joined(separator: " ").lowercased()
                XCTAssertFalse(text.contains("alone"), "\(n)p: alone leaked to seat \(bystander): \(text)")
                XCTAssertFalse(text.contains("secret partner"), "\(n)p: partner hint leaked")
                XCTAssertTrue(visible.contains { $0.text == "\(state.players[picker].name) is the picker. The Jack of Diamonds is the partner card." || $0.text == "You are the picker. The Jack of Diamonds is the partner card." },
                              "the neutral announcement is missing or reworded")
                // The picker was told, privately.
                let told = state.log.events.filter { $0.audience == picker && ($0.text.contains("playing alone") || $0.text.contains("secret partner")) }
                XCTAssertEqual(told.count, 1)
                if state.alone { aloneHands += 1 } else { partneredHands += 1 }
            }
        }
        XCTAssertGreaterThan(aloneHands, 0)
        XCTAssertGreaterThan(partneredHands, 0)
    }

    func testTheRevealSaysTheRightThing() {
        var alone = 0, partnered = 0
        for n in 4...6 {
            for i in 0..<60 {
                var (state, rng) = newGame(players: n, seed: UInt64(n * 2000 + i))
                playHand(&state, rng: &rng)
                if state.isLeaster { continue }
                let plays = state.log.events.filter { $0.kind == .play }
                guard let jd = plays.first(where: { $0.cards == [SheepheadCards.partnerCard] }) else {
                    XCTAssertTrue(state.buried.contains(SheepheadCards.partnerCard), "the jack was neither played nor buried")
                    continue
                }
                let before = plays.prefix { $0.id != jd.id }.map(\.text).joined(separator: " ").lowercased()
                XCTAssertFalse(before.contains("alone") || before.contains("partner"), "sides leaked in play events before the jack")
                if state.alone {
                    alone += 1
                    XCTAssertTrue(jd.text.contains("playing alone"), jd.text)
                    XCTAssertEqual(jd.seat, state.picker)
                } else {
                    partnered += 1
                    XCTAssertTrue(jd.text.hasSuffix("is the picker's partner.") || jd.text.hasSuffix("are the picker's partner."), jd.text)
                    XCTAssertEqual(jd.seat, state.partner)
                }
                XCTAssertEqual(state.revealInfo?.player, jd.seat)
                XCTAssertEqual(state.revealInfo?.alone, state.alone)
            }
        }
        XCTAssertGreaterThan(alone, 0)
        XCTAssertGreaterThan(partnered, 0)
    }

    /// The computer players price trump at -45 when burying, so they never
    /// choose this themselves; force it, and the hand must stay silent.
    func testABuriedJackStaysSecretAllHand() {
        for n in 4...6 {
            for i in 0..<15 {
                var (state, rng) = newGame(players: n, seed: UInt64(n * 3000 + i))
                let jd = SheepheadCards.partnerCard
                state.turn = 0
                state.leader = 0
                state.dealer = n - 1
                if !state.players[0].hand.contains(jd) {
                    // Swap it into seat 0 from wherever it is.
                    let swap = state.players[0].hand[0]
                    state.players[0].hand[0] = jd
                    if let h = state.players.indices.first(where: { $0 != 0 && state.players[$0].hand.contains(jd) }) {
                        state.players[h].hand = state.players[h].hand.removing(jd) + [swap]
                    } else {
                        state.blind = state.blind.removing(jd) + [swap]
                    }
                }
                state.players[0].name = "P0"
                state.players[0].occupant = .bot
                XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .pick, rng: &rng), .ok)
                let other = state.players[0].hand.first { $0 != jd }!
                XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .bury([jd, other]), rng: &rng), .ok)
                XCTAssertTrue(state.alone)
                XCTAssertFalse(state.partnerRevealed)
                let start = state.log.lastId
                playHand(&state, rng: &rng) { st, _, _, _ in
                    XCTAssertFalse(st.partnerRevealed, "buried jack revealed mid-hand")
                }
                let scoreId = state.log.events.first { $0.kind == .score }!.id
                let texts = state.log.events(for: 1, since: 0).filter { $0.id < scoreId }.map(\.text)
                let neutral = "P0 is the picker. The Jack of Diamonds is the partner card."
                XCTAssertTrue(texts.contains(neutral))
                let rest = texts.filter { $0 != neutral }.joined(separator: " ").lowercased()
                XCTAssertFalse(rest.contains("alone") || rest.contains("partner"), "buried jack leaked: \(rest)")
                XCTAssertTrue(state.result!.summary.contains("P0 alone (the Jack of Diamonds was buried)"))
                _ = start
            }
        }
    }

    func testTheHumanPickerIsToldTheirOwnSituation() {
        var toldAlone = 0, toldPartnered = 0
        for i in 0..<60 {
            var (state, rng) = fiveHanded(seed: UInt64(4000 + i))
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .pick, rng: &rng), .ok)
            let since = state.log.lastId
            let hand = state.players[0].hand
            XCTAssertEqual(SheepheadGame.applyAction(&state, seat: 0, action: .bury([hand[hand.count - 1], hand[hand.count - 2]]), rng: &rng), .ok)
            let mine = state.log.events(for: 0, since: since).map(\.text).joined(separator: " ")
            let theirs = state.log.events(for: 1, since: since).map(\.text).joined(separator: " ")
            if state.alone {
                toldAlone += 1
                XCTAssertTrue(mine.contains("you are playing alone"), mine)
            } else {
                toldPartnered += 1
                XCTAssertTrue(mine.contains("secret partner"), mine)
            }
            XCTAssertTrue(theirs.contains("You are the picker. The Jack of Diamonds is the partner card."))
            XCTAssertFalse(theirs.lowercased().contains("alone") || theirs.contains("secret partner"))
            XCTAssertFalse(theirs.contains("You buried"))
            XCTAssertFalse(theirs.contains("From the blind"))
        }
        XCTAssertGreaterThan(toldAlone, 0)
        XCTAssertGreaterThan(toldPartnered, 0)
    }

    func testDoublerHoldersAreToldPrivately() {
        var found = 0
        for i in 0..<80 {
            var (state, rng) = newGame(players: 3, doublers: true, seed: UInt64(6000 + i))
            playHand(&state, rng: &rng)
            for e in state.log.events where e.text.contains("counts double") {
                found += 1
                XCTAssertNotNil(e.audience)
                XCTAssertEqual(e.audience, e.seat)
            }
        }
        XCTAssertGreaterThan(found, 0)
    }
}

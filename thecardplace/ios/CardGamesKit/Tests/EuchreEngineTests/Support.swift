import XCTest
import CardCore
@testable import EuchreEngine

/// Shared helpers: a config with the web defaults, a driver that plays the
/// table with the AI while asserting every move is legal, and a builder for
/// constructed positions.
enum Support {
    static let names = ["You", "Ruth", "Dale", "Marta"]

    static func config(difficulty: Difficulty = .normal, stick: Bool = false, alone: Bool = true,
                       points: Int = 10, names: [String] = Support.names) -> EuchreConfig {
        EuchreConfig(names: names, difficulty: difficulty, pointsToWin: points,
                     stickTheDealer: stick, allowAlone: alone)
    }

    static func card(_ id: String) -> Card {
        guard let c = Card(id: id) else { fatalError("not a card id: \(id)") }
        return c
    }

    static func cards(_ ids: [String]) -> [Card] { ids.map(card) }

    /// Play the table with the AI until `stop` is true. Every decision is
    /// checked against `legalPlays` before it is applied, and every application
    /// must be accepted. Returns the number of moves made.
    @discardableResult
    static func drive(_ s: inout EuchreState, rng: inout RandomSource,
                      until stop: (EuchreState) -> Bool,
                      file: StaticString = #filePath, line: UInt = #line) -> Int {
        var moves = 0
        while !stop(s) {
            guard let seat = EuchreGame.seatToAct(s) else {
                XCTFail("nobody to act at phase \(s.phase)", file: file, line: line)
                return moves
            }
            guard let action = EuchreAI.decide(s, seat: seat, rng: &rng) else {
                XCTFail("the computer had no move for seat \(seat) at phase \(s.phase)", file: file, line: line)
                return moves
            }
            if case .play(let c) = action {
                XCTAssertTrue(EuchreGame.legalPlays(s, seat: seat).contains(c),
                              "seat \(seat) chose an illegal card \(c.id)", file: file, line: line)
            }
            let r = EuchreGame.applyAction(&s, seat: seat, action: action, rng: &rng)
            XCTAssertTrue(r.ok, "the computer's move was refused: \(r.reason ?? "no reason") " +
                          "(\(action) at \(s.phase), seat \(seat))", file: file, line: line)
            if !r.ok { return moves }
            moves += 1
            if moves > 400 {
                XCTFail("a hand never finished", file: file, line: line)
                return moves
            }
        }
        return moves
    }

    static func handIsOver(_ s: EuchreState) -> Bool { s.phase == .handOver || s.phase == .gameOver }

    /// Deal (start or nextHand as the phase requires) and play one whole hand.
    static func playHand(_ s: inout EuchreState, rng: inout RandomSource,
                         file: StaticString = #filePath, line: UInt = #line) {
        let deal: EuchreAction = s.phase == .idle ? .start : .nextHand
        let r = EuchreGame.applyAction(&s, seat: 0, action: deal, rng: &rng)
        XCTAssertTrue(r.ok, "could not deal: \(r.reason ?? "")", file: file, line: line)
        drive(&s, rng: &rng, until: handIsOver, file: file, line: line)
    }

    /// A constructed position. Hands are card ids; the trick is (seat, id).
    static func position(phase: EuchrePhase, dealer: Int = 3, turn: Int = 0, leader: Int? = nil,
                         trump: Suit? = nil, hands: [[String]] = [[], [], [], []],
                         upcard: String? = nil, upcardStatus: EuchreUpcardStatus = .none,
                         deniedSuit: Suit? = nil, maker: Int? = nil, alone: Bool = false,
                         sittingOut: Int? = nil, trick: [(Int, String)] = [],
                         config: EuchreConfig = Support.config()) -> EuchreState {
        var s = EuchreGame.createGame(config)
        s.phase = phase
        s.dealer = dealer
        s.turn = turn
        s.leader = leader ?? turn
        s.trump = trump
        for i in 0..<EuchreGame.seats { s.players[i].hand = cards(hands[i]) }
        s.upcard = upcard.map(card)
        s.upcardStatus = upcardStatus
        s.deniedSuit = deniedSuit
        s.maker = maker
        s.alone = alone
        s.sittingOut = sittingOut
        s.trick = trick.map { EuchrePlay(player: $0.0, card: card($0.1)) }
        s.handNumber = 1
        s.gameNumber = 1
        return s
    }

    /// The same position with everything seat `keeping` may not see replaced by
    /// a different plausible arrangement of the same cards: the other seats'
    /// hands, the kitty, and the dealer's discard (unless the seat is the
    /// dealer, whose own discard it is entitled to remember).
    static func scramble(_ s: EuchreState, keeping p: Int, rng: inout RandomSource) -> EuchreState {
        var alt = s
        let upTaken: Card? = s.upcardStatus == .taken ? s.upcard : nil
        var pool: [Card] = []
        for i in 0..<EuchreGame.seats where i != p {
            for c in s.players[i].hand where c != upTaken { pool.append(c) }
        }
        pool += s.kitty
        let discardMoves = p != s.dealer && s.discard != nil && s.discard != upTaken
        if discardMoves, let d = s.discard { pool.append(d) }
        pool = pool.shuffled(with: &rng)

        var at = 0
        for i in 0..<EuchreGame.seats where i != p {
            var fresh: [Card] = []
            for c in s.players[i].hand {
                if c == upTaken { fresh.append(c) } else { fresh.append(pool[at]); at += 1 }
            }
            alt.players[i].hand = fresh
        }
        alt.kitty = Array(pool[at..<(at + s.kitty.count)])
        at += s.kitty.count
        if discardMoves { alt.discard = pool[at]; at += 1 }
        return alt
    }
}

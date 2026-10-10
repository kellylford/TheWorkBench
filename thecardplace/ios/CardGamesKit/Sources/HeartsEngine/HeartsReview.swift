import CardCore

/// The review sentences — the strings behind the browser's H/T/L/S/P/C/O
/// buttons in `hearts/js/ui.js` — as pure functions from state and seat to a
/// complete sentence. They are what a screen reader user asks for most.
public enum HeartsReview {
    private static func name(_ state: HeartsState, _ seat: Int) -> String {
        seat >= 0 && seat < state.players.count ? state.players[seat].name : "seat \(seat)"
    }

    private static func player(_ state: HeartsState, _ seat: Int) -> HeartsPlayer? {
        seat >= 0 && seat < state.players.count ? state.players[seat] : nil
    }

    /// "one club" / "three clubs" / "one heart" / "four hearts".
    private static func suitCount(_ n: Int, _ suit: Suit) -> String {
        let word = n == 1 ? String(suit.lowerName.dropLast()) : suit.lowerName
        return "\(Prose.number(n)) \(word)"
    }

    private static func capitalised(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }

    /// Grouped by suit rather than read as thirteen names in a row, high to
    /// low within each, saying how many of each:
    /// "Three clubs: Ace, Ten and Two. One diamond: King. …"
    public static func hand(_ state: HeartsState, seat: Int) -> String {
        guard let p = player(state, seat) else { return "There is no such seat." }
        if p.hand.isEmpty { return "Your hand is empty." }
        let sorted = HeartsCards.sortHand(p.hand)
        var parts: [String] = []
        for suit in HeartsCards.suitOrder {
            let ranks = sorted.filter { $0.suit == suit }.map { $0.rank.name }
            if ranks.isEmpty { continue }
            parts.append(capitalised(suitCount(ranks.count, suit)) + ": " + Prose.list(ranks) + ".")
        }
        return parts.joined(separator: " ")
    }

    /// "North played the Two of Clubs, East played the Ace of Clubs. Clubs was led."
    public static func trick(_ state: HeartsState, seat: Int) -> String {
        if state.trick.isEmpty { return "Nothing has been played to this trick yet." }
        let parts = state.trick.map { "\(name(state, $0.seat)) played the \(HeartsCards.name($0.card))" }
        let led = state.trick[0].card.suit
        return parts.joined(separator: ", ") + ". \(led.name) was led."
    }

    /// The last completed trick, which is the question a player asks most
    /// often after "what is in my hand".
    public static func lastTrick(_ state: HeartsState, seat: Int) -> String {
        guard let lt = state.lastTrick else { return "No trick has been completed yet." }
        let parts = lt.cards.map { "\(name(state, $0.seat)) played the \(HeartsCards.name($0.card))" }
        return parts.joined(separator: ", ") + ". \(name(state, lt.winner)) took it\(HeartsGame.pointsTail(lt.points))."
    }

    /// "North 12, East 0, South 30, West 4. Lowest wins."
    public static func scores(_ state: HeartsState, seat: Int) -> String {
        state.players.map { "\($0.name) \($0.score)" }.joined(separator: ", ") + ". Lowest wins."
    }

    /// Points each player has taken this hand from the tricks won — public
    /// information — and who has the queen.
    public static func pointsSoFar(_ state: HeartsState, seat: Int) -> String {
        let parts = state.players.map { "\($0.name) \(Prose.count($0.takenPoints, "point"))" }
        let tail: String
        if let q = state.players.first(where: { $0.hasQueen }) {
            tail = " \(q.name) has the queen of spades."
        } else {
            tail = " The queen of spades has not been played."
        }
        return "This hand: " + parts.joined(separator: ", ") + "." + tail
    }

    /// The counting aid: what has gone, and the facts that decide how the rest
    /// of the hand plays — whether hearts are live, whether the queen is still
    /// out, and which of the high hearts have gone.
    public static func cardsPlayed(_ state: HeartsState, seat: Int) -> String {
        let played = state.tricksPlayed
        let left = HeartsGame.handSize - played
        var out = "\(Prose.count(played, "trick")) played, \(left) to go."
        out += " Hearts " + (state.heartsBroken ? "are broken." : "have not been broken.")

        var gone: [Card] = []
        for p in state.players { gone += p.taken }
        gone += state.trick.map(\.card)

        out += " The queen of spades " + (gone.contains(HeartsCards.queenOfSpades) ? "has gone." : "is still out.")

        if !gone.isEmpty {
            let counts = HeartsCards.suitOrder.compactMap { suit -> String? in
                let n = gone.count(of: suit)
                return n > 0 ? suitCount(n, suit) : nil
            }
            out += " Played so far: " + Prose.list(counts) + "."
        }

        let highHearts: [Rank] = [.ace, .king, .queen, .jack]
        let goneHigh = highHearts.filter { gone.contains(Card($0, .hearts)) }
        let outHigh = highHearts.filter { !gone.contains(Card($0, .hearts)) }
        if goneHigh.isEmpty {
            out += " None of the high hearts have gone."
        } else if outHigh.isEmpty {
            out += " All four high hearts have gone."
        } else {
            out += " Of the high hearts, the \(Prose.list(goneHigh.map(\.name))) " + (goneHigh.count == 1 ? "has" : "have")
                + " gone; the \(Prose.list(outHigh.map(\.name))) " + (outHigh.count == 1 ? "is" : "are") + " still out."
        }
        return out
    }

    /// Who plays after whom, from the current leader round.
    public static func playOrder(_ state: HeartsState, seat: Int) -> String {
        let from = state.trick.first?.seat ?? state.leader
        let n = state.players.count
        guard n > 0 else { return "Nobody is at the table." }
        let names = (0..<n).map { name(state, (from + $0) % n) }
        return "Play goes " + names.joined(separator: ", then ") + "."
    }

    /// "North, you. East, computer. …"
    public static func who(_ state: HeartsState, seat: Int) -> String {
        state.players.map { "\($0.name), \($0.index == seat ? "you" : ($0.occupant == .human ? "a person" : "computer"))." }
            .joined(separator: " ")
    }

    /// One sentence for the status line.
    public static func status(_ state: HeartsState, seat: Int) -> String {
        switch state.phase {
        case .idle:
            return "Choose Start to deal the first hand."
        case .passing:
            if seat >= 0 && seat < state.passing.count && state.passing[seat] != nil {
                let waiting = state.passing.filter { $0 == nil }.count
                return "You have passed. Waiting for \(Prose.count(waiting, "player"))."
            }
            let dir = state.passDirection == .across ? "across" : "to the \(state.passDirection.rawValue)"
            return "Choose three cards to pass \(dir)."
        case .play:
            if state.turn == seat {
                if let first = state.trick.first {
                    return "Your turn. \(name(state, first.seat)) led the \(HeartsCards.name(first.card))."
                }
                return "Your turn. You lead."
            }
            return "Waiting for \(name(state, state.turn))."
        case .handOver:
            return "Hand \(state.dealNumber) is over. " + scores(state, seat: seat)
        case .gameOver:
            if let w = state.winner, let p = player(state, w) {
                return "\(p.name) wins with \(p.score)."
            }
            let low = state.players.map(\.score).min() ?? 0
            let tied = state.players.filter { $0.score == low }.map(\.name)
            return "The game is over. Tied on \(low): " + Prose.list(tied) + "."
        }
    }
}

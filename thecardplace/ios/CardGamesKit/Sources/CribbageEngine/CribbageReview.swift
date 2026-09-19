import CardCore

/// The review sentences — what a screen reader user asks for most. A port of
/// the strings behind the H/T/L/S/P/C keys in `cribbage-multiplayer/js/ui.js`,
/// with the key references dropped. Pure functions from state and seat to
/// text.
///
/// CRIBBAGE IS ARITHMETIC PERFORMED OUT LOUD. A sighted player looks at a pile
/// of cards, a running count and their own hand and knows in about a second
/// which of their cards makes fifteen, which pairs, and which takes the count
/// past thirty-one. Done by ear that is a running sum plus four subtractions,
/// repeated on every turn. So the program does the arithmetic and says it:
/// every card in the hand is labelled with what it is worth, what count it
/// would make, and what it would score. It removes arithmetic, not judgement.
public enum CribbageReview {
    static func other(_ i: Int) -> Int { 1 - i }

    static func opponentName(_ s: CribbageState, _ seat: Int) -> String { s.players[other(seat)].name }

    /// "you" for the seat asking, the name for anybody else.
    static func nameFor(_ s: CribbageState, _ seat: Int, _ i: Int?) -> String {
        guard let i = i, s.players.indices.contains(i) else { return "nobody" }
        return i == seat ? "you" : s.players[i].name
    }

    static func num(_ n: Int) -> String { CribbageCards.numberWord(n) }

    static let stageNames = ["the non-dealer’s hand", "the dealer’s hand", "the crib"]

    /// Is this seat the one the table is waiting for? Not simply `turn ==
    /// seat`: during the discard "my move" means "I have not thrown yet".
    public static func isMyMove(_ state: CribbageState, seat: Int) -> Bool {
        switch state.phase {
        case .cutForDeal: return true
        case .discard: return !state.hasDiscarded(seat)
        case .play, .count: return state.turn == seat
        case .roundOver, .gameOver: return true
        case .idle: return false
        }
    }

    // MARK: - Card labels

    /// The accessibility label for one card in this seat's hand: "Seven of
    /// Clubs, worth seven, makes twenty-two, and scores a pair for two", or
    /// "King of Spades, cannot be played, it would take the count to
    /// thirty-four, past thirty-one", or, when the card is only there for
    /// review, why: "Five of Hearts, for review, Ruth is to play".
    public static func cardLabel(_ state: CribbageState, seat: Int, card: Card) -> String {
        var label = CribbageCards.describe(card)
        if state.phase == .play && state.turn == seat {
            if let why = CribbageGame.whyNot(state, seat: seat, card: card) {
                return label + ", cannot be played, " + why
            }
            let got = CribbageGame.pointsForPlay(state, card: card)
            label += ", worth " + num(CribbageCards.value(card)) + ", makes " + num(got.count)
            if got.total > 0 { label += ", and scores " + got.phrase }
            return label
        }
        if state.phase == .discard && !state.hasDiscarded(seat) {
            return label
        }
        return label + ", " + idleReason(state, seat: seat)
    }

    /// Why a card in the hand cannot be chosen right now.
    public static func idleReason(_ state: CribbageState, seat: Int) -> String {
        switch state.phase {
        case .cutForDeal: return "for review, nothing is dealt yet"
        case .discard: return "for review, your throw is already in"
        case .play: return "for review, " + opponentName(state, seat) + " is to play"
        case .count: return "for review while the hands are counted"
        default: return "not playable right now"
        }
    }

    // MARK: - The review keys

    /// H: your hand — during the play, what each card is worth and would
    /// make; otherwise the cards, whose crib two of them go to, and the
    /// starter.
    public static func hand(_ state: CribbageState, seat: Int) -> String {
        let me = state.players[seat]
        let cards = me.hand
        if cards.isEmpty {
            if !me.kept.isEmpty {
                return "You have played all four. You kept " +
                    CribbageCards.listNames(CribbageCards.sortHand(me.kept)) + "."
            }
            return "Your hand is empty."
        }
        let sorted = CribbageCards.sortHand(cards)
        let lead = "Your " + num(sorted.count) + (sorted.count == 1 ? " card: " : " cards: ")

        if state.phase == .play {
            let parts = sorted.map { c -> String in
                let to = state.count + CribbageCards.value(c)
                if to > 31 { return c.name + ", too big to play" }
                var s = c.name + ", worth " + num(CribbageCards.value(c)) + ", makes " + num(to)
                if state.turn == seat {
                    let got = CribbageGame.pointsForPlay(state, card: c)
                    if got.total > 0 { s += ", and scores " + got.phrase }
                }
                return s
            }
            return "The count is \(state.count). " + lead + parts.joined(separator: ". ") + "."
        }

        var msg = lead + sorted.map(CribbageCards.describe).joined(separator: ", ") + "."
        if state.phase == .discard && !state.hasDiscarded(seat), let dealer = state.dealer {
            msg += " Two of them go to " + (dealer == seat ? "your own crib." : opponentName(state, seat) + "’s crib.")
        }
        if let s = state.starter { msg += " The starter is the " + CribbageCards.describe(s) + "." }
        return msg
    }

    /// T: the play — the count, what is down this run, and on your turn what
    /// you could score.
    public static func play(_ state: CribbageState, seat: Int) -> String {
        if state.phase != .play && state.pile.isEmpty {
            return "The play has not started yet."
        }
        let seq = state.pile.count > state.runStart ? Array(state.pile[state.runStart...]) : []
        let head = "The count is \(state.count). "
        if seq.isEmpty {
            return head + (state.pile.isEmpty
                ? nameFor(state, seat, state.turn) + " to lead."
                : "Nothing down since the count reset. " + nameFor(state, seat, state.turn) + " to lead.")
        }
        let down = seq.map { nameFor(state, seat, $0.player) + " the " + $0.card.name }.joined(separator: ", then ")
        var msg = head + "Down this run: " + down + "."

        if state.phase == .play && state.turn == seat {
            let legal = CribbageGame.legalPlays(state, seat: seat)
            if legal.isEmpty {
                msg += " Nothing in your hand fits under thirty-one, so you must say go."
            } else {
                let scoring = CribbageCards.sortHand(legal).compactMap { c -> String? in
                    let got = CribbageGame.pointsForPlay(state, card: c)
                    return got.total > 0 ? got.phrase + " with the " + c.name : nil
                }
                if !scoring.isEmpty { msg += " You could score " + Prose.list(scoring) + "." }
            }
        }
        return msg
    }

    /// The same as `play`; cribbage has no tricks, and this is the name the
    /// other engines use.
    public static func trick(_ state: CribbageState, seat: Int) -> String { play(state, seat: seat) }

    /// L: the last count that was read out.
    public static func lastCount(_ state: CribbageState, seat: Int) -> String {
        let counts = state.log.events(for: seat).filter { $0.kind == .count }
        return counts.last?.text ?? "Nothing has been counted yet."
    }

    /// S: both scores, and how far each of you has to go.
    public static func scores(_ state: CribbageState, seat: Int) -> String {
        let target = state.config.targetScore
        let me = state.players[seat].score, them = state.players[other(seat)].score
        let opp = opponentName(state, seat)
        var parts = ["You \(me), \(opp) \(them), playing to \(target)."]
        parts.append("You need " + num(max(0, target - me)) + " more; " + opp + " needs " + num(max(0, target - them)) + ".")
        if state.gamesWon[0] > 0 || state.gamesWon[1] > 0 {
            parts.append("Games won: you \(state.gamesWon[seat]), \(opp) \(state.gamesWon[other(seat)]).")
        }
        return parts.joined(separator: " ")
    }

    /// P: who dealt, whose crib it is, and the starter.
    public static func dealerAndCrib(_ state: CribbageState, seat: Int) -> String {
        guard let dealer = state.dealer else { return "Nobody has dealt yet. Cut for deal to begin." }
        let opp = opponentName(state, seat)
        var msg = dealer == seat ? "You dealt, so it is your crib." : opp + " dealt, so the crib is theirs."
        msg += " " + (state.starter.map { "The starter is the " + CribbageCards.describe($0) + "." }
                      ?? "The starter has not been turned yet.")
        if state.phase == .discard {
            msg += state.hasDiscarded(seat)
                ? " Your two are in the crib; waiting for " + opp + "."
                : " You still have to throw two."
            if state.seatsOutstanding.isEmpty { msg += " Both throws are in." }
        }
        if state.phase == .count, stageNames.indices.contains(state.countStage) {
            msg += " Counting: " + stageNames[state.countStage] + " next."
        }
        if !state.crib.isEmpty && (state.phase == .roundOver || state.phase == .gameOver || state.countStage >= 3) {
            msg += " The crib was " + CribbageCards.listNames(CribbageCards.sortHand(state.crib)) + "."
        }
        return msg
    }

    /// C: what has been played this hand, in the order it went down, with the
    /// count reset marked — the cards both players watched land and either
    /// may recall. Nothing derived from it: working out what is still out is
    /// the whole of cribbage.
    public static func countingAid(_ state: CribbageState, seat: Int) -> String {
        if state.pile.isEmpty {
            return state.phase == .play ? "Nothing has been played yet this hand." : "The play has not started yet."
        }
        let parts = state.pile.enumerated().map { (i, e) -> String in
            (i == state.runStart && i > 0 ? "the count reset, then " : "") +
                nameFor(state, seat, e.player) + " the " + e.card.name
        }
        return "Played this hand: " + parts.joined(separator: ", ") + ". The count is \(state.count)."
    }

    public static func cardsPlayed(_ state: CribbageState, seat: Int) -> String { countingAid(state, seat: seat) }

    /// O: the order of play this hand — who leads, and who counts first.
    public static func playOrder(_ state: CribbageState, seat: Int) -> String {
        guard let dealer = state.dealer else { return "Nobody has dealt yet. The lower cut deals first and takes the first crib." }
        let nd = other(dealer)
        let dealerName = nameFor(state, seat, dealer), leaderName = nameFor(state, seat, nd)
        let dealerPoss = dealer == seat ? "your" : dealerName + "’s"
        return CribbageGame.cap(dealerName) + " dealt, so " + leaderName + (nd == seat ? " lead" : " leads") +
            " the play and " + dealerName + (dealer == seat ? " answer" : " answers") +
            ". At the count, " + leaderName + (nd == seat ? " count" : " counts") + " first, then " +
            dealerName + ", then " + dealerPoss + " crib."
    }

    /// The headline between hands: each count's total, or who won.
    public static func handSummary(_ state: CribbageState, seat: Int) -> String {
        let opp = opponentName(state, seat)
        if state.phase == .gameOver, let r = state.result, let w = state.gameWinner {
            return (w == seat ? "You win" : opp + " wins") + ", \(state.players[w].score) to \(state.players[other(w)].score)" +
                (r.skunk.map { " — a " + $0.words + "." } ?? ".")
        }
        guard let r = state.result, !r.counts.isEmpty else { return "" }
        return r.counts.map { c in
            (c.who == seat ? "your " : opp + "’s ") + c.kind.rawValue + " \(c.result.total)"
        }.joined(separator: ", ") + "."
    }

    /// What this seat should do now, if anything: "Choose two cards to throw
    /// to your own crib." Empty when it is not their move.
    public static func prompt(_ state: CribbageState, seat: Int) -> String {
        let opp = opponentName(state, seat)
        switch state.phase {
        case .gameOver: return "Start a new game, or deal to play another."
        case .roundOver: return "Deal the next hand."
        case .idle: return "Start the game to cut for deal."
        case .cutForDeal: return "Cut for deal. The lower card deals."
        case .discard:
            guard !state.hasDiscarded(seat) else { return "" }
            return "Choose two cards to throw to " + (state.dealer == seat ? "your own crib." : opp + "’s crib.")
        case .count:
            guard state.turn == seat else { return "" }
            return state.countStage == 2 ? "Your crib to count. Turn it over." : "Your hand to count."
        case .play:
            guard state.turn == seat else { return "" }
            if CribbageGame.legalPlays(state, seat: seat).isEmpty { return "You cannot play. Say go." }
            return "Your turn. The count is \(state.count)."
        }
    }

    /// One sentence for the status line.
    public static func status(_ state: CribbageState, seat: Int) -> String {
        let opp = opponentName(state, seat)
        switch state.phase {
        case .idle:
            return "Cribbage, playing to \(state.config.targetScore). Start the game to cut for deal."
        case .cutForDeal:
            var s = "Cut for deal — the lower card deals and takes the first crib."
            if state.cutForDeal?.tie == true { s += " That was a tie; cut again." }
            return s
        case .discard:
            return state.hasDiscarded(seat)
                ? "Your two are in the crib. Waiting for " + opp + "."
                : "Throw two cards to " + (state.dealer == seat ? "your crib." : opp + "’s crib.")
        case .play:
            return "The count is \(state.count) — " + (state.turn == seat ? "your turn." : opp + " to play.")
        case .count:
            let stage = stageNames.indices.contains(state.countStage) ? stageNames[state.countStage] : "the crib"
            return "Counting: " + stage + (state.turn == seat ? " — yours to count." : " — " + opp + " is counting.")
        case .roundOver:
            return "Hand \(state.handNumber) complete. You \(state.players[seat].score), \(opp) \(state.players[other(seat)].score)."
        case .gameOver:
            guard let w = state.gameWinner else { return "Game over." }
            return (w == seat ? "You win" : opp + " wins") + ", \(state.players[w].score) to \(state.players[other(w)].score)."
        }
    }
}

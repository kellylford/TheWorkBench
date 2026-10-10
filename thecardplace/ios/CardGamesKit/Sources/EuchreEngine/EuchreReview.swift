import CardCore

/// The review sentences — the strings behind the browser game's H, T, L, S, P,
/// O and C buttons, its status line and its turn prompt, ported from `ui.js`.
/// Pure functions from state and seat to text; the app reads them out.
///
/// THE ONE EUCHRE-SPECIFIC ACCESSIBILITY DECISION: a sighted euchre player
/// answers "what would my hand be if hearts were trump?" by looking at five
/// cards at once. Read out card by card, the same question is a memory exercise
/// with a colour rule in it. So during the bidding the hand read does the
/// mapping — it says what your trump WOULD be, names the bowers, and counts
/// them. It tells you nothing you could not derive; it just removes a workload
/// that only exists if you cannot see the cards.
public enum EuchreReview {
    private static let seats = EuchreGame.seats
    private static let handSize = EuchreGame.handSize

    // MARK: Small pieces

    static func seatName(_ s: EuchreState, _ i: Int?) -> String {
        guard let i = i, i >= 0, i < s.players.count else { return "the table" }
        return s.players[i].name
    }

    static func countWord(_ n: Int, _ one: String, _ many: String) -> String {
        let words = ["no", "one", "two", "three", "four", "five", "six"]
        let w = (0..<words.count).contains(n) ? words[n] : String(n)
        return w + " " + (n == 1 ? one : many)
    }

    static func cap(_ s: String) -> String {
        guard let f = s.first else { return s }
        return f.uppercased() + s.dropFirst()
    }

    static func trickNumber(_ s: EuchreState) -> Int { min(handSize, s.trickLog.count + 1) }

    static func sideTricks(_ s: EuchreState, _ t: Int) -> Int {
        (0..<seats).filter { EuchreGame.teamOf($0) == t }.reduce(0) { $0 + s.players[$1].tricksWon }
    }

    static func validSeat(_ s: EuchreState, _ seat: Int) -> Bool { seat >= 0 && seat < s.players.count }

    /// Whether this seat is the one the table is waiting on.
    static func isMyTurn(_ s: EuchreState, _ seat: Int) -> Bool {
        switch s.phase {
        case .bid1, .bid2, .play: return s.turn == seat
        case .discard: return s.dealer == seat
        case .idle, .handOver, .gameOver: return false
        }
    }

    /// The hand, grouped by trump and then by suit, with the bowers named.
    /// Every card is read out in full in both groups.
    public static func groupedHand(_ cards: [Card], trump: Suit?) -> String {
        let sorted = EuchreCards.sortHand(cards, trump: trump)
        var groups: [(key: Suit, cards: [Card])] = []
        for c in sorted {
            let key = EuchreCards.effectiveSuit(c, trump: trump)
            if let last = groups.last, last.key == key {
                groups[groups.count - 1].cards.append(c)
            } else {
                groups.append((key, [c]))
            }
        }
        return groups.map { g in
            let label = (trump != nil && g.key == trump) ? "Trump" : g.key.name
            return label + ": " + g.cards.map { c -> String in
                switch EuchreCards.bower(c, trump: trump) {
                case .right: return c.name + ", the right bower"
                case .left: return c.name + ", the left bower"
                case nil: return c.name
                }
            }.joined(separator: ", ")
        }.joined(separator: ". ")
    }

    // MARK: H — the hand

    /// The hand grouped by trump and suit; during the bidding, what it would be
    /// worth with the suit on offer as trump (round one) or how many trump each
    /// available suit would give (round two).
    public static func hand(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        let hand = s.players[seat].hand
        if hand.isEmpty { return "Your hand is empty." }

        var lead = ""
        /* The dealer's sixth card, called out before anything else — it is the
         * thing they actually have to act on. */
        if s.phase == .discard, s.dealer == seat, let up = s.upcard {
            lead = "You took the \(up.name). "
        }

        if s.phase == .bid1, let up = s.upcard {
            let t = up.suit
            let mine = hand.filter { EuchreCards.isTrump($0, trump: t) }
            let rest = hand.filter { !EuchreCards.isTrump($0, trump: t) }
            var msg = "With \(t.lowerName) as trump you would hold \(countWord(mine.count, "trump", "trump")). "
            if !mine.isEmpty { msg += groupedHand(mine, trump: t) + ". " }
            msg += rest.isEmpty ? "Nothing else." : "The rest: " + groupedHand(rest, trump: t) + "."
            if s.dealer == seat {
                msg += " You are the dealer, so the \(up.name) would come to you and you would put a card back."
            } else if EuchreGame.partnerOf(seat) == s.dealer {
                msg += " Your partner is dealing, so the \(up.name) would go to them."
            } else {
                msg += " \(seatName(s, s.dealer)) is dealing, so the \(up.name) would go to the other side."
            }
            return msg
        }

        if s.phase == .bid2 {
            let bySuit = "Your hand: " + groupedHand(hand, trump: nil) + "."
            var options: [String] = []
            for su in EuchreCards.suits where su != s.deniedSuit {
                let n = hand.filter { EuchreCards.isTrump($0, trump: su) }.count
                options.append("\(su.lowerName) \(n)")
            }
            let denied = s.deniedSuit?.name ?? "Nothing"
            return bySuit + " \(denied) cannot be named. Trump you would hold: " + options.joined(separator: ", ") + "."
        }

        var out = lead + "Your hand, \(countWord(hand.count, "card", "cards")). " + groupedHand(hand, trump: s.trump) + "."
        if s.sittingOut == seat {
            out += " These are out of play this hand — \(seatName(s, s.maker)) is playing alone."
        }
        return out
    }

    // MARK: T — the trick

    /// "Trump led. Ruth is winning with the Ace of Spades, trump."
    public static func trickShort(_ s: EuchreState) -> String {
        guard let first = s.trick.first else { return "Nothing played to this trick yet." }
        let led = EuchreCards.effectiveSuit(first.card, trump: s.trump)
        let wi = EuchreGame.trickWinnerIndex(s.trick, trump: s.trump)
        let w = s.trick[wi]
        let ledWord = led == s.trump ? "Trump" : led.name
        return "\(ledWord) led. \(seatName(s, w.player)) is winning with the \(EuchreCards.describe(w.card, trump: s.trump))."
    }

    public static func trick(_ s: EuchreState, seat: Int) -> String {
        let head = "Trick \(trickNumber(s)) of \(handSize). "
        if s.trick.isEmpty {
            return head + "Nothing played yet. \(seatName(s, s.turn)) to lead."
        }
        let list = s.trick.map { "\(seatName(s, $0.player)), \(EuchreCards.describe($0.card, trump: s.trump))" }
            .joined(separator: ". ")
        return head + list + ". " + trickShort(s)
    }

    // MARK: L — the last trick

    public static func lastTrick(_ s: EuchreState, seat: Int) -> String {
        guard let lt = s.lastTrick else { return "No trick has been completed yet this hand." }
        let list = lt.plays.map { "\(seatName(s, $0.player)), \($0.card.name)" }.joined(separator: ". ")
        return "Trick \(lt.number). " + list + ". \(seatName(s, lt.winner)) took it."
    }

    // MARK: S — the score

    /// Tricks belong to a SIDE in euchre, not to a player, and that is the
    /// number that decides the hand.
    public static func scores(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        let us = EuchreGame.teamOf(seat), them = 1 - us
        let target = s.config.pointsToWin
        var parts: [String] = []
        parts.append("Tricks this hand: you and \(seatName(s, EuchreGame.partnerOf(seat))) \(sideTricks(s, us)), " +
                     "\(EuchreGame.sideWords(s, team: them)) \(sideTricks(s, them)).")
        parts.append("Game \(s.gameNumber) to \(target): you \(s.scores[us]), them \(s.scores[them]).")
        if s.gamesWon[0] != 0 || s.gamesWon[1] != 0 {
            parts.append("Games won: you \(s.gamesWon[us]), them \(s.gamesWon[them]).")
        }
        if let maker = s.maker, s.phase != .handOver, s.phase != .gameOver {
            let mt = EuchreGame.teamOf(maker)
            let need = 3 - sideTricks(s, mt)
            if mt == us {
                parts.append(need > 0 ? "You need \(countWord(need, "more trick", "more tricks")) to make it."
                                      : "You have made it.")
            } else {
                parts.append(need > 0
                    ? "They need \(countWord(need, "more trick", "more tricks")); " +
                      "\(countWord(3 - sideTricks(s, us), "more trick", "more tricks")) euchres them."
                    : "They have made it.")
            }
        }
        return parts.joined(separator: " ")
    }

    // MARK: P — trump and partners

    /// Who has spoken so far in the round now under way. Only passes can
    /// appear here: the moment somebody does anything else the round is over.
    static func biddingSoFar(_ s: EuchreState, round: Int) -> String {
        let said = s.bidLog.filter { $0.kind == .pass && $0.round == round }
        if said.isEmpty { return "Nobody has bid yet this round." }
        let names = said.map { seatName(s, $0.player) }
        return names.joined(separator: ", ") + (said.count == 1 ? " has passed." : " have passed.")
    }

    /// Trump, who made it, who your partner is, who is sitting out.
    public static func trumpAndPartner(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        let partner = EuchreGame.partnerOf(seat)
        let base = "Your partner is \(seatName(s, partner)), in seat \(partner + 1). "

        if s.phase == .bid1, let up = s.upcard {
            return base + "The upcard is the \(up.name), so \(up.suit.lowerName) are on offer. " +
                "\(seatName(s, s.dealer)) is dealing. " + biddingSoFar(s, round: 1)
        }
        if s.phase == .bid2, let up = s.upcard {
            return base + "The \(up.name) was turned down, so \(s.deniedSuit?.lowerName ?? up.suit.lowerName) cannot be named. " +
                "\(seatName(s, s.dealer)) is dealing" +
                (s.config.stickTheDealer ? " and must name a suit if it reaches them" : "") + ". " +
                biddingSoFar(s, round: 2)
        }
        guard let maker = s.maker, let trump = s.trump else { return base + "Nobody has made trump yet." }

        var msg = base + "\(trump.name) are trump, made by " +
            (maker == seat ? "you" : seatName(s, maker)) +
            (EuchreGame.teamOf(maker) == EuchreGame.teamOf(seat) ? ", on your side" : ", against you") + ". "
        msg += "The right bower is the Jack of \(trump.name) and the left bower is the Jack of \(trump.sameColour.name). "
        if s.alone {
            msg += (maker == seat ? "You are" : seatName(s, maker) + " is") + " playing alone, so " +
                (s.sittingOut == seat ? "you are" : seatName(s, s.sittingOut) + " is") + " sitting this hand out. "
        }
        if let up = s.upcard {
            msg += "The upcard was the \(up.name)" +
                (s.upcardStatus == .turnedDown ? ", turned down." : ", taken by \(seatName(s, s.dealer)).")
        }
        return msg
    }

    // MARK: C — cards played

    /// WHAT HAS BEEN PLAYED. Not what has not. The browser game used to name
    /// the highest trump still out; it stopped, because working that out is
    /// the game, and a button that does it removes the skill unevenly.
    public static func cardsPlayed(_ s: EuchreState, seat: Int) -> String {
        guard let up = s.upcard else { return "No hand has been dealt yet, so there is nothing to count." }
        guard let trump = s.trump else {
            return "Trump has not been decided yet, so there is nothing to count. The upcard is the \(up.name)."
        }
        let down = s.played + s.trick.map(\.card)
        let trumpGone = down.filter { EuchreCards.isTrump($0, trump: trump) }.count

        var parts = ["Trump played: \(trumpGone) of 7."]
        for su in EuchreCards.suits where su != trump {
            let n = down.filter { !EuchreCards.isTrump($0, trump: trump) && $0.suit == su }.count
            parts.append("\(su.name): \(countWord(n, "card", "cards")) played.")
        }
        parts.append("The upcard was the \(up.name).")
        return parts.joined(separator: " ")
    }

    // MARK: O — play order

    static func places(_ k: Int) -> String {
        let words = ["", "one place", "two places", "three places"]
        return (0..<words.count).contains(k) ? words[k] : "\(k) places"
    }

    /// The roles a seat may be shown as. One place, so the spoken play order
    /// and the players table can never drift apart.
    public static func roleTags(_ s: EuchreState, _ i: Int, seat: Int) -> [String] {
        var roles: [String] = []
        if i == s.dealer { roles.append("dealer") }
        if i == s.maker { roles.append(s.alone ? "maker, alone" : "maker") }
        if i == s.sittingOut { roles.append("sitting out") }
        if i == EuchreGame.partnerOf(seat) { roles.append("your partner") }
        return roles
    }

    static func roleSuffix(_ s: EuchreState, _ i: Int, seat: Int) -> String {
        let r = roleTags(s, i, seat: seat)
        return r.isEmpty ? "" : ", " + r.joined(separator: ", ")
    }

    /// Where everyone sits in the running order, and where you are in it.
    public static func playOrder(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        var list: [String] = []

        if s.phase == .bid1 || s.phase == .bid2 {
            let round = s.phase == .bid1 ? 1 : 2
            var decided: [Int: String] = [:]
            for b in s.bidLog where b.kind != .pass || b.round == round {
                decided[b.player] = b.kind == .pass ? "passed" : b.words
            }
            let start = ((s.dealer ?? 0) + 1) % seats
            for k in 0..<seats {
                let i = (start + k) % seats
                let st = decided[i] ?? (i == s.turn ? "deciding now" : "still to decide")
                list.append("\(k + 1), \(seatName(s, i))\(roleSuffix(s, i, seat: seat)), \(st)")
            }
            return "Bidding order, starting to the dealer's left. " + list.joined(separator: ". ") + "."
        }

        if s.phase != .play && s.phase != .handOver && s.phase != .gameOver {
            return "Seating order: " + (0..<seats).map { seatName(s, $0) + roleSuffix(s, $0, seat: seat) }
                .joined(separator: ", ") + "."
        }

        let startSeat = s.trick.first?.player ?? s.leader
        var playedBy: [Int: Card] = [:]
        for t in s.trick { playedBy[t.player] = t.card }

        var order: [Int] = []
        var at = startSeat
        for _ in 0..<EuchreGame.activeCount(s) {
            order.append(at)
            at = EuchreGame.nextActive(s, at)
        }

        let youAt = order.firstIndex(of: seat)
        let makerAt = s.maker.flatMap { order.firstIndex(of: $0) }
        for (idx, s2) in order.enumerated() {
            var line = "\(idx + 1), \(seatName(s, s2))\(roleSuffix(s, s2, seat: seat))"
            if s.phase == .play {
                line += ", " + (playedBy[s2].map { "played the \($0.name)" } ?? "to play")
            }
            list.append(line)
        }

        var msg = "Play order for this trick, starting with the lead. " + list.joined(separator: ". ") + "."
        if let out = s.sittingOut {
            msg += " " + (out == seat ? "You are" : seatName(s, out) + " is") +
                " sitting out, so there are only three cards to this trick."
        }
        if youAt == 0 { msg += " You lead." }
        else if let y = youAt, y == order.count - 1 { msg += " You play last." }

        if let maker = s.maker, let m = makerAt, let y = youAt, maker != seat {
            let delta = m - y
            msg += delta > 0
                ? " The maker plays \(places(delta)) after you."
                : " The maker plays \(places(-delta)) before you."
        }

        if s.phase == .play, let y = youAt, playedBy[seat] == nil {
            let after = order[(y + 1)...].map { seatName(s, $0) }
            msg += after.isEmpty
                ? " Nobody plays after you."
                : " \(after.count)" + (after.count == 1 ? " player plays" : " players play") +
                  " after you: " + after.joined(separator: ", ") + "."
        }
        return msg
    }

    // MARK: W — who is here

    /// Who is at the table, which side they are on, and whose move it is.
    public static func whoIsHere(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        var parts = ["You are playing against the computer. Your partner is \(seatName(s, EuchreGame.partnerOf(seat)))."]
        for i in 0..<seats {
            let p = s.players[i]
            let who = p.occupant == .human ? (i == seat ? "you" : "a person") : "the computer"
            parts.append("Seat \(i + 1), \(p.name), \(who)" +
                         (i == EuchreGame.partnerOf(seat) ? ", your partner" : "") +
                         (EuchreGame.teamOf(i) == EuchreGame.teamOf(seat) ? "" : ", against you") + ".")
        }
        if let onMove = EuchreGame.seatToAct(s) {
            parts.append(onMove == seat ? "It is your turn." : "Waiting for \(seatName(s, onMove)).")
        } else if s.phase == .handOver {
            parts.append("The hand is over; the table is waiting for somebody to deal.")
        } else if s.phase == .gameOver {
            parts.append("The game is over.")
        }
        return parts.joined(separator: " ")
    }

    // MARK: The hand's result

    /// One sentence: who won the hand and how.
    public static func handResult(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat), let r = s.result else { return "" }
        if r.thrownIn {
            return "Everybody passed twice, so the hand was thrown in. Nobody scored."
        }
        let mySide = EuchreGame.teamOf(seat)
        let makerSide = r.makerTeam ?? 0
        let whoMade = r.maker == seat ? "You" : seatName(s, r.maker)
        let head = whoMade + " made " + (r.trump?.lowerName ?? "trump") +
            (r.alone ? ", alone" : "") + " and took \(countWord(r.made, "trick", "tricks")). "
        if r.euchred {
            return head + (makerSide == mySide
                ? "You were euchred — two points against you."
                : "Euchred — two points to you.")
        }
        return head + cap(makerSide == mySide
            ? countWord(r.deltas[mySide], "point", "points") + " to you."
            : countWord(r.deltas[1 - mySide], "point", "points") + " to them.")
    }

    /// What was face down, once the hand is over: the upcard, what the dealer
    /// put back, and the three cards nobody ever sees at a real table. Nil
    /// while a hand is in progress.
    public static func dealReveal(_ s: EuchreState) -> String? {
        guard s.phase == .handOver || s.phase == .gameOver, let dealt = s.dealt else { return nil }
        let up = dealt.upcard
        var note: String
        if s.result?.thrownIn == true {
            note = "Nobody took the \(up.name) and nobody named a suit, so the hand was thrown in."
        } else if s.upcardStatus == .turnedDown {
            note = "The \(up.name) was turned down, so \(up.suit.lowerName) could not be named. " +
                "\(seatName(s, s.maker)) named \(s.trump?.lowerName ?? "trump") instead."
        } else {
            note = "\(seatName(s, s.dealer)) took the \(up.name) and put back the " +
                (s.discard?.name ?? "card shown") + "."
        }
        note += " Upcard: \(EuchreCards.describe(up, trump: s.trump))."
        if let d = s.discard { note += " Put back: \(EuchreCards.describe(d, trump: s.trump))." }
        let kitty = dealt.kitty.map { EuchreCards.describe($0, trump: s.trump) }
        note += " Kitty: " + (kitty.isEmpty ? "none" : Prose.list(kitty)) + "."
        return note
    }

    // MARK: The status line

    /// One sentence for the status line.
    public static func status(_ s: EuchreState, seat: Int) -> String {
        let mine = isMyTurn(s, seat)
        switch s.phase {
        case .idle:
            return "No hand has been dealt yet."
        case .bid1:
            return "Bidding, round one. The upcard is the \(s.upcard?.name ?? "upcard"). " +
                (mine ? "Your turn: order it up or pass?" : "Waiting for \(seatName(s, s.turn)).")
        case .bid2:
            return "Bidding, round two. \(s.deniedSuit?.name ?? "The upcard") turned down. " +
                (mine ? "Your turn: name a suit or pass?" : "Waiting for \(seatName(s, s.turn)).")
        case .discard:
            return s.dealer == seat
                ? "You took the upcard. Put one card back."
                : "\(seatName(s, s.dealer)) took the upcard and is putting a card back."
        case .play:
            return "\(s.trump?.name ?? "Trump") are trump — trick \(trickNumber(s)) of \(handSize) — " +
                (s.sittingOut == seat ? "you are sitting out this hand."
                    : mine ? "your turn to play." : "\(seatName(s, s.turn)) to play.")
        case .handOver:
            let us = validSeat(s, seat) ? EuchreGame.teamOf(seat) : 0
            return "Hand \(s.handNumber) complete. Score \(s.scores[us]) to \(s.scores[1 - us])."
        case .gameOver:
            let win = s.gameWinner ?? 0
            return "Hand \(s.handNumber) complete. Game over — \(EuchreGame.sideWords(s, team: win)) win, " +
                "\(s.scores[win]) to \(s.scores[1 - win])."
        }
    }

    /// What the game says to a seat when it becomes their move, or when the
    /// table is waiting for a button. Empty when there is nothing to prompt.
    public static func turnPrompt(_ s: EuchreState, seat: Int) -> String {
        guard validSeat(s, seat) else { return "" }
        switch s.phase {
        case .handOver:
            return "Choose Deal next hand."
        case .gameOver:
            return "Choose Start a new game."
        case .play where s.sittingOut == seat:
            return "You are sitting out this hand while \(seatName(s, s.maker)) plays alone."
        default:
            break
        }
        guard isMyTurn(s, seat) else { return "" }
        switch s.phase {
        case .bid1:
            let up = s.upcard
            return "Your turn to bid. The upcard is the \(up?.name ?? "upcard"). " +
                "Order it up to make \(up?.suit.lowerName ?? "its suit") trump, or pass."
        case .bid2:
            return "Your turn to bid. \(s.deniedSuit?.name ?? "The upcard") were turned down. Name another suit, or pass."
        case .discard:
            return "You took the upcard. Choose one card to put back."
        case .play:
            if s.trick.isEmpty { return "Your lead. Trick \(trickNumber(s)) of \(handSize)." }
            return "Your turn to play. " + trickShort(s)
        case .idle, .handOver, .gameOver:
            return ""
        }
    }

    /// A short hint for the play phase: what to lead or follow.
    public static func playHint(_ s: EuchreState, seat: Int) -> String {
        guard s.phase == .play, let trump = s.trump else { return "" }
        guard let first = s.trick.first else { return "Lead any card from your hand. \(trump.name) are trump." }
        let led = EuchreCards.effectiveSuit(first.card, trump: trump)
        return led == trump
            ? "Trump was led. Follow with trump if you have any — including the left bower, the Jack of \(trump.sameColour.name)."
            : "Follow \(led.lowerName) if you can."
    }
}

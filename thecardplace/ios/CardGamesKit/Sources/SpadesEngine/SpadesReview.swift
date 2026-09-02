import CardCore

/// The review sentences — the strings behind the H/T/L/B/S/C/O/W buttons in
/// `spades/js/ui.js`, as pure functions of the state and a seat. Wherever the
/// web wording referred to a key or the mouse it has been dropped.
public enum SpadesReview {
    typealias G = SpadesGame
    typealias C = SpadesCards

    static func seatName(_ state: SpadesState, _ i: Int) -> String { G.vb(state, i) }
    public static func teamName(_ state: SpadesState, _ team: Int) -> String { G.teamName(state, team) }

    static func listOf(_ items: [String]) -> String { items.isEmpty ? "nothing" : Prose.list(items) }
    static func bidWord(_ b: Int?) -> String {
        guard let b = b else { return "still to bid" }
        return b == 0 ? "nil" : String(b)
    }
    static func bagWord(_ n: Int) -> String { Prose.count(n, "bag") }

    // MARK: H — the hand

    /// The hand, grouped by suit; the trump suit named once, at the end, with
    /// the spade count. "Clubs: Ace, Ten and Four. Diamonds: King. Spades
    /// (trump): Queen and Nine. 2 spades."
    public static func hand(_ state: SpadesState, seat: Int) -> String {
        guard seat >= 0, seat < state.players.count else { return "Your hand is empty." }
        let hand = state.players[seat].hand
        if hand.isEmpty { return "Your hand is empty." }
        var parts: [String] = []
        var spades = 0
        for s in C.suitOrder {
            let ranks = C.sortHand(hand.filter { $0.suit == s }).map { $0.rank.name }
            if ranks.isEmpty { continue }
            if s == C.trump { spades = ranks.count }
            parts.append(s.name + (s == C.trump ? " (trump)" : "") + ": " + listOf(ranks))
        }
        return parts.joined(separator: ". ") + ". "
            + (spades > 0 ? Prose.count(spades, "spade") + "." : "No spades.")
    }

    // MARK: T — this trick

    public static func trick(_ state: SpadesState) -> String {
        if state.trick.isEmpty { return "Nothing has been played to this trick yet." }
        let parts = state.trick.map { "\(seatName(state, $0.seat)) played the \($0.card.name)" }
        let led = state.trick[0].card.suit
        let w = G.trickWinner(state.trick)!
        return parts.joined(separator: ", ") + ". \(led.name) was led. \(seatName(state, w.seat)) is winning it."
    }

    // MARK: L — the last trick

    public static func lastTrick(_ state: SpadesState) -> String {
        guard let lt = state.lastTrick else { return "No trick has been completed yet." }
        let parts = lt.cards.map { "\(seatName(state, $0.seat)) played the \($0.card.name)" }
        return parts.joined(separator: ", ") + ". \(seatName(state, lt.winner)) took it."
    }

    // MARK: S — scores and bags

    public static func scores(_ state: SpadesState) -> String {
        "\(teamName(state, 0)) \(state.scores[0]) with \(bagWord(state.bags[0])), "
            + "\(teamName(state, 1)) \(state.scores[1]) with \(bagWord(state.bags[1]))"
            + ". Playing to \(G.target(of: state))."
    }

    // MARK: B — bids and contract

    /// The single most useful sentence in this game: what each pair promised,
    /// what they have, and what is still needed — your own side first. A
    /// negative "needs" is said as bags. Any nil in play is named, and whether
    /// it is still intact.
    public static func contract(_ state: SpadesState, seat: Int) -> String {
        if state.phase == .bidding {
            let said = state.players.filter { $0.bid != nil }
            if said.isEmpty { return "Nobody has bid yet." }
            return said.map { "\(seatName(state, $0.index)) \(bidWord($0.bid))" }.joined(separator: ", ") + "."
        }
        if state.phase == .idle { return "Nobody has bid yet." }

        var lines: [String] = []
        for t in 0..<G.teams {
            let contract = G.contractOf(state, team: t), took = G.tricksOf(state, team: t)
            let need = contract - took
            let tail: String
            if need > 0 { tail = "\(need) more \(need == 1 ? "trick" : "tricks") needed" }
            else if need == 0 { tail = "made it exactly" }
            else { tail = "\(-need) over, \(bagWord(-need)) so far" }
            lines.append("\(teamName(state, t)) bid \(contract), took \(took) — \(tail)")
        }
        // Your own side first.
        if G.teamOf(max(0, seat)) == 1 { lines.reverse() }

        var nils: [String] = []
        for p in state.players where p.bid == 0 {
            if p.tricks == 0 {
                nils.append("\(p.name) bid nil and has not taken a trick.")
            } else {
                nils.append("\(p.name) bid nil and has taken \(Prose.count(p.tricks, "trick")).")
            }
        }
        return lines.joined(separator: ". ") + "." + (nils.isEmpty ? "" : " " + nils.joined(separator: " "))
    }

    // MARK: C — cards played

    /// What has gone, whether spades can be led yet, how many spades are gone,
    /// and the highest card in each suit that this seat has not yet seen —
    /// neither in its own hand nor on the table this hand.
    public static func cardsPlayed(_ state: SpadesState, seat: Int) -> String {
        let played = state.tricksPlayed
        let left = G.handSize - played
        var text = "\(Prose.count(played, "trick")) played, \(left) to go. Spades "
            + (state.spadesBroken ? "are broken." : "have not been broken.")

        let gone = state.playedThisHand
        let spadesGone = gone.count(of: C.trump)
        text += spadesGone == 0 ? " No spades have gone." : " \(Prose.count(spadesGone, "spade")) gone."

        let mine = seat >= 0 && seat < state.players.count ? state.players[seat].hand : []
        let seen = Set(gone + mine)
        var highest: [String] = []
        for s in C.suitOrder {
            if let top = C.rankOrder.map({ Card($0, s) }).first(where: { !seen.contains($0) }) {
                highest.append(top.name)
            }
        }
        if !highest.isEmpty {
            text += " Highest still out: " + Prose.list(highest) + "."
        }
        return text
    }

    // MARK: O — play order

    public static func playOrder(_ state: SpadesState) -> String {
        let from = state.trick.first?.seat ?? state.leader
        let names = (0..<G.seats).map { seatName(state, (from + $0) % G.seats) }
        return "Play goes " + names.joined(separator: ", then ") + "."
    }

    // MARK: W — who is here

    /// Who is here, and who is with whom.
    public static func whoIsHere(_ state: SpadesState, seat: Int) -> String {
        let myTeam = G.teamOf(max(0, seat))
        var parts: [String] = []
        for t in 0..<G.teams {
            let members = state.players.filter { $0.team == t }
            parts.append(members.map { "\($0.name) (\($0.occupant == .human ? "a person" : "computer"))" }
                .joined(separator: " and ") + (t == myTeam ? ", your side" : ""))
        }
        return parts.joined(separator: ". Against: ") + "."
    }

    // MARK: The status line

    /// One sentence for the status line. The contract travels with the turn
    /// line during play, because it is the number the player needs at exactly
    /// the moment they are choosing a card.
    public static func status(_ state: SpadesState, seat: Int) -> String {
        let me = max(0, seat)
        switch state.phase {
        case .idle:
            return "Ready to start."
        case .bidding:
            if state.turn == me {
                let partner = G.partnerOf(me)
                let partnerBid = state.players[partner].bid
                return "Your bid. How many tricks will you take? "
                    + (partnerBid != nil
                        ? "\(seatName(state, partner)) bid \(bidWord(partnerBid))."
                        : "Your partner has not bid yet.")
            }
            return "Waiting for \(seatName(state, state.turn)) to bid."
        case .play:
            let team = G.teamOf(me)
            let need = G.contractOf(state, team: team) - G.tricksOf(state, team: team)
            let tail = need > 0 ? " You need \(need) more."
                : need == 0 ? " Your contract is made."
                : " \(bagWord(-need)) over."
            if state.turn == me {
                return "Your turn. " + (state.trick.isEmpty ? "You lead." : "\(state.trick[0].card.suit.name) was led.") + tail
            }
            return "Waiting for \(seatName(state, state.turn))." + tail
        case .handOver:
            return "Hand \(state.dealNumber) is over. " + scores(state)
        case .gameOver:
            if let w = state.winner {
                return "\(teamName(state, w)) win, \(state.scores[w]) to \(state.scores[1 - w])."
            }
            return "The game is over."
        }
    }
}

import CardCore

/// The review sentences — the text behind the web game's H, T, L, S, P, C and
/// O buttons and its status line — as pure functions from state and seat to
/// a string. Ported from `sheephead-multiplayer/js/ui.js`.
///
/// Everything here is written from `seat`'s point of view and reveals only
/// what that seat is entitled to know: its own cards, the table, and the sides
/// once the jack of diamonds has shown.
public enum SheepheadReview {
    private typealias C = SheepheadCards

    private static func name(_ state: SheepheadState, _ i: Int) -> String { state.players[i].name }

    private static func inTrick(_ state: SheepheadState, _ p: Int) -> Bool {
        state.trick.contains { $0.player == p }
    }

    /// Which trick we are on, counted from the seat's own remaining cards.
    public static func trickNumber(_ state: SheepheadState, seat: Int) -> Int {
        let d = state.spec
        let held = state.players[seat].hand.count
        return min(d.hand, d.hand - held + (inTrick(state, seat) ? 0 : 1))
    }

    // MARK: Cards

    /// What holding the jack of diamonds means for this seat right now. Only
    /// ever describes their own position, never anybody else's.
    public static func partnerCardMeaning(_ state: SheepheadState, seat: Int) -> String {
        guard let picker = state.picker else { return "the partner card" }
        if picker == seat { return "the partner card, so you are playing alone" }
        return "the partner card, so you are the picker's partner"
    }

    private static func holdsPartnerCard(_ state: SheepheadState, seat: Int) -> Bool {
        state.spec.partner && state.players[seat].hand.contains(C.partnerCard)
    }

    /// A card in this seat's own hand, as its accessibility label: the plain
    /// description, then "from the blind" for a card just picked up, then what
    /// the jack of diamonds means for this seat.
    public static func describe(_ card: Card, in state: SheepheadState, seat: Int) -> String {
        var label = C.describe(card)
        if state.phase == .bury, state.picker == seat, state.pickedUp.contains(card) {
            label += ", from the blind"
        }
        if card == C.partnerCard, holdsPartnerCard(state, seat: seat) {
            label += ", " + partnerCardMeaning(state, seat: seat)
        }
        return label
    }

    // MARK: H — the hand

    public static func hand(_ state: SheepheadState, seat: Int, verbose: Bool = true) -> String {
        let hand = C.sortHand(state.players[seat].hand)
        if hand.isEmpty { return "Your hand is empty." }

        // Just after picking, call out what came from the blind before anything
        // else — that is the thing the picker actually needs to know right now.
        var lead = ""
        if state.phase == .bury, state.picker == seat, !state.pickedUp.isEmpty {
            lead = "From the blind: " + state.pickedUp.map(\.name).joined(separator: ", ") + ". Then your hand. "
        }

        let trump = hand.filter(C.isTrump)
        let fail = hand.filter { !C.isTrump($0) }
        var parts: [String] = []
        parts.append(trump.isEmpty ? "No trump" : "Trump: " + trump.map(\.name).joined(separator: ", "))
        parts.append(fail.isEmpty ? "No non-trump cards" : "Non-trump: " + fail.map(\.name).joined(separator: ", "))

        var msg = lead + "Your hand, \(Prose.count(hand.count, "card")). " + parts.joined(separator: ". ") + "."
        if verbose { msg += " Worth \(C.sumPoints(hand)) points." }
        if holdsPartnerCard(state, seat: seat) {
            msg += " You hold the Jack of Diamonds, " + partnerCardMeaning(state, seat: seat) + "."
        }
        return msg
    }

    // MARK: T — the current trick

    /// "Trump led. Alice is winning with Queen of Clubs. 14 points in the trick so far."
    public static func trickShort(_ state: SheepheadState) -> String {
        guard let first = state.trick.first else { return "Nothing played to this trick yet." }
        let led = C.effectiveSuit(first.card)
        let w = state.trick[SheepheadGame.trickWinnerIndex(state.trick)]
        let pts = C.sumPoints(state.trick.map(\.card))
        return led.name + " led. " + name(state, w.player) + " is winning with " + w.card.name + ". "
            + Prose.count(pts, "point") + " in the trick so far."
    }

    public static func trick(_ state: SheepheadState, seat: Int, verbose: Bool = true) -> String {
        let head = "Trick \(trickNumber(state, seat: seat)) of \(state.spec.hand). "
        if state.trick.isEmpty { return head + "Nothing played yet. " + name(state, state.turn) + " to lead." }
        let list = state.trick.map { t in
            name(state, t.player) + ", " + (verbose ? C.describe(t.card) : t.card.name)
        }.joined(separator: ". ")
        return head + list + ". " + trickShort(state)
    }

    // MARK: L — the last trick

    public static func lastTrick(_ state: SheepheadState, seat: Int) -> String {
        guard let lt = state.lastTrick else { return "No trick has been completed yet this hand." }
        let list = lt.plays.map { name(state, $0.player) + ", " + $0.card.name }.joined(separator: ". ")
        return "Last trick. " + list + ". " + name(state, lt.winner) + " took it for \(lt.points) points."
    }

    // MARK: S — scores

    public static func scores(_ state: SheepheadState, seat: Int) -> String {
        let hand = state.players.map { p in
            p.name + " \(p.points), " + Prose.count(p.tricksWon, "trick")
        }.joined(separator: ". ")
        let running = state.players.map { $0.name + " \($0.score)" }.joined(separator: ", ")
        var buried = ""
        if state.picker == seat, !state.buried.isEmpty {
            buried = " You buried \(C.sumPoints(state.buried)) points."
        }
        return "This hand: " + hand + "." + buried + " Running score: " + running + "."
    }

    // MARK: P — the picker and the partner

    public static func picker(_ state: SheepheadState, seat: Int) -> String {
        if state.phase == .idle { return "The hand has not been dealt." }
        if state.phase == .pick { return "Nobody has picked yet. " + name(state, state.turn) + " is deciding." }
        if state.isLeaster {
            return "Leaster. There is no picker; everyone plays for themselves and the fewest points wins. You must take at least one trick to be eligible."
        }
        guard let picker = state.picker else { return "No picker yet." }
        let msg = picker == seat ? "You are the picker." : name(state, picker) + " is the picker."
        if !state.spec.partner { return msg + " With \(state.seats) players the picker always plays alone." }

        // Once the jack of diamonds has shown, everything is public.
        if state.partnerRevealed {
            if state.alone { return msg + " The picker is playing alone." }
            let partner = state.partner!
            return msg + " " + (partner == seat ? "You are" : name(state, partner) + " is") + " the partner."
        }
        // Still hidden. Only tell the player what their own cards entitle them to know.
        if picker == seat {
            return msg + (state.alone
                ? " You have the Jack of Diamonds yourself, so you are playing alone. Nobody else knows that yet."
                : " Somebody else holds the Jack of Diamonds and is your secret partner.")
        }
        if state.players[seat].hand.contains(C.partnerCard) {
            return msg + " You hold the Jack of Diamonds, so you are the secret partner. Nobody else knows yet."
        }
        return msg + " The Jack of Diamonds has not been played, so the partner is still unknown — "
            + "and the picker may be holding it and playing alone."
    }

    // MARK: C — the counting aid

    /// What has been played, using only what the player could legitimately
    /// track. Naming the highest trump still out is the skill the game is made
    /// of, so this counts and does not name.
    public static func cardsPlayed(_ state: SheepheadState, seat: Int) -> String {
        let trumpTotal = C.trumpOrder.filter { !state.spec.exclude.contains($0) }.count
        let trumpPlayed = state.played.filter(C.isTrump).count
        var parts = ["Trump played: \(trumpPlayed) of \(trumpTotal)."]
        for s in C.failSuits {
            let played = state.played.filter { !C.isTrump($0) && $0.suit == s }.count
            parts.append(s.name + ": \(played) of 6 played.")
        }
        return parts.joined(separator: " ")
    }

    // MARK: O — the play order

    /// The roles a seat may be shown as, from this player's point of view. The
    /// one place the disclosure rule lives.
    public static func roleTags(_ state: SheepheadState, of i: Int, seat: Int) -> [String] {
        var roles: [String] = []
        if i == state.dealer { roles.append("dealer") }
        if i == state.picker {
            roles.append("picker")
            if state.alone, state.partnerRevealed || i == seat { roles.append("alone") }
        }
        if !state.isLeaster, !state.alone, state.partner == i, state.partnerRevealed || i == seat {
            roles.append("partner")
        }
        if state.isLeaster { roles.append("leaster") }
        return roles
    }

    private static func places(_ k: Int) -> String {
        let words = ["", "one place", "two places", "three places", "four places", "five places"]
        return (0..<words.count).contains(k) && k > 0 ? words[k] : "\(k) places"
    }

    public static func playOrder(_ state: SheepheadState, seat: Int) -> String {
        let n = state.seats
        var list: [String] = []

        if state.phase == .pick {
            var decided: [Int: Bool] = [:]
            for e in state.pickLog { decided[e.player] = e.picked }
            let pickStart = ((state.dealer ?? -1) + 1) % n
            for k in 0..<n {
                let i = (pickStart + k) % n
                let tags = roleTags(state, of: i, seat: seat)
                let st: String
                if let d = decided[i] { st = d ? "picked" : "passed" }
                else { st = i == state.turn ? "deciding now" : "still to decide" }
                list.append("\(k + 1), " + name(state, i) + (tags.isEmpty ? "" : ", " + tags.joined(separator: ", ")) + ", " + st)
            }
            return "Picking order, starting to the dealer's left. " + list.joined(separator: ". ") + "."
        }

        if state.phase != .play && state.phase != .handOver {
            return "Seating order: " + state.players.map(\.name).joined(separator: ", ") + "."
        }

        let startSeat = state.trick.first?.player ?? state.leader
        var playedBy: [Int: Card] = [:]
        for t in state.trick { playedBy[t.player] = t.card }

        var youAt = -1, pickerAt = -1
        for k in 0..<n {
            let i = (startSeat + k) % n
            if i == seat { youAt = k }
            if i == state.picker { pickerAt = k }
            let tags = roleTags(state, of: i, seat: seat)
            var line = "\(k + 1), " + name(state, i) + (tags.isEmpty ? "" : ", " + tags.joined(separator: ", "))
            if state.phase == .play {
                line += ", " + (playedBy[i].map { "played " + $0.name } ?? "to play")
            }
            list.append(line)
        }

        var msg = "Play order for this trick, starting with the lead. " + list.joined(separator: ". ") + "."

        if youAt == 0 { msg += " You lead." }
        else if youAt == n - 1 { msg += " You play last." }

        if !state.isLeaster, let picker = state.picker {
            if picker == seat {
                msg += " You are the picker."
            } else if pickerAt >= 0, youAt >= 0 {
                let delta = pickerAt - youAt
                msg += delta > 0
                    ? " The picker plays " + places(delta) + " after you."
                    : " The picker plays " + places(-delta) + " before you."
            }
        }

        if state.phase == .play, youAt >= 0, playedBy[seat] == nil {
            var after: [String] = []
            if youAt + 1 < n {
                for k in (youAt + 1)..<n { after.append(name(state, (startSeat + k) % n)) }
            }
            msg += after.isEmpty
                ? " Nobody plays after you."
                : " \(after.count) " + (after.count == 1 ? "player plays" : "players play")
                    + " after you: " + after.joined(separator: ", ") + "."
        }
        return msg
    }

    // MARK: The status line

    /// One sentence for the status line.
    public static func status(_ state: SheepheadState, seat: Int) -> String {
        let d = state.spec
        switch state.phase {
        case .idle:
            return "Ready to start."
        case .pick:
            return state.turn == seat
                ? "Your turn: pick up the blind (\(d.blind) cards) or pass?"
                : "Waiting for " + name(state, state.turn) + " to pick or pass."
        case .bury:
            return state.picker == seat
                ? "You picked. Bury \(d.blind) cards."
                : name(state, state.picker ?? 0) + " picked and is burying."
        case .play:
            return "Trick \(trickNumber(state, seat: seat)) of \(d.hand) — "
                + (state.turn == seat ? "your turn to play." : name(state, state.turn) + " to play.")
        case .handOver:
            return "Hand \(state.handNumber) complete."
        }
    }

    /// What is asked of this seat right now, as it is announced; empty when
    /// nothing is.
    public static func prompt(_ state: SheepheadState, seat: Int) -> String {
        let d = state.spec
        switch state.phase {
        case .idle: return ""
        case .handOver: return "Choose Deal next hand."
        case .pick:
            guard state.turn == seat else { return "" }
            return "Your turn. Pick up the blind of \(d.blind) cards, or pass?"
        case .bury:
            guard state.picker == seat else { return "" }
            return "You picked. Choose \(d.blind) cards to bury, then choose Bury."
        case .play:
            guard state.turn == seat else { return "" }
            if state.trick.isEmpty { return "Your lead. Trick \(trickNumber(state, seat: seat)) of \(d.hand)." }
            return "Your turn to play. " + trickShort(state)
        }
    }

    // MARK: Hand end

    /// The outcome in one line.
    public static func resultHeadline(_ state: SheepheadState, seat: Int) -> String {
        guard let r = state.result else { return "" }
        if r.leaster, let w = r.winners.first {
            return name(state, w) + " wins the leaster with the fewest points."
        }
        guard let picker = state.picker else { return "" }
        // One player takes a singular verb, two take a plural, and "You" takes the
        // second person either way.
        let youAreThem = picker == seat && name(state, seat).lowercased() == "you"
        if state.alone {
            return name(state, picker)
                + (r.pickerWins ? (youAreThem ? " win" : " wins") : (youAreThem ? " lose" : " loses"))
                + " alone — " + r.label + "."
        }
        return name(state, picker) + " and " + name(state, state.partner!)
            + (r.pickerWins ? " win" : " lose") + " — " + r.label + "."
    }

    /// The blind and the bury, shown card by card once the hand is over.
    /// Empty until then: during play it is nobody's business.
    public static func blindReveal(_ state: SheepheadState) -> String {
        guard state.phase == .handOver, let dealt = state.dealt else { return "" }
        let blind = dealt.blind
        var note: String
        if state.isLeaster {
            let last = state.trickLog.last
            note = "Nobody picked, so the blind was worth \(C.sumPoints(blind)) to "
                + (last.map { name(state, $0.winner) } ?? "whoever took the last trick") + " with the last trick."
            note += " Blind: " + blind.map(\.name).joined(separator: ", ") + "."
        } else {
            note = "The blind, and what " + name(state, state.picker ?? 0) + " buried ("
                + "\(C.sumPoints(state.buried)) points, counted for the picker's team)."
            note += " Blind: " + blind.map(\.name).joined(separator: ", ") + "."
            note += " Buried: " + state.buried.map(\.name).joined(separator: ", ") + "."
        }
        return note
    }
}

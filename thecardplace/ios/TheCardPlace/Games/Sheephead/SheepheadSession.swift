import SwiftUI
import CardCore
import SheepheadEngine

/// One game of sheephead, from the person's chair. Owns the engine state,
/// runs the computer players at the chosen pace, and turns every event into
/// an announcement and a log line.
///
/// Hidden information stays hidden: the hand labels, the roles in the players
/// table and every review sentence come from `SheepheadReview`, which only
/// ever says what seat 0 is entitled to know.
@MainActor
@Observable
final class SheepheadSession {
    static let me = 0

    private(set) var state: SheepheadState
    private var rng = RandomSource()
    let announcer = Announcer()
    let gate = PaceGate()
    private let settings: AppSettings

    /// Newest first.
    private(set) var log: [LogEntry] = []
    private var lastEventId = 0
    /// Log ids are ours, not the engine's: a new game restarts the engine's
    /// numbering, and the log is kept across games.
    private var logSerial = 0

    /// Cards chosen to bury, in the order chosen.
    private(set) var selected: [Card] = []

    /// The card VoiceOver should move to, and a counter so the same card can
    /// be asked for twice.
    private(set) var focusCard: String?
    private(set) var focusTick = 0

    /// The hand whose blind and bury have been read out, so they are said once.
    private var revealedHand = 0

    private var botTask: Task<Void, Never>?

    init(settings: AppSettings) {
        self.settings = settings
        let rules = settings.rules(for: .sheephead, default: SheepheadRulesOptions())
        let players = min(6, max(3, rules.players))
        let config = SheepheadConfig(names: settings.names(seats: players),
                                     players: players,
                                     difficulty: settings.difficulty,
                                     allPass: rules.allPass,
                                     blackQueenDoubler: rules.blackQueenDoubler,
                                     redQueenDoubler: rules.redQueenDoubler,
                                     redealDoubler: rules.redealDoubler)
        state = SheepheadGame.createGame(config)
        apply(.start)
        runBots()
    }

    // MARK: - what the screen shows

    var status: String { SheepheadReview.status(state, seat: Self.me) }
    var me: SheepheadPlayer { state.players[Self.me] }
    var isMyTurn: Bool { SheepheadGame.seatToAct(state) == Self.me }
    var isPicker: Bool { state.picker == Self.me }
    var pace: Pace { settings.pace(for: .sheephead) }
    /// How many cards the picker takes and buries: two at every table size.
    var buryCount: Int { state.spec.blind }

    /// "trump" or "N pts": short enough to print on the face of the card.
    private func badge(_ card: Card) -> String {
        SheepheadCards.isTrump(card) ? "trump" : "\(SheepheadCards.points(card)) pts"
    }

    var handItems: [HandCardItem] {
        let hand = me.hand
        switch state.phase {
        case .bury where isPicker:
            return hand.map { c in
                // The engine's label already says "from the blind"; the card's
                // mark says it too, and the button reads both. Take it out of
                // the description so it is spoken once, and shown on the face.
                let fromBlind = state.pickedUp.contains(c)
                var text = SheepheadReview.describe(c, in: state, seat: Self.me)
                if fromBlind { text = text.replacingOccurrences(of: ", from the blind", with: "") }
                return HandCardItem(card: c, description: text, badge: badge(c),
                                    selected: selected.contains(c),
                                    marked: fromBlind ? "from the blind" : nil)
            }
        case .play where isMyTurn:
            let legal = SheepheadGame.legalPlays(state, seat: Self.me)
            return hand.map { c in
                let ok = legal.contains(c)
                return HandCardItem(card: c, description: SheepheadReview.describe(c, in: state, seat: Self.me),
                                    badge: badge(c),
                                    playable: ok,
                                    reason: ok ? nil : SheepheadGame.whyNot(state, seat: Self.me, card: c))
            }
        default:
            // Picking, waiting, somebody else burying: every card is readable and
            // nothing is marked unavailable. A tap says what to do instead.
            return hand.map { HandCardItem(card: $0, description: SheepheadReview.describe($0, in: state, seat: Self.me), badge: badge($0)) }
        }
    }

    var handHint: String {
        switch state.phase {
        case .bury: return isPicker ? "Selects this card to bury" : ""
        case .play: return isMyTurn ? "Plays this card" : ""
        default: return ""
        }
    }

    var trickPlays: [PlayedCard] {
        guard !state.trick.isEmpty else { return [] }
        let winning = state.trick[SheepheadGame.trickWinnerIndex(state.trick)]
        return state.trick.enumerated().map { i, p in
            var note: String? = nil
            if p.player == winning.player { note = "winning so far" }
            if i == 0 { note = note.map { "led, " + $0 } ?? "led" }
            return PlayedCard(id: "\(p.player)-\(p.card.id)", player: name(p.player), card: p.card,
                              description: SheepheadCards.describe(p.card), note: note)
        }
    }

    var lastTrickPlays: [PlayedCard] {
        guard let lt = state.lastTrick else { return [] }
        return lt.plays.map { p in
            var note: String? = nil
            if p.player == lt.winner {
                note = "took the trick, \(Prose.count(lt.points, "point"))"
                if lt.fromBlind > 0 { note! += " including \(lt.fromBlind) from the blind" }
            }
            return PlayedCard(id: "last-\(p.player)-\(p.card.id)", player: name(p.player), card: p.card,
                              description: SheepheadCards.describe(p.card), note: note)
        }
    }

    /// Player, role, tricks, points this hand, score. The roles come from the
    /// review's one disclosure rule: dealer always; picker once there is one;
    /// partner and alone only when the jack of diamonds has shown, or when the
    /// seat is your own.
    var playerRows: [[String]] {
        state.players.map { p in
            let roles = SheepheadReview.roleTags(state, of: p.index, seat: Self.me)
            return [p.name + (p.index == Self.me ? " (you)" : ""),
                    roles.isEmpty ? "none" : roles.joined(separator: ", "),
                    "\(p.tricksWon)", "\(p.points)", "\(p.score)"]
        }
    }

    var historyColumns: [String] { ["Hand", "Picker", "Partner", "Result"] + state.players.map(\.name) }
    var historyRows: [[String]] {
        state.history.map { h in
            let picker: String
            let partner: String
            if h.isLeaster {
                picker = "nobody, leaster"
                partner = "none"
            } else {
                picker = h.picker.map { h.names[$0] } ?? "nobody"
                partner = h.alone ? "alone" : (h.partner.map { h.names[$0] } ?? "none")
            }
            return ["\(h.handNumber)", picker, partner, h.result.label] + h.result.deltas.map { d in
                d > 0 ? "+\(d)" : "\(d)"
            }
        }
    }

    /// The blind as it was dealt, once the hand is over. Empty until then.
    var revealedBlind: [Card] {
        guard state.phase == .handOver, let dealt = state.dealt else { return [] }
        return dealt.blind
    }

    /// What the picker buried, once the hand is over. Empty in a leaster.
    var revealedBury: [Card] {
        guard state.phase == .handOver else { return [] }
        return state.buried
    }

    var blindReveal: String { SheepheadReview.blindReveal(state) }
    var resultHeadline: String { SheepheadReview.resultHeadline(state, seat: Self.me) }

    var who: String {
        let list = state.players.map { p in
            p.name + (p.index == Self.me ? " (you)" : "") + (p.index == state.dealer ? ", dealer" : "")
        }
        let d = state.spec
        var msg = "\(Prose.number(state.seats).capitalized) players: " + Prose.list(list) + "."
        msg += " \(Prose.count(d.hand, "card")) each and \(Prose.count(d.blind, "card")) in the blind."
        msg += d.partner ? " The Jack of Diamonds names the picker's partner." : " The picker always plays alone."
        return msg
    }

    var reviews: [ReviewItem] {
        [
            ReviewItem("Hand", key: "h") { [unowned self] in SheepheadReview.hand(state, seat: Self.me) },
            ReviewItem("Trick", key: "t") { [unowned self] in SheepheadReview.trick(state, seat: Self.me) },
            ReviewItem("Last trick", key: "l") { [unowned self] in SheepheadReview.lastTrick(state, seat: Self.me) },
            ReviewItem("Scores", key: "s") { [unowned self] in SheepheadReview.scores(state, seat: Self.me) },
            ReviewItem("Picker and partner", key: "p") { [unowned self] in SheepheadReview.picker(state, seat: Self.me) },
            ReviewItem("Cards played", key: "c") { [unowned self] in SheepheadReview.cardsPlayed(state, seat: Self.me) },
            ReviewItem("Play order", key: "o") { [unowned self] in SheepheadReview.playOrder(state, seat: Self.me) },
            ReviewItem("Who is here", key: "w") { [unowned self] in who },
            ReviewItem("Status") { [unowned self] in status }
        ]
    }

    func name(_ seat: Int) -> String { state.players[seat].name }

    /// Who the table is waiting on, for a refusal.
    private var waitingFor: String {
        let seat = SheepheadGame.seatToAct(state) ?? state.turn
        return "Not your turn. Waiting for \(name(seat))."
    }

    // MARK: - what the person does

    func tap(_ item: HandCardItem) {
        switch state.phase {
        case .pick:
            announcer.error(isMyTurn ? "Pick or pass first." : waitingFor)
        case .bury:
            guard isPicker else {
                announcer.error(waitingFor)
                return
            }
            if let i = selected.firstIndex(of: item.card) {
                selected.remove(at: i)
                announcer.request("\(item.card.name) removed. \(selectionSummary)")
            } else if selected.count >= buryCount {
                announcer.error("\(Prose.number(buryCount).capitalized) cards are already chosen: \(selected.spokenList). Remove one first.")
            } else {
                selected.append(item.card)
                announcer.request("\(item.card.name) chosen. \(selectionSummary)")
            }
        case .play:
            guard isMyTurn else {
                announcer.error(waitingFor)
                return
            }
            if let why = SheepheadGame.whyNot(state, seat: Self.me, card: item.card) {
                announcer.error("\(item.card.name) cannot be played: \(why)")
                return
            }
            apply(.play(item.card))
            runBots()
        case .handOver:
            announcer.error("The hand is over. Choose Deal the next hand.")
        case .idle:
            break
        }
    }

    var selectionSummary: String {
        let n = selected.count
        if n == 0 { return "No cards chosen yet." }
        return "\(Prose.number(n).capitalized) of \(Prose.number(buryCount)) chosen"
            + (n == buryCount ? ". Choose Bury to put them down." : ".")
    }

    func pick() {
        guard state.phase == .pick, isMyTurn else {
            announcer.error(waitingFor)
            return
        }
        selected = []
        apply(.pick)
        runBots()
    }

    func pass() {
        guard state.phase == .pick, isMyTurn else {
            announcer.error(waitingFor)
            return
        }
        apply(.pass)
        runBots()
    }

    func burySelected() {
        guard state.phase == .bury, isPicker else {
            announcer.error(waitingFor)
            return
        }
        guard selected.count == buryCount else {
            announcer.error("Choose exactly \(Prose.number(buryCount)) cards to bury. \(selectionSummary)")
            return
        }
        let cards = selected
        selected = []
        apply(.bury(cards))
        runBots()
    }

    func nextHand() {
        guard SheepheadGame.canDeal(state) else { return }
        apply(.nextHand)
        runBots()
    }

    func newGame() {
        botTask?.cancel()
        gate.cancel()
        selected = []
        // The engine only takes newGame between hands; starting over mid-hand
        // is the person's call, so rebuild the table the same way it did.
        state = SheepheadGame.createGame(state.config)
        lastEventId = 0
        revealedHand = 0
        apply(.start)
        runBots()
    }

    func stop() {
        botTask?.cancel()
        gate.cancel()
        announcer.clear()
    }

    // MARK: - the engine

    @discardableResult
    private func apply(_ action: SheepheadAction, seat: Int = SheepheadSession.me, speak: Bool = true) -> Bool {
        let r = SheepheadGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        if !r.ok {
            announcer.error(r.reason.map { $0.prefix(1).uppercased() + $0.dropFirst() + ($0.hasSuffix(".") ? "" : ".") } ?? "That was refused.")
            return false
        }
        if speak { drain(batch: false) }
        return true
    }

    /// New events into the log and, unless told to hold them, out loud.
    @discardableResult
    private func drain(batch: Bool) -> [String] {
        let fresh = state.log.events(for: Self.me, since: lastEventId)
        guard !fresh.isEmpty else { return [] }
        lastEventId = fresh.last!.id
        let entries = fresh.map { e -> LogEntry in
            logSerial += 1
            return LogEntry(id: logSerial, text: e.text)
        }
        log.insert(contentsOf: entries.reversed(), at: 0)
        let texts = fresh.map(\.text)
        if !batch { announcer.say(batch: texts) }
        return texts
    }

    private func runBots() {
        botTask?.cancel()
        botTask = Task { [weak self] in
            await self?.driveBots()
        }
    }

    private func driveBots() async {
        var held: [String] = []
        let batching = pace == .immediate || !settings.speakEveryPlay
        while !Task.isCancelled,
              let seat = SheepheadGame.seatToAct(state),
              state.players[seat].occupant == .bot {
            // The pause is for plays. A computer deciding to pick, pass or bury
            // is a sentence or two and does not need the table to wait.
            if state.phase == .play {
                await gate.wait(pace)
                if Task.isCancelled { return }
            }
            guard let action = SheepheadAI.decide(state, seat: seat, rng: &rng) else { break }
            let r = SheepheadGame.applyAction(&state, seat: seat, action: action, rng: &rng)
            if !r.ok {
                announcer.error("The computer's move was refused: \(r.reason ?? "no reason given").")
                break
            }
            if batching {
                held += drain(batch: true)
            } else {
                drain(batch: false)
            }
        }
        if !held.isEmpty { announcer.say(batch: held) }
        turnCameToMe()
    }

    /// Say what is asked of you, and put VoiceOver on the first card you can
    /// play — or, while picking or burying, on the first card of the hand so
    /// it can be read before deciding.
    private func turnCameToMe() {
        switch state.phase {
        case .play where isMyTurn:
            announcer.say(status)
            if settings.autofocus {
                let legal = SheepheadGame.legalPlays(state, seat: Self.me)
                let first = SheepheadCards.sortHand(me.hand).first { legal.contains($0) } ?? me.hand.first
                focus(first?.id)
            }
        case .pick where isMyTurn:
            announcer.say(status)
            if settings.autofocus { focus(me.hand.first?.id) }
        case .bury where isPicker:
            announcer.say(status)
            if settings.autofocus { focus(me.hand.first?.id) }
        case .handOver:
            if revealedHand != state.handNumber {
                revealedHand = state.handNumber
                announcer.say(blindReveal)
            }
        default:
            break
        }
    }

    private func focus(_ id: String?) {
        guard let id else { return }
        focusCard = id
        focusTick += 1
    }
}

/// The rule options sheephead remembers between games.
struct SheepheadRulesOptions: Codable, Hashable {
    /// Three to six.
    var players: Int = 5
    var allPass: SheepheadConfig.AllPass = .leaster
    var blackQueenDoubler: Bool = false
    var redQueenDoubler: Bool = false
    var redealDoubler: Bool = false
}

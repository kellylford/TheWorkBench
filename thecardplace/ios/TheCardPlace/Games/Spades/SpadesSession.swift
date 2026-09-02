import SwiftUI
import CardCore
import SpadesEngine

/// One game of spades, from the person's chair. Owns the engine state, runs
/// the computer players at the chosen pace, and turns every event into an
/// announcement and a log line.
///
/// The person sits at seat 0 with seat 2 as their partner, against seats 1
/// and 3. Bidding goes once round the table; then thirteen tricks; then the
/// hand is scored by partnership.
@MainActor
@Observable
final class SpadesSession {
    static let me = 0

    /// The accessibility focus id for the bid stepper — not a card, but the
    /// thing the person needs when it is their turn to bid.
    static let bidFocus = "bid"

    private(set) var state: SpadesState
    private var rng = RandomSource()
    let announcer = Announcer()
    let gate = PaceGate()
    private let settings: AppSettings

    /// Newest first.
    private(set) var log: [LogEntry] = []
    private var lastEventId = 0

    /// The number on the bid stepper. Nil is a separate button, so this is
    /// never zero.
    var bidValue: Int = 3

    /// The card (or the bid stepper) VoiceOver should move to, and a counter
    /// so the same one can be asked for twice.
    private(set) var focusCard: String?
    private(set) var focusTick = 0

    private var botTask: Task<Void, Never>?

    init(settings: AppSettings) {
        self.settings = settings
        let rules = settings.rules(for: .spades, default: SpadesRulesOptions())
        let config = SpadesConfig(names: settings.names(seats: SpadesGame.seats),
                                  difficulty: settings.difficulty,
                                  pointsToWin: rules.pointsToWin)
        state = SpadesGame.createGame(config)
        apply(.start)
        // Bidding starts to the dealer's left, and the dealer is drawn; the
        // first to bid is as likely as not a computer.
        runBots()
    }

    // MARK: - what the screen shows

    var status: String { SpadesReview.status(state, seat: Self.me) }
    var me: SpadesPlayer { state.players[Self.me] }
    var partner: SpadesPlayer { state.players[SpadesGame.partnerOf(Self.me)] }
    var isMyTurn: Bool { SpadesGame.seatToAct(state) == Self.me }
    var pace: Pace { settings.pace(for: .spades) }

    /// The bids the stepper offers: everything legal except nil, which has
    /// its own button. Empty when it is not our turn to bid.
    var bidRange: ClosedRange<Int> {
        let legal = SpadesGame.legalBids(state, seat: Self.me).filter { $0 > 0 }
        guard let lo = legal.min(), let hi = legal.max() else { return 1...SpadesGame.handSize }
        return lo...hi
    }

    var handItems: [HandCardItem] {
        let hand = me.hand
        switch state.phase {
        case .play where isMyTurn:
            let legal = SpadesGame.legalPlays(state, seat: Self.me)
            return hand.map { c in
                let ok = legal.contains(c)
                return HandCardItem(card: c, description: SpadesCards.describe(c),
                                    badge: badge(c),
                                    playable: ok,
                                    reason: ok ? nil : SpadesGame.whyNot(state, seat: Self.me, card: c))
            }
        default:
            // Bidding included: the whole hand is readable while you decide,
            // and nothing is marked unavailable.
            return hand.map { HandCardItem(card: $0, description: SpadesCards.describe($0), badge: badge($0)) }
        }
    }

    private func badge(_ c: Card) -> String? {
        let r = SpadesCards.role(c)
        return r.isEmpty ? nil : r
    }

    var handHint: String {
        switch state.phase {
        case .play: return isMyTurn ? "Plays this card" : ""
        default: return ""
        }
    }

    var trickPlays: [PlayedCard] {
        guard !state.trick.isEmpty, let winning = SpadesGame.trickWinner(state.trick) else { return [] }
        return state.trick.enumerated().map { i, p in
            var note: String? = nil
            if p.seat == winning.seat { note = "winning so far" }
            if i == 0 { note = note.map { "led, " + $0 } ?? "led" }
            return PlayedCard(id: "\(p.seat)-\(p.card.id)", player: name(p.seat), card: p.card,
                              description: SpadesCards.describe(p.card), note: note)
        }
    }

    var lastTrickPlays: [PlayedCard] {
        guard let lt = state.lastTrick else { return [] }
        return lt.cards.map { p in
            PlayedCard(id: "last-\(p.seat)-\(p.card.id)", player: name(p.seat), card: p.card,
                       description: SpadesCards.describe(p.card),
                       note: p.seat == lt.winner ? "took the trick" : nil)
        }
    }

    /// One row per partnership: the score, the bags, and this hand's contract
    /// and tricks. Your own side first.
    var sideRows: [[String]] {
        (0..<SpadesGame.teams).map { t in
            let bid = state.players.filter { $0.team == t }.allSatisfy { $0.bid == nil }
                ? "not yet" : "\(SpadesGame.contractOf(state, team: t))"
            return [SpadesGame.teamName(state, t), "\(state.scores[t])", "\(state.bags[t])",
                    bid, "\(SpadesGame.tricksOf(state, team: t))"]
        }
    }

    var playerRows: [[String]] {
        state.players.map { p in
            [p.name + (p.index == Self.me ? " (you)" : ""), bidWord(p.bid), "\(p.tricks)"]
        }
    }

    var historyColumns: [String] { ["Hand", "Dealer", SpadesGame.teamName(state, 0), SpadesGame.teamName(state, 1)] }
    var historyRows: [[String]] {
        state.history.map { h in
            ["\(h.deal)", name(h.dealer)] + (0..<SpadesGame.teams).map { t in
                "\(signed(h.delta[t])), score \(h.scores[t]), \(Prose.count(h.bags[t], "bag"))"
            }
        }
    }

    /// What the hand just played was worth, side by side, for the hand-over
    /// text. Your own side first.
    var handResult: String {
        guard let h = state.history.last else { return "" }
        return "\(SpadesGame.teamName(state, 0)) \(signed(h.delta[0])), \(SpadesGame.teamName(state, 1)) \(signed(h.delta[1]))."
    }

    var reviews: [ReviewItem] {
        [
            ReviewItem("Hand", key: "h") { [unowned self] in SpadesReview.hand(state, seat: Self.me) },
            ReviewItem("Trick", key: "t") { [unowned self] in SpadesReview.trick(state) },
            ReviewItem("Last trick", key: "l") { [unowned self] in SpadesReview.lastTrick(state) },
            ReviewItem("Scores", key: "s") { [unowned self] in SpadesReview.scores(state) },
            ReviewItem("Contract", key: "b") { [unowned self] in SpadesReview.contract(state, seat: Self.me) },
            ReviewItem("Cards played", key: "c") { [unowned self] in SpadesReview.cardsPlayed(state, seat: Self.me) },
            ReviewItem("Play order", key: "o") { [unowned self] in SpadesReview.playOrder(state) },
            ReviewItem("Who is here", key: "w") { [unowned self] in SpadesReview.whoIsHere(state, seat: Self.me) },
            ReviewItem("Status") { [unowned self] in status }
        ]
    }

    func name(_ seat: Int) -> String { state.players[seat].name }

    /// "nil" for a nil bid, the number otherwise, and a dash for nobody yet.
    func bidWord(_ bid: Int?) -> String {
        guard let bid else { return "not yet" }
        return bid == 0 ? "nil" : "\(bid)"
    }

    private func signed(_ n: Int) -> String { n >= 0 ? "+\(n)" : "\(n)" }

    // MARK: - what the person does

    func tap(_ item: HandCardItem) {
        switch state.phase {
        case .bidding:
            announcer.error("Bid first.")
        case .play:
            guard isMyTurn else {
                announcer.error("Not your turn. Waiting for \(name(state.turn)).")
                return
            }
            if let why = SpadesGame.whyNot(state, seat: Self.me, card: item.card) {
                announcer.error("\(item.card.name) cannot be played: \(why).")
                return
            }
            apply(.play(item.card))
            runBots()
        default:
            break
        }
    }

    /// The number on the stepper.
    func bid() {
        bid(bidValue)
    }

    func bidNil() {
        bid(0)
    }

    private func bid(_ n: Int) {
        guard state.phase == .bidding else {
            announcer.error("Nobody is bidding.")
            return
        }
        guard isMyTurn else {
            announcer.error("Not your turn. Waiting for \(name(state.turn)) to bid.")
            return
        }
        if apply(.bid(n)) { runBots() }
    }

    func nextHand() {
        guard SpadesGame.canDeal(state) else { return }
        apply(.nextHand)
        runBots()
    }

    func newGame() {
        botTask?.cancel()
        gate.cancel()
        apply(.newGame)
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
    private func apply(_ action: SpadesAction, seat: Int = SpadesSession.me, speak: Bool = true) -> Bool {
        let r = SpadesGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        if !r.ok {
            announcer.error(r.reason.map { $0.prefix(1).uppercased() + $0.dropFirst() + "." } ?? "That was refused.")
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
        log.insert(contentsOf: fresh.reversed().map { LogEntry(id: $0.id, text: $0.text) }, at: 0)
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
              let seat = SpadesGame.seatToAct(state),
              state.players[seat].occupant == .bot {
            // The pause is between plays. A bid is one short sentence and
            // goes straight into the announcement queue.
            if state.phase == .play {
                await gate.wait(pace)
                if Task.isCancelled { return }
            }
            guard let action = SpadesAI.decide(state, seat: seat, rng: &rng) else { break }
            let r = SpadesGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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

    /// Say it is your turn, and put VoiceOver where the decision is: on the
    /// bid stepper while bidding, on the first card you can play otherwise.
    private func turnCameToMe() {
        guard isMyTurn else { return }
        switch state.phase {
        case .bidding:
            bidValue = min(max(bidValue, bidRange.lowerBound), bidRange.upperBound)
            announcer.say(status)
            if settings.autofocus { focus(Self.bidFocus) }
        case .play:
            announcer.say(status)
            if settings.autofocus {
                let legal = SpadesGame.legalPlays(state, seat: Self.me)
                let first = SpadesCards.sortHand(me.hand).first { legal.contains($0) } ?? me.hand.first
                focus(first?.id)
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

/// The rule options spades remembers between games. The web settings dialog
/// offers only the target score; bags and nil stay at the table's defaults.
struct SpadesRulesOptions: Codable, Hashable {
    var pointsToWin: Int = 500
}

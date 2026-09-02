import SwiftUI
import CardCore
import HeartsEngine

/// One game of hearts, from the person's chair. Owns the engine state, runs
/// the computer players at the chosen pace, and turns every event into an
/// announcement and a log line.
@MainActor
@Observable
final class HeartsSession {
    static let me = 0

    private(set) var state: HeartsState
    private var rng = RandomSource()
    let announcer = Announcer()
    let gate = PaceGate()
    private let settings: AppSettings

    /// Newest first. Ids are the session's own count rather than the engine's,
    /// because a new game restarts the engine's log at one and the list would
    /// otherwise hold two entries with the same id.
    private(set) var log: [LogEntry] = []
    private var lastEventId = 0
    private var logSerial = 0

    /// Cards chosen to pass, in the order chosen.
    private(set) var selected: [Card] = []

    /// The card VoiceOver should move to, and a counter so the same card can
    /// be asked for twice.
    private(set) var focusCard: String?
    private(set) var focusTick = 0

    private var botTask: Task<Void, Never>?

    init(settings: AppSettings) {
        self.settings = settings
        let rules = settings.rules(for: .hearts, default: HeartsRulesOptions())
        let config = HeartsConfig(names: settings.names(seats: HeartsGame.seats),
                                  difficulty: settings.difficulty,
                                  pointsToWin: rules.pointsToWin)
        state = HeartsGame.createGame(config)
        apply(.start)
    }

    // MARK: - what the screen shows

    var status: String { HeartsReview.status(state, seat: Self.me) }
    var me: HeartsPlayer { state.players[Self.me] }
    var isMyTurn: Bool { HeartsGame.seatToAct(state) == Self.me }
    var pace: Pace { settings.pace(for: .hearts) }

    var handItems: [HandCardItem] {
        let hand = me.hand
        switch state.phase {
        case .passing:
            let passed = state.passing[Self.me] != nil
            return hand.map { c in
                HandCardItem(card: c, description: HeartsCards.describe(c),
                             playable: !passed,
                             reason: passed ? "you have already passed" : nil,
                             selected: selected.contains(c))
            }
        case .play where isMyTurn:
            let legal = HeartsGame.legalPlays(state, seat: Self.me)
            return hand.map { c in
                let ok = legal.contains(c)
                return HandCardItem(card: c, description: HeartsCards.describe(c),
                                    playable: ok,
                                    reason: ok ? nil : HeartsGame.whyNot(state, seat: Self.me, card: c))
            }
        default:
            return hand.map { HandCardItem(card: $0, description: HeartsCards.describe($0)) }
        }
    }

    var handHint: String {
        switch state.phase {
        case .passing: return "Selects this card to pass"
        case .play: return isMyTurn ? "Plays this card" : ""
        default: return ""
        }
    }

    var trickPlays: [PlayedCard] {
        guard !state.trick.isEmpty else { return [] }
        var winning = state.trick[0]
        for p in state.trick.dropFirst() where HeartsCards.beats(p.card, winning.card) { winning = p }
        return state.trick.enumerated().map { i, p in
            var note: String? = nil
            if p.seat == winning.seat { note = "winning so far" }
            if i == 0 { note = note.map { "led, " + $0 } ?? "led" }
            return PlayedCard(id: "\(p.seat)-\(p.card.id)", player: name(p.seat), card: p.card,
                              description: HeartsCards.describe(p.card), note: note)
        }
    }

    var lastTrickPlays: [PlayedCard] {
        guard let lt = state.lastTrick else { return [] }
        return lt.cards.map { p in
            PlayedCard(id: "last-\(p.seat)-\(p.card.id)", player: name(p.seat), card: p.card,
                       description: HeartsCards.describe(p.card),
                       note: p.seat == lt.winner ? "took the trick" + HeartsGame.pointsTail(lt.points) : nil)
        }
    }

    var playerRows: [[String]] {
        state.players.map { p in
            [p.name + (p.index == Self.me ? " (you)" : ""), "\(p.score)", "\(p.takenPoints)", "\(p.taken.count / HeartsGame.seats)"]
        }
    }

    var historyColumns: [String] { ["Hand", "Pass"] + state.players.map(\.name) }
    var historyRows: [[String]] {
        state.history.map { h in
            ["\(h.deal)", h.passDirection.rawValue] + h.points.enumerated().map { i, pts in
                h.shooter == i ? "\(pts), shot the moon" : "\(pts)"
            }
        }
    }

    var reviews: [ReviewItem] {
        [
            ReviewItem("Hand", key: "h") { [unowned self] in HeartsReview.hand(state, seat: Self.me) },
            ReviewItem("Trick", key: "t") { [unowned self] in HeartsReview.trick(state, seat: Self.me) },
            ReviewItem("Last trick", key: "l") { [unowned self] in HeartsReview.lastTrick(state, seat: Self.me) },
            ReviewItem("Scores", key: "s") { [unowned self] in HeartsReview.scores(state, seat: Self.me) },
            ReviewItem("Points so far", key: "p") { [unowned self] in HeartsReview.pointsSoFar(state, seat: Self.me) },
            ReviewItem("Cards played", key: "c") { [unowned self] in HeartsReview.cardsPlayed(state, seat: Self.me) },
            ReviewItem("Play order", key: "o") { [unowned self] in HeartsReview.playOrder(state, seat: Self.me) },
            ReviewItem("Who is here", key: "w") { [unowned self] in HeartsReview.who(state, seat: Self.me) },
            ReviewItem("Status") { [unowned self] in status }
        ]
    }

    func name(_ seat: Int) -> String { state.players[seat].name }

    // MARK: - what the person does

    func tap(_ item: HandCardItem) {
        switch state.phase {
        case .passing:
            guard state.passing[Self.me] == nil else {
                announcer.error("You have already passed. Waiting for the others.")
                return
            }
            if let i = selected.firstIndex(of: item.card) {
                selected.remove(at: i)
                announcer.request("\(item.card.name) removed. \(selectionSummary)")
            } else if selected.count >= HeartsGame.passCount {
                announcer.error("Three cards are already chosen: \(selected.spokenList). Remove one first.")
            } else {
                selected.append(item.card)
                announcer.request("\(item.card.name) chosen. \(selectionSummary)")
            }
        case .play:
            guard isMyTurn else {
                announcer.error("Not your turn. Waiting for \(name(state.turn)).")
                return
            }
            if let why = HeartsGame.whyNot(state, seat: Self.me, card: item.card) {
                announcer.error("\(item.card.name) cannot be played: \(why).")
                return
            }
            apply(.play(item.card))
            runBots()
        default:
            break
        }
    }

    var selectionSummary: String {
        let n = selected.count
        if n == 0 { return "No cards chosen yet." }
        return "\(Prose.number(n)) of three chosen" + (n == HeartsGame.passCount ? ". Choose Pass to send them." : ".")
    }

    func passSelected() {
        guard selected.count == HeartsGame.passCount else {
            announcer.error("Choose exactly three cards to pass. \(selectionSummary)")
            return
        }
        let cards = selected
        selected = []
        apply(.pass(cards))
        runBots()
    }

    func nextHand() {
        guard HeartsGame.canDeal(state) else { return }
        apply(.nextHand)
        runBots()
    }

    func newGame() {
        botTask?.cancel()
        gate.cancel()
        selected = []
        // The engine rebuilds its state, and its log starts again at one.
        lastEventId = 0
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
    private func apply(_ action: HeartsAction, seat: Int = HeartsSession.me, speak: Bool = true) -> Bool {
        let r = HeartsGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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
        for e in fresh {
            logSerial += 1
            log.insert(LogEntry(id: logSerial, text: e.text), at: 0)
        }
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
              let seat = HeartsGame.seatToAct(state),
              state.players[seat].occupant == .bot {
            if state.phase == .play {
                await gate.wait(pace)
                if Task.isCancelled { return }
            }
            guard let action = HeartsAI.decide(state, seat: seat, rng: &rng) else { break }
            let r = HeartsGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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

    /// Say it is your turn, and put VoiceOver on the first card you can play.
    private func turnCameToMe() {
        guard state.phase == .play, isMyTurn else {
            if state.phase == .passing, state.passing[Self.me] == nil, settings.autofocus {
                focus(me.hand.first?.id)
            }
            return
        }
        announcer.say(status)
        if settings.autofocus {
            let legal = HeartsGame.legalPlays(state, seat: Self.me)
            let first = HeartsCards.sortHand(me.hand).first { legal.contains($0) } ?? me.hand.first
            focus(first?.id)
        }
    }

    private func focus(_ id: String?) {
        guard let id else { return }
        focusCard = id
        focusTick += 1
    }
}

/// The rule options hearts remembers between games.
struct HeartsRulesOptions: Codable, Hashable {
    var pointsToWin: Int = 100
}

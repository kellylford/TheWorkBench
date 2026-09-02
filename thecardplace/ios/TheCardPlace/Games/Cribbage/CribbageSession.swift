import SwiftUI
import CardCore
import CribbageEngine

/// One game of cribbage, from the person's chair. Owns the engine state, runs
/// the computer player at the chosen pace, and turns every event into an
/// announcement and a log line.
///
/// Cribbage is arithmetic performed out loud, so during the play every card
/// in the hand carries the engine's label — what it is worth, what count it
/// makes, and what it scores — rather than just its name.
@MainActor
@Observable
final class CribbageSession {
    static let me = 0

    private(set) var state: CribbageState
    private var rng = RandomSource()
    let announcer = Announcer()
    let gate = PaceGate()
    private let settings: AppSettings

    /// Newest first.
    private(set) var log: [LogEntry] = []
    private var lastEventId = 0
    /// Added to event ids after a mid-game restart, so the kept log and the
    /// fresh engine log never share an id.
    private var logOffset = 0

    /// Cards chosen to throw to the crib, in the order chosen.
    private(set) var selected: [Card] = []

    /// The card VoiceOver should move to, and a counter so the same card can
    /// be asked for twice.
    private(set) var focusCard: String?
    private(set) var focusTick = 0

    private var botTask: Task<Void, Never>?

    init(settings: AppSettings) {
        self.settings = settings
        let rules = settings.rules(for: .cribbage, default: CribbageRulesOptions())
        let config = CribbageConfig(names: settings.names(seats: CribbageGame.seats),
                                    difficulty: settings.difficulty,
                                    targetScore: rules.targetScore)
        state = CribbageGame.createGame(config)
        apply(.start)
    }

    // MARK: - what the screen shows

    var status: String { CribbageReview.status(state, seat: Self.me) }
    var me: CribbagePlayer { state.players[Self.me] }
    var opponent: CribbagePlayer { state.players[CribbageGame.other(Self.me)] }
    var isMyTurn: Bool { CribbageGame.seatToAct(state) == Self.me }
    var pace: Pace { settings.pace(for: .cribbage) }
    var target: Int { state.config.targetScore }
    var hasThrown: Bool { state.hasDiscarded(Self.me) }
    var legalPlays: [Card] { CribbageGame.legalPlays(state, seat: Self.me) }
    var mustSayGo: Bool { state.phase == .play && isMyTurn && legalPlays.isEmpty }

    /// "your crib" / "Ruth's crib".
    var cribOwner: String {
        guard let d = state.dealer else { return "nobody's crib" }
        return d == Self.me ? "your crib" : "\(name(d))’s crib"
    }

    var handItems: [HandCardItem] {
        let hand = CribbageCards.sortHand(me.hand)
        switch state.phase {
        case .discard:
            if hasThrown {
                return hand.map { c in
                    HandCardItem(card: c, description: CribbageCards.describe(c),
                                 playable: false, reason: "your throw is already in")
                }
            }
            return hand.map { c in
                HandCardItem(card: c, description: CribbageCards.describe(c),
                             playable: true, selected: selected.contains(c))
            }
        case .play:
            // The engine's label says everything: worth, makes, scores, or why
            // it cannot be played. Verbatim, with nothing added but the position.
            let legal = legalPlays
            return hand.map { c in
                HandCardItem(card: c, description: CribbageReview.cardLabel(state, seat: Self.me, card: c),
                             playable: isMyTurn && legal.contains(c))
            }
        default:
            return hand.map { c in
                HandCardItem(card: c, description: CribbageCards.describe(c),
                             playable: false, reason: CribbageReview.idleReason(state, seat: Self.me))
            }
        }
    }

    var handHint: String {
        switch state.phase {
        case .discard: return hasThrown ? "" : "Chooses this card to throw to the crib"
        case .play: return isMyTurn ? "Plays this card" : ""
        default: return ""
        }
    }

    /// The cards down since the count last went back to nothing.
    var runPlays: [PlayedCard] {
        let seq = state.pile.count > state.runStart ? Array(state.pile[state.runStart...]) : []
        return seq.enumerated().map { i, p in
            var note: String? = nil
            if i == 0 { note = "led" }
            if state.lastPlayer == p.player, i == seq.count - 1, seq.count > 1 { note = "last card down" }
            return PlayedCard(id: "\(state.runStart + i)-\(p.card.id)", player: name(p.player), card: p.card,
                              description: CribbageCards.describe(p.card), note: note)
        }
    }

    var playEmptyText: String {
        if state.phase != .play && state.pile.isEmpty { return "The play has not started yet." }
        if state.pile.isEmpty { return "Nothing played yet. \(nameFor(state.turn, cap: true)) to lead." }
        return "Nothing down since the count reset."
    }

    var countText: String { "The count is \(state.count)." }

    var starterText: String {
        state.starter.map { "The starter is the \(CribbageCards.describe($0))." } ?? "The starter has not been turned yet."
    }

    /// The crib is face down until the engine counts it, and that includes
    /// the dealer whose crib it is.
    var cribRevealed: Bool {
        !state.crib.isEmpty && (state.countStage >= 3 || state.phase == .roundOver || state.phase == .gameOver)
    }

    var cribText: String {
        guard state.dealer != nil else { return "Nobody has dealt yet; the lower cut takes the first crib." }
        if cribRevealed {
            return "\(cap(cribOwner)): " + CribbageCards.listNames(CribbageCards.sortHand(state.crib)) + "."
        }
        let n = state.crib.count
        switch n {
        case 0:
            let thrown = state.seatsOutstanding.count == 1 ? " One player has thrown two cards to it." : ""
            return "\(cap(cribOwner)). Nothing in it yet.\(thrown)"
        default:
            return "\(cap(cribOwner)), \(Prose.number(n)) cards in it, face down until it is counted."
        }
    }

    var scoreRows: [[String]] {
        state.players.map { p in
            [p.name + (p.index == Self.me ? " (you)" : ""), "\(p.score)", "\(max(0, target - p.score))"]
        }
    }

    var gamesWonText: String? {
        guard state.gamesWon.contains(where: { $0 > 0 }) else { return nil }
        return "Games won: " + state.players.map { "\($0.name) \(state.gamesWon[$0.index])" }.joined(separator: ", ") + "."
    }

    var lastCountText: String? {
        let t = CribbageReview.lastCount(state, seat: Self.me)
        return t == "Nothing has been counted yet." ? nil : t
    }

    var historyColumns: [String] { ["Hand", "Dealer"] + state.players.map(\.name) }
    var historyRows: [[String]] {
        state.history.filter { $0.gameNumber == state.gameNumber }.map { h in
            ["\(h.handNumber)", name(h.dealer)] + h.scores.map { "\($0)" }
        }
    }

    // MARK: the count, stage by stage

    /// What the next press of Next will count: whose cards, and the cards
    /// themselves when they are face up. The crib is face down until it is
    /// turned.
    var countStageTitle: String {
        guard let dealer = state.dealer else { return "" }
        switch state.countStage {
        case 0: return "\(cap(poss(CribbageGame.other(dealer)))) hand"
        case 1: return "\(cap(poss(dealer))) hand"
        case 2: return "\(cap(poss(dealer))) crib"
        default: return "The count is done"
        }
    }

    var countStageCards: [Card] {
        guard let dealer = state.dealer else { return [] }
        switch state.countStage {
        case 0: return CribbageCards.sortHand(state.players[CribbageGame.other(dealer)].kept)
        case 1: return CribbageCards.sortHand(state.players[dealer].kept)
        default: return []
        }
    }

    var countStageText: String {
        guard state.dealer != nil else { return "" }
        let starter = state.starter.map { " with the \(CribbageCards.describe($0))" } ?? ""
        switch state.countStage {
        case 0, 1:
            return "\(countStageTitle): " + CribbageCards.listNames(countStageCards) + starter + "."
        case 2:
            return "\(countStageTitle), four cards face down\(starter). Next turns it over."
        default:
            return "Every hand has been counted."
        }
    }

    /// Each count so far this hand, as it was read out.
    var countBreakdowns: [String] {
        state.countResults.map { c in
            "\(cap(poss(c.who))) \(c.kind.rawValue): \(cap(c.result.spoken))."
        }
    }

    var reviews: [ReviewItem] {
        [
            ReviewItem("Hand", key: "h") { [unowned self] in CribbageReview.hand(state, seat: Self.me) },
            ReviewItem("The play", key: "t") { [unowned self] in CribbageReview.play(state, seat: Self.me) },
            ReviewItem("Last count", key: "l") { [unowned self] in CribbageReview.lastCount(state, seat: Self.me) },
            ReviewItem("Scores", key: "s") { [unowned self] in CribbageReview.scores(state, seat: Self.me) },
            ReviewItem("Dealer and crib", key: "p") { [unowned self] in CribbageReview.dealerAndCrib(state, seat: Self.me) },
            ReviewItem("Counting aid", key: "c") { [unowned self] in CribbageReview.countingAid(state, seat: Self.me) },
            ReviewItem("Play order", key: "o") { [unowned self] in CribbageReview.playOrder(state, seat: Self.me) },
            ReviewItem("Status") { [unowned self] in status }
        ]
    }

    func name(_ seat: Int) -> String { state.players[seat].name }

    /// "you" / "Ruth", capitalised when it starts a sentence.
    func nameFor(_ seat: Int, cap capitalise: Bool = false) -> String {
        let n = seat == Self.me ? "you" : name(seat)
        return capitalise ? cap(n) : n
    }

    /// "your" / "Ruth’s".
    private func poss(_ seat: Int) -> String {
        seat == Self.me ? "your" : "\(name(seat))’s"
    }

    private func cap(_ s: String) -> String {
        guard let f = s.first else { return s }
        return f.uppercased() + s.dropFirst()
    }

    // MARK: - what the person does

    func tap(_ item: HandCardItem) {
        switch state.phase {
        case .discard:
            guard !hasThrown else {
                announcer.error("Your two are already in the crib. Waiting for \(opponent.name).")
                return
            }
            if let i = selected.firstIndex(of: item.card) {
                selected.remove(at: i)
                announcer.request("\(item.card.name) removed. \(selectionSummary)")
            } else if selected.count >= 2 {
                announcer.error("Two cards are already chosen: \(selected.spokenList). Remove one first.")
            } else {
                selected.append(item.card)
                announcer.request("\(item.card.name) chosen. \(selectionSummary)")
            }
        case .play:
            guard isMyTurn else {
                announcer.error("Not your turn. Waiting for \(name(state.turn)).")
                return
            }
            if let why = CribbageGame.whyNot(state, seat: Self.me, card: item.card) {
                announcer.error("\(item.card.name) cannot be played: \(why).")
                return
            }
            apply(.play(item.card))
            runBots()
        default:
            announcer.error("\(item.card.name) is \(CribbageReview.idleReason(state, seat: Self.me)).")
        }
    }

    var selectionSummary: String {
        let n = selected.count
        if n == 0 { return "No cards chosen yet." }
        return "\(cap(Prose.number(n))) of two chosen" + (n == 2 ? ". Choose Throw to send them to the crib." : ".")
    }

    func cut() {
        guard state.phase == .cutForDeal else { return }
        apply(.cut)
        runBots()
    }

    func throwSelected() {
        guard selected.count == 2 else {
            announcer.error("Choose exactly two cards to throw. \(selectionSummary)")
            return
        }
        let cards = selected
        selected = []
        apply(.discard(cards))
        runBots()
    }

    func sayGo() {
        guard state.phase == .play, isMyTurn else { return }
        apply(.go)
        runBots()
    }

    func next() {
        guard state.phase == .count, isMyTurn else { return }
        apply(.next)
        runBots()
    }

    func nextHand() {
        guard CribbageGame.canDeal(state) else { return }
        selected = []
        apply(.nextHand)
        runBots()
    }

    /// From the game-over button or the More menu. The engine only accepts
    /// newGame once a game is over; a game abandoned part way is rebuilt with
    /// the same names, rules and games won.
    func newGame() {
        botTask?.cancel()
        gate.cancel()
        selected = []
        if state.phase == .gameOver {
            apply(.newGame)
        } else {
            var fresh = CribbageGame.createGame(state.config)
            fresh.gamesWon = state.gamesWon
            fresh.gameNumber = state.gameNumber
            logOffset = log.first?.id ?? 0
            lastEventId = 0
            state = fresh
        }
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
    private func apply(_ action: CribbageAction, seat: Int = CribbageSession.me, speak: Bool = true) -> Bool {
        let r = CribbageGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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
        log.insert(contentsOf: fresh.reversed().map { LogEntry(id: $0.id + logOffset, text: $0.text) }, at: 0)
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
              let seat = CribbageGame.seatToAct(state),
              state.players[seat].occupant == .bot {
            // A pause before a play, a go, or a step of the count; the throw
            // to the crib and the cut happen at once, as they would at a table.
            if state.phase == .play || state.phase == .count {
                await gate.wait(pace)
                if Task.isCancelled { return }
            }
            guard let action = CribbageAI.decide(state, seat: seat, rng: &rng) else { break }
            let r = CribbageGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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
        switch state.phase {
        case .play where isMyTurn:
            var words = status
            if legalPlays.isEmpty { words += " " + CribbageReview.prompt(state, seat: Self.me) }
            announcer.say(words)
            if settings.autofocus {
                let legal = legalPlays
                let first = CribbageCards.sortHand(me.hand).first { legal.contains($0) } ?? CribbageCards.sortHand(me.hand).first
                focus(first?.id)
            }
        case .discard where !hasThrown:
            if settings.autofocus { focus(CribbageCards.sortHand(me.hand).first?.id) }
        case .count where isMyTurn:
            announcer.say(status)
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

/// The rule options cribbage remembers between games.
struct CribbageRulesOptions: Codable, Hashable {
    /// 121 is the standard game; 61 is once round the board.
    var targetScore: Int = 121
}

import SwiftUI
import CardCore
import EuchreEngine

/// One game of euchre, from the person's chair. Owns the engine state, runs
/// the computer players at the chosen pace, and turns every event into an
/// announcement and a log line.
///
/// Two things are euchre's own. Trump is unknown for the whole of the
/// bidding, so the hand is described plainly then and with its bowers once a
/// suit is made — and in round one every card says what it WOULD be if the
/// upcard's suit were ordered, which is the question the bid turns on. And
/// while somebody plays alone the person may be sitting out, in which case the
/// whole hand is played by the others and the session only watches.
@MainActor
@Observable
final class EuchreSession {
    static let me = 0

    private(set) var state: EuchreState
    private var rng = RandomSource()
    let announcer = Announcer()
    let gate = PaceGate()
    private let settings: AppSettings

    /// Newest first.
    private(set) var log: [LogEntry] = []
    private var lastEventId = 0
    private var logSerial = 0

    /// The "Go alone" switch in the naming round. Applied to the next call.
    var goAlone = false

    /// The card VoiceOver should move to, and a counter so the same card can
    /// be asked for twice.
    private(set) var focusCard: String?
    private(set) var focusTick = 0

    /// The last hand whose face-down cards were read out.
    private var revealedHand = 0

    private var botTask: Task<Void, Never>?

    init(settings: AppSettings) {
        self.settings = settings
        state = EuchreGame.createGame(Self.config(from: settings))
        apply(.start)
        runBots()
    }

    private static func config(from settings: AppSettings) -> EuchreConfig {
        let rules = settings.rules(for: .euchre, default: EuchreRulesOptions())
        return EuchreConfig(names: settings.names(seats: EuchreGame.seats),
                            difficulty: settings.difficulty,
                            pointsToWin: rules.pointsToWin,
                            stickTheDealer: rules.stickTheDealer,
                            allowAlone: rules.allowAlone)
    }

    // MARK: - what the screen shows

    var status: String { EuchreReview.status(state, seat: Self.me) }
    var me: EuchrePlayer { state.players[Self.me] }
    var isMyTurn: Bool { EuchreGame.seatToAct(state) == Self.me }
    var isDealer: Bool { state.dealer == Self.me }
    var isSittingOut: Bool { state.sittingOut == Self.me }
    var pace: Pace { settings.pace(for: .euchre) }
    var allowAlone: Bool { state.config.allowAlone }
    var stickTheDealer: Bool { state.config.stickTheDealer }

    /// Stick the dealer, and it has come round to us: Pass is refused.
    var mustCall: Bool { state.phase == .bid2 && isDealer && stickTheDealer }

    /// The suits that may be named in round two: anything but the turned-down one.
    var callableSuits: [Suit] { EuchreCards.suits.filter { $0 != state.deniedSuit } }

    /// Who the table is waiting for, or nobody.
    var waitingFor: String? { EuchreGame.seatToAct(state).map(name) }

    var partnerName: String { name(EuchreGame.partnerOf(Self.me)) }
    var makerName: String { state.maker.map(name) ?? "the maker" }

    var playHint: String { EuchreReview.playHint(state, seat: Self.me) }
    var handResult: String { EuchreReview.handResult(state, seat: Self.me) }

    /// The hand, trump first once there is a trump, otherwise by suit — the
    /// order the engine reads it in. Every card is a button in every phase;
    /// only on our turn to play does a card say it cannot be played, and why.
    var handItems: [HandCardItem] {
        let trump = state.trump
        let hand = EuchreCards.sortHand(me.hand, trump: trump)
        return hand.map { c in
            var item = HandCardItem(card: c, description: EuchreCards.describe(c, trump: trump), badge: badge(c))
            switch state.phase {
            case .bid1:
                if let up = state.upcard { item.marked = prospect(c, trump: up.suit) }
            case .play where isSittingOut:
                item.marked = "out of play"
            case .play where isMyTurn:
                if let why = EuchreGame.whyNot(state, seat: Self.me, card: c) {
                    item.playable = false
                    item.reason = why
                }
            default:
                break
            }
            return item
        }
    }

    var handHint: String {
        switch state.phase {
        case .discard where isDealer: return "Puts this card back"
        case .play where isMyTurn: return "Plays this card"
        default: return ""
        }
    }

    /// "right bower", "left bower", "trump": the role with its explanation
    /// trimmed off, for the face of the card. The full role is in the label.
    private func badge(_ c: Card) -> String? {
        let role = EuchreCards.role(c, trump: state.trump)
        guard let short = role.split(separator: ",").first, !short.isEmpty else { return nil }
        return String(short)
    }

    /// What a card would be if the upcard's suit were trump.
    private func prospect(_ c: Card, trump: Suit) -> String? {
        switch EuchreCards.bower(c, trump: trump) {
        case .right: return "would be the right bower"
        case .left: return "would be the left bower"
        case nil: return EuchreCards.isTrump(c, trump: trump) ? "would be trump" : nil
        }
    }

    var trickPlays: [PlayedCard] {
        guard !state.trick.isEmpty else { return [] }
        let winning = EuchreGame.trickWinnerIndex(state.trick, trump: state.trump)
        return state.trick.enumerated().map { i, p in
            var note: String? = nil
            if i == winning { note = "winning so far" }
            if i == 0 { note = note.map { "led, " + $0 } ?? "led" }
            return PlayedCard(id: "\(p.player)-\(p.card.id)", player: name(p.player), card: p.card,
                              description: EuchreCards.describe(p.card, trump: state.trump), note: note)
        }
    }

    var lastTrickPlays: [PlayedCard] {
        guard let lt = state.lastTrick else { return [] }
        return lt.plays.map { p in
            PlayedCard(id: "last-\(p.player)-\(p.card.id)", player: name(p.player), card: p.card,
                       description: EuchreCards.describe(p.card, trump: state.trump),
                       note: p.player == lt.winner ? "took the trick" : nil)
        }
    }

    /// The face-down cards, once the hand is over: the upcard, what the
    /// dealer put back, and the kitty. Empty while a hand is in progress —
    /// nothing is shown that the engine has not said.
    var revealText: String? { EuchreReview.dealReveal(state) }

    var revealCards: [PlayedCard] {
        guard revealText != nil, let dealt = state.dealt else { return [] }
        let trump = state.trump
        var rows = [PlayedCard(id: "up-\(dealt.upcard.id)", player: "Upcard", card: dealt.upcard,
                               description: EuchreCards.describe(dealt.upcard, trump: trump),
                               note: state.upcardStatus == .turnedDown ? "turned down" : (state.discard != nil ? "taken by \(name(state.dealer ?? 0))" : nil))]
        if let d = state.discard {
            rows.append(PlayedCard(id: "down-\(d.id)", player: "Put back", card: d,
                                   description: EuchreCards.describe(d, trump: trump)))
        }
        rows += dealt.kitty.map {
            PlayedCard(id: "kitty-\($0.id)", player: "Kitty", card: $0, description: EuchreCards.describe($0, trump: trump))
        }
        return rows
    }

    // MARK: tables

    static let sideColumns = ["Side", "Score", "Tricks this hand", "Games won"]

    /// Scores belong to a side in euchre, so the table has two rows, not four.
    var sideRows: [[String]] {
        [0, 1].map { t in
            [sideName(t), "\(state.scores[t])", "\(sideTricks(t))", "\(state.gamesWon[t])"]
        }
    }

    static let playerColumns = ["Player", "Role", "Tricks"]

    var playerRows: [[String]] {
        state.players.map { p in
            let roles = EuchreReview.roleTags(state, p.index, seat: Self.me)
            return [p.name + (p.index == Self.me ? " (you)" : ""),
                    roles.isEmpty ? "none" : roles.joined(separator: ", "),
                    "\(p.tricksWon)"]
        }
    }

    static let historyColumns = ["Hand", "Dealer", "Trump", "Maker", "Result"]

    var historyRows: [[String]] {
        state.history.map { h in
            let maker = h.maker.map { name($0) + (h.alone ? ", alone" : "") } ?? "nobody"
            return ["\(h.handNumber)", name(h.dealer), h.trump?.name ?? "none", maker,
                    h.result.thrownIn ? "thrown in" : h.result.label]
        }
    }

    func sideName(_ team: Int) -> String {
        team == EuchreGame.teamOf(Self.me) ? "You and \(partnerName)" : EuchreGame.sideWords(state, team: team)
    }

    func sideTricks(_ team: Int) -> Int {
        state.players.filter { EuchreGame.teamOf($0.index) == team }.reduce(0) { $0 + $1.tricksWon }
    }

    var reviews: [ReviewItem] {
        [
            ReviewItem("Hand", key: "h") { [unowned self] in EuchreReview.hand(state, seat: Self.me) },
            ReviewItem("Trick", key: "t") { [unowned self] in EuchreReview.trick(state, seat: Self.me) },
            ReviewItem("Last trick", key: "l") { [unowned self] in EuchreReview.lastTrick(state, seat: Self.me) },
            ReviewItem("Scores", key: "s") { [unowned self] in EuchreReview.scores(state, seat: Self.me) },
            ReviewItem("Trump and partner", key: "p") { [unowned self] in EuchreReview.trumpAndPartner(state, seat: Self.me) },
            ReviewItem("Cards played", key: "c") { [unowned self] in EuchreReview.cardsPlayed(state, seat: Self.me) },
            ReviewItem("Play order", key: "o") { [unowned self] in EuchreReview.playOrder(state, seat: Self.me) },
            ReviewItem("Who is here", key: "w") { [unowned self] in EuchreReview.whoIsHere(state, seat: Self.me) },
            ReviewItem("Status") { [unowned self] in status }
        ]
    }

    func name(_ seat: Int) -> String { state.players[seat].name }

    // MARK: - what the person does

    func tap(_ item: HandCardItem) {
        switch state.phase {
        case .idle:
            announcer.error("No hand has been dealt yet.")
        case .bid1, .bid2:
            if isMyTurn {
                announcer.error("Bid first.")
            } else {
                announcer.error("Not your turn. Waiting for \(name(state.turn)).")
            }
        case .discard:
            guard isDealer else {
                announcer.error("Not your turn. Waiting for \(name(state.dealer ?? state.turn)) to put a card back.")
                return
            }
            if apply(.discard(item.card)) { runBots() }
        case .play:
            if isSittingOut {
                announcer.error("You are sitting out this hand while \(makerName) plays alone.")
                return
            }
            guard isMyTurn else {
                announcer.error("Not your turn. Waiting for \(name(state.turn)).")
                return
            }
            if let why = EuchreGame.illegalReason(state, seat: Self.me, card: item.card) {
                announcer.error("\(item.card.name) cannot be played: \(why).")
                return
            }
            if apply(.play(item.card)) { runBots() }
        case .handOver:
            announcer.error("The hand is over. Choose Deal the next hand.")
        case .gameOver:
            announcer.error("The game is over. Choose Start a new game.")
        }
    }

    /// Round one: take the upcard's suit. The dealer "picks it up".
    func orderUp(alone: Bool) {
        if apply(.orderUp(alone: alone && allowAlone)) { runBots() }
    }

    /// Round two: name a suit, alone if the switch is on.
    func callSuit(_ suit: Suit) {
        if apply(.callSuit(suit, alone: goAlone && allowAlone)) {
            goAlone = false
            runBots()
        }
    }

    func pass() {
        if apply(.pass) { runBots() }
    }

    func nextHand() {
        guard EuchreGame.canDeal(state) else { return }
        goAlone = false
        // The computer players' skill takes effect from the next hand.
        state.config.difficulty = settings.difficulty
        apply(.nextHand)
        runBots()
    }

    /// A fresh game with the rules as they are now set. The record of games
    /// won carries on; the scores do not.
    func newGame() {
        botTask?.cancel()
        gate.cancel()
        goAlone = false
        if state.phase == .gameOver {
            // The engine keeps the match: games won, and the dealer rotating on.
            state.config = Self.config(from: settings)
            lastEventId = 0
            apply(.newGame)
        } else {
            // Starting over mid-hand is the person's call; the engine only
            // takes newGame once a game is over, so the table is rebuilt.
            var fresh = EuchreGame.createGame(Self.config(from: settings))
            fresh.gamesWon = state.gamesWon
            fresh.gameNumber = state.gameNumber
            state = fresh
            lastEventId = 0
        }
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
    private func apply(_ action: EuchreAction, seat: Int = EuchreSession.me, speak: Bool = true) -> Bool {
        let r = EuchreGame.applyAction(&state, seat: seat, action: action, rng: &rng)
        if !r.ok {
            announcer.error(r.reason?.asSentence ?? "That was refused.")
            return false
        }
        if speak { drain(batch: false) }
        return true
    }

    /// New events — including the ones only this seat is told — into the
    /// log and, unless told to hold them, out loud.
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

    /// Bids, discards and plays for every computer seat until the table is
    /// waiting on the person or on nobody. The pace applies to plays only —
    /// a bid is a sentence, and the announcer already spaces sentences out.
    private func driveBots() async {
        var held: [String] = []
        // A run of plays is gathered into one message when there is no time
        // between them to say each, or when the player asked for that — but
        // never at Wait-for-me, where every press of Continue must say what
        // it did.
        let batching = pace == .immediate || (!settings.speakEveryPlay && pace != .waitForMe)
        while !Task.isCancelled,
              let seat = EuchreGame.seatToAct(state),
              state.players[seat].occupant == .bot {
            if state.phase == .play {
                await gate.wait(pace)
                if Task.isCancelled { return }
            }
            guard let action = EuchreAI.decide(state, seat: seat, rng: &rng) else { break }
            let r = EuchreGame.applyAction(&state, seat: seat, action: action, rng: &rng)
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

    /// Say what the table wants from us, and put VoiceOver on the first card
    /// we can act on. Between hands, read out what was face down.
    private func turnCameToMe() {
        switch state.phase {
        case .bid1, .bid2:
            guard isMyTurn else { return }
            announcer.say(EuchreReview.turnPrompt(state, seat: Self.me))
            if settings.autofocus { focus(handItems.first?.id) }
        case .discard:
            // The engine has already said "You took the upcard. Choose a card to put back."
            guard isDealer else { return }
            if settings.autofocus { focus(handItems.first?.id) }
        case .play:
            guard isMyTurn else { return }
            let hint = playHint
            announcer.say(EuchreReview.turnPrompt(state, seat: Self.me) + (hint.isEmpty ? "" : " " + hint))
            if settings.autofocus {
                let first = handItems.first { $0.playable } ?? handItems.first
                focus(first?.id)
            }
        case .handOver, .gameOver:
            if revealedHand != state.handNumber, let reveal = revealText {
                revealedHand = state.handNumber
                announcer.say(reveal)
            }
        case .idle:
            break
        }
    }

    private func focus(_ id: String?) {
        guard let id else { return }
        focusCard = id
        focusTick += 1
    }
}

/// The rule options euchre remembers between games.
struct EuchreRulesOptions: Codable, Hashable {
    var pointsToWin: Int = 10
    var stickTheDealer: Bool = false
    var allowAlone: Bool = true
}

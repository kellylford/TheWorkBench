/* Euchre - per-seat projection.
 *
 * The authoritative state holds every hand. This turns it into the much smaller
 * thing one seat is entitled to see. Everything the server sends a client goes
 * through here; nothing else may reach a socket.
 *
 * Built as an ALLOWLIST, and that choice is the whole design. A deny-list — copy
 * the state, delete the secrets — reads more naturally and fails silently the
 * first time somebody adds a field to createGame and forgets this file. It fails
 * in the direction of leaking, quietly, in code nobody is looking at. An
 * allowlist fails in the direction of a missing field, which shows up instantly
 * as a broken screen and gets fixed the same afternoon.
 *
 * The cost is that this file has to be revisited whenever the state gains a
 * field. tests/projection.js enforces exactly that: it fails if a top-level key
 * of state has never been given a ruling here.
 *
 * EUCHRE HAS LESS TO HIDE THAN SHEEPHEAD, and it is worth being clear about
 * exactly what, because the temptation is to hide things that are not secret and
 * then wonder why the interface cannot describe the hand.
 *
 *   Public from the moment it happens: the upcard (everybody watched it turned),
 *   who ordered or named and what, whether they are alone, who is sitting out,
 *   what trump is, every card played, every trick taken, both scores.
 *
 *   Private: your own five cards, the dealer's discard, and the three cards left
 *   face down in the kitty. That is the entire list.
 *
 * The dealer's discard is the interesting one. It is one card, it is often the
 * upcard itself, and knowing whether the dealer kept what they were given is
 * real information about their hand — so it is the dealer's business until the
 * hand is over.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  /* Room-level configuration. The rest of `config` is whatever the client had in
   * localStorage when the table was made — every settings key, including the
   * player's own name, their pace, their skin and their layout. None of that is
   * any of the table's business, and `name` in particular is one seat's private
   * preference wearing a public-looking key. */
  var ROOM_CONFIG = [
    'numPlayers', 'names',
    'pointsToWin', 'stickTheDealer', 'allowAlone', 'difficulty'
  ];

  /* What another seat's card looks like.
   *
   * Deliberately carries no rank, no suit and no id — not even a scrambled one.
   * The client needs exactly one thing about another player's hand, which is how
   * many cards are in it: the players table prints the count, and the
   * traditional skin draws that many face-down backs. Nothing reads a field.
   *
   * So a placeholder with no fields is not a limitation, it is the point. If
   * some future code does reach for c.r it gets undefined, which surfaces
   * immediately as an obviously broken cell rather than as a plausible-looking
   * wrong one. Loud beats silent. */
  function hiddenCard() { return { hidden: true }; }

  function hiddenHand(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) out.push(hiddenCard());
    return out;
  }

  /* Card objects survive JSON as plain objects with the same fields, and every
   * card helper reads fields rather than identity, so a copy is as good as the
   * singleton on both sides of a socket. */
  function copyCard(c) { return c ? { id: c.id, r: c.r, s: c.s } : null; }

  function copyCards(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) out.push(copyCard(cards[i]));
    return out;
  }

  function copyTrick(trick) {
    var out = [];
    for (var i = 0; i < trick.length; i++) {
      out.push({ player: trick[i].player, card: copyCard(trick[i].card) });
    }
    return out;
  }

  function clone(x) { return x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)); }

  function forSeat(state, seat) {
    var over = state.phase === 'handOver';
    var isDealer = state.dealer === seat;

    var players = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      players.push({
        index: p.index,
        name: p.name,
        occupant: p.occupant,
        tricksWon: p.tricksWon,
        hand: i === seat ? copyCards(p.hand) : hiddenHand(p.hand)
      });
    }

    var config = {};
    for (var k = 0; k < ROOM_CONFIG.length; k++) {
      var key = ROOM_CONFIG[k];
      if (state.config[key] !== undefined) config[key] = state.config[key];
    }

    var view = {
      seat: seat,
      config: config,
      players: players,

      /* The match. Both scores are public at any table anybody would want to sit
       * at — a card game where you cannot ask the score is not a card game. */
      scores: state.scores.slice(),
      gamesWon: state.gamesWon.slice(),
      gameNumber: state.gameNumber,
      gameOver: state.gameOver,
      gameWinner: state.gameWinner,

      phase: state.phase,
      turn: state.turn,
      leader: state.leader,
      dealer: state.dealer,
      handNumber: state.handNumber,

      /* The bidding, and its outcome. Every one of these was announced to the
       * whole table at the moment it was decided, so withholding any of it would
       * be withholding something the player has already been told — which is
       * worse than useless, it is a screen that contradicts the announcement. */
      trump: state.trump,
      maker: state.maker,
      alone: state.alone,
      sittingOut: state.sittingOut,
      deniedSuit: state.deniedSuit,
      upcard: copyCard(state.upcard),
      upcardStatus: state.upcardStatus,
      bidLog: clone(state.bidLog),

      trick: copyTrick(state.trick),
      played: copyCards(state.played),
      trickLog: clone(state.trickLog),
      lastTrick: state.lastTrick ? {
        plays: copyTrick(state.lastTrick.plays),
        winner: state.lastTrick.winner,
        number: state.lastTrick.number
      } : null,

      /* The kitty is a count and never contents, until the hand is over.
       *
       * Three cards nobody ever sees in a real game. Showing them at the end is a
       * deliberate small departure from the table version, and it is worth it:
       * a player learning the game wants to know what was sitting there, the
       * counting aid accounts for them as unseen, and the deck is reshuffled
       * every hand so it cannot inform anything that follows. */
      kittyCount: state.kitty.length,
      kitty: over ? copyCards(state.kitty) : [],

      /* The dealer's own discard, and only the dealer's. Whether they kept the
       * card they were given says a good deal about their hand, which is exactly
       * why everybody at a real table watches it go face down and nobody sees
       * what it was. */
      discard: (isDealer || over) ? copyCard(state.discard) : null,
      discarded: !!state.discard,

      /* History is deliberately absent. It grows with every hand and holds every
       * card of every finished one, so shipping it on each of the hundred-odd
       * views a hand produces would be most of the traffic — and a long session
       * would push a single-blob write past the 128 KiB Durable Object value
       * limit. The client reads it in exactly two places, the export dialog and
       * the bug report, and both can ask for it. What it needs everywhere else
       * is these two numbers. */
      handsPlayed: state.history.length,
      handsFailingAudit: state.history.filter(function (h) {
        return h.problems && h.problems.length;
      }).length
    };

    /* The deal, including the kitty, at hand end only. This is the single most
     * dangerous field in the state — a snapshot of every hand as dealt, which
     * simply never goes away — and it is also what the end-of-hand review needs.
     * Both facts are true, so the phase check is doing all the work. */
    view.dealt = over && state.dealt ? clone(state.dealt) : null;

    /* Gated on the phase, not on the engine's promise that state.result is null
     * before then. result.summary names the maker, the trump, the trick count
     * and the score; the first feature that computes a provisional result — a
     * running "we are two tricks up", an "are you sure?" on a risky lead — would
     * leak the hand through a field nothing was watching. */
    view.result = (over && state.result) ? clone(state.result) : null;

    return view;
  }

  SH.View = {
    forSeat: forSeat,
    ROOM_CONFIG: ROOM_CONFIG,
    hiddenCard: hiddenCard
  };
})(typeof window !== 'undefined' ? window : globalThis);

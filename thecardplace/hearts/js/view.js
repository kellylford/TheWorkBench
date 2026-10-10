/* Hearts - per-seat projection.
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
 * tests/projection.js enforces that cost: it fails if a top-level key of state
 * has never been given a ruling here.
 *
 * ---- what hearts has to hide, and it is not the same list as its neighbours ----
 *
 *   Private: your own thirteen cards, and — for as long as the pass is open —
 *   the three cards every seat has chosen to give away, INCLUDING YOUR OWN once
 *   you have chosen them, as far as everybody else is concerned.
 *
 *   Public the moment it happens: every card played, who took each trick and
 *   what it was worth, whose turn it is, the passing direction, every score.
 *
 * THE PASSING IS THE WHOLE SECURITY PROBLEM IN THIS GAME, and it is a shape none
 * of the other three have. Passing is simultaneous: three cards leave your hand
 * before you know what is arriving. If a seat could see another seat's chosen
 * cards even one moment early, it would choose its own pass knowing what is
 * coming — which is not a small edge, it is the difference between guessing and
 * knowing on the single most consequential decision of the hand.
 *
 * So `passing` is never sent to anybody, in any phase, in any form. Not the
 * cards, not a count of them per seat, nothing but whether each seat has
 * finished choosing — which is public at a real table, because you can see
 * somebody put three cards down.
 *
 * `received` — what you were handed — is yours alone and only after the swap.
 * The engine writes it per seat; this hands each seat its own row and nobody
 * else's. Knowing what the player on your left was given tells you three cards
 * they hold, which is a third of the information you would need to play their
 * hand for them.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  /* Room-level configuration. The rest of `config` is whatever the client had
   * in localStorage when the table was made — every settings key, including the
   * player's own name, their pace and their skin. None of that is any of the
   * table's business, and `name` in particular is one seat's private preference
   * wearing a public-looking key. */
  var ROOM_CONFIG = ['names', 'pointsToWin', 'difficulty'];

  /* What another seat's card looks like.
   *
   * Deliberately carries no rank, no suit and no id — not even a scrambled one.
   * The client needs exactly one thing about another player's hand, which is how
   * many cards are in it: the players table prints the count and the
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
      out.push({ seat: trick[i].seat, card: copyCard(trick[i].card) });
    }
    return out;
  }

  function forSeat(state, seat) {
    var players = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      players.push({
        index: p.index,
        name: p.name,
        occupant: p.occupant,
        score: p.score,
        handPoints: p.handPoints,
        /* How many cards this seat has TAKEN, not which. Which cards a player
         * has taken is public in principle — everybody watched every trick — but
         * sending the pile costs nothing to withhold and the interface prints a
         * count and a points total. What is genuinely needed is the points,
         * which is below. */
        takenCount: p.taken.length,
        takenPoints: SH.Game.pointsOf(p.taken),
        /* Public by construction: everybody watched the trick she fell in. The
         * interface says so on request, because "who has the queen" is the
         * single most useful question in this game and a player tracking it by
         * memory is doing bookkeeping the table can just answer. */
        hasQueen: p.taken.some(function (c) { return c.id === 'QS'; }),
        hand: i === seat ? copyCards(p.hand) : hiddenHand(p.hand)
      });
    }

    var config = {};
    for (var k = 0; k < ROOM_CONFIG.length; k++) {
      var key = ROOM_CONFIG[k];
      if (state.config && state.config[key] !== undefined) config[key] = state.config[key];
    }

    return {
      seat: seat,
      config: config,
      players: players,

      phase: state.phase,
      turn: state.turn,
      leader: state.leader,
      dealNumber: state.dealNumber,
      passDir: state.passDir,

      /* WHO HAS FINISHED CHOOSING, and nothing else about the pass. Visible at a
       * real table — you can see three cards go face down — and it is what the
       * interface needs to say "waiting for two players". The cards themselves
       * are never sent, to anybody, in any phase. */
      passedIn: state.passing.map(function (p) { return !!p; }),

      /* What THIS seat was handed, and only after the swap. Another seat's
       * received cards are three of the thirteen they hold. */
      received: state.received[seat] ? copyCards(state.received[seat]) : null,

      trick: copyTrick(state.trick),
      tricksPlayed: state.tricksPlayed,
      heartsBroken: state.heartsBroken,
      lastTrick: state.lastTrick ? {
        cards: copyTrick(state.lastTrick.cards),
        winner: state.lastTrick.winner,
        points: state.lastTrick.points
      } : null,

      history: state.history.map(function (h) {
        return {
          deal: h.deal, passDir: h.passDir,
          points: h.points.slice(), shooter: h.shooter, scores: h.scores.slice()
        };
      }),
      winner: state.winner
    };
  }

  SH.View = {
    forSeat: forSeat,
    ROOM_CONFIG: ROOM_CONFIG,
    /* Named so tests/projection.js can state what it has ruled on. Every
     * top-level key of the state must appear in exactly one of these. */
    SENT: ['phase', 'players', 'turn', 'leader', 'dealNumber', 'passDir',
      'passing', 'received', 'trick', 'tricksPlayed', 'heartsBroken',
      'lastTrick', 'history', 'winner', 'config'],
    WITHHELD: ['events', 'nextEventId']
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Spades - per-seat projection.
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
 * ---- what spades has to hide, and it is a SHORT list ----
 *
 *   Private: your own thirteen cards. That is the entire secret in this game.
 *
 *   Public the moment it happens: every bid, every card played, who took each
 *   trick, whose turn it is, both scores, both bag counts, whether spades are
 *   broken.
 *
 * THE BIDS ARE PUBLIC, AND THAT IS NOT AN OVERSIGHT. Bidding in spades is spoken
 * aloud, in order, and the whole skill of the last two seats is bidding into what
 * they have already heard. Hiding a bid until everybody had chosen would not be
 * a stricter version of this game, it would be a different one — and a worse one,
 * because the dealer's position would stop being worth anything.
 *
 * The counterpart is that a seat which has not bid yet has `bid: null`, and that
 * is public too: everybody at a real table can see whose turn it is to speak.
 *
 * This is worth stating explicitly because the neighbouring game hides exactly
 * the analogous field. Hearts must never send `passing`, because passing is
 * SIMULTANEOUS — three cards leave your hand before you know what is arriving, so
 * one seat seeing another's choice early is the difference between guessing and
 * knowing. Spades bidding is sequential and spoken. Same shape of field, opposite
 * ruling, and the reason is the rule and not the type.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  /* Room-level configuration. The rest of `config` is whatever the client had
   * in localStorage when the table was made — every settings key, including the
   * player's own name, their pace and their skin. None of that is any of the
   * table's business, and `name` in particular is one seat's private preference
   * wearing a public-looking key.
   *
   * Every rule the engine reads from config has to be here, or a client is
   * scoring by a different book than the server: bagLimit and bagPenalty change
   * what a hand is worth, and nilValue changes what a nil is worth. A rule the
   * table plays by that the table cannot see is how you get a player insisting
   * the score is wrong and being right. */
  var ROOM_CONFIG = ['names', 'pointsToWin', 'bagLimit', 'bagPenalty', 'nilValue', 'difficulty'];

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
        team: p.team,
        occupant: p.occupant,
        bid: p.bid,
        tricks: p.tricks,
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
      dealer: state.dealer,
      dealNumber: state.dealNumber,

      trick: copyTrick(state.trick),
      tricksPlayed: state.tricksPlayed,
      spadesBroken: state.spadesBroken,
      lastTrick: state.lastTrick ? {
        cards: copyTrick(state.lastTrick.cards),
        winner: state.lastTrick.winner
      } : null,

      scores: state.scores.slice(),
      bags: state.bags.slice(),

      history: state.history.map(function (h) {
        return {
          deal: h.deal, dealer: h.dealer,
          bids: h.bids.slice(), tricks: h.tricks.slice(),
          delta: h.delta.slice(), scores: h.scores.slice(), bags: h.bags.slice()
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
    SENT: ['phase', 'players', 'turn', 'leader', 'dealer', 'dealNumber',
      'trick', 'tricksPlayed', 'spadesBroken', 'lastTrick', 'scores', 'bags',
      'history', 'winner', 'config'],
    WITHHELD: ['events', 'nextEventId']
  };
})(typeof window !== 'undefined' ? window : globalThis);

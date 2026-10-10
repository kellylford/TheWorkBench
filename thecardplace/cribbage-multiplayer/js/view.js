/* Cribbage - per-seat projection.
 *
 * The authoritative state holds both hands, the crib and the undealt remainder.
 * This turns it into the much smaller thing one seat is entitled to see.
 * Everything the server sends a client goes through here; nothing else may reach
 * a socket.
 *
 * Built as an ALLOWLIST. A deny-list — copy the state, delete the secrets —
 * reads more naturally and fails silently the first time somebody adds a field
 * to createGame and forgets this file. It fails in the direction of leaking,
 * quietly, in code nobody is looking at. An allowlist fails in the direction of
 * a missing field, which shows up instantly as a broken screen.
 *
 * CRIBBAGE HIDES MORE THAN THE OTHER GAMES HERE, and it hides it in a shape the
 * others do not have.
 *
 *   `deck` is the dangerous one, and it is unique to this game. Six cards each
 *   out of fifty-two leaves forty on the table, and a client that could see them
 *   would know its opponent's hand exactly, by elimination, from the moment of
 *   the deal. There is no phase at which it becomes safe, so it is not in the
 *   view at any phase — not even at the end of the hand, where every other
 *   secret is released.
 *
 *   The crib is hidden from BOTH players, including the dealer whose crib it is.
 *   That is not true of anything in sheephead or euchre, where a secret always
 *   belongs to somebody. It becomes public at the moment it is counted, and not
 *   before.
 *
 *   BOTH HANDS become public the moment the play ends and the counting starts.
 *   They used to come up one at a time in counting order, on the reasoning that
 *   this is what happens at a table. It is not what happens at a table: both
 *   players' four cards are lying in front of them, face up, and each can see
 *   the other's while the count is read out. That is how you check a count, and
 *   two people playing this together said so — one of them sighted, watching a
 *   screen that showed him nothing to check against.
 *
 *   Nothing is risked by it. The play is over when counting begins, so there is
 *   no decision left that the other hand could inform. The crib is the one thing
 *   still held back, until its own turn, because it genuinely is face down on
 *   the table until the dealer turns it.
 *
 * tests/projection.js holds a written ruling for every field and fails if the
 * engine grows one that has never been considered.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  /* Room-level configuration. The rest of `config` is whatever the client had in
   * localStorage when the table was made — every settings key, including the
   * player's own name, their pace and their appearance. None of that is any of
   * the table's business. */
  var ROOM_CONFIG = ['names', 'targetScore', 'difficulty'];

  /* What a card the viewer may not see looks like. No rank, no suit, no id — not
   * even a scrambled one. The client needs exactly one thing about a hidden
   * hand, which is how many cards are in it. A placeholder carrying a plausible
   * fake rank would let wrong code keep working and quietly report nonsense; one
   * with no fields breaks loudly at the first misuse. Loud beats silent. */
  function hiddenCard() { return { hidden: true }; }

  function hiddenHand(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) out.push(hiddenCard());
    return out;
  }

  function copyCard(c) { return c ? { id: c.id, r: c.r, s: c.s } : null; }

  function copyCards(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) out.push(copyCard(cards[i]));
    return out;
  }

  function clone(x) { return x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)); }

  function forSeat(state, seat) {
    var over = state.phase === 'roundOver' || state.phase === 'gameOver';

    /* Counting order, and what it makes public.
     *
     * The non-dealer counts first, then the dealer, then the crib. Each becomes
     * visible to everybody the moment it is counted and not a step earlier —
     * which is exactly the table behaviour, and also the only version that does
     * not hand a player their opponent's hand while they are still deciding
     * whether to dispute the count. */
    var counting = state.phase === 'count' || over;
    var showCrib = over || (counting && state.countStage >= 3);

    function maySeeHand(i) {
      if (i === seat) return true;
      /* Both hands, from the first moment of the count. Staging them by
       * countStage kept the opponent's four cards hidden while their count was
       * being read aloud, which is the one moment you most want to see them. */
      return counting;
    }

    var players = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      var open = maySeeHand(i);
      players.push({
        index: p.index,
        name: p.name,
        occupant: p.occupant,
        score: p.score,
        /* Played cards are public the moment they are laid, so `played` is never
         * hidden — it is on the table face up. */
        played: copyCards(p.played),
        hand: open ? copyCards(p.hand) : hiddenHand(p.hand),
        kept: open ? copyCards(p.kept) : hiddenHand(p.kept),
        /* Whether this seat has thrown to the crib yet is public — everybody
         * watches it happen — while WHAT they threw is not. */
        hasDiscarded: !!state.discarded[i]
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

      gamesWon: state.gamesWon.slice(),
      gameNumber: state.gameNumber,
      gameOver: state.gameOver,
      gameWinner: state.gameWinner,

      phase: state.phase,
      turn: state.turn,
      dealer: state.dealer,
      handNumber: state.handNumber,

      /* Both cuts, and whether it was a tie. Public: they are turned face up in
       * front of both players. */
      cutForDeal: clone(state.cutForDeal),

      /* The starter is face up from the moment it is turned, and null before. */
      starter: copyCard(state.starter),

      /* The play, all of it public. `runStart` goes too: the client needs to
       * know where the current count sequence began to show what a pair or a run
       * could still be built on, and it is derivable from the counts anyway. */
      pile: state.pile.map(function (e) {
        return { player: e.player, card: copyCard(e.card) };
      }),
      runStart: state.runStart,
      count: state.count,
      goSaid: state.goSaid.slice(),
      lastPlayer: state.lastPlayer,

      /* The count, as far as it has got. countResults only ever contains stages
       * that have already been announced to the whole table, so sending it in
       * full reveals nothing that was not just said out loud. */
      countStage: state.countStage,
      countResults: clone(state.countResults),

      /* The crib, and what each seat threw to it.
       *
       * Hidden from BOTH players until it is counted — including from the dealer
       * whose crib it is, who at a real table has four cards face down in front
       * of them and does not get to look. `cribCount` is what the interface
       * needs before then, and it draws that many backs. */
      cribCount: state.crib.length,
      crib: showCrib ? copyCards(state.crib) : [],

      /* Your own discard is yours to remember; the other seat's is not, and
       * knowing it would give away a third of their information for the whole
       * hand. */
      discarded: state.discarded.map(function (d, i) {
        if (!d) return null;
        return (i === seat || over) ? d.slice() : null;
      }),

      /* History is deliberately absent. It grows with every hand and holds every
       * card of every finished one, so shipping it on each of the views a hand
       * produces would be most of the traffic. The client reads it in exactly
       * two places — the export dialog and the bug report — and both can ask. */
      handsPlayed: state.history.length,
      handsFailingAudit: state.history.filter(function (h) {
        return h.problems && h.problems.length;
      }).length
    };

    /* The deal, at hand end only. Note that even here it is `dealt` and never
     * `deck`: what everybody held is fair to show once the hand is over, and
     * what was left in the pack is not shown at all, because there is no moment
     * at which forty unseen cards become somebody's business. */
    view.dealt = over && state.dealt ? clone(state.dealt) : null;

    view.result = (over && state.result) ? clone(state.result) : null;

    return view;
  }

  SH.View = {
    forSeat: forSeat,
    ROOM_CONFIG: ROOM_CONFIG,
    hiddenCard: hiddenCard
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Sheephead - per-seat projection.
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
 * The cost is that this file has to be revisited whenever state gains a field.
 * tests/projection.js enforces exactly that: it fails if a top-level key of
 * state has never been given a ruling here.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  /* Room-level configuration. The rest of `config` is whatever the client had in
   * localStorage when it called createGame — onStart copies EVERY settings key
   * in, including the player's own name, their pace, their skin and their
   * layout. None of that is any of the table's business, and `name` in
   * particular is one seat's private preference wearing a public-looking key. */
  var ROOM_CONFIG = [
    'numPlayers', 'names',
    'allPass', 'difficulty',
    'blackQueenDoubler', 'redQueenDoubler', 'redealDoubler'
  ];

  /* What another seat's card looks like.
   *
   * Deliberately carries no rank, no suit and no id — not even a scrambled one.
   * The client needs exactly one thing about another player's hand, which is how
   * many cards are in it: renderPlayers prints p.hand.length, the footer totals
   * it, and the traditional skin draws that many face-down backs. Nothing reads
   * a field.
   *
   * So a placeholder with no fields is not a limitation, it is the point. If some
   * future code does reach for c.r, it gets undefined and POINTS[undefined] makes
   * NaN, which surfaces immediately in the totals row that already has a
   * bad-total warning watching it. Loud beats silent: a placeholder carrying a
   * plausible-looking fake rank would let wrong code keep working and quietly
   * report nonsense. */
  function hiddenCard() { return { hidden: true }; }

  function hiddenHand(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) out.push(hiddenCard());
    return out;
  }

  /* Card objects survive JSON as plain objects with the same fields, and every
   * card helper reads fields rather than identity, so a copy is as good as the
   * singleton on both sides of a socket. */
  function copyCards(cards) {
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      out.push({ id: c.id, r: c.r, s: c.s });
    }
    return out;
  }

  function copyTrick(trick) {
    var out = [];
    for (var i = 0; i < trick.length; i++) {
      out.push({ player: trick[i].player, card: { id: trick[i].card.id, r: trick[i].card.r, s: trick[i].card.s } });
    }
    return out;
  }

  function forSeat(state, seat) {
    var over = state.phase === 'handOver';
    var isPicker = state.picker >= 0 && state.picker === seat;

    /* The sides are hidden until the Jack of Diamonds is played — that is the
     * entire mechanic of the game. The picker is the one exception: they have
     * always known, because they can see their own hand. */
    var sidesKnown = state.partnerRevealed || over;
    var mayKnowSides = sidesKnown || isPicker;

    var players = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      players.push({
        index: p.index,
        name: p.name,
        occupant: p.occupant,
        tricksWon: p.tricksWon,
        points: p.points,
        score: p.score,
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

      // Public throughout: none of this can be inferred back to a hidden card.
      phase: state.phase,
      turn: state.turn,
      leader: state.leader,
      dealer: state.dealer,
      handNumber: state.handNumber,
      passCount: state.passCount,
      isLeaster: state.isLeaster,
      picker: state.picker,
      partnerRevealed: state.partnerRevealed,
      trick: copyTrick(state.trick),
      played: copyCards(state.played),
      trickLog: JSON.parse(JSON.stringify(state.trickLog)),
      pickLog: JSON.parse(JSON.stringify(state.pickLog)),
      lastTrick: state.lastTrick ? JSON.parse(JSON.stringify(state.lastTrick)) : null,
      revealInfo: state.revealInfo ? JSON.parse(JSON.stringify(state.revealInfo)) : null,

      /* Public, and easy to confuse with the rule of the same name.
       * state.redealDoubler says THIS hand is doubled because the last one was
       * thrown in; config.redealDoubler says the table plays that rule at all.
       * Dropping this by mistake breaks the client's multiplier without any
       * error, so it is called out here rather than left in a list. */
      redealDoubler: state.redealDoubler,
      nextHandDoubler: state.nextHandDoubler,

      /* The blind is a count and never contents.
       *
       * An earlier draft had this as "hidden until picked, then picker-only,
       * except in a leaster where it stays hidden all hand". All of that was
       * wrong: doPick empties state.blind into the picker's hand, and
       * resolveTrick empties it on a leaster's final trick, so it is already
       * empty at handOver on every path. What actually reveals the blind is
       * dealt.blind, below. */
      blindCount: state.blind.length,

      /* History is deliberately absent. It grows about 2 KB per hand and holds
       * every card of every finished hand, so shipping it on each of the ~150
       * views a hand produces would be most of the traffic — and a long session
       * would push a single-blob write past the 128 KiB Durable Object value
       * limit around hand sixty. The client reads it in exactly two places, the
       * export dialog and the bug report, and both can ask for it. What it needs
       * everywhere else is these two numbers. */
      handsPlayed: state.history.length,
      handsFailingAudit: state.history.filter(function (h) { return h.problems && h.problems.length; }).length
    };

    /* Own cards taken from the blind, and the bury choice in progress. Both are
     * the blind's contents under another name, so both are picker-only. */
    view.pickedUp = isPicker ? state.pickedUp.slice() : [];

    /* Buried cards are the picker's private business until the hand is over,
     * when everything is shown anyway — the end-of-hand panel lays out what went
     * down, because "21 points buried" tells a player nothing. */
    view.buried = (isPicker || over) ? copyCards(state.buried) : [];
    view.buriedCount = state.buried.length;

    /* The partnership. `alone` is withheld rather than defaulted, because a
     * default is a claim: sending alone:false to everyone before the reveal
     * would be a lie on exactly the hands where it matters. */
    if (mayKnowSides) {
      view.alone = state.alone;
      view.partner = state.partner;
    }
    view.sidesKnown = mayKnowSides;

    /* Queen-pair doublers name their holder — {kind, player, text} — and unlike
     * the partner card, nothing in the game ever makes that public before
     * scoring. The factor is withheld with them: a hand visibly worth double
     * tells the table a pair exists and roughly where, which is most of the
     * secret. Each holder is told privately at the time, through an event
     * addressed to their seat. */
    view.doublers = over ? JSON.parse(JSON.stringify(state.doublers)) : [];

    /* The deal, including the blind, at hand end only. This is the single most
     * dangerous field in the state — a snapshot of every hand as dealt, which
     * simply never goes away — and it is also what the end-of-hand review needs.
     * Both facts are true, so the phase check is doing all the work. */
    view.dealt = over && state.dealt ? JSON.parse(JSON.stringify(state.dealt)) : null;

    /* Only ever non-null at handOver, and seat-neutral by construction — see the
     * note on defenceText in scoreNormal. */
    view.result = state.result ? JSON.parse(JSON.stringify(state.result)) : null;

    return view;
  }

  SH.View = {
    forSeat: forSeat,
    ROOM_CONFIG: ROOM_CONFIG,
    hiddenCard: hiddenCard
  };
})(typeof window !== 'undefined' ? window : globalThis);

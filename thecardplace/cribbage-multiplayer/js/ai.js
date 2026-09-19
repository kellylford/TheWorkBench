/* Cribbage - the computer player.
 *
 * THE RULE THIS FILE EXISTS TO KEEP, and the reason it is a rewrite rather than
 * a port: IT READS ONLY WHAT ITS OWN SEAT IS ENTITLED TO.
 *
 * The stable game in `Cribbage/` does not. Its pegging strategy has this, in
 * `selectBestPlayCard`:
 *
 *     const opponentHand = this.player.hand.filter(...)
 *     if (opponentHand.some(c => newCount + c.value === 31)) score -= 15;
 *     if (opponentHand.some(c => newCount + c.value === 15)) score -= 8;
 *     if (opponentHand.some(c => c.rank === card.rank))      score -= 5;
 *
 * That is the computer looking at your cards before deciding what to lay. In a
 * single-player game it is a quality problem — the opponent feels uncannily good
 * at not setting you up. At a table where a bot can fill a seat opposite a
 * stranger it is cheating, and completely invisible cheating at that, because
 * every card it plays is legal and it simply wins more than it should.
 *
 * The replacement plays the same idea honestly. Instead of asking "can my
 * opponent make thirty-one", it asks "how many of the cards I have not seen
 * would make thirty-one" — which is what a good human player does, is often
 * wrong, and is wrong in the way a person is wrong. Being sometimes mistaken
 * about this is not a weakness of the design; it is the design.
 *
 * `tests/hidden-information.js` enforces it, by putting a recorder on the other
 * seat's cards while the computer thinks.
 *
 * It acts through applyAction, never through the engine directly: the seat check
 * lives in the gate, and a bot that reaches round it is a bot that can move for
 * somebody else — the exact hole the gate exists to close, arriving through the
 * one caller nobody audits.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards, G = SH.Game;

  /* Everything this seat has not seen: the whole deck, less its own cards, less
   * its own discard, less everything on the table. Public information and its
   * own, and nothing else. Never the crib, never the undealt remainder, never
   * the other seat's hand. */
  function unseenFor(state, p) {
    var seen = {};
    state.players[p].hand.forEach(function (c) { seen[c.id] = 1; });
    state.players[p].kept.forEach(function (c) { seen[c.id] = 1; });
    state.players[p].played.forEach(function (c) { seen[c.id] = 1; });
    state.pile.forEach(function (e) { seen[e.card.id] = 1; });
    if (state.discarded[p]) state.discarded[p].forEach(function (id) { seen[id] = 1; });
    if (state.starter) seen[state.starter.id] = 1;
    return C.newDeck().filter(function (c) { return !seen[c.id]; });
  }

  /* ---------------- the discard ----------------
   *
   * Fifteen ways to throw two of six. Each is judged on what the four kept cards
   * are worth AVERAGED OVER EVERY STARTER THAT COULD STILL COME — 46 of them —
   * rather than on the bare four, because a hand's value in cribbage is mostly
   * about what it can become. Two fives and a four is worth two on its own and a
   * great deal more once a six or a ten arrives.
   *
   * Then the crib is added or subtracted depending on whose it is. That sign is
   * the whole of cribbage discard strategy: the same two cards are a gift to
   * yourself and a present to your opponent.
   */
  function averageHandValue(kept, unseen) {
    var total = 0;
    for (var i = 0; i < unseen.length; i++) {
      total += G.scoreHand(kept, unseen[i], false).total;
    }
    return unseen.length ? total / unseen.length : G.scoreHand(kept, null, false).total;
  }

  /* What two cards are worth going into a crib, before anything joins them.
   *
   * Deliberately a small heuristic rather than an average over every pair of
   * cards that might land on top: that would be 46 x 45 hands per candidate
   * discard, fifteen candidates, and it would take a second and a half per
   * decision for an answer barely better than this one. Fives are the whole
   * story; touching cards and pairs are most of the rest. */
  function cribValue(a, b) {
    var v = 0;
    var va = C.value(a), vb = C.value(b);
    if (va + vb === 15) v += 2.5;
    if (a.r === b.r) v += 2.2;
    var gap = Math.abs(C.order(a) - C.order(b));
    if (gap === 1) v += 1.4;              // touching: a run is one card away
    else if (gap === 2) v += 0.7;         // a gap a single card fills
    if (a.r === '5') v += 1.9;
    if (b.r === '5') v += 1.9;
    /* A jack in the crib is a nob about one time in four. */
    if (a.r === 'J') v += 0.25;
    if (b.r === 'J') v += 0.25;
    return v;
  }

  function chooseDiscard(state, p) {
    var hand = state.players[p].hand;
    var unseen = unseenFor(state, p);
    var mine = state.dealer === p;
    var best = null;

    for (var i = 0; i < hand.length; i++) {
      for (var j = i + 1; j < hand.length; j++) {
        var thrown = [hand[i], hand[j]];
        var kept = hand.filter(function (c) { return c !== thrown[0] && c !== thrown[1]; });
        var value = averageHandValue(kept, unseen);
        var crib = cribValue(thrown[0], thrown[1]);
        var score = value + (mine ? crib : -crib);
        if (!best || score > best.score) best = { score: score, thrown: thrown };
      }
    }
    return best ? C.ids(best.thrown) : C.ids(hand.slice(0, 2));
  }

  /* ---------------- the play ---------------- */

  /* How many unseen cards would take a count of `from` to exactly `to`. The
   * honest version of "can my opponent make thirty-one". */
  function unseenMaking(unseen, from, to) {
    var n = 0;
    for (var i = 0; i < unseen.length; i++) {
      if (from + C.value(unseen[i]) === to) n++;
    }
    return n;
  }

  function unseenOfRank(unseen, r) {
    var n = 0;
    for (var i = 0; i < unseen.length; i++) if (unseen[i].r === r) n++;
    return n;
  }

  /* What laying this card would score. The engine owns this — see
   * G.pointsForPlay — because the engine, the computer and the interface all
   * need the same answer and three copies of it would not stay the same for
   * long. */
  function pointsFor(state, card) {
    return G.pointsForPlay(state, card).total;
  }

  function chooseCard(state, p) {
    var legal = G.legalPlays(state, p);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0].id;

    var difficulty = state.config.difficulty || 'normal';
    if (difficulty === 'easy' && Math.random() < 0.35) {
      return legal[Math.floor(Math.random() * legal.length)].id;
    }
    if (difficulty === 'normal' && Math.random() < 0.12) {
      return legal[Math.floor(Math.random() * legal.length)].id;
    }

    var unseen = unseenFor(state, p);
    var best = null;

    for (var i = 0; i < legal.length; i++) {
      var card = legal[i];
      var newCount = state.count + C.value(card);
      var score = pointsFor(state, card) * 10;

      /* THE TWO COUNTS NEVER TO LEAVE. A count of five or twenty-one hands the
       * opponent a fifteen or a thirty-one with any of the sixteen ten-cards in
       * the deck, which is the most likely card they hold. This one rule is
       * worth more than everything else in this function. */
      if (newCount === 5 || newCount === 21) score -= 9;

      /* Everything else, priced by how many unseen cards would punish it. */
      score -= unseenMaking(unseen, newCount, 31) * (6 / Math.max(1, unseen.length / 10));
      score -= unseenMaking(unseen, newCount, 15) * (4 / Math.max(1, unseen.length / 10));
      score -= unseenOfRank(unseen, card.r) * 0.6;         // they may pair it

      /* Leading. A low card keeps the count out of range of a fifteen and leaves
       * room to answer; a five led is a present. */
      if (state.count === 0) {
        if (card.r === '5') score -= 8;
        score -= C.value(card) * 0.25;
        /* Leading from a pair is good: if they pair it, you take three of a kind
         * for six. */
        var mineSame = 0;
        state.players[p].hand.forEach(function (c) { if (c.r === card.r) mineSame++; });
        if (mineSame >= 2) score += 2.5;
      }

      /* Keeping something playable afterwards. Being forced to say go hands over
       * a point and the lead. */
      var left = state.players[p].hand.filter(function (c) { return c !== card; });
      var stillPlayable = left.filter(function (c) { return newCount + C.value(c) <= 31; }).length;
      if (left.length && stillPlayable === 0 && newCount < 31) score -= 4;
      else score += stillPlayable * 0.6;

      if (!best || score > best.score) best = { score: score, card: card };
    }
    return best.card.id;
  }

  /* ---------------- taking a turn ---------------- */

  function decide(state, p) {
    switch (state.phase) {
      case 'cutForDeal': return { type: 'cut' };
      case 'discard': return { type: 'discard', cards: chooseDiscard(state, p) };
      case 'count': return { type: 'next' };
      case 'play': {
        var id = chooseCard(state, p);
        /* No playable card means the only legal thing to do is say go. The
         * engine refuses a go from somebody who can play, so this cannot be used
         * to duck a turn. */
        return id ? { type: 'play', card: id } : { type: 'go' };
      }
    }
    return null;
  }

  /* Take one turn for whoever is on move. Returns the seat acted for, or -1.
   *
   * Throws if the gate refuses. A refused bot move is a bug in here, and a table
   * that quietly retries it is a table that has stopped with nothing said — the
   * room catches this, announces a fault, and somebody gets told. */
  function act(state) {
    var p = G.seatToAct(state);
    if (p < 0) return -1;
    var action = decide(state, p);
    if (!action) throw new Error('the computer had no move at phase ' + state.phase);
    var r = G.applyAction(state, p, action);
    if (!r.ok) {
      throw new Error('the computer\'s move was refused: ' + (r.reason || 'no reason given') +
        ' (' + action.type + ' at ' + state.phase + ', seat ' + p + ')');
    }
    return p;
  }

  SH.AI = {
    act: act,
    decide: decide,
    chooseCard: chooseCard,
    chooseDiscard: chooseDiscard,
    unseenFor: unseenFor,
    cribValue: cribValue,
    averageHandValue: averageHandValue
  };
})(typeof window !== 'undefined' ? window : globalThis);

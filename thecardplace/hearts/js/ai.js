/* Hearts - the computer players.
 *
 * Hearts is an avoidance game, and that changes what "playing well" means in a
 * way worth stating before any of the tactics below make sense: there is no
 * trick you want to win. Every heuristic here is about ducking — getting under
 * the trick, getting rid of dangerous cards while somebody else is committed,
 * and above all not being the one holding the queen of spades when she falls.
 *
 * ---- what it plays honestly with ----
 *
 * ONLY WHAT ITS SEAT CAN SEE. Its own hand, the cards on the table, the tricks
 * that have been taken, and what it was passed. Not the other three hands.
 *
 * That restraint is the whole reason this file is worth having, and it is easy
 * to lose by accident rather than by intent: `state.players[i].hand` is right
 * there and reads as available. A bot that peeks does not throw, does not fail a
 * test, and simply plays impossibly well — which gets reported as "the computer
 * is cheating" months later, by somebody who is right.
 *
 * unseen() is the honest substitute: the whole pack, minus what this seat holds,
 * minus everything already played. It is what a person tracking cards at the
 * table would know, and no more.
 *
 * ---- the passing ----
 *
 * Three cards, and the only genuinely important question is what to do with the
 * queen of spades and her guards. Holding the queen with fewer than three spades
 * is dangerous: spades get led, and with a short holding you are forced to play
 * her. So high spades go unless there is length behind them. After that, high
 * cards in short suits — the ones that will win a trick you did not want.
 *
 * Hearts are NOT dumped by default. Passing hearts away hands somebody else the
 * material to shoot the moon with, and a moon costs twenty-six.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;
  var G = SH.Game;

  function seatToAct(state) { return G.seatToAct(state); }

  /* Everything this seat has not seen: the pack minus its own hand minus every
   * card that has hit the table. Cards in other hands and cards not yet played
   * are indistinguishable from here, which is exactly the point. */
  function unseen(state, seat) {
    var gone = {};
    state.players[seat].hand.forEach(function (c) { gone[c.id] = true; });
    state.players.forEach(function (p) {
      p.taken.forEach(function (c) { gone[c.id] = true; });
    });
    state.trick.forEach(function (t) { gone[t.card.id] = true; });
    return C.newDeck().filter(function (c) { return !gone[c.id]; });
  }

  function countSuit(cards, s) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].s === s) n++;
    return n;
  }

  /* ---------------- passing ---------------- */

  function choosePass(state, seat) {
    var hand = state.players[seat].hand.slice();
    var spades = countSuit(hand, 'S');

    var scored = hand.map(function (c) {
      return { c: c, risk: passRisk(c, hand, spades) };
    });
    scored.sort(function (a, b) { return b.risk - a.risk; });
    return scored.slice(0, G.PASS_COUNT).map(function (x) { return x.c.id; });
  }

  function passRisk(c, hand, spades) {
    /* The queen first, and her guards with her. With three or more spades below
     * her you can afford to hold her — you will get to throw a low one when
     * spades are led. With fewer, she comes down on somebody's ace. */
    if (c.id === 'QS') return spades >= 4 ? 60 : 100;
    if (c.s === 'S' && C.power(c) > C.power(C.get('QS'))) {
      /* Ace and king of spades: they win a spade trick, and the queen may be in
       * it. Dangerous in proportion to how short the suit is. */
      return spades >= 4 ? 55 : 90;
    }

    var len = countSuit(hand, c.s);
    var high = C.power(c);

    /* A high card in a short suit is a trick you cannot avoid winning. A high
     * card in a long suit can usually be got rid of underneath something. */
    var risk = high * 2 - len * 6;

    /* Hearts are kept unless they are genuinely high. Passing low hearts away
     * is how the seat on your left ends up with the material to shoot. */
    if (c.s === 'H') risk = high >= 12 ? high * 2 - len * 4 : high - 20;

    return risk;
  }

  /* ---------------- playing ---------------- */

  function chooseCard(state, seat) {
    var legal = G.legalPlays(state, seat);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    var leading = state.trick.length === 0;
    return leading ? chooseLead(state, seat, legal) : chooseFollow(state, seat, legal);
  }

  function chooseLead(state, seat, legal) {
    var hand = state.players[seat].hand;
    var out = unseen(state, seat);

    /* If the queen is still out there and this seat does not hold her, leading
     * spades from below her is how she gets flushed — but only while the top
     * spades are still out, or you simply take her yourself. */
    var queenGone = !out.some(function (c) { return c.id === 'QS'; }) &&
      !hand.some(function (c) { return c.id === 'QS'; });

    var best = null, bestScore = -Infinity;
    legal.forEach(function (c) {
      var score = 0;
      var outHigher = out.filter(function (o) {
        return o.s === c.s && C.power(o) > C.power(c);
      }).length;

      /* Low is good: the lower the card, the more of the suit is above it and
       * the less likely this seat takes the trick. */
      score += outHigher * 8 - C.power(c) * 2;

      if (c.s === 'H') score -= 25;                       // leading hearts gives points away
      if (c.id === 'QS') score -= 200;                    // never
      if (c.s === 'S' && !queenGone && C.power(c) > 12) score -= 60;

      /* Leading a suit this seat is short in is how you get a void, and a void
       * is what lets you throw the queen at somebody later. */
      var len = countSuit(hand, c.s);
      if (len <= 2 && c.s !== 'H') score += 12;

      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  function chooseFollow(state, seat, legal) {
    var led = state.trick[0].card.s;
    var winning = state.trick[0].card;
    state.trick.forEach(function (t) { if (C.beats(t.card, winning)) winning = t.card; });
    var last = state.trick.length === G.SEATS - 1;
    var pot = G.pointsOf(state.trick.map(function (t) { return t.card; }));

    var following = legal.filter(function (c) { return c.s === led; });

    if (following.length) {
      var under = following.filter(function (c) { return !C.beats(c, winning); });

      /* Last to play, with nothing in the pot and a card that ducks: the trick
       * is free and worth taking with the highest card that still loses, to get
       * rid of it. */
      if (under.length) {
        if (last && pot === 0) return highest(under);
        return highest(under);      // duck as high as you can safely go
      }

      /* Forced to win. Take it with the lowest card that does — no sense
       * spending the ace when the ten wins the same trick. */
      return lowest(following);
    }

    /* A discard. The best moment in the game to be rid of something. */
    var qs = legal.filter(function (c) { return c.id === 'QS'; })[0];
    if (qs) return qs;

    var spadesHigh = legal.filter(function (c) {
      return c.s === 'S' && C.power(c) > C.power(C.get('QS'));
    });
    if (spadesHigh.length) return highest(spadesHigh);

    var hearts = legal.filter(function (c) { return c.s === 'H'; });
    if (hearts.length) return highest(hearts);

    return highest(legal);
  }

  function highest(cards) {
    return cards.reduce(function (a, b) { return C.power(b) > C.power(a) ? b : a; });
  }
  function lowest(cards) {
    return cards.reduce(function (a, b) { return C.power(b) < C.power(a) ? b : a; });
  }

  /* ---------------- the one entry point ---------------- */

  function decide(state, seat) {
    if (state.phase === 'passing') {
      return { type: 'pass', cards: choosePass(state, seat) };
    }
    if (state.phase === 'play') {
      var c = chooseCard(state, seat);
      return c ? { type: 'play', card: c.id } : null;
    }
    return null;
  }

  function act(state) {
    var p = seatToAct(state);
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
    seatToAct: seatToAct,
    choosePass: choosePass,
    chooseCard: chooseCard,
    unseen: unseen
  };
})(typeof window !== 'undefined' ? window : globalThis);

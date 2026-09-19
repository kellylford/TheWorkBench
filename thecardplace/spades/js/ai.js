/* Spades - the computer players.
 *
 * Spades is a game about a promise you made before you saw a single card played,
 * and every heuristic below is downstream of that. Unlike hearts next door, where
 * there is no trick you want to win, here there is an exact number of them you
 * want — and both directions from it are expensive. One short of the contract
 * loses the whole bid; one over is a bag, and ten bags is a hundred points.
 *
 * So "playing well" means steering towards a number, and the same card is right
 * or wrong depending on how many tricks this seat still needs.
 *
 * ---- what it plays honestly with ----
 *
 * ONLY WHAT ITS SEAT CAN SEE. Its own hand, the bids (which are public in this
 * game, spoken aloud in order), the cards on the table, and how many tricks each
 * seat has taken. Not the other three hands.
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
 * ---- the bidding ----
 *
 * Count winners, not points. An ace is a trick; a king is most of one; length in
 * spades is a trick per card beyond the third or so, because the short suits run
 * out and the trumps keep winning. Then round DOWN, because of rule 2: a bid you
 * miss costs the whole thing, so between bidding three and bidding four on a
 * hand worth three and a half, three is right and it is not close.
 *
 * Nil is offered only on a hand that can genuinely duck everything — no ace, no
 * king outside a long suit, and short, low trump. A nil is a hundred either way
 * and a bot that tries them hopefully is a bot nobody wants as a partner.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;
  var G = SH.Game;

  function seatToAct(state) { return G.seatToAct(state); }

  /* Everything this seat has not seen: the pack minus its own hand minus every
   * card that has hit the table. Cards in other hands and cards not yet played
   * are indistinguishable from here, which is exactly the point.
   *
   * This game keeps no pile of taken cards — a trick is counted and the cards
   * are gone — so what this can subtract is the current trick and the last
   * completed one, which is what the engine still holds.
   *
   * That makes it deliberately WEAKER than hearts' version, where every taken
   * card is retained and countable. A bot here tracks less than a good human
   * would. It does not track more, which is the property that matters: the
   * failure direction is a bot that plays a bit loosely, not one that knows
   * things it never saw. */
  function unseen(state, seat) {
    var gone = {};
    state.players[seat].hand.forEach(function (c) { gone[c.id] = true; });
    state.trick.forEach(function (t) { gone[t.card.id] = true; });
    if (state.lastTrick) {
      state.lastTrick.cards.forEach(function (t) { gone[t.card.id] = true; });
    }
    return C.newDeck().filter(function (c) { return !gone[c.id]; });
  }

  function countSuit(cards, s) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) if (cards[i].s === s) n++;
    return n;
  }

  function suitCards(cards, s) {
    return cards.filter(function (c) { return c.s === s; });
  }

  /* ---------------- bidding ---------------- */

  /* Roughly how many tricks this hand takes, in halves so that the rounding is
   * an explicit decision rather than a side effect of integer arithmetic. */
  function handStrength(hand) {
    var half = 0;
    var trumps = suitCards(hand, C.TRUMP);

    /* Trump honours are close to certain. The ace always, the king nearly
     * always, the queen often enough to count as most of a trick. */
    trumps.forEach(function (c) {
      if (c.r === 'A') half += 2;
      else if (c.r === 'K') half += 2;
      else if (c.r === 'Q') half += 1;
    });

    /* Length. Every trump past the third is a trick on its own once the side
     * suits are exhausted — that is what trump length means and it is where most
     * of a big bid comes from. Four spades is already long: the pack holds
     * thirteen between four players, so the average holding is three and a
     * quarter. */
    if (trumps.length > 3) half += (trumps.length - 3) * 2;

    C.SUITS.forEach(function (s) {
      if (s === C.TRUMP) return;
      var cards = suitCards(hand, s);
      var len = cards.length;

      cards.forEach(function (c) {
        if (c.r === 'A') half += 2;
        /* A king needs cover. With two small cards behind it you can duck the
         * ace out and cash it; bare or second it runs straight into the ace. */
        else if (c.r === 'K') half += len >= 3 ? 2 : 1;
        /* A queen needs two cards behind it to be worth anything. */
        else if (c.r === 'Q' && len >= 3) half += 1;
      });

      /* Short side suits plus trump means ruffing — but only while the trumps
       * last. With three spades a void is worth most of a trick, because one of
       * those spades is likely wanted elsewhere; with four or more it is a
       * whole one. */
      if (trumps.length >= 3) {
        if (len === 0) half += trumps.length >= 4 ? 2 : 1;
        else if (len === 1 && trumps.length >= 4) half += 1;
      }

      /* A LONG side suit takes late tricks with small cards, once everybody else
       * has run out of it — but in a trump game "everybody else has run out"
       * is also when they start ruffing. So this counts only from the sixth
       * card, where the suit is long enough that somebody is out of trumps
       * too. */
      if (len > 5) half += len - 5;
    });

    return half / 2;
  }

  /* The count is CALIBRATED so that flooring it is right, rather than flooring
   * being a conservative correction applied to a count that runs high.
   *
   * That distinction was worth the measuring. An earlier version over-counted —
   * fourteen and a third across the table, where thirteen tricks exist — and
   * compensated with a rounding bias. Two things were wrong with that. The bias
   * did nothing at all, because handStrength returns halves and
   * `floor(x + 0.25)` equals `floor(x)` for every multiple of a half: a
   * parameter that looks like a tuning knob and is mathematically inert is worse
   * than no knob. And a count that is wrong in one direction and corrected in
   * the other is two errors that happen to cancel, until somebody adjusts one.
   *
   * So the components below are each set to what that holding is actually worth,
   * the total comes to just under thirteen, and the floor takes the table to
   * about twelve — which is what real tables bid, and the slack is where bags
   * come from. tests/balance.js measures the consequences and will fail if this
   * drifts: table bid, how often a contract is set, and how often the bag bin
   * fills. */

  /* Can this hand duck thirteen tricks? The test is deliberately strict. */
  function nilWorthy(hand) {
    var trumps = suitCards(hand, C.TRUMP);
    /* Any real trump length means being forced to win one late, when everybody
     * else is void and leading. Three low spades is already risky. */
    if (trumps.length > 3) return false;
    if (trumps.some(function (c) { return C.power(c) > C.power(C.get('9S')); })) return false;

    var bad = 0;
    C.SUITS.forEach(function (s) {
      if (s === C.TRUMP) return;
      var cards = suitCards(hand, s);
      cards.forEach(function (c) {
        if (c.r === 'A') bad += 3;
        /* A high card is only safe with enough small ones underneath to throw
         * first. A bare king is a trick you cannot avoid. */
        else if (c.r === 'K') bad += cards.length >= 4 ? 1 : 3;
        else if (c.r === 'Q') bad += cards.length >= 3 ? 0 : 2;
      });
    });
    return bad === 0;
  }

  function chooseBid(state, seat) {
    var hand = state.players[seat].hand;

    if (nilWorthy(hand)) return 0;

    var n = Math.floor(handStrength(hand));

    /* The partner has already spoken, or has not. If they have, and the two bids
     * together would leave the table well over thirteen, shade down by one —
     * somebody is going to be set and it does not have to be this pair.
     *
     * Read from bids rather than from hands, which is the only honest source
     * and also the real one: this is exactly the information a human at the
     * table is using. */
    var table = 0, spoken = 0;
    state.players.forEach(function (p) {
      if (p.bid !== null) { table += p.bid; spoken++; }
    });
    if (spoken && table + n > G.HAND + 1) n = Math.max(1, n - 1);

    /* A partner sitting on nil needs cover, not ambition: their tricks are your
     * problem now and you will be taking some of them defensively. */
    var partner = state.players[G.partnerOf(seat)];
    if (partner.bid === 0) n = Math.max(1, n - 1);

    /* Never nil by accident. Zero is a hundred-point bet and is only ever
     * reached through nilWorthy above. */
    if (n < 1) n = 1;
    if (n > G.HAND) n = G.HAND;
    return n;
  }

  /* ---------------- playing ---------------- */

  /* How many more tricks this seat wants. Negative means it is already over and
   * every further trick is a bag.
   *
   * Worked out for the PARTNERSHIP, because that is what the contract is, and
   * then attributed to this seat: what the pair still needs, less whatever the
   * partner looks like providing. A bot that steers to its own bid rather than
   * the pair's will happily let a contract go down while making its own number,
   * which is the single most annoying thing a spades partner can do. */
  function stillNeeds(state, seat) {
    var team = G.teamOf(seat);
    var contract = G.contractOf(state, team);
    var took = 0;
    state.players.forEach(function (p) { if (G.teamOf(p.index) === team) took += p.tricks; });
    return contract - took;
  }

  function isNil(state, seat) { return state.players[seat].bid === 0; }

  function chooseCard(state, seat) {
    var legal = G.legalPlays(state, seat);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    /* On nil, the whole plan is different: take nothing, ever. Worth a hundred
     * and nothing else in the hand comes close. */
    if (isNil(state, seat)) return nilPlay(state, seat, legal);

    /* Partner is on nil: their tricks are the disaster. Take anything that
     * threatens them if it can be done cheaply. */
    if (isNil(state, G.partnerOf(seat))) return coverPlay(state, seat, legal);

    var leading = state.trick.length === 0;
    return leading ? chooseLead(state, seat, legal) : chooseFollow(state, seat, legal);
  }

  /* ---- playing a nil ---- */

  function nilPlay(state, seat, legal) {
    if (state.trick.length === 0) {
      /* Lead the lowest thing available. Leading is bad on nil and unavoidable
       * sometimes; the lowest card of the longest suit is the least likely to
       * come back and win. */
      return lowest(legal);
    }
    var winning = currentWinner(state);
    var losing = legal.filter(function (c) { return !C.beats(c, winning.card); });
    /* The highest card that still loses. Getting rid of the dangerous ones while
     * somebody else is committed to winning is the whole craft of a nil. */
    if (losing.length) return highest(losing);
    /* Forced to win. Do it with the cheapest card — the nil is going down and
     * the only thing left to protect is the partner's contract. */
    return lowest(legal);
  }

  /* ---- covering a partner's nil ---- */

  function coverPlay(state, seat, legal) {
    if (state.trick.length === 0) {
      /* Lead high. Taking the trick yourself is how the partner never has to. */
      return highest(legal);
    }
    var winning = currentWinner(state);
    var partnerIn = state.trick.some(function (t) { return t.seat === G.partnerOf(seat); });
    var partnerWinning = winning.seat === G.partnerOf(seat);

    if (partnerWinning) {
      /* Take it off them. Anything that beats it, as cheaply as possible. */
      var over = legal.filter(function (c) { return C.beats(c, winning.card); });
      if (over.length) return lowest(over);
      return lowest(legal);
    }

    /* Partner still to play and holding a card that might win: cover by taking
     * it now if that is cheap. Otherwise play low and leave them room to duck. */
    if (!partnerIn) {
      var beat = legal.filter(function (c) { return C.beats(c, winning.card); });
      if (beat.length) return lowest(beat);
    }
    return lowest(legal);
  }

  /* ---- the ordinary case ---- */

  function currentWinner(state) {
    var best = state.trick[0];
    for (var i = 1; i < state.trick.length; i++) {
      if (C.beats(state.trick[i].card, best.card)) best = state.trick[i];
    }
    return best;
  }

  function chooseLead(state, seat, legal) {
    var need = stillNeeds(state, seat);
    var out = unseen(state, seat);

    var best = null, bestScore = -Infinity;
    legal.forEach(function (c) {
      var score = 0;
      var outHigher = out.filter(function (o) {
        return o.s === c.s && C.power(o) > C.power(c);
      }).length;

      if (need > 0) {
        /* Chasing tricks: lead winners. The fewer cards outstanding above it,
         * the better this card is to lead. */
        score += (13 - outHigher) * 6 + C.power(c);
        /* Do not lead trump while chasing unless it is genuinely high — pulling
         * trump with a small one just gives the trick away. */
        if (C.isTrump(c)) score += C.power(c) > 11 ? 10 : -30;
      } else {
        /* At or past the contract: every further trick is a bag. Lead the
         * lowest, most losable card there is. */
        score += outHigher * 8 - C.power(c) * 3;
        if (C.isTrump(c)) score -= 60;      // never spend trump when ducking
      }

      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  function chooseFollow(state, seat, legal) {
    var need = stillNeeds(state, seat);
    var winning = currentWinner(state);
    var partnerWinning = winning.seat === G.partnerOf(seat);

    var canBeat = legal.filter(function (c) { return C.beats(c, winning.card); });
    var canDuck = legal.filter(function (c) { return !C.beats(c, winning.card); });

    /* The partner has it. Do not take a trick off your own side — it counts the
     * same towards the contract either way and beating them costs a card you
     * will want later. True whether or not the pair still needs tricks, which
     * is the point of scoring by partnership rather than by seat. */
    if (partnerWinning && canDuck.length) return lowest(canDuck);

    if (need > 0) {
      if (!canBeat.length) return lowest(legal);
      /* Take it as cheaply as it can be taken. Last to play makes the cheapest
       * winner certain; earlier it is a judgement, and the cheap card is still
       * right more often than the ace — spending an ace to beat a seven leaves
       * you with nothing for the seat still to come. */
      return lowest(canBeat);
    }

    /* At or over the contract: duck everything possible. */
    if (canDuck.length) return highest(canDuck);
    return lowest(legal);
  }

  function highest(cards) {
    return cards.reduce(function (a, b) { return C.power(b) > C.power(a) ? b : a; });
  }
  function lowest(cards) {
    return cards.reduce(function (a, b) { return C.power(b) < C.power(a) ? b : a; });
  }

  /* ---------------- the one entry point ---------------- */

  function decide(state, seat) {
    if (state.phase === 'bidding') {
      return { type: 'bid', bid: chooseBid(state, seat) };
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
    chooseBid: chooseBid,
    chooseCard: chooseCard,
    handStrength: handStrength,
    nilWorthy: nilWorthy,
    stillNeeds: stillNeeds,
    unseen: unseen
  };
})(typeof window !== 'undefined' ? window : globalThis);

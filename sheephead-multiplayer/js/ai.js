/* Sheephead - computer players.
 *
 * The AI only ever looks at information a person in that seat would have:
 * its own hand, the cards already played, the public identity of the picker,
 * and (if it is the picker) its own buried cards. It never reads other hands.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;
  var G = SH.Game;

  /* ---------------- shared helpers ---------------- */

  /* Cards this seat has not seen: the whole deck minus own hand, minus everything
   * played so far, minus own buried cards. For anyone but the picker the blind is
   * correctly still "unseen". */
  function unseenFor(state, p) {
    var seen = {};
    state.players[p].hand.forEach(function (c) { seen[c.id] = 1; });
    state.played.forEach(function (c) { seen[c.id] = 1; });
    if (p === state.picker) state.buried.forEach(function (c) { seen[c.id] = 1; });
    return G.deckFor(state.config.numPlayers).filter(function (c) { return !seen[c.id]; });
  }

  /* True when nothing still out there can beat this card if it were leading. */
  function isBoss(card, unseen) {
    for (var i = 0; i < unseen.length; i++) {
      if (C.beats(unseen[i], card)) return false;
    }
    return true;
  }

  function trickPoints(trick) {
    return C.sumPoints(trick.map(function (t) { return t.card; }));
  }

  function currentBest(trick) {
    return trick[G.trickWinnerIndex(trick)];
  }

  function lowestByPoints(cards) {
    return cards.slice().sort(function (a, b) {
      var d = C.points(a) - C.points(b);
      return d !== 0 ? d : C.power(a) - C.power(b);
    })[0];
  }

  function highestByPoints(cards) {
    return cards.slice().sort(function (a, b) {
      var d = C.points(b) - C.points(a);
      return d !== 0 ? d : C.power(b) - C.power(a);
    })[0];
  }

  function cheapestWinner(cards) {
    // Prefer winning with a fail card; among equals use the weakest card that still wins.
    return cards.slice().sort(function (a, b) {
      var ta = C.isTrump(a) ? 1 : 0, tb = C.isTrump(b) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return C.power(a) - C.power(b);
    })[0];
  }

  function bySuit(hand, suit) {
    return hand.filter(function (c) { return !C.isTrump(c) && c.s === suit; });
  }

  function trumpOf(hand) { return hand.filter(C.isTrump); }
  function failOf(hand) { return hand.filter(function (c) { return !C.isTrump(c); }); }

  /* ---------------- picking ---------------- */

  var TRUMP_VALUE = {
    QC: 4.5, QS: 4.0, QH: 3.6, QD: 3.2,
    JC: 2.5, JS: 2.3, JH: 2.1, JD: 1.9,
    AD: 1.6, TD: 1.2, KD: 0.9, '9D': 0.6, '8D': 0.5, '7D': 0.4
  };

  function handStrength(hand) {
    var score = 0;
    var t = trumpOf(hand);
    t.forEach(function (c) { score += TRUMP_VALUE[c.id] || 0.5; });
    if (t.length >= 4) score += (t.length - 3) * 0.8;

    C.FAIL_SUITS.forEach(function (s) {
      var cards = bySuit(hand, s);
      if (cards.length === 0) { score += 0.7; return; }        // void: free trumping chance
      if (cards.length === 1 && cards[0].r !== 'A') score += 0.35;
      cards.forEach(function (c) {
        if (c.r === 'A') score += cards.length <= 2 ? 0.9 : 0.7;
        else if (c.r === 'T') score += cards.length <= 2 ? 0.25 : 0.15;
      });
    });
    return score;
  }

  /* Bar for taking the blind, one figure per table size. These were tuned by
   * simulation until picking came out close to break-even against the payout
   * table — going down costs double, so the bar sits well above "even money".
   * They are not interchangeable: a five card hand at six players offers far
   * less control than a ten card hand at three. */
  var PICK_BASE = { 3: 12.0, 4: 7.0, 5: 8.75, 6: 8.75 };

  function shouldPick(state, p) {
    var n = state.config.numPlayers;
    var raw = handStrength(state.players[p].hand);

    // Later seats have less to lose by taking a marginal hand.
    var frac = n > 1 ? state.passCount / (n - 1) : 0;
    var threshold = (PICK_BASE[n] || 8.5) - 1.5 * frac;

    var diff = state.config.difficulty;
    if (diff === 'easy') threshold += (Math.random() * 3 - 1.5);
    else if (diff === 'normal') threshold += (Math.random() * 1.2 - 0.6);

    return raw >= threshold;
  }

  /* ---------------- burying ---------------- */

  function combinations(arr, k) {
    var out = [];
    (function rec(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = start; i < arr.length; i++) {
        cur.push(arr[i]);
        rec(i + 1, cur);
        cur.pop();
      }
    })(0, []);
    return out;
  }

  function chooseBury(state, p) {
    var hand = state.players[p].hand;
    var k = G.DEAL[state.config.numPlayers].blind;
    var combos = combinations(hand, k);
    var best = null, bestScore = -Infinity;

    for (var i = 0; i < combos.length; i++) {
      var set = combos[i];
      var score = 0;
      var burying = {};
      set.forEach(function (c) {
        burying[c.id] = 1;
        score += C.points(c);
        if (C.isTrump(c)) score -= 45;        // trump is far too useful to throw away
      });
      var kept = hand.filter(function (c) { return !burying[c.id]; });
      C.FAIL_SUITS.forEach(function (s) {
        var had = bySuit(hand, s).length;
        if (had > 0 && bySuit(kept, s).length === 0) score += 7;   // a fresh void
      });
      if (score > bestScore) { bestScore = score; best = set; }
    }
    return C.ids(best || hand.slice(0, k));
  }

  /* ---------------- playing ---------------- */

  function chooseCard(state, p) {
    var legal = G.legalPlays(state, p);
    if (legal.length === 1) return legal[0].id;

    if (state.config.difficulty === 'easy' && Math.random() < 0.28) {
      return legal[Math.floor(Math.random() * legal.length)].id;
    }

    var unseen = unseenFor(state, p);
    if (state.isLeaster) return leasterCard(state, p, legal, unseen).id;
    if (state.trick.length === 0) return leadCard(state, p, legal, unseen).id;
    return followCard(state, p, legal, unseen).id;
  }

  function isLastTrickOfHand(state, p) {
    return state.players[p].hand.length === 1;
  }

  /* --- leading --- */

  function leadCard(state, p, legal, unseen) {
    var team = G.teamOf(state, p);
    var trump = trumpOf(legal);
    var fail = failOf(legal);

    // A boss trump is always a fine lead: it drags out trump and cannot be beaten.
    var bossTrump = trump.filter(function (c) { return isBoss(c, unseen); });
    var trumpOutstanding = unseen.filter(C.isTrump).length;

    if (team === 'picker') {
      if (bossTrump.length && trumpOutstanding > 0) return bossTrump[0];
      if (trump.length >= 3) return trump.sort(function (a, b) { return C.power(b) - C.power(a); })[0];
      // Short on trump: cash a fail ace if it is likely to stand.
      var aces = fail.filter(function (c) { return c.r === 'A' && isBoss(c, unseen); });
      if (aces.length) return aces[0];
      if (fail.length) return lowestByPoints(fail);
      return trump.sort(function (a, b) { return C.power(b) - C.power(a); })[0];
    }

    // Defence. Pull the picker's trump only when holding the top of what is left.
    if (bossTrump.length && trumpOutstanding > 0 && trump.length >= 3) return bossTrump[0];

    var safeAce = fail.filter(function (c) { return c.r === 'A' && isBoss(c, unseen); });
    if (safeAce.length) {
      // Lead the ace from the longest such suit; it is least likely to be trumped.
      safeAce.sort(function (a, b) { return bySuit(legal, b.s).length - bySuit(legal, a.s).length; });
      return safeAce[0];
    }
    if (fail.length) {
      // Lead a low card from the suit where a partner is most likely to help.
      var pool = fail.filter(function (c) { return C.points(c) === 0; });
      if (pool.length) {
        pool.sort(function (a, b) { return bySuit(legal, b.s).length - bySuit(legal, a.s).length; });
        return pool[0];
      }
      return lowestByPoints(fail);
    }
    return lowestByPoints(legal);
  }

  /* --- following --- */

  function followCard(state, p, legal, unseen) {
    var best = currentBest(state.trick);
    var pts = trickPoints(state.trick);
    var isLast = state.trick.length === state.config.numPlayers - 1;
    var prob = G.allyProb(state, p, best.player);
    var allyWinning = prob >= 0.55;
    var winners = legal.filter(function (c) { return C.beats(c, best.card); });
    var losers = legal.filter(function (c) { return !C.beats(c, best.card); });
    var lastTrick = isLastTrickOfHand(state, p);

    if (allyWinning) {
      // "Safe" means no card still unaccounted for — including my own — can beat it.
      var safe = isLast || isBoss(best.card, unseen.concat(state.players[p].hand));
      if (losers.length && (safe || pts >= 4)) return highestByPoints(losers);
      if (losers.length) {
        // Not confident the trick is theirs yet — feed a middling card, keep the ace.
        var modest = losers.filter(function (c) { return C.points(c) < 10; });
        return highestByPoints(modest.length ? modest : losers);
      }
      return lowestByPoints(legal);   // forced to overtake a friend
    }

    if (winners.length) {
      var take = cheapestWinner(winners);
      var gain = pts + C.points(take);
      var costlyTrump = C.isTrump(take) && C.power(take) >= C.power(C.get('JD'));
      var worth =
        lastTrick ||
        isLast && pts >= 4 ||
        !C.isTrump(take) ||                        // winning in suit costs nothing
        gain >= 10 ||
        (isBoss(take, unseen) && pts >= 4) ||
        (G.teamOf(state, p) === 'picker' && pts >= 7);
      if (costlyTrump && pts < 7 && !lastTrick && !isBoss(take, unseen)) worth = false;
      if (worth) return take;
    }

    if (losers.length) return lowestByPoints(losers);
    return lowestByPoints(legal);
  }

  /* --- leaster: take as few points as possible, but take one trick --- */

  function leasterCard(state, p, legal, unseen) {
    var me = state.players[p];
    var lastTrick = isLastTrickOfHand(state, p);
    var mustWin = lastTrick && me.tricksWon === 0;

    if (state.trick.length === 0) {
      if (mustWin) {
        var boss = legal.filter(function (c) { return isBoss(c, unseen); });
        if (boss.length) return lowestByPoints(boss);
      }
      var zero = legal.filter(function (c) { return C.points(c) === 0; });
      return (zero.length ? zero : legal).slice().sort(function (a, b) {
        return C.power(a) - C.power(b);
      })[0];
    }

    var best = currentBest(state.trick);
    var winners = legal.filter(function (c) { return C.beats(c, best.card); });
    var losers = legal.filter(function (c) { return !C.beats(c, best.card); });

    if (mustWin && winners.length) return cheapestWinner(winners);
    if (losers.length) return highestByPoints(losers);   // dump points on somebody else
    return lowestByPoints(winners.length ? winners : legal);
  }

  /* ---------------- driver ---------------- */

  function act(state) {
    var p = state.turn;
    if (state.phase === 'pick') {
      if (shouldPick(state, p)) SH.Game.doPick(state, p);
      else SH.Game.doPass(state, p);
    } else if (state.phase === 'bury') {
      SH.Game.doBury(state, p, chooseBury(state, p));
    } else if (state.phase === 'play') {
      SH.Game.doPlay(state, p, chooseCard(state, p));
    }
  }

  SH.AI = {
    act: act,
    shouldPick: shouldPick,
    chooseBury: chooseBury,
    chooseCard: chooseCard,
    handStrength: handStrength,
    unseenFor: unseenFor,
    isBoss: isBoss
  };
})(window);

/* Euchre - the computer players.
 *
 * TWO RULES GOVERN THIS FILE, and both are load-bearing rather than stylistic.
 *
 * 1. IT READS ONLY WHAT ITS OWN SEAT IS ENTITLED TO. Its own hand, the cards
 *    already played, the upcard everybody saw, the trump everybody was told, and
 *    — if it is the dealer — the card it discarded itself. It never looks at
 *    another seat's cards, and `tests/hidden-information.js` asserts that by
 *    running every hand with a trap on the other seats' hands.
 *
 *    This matters more online than off. In a single-player game a cheating AI is
 *    a quality problem; at a table where three of four seats might be computers
 *    it is the computer players colluding against the one person present.
 *
 * 2. IT ACTS THROUGH applyAction, NEVER THROUGH THE ENGINE DIRECTLY. The seat
 *    check lives in the gate, and a bot that reaches round it is a bot that can
 *    play somebody else's turn — which is exactly the bug the gate exists to
 *    prevent, arriving through the one caller nobody audits. If the gate refuses
 *    a bot's move that is a bug in here, and it throws rather than looping: the
 *    room catches it, says the table has stopped, and somebody gets told. A
 *    silent retry loop would be a hand that never advances and no error anywhere.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards, G = SH.Game;

  /* ---------------- valuing a hand ----------------
   *
   * All in "tricks I expect this card to be worth", roughly, so the numbers can
   * be reasoned about rather than tuned blind. A hand worth about two and a half
   * expected tricks is the break-even point for ordering: the makers need three
   * of five, and the partner is worth something.
   */
  function cardValue(c, trump) {
    var b = C.bower(c, trump);
    if (b === 'right') return 1.0;
    if (b === 'left') return 0.85;
    if (C.isTrump(c, trump)) {
      if (c.r === 'A') return 0.65;
      if (c.r === 'K') return 0.45;
      if (c.r === 'Q') return 0.30;
      return 0.20;                       // ten, nine: they still draw trump out
    }
    if (c.r === 'A') return 0.50;        // an off-suit ace usually takes a trick
    if (c.r === 'K') return 0.15;
    return 0.02;
  }

  /* What a hand is worth with a given suit as trump.
   *
   * Voids are counted, and only voids: a short suit is worth something because
   * it lets you trump in, and that is only true once you are actually out of it.
   * Counting doubletons as well made the computer order on rubbish, because
   * almost every five-card hand has one. */
  function handValue(cards, trump) {
    var total = 0, i;
    for (i = 0; i < cards.length; i++) total += cardValue(cards[i], trump);

    var have = {};
    for (i = 0; i < cards.length; i++) {
      have[C.effSuit(cards[i], trump)] = (have[C.effSuit(cards[i], trump)] || 0) + 1;
    }
    var trumpCount = have[trump] || 0;
    if (trumpCount > 0) {
      for (i = 0; i < C.SUITS.length; i++) {
        var s = C.SUITS[i];
        if (s === trump) continue;
        if (!have[s]) total += 0.22;     // void, and something to trump it with
      }
    }
    /* Four or five trump is worth more than the sum of its parts: you can draw
     * everything and the last two are winners by exhaustion. */
    if (trumpCount >= 4) total += 0.45;
    else if (trumpCount === 3) total += 0.15;
    return total;
  }

  function trumpCount(cards, trump) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) if (C.isTrump(cards[i], trump)) n++;
    return n;
  }

  function has(cards, pred) {
    for (var i = 0; i < cards.length; i++) if (pred(cards[i])) return true;
    return false;
  }

  /* ---------------- the bidding ---------------- */

  /* The two numbers that decide how often anybody bids at all, in expected
   * tricks. Exposed rather than buried so tests/balance.js can sweep them, and
   * because they are the only figures here that were arrived at by measurement
   * rather than by reasoning.
   *
   * `order` is lower than `call` on purpose. In round one somebody is about to
   * be handed a known card, so the position is better understood; by round two
   * everybody has passed once, which is real evidence that the hands around the
   * table are poor — and a suit named in round two has no upcard coming to
   * strengthen it.
   *
   * Tuned against tests/balance.js. Measured over 4,000 hands against hard
   * opponents: a suit is named on 94% of hands, the makers are euchred on 13% of
   * those, a march comes up on 14%, and the dealer's side makes trump 65% of the
   * time — which is the advantage the upcard is supposed to give them.
   *
   * The first draft used 2.55 and 2.80 and threw more than two hands in five
   * straight in the bin, which is not a game anybody would sit through. That is
   * the failure this pair of numbers is guarding against, and it is invisible
   * from any test that only checks the rules are obeyed. */
  var THRESHOLDS = { order: 2.00, call: 2.20 };

  /* How much a bid threshold moves for this difficulty, plus a little noise so
   * three computer seats at one table do not all make identical decisions from
   * identical positions. */
  function bidBias(difficulty) {
    if (difficulty === 'easy') return -0.45 + Math.random() * 0.5;     // bids on too little
    if (difficulty === 'hard') return (Math.random() - 0.5) * 0.12;
    return (Math.random() - 0.5) * 0.30;
  }

  /* Whether a hand is worth playing without a partner.
   *
   * Going alone pays four instead of two, and only for a march — three or four
   * tricks alone is worth the same single point it would have been worth with a
   * partner. So the question is not "will this hand make it" but "will this hand
   * take all five", and the cost of being wrong is losing the partner's tricks
   * as well as your own.
   *
   * Hence: a top trump, real length in it, and a hand that is already strong. An
   * earlier draft demanded the right bower specifically and a value of 3.75, and
   * went alone on one hand in a hundred — every one of which it made, which is
   * the signature of a threshold set so high it is only ever taking free money.
   * Both bowers, or the right bower and an ace, is the hand people actually
   * declare on. */
  function goAlone(cards, trump, value) {
    if (trumpCount(cards, trump) < 3) return false;
    var right = has(cards, function (c) { return C.bower(c, trump) === 'right'; });
    var left = has(cards, function (c) { return C.bower(c, trump) === 'left'; });
    var aceTrump = has(cards, function (c) { return C.isTrump(c, trump) && c.r === 'A'; });
    var top = (right && left) || (right && aceTrump) || (left && aceTrump);
    return top && value >= 3.10;
  }

  /* Round one. The upcard's suit is on offer, and the dealer gets the card.
   *
   * That last clause is the whole of round one strategy and the thing a naive
   * evaluator misses: the same hand is a clear order when your partner is
   * dealing and a clear pass when the seat on your left is, because the card
   * changes hands either way. A right bower going to an opponent is worth more
   * against you than most hands are worth for you. */
  function bidRound1(state, p) {
    var hand = state.players[p].hand;
    var trump = state.upcard.s;
    var value = handValue(hand, trump);
    var dealer = state.dealer;

    if (p === dealer) {
      /* We will hold the upcard and put our worst card back, so value the hand
       * as it will actually be, not as it is. */
      var withCard = hand.concat([state.upcard]);
      var worst = worstDiscard(withCard, trump, state);
      var kept = withCard.filter(function (c) { return c.id !== worst.id; });
      value = handValue(kept, trump);
    } else if (G.partnerOf(p) === dealer) {
      value += cardValue(state.upcard, trump) * 0.55;      // it helps our side
    } else {
      value -= cardValue(state.upcard, trump) * 0.75;      // it helps theirs
    }

    var bias = bidBias(state.config.difficulty);
    var order = value >= THRESHOLDS.order + bias;

    var alone = false;
    if (order && state.config.allowAlone !== false) {
      /* Judged on the hand as it will BE, not as it is. The dealer's upcard may
       * be the right bower, and a dealer who ordered the right bower up and then
       * declined to go alone because the bower was not yet in their hand would
       * be reading the wrong five cards. */
      var effective = p === dealer ? hand.concat([state.upcard]) : hand;
      alone = goAlone(effective, trump, value);
    }
    return order ? { type: 'order', alone: alone } : { type: 'pass' };
  }

  /* Round two. Any suit but the one turned down. */
  function bidRound2(state, p) {
    var hand = state.players[p].hand;
    var best = null;
    for (var i = 0; i < C.SUITS.length; i++) {
      var s = C.SUITS[i];
      if (s === state.deniedSuit) continue;
      var v = handValue(hand, s);
      /* CALLING NEXT. The turned-down suit's own colour is the suit to prefer:
       * everybody just declined the upcard, which is weak evidence that its
       * bowers are not out there — and the left bower of "next" is the jack of
       * the turned-down suit, which nobody wanted to be holding. Small, and
       * real. */
      if (s === C.SAME_COLOUR[state.deniedSuit]) v += 0.18;
      if (!best || v > best.value) best = { suit: s, value: v };
    }
    if (!best) return { type: 'pass' };

    var forced = p === state.dealer && state.config.stickTheDealer;
    var bias = bidBias(state.config.difficulty);
    /* Higher than round one: nobody gets a card, and having passed once already
     * everybody has told you something about their hand. */
    if (!forced && best.value < THRESHOLDS.call + bias) return { type: 'pass' };

    var alone = state.config.allowAlone !== false && goAlone(hand, best.suit, best.value);
    return { type: 'call', suit: best.suit, alone: alone };
  }

  /* ---------------- the discard ----------------
   *
   * Void yourself if you can do it cheaply, otherwise throw the lowest card you
   * hold. Never throw trump, and never throw an off-suit ace to make a void —
   * the ace is usually a trick and the void is usually worth less than one.
   */
  function worstDiscard(cards, trump, state) {
    var counts = {};
    cards.forEach(function (c) {
      var s = C.effSuit(c, trump);
      counts[s] = (counts[s] || 0) + 1;
    });

    var best = null;
    cards.forEach(function (c) {
      if (C.isTrump(c, trump)) return;                 // never put trump back
      var score = cardValue(c, trump);
      /* A singleton that is not an ace is the cheapest void available, so it is
       * worth a small discount rather than a large one — the void only pays if
       * we still hold trump to use it with. */
      if (counts[C.effSuit(c, trump)] === 1 && c.r !== 'A') score -= 0.12;
      if (!best || score < best.score) best = { card: c, score: score };
    });

    /* A hand of nothing but trump. Rare, excellent, and it still has to put one
     * back: the lowest trump. */
    if (!best) {
      var low = cards.slice().sort(function (a, b) {
        return C.power(a, trump) - C.power(b, trump);
      })[0];
      return low;
    }
    return best.card;
  }

  /* ---------------- playing a card ---------------- */

  /* Cards this seat has not seen: the whole deck, less its own hand, less
   * everything played, less the upcard if its whereabouts are known, less its
   * own discard. Public information and its own, and nothing else. */
  function unseenFor(state, p) {
    var seen = {};
    state.players[p].hand.forEach(function (c) { seen[c.id] = 1; });
    state.played.forEach(function (c) { seen[c.id] = 1; });
    state.trick.forEach(function (t) { seen[t.card.id] = 1; });
    /* A turned-down upcard is out of play and everybody watched it go. One that
     * was taken up is in the dealer's hand, which is not the same as unseen, but
     * for "what might beat me" purposes it is accounted for either way. */
    if (state.upcard && state.upcardStatus !== 'none') seen[state.upcard.id] = 1;
    if (p === state.dealer && state.discard) seen[state.discard.id] = 1;
    return C.newDeck().filter(function (c) { return !seen[c.id]; });
  }

  function highest(cards, trump) {
    return cards.slice().sort(function (a, b) { return C.power(b, trump) - C.power(a, trump); })[0];
  }
  function lowest(cards, trump) {
    return cards.slice().sort(function (a, b) { return C.power(a, trump) - C.power(b, trump); })[0];
  }

  /* The cheapest card to throw away when this trick is lost or already won.
   * Off-suit first, lowest first, and hold trump back — trump thrown away is a
   * trick given away later. */
  function throwAway(cards, trump) {
    var off = cards.filter(function (c) { return !C.isTrump(c, trump); });
    if (off.length) {
      /* Keep aces, and keep the last card of a suit you might otherwise still
       * guard. Sorting by value rather than by rank is what stops it pitching an
       * off-suit ace to keep a nine. */
      return off.slice().sort(function (a, b) {
        return cardValue(a, trump) - cardValue(b, trump);
      })[0];
    }
    return lowest(cards, trump);
  }

  /* Is the trick currently being won by my partner? */
  function partnerWinning(state, p) {
    if (!state.trick.length) return false;
    var wi = G.trickWinnerIndex(state.trick, state.trump);
    return state.trick[wi].player === G.partnerOf(p);
  }

  /* Can anybody still to play in this trick beat what is winning it?
   *
   * Answered from unseen cards and from who has yet to play, never by looking at
   * their hands. Wrong sometimes, which is the point: a player who is never
   * wrong about this is a player who is cheating. */
  function safeToDuck(state, p) {
    var yetToPlay = G.activeCount(state) - state.trick.length - 1;
    if (yetToPlay <= 0) return true;
    if (!state.trick.length) return false;
    var wi = G.trickWinnerIndex(state.trick, state.trump);
    var winning = state.trick[wi].card;
    var unseen = unseenFor(state, p);
    var led = C.effSuit(state.trick[0].card, state.trump);
    var beaters = unseen.filter(function (c) {
      if (C.isTrump(c, state.trump)) return C.beats(c, winning, state.trump);
      return C.effSuit(c, state.trump) === led && C.beats(c, winning, state.trump);
    });
    return beaters.length === 0;
  }

  function chooseLead(state, p) {
    var hand = state.players[p].hand;
    var trump = state.trump;
    var mine = hand.filter(function (c) { return C.isTrump(c, trump); });
    var off = hand.filter(function (c) { return !C.isTrump(c, trump); });
    var iAmMaker = G.teamOf(p) === G.teamOf(state.maker);

    /* The makers lead trump to draw it out, provided they have enough of it that
     * running out first is not the likely outcome. Holding the right bower and
     * three trump, leading it is nearly always right. */
    if (iAmMaker && mine.length >= 3) return highest(mine, trump);
    if (iAmMaker && has(mine, function (c) { return C.bower(c, trump) === 'right'; }) && mine.length >= 2) {
      return highest(mine, trump);
    }

    /* Otherwise cash an off-suit ace while it is still good. */
    var aces = off.filter(function (c) { return c.r === 'A'; });
    if (aces.length) return aces[0];

    /* Defending, with the right bower and nothing else to do: take it out from
     * under whoever is counting on it. */
    if (!iAmMaker && has(mine, function (c) { return C.bower(c, trump) === 'right'; }) && mine.length >= 3) {
      return highest(mine, trump);
    }

    if (off.length) {
      /* Lead from a short suit rather than a long one: it gets us void sooner.
       * Among equals, the lowest card. */
      var counts = {};
      off.forEach(function (c) { counts[c.s] = (counts[c.s] || 0) + 1; });
      return off.slice().sort(function (a, b) {
        if (counts[a.s] !== counts[b.s]) return counts[a.s] - counts[b.s];
        return C.power(a, trump) - C.power(b, trump);
      })[0];
    }
    return lowest(mine, trump);
  }

  function chooseFollow(state, p) {
    var trump = state.trump;
    var legal = G.legalPlays(state, p);
    var wi = G.trickWinnerIndex(state.trick, state.trump);
    var winning = state.trick[wi].card;
    var winners = legal.filter(function (c) { return C.beats(c, winning, trump); });
    var last = state.trick.length === G.activeCount(state) - 1;

    if (partnerWinning(state, p)) {
      /* Partner has it. Do not overtrump your own side; throw the cheapest thing
       * that is not trump — unless partner's card is weak and somebody after us
       * is likely to take it anyway. */
      if (last || safeToDuck(state, p)) return throwAway(legal, trump);
      if (winners.length) return lowest(winners, trump);
      return throwAway(legal, trump);
    }

    if (!winners.length) return throwAway(legal, trump);

    /* Playing last, take it as cheaply as possible. */
    if (last) return lowest(winners, trump);

    /* Somebody is still to play. Winning cheaply invites being overtrumped, so
     * take it with something that will hold up: the lowest card that nothing
     * unseen beats, or failing that the highest we have. */
    var unseen = unseenFor(state, p);
    var led = C.effSuit(state.trick[0].card, trump);
    var ranked = winners.slice().sort(function (a, b) { return C.power(a, trump) - C.power(b, trump); });
    for (var i = 0; i < ranked.length; i++) {
      var cand = ranked[i];
      var beatable = false;
      for (var u = 0; u < unseen.length; u++) {
        var o = unseen[u];
        if (C.isTrump(o, trump) ? C.beats(o, cand, trump)
          : (C.effSuit(o, trump) === led && C.beats(o, cand, trump))) { beatable = true; break; }
      }
      if (!beatable) return cand;
    }
    return highest(winners, trump);
  }

  function chooseCard(state, p) {
    var legal = G.legalPlays(state, p);
    if (!legal.length) return null;

    /* Easy opponents throw a legal card at random some of the time. Deliberately
     * a legal one: an opponent who revokes is not an easier opponent, it is a
     * broken game. */
    if (state.config.difficulty === 'easy' && Math.random() < 0.30) {
      return legal[Math.floor(Math.random() * legal.length)].id;
    }
    if (state.config.difficulty === 'normal' && Math.random() < 0.10) {
      return legal[Math.floor(Math.random() * legal.length)].id;
    }

    var pick = state.trick.length ? chooseFollow(state, p) : chooseLead(state, p);
    /* Belt and braces. Everything above is written to return a legal card and
     * this has never fired, but a bot that plays an illegal card gets its move
     * refused by the gate, and AI.act turns a refusal into a thrown error that
     * wedges the room for four people. Falling back to a legal card is a much
     * better failure than that. */
    if (!pick || !legal.some(function (c) { return c.id === pick.id; })) {
      pick = legal[0];
    }
    return pick.id;
  }

  /* ---------------- taking a turn ---------------- */

  /* Which seat, if any, is being asked to act. The engine owns this question —
   * see G.seatToAct — and re-deriving it here is how the room's idea of whose
   * move it is drifts away from the engine's. */
  var seatToAct = G.seatToAct;

  function decide(state, p) {
    switch (state.phase) {
      case 'bid1': return bidRound1(state, p);
      case 'bid2': return bidRound2(state, p);
      case 'discard':
        return { type: 'discard', card: worstDiscard(state.players[p].hand, state.trump, state).id };
      case 'play': {
        var id = chooseCard(state, p);
        return id ? { type: 'play', card: id } : null;
      }
    }
    return null;
  }

  /* Take one turn for whoever is on it. Returns the seat acted for, or -1.
   *
   * Throws if the gate refuses. See the note at the top of this file: a refused
   * bot move is a bug in here, and a table that quietly retries it is a table
   * that has stopped with nothing said. */
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
    THRESHOLDS: THRESHOLDS,
    act: act,
    decide: decide,
    seatToAct: seatToAct,
    chooseCard: chooseCard,
    handValue: handValue,
    cardValue: cardValue,
    worstDiscard: worstDiscard,
    unseenFor: unseenFor
  };
})(typeof window !== 'undefined' ? window : globalThis);

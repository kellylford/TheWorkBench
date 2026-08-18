/* Sheephead - rules engine. No DOM access lives in here.
 *
 * The engine is a small state machine driven by four actions: doPick, doPass,
 * doBury and doPlay. Every action appends human-readable entries to state.events,
 * which the UI drains for the log and for screen-reader announcements.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  /* Table sizes. Four players needs 30 cards to leave a two-card blind, so the
   * two lowest trump come out; they are worth nothing, so a hand is still 120
   * points at every table size. A four-card blind was tried instead and gave the
   * picker a decisive edge — burying four cards voids two suits and stashes
   * roughly twenty points. */
  var DEAL = {
    3: { hand: 10, blind: 2, partner: false, exclude: [] },
    4: { hand: 7, blind: 2, partner: true, exclude: ['7D', '8D'] },
    5: { hand: 6, blind: 2, partner: true, exclude: [] },
    6: { hand: 5, blind: 2, partner: true, exclude: [] }
  };

  function deckFor(n) { return C.newDeck(DEAL[n].exclude); }

  var PARTNER_CARD = 'JD';

  function createGame(config) {
    var n = config.numPlayers;
    var players = [];
    for (var i = 0; i < n; i++) {
      players.push({
        index: i,
        name: config.names[i],
        /* Who is sitting here, rather than whether this is "the" human.
         *
         * isHuman was a boolean that was true for exactly one seat, and the
         * engine used it for two different jobs: deciding whose point of view a
         * message is written from, and deciding whether a seat is played by the
         * computer. Those come apart the moment more than one person is at the
         * table — every seat is human, and the question that still matters is
         * whether anybody is currently in it.
         *
         * 'human' | 'bot' | 'away'. A seat whose player has dropped becomes
         * 'away' and is played by the AI until they return, which is why this is
         * not simply a boolean the other way round. */
        occupant: i === 0 ? 'human' : 'bot',
        hand: [],
        tricksWon: 0,
        points: 0,
        score: 0
      });
    }
    return {
      config: config,
      players: players,
      dealer: -1,
      handNumber: 0,
      phase: 'idle',
      turn: 0,
      blind: [],
      buried: [],
      picker: -1,
      partner: -1,
      alone: false,
      partnerRevealed: false,
      isLeaster: false,
      passCount: 0,
      trick: [],
      leader: 0,
      lastTrick: null,
      played: [],
      result: null,
      events: [],
      history: [],      // one audited record per completed hand
      dealt: null,
      pickLog: [],
      pickedUp: [],
      trickLog: [],
      doublers: [],
      redealDoubler: false,
      nextHandDoubler: false,
      revealInfo: null
    };
  }

  function deal(state) {
    var n = state.config.numPlayers;
    var d = DEAL[n];
    var deck = C.shuffle(deckFor(n));
    var pos = 0;
    for (var i = 0; i < n; i++) {
      state.players[i].hand = C.sortHand(deck.slice(pos, pos + d.hand));
      state.players[i].tricksWon = 0;
      state.players[i].points = 0;
      pos += d.hand;
    }
    state.blind = deck.slice(pos, pos + d.blind);
    // Snapshot the deal so a finished hand can be reconstructed exactly.
    state.dealt = {
      hands: state.players.map(function (p) { return C.ids(p.hand); }),
      blind: C.ids(state.blind)
    };
  }

  function newHand(state) {
    var n = state.config.numPlayers;
    state.handNumber++;
    // The very first dealer is drawn at random, then the deal rotates. Otherwise
    // the player would always deal the opening hand, which also means always
    // deciding on the blind last.
    state.dealer = state.dealer < 0
      ? Math.floor(Math.random() * n)
      : (state.dealer + 1) % n;
    state.buried = [];
    state.picker = -1;
    state.partner = -1;
    state.alone = false;
    state.partnerRevealed = false;
    state.isLeaster = false;
    state.passCount = 0;
    state.trick = [];
    state.lastTrick = null;
    state.played = [];
    state.result = null;
    state.pickLog = [];
    state.pickedUp = [];
    state.trickLog = [];
    state.doublers = [];
    // A redeal doubles the hand that follows it; it does not compound.
    state.redealDoubler = !!state.nextHandDoubler;
    state.nextHandDoubler = false;
    state.revealInfo = null;
    deal(state);
    state.phase = 'pick';
    state.leader = (state.dealer + 1) % n;
    state.turn = state.leader;
    ev(state, 'info', 'Hand ' + state.handNumber + '. ' + nameOf(state, state.dealer) + vb(state, state.dealer, ' deals.', ' deal.'));
    return state;
  }

  function ev(state, kind, text, extra) {
    var e = { kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.events.push(e);
    return e;
  }

  /* An event only one seat may see.
   *
   * The engine used to say private things by appending them to a public string
   * when the seat happened to be the human one — see assignPartner and
   * computeDoublers below, both of which did exactly that. It worked because
   * there was only ever one human, so "the human" and "the seat this concerns"
   * were the same seat and nobody else was reading the log anyway.
   *
   * Online, every seat is human. That construction would have emitted one
   * private sentence per player into shared state, each telling everyone else
   * something. And because public and private were concatenated into a single
   * string, no amount of filtering downstream could separate them — you cannot
   * withhold half a sentence.
   *
   * So: a private event is addressed to a SEAT, never to "the human", and it is
   * its own event. The projection layer sends it only to that seat and strips
   * the `audience` key on the way out, since the mere presence of a targeted
   * event tells a bystander that something private happened. */
  function evTo(state, seat, kind, text, extra) {
    var e = ev(state, kind, text, extra);
    e.audience = seat;
    return e;
  }

  /* The events one seat is entitled to: everything public, plus anything
   * addressed to it, with the address removed.
   *
   * Stripping `audience` is not tidiness. A targeted event that still carried
   * its address would tell the seat receiving it nothing new, but the shape of
   * the list would tell a bystander that a private event exists — and when it
   * was emitted is itself information. assignPartner fires one immediately after
   * the picker is known, so "there was a private event just then" narrows down
   * what it was about. The recipient gets a plain event; everybody else never
   * learns one was sent. */
  function eventsFor(state, seat) {
    var out = [];
    for (var i = 0; i < state.events.length; i++) {
      var e = state.events[i];
      if (e.audience !== undefined && e.audience !== seat) continue;
      var copy = {};
      for (var k in e) if (k !== 'audience') copy[k] = e[k];
      out.push(copy);
    }
    return out;
  }

  function nameOf(state, i) { return state.players[i].name; }

  /* Keeps messages grammatical when the player has left their name as "You". */
  function vb(state, i, third, second) {
    return state.players[i].name.toLowerCase() === 'you' ? second : third;
  }

  /* ---------------- picking ---------------- */

  function doPick(state, p) {
    if (state.phase !== 'pick' || state.turn !== p) return false;
    var d = DEAL[state.config.numPlayers];
    state.picker = p;
    var pl = state.players[p];
    // The blind goes to the front of the hand, unsorted, so the picker can see
    // at a glance what they just took. The hand is sorted properly after burying.
    state.pickedUp = C.ids(state.blind);
    pl.hand = state.blind.concat(C.sortHand(pl.hand));
    state.pickLog.push({ player: p, action: 'pick' });
    ev(state, 'pick', nameOf(state, p) + vb(state, p, ' picks', ' pick') + ' up the blind (' + d.blind + ' cards).');
    state.blind = [];
    state.phase = 'bury';
    state.turn = p;
    return true;
  }

  function doPass(state, p) {
    if (state.phase !== 'pick' || state.turn !== p) return false;
    var n = state.config.numPlayers;
    state.pickLog.push({ player: p, action: 'pass' });
    ev(state, 'pass', nameOf(state, p) + vb(state, p, ' passes.', ' pass.'));
    state.passCount++;
    if (state.passCount >= n) {
      if (state.config.allPass === 'leaster') {
        state.isLeaster = true;
        state.phase = 'play';
        state.leader = (state.dealer + 1) % n;
        state.turn = state.leader;
        ev(state, 'info', 'Everyone passed. This hand is a leaster: no picker, everyone plays for themselves, ' +
          'and the fewest points wins. You must take at least one trick to win. ' +
          'The blind goes to whoever takes the last trick.');
        computeDoublers(state);
      } else {
        var willDouble = !!state.config.redealDoubler;
        if (willDouble) state.nextHandDoubler = true;
        ev(state, 'info', 'Everyone passed. Redealing.' +
          (willDouble ? ' The next hand is a doubler, worth twice as much.' : ''));
        newHand(state);
      }
    } else {
      state.turn = (p + 1) % n;
    }
    return true;
  }

  /* ---------------- burying ---------------- */

  /* Takes an actor, like the other three actions, and this is not tidiness.
   *
   * It used to be doBury(state, cardIds) and checked only the phase, then acted
   * on state.players[state.picker] regardless of who asked. Single-player never
   * noticed: the only caller that could reach it was the one seat a person sits
   * in. Online it means any connected client can bury another player's cards,
   * which is not a bug in the bury path so much as a hole straight through the
   * authoritative-server premise — the server would be faithfully applying a
   * move it never checked the sender was entitled to make.
   *
   * Three review passes looked at this file and missed it, because they were all
   * asking what information leaks OUT and none was asking who is allowed to act. */
  function doBury(state, p, cardIds) {
    if (state.phase !== 'bury' || state.picker !== p) return false;
    var d = DEAL[state.config.numPlayers];
    if (!cardIds || cardIds.length !== d.blind) return false;
    /* Validate the whole list before the hand changes at all.
     *
     * This used to splice each card out as it was found and `return false` on the
     * first one it could not find — so a bury of [a good card, a bad id] removed
     * the good card, threw away the array it had collected, and left the picker
     * permanently one card short in a phase that requires an exact count. The
     * card was not misfiled; it ceased to exist.
     *
     * Unreachable from the single-player UI, which only ever submits ids taken
     * from the hand it just rendered. Trivially reachable from a network message,
     * which is the whole reason this pass exists. A rejected action must leave
     * the game exactly as it found it.
     *
     * The idxs.indexOf(j) check also rejects the same card named twice, which the
     * old loop turned into the same destructive partial write. */
    var pl = state.players[state.picker];
    var idxs = [];
    for (var i = 0; i < cardIds.length; i++) {
      var idx = -1;
      for (var j = 0; j < pl.hand.length; j++) {
        if (pl.hand[j].id === cardIds[i] && idxs.indexOf(j) < 0) { idx = j; break; }
      }
      if (idx < 0) return false;
      idxs.push(idx);
    }
    // Every card is known good, so the hand may now change. Remove from the back
    // so the earlier indices stay valid, then restore the caller's order.
    var removed = {};
    idxs.slice().sort(function (a, b) { return b - a; })
      .forEach(function (j) { removed[j] = pl.hand.splice(j, 1)[0]; });
    var chosen = idxs.map(function (j) { return removed[j]; });
    state.buried = chosen;
    pl.hand = C.sortHand(pl.hand);   // back to normal order now the choice is made
    state.pickedUp = [];
    ev(state, 'bury', nameOf(state, state.picker) + vb(state, state.picker, ' buries ', ' bury ') + d.blind + ' cards.');

    assignPartner(state);
    computeDoublers(state);

    state.phase = 'play';
    state.leader = (state.dealer + 1) % state.config.numPlayers;
    state.turn = state.leader;
    return true;
  }

  /* state.alone is the ground truth and must stay private: whether the picker
   * kept or buried the Jack of Diamonds is nobody else's business until the card
   * shows up, or until the hand is scored. state.partnerRevealed gates that.
   * The only exception is a table with no partner card at all, where playing
   * alone is a rule everyone knows in advance. */
  function assignPartner(state) {
    var d = DEAL[state.config.numPlayers];
    var picker = state.picker;
    if (!d.partner) {
      state.alone = true;
      state.partner = -1;
      state.partnerRevealed = true;
      ev(state, 'info', nameOf(state, picker) + vb(state, picker, ' is', ' are') + ' the picker and ' +
        vb(state, picker, 'plays', 'play') + ' alone.');
      return;
    }

    var holder = -1;
    for (var i = 0; i < state.players.length; i++) {
      if (hasCard(state.players[i].hand, PARTNER_CARD)) { holder = i; break; }
    }
    var buriedPartnerCard = hasCard(state.buried, PARTNER_CARD);
    if (holder === picker || buriedPartnerCard || holder === -1) {
      state.alone = true;
      state.partner = -1;
    } else {
      state.alone = false;
      state.partner = holder;
    }
    state.partnerRevealed = false;

    // Deliberately identical wording either way, so the log gives nothing away.
    ev(state, 'info', nameOf(state, picker) + vb(state, picker, ' is', ' are') +
      ' the picker. The Jack of Diamonds is the partner card.');

    // And what only the picker is told. Unconditional now: it is addressed to
    // the picker's seat rather than emitted when the picker happens to be human,
    // because online that condition is true for everyone.
    evTo(state, picker, 'info', state.alone
      ? 'You have the Jack of Diamonds yourself, so you are playing alone — nobody else knows that yet.'
      : 'Somebody else holds it and is your secret partner.');
  }

  function hasCard(cards, id) {
    for (var i = 0; i < cards.length; i++) if (cards[i].id === id) return true;
    return false;
  }

  /* ---------------- doublers ---------------- */

  var QUEEN_PAIRS = [
    { kind: 'black', cards: ['QC', 'QS'], text: 'both black queens' },
    { kind: 'red', cards: ['QH', 'QD'], text: 'both red queens' }
  ];

  /* A pair only counts in one player's own hand, and only once the hands are
   * final — the picker's changes when they bury. Each pair found doubles the
   * hand, so a player holding all four queens doubles it twice.
   *
   * Who holds what is private until scoring, exactly like the partner card. The
   * only thing said out loud is to the player about their own hand. */
  function computeDoublers(state) {
    state.doublers = [];
    for (var q = 0; q < QUEEN_PAIRS.length; q++) {
      var pair = QUEEN_PAIRS[q];
      if (!state.config[pair.kind === 'black' ? 'blackQueenDoubler' : 'redQueenDoubler']) continue;
      for (var i = 0; i < state.players.length; i++) {
        var hand = state.players[i].hand;
        if (hasCard(hand, pair.cards[0]) && hasCard(hand, pair.cards[1])) {
          state.doublers.push({ kind: pair.kind, player: i, text: pair.text });
          evTo(state, i, 'info', 'You hold ' + pair.text + ', so this hand counts double.');
          break;   // a pair can only sit in one hand
        }
      }
    }
  }

  /* Everything that multiplies this hand, including the redeal doubler. */
  function doublerList(state) {
    var out = state.doublers.slice();
    if (state.redealDoubler) out.push({ kind: 'redeal', player: -1, text: 'the redeal' });
    return out;
  }

  function doublerFactor(state) {
    return Math.pow(2, doublerList(state).length);
  }

  function doublerText(state) {
    var list = doublerList(state);
    if (!list.length) return '';
    var bits = list.map(function (dbl) {
      return dbl.player >= 0 ? nameOf(state, dbl.player) + ' held ' + dbl.text : dbl.text;
    });
    return ' Doubled by ' + bits.join(' and ') + ', so the hand is worth ' +
      doublerFactor(state) + ' times.';
  }

  /* ---------------- playing ---------------- */

  function legalPlays(state, p) {
    var hand = state.players[p].hand;
    if (state.trick.length === 0) return hand.slice();
    var led = C.effSuit(state.trick[0].card);
    var match = hand.filter(function (c) { return C.effSuit(c) === led; });
    return match.length ? match : hand.slice();
  }

  function isLegal(state, p, cardId) {
    var legal = legalPlays(state, p);
    for (var i = 0; i < legal.length; i++) if (legal[i].id === cardId) return true;
    return false;
  }

  /* Why a card cannot be played right now, phrased for a person. */
  function illegalReason(state, p, cardId) {
    if (state.trick.length === 0) return '';
    var led = C.effSuit(state.trick[0].card);
    var what = led === 'T' ? 'trump' : C.SUIT_NAME[led];
    return 'You must follow ' + what + '.';
  }

  function trickWinnerIndex(plays) {
    var best = 0;
    for (var i = 1; i < plays.length; i++) {
      if (C.beats(plays[i].card, plays[best].card)) best = i;
    }
    return best;
  }

  function doPlay(state, p, cardId) {
    if (state.phase !== 'play' || state.turn !== p) return false;
    if (!isLegal(state, p, cardId)) return false;
    var pl = state.players[p];
    var idx = -1;
    for (var i = 0; i < pl.hand.length; i++) if (pl.hand[i].id === cardId) { idx = i; break; }
    if (idx < 0) return false;
    var card = pl.hand.splice(idx, 1)[0];
    state.trick.push({ player: p, card: card });
    state.played.push(card);

    var opening = nameOf(state, p) + vb(state, p, ' plays ', ' play ');
    var text = opening + C.describe(card) + '.';
    var plain = opening + C.name(card) + '.';
    // The partner card hitting the table is what makes the sides public. If the
    // picker plays it themselves, that is the moment everyone learns they are alone.
    if (card.id === PARTNER_CARD && !state.partnerRevealed && !state.isLeaster &&
        DEAL[state.config.numPlayers].partner) {
      state.partnerRevealed = true;
      state.revealInfo = { trick: state.trickLog.length + 1, player: p, alone: p === state.picker };
      var reveal = p === state.picker
        ? ' That is the picker\'s own partner card, so ' + nameOf(state, p) +
          vb(state, p, ' is', ' are') + ' playing alone.'
        : ' ' + nameOf(state, p) + vb(state, p, ' is', ' are') + ' the picker\'s partner.';
      text += reveal;
      plain += reveal;
    }
    ev(state, 'play', text, { player: p, card: card.id, textPlain: plain });

    if (state.trick.length === state.config.numPlayers) resolveTrick(state);
    else state.turn = (p + 1) % state.config.numPlayers;
    return true;
  }

  function resolveTrick(state) {
    var plays = state.trick.slice();
    var wi = trickWinnerIndex(plays);
    var winner = plays[wi].player;
    var pts = C.sumPoints(plays.map(function (x) { return x.card; }));
    var isFinal = state.players[winner].hand.length === 0;

    var extra = 0;
    if (isFinal && state.isLeaster && state.blind.length) {
      extra = C.sumPoints(state.blind);
      state.blind = [];   // consumed: those points now belong to the trick winner
    }

    state.players[winner].tricksWon++;
    state.players[winner].points += pts + extra;

    state.lastTrick = { plays: plays, winner: winner, points: pts + extra };
    state.trickLog.push({
      plays: plays.map(function (x) { return { player: x.player, card: x.card.id }; }),
      winner: winner,
      points: pts + extra,
      fromBlind: extra
    });
    state.trick = [];
    state.turn = winner;
    state.leader = winner;

    var msg = nameOf(state, winner) + vb(state, winner, ' takes', ' take') + ' the trick, ' + (pts + extra) + ' points.';
    if (extra) msg += ' That includes ' + extra + ' points from the blind.';
    ev(state, 'trick', msg, { winner: winner, points: pts + extra });

    if (isFinal) endHand(state);
  }

  /* ---------------- scoring ---------------- */

  function endHand(state) {
    state.phase = 'handOver';
    state.partnerRevealed = true;   // scoring makes the sides public either way
    state.result = state.isLeaster ? scoreLeaster(state) : scoreNormal(state);
    for (var i = 0; i < state.players.length; i++) {
      state.players[i].score += state.result.deltas[i];
    }
    ev(state, 'score', state.result.summary);

    var record = recordHand(state);
    state.history.push(record);
    if (record.problems.length) {
      ev(state, 'error', 'Accounting problem in hand ' + record.handNumber + ': ' +
        record.problems.join(' ') + ' Please export the game log so this can be looked at.');
    }
  }

  function recordHand(state) {
    var n = state.config.numPlayers;
    var rec = {
      handNumber: state.handNumber,
      numPlayers: n,
      dealer: state.dealer,
      names: state.players.map(function (p) { return p.name; }),
      dealt: state.dealt,
      pickLog: state.pickLog.slice(),
      picker: state.picker,
      partner: state.partner,
      alone: state.alone,
      isLeaster: state.isLeaster,
      buried: C.ids(state.buried),
      buriedPts: C.sumPoints(state.buried),
      blindLeft: C.ids(state.blind),
      revealInfo: state.revealInfo,
      tricks: state.trickLog.slice(),
      points: state.players.map(function (p) { return p.points; }),
      tricksWon: state.players.map(function (p) { return p.tricksWon; }),
      result: state.result,
      scoresAfter: state.players.map(function (p) { return p.score; })
    };
    rec.problems = auditHand(rec);
    return rec;
  }

  /* Independent re-check of a finished hand. This does not trust the running
   * totals: it re-adds the card values straight from the recorded tricks. */
  function auditHand(rec) {
    var problems = [];
    var d = DEAL[rec.numPlayers];

    // Every card dealt, exactly once, and the deck is the right one.
    var all = [];
    rec.dealt.hands.forEach(function (h) { all = all.concat(h); });
    all = all.concat(rec.dealt.blind);
    var expect = C.ids(deckFor(rec.numPlayers)).sort().join(' ');
    if (all.slice().sort().join(' ') !== expect) problems.push('The deal does not match the deck.');

    // Points taken, recomputed from the tricks themselves.
    var byPlayer = new Array(rec.numPlayers).fill(0);
    var playedIds = [];
    rec.tricks.forEach(function (t) {
      var sum = 0;
      t.plays.forEach(function (pl) {
        playedIds.push(pl.card);
        sum += C.points(C.get(pl.card));
      });
      if (sum + t.fromBlind !== t.points) {
        problems.push('Trick points do not add up (' + sum + ' plus ' + t.fromBlind + ' from the blind is not ' + t.points + ').');
      }
      byPlayer[t.winner] += t.points;
    });

    if (rec.tricks.length !== d.hand) {
      problems.push('Expected ' + d.hand + ' tricks but recorded ' + rec.tricks.length + '.');
    }
    if (playedIds.length !== rec.numPlayers * d.hand) {
      problems.push('Expected ' + (rec.numPlayers * d.hand) + ' cards played but recorded ' + playedIds.length + '.');
    }
    if (new Set(playedIds).size !== playedIds.length) problems.push('A card was played more than once.');

    for (var i = 0; i < rec.numPlayers; i++) {
      if (byPlayer[i] !== rec.points[i]) {
        problems.push('Recorded points for ' + rec.names[i] + ' (' + rec.points[i] +
          ') do not match the tricks they took (' + byPlayer[i] + ').');
      }
    }

    var taken = rec.points.reduce(function (a, b) { return a + b; }, 0);
    var total = taken + rec.buriedPts + C.sumPoints(rec.blindLeft.map(C.get));
    if (total !== C.TOTAL_POINTS) {
      problems.push('Points do not total ' + C.TOTAL_POINTS + ': ' + taken + ' taken plus ' +
        rec.buriedPts + ' buried plus ' + C.sumPoints(rec.blindLeft.map(C.get)) + ' left in the blind is ' + total + '.');
    }

    var sum = rec.result.deltas.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== 0) problems.push('Score changes are not zero sum (they total ' + sum + ').');

    if (!rec.isLeaster) {
      var pickerPts = rec.buriedPts + rec.points[rec.picker] +
        (!rec.alone && rec.partner >= 0 ? rec.points[rec.partner] : 0);
      if (pickerPts !== rec.result.pickerPts) {
        problems.push('The picker total in the summary (' + rec.result.pickerPts +
          ') does not match the tricks and bury (' + pickerPts + ').');
      }
      if (rec.result.pickerPts + rec.result.oppPts !== C.TOTAL_POINTS) {
        problems.push('The two sides in the summary total ' +
          (rec.result.pickerPts + rec.result.oppPts) + ', not ' + C.TOTAL_POINTS + '.');
      }
    }
    return problems;
  }

  function scoreLeaster(state) {
    var n = state.config.numPlayers;
    var deltas = new Array(n).fill(0);
    var best = -1;
    for (var i = 0; i < n; i++) {
      var pl = state.players[i];
      if (pl.tricksWon === 0) continue;
      if (best < 0) { best = i; continue; }
      var b = state.players[best];
      if (pl.points < b.points || (pl.points === b.points && pl.tricksWon < b.tricksWon)) best = i;
    }
    if (best < 0) best = 0;
    var lf = doublerFactor(state);
    for (var j = 0; j < n; j++) deltas[j] = (j === best ? (n - 1) : -1) * lf;

    var lines = state.players.map(function (p) {
      return p.name + ' ' + p.points + (p.tricksWon === 0 ? ' (no tricks, not eligible)' : '');
    }).join(', ');

    // The blind was never picked up, so nobody has seen it until now.
    var blindText = '';
    if (state.dealt && state.dealt.blind.length) {
      var cards = state.dealt.blind.map(function (id) { return C.get(id); });
      var last = state.trickLog.length ? state.trickLog[state.trickLog.length - 1] : null;
      blindText = ' The blind held ' + cards.map(function (c) { return C.name(c); }).join(' and ') +
        ', worth ' + C.sumPoints(cards) + ', and went to ' +
        (last ? nameOf(state, last.winner) : 'the last trick') + ' with the last trick.';
    }

    return {
      leaster: true,
      winners: [best],
      deltas: deltas,
      factor: lf,
      summary: 'Leaster result: ' + lines + '.' + blindText + ' ' + state.players[best].name +
        ' takes the fewest points and wins, ' + ((n - 1) * lf) + ' points.' + doublerText(state)
    };
  }

  function scoreNormal(state) {
    var n = state.config.numPlayers;
    var buriedPts = C.sumPoints(state.buried);
    var pickerTeam = [state.picker];
    if (!state.alone && state.partner >= 0) pickerTeam.push(state.partner);

    var pickerPts = buriedPts;
    var pickerTricks = 0;
    for (var i = 0; i < pickerTeam.length; i++) {
      pickerPts += state.players[pickerTeam[i]].points;
      pickerTricks += state.players[pickerTeam[i]].tricksWon;
    }
    var oppPts = C.TOTAL_POINTS - pickerPts;
    var totalTricks = DEAL[n].hand;

    var pickerWins, mult, label;
    if (pickerPts >= 61) {
      pickerWins = true;
      if (pickerTricks === totalTricks) { mult = 3; label = 'no tricks for the other team'; }
      else if (pickerPts >= 91) { mult = 2; label = 'schneider'; }
      else { mult = 1; label = 'a normal win'; }
    } else {
      pickerWins = false;
      if (pickerTricks === 0) { mult = 4; label = 'the picker took no tricks'; }
      else if (pickerPts <= 30) { mult = 3; label = 'schneider against the picker'; }
      else { mult = 2; label = 'the picker went down'; }
    }

    var isOpp = new Array(n).fill(true);
    for (var k = 0; k < pickerTeam.length; k++) isOpp[pickerTeam[k]] = false;
    var oppCount = isOpp.filter(Boolean).length;

    // Doublers multiply the whole hand, win or lose, rather than rewarding the
    // holder — so holding both black queens and going down costs double too.
    var factor = doublerFactor(state);
    var stake = 2 * mult * factor;
    var pot = stake * oppCount;
    var partnerShare = pickerTeam.length > 1 ? Math.floor(pot / 3) : 0;
    var pickerShare = pot - partnerShare;

    var deltas = new Array(n).fill(0);
    var sign = pickerWins ? 1 : -1;
    deltas[state.picker] = sign * pickerShare;
    if (pickerTeam.length > 1) deltas[state.partner] = sign * partnerShare;
    for (var m = 0; m < n; m++) if (isOpp[m]) deltas[m] = -sign * stake;

    /* The defending side is named neutrally, and this is a deliberate loss.
     *
     * It used to say "your team" when the one human seat was defending, which
     * read better — a summary that calls the side you are standing in "the other
     * team" sounds like it is describing somebody else's game.
     *
     * It cannot survive multiplayer, and not merely because every seat is human.
     * endHand hands this object to recordHand, which stores it into
     * state.history BY REFERENCE, and the transcript prints result.summary
     * verbatim. Personalise it for one seat and every other player's permanent
     * exported log is wrong for them. There is one summary and it outlives the
     * moment, so it has to be true from every seat.
     *
     * The client is free to compose a personalised sentence from result.deltas,
     * which is per-seat by construction and is not stored. */
    var defenceText = 'the defenders';

    var teamText = state.alone
      ? state.players[state.picker].name + ' alone'
      : state.players[state.picker].name + ' and ' + state.players[state.partner].name;
    if (state.alone && DEAL[n].partner && hasCard(state.buried, PARTNER_CARD)) {
      teamText += ' (the Jack of Diamonds was buried)';
    }

    // Name the cards, not just the total — at hand end everything is public, and
    // "21 buried" tells you nothing about what actually went down.
    var buriedText = state.buried.length
      ? ' Buried: ' + state.buried.map(function (c) { return C.name(c); }).join(', ') +
        ' (' + buriedPts + (buriedPts === 1 ? ' point).' : ' points).')
      : '';
    var blindText = state.dealt && state.dealt.blind.length
      ? ' The blind held ' + state.dealt.blind.map(function (id) { return C.name(C.get(id)); }).join(' and ') + '.'
      : '';

    var summary = 'Hand over. ' + teamText + ' took ' + pickerPts + ' points (including ' +
      buriedPts + ' buried); ' + defenceText + ' took ' + oppPts + '.' + blindText + buriedText + ' ' +
      (pickerWins ? 'The picker\'s team wins' : 'The picker\'s team loses') + ' — ' + label + '.' +
      doublerText(state) + ' ' +
      state.players.map(function (p, i) {
        var dv = deltas[i];
        return p.name + ' ' + (dv >= 0 ? '+' : '') + dv;
      }).join(', ') + '.';

    return {
      leaster: false,
      pickerPts: pickerPts,
      oppPts: oppPts,
      buriedPts: buriedPts,
      pickerWins: pickerWins,
      mult: mult,
      factor: factor,
      label: label,
      deltas: deltas,
      summary: summary
    };
  }

  /* ---------------- queries used by the UI and the AI ---------------- */

  function teamOf(state, p) {
    if (state.isLeaster) return 'solo';
    if (p === state.picker) return 'picker';
    if (!state.alone && p === state.partner) return 'picker';
    return 'opponent';
  }

  /* How likely `q` is an ally, judged only from what `viewer` is entitled to know.
   * Deliberately does NOT consult state.alone unless the viewer is the picker
   * (who can see their own hand) or the sides have already been revealed —
   * otherwise the computer players would be reading hidden information. */
  function allyProb(state, viewer, q) {
    if (viewer === q) return 1;
    if (state.isLeaster) return 0;
    if (state.picker < 0) return 0;

    var n = state.config.numPlayers;
    var d = DEAL[n];

    // Public knowledge: the sides are out, or this table has no partner card.
    if (state.partnerRevealed || !d.partner) {
      return teamOf(state, viewer) === teamOf(state, q) ? 1 : 0;
    }

    if (viewer === state.picker) {
      if (state.alone) return 0;           // the picker can see their own hand
      return 1 / (n - 1);                  // one of the others holds the card
    }
    if (!state.alone && viewer === state.partner) {
      return q === state.picker ? 1 : 0;   // the partner knows both sides
    }

    // A plain opponent. They know they do not hold the partner card themselves,
    // but not whether the picker kept it. Weigh the two possibilities.
    if (q === state.picker) return 0;
    var u = n - 2;
    if (u <= 0) return 0;
    var pAlone = (d.hand + d.blind) / (deckFor(n).length - d.hand);
    return 1 - (1 - pAlone) / u;
  }

  function handSizeFor(n) { return DEAL[n].hand; }

  /* ---------------- transcript ---------------- */

  function cardList(ids) {
    if (!ids || !ids.length) return '(none)';
    return ids.map(function (id) { return C.shortText(C.get(id)); }).join(' ');
  }

  function pad(s, w) {
    s = String(s);
    while (s.length < w) s += ' ';
    return s;
  }

  /* A full, reviewable account of the session. Finished hands are written out
   * completely, including everyone's cards — the hand is over, so nothing is
   * given away. The hand still in progress is reported from the player's own
   * seat only, so exporting mid-hand can never be used to see other hands. */
  function transcript(state, seat, extraLines) {
    var n = state.config.numPlayers;
    var d = DEAL[n];
    var L = [];
    L.push('Sheephead game log');
    L.push('Players: ' + n + ' — ' + state.players.map(function (p, i) {
      // Which seat is "you" is now an argument. It used to be whichever seat had
      // isHuman set, which online is all of them.
      if (i === seat) return p.name + ' (you)';
      return p.name + (p.occupant === 'bot' ? ' (computer)' : '');
    }).join(', '));
    L.push('Layout: ' + d.hand + ' cards each, ' + d.blind + ' card blind, ' +
      deckFor(n).length + ' card deck' + (d.exclude.length ? ' (without ' + cardList(d.exclude) + ')' : '') +
      ', ' + (d.partner ? 'Jack of Diamonds partner' : 'picker always alone'));
    L.push('Options: all pass = ' + state.config.allPass + ', opponents = ' + state.config.difficulty);
    L.push('Hands completed: ' + state.history.length);
    L.push('Running score: ' + state.players.map(function (p) {
      return p.name + ' ' + (p.score > 0 ? '+' : '') + p.score;
    }).join(', '));

    var bad = state.history.filter(function (h) { return h.problems.length; });
    L.push('Automatic check: ' + (bad.length
      ? bad.length + ' of ' + state.history.length + ' hands FAILED — see below'
      : 'all ' + state.history.length + ' completed hands add up correctly'));
    L.push('');
    L.push('Card values: A 11, 10 10, K 4, Q 3, J 2; 9, 8, 7 are worth nothing. 120 points per hand.');
    L.push('Trump, high to low: ' + cardList(C.TRUMP_ORDER.filter(function (id) {
      return d.exclude.indexOf(id) < 0;
    })));
    L.push('');

    state.history.forEach(function (h) { pushHand(L, h); });

    if (state.phase !== 'handOver' && state.phase !== 'idle') pushInProgress(L, state, seat);

    if (extraLines && extraLines.length) {
      L.push('=== On-screen log (newest first) ===');
      extraLines.forEach(function (t) { L.push('  ' + t); });
      L.push('');
    }
    return L.join('\n');
  }

  function pushHand(L, h) {
    var name = function (i) { return h.names[i]; };
    L.push('=== Hand ' + h.handNumber + ' ===');
    L.push('Dealer: ' + name(h.dealer));
    L.push('Dealt:');
    h.dealt.hands.forEach(function (ids, i) {
      L.push('  ' + pad(name(i), 10) + cardList(ids));
    });
    L.push('  ' + pad('blind', 10) + cardList(h.dealt.blind));

    L.push('Picking: ' + (h.pickLog.length
      ? h.pickLog.map(function (e) { return name(e.player) + (e.action === 'pick' ? ' picks' : ' passes'); }).join(', ')
      : '(nobody)'));

    if (h.isLeaster) {
      L.push('Leaster: no picker, everyone for themselves, fewest points wins.');
      L.push('Blind (' + cardList(h.dealt.blind) + ') goes to the last trick.');
    } else {
      L.push('Picker: ' + name(h.picker));
      L.push('Buried: ' + cardList(h.buried) + ' (' + h.buriedPts + ' points)');
      L.push('Sides: ' + (h.alone
        ? name(h.picker) + ' alone'
        : name(h.picker) + ' with ' + name(h.partner)) +
        (h.revealInfo
          ? ' — shown when ' + name(h.revealInfo.player) + ' played the Jack of Diamonds in trick ' + h.revealInfo.trick
          : ' — never shown during play (the Jack of Diamonds was buried)'));
    }

    h.tricks.forEach(function (t, ti) {
      L.push('  Trick ' + pad(ti + 1, 2) + ': ' +
        t.plays.map(function (p) { return name(p.player) + ' ' + C.shortText(C.get(p.card)); }).join(', ') +
        '  ->  ' + name(t.winner) + ' takes ' + t.points +
        (t.fromBlind ? ' (including ' + t.fromBlind + ' from the blind)' : ''));
    });

    L.push('Points: ' + h.points.map(function (v, i) {
      return name(i) + ' ' + v;
    }).join(', ') + (h.isLeaster ? '' : ', buried ' + h.buriedPts) +
      '  = ' + (h.points.reduce(function (a, b) { return a + b; }, 0) + h.buriedPts));
    L.push('Result: ' + h.result.summary);
    L.push('Score after: ' + h.scoresAfter.map(function (v, i) {
      return name(i) + ' ' + (v > 0 ? '+' : '') + v;
    }).join(', '));
    L.push('Check: ' + (h.problems.length ? 'FAILED — ' + h.problems.join(' ') : 'ok'));
    L.push('');
  }

  function pushInProgress(L, state, seat) {
    L.push('=== Hand ' + state.handNumber + ' (in progress) ===');
    L.push('Only what you can see from your own seat is written out here, so that');
    L.push('exporting part way through cannot be used to see anybody else\'s cards.');
    L.push('Dealer: ' + nameOf(state, state.dealer) + ', phase: ' + state.phase);
    var me = (typeof seat === 'number' && seat >= 0 && seat < state.players.length) ? seat : -1;
    if (me >= 0) L.push('Your hand: ' + cardList(C.ids(state.players[me].hand)));
    if (state.picker >= 0) {
      L.push('Picker: ' + nameOf(state, state.picker));
      if (state.partnerRevealed) {
        L.push('Sides: ' + (state.alone ? 'picker alone' : 'picker with ' + nameOf(state, state.partner)));
      } else {
        L.push('Sides: not yet shown.');
      }
      if (state.picker === me) L.push('You buried: ' + cardList(C.ids(state.buried)));
    }
    state.trickLog.forEach(function (t, ti) {
      L.push('  Trick ' + pad(ti + 1, 2) + ': ' +
        t.plays.map(function (p) { return nameOf(state, p.player) + ' ' + C.shortText(C.get(p.card)); }).join(', ') +
        '  ->  ' + nameOf(state, t.winner) + ' takes ' + t.points);
    });
    if (state.trick.length) {
      L.push('  Current: ' + state.trick.map(function (p) {
        return nameOf(state, p.player) + ' ' + C.shortText(p.card);
      }).join(', '));
    }
    L.push('Points so far: ' + state.players.map(function (p) { return p.name + ' ' + p.points; }).join(', '));
    L.push('');
  }

  /* ---------------- the gate ----------------
   *
   * applyAction is the ONLY path into the engine from anything that came off a
   * network. doPick/doPass/doBury/doPlay stay exported because the AI and the
   * offline UI call them directly with a seat they already own, but nothing that
   * originated in a message may reach them except through here.
   *
   * The four actions each guard their own turn, so this is belt and braces on
   * that count. What it adds is the part they cannot do: refusing input that is
   * not shaped like an action at all. A malformed or hostile payload must come
   * back as a rejection, never as a throw — an unhandled exception inside a
   * Durable Object takes the room down for everyone at the table, so one bad
   * client would end five other people's game.
   *
   * Returns {ok: true} or {ok: false, reason: <short string>}. The reason is safe
   * to show a player: it says what was wrong with THEIR request and never
   * anything about anybody else's cards. */
  var ACTIONS = { pick: 1, pass: 1, bury: 1, play: 1 };

  function applyAction(state, seat, action) {
    if (!state || !state.players) return { ok: false, reason: 'no game in progress' };
    if (!action || typeof action !== 'object') return { ok: false, reason: 'malformed action' };
    if (!ACTIONS[action.type]) return { ok: false, reason: 'unknown action' };

    // Seat has to be a real index before anything indexes players[] with it.
    if (typeof seat !== 'number' || seat !== Math.floor(seat) ||
        seat < 0 || seat >= state.players.length) {
      return { ok: false, reason: 'not a seat at this table' };
    }

    try {
      switch (action.type) {
        case 'pick':
          if (state.phase !== 'pick') return { ok: false, reason: 'not the picking phase' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          return doPick(state, seat) ? { ok: true } : { ok: false, reason: 'could not pick' };

        case 'pass':
          if (state.phase !== 'pick') return { ok: false, reason: 'not the picking phase' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          return doPass(state, seat) ? { ok: true } : { ok: false, reason: 'could not pass' };

        case 'bury':
          if (state.phase !== 'bury') return { ok: false, reason: 'nothing to bury' };
          if (state.picker !== seat) return { ok: false, reason: 'only the picker buries' };
          if (!Array.isArray(action.cards)) return { ok: false, reason: 'no cards given' };
          return doBury(state, seat, action.cards)
            ? { ok: true } : { ok: false, reason: 'those cards could not be buried' };

        case 'play':
          if (state.phase !== 'play') return { ok: false, reason: 'not the playing phase' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          if (typeof action.card !== 'string') return { ok: false, reason: 'no card given' };
          if (!isLegal(state, seat, action.card)) {
            return { ok: false, reason: illegalReason(state, seat, action.card) || 'that card cannot be played' };
          }
          return doPlay(state, seat, action.card)
            ? { ok: true } : { ok: false, reason: 'that card could not be played' };
      }
    } catch (e) {
      // Reaching here is a bug in the engine, not in the message. Say so plainly
      // and keep the room alive; the server logs the real error separately.
      return { ok: false, reason: 'the game could not apply that move' };
    }
    return { ok: false, reason: 'unknown action' };
  }

  SH.Game = {
    DEAL: DEAL,
    applyAction: applyAction,
    eventsFor: eventsFor,
    deckFor: deckFor,
    PARTNER_CARD: PARTNER_CARD,
    createGame: createGame,
    newHand: newHand,
    doPick: doPick,
    doPass: doPass,
    doBury: doBury,
    doPlay: doPlay,
    legalPlays: legalPlays,
    isLegal: isLegal,
    illegalReason: illegalReason,
    trickWinnerIndex: trickWinnerIndex,
    teamOf: teamOf,
    allyProb: allyProb,
    handSizeFor: handSizeFor,
    transcript: transcript,
    auditHand: auditHand,
    doublerFactorFor: doublerFactor,
    doublerListFor: doublerList
  };
})(window);

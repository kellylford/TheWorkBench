/* Hearts - the rules, and the only door into them.
 *
 * Four players, thirteen tricks, no trump. Every heart is worth a point and the
 * queen of spades is worth thirteen, and the object is to take none of them. The
 * game ends when somebody reaches a hundred; the LOWEST score wins, which is the
 * one thing about this game that surprises people who have only played the
 * others in this repository.
 *
 * ---- the four rules that are actually the game ----
 *
 * 1. THE TWO OF CLUBS LEADS THE FIRST TRICK. Not the dealer's left, not the
 *    winner of anything — whoever holds it, plays it. It is not a choice.
 *
 * 2. NOTHING SCORING ON THE FIRST TRICK. No heart, no queen of spades, unless a
 *    player has nothing else at all. A hand of thirteen hearts cannot follow this
 *    rule, so the rule has to yield rather than the deal being illegal.
 *
 * 3. HEARTS MUST BE BROKEN BEFORE THEY CAN BE LED. A heart may be discarded on a
 *    suit you cannot follow at any time, and that is what breaks them. Until
 *    then a player holding nothing but hearts may still lead one — again, the
 *    rule yields rather than trapping somebody with no legal move.
 *
 * 4. SHOOTING THE MOON. Take all twenty-six and everybody else takes
 *    twenty-six instead. This is the rule that makes the scoring worth testing
 *    twice: it inverts the sign of the whole hand, and an engine that adds up
 *    points correctly and forgets this is wrong in the most spectacular way
 *    available.
 *
 * ---- the passing ----
 *
 * Three cards, and the direction rotates: left, right, across, then a hand where
 * nobody passes at all. The hold hand is not decoration — a four-hand cycle with
 * no hold means the deal number and the direction stay in lockstep for ever, and
 * every fourth hand plays identically to every other fourth hand.
 *
 * Passing is simultaneous. Nobody may see what they were given before choosing
 * what to give, which means the engine holds four sets of three cards and swaps
 * them only when all four are in. view.js is what stops a passed card being
 * visible early, and it is tested separately, but the engine is what makes that
 * possible by never putting a passed card anywhere a projection would find it.
 *
 * ---- the contract this file has to meet ----
 *
 * createGame, applyAction, eventsFor, seatToAct, canDeal, note, vb — the shared
 * transport in ../shared/js/ drives an engine it knows nothing about through
 * exactly these, and shared/tests/engine-contract.js holds every game in this
 * repository to them. canDeal in particular must be EXACTLY the set of phases
 * applyAction accepts a nextHand in: too broad and the player gets a raw refusal
 * while somebody else is visibly dealing, too narrow and the deal is swallowed
 * in silence. Both of those have happened here.
 *
 * applyAction is the single authorization gate. Nothing else may move the game.
 * Not because doPlay is dangerous in itself, but because the seat check lives in
 * one place and a function that trusts its caller is a hole the size of the
 * whole table once there is a socket.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  var SEATS = 4;
  var HAND = 13;
  var PASS_COUNT = 3;
  var TARGET = 100;
  var MOON = 26;

  /* left, right, across, hold — and the hold hand is why this is length four. */
  var PASS_DIRS = ['left', 'right', 'across', 'hold'];
  var PASS_OFFSET = { left: 1, right: SEATS - 1, across: 2, hold: 0 };

  function createGame(config) {
    var players = [];
    for (var i = 0; i < SEATS; i++) {
      players.push({
        index: i,
        name: config.names[i],
        /* Who is sitting here, rather than whether this is "the" human. A
         * boolean that is true for one seat cannot answer the question a table
         * actually asks, which is whether anybody is currently in a chair.
         * 'human' | 'bot' | 'away'. */
        occupant: i === 0 ? 'human' : 'bot',
        hand: [],
        taken: [],          // cards won in tricks this hand
        score: 0,           // running total; lowest wins
        handPoints: 0       // this hand only, after moon adjustment
      });
    }
    return {
      phase: 'idle',
      players: players,
      dealNumber: 0,
      passDir: PASS_DIRS[0],
      passing: [null, null, null, null],   // each seat's chosen three, before the swap
      received: [null, null, null, null],  // what each seat was handed, for the log
      turn: 0,
      leader: 0,
      trick: [],            // { seat, card }
      tricksPlayed: 0,
      heartsBroken: false,
      lastTrick: null,
      history: [],
      events: [],
      nextEventId: 1,
      winner: -1
    };
  }

  /* ---------------- events ---------------- */

  function ev(state, kind, text, extra) {
    var e = { id: state.nextEventId++, kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.events.push(e);
    return e;
  }

  /* An event only one seat may hear. `audience` and `id` are stripped on
   * delivery; the point is that a seat never receives a line written for
   * somebody else, not that it receives it and is asked not to look. */
  function evTo(state, seat, kind, text, extra) {
    var e = ev(state, kind, text, extra);
    e.audience = seat;
    return e;
  }

  function vb(state, seat) {
    var p = state.players[seat];
    return p ? p.name : 'seat ' + seat;
  }

  function eventsFor(state, seat, since) {
    var out = [];
    for (var i = 0; i < state.events.length; i++) {
      var e = state.events[i];
      if (typeof since === 'number' && e.id <= since) continue;
      if (typeof e.audience === 'number' && e.audience !== seat) continue;
      var copy = {};
      for (var k in e) if (k !== 'audience' && k !== 'id') copy[k] = e[k];
      copy.id = e.id;
      out.push(copy);
    }
    return out;
  }

  /* ---------------- dealing ---------------- */

  function newHand(state, rng) {
    if (!canDeal(state)) return false;

    var deck = C.shuffle(C.newDeck().slice(), rng);
    state.players.forEach(function (p, i) {
      p.hand = C.sortHand(deck.slice(i * HAND, (i + 1) * HAND));
      p.taken = [];
      p.handPoints = 0;
    });

    state.dealNumber++;
    state.passDir = PASS_DIRS[(state.dealNumber - 1) % PASS_DIRS.length];
    state.passing = [null, null, null, null];
    state.received = [null, null, null, null];
    state.trick = [];
    state.tricksPlayed = 0;
    state.heartsBroken = false;
    state.lastTrick = null;

    ev(state, 'deal', 'Hand ' + state.dealNumber + ' dealt.');

    if (state.passDir === 'hold') {
      ev(state, 'info', 'Nobody passes this hand.');
      beginPlay(state);
    } else {
      state.phase = 'passing';
      ev(state, 'info', 'Pass three cards to the ' +
        (state.passDir === 'across' ? 'player across' : state.passDir) + '.');
    }
    return true;
  }

  function canDeal(state) {
    /* EXACTLY the phases applyAction accepts a nextHand in. See the note at the
     * top: too broad hands the player the raw engine refusal while a hand is
     * visibly being dealt, too narrow eats the deal in silence. idle belongs to
     * the start action, which is a decision the table makes together. */
    return state.phase === 'handOver';
  }

  /* ---------------- passing ---------------- */

  function doPass(state, seat, cardIds) {
    if (state.phase !== 'passing') return { ok: false, reason: 'nothing is being passed' };
    if (state.passing[seat]) return { ok: false, reason: 'you have already passed' };
    if (!Array.isArray(cardIds) || cardIds.length !== PASS_COUNT) {
      return { ok: false, reason: 'pass exactly ' + PASS_COUNT + ' cards' };
    }
    var seen = {};
    var chosen = [];
    for (var i = 0; i < cardIds.length; i++) {
      var id = cardIds[i];
      if (seen[id]) return { ok: false, reason: 'the same card twice' };
      seen[id] = true;
      var card = null;
      for (var j = 0; j < state.players[seat].hand.length; j++) {
        if (state.players[seat].hand[j].id === id) { card = state.players[seat].hand[j]; break; }
      }
      if (!card) return { ok: false, reason: 'you do not hold that card' };
      chosen.push(card);
    }
    state.passing[seat] = chosen;

    evTo(state, seat, 'you', 'You passed ' + listCards(chosen) + '.');

    /* Everyone is told THAT a seat has passed, and nothing about what. The
     * count is the whole of what is public here. */
    ev(state, 'info', vb(state, seat) + ' has passed.');

    if (state.passing.every(function (p) { return !!p; })) swapPasses(state);
    return { ok: true };
  }

  function swapPasses(state) {
    var offset = PASS_OFFSET[state.passDir];
    var moving = [];
    for (var from = 0; from < SEATS; from++) {
      moving.push({ from: from, to: (from + offset) % SEATS, cards: state.passing[from] });
    }
    /* Removed from every hand BEFORE anything is added to any hand. Doing it a
     * seat at a time lets a card that has just arrived be passed on again in the
     * same swap, which is not a hypothetical: with `across`, seats 0 and 2 hand
     * each other three cards, and a sequential loop would give seat 0 its own
     * cards back. */
    moving.forEach(function (m) {
      var give = {};
      m.cards.forEach(function (c) { give[c.id] = true; });
      var p = state.players[m.from];
      p.hand = p.hand.filter(function (c) { return !give[c.id]; });
    });
    moving.forEach(function (m) {
      var p = state.players[m.to];
      p.hand = C.sortHand(p.hand.concat(m.cards));
      state.received[m.to] = m.cards.slice();
      evTo(state, m.to, 'you', vb(state, m.from) + ' passed you ' + listCards(m.cards) + '.');
    });

    state.passing = [null, null, null, null];
    beginPlay(state);
  }

  /* ---------------- play ---------------- */

  function beginPlay(state) {
    state.phase = 'play';
    state.leader = holderOfTwoOfClubs(state);
    state.turn = state.leader;
    state.trick = [];
    ev(state, 'info', vb(state, state.leader) + ' has the two of clubs and leads.');
  }

  function holderOfTwoOfClubs(state) {
    for (var i = 0; i < SEATS; i++) {
      for (var j = 0; j < state.players[i].hand.length; j++) {
        if (state.players[i].hand[j].id === '2C') return i;
      }
    }
    return 0;   // unreachable with a full pack, and a sane answer if it ever is
  }

  /* Which cards this seat may legally play right now.
   *
   * The three yielding rules all live here, and they all yield the same way: if
   * applying the restriction would leave nothing, the restriction does not
   * apply. A rule that can leave a player with no legal move is not a rule, it
   * is a deadlock. */
  function legalPlays(state, seat) {
    if (state.phase !== 'play' || state.turn !== seat) return [];
    var hand = state.players[seat].hand;
    if (!hand.length) return [];

    var firstTrick = state.tricksPlayed === 0;
    var leading = state.trick.length === 0;

    if (leading) {
      if (firstTrick) {
        var two = hand.filter(function (c) { return c.id === '2C'; });
        if (two.length) return two;       // not a choice
      }
      if (!state.heartsBroken) {
        var notHearts = hand.filter(function (c) { return c.s !== 'H'; });
        if (notHearts.length) return notHearts;
        return hand.slice();              // nothing but hearts: the rule yields
      }
      return hand.slice();
    }

    var led = state.trick[0].card.s;
    var follow = hand.filter(function (c) { return c.s === led; });
    if (follow.length) {
      /* Following suit: no scoring restriction can apply, because the suit
       * decides the card. The first-trick rule only ever bites on a discard. */
      return follow;
    }

    if (firstTrick) {
      var safe = hand.filter(function (c) { return !isScoring(c); });
      if (safe.length) return safe;
      return hand.slice();                // all points: the rule yields
    }
    return hand.slice();
  }

  function isScoring(c) { return c.s === 'H' || c.id === 'QS'; }

  function pointsOf(cards) {
    var n = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].s === 'H') n += 1;
      else if (cards[i].id === 'QS') n += 13;
    }
    return n;
  }

  function doPlay(state, seat, cardId) {
    if (state.phase !== 'play') return { ok: false, reason: 'no trick is in progress' };
    if (state.turn !== seat) return { ok: false, reason: 'not your turn' };

    var legal = legalPlays(state, seat);
    var card = null;
    for (var i = 0; i < legal.length; i++) if (legal[i].id === cardId) { card = legal[i]; break; }
    if (!card) {
      var held = state.players[seat].hand.some(function (c) { return c.id === cardId; });
      return { ok: false, reason: held ? whyNot(state, seat, cardId) : 'you do not hold that card' };
    }

    var p = state.players[seat];
    p.hand = p.hand.filter(function (c) { return c.id !== cardId; });
    state.trick.push({ seat: seat, card: card });

    if (card.s === 'H' && !state.heartsBroken) {
      state.heartsBroken = true;
      ev(state, 'info', 'Hearts are broken.');
    }

    ev(state, 'play', vb(state, seat) + ' played the ' + C.name(card) + '.',
      { seat: seat, card: card.id });

    if (state.trick.length === SEATS) return finishTrick(state);

    state.turn = (state.turn + 1) % SEATS;
    return { ok: true };
  }

  /* Why a card in your hand cannot be played. Said in the words of the rule
   * rather than "illegal move", because a player who is told which rule stopped
   * them learns the game and a player told "no" learns nothing. */
  function whyNot(state, seat, cardId) {
    var card = C.get(cardId);
    if (!card) return 'no such card';
    var leading = state.trick.length === 0;
    if (!leading) {
      var led = state.trick[0].card.s;
      var canFollow = state.players[seat].hand.some(function (c) { return c.s === led; });
      if (canFollow && card.s !== led) {
        return 'you must follow ' + C.SUIT_NAME[led].toLowerCase();
      }
      if (state.tricksPlayed === 0 && isScoring(card)) {
        return 'no points on the first trick';
      }
      return 'not a legal card here';
    }
    if (state.tricksPlayed === 0) return 'the two of clubs must be led first';
    if (card.s === 'H' && !state.heartsBroken) return 'hearts have not been broken';
    return 'not a legal card here';
  }

  function finishTrick(state) {
    var best = state.trick[0];
    for (var i = 1; i < state.trick.length; i++) {
      if (C.beats(state.trick[i].card, best.card)) best = state.trick[i];
    }
    var cards = state.trick.map(function (t) { return t.card; });
    var pts = pointsOf(cards);

    state.players[best.seat].taken = state.players[best.seat].taken.concat(cards);
    state.lastTrick = { cards: state.trick.slice(), winner: best.seat, points: pts };
    state.tricksPlayed++;

    ev(state, 'trick', vb(state, best.seat) + ' took the trick' +
      (pts ? ' with ' + pts + (pts === 1 ? ' point' : ' points') : ', no points') + '.',
      { seat: best.seat, points: pts });

    state.trick = [];
    state.leader = best.seat;
    state.turn = best.seat;

    if (state.tricksPlayed === HAND) return finishHand(state);
    return { ok: true };
  }

  function finishHand(state) {
    var raw = state.players.map(function (p) { return pointsOf(p.taken); });
    var total = raw.reduce(function (a, b) { return a + b; }, 0);

    /* The moon. Twenty-six points in one pair of hands turns the hand inside
     * out, and it is checked against the total rather than against a count of
     * hearts so that a bug in pointsOf cannot make a false moon: if the sum is
     * not twenty-six, nobody shot anything. */
    var shooter = -1;
    if (total === MOON) {
      for (var i = 0; i < SEATS; i++) if (raw[i] === MOON) shooter = i;
    }

    state.players.forEach(function (p, i) {
      p.handPoints = shooter >= 0 ? (i === shooter ? 0 : MOON) : raw[i];
      p.score += p.handPoints;
    });

    if (shooter >= 0) {
      ev(state, 'moon', vb(state, shooter) + ' shot the moon — everybody else takes ' +
        MOON + '.', { seat: shooter });
    }

    state.history.push({
      deal: state.dealNumber,
      passDir: state.passDir,
      points: state.players.map(function (p) { return p.handPoints; }),
      shooter: shooter,
      scores: state.players.map(function (p) { return p.score; })
    });

    ev(state, 'hand', 'Hand ' + state.dealNumber + ' over. ' +
      state.players.map(function (p) {
        return p.name + ' ' + p.handPoints;
      }).join(', ') + '.');

    var over = state.players.some(function (p) { return p.score >= TARGET; });
    if (over) {
      var low = Math.min.apply(null, state.players.map(function (p) { return p.score; }));
      var winners = state.players.filter(function (p) { return p.score === low; });
      state.winner = winners.length === 1 ? winners[0].index : -1;
      state.phase = 'gameOver';
      ev(state, 'game', winners.length === 1
        ? winners[0].name + ' wins with ' + low + '. Lowest score wins.'
        : 'Tied on ' + low + ': ' + winners.map(function (p) { return p.name; }).join(' and ') + '.');
    } else {
      state.phase = 'handOver';
    }
    return { ok: true };
  }

  function listCards(cards) {
    var names = cards.map(function (c) { return C.name(c); });
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* ---------------- who is to move ---------------- */

  function seatToAct(state) {
    /* -1 for nobody, and the dead phases matter: a room that asks a bot to move
     * during handOver gets a seat number still valid from the last trick, and
     * the bot plays into a hand that is over.
     *
     * Passing has no single seat to act — all four choose at once — so this
     * answers with the first seat that has not passed. The room uses it to
     * decide which bot to prod, and prodding them one at a time is exactly
     * right: they are not waiting on each other. */
    if (state.phase === 'passing') {
      for (var i = 0; i < SEATS; i++) if (!state.passing[i]) return i;
      return -1;
    }
    if (state.phase === 'play') return state.turn;
    return -1;
  }

  /* ---------------- the only way in ----------------
   *
   * Object.create(null) rather than {}: a plain object inherits from
   * Object.prototype, so ACTIONS['constructor'] and ACTIONS['__proto__'] are
   * truthy and would sail past the guard.
   */
  var ACTIONS = Object.create(null);
  ACTIONS.start = true;
  ACTIONS.pass = true;
  ACTIONS.play = true;
  ACTIONS.nextHand = true;

  function applyAction(state, seat, action, rng) {
    if (!state || !state.players) return { ok: false, reason: 'no game in progress' };
    if (!action || typeof action !== 'object') return { ok: false, reason: 'malformed action' };
    if (!ACTIONS[action.type]) return { ok: false, reason: 'unknown action' };
    if (typeof seat !== 'number' || seat !== Math.floor(seat) ||
        seat < 0 || seat >= state.players.length) {
      return { ok: false, reason: 'not a seat at this table' };
    }

    try {
      switch (action.type) {
        case 'start':
          /* Deal the FIRST hand, when the people at the table say they are
           * ready. A table that deals the moment it is made leaves the host no
           * time to read the code to anybody. */
          if (state.phase !== 'idle') return { ok: false, reason: 'the game has already started' };
          state.phase = 'handOver';         // so newHand's own gate is the only one
          return newHand(state, rng) ? { ok: true } : { ok: false, reason: 'could not deal' };

        case 'pass':
          return doPass(state, seat, action.cards);

        case 'play':
          return doPlay(state, seat, action.card);

        case 'nextHand':
          if (!canDeal(state)) return { ok: false, reason: 'the hand is not over' };
          return newHand(state, rng) ? { ok: true } : { ok: false, reason: 'could not deal' };
      }
    } catch (e) {
      /* Reaching here is a bug in the engine, not in the message, and the state
       * is now untrustworthy — so it must NOT be reported as an ordinary
       * refusal. Everything validated above happens before anything is written,
       * so `ok: false` from it genuinely means nothing changed. A throw does
       * not: doPlay removes the card from the hand and pushes it onto the trick
       * before it ever reaches the scoring. */
      return { ok: false, reason: 'the game hit a fault and cannot continue', fault: true };
    }
    return { ok: false, reason: 'unknown action' };
  }

  SH.Game = {
    SEATS: SEATS,
    HAND: HAND,
    PASS_COUNT: PASS_COUNT,
    TARGET: TARGET,
    MOON: MOON,
    PASS_DIRS: PASS_DIRS,
    PASS_OFFSET: PASS_OFFSET,
    createGame: createGame,
    applyAction: applyAction,
    eventsFor: eventsFor,
    seatToAct: seatToAct,
    canDeal: canDeal,
    legalPlays: legalPlays,
    pointsOf: pointsOf,
    isScoring: isScoring,
    whyNot: whyNot,
    holderOfTwoOfClubs: holderOfTwoOfClubs,
    /* For the room, which writes prose about players too. */
    note: function (state, text) { return ev(state, 'info', text); },
    vb: vb
  };
})(typeof window !== 'undefined' ? window : globalThis);

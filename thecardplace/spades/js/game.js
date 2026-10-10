/* Spades - the rules, and the only door into them.
 *
 * Four players in two fixed partnerships: seats 0 and 2 against seats 1 and 3.
 * Thirteen tricks a hand, spades always trump. Everybody bids the number of
 * tricks they expect to take, and a partnership either makes what the two of
 * them promised between them or loses it all.
 *
 * ---- the four rules that are actually the game ----
 *
 * 1. THE BID IS A PARTNERSHIP CONTRACT, not a personal one. Two bids are added
 *    together and the pair is judged on the total. Bidding four and taking two
 *    is fine if your partner bid two and took four. This is why the scoring
 *    below works on teams and not on players, and it is the single most common
 *    thing to get wrong by writing the obvious per-player loop.
 *
 * 2. MISSING THE CONTRACT COSTS THE WHOLE BID. Not the difference — the whole
 *    thing, negative. A pair that bids seven and takes six loses seventy. This
 *    is what makes bidding a real decision rather than an estimate.
 *
 * 3. OVERTRICKS ARE WORTH ONE POINT AND ARE A LIABILITY. Every trick over the
 *    contract scores a single point and also a "bag". Ten bags costs a hundred
 *    points. So a pair that quietly over-performs every hand is losing, slowly,
 *    in a way that is invisible if you only look at the hand scores — which is
 *    exactly why the bag count is on screen and spoken.
 *
 * 4. NIL. A bid of zero, scored on its own: a hundred if that player takes no
 *    trick at all, minus a hundred if they take one. The partner's bid is still
 *    a contract and is still scored normally, and a FAILED nil's tricks count
 *    towards it — which falls out of the sum rather than needing a special case,
 *    because a successful nil took none and so contributes nothing either way.
 *
 * ---- the play ----
 *
 * Left of the dealer leads. Follow suit if you can; otherwise anything, and that
 * includes a spade whenever you like — spades are trump, and trumping in is not
 * a privilege that has to be earned.
 *
 * What DOES have to be earned is leading them. Spades cannot be led until they
 * are broken, and they are broken as soon as ANY spade is played — usually
 * somebody trumping in on a suit they could not follow.
 *
 * The rule yields rather than trapping anybody: a player holding nothing but
 * spades may lead one, and that breaks them too. Requiring the breaking spade to
 * have come from a seat that could not follow reads as more precise and is
 * wrong, because it leaves the flag false through an entire trick of spades and
 * the next leader is refused with "spades have not been broken".
 *
 * ---- the contract this file has to meet ----
 *
 * createGame, applyAction, eventsFor, seatToAct, canDeal, note, vb — the shared
 * transport in ../shared/js/ drives an engine it knows nothing about through
 * exactly these, and shared/tests/engine-contract.js holds every game in this
 * repository to them. canDeal in particular must be EXACTLY the set of phases
 * applyAction accepts a nextHand in: too broad and the player gets a raw refusal
 * while somebody else is visibly dealing, too narrow and the deal is swallowed
 * in silence. Both of those have happened in this repository.
 *
 * applyAction is the single authorization gate. Nothing else may move the game.
 * Not because doPlay is dangerous in itself, but because the seat check lives in
 * one place and a function that trusts its caller is a hole the size of the
 * whole table once there is a socket.
 *
 * ---- every configurable rule is read from config, at the point of use ----
 *
 * targetOf and bagPenaltyAt below are functions rather than constants, and they
 * are called where the decision is made rather than read once at the deal. The
 * constants next to them are DEFAULTS and are named as such. Hearts shipped a
 * "short game to fifty" that was offered on two screens, stored, sent to every
 * seat and then compared against a module constant, so the game ran to a hundred
 * with a fifty on the screen and nothing said so. Do not reintroduce that here.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  var SEATS = 4;
  var HAND = 13;
  var TEAMS = 2;

  /* Defaults, and only defaults. What a given table plays by is in config. */
  var TARGET = 500;           // config.pointsToWin
  var BAG_LIMIT = 10;         // config.bagLimit — bags per penalty
  var BAG_PENALTY = 100;      // config.bagPenalty — what a full bag bin costs
  var NIL_VALUE = 100;        // config.nilValue

  /* Seats 0 and 2 against 1 and 3. Sitting opposite your partner is not a
   * convention here, it is the definition — everything from the play order to
   * the scoring assumes it. */
  function teamOf(seat) { return seat % TEAMS; }
  function partnerOf(seat) { return (seat + 2) % SEATS; }

  function createGame(config) {
    var players = [];
    for (var i = 0; i < SEATS; i++) {
      players.push({
        index: i,
        name: config.names[i],
        team: teamOf(i),
        /* Who is sitting here, rather than whether this is "the" human. A
         * boolean that is true for one seat cannot answer the question a table
         * actually asks, which is whether anybody is currently in a chair.
         * 'human' | 'bot' | 'away'. */
        occupant: i === 0 ? 'human' : 'bot',
        hand: [],
        /* null until this seat has bid. Not 0 — zero is nil, which is a real and
         * very consequential bid, and a default that collides with a meaningful
         * value is a bug waiting for the first player who passes out. */
        bid: null,
        tricks: 0
      });
    }
    return {
      phase: 'idle',
      players: players,
      /* Kept whole on the server and filtered on the way out. view.js sends
       * only the handful of keys that are the TABLE's business; the rest of
       * what a client had in localStorage — its pace, its skin, its own name —
       * is one seat's private preference wearing a public-looking key. */
      config: config || {},

      dealer: -1,
      dealNumber: 0,
      turn: 0,
      leader: 0,

      trick: [],            // { seat, card }
      tricksPlayed: 0,
      spadesBroken: false,
      lastTrick: null,

      /* Per TEAM, not per player, because rule 1 above is the game. */
      scores: [0, 0],
      bags: [0, 0],

      history: [],
      events: [],
      nextEventId: 1,
      winner: -1            // team index, or -1 for nobody yet / a tie
    };
  }

  /* ---------------- the rules this table plays by ----------------
   *
   * Read from config every time they are needed. See the note at the top of the
   * file about the hearts bug this shape exists to prevent. */

  function ruleNumber(state, key, fallback, allowZero) {
    var n = state.config && state.config[key];
    if (typeof n !== 'number' || !isFinite(n)) return fallback;
    if (n < 0) return fallback;
    if (n === 0 && !allowZero) return fallback;
    return n;
  }

  function targetOf(state) { return ruleNumber(state, 'pointsToWin', TARGET); }
  function bagLimitOf(state) { return ruleNumber(state, 'bagLimit', BAG_LIMIT); }
  /* allowZero: a table that wants bags counted but not punished is a coherent
   * choice, and zero is how you say it. */
  function bagPenaltyOf(state) { return ruleNumber(state, 'bagPenalty', BAG_PENALTY, true); }
  function nilValueOf(state) { return ruleNumber(state, 'nilValue', NIL_VALUE); }

  /* ---------------- events ---------------- */

  function ev(state, kind, text, extra) {
    var e = { id: state.nextEventId++, kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.events.push(e);
    return e;
  }

  /* There is deliberately no evTo() here.
   *
   * Hearts has one — an event only one seat may hear — because it has something
   * to say privately: what you were passed. Nothing in spades is private once it
   * happens. The bids are spoken aloud, every card is played face up, and both
   * scores are public. eventsFor still honours an `audience` field, so the
   * machinery is there if a variant ever needs it; carrying an unused helper
   * that suggests this game has private events would be a false signal in the
   * file somebody reads to learn how events reach a seat.
   */

  function vb(state, seat) {
    var p = state.players[seat];
    return p ? p.name : 'seat ' + seat;
  }

  /* "You and Nell" — a partnership named by its people rather than by a number.
   * "Team 0" is how the code thinks and is no use at a table. */
  function teamName(state, team) {
    var names = [];
    for (var i = 0; i < SEATS; i++) if (teamOf(i) === team) names.push(vb(state, i));
    return names.join(' and ');
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
      p.bid = null;
      p.tricks = 0;
    });

    state.dealNumber++;
    /* The very first dealer is drawn at random, then the deal rotates.
     *
     * Nothing at a spades table decides who starts — there is no cut, no upcard,
     * no two of clubs. So whatever this line says IS the draw, and saying zero
     * meant the seat a lone player is put in dealt the opening hand of every
     * game they ever played. The dealer bids last, which is the only positional
     * advantage in the game, so that is not a cosmetic bias.
     *
     * Drawn from the SAME rng the shuffle above used, not from Math.random: a
     * seeded run has to stay reproducible, and a second, unseeded source of
     * randomness inside a deal is exactly what makes a soak failure impossible
     * to replay. Drawn AFTER the shuffle so the hands a given seed produces do
     * not move.
     *
     * The `% SEATS` is not belt and braces. Math.random is specified to stay
     * below one, but an injected rng is not: the seeded one in tests/balance.js
     * is `seed / 0x7fffffff`, whose top value is exactly 1, and one draw in two
     * billion would otherwise seat the dealer at index 4 of a four-seat table —
     * a dealer nobody is, on a hand nobody can bid. */
    state.dealer = state.dealer < 0
      ? Math.floor((rng || Math.random)() * SEATS) % SEATS
      : (state.dealer + 1) % SEATS;
    state.trick = [];
    state.tricksPlayed = 0;
    state.spadesBroken = false;
    state.lastTrick = null;

    /* Bidding starts to the dealer's left and goes once around. The dealer bids
     * last, which is the only positional advantage in the game and the reason
     * the deal rotates. */
    state.phase = 'bidding';
    state.leader = (state.dealer + 1) % SEATS;
    state.turn = state.leader;

    ev(state, 'deal', 'Hand ' + state.dealNumber + ' dealt. ' +
      vb(state, state.dealer) + ' dealt; ' + vb(state, state.turn) + ' bids first.');
    return true;
  }

  function canDeal(state) {
    /* EXACTLY the phases applyAction accepts a nextHand in. See the note at the
     * top: too broad hands the player the raw engine refusal while a hand is
     * visibly being dealt, too narrow eats the deal in silence. idle belongs to
     * the start action, which is a decision the table makes together. */
    return state.phase === 'handOver';
  }

  /* ---------------- bidding ---------------- */

  /* Every bid this seat may make. Zero through thirteen, always — there is no
   * rule in this game preventing any individual bid, and a table total of
   * thirteen is legal and common.
   *
   * It exists as a function returning the whole range because the interface
   * builds its buttons from it and the computer players choose from it, so
   * "what may I bid" has one answer in one place. A variant that forbids the
   * table bidding exactly thirteen would change this and nothing else. */
  function legalBids(state, seat) {
    if (state.phase !== 'bidding' || state.turn !== seat) return [];
    var out = [];
    for (var i = 0; i <= HAND; i++) out.push(i);
    return out;
  }

  function doBid(state, seat, n) {
    if (state.phase !== 'bidding') return { ok: false, reason: 'nobody is bidding' };
    if (state.turn !== seat) return { ok: false, reason: 'not your turn to bid' };
    if (typeof n !== 'number' || n !== Math.floor(n) || n < 0 || n > HAND) {
      return { ok: false, reason: 'a bid is a whole number from zero to ' + HAND };
    }
    if (state.players[seat].bid !== null) return { ok: false, reason: 'you have already bid' };

    state.players[seat].bid = n;

    ev(state, 'bid', vb(state, seat) + ' bid ' + (n === 0 ? 'nil' : n) + '.',
      { seat: seat, bid: n });

    /* Round the table once, then play. Counting the bids in rather than counting
     * seats round means an engine that somehow bid twice for one seat stops
     * here instead of dealing a hand nobody bid on. */
    if (state.players.every(function (p) { return p.bid !== null; })) {
      beginPlay(state);
      return { ok: true };
    }

    state.turn = (state.turn + 1) % SEATS;
    return { ok: true };
  }

  function beginPlay(state) {
    state.phase = 'play';
    state.leader = (state.dealer + 1) % SEATS;
    state.turn = state.leader;
    state.trick = [];

    var t0 = contractOf(state, 0), t1 = contractOf(state, 1);
    ev(state, 'info', 'Bidding is done. ' +
      teamName(state, 0) + ' for ' + t0 + ', ' +
      teamName(state, 1) + ' for ' + t1 + '. ' +
      /* Said out loud because it is the single most useful fact about the hand
       * about to be played, and at a real table everybody works it out. Over is
       * a scramble, under means tricks are going begging. */
      tableShape(t0 + t1) + ' ' + vb(state, state.leader) + ' leads.');
  }

  function tableShape(total) {
    if (total > HAND) return 'That is ' + (total - HAND) + ' over the ' + HAND + ' available.';
    if (total < HAND) return 'That leaves ' + (HAND - total) + ' spare.';
    return 'Exactly ' + HAND + ' bid.';
  }

  function contractOf(state, team) {
    var n = 0;
    for (var i = 0; i < SEATS; i++) {
      if (teamOf(i) === team && state.players[i].bid !== null) n += state.players[i].bid;
    }
    return n;
  }

  /* ---------------- play ---------------- */

  /* Which cards this seat may legally play right now.
   *
   * Two rules, and both of them yield rather than deadlock: follow the suit led
   * if you hold it, and do not LEAD a spade until spades are broken unless
   * spades are all you have. A rule that can leave a player with no legal move
   * is not a rule, it is a hang. */
  function legalPlays(state, seat) {
    if (state.phase !== 'play' || state.turn !== seat) return [];
    var hand = state.players[seat].hand;
    if (!hand.length) return [];

    if (state.trick.length === 0) {
      if (state.spadesBroken) return hand.slice();
      var notTrump = hand.filter(function (c) { return !C.isTrump(c); });
      /* Nothing but spades: the rule yields. Otherwise a player dealt thirteen
       * spades — rare, and it happens — could not move at all. */
      return notTrump.length ? notTrump : hand.slice();
    }

    var led = state.trick[0].card.s;
    var follow = hand.filter(function (c) { return c.s === led; });
    /* Void in the led suit: anything, and that explicitly includes trumping in.
     * There is no rule in spades requiring you to trump, and none preventing
     * it. */
    return follow.length ? follow : hand.slice();
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

    /* ANY spade reaching the table breaks them. Not only one played by a seat
     * that could not follow.
     *
     * This used to also require `state.trick.length > 0`, on the reasoning that
     * breaking is what happens when somebody ruffs in. That misses the one way a
     * spade can be LED before they are broken: a player holding nothing but
     * spades, where the leading rule yields rather than trapping them with no
     * legal move. The flag then stayed false through an entire trick of spades,
     * and the next player to lead was refused with "spades have not been
     * broken" — a sentence that is plainly false to anybody who watched the
     * trick.
     *
     * The condition is now simply "a spade was played", which is also the rule
     * as everybody states it: once spades have been seen, they are live.
     *
     * Checked before the card joins the trick, so that `state.trick` still
     * describes what was already on the table rather than including this card. */
    if (C.isTrump(card) && !state.spadesBroken) {
      state.spadesBroken = true;
      ev(state, 'info', 'Spades are broken.');
    }

    state.trick.push({ seat: seat, card: card });

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
    if (state.trick.length === 0) {
      if (C.isTrump(card) && !state.spadesBroken) return 'spades have not been broken';
      return 'not a legal card here';
    }
    var led = state.trick[0].card.s;
    var canFollow = state.players[seat].hand.some(function (c) { return c.s === led; });
    if (canFollow && card.s !== led) return 'you must follow ' + C.SUIT_NAME[led].toLowerCase();
    return 'not a legal card here';
  }

  function trickWinner(plays) {
    var best = plays[0];
    for (var i = 1; i < plays.length; i++) {
      if (C.beats(plays[i].card, best.card)) best = plays[i];
    }
    return best;
  }

  function finishTrick(state) {
    var best = trickWinner(state.trick);

    state.players[best.seat].tricks++;
    state.lastTrick = { cards: state.trick.slice(), winner: best.seat };
    state.tricksPlayed++;

    ev(state, 'trick', vb(state, best.seat) + ' took the trick with the ' +
      C.name(best.card) + '.', { seat: best.seat });

    /* A nil going down is the loudest thing that happens in this game and it
     * happens silently otherwise — a trick goes to somebody and only the score
     * at the end of the hand reveals it cost a hundred. Said the moment it is
     * certain. */
    if (state.players[best.seat].bid === 0 && state.players[best.seat].tricks === 1) {
      ev(state, 'nil', vb(state, best.seat) + ' bid nil and has taken a trick.',
        { seat: best.seat });
    }

    state.trick = [];
    state.leader = best.seat;
    state.turn = best.seat;

    if (state.tricksPlayed === HAND) return finishHand(state);
    return { ok: true };
  }

  /* ---------------- scoring ----------------
   *
   * Kept as a pure function of a hand's bids and tricks so that the oracle can
   * check it against a table of worked examples without having to play a hand to
   * get there, and so that the interface can explain a score without recomputing
   * it a second way. Everything it needs is passed in; it reads no state.
   *
   *   bids   - four bids, by seat
   *   tricks - four trick counts, by seat
   *   bagsIn - the two bag counts BEFORE this hand
   *   rules  - { bagLimit, bagPenalty, nilValue }
   *
   * Returns per-team deltas, the new bag counts, and enough detail for prose. */
  function scoreHand(bids, tricks, bagsIn, rules) {
    var out = { delta: [0, 0], bags: [bagsIn[0], bagsIn[1]], detail: [] };

    for (var team = 0; team < TEAMS; team++) {
      var contract = 0, took = 0, nils = [];
      for (var i = 0; i < SEATS; i++) {
        if (teamOf(i) !== team) continue;
        contract += bids[i];
        took += tricks[i];
        if (bids[i] === 0) nils.push({ seat: i, made: tricks[i] === 0, tricks: tricks[i] });
      }

      var d = { team: team, contract: contract, took: took, nils: nils, made: false,
        base: 0, overtricks: 0, nilPoints: 0, bagPenalty: 0 };

      /* Rule 2: the whole contract, not the difference. And a contract of zero —
       * both partners bid nil — is made by definition, which is right: there is
       * nothing to fail at, and the nils below carry the whole result. */
      if (took >= contract) {
        d.made = true;
        d.base = 10 * contract;
        d.overtricks = took - contract;
      } else {
        d.base = -10 * contract;
        d.overtricks = 0;
      }

      /* Rule 4: nil is its own bet, settled separately from the contract. */
      nils.forEach(function (n) {
        d.nilPoints += n.made ? rules.nilValue : -rules.nilValue;
      });

      /* Rule 3. Bags are only earned on a made contract — a set hand's extra
       * tricks are not overtricks, there was no contract to be over.
       *
       * The penalty can fire more than once in a hand: eight bags plus five
       * overtricks is thirteen, which is one bin emptied and three left over.
       * A single `if` would silently forgive the second, and a table playing to
       * a low bag limit would notice long before anybody found the code. */
      out.bags[team] += d.overtricks;
      while (rules.bagLimit > 0 && out.bags[team] >= rules.bagLimit) {
        out.bags[team] -= rules.bagLimit;
        d.bagPenalty += rules.bagPenalty;
      }

      out.delta[team] = d.base + d.overtricks + d.nilPoints - d.bagPenalty;
      out.detail.push(d);
    }

    return out;
  }

  function finishHand(state) {
    var bids = state.players.map(function (p) { return p.bid; });
    var tricks = state.players.map(function (p) { return p.tricks; });
    var rules = {
      bagLimit: bagLimitOf(state),
      bagPenalty: bagPenaltyOf(state),
      nilValue: nilValueOf(state)
    };

    var r = scoreHand(bids, tricks, state.bags, rules);

    state.scores[0] += r.delta[0];
    state.scores[1] += r.delta[1];
    state.bags = r.bags;

    r.detail.forEach(function (d) {
      var who = teamName(state, d.team);
      var line = who + ' bid ' + d.contract + ', took ' + d.took + ' — ' +
        (d.made ? 'made it' : 'set') + ', ' + signed(r.delta[d.team]) + '.';
      ev(state, 'score', line, { team: d.team, delta: r.delta[d.team] });

      d.nils.forEach(function (n) {
        ev(state, 'nil', vb(state, n.seat) + '’s nil ' +
          (n.made ? 'came in.' : 'went down on ' + n.tricks +
            (n.tricks === 1 ? ' trick.' : ' tricks.')), { seat: n.seat });
      });

      if (d.bagPenalty) {
        ev(state, 'bags', who + ' filled the bag bin — ' + d.bagPenalty + ' off.',
          { team: d.team });
      }
    });

    state.history.push({
      deal: state.dealNumber,
      dealer: state.dealer,
      bids: bids.slice(),
      tricks: tricks.slice(),
      delta: r.delta.slice(),
      scores: state.scores.slice(),
      bags: state.bags.slice()
    });

    ev(state, 'hand', 'Hand ' + state.dealNumber + ' over. ' +
      teamName(state, 0) + ' ' + state.scores[0] + ', ' +
      teamName(state, 1) + ' ' + state.scores[1] + '.');

    /* The target, read from the table's config at the point of use. See the
     * note at the top of the file. */
    var target = targetOf(state);
    var over0 = state.scores[0] >= target, over1 = state.scores[1] >= target;
    if (over0 || over1) {
      /* Both across the line in the same hand is possible — two contracts are
       * scored from one deal — so the higher score wins rather than whichever
       * happens to be checked first. Equal and both over is a genuine tie and
       * plays another hand rather than inventing a winner. */
      if (over0 && over1 && state.scores[0] === state.scores[1]) {
        ev(state, 'info', 'Both partnerships passed ' + target + ' and are level. ' +
          'Another hand decides it.');
        state.phase = 'handOver';
        return { ok: true };
      }
      state.winner = state.scores[0] > state.scores[1] ? 0 : 1;
      state.phase = 'gameOver';
      ev(state, 'game', teamName(state, state.winner) + ' win, ' +
        state.scores[state.winner] + ' to ' + state.scores[1 - state.winner] + '.');
    } else {
      state.phase = 'handOver';
    }
    return { ok: true };
  }

  function signed(n) { return n >= 0 ? '+' + n : String(n); }

  /* ---------------- who is to move ---------------- */

  function seatToAct(state) {
    /* -1 for nobody, and the dead phases matter: a room that asks a bot to move
     * during handOver gets a seat number still valid from the last trick, and
     * the bot plays into a hand that is over. */
    if (state.phase === 'bidding') return state.turn;
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
  ACTIONS.bid = true;
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

        case 'bid':
          return doBid(state, seat, action.bid);

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
    TEAMS: TEAMS,
    TARGET: TARGET,
    BAG_LIMIT: BAG_LIMIT,
    BAG_PENALTY: BAG_PENALTY,
    NIL_VALUE: NIL_VALUE,
    targetOf: targetOf,
    bagLimitOf: bagLimitOf,
    bagPenaltyOf: bagPenaltyOf,
    nilValueOf: nilValueOf,
    teamOf: teamOf,
    partnerOf: partnerOf,
    teamName: teamName,
    contractOf: contractOf,
    createGame: createGame,
    applyAction: applyAction,
    eventsFor: eventsFor,
    seatToAct: seatToAct,
    canDeal: canDeal,
    legalPlays: legalPlays,
    legalBids: legalBids,
    trickWinner: trickWinner,
    scoreHand: scoreHand,
    whyNot: whyNot,
    /* For the room, which writes prose about players too. */
    note: function (state, text) { return ev(state, 'info', text); },
    vb: vb
  };
})(typeof window !== 'undefined' ? window : globalThis);

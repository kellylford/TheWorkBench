/* Does the engine play spades, or does it play something that looks like it?
 *
 * Every rule below is re-derived here by a DIFFERENT method from the one game.js
 * uses, and the two are compared after every single move of thousands of hands.
 * A test that re-implements the engine's own logic proves that the logic is
 * self-consistent, which it always is, and nothing else.
 *
 * Where game.js filters a hand, this counts. Where game.js tracks a flag, this
 * looks at what has actually been played. Where game.js decides a trick as it
 * goes, this replays the cards afterwards. The scoring in particular is checked
 * against a completely separate implementation in tests/scoring.js, driven by
 * worked examples rather than by play.
 *
 * THE TARGET, THE BAG LIMIT AND THE NIL VALUE ARE TAKEN FROM THE CONFIG THIS
 * SUITE BUILT THE GAME WITH, never from the engine's own constants. A suite that
 * asks the engine for the number and then checks the engine against it agrees
 * with any bug that reads the same wrong number twice — which is exactly how the
 * game next door shipped a "short game to fifty" that ran to a hundred.
 *
 *   node tests/rules-oracle.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Math, JSON, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.SH.Cards;
const G = sandbox.SH.Game;
const AI = sandbox.SH.AI;

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

/* Repeatable. A suite that plays different hands every run reports different
 * results every run, and the first thing anybody does with an intermittent
 * failure is run it again. */
let seed = 20260825;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* ---------------- the oracle's own idea of the rules ---------------- */

const TRUMP = 'S';
const VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14 };

/* Which cards may be played, worked out by elimination rather than by building
 * a list: start from the whole hand and remove what the rules forbid, then put
 * everything back if nothing survives. game.js does it the other way round. */
function oracleLegal(state, seat) {
  const hand = state.players[seat].hand.slice();
  const leading = state.trick.length === 0;

  let allowed = hand.slice();

  if (leading) {
    /* Spades broken is RE-DERIVED from what has actually been played this hand,
     * not read off the engine's flag. A flag set in the wrong place is exactly
     * the bug this is looking for. */
    if (!spadesEverBroken(state)) {
      const notTrump = allowed.filter(c => c.s !== TRUMP);
      if (notTrump.length) allowed = notTrump;
    }
  } else {
    const led = state.trick[0].card.s;
    const canFollow = hand.some(c => c.s === led);
    if (canFollow) allowed = allowed.filter(c => c.s === led);
  }

  if (!allowed.length) allowed = hand.slice();
  return allowed.map(c => c.id).sort();
}

/* Has a spade been played on a trick led in something else?
 *
 * Tracked here by watching every play as it happens, in `brokenLog`, because the
 * engine does not keep the cards of completed tricks and there is nothing to
 * reconstruct from afterwards. That is a weaker position than the hearts oracle
 * is in, so this keeps its own record rather than trusting the engine's. */
function spadesEverBroken(state) {
  return brokenLog.broken;
}

let brokenLog = { broken: false };

function watchPlay(state, seat, card) {
  /* A spade played to a trick that was LED in something else. A spade led once
   * they are already broken does not re-break; a spade played to a spade lead is
   * following suit. */
  if (card.s === TRUMP && state.trick.length > 0 && state.trick[0].card.s !== TRUMP) {
    brokenLog.broken = true;
  }
}

/* Replay the cards of a trick and say who took them. Highest spade if any spade
 * is present; otherwise the highest card of the suit led. Written as two passes
 * over the plays rather than as a comparison chain, so that it shares no shape
 * with C.beats(). */
function oracleTrickWinner(plays) {
  const trumps = plays.filter(p => p.card.s === TRUMP);
  if (trumps.length) {
    return trumps.reduce((a, b) => VALUE[b.card.r] > VALUE[a.card.r] ? b : a).seat;
  }
  const led = plays[0].card.s;
  const onSuit = plays.filter(p => p.card.s === led);
  return onSuit.reduce((a, b) => VALUE[b.card.r] > VALUE[a.card.r] ? b : a).seat;
}

/* ---------------- play a lot of spades ---------------- */

const seen = {
  nilBid: 0, nilMade: 0, nilBroken: 0, setHands: 0, madeHands: 0,
  bagPenalties: 0, trumped: 0, spadeLeads: 0, voidDiscards: 0,
  tricks: 0, hands: 0, games: 0, targets: {}, bothOver: 0
};

function playGames(n, config) {
  for (let g = 0; g < n; g++) {
    const cfg = Object.assign(
      { names: ['North', 'East', 'South', 'West'] }, config || {});
    const state = G.createGame(cfg);

    /* The rules THIS game is meant to run by, from the config it was built with
     * and never from the engine. See the note at the top. */
    const target = cfg.pointsToWin || G.TARGET;
    const bagLimit = cfg.bagLimit || G.BAG_LIMIT;
    const bagPenalty = cfg.bagPenalty === undefined ? G.BAG_PENALTY : cfg.bagPenalty;
    const nilValue = cfg.nilValue || G.NIL_VALUE;
    seen.targets[target] = (seen.targets[target] || 0) + 1;

    let res = G.applyAction(state, 0, { type: 'start' }, rng);
    check(res.ok, 'start refused: ' + res.reason);

    let guard = 0;
    let handBids = null;

    while (state.phase !== 'gameOver' && guard++ < 40000) {
      if (state.phase === 'bidding') {
        const seat = G.seatToAct(state);
        check(seat >= 0, 'bidding with nobody to act');
        if (seat < 0) break;

        /* Bidding goes round from the dealer's left, one seat at a time, and the
         * dealer speaks last. Re-derived from the dealer rather than read from
         * state.turn. */
        const expected = (state.dealer + 1 + state.players.filter(p => p.bid !== null).length)
          % G.SEATS;
        check(seat === expected,
          'bidding out of order: engine says seat ' + seat + ', oracle says ' + expected +
          ' (dealer ' + state.dealer + ')');

        const bid = AI.chooseBid(state, seat);
        const r = G.applyAction(state, seat, { type: 'bid', bid }, rng);
        check(r.ok, 'bid refused: ' + r.reason);

        /* A second bid from the same seat must be refused, and must change
         * nothing. */
        const again = G.applyAction(state, seat, { type: 'bid', bid: 1 }, rng);
        check(!again.ok, 'the engine accepted a second bid from seat ' + seat);

        if (state.phase === 'play') {
          brokenLog = { broken: false };
          handBids = state.players.map(p => p.bid);
          state.players.forEach((p, i) => {
            check(p.bid !== null, 'play began with seat ' + i + ' not having bid');
          });
          seen.hands++;
          handBids.forEach(b => { if (b === 0) seen.nilBid++; });
        }
        continue;
      }

      if (state.phase === 'play') {
        const seat = G.seatToAct(state);
        check(seat === state.turn, 'seatToAct disagrees with turn in play');

        checkPlayPhase(state);

        const legal = G.legalPlays(state, seat);
        check(legal.length > 0, 'no legal play for seat ' + seat +
          ' holding ' + state.players[seat].hand.map(c => c.id).join(' '));
        if (!legal.length) break;

        const pick = AI.chooseCard(state, seat);
        check(!!pick, 'the computer had no card at seat ' + seat);
        check(legal.some(c => c.id === pick.id),
          'the computer chose an illegal card ' + (pick && pick.id));

        const card = C.get(pick.id);
        const trickBefore = state.trick.slice();
        const leadSuit = trickBefore.length ? trickBefore[0].card.s : null;
        const heldLed = leadSuit
          ? state.players[seat].hand.some(c => c.s === leadSuit) : false;

        watchPlay(state, seat, card);

        if (leadSuit && !heldLed) {
          seen.voidDiscards++;
          if (card.s === TRUMP && leadSuit !== TRUMP) seen.trumped++;
        }
        if (!trickBefore.length && card.s === TRUMP) seen.spadeLeads++;

        const before = state.tricksPlayed;
        const r = G.applyAction(state, seat, { type: 'play', card: pick.id }, rng);
        check(r.ok, 'play refused: ' + r.reason);

        /* The engine's broken flag against the oracle's, after every play. */
        check(state.spadesBroken === brokenLog.broken,
          'spadesBroken drifted: engine ' + state.spadesBroken +
          ', oracle ' + brokenLog.broken + ' at trick ' + state.tricksPlayed);

        if (state.tricksPlayed === before + 1) {
          seen.tricks++;
          const plays = trickBefore.concat([{ seat, card }]);
          const want = oracleTrickWinner(plays);
          check(state.lastTrick && state.lastTrick.winner === want,
            'trick winner: engine said ' + (state.lastTrick && state.lastTrick.winner) +
            ', oracle said ' + want + ' for ' +
            plays.map(p => p.card.id).join(' '));
        }
        continue;
      }

      if (state.phase === 'handOver' || state.phase === 'gameOver') {
        if (handBids) { checkHandScored(state, handBids, { bagLimit, bagPenalty, nilValue }); handBids = null; }
        if (state.phase === 'gameOver') break;
        const r = G.applyAction(state, 0, { type: 'nextHand' }, rng);
        check(r.ok, 'nextHand refused at handOver: ' + r.reason);
        continue;
      }
      break;
    }

    /* THE LAST HAND OF THE GAME, which the loop above cannot reach.
     *
     * `while (state.phase !== 'gameOver')` exits the moment finishHand declares
     * a winner, so the scoring branch inside the loop never runs for the hand
     * that ended the game. Every other hand was checked and the deciding one —
     * the hand where the scoring matters most, and the only hand that can push a
     * side past the target — was silently skipped.
     *
     * Found by a count that did not add up: forty-five nils bid and thirty-eight
     * accounted for at scoring, a gap of exactly one hand per game. A suite that
     * had only reported "pass" would have hidden it for ever. */
    if (handBids) { checkHandScored(state, handBids, { bagLimit, bagPenalty, nilValue }); handBids = null; }

    check(state.phase === 'gameOver', 'game did not finish, stuck in ' + state.phase);
    if (state.phase === 'gameOver') {
      seen.games++;

      check(state.scores[0] >= target || state.scores[1] >= target,
        'game ended before either side reached ' + target +
        ': scores ' + state.scores.join(','));

      /* The winner is the HIGHER score, and it is over the line. */
      const hi = state.scores[0] >= state.scores[1] ? 0 : 1;
      check(state.winner === hi,
        'the winner is not the higher score: winner ' + state.winner +
        ', scores ' + state.scores.join(','));
      check(state.scores[state.winner] >= target,
        'the winner is under the target');

      /* And it ended on the hand it should have. Every hand but the last must
       * leave BOTH sides under the line — a game that plays on past the target
       * still finishes with somebody over it, so the check above passes on its
       * own while the game runs to a different number entirely. */
      state.history.slice(0, -1).forEach(h => {
        const over = h.scores.filter(s => s >= target);
        /* The one legitimate exception: both sides crossing in the same hand
         * and being level plays on, because there is no winner to declare. */
        const levelAndOver = over.length === 2 && h.scores[0] === h.scores[1];
        if (levelAndOver) { seen.bothOver++; return; }
        check(over.length === 0,
          'hand ' + h.deal + ' put somebody on ' + Math.max(...h.scores) +
          ', at or past the target of ' + target + ', and the game carried on');
      });
    }
  }
}

/* Every rule that governs a single play, checked before it is made. */
function checkPlayPhase(state) {
  const seat = state.turn;

  /* The engine's legal list and the oracle's must agree exactly, every move. */
  const mine = G.legalPlays(state, seat).map(c => c.id).sort();
  const theirs = oracleLegal(state, seat);
  check(JSON.stringify(mine) === JSON.stringify(theirs),
    'legal plays differ for seat ' + seat + ' (trick ' + state.tricksPlayed + ', ' +
    state.trick.length + ' played): engine ' + mine.join(' ') + ' / oracle ' + theirs.join(' '));

  /* Nobody may play out of turn, and every other seat must be refused. */
  if (state.trick.length < G.SEATS) {
    for (let other = 0; other < G.SEATS; other++) {
      if (other === seat) continue;
      const card = state.players[other].hand[0];
      if (!card) continue;
      const r = G.applyAction(state, other, { type: 'play', card: card.id });
      check(!r.ok, 'seat ' + other + ' played out of turn while seat ' + seat + ' was to act');
    }
  }

  /* Hands are the same size, or one apart mid-trick. Thirteen cards dealt to
   * four seats can drift only if a card is duplicated or lost. */
  const sizes = state.players.map(p => p.hand.length);
  check(Math.max(...sizes) - Math.min(...sizes) <= 1,
    'hand sizes drifted: ' + sizes.join(','));

  /* No card exists twice, anywhere. */
  const all = {};
  let dupes = 0;
  state.players.forEach(p => p.hand.forEach(c => { if (all[c.id]) dupes++; all[c.id] = true; }));
  state.trick.forEach(t => { if (all[t.card.id]) dupes++; all[t.card.id] = true; });
  check(dupes === 0, 'the same card is in play twice');
}

/* The hand is over. Re-derive the score from the bids and the trick counts by a
 * method that shares nothing with scoreHand, and compare. */
function checkHandScored(state, bids, rules) {
  const h = state.history[state.history.length - 1];
  check(!!h, 'a hand finished without a history row');
  if (!h) return;

  const tricks = h.tricks;
  check(tricks.reduce((a, b) => a + b, 0) === G.HAND,
    'the tricks do not add up to ' + G.HAND + ': ' + tricks.join(','));
  check(JSON.stringify(h.bids) === JSON.stringify(bids),
    'the history recorded different bids from the ones made');

  for (let team = 0; team < 2; team++) {
    const seats = [team, team + 2];
    const contract = seats.reduce((a, s) => a + bids[s], 0);
    const took = seats.reduce((a, s) => a + tricks[s], 0);

    if (took >= contract) seen.madeHands++; else seen.setHands++;

    /* Built up term by term, in the words of the rules, rather than by calling
     * the engine's scorer. */
    let want = 0;
    let over = 0;
    if (took >= contract) { want += 10 * contract; over = took - contract; want += over; }
    else { want += -10 * contract; }

    seats.forEach(s => {
      if (bids[s] !== 0) return;
      const made = tricks[s] === 0;
      want += made ? rules.nilValue : -rules.nilValue;
      if (made) seen.nilMade++; else seen.nilBroken++;
    });

    /* Bags, including the case where one hand fills the bin more than once. */
    const prev = state.history.length > 1
      ? state.history[state.history.length - 2].bags[team] : 0;
    let bags = prev + over;
    let penalties = 0;
    while (rules.bagLimit > 0 && bags >= rules.bagLimit) {
      bags -= rules.bagLimit;
      penalties += rules.bagPenalty;
    }
    want -= penalties;
    if (penalties) seen.bagPenalties++;

    check(h.delta[team] === want,
      'hand ' + h.deal + ' team ' + team + ': engine scored ' + h.delta[team] +
      ', oracle says ' + want + ' (bid ' + contract + ', took ' + took +
      ', bids ' + bids.join(',') + ', tricks ' + tricks.join(',') + ')');
    check(h.bags[team] === bags,
      'hand ' + h.deal + ' team ' + team + ': engine has ' + h.bags[team] +
      ' bags, oracle says ' + bags);
  }

  /* And the running total is the sum of every delta so far. A per-hand score
   * that is right while the total drifts is a real and quiet failure mode. */
  for (let team = 0; team < 2; team++) {
    const total = state.history.reduce((a, row) => a + row.delta[team], 0);
    check(h.scores[team] === total,
      'the running score for team ' + team + ' is ' + h.scores[team] +
      ' but the hands add to ' + total);
  }
}

/* ---------------- refusals ---------------- */

function checkRefusals() {
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });

  check(!G.applyAction(state, 0, { type: 'play', card: 'AS' }).ok,
    'a card was played before the game started');
  check(!G.applyAction(state, 0, { type: 'bid', bid: 3 }).ok,
    'a bid was accepted before the game started');
  check(!G.applyAction(state, 0, { type: 'nextHand' }).ok,
    'a deal was accepted at idle');
  check(!G.applyAction(state, 0, { type: 'nonsense' }).ok, 'an unknown action was accepted');
  check(!G.applyAction(state, 0, null).ok, 'a null action was accepted');
  check(!G.applyAction(state, 9, { type: 'bid', bid: 1 }).ok, 'seat 9 was allowed to act');
  check(!G.applyAction(state, -1, { type: 'bid', bid: 1 }).ok, 'seat -1 was allowed to act');
  check(!G.applyAction(state, 1.5, { type: 'bid', bid: 1 }).ok, 'a fractional seat was allowed to act');

  /* __proto__ and constructor are truthy on a plain object, which is why
   * ACTIONS is Object.create(null). */
  check(!G.applyAction(state, 0, { type: '__proto__' }).ok, '__proto__ was accepted as an action');
  check(!G.applyAction(state, 0, { type: 'constructor' }).ok, 'constructor was accepted as an action');

  G.applyAction(state, 0, { type: 'start' }, rng);
  check(state.phase === 'bidding', 'start did not begin the bidding');
  check(!G.applyAction(state, 0, { type: 'start' }).ok, 'the game was started twice');

  /* Bids outside the range, and bids that are not whole numbers. */
  const bidder = state.turn;
  [-1, 14, 1.5, '3', null, undefined, NaN, Infinity].forEach(bad => {
    const r = G.applyAction(state, bidder, { type: 'bid', bid: bad });
    check(!r.ok, 'the engine accepted a bid of ' + String(bad));
  });
  check(state.players[bidder].bid === null, 'a refused bid was recorded anyway');

  /* A card cannot be played during the bidding. */
  check(!G.applyAction(state, bidder, { type: 'play', card: state.players[bidder].hand[0].id }).ok,
    'a card was played during the bidding');

  /* Nil is a legal bid, and zero is not treated as "no bid". */
  const r0 = G.applyAction(state, bidder, { type: 'bid', bid: 0 }, rng);
  check(r0.ok, 'nil was refused as a bid');
  check(state.players[bidder].bid === 0, 'a nil bid was not recorded as zero');
}

/* Every phase the engine can be in, and whether canDeal agrees with what
 * applyAction actually accepts. These have disagreed in this repository, in both
 * directions, and both are silent. */
function checkCanDeal() {
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'], pointsToWin: 100 });
  const phasesSeen = new Set();
  let guard = 0;

  const probe = () => {
    phasesSeen.add(state.phase);
    const said = G.canDeal(state);
    /* Ask on a COPY, so the answer does not change the game being walked. */
    const copy = JSON.parse(JSON.stringify(state));
    const did = G.applyAction(copy, 0, { type: 'nextHand' }, () => 0.5).ok;
    check(said === did,
      'canDeal says ' + said + ' at phase ' + state.phase + ' but applyAction ' +
      (did ? 'accepted' : 'refused') + ' a deal');
  };

  probe();
  G.applyAction(state, 0, { type: 'start' }, rng);
  while (state.phase !== 'gameOver' && guard++ < 40000) {
    probe();
    if (state.phase === 'handOver') { G.applyAction(state, 0, { type: 'nextHand' }, rng); continue; }
    if (G.seatToAct(state) < 0) break;
    AI.act(state);
  }
  probe();

  check(phasesSeen.has('idle') && phasesSeen.has('bidding') && phasesSeen.has('play') &&
    phasesSeen.has('handOver') && phasesSeen.has('gameOver'),
    'the canDeal walk only reached ' + [...phasesSeen].join(', '));
}

/* seatToAct must be -1 in every phase where nobody is to move, and a real seat
 * in every phase where somebody is. A room that prods a bot during handOver gets
 * a seat number left over from the last trick. */
function checkSeatToAct() {
  const dead = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  check(G.seatToAct(dead) === -1, 'seatToAct answered at idle');

  const state = G.createGame({ names: ['N', 'E', 'S', 'W'], pointsToWin: 100 });
  G.applyAction(state, 0, { type: 'start' }, rng);
  let guard = 0;
  while (state.phase !== 'gameOver' && guard++ < 40000) {
    const s = G.seatToAct(state);
    if (state.phase === 'bidding' || state.phase === 'play') {
      check(s >= 0 && s < G.SEATS, 'seatToAct gave ' + s + ' at phase ' + state.phase);
    } else {
      check(s === -1, 'seatToAct gave ' + s + ' at phase ' + state.phase);
    }
    if (state.phase === 'handOver') { G.applyAction(state, 0, { type: 'nextHand' }, rng); continue; }
    if (s < 0) break;
    AI.act(state);
  }
  check(G.seatToAct(state) === -1, 'seatToAct answered at gameOver');
}

/* ---------------- run ---------------- */

checkRefusals();
checkCanDeal();
checkSeatToAct();

playGames(30);
/* The short game. Offered on the start screen and in settings, carried through
 * the room config to every seat — and the whole point of testing it here is that
 * the game must END there, not merely finish with somebody past it. */
playGames(10, { pointsToWin: 250 });
/* A table with different bag rules. bagPenalty of zero is a real choice — count
 * the bags, do not punish them — and zero is the value most likely to be eaten
 * by a falsy check somewhere. */
playGames(6, { pointsToWin: 250, bagLimit: 5, bagPenalty: 50, nilValue: 50 });
playGames(4, { pointsToWin: 250, bagPenalty: 0 });

console.log(checks.toLocaleString() + ' assertions across ' + seen.games + ' games, ' +
  seen.hands + ' hands, ' + seen.tricks + ' tricks');
console.log('  contracts: ' + seen.madeHands + ' made, ' + seen.setHands + ' set' +
  '   bag penalties: ' + seen.bagPenalties);
console.log('  nils: ' + seen.nilBid + ' bid, ' + seen.nilMade + ' made, ' +
  seen.nilBroken + ' broken');
console.log('  spades: ' + seen.trumped + ' ruffs, ' + seen.spadeLeads + ' led, ' +
  seen.voidDiscards + ' discards when void');
console.log('  targets played to: ' +
  Object.entries(seen.targets).map(([k, v]) => k + ' points x' + v).join(', '));

/* A run that never met the interesting cases has not tested them, and saying so
 * is the difference between a green suite and a green suite worth believing. */
const gaps = [];
/* Every hand that began play must have been scored and checked. This is the
 * assertion the nil count would have made unnecessary if anybody had read it:
 * a suite that quietly skips hands is a suite whose pass means less than it
 * appears to. */
if (seen.nilMade + seen.nilBroken !== seen.nilBid) {
  fails.push('the suite bid ' + seen.nilBid + ' nils but only settled ' +
    (seen.nilMade + seen.nilBroken) + ' — some hands were never scored');
}
if (!seen.hands) gaps.push('no hand was ever played');
if (!seen.setHands) gaps.push('no contract was ever set, so the negative scoring went untested');
if (!seen.madeHands) gaps.push('no contract was ever made');
if (!seen.nilBid) gaps.push('nobody ever bid nil, so a hundred points of the rules went untested');
if (!seen.nilMade) gaps.push('no nil ever came in');
if (!seen.nilBroken) gaps.push('no nil was ever broken, so the minus-a-hundred path went untested');
if (!seen.bagPenalties) gaps.push('the bag bin never filled, so the penalty went untested');
if (!seen.trumped) gaps.push('nobody ever ruffed, so trumping in went untested');
if (!seen.spadeLeads) gaps.push('a spade was never led, so the broken-spades rule went untested');
if (Object.keys(seen.targets).length < 2) {
  gaps.push('every game ran to the same target, so the configured target went untested');
}
gaps.forEach(g => fails.push(g));

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 20).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('\nThe engine plays the game the rules describe.');

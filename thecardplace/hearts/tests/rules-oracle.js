/* Does the engine play hearts, or does it play something that looks like it?
 *
 * Every rule below is re-derived here by a DIFFERENT method from the one game.js
 * uses, and the two are compared after every single move of thousands of hands.
 * A test that re-implements the engine's own logic proves that the logic is
 * self-consistent, which it always is, and nothing else.
 *
 * Where game.js filters a hand, this counts. Where game.js tracks a flag, this
 * looks at what has actually been played. Where game.js decides a trick as it
 * goes, this replays the four cards afterwards. The moon in particular is
 * checked by taking every card back out of every trick and adding it up from
 * the pack, rather than by trusting a running total.
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
for (const f of ['js/cards.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.SH.Cards;
const G = sandbox.SH.Game;

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

/* Repeatable. A suite that plays different hands every run reports different
 * results every run, and the first thing anybody does with an intermittent
 * failure is run it again. */
let seed = 20260821;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* ---------------- the oracle's own idea of the rules ---------------- */

const POINTS = c => (c.s === 'H' ? 1 : c.id === 'QS' ? 13 : 0);

/* Which cards may be played, worked out by elimination rather than by building
 * a list: start from the whole hand and remove what the rules forbid, then put
 * everything back if nothing survives. game.js does it the other way round. */
function oracleLegal(state, seat) {
  const hand = state.players[seat].hand.slice();
  const leading = state.trick.length === 0;
  const first = state.tricksPlayed === 0;

  if (leading && first) {
    const two = hand.filter(c => c.id === '2C');
    if (two.length) return two.map(c => c.id).sort();
  }

  let allowed = hand.slice();

  if (!leading) {
    const led = state.trick[0].card.s;
    const canFollow = hand.some(c => c.s === led);
    if (canFollow) allowed = allowed.filter(c => c.s === led);
  }

  if (leading && !first) {
    /* Hearts broken is re-derived from the cards actually played this hand, not
     * read off the engine's flag. A flag that is set in the wrong place is
     * exactly the bug this is looking for. */
    if (!heartEverPlayed(state)) {
      const notHearts = allowed.filter(c => c.s !== 'H');
      if (notHearts.length) allowed = notHearts;
    }
  }

  if (first) {
    const safe = allowed.filter(c => POINTS(c) === 0);
    if (safe.length) allowed = safe;
  }

  if (!allowed.length) allowed = hand.slice();
  return allowed.map(c => c.id).sort();
}

/* Has any heart hit the table this hand? Taken from the tricks that have been
 * won plus what is on the table right now — the engine's own heartsBroken flag
 * is never consulted. */
function heartEverPlayed(state) {
  if (state.trick.some(t => t.card.s === 'H')) return true;
  return state.players.some(p => p.taken.some(c => c.s === 'H'));
}

/* Replay four cards and say who took them. Highest of the led suit; nothing
 * else can win, because there is no trump. */
function oracleTrickWinner(plays) {
  const led = plays[0].card.s;
  let best = plays[0];
  for (const p of plays.slice(1)) {
    if (p.card.s !== led) continue;
    if (C.power(p.card) > C.power(best.card)) best = p;
  }
  return best.seat;
}

/* ---------------- play a lot of hearts ---------------- */

const seen = {
  moon: 0, qsPlayed: 0, heartsLed: 0, firstTrickDiscard: 0,
  passDirs: {}, allHeartsHand: 0, tricks: 0, hands: 0, games: 0, targets: {}
};

function playGames(n, config) {
  for (let g = 0; g < n; g++) {
    const state = G.createGame(Object.assign(
      { names: ['North', 'East', 'South', 'West'] }, config || {}));
    /* The number this game is meant to end on, taken from the config the table
     * was made with rather than from the engine's default. A suite that asks
     * the engine for the target and then checks the engine against it agrees
     * with any bug that reads the same wrong number twice. */
    const target = (config && config.pointsToWin) || G.TARGET;
    seen.targets[target] = (seen.targets[target] || 0) + 1;
    let res = G.applyAction(state, 0, { type: 'start' }, rng);
    check(res.ok, 'start refused: ' + res.reason);

    let guard = 0;
    while (state.phase !== 'gameOver' && guard++ < 4000) {
      if (state.phase === 'passing') {
        const seat = G.seatToAct(state);
        check(seat >= 0, 'passing with nobody to act');
        if (seat < 0) break;

        const before = state.players.map(p => p.hand.length);
        const chosen = state.players[seat].hand.slice(0, 3).map(c => c.id);
        const r = G.applyAction(state, seat, { type: 'pass', cards: chosen }, rng);
        check(r.ok, 'pass refused: ' + r.reason);

        /* Nobody may be handed a card before everybody has chosen. If the swap
         * happened early, some hand would already have changed size. */
        if (state.phase === 'passing') {
          const now = state.players.map(p => p.hand.length);
          check(now.every(n2 => n2 === 13),
            'a hand changed size mid-pass: ' + before.join(',') + ' -> ' + now.join(','));
        }
        continue;
      }

      if (state.phase === 'play') {
        checkPlayPhase(state);
        const seat = state.turn;
        const legal = oracleLegal(state, seat);
        const pick = legal[Math.floor(rng() * legal.length)];
        const trickBefore = state.trick.slice();
        const r = G.applyAction(state, seat, { type: 'play', card: pick }, rng);
        check(r.ok, 'legal play refused: ' + pick + ' — ' + r.reason);

        if (trickBefore.length === 3 && r.ok) {
          seen.tricks++;
          const plays = trickBefore.concat([{ seat, card: C.get(pick) }]);
          const want = oracleTrickWinner(plays);
          check(state.lastTrick && state.lastTrick.winner === want,
            'trick winner: engine said ' + (state.lastTrick && state.lastTrick.winner) +
            ', oracle said ' + want + ' for ' +
            plays.map(p => p.card.id).join(' '));
          check(state.lastTrick.points === plays.reduce((a, p) => a + POINTS(p.card), 0),
            'trick points wrong for ' + plays.map(p => p.card.id).join(' '));
        }
        continue;
      }

      if (state.phase === 'handOver') {
        checkHandOver(state);
        const r = G.applyAction(state, 0, { type: 'nextHand' }, rng);
        check(r.ok, 'nextHand refused at handOver: ' + r.reason);
        continue;
      }
      break;
    }

    check(state.phase === 'gameOver', 'game did not finish, stuck in ' + state.phase);
    if (state.phase === 'gameOver') {
      checkHandOver(state);
      seen.games++;
      const low = Math.min(...state.players.map(p => p.score));
      const winners = state.players.filter(p => p.score === low);
      if (winners.length === 1) {
        check(state.winner === winners[0].index,
          'the winner is not the lowest score: winner ' + state.winner +
          ', scores ' + state.players.map(p => p.score).join(','));
      }
      check(state.players.some(p => p.score >= target),
        'game ended before anybody reached ' + target +
        ': scores ' + state.players.map(p => p.score).join(','));

      /* And it ended on the hand it should have. The scores after every hand
       * but the last must all be under the line — a game that plays on past
       * the target still finishes with somebody over it, so the check above
       * passes on its own while the game runs to a different number entirely.
       * This is the half that a hard-coded target hid for as long as it did. */
      state.history.slice(0, -1).forEach(h => {
        check(h.scores.every(sc => sc < target),
          'hand ' + h.deal + ' left somebody on ' + Math.max(...h.scores) +
          ', at or past the target of ' + target + ', and the game carried on');
      });
    }
  }
}

function checkPlayPhase(state) {
  const seat = state.turn;

  /* The engine's legal list and the oracle's must agree exactly, every move. */
  const mine = G.legalPlays(state, seat).map(c => c.id).sort();
  const theirs = oracleLegal(state, seat);
  check(JSON.stringify(mine) === JSON.stringify(theirs),
    'legal plays differ for seat ' + seat + ' (trick ' + state.tricksPlayed + ', ' +
    state.trick.length + ' played): engine ' + mine.join(' ') + ' / oracle ' + theirs.join(' '));

  /* heartsBroken is a cache. Anything cached can drift from the thing it caches. */
  check(state.heartsBroken === heartEverPlayed(state),
    'heartsBroken says ' + state.heartsBroken + ' but ' +
    (heartEverPlayed(state) ? 'a heart has been played' : 'no heart has been played'));

  /* Nothing may be in two places. Every one of the fifty-two cards is in exactly
   * one hand, one pile of tricks, or on the table. */
  const all = [];
  state.players.forEach(p => { all.push(...C.ids(p.hand)); all.push(...C.ids(p.taken)); });
  state.trick.forEach(t => all.push(t.card.id));
  check(all.length === 52, 'the pack has ' + all.length + ' cards in it');
  check(new Set(all).size === all.length, 'a card is in two places at once');

  if (state.tricksPlayed === 0 && state.trick.length === 0) {
    check(state.turn === G.holderOfTwoOfClubs(state),
      'the first trick is not led by the two of clubs');
  }

  /* Coverage, so the report can say whether the interesting cases happened. */
  if (state.trick.length === 0 && state.tricksPlayed > 0) {
    const legal = G.legalPlays(state, seat);
    if (legal.every(c => c.s === 'H')) seen.allHeartsHand++;
    if (state.heartsBroken && legal.some(c => c.s === 'H')) seen.heartsLed++;
  }
  if (state.tricksPlayed === 0 && state.trick.length > 0) {
    const led = state.trick[0].card.s;
    if (!state.players[seat].hand.some(c => c.s === led)) seen.firstTrickDiscard++;
  }
}

function checkHandOver(state) {
  seen.hands++;
  seen.passDirs[state.passDir] = (seen.passDirs[state.passDir] || 0) + 1;

  /* Add the hand up from the cards themselves, not from any total the engine
   * kept. Every trick is back in somebody's `taken` pile by now, so the whole
   * twenty-six points are recoverable from the pack. */
  const raw = state.players.map(p => p.taken.reduce((a, c) => a + POINTS(c), 0));
  const total = raw.reduce((a, b) => a + b, 0);
  check(total === 26, 'a finished hand is worth ' + total + ' points, not 26');

  const cardsTaken = state.players.reduce((a, p) => a + p.taken.length, 0);
  check(cardsTaken === 52, 'a finished hand accounts for ' + cardsTaken + ' cards');

  const qs = state.players.filter(p => p.taken.some(c => c.id === 'QS'));
  check(qs.length === 1, 'the queen of spades ended up in ' + qs.length + ' piles');
  if (qs.length === 1) seen.qsPlayed++;

  const last = state.history[state.history.length - 1];
  check(!!last, 'no history row was written for the hand');
  if (!last) return;

  const shot = raw.findIndex(n => n === 26);
  if (shot >= 0) {
    seen.moon++;
    check(last.shooter === shot,
      'seat ' + shot + ' took all 26 and the engine recorded shooter ' + last.shooter);
    /* The inversion, stated the other way round from game.js: the shooter takes
     * nothing and everybody else takes the lot. */
    state.players.forEach((p, i) => {
      check(last.points[i] === (i === shot ? 0 : 26),
        'moon scoring: seat ' + i + ' got ' + last.points[i]);
    });
  } else {
    check(last.shooter === -1, 'a shooter was recorded when nobody took all 26');
    state.players.forEach((p, i) => {
      check(last.points[i] === raw[i],
        'hand points for seat ' + i + ': engine ' + last.points[i] + ', cards say ' + raw[i]);
    });
  }

  /* Running totals are the sum of every hand, re-added from the history. */
  const sums = [0, 0, 0, 0];
  state.history.forEach(h => h.points.forEach((n, i) => { sums[i] += n; }));
  state.players.forEach((p, i) => {
    check(p.score === sums[i],
      'seat ' + i + ' shows ' + p.score + ' but its hands add up to ' + sums[i]);
  });
}

/* ---------------- the passing, on its own ---------------- */

function checkPassing() {
  /* Across is the direction that catches a sequential swap: seats 0 and 2 hand
   * each other three cards, and a loop that removes and adds one seat at a time
   * gives seat 0 its own cards straight back. */
  for (const dir of G.PASS_DIRS) {
    if (dir === 'hold') continue;
    const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
    G.applyAction(state, 0, { type: 'start' }, rng);
    while (state.passDir !== dir) {
      /* Deal on until the direction comes round. Passing whatever, then playing
       * the hand out, is more machinery than this needs — the direction is a
       * function of the deal number, so just re-deal. */
      state.phase = 'handOver';
      G.applyAction(state, 0, { type: 'nextHand' }, rng);
    }
    if (state.phase !== 'passing') continue;

    const gave = state.players.map(p => p.hand.slice(0, 3).map(c => c.id));
    gave.forEach((cards, i) => {
      const r = G.applyAction(state, i, { type: 'pass', cards }, rng);
      check(r.ok, dir + ': pass refused — ' + r.reason);
    });

    const offset = G.PASS_OFFSET[dir];
    for (let from = 0; from < 4; from++) {
      const to = (from + offset) % 4;
      const held = new Set(C.ids(state.players[to].hand));
      gave[from].forEach(id => {
        check(held.has(id), dir + ': seat ' + to + ' never received ' + id + ' from seat ' + from);
      });
      const back = new Set(C.ids(state.players[from].hand));
      gave[from].forEach(id => {
        check(!back.has(id), dir + ': seat ' + from + ' still holds ' + id + ' after passing it');
      });
    }
    state.players.forEach((p, i) => {
      check(p.hand.length === 13, dir + ': seat ' + i + ' holds ' + p.hand.length + ' cards');
    });
  }

  /* A hold hand passes nothing and goes straight to play. */
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  let guard = 0;
  while (state.passDir !== 'hold' && guard++ < 20) {
    state.phase = 'handOver';
    G.applyAction(state, 0, { type: 'nextHand' }, rng);
  }
  check(state.passDir === 'hold', 'never reached a hold hand');
  check(state.phase === 'play', 'a hold hand should go straight to play, not ' + state.phase);
}

/* ---------------- refusals ---------------- */

function checkRefusals() {
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });

  check(!G.applyAction(state, 0, { type: 'nextHand' }, rng).ok,
    'nextHand was accepted before the game started');
  check(!G.applyAction(state, 0, { type: 'play', card: '2C' }, rng).ok,
    'a card was played before the game started');
  check(!G.applyAction(state, 0, { type: 'constructor' }, rng).ok,
    'ACTIONS inherited from Object.prototype');
  check(!G.applyAction(state, 0, { type: '__proto__' }, rng).ok,
    'ACTIONS inherited __proto__');
  check(!G.applyAction(state, 9, { type: 'start' }, rng).ok, 'seat 9 was allowed to act');
  check(!G.applyAction(state, -1, { type: 'start' }, rng).ok, 'seat -1 was allowed to act');
  check(!G.applyAction(state, 1.5, { type: 'start' }, rng).ok, 'seat 1.5 was allowed to act');

  G.applyAction(state, 0, { type: 'start' }, rng);
  check(!G.applyAction(state, 0, { type: 'start' }, rng).ok, 'the game started twice');

  if (state.phase === 'passing') {
    const hand = state.players[0].hand;
    check(!G.applyAction(state, 0, { type: 'pass', cards: [hand[0].id] }, rng).ok,
      'a pass of one card was accepted');
    check(!G.applyAction(state, 0, { type: 'pass', cards: [hand[0].id, hand[0].id, hand[1].id] }, rng).ok,
      'the same card was passed twice');
    const notMine = C.ids(state.players[1].hand).filter(id => !C.ids(hand).includes(id));
    check(!G.applyAction(state, 0, { type: 'pass', cards: notMine.slice(0, 3) }, rng).ok,
      'a seat passed cards it does not hold');
    check(G.applyAction(state, 0, { type: 'pass', cards: C.ids(hand).slice(0, 3) }, rng).ok,
      'a legal pass was refused');
    check(!G.applyAction(state, 0, { type: 'pass', cards: C.ids(state.players[0].hand).slice(0, 3) }, rng).ok,
      'a seat passed twice');
  }

  /* canDeal must be EXACTLY what nextHand accepts. The shared contract test
   * checks this across every game; it is here too because it is a rule about
   * THIS engine and belongs where somebody changing the phases will see it. */
  const probe = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(probe, 0, { type: 'start' }, rng);
  let steps = 0;
  const phasesSeen = new Set();
  while (steps++ < 3000) {
    phasesSeen.add(probe.phase);
    const copy = JSON.parse(JSON.stringify(probe));
    const accepted = G.applyAction(copy, 0, { type: 'nextHand' }, rng).ok;
    check(G.canDeal(probe) === accepted,
      'phase ' + probe.phase + ': canDeal says ' + G.canDeal(probe) +
      ' but nextHand ' + (accepted ? 'is accepted' : 'is refused'));
    if (probe.phase === 'gameOver') break;
    if (probe.phase === 'passing') {
      const seat = G.seatToAct(probe);
      G.applyAction(probe, seat, { type: 'pass', cards: C.ids(probe.players[seat].hand).slice(0, 3) }, rng);
    } else if (probe.phase === 'play') {
      const legal = G.legalPlays(probe, probe.turn);
      G.applyAction(probe, probe.turn, { type: 'play', card: legal[0].id }, rng);
    } else if (probe.phase === 'handOver') {
      G.applyAction(probe, 0, { type: 'nextHand' }, rng);
    } else break;
  }
  check(phasesSeen.size >= 4,
    'the canDeal walk only reached ' + [...phasesSeen].join(', '));
}

/* ---------------- run ---------------- */

checkRefusals();
checkPassing();
playGames(30);
/* The short game. Offered in the setup form and in settings, carried through
 * the room config to every seat — and for a while read by nobody, so choosing
 * it got you a hundred-point game with a fifty on the screen. */
playGames(12, { pointsToWin: 50 });

console.log(checks.toLocaleString() + ' assertions across ' + seen.games + ' games, ' +
  seen.hands + ' hands, ' + seen.tricks + ' tricks');
console.log('  moons shot: ' + seen.moon +
  '   hearts led: ' + seen.heartsLed +
  '   first-trick discards: ' + seen.firstTrickDiscard +
  '   hands with only hearts to lead: ' + seen.allHeartsHand);
console.log('  pass directions: ' +
  Object.entries(seen.passDirs).map(([k, v]) => k + ' ' + v).join(', '));
console.log('  targets played to: ' +
  Object.entries(seen.targets).map(([k, v]) => k + ' points x' + v).join(', '));

/* A run that never met the interesting cases has not tested them, and saying so
 * is the difference between a green suite and a green suite worth believing. */
const gaps = [];
if (!seen.hands) gaps.push('no hand was ever finished');
if (!seen.qsPlayed) gaps.push('the queen of spades was never taken by anybody');
if (!seen.heartsLed) gaps.push('a heart was never led, so the broken-hearts rule went untested');
if (!seen.firstTrickDiscard) gaps.push('nobody ever failed to follow on the first trick, so the no-points rule went untested');
if (Object.keys(seen.passDirs).length < 4) gaps.push('not every passing direction came up');
if (Object.keys(seen.targets).length < 2) gaps.push('every game ran to the same target, so the configured target went untested');
gaps.forEach(g => fails.push(g));

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 20).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('\nThe engine plays the game the rules describe.');

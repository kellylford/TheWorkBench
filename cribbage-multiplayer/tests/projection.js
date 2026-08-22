/* What one seat may see.
 *
 * js/view.js is an allowlist, and an allowlist has exactly one failure mode: a
 * field is added to the state and nobody rules on it. The first section is the
 * guard for that. Everything after it checks particular secrets, and particular
 * secrets are the ones somebody already thought of.
 *
 * CRIBBAGE HIDES THINGS THE OTHER GAMES DO NOT:
 *
 *   `deck` — forty undealt cards. A client that could see them would know its
 *   opponent's hand exactly, by elimination, from the moment of the deal. There
 *   is no phase at which that becomes safe, so unlike every other secret it is
 *   never released, not even at the end of the hand.
 *
 *   the crib — hidden from BOTH players, including the dealer whose crib it is.
 *   Nothing in sheephead or euchre is hidden from everybody.
 *
 *   node tests/projection.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 31459;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Cards: C, Game: G, AI, View: V } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

/* ============ 0. EVERY FIELD HAS A RULING ============ */
const RULINGS = {
  config: 'allowlisted to the room rules; the rest is one client’s preferences',
  players: 'per-player rulings below',
  gamesWon: 'public', gameNumber: 'public', gameOver: 'public', gameWinner: 'public',
  dealer: 'public — everybody watches the cards come out',
  handNumber: 'public', phase: 'public', turn: 'public',
  cutForDeal: 'public — both cuts are turned face up',
  deck: 'NEVER SENT, at any phase. Forty unseen cards give away the opponent’s ' +
    'hand by elimination, and there is no moment at which that stops being true',
  crib: 'PRIVATE TO BOTH PLAYERS until it is counted',
  discarded: 'each seat may see its own throw and not the other’s',
  starter: 'public the moment it is turned',
  pile: 'public — laid face up', runStart: 'public — derivable from the counts anyway',
  count: 'public', goSaid: 'public', lastPlayer: 'public',
  countStage: 'public', countResults: 'public — each stage is announced as it is reached',
  dealt: 'PRIVATE until the hand is over',
  result: 'gated on the hand being over',
  history: 'NOT SENT; two derived counts go instead',
  events: 'audience-filtered and delivered by cursor, not as a field',
  nextEventId: 'NOT SENT: the gaps would count the private events sent to the other seat'
};
const PLAYER_RULINGS = {
  index: 'public', name: 'public', occupant: 'public', score: 'public',
  hand: 'own cards only until the count', kept: 'own cards only until the count',
  played: 'public — laid face up as they are played'
};

function newGame(opts) {
  return G.createGame(Object.assign({
    names: ['North', 'South'], targetScore: 121, difficulty: 'hard'
  }, opts || {}));
}

{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  G.applyAction(st, 0, { type: 'cut' });
  for (const k of Object.keys(st)) {
    check(RULINGS[k] !== undefined,
      `state.${k} has no ruling in tests/projection.js. Rule on it in js/view.js and here.`);
  }
  for (const k of Object.keys(st.players[0])) {
    check(PLAYER_RULINGS[k] !== undefined,
      `players[].${k} has no ruling in tests/projection.js.`);
  }
}

/* ============ 1. NO CARD A SEAT MAY NOT SEE, EVER ============ */
const ALL_IDS = [];
for (const s of ['C', 'S', 'H', 'D']) {
  for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']) {
    ALL_IDS.push(r + s);
  }
}

function idsIn(obj) {
  const found = new Set();
  JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string' && ALL_IDS.indexOf(v) >= 0) found.add(v);
    if (v && typeof v === 'object' && typeof v.id === 'string' && ALL_IDS.indexOf(v.id) >= 0) {
      found.add(v.id);
    }
    return v;
  });
  return found;
}

/* Everything a seat is legitimately entitled to know the identity of. */
function entitled(st, seat) {
  const ok = new Set();
  const over = st.phase === 'roundOver' || st.phase === 'gameOver';
  st.players[seat].hand.forEach(c => ok.add(c.id));
  st.players[seat].kept.forEach(c => ok.add(c.id));
  st.players.forEach(p => p.played.forEach(c => ok.add(c.id)));   // face up
  st.pile.forEach(e => ok.add(e.card.id));
  if (st.starter) ok.add(st.starter.id);
  if (st.cutForDeal) st.cutForDeal.cuts.forEach(id => ok.add(id));
  if (st.discarded[seat]) st.discarded[seat].forEach(id => ok.add(id));

  /* BOTH HANDS at the moment counting starts; the crib still on its own
   * schedule. The hands used to come up one at a time in counting order, and
   * that ruling was changed deliberately: play is finished when counting
   * begins, so there is no decision left for the other hand to inform, and two
   * people counting together need to see both. tests/hidden-information.js is
   * the check that the first half of that sentence is true — it watches every
   * decision made and would fail if one were ever taken from here.
   *
   * The crib is NOT part of the change. It is genuinely face down on the table
   * until the dealer turns it, and it is turned last. */
  const counting = st.phase === 'count' || over;
  if (counting) {
    st.players.forEach(p => {
      p.kept.forEach(c => ok.add(c.id));
      p.hand.forEach(c => ok.add(c.id));
    });
  }
  if (over || (counting && st.countStage >= 3)) st.crib.forEach(c => ok.add(c.id));
  if (over) {
    (st.dealt ? st.dealt.hands : []).forEach(h => h.forEach(id => ok.add(id)));
    st.discarded.forEach(d => (d || []).forEach(id => ok.add(id)));
  }
  return ok;
}

let sweeps = 0;
const phasesSeen = {};

for (let g = 0; g < 250; g++) {
  const st = newGame({ difficulty: ['easy', 'normal', 'hard'][g % 3] });
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  let last = null;

  while (guard++ < 3000) {
    const marker = [st.phase, st.pile.length, st.countStage,
      st.discarded.map(d => (d ? 1 : 0)).join('')].join(':');
    if (marker !== last) {
      last = marker;
      phasesSeen[st.phase] = (phasesSeen[st.phase] || 0) + 1;

      for (let seat = 0; seat < 2; seat++) {
        const view = V.forSeat(st, seat);
        sweeps++;

        /* THE ONE THAT MATTERS MOST. */
        check(view.deck === undefined,
          'the undealt pack is in the view — the opponent’s hand follows by elimination');

        const allowed = entitled(st, seat);
        for (const id of idsIn(view)) {
          if (!allowed.has(id)) {
            fails.push(`seat ${seat + 1} could see ${id} at ${st.phase} ` +
              `(countStage ${st.countStage}) and is not entitled to it`);
          }
        }

        /* The placeholder shape, exactly — but only while the other seat's
         * cards are still meant to be face down. Once counting starts they are
         * laid out on the table, and a blanket assertion here would be the test
         * being wrong rather than a leak. */
        const opp = 1 - seat;
        const over = st.phase === 'roundOver' || st.phase === 'gameOver';
        const counting = st.phase === 'count' || over;
        const oppOpen = counting;
        for (const c of view.players[opp].hand.concat(view.players[opp].kept)) {
          if (oppOpen) {
            if (!c.id) fails.push('a card that should be face up is still a placeholder');
          } else if (c.hidden !== true || Object.keys(c).length !== 1) {
            fails.push('a hidden card is ' + JSON.stringify(c) + ', not a bare placeholder');
          }
        }
        check(view.players[seat].hand.length === st.players[seat].hand.length,
          'a seat cannot see its own hand');
        check(view.seat === seat, 'the view is stamped with the wrong seat');
        /* Whether the other seat has thrown is public; what they threw is not. */
        check(view.players[opp].hasDiscarded === !!st.discarded[opp],
          'whether the other seat has thrown is not reported');
        if (st.phase !== 'roundOver' && st.phase !== 'gameOver') {
          check(view.discarded[opp] === null,
            'the other seat’s discard reached the view mid-hand');
        }
      }
    }
    if (st.phase === 'roundOver' || st.phase === 'gameOver') break;
    AI.act(st);
  }
}

check(sweeps > 5000, 'only ' + sweeps + ' views were swept');
for (const p of ['discard', 'play', 'count']) {
  check((phasesSeen[p] || 0) > 100, 'only ' + (phasesSeen[p] || 0) + ' sweeps at ' + p);
}

/* ============ 2. THE CRIB IS RELEASED ON SCHEDULE AND NOT BEFORE ============ */
{
  let tested = 0;
  for (let g = 0; g < 200 && tested < 40; g++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== 'count' && guard++ < 2000) {
      if (st.phase === 'roundOver' || st.phase === 'gameOver') break;
      AI.act(st);
    }
    if (st.phase !== 'count') continue;
    tested++;

    for (let seat = 0; seat < 2; seat++) {
      const v0 = V.forSeat(st, seat);
      check(v0.crib.length === 0,
        'the crib was visible before it was counted — even to the dealer, who at a ' +
        'real table has four cards face down and does not get to look');
      check(v0.cribCount === 4, 'the crib count is not reported while it is face down');
    }

    /* Both hands are already down at stage nought — before either has been
     * counted — and the crib is not. That pair is the whole ruling. */
    const nonDealer = 1 - st.dealer;
    for (let seat = 0; seat < 2; seat++) {
      const v0 = V.forSeat(st, seat);
      check(v0.players[0].kept.every(c => c.id) && v0.players[1].kept.every(c => c.id),
        'a hand was still face down when the counting started, so neither player ' +
        'could check the count against it');
    }
    G.applyAction(st, nonDealer, { type: 'next' });        // non-dealer's hand
    if (st.phase !== 'count') continue;
    for (let seat = 0; seat < 2; seat++) {
      const v1 = V.forSeat(st, seat);
      check(v1.players[nonDealer].kept.every(c => c.id),
        'the non-dealer’s hand is hidden after they counted it');
      check(v1.crib.length === 0, 'the crib appeared before it was counted');
    }
    G.applyAction(st, st.dealer, { type: 'next' });         // dealer's hand
    if (st.phase !== 'count') continue;
    for (let seat = 0; seat < 2; seat++) {
      check(V.forSeat(st, seat).crib.length === 0, 'the crib appeared before it was counted');
    }
    G.applyAction(st, st.dealer, { type: 'next' });         // the crib
    for (let seat = 0; seat < 2; seat++) {
      const v3 = V.forSeat(st, seat);
      check(v3.crib.length === 4 && v3.crib.every(c => c.id),
        'the crib was not revealed after it was counted');
    }
  }
  check(tested >= 20, 'the crib schedule was only checked ' + tested + ' times');
}

/* ============ 3. A CONSTRUCTED COUNTERFACTUAL ============
 *
 * Two states differing only in what the other seat holds. The viewer's serialized
 * view must be identical — leaks happen through absence as often as presence, so
 * the comparison is byte for byte rather than field by field. */
{
  let tested = 0;
  for (let g = 0; g < 150; g++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (guard++ < 3000) {
      for (let seat = 0; seat < 2; seat++) {
        const opp = 1 - seat;
        /* Only while the opponent's cards are still hidden from this seat. */
        if (st.phase === 'count' || st.phase === 'roundOver' || st.phase === 'gameOver') continue;
        const swapped = JSON.parse(JSON.stringify(st));
        /* Give the opponent completely different cards, from the undealt pack. */
        const n = swapped.players[opp].hand.length;
        if (!n || swapped.deck.length < n) continue;
        swapped.players[opp].hand = swapped.deck.slice(0, n);
        tested++;
        check(JSON.stringify(V.forSeat(st, seat)) === JSON.stringify(V.forSeat(swapped, seat)),
          `seat ${seat + 1}'s view changed when the other seat's cards were replaced, at ${st.phase}`);
      }
      if (st.phase === 'roundOver' || st.phase === 'gameOver') break;
      AI.act(st);
    }
  }
  check(tested > 500, 'the counterfactual ran only ' + tested + ' times');
}

/* ============ 4. EVENTS ============ */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (st.phase !== 'roundOver' && st.phase !== 'gameOver' && guard++ < 3000) AI.act(st);

  check(st.events.filter(e => e.audience !== undefined).length > 0,
    'no private events were emitted at all — the test proves nothing');

  for (let seat = 0; seat < 2; seat++) {
    const evts = G.eventsFor(st, seat);
    for (const e of evts) {
      check(e.audience === undefined, 'an event reached a client still carrying its audience');
      check(e.id === undefined, 'an event reached a client carrying its global id');
    }
    const want = st.events.filter(e => e.audience === undefined || e.audience === seat).length;
    check(evts.length === want,
      `seat ${seat + 1} received ${evts.length} events, expected ${want}`);
  }

  /* Anything that reads as private must actually BE addressed. */
  for (const e of st.events) {
    if (/\bYour six\b|\bYou threw\b|\bYou keep\b|\bYour hand:/i.test(e.text)) {
      check(e.audience !== undefined,
        'an event addressed to one player went out publicly: ' + e.text);
    }
  }
}

console.log('projection: ' + checks.toLocaleString() + ' assertions, ' +
  sweeps.toLocaleString() + ' full-view sweeps');
console.log('  phases swept: ' + Object.entries(phasesSeen).map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('projection: OK');

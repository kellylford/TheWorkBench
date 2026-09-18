/* What one seat may see.
 *
 * js/view.js is an allowlist, and an allowlist has exactly one failure mode: a
 * field is added to the state and nobody remembers to rule on it. The first
 * section of this file is the guard for that — it holds a written ruling for
 * every top-level key of the state and every per-player key, and it fails if the
 * engine grows one that has never been considered.
 *
 * That guard is the point. Everything after it checks particular secrets, and
 * particular secrets are the ones somebody already thought of.
 *
 *   node tests/projection.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let seed = 90210;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI, View: V } = sandbox.SH;

const fails = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) fails.push(msg); }

/* ============ 0. EVERY FIELD HAS A RULING ============
 *
 * Adding a key to the state without adding it here is a test failure, not a
 * silent leak. The ruling text is not machine-checked — it is there so the next
 * person has to write a sentence about why a field is safe before the suite goes
 * green again. */
const RULINGS = {
  config: 'allowlisted to the room-level rules; the rest is one client\'s preferences',
  players: 'per-player rulings below',
  scores: 'public — a card game where you cannot ask the score is not a card game',
  gamesWon: 'public, same reason',
  gameNumber: 'public',
  gameOver: 'public',
  gameWinner: 'public',
  dealer: 'public — everybody watches the cards come out',
  handNumber: 'public',
  phase: 'public',
  turn: 'public',
  leader: 'public',
  trump: 'public once made; null while nobody has made it, which is also public',
  maker: 'public — announced the moment it happens',
  alone: 'public — the partner visibly puts their cards down',
  sittingOut: 'public, same reason',
  upcard: 'public — it is turned face up on the table',
  upcardStatus: 'public — whether it was taken or turned down is watched by everyone',
  deniedSuit: 'public — follows from the upcard being turned down',
  kitty: 'PRIVATE until handOver; only the count goes out before then',
  discard: 'PRIVATE to the dealer until handOver',
  trick: 'public',
  lastTrick: 'public',
  played: 'public',
  trickLog: 'public',
  bidLog: 'public — every bid is spoken aloud at a real table',
  dealt: 'PRIVATE until handOver: a snapshot of every hand as dealt',
  result: 'gated on handOver, not on the engine promising it is null before then',
  history: 'NOT SENT AT ALL; two derived counts go instead',
  events: 'audience-filtered and delivered by cursor, not as a field',
  nextEventId: 'NOT SENT: the gaps would count the private events sent to others'
};

const PLAYER_RULINGS = {
  index: 'public',
  name: 'public',
  occupant: 'public — who is in a chair is what the table needs to know',
  hand: 'own cards only; every other seat becomes featureless placeholders',
  tricksWon: 'public'
};

function newGame(opts) {
  return G.createGame(Object.assign({
    numPlayers: 4, names: ['N', 'E', 'S', 'W'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  }, opts || {}));
}

{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  for (const k of Object.keys(st)) {
    check(RULINGS[k] !== undefined,
      `state.${k} has no ruling in tests/projection.js. Add one to js/view.js and here.`);
  }
  for (const k of Object.keys(st.players[0])) {
    check(PLAYER_RULINGS[k] !== undefined,
      `players[].${k} has no ruling in tests/projection.js.`);
  }
  /* And the other way: a ruling for a field that no longer exists is a stale
   * comment pretending to be a decision. */
  for (const k of Object.keys(RULINGS)) {
    check(st[k] !== undefined || k === 'result' || k === 'trump' || k === 'dealt' ||
      k === 'discard' || k === 'lastTrick',
      `tests/projection.js rules on state.${k}, which the engine no longer has`);
  }
}

/* ============ 1. NO OTHER SEAT'S CARDS, EVER ============ */

const ALL_IDS = [];
for (const s of ['C', 'S', 'H', 'D']) for (const r of ['A', 'K', 'Q', 'J', 'T', '9']) ALL_IDS.push(r + s);

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

/* Everything a seat is legitimately entitled to know the identity of.
 *
 * At handOver that is the whole deck, and deliberately so: the hand is over, the
 * cards are laid out, and a review that will not tell you what was in the kitty
 * is a review of nothing. The sweep below therefore proves nothing at handOver,
 * which is why the reveal is asserted separately and positively — that `dealt`,
 * `kitty` and `result` are all actually present. */
function entitled(st, seat) {
  const ok = new Set();
  if (st.phase === 'handOver') { ALL_IDS.forEach(id => ok.add(id)); return ok; }
  st.players[seat].hand.forEach(c => ok.add(c.id));
  st.played.forEach(c => ok.add(c.id));
  st.trick.forEach(t => ok.add(t.card.id));
  st.trickLog.forEach(t => t.plays.forEach(p => ok.add(p.card)));
  if (st.lastTrick) st.lastTrick.plays.forEach(p => ok.add(p.card.id));
  if (st.upcard) ok.add(st.upcard.id);
  if (seat === st.dealer && st.discard) ok.add(st.discard.id);
  return ok;
}

let phasesSeen = {};
let leakChecks = 0;

for (let g = 0; g < 300; g++) {
  const st = newGame({ stickTheDealer: g % 2 === 0, difficulty: ['easy', 'normal', 'hard'][g % 3] });
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  let lastPhase = null;

  while (guard++ < 400) {
    /* Check at every phase transition, and at every trick, rather than once at
     * the end — the interesting leaks all happen mid-hand. */
    const marker = st.phase + ':' + st.trickLog.length + ':' + st.trick.length;
    if (marker !== lastPhase) {
      lastPhase = marker;
      phasesSeen[st.phase] = (phasesSeen[st.phase] || 0) + 1;

      for (let seat = 0; seat < 4; seat++) {
        const view = V.forSeat(st, seat);
        const allowed = entitled(st, seat);
        const seen = idsIn(view);
        leakChecks++;
        for (const id of seen) {
          if (!allowed.has(id)) {
            fails.push(`seat ${seat + 1} could see ${id} at ${st.phase} ` +
              `(trick ${st.trickLog.length + 1}) and is not entitled to it`);
          }
        }

        /* The placeholder shape, exactly. A placeholder carrying a plausible
         * fake rank would let wrong code keep working and quietly report
         * nonsense; one with no fields breaks loudly at the first misuse. */
        for (let i = 0; i < 4; i++) {
          if (i === seat) continue;
          for (const c of view.players[i].hand) {
            if (JSON.stringify(c) !== '{"hidden":true}') {
              fails.push(`the placeholder for another seat's card is ` + JSON.stringify(c));
            }
          }
          check(view.players[i].hand.length === st.players[i].hand.length,
            'the placeholder hand is the wrong length');
        }
        check(view.players[seat].hand.length === st.players[seat].hand.length,
          'a seat cannot see its own hand');
        check(view.seat === seat, 'the view is stamped with the wrong seat');
      }
    }
    if (st.phase === 'handOver') break;
    AI.act(st);
  }

  /* At handOver everything is shown, because at a real table it would be. */
  for (let seat = 0; seat < 4; seat++) {
    const view = V.forSeat(st, seat);
    if (st.result && !st.result.thrownIn) {
      check(view.dealt !== null, 'the deal was not revealed at the end of the hand');
      check(view.kitty.length === 3, 'the kitty was not revealed at the end of the hand');
      check(view.result !== null, 'the result was not sent at the end of the hand');
    }
  }
}

/* ============ 2. THE DISCARD, SPECIFICALLY ============
 *
 * The one genuinely private card in euchre once trump is settled. Two games that
 * differ ONLY in which card the dealer put back must be indistinguishable to
 * every other seat — not "look similar", byte-identical when serialized, because
 * leaks happen through absence as often as through presence: a key omitted
 * rather than null, an array of two rather than three. */
{
  let tested = 0;
  for (let trial = 0; trial < 400 && tested < 40; trial++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (st.phase !== 'discard' && st.phase !== 'handOver' && guard++ < 200) AI.act(st);
    if (st.phase !== 'discard') continue;

    const hand = st.players[st.dealer].hand.map(c => c.id);
    if (hand.length < 2) continue;
    tested++;

    const a = JSON.parse(JSON.stringify(st));
    const b = JSON.parse(JSON.stringify(st));
    /* Rehydrate the card objects: JSON gives back plain copies, and every card
     * helper reads fields rather than identity, so a copy is as good as the
     * singleton. That property is pinned in tests/room.js. */
    G.applyAction(a, a.dealer, { type: 'discard', card: hand[0] });
    G.applyAction(b, b.dealer, { type: 'discard', card: hand[1] });

    for (let seat = 0; seat < 4; seat++) {
      if (seat === st.dealer) continue;
      const va = JSON.stringify(V.forSeat(a, seat));
      const vb = JSON.stringify(V.forSeat(b, seat));
      check(va === vb,
        `seat ${seat + 1} can tell which card the dealer put back ` +
        `(${hand[0]} vs ${hand[1]})`);
    }
    /* And the dealer CAN see their own. */
    const vd = V.forSeat(a, a.dealer);
    check(vd.discard && vd.discard.id === hand[0],
      'the dealer cannot see the card they put back themselves');
    check(V.forSeat(b, b.dealer).discard.id === hand[1], 'the dealer sees the wrong discard');
    /* Everybody knows a card WAS put back, which is what they watch happen. */
    check(V.forSeat(a, (a.dealer + 1) % 4).discarded === true,
      'the other seats were not told the dealer had discarded');
  }
  check(tested >= 20, 'the discard counterfactual was only run ' + tested + ' times');
}

/* ============ 3. SWAPPING TWO OTHER SEATS' HANDS CHANGES NOTHING ============
 *
 * Constructed rather than sampled: you cannot hold everything equal while
 * changing a deal, so the two worlds are built from one. */
{
  let tested = 0;
  for (let g = 0; g < 120; g++) {
    const st = newGame();
    G.applyAction(st, 0, { type: 'start' });
    let guard = 0;
    while (guard++ < 400) {
      for (let seat = 0; seat < 4; seat++) {
        const others = [0, 1, 2, 3].filter(i => i !== seat);
        const swapped = JSON.parse(JSON.stringify(st));
        const [x, y] = [others[0], others[1]];
        /* Only swap when the two hands are the same size, so the placeholder
         * counts are identical and the test is about identity rather than
         * arithmetic. */
        if (swapped.players[x].hand.length !== swapped.players[y].hand.length) continue;
        const t = swapped.players[x].hand;
        swapped.players[x].hand = swapped.players[y].hand;
        swapped.players[y].hand = t;
        tested++;
        check(JSON.stringify(V.forSeat(st, seat)) === JSON.stringify(V.forSeat(swapped, seat)),
          `seat ${seat + 1}'s view changed when seats ${x + 1} and ${y + 1} swapped hands, at ${st.phase}`);
      }
      if (st.phase === 'handOver') break;
      AI.act(st);
    }
  }
  check(tested > 1000, 'the swap counterfactual ran only ' + tested + ' times');
}

/* ============ 4. EVENTS ============ */
{
  const st = newGame();
  G.applyAction(st, 0, { type: 'start' });
  let guard = 0;
  while (st.phase !== 'handOver' && guard++ < 400) AI.act(st);

  const privateCount = st.events.filter(e => e.audience !== undefined).length;
  check(privateCount > 0, 'no private events were emitted at all — the test proves nothing');

  for (let seat = 0; seat < 4; seat++) {
    const evts = G.eventsFor(st, seat);
    for (const e of evts) {
      check(e.audience === undefined, 'an event reached a client still carrying its audience');
      /* The id is stripped for the same reason. Ids are global and monotonic, so
       * the gaps in the sequence a seat receives count the private events sent
       * to everybody else. */
      check(e.id === undefined, 'an event reached a client carrying its global id');
    }
    /* A seat receives every public event and exactly its own private ones. */
    const want = st.events.filter(e => e.audience === undefined || e.audience === seat).length;
    check(evts.length === want,
      `seat ${seat + 1} received ${evts.length} events, expected ${want}`);
  }

  /* Anything that reads as private must actually BE addressed. A public event
   * saying "Your hand" would be one sentence with two audiences, which is the
   * failure that cannot be fixed downstream — you cannot withhold half a
   * sentence. */
  for (const e of st.events) {
    if (/\bYour hand\b|\byou put back\b|\bYou took the\b/i.test(e.text)) {
      check(e.audience !== undefined,
        'an event addressed to one player went out publicly: ' + e.text);
    }
  }

  /* The cursor: asking for everything after id N gives exactly the tail. */
  const all = G.eventsFor(st, 0);
  const half = st.events[Math.floor(st.events.length / 2)].id;
  const tail = G.eventsFor(st, 0, half);
  check(tail.length < all.length, 'the event cursor returned everything');
  check(tail.length === st.events.filter(
    e => e.id > half && (e.audience === undefined || e.audience === 0)).length,
    'the event cursor returned the wrong slice');
}

console.log('projection: ' + checks.toLocaleString() + ' assertions, ' +
  leakChecks.toLocaleString() + ' full-view leak sweeps');
console.log('  phases swept: ' + Object.entries(phasesSeen).map(([k, v]) => k + ' ' + v).join(', '));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
  process.exit(1);
}
console.log('projection: OK');

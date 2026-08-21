/* What a game has to provide before the shared transport can run it.
 *
 * shared/js/localserver.js and each game's room.js drive an engine they know
 * nothing about. That works because every engine exports the same handful of
 * functions and they mean the same thing in each. Nothing wrote that down, so
 * it was true by coincidence and stopped being true twice:
 *
 *   - sheephead had no seatToAct. Its copy of localserver.js had the rule
 *     written out inline instead, and that was the only reason localserver.js
 *     could not be shared. The same rule appeared four times in that game.
 *
 *   - sheephead had no canDeal. Its room.js tested `phase !== 'handOver'`
 *     directly, which is the exact line that was copied into cribbage — whose
 *     phase is called roundOver — and silently swallowed every deal that came
 *     over the wire. It was found by accident, in another game.
 *
 * This file is the contract, and it is checked against every game at once, so
 * that the next game is held to it before anybody plays on it rather than
 * after. Adding a game means adding one line to GAMES.
 *
 *   node shared/tests/engine-contract.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

/* Each game, and the scripts its engine needs loaded to stand up. */
const GAMES = [
  { dir: 'euchre',                files: ['js/cards.js', 'js/game.js', 'js/ai.js'] },
  { dir: 'cribbage-multiplayer',  files: ['js/cards.js', 'js/game.js', 'js/ai.js'] },
  { dir: 'sheephead-multiplayer', files: ['js/cards.js', 'js/game.js', 'js/ai.js'] },
  { dir: 'hearts',                files: ['js/cards.js', 'js/game.js', 'js/ai.js'] }
];

/* Every name shared/js/*.js and room.js reach for on the engine. Derived by
 * grepping them rather than remembered, because a contract written from memory
 * is a contract that is missing the item you forgot. */
const REQUIRED = [
  'createGame',   // build a table
  'applyAction',  // the single authorization gate — nothing else may move the game
  'eventsFor',    // what this seat is allowed to have heard
  'seatToAct',    // whose move, or -1
  'canDeal',      // may a hand start right now
  'note',         // the room's own voice at the table
  'vb'            // name a seat in prose
];

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

function load(g) {
  const sandbox = { console, Math, Date, JSON };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of g.files) {
    vm.runInContext(fs.readFileSync(path.join(root, g.dir, f), 'utf8'), sandbox,
      { filename: g.dir + '/' + f });
  }
  return sandbox.SH;
}

const table = [];

for (const g of GAMES) {
  let SH;
  try { SH = load(g); } catch (e) {
    fails.push(g.dir + ': engine would not load — ' + e.message); checks++; continue;
  }
  const G = SH && SH.Game;
  check(!!G, g.dir + ': no SH.Game');
  if (!G) continue;

  for (const fn of REQUIRED) {
    check(typeof G[fn] === 'function',
      g.dir + ': SH.Game.' + fn + ' is missing. shared/js/localserver.js and ' +
      'room.js both call it, so this game cannot be played over the wire.');
  }
  if (REQUIRED.some(fn => typeof G[fn] !== 'function')) continue;

  /* ---- seatToAct means the same thing everywhere -------------------------
   *
   * The one that matters is -1. A room that gets a live seat number back
   * between hands schedules a bot to move into a hand that is over. Dropping
   * the guard from sheephead's seatToAct passed that game's entire suite. */
  const idle = { phase: 'idle', turn: 0, picker: 0, dealer: 0, players: [] };
  check(G.seatToAct(idle) === -1,
    g.dir + ': seatToAct says seat ' + G.seatToAct(idle) + ' may act while the ' +
    'phase is idle. Nobody may act before a deal; the answer is -1.');

  /* Every phase the engine can reach, from a real game played out, must give
   * either -1 or a seat that exists. A number that is neither is how a bot
   * ends up acting for a seat nobody is sitting in. */
  const seats = [];
  const phases = new Set();
  let state = G.createGame(seatOptions(g.dir));
  let guard = 0;
  while (guard++ < 4000) {
    phases.add(state.phase);
    const s = G.seatToAct(state);
    check(s === -1 || (Number.isInteger(s) && s >= 0 && s < state.players.length),
      g.dir + ': seatToAct returned ' + s + ' in phase ' + state.phase +
      ' with ' + state.players.length + ' seats');
    seats.push(s);

    /* canDeal must be EXACTLY the set of phases applyAction takes a nextHand
     * in — not a superset, not a subset.
     *
     * The room forwards a Deal when canDeal is true and answers with a view of
     * the table when it is false. Too narrow and a real deal is swallowed in
     * silence, which is what a handOver check copied into cribbage did to every
     * deal that came over the wire. Too broad and the player is handed the raw
     * engine refusal while somebody else is visibly dealing, which is the
     * confusion the gate exists to prevent. Both were live in this repository
     * when this check was written: all three games claimed idle, and cribbage
     * also claimed cutForDeal, while no engine accepts a nextHand in either.
     *
     * Asked of a copy, because applyAction deals on success. */
    {
      const copy = JSON.parse(JSON.stringify(state));
      const asked = G.applyAction(copy, s < 0 ? 0 : s, { type: 'nextHand' });
      const accepted = !!(asked && asked.ok);
      check(G.canDeal(state) === accepted,
        g.dir + ': in phase ' + state.phase + ', canDeal says ' + G.canDeal(state) +
        ' but applyAction ' + (accepted ? 'accepts' : 'refuses (' + (asked && asked.reason) + ')') +
        ' a nextHand. The room gates deals on canDeal, so these must agree.');
    }

    /* A hand that may be dealt is a hand nobody is playing. */
    /* canDeal and seatToAct must not both be true: a hand that can be dealt is
     * a hand nobody is playing. */
    if (G.canDeal(state)) {
      check(s === -1,
        g.dir + ': in phase ' + state.phase + ' a hand may be dealt AND seat ' + s +
        ' is on move. One of canDeal and seatToAct is wrong about this phase.');
    }
    if (!advance(SH, G, state)) break;
  }

  check(phases.size >= 3,
    g.dir + ': only reached phases ' + [...phases].join(', ') +
    ' — the walk stopped too early to have checked anything');
  check(seats.some(s => s >= 0),
    g.dir + ': no phase ever had a seat on move, so seatToAct was never really tested');
  check(seats.some(s => s === -1),
    g.dir + ': seatToAct never returned -1, so the between-hands case was never reached');

  table.push('  ' + g.dir.padEnd(24) + [...phases].sort().join(' '));
}

/* Play the game forward, using each game's own AI as the move generator.
 *
 * That is deliberately the production path: shared/js/localserver.js drives
 * bots by calling AI.act(state), so a walk that used anything else would be
 * exercising a code path nobody plays through. It is not testing the AI —
 * each game does that at length — it is asking the AI to produce legal moves
 * so that seatToAct and canDeal can be checked in every phase a real hand
 * actually reaches. */
function advance(SH, G, state) {
  const seat = G.seatToAct(state);
  if (seat < 0) {
    if (state.phase === 'idle') return ok(G.applyAction(state, 0, { type: 'start' }));
    if (G.canDeal(state)) return ok(G.applyAction(state, 0, { type: 'nextHand' }));
    return false;
  }
  try { SH.AI.act(state); } catch (e) { return false; }
  return true;
}

function ok(r) { return !!(r && r.ok !== false); }


/* Enough of a table for each game to start one. The engines differ here and it
 * is not worth pretending otherwise: two of them have a fixed number of seats
 * and read only names, sheephead is 3-to-6 and reads numPlayers as well. The
 * fields were read out of each createGame rather than assumed. */
function seatOptions(dir) {
  const names = [];
  for (let i = 0; i < 6; i++) names.push('Seat ' + i);
  if (dir === 'sheephead-multiplayer') return { names: names, numPlayers: 5 };
  return { names: names };
}

console.log('engine contract: ' + checks + ' checks across ' + GAMES.length + ' games');
console.log('  required of every engine: ' + REQUIRED.join(', '));
for (const r of table) console.log(r);

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('Every engine meets the contract the shared transport drives it through.');

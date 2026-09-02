/* What a seat is sent, and what it is not.
 *
 * view.js is the only thing between the authoritative state and a socket, so a
 * mistake in it is not a display bug — it is the whole hand, handed to somebody
 * who then plays a different game from everyone else and cannot be caught doing
 * it. This suite reads every projection the engine can produce and asserts that
 * no card another seat holds appears anywhere inside it.
 *
 * IT DOES NOT LOOK FOR NAMED FIELDS. Checking that `view.players[i].hand` is
 * hidden tests the leak you already thought of. Everything here serialises the
 * whole projection and searches the text for card ids, because the leak that
 * matters is the one through a field nobody remembered — a debug copy, a
 * lastTrick that kept too much, a history row carrying the deal.
 *
 * ---- the passing is checked hardest ----
 *
 * Hearts passes three cards simultaneously, and a seat that could see another
 * seat's chosen cards before the swap would choose its own pass knowing what is
 * coming. That is the single most consequential decision in the hand. So the
 * pass is checked at every point in its life: before anybody has chosen, after
 * one seat has, after three, and after the swap.
 *
 *   node tests/projection.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Math, JSON, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.SH.Cards;
const G = sandbox.SH.Game;
const V = sandbox.SH.View;

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

let seed = 424242;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* Every card id that appears anywhere in a projection, however deeply, whatever
 * the field is called. A regex over the serialised view rather than a walk of
 * known fields, because the field nobody remembered is the whole point. */
function idsIn(view) {
  const text = JSON.stringify(view);
  const found = new Set();
  C.newDeck().forEach(c => {
    /* Quoted, so a card id cannot be matched inside a longer string by accident
     * — "2C" would otherwise match inside a name or a message. */
    if (text.includes('"' + c.id + '"')) found.add(c.id);
  });
  return found;
}

/* What this seat is legitimately allowed to see the identity of, at this moment:
 * its own hand, everything already played, and what it was handed in the pass. */
function allowedFor(state, seat) {
  const ok = new Set();
  state.players[seat].hand.forEach(c => ok.add(c.id));
  state.players.forEach(p => p.taken.forEach(c => ok.add(c.id)));
  state.trick.forEach(t => ok.add(t.card.id));
  if (state.lastTrick) state.lastTrick.cards.forEach(t => ok.add(t.card.id));
  if (state.received[seat]) state.received[seat].forEach(c => ok.add(c.id));
  return ok;
}

function auditEverySeat(state, where) {
  for (let seat = 0; seat < G.SEATS; seat++) {
    const view = V.forSeat(state, seat);
    const seen = idsIn(view);
    const allowed = allowedFor(state, seat);

    const leaked = [...seen].filter(id => !allowed.has(id));
    check(leaked.length === 0,
      where + ': seat ' + seat + ' can see ' + leaked.slice(0, 6).join(', ') +
      (leaked.length > 6 ? ' and ' + (leaked.length - 6) + ' more' : '') +
      ' — cards it is not entitled to');

    /* And the converse: a projection that hides everything would pass the test
     * above and be useless. The seat must be able to see its own hand. */
    const mine = state.players[seat].hand.map(c => c.id);
    const missing = mine.filter(id => !seen.has(id));
    check(missing.length === 0,
      where + ': seat ' + seat + ' cannot see its own ' + missing.slice(0, 4).join(', '));

    /* Other hands are counted, never named. */
    view.players.forEach((p, i) => {
      if (i === seat) return;
      check(p.hand.length === state.players[i].hand.length,
        where + ': seat ' + seat + ' sees ' + p.hand.length + ' cards at seat ' + i +
        ' but there are ' + state.players[i].hand.length);
      p.hand.forEach(c => {
        check(Object.keys(c).join(',') === 'hidden',
          where + ': a hidden card carries fields ' + Object.keys(c).join(','));
      });
    });
  }
}

/* ---------------- 1. every top-level state key has a ruling ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  const ruled = new Set([...V.SENT, ...V.WITHHELD]);
  Object.keys(state).forEach(k => {
    check(ruled.has(k),
      'state.' + k + ' has never been ruled on in view.js. Add it to SENT or ' +
      'WITHHELD — an allowlist that silently ignores a new field is a deny-list ' +
      'with extra steps.');
  });
  /* And nothing ruled on that does not exist, which is how a rule rots. */
  ruled.forEach(k => {
    check(k in state, 'view.js rules on state.' + k + ', which the engine no longer has');
  });
}

/* ---------------- 2. the pass, at every moment of its life ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  check(state.phase === 'passing', 'the first hand should be a passing hand');

  auditEverySeat(state, 'passing, nobody has chosen');

  /* One seat chooses. Its three cards are now in state.passing and must not
   * reach ANY projection — including its own, as far as the wire is concerned:
   * the cards are still in that seat's hand, so it sees them there, but nothing
   * about `passing` may be sent to anybody. */
  const chosen0 = state.players[0].hand.slice(0, 3).map(c => c.id);
  G.applyAction(state, 0, { type: 'pass', cards: chosen0 }, rng);
  auditEverySeat(state, 'passing, one seat has chosen');

  for (let seat = 1; seat < G.SEATS; seat++) {
    const v = V.forSeat(state, seat);
    const text = JSON.stringify(v);
    chosen0.forEach(id => {
      check(!text.includes('"' + id + '"'),
        'seat ' + seat + ' can see ' + id + ', which seat 0 has chosen to pass — ' +
        'that seat would then choose its own pass knowing what is coming');
    });
    check(Array.isArray(v.passedIn) && v.passedIn[0] === true,
      'a seat cannot tell that seat 0 has finished choosing');
  }

  /* Three seats in: the swap has not happened, so nothing has moved. */
  const chosen = [chosen0];
  for (let seat = 1; seat < 3; seat++) {
    const c = state.players[seat].hand.slice(0, 3).map(x => x.id);
    chosen.push(c);
    G.applyAction(state, seat, { type: 'pass', cards: c }, rng);
  }
  auditEverySeat(state, 'passing, three seats have chosen');

  /* The last seat completes it, and the swap happens. */
  const c3 = state.players[3].hand.slice(0, 3).map(x => x.id);
  chosen.push(c3);
  G.applyAction(state, 3, { type: 'pass', cards: c3 }, rng);
  check(state.phase === 'play', 'the swap should have started the play');
  auditEverySeat(state, 'after the swap');

  /* Each seat sees what it was handed, and nobody else's. */
  for (let seat = 0; seat < G.SEATS; seat++) {
    const v = V.forSeat(state, seat);
    check(Array.isArray(v.received) && v.received.length === G.PASS_COUNT,
      'seat ' + seat + ' was not told what it received');
    const from = (seat + G.SEATS - G.PASS_OFFSET[state.passDir]) % G.SEATS;
    const want = chosen[from].slice().sort().join(',');
    const got = (v.received || []).map(c => c.id).sort().join(',');
    check(got === want,
      'seat ' + seat + ' was told it received ' + got + ' but seat ' + from +
      ' passed ' + want);
  }

  /* passing itself must never be a field on any projection. */
  for (let seat = 0; seat < G.SEATS; seat++) {
    const v = V.forSeat(state, seat);
    check(!('passing' in v),
      'the projection carries a `passing` field, which is the one thing in this ' +
      'game that must never cross a socket');
  }
}

/* ---------------- 3. a whole game, audited after every single move -------- */

{
  let audited = 0;
  const phases = new Set();
  for (let g = 0; g < 3; g++) {
    const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
    G.applyAction(state, 0, { type: 'start' }, rng);
    let guard = 0;
    while (state.phase !== 'gameOver' && guard++ < 4000) {
      phases.add(state.phase);
      auditEverySeat(state, 'mid game, phase ' + state.phase);
      audited++;
      if (state.phase === 'handOver') {
        G.applyAction(state, 0, { type: 'nextHand' }, rng);
        continue;
      }
      try { sandbox.SH.AI.act(state); } catch (e) { break; }
    }
    phases.add(state.phase);
    auditEverySeat(state, 'game over');
  }
  check(audited > 200, 'only ' + audited + ' projections were audited');
  check(phases.has('passing') && phases.has('play') && phases.has('handOver') &&
    phases.has('gameOver'),
    'the walk only reached ' + [...phases].join(', '));
  console.log(audited.toLocaleString() + ' projections audited across ' +
    [...phases].sort().join(', '));
}

console.log(checks.toLocaleString() + ' assertions');
if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 15).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('No seat is sent a card it has no right to.');

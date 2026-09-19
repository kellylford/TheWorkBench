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
 * ---- what spades has to hide is short, and that is the risk ----
 *
 * The whole secret in this game is the thirteen cards in each hand. Bids are
 * public, scores are public, bags are public, whose turn it is is public. A
 * projection with almost nothing to withhold is one where the single thing it
 * does withhold is easy to lose track of, so this checks it after every move of
 * several complete games rather than at a few chosen moments.
 *
 * The trump suit gets its own case. Spades are the cards whose identity is worth
 * the most to an opponent — knowing who holds the ace decides how the whole hand
 * is played — so there is a check that they are hidden exactly as well as
 * everything else, and not accidentally surfaced by some convenience field that
 * seemed harmless.
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
 * its own hand, whatever is on the table, and the trick that has just gone.
 *
 * Deliberately SHORTER than the hearts equivalent, which also allows every card
 * in every `taken` pile. This game keeps no taken piles — a trick is counted and
 * the cards are gone — so a projection carrying a completed trick from earlier
 * than lastTrick would be carrying something the engine itself does not retain,
 * which is exactly the sort of convenience field this suite exists to catch. */
function allowedFor(state, seat) {
  const ok = new Set();
  state.players[seat].hand.forEach(c => ok.add(c.id));
  state.trick.forEach(t => ok.add(t.card.id));
  if (state.lastTrick) state.lastTrick.cards.forEach(t => ok.add(t.card.id));
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

    /* THE BIDS ARE PUBLIC, and that has to be asserted rather than assumed.
     * Spades bidding is spoken aloud in order, and the later seats bidding into
     * what they have heard is the whole reason the deal rotates. A projection
     * that "helpfully" hid another seat's bid would be a different and worse
     * game, and would break the interface silently. */
    view.players.forEach((p, i) => {
      check(p.bid === state.players[i].bid,
        where + ': seat ' + seat + ' was told seat ' + i + ' bid ' + p.bid +
        ' when it bid ' + state.players[i].bid + ' — bids are public in this game');
      check(p.tricks === state.players[i].tricks,
        where + ': trick counts must be public, seat ' + i + ' disagrees');
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

/* ---------------- 2. the rules of the table reach every seat ---------------- */

{
  /* Every rule the ENGINE reads from config must survive the projection, or a
   * client is scoring by a different book than the server — and the disagreement
   * shows up as a player insisting the score is wrong and being right. */
  const cfg = {
    names: ['N', 'E', 'S', 'W'],
    pointsToWin: 250, bagLimit: 5, bagPenalty: 50, nilValue: 75,
    /* Private to whoever made the table, and must NOT travel. */
    name: 'the host', pace: 900, skin: 'plain'
  };
  const state = G.createGame(cfg);
  G.applyAction(state, 0, { type: 'start' }, rng);

  for (let seat = 0; seat < G.SEATS; seat++) {
    const v = V.forSeat(state, seat);
    check(G.targetOf(v) === 250, 'seat ' + seat + ' would play to ' + G.targetOf(v));
    check(G.bagLimitOf(v) === 5, 'seat ' + seat + ' has the wrong bag limit');
    check(G.bagPenaltyOf(v) === 50, 'seat ' + seat + ' has the wrong bag penalty');
    check(G.nilValueOf(v) === 75, 'seat ' + seat + ' has the wrong nil value');

    check(v.config.name === undefined,
      'the table owner\'s own name reached seat ' + seat + ' through the config');
    check(v.config.pace === undefined, 'one browser\'s pace reached seat ' + seat);
    check(v.config.skin === undefined, 'one browser\'s card style reached seat ' + seat);
  }
}

/* ---------------- 3. the trump suit is hidden as well as anything else ------ */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);

  /* Who holds each spade, before a card is played. */
  const holder = {};
  state.players.forEach((p, i) => p.hand.forEach(c => { if (c.s === 'S') holder[c.id] = i; }));
  check(Object.keys(holder).length === 13, 'the pack should hold thirteen spades');

  for (let seat = 0; seat < G.SEATS; seat++) {
    const text = JSON.stringify(V.forSeat(state, seat));
    Object.keys(holder).forEach(id => {
      if (holder[id] === seat) return;
      check(!text.includes('"' + id + '"'),
        'seat ' + seat + ' can see the ' + C.name(C.get(id)) + ', held by seat ' +
        holder[id] + ' — trump identity is the most valuable thing at this table');
    });
  }
}

/* ---------------- 4. a whole game, audited after every single move -------- */

{
  let audited = 0;
  const phases = new Set();
  for (let g = 0; g < 3; g++) {
    const state = G.createGame({ names: ['N', 'E', 'S', 'W'], pointsToWin: 250 });
    G.applyAction(state, 0, { type: 'start' }, rng);
    let guard = 0;
    while (state.phase !== 'gameOver' && guard++ < 8000) {
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
  check(phases.has('bidding') && phases.has('play') && phases.has('handOver') &&
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

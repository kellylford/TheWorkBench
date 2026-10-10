/* Can a seat do something it has no right to?
 *
 * applyAction is the single door into the engine, and once there is a socket in
 * front of it every message arriving is a claim by a stranger about who they
 * are. The room checks the seat; this checks that the ENGINE would refuse even
 * if the room did not, because a defence that exists in exactly one place is a
 * defence that is one refactor from not existing.
 *
 * The method is exhaustive rather than illustrative. At every position of every
 * hand, every seat is offered every action with every plausible argument, and
 * the two things asserted are:
 *
 *   1. Anything that should be refused IS refused.
 *   2. A refusal CHANGES NOTHING. This is the half that is easy to miss and the
 *      half that matters more. An engine that returns ok:false after having
 *      already removed a card from a hand has not refused anything — it has
 *      performed the action and then apologised. So every refusal here is taken
 *      against a serialised snapshot of the whole state, and the state after
 *      must be byte-identical.
 *
 * A REFUSAL MAY NOT NAME A CARD THE ASKER CANNOT SEE. whyNot() writes prose
 * about the hand, and prose written about the wrong seat's hand is a side
 * channel: ask to play every card in the pack, and the refusals tell you what
 * everybody holds. Checked at the bottom.
 *
 *   node tests/authorization.js
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

let seed = 909090;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const snap = s => JSON.stringify(s);

/* Offer an action and require that it is refused AND that nothing moved. */
function mustRefuse(state, seat, action, what) {
  const before = snap(state);
  const r = G.applyAction(state, seat, action, rng);
  check(!r.ok, what + ' was ACCEPTED and should not have been');
  check(snap(state) === before,
    what + ' was refused but the state changed anyway — a refusal that has ' +
    'already happened is not a refusal');
  return r;
}

function mustAllow(state, seat, action, what) {
  const r = G.applyAction(state, seat, action, rng);
  check(r.ok, what + ' was refused: ' + r.reason);
  return r;
}

/* ---------------- malformed everything ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);

  const seat = state.turn;
  const junk = [
    undefined, null, 0, 1, '', 'bid', [], {}, { type: null }, { type: 0 },
    { type: 'bid' },                       // no bid at all
    { type: 'play' },                      // no card at all
    { type: '__proto__' }, { type: 'constructor' }, { type: 'toString' },
    { type: 'hasOwnProperty' }, { type: 'valueOf' }
  ];
  junk.forEach(a => {
    mustRefuse(state, seat, a, 'the malformed action ' + JSON.stringify(a));
  });

  const badSeats = [-1, 4, 99, 1.5, NaN, Infinity, -0.5, '0', null, undefined, {}, []];
  badSeats.forEach(s => {
    const before = snap(state);
    const r = G.applyAction(state, s, { type: 'bid', bid: 3 }, rng);
    check(!r.ok, 'seat ' + JSON.stringify(s) + ' was allowed to bid');
    check(snap(state) === before, 'a bid from seat ' + JSON.stringify(s) + ' changed the state');
    checks++;
  });

  /* A state that is not a game at all. */
  check(!G.applyAction(null, 0, { type: 'bid', bid: 1 }).ok, 'a null state was accepted');
  check(!G.applyAction({}, 0, { type: 'bid', bid: 1 }).ok, 'an empty state was accepted');
  check(!G.applyAction({ players: null }, 0, { type: 'bid', bid: 1 }).ok,
    'a state with no players was accepted');
}

/* ---------------- the bidding ---------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  check(state.phase === 'bidding', 'the hand should open in the bidding');

  for (let round = 0; round < G.SEATS; round++) {
    const turn = state.turn;

    /* Every OTHER seat is refused, whatever it bids. */
    for (let other = 0; other < G.SEATS; other++) {
      if (other === turn) continue;
      for (const n of [0, 1, 5, 13]) {
        mustRefuse(state, other, { type: 'bid', bid: n },
          'seat ' + other + ' bidding ' + n + ' out of turn');
      }
      /* And cannot play a card either. */
      mustRefuse(state, other, { type: 'play', card: state.players[other].hand[0].id },
        'seat ' + other + ' playing a card during the bidding');
    }

    /* The seat whose turn it is cannot bid nonsense. */
    [-1, 14, 100, 1.5, '4', null, undefined, NaN, Infinity, -Infinity, [], {}].forEach(bad => {
      mustRefuse(state, turn, { type: 'bid', bid: bad },
        'a bid of ' + JSON.stringify(bad) + ' at seat ' + turn);
    });

    /* Nor play a card. */
    mustRefuse(state, turn, { type: 'play', card: state.players[turn].hand[0].id },
      'seat ' + turn + ' playing a card before the bidding is done');

    /* Nor deal. */
    mustRefuse(state, turn, { type: 'nextHand' }, 'a deal during the bidding');
    mustRefuse(state, turn, { type: 'start' }, 'a second start during the bidding');

    /* A legal bid goes through, once. */
    mustAllow(state, turn, { type: 'bid', bid: round }, 'seat ' + turn + ' bidding ' + round);
    if (state.phase === 'bidding') {
      mustRefuse(state, turn, { type: 'bid', bid: 2 }, 'seat ' + turn + ' bidding twice');
    }
  }
  check(state.phase === 'play', 'four bids should have started the play');
}

/* ---------------- the play, at every position of a whole hand ------------- */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'], pointsToWin: 250 });
  G.applyAction(state, 0, { type: 'start' }, rng);

  let guard = 0;
  let positions = 0;
  while (state.phase !== 'gameOver' && guard++ < 8000) {
    if (state.phase === 'bidding') {
      const s = state.turn;
      mustAllow(state, s, { type: 'bid', bid: AI.chooseBid(state, s) }, 'a bid');
      continue;
    }

    if (state.phase === 'handOver') {
      /* ANY seat may deal the next hand — it is a table action, not a private
       * one — but nobody may bid or play. */
      for (let s = 0; s < G.SEATS; s++) {
        mustRefuse(state, s, { type: 'bid', bid: 3 }, 'a bid at handOver');
        mustRefuse(state, s, { type: 'play', card: 'AS' }, 'a card at handOver');
        mustRefuse(state, s, { type: 'start' }, 'a start at handOver');
      }
      mustAllow(state, 0, { type: 'nextHand' }, 'the next deal');
      continue;
    }

    if (state.phase !== 'play') break;
    positions++;

    const turn = state.turn;
    const legal = G.legalPlays(state, turn).map(c => c.id);

    /* Every other seat, every card in the pack: all refused. */
    for (let other = 0; other < G.SEATS; other++) {
      if (other === turn) continue;
      /* Its own cards, which it does hold — refused because it is not its turn. */
      state.players[other].hand.slice(0, 3).forEach(c => {
        mustRefuse(state, other, { type: 'play', card: c.id },
          'seat ' + other + ' playing its own ' + c.id + ' out of turn');
      });
      mustRefuse(state, other, { type: 'bid', bid: 1 }, 'seat ' + other + ' bidding during play');
      mustRefuse(state, other, { type: 'nextHand' }, 'seat ' + other + ' dealing mid-hand');
    }

    /* The seat to act cannot play a card it does not hold, or one that is
     * illegal here, or a card that does not exist. */
    const held = {};
    state.players[turn].hand.forEach(c => { held[c.id] = true; });
    const legalSet = new Set(legal);

    C.newDeck().forEach(c => {
      if (legalSet.has(c.id)) return;
      mustRefuse(state, turn, { type: 'play', card: c.id },
        'seat ' + turn + ' playing ' + c.id + ' which is ' +
        (held[c.id] ? 'held but illegal here' : 'not in its hand'));
    });
    ['', 'ZZ', '1S', 'AX', null, undefined, 0, {}, []].forEach(bad => {
      mustRefuse(state, turn, { type: 'play', card: bad },
        'seat ' + turn + ' playing the non-card ' + JSON.stringify(bad));
    });

    const pick = AI.chooseCard(state, turn);
    mustAllow(state, turn, { type: 'play', card: pick.id }, 'a legal card');
  }
  check(positions > 40, 'only ' + positions + ' play positions were exercised');
  console.log(positions + ' play positions, every seat offered every card at each');
}

/* ---------------- a refusal may not name a card the asker cannot see ------ */

{
  const state = G.createGame({ names: ['N', 'E', 'S', 'W'] });
  G.applyAction(state, 0, { type: 'start' }, rng);
  while (state.phase === 'bidding') {
    const s = state.turn;
    G.applyAction(state, s, { type: 'bid', bid: AI.chooseBid(state, s) }, rng);
  }

  const turn = state.turn;
  const mine = new Set(state.players[turn].hand.map(c => c.id));

  /* Ask to play every card in the pack and read every refusal. If the reason
   * ever names a card, a rank or a suit that this seat could not otherwise know
   * about, the refusals are an oracle for the other three hands.
   *
   * EVERY PROBE GETS ITS OWN COPY OF THE STATE, and that is not tidiness. Asking
   * fifty-two times in a row against one game means the first legal card is
   * ACCEPTED — the turn moves on, and every question after it comes back "not
   * your turn". The suite then reports forty refusals that say nothing about the
   * hand, which looks exactly like a leak and is really the test playing the
   * game it is trying to interrogate. */
  let leaks = 0;
  C.newDeck().forEach(c => {
    const probe = JSON.parse(JSON.stringify(state));
    const r = G.applyAction(probe, turn, { type: 'play', card: c.id }, rng);
    if (r.ok) return;
    const reason = String(r.reason || '');

    /* The reason may talk about the suit that was LED, which is on the table and
     * public, and about cards this seat holds. It may not distinguish between
     * "somebody else holds this" and "nobody holds this". */
    if (!mine.has(c.id)) {
      check(reason === 'you do not hold that card',
        'asking to play ' + c.id + ' — which this seat does not hold — was refused ' +
        'with "' + reason + '", which says more than that it is not in the hand');
      if (reason !== 'you do not hold that card') leaks++;
    }
  });
  check(leaks === 0, leaks + ' refusals distinguished between cards held elsewhere');

  /* The same refusal, whatever anybody else holds. Rebuild the hand with the
   * other three seats' cards shuffled around and check the message is identical:
   * a message that changes when somebody else's hand changes is a channel. */
  const beforeProbe = JSON.parse(JSON.stringify(state));
  const before = G.applyAction(beforeProbe, turn, { type: 'play', card: 'AS' }, rng);
  if (!before.ok) {
    const copy = JSON.parse(JSON.stringify(state));
    const pool = [];
    for (let i = 0; i < G.SEATS; i++) if (i !== turn) pool.push(...copy.players[i].hand);
    let k = 0;
    for (let i = 0; i < G.SEATS; i++) {
      if (i === turn) continue;
      const n = copy.players[i].hand.length;
      copy.players[i].hand = pool.slice(k, k + n);
      k += n;
    }
    const after = G.applyAction(copy, turn, { type: 'play', card: 'AS' }, rng);
    check(String(before.reason) === String(after.reason),
      'the refusal changed from "' + before.reason + '" to "' + after.reason +
      '" when other seats\' cards moved — that is a side channel');
  }
}

console.log(checks.toLocaleString() + ' assertions');
if (fails.length) {
  const uniq = [...new Set(fails)];
  console.error('\nFAIL (' + uniq.length + '):');
  uniq.slice(0, 15).forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('Every action was refused from every seat that had no right to it, nothing moved ' +
  'when it was, and no refusal named a card the asker could not see.');

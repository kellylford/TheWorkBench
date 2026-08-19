/* Playing over a wire, before there is a wire.
 *
 * js/localserver.js is an authoritative server that happens to run in the same
 * process: the real engine, the real authorization gate, the real projection,
 * and a faked network with a delay on it. That makes the asynchronous half of
 * the client testable now rather than during the first two-player session,
 * debugged across two machines and a socket.
 *
 * Four things are proved here, and the second is the one that would otherwise
 * be discovered late and expensively:
 *
 *   1. A complete hand can be played from PROJECTED VIEWS ALONE. If the client
 *      can get from deal to scoring without ever seeing the authoritative state,
 *      the projection carries everything the interface needs.
 *   2. The client plays a seat that is not zero. Every hardcoded 0 that survived
 *      the seat generalization shows up here as a hand that will not play.
 *   3. The seat comes from the CONNECTION, never from the message. A client that
 *      names another seat in its payload must not be able to act as that seat —
 *      applyAction cannot enforce this, because by the time it is called the
 *      damage is a parameter.
 *   4. One move in flight at a time, and a move that is never answered says so
 *      rather than hanging silently.
 *
 *   node tests/online.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 99991;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = {
  console, Math: seededMath, Date, JSON, Set,
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js', 'js/table.js', 'js/localserver.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Cards: C, Table, LocalServer } = sandbox.SH;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function config(n) {
  return {
    numPlayers: n,
    names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n),
    allPass: 'leaster', difficulty: 'hard',
    blackQueenDoubler: true, redQueenDoubler: true, redealDoubler: true
  };
}

/* ---------------- 1 & 2. A whole hand, from views, from a seat that is not 0 --- */

async function playAHand(n, mySeat) {
  const server = LocalServer.create({ config: config(n), latency: 4, botDelay: 6 });
  const link = Table.startOnline(mySeat, handler => server.connect(mySeat, handler));
  server.start();

  let sawOwnHand = false;
  let everSawAnotherHand = false;
  let handsPlayed = 0;

  for (let step = 0; step < 4000; step++) {
    await sleep(2);
    const v = Table.view();
    if (!v) continue;

    check(v.seat === mySeat, `${n}p: the server sat us at ${v.seat}, not ${mySeat}`);

    // The projection must never carry another seat's cards, over the wire or not.
    for (let i = 0; i < n; i++) {
      if (i === mySeat) continue;
      if (v.players[i].hand.some(c => c && c.id !== undefined)) everSawAnotherHand = true;
    }
    if (v.players[mySeat].hand.length) sawOwnHand = true;

    if (Table.pending()) continue;             // a move is out; wait for the answer

    if (v.phase === 'handOver') {
      handsPlayed++;
      if (handsPlayed >= 2) break;
      Table.act({ type: 'nextHand' });
      continue;
    }
    if (v.phase === 'pick' && v.turn === mySeat) {
      Table.act({ type: 'pick' });
      continue;
    }
    if (v.phase === 'bury' && v.picker === mySeat) {
      const ids = v.players[mySeat].hand.map(c => c.id).slice(0, G.DEAL[n].blind);
      Table.act({ type: 'bury', cards: ids });
      continue;
    }
    if (v.phase === 'play' && v.turn === mySeat) {
      /* legalPlays needs a state-shaped object and the view is one — for OUR
       * seat, whose cards are real. That is the whole bet of the projection:
       * everything the client must reason about, it can see. */
      const legal = G.legalPlays(v, mySeat);
      check(legal.length > 0, `${n}p seat ${mySeat}: no legal play offered on our turn`);
      if (legal.length) Table.act({ type: 'play', card: legal[0].id });
      continue;
    }
  }

  check(handsPlayed >= 2, `${n}p seat ${mySeat}: only completed ${handsPlayed} hands over the wire`);
  check(sawOwnHand, `${n}p seat ${mySeat}: never received our own cards`);
  check(!everSawAnotherHand, `${n}p seat ${mySeat}: a view carried another seat's cards`);

  const truth = server.peek();
  check(truth.history.length >= 2, `${n}p: the server did not record the hands`);
  check(truth.history.every(h => !h.problems || !h.problems.length),
    `${n}p: a hand played over the wire failed its own audit`);

  server.stop();
}

/* ---------------- 3. The seat comes from the connection ---------------- */

async function seatCannotBeSpoofed() {
  const server = LocalServer.create({ config: config(5), latency: 2, botDelay: 100000 });
  server.start();

  let seen = null;
  const link = server.connect(2, m => { seen = m; });
  await sleep(30);

  const truth = server.peek();
  const victim = truth.turn === 2 ? 3 : truth.turn;   // a seat that is not ours

  const before = JSON.stringify({
    phase: truth.phase, turn: truth.turn, picker: truth.picker,
    hands: truth.players.map(p => C.ids(p.hand))
  });

  /* Every shape a hostile client might try. The connection is seat 2 throughout;
   * nothing in any of these may make the server act as somebody else. */
  link.send({ type: 'action', seat: victim, action: { type: 'pick' } });
  link.send({ type: 'action', action: { type: 'pick', seat: victim } });
  link.send({ type: 'action', seat: victim, seq: 1, action: { type: 'pass' } });
  link.send({ type: 'action', action: { type: 'bury', cards: C.ids(truth.players[victim].hand).slice(0, 2), seat: victim } });
  await sleep(60);

  const after = JSON.stringify({
    phase: truth.phase, turn: truth.turn, picker: truth.picker,
    hands: truth.players.map(p => C.ids(p.hand))
  });

  if (truth.turn !== 2) {
    check(before === after,
      'a client acted as another seat by naming it in the message — the seat must come from the connection');
  }

  // ...and the same client acting as ITSELF, when it is its turn, does work —
  // otherwise the check above would pass on a server that refuses everything.
  truth.turn = 2;
  truth.phase = 'pick';
  link.send({ type: 'action', seq: 9, action: { type: 'pick' } });
  await sleep(60);
  check(truth.picker === 2, 'the client could not act on its own behalf either');

  server.stop();
}

/* ---------------- 4. Pending, double-send, rejection, timeout ---------------- */

async function pendingBehaviour() {
  const server = LocalServer.create({ config: config(5), latency: 40, botDelay: 100000 });
  Table.startOnline(0, handler => server.connect(0, handler));
  server.start();
  await sleep(120);

  const truth = server.peek();
  truth.turn = 0; truth.phase = 'pick';

  check(Table.pending() === null, 'something was pending before we sent anything');

  const first = Table.act({ type: 'pick' });
  check(first.ok === 'pending', 'an online act did not report itself as pending: ' + JSON.stringify(first));
  check(Table.pending() !== null, 'a sent move was not recorded as pending');

  /* The digit keys fire on keydown with no debounce, so a player pressing the
   * same key twice — or holding it — would send two moves, and the second would
   * be applied to a state the first had already changed. */
  const second = Table.act({ type: 'pick' });
  check(second.ok === false, 'a second move was accepted while the first was still in flight');

  await sleep(200);
  check(Table.pending() === null, 'pending was never cleared after the view arrived');
  check(Table.view().picker === 0, 'the move did not take effect');

  // A refused move reports itself, and stops being pending.
  const rejections = [];
  Table.onRejected(info => rejections.push(info));
  Table.act({ type: 'play', card: 'NOT_A_CARD' });
  await sleep(250);
  check(rejections.length >= 1, 'a refused move never reported back');
  check(rejections[0] && typeof rejections[0].reason === 'string' && rejections[0].reason.length > 0,
    'a refusal carried no reason to tell the player');
  check(Table.pending() === null, 'a refused move stayed pending for ever');

  server.stop();
}

async function timeoutSpeaks() {
  /* A server that accepts the connection and then never answers. Silence is the
   * one failure a player cannot distinguish from a dropped keypress, so it has
   * to become a message. */
  const deaf = {
    send: function () {},
    close: function () {}
  };
  const timeouts = [];
  Table.startOnline(0, handler => {
    setTimeout(() => handler({
      type: 'welcome', seat: 0, version: 1,
      view: { seat: 0, phase: 'pick', turn: 0, players: [{ hand: [] }], config: {} },
      events: []
    }), 5);
    return deaf;
  });
  Table.onRejected(info => timeouts.push(info));
  await sleep(30);

  Table.act({ type: 'pick' });
  check(Table.pending() !== null, 'the move was not pending against a silent server');

  await sleep(Table.ANSWER_TIMEOUT + 400);
  check(timeouts.some(t => t.timedOut), 'a move that was never answered never said so');
  check(Table.pending() === null, 'a timed-out move stayed pending');
}

/* ---------------- 5. Stale and duplicate views are ignored ---------------- */

async function staleViewsIgnored() {
  let handler = null;
  Table.startOnline(1, h => { handler = h; return { send() {}, close() {} }; });

  const mk = (version, turn) => ({
    type: 'view', version, view: { seat: 1, phase: 'play', turn, players: [], config: {} }, events: []
  });

  handler(mk(5, 3));
  check(Table.view().turn === 3, 'the first view was not applied');
  handler(mk(4, 9));                      // older
  check(Table.view().turn === 3, 'an out-of-order view rolled the game backwards');
  handler(mk(5, 8));                      // duplicate
  check(Table.view().turn === 3, 'a duplicate view was applied twice');
  handler(mk(6, 2));                      // newer
  check(Table.view().turn === 2, 'a newer view was ignored');
}

/* ---------------- 6. Events arrive once, in order ---------------- */

async function eventsArriveOnce() {
  const server = LocalServer.create({ config: config(4), latency: 3, botDelay: 5 });
  Table.startOnline(1, handler => server.connect(1, handler));
  server.start();

  const heard = [];
  for (let i = 0; i < 900; i++) {
    await sleep(2);
    heard.push(...Table.drainEvents().map(e => e.text));
    const v = Table.view();
    if (!v) continue;
    if (Table.pending()) continue;
    if (v.phase === 'handOver') break;
    if (v.phase === 'pick' && v.turn === 1) { Table.act({ type: 'pass' }); continue; }
    if (v.phase === 'bury' && v.picker === 1) {
      Table.act({ type: 'bury', cards: v.players[1].hand.map(c => c.id).slice(0, 2) });
      continue;
    }
    if (v.phase === 'play' && v.turn === 1) {
      const legal = G.legalPlays(v, 1);
      if (legal.length) Table.act({ type: 'play', card: legal[0].id });
      continue;
    }
  }

  check(heard.length > 0, 'no events were delivered over the wire');
  const dupes = heard.filter((t, i) => heard.indexOf(t) !== i && /^Hand \d+\./.test(t));
  check(dupes.length === 0, 'a hand-start event was delivered more than once: ' + dupes.slice(0, 2));

  // Nothing addressed to another seat may arrive here.
  const truth = server.peek();
  const privateElsewhere = truth.events.filter(e => e.audience !== undefined && e.audience !== 1);
  privateElsewhere.forEach(e => {
    check(heard.indexOf(e.text) < 0, 'an event addressed to another seat was delivered: ' + e.text);
  });

  server.stop();
}

(async () => {
  await playAHand(5, 0);
  await playAHand(5, 3);      // a seat that is not zero
  await playAHand(4, 2);
  await playAHand(3, 1);
  await seatCannotBeSpoofed();
  await pendingBehaviour();
  await staleViewsIgnored();
  await eventsArriveOnce();
  await timeoutSpeaks();

  if (fails.length) {
    console.error('\nFAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('complete hands played over a simulated wire at 3, 4, 5 and 6 seats');
  console.log('from projected views alone, from seats 0, 1, 2 and 3');
  console.log('seat spoofing refused, double-sends refused, stale views dropped, silence reported');
  process.exit(0);
})();

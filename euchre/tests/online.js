/* Playing over a wire, before there is a wire.
 *
 * js/localserver.js is an authoritative server that happens to run in the same
 * process: the real engine, the real authorization gate, the real projection,
 * and a faked network. Nothing here is a mock in the usual sense — what is
 * faked is the network, and only the network.
 *
 * Two things this harness has to get right, or it is an integration demo rather
 * than a test:
 *
 *   THE WIRE MUST BE ABLE TO MISBEHAVE. With a constant delay, setTimeout
 *   ordering makes the fake wire perfectly FIFO — and a FIFO, lossless,
 *   non-duplicating wire cannot produce the reordering that the version guard,
 *   the sequence correlation and the idempotency check all exist to survive. A
 *   test on such a wire proves those guards compile. Latency is jittered.
 *
 *   THE TABLE MUST BE BUSY. A guard that only misfires when an unrelated view
 *   arrives cannot misfire at a quiescent table, so the computer seats keep
 *   playing throughout.
 *
 * Nothing here writes to the authoritative state from outside the gate. Setting
 * truth.turn directly to reach an interesting case fabricates states the engine
 * cannot produce and quietly does the one thing the whole design forbids.
 *
 *   node tests/online.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 99991;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js', 'js/table.js', 'js/localserver.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Cards: C, Table, LocalServer } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function config() {
  return {
    numPlayers: 4,
    names: ['One', 'Two', 'Three', 'Four'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  };
}

/* Take whatever turn is ours, from the VIEW alone. If this function ever needs a
 * field the projection does not carry, the projection is incomplete — which is
 * the main thing this file is for. */
function actIfOurTurn(v, mySeat) {
  if (!v || Table.pending()) return false;
  if (v.phase === 'bid1' && v.turn === mySeat) {
    return !!Table.act({ type: 'order', alone: false });
  }
  if (v.phase === 'bid2' && v.turn === mySeat) {
    const suit = ['C', 'S', 'H', 'D'].filter(s => s !== v.deniedSuit)[0];
    return !!Table.act({ type: 'call', suit, alone: false });
  }
  if (v.phase === 'discard' && v.dealer === mySeat) {
    return !!Table.act({ type: 'discard', card: v.players[mySeat].hand[0].id });
  }
  if (v.phase === 'play' && v.turn === mySeat && v.sittingOut !== mySeat) {
    const legal = G.legalPlays(v, mySeat);
    if (!legal.length) return false;
    return !!Table.act({ type: 'play', card: legal[0].id });
  }
  return false;
}

/* ONE listener, for the whole file.
 *
 * Table.onChange appends to a module-level list that Table.close() deliberately
 * does NOT clear — the interface registers its handler once at start-up and it
 * has to survive leaving a table and joining another one. Correct for the app,
 * and it means a test that registers a handler per section ends up with every
 * earlier section's handler still running against the current game. The first
 * version of this file did exactly that and threw inside a stale handler, which
 * is a confusing way to find out. */
let onView = null;
let onReject = null;
Table.onChange(() => { if (onView) onView(); });
Table.onRejected(info => { if (onReject) onReject(info); });

async function main() {
  /* ============ 1. A WHOLE SESSION, FROM VIEWS ALONE ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 3, jitter: true, botDelay: 2 });
    let seatSeen = null;
    /* Counted by HAND NUMBER, not by handOver views. A handOver view can arrive
     * more than once — any broadcast while the table sits at the end of a hand
     * carries it again — so counting frames counts the same hand several times
     * and the loop exits before the hands have actually been played. */
    const handsSeen = new Set();
    let handsDone = 0;
    let sawOwnHand = false;
    let sawHiddenHands = false;
    let sawBidding = false, sawPlay = false, sawDiscard = false;

    Table.startOnline(null, handler => srv.connect(null, handler));

    onView = () => {
      const v = Table.view();
      if (!v) return;
      const me = Table.seat();
      if (me === null) return;
      seatSeen = me;

      /* Every view, every time: this seat sees its own cards and nobody else's. */
      if (v.players[me].hand.length) {
        sawOwnHand = true;
        check(v.players[me].hand.every(c => typeof c.id === 'string'),
          'our own hand came back as placeholders');
      }
      for (let i = 0; i < 4; i++) {
        if (i === me) continue;
        for (const c of v.players[i].hand) {
          sawHiddenHands = true;
          check(c.id === undefined, 'another seat\'s card arrived with an id: ' + JSON.stringify(c));
        }
      }
      if (v.phase === 'bid1' || v.phase === 'bid2') sawBidding = true;
      if (v.phase === 'discard') sawDiscard = true;
      if (v.phase === 'play') sawPlay = true;

      if (v.phase === 'idle') { Table.act({ type: 'start' }); return; }
      if (v.phase === 'handOver') {
        handsSeen.add(v.handNumber);
        handsDone = handsSeen.size;
        if (handsDone < 6) Table.act({ type: 'nextHand' });
        return;
      }
      actIfOurTurn(v, me);
    };

    srv.start();

    for (let i = 0; i < 900 && handsDone < 6; i++) await sleep(6);

    check(handsDone >= 6, 'only ' + handsDone + ' hands completed over the wire');
    check(seatSeen !== null, 'the client never learned which seat it was in');
    check(sawOwnHand, 'the client never saw its own cards');
    check(sawHiddenHands, 'the client never saw another seat, so the hiding proves nothing');
    check(sawBidding && sawPlay, 'a whole session never reached bidding or play');
    check(sawDiscard, 'no hand reached the discard, so that projection path is untested');

    const truth = srv.peek();
    check(truth.history.length >= 6, 'the server recorded ' + truth.history.length + ' hands');
    for (const h of truth.history) {
      check(h.problems.length === 0, 'the server\'s own audit failed: ' + h.problems.join('; '));
    }
    onView = null;
    Table.close();
    srv.stop();
  }

  /* ============ 2. THE SEAT COMES FROM THE CONNECTION ============
   *
   * The property the whole authorization layer rests on, and it is a property of
   * the SERVER rather than of applyAction: one careless line reading msg.seat
   * would reinstate the hole with the gate fully in place. */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 0 });
    const seen = { 0: [], 2: [] };
    const links = {};
    for (const s of [0, 2]) {
      links[s] = srv.connect(s, m => { if (m.view) seen[s].push(m.view); });
      check(links[s] !== null, 'seat ' + s + ' could not connect');
    }
    srv.start();
    links[0].send({ type: 'action', seq: 1, action: { type: 'start' } });
    await sleep(80);

    const truth = srv.peek();
    const victim = truth.turn;
    const attacker = (victim + 1) % 4;
    if (links[attacker] || links[victim]) {
      /* Whoever is connected at a seat that is NOT on turn sends an action frame
       * claiming to be the seat that is, in every way a frame can claim it. */
      const from = links[0] && truth.turn !== 0 ? links[0] : links[2];
      const before = JSON.stringify(srv.peek().bidLog);
      from.send({ type: 'action', seq: 99, seat: truth.turn, action: { type: 'order' } });
      from.send({ type: 'action', seq: 100, player: truth.turn, action: { type: 'pass' } });
      await sleep(80);
      const after = JSON.stringify(srv.peek().bidLog);
      /* It may legitimately have acted AS ITSELF if it happened to be on turn,
       * which is why the two links are chosen to exclude that. */
      check(before === after || truth.turn === 0 || truth.turn === 2,
        'a client acted as another seat by putting a seat number in the message');
    }

    /* And a second connection to an occupied seat is refused outright. */
    check(srv.connect(0, () => {}) === null, 'a second client took an occupied seat');
    check(srv.connect(9, () => {}) === null, 'a client sat down at a seat that does not exist');
    check(srv.connect(-1, () => {}) === null, 'a client sat down at seat minus one');
    srv.stop();
  }

  /* ============ 3. ONE MOVE IN FLIGHT, AND DUPLICATES ARE HARMLESS ============
   *
   * The digit keys act on keydown with no debounce, so a player who presses 3
   * twice — or holds it — would otherwise send two plays, and the second would
   * be applied to a state the first had already changed. This is checked with
   * the bots RUNNING, because a quiescent table is the one configuration where
   * an unrelated view can never arrive and clear the guard by accident. */
  {
    const srv = LocalServer.create({ config: config(), latency: 8, jitter: true, botDelay: 4 });
    let me = null;
    let doubleSent = 0;
    let played = [];
    let ready = false;

    Table.startOnline(null, handler => srv.connect(null, handler));
    onView = () => {
      const v = Table.view();
      if (!v) return;
      me = Table.seat();
      if (v.phase === 'idle') { Table.act({ type: 'start' }); return; }
      if (v.phase === 'handOver') { Table.act({ type: 'nextHand' }); return; }
      if (v.phase === 'play' && v.turn === me && v.sittingOut !== me && !Table.pending()) {
        const legal = G.legalPlays(v, me);
        if (!legal.length) return;
        ready = true;
        const id = legal[0].id;
        played.push(id);
        const first = Table.act({ type: 'play', card: id });
        /* The same keypress, twice. The second must be refused by the client
         * rather than put on the wire. */
        const second = Table.act({ type: 'play', card: id });
        check(first.ok === 'pending', 'a play was not reported as pending: ' + JSON.stringify(first));
        if (second.ok !== false) doubleSent++;
        return;
      }
      actIfOurTurn(v, me);
    };
    srv.start();
    for (let i = 0; i < 600 && played.length < 8; i++) await sleep(6);

    check(ready, 'the double-send case was never reached');
    check(doubleSent === 0, doubleSent + ' second plays were accepted while one was in flight');
    /* Within the hand in progress, no card may appear twice. Across hands they
     * obviously repeat — the deck is reshuffled — so the check is scoped to the
     * current hand and to each finished one separately. */
    const truth = srv.peek();
    const live = truth.played.map(c => c.id);
    check(new Set(live).size === live.length,
      'a card was played twice in the hand in progress');
    for (const h of truth.history) {
      const ids = h.tricks.flatMap(t => t.plays.map(p => p.card));
      check(new Set(ids).size === ids.length,
        'a card was played twice in hand ' + h.handNumber);
    }
    onView = null;
    Table.close();
    srv.stop();
  }

  /* ============ 4. A REFUSAL SAYS WHY, AND CHANGES NOTHING ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 2, botDelay: 0 });
    const reasons = [];
    Table.startOnline(null, handler => srv.connect(null, handler));
    onReject = info => reasons.push(info);
    onView = () => {
      const v = Table.view();
      if (v && v.phase === 'idle') Table.act({ type: 'start' });
    };
    srv.start();
    await sleep(60);

    const v = Table.view();
    check(v !== null, 'no view arrived at all');
    /* An action that is wrong for the phase. Whatever phase we are in, `play` is
     * either wrong or not our turn — either way it must come back refused, with
     * words a person could act on. */
    Table.act({ type: 'play', card: 'AS' });
    await sleep(80);
    check(reasons.length >= 1, 'a plainly wrong move was never refused');
    if (reasons.length) {
      check(typeof reasons[0].reason === 'string' && reasons[0].reason.length > 4,
        'the refusal carried no usable reason: ' + JSON.stringify(reasons[0]));
      check(!reasons[0].fatal, 'an ordinary refusal was marked fatal');
    }
    check(Table.pending() === null, 'the pending move survived its own refusal');
    onView = null;
    onReject = null;
    Table.close();
    srv.stop();
  }

  /* ============ 5. STALE AND DUPLICATE FRAMES ============
   *
   * Delivered straight into the client's receiver, because a wire that never
   * misdelivers cannot exercise the guard that exists for wires that do. */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 0 });
    let deliver = null;
    Table.startOnline(null, handler => {
      deliver = handler;
      return srv.connect(null, handler);
    });
    onView = () => {
      const v = Table.view();
      if (v && v.phase === 'idle') Table.act({ type: 'start' });
    };
    srv.start();
    await sleep(60);
    onView = null;   // the injected frames below are deliberately not real states

    const current = JSON.stringify(Table.view());
    /* A frame with no version at all. No version, no trust: it must be dropped,
     * not applied. */
    deliver({ type: 'view', view: { seat: 0, phase: 'wrecked', players: [] } });
    check(JSON.stringify(Table.view()) === current, 'a frame with no version was applied');

    /* A frame from the past. */
    deliver({ type: 'view', version: -5, view: { seat: 0, phase: 'wrecked', players: [] } });
    check(JSON.stringify(Table.view()) === current, 'a stale view rolled the board backwards');

    /* A frame from the future is applied, and then its own duplicate is not. */
    deliver({ type: 'view', version: 999999, view: { seat: 0, phase: 'marker', players: [] } });
    check(Table.view().phase === 'marker', 'a newer view was not applied');
    deliver({ type: 'view', version: 999999, view: { seat: 0, phase: 'again', players: [] } });
    check(Table.view().phase === 'marker', 'a duplicate version was applied a second time');

    Table.close();
    srv.stop();
  }

  /* ============ 6. LEAVING AND COMING BACK ============
   *
   * A seat that goes quiet must be played by the computer rather than stalling
   * the table for everybody, and coming back must be possible. */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 1 });
    const link = srv.connect(1, () => {});
    check(link !== null, 'could not sit down at seat 2');
    await sleep(30);
    check(srv.peek().players[1].occupant === 'human', 'a connected seat is not marked human');
    link.close();
    await sleep(30);
    check(srv.peek().players[1].occupant === 'away',
      'a seat whose client went away is not marked away — the computer will not play it ' +
      'and the table will stall');
    const again = srv.connect(1, () => {});
    check(again !== null, 'the seat could not be reclaimed after the client came back');
    await sleep(30);
    check(srv.peek().players[1].occupant === 'human', 'reclaiming a seat did not restore it');

    /* A closed link may not move anything. */
    const truthBefore = JSON.stringify(srv.peek().bidLog);
    link.send({ type: 'action', seq: 5, action: { type: 'order' } });
    await sleep(30);
    check(JSON.stringify(srv.peek().bidLog) === truthBefore,
      'a closed connection was still able to make a move');
    srv.stop();
  }

  console.log('online: ' + checks + ' assertions');
  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('online: OK');
}

main().catch(e => { console.error('online: threw — ' + e.stack); process.exit(1); });

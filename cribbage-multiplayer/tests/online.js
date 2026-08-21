/* Playing over a wire, before there is a wire.
 *
 * js/localserver.js is an authoritative server that happens to run in the same
 * process: the real engine, the real authorization gate, the real projection,
 * and a faked network. What is faked is the network, and only the network.
 *
 * THE WIRE MUST BE ABLE TO MISBEHAVE. With a constant delay, setTimeout ordering
 * makes the fake wire perfectly FIFO — and a FIFO, lossless wire cannot produce
 * the reordering that the version guard, the sequence correlation and the
 * idempotency check exist to survive. Latency is jittered.
 *
 *   node tests/online.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 24680;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js',
  'js/table.js', 'js/localserver.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Table, LocalServer } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const config = () => ({ names: ['One', 'Two'], targetScore: 61, difficulty: 'hard' });

/* ONE listener for the whole file. Table.onChange appends to a module-level list
 * that Table.close() deliberately does NOT clear — the interface registers its
 * handler once at start-up and it has to survive leaving one table and joining
 * another. Correct for the app, and it means a per-section handler would leave
 * every earlier section's still running against the current game. */
let onView = null;
Table.onChange(() => { if (onView) onView(); });
let onReject = null;
Table.onRejected(info => { if (onReject) onReject(info); });

/* Take whatever move is ours, FROM THE VIEW ALONE. If this ever needs a field
 * the projection does not carry, the projection is incomplete — which is the
 * main thing this file is for. */
function actIfOurs(v, me) {
  if (!v || Table.pending()) return false;
  if (v.phase === 'cutForDeal') return !!Table.act({ type: 'cut' });
  if (v.phase === 'discard' && !v.players[me].hasDiscarded) {
    const h = v.players[me].hand.map(c => c.id);
    return h.length >= 2 && !!Table.act({ type: 'discard', cards: [h[0], h[1]] });
  }
  if (v.phase === 'play' && v.turn === me) {
    const legal = G.legalPlays(v, me);
    return !!Table.act(legal.length ? { type: 'play', card: legal[0].id } : { type: 'go' });
  }
  if (v.phase === 'count' && v.turn === me) return !!Table.act({ type: 'next' });
  return false;
}

async function main() {
  /* ============ 1. A WHOLE SESSION, FROM VIEWS ALONE ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 3, jitter: true, botDelay: 2 });
    const handsSeen = new Set();
    let seatSeen = null, sawOwnHand = false, sawHidden = false, sawCribHidden = false;
    let sawCribShown = false;
    const phases = {};

    Table.startOnline(null, handler => srv.connect(null, handler));
    onView = () => {
      const v = Table.view();
      if (!v) return;
      const me = Table.seat();
      if (me === null) return;
      seatSeen = me;
      phases[v.phase] = (phases[v.phase] || 0) + 1;

      /* THE FIELD THAT MUST NEVER BE ON THE WIRE. Forty undealt cards give away
       * the opponent's hand by elimination. */
      check(v.deck === undefined, 'the undealt pack arrived at a client');

      if (v.players[me].hand.length) {
        sawOwnHand = true;
        check(v.players[me].hand.every(c => c.id), 'our own hand came back as placeholders');
      }
      const opp = 1 - me;
      const open = v.phase === 'roundOver' || v.phase === 'gameOver' ||
        (v.phase === 'count' && v.countStage >= 1);
      if (!open) {
        for (const c of v.players[opp].hand) {
          sawHidden = true;
          check(c.id === undefined, 'the other hand arrived with an id: ' + JSON.stringify(c));
        }
        if (v.cribCount) {
          sawCribHidden = true;
          check(v.crib.length === 0, 'the crib arrived before it was counted');
        }
      }
      if (v.crib.length) sawCribShown = true;

      if (v.phase === 'idle') { Table.act({ type: 'start' }); return; }
      if (v.phase === 'roundOver' || v.phase === 'gameOver') {
        handsSeen.add(v.gameNumber + ':' + v.handNumber);
        if (handsSeen.size < 8) Table.act({ type: 'nextHand' });
        return;
      }
      actIfOurs(v, me);
    };

    srv.start();
    for (let i = 0; i < 2000 && handsSeen.size < 8; i++) await sleep(4);

    check(handsSeen.size >= 8, 'only ' + handsSeen.size + ' hands completed over the wire');
    check(seatSeen !== null, 'the client never learned which seat it was in');
    check(sawOwnHand, 'the client never saw its own cards');
    check(sawHidden, 'the client never saw a hidden hand, so the hiding proves nothing');
    check(sawCribHidden, 'the crib was never seen face down');
    check(sawCribShown, 'the crib was never revealed');
    for (const p of ['discard', 'play', 'count']) {
      check((phases[p] || 0) > 0, 'the session never reached ' + p);
    }
    for (const h of srv.peek().history) {
      check(h.problems.length === 0, 'the server audit failed: ' + h.problems.join('; '));
    }
    onView = null;
    Table.close();
    srv.stop();
  }

  /* ============ 2. THE SEAT COMES FROM THE CONNECTION ============
   *
   * The property the whole authorization layer rests on, and it belongs to the
   * SERVER rather than to applyAction: one careless line reading msg.seat would
   * reinstate the hole with the gate fully in place. */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 0 });
    const a = srv.connect(0, () => {});
    const b = srv.connect(1, () => {});
    check(a && b, 'both seats could not be taken');
    check(srv.connect(0, () => {}) === null, 'a second client took an occupied seat');
    check(srv.connect(5, () => {}) === null, 'a client sat down at a seat that does not exist');
    check(srv.connect(-1, () => {}) === null, 'a client sat down at seat minus one');
    srv.start();
    a.send({ type: 'action', seq: 1, action: { type: 'start' } });
    await sleep(60);
    a.send({ type: 'action', seq: 2, action: { type: 'cut' } });
    await sleep(60);

    const truth = srv.peek();
    if (truth.phase === 'discard') {
      /* Seat 0 tries to throw seat 1's cards, claiming to be seat 1 in every way
       * a message can claim it. */
      const theirs = truth.players[1].hand.map(c => c.id).slice(0, 2);
      const before = JSON.stringify(srv.peek().discarded);
      a.send({ type: 'action', seq: 3, seat: 1, action: { type: 'discard', cards: theirs } });
      a.send({ type: 'action', seq: 4, player: 1, action: { type: 'discard', cards: theirs } });
      await sleep(80);
      check(JSON.stringify(srv.peek().discarded) === before,
        'a client threw the other seat\'s cards by putting a seat number in the message');
    }
    srv.stop();
  }

  /* ============ 3. ONE MOVE IN FLIGHT, DUPLICATES HARMLESS ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 8, jitter: true, botDelay: 4 });
    let doubleSent = 0, played = 0, reached = false;
    Table.startOnline(null, handler => srv.connect(null, handler));
    onView = () => {
      const v = Table.view();
      if (!v) return;
      const me = Table.seat();
      if (v.phase === 'idle') { Table.act({ type: 'start' }); return; }
      if (v.phase === 'roundOver' || v.phase === 'gameOver') { Table.act({ type: 'nextHand' }); return; }
      if (v.phase === 'play' && v.turn === me && !Table.pending()) {
        const legal = G.legalPlays(v, me);
        if (!legal.length) { Table.act({ type: 'go' }); return; }
        reached = true;
        played++;
        const first = Table.act({ type: 'play', card: legal[0].id });
        /* The same keypress, twice. The second must be refused by the client
         * rather than put on the wire. */
        const second = Table.act({ type: 'play', card: legal[0].id });
        check(first.ok === 'pending', 'a play was not reported as pending');
        if (second.ok !== false) doubleSent++;
        return;
      }
      actIfOurs(v, me);
    };
    srv.start();
    for (let i = 0; i < 1200 && played < 10; i++) await sleep(4);

    check(reached, 'the double-send case was never reached');
    check(doubleSent === 0, doubleSent + ' second plays were accepted while one was in flight');
    const live = srv.peek().pile.map(e => e.card.id);
    check(new Set(live).size === live.length, 'a card was played twice in the hand in progress');
    onView = null;
    Table.close();
    srv.stop();
  }

  /* ============ 4. A REFUSAL SAYS WHY ============ */
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

    Table.act({ type: 'play', card: 'AS' });     // wrong for the cut-for-deal phase
    await sleep(100);
    check(reasons.length >= 1, 'a plainly wrong move was never refused');
    if (reasons.length) {
      check(typeof reasons[0].reason === 'string' && reasons[0].reason.length > 4,
        'the refusal carried no usable reason: ' + JSON.stringify(reasons[0]));
      check(!reasons[0].fatal, 'an ordinary refusal was marked fatal');
    }
    check(Table.pending() === null, 'the pending move survived its own refusal');
    onView = null; onReject = null;
    Table.close();
    srv.stop();
  }

  /* ============ 5. STALE AND DUPLICATE FRAMES ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 0 });
    let deliver = null;
    Table.startOnline(null, handler => { deliver = handler; return srv.connect(null, handler); });
    onView = () => {
      const v = Table.view();
      if (v && v.phase === 'idle') Table.act({ type: 'start' });
    };
    srv.start();
    await sleep(60);
    onView = null;    // the frames below are deliberately not real states

    const current = JSON.stringify(Table.view());
    deliver({ type: 'view', view: { seat: 0, phase: 'wrecked', players: [] } });
    check(JSON.stringify(Table.view()) === current, 'a frame with no version was applied');
    deliver({ type: 'view', version: -5, view: { seat: 0, phase: 'wrecked', players: [] } });
    check(JSON.stringify(Table.view()) === current, 'a stale view rolled the board backwards');
    deliver({ type: 'view', version: 999999, view: { seat: 0, phase: 'marker', players: [] } });
    check(Table.view().phase === 'marker', 'a newer view was not applied');
    deliver({ type: 'view', version: 999999, view: { seat: 0, phase: 'again', players: [] } });
    check(Table.view().phase === 'marker', 'a duplicate version was applied a second time');

    Table.close();
    srv.stop();
  }

  /* ============ 6. LEAVING AND COMING BACK ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 1 });
    const link = srv.connect(1, () => {});
    check(link !== null, 'could not sit down at seat 2');
    await sleep(30);
    check(srv.peek().players[1].occupant === 'human', 'a connected seat is not marked human');
    link.close();
    await sleep(30);
    check(srv.peek().players[1].occupant === 'away',
      'a seat whose client went away is not marked away, so the table will stall');
    const again = srv.connect(1, () => {});
    check(again !== null, 'the seat could not be reclaimed');
    await sleep(30);
    check(srv.peek().players[1].occupant === 'human', 'reclaiming did not restore the seat');

    const before = JSON.stringify(srv.peek().cutForDeal);
    link.send({ type: 'action', seq: 9, action: { type: 'cut' } });
    await sleep(30);
    check(JSON.stringify(srv.peek().cutForDeal) === before,
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

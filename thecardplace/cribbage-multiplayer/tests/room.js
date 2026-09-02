/* The room, and the thing that can only be tested here: EVICTION.
 *
 * A Durable Object is evicted and woken constantly, and three of the things the
 * room holds produce a WRONG GAME rather than an obvious failure if they do not
 * survive — and all three are silent:
 *
 *   version   resets to 0, so every client, holding versions in the hundreds,
 *             discards every view that follows as stale. The board freezes with
 *             no error and no timeout.
 *   cursors   reset, so the whole game's log is replayed and a screen reader
 *             recites the entire hand again.
 *   lastSeq   resets, so a frame retried after a reconnect plays a second card.
 *
 * The storage below serializes on the way in and parses on the way out, because
 * that is what the platform does. A fake storage that hands back the same object
 * lets a game survive eviction through references a real one loses.
 *
 *   node tests/room.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 13579;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js', '../shared/js/room.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Room } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

const config = () => ({ names: ['One', 'Two'], targetScore: 61, difficulty: 'hard' });

function makeTable(opts) {
  const store = {};
  let clock = 1000;
  let alarmAt = 0;
  const inbox = {};

  const storage = {
    get: k => (k in store ? JSON.parse(store[k]) : null),
    put: (k, v) => { store[k] = JSON.stringify(v); }
  };

  const room = Room.create(Object.assign({
    config: config(), storage,
    now: () => clock,
    setAlarm: at => { alarmAt = at; },
    deliver: (id, msg) => { (inbox[id] = inbox[id] || []).push(msg); },
    botDelay: 10
  }, opts || {}));

  return {
    room, inbox,
    now: () => clock,
    advance: ms => { clock += ms; },
    runAlarms(max = 400) {
      let n = 0;
      while (alarmAt && clock >= alarmAt && n < max) { alarmAt = 0; room.onAlarm(); n++; }
      return n;
    },
    /* Only the computer's alarms, stopping the moment a person is on move.
     * settle() cannot be used for that: once a human seat is on move the pending
     * alarm IS the turn clock, so settling fast-forwards the grace period and
     * takes the player's seat off them. */
    runBots(max = 400) {
      let n = 0;
      while (alarmAt && n < max) {
        const st = room.peek();
        const seat = st ? G.seatToAct(st) : -1;
        if (seat >= 0 && st.players[seat].occupant === 'human') break;
        if (clock < alarmAt) clock = alarmAt;
        alarmAt = 0; room.onAlarm(); n++;
      }
      return n;
    },
    settle(max = 600) {
      let n = 0;
      while (alarmAt && n < max) {
        if (clock < alarmAt) clock = alarmAt;
        alarmAt = 0; room.onAlarm(); n++;
      }
      return n;
    },
    pending: () => alarmAt,
    bytes: () => Object.values(store).reduce((a, s) => a + s.length, 0),
    cycle(live) { room.hibernate(); room.wake(live); }
  };
}

function lastView(inbox, id) {
  const list = inbox[id] || [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].view) return list[i];
  return null;
}

/* ============ 1. A SESSION, EVICTED BETWEEN EVERY MOVE ============ */
{
  const t = makeTable();
  const live = [{ id: 'a', seat: 0, seenAt: 1000 }, { id: 'b', seat: 1, seenAt: 1000 }];
  t.room.start();
  check(t.room.join('a', null, 'Ann').ok, 'the first player could not sit down');
  check(t.room.join('b', null, 'Bob').ok, 'the second player could not sit down');

  /* Versions are tracked PER CONNECTION. The counter is shared and monotonic,
   * but the two clients do not receive every frame at the same moment, so one
   * connection's latest legitimately trails the other's — comparing each against
   * a single running maximum reports a rollback on a perfectly correct run. */
  let seq = 0, evictions = 0, handsDone = 0, versionFell = false;
  const lastVersion = { a: -1, b: -1 };
  const handsSeen = new Set();

  function move(id, seat) {
    const frame = lastView(t.inbox, id);
    if (!frame) return false;
    const v = frame.view;
    const send = action => t.room.action(id, { seq: ++seq, action });
    if (v.phase === 'idle') { send({ type: 'start' }); return true; }
    if (v.phase === 'cutForDeal') { send({ type: 'cut' }); return true; }
    if (v.phase === 'roundOver' || v.phase === 'gameOver') {
      handsSeen.add(v.gameNumber + ':' + v.handNumber);
      handsDone = handsSeen.size;
      send({ type: 'nextHand' });
      return true;
    }
    if (v.phase === 'discard' && !v.players[seat].hasDiscarded) {
      const h = v.players[seat].hand.map(c => c.id);
      if (h.length < 2) return false;
      send({ type: 'discard', cards: [h[0], h[1]] });
      return true;
    }
    if (v.phase === 'play' && v.turn === seat) {
      const legal = G.legalPlays(v, seat);
      send(legal.length ? { type: 'play', card: legal[0].id } : { type: 'go' });
      return true;
    }
    if (v.phase === 'count' && v.turn === seat) { send({ type: 'next' }); return true; }
    return false;
  }

  for (let step = 0; step < 8000 && handsDone < 8; step++) {
    /* Evict between every single move. Whatever is not in storage by now is
     * gone, which is the entire point. */
    t.cycle(live);
    evictions++;
    const moved = move('a', 0) || move('b', 1);
    if (!moved) { t.advance(40); t.runAlarms(); }
    for (const id of ['a', 'b']) {
      const f = lastView(t.inbox, id);
      if (!f) continue;
      if (f.version < lastVersion[id]) versionFell = true;
      lastVersion[id] = Math.max(lastVersion[id], f.version);
    }
  }

  check(handsDone >= 8, 'only ' + handsDone + ' hands finished across ' + evictions + ' evictions');
  check(!versionFell,
    'the view version went BACKWARDS across an eviction — every client would silently ' +
    'discard everything that followed and the board would freeze');

  const truth = t.room.peek();
  for (const h of truth.history) {
    check(h.problems.length === 0,
      'hand ' + h.handNumber + ' failed its audit after eviction: ' + h.problems.join('; '));
  }

  /* Nobody hears the same event twice, however often the room was evicted.
   * Counted by KIND, because the deal line names the hand number and that
   * restarts when somebody wins a game. */
  const dealsExpected = truth.history.length +
    (truth.phase !== 'idle' && truth.phase !== 'roundOver' && truth.phase !== 'gameOver' ? 1 : 0);
  for (const id of ['a', 'b']) {
    let deals = 0;
    for (const m of t.inbox[id] || []) for (const e of m.events || []) if (e.kind === 'deal') deals++;
    check(deals === dealsExpected,
      'connection ' + id + ' was told about ' + deals + ' deals across ' + dealsExpected +
      ' hands: the event cursor did not survive eviction');
  }

  /* And no seat was ever handed the other one's cards. */
  for (const [id, seat] of [['a', 0], ['b', 1]]) {
    for (const m of t.inbox[id] || []) {
      if (!m.view) continue;
      check(m.view.deck === undefined, 'the undealt pack was sent to a client');
      const opp = 1 - seat;
      const open = m.view.phase === 'roundOver' || m.view.phase === 'gameOver' ||
        (m.view.phase === 'count' && m.view.countStage >= 1);
      if (!open) {
        for (const c of m.view.players[opp].hand) {
          check(c.id === undefined, 'the other seat\'s hand was sent mid-hand');
        }
      }
    }
  }
}

/* ============ 2. A RETRIED FRAME MUST NOT MOVE TWICE ============ */
{
  const t = makeTable();
  const live = [{ id: 'a', seat: 0, seenAt: 1000 }];
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  t.room.action('a', { seq: 2, action: { type: 'cut' } });
  t.runBots(50);

  const st = t.room.peek();
  if (st.phase === 'discard' && !st.discarded[0]) {
    const h = st.players[0].hand.map(c => c.id).slice(0, 2);
    t.room.action('a', { seq: 7, action: { type: 'discard', cards: h } });
    check(!!t.room.peek().discarded[0], 'the first frame did not take effect');
    const after = JSON.stringify(t.room.peek().discarded[0]);

    /* Evict, come back, send exactly the same frame again — what a client does
     * after a flaky reconnect. */
    t.cycle(live);
    t.room.action('a', { seq: 7, action: { type: 'discard', cards: h } });
    check(JSON.stringify(t.room.peek().discarded[0]) === after,
      'a retried frame was applied a second time across an eviction');
    /* An older sequence number is a duplicate too. */
    t.room.action('a', { seq: 3, action: { type: 'discard', cards: h } });
    check(JSON.stringify(t.room.peek().discarded[0]) === after,
      'an older sequence number was applied');
  } else {
    fails.push('could not reach a discard to retry'); checks++;
  }
}

/* ============ 3. THE TURN CLOCK, BOTH WAYS ============ */
{
  const t = makeTable({ turnGrace: 90000, awayGrace: 0, presenceWindow: 0 });
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  t.room.action('a', { seq: 2, action: { type: 'cut' } });

  let guard = 0;
  while (guard++ < 300 && G.seatToAct(t.room.peek()) !== 0) {
    if (!t.runBots(40)) { t.advance(30); if (!t.runBots(40)) break; }
  }
  check(G.seatToAct(t.room.peek()) === 0, 'the table never put the player on move');
  check(t.room.peek().players[0].occupant === 'human', 'a connected seat is not marked human');

  t.advance(200000);
  t.settle(200);
  check(t.room.peek().players[0].occupant === 'away' || t.room.peek().gameOver,
    'a silent seat held the table up for ever: the turn clock never fired');
}
{
  /* And the mirror image, which is the more damaging failure: somebody reading a
   * hand back before deciding what to throw is doing exactly what the interface
   * encourages, and taking their cards for it is worse than a table that waits. */
  const t = makeTable({ turnGrace: 90000, awayGrace: 30 * 60 * 1000, presenceWindow: 180000 });
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  t.room.action('a', { seq: 2, action: { type: 'cut' } });
  let guard = 0;
  while (guard++ < 300 && G.seatToAct(t.room.peek()) !== 0) {
    if (!t.runBots(40)) { t.advance(30); if (!t.runBots(40)) break; }
  }
  if (G.seatToAct(t.room.peek()) === 0) {
    /* runAlarms, not settle: settle races through several turn-clock windows
     * without the client getting a chance to ping, which is not what happens to
     * a live browser. */
    for (let minute = 0; minute < 5; minute++) {
      t.advance(60000);
      t.room.wake([{ id: 'a', seat: 0, seenAt: t.now() }]);
      t.runAlarms(10);
    }
    check(t.room.peek().players[0].occupant === 'human',
      'a player whose browser was still answering was declared away for taking five ' +
      'minutes over a discard');
  }
}

/* ============ 4. SEATS ============ */
{
  const t = makeTable();
  t.room.start();
  check(t.room.join('a', null, 'Ann').ok, 'the first player could not sit down');
  check(t.room.join('b', 0, 'Bob').ok === false, 'two clients took the same seat');
  check(t.room.join('c', 5, 'Cid').ok === false, 'a client sat down at a seat that does not exist');
  const b = t.room.join('b', null, 'Bob');
  check(b.ok, 'the second seat could not be taken');
  check(t.room.join('c', null, 'Cid').ok === false, 'a third person joined a two-seat table');

  t.room.leave('b');
  check(t.room.peek().players[b.seat].occupant === 'away',
    'a seat whose client left is not marked away, so the table will stall');
  check(t.room.join('b2', b.seat, 'Bob').ok, 'an abandoned seat could not be reclaimed');
  check(t.room.peek().players[b.seat].occupant === 'human', 'reclaiming did not restore the seat');
}

/* ============ 5. STORAGE ============ */
let bytesPerHand = 0;
{
  const t = makeTable();
  t.room.start();
  t.room.join('a', 0, 'Ann');
  let seq = 0, hands = 0;
  const send = a => t.room.action('a', { seq: ++seq, action: a });
  send({ type: 'start' });
  send({ type: 'cut' });
  for (let step = 0; step < 12000 && hands < 20; step++) {
    const st = t.room.peek();
    if (st.phase === 'roundOver' || st.phase === 'gameOver') { hands++; send({ type: 'nextHand' }); continue; }
    if (st.phase === 'cutForDeal') { send({ type: 'cut' }); continue; }
    const seat = G.seatToAct(st);
    if (seat === 0) {
      const v = sandbox.SH.View.forSeat(st, 0);
      if (v.phase === 'discard') {
        const h = v.players[0].hand.map(c => c.id);
        send({ type: 'discard', cards: [h[0], h[1]] });
      } else if (v.phase === 'play') {
        const legal = G.legalPlays(v, 0);
        send(legal.length ? { type: 'play', card: legal[0].id } : { type: 'go' });
      } else if (v.phase === 'count') send({ type: 'next' });
      continue;
    }
    t.advance(20);
    if (!t.runBots(80)) t.advance(20);
  }
  bytesPerHand = hands ? Math.round(t.bytes() / hands) : 0;
  check(hands >= 15, 'only ' + hands + ' hands were played for the storage measurement');

  /* The event log must not be what grows. Nothing on the server drains it — in a
   * browser the interface does — so without pruning the whole room state grows
   * for the life of the table, and the write starts silently failing at the
   * 128 KiB per-value limit while everything in memory carries on working. */
  check(t.room.peek().events.length <= 400,
    'the event log reached ' + t.room.peek().events.length + ' entries and is not being pruned');
}

console.log('room: ' + checks + ' assertions');
console.log('  storage: about ' + bytesPerHand.toLocaleString() + ' bytes per hand, so the ' +
  '128 KiB per-value limit is reached at roughly hand ' +
  (bytesPerHand ? Math.floor(131072 / bytesPerHand) : '?'));

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('room: OK');

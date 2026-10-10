/* The room, and the thing that can only be tested here: EVICTION.
 *
 * A Durable Object is evicted and woken constantly, and the room holds several
 * things that produce a WRONG GAME rather than an obvious failure if they do not
 * survive:
 *
 *   version   resets to 0, so every client — holding versions in the hundreds —
 *             silently discards every view that follows as stale. The board
 *             freezes. No error, no timeout, views arriving and being dropped.
 *   cursors   reset, so the whole game's event log is replayed to every seat and
 *             a screen reader recites the entire hand again.
 *   lastSeq   resets, so a frame retried after a reconnect plays a second card.
 *
 * Three of those are silent, and none of them is caught by a test that runs in
 * one process without eviction. So hibernate() and wake() are exercised
 * constantly here — between individual moves, not just between hands.
 *
 * The storage below serializes on the way in and parses on the way out, because
 * that is what the platform does. A fake storage that hands back the same object
 * would let a game survive eviction by accident, through references that a real
 * one loses.
 *
 *   node tests/room.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 606060;
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

function config() {
  return {
    numPlayers: 4, names: ['One', 'Two', 'Three', 'Four'],
    pointsToWin: 10, stickTheDealer: false, allowAlone: true, difficulty: 'hard'
  };
}

/* A table, with a clock, an alarm and a storage that behaves like the real one. */
function makeTable(opts) {
  const store = {};
  let clock = 1000;
  let alarmAt = 0;
  const inbox = {};        // connId -> [messages]

  const storage = {
    get: k => (k in store ? JSON.parse(store[k]) : null),
    put: (k, v) => { store[k] = JSON.stringify(v); }
  };

  const room = Room.create(Object.assign({
    config: config(),
    storage,
    now: () => clock,
    setAlarm: at => { alarmAt = at; },
    deliver: (connId, msg) => {
      (inbox[connId] = inbox[connId] || []).push(msg);
    },
    botDelay: 10
  }, opts || {}));

  return {
    room, inbox,
    now: () => clock,
    advance: ms => { clock += ms; },
    /* Fire the alarm if it is due, exactly as the platform would. Returns how
     * many alarms ran. */
    runAlarms(max = 400) {
      let n = 0;
      while (alarmAt && clock >= alarmAt && n < max) {
        alarmAt = 0;
        room.onAlarm();
        n++;
      }
      return n;
    },
    /* Let the COMPUTER seats get on with it, and stop the moment a person is on
     * move.
     *
     * settle() below cannot be used for this, and the difference is the whole
     * point of section 3. With a turn clock armed, settle() jumps the clock to
     * whatever alarm is pending — and once a human seat is on move the pending
     * alarm IS the turn clock, so settling fast-forwards ninety seconds and
     * takes the player's seat off them. A correct simulation of somebody who
     * never answers, and a useless way to reach their turn. */
    runBots(max = 400) {
      let n = 0;
      while (alarmAt && n < max) {
        const st = room.peek();
        const seat = st ? sandbox.SH.Game.seatToAct(st) : -1;
        if (seat >= 0 && st.players[seat].occupant === 'human') break;
        if (clock < alarmAt) clock = alarmAt;
        alarmAt = 0;
        room.onAlarm();
        n++;
      }
      return n;
    },
    /* Let the table get on with it: advance the clock to whatever alarm is
     * pending and fire it, repeatedly. */
    settle(max = 600) {
      let n = 0;
      while (alarmAt && n < max) {
        if (clock < alarmAt) clock = alarmAt;
        alarmAt = 0;
        room.onAlarm();
        n++;
      }
      return n;
    },
    pending: () => alarmAt,
    bytes: () => Object.values(store).reduce((a, s) => a + s.length, 0),
    /* Evict and come back, exactly as the platform does. */
    cycle(live) { room.hibernate(); room.wake(live); }
  };
}

function lastView(inbox, id) {
  const list = inbox[id] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].view) return list[i];
  }
  return null;
}

/* ============ 1. A WHOLE SESSION, EVICTED BETWEEN EVERY MOVE ============ */
{
  const t = makeTable();
  const live = [{ id: 'a', seat: 0, seenAt: 1000 }, { id: 'b', seat: 2, seenAt: 1000 }];
  t.room.start();
  check(t.room.join('a', null, 'Ann').ok, 'the first player could not sit down');
  check(t.room.join('b', null, 'Bob').ok, 'the second player could not sit down');
  const seatA = t.room.peek().players.findIndex(p => p.name === 'Ann');
  const seatB = t.room.peek().players.findIndex(p => p.name === 'Bob');
  check(seatA === 0 && seatB === 1, 'the room seated people somewhere unexpected: ' + seatA + ',' + seatB);
  live[1].seat = seatB;

  let seq = 0;
  let evictions = 0;
  let handsDone = 0;
  let versionEverFell = false;
  let lastVersion = -1;

  /* Play as both humans, from the view each one is given. */
  function humanMove(connId, seat) {
    const frame = lastView(t.inbox, connId);
    if (!frame) return false;
    const v = frame.view;
    if (v.phase === 'idle') { t.room.action(connId, { seq: ++seq, action: { type: 'start' } }); return true; }
    if (v.phase === 'handOver') {
      handsDone++;
      t.room.action(connId, { seq: ++seq, action: { type: 'nextHand' } });
      return true;
    }
    if (v.phase === 'bid1' && v.turn === seat) {
      t.room.action(connId, { seq: ++seq, action: { type: 'order', alone: false } }); return true;
    }
    if (v.phase === 'bid2' && v.turn === seat) {
      const suit = ['C', 'S', 'H', 'D'].filter(s => s !== v.deniedSuit)[0];
      t.room.action(connId, { seq: ++seq, action: { type: 'call', suit, alone: false } }); return true;
    }
    if (v.phase === 'discard' && v.dealer === seat) {
      t.room.action(connId, { seq: ++seq, action: { type: 'discard', card: v.players[seat].hand[0].id } });
      return true;
    }
    if (v.phase === 'play' && v.turn === seat && v.sittingOut !== seat) {
      const legal = G.legalPlays(v, seat);
      if (!legal.length) return false;
      t.room.action(connId, { seq: ++seq, action: { type: 'play', card: legal[0].id } });
      return true;
    }
    return false;
  }

  for (let step = 0; step < 4000 && handsDone < 8; step++) {
    /* Evict between every single move. Whatever is not in storage by now is
     * gone, which is exactly the point. */
    t.cycle(live);
    evictions++;

    const moved = humanMove('a', seatA) || humanMove('b', seatB);
    if (!moved) {
      t.advance(40);
      t.runAlarms();
    }

    for (const [id] of [['a'], ['b']]) {
      const f = lastView(t.inbox, id);
      if (!f) continue;
      if (f.version < lastVersion) versionEverFell = true;
      lastVersion = Math.max(lastVersion, f.version);
    }
    if (!t.pending() && !moved) t.advance(40);
  }

  check(handsDone >= 8, 'only ' + handsDone + ' hands finished across ' + evictions + ' evictions');
  check(!versionEverFell,
    'the view version went BACKWARDS across an eviction — every client would ' +
    'silently discard everything that followed and the board would freeze');

  const truth = t.room.peek();
  for (const h of truth.history) {
    check(h.problems.length === 0,
      'hand ' + h.handNumber + ' failed its audit after eviction: ' + h.problems.join('; '));
  }
  check(truth.history.length >= 8, 'the room recorded ' + truth.history.length + ' hands');

  /* No seat may hear the same event twice, however often the room was evicted.
   * A screen reader reciting the whole hand again is not a cosmetic problem — it
   * is the game reporting things that are not happening. */
  /* Counted by KIND, not by the words. The deal line names the hand number, and
   * the hand number restarts at one when somebody wins a game — so a set of the
   * texts reports a duplicate on a perfectly correct run as soon as a second
   * game begins. Counting the events themselves is exact. */
  const dealsExpected = truth.history.length +
    (truth.phase !== 'idle' && truth.phase !== 'handOver' ? 1 : 0);
  for (const id of ['a', 'b']) {
    let deals = 0;
    for (const m of t.inbox[id] || []) for (const e of m.events || []) if (e.kind === 'deal') deals++;
    check(deals === dealsExpected,
      'connection ' + id + ' was told about ' + deals + ' deals across ' + dealsExpected +
      ' hands: the event cursor did not survive eviction');
  }
}

/* ============ 2. A RETRIED FRAME MUST NOT PLAY A SECOND CARD ============ */
{
  const t = makeTable();
  const live = [{ id: 'a', seat: 0, seenAt: 1000 }];
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  t.settle();

  /* Get to a point where seat 0 can act. */
  let guard = 0;
  while (guard++ < 200) {
    const v = lastView(t.inbox, 'a').view;
    if (v.phase === 'bid1' && v.turn === 0) break;
    if (v.phase === 'handOver') { t.room.action('a', { seq: 100 + guard, action: { type: 'nextHand' } }); }
    t.advance(50);
    if (!t.runBots(50)) t.advance(50);
  }

  const v = lastView(t.inbox, 'a').view;
  if (v.phase === 'bid1' && v.turn === 0) {
    const bidsBefore = t.room.peek().bidLog.length;
    t.room.action('a', { seq: 7, action: { type: 'order', alone: false } });
    const after = t.room.peek().bidLog.length;
    check(after === bidsBefore + 1, 'the first frame did not take effect');

    /* Evict, come back, and send exactly the same frame again — what a client
     * does after a flaky reconnect. */
    t.cycle(live);
    t.room.action('a', { seq: 7, action: { type: 'order', alone: false } });
    check(t.room.peek().bidLog.length === after,
      'a retried frame was applied a second time across an eviction');

    /* And an OLDER sequence number is a duplicate too. */
    t.room.action('a', { seq: 3, action: { type: 'pass' } });
    check(t.room.peek().bidLog.length === after, 'an older sequence number was applied');
  } else {
    fails.push('could not reach a bid to retry');
    checks++;
  }
}

/* ============ 3. THE TURN CLOCK ============
 *
 * A seat only becomes 'away' when its socket closes cleanly. A laptop that
 * sleeps, a phone that loses signal, a browser killed outright: the seat stays
 * 'human', no bot will play it, and the table stalls for everybody, permanently,
 * with no message. */
{
  const t = makeTable({ turnGrace: 90000, awayGrace: 0, presenceWindow: 0 });
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });

  /* Run the table until seat 0 is on move and then simply never answer. */
  let guard = 0;
  while (guard++ < 300 && G.seatToAct(t.room.peek()) !== 0) {
    if (!t.runBots(40)) { t.advance(30); if (!t.runBots(40)) break; }
  }
  check(G.seatToAct(t.room.peek()) === 0, 'the table never reached seat 1\'s turn');

  const before = t.room.peek().players[0].occupant;
  check(before === 'human', 'the connected seat was not marked human');

  t.advance(200000);
  t.settle(200);
  const st = t.room.peek();
  check(st.players[0].occupant === 'away' || st.phase === 'handOver',
    'a silent seat held the table up for ever: the turn clock never fired');
  check(st.history.length > 0 || st.trickLog.length > 0 || st.bidLog.length > 0,
    'the table made no progress at all after the silent seat was taken over');

  /* And making any move takes the seat straight back — the alternative is a
   * player losing their chair for the rest of the session for having thought
   * about a bid, with nothing to tell them to reload. */
  if (st.players[0].occupant === 'away' && G.seatToAct(t.room.peek()) === 0) {
    const v = lastView(t.inbox, 'a').view;
    if (v && v.phase === 'bid1') {
      t.room.action('a', { seq: 50, action: { type: 'pass' } });
      check(t.room.peek().players[0].occupant === 'human',
        'a player who came back and moved did not get their seat back');
    }
  }
}

/* ============ 4. A PRESENT PLAYER IS NOT TIMED OUT FOR THINKING ============
 *
 * The mirror image, and the more damaging failure of the two: a screen reader
 * user reading a hand back before deciding on a bid is doing exactly what the
 * interface encourages, and taking their cards off them for it is worse than a
 * table that waits. */
{
  const t = makeTable({ turnGrace: 90000, awayGrace: 30 * 60 * 1000, presenceWindow: 180000 });
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });

  let guard = 0;
  while (guard++ < 300 && G.seatToAct(t.room.peek()) !== 0) {
    if (!t.runBots(40)) { t.advance(30); if (!t.runBots(40)) break; }
  }

  check(G.seatToAct(t.room.peek()) === 0, 'the table never put the player on move');

  if (G.seatToAct(t.room.peek()) === 0) {
    /* Five minutes of thinking, while the browser keeps saying it is there —
     * which is what a client's pings do, and what the wrapper records on the
     * socket. */
    /* runAlarms, not settle: settle jumps the clock forward to whatever alarm is
     * pending and keeps going, which races through several turn-clock windows
     * without the client getting a chance to ping in between. That is not what
     * happens to a live browser, and simulating it that way declares a perfectly
     * healthy tab dead — which is the bug this section exists to catch, so
     * arriving at it through the harness would be a false positive. */
    for (let minute = 0; minute < 5; minute++) {
      t.advance(60000);
      t.room.wake([{ id: 'a', seat: 0, seenAt: t.now() }]);
      t.runAlarms(10);
    }
    check(t.room.peek().players[0].occupant === 'human',
      'a player whose browser was still answering was declared away for taking ' +
      'five minutes over a bid');
  }
}

/* ============ 5. SEATS ============ */
{
  const t = makeTable();
  t.room.start();
  check(t.room.join('a', null, 'Ann').ok, 'the first player could not sit down');
  check(t.room.join('b', 0, 'Bob').ok === false, 'two clients took the same seat');
  check(t.room.join('c', 9, 'Cid').ok === false, 'a client sat down at a seat that does not exist');
  check(t.room.join('d', -1, 'Dot').ok === false, 'a client sat down at seat minus one');
  check(t.room.join('e', 1.5, 'Eve').ok === false, 'a client sat down at seat one and a half');

  const b = t.room.join('b', null, 'Bob');
  const c = t.room.join('c', null, 'Cid');
  const d = t.room.join('d', null, 'Dot');
  check(b.ok && c.ok && d.ok, 'the table could not be filled');
  check(t.room.join('e', null, 'Eve').ok === false, 'a fifth person joined a four-seat table');

  /* Somebody leaves; their seat becomes reclaimable but is not handed to a
   * stranger while they might still come back... except that it is, because a
   * table that cannot be re-joined is worse. What must hold is that the seat is
   * marked away so the computer keeps it moving. */
  t.room.leave('b');
  check(t.room.peek().players[b.seat].occupant === 'away',
    'a seat whose client left is not marked away, so the table will stall');
  const back = t.room.join('b2', b.seat, 'Bob');
  check(back.ok, 'an abandoned seat could not be reclaimed');
  check(t.room.peek().players[b.seat].occupant === 'human', 'reclaiming did not restore the seat');
}

/* ============ 6. THE CHEAP PROPERTY WORTH PINNING ============
 *
 * Card objects are shared singletons in cards.js, and storage turns them into
 * plain copies. Every helper reads .id, .r and .s rather than comparing by
 * identity, so a copy is as good as the original — which is what makes eviction
 * survivable at all. Worth pinning before it stops being true. */
{
  const t = makeTable();
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  t.settle(50);

  const mid = JSON.parse(JSON.stringify(t.room.peek()));
  const fresh = G.createGame(config());
  Object.keys(mid).forEach(k => { fresh[k] = mid[k]; });
  let guard = 0;
  while (fresh.phase !== 'handOver' && guard++ < 400) {
    const p = G.seatToAct(fresh);
    if (p < 0) break;
    sandbox.SH.AI.act(fresh);
  }
  check(fresh.phase === 'handOver', 'a hand could not be finished after a JSON round trip');
  if (fresh.history.length) {
    check(fresh.history[fresh.history.length - 1].problems.length === 0,
      'a hand finished after a JSON round trip failed its audit');
  }
}

/* ============ 7. STORAGE SIZE ============
 *
 * The Durable Object per-value limit is 128 KiB. History is stored inside the
 * state blob, so a long session is the thing that would quietly start failing to
 * write. This does not assert a limit — it reports the number, so a change that
 * makes a hand ten times more expensive to store is visible in the log rather
 * than discovered at hand sixty. */
let bytesPerHand = 0;
{
  const t = makeTable();
  t.room.start();
  t.room.join('a', 0, 'Ann');
  t.room.action('a', { seq: 1, action: { type: 'start' } });
  let hands = 0, seq = 1;
  for (let step = 0; step < 6000 && hands < 25; step++) {
    const st = t.room.peek();
    if (st.phase === 'handOver') { hands++; t.room.action('a', { seq: ++seq, action: { type: 'nextHand' } }); continue; }
    const p = G.seatToAct(st);
    if (p === 0) {
      const v = sandbox.SH.View.forSeat(st, 0);
      if (v.phase === 'bid1') t.room.action('a', { seq: ++seq, action: { type: 'pass' } });
      else if (v.phase === 'bid2') t.room.action('a', { seq: ++seq, action: { type: 'pass' } });
      else if (v.phase === 'discard') t.room.action('a', { seq: ++seq, action: { type: 'discard', card: v.players[0].hand[0].id } });
      else if (v.phase === 'play') {
        const legal = G.legalPlays(v, 0);
        if (legal.length) t.room.action('a', { seq: ++seq, action: { type: 'play', card: legal[0].id } });
      }
      continue;
    }
    t.advance(20);
    if (!t.settle(80)) t.advance(20);
  }
  bytesPerHand = hands ? Math.round(t.bytes() / hands) : 0;
  check(hands >= 20, 'only ' + hands + ' hands were played for the storage measurement');

  /* The event log must not be what grows. Nothing on the server drains it — in a
   * browser the interface does, and there is no interface here — so without
   * pruning the whole room state grows for as long as the table exists, and the
   * write starts silently failing at the 128 KiB per-value limit while
   * everything in memory carries on working perfectly. */
  check(t.room.peek().events.length <= 400,
    'the event log reached ' + t.room.peek().events.length + ' entries over ' + hands +
    ' hands and is not being pruned');

  /* And pruning must not have eaten anything the seat at the table still needed,
   * nor caused anything to be sent twice. Exactly one deal event per hand. */
  let deals = 0;
  for (const m of t.inbox.a || []) for (const e of m.events || []) if (e.kind === 'deal') deals++;
  const expected = t.room.peek().history.length +
    (t.room.peek().phase !== 'idle' && t.room.peek().phase !== 'handOver' ? 1 : 0);
  check(deals === expected,
    'the seat was told about ' + deals + ' deals across ' + expected + ' hands — pruning ' +
    'either dropped one it still needed or caused one to be delivered twice');
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

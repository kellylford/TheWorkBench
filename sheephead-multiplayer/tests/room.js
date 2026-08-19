/* A room that keeps being evicted.
 *
 * A Durable Object is not a server that stays up. It is woken to handle a
 * message, and evicted again whenever the platform feels like it — mid-hand, mid
 * trick, between a player's move and the answer. Anything held in memory and not
 * in storage is gone, and three of the things this room holds produce a WRONG
 * GAME rather than an obvious failure when they vanish:
 *
 *   version   resets to 0. Clients are holding versions in the hundreds, so they
 *             discard every view that follows as stale. The board freezes. No
 *             error, no timeout — views keep arriving and are dropped in silence.
 *   cursors   reset. The whole game's event log is replayed to every seat, so a
 *             screen reader recites the entire hand again.
 *   lastSeq   resets. A frame retried after a reconnect plays a second card.
 *
 * None of that is visible in a process that never evicts, which is every test
 * written so far. So this file evicts constantly: between every single message,
 * in the fiercest run, and asserts a whole hand still comes out right.
 *
 *   node tests/room.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 31337;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js', 'js/room.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Cards: C, Room } = sandbox.SH;

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* Storage that behaves like the real thing in the one way that matters: values
 * go through JSON, so anything that cannot survive a round trip fails here
 * rather than in production. */
function makeStorage() {
  const box = {};
  return {
    get: k => (k in box ? JSON.parse(box[k]) : null),
    put: (k, v) => { box[k] = JSON.stringify(v); },
    raw: box
  };
}

function config(n) {
  return {
    numPlayers: n,
    names: ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n),
    allPass: 'leaster', difficulty: 'hard',
    blackQueenDoubler: true, redQueenDoubler: true, redealDoubler: true
  };
}

/* A table wrapper that can be evicted between any two operations. `evictEvery`
 * of 1 means the object is thrown away and rebuilt before every single call —
 * the harshest schedule the platform could possibly impose. */
function makeTable(n, evictEvery, opts) {
  const storage = makeStorage();
  const inbox = {};                 // connId -> messages received
  const live = [];                  // connections the platform would hand back
  let clock = 0;
  let alarmAt = 0;
  let ops = 0;
  let room = null;

  function build() {
    return Room.create({
      config: config(n),
      storage,
      now: () => clock,
      setAlarm: t => { alarmAt = t; },
      deliver: (id, msg) => { (inbox[id] = inbox[id] || []).push(msg); },
      botDelay: 10,
      turnGrace: (opts && opts.turnGrace) || 0
    });
  }

  room = build();

  /* Evict and rebuild. Everything in memory is lost; only storage survives, and
   * the platform hands back the live sockets with whatever was attached to them. */
  function evict() {
    room.hibernate();
    room = build();
    room.wake(live.map(c => ({ id: c.id, seat: c.seat })));
  }

  function maybeEvict() {
    ops++;
    if (evictEvery && ops % evictEvery === 0) evict();
  }

  return {
    storage, inbox, live,
    get room() { return room; },
    evict,
    tick(ms) {
      clock += ms;
      if (alarmAt && clock >= alarmAt) { alarmAt = 0; room.onAlarm(); maybeEvict(); return true; }
      return false;
    },
    join(id, seat, name) {
      const r = room.join(id, seat, name);
      if (r.ok) live.push({ id, seat });
      maybeEvict();
      return r;
    },
    action(id, msg) { room.action(id, msg); maybeEvict(); },
    start() { room.start(); maybeEvict(); },
    latestView(id) {
      const msgs = inbox[id] || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].type === 'view' || msgs[i].type === 'welcome') return msgs[i];
      }
      return null;
    }
  };
}

/* ---------------- 1. A whole hand, evicted between every message ---------------- */

for (const evictEvery of [0, 1]) {
  const label = evictEvery ? 'evicted before every call' : 'never evicted';
  const t = makeTable(5, evictEvery);
  t.start();
  check(t.join('c1', 2, 'Kelly').ok, `${label}: could not sit down`);

  let seq = 0, guard = 0, handsDone = 0;
  while (guard++ < 4000 && handsDone < 2) {
    // Let bots move.
    if (t.tick(20)) continue;

    const msg = t.latestView('c1');
    if (!msg) { t.tick(20); continue; }
    const v = msg.view;

    if (v.phase === 'handOver') { handsDone++; t.action('c1', { seq: ++seq, action: { type: 'nextHand' } }); continue; }
    if (v.phase === 'pick' && v.turn === 2) { t.action('c1', { seq: ++seq, action: { type: 'pick' } }); continue; }
    if (v.phase === 'bury' && v.picker === 2) {
      t.action('c1', { seq: ++seq, action: { type: 'bury', cards: v.players[2].hand.map(c => c.id).slice(0, 2) } });
      continue;
    }
    if (v.phase === 'play' && v.turn === 2) {
      const legal = G.legalPlays(v, 2);
      check(legal.length > 0, `${label}: no legal play on our turn`);
      if (legal.length) t.action('c1', { seq: ++seq, action: { type: 'play', card: legal[0].id } });
      continue;
    }
    t.tick(20);
  }

  check(handsDone >= 2, `${label}: only finished ${handsDone} hands`);

  const truth = t.room.peek();
  check(truth.history.length >= 2, `${label}: the room did not record the hands`);
  check(truth.history.every(h => !h.problems || !h.problems.length),
    `${label}: a hand played across evictions failed its own audit`);

  /* Never a card we may not know, across every view we were ever sent. */
  const seatCards = new Set();
  (t.inbox['c1'] || []).forEach(m => {
    if (!m.view) return;
    m.view.players.forEach((p, i) => {
      if (i === 2) return;
      p.hand.forEach(c => { if (c && c.id) seatCards.add(c.id); });
    });
  });
  check(seatCards.size === 0, `${label}: another seat's cards were delivered: ${[...seatCards]}`);
}

/* ---------------- 2. Version never goes backwards across eviction ---------------- */

/* The silent killer. If version restarts, a client holding a higher number
 * discards everything that follows as stale — the board freezes with no error
 * anywhere, which is indistinguishable from the game having stopped. */
{
  const t = makeTable(4, 0);
  t.start();
  t.join('c1', 1, 'Kelly');

  const versions = [];
  const record = () => { const m = t.latestView('c1'); if (m) versions.push(m.version); };
  record();

  for (let i = 0; i < 12; i++) {
    t.tick(20);
    t.evict();          // evicted between every bot move
    record();
  }

  check(versions.length > 2, 'not enough views to judge the version sequence');
  const wentBack = versions.some((v, i) => i > 0 && v < versions[i - 1]);
  check(!wentBack,
    'the version went BACKWARDS across an eviction — every client would discard ' +
    'the rest of the game as stale and the board would freeze: ' + versions.join(','));
  check(t.room.peekRoom().version >= versions[versions.length - 1],
    'the stored version is behind what has already been sent');
}

/* ---------------- 3. Events are not replayed after a wake ---------------- */

{
  const t = makeTable(4, 0);
  t.start();
  t.join('c1', 1, 'Kelly');

  const heard = [];
  const collect = () => {
    (t.inbox['c1'] || []).forEach(m => (m.events || []).forEach(e => heard.push(e.text)));
    t.inbox['c1'] = [];
  };
  collect();

  for (let i = 0; i < 15; i++) { t.tick(20); t.evict(); }
  collect();

  const starts = heard.filter(x => /^Hand \d+\./.test(x));
  check(starts.length <= 1,
    'the hand-start announcement was delivered ' + starts.length + ' times — the event cursor ' +
    'did not survive eviction, so a screen reader would recite the whole hand again');

  const dupes = heard.filter((x, i) => heard.indexOf(x) !== i);
  check(dupes.length === 0, 'events were replayed after a wake: ' + dupes.slice(0, 3).join(' | '));
}

/* ---------------- 4. A retried frame does not play twice, across eviction ------- */

{
  const t = makeTable(5, 0);
  t.start();
  t.join('c1', 0, 'Kelly');

  /* Drive to a turn we can actually take, then retry the SAME frame across two
   * evictions.
   *
   * The first version of this waited for the pick phase, ran out of guard
   * iterations while the bots picked, and then sent a `pass` during the play
   * phase — which the engine refuses on its own. It was measuring a rejection and
   * reporting it as a missing idempotency guard. Whatever move is legal now is
   * the one to retry. */
  let guard = 0, mv = null;
  while (guard++ < 800) {
    const m = t.latestView('c1');
    if (m && m.view.turn === 0 && (m.view.phase === 'pick' || m.view.phase === 'play')) { mv = m.view; break; }
    if (!t.tick(20)) t.tick(20);
  }
  check(mv !== null, 'never reached a turn we could take');

  if (mv) {
    const isPlay = mv.phase === 'play';
    const legal = isPlay ? G.legalPlays(mv, 0) : [];
    if (isPlay) check(legal.length > 0, 'no legal play on our turn');

    const frame = isPlay
      ? { seq: 7, action: { type: 'play', card: legal[0].id } }
      : { seq: 7, action: { type: 'pass' } };
    const count = () => isPlay
      ? t.room.peek().played.length
      : t.room.peek().pickLog.filter(e => e.player === 0).length;

    const before = count();
    t.action('c1', frame);
    t.inbox['c1'] = [];                          // watch only what the RETRIES produce
    t.evict();                                   // the object dies between the two
    t.action('c1', frame);
    t.evict();
    t.action('c1', frame);

    const applied = count() - before;
    check(applied === 1,
      `a frame retried across evictions was applied ${applied} times — lastSeq did not survive`);

    /* Counting applications cannot see the guard, and this is the second time
     * that has caught me out: the ENGINE refuses the replay too, because the card
     * is already played or the turn has moved on. So the count is 1 either way.
     *
     * What distinguishes them is who refused. With lastSeq intact the room
     * recognises the sequence number and re-sends the answer it already gave.
     * Without it the frame reaches the engine, which refuses it as an illegal
     * move — and the player is told off twice for a message they sent once,
     * after a reconnect that was not their fault. */
    const refusals = (t.inbox['c1'] || []).filter(m => m.type === 'rejected');
    check(refusals.length === 0,
      `a retried frame was passed to the engine and refused ${refusals.length} times — ` +
      'lastSeq did not survive eviction, so a reconnect makes the player look like a cheat');
  }
}

/* ---------------- 5. Bots keep playing across eviction ---------------- */

/* A hibernated object has no timers. If the bot's move is a setTimeout rather
 * than an alarm, it evaporates on eviction and the table stops mid-hand with
 * nothing to restart it and no error anywhere. */
{
  const t = makeTable(5, 0);
  t.start();
  t.join('c1', 0, 'Kelly');

  const handNo = t.room.peek().handNumber;
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    t.evict();                                 // die before every alarm
    if (t.tick(20)) moved++;
  }
  check(moved > 3,
    'the bots stopped moving across evictions — only ' + moved + ' alarms fired, so a table ' +
    'with an empty seat would simply stop mid-hand');
  check(t.room.peek().handNumber === handNo, 'the hand restarted unexpectedly');
}

/* ---------------- 5b. A reconnected player can actually move ---------------- */

/* The seat unlocking is not the same as the player being able to play, and only
 * the first was ever tested.
 *
 * A client numbers its moves from one again on every connection; the room keeps
 * the highest sequence it has seen, in durable storage. So somebody who closed
 * their tab after a dozen moves and came back had their next dozen keypresses
 * treated as duplicates — the room echoed a view each time, which cleared the
 * client's pending flag, so there was no timeout, no refusal and no message. The
 * card simply did not move, over and over. */
{
  const t = makeTable(5, 0);
  t.start();
  t.join('first', 0, 'Kelly');

  // Make some moves, so the room's idea of "the highest sequence seen" is high.
  let seq = 0, guard = 0, moved = 0;
  while (guard++ < 600 && moved < 3) {
    const m = t.latestView('first');
    if (m && m.view.turn === 0 && m.view.phase === 'pick') {
      t.action('first', { seq: ++seq, action: { type: 'pick' } }); moved++;
    } else if (m && m.view.phase === 'bury' && m.view.picker === 0) {
      t.action('first', { seq: ++seq, action: { type: 'bury', cards: m.view.players[0].hand.map(c => c.id).slice(0, 2) } });
      moved++;
    } else if (m && m.view.turn === 0 && m.view.phase === 'play') {
      const legal = G.legalPlays(m.view, 0);
      if (legal.length) { t.action('first', { seq: ++seq, action: { type: 'play', card: legal[0].id } }); moved++; }
    } else if (!t.tick(20)) t.tick(20);
  }
  check(moved >= 1, 'never made a move before disconnecting');
  check(seq >= 1, 'no sequence numbers were used');

  // The tab closes, and the same person comes back to the same seat.
  t.room.leave('first');
  t.live.length = 0;
  const back = t.join('second', 0, 'Kelly');
  check(back.ok, 'could not rejoin the seat just vacated');

  // The returning client starts numbering at 1 again, as table.js does.
  let acted = false;
  for (let i = 0; i < 600 && !acted; i++) {
    const m = t.latestView('second');
    if (m && m.view.turn === 0 && (m.view.phase === 'pick' || m.view.phase === 'play')) {
      const before = JSON.stringify(t.room.peek().pickLog) + t.room.peek().played.length;
      if (m.view.phase === 'pick') t.action('second', { seq: 1, action: { type: 'pass' } });
      else {
        const legal = G.legalPlays(m.view, 0);
        if (legal.length) t.action('second', { seq: 1, action: { type: 'play', card: legal[0].id } });
      }
      const after = JSON.stringify(t.room.peek().pickLog) + t.room.peek().played.length;
      acted = after !== before;
      if (!acted) break;
    } else if (!t.tick(20)) t.tick(20);
  }
  check(acted,
    "a reconnected player could not move: the room still held the old connection's highest " +
    'sequence number, so every fresh keypress was treated as a duplicate and silently swallowed');
}

/* ---------------- 5c. A player who vanishes must not stall the table ---------- */

/* The failure every test so far was blind to, because every test disconnects
 * cleanly.
 *
 * A seat only becomes 'away' when its socket closes properly. A laptop that
 * sleeps, a phone that loses signal, a browser killed outright: the seat stays
 * 'human', no bot will ever play it, and the table stops for everybody with no
 * message at all. Each other player's move timeout says "the table has not
 * answered" once, and then silence. */
{
  const t = makeTable(5, 0, { turnGrace: 500 });
  t.start();
  t.join('ghost', 0, 'Ghost');       // sits down, and is never heard from again
  t.join('live', 1, 'Kelly');

  // Wind on until it is the vanished player's turn.
  let guard = 0;
  while (guard++ < 800) {
    const truth = t.room.peek();
    const onTurn = truth.phase === 'bury' ? truth.picker : truth.turn;
    if (onTurn === 0 && truth.phase !== 'handOver') break;
    if (!t.tick(50)) t.tick(50);
  }
  const stuckAt = t.room.peek();
  const onTurn = stuckAt.phase === 'bury' ? stuckAt.picker : stuckAt.turn;
  check(onTurn === 0, "never reached the vanished player's turn");

  const before = JSON.stringify({ phase: stuckAt.phase, turn: stuckAt.turn, picker: stuckAt.picker });

  // Time passes. Nobody says anything. The table must recover on its own.
  for (let i = 0; i < 60; i++) t.tick(100);

  const after = JSON.stringify({
    phase: t.room.peek().phase, turn: t.room.peek().turn, picker: t.room.peek().picker
  });
  check(before !== after,
    'the table stalled permanently on a player who vanished without closing their connection — ' +
    'no turn clock, so nobody would ever have been told why the game stopped');

  check(t.room.peek().players[0].occupant === 'away',
    'the vanished seat was never marked away, so the computer will not play it');

  // And the other player was TOLD, rather than left wondering.
  const heard = (t.inbox['live'] || []).flatMap(m => (m.events || []).map(e => e.text)).join(' | ');
  check(/stopped responding/i.test(heard),
    'nobody at the table was told why a seat went quiet: "' + heard + '"');

  // Coming back takes the seat again, and that is announced too.
  t.live.length = 0;
  const back = t.join('ghost2', 0, 'Ghost');
  check(back.ok, 'the vanished player could not take their seat back');
  const heard2 = (t.inbox['live'] || []).flatMap(m => (m.events || []).map(e => e.text)).join(' | ');
  check(/is back/i.test(heard2), 'nobody was told the player had returned');
}

/* ---------------- 6. Seats, and the seat coming from the connection ------------- */

{
  const t = makeTable(5, 0);
  t.start();

  check(t.join('a', 9, 'X').ok === false, 'a seat that does not exist was allowed');
  check(t.join('a', -1, 'X').ok === false, 'a negative seat was allowed');
  check(t.join('a', 1.5, 'X').ok === false, 'a fractional seat was allowed');
  check(t.join('a', 2, 'Kelly').ok === true, 'a free seat was refused');
  check(t.join('b', 2, 'Someone').ok === false, 'two clients were allowed into one seat');
  check(t.join('b', 3, 'Ruth').ok === true, 'a second player could not sit down');

  t.evict();                                   // seats must survive the wake
  check(t.room.peek().players[2].name === 'Kelly', 'a seated player lost their name on eviction');

  // Acting as somebody else, by every shape a client could try.
  const truth = t.room.peek();
  const snapshot = () => JSON.stringify({
    phase: truth.phase, turn: truth.turn, picker: truth.picker,
    hands: truth.players.map(p => C.ids(p.hand))
  });
  const before = snapshot();
  const victim = truth.turn === 2 ? 3 : truth.turn;
  if (victim !== 2 && victim !== 3) {
    t.action('a', { seq: 1, seat: victim, action: { type: 'pick' } });
    t.action('a', { seq: 2, action: { type: 'pick', seat: victim } });
    check(before === snapshot(),
      'a client acted as another seat by naming it in the message');
  }

  // A connection that has left cannot act at all.
  t.room.leave('a');
  const afterLeave = snapshot();
  t.action('a', { seq: 3, action: { type: 'pick' } });
  check(afterLeave === snapshot(), 'a connection that had left could still make a move');
}

/* ---------------- report ---------------- */

if (fails.length) {
  console.error('\nFAILED:');
  [...new Set(fails)].forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('complete hands played with the room evicted before every single message');
console.log('version never went backwards; events not replayed; retries applied once');
console.log('bots kept playing on alarms across eviction; seats survived the wake');

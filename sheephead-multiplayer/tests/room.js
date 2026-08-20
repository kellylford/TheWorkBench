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
      botDelay: (opts && opts.botDelay !== undefined) ? opts.botDelay : 10,
      turnGrace: (opts && opts.turnGrace) || 0,
      awayGrace: (opts && opts.awayGrace) || 0,
      presenceWindow: (opts && opts.presenceWindow !== undefined) ? opts.presenceWindow : 60000
    });
  }

  room = build();

  /* Evict and rebuild. Everything in memory is lost; only storage survives, and
   * the platform hands back the live sockets with whatever was attached to them. */
  function evict() {
    room.hibernate();
    room = build();
    room.wake(live.map(c => ({ id: c.id, seat: c.seat, seenAt: c.seenAt })));
  }

  function maybeEvict() {
    ops++;
    if (evictEvery && ops % evictEvery === 0) evict();
  }

  return {
    storage, inbox, live,
    get room() { return room; },
    evict,
    now() { return clock; },
    get alarmAt() { return alarmAt; },
    /* The keepalive, modelled the way the Worker actually carries it: the client
     * pings, the wrapper stamps the SOCKET, and the room only ever learns of it
     * when it next wakes and is handed the sockets back. There is no other
     * channel — a room that is asleep cannot be told anything. */
    ping(id) {
      const c = live.find(x => x.id === id);
      if (c) c.seenAt = clock;
      evict();
    },
    tick(ms) {
      clock += ms;
      if (alarmAt && clock >= alarmAt) { alarmAt = 0; room.onAlarm(); maybeEvict(); return true; }
      return false;
    },
    join(id, seat, name) {
      const r = room.join(id, seat, name);
      if (r.ok) live.push({ id, seat: r.seat, seenAt: clock });
      maybeEvict();
      return r;
    },
    action(id, msg) { room.action(id, msg); maybeEvict(); },
    /* Somebody at the table says to begin. A room no longer deals when it is
     * created — the host needs time to read the code to people first — so every
     * test that wants a hand has to ask for one, exactly as a player does. */
    begin(id) {
      /* Sequence 0, not 1000. The room ignores any sequence it has already seen,
       * so beginning at a high number made every later move look like a duplicate
       * and the table appeared to stop responding — the idempotency guard doing
       * its job to a test that had not thought about it. */
      room.action(id, { seq: 0, action: { type: 'start' } });
      maybeEvict();
    },
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
  t.begin('c1');

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
  t.begin('c1');

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
  t.begin('c1');

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
  t.begin('c1');

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
  t.begin('c1');

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
  t.begin('first');

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
  t.begin('live');

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

/* ---------------- 5d. A move must not wait out the turn clock ----------------- */

/* The bug this exists to catch, reported from a real table as "sometimes there
 * is a thirty second lag before the computer takes a turn".
 *
 * One field, room.botDue, carried two different deadlines: when the next bot
 * moves, and when the turn clock gives up on somebody. Nothing recorded which
 * one it was holding, so as soon as a player moved and handed off to a computer
 * seat, scheduleBots read the turn clock's deadline as "a bot move is already
 * scheduled" and armed nothing. The next play came when the TURN CLOCK expired
 * instead — up to the whole grace period later, every single time.
 *
 * Against the shipped numbers (1200ms bot delay, 90 second grace) that measured
 * 88 seconds per hand-off. From the player's side it is a table that has died.
 *
 * Asserted on the SCHEDULED TIME rather than on the game advancing, because a
 * test that winds the clock forward until something happens cannot tell a
 * prompt reply from a late one — which is exactly how this survived. */
{
  const BOT = 40, GRACE = 9000;
  const t = makeTable(5, 0, { botDelay: BOT, turnGrace: GRACE, awayGrace: 0 });
  t.start();
  check(t.join('me', 0, 'Kelly').ok, 'could not sit down');
  t.begin('me');

  const mine = () => {
    const s = t.room.peek();
    if (s.phase === 'bury') return s.picker === 0;
    if (s.phase === 'pick' || s.phase === 'play') return s.turn === 0;
    return false;
  };

  let seq = 0, guard = 0, handOffs = [], worst = 0;
  while (guard++ < 900 && handOffs.length < 6) {
    const s = t.room.peek();
    if (s.phase === 'handOver') break;
    if (mine()) {
      const v = t.latestView('me').view;
      t.tick(1000);                       // a perfectly ordinary pause
      if (t.room.peek().phase === 'handOver' || !mine()) continue;
      if (v.phase === 'pick') t.action('me', { seq: ++seq, action: { type: 'pick' } });
      else if (v.phase === 'bury') {
        t.action('me', { seq: ++seq, action: { type: 'bury', cards: v.players[0].hand.slice(0, 2).map(c => c.id) } });
      } else {
        const legal = G.legalPlays(v, 0);
        if (!legal.length) break;
        t.action('me', { seq: ++seq, action: { type: 'play', card: legal[0].id } });
      }
      // Handed off to a computer seat? Then a bot move is owed, promptly.
      if (!mine() && t.room.peek().phase !== 'handOver') {
        const wait = t.alarmAt - t.now();
        handOffs.push(wait);
        if (wait > worst) worst = wait;
      }
      continue;
    }
    if (!t.alarmAt) { check(false, 'the table stalled with no alarm armed'); break; }
    t.tick(Math.max(1, t.alarmAt - t.now()));
  }

  check(handOffs.length >= 3, 'never got far enough to hand off to a computer seat');
  check(worst <= BOT,
    'after the player moved, the next computer play was scheduled ' + worst +
    'ms away instead of ' + BOT + 'ms: the turn clock deadline was mistaken for the bot one. ' +
    'Waits seen: ' + handOffs.join(', '));
}

/* ---------------- 5e. A player who is there must keep their own cards --------- */

/* The other half of the same report: "if you set the game to be instant, it
 * takes not only the computer turns but also yours."
 *
 * The turn clock could not tell a player who was thinking from a browser that
 * had gone away, because from the room both look identical: no action. Ninety
 * seconds is an ordinary amount of time to spend on a bury when the hand has to
 * be read aloud first, so ordinary players hit it — and once the seat went
 * 'away' the computer played every remaining turn while they sat there watching
 * their own hand go down.
 *
 * A client that is still pinging is still there. */
{
  const GRACE = 1000, AWAY = 60000;
  const t = makeTable(5, 0, { turnGrace: GRACE, awayGrace: AWAY, presenceWindow: 3000 });
  t.start();
  check(t.join('me', 0, 'Kelly').ok, 'could not sit down');
  t.join('other', 1, 'Pat');
  t.begin('me');

  const onTurn = () => {
    const s = t.room.peek();
    return s.phase === 'handOver' ? -1 : (s.phase === 'bury' ? s.picker : s.turn);
  };

  let guard = 0;
  while (guard++ < 900 && onTurn() !== 0) {
    if (!t.alarmAt) break;
    t.tick(Math.max(1, t.alarmAt - t.now()));
  }
  check(onTurn() === 0, 'never reached the player own turn');

  const held = C.ids(t.room.peek().players[0].hand).join(',');

  // Twenty seconds of thinking, with the browser pinging away as it does.
  for (let i = 0; i < 10; i++) {
    t.tick(2000);
    t.ping('me');
  }

  check(t.room.peek().players[0].occupant === 'human',
    'a player whose browser was still pinging every two seconds was declared away after ' +
    '20 seconds of thinking, against a grace period of ' + AWAY + 'ms');
  check(C.ids(t.room.peek().players[0].hand).join(',') === held,
    'the computer played cards out of a present player hand while they were deciding');
  check(onTurn() === 0, 'the player turn was taken while they were still there');

  /* And a seat whose browser really does stop answering is still taken over —
   * that guarantee is not being traded away for this one. */
  let g2 = 0;
  while (g2++ < 400 && t.room.peek().players[0].occupant === 'human') {
    if (!t.alarmAt) break;
    t.tick(Math.max(1, t.alarmAt - t.now()));
  }
  check(t.room.peek().players[0].occupant === 'away',
    'a seat whose client stopped pinging was never taken over, so the table stalls for everybody');
}

/* ---------------- 5f. Making a move takes the seat back ---------------------- */

/* 'away' was cleared by join() and nothing else, which means only by opening a
 * NEW connection. The player whose client never dropped has no way to do that
 * and no reason to think they should: the board is still drawing itself, the
 * cards are still there, and the only thing wrong is that nothing they press
 * does anything, ever again. */
{
  const t = makeTable(5, 0, { turnGrace: 500 });
  t.start();
  check(t.join('me', 0, 'Kelly').ok, 'could not sit down');
  t.join('other', 1, 'Pat');
  t.begin('me');

  const onTurn = () => {
    const s = t.room.peek();
    return s.phase === 'handOver' ? -1 : (s.phase === 'bury' ? s.picker : s.turn);
  };

  let guard = 0;
  while (guard++ < 900 && onTurn() !== 0) {
    if (!t.alarmAt) break;
    t.tick(Math.max(1, t.alarmAt - t.now()));
  }
  check(onTurn() === 0, 'never reached the player own turn');

  // Say nothing for long enough to be counted out.
  let g2 = 0;
  while (g2++ < 400 && t.room.peek().players[0].occupant === 'human') {
    if (!t.alarmAt) break;
    t.tick(Math.max(1, t.alarmAt - t.now()));
  }
  check(t.room.peek().players[0].occupant === 'away', 'the idle seat was never counted out');

  // The same connection, still open, makes a move. Whatever the move is, the
  // player is plainly at the table.
  t.action('me', { seq: 500, action: { type: 'play', card: 'JD' } });
  check(t.room.peek().players[0].occupant === 'human',
    'a player at a live connection could not get their own seat back by playing: ' +
    'the computer keeps their chair for the rest of the session');

  const heard = (t.inbox['other'] || []).flatMap(m => (m.events || []).map(e => e.text)).join(' | ');
  check(/is back/i.test(heard),
    'the rest of the table was told the seat had gone and never told it was back');
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
console.log('a computer seat moves after the bot delay, not when the turn clock expires');
console.log('a player whose browser is still pinging keeps their own turn, and a move takes an away seat back');

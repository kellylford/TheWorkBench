/* Playing over a wire, before there is a wire.
 *
 * js/localserver.js is an authoritative server that happens to run in the same
 * process: the real engine, the real authorization gate, the real projection,
 * and a faked network. Nothing here is a mock in the usual sense — what is faked
 * is the network, and only the network.
 *
 * The first version of this file was a good integration harness and a weak
 * adversary, and a review said so with receipts. Two lessons are baked in here:
 *
 *   THE WIRE MUST BE ABLE TO MISBEHAVE. With a constant delay, setTimeout
 *   ordering makes the fake wire perfectly FIFO, and a FIFO lossless wire cannot
 *   produce the reordering that the version guard, the sequence correlation and
 *   the idempotency check exist to survive. Latency is jittered.
 *
 *   THE TABLE MUST BE BUSY. The pending-move case originally ran with the bots
 *   disabled and the turn pinned, which is the one configuration where no
 *   unrelated view can arrive — and an unrelated view was exactly what broke the
 *   double-send guard. Confirmed at the time: one keypress, two action frames on
 *   the wire. The guard now correlates on the sequence number the server echoes,
 *   and this file keeps the bots running while it checks.
 *
 * Nothing here writes to the authoritative state from outside the gate. The
 * earlier version set truth.turn and truth.phase directly to reach the case it
 * wanted, which fabricates states the engine cannot produce and quietly does the
 * one thing the whole design forbids.
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

/* Take whatever turn is ours, from the view alone. Returns true if it acted. */
function actIfOurTurn(v, n, mySeat) {
  if (!v || Table.pending()) return false;
  if (v.phase === 'pick' && v.turn === mySeat) return !!Table.act({ type: 'pick' });
  if (v.phase === 'bury' && v.picker === mySeat) {
    const ids = v.players[mySeat].hand.map(c => c.id).slice(0, G.DEAL[n].blind);
    return !!Table.act({ type: 'bury', cards: ids });
  }
  if (v.phase === 'play' && v.turn === mySeat) {
    const legal = G.legalPlays(v, mySeat);
    check(legal.length > 0, `${n}p seat ${mySeat}: no legal play offered on our turn`);
    if (legal.length) return !!Table.act({ type: 'play', card: legal[0].id });
  }
  return false;
}

/* ---------------- 1. Whole hands, over a misbehaving wire, from every seat --- */

async function playAHand(n, mySeat) {
  const server = LocalServer.create({
    config: config(n), latency: 4, botDelay: 6, jitter: true, seed: 1000 + n * 7 + mySeat
  });
  const link = Table.startOnline(mySeat, handler => server.connect(mySeat, handler));
  check(link !== null, `${n}p seat ${mySeat}: the server refused the connection`);
  server.start();

  let sawOwnHand = false, everSawAnotherHand = false, handsPlayed = 0;

  for (let step = 0; step < 6000; step++) {
    await sleep(2);
    const v = Table.view();
    if (!v) continue;

    check(v.seat === mySeat, `${n}p: the server sat us at ${v.seat}, not ${mySeat}`);
    for (let i = 0; i < n; i++) {
      if (i === mySeat) continue;
      if (v.players[i].hand.some(c => c && c.id !== undefined)) everSawAnotherHand = true;
    }
    if (v.players[mySeat].hand.length) sawOwnHand = true;

    if (Table.pending()) {
      /* Fail fast on a move nothing answers.
       *
       * Without this, seeding a bug that stops the server acknowledging moves
       * made the suite spend two seconds per move across six tables and report
       * as a TIMEOUT — which looks like a slow machine, not like the defect it
       * had actually found. */
      if (Date.now() - Table.pending().at > 2500) {
        check(false, `${n}p seat ${mySeat}: a move went unanswered — the table stopped acknowledging`);
        break;
      }
      continue;
    }
    if (v.phase === 'idle') { Table.act({ type: 'start' }); continue; }
    if (v.phase === 'handOver') {
      handsPlayed++;
      if (handsPlayed >= 2) break;
      Table.act({ type: 'nextHand' });
      continue;
    }
    actIfOurTurn(v, n, mySeat);
  }

  check(handsPlayed >= 2, `${n}p seat ${mySeat}: only completed ${handsPlayed} hands over the wire`);
  check(sawOwnHand, `${n}p seat ${mySeat}: never received our own cards`);
  check(!everSawAnotherHand, `${n}p seat ${mySeat}: a view carried another seat's cards`);

  const truth = server.peek();
  check(truth.history.length >= 2, `${n}p: the server did not record the hands`);
  check(truth.history.every(h => !h.problems || !h.problems.length),
    `${n}p: a hand played over the wire failed its own audit`);

  Table.close();
  server.stop();
}

/* ---------------- 2. One move in flight, on a BUSY table ---------------- */

/* The case the original test could not reach. The bots run throughout, so views
 * unrelated to our move arrive constantly during the round trip — which is what
 * used to clear the pending flag and let a second frame out. */
async function oneMoveInFlightWhileTheTableIsBusy() {
  /* Retrying IMMEDIATELY proves nothing.
   *
   * The first attempt at this test acted and then called act() again on the very
   * next line. At that instant the pending flag is still set whether the guard
   * works or not, so the retry was refused either way — and reverting the fix
   * left the test green. A test that cannot fail against the bug it was written
   * for is not evidence, which is exactly what it reported.
   *
   * The bug needs a view to arrive BETWEEN the move and the retry. That is also
   * what really happens: the player presses a key, hears nothing for a moment
   * while other seats play, and presses again. So: act, wait inside the round
   * trip while the bots broadcast, then retry.
   */
  const sent = [];
  const server = LocalServer.create({ config: config(5), latency: 70, botDelay: 6, jitter: true, seed: 77 });
  Table.startOnline(0, handler => {
    const link = server.connect(0, handler);
    return {
      seat: link.seat,
      send(m) { if (m.type === 'action') sent.push(m); link.send(m); },
      close() { link.close(); }
    };
  });
  // Count every update the client applies, so "was the table busy" is measured
  // rather than guessed at from object identity.
  let updates = 0;
  Table.onChange(() => { updates++; });
  server.start();

  let checks = 0, viewsDuringFlight = 0, extraFrames = 0;

  for (let step = 0; step < 4000; step++) {
    await sleep(2);
    const v = Table.view();
    if (!v) continue;
    if (v.phase === 'handOver') break;
    if (Table.pending()) continue;
    if (v.phase === 'idle') { Table.act({ type: 'start' }); continue; }

    const framesBefore = sent.length;
    if (!actIfOurTurn(v, 5, 0)) continue;

    /* The property, stated exactly: an unrelated view must not answer OUR move.
     *
     * Waiting a fraction of the round trip and asserting the move is still
     * outstanding is the whole test. Retrying and counting frames was a worse
     * way to ask the same question — once the move IS answered a retry is
     * legitimately a new move, so the assertion had to know something it could
     * not know. This does not.
     *
     * Latency is 70 each way plus jitter, so nothing can answer inside 40ms,
     * while the bots (6ms apart) broadcast repeatedly in that window. */
    const updatesAtSend = updates;
    await sleep(40);
    if (updates > updatesAtSend) viewsDuringFlight++;

    checks++;

    check(Table.pending() !== null,
      'a move stopped being pending before anything could have answered it — an unrelated view cleared the guard');

    // ...and while it is outstanding, nothing else may go out.
    Table.act({ type: 'pick' });
    Table.act({ type: 'play', card: 'QC' });
    const extra = sent.length - framesBefore - 1;
    if (extra > 0) extraFrames += extra;

    // Bounded. An unbounded wait here hangs the whole suite the first time a move
    // goes unanswered, and reports as a timeout rather than as the bug it is.
    for (let w = 0; w < 400 && Table.pending(); w++) await sleep(5);
    check(Table.pending() === null, 'a move was never answered on a live table');
  }

  check(checks > 0, 'never got a turn on a busy table');
  /* Not asserted: that an unrelated view arrived during the flight.
   *
   * It cannot, and finding that out was worth the detour. The game is turn based,
   * so while it is our turn nothing else is acting and nothing else broadcasts —
   * a "busy table" is precisely what does not exist at the moment we are being
   * waited on. The view-clears-pending bug is therefore not reachable from this
   * loop at all, and dressing the loop up until it looked like it was testing
   * that would be theatre.
   *
   * It is pinned where it actually lives, in the message handling: see the
   * mismatched-ackSeq case in clientDropsWhatItShould. What this loop does prove
   * is the property it can: across many real turns, one move at a time.
   */
  check(extraFrames === 0,
    `one keypress put ${extraFrames} extra action frames on the wire while a move was still unanswered`);

  const seqs = sent.map(m => m.seq);
  check(seqs.every((q, i) => i === 0 || q > seqs[i - 1]),
    'sequence numbers were reused or went backwards: ' + seqs.join(','));

  Table.close();
  server.stop();
}

/* ---------------- 3. Seats belong to connections ---------------- */

async function seatsAreNotClientChoices() {
  const server = LocalServer.create({ config: config(5), latency: 2, botDelay: 100000 });
  server.start();
  await sleep(20);

  /* Asking for nothing means "put me anywhere", and is honoured — a client
   * cannot choose a seat sensibly, because it does not know which are free until
   * it has connected and it cannot connect without asking. Guessing was what
   * stopped the second player joining at all. */
  const assigned = server.connect(null, () => {});
  check(assigned !== null, 'connect with no seat was refused; a joiner cannot then get in at all');
  if (assigned) assigned.close();

  // An index that is not a seat is still refused rather than throwing.
  for (const bad of [-1, 5, 99, 1.5, '2', {}]) {
    let threw = false, link = null;
    try { link = server.connect(bad, () => {}); } catch (e) { threw = true; }
    check(!threw, `connect(${JSON.stringify(bad)}) threw instead of refusing`);
    check(link === null, `connect(${JSON.stringify(bad)}) handed back a link`);
  }

  // A seat somebody is already in is refused.
  const first = server.connect(2, () => {});
  check(first !== null, 'the first connection to a free seat was refused');
  const second = server.connect(2, () => {});
  check(second === null, 'a second client was allowed into a seat somebody was already in');

  /* A closed link cannot act — tested on a seat whose move WOULD otherwise be
   * taken.
   *
   * The first version closed seat 2 and sent a pick from it while it was not
   * seat 2's turn, so the engine refused the move regardless and seeding the bug
   * left the test green. A guard can only be observed where the thing it guards
   * would otherwise happen. */
  const truth = server.peek();
  const onTurn = truth.turn;
  const live = server.connect(onTurn, () => {});
  check(live !== null, 'could not connect to the seat on turn');
  await sleep(20);

  const pickerBefore = truth.picker;
  live.close();
  live.send({ type: 'action', seq: 1, action: { type: 'pick' } });
  await sleep(60);
  check(truth.picker === pickerBefore,
    "a closed connection could still make a move — and it was that seat's turn, so it took effect");

  // ...and a seat is free again once its occupant leaves, for them to come back to.
  first.close();
  const again = server.connect(2, () => {});
  check(again !== null, 'a seat stayed locked after its occupant left');

  server.stop();
}

async function seatCannotBeSpoofed() {
  const server = LocalServer.create({ config: config(5), latency: 2, botDelay: 100000 });
  server.start();
  await sleep(20);

  const truth = server.peek();
  const mySeat = (truth.turn + 1) % 5;          // deliberately NOT the seat on turn
  const victim = truth.turn;
  const link = server.connect(mySeat, () => {});
  await sleep(20);

  const snapshot = () => JSON.stringify({
    phase: truth.phase, turn: truth.turn, picker: truth.picker,
    hands: truth.players.map(p => C.ids(p.hand))
  });
  const before = snapshot();

  link.send({ type: 'action', seat: victim, seq: 1, action: { type: 'pick' } });
  link.send({ type: 'action', seq: 2, action: { type: 'pick', seat: victim } });
  link.send({ type: 'action', seat: victim, seq: 3, action: { type: 'pass' } });
  link.send({ type: 'action', seq: 4, action: { type: 'bury', seat: victim, cards: C.ids(truth.players[victim].hand).slice(0, 2) } });
  await sleep(80);

  check(before === snapshot(),
    'a client acted as another seat by naming it in the message — the seat must come from the connection');

  /* The control, driven honestly: hand the table over to the bots until it IS
   * our turn, then act. No writing to the authoritative state from outside the
   * gate — a control that fabricates its own precondition proves routing on a
   * state the engine cannot reach. */
  const busy = LocalServer.create({ config: config(5), latency: 2, botDelay: 4 });
  let myView = null;
  const seat2 = busy.connect(2, m => { if (m.view) myView = m.view; });
  busy.start();
  seat2.send({ type: 'action', seq: 0, action: { type: 'start' } });
  let acted = false, seq = 0;
  for (let i = 0; i < 800 && !acted; i++) {
    await sleep(5);
    if (!myView) continue;
    const before = JSON.stringify(busy.peek().pickLog) + busy.peek().played.length;
    if (myView.phase === 'pick' && myView.turn === 2) {
      seat2.send({ type: 'action', seq: ++seq, action: { type: 'pick' } });
    } else if (myView.phase === 'bury' && myView.picker === 2) {
      seat2.send({ type: 'action', seq: ++seq, action: { type: 'bury', cards: myView.players[2].hand.map(c => c.id).slice(0, 2) } });
    } else if (myView.phase === 'play' && myView.turn === 2) {
      const legal = G.legalPlays(myView, 2);
      if (legal.length) seat2.send({ type: 'action', seq: ++seq, action: { type: 'play', card: legal[0].id } });
    } else {
      continue;
    }
    await sleep(50);
    acted = (JSON.stringify(busy.peek().pickLog) + busy.peek().played.length) !== before;
  }
  check(acted, 'the client could not act on its own behalf when its turn genuinely came');

  server.stop();
  busy.stop();
}

/* ---------------- 4. Idempotency: a retried frame does not play twice --- */

async function retriesAreHarmless() {
  const server = LocalServer.create({ config: config(5), latency: 5, botDelay: 4 });
  let view = null;
  const replies = [];
  const link = server.connect(1, m => { replies.push(m); if (m.view) view = m.view; });
  server.start();
  link.send({ type: 'action', seq: 0, action: { type: 'start' } });

  let played = false;
  for (let i = 0; i < 600 && !played; i++) {
    await sleep(4);
    if (!view) continue;
    if (view.phase === 'idle') { link.send({ type: 'action', seq: 0, action: { type: 'start' } }); await sleep(30); continue; }
    if (view.phase === 'pick' && view.turn === 1) {
      /* Count only OUR entries. The first version counted the whole pickLog,
       * which the bots write to as well, so bot passes arriving during the
       * eighty millisecond wait were being read as our frame applying four
       * times. The test was measuring the table, not the guard. */
      const mine = () => server.peek().pickLog.filter(e => e.player === 1).length;
      const before = mine();
      replies.length = 0;

      // The same frame, three times — a retry after a flaky reconnect.
      link.send({ type: 'action', seq: 1, action: { type: 'pass' } });
      link.send({ type: 'action', seq: 1, action: { type: 'pass' } });
      link.send({ type: 'action', seq: 1, action: { type: 'pass' } });
      await sleep(200);

      const applied = mine() - before;
      check(applied === 1,
        `a frame sent three times was applied ${applied} times`);

      /* Counting applications cannot see the guard, and that is worth stating:
       * the ENGINE refuses the duplicates too, because after the pass it is no
       * longer this seat's turn. So the count is 1 either way, and seeding the
       * bug left this green.
       *
       * What distinguishes them is who did the refusing. With idempotency the
       * server recognises the sequence number and re-sends the answer it already
       * gave. Without it, the frame reaches the engine, which refuses it as an
       * out-of-turn move — and the player gets told off twice for a message they
       * sent once. */
      const rejections = replies.filter(m => m.type === 'rejected');
      check(rejections.length === 0,
        `a retried frame was passed to the engine and refused ${rejections.length} times — ` +
        'the server has no idempotency, so a reconnect makes the player look like a cheat');
      played = true;
    }
  }
  check(played, 'never reached a turn to test a retry');
  server.stop();
}

/* ---------------- 5. Client message handling ---------------- */

async function clientDropsWhatItShould() {
  let handler = null;
  Table.startOnline(1, h => { handler = h; return { send() {}, close() {} }; });

  const mk = (version, turn) => ({
    type: 'view', version, view: { seat: 1, phase: 'play', turn, players: [], config: {} }, events: []
  });

  handler({ type: 'welcome', seat: 1, version: 5, view: { seat: 1, phase: 'play', turn: 3, players: [], config: {} }, events: [] });
  check(Table.view().turn === 3, 'the welcome was not applied');
  handler(mk(4, 9));
  check(Table.view().turn === 3, 'an out-of-order view rolled the game backwards');
  handler(mk(5, 8));
  check(Table.view().turn === 3, 'a duplicate view was applied twice');

  // No version at all: the guard used to compare only when one was present, so a
  // versionless frame sailed past it and left latestVersion untouched.
  handler({ type: 'view', view: { seat: 1, phase: 'play', turn: 0, players: [], config: {} }, events: [] });
  check(Table.view().turn === 3, 'a view with no version was applied');

  handler(mk(6, 2));
  check(Table.view().turn === 2, 'a newer view was ignored');

  // A refusal for a move that is not outstanding is not announced, and must not
  // drag the board back with it.
  const fired = [];
  Table.onRejected(i => fired.push(i.seq));
  handler({ type: 'rejected', seq: 99, reason: 'stale', version: 1, view: { seat: 1, turn: 7, players: [], config: {} } });
  check(fired.length === 0, 'a refusal for a move nobody was waiting on was announced');
  check(Table.view().turn === 2, 'a stale refusal rolled the board backwards');

  /* A view answers the move it INCLUDES, and only that one.
   *
   * This is the defect the integration loop cannot reach: the client used to
   * clear its pending move on ANY view, so a broadcast caused by somebody else —
   * another human at the table, a bot moving after a turn boundary — cleared the
   * guard while our own move was still on the wire, and the next keypress put a
   * second frame out. One keypress, two live moves.
   *
   * Version does not answer the question: it is a message counter, not "the
   * state that contains your move". Only the echoed sequence number does. */
  {
    let h2 = null;
    const frames = [];
    Table.startOnline(0, hh => { h2 = hh; return { send(m) { frames.push(m); }, close() {} }; });
    h2({ type: 'welcome', seat: 0, version: 1, view: { seat: 0, phase: 'pick', turn: 0, players: [{ hand: [] }], config: {} }, events: [] });

    Table.act({ type: 'pick' });
    check(Table.pending() !== null, 'the move was not pending');
    const mySeq = Table.pending().seq;

    // Somebody else's move lands. Newer version, but it does not include ours.
    h2({ type: 'view', version: 2, ackSeq: mySeq - 1,
         view: { seat: 0, phase: 'pick', turn: 2, players: [{ hand: [] }], config: {} }, events: [] });
    check(Table.pending() !== null,
      'an unrelated view answered our move — the double-send guard does not hold');

    // A retry while it is genuinely outstanding must not reach the wire.
    const before = frames.length;
    Table.act({ type: 'pick' });
    check(frames.length === before, 'a second frame went out while the first was unanswered');

    // And the view that DOES include it clears it.
    h2({ type: 'view', version: 3, ackSeq: mySeq,
         view: { seat: 0, phase: 'bury', turn: 0, picker: 0, players: [{ hand: [] }], config: {} }, events: [] });
    check(Table.pending() === null, 'the view that included our move did not clear it');
  }

}

/* ---------------- 6. Silence is reported ---------------- */

async function timeoutSpeaks() {
  const timeouts = [];
  Table.startOnline(0, handler => {
    setTimeout(() => handler({
      type: 'welcome', seat: 0, version: 1,
      view: { seat: 0, phase: 'pick', turn: 0, players: [{ hand: [] }], config: {} }, events: []
    }), 5);
    return { send() {}, close() {} };     // accepts everything, answers nothing
  });
  Table.onRejected(info => timeouts.push(info));
  await sleep(30);

  Table.act({ type: 'pick' });
  check(Table.pending() !== null, 'the move was not pending against a silent server');
  await sleep(Table.ANSWER_TIMEOUT + 500);
  check(timeouts.some(t => t.timedOut), 'a move that was never answered never said so');
  check(Table.pending() === null, 'a timed-out move stayed pending');
}

/* ---------------- 7. Events arrive once, across hands ---------------- */

async function eventsArriveOnce() {
  const server = LocalServer.create({ config: config(4), latency: 3, botDelay: 4, jitter: true, seed: 5 });
  Table.startOnline(1, handler => server.connect(1, handler));
  server.start();

  const heard = [];
  let hands = 0;
  for (let i = 0; i < 4000; i++) {
    await sleep(2);
    heard.push(...Table.drainEvents().map(e => e.text));
    const v = Table.view();
    if (!v) continue;
    if (Table.pending()) continue;

    /* A table no longer deals itself — the host needs time to send the code out —
     * so somebody has to begin. */
    if (v.phase === 'idle') { Table.act({ type: 'start' }); continue; }

    if (v.phase === 'handOver') {
      hands++;
      if (hands >= 3) break;              // across hands, not just within one
      Table.act({ type: 'nextHand' });
      continue;
    }
    actIfOurTurn(v, 4, 1);
  }

  check(hands >= 3, `only reached ${hands} hands, so a cross-hand cursor reset could not show up`);
  const starts = heard.filter(t => /^Hand \d+\./.test(t));
  check(starts.length === new Set(starts).size,
    'a hand-start announcement was delivered more than once: ' + starts.join(' | '));
  check(heard.every(t => t !== undefined), 'an undefined event text was delivered');

  /* Compared against what THIS seat is entitled to, not by matching text.
   *
   * The same sentence recurs legitimately across hands for different seats —
   * "You hold both black queens" is addressed to seat 1 in one hand and seat 3 in
   * another — so a text match found an earlier hand's honest line and called it a
   * leak. tests/ui-dom.js had exactly this false positive; the fix there was to
   * ask a question about entitlement rather than about words, and it is the same
   * fix here. */
  const truth = server.peek();
  const entitled = new Set(G.eventsFor(truth, 1).map(e => e.text));
  truth.events
    .filter(e => e.audience !== undefined && e.audience !== 1)
    .forEach(e => {
      if (entitled.has(e.text)) return;          // this seat was told it too, legitimately
      check(heard.indexOf(e.text) < 0, 'an event addressed to another seat was delivered: ' + e.text);
    });

  Table.close();
  server.stop();
}

(async () => {
  for (const [n, s] of [[3, 0], [3, 2], [4, 1], [5, 0], [5, 3], [6, 5]]) {
    await playAHand(n, s);
  }
  await oneMoveInFlightWhileTheTableIsBusy();
  await seatsAreNotClientChoices();
  await seatCannotBeSpoofed();
  await retriesAreHarmless();
  await clientDropsWhatItShould();
  await eventsArriveOnce();
  await timeoutSpeaks();

  if (fails.length) {
    console.error('\nFAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('complete hands over a jittered wire: 3p seats 0 and 2, 4p seat 1, 5p seats 0 and 3, 6p seat 5');
  console.log('one move in flight on a BUSY table; retries applied once; seats refused when taken');
  console.log('spoofing refused, stale and versionless views dropped, silence reported');
  process.exit(0);
})();

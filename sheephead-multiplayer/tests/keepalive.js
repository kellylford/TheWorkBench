/* The keepalive, and what a frozen tab does to it.
 *
 * js/net.js had no test of any kind — no test file loaded it at all — which is
 * the real finding here. What went wrong at a live table was that a seat's
 * socket closed, the player was told once into a region that then held nothing,
 * and the board went on showing a hand that had stopped being true. The close
 * came back with no reason code, so WHO hung up is not established: it may have
 * been the platform, the network, or the browser. It is written up here as the
 * open question it is rather than as a diagnosis.
 *
 * What IS established is that this file could not answer the question, because
 * nothing exercised it — and that writing these tests immediately turned up a
 * real ordering bug: the pong deadline was armed after the send, so an answer
 * that arrived during send() cancelled the previous ping's timer and left the
 * fresh one with nothing to cancel it. That would hang up on a socket which had
 * just that moment answered.
 *
 * The mechanism is a browser one, so it needs saying plainly. net.js pings every
 * twenty-five seconds and gives the pong ten seconds to arrive. Chrome throttles
 * timers in a backgrounded tab to roughly once a minute and freezes them
 * outright after a few minutes, so that ten second deadline fires having
 * actually waited a minute or more — and the pong it was waiting for may have
 * been sitting unprocessed the whole time. Nothing about the CONNECTION has been
 * demonstrated; the only thing proved is that the tab was asleep.
 *
 * So the rule under test: a deadline that fires far later than it was set for
 * was frozen, not ignored, and must not be read as evidence the wire is dead.
 *
 *   node tests/keepalive.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* A controllable clock and timer queue, so a frozen tab can be simulated
 * exactly: time passes, and the callbacks run late and all at once. */
function makeWorld() {
  let now = 1000000;                 // not zero; Date.now() never is
  let seq = 0;
  const timers = new Map();          // id -> {at, fn, every}

  const world = {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn, every: 0 }); return id; },
    setInterval(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    clearInterval(id) { timers.delete(id); },

    /* Ordinary time: run whatever falls due, in order. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at = now + t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },

    /* A FROZEN TAB. The clock runs on; nothing is allowed to execute. When the
     * tab wakes, everything overdue fires at once, having waited far longer than
     * it asked to. This is the whole point of the file. */
    freezeThenThaw(ms) {
      now += ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= now && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        if (t.every) t.at = now + t.every; else timers.delete(id);
        t.fn();
      }
    },
    pending() { return timers.size; }
  };
  return world;
}

/* A socket that records what was sent and answers pings, unless told not to. */
function makeSocket(world, opts) {
  const o = opts || {};
  const sock = {
    sent: [],
    closed: null,
    answering: o.answering !== false,
    listeners: {},
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
    send(raw) {
      this.sent.push(JSON.parse(raw));
      const msg = JSON.parse(raw);
      if (msg.type === 'ping' && this.answering) {
        // The pong comes back over the wire, not on a timer: a message event is
        // not a scheduled callback, which is exactly why it can arrive while the
        // deadline that was waiting for it is still frozen.
        this.deliver({ type: 'pong', at: msg.at });
      }
    },
    close(code, reason) { this.closed = { code, reason }; if (this.onclose) this.onclose({ code, reason }); },
    deliver(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
  };
  return sock;
}

function load(world, sock, doc) {
  const sandbox = {
    console, JSON, Math,
    Date: { now: world.now },
    setTimeout: world.setTimeout, clearTimeout: world.clearTimeout,
    setInterval: world.setInterval, clearInterval: world.clearInterval,
    WebSocket: function () { return sock; },
    document: doc
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/net.js'), 'utf8'), sandbox, { filename: 'js/net.js' });
  return sandbox.SH.Net;
}

/* ---------------- 1. A frozen tab must not be read as a dead wire ------------ */
{
  const world = makeWorld();
  const sock = makeSocket(world);
  const states = [];
  const Net = load(world, sock, null);
  const link = Net.connect({ code: 'ABCDE', base: 'http://x' },
    function () {}, function (s) { states.push(s.state); });
  sock.onopen && sock.onopen();

  // Normal running first: pings go out, pongs come back, nobody complains.
  world.advance(120000);
  const normalPings = sock.sent.filter(m => m.type === 'ping').length;
  check(normalPings >= 4, 'the keepalive did not ping on its own: ' + normalPings + ' in two minutes');
  check(!sock.closed, 'the client closed a healthy socket during ordinary running');
  check(states.indexOf('lost') < 0, 'a healthy connection was reported lost: ' + states.join(','));

  /* Now the tab goes behind another window for five minutes. The socket is
   * fine; the browser simply stops running our callbacks. */
  world.freezeThenThaw(300000);

  check(!sock.closed,
    'the client hung up on its own healthy socket after the tab was backgrounded ' +
    'for five minutes (close ' + JSON.stringify(sock.closed) + '). This is the bug ' +
    'that ended a real game: it closes the connection, never reconnects, and ' +
    'leaves the board showing a hand that is no longer true.');
  check(states.indexOf('lost') < 0,
    'the player was told the table was lost because their tab had been in the ' +
    'background, not because anything was wrong: ' + states.join(','));
}

/* ---------------- 1b. The verdict is never delivered on a frozen timer -------- */

/* The distinction this file exists for, stated as narrowly as it can be.
 *
 * When the tab thaws, an overdue deadline fires having "waited" ten seconds and
 * actually waited five minutes. Whatever it observes, it observed nothing: the
 * pong it was watching for could not have been processed either. Concluding the
 * wire is dead from that is concluding it from the tab having been asleep.
 *
 * So a late deadline must re-test on a running timer rather than deliver a
 * verdict — and if the wire really has gone, that retry finds out and says so
 * within one ordinary grace period. Tolerating a throttled timer must not mean
 * tolerating a dead table. */
{
  const PONG_GRACE = 10000;
  const world = makeWorld();
  const sock = makeSocket(world);
  const states = [];
  const Net = load(world, sock, null);
  Net.connect({ code: 'ABCDE', base: 'http://x' }, function () {}, function (s) { states.push(s.state); });
  sock.onopen && sock.onopen();

  world.advance(60000);
  check(!sock.closed, 'closed during the healthy stretch before the test even began');

  /* The wire goes quiet, and then the tab freezes WITH A PING ALREADY OUT and
   * its deadline still pending. That ordering is the whole test: the deadline
   * has to be outstanding across the freeze, so that it comes due having waited
   * five minutes instead of ten seconds. Arrange it explicitly — pings run every
   * twenty-five seconds, so step just past the next one and stop short of its
   * ten second deadline. */
  sock.answering = false;
  world.advance(15001);                       // next ping goes out; deadline pending
  const outstanding = sock.sent.filter(m => m.type === 'ping').length;
  check(outstanding >= 3 && !sock.closed,
    'failed to get a ping outstanding before the freeze, so this section is not ' +
    'testing what it claims to');
  world.freezeThenThaw(300000);

  check(!sock.closed,
    'the client delivered its verdict on a timer that had been frozen for five ' +
    'minutes — it cannot have observed anything about the connection in that time, ' +
    'because the answer it was waiting for could not have been processed either');

  // Now a fair window, on timers that are actually running.
  world.advance(PONG_GRACE * 3);
  check(sock.closed,
    'after re-testing on a running timer, a wire that genuinely stopped answering ' +
    'was still never reported. Tolerating a throttled timer must not mean ' +
    'tolerating a dead table.');
  check(states.indexOf('lost') >= 0, 'the socket was closed without telling the player');
}

/* ---------------- 2. A wire that really is dead is still reported ------------ */
{
  const world = makeWorld();
  const sock = makeSocket(world, { answering: false });   // pings go out, nothing comes back
  const states = [];
  const Net = load(world, sock, null);
  Net.connect({ code: 'ABCDE', base: 'http://x' }, function () {}, function (s) { states.push(s.state); });
  sock.onopen && sock.onopen();

  world.advance(120000);

  check(states.indexOf('lost') >= 0,
    'a socket that stopped answering entirely was never reported lost. Tolerating a ' +
    'throttled timer must not mean tolerating a dead table — silence is the one ' +
    'failure a screen reader user cannot diagnose.');
  check(sock.closed && sock.closed.code === 4000,
    'a dead socket was reported but never closed, so nothing would ever reconnect it');
}

/* ---------------- 3. Coming back to the tab proves we are alive -------------- */

/* The server tells a player who is thinking from a browser that has gone by
 * whether it has heard from them lately. A backgrounded tab's timer is exactly
 * what it cannot rely on, so becoming visible — the one moment somebody is
 * definitely looking — has to send a frame of its own. */
{
  const world = makeWorld();
  const sock = makeSocket(world);
  const handlers = {};
  const doc = {
    visibilityState: 'hidden',
    addEventListener(k, fn) { (handlers[k] = handlers[k] || []).push(fn); },
    removeEventListener(k, fn) {
      if (!handlers[k]) return;
      handlers[k] = handlers[k].filter(f => f !== fn);
    }
  };
  const Net = load(world, sock, doc);
  const link = Net.connect({ code: 'ABCDE', base: 'http://x' }, function () {}, function () {});
  sock.onopen && sock.onopen();

  check((handlers.visibilitychange || []).length === 1,
    'net.js did not listen for the tab becoming visible, so the only proof of life ' +
    'it can offer is a timer the browser is actively slowing down');

  const before = sock.sent.filter(m => m.type === 'ping').length;
  doc.visibilityState = 'visible';
  (handlers.visibilitychange || []).forEach(fn => fn());
  const after = sock.sent.filter(m => m.type === 'ping').length;
  check(after === before + 1,
    'coming back to the tab sent no ping, so the server has nothing newer to go on ' +
    'than whatever the throttled timer last managed');

  // Hidden again: no ping. Only becoming visible is news.
  const b2 = sock.sent.filter(m => m.type === 'ping').length;
  doc.visibilityState = 'hidden';
  (handlers.visibilitychange || []).forEach(fn => fn());
  check(sock.sent.filter(m => m.type === 'ping').length === b2,
    'net.js pinged on the tab being HIDDEN, which proves nothing and costs a frame');

  // And the listener is given back when the socket closes.
  link.close();
  check((handlers.visibilitychange || []).length === 0,
    'the visibilitychange listener outlived its connection, so a long session ' +
    'accumulates one per table joined');
}

/* ---------------- report ---------------- */

if (fails.length) {
  console.error('\nFAILED:');
  [...new Set(fails)].forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('a backgrounded tab is not hung up on; a dead one still is');
console.log('coming back to the tab proves it is alive, and the listener is given back');

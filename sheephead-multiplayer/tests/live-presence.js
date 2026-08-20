/* Does a real Worker leave a thinking player alone?
 *
 * The turn clock takes a seat over when it stops responding, and it could not
 * tell that apart from a player who was reading their hand back — so it took
 * present players' cards off them, and the seat never came back. The fix leans
 * on the KEEPALIVE: the client pings every twenty-five seconds, the Worker
 * stamps the socket's attachment, and the room reads that stamp when it next
 * wakes.
 *
 * Every part of that lives on the platform. The attachment, hibernation, and the
 * fact that a ping is answered without waking the room at all are exactly what
 * tests/room.js has to fake, and faking them is how the seat-attachment bug
 * shipped. So this sits at a real table, over a real socket, and waits.
 *
 * It is slow on purpose — the grace period is ninety seconds and cannot be
 * hurried from out here.
 *
 *   node tests/live-presence.js --base http://127.0.0.1:8787
 *   node tests/live-presence.js                       # the deployed Worker
 *   node tests/live-presence.js --skip-silent         # only the fast half
 */

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = n => args.includes('--' + n);

const BASE = arg('base', 'https://sheephead-room.quickmail.workers.dev');
const ORIGIN = arg('origin', 'https://kellylford.github.io');
const wsBase = BASE.replace(/^http/, 'ws');

/* Longer than the deployed grace period, with room to spare. If the Worker is
 * configured with a different one, say so here rather than guessing. */
const GRACE_MS = Number(arg('grace', 90000));

/* HOW LONG A SILENT SEAT MAY HOLD THE TABLE, and it is not the grace period.
 *
 * Presence is POLLED, once per grace period, so a check that lands just inside
 * the presence window re-arms for another whole grace period. The worst case is
 * presenceWindow + turnGrace, and with the shipped numbers that is 180 + 90 =
 * 270 seconds rather than the 90 this file used to wait.
 *
 * That mattered: after the window was widened this harness went red against a
 * correctly behaving Worker, which is a test asserting a number the code had
 * deliberately changed. Derived here rather than written as a constant, so it
 * moves when the Worker's own numbers move. */
const PRESENCE_WINDOW_MS = Number(arg('window', 180000));
const TAKEOVER_MS = PRESENCE_WINDOW_MS + GRACE_MS;

const WATCH_MS = GRACE_MS + 45000;
const PING_EVERY = 20000;      // the browser uses 25s; well inside the window

const t0 = Date.now();
const fails = [];
const check = (c, m) => { if (!c) { fails.push(m); log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(tag, ...rest) {
  console.log(String(Date.now() - t0).padStart(6) + 'ms  ' + tag.padEnd(8), ...rest);
}

if (typeof WebSocket === 'undefined') {
  console.error('This needs Node 22 or newer for a built-in WebSocket.');
  process.exit(1);
}

function Client(name) {
  return {
    name, ws: null, seat: null, view: null, version: -1, events: [], seq: 0,
    connect(code) {
      return new Promise((resolve, reject) => {
        const url = `${wsBase}/join?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&protocol=1`;
        const ws = new WebSocket(url, { headers: { Origin: ORIGIN } });
        this.ws = ws;
        const settle = setTimeout(() => reject(new Error('the socket never opened')), 15000);
        ws.addEventListener('message', ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.type === 'welcome' || m.type === 'view') {
            if (typeof m.version === 'number' && m.version > this.version) {
              this.version = m.version;
              this.view = m.view;
              if (m.type === 'welcome' && typeof m.seat === 'number') this.seat = m.seat;
            }
            (m.events || []).forEach(e => this.events.push(e.text));
            clearTimeout(settle);
            resolve(this);
          }
        });
        ws.addEventListener('close', ev => {
          clearTimeout(settle);
          reject(new Error('closed ' + ev.code + ' ' + (ev.reason || '')));
        });
        ws.addEventListener('error', () => { /* close carries the detail */ });
      });
    },
    send(action) { this.seq++; this.ws.send(JSON.stringify({ type: 'action', seq: this.seq, action })); },
    ping() { try { this.ws.send(JSON.stringify({ type: 'ping', at: Date.now() })); } catch (e) { /* gone */ } },
    close() { try { this.ws.close(1000, 'done'); } catch (e) { /* gone */ } }
  };
}

const onTurn = v => (!v || v.phase === 'handOver' || v.phase === 'idle')
  ? -1 : (v.phase === 'bury' ? v.picker : v.turn);
const myHand = c => (c.view.players[c.seat].hand || []).map(x => x.id).join(',');

async function table(name) {
  const res = await fetch(BASE + '/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ protocol: 1 })
  });
  if (!res.ok) throw new Error('POST /new returned ' + res.status);
  const { code } = await res.json();
  const c = Client(name);
  await c.connect(code);
  c.send({ type: 'start' });
  for (let i = 0; i < 120 && onTurn(c.view) !== c.seat; i++) await sleep(250);
  return c;
}

(async () => {
  /* --- a player who is there, and says so --- */
  log('start', `base=${BASE} grace=${GRACE_MS}ms`);
  const kept = await table('Thinker');
  check(onTurn(kept.view) === kept.seat, 'never got a turn to sit on');
  const held = myHand(kept);
  const phase = kept.view.phase;
  log('turn', `seat ${kept.seat}, phase ${phase}, ${held.split(',').length} cards`);
  log('wait', `thinking for ${Math.round(WATCH_MS / 1000)}s, pinging every ${PING_EVERY / 1000}s`);

  const until = Date.now() + WATCH_MS;
  while (Date.now() < until) {
    kept.ping();
    await sleep(PING_EVERY);
  }

  check(onTurn(kept.view) === kept.seat,
    'the turn moved on while the player was sitting there with a live, pinging socket');
  check(myHand(kept) === held,
    'the computer played cards out of a present player’s hand: ' + held + ' -> ' + myHand(kept));
  check(!kept.events.some(t => /stopped responding/i.test(t)),
    'a player whose browser was pinging throughout was declared to have stopped responding');
  log('kept', 'the thinking player still holds their turn and their cards');
  kept.close();

  /* --- and a client that really has gone is still taken over --- */
  if (has('skip-silent')) { report(); return; }
  const gone = await table('Vanisher');
  check(onTurn(gone.view) === gone.seat, 'never got a turn to abandon');
  const wait = TAKEOVER_MS + 30000;
  log('silent', `saying nothing at all for ${Math.round(wait / 1000)}s ` +
    `(worst case is presence window ${PRESENCE_WINDOW_MS / 1000}s + grace ${GRACE_MS / 1000}s)`);
  await sleep(wait);

  const takenOver = gone.events.some(t => /stopped responding/i.test(t));
  check(takenOver,
    'a seat whose client stopped answering was never taken over within ' +
    Math.round(wait / 1000) + 's — the table stalls for everybody else, which is the ' +
    'failure the turn clock exists to prevent');
  if (takenOver) log('taken', 'the silent seat was taken over as it should be');
  gone.close();

  report();
})().catch(e => { console.error('the run itself failed: ' + e.message); process.exit(1); });

function report() {
  if (fails.length) {
    console.error('\nFAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('\na present player keeps their turn; a silent one is still covered.');
  process.exit(0);
}

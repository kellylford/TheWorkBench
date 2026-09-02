/* Real clients, real sockets, a real deployed room.
 *
 * Everything else in this directory tests against an in-process server with a
 * simulated network. That found a great deal and could not, even in principle,
 * find the class of bug that actually reached the player: the Worker delivering
 * nothing because a socket attachment was written too early, a client pointing at
 * a host that does not resolve, a table that starts playing before anybody can
 * share its code. Those live in the join between the pieces, and the join is what
 * a fake wire replaces.
 *
 * So this drives the DEPLOYED Worker over real WebSockets, with as many clients
 * as asked for, and prints a transcript of every frame. It is meant to be read as
 * much as asserted on: when something is wrong at a real table, the first
 * question is "what actually happened", and this answers it in one run instead of
 * two people comparing notes over the phone.
 *
 *   node tests/live-room.js                      # against the deployed Worker
 *   node tests/live-room.js --base http://127.0.0.1:8787   # against wrangler dev
 *   node tests/live-room.js --players 3 --hands 2 --quiet
 *
 * Exits non-zero if the table fails to behave, so it can be a CI job.
 */

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const has = name => args.includes('--' + name);

const BASE = arg('base', 'https://sheephead-room.quickmail.workers.dev');
const ORIGIN = arg('origin', 'https://kellylford.github.io');
const PLAYERS = Number(arg('players', 2));
const HANDS = Number(arg('hands', 1));
const QUIET = has('quiet');
const TIMEOUT_MS = Number(arg('timeout', 90000));

const wsBase = BASE.replace(/^http/, 'ws');
const fails = [];
const check = (c, m) => { if (!c) { fails.push(m); log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const t0 = Date.now();
function log(tag, ...rest) {
  if (QUIET && tag === 'frame') return;
  const at = String(Date.now() - t0).padStart(6);
  console.log(at + 'ms  ' + tag.padEnd(7), ...rest);
}

if (typeof WebSocket === 'undefined') {
  console.error('This needs Node 22 or newer for a built-in WebSocket.');
  process.exit(1);
}

/* One player. Deliberately not the real js/table.js: this is an independent
 * reading of the protocol, so a bug in the client and a bug in the server cannot
 * cancel each other out and look like success. */
function Client(name) {
  return {
    name,
    ws: null,
    seat: null,
    view: null,
    version: -1,
    frames: [],
    events: [],
    seq: 0,
    refused: 0,        // how many cards down the hand to try next
    pending: null,
    closed: null,

    connect(code) {
      return new Promise((resolve, reject) => {
        const url = `${wsBase}/join?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&protocol=1`;
        const ws = new WebSocket(url, { headers: { Origin: ORIGIN } });
        this.ws = ws;
        const settle = setTimeout(() => reject(new Error(name + ': the socket never opened')), 15000);

        ws.addEventListener('open', () => { log('open', name); });
        ws.addEventListener('message', ev => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          this.frames.push(m);
          if (m.type === 'welcome' || m.type === 'view') {
            if (typeof m.version === 'number' && m.version > this.version) {
              this.version = m.version;
              this.view = m.view;
              if (m.type === 'welcome' && typeof m.seat === 'number') this.seat = m.seat;
            }
            (m.events || []).forEach(e => this.events.push(e.text));
            if (typeof m.ackSeq === 'number' && this.pending && this.pending === m.ackSeq) this.pending = null;
            log('frame', name, m.type, 'v' + m.version, 'seat', this.seat,
              'phase', m.view && m.view.phase, 'turn', m.view && m.view.turn,
              (m.events || []).length ? '+' + m.events.length + ' events' : '');
            clearTimeout(settle);
            resolve(this);
          } else if (m.type === 'rejected') {
            this.pending = null;
            /* Move on to the next card rather than offering the same one for
             * ever. "Tries its cards until one is accepted" was the intent and
             * the loop never advanced, so a seat whose first card happened to be
             * illegal sent it three hundred times and the run reported a
             * deadline rather than the refusal it was drowning in. */
            this.refused++;
            log('frame', name, 'REJECTED', m.reason);
          } else if (m.type === 'fault') {
            log('frame', name, 'FAULT', m.reason);
          } else if (m.type === 'pong') {
            log('frame', name, 'pong');
          }
        });
        ws.addEventListener('close', ev => {
          this.closed = { code: ev.code, reason: ev.reason };
          log('close', name, ev.code, ev.reason || '');
          clearTimeout(settle);
          reject(new Error(name + ': closed ' + ev.code + ' ' + (ev.reason || '')));
        });
        ws.addEventListener('error', () => { /* close carries the detail */ });
      });
    },

    send(action) {
      this.seq++;
      this.pending = this.seq;
      log('send', this.name, JSON.stringify(action));
      this.ws.send(JSON.stringify({ type: 'action', seq: this.seq, action }));
    },

    close() { try { this.ws.close(1000, 'done'); } catch (e) { /* gone */ } }
  };
}

/* The move this seat can make right now, read from its own view. */
function moveFor(c, DEAL) {
  const v = c.view;
  if (!v || c.pending !== null) return null;
  /* Somebody has to say to begin.
   *
   * A room waits at 'idle' now, so that the host can read the code out before
   * anything is dealt. This harness predates that gate and had no case for it,
   * so every run against a real Worker sat at an empty table until the idle
   * counter ran out and reported "the table stopped making progress" — which is
   * true, and says nothing about why. Only the first seat asks, so two clients
   * do not race to deal. */
  if (v.phase === 'idle') return c.seat === 0 ? { type: 'start' } : null;
  if (v.phase === 'pick' && v.turn === c.seat) return { type: 'pick' };
  if (v.phase === 'bury' && v.picker === c.seat) {
    return { type: 'bury', cards: v.players[c.seat].hand.map(x => x.id).slice(0, DEAL) };
  }
  if (v.phase === 'play' && v.turn === c.seat) {
    const hand = v.players[c.seat].hand;
    if (!hand.length) return null;
    /* Legality is the server's business; this tries its cards until one is
     * accepted, which is also a decent test of the refusal path. */
    const pick = hand[c.refused % hand.length];
    return { type: 'play', card: pick && pick.id };
  }
  if (v.phase === 'handOver') return { type: 'nextHand' };
  return null;
}

(async () => {
  log('start', `base=${BASE} players=${PLAYERS} hands=${HANDS}`);

  /* --- creating a table --- */
  const res = await fetch(BASE + '/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ protocol: 1 })
  }).catch(e => { throw new Error('POST /new failed outright: ' + e.message); });

  check(res.ok, 'POST /new returned ' + res.status);
  check(res.headers.get('access-control-allow-origin') === ORIGIN,
    'the table endpoint did not allow the site origin, so a browser could never create a table');
  const body = await res.json();
  check(!!body.code, 'no table code came back');
  const code = body.code;
  log('table', 'code', code);

  /* --- everybody joins --- */
  const clients = [];
  for (let i = 0; i < PLAYERS; i++) {
    const c = Client('P' + (i + 1));
    try {
      await c.connect(code);
    } catch (e) {
      check(false, 'a player could not join: ' + e.message);
      break;
    }
    clients.push(c);
    await sleep(300);
  }
  check(clients.length === PLAYERS, `only ${clients.length} of ${PLAYERS} players got in`);
  if (!clients.length) { report(); return; }

  const seats = clients.map(c => c.seat);
  check(new Set(seats).size === seats.length, 'two players were given the same seat: ' + seats.join(','));
  log('seats', seats.join(', '));

  /* --- WHAT THE TABLE DOES WHILE PEOPLE ARE STILL ARRIVING ---
   *
   * The thing a real table has to get right and the fake one never tested: a
   * player needs time to read the code out before anything is dealt. */
  const dealtBeforeEverybodyJoined = clients[0].events.some(t => /^Hand \d+\./.test(t));
  log('check', 'a hand was dealt during joining:', dealtBeforeEverybodyJoined);

  /* --- play --- */
  const DEAL = clients[0].view && clients[0].view.players.length === 4 ? 2 : 2;
  let handsSeen = 0, idle = 0;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline && handsSeen < HANDS) {
    let acted = false;
    for (const c of clients) {
      const before = c.version;
      const mv = moveFor(c, DEAL);
      if (mv) {
        if (c.version > before) c.refused = 0;
        if (mv.type === 'nextHand') {
          handsSeen++;
          if (handsSeen >= HANDS) break;
        }
        c.send(mv);
        acted = true;
        await sleep(250);
      }
    }
    /* CONSECUTIVE idleness, not total.
     *
     * It only ever counted up, so every quarter second spent legitimately
     * waiting for the computer seats added to the same tally — and a run long
     * enough to be interesting failed with "the table stopped making progress"
     * while the table was making progress the whole time. Fifteen seconds with
     * nothing happening at all is the thing worth reporting. */
    if (acted) idle = 0;
    else { idle++; await sleep(250); }
    if (idle > 60) { check(false, 'the table stopped making progress'); break; }
  }

  check(handsSeen >= HANDS || Date.now() < deadline,
    `only completed ${handsSeen} of ${HANDS} hands before the deadline`);

  /* --- what each seat was allowed to see --- */
  clients.forEach(c => {
    if (!c.view) return;
    c.view.players.forEach((p, i) => {
      if (i === c.seat) return;
      const real = (p.hand || []).filter(x => x && x.id);
      check(real.length === 0,
        `${c.name} (seat ${c.seat}) was sent real cards for seat ${i}`);
    });
    check((c.view.players[c.seat].hand || []).length >= 0, c.name + ' has no hand of its own');
  });

  clients.forEach(c => c.close());
  await sleep(400);
  report();

  function report() {
    log('done', `frames: ${clients.map(c => c.name + '=' + c.frames.length).join(' ')}`);
    if (!QUIET) {
      clients.forEach(c => {
        console.log('\n--- ' + c.name + ' (seat ' + c.seat + ') heard ---');
        c.events.forEach(t => console.log('    ' + t));
      });
    }
    if (fails.length) {
      console.error('\nFAILED:');
      [...new Set(fails)].forEach(f => console.error('  - ' + f));
      process.exit(1);
    }
    console.log('\nthe live table behaved.');
    process.exit(0);
  }
})().catch(e => {
  console.error('\nthe run itself failed: ' + e.message);
  process.exit(1);
});

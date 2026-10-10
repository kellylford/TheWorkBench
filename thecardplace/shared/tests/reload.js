/* What happens when somebody reloads the page mid-game.
 *
 * Until this existed, reloading was the end of the game, and both halves of
 * that were found by reloading a browser rather than by reading the code.
 *
 * THE TABLE WAS GONE. The five-character code lived in a variable and nowhere
 * else, so a refresh — or a browser restoring its own tabs after a crash, which
 * nobody chose — put the player back on the New game screen with no way to the
 * table they had been at.
 *
 * THE LOG CAME BACK EMPTY. The room sends each seat the events it has not been
 * told about, which is exactly right for a client that still HAS what it was
 * told and exactly wrong for one that has just lost everything. The board came
 * back readable and the record of how it got that way did not come back at all.
 * For a player who reads the game by ear, that log is the whole account of the
 * hand.
 *
 * This is a SHARED test and not five copies of one, because room.js, net.js,
 * localserver.js and table.js are one copy shared by every game here — so this
 * is one property that no single game can see, held against all of them at
 * once. That is the same reason engine-contract.js and wiring.js live here.
 *
 * Every check below has been falsified: the fix was reverted, the run went red,
 * and the message it printed was read. A check that has never failed is a
 * check that has never been tested.
 *
 *   node shared/tests/reload.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

/* The five games that are played over the transport. sheephead/ and Cribbage/
 * are the stable single-player builds; they have no room to rejoin. */
const GAMES = [
  { dir: 'euchre', seats: 4 },
  { dir: 'cribbage-multiplayer', seats: 2 },
  { dir: 'sheephead-multiplayer', seats: 5 },
  { dir: 'hearts', seats: 4 },
  { dir: 'spades', seats: 4 }
];

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

/* A tab. Its own globals, its own sessionStorage, and nothing carried over from
 * the last one — which is the honest model of a reload, and the reason this
 * does not simply call the functions twice in one context. */
function tab(dir, files) {
  const storage = {};
  const sandbox = {
    console, Math, Date, JSON, setTimeout, clearTimeout,
    sessionStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(root, f.startsWith('shared/') ? f : dir + '/' + f), 'utf8'),
      sandbox, { filename: f });
  }
  return sandbox;
}

const ENGINE = ['js/config.js', 'js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js',
  'shared/js/localserver.js', 'shared/js/table.js', 'shared/js/net.js',
  'shared/js/room.js'];

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Play until the room has a log worth losing. Bots drive it, which is the
 * production path — see the note in localserver.js about never handing a bot a
 * projection. */
async function playAWhile(SH, srv, mySeat, link) {
  for (let i = 0; i < 60; i++) {
    const st = srv.peek();
    if (st.events.length >= 4) return;
    const seat = SH.Game.seatToAct(st);
    if (seat === mySeat) {
      /* Our own seat has to move or the table waits for us for ever. Any legal
       * move will do; this is not testing the rules. */
      try { SH.AI.act(st); } catch (e) { return; }
    }
    await wait(5);
  }
}

async function run() {
  for (const g of GAMES) {
    let ctx;
    try { ctx = tab(g.dir, ENGINE); } catch (e) {
      check(false, g.dir + ': would not load — ' + e.message);
      continue;
    }
    const SH = ctx.SH;

    /* ---- 1. the code this tab was at survives a reload ------------------ */
    check(typeof SH.Net.rememberTable === 'function' &&
          typeof SH.Net.rememberedTable === 'function' &&
          typeof SH.Net.forgetTable === 'function',
      g.dir + ': shared/js/net.js does not offer rememberTable/rememberedTable/' +
      'forgetTable, so nothing can put a player back at the table they were at');

    if (typeof SH.Net.rememberTable === 'function') {
      check(SH.Net.rememberedTable() === '',
        g.dir + ': a tab that has never joined a table already claims to have one');
      SH.Net.rememberTable('AB2CD');
      check(SH.Net.rememberedTable() === 'AB2CD',
        g.dir + ': the table code did not survive being written down. A reload ' +
        'puts the player on the New game screen with no way back to their table.');

      /* Leaving on purpose is the one thing that must clear it, or going back to
       * the menu and reloading offers to rejoin the table you walked away from. */
      SH.Net.forgetTable();
      check(SH.Net.rememberedTable() === '',
        g.dir + ': leaving the table did not forget it, so a reload offers to ' +
        'rejoin a table the player deliberately left');

      /* Two games in one tab must not read each other's code. sessionStorage is
       * scoped to the ORIGIN and every game here publishes under the same one. */
      SH.Net.rememberTable('AB2CD');
      const other = ctx.SH.CONFIG.game;
      ctx.SH.CONFIG = { game: other + '-else', workerBase: 'https://x.example' };
      check(SH.Net.rememberedTable() === '',
        g.dir + ": another game in the same tab can read this game's table code. " +
        'They would offer each other codes their own room will refuse.');
      ctx.SH.CONFIG = { game: other, workerBase: 'https://x.example' };
      SH.Net.forgetTable();
    }

    /* ---- 2. the log comes back --------------------------------------- */
    const names = [];
    for (let i = 0; i < g.seats; i++) names.push('Seat ' + (i + 1));
    const cfg = { numPlayers: g.seats, names: names, difficulty: 'hard' };

    const srv = SH.LocalServer.create({ config: cfg, latency: 0, botDelay: 0 });
    let mySeat = null;
    let firstLink = null;
    firstLink = srv.connect(null, m => {
      if (m.type === 'welcome') {
        mySeat = m.seat;
        firstLink.send({ type: 'action', seq: 1, action: { type: 'start' } });
      }
    });
    await wait(20);
    if (mySeat === null) { check(false, g.dir + ': could not take a seat at all'); continue; }
    await playAWhile(SH, srv, mySeat, firstLink);

    const state = srv.peek();
    /* What this seat is entitled to have heard — the engine's own answer, asked
     * from scratch. Not "what was sent", which is the thing under test. */
    const entitled = SH.Game.eventsFor(state, mySeat, -1).length;
    check(entitled > 0,
      g.dir + ': the table produced no events this seat may hear, so losing them ' +
      'could not have been noticed');

    firstLink.close();

    /* THE RELOAD. A brand-new connection to the same seat, remembering nothing —
     * which is what a browser that has just reloaded is. */
    let welcome = null;
    srv.connect(mySeat, m => { if (m.type === 'welcome' && !welcome) welcome = m; });
    await wait(20);

    check(!!welcome, g.dir + ': a client reconnecting to its own seat got no welcome');
    if (welcome) {
      const after = SH.Game.eventsFor(srv.peek(), mySeat, -1).length;
      check(welcome.events.length >= entitled,
        g.dir + ': a reloaded client was given ' + welcome.events.length + ' of the ' +
        after + ' events its seat may hear. The board comes back and the record of ' +
        'how it got there does not, which for a player reading by ear is the whole ' +
        'account of the hand.');

      /* Restoring a log must not restore somebody else's cards with it. hearts
       * is the one that makes this bite — what you were passed is addressed to
       * one seat — but it is asked of every game, because the next private
       * event will be added to whichever game nobody was thinking about. */
      const mine = {};
      SH.Game.eventsFor(srv.peek(), mySeat, -1).forEach(e => { mine[e.id] = true; });
      const leaked = welcome.events.filter(e => !mine[e.id]);
      check(leaked.length === 0,
        g.dir + ': the restored log carried ' + leaked.length + ' event(s) this seat ' +
        'was never entitled to hear. Coming back to a table must not hand somebody ' +
        "else's cards over with the history.");
    }

    /* ---- 3. and the backlog is not read out loud ---------------------- */
    /* table.js is what the interface actually talks to, so this asks IT rather
     * than reasoning about what the room sent. The flag is the whole mechanism:
     * without it the interface cannot tell a recovered hand from a live one, and
     * the obvious thing to do with events is speak them — minutes of recitation
     * before the player can find out whose turn it is. */
    const T = SH.Table;
    let sink = null;
    T.startOnline(null, handler => { sink = handler; return { seat: 0, send() {}, close() {} }; });
    sink({
      type: 'welcome', seat: 0, version: 1, view: { phase: 'idle', players: [] },
      events: [{ id: 1, kind: 'info', text: 'something that happened while you were away' }]
    });
    const recovered = T.drainEvents();
    check(recovered.length === 1 && recovered[0].replay === true,
      g.dir + ': events arriving on a welcome are not marked as a backlog, so the ' +
      'interface cannot tell a recovered hand from a live one and will read the ' +
      'whole thing out loud before the player can find out whose turn it is');

    sink({
      type: 'view', version: 2, view: { phase: 'idle', players: [] },
      events: [{ id: 2, kind: 'info', text: 'something happening now' }]
    });
    const live = T.drainEvents();
    check(live.length === 1 && !live[0].replay,
      g.dir + ': an event arriving on an ordinary view is marked as a backlog, so ' +
      'the game would go silent — every move logged and nothing said');
    T.close();

    /* ---- 4. a refused move says WHICH move ---------------------------- */
    /* The interface cannot mark the card the table refused unless it is told
     * which one. The timeout and dropped-connection paths always handed the
     * action back; the ordinary server refusal — much the commonest of the
     * three — did not, so a refusal could only ever be spoken. */
    let sink2 = null;
    let refusal = null;
    T.startOnline(null, handler => { sink2 = handler; return { seat: 0, send() {}, close() {} }; });
    T.onRejected(info => { refusal = info; });
    sink2({ type: 'welcome', seat: 0, version: 1, view: { phase: 'play', players: [] }, events: [] });
    const asked = T.act({ type: 'play', card: 'QS' });
    check(asked && asked.ok === 'pending',
      g.dir + ': the table would not accept a move to refuse');
    if (asked && asked.ok === 'pending') {
      sink2({ type: 'rejected', seq: asked.seq, reason: 'you must follow suit', version: 2 });
      check(refusal && refusal.action && refusal.action.card === 'QS',
        g.dir + ': a refused move does not say which card it was, so the interface ' +
        'can only speak the refusal and has nothing to point at on screen');
    }
    T.close();

    srv.stop();

    /* ---- 5. and the SAME thing over the real room, delivered the real way -
     *
     * This check exists because everything above passed while the deployed
     * Worker still handed a reloading player nothing, and it was found by
     * reloading a live table rather than by any test here.
     *
     * The difference is one line in the Worker: a socket's attachment is not
     * written until join() has returned the seat, and a socket with no
     * attachment cannot be found — so join()'s own welcome is DROPPED, and the
     * frame the client actually receives comes from the resend() a line later.
     * localserver.js has no such step, so on the fake wire the first delivery
     * always arrived and the bug was invisible.
     *
     * So this models what the platform does rather than what is convenient:
     * nothing sent before resend() can be received. Any future divergence
     * between the two transports fails here instead of on somebody's reload. */
    const Room = SH.Room;
    if (!Room || typeof Room.create !== 'function') {
      check(false, g.dir + ': no SH.Room, so the deployed transport is untested');
    } else {
      const store = {};
      const inbox = {};
      let attached = {};      // connId -> can this socket be found yet?
      const room = Room.create({
        config: cfg,
        storage: {
          get: k => (k in store ? JSON.parse(store[k]) : null),
          put: (k, v) => { store[k] = JSON.stringify(v); }
        },
        now: () => 1000,
        setAlarm: () => {},
        /* The platform's rule, not a convenience: a frame for a socket whose
         * attachment is unwritten goes nowhere. */
        deliver: (connId, msg) => {
          if (!attached[connId]) return;
          (inbox[connId] = inbox[connId] || []).push(msg);
        },
        botDelay: 0
      });

      /* Exactly the order in each game's worker/src/index.js: join, write the
       * attachment, resend. */
      function connect(connId, seat) {
        const r = room.join(connId, seat, 'Somebody');
        if (!r.ok) return r;
        attached[connId] = true;
        room.resend(connId);
        return r;
      }

      const first = connect('conn-1', null);
      check(first.ok, g.dir + ' (room): could not take a seat — ' + first.reason);
      if (first.ok) {
        room.action('conn-1', { seq: 1, action: { type: 'start' } });
        const mine = first.seat;

        const owed = (inbox['conn-1'] || []).reduce((n, m) => n + ((m.events || []).length), 0);
        check(owed > 0,
          g.dir + ' (room): the first connection was never told anything, so ' +
          'losing it could not have been noticed');

        room.leave('conn-1');
        const back = connect('conn-2', mine);
        check(back.ok, g.dir + ' (room): could not reclaim the seat — ' + back.reason);

        const welcomes = (inbox['conn-2'] || []).filter(m => m.type === 'welcome');
        const got = welcomes.reduce((n, m) => n + ((m.events || []).length), 0);
        check(welcomes.length > 0,
          g.dir + ' (room): a rejoining socket never received a welcome at all, so ' +
          'it does not know which seat it is in');
        check(got > 0,
          g.dir + ' (room): a rejoining socket was welcomed with ' + got + ' events. ' +
          "join() built the backlog and the platform dropped that frame; resend() " +
          'is what the client hears, and it read a cursor join() had already ' +
          'advanced past. This is the shape the fake wire cannot show.');
      }
    }
  }

  console.log('reload: ' + checks + ' checks across ' + GAMES.length + ' games');
  console.log('  the table code survives, the log comes back, the backlog is not spoken,');
  console.log('  and a refusal names its card.');

  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)]) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('Reloading the page is no longer the end of the game.');
}

run().catch(e => { console.error(e); process.exit(1); });

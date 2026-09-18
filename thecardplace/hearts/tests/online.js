/* Can the shared transport actually run hearts?
 *
 * shared/js/localserver.js is an authoritative server that happens to be in this
 * process: the real engine, the real projection, the real room logic, with the
 * network faked and given latency. So this plays whole games of hearts through
 * exactly the path a socket would take, without a socket.
 *
 * THE POINT IS THAT IT PLAYS FROM THE VIEW ALONE. Every move below is chosen
 * from what Table.view() carries. If this file ever needs a field the projection
 * does not send, the projection is incomplete — and that is a much better way to
 * find out than a player reporting that the interface goes blank at the passing
 * stage.
 *
 * Hearts is the first game in this repository written after the shared transport
 * existed rather than before it, so this file is also the answer to whether the
 * transport was actually general or merely three games that happened to agree.
 *
 * The passing phase is the interesting part, and it is a shape the other games
 * do not have: four seats act at once, nobody may see another's choice, and the
 * server holds all four sets of three until the last one arrives.
 *
 *   node tests/online.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const root = path.join(__dirname, '..');

let seed = 5150;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const seededMath = Object.create(Math);
seededMath.random = rnd;

const sandbox = { console, Math: seededMath, Date, JSON, Set, Map, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js', 'js/config.js',
                 '../shared/js/table.js', '../shared/js/localserver.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, Cards: C, Table, LocalServer } = sandbox.SH;

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function config() {
  return {
    numPlayers: 4,
    names: ['One', 'Two', 'Three', 'Four'],
    pointsToWin: 100,
    difficulty: 'hard'
  };
}

/* Take whatever turn is ours, from the VIEW alone. */
function actIfOurTurn(v, mySeat) {
  if (!v || Table.pending()) return false;

  if (v.phase === 'passing') {
    /* passedIn is the only thing the projection says about the pass, and it is
     * all a client needs: whether THIS seat has finished choosing. If the view
     * carried the cards, this test could not tell the difference — which is why
     * projection.js checks the wire and this checks the client. */
    if (v.passedIn && v.passedIn[mySeat]) return false;
    const hand = v.players[mySeat].hand;
    if (hand.length < 3) return false;
    return !!Table.act({ type: 'pass', cards: hand.slice(0, 3).map(c => c.id) });
  }

  /* Somebody has to ask for the next hand. The room deliberately does not deal
   * on its own: three other people may still be reading the result, and a table
   * that deals itself takes that away. First come, and the room answers the
   * loser with a view rather than a refusal. */
  if (v.phase === 'handOver') {
    return !!Table.act({ type: 'nextHand' });
  }

  if (v.phase === 'play' && v.turn === mySeat) {
    /* legalPlays runs on the VIEW, not on a server state. It works because the
     * projection carries this seat's own hand, the trick, the tricks played and
     * heartsBroken — everything the rule needs. If any of those went missing the
     * client could not tell a legal card from an illegal one. */
    const legal = G.legalPlays(v, mySeat);
    if (!legal.length) return false;
    return !!Table.act({ type: 'play', card: legal[0].id });
  }
  return false;
}

/* ONE listener, for the whole file.
 *
 * Table.onChange appends to a module-level list that Table.close() deliberately
 * does NOT clear — the interface registers its handler once at start-up and it
 * has to survive leaving one table and joining another. Correct for the app, and
 * it means a test registering a handler per section ends up with every earlier
 * section's handler still running against the current game. */
let onView = null;
let onReject = null;
Table.onChange(() => { if (onView) onView(); });
Table.onRejected(info => { if (onReject) onReject(info); });

async function main() {
  /* ============ 1. A WHOLE SESSION, FROM VIEWS ALONE ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 3, jitter: true, botDelay: 2 });
    const handsSeen = new Set();
    let sawOwnHand = false, sawHiddenHands = false;
    let sawPassing = false, sawPlay = false, sawHandOver = false;
    let leakedCards = 0;
    let passOrderBad = 0;

    Table.startOnline(null, handler => srv.connect(null, handler));

    onView = () => {
      const v = Table.view();
      if (!v) return;
      const me = Table.seat();
      if (me === null) return;

      if (v.phase === 'passing') sawPassing = true;
      if (v.phase === 'play') sawPlay = true;
      if (v.phase === 'handOver' || v.phase === 'gameOver') sawHandOver = true;
      if (v.dealNumber) handsSeen.add(v.dealNumber);

      /* Every view, every time: this seat sees its own cards and nobody else's. */
      if (v.players[me].hand.length) {
        sawOwnHand = true;
        v.players[me].hand.forEach(c => {
          if (!c.id) leakedCards++;      // our own hand must be real cards
        });
      }
      v.players.forEach((p, i) => {
        if (i === me) return;
        p.hand.forEach(c => {
          sawHiddenHands = true;
          if (c.id || c.r || c.s) leakedCards++;
        });
      });

      /* The pass never crosses the wire. Not the cards, not a count of them. */
      if ('passing' in v) passOrderBad++;
      if (v.received && v.phase === 'passing') passOrderBad++;   // not before the swap

      actIfOurTurn(v, me);
    };

    /* Kick it off: somebody has to say the table is ready. */
    await sleep(30);
    const v0 = Table.view();
    if (v0 && v0.phase === 'idle') Table.act({ type: 'start' });

    for (let i = 0; i < 900 && handsSeen.size < 3; i++) {
      const v = Table.view();
      const me = Table.seat();
      if (v && me !== null) actIfOurTurn(v, me);
      await sleep(6);
    }

    check(sawOwnHand, 'never saw our own hand through the transport');
    check(sawHiddenHands, 'never saw another seat, so nothing checked that it is hidden');
    check(leakedCards === 0, leakedCards + ' cards crossed the wire that should not have');
    check(passOrderBad === 0,
      'the projection carried the pass ' + passOrderBad + ' times — that is the one ' +
      'thing in this game that must never reach a client');
    check(sawPassing, 'never reached the passing phase over the transport');
    check(sawPlay, 'never reached the play over the transport');
    check(sawHandOver, 'never finished a hand over the transport');
    check(handsSeen.size >= 2,
      'only ' + handsSeen.size + ' hand(s) were played through the transport');

    onView = null;
    Table.close();
  }

  /* ============ 2. A REFUSAL COMES BACK AS A REFUSAL ============
   *
   * The client has to be told when the server said no, and told WHY, or the
   * interface can only show a move that silently did not happen. */
  {
    const srv = LocalServer.create({ config: config(), latency: 2, botDelay: 2 });
    const rejects = [];
    onReject = info => rejects.push(info);

    Table.startOnline(null, handler => srv.connect(null, handler));
    await sleep(30);
    let v = Table.view();
    if (v && v.phase === 'idle') Table.act({ type: 'start' });
    await sleep(60);

    v = Table.view();
    const me = Table.seat();
    check(!!v, 'no view arrived at all');

    if (v && me !== null) {
      /* A card this seat does not hold. The server must refuse it, and must not
       * say which seat does hold it. */
      const mine = new Set(v.players[me].hand.map(c => c.id));
      const notMine = C.newDeck().map(c => c.id).filter(id => !mine.has(id));
      Table.act({ type: 'play', card: notMine[0] });
      await sleep(60);

      check(rejects.length > 0, 'the server accepted a card the seat does not hold, ' +
        'or refused it without telling the client');
      if (rejects.length) {
        const why = String(rejects[0].reason || '');
        check(why.length > 0, 'a refusal arrived with no reason at all');
        /* No other seat's card may be named in it. */
        v.players.forEach((p, i) => {
          if (i === me) return;
          p.hand.forEach(c => {
            if (!c.id) return;
            check(!why.includes(C.name(C.get(c.id))),
              'a refusal named a card in seat ' + i + "'s hand");
          });
        });
      }
    }

    onReject = null;
    Table.close();
  }

  /* ============ 3. THE VIEW CARRIES ENOUGH TO PLAY BY ============
   *
   * Not "the fields exist" — that a legal move can be CHOSEN from a view with
   * nothing else to hand. legalPlays is run on the projection above; here the
   * rest of what an interface has to draw is checked for presence, because a
   * missing field shows up as a blank panel rather than as an error. */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 1 });
    Table.startOnline(null, handler => srv.connect(null, handler));
    await sleep(30);
    if ((Table.view() || {}).phase === 'idle') Table.act({ type: 'start' });

    let checked = false;
    for (let i = 0; i < 400 && !checked; i++) {
      const v = Table.view();
      const me = Table.seat();
      if (v && me !== null && v.phase === 'play') {
        ['phase', 'turn', 'leader', 'dealNumber', 'passDir', 'trick', 'tricksPlayed',
         'heartsBroken', 'players', 'history'].forEach(k => {
          check(v[k] !== undefined, 'the view has no ' + k + ', so the interface cannot draw it');
        });
        v.players.forEach((p, i2) => {
          ['name', 'occupant', 'score', 'takenPoints', 'hand'].forEach(k => {
            check(p[k] !== undefined, 'seat ' + i2 + ' has no ' + k + ' in the view');
          });
        });
        checked = true;
      }
      if (v && me !== null) actIfOurTurn(v, me);
      await sleep(5);
    }
    check(checked, 'never reached the play phase to check what the view carries');
    Table.close();
  }

  console.log(checks.toLocaleString() + ' assertions');
  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.error('\nFAIL (' + uniq.length + '):');
    uniq.slice(0, 15).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('The shared transport runs hearts, and a client can play from the view alone.');
}

main().catch(e => { console.error('online: threw — ' + e.stack); process.exit(1); });

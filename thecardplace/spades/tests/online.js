/* Can the shared transport actually run spades?
 *
 * shared/js/localserver.js is an authoritative server that happens to be in this
 * process: the real engine, the real projection, the real room logic, with the
 * network faked and given latency. So this plays whole games of spades through
 * exactly the path a socket would take, without a socket.
 *
 * THE POINT IS THAT IT PLAYS FROM THE VIEW ALONE. Every move below is chosen
 * from what Table.view() carries. If this file ever needs a field the projection
 * does not send, the projection is incomplete — and that is a much better way to
 * find out than a player reporting that the interface goes blank at the bidding
 * stage.
 *
 * The bidding is the shape worth exercising. It is sequential, one seat at a
 * time round the table, which is the OPPOSITE of hearts' simultaneous pass — and
 * the transport has to carry a phase where three seats are waiting on a fourth
 * without anything to do. A room that prods the wrong bot, or prods one that has
 * already bid, hangs the table rather than failing.
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
    pointsToWin: 250,
    bagLimit: 10,
    bagPenalty: 100,
    nilValue: 100,
    difficulty: 'hard'
  };
}

/* Take whatever turn is ours, from the VIEW alone. */
function actIfOurTurn(v, mySeat) {
  if (!v || Table.pending()) return false;

  if (v.phase === 'bidding' && v.turn === mySeat) {
    /* A bid chosen from the view: count the spades in our own hand, which is the
     * only hand the projection carries. Deliberately not AI.chooseBid — that
     * reads state.players[].bid across the table, and the point here is that a
     * client can decide with nothing but what it was sent. */
    const hand = v.players[mySeat].hand;
    const spades = hand.filter(c => c.s === 'S').length;
    return !!Table.act({ type: 'bid', bid: Math.max(1, Math.min(13, spades)) });
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
     * projection carries this seat's own hand, the trick and spadesBroken —
     * everything the rule needs. If any of those went missing the client could
     * not tell a legal card from an illegal one. */
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
 * has to survive leaving one table and joining another. */
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
    let sawBidding = false, sawPlay = false, sawHandOver = false;
    let leakedCards = 0;
    let bidOrderBad = 0;
    let sawPublicBids = 0;

    Table.startOnline(null, handler => srv.connect(null, handler));

    onView = () => {
      const v = Table.view();
      if (!v) return;
      const me = Table.seat();
      if (me === null) return;

      if (v.phase === 'bidding') sawBidding = true;
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

      /* THE BIDS MUST CROSS THE WIRE. This is the inverse of the hearts check
       * next door, which asserts that the pass never does — and the difference
       * is the rule, not the shape of the field. A spades client that could not
       * see what the seats before it had bid would be playing a different game,
       * and the later seats would lose the only advantage position confers. */
      if (v.phase === 'play') {
        v.players.forEach((p, i) => {
          if (p.bid === null || p.bid === undefined) bidOrderBad++;
          else if (i !== me) sawPublicBids++;
        });
      }

      /* During the bidding, a seat that has not spoken shows null rather than a
       * number invented by the projection. */
      if (v.phase === 'bidding') {
        const said = v.players.filter(p => p.bid !== null).length;
        const expected = (v.turn - v.dealer - 1 + 8) % 4;
        if (said !== expected) bidOrderBad++;
      }

      actIfOurTurn(v, me);
    };

    /* Kick it off: somebody has to say the table is ready. */
    await sleep(30);
    const v0 = Table.view();
    if (v0 && v0.phase === 'idle') Table.act({ type: 'start' });

    for (let i = 0; i < 1200 && handsSeen.size < 3; i++) {
      const v = Table.view();
      const me = Table.seat();
      if (v && me !== null) actIfOurTurn(v, me);
      await sleep(6);
    }

    check(sawOwnHand, 'never saw our own hand through the transport');
    check(sawHiddenHands, 'never saw another seat, so nothing checked that it is hidden');
    check(leakedCards === 0, leakedCards + ' cards crossed the wire that should not have');
    check(bidOrderBad === 0,
      'the bidding arrived wrong ' + bidOrderBad + ' times — either a bid was missing ' +
      'once play began, or the count of bids did not match whose turn it was');
    check(sawPublicBids > 0,
      'this seat never saw another seat\'s bid, and in spades the bids are spoken aloud');
    check(sawBidding, 'never reached the bidding phase over the transport');
    check(sawPlay, 'never reached the play over the transport');
    check(sawHandOver, 'never finished a hand over the transport');
    check(handsSeen.size >= 2,
      'only ' + handsSeen.size + ' hand(s) were played through the transport');

    onView = null;
    Table.close();
  }

  /* ============ 2. A REFUSAL COMES BACK AS A REFUSAL ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 2, botDelay: 2 });
    const rejects = [];
    onReject = info => rejects.push(info);

    Table.startOnline(null, handler => srv.connect(null, handler));
    await sleep(30);
    let v = Table.view();
    if (v && v.phase === 'idle') Table.act({ type: 'start' });
    await sleep(80);

    v = Table.view();
    const me = Table.seat();
    check(!!v, 'no view arrived at all');

    if (v && me !== null) {
      /* A card this seat does not hold. The server must refuse it, and must not
       * say which seat does hold it. */
      const mine = new Set(v.players[me].hand.map(c => c.id));
      const notMine = C.newDeck().map(c => c.id).filter(id => !mine.has(id));
      Table.act({ type: 'play', card: notMine[0] });
      await sleep(80);

      check(rejects.length > 0, 'the server accepted a card the seat does not hold, ' +
        'or refused it without telling the client');
      if (rejects.length) {
        const why = String(rejects[0].reason || '');
        check(why.length > 0, 'a refusal arrived with no reason at all');
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

  /* ============ 3. THE VIEW CARRIES ENOUGH TO PLAY BY ============ */
  {
    const srv = LocalServer.create({ config: config(), latency: 1, botDelay: 1 });
    Table.startOnline(null, handler => srv.connect(null, handler));
    await sleep(30);
    if ((Table.view() || {}).phase === 'idle') Table.act({ type: 'start' });

    let checked = false;
    for (let i = 0; i < 600 && !checked; i++) {
      const v = Table.view();
      const me = Table.seat();
      if (v && me !== null && v.phase === 'play') {
        ['phase', 'turn', 'leader', 'dealer', 'dealNumber', 'trick', 'tricksPlayed',
         'spadesBroken', 'players', 'history', 'scores', 'bags'].forEach(k => {
          check(v[k] !== undefined, 'the view has no ' + k + ', so the interface cannot draw it');
        });
        v.players.forEach((p, i2) => {
          ['name', 'occupant', 'team', 'bid', 'tricks', 'hand'].forEach(k => {
            check(p[k] !== undefined, 'seat ' + i2 + ' has no ' + k + ' in the view');
          });
        });

        /* The rules of the table reached this client. Without these it would
         * count bags to a different limit than the server does, and the two
         * would disagree about the score with nothing to say which was right. */
        check(G.targetOf(v) === 250, 'the client would play to ' + G.targetOf(v) + ', not 250');
        check(G.bagLimitOf(v) === 10, 'the bag limit did not reach the client');
        check(G.nilValueOf(v) === 100, 'the nil value did not reach the client');

        /* The partnerships are derivable from the view, which is what every
         * "us and them" line in the interface depends on. */
        check(v.players[0].team === v.players[2].team &&
              v.players[1].team === v.players[3].team &&
              v.players[0].team !== v.players[1].team,
          'the view does not describe the partnerships correctly');
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
  console.log('The shared transport runs spades, and a client can play from the view alone.');
}

main().catch(e => { console.error('online: threw — ' + e.stack); process.exit(1); });

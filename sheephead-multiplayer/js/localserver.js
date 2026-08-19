/* Sheephead - an authoritative server that happens to be in this tab.
 *
 * Same contract as the Durable Object that will replace it: it owns the only
 * real state, it decides what each seat may see, it refuses moves from seats
 * that are not entitled to make them, and it answers asynchronously after a
 * delay. Nothing here is a mock in the usual sense — the rules engine, the
 * authorization gate and the projection are the real ones. What is faked is the
 * network, and only the network.
 *
 * This exists for three reasons, in order of how much they matter:
 *
 *   1. The asynchronous client code has to be testable before the real server
 *      exists. Otherwise "the card does not move until the server says so" gets
 *      written blind, discovered broken during the first two-player test, and
 *      debugged across two machines and a websocket.
 *
 *   2. It proves the projection is sufficient. If a browser can play a complete
 *      hand from views alone, the views carry everything the interface needs. A
 *      field missing from js/view.js fails here, on a machine with a debugger,
 *      rather than online six weeks later.
 *
 *   3. THE SEAT COMES FROM THE CONNECTION, NEVER FROM THE MESSAGE. That is the
 *      property the whole authorization layer rests on, and it is a property of
 *      the server rather than of applyAction — one careless line reading
 *      msg.seat would reinstate the hole with the gate fully in place. Writing
 *      it here, now, means the Durable Object has a shape to copy instead of a
 *      decision to make.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var G = SH.Game;
  var V = SH.View;
  var AI = SH.AI;

  function create(opts) {
    opts = opts || {};
    var latency = opts.latency === undefined ? 0 : opts.latency;   // each way
    var jitter = !!opts.jitter;
    /* Deterministic by default so a failure is reproducible; the seed is an
     * option so a soak run can vary it. */
    var rseed = opts.seed === undefined ? 12345 : opts.seed;
    function rand() {
      rseed = (rseed * 1103515245 + 12345) & 0x7fffffff;
      return rseed / 0x7fffffff;
    }
    var botDelay = opts.botDelay === undefined ? 300 : opts.botDelay;
    var state = G.createGame(opts.config);

    /* Nobody is sitting anywhere until they connect.
     *
     * createGame marks seat 0 human, which is right for a browser playing alone
     * and wrong for a server: with a single client connected at seat 3, seat 0
     * stayed "human", the bot pump correctly declined to play a seat somebody was
     * supposedly occupying, and the table waited for ever on a player who did not
     * exist. Empty seats are bots until a person takes them. */
    for (var s0 = 0; s0 < state.players.length; s0++) state.players[s0].occupant = 'bot';
    /* Everything the room knows that is not the game itself. Kept in one object
     * on purpose: a Durable Object has to PERSIST all of this, and losing any of
     * it produces a wrong game rather than an obvious failure. `version` reset to
     * zero means every client silently discards every later view as stale and the
     * board freezes with no error; `cursors` reset means the whole log is replayed
     * to everyone; `lastSeq` reset means a retried frame plays a second card. */
    var room = {
      version: 0,
      cursors: {},     // seat -> highest event id sent
      lastSeq: {},     // seat -> highest action sequence applied, for idempotency
      lastAck: {}      // seat -> sequence to echo on the next view
    };
    var connections = {};        // seat -> {handler, token}
    var nextToken = 1;
    var botTimer = null;
    var stopped = false;
    var wedged = false;          // an engine fault has made the state untrustworthy

    /* Seats nobody is sitting in are played by the computer. Occupancy lives on
     * the state because the engine's own messages depend on it, and because a
     * seat that empties mid-hand has to keep playing rather than stall the
     * table. */
    function seatIsBot(i) { return state.players[i].occupant !== 'human'; }

    /* Jitter is not decoration.
     *
     * With a constant delay every message takes the same time, so setTimeout
     * ordering makes the fake wire perfectly FIFO — and a FIFO, lossless,
     * non-duplicating wire cannot produce the reordering that the version guard,
     * the sequence correlation and the idempotency check all exist to survive.
     * A test running on such a wire proves those guards compile.
     *
     * Varying the delay per message is the cheapest way to make the harness
     * capable of failing. It is also more honest about what a socket does. */
    function later(fn, ms) {
      if (stopped) return null;
      var d = jitter ? ms * (0.5 + rand() * 1.5) : ms;
      return setTimeout(function () { if (!stopped) fn(); }, d);
    }

    function broadcast() {
      if (wedged) return;
      room.version++;
      Object.keys(connections).forEach(function (key) {
        var seat = Number(key);
        var conn = connections[key];

        /* Slice by event ID, not by array index. Index arithmetic is correct only
         * while state.events is never truncated — an invariant nothing enforced,
         * on a log that grows for the room's whole lifetime. */
        var since = room.cursors[seat];
        var fresh = G.eventsFor(state, seat, typeof since === 'number' ? since : -1);
        var lastId = -1;
        for (var i = 0; i < state.events.length; i++) {
          var e = state.events[i];
          if (e.audience === undefined || e.audience === seat) lastId = e.id;
        }
        room.cursors[seat] = lastId;

        var payload = {
          type: 'view',
          version: room.version,
          ackSeq: room.lastAck[seat],   // which of this seat's moves this view includes
          view: V.forSeat(state, seat),
          events: fresh
        };

        var wire;
        try {
          // Serialize on the way out. Anything that cannot survive JSON would not
          // survive a socket either, and finding that out here is much cheaper.
          wire = JSON.stringify(payload);
        } catch (err) {
          // One unserializable view must not cost the other seats their update.
          return;
        }
        later(function () {
          var still = connections[key];
          // Guard on the connection TOKEN, not the handler: the client's receive
          // is one shared function, so a disconnect and reconnect at the same
          // seat re-registers the same reference and an identity check passes.
          if (still && still.token === conn.token) still.handler(JSON.parse(wire));
        }, latency);
      });
    }

    /* Bots act on the FULL state, never on a projection.
     *
     * ai.js reads state.buried when it is the picker and state.alone through
     * allyProb, and a view withholds both by design. Handing it a projection
     * would not throw; it would quietly make the computer play badly, which is
     * the kind of bug that gets diagnosed as "the AI feels off" for a month. */
    function pumpBots() {
      if (stopped || botTimer) return;
      if (state.phase === 'handOver' || state.phase === 'idle') return;

      var seat = state.phase === 'bury' ? state.picker : state.turn;
      if (seat < 0 || !seatIsBot(seat)) return;

      botTimer = later(function () {
        botTimer = null;
        if (stopped || wedged) return;
        /* An AI fault must not take the room down or, worse, stall it silently.
         * Without this, a throw inside the timer leaves botTimer null with no
         * broadcast and no further pump — the table simply stops, mid-hand, with
         * an uncaught exception nobody at the table can see. */
        try {
          AI.act(state);
        } catch (err) {
          wedged = true;
          announceFault('the computer players could not continue');
          return;
        }
        broadcast();
        pumpBots();
      }, botDelay);
    }

    /* An engine fault means the state is no longer trustworthy.
     *
     * game.js is explicit that `fatal` is never to be shown to a player as an
     * ordinary refusal, and this file was doing exactly that: sending it down the
     * rejection path with a view OF THE CORRUPT STATE, then carrying on pumping
     * bots and broadcasting it. That is the outcome game.js calls strictly worse
     * than a crash — a wedged game, checkpointed, with everyone told nothing
     * happened. A real room reloads from its last good snapshot; this one has no
     * snapshot to reload, so it stops and says so. */
    function announceFault(reason) {
      Object.keys(connections).forEach(function (key) {
        var conn = connections[key];
        later(function () {
          conn.handler({ type: 'fault', reason: reason });
        }, latency);
      });
    }

    function applyFromSeat(seat, action) {
      var r = G.applyAction(state, seat, action);
      if (r.fatal) {
        wedged = true;
        clearTimeout(botTimer);
        botTimer = null;
        announceFault(r.reason || 'the game could not continue');
        return r;
      }
      if (r.ok) {
        broadcast();
        pumpBots();
      }
      return r;
    }

    return {
      /* Sit down. The returned object is the ONLY way to talk to the server, and
       * it has the seat baked into the closure — there is no field on any message
       * that can change which seat a move comes from. */
      /* Sit down at a seat, if it is free.
       *
       * The seat is a parameter here and that is the point of the review that
       * produced this comment: the message handler genuinely ignores msg.seat, so
       * a client cannot act as somebody else — but the CONNECTION's seat was
       * whatever the caller asked for, with no validation and no check that
       * anybody was already in it. One caller opened seats 0, 1 and 4 and read
       * all three hands. The hole was not closed, it was moved one level up.
       *
       * The Durable Object will validate a room token here and assign or approve
       * the seat. This does the part that is not about identity: refuse an index
       * that is not a seat, and refuse a seat somebody is already sitting in.
       *
       * Returns null on refusal — there is no link to hand back. */
      connect: function (seat, onMessage) {
        if (typeof seat !== 'number' || seat !== Math.floor(seat) ||
            seat < 0 || seat >= state.players.length) {
          return null;
        }
        if (connections[seat]) return null;          // that seat is taken
        if (typeof onMessage !== 'function') return null;

        var token = nextToken++;
        var open = true;
        connections[seat] = { handler: onMessage, token: token };
        if (room.cursors[seat] === undefined) room.cursors[seat] = -1;
        state.players[seat].occupant = 'human';

        later(function () {
          if (!open) return;
          var fresh = G.eventsFor(state, seat, room.cursors[seat]);
          var lastId = -1;
          for (var i = 0; i < state.events.length; i++) {
            var e = state.events[i];
            if (e.audience === undefined || e.audience === seat) lastId = e.id;
          }
          room.cursors[seat] = lastId;
          onMessage({
            type: 'welcome',
            seat: seat,
            version: ++room.version,
            view: V.forSeat(state, seat),
            events: fresh
          });
        }, latency);

        function hangUp(why) {
          if (!open) return;
          open = false;
          if (connections[seat] && connections[seat].token === token) {
            delete connections[seat];
            /* Away, not bot: the seat still belongs to whoever was in it, and the
             * distinction is what lets them reclaim it later. The AI plays an
             * away seat so the table does not stall. */
            state.players[seat].occupant = 'away';
          }
          broadcast();
          pumpBots();
        }

        return {
          seat: seat,
          send: function (msg) {
            /* A closed link must not be able to move anything. It could: the
             * returned closure had no open flag, so send() after close() still
             * made the move — while the seat was marked away and the bot pump was
             * also driving it. Two actors, one seat. */
            if (stopped || !open || wedged) return;
            later(function () {
              if (!open || wedged) return;
              if (!msg || typeof msg !== 'object') return;

              if (msg.type === 'action') {
                /* Idempotency lives on the server, because the client is the one
                 * side that cannot be trusted to have it. A frame retried after a
                 * flaky reconnect must not play a second card, and a hostile
                 * client can simply send the same play twice. */
                if (typeof msg.seq === 'number') {
                  var last = room.lastSeq[seat];
                  if (typeof last === 'number' && msg.seq <= last) {
                    room.lastAck[seat] = msg.seq;
                    later(function () {
                      if (open) onMessage({
                        type: 'view', version: ++room.version, ackSeq: msg.seq,
                        view: V.forSeat(state, seat), events: []
                      });
                    }, latency);
                    return;
                  }
                  room.lastSeq[seat] = msg.seq;
                  room.lastAck[seat] = msg.seq;
                }

                // seat from the closure; msg.seat, if present, is ignored.
                var r = applyFromSeat(seat, msg.action);
                if (!r.ok && !r.fatal) {
                  later(function () {
                    if (!open) return;
                    onMessage({
                      type: 'rejected',
                      seq: msg.seq,
                      reason: r.reason,
                      version: ++room.version,
                      view: V.forSeat(state, seat)
                    });
                  }, latency);
                }
                return;
              }

              if (msg.type === 'leave') hangUp('left');
            }, latency);
          },
          close: function () { hangUp('closed'); }
        };
      },

      /* Deal the first hand and start the table running. */
      start: function () {
        G.newHand(state);
        broadcast();
        pumpBots();
      },

      stop: function () {
        stopped = true;
        clearTimeout(botTimer);
        botTimer = null;
      },

      /* For tests and for the eventual admin view. Never handed to a client. */
      peek: function () { return state; }
    };
  }

  SH.LocalServer = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);

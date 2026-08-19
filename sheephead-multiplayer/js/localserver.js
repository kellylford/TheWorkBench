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
    var connections = {};        // seat -> handler
    var version = 0;
    var cursors = {};            // seat -> how far through the event list it has read
    var botTimer = null;
    var stopped = false;

    /* Seats nobody is sitting in are played by the computer. Occupancy lives on
     * the state because the engine's own messages depend on it, and because a
     * seat that empties mid-hand has to keep playing rather than stall the
     * table. */
    function seatIsBot(i) { return state.players[i].occupant !== 'human'; }

    function later(fn, ms) {
      if (stopped) return null;
      return setTimeout(function () { if (!stopped) fn(); }, ms);
    }

    function broadcast() {
      version++;
      Object.keys(connections).forEach(function (key) {
        var seat = Number(key);
        var all = G.eventsFor(state, seat);
        var fresh = all.slice(cursors[seat] || 0);
        cursors[seat] = all.length;

        var payload = {
          type: 'view',
          version: version,
          view: V.forSeat(state, seat),
          events: fresh
        };
        // Serialize on the way out. Anything that cannot survive JSON would not
        // survive a socket either, and finding that out here is much cheaper.
        var wire = JSON.stringify(payload);
        var handler = connections[key];
        later(function () { if (connections[key] === handler) handler(JSON.parse(wire)); }, latency);
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
        if (stopped) return;
        AI.act(state);
        broadcast();
        pumpBots();
      }, botDelay);
    }

    function applyFromSeat(seat, action) {
      var r = G.applyAction(state, seat, action);
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
      connect: function (seat, onMessage) {
        connections[seat] = onMessage;
        cursors[seat] = 0;
        state.players[seat].occupant = 'human';

        later(function () {
          onMessage({
            type: 'welcome',
            seat: seat,
            version: ++version,
            view: V.forSeat(state, seat),
            events: G.eventsFor(state, seat)
          });
          cursors[seat] = G.eventsFor(state, seat).length;
        }, latency);

        return {
          seat: seat,
          send: function (msg) {
            if (stopped) return;
            later(function () {
              if (!msg || typeof msg !== 'object') return;

              if (msg.type === 'action') {
                // seat from the closure; msg.seat, if present, is ignored.
                var r = applyFromSeat(seat, msg.action);
                if (!r.ok) {
                  later(function () {
                    onMessage({
                      type: 'rejected',
                      seq: msg.seq,
                      reason: r.reason,
                      fatal: !!r.fatal,
                      version: version,
                      view: V.forSeat(state, seat)
                    });
                  }, latency);
                } else if (msg.seq !== undefined) {
                  later(function () {
                    onMessage({ type: 'accepted', seq: msg.seq, version: version });
                  }, latency);
                }
                return;
              }

              if (msg.type === 'leave') {
                delete connections[seat];
                state.players[seat].occupant = 'away';
                broadcast();
                pumpBots();
              }
            }, latency);
          },
          close: function () {
            delete connections[seat];
            state.players[seat].occupant = 'away';
            pumpBots();
          }
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

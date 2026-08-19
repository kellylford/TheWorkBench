/* Sheephead - the actual wire.
 *
 * Everything above this file already works against a fake network: table.js
 * cannot tell the difference, and tests/online.js plays whole hands over a
 * jittered in-process link. So this is the smallest thing that can carry those
 * messages over a real socket, and deliberately no cleverer.
 *
 * What it does add, because a real socket has failures the fake one does not:
 *
 *   - It reports its own state. "Connecting", "connected", "the table has gone"
 *     are things a player needs told, and for somebody who cannot see a spinner
 *     they are the ONLY way to tell a slow table from a dead one. Silence is the
 *     failure a screen reader user cannot diagnose.
 *   - It pings. A socket that has died without a close frame looks exactly like
 *     a table where everybody is thinking, and a card game has long quiet
 *     stretches by design.
 *   - It never reconnects silently. Coming back is a decision with consequences
 *     — a seat may have been taken over by the AI meanwhile — so it says so and
 *     lets the game layer decide.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  /* Where the room service lives. A plain constant because there is no build
   * step to substitute one, and a protocol version so that a client cached in
   * somebody's browser against a newer server is told to reload rather than
   * failing in some inventive way. */
  var DEFAULT_BASE = 'https://sheephead-room.kellylford.workers.dev';
  var PROTOCOL = 1;

  var PING_EVERY = 25000;      // under any sensible idle timeout
  var PONG_GRACE = 10000;      // a pong overdue by this much means the wire is gone

  function httpBase(base) { return (base || DEFAULT_BASE).replace(/\/+$/, ''); }
  function wsBase(base) { return httpBase(base).replace(/^http/, 'ws'); }

  /* Ask the server for a new table. Resolves with the code people will read to
   * each other. */
  function createTable(opts) {
    var base = httpBase(opts && opts.base);
    return fetch(base + '/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: PROTOCOL, config: (opts && opts.config) || null })
    }).then(function (r) {
      if (!r.ok) throw new Error('the server would not make a table (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      if (!j || !j.code) throw new Error('the server did not give us a code');
      return j.code;
    });
  }

  /* Open a connection for one seat at one table.
   *
   * `onMessage` receives already-parsed messages, exactly as the in-process
   * server delivers them, so table.js needs no branch for which one it is
   * talking to. `onStatus` receives connection state, which is NOT a game
   * message and must not be smuggled in as one. */
  function connect(opts, onMessage, onStatus) {
    var base = wsBase(opts.base);
    var url = base + '/join?code=' + encodeURIComponent(opts.code) +
      '&seat=' + encodeURIComponent(opts.seat) +
      '&name=' + encodeURIComponent(opts.name || '') +
      '&protocol=' + PROTOCOL;

    var ws = null;
    var open = false;
    var pingTimer = null;
    var pongTimer = null;
    var closedBy = null;         // 'us' | 'them' | 'error'

    function status(state, detail) {
      if (typeof onStatus === 'function') onStatus({ state: state, detail: detail });
    }

    function stopTimers() {
      clearInterval(pingTimer); pingTimer = null;
      clearTimeout(pongTimer); pongTimer = null;
    }

    function startPings() {
      stopTimers();
      pingTimer = setInterval(function () {
        if (!open) return;
        try { ws.send(JSON.stringify({ type: 'ping', at: Date.now() })); } catch (e) { return; }
        /* A socket that dies without a close frame is indistinguishable from a
         * table where everybody is thinking, and this game has long quiet
         * stretches by design. If the pong does not come, say so rather than
         * leaving the player waiting on nothing. */
        clearTimeout(pongTimer);
        pongTimer = setTimeout(function () {
          status('lost', 'the table stopped answering');
          try { ws.close(4000, 'no pong'); } catch (e) { /* already gone */ }
        }, PONG_GRACE);
      }, PING_EVERY);
    }

    status('connecting');
    try {
      ws = new global.WebSocket(url);
    } catch (e) {
      status('failed', 'could not open a connection');
      return { send: function () {}, close: function () {} };
    }

    ws.onopen = function () {
      open = true;
      status('connected');
      startPings();
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'pong') { clearTimeout(pongTimer); pongTimer = null; return; }

      /* A fault is the server saying its own state is untrustworthy. It is not a
       * refusal and must not be shown as one — see the note on `fatal` in
       * game.js. */
      if (msg.type === 'fault') {
        status('fault', msg.reason || 'the table stopped');
        return;
      }
      onMessage(msg);
    };

    ws.onclose = function (ev) {
      open = false;
      stopTimers();
      if (closedBy === 'us') { status('closed'); return; }
      /* 4001 is the room refusing the seat — somebody is already in it, or it is
       * not a seat at this table. That is a different thing from the connection
       * dropping, and telling a player "connection lost" when the truth is
       * "that seat is taken" sends them looking for a network problem. */
      if (ev && ev.code === 4001) status('refused', ev.reason || 'that seat is not available');
      else status('lost', (ev && ev.reason) || 'the connection closed');
    };

    ws.onerror = function () {
      /* onerror gives nothing useful and is always followed by onclose, so the
       * message the player sees is written there. */
      closedBy = closedBy || 'error';
    };

    return {
      send: function (msg) {
        if (!open) return;
        try { ws.send(JSON.stringify(msg)); } catch (e) { status('lost', 'the message could not be sent'); }
      },
      close: function () {
        closedBy = 'us';
        stopTimers();
        try { ws.send(JSON.stringify({ type: 'leave' })); } catch (e) { /* going anyway */ }
        try { ws.close(1000, 'left'); } catch (e) { /* already gone */ }
      }
    };
  }

  SH.Net = {
    DEFAULT_BASE: DEFAULT_BASE,
    PROTOCOL: PROTOCOL,
    createTable: createTable,
    connect: connect
  };
})(typeof window !== 'undefined' ? window : globalThis);

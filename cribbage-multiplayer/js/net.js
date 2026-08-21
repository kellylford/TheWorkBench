/* Cribbage - the actual wire.
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

  /* Where the room service lives. A plain constant because there is no build step
   * to substitute one.
   *
   * The subdomain is the ACCOUNT's, not the repository owner's — this account's
   * workers.dev name happens to be "quickmail", after the first Worker deployed
   * on it. Guessing it from the GitHub username produced a host that does not
   * resolve, so the first real deploy shipped a client pointing at nothing: the
   * Worker was live and answering, and no browser could have reached it.
   * Confirmed against the deploy output rather than assumed a second time. */
  var DEFAULT_BASE = 'https://cribbage-room.quickmail.workers.dev';
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
    /* No seat parameter unless one was actually asked for. Sending "seat=null"
     * would be a request for a seat named null rather than no request at all. */
    var url = base + '/join?code=' + encodeURIComponent(opts.code) +
      (opts.seat === undefined || opts.seat === null
        ? '' : '&seat=' + encodeURIComponent(opts.seat)) +
      '&name=' + encodeURIComponent(opts.name || '') +
      '&protocol=' + PROTOCOL;

    var ws = null;
    var open = false;
    var pingTimer = null;
    var pongTimer = null;
    var onVisible = null;        // the visibilitychange listener, so it can be removed
    var awaitingPong = false;    // a ping is out and unanswered
    var closedBy = null;         // 'us' | 'them' | 'error'

    function status(state, detail) {
      if (typeof onStatus === 'function') onStatus({ state: state, detail: detail });
    }

    function stopTimers() {
      clearInterval(pingTimer); pingTimer = null;
      clearTimeout(pongTimer); pongTimer = null;
      awaitingPong = false;
      if (onVisible) {
        try { global.document.removeEventListener('visibilitychange', onVisible); } catch (e) { /* no document */ }
        onVisible = null;
      }
    }

    /* One ping, now. The interval is not the only thing entitled to send one. */
    function pingNow() {
      if (!open) return;
      var sentAt = Date.now();

      /* ARMED BEFORE THE SEND, and cleared by a flag rather than by whether a
       * particular timer id is still live.
       *
       * Arming afterwards assumes the answer cannot beat the timer, and there is
       * no such guarantee to lean on: the pong handler clears whatever timer
       * exists WHEN IT RUNS, so a pong that arrives during send() clears the
       * previous ping's timer and the fresh one is then armed with nothing left
       * to cancel it. The client would hang up ten seconds later on a socket
       * that had just answered. table.js learned the same lesson about its own
       * answer timeout, in the same direction: arm first. */
      awaitingPong = true;
      clearTimeout(pongTimer);
      pongTimer = setTimeout(function () {
        /* A TIMER THAT FIRED LATE WAS FROZEN, NOT IGNORED — check the clock
         * before accusing the wire.
         *
         * This is a ten second deadline. If it fires and the better part of a
         * minute has actually passed, nothing about the connection has been
         * demonstrated: the browser suspended this tab and ran the callback
         * whenever it got round to it, and the pong may well have been sitting
         * there unprocessed the whole time. Chrome does this to any backgrounded
         * tab, and freezes them outright after a few minutes.
         *
         * So the client hung up on a perfectly good socket every time the player
         * alt-tabbed for a while, and then — having closed it itself — never
         * reconnected and left the board showing a hand that had stopped being
         * true. Observed at a real table: the seat went quiet, the room played
         * it out, and the browser was fine the entire time.
         *
         * Ping again instead. If the wire really is gone, the next attempt runs
         * on an unthrottled timer once the tab is visible, and says so then. */
        if (!awaitingPong) return;              // answered already
        var late = Date.now() - sentAt;
        if (late > PONG_GRACE * 2) { pingNow(); return; }
        status('lost', 'the table stopped answering');
        try { ws.close(4000, 'no pong'); } catch (e) { /* already gone */ }
      }, PONG_GRACE);

      try {
        ws.send(JSON.stringify({ type: 'ping', at: sentAt }));
      } catch (e) {
        awaitingPong = false;
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    }

    function startPings() {
      stopTimers();
      pingTimer = setInterval(pingNow, PING_EVERY);

      /* AND A PING THE MOMENT THE TAB COMES BACK TO THE FRONT.
       *
       * The interval alone is not enough to prove a browser is alive, because
       * the browser is what slows it down: Chrome throttles timers in a hidden
       * tab to roughly once a minute, and harder after a few minutes. The
       * server reads these pings to tell a player who is thinking from one
       * whose browser has gone, so a throttled tab looks progressively more
       * like a dead one the longer it sits behind another window.
       *
       * That was not a theory — it took both seats at a real table at once and
       * the computer played out the hand for two people who were sitting right
       * there. The server's window was widened to cover the throttled rate; this
       * is the other half, and it costs one frame. Becoming visible is the one
       * moment we can be certain somebody is looking. */
      try {
        if (global.document && typeof global.document.addEventListener === 'function') {
          onVisible = function () {
            if (global.document.visibilityState === 'visible') pingNow();
          };
          global.document.addEventListener('visibilitychange', onVisible);
        }
      } catch (e) { /* no document: tests and the Worker */ }
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

      if (msg.type === 'pong') {
        awaitingPong = false;
        clearTimeout(pongTimer);
        pongTimer = null;
        return;
      }

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
      if (ev && ev.code === 4004) status('nosuch', ev.reason || 'no table with that code');
      else if (ev && ev.code === 4001) status('refused', ev.reason || 'that seat is not available');
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

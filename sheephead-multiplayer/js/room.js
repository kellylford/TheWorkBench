/* Sheephead - a room, with nothing platform-specific in it.
 *
 * This is the game server's logic. It does not know what a Durable Object is, or
 * a WebSocket, or setTimeout. Everything that touches the outside world is passed
 * in: storage, a clock, an alarm scheduler, and a way to send a message to a
 * connection. That is not architecture for its own sake — it is what makes the
 * whole thing testable in plain Node, including the part that cannot be tested
 * any other way.
 *
 * THE PART THAT CANNOT BE TESTED ANY OTHER WAY is eviction. A Durable Object is
 * evicted and woken constantly, and three of the things it holds produce a WRONG
 * GAME rather than an obvious failure if they do not survive:
 *
 *   version   resets to 0, so every client — holding versions in the hundreds —
 *             silently discards every view that follows as stale. The board
 *             freezes. No error, no timeout, views arriving and being dropped.
 *   cursors   reset, so the entire game's event log is replayed to every seat and
 *             a screen reader recites the whole hand again.
 *   lastSeq   resets, so a frame retried after a reconnect plays a second card.
 *
 * None of those is visible in a process that never evicts. So `hibernate()` and
 * `wake()` are first-class operations here, and tests/room.js drives a real hand
 * across several of them.
 *
 * Everything that decides the GAME still lives in game.js and view.js: this file
 * owns delivery, seating and persistence, and never rules on the rules.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var G = SH.Game;
  var V = SH.View;
  var AI = SH.AI;

  var STATE_KEY = 'state';
  var ROOM_KEY = 'room';

  /* The engine's card objects are shared singletons, and JSON turns them into
   * plain copies. Nothing compares cards by identity — every helper reads .id,
   * .r and .s — so a copy is as good as the original on either side of storage.
   * That is checked by tests/room.js rather than assumed. */
  function reviveState(raw) { return raw; }

  function createRoom(opts) {
    var storage = opts.storage;                 // {get, put} returning plain values
    var now = opts.now || function () { return 0; };
    var scheduleAlarm = opts.setAlarm || function () {};
    var deliver = opts.deliver;                 // (connId, message) -> void
    var botDelay = opts.botDelay === undefined ? 1200 : opts.botDelay;
    var turnGrace = opts.turnGrace === undefined ? 0 : opts.turnGrace;

    var state = null;
    var room = null;
    var conns = {};        // connId -> {seat}
    var loaded = false;

    /* ---------------- persistence ---------------- */

    function blankRoom(n) {
      return {
        version: 0,
        cursors: {},       // seat -> highest event id delivered
        lastSeq: {},       // seat -> highest action sequence applied
        lastAck: {},       // seat -> sequence to echo on the next view
        seats: {},         // seat -> {name, token} for whoever holds it
        wedged: false,
        botDue: 0,         // when the next bot move is due, 0 for none
        turnSince: 0       // when the seat now on turn became responsible for it
      };
    }

    function load() {
      if (loaded) return;
      var s = storage.get(STATE_KEY);
      var r = storage.get(ROOM_KEY);
      if (s) { state = reviveState(s); room = r || blankRoom(); }
      else {
        state = G.createGame(opts.config);
        // Nobody is sitting anywhere until they connect. createGame marks seat 0
        // human, which is right for a browser playing alone and wrong here.
        for (var i = 0; i < state.players.length; i++) state.players[i].occupant = 'bot';
        room = blankRoom();
      }
      loaded = true;
    }

    function persist() {
      storage.put(STATE_KEY, state);
      storage.put(ROOM_KEY, room);
    }

    /* Drop everything held in memory, exactly as eviction does. Whatever is not
     * in storage by now is gone. */
    function hibernate() {
      persist();
      state = null;
      room = null;
      loaded = false;
      // conns is deliberately NOT cleared: the sockets outlive the object, and
      // the platform hands them back on wake. wake() rebuilds from what it is
      // given rather than from this.
    }

    function wake(liveConnections) {
      loaded = false;
      load();
      conns = {};
      (liveConnections || []).forEach(function (c) { conns[c.id] = { seat: c.seat }; });
    }

    /* ---------------- delivery ---------------- */

    function highestEventIdFor(seat) {
      var last = -1;
      for (var i = 0; i < state.events.length; i++) {
        var e = state.events[i];
        if (e.audience === undefined || e.audience === seat) last = e.id;
      }
      return last;
    }

    function viewFor(connId, seat) {
      var since = room.cursors[seat];
      var fresh = G.eventsFor(state, seat, typeof since === 'number' ? since : -1);
      room.cursors[seat] = highestEventIdFor(seat);
      return {
        type: 'view',
        version: room.version,
        ackSeq: room.lastAck[seat],
        view: V.forSeat(state, seat),
        events: fresh
      };
    }

    function broadcast() {
      if (room.wedged) return;
      room.version++;
      Object.keys(conns).forEach(function (id) {
        var seat = conns[id].seat;
        var payload = viewFor(id, seat);
        var wire;
        try {
          // Serialize here so an unserializable view is one seat's problem rather
          // than everybody's, and so it fails on this machine rather than in a
          // socket write.
          wire = JSON.stringify(payload);
        } catch (e) { return; }
        deliver(id, JSON.parse(wire));
      });
      persist();
    }

    function announceFault(reason) {
      Object.keys(conns).forEach(function (id) {
        deliver(id, { type: 'fault', reason: reason });
      });
    }

    /* ---------------- bots, driven by alarms ---------------- */

    /* A hibernated Durable Object has no timers. Every delay in this game — the
     * bot's, and later the turn clock and the disconnect grace — has to be an
     * alarm, or the table stops mid-hand with nothing to restart it and no error
     * anywhere. */
    function seatNeedingBot() {
      if (room.wedged) return -1;
      if (state.phase === 'handOver' || state.phase === 'idle') return -1;
      var seat = state.phase === 'bury' ? state.picker : state.turn;
      if (seat < 0) return -1;
      return state.players[seat].occupant === 'human' ? -1 : seat;
    }

    /* Whose turn it is, whoever they are. */
    function seatOnTurn() {
      if (state.phase === 'handOver' || state.phase === 'idle') return -1;
      return state.phase === 'bury' ? state.picker : state.turn;
    }

    function scheduleBots() {
      var botSeat = seatNeedingBot();

      if (botSeat >= 0) {
        if (room.botDue) return;               // already scheduled
        room.botDue = now() + botDelay;
        persist();
        scheduleAlarm(room.botDue);
        return;
      }

      /* THE TURN CLOCK.
       *
       * A seat only becomes 'away' when its socket closes cleanly. A laptop that
       * sleeps, a phone that loses signal, a browser killed outright: the seat
       * stays 'human', no bot will ever play it, and the table stalls for
       * everybody, permanently, with no message. Each other player's move
       * timeout says "the table has not answered" once and then nothing.
       *
       * So a human seat that has not moved within the grace period is treated as
       * away and played by the computer. They can take the seat back by
       * rejoining. Generous on purpose: reading a hand back with a screen reader
       * is a legitimate reason to be slow, and being timed out for thinking would
       * be a worse failure than the one this prevents. */
      var human = seatOnTurn();
      if (human < 0 || !turnGrace) { room.botDue = 0; persist(); return; }
      if (!room.turnSince) room.turnSince = now();
      room.botDue = room.turnSince + turnGrace;
      persist();
      scheduleAlarm(room.botDue);
    }

    function onAlarm() {
      load();
      room.botDue = 0;
      var seat = seatNeedingBot();

      /* Nobody to play for, so this alarm is the turn clock rather than a bot's
       * move: the seat on turn is a person who has not acted in time. */
      if (seat < 0) {
        var waiting = seatOnTurn();
        if (waiting >= 0 && turnGrace && room.turnSince &&
            now() - room.turnSince >= turnGrace &&
            state.players[waiting].occupant === 'human') {
          state.players[waiting].occupant = 'away';
          G.note(state, state.players[waiting].name +
            ' has stopped responding. The computer is playing that seat until they come back.');
          room.turnSince = 0;
          broadcast();
          scheduleBots();
          return;
        }
        persist();
        return;
      }
      try {
        AI.act(state);
      } catch (e) {
        /* An AI fault must not stall the table in silence. Without this the alarm
         * fires, the throw escapes, nothing is broadcast and nothing is
         * rescheduled — the game simply stops, mid-hand, with an uncaught
         * exception nobody at the table can see. */
        room.wedged = true;
        persist();
        announceFault('the computer players could not continue');
        return;
      }
      broadcast();
      scheduleBots();
    }

    /* ---------------- seats ---------------- */

    function seatIsFree(seat) {
      for (var id in conns) if (conns[id].seat === seat) return false;
      return true;
    }

    /* The lowest seat nobody is sitting in, or -1 if the table is full. */
    function firstFreeSeat() {
      for (var i = 0; i < state.players.length; i++) if (seatIsFree(i)) return i;
      return -1;
    }

    /* THE SERVER ASSIGNS THE SEAT.
     *
     * A client cannot choose one sensibly: it does not know which are free until
     * it has connected, and it cannot connect without asking for one. The first
     * version had the client guess, which meant it guessed seat 0 — so the second
     * person to arrive was told "that seat is taken" and could not join at all.
     *
     * Asking for a specific seat is still allowed, because reclaiming the seat
     * you were in is exactly that request, and it is refused if somebody is in
     * it. Asking for nothing means "put me anywhere", which is what joining by a
     * code actually means. */
    function join(connId, seat, name) {
      load();
      if (seat === undefined || seat === null) {
        seat = firstFreeSeat();
        if (seat < 0) return { ok: false, reason: 'this table is full' };
      }
      if (typeof seat !== 'number' || seat !== Math.floor(seat) ||
          seat < 0 || seat >= state.players.length) {
        return { ok: false, reason: 'that is not a seat at this table' };
      }
      /* A seat we have already concluded is abandoned yields to whoever asks for
       * it next — including the person who was in it.
       *
       * An ungraceful drop leaves the old connection registered until the
       * platform notices, which can be minutes. Requiring the seat to be free of
       * connections meant the turn clock correctly marked somebody away, the
       * computer took over, and then they could not get back in: "somebody is
       * already in that seat", and the somebody was them. */
      if (!seatIsFree(seat)) {
        if (state.players[seat].occupant !== 'away') {
          return { ok: false, reason: 'somebody is already in that seat' };
        }
        Object.keys(conns).forEach(function (id) {
          if (conns[id].seat === seat) delete conns[id];
        });
      }

      var wasAway = state.players[seat].occupant === 'away';
      conns[connId] = { seat: seat };
      state.players[seat].occupant = 'human';

      /* A new connection starts its sequence numbering again, so the room must
       * forget what the last one reached.
       *
       * table.js resets seq to 0 on every startOnline; the room keeps lastSeq in
       * durable storage. Without this, somebody who closed their tab after
       * twelve moves and came back had their next twelve keypresses treated as
       * duplicates: the room echoed a view each time, which cleared the client's
       * pending flag, so there was no timeout, no refusal and no message — the
       * card simply did not move. The same thing happened to a DIFFERENT person
       * taking a seat somebody had vacated. */
      room.lastSeq[seat] = undefined;
      room.lastAck[seat] = undefined;
      room.turnSince = now();

      if (wasAway) {
        G.note(state, state.players[seat].name + ' is back.');
      }
      if (name) state.players[seat].name = String(name).slice(0, 16);
      if (room.cursors[seat] === undefined) room.cursors[seat] = -1;

      var fresh = G.eventsFor(state, seat, room.cursors[seat]);
      room.cursors[seat] = highestEventIdFor(seat);
      room.version++;
      persist();

      deliver(connId, {
        type: 'welcome',
        seat: seat,
        version: room.version,
        ackSeq: room.lastAck[seat],
        view: V.forSeat(state, seat),
        events: fresh
      });
      /* Tell the rest of the table, not just the person who arrived.
       *
       * join() only ever answered the joiner, so "Ruth is back" was written into
       * the log and delivered to Ruth. Everybody else — who had watched the
       * computer play her seat and been told why — was never told it had
       * stopped. Somebody sitting down is news for the table. */
      Object.keys(conns).forEach(function (id) {
        if (id === connId) return;
        room.version++;
        deliver(id, viewFor(id, conns[id].seat));
      });
      persist();

      scheduleBots();
      return { ok: true, seat: seat };
    }

    /* Send this connection a fresh view.
     *
     * The Cloudflare wrapper cannot write a socket's seat attachment until join()
     * has assigned one, and join() delivers the welcome before that — so on the
     * real platform the welcome is produced while the socket is still invisible
     * and goes nowhere. Rather than restructure join() around one platform's
     * ordering, the wrapper asks for it again once the socket can be found. */
    function resend(connId) {
      load();
      var c = conns[connId];
      if (!c) return;
      room.version++;
      persist();
      deliver(connId, viewFor(connId, c.seat));
    }

    function leave(connId) {
      load();
      var c = conns[connId];
      if (!c) return;
      delete conns[connId];
      /* Away, not bot: the seat still belongs to whoever was in it, and that
       * distinction is what will let them reclaim it. The AI plays an away seat
       * so the table does not stall while they are gone. */
      state.players[c.seat].occupant = 'away';
      broadcast();
      scheduleBots();
    }

    /* ---------------- moves ---------------- */

    function action(connId, msg) {
      load();
      var c = conns[connId];
      if (!c) return;                          // not at this table
      if (room.wedged) return;
      var seat = c.seat;                       // FROM THE CONNECTION. Never msg.seat.

      if (typeof msg.seq === 'number') {
        var last = room.lastSeq[seat];
        if (typeof last === 'number' && msg.seq <= last) {
          /* Already applied. Re-send the answer rather than the move: a frame
           * retried after a flaky reconnect must not play a second card, and the
           * client is the one side that cannot be trusted to have this. */
          room.lastAck[seat] = msg.seq;
          room.version++;
          /* viewFor advances the event cursor, so it must run BEFORE the write.
           * Persisting first rolled the cursor back on the next eviction and
           * replayed events this seat had already heard — the "screen reader
           * recites the whole hand again" failure this file is written to
           * prevent, reintroduced in the one path with no test. */
          var reply = viewFor(connId, seat);
          persist();
          deliver(connId, reply);
          return;
        }
        room.lastSeq[seat] = msg.seq;
        room.lastAck[seat] = msg.seq;
      }

      /* Dealing the next hand is first-come, and the loser is told so plainly.
       *
       * Two people pressing Deal at handOver is not a race to be prevented — the
       * first one is right, and the hand should start. What must not happen is
       * the second being told "the hand is not over" while a new hand is visibly
       * being dealt in front of them, which is what the raw engine refusal says.
       * A view is the honest answer: somebody already did it, here is the table. */
      if (msg.action && msg.action.type === 'nextHand' && state.phase !== 'handOver') {
        room.version++;
        var already = viewFor(connId, seat);
        persist();
        deliver(connId, already);
        return;
      }

      var r = G.applyAction(state, seat, msg.action);

      if (r.fatal) {
        /* game.js is explicit that this is never an ordinary refusal: the state is
         * untrustworthy now and must be discarded for the last good checkpoint.
         * Broadcasting it instead would checkpoint a wedged game and tell
         * everybody nothing happened. */
        room.wedged = true;
        room.botDue = 0;
        persist();
        announceFault(r.reason || 'the game could not continue');
        return;
      }

      if (!r.ok) {
        room.version++;
        persist();
        deliver(connId, {
          type: 'rejected',
          seq: msg.seq,
          reason: r.reason,
          version: room.version,
          view: V.forSeat(state, seat)
        });
        return;
      }

      room.turnSince = now();
      broadcast();
      scheduleBots();
    }

    function start() {
      load();
      G.newHand(state);
      broadcast();
      scheduleBots();
    }

    return {
      start: start,
      join: join,
      leave: leave,
      action: action,
      resend: resend,
      onAlarm: onAlarm,
      hibernate: hibernate,
      wake: wake,
      /* Tests and diagnostics only. Never sent to a client. */
      peek: function () { load(); return state; },
      peekRoom: function () { load(); return room; }
    };
  }

  SH.Room = { create: createRoom };
})(typeof window !== 'undefined' ? window : globalThis);

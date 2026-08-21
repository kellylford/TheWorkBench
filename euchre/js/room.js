/* Euchre - a room, with nothing platform-specific in it.
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

    /* How long a seat may hold up the table WHILE ITS CLIENT IS DEMONSTRABLY
     * STILL THERE, and how recently we must have heard from that client to
     * believe it.
     *
     * turnGrace answers "this seat has gone quiet"; these two answer "this seat
     * is thinking". They are not the same question and were being decided by the
     * same number, which is what made the turn clock take a present player's
     * cards off them — see the note in onAlarm. Zero disables the distinction
     * entirely, which is what every test that predates it gets. */
    var awayGrace = opts.awayGrace === undefined ? 0 : opts.awayGrace;
    /* Three minutes, not sixty seconds.
     *
     * Sixty was the default here even after the Worker was corrected, and sixty
     * is the exact number that took both seats at a real table: it is shorter
     * than the rate a backgrounded Chrome tab pings at. awayGrace defaults to 0
     * because 0 is a meaningful OFF — no presence distinction at all. There is
     * no equivalent reading of 60000. It is simply the wrong answer sitting
     * where the next wrapper, or a call site that forgets the option, would
     * pick it up. */
    var presenceWindow = opts.presenceWindow === undefined ? 180000 : opts.presenceWindow;

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
        botDue: 0,         // when the pending alarm is due, 0 for none
        /* WHAT the pending alarm is for: 'bot' (a computer seat is about to
         * move) or 'turn' (the turn clock is counting somebody out). Null when
         * nothing is scheduled.
         *
         * One field held both deadlines and nothing recorded which one it was,
         * so scheduleBots read a turn-clock deadline as "a bot move is already
         * scheduled" and returned without arming anything. Every time a player
         * moved and handed off to a computer seat, the next play came when the
         * TURN CLOCK expired instead of after botDelay — up to the whole grace
         * period later. Measured at 88 seconds against a 90 second grace, on
         * every single hand-off, and it looks exactly like a dead table. */
        dueKind: null,
        /* When the seat now on turn became responsible for it. null, not 0:
         * zero is a legitimate timestamp — the tests run on a clock that starts
         * there — and treating it as "unset" made the turn clock silently never
         * fire. Date.now() is never 0 in production, so this would have been a
         * latent bug that only ever bit somebody whose table stalled. */
        turnSince: null
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

    /* THE EVENT LOG IS NOT ALLOWED TO GROW FOR EVER.
     *
     * The engine appends to state.events and nothing on the server ever takes
     * anything out — in a browser the interface drains it, and there is no
     * interface here. So the whole room state, which is written to durable
     * storage on every single change, grows without bound for as long as the
     * table exists. Measured before this was added: about 6.5 KB per hand, which
     * puts a room past the Durable Object 128 KiB per-value limit at around hand
     * nineteen. Not a theoretical session length — that is two games of euchre.
     *
     * And the failure is silent in the worst way. The write starts failing while
     * everything in memory still works, so the table plays on perfectly until it
     * is evicted, and then comes back as whatever the last successful write
     * happened to be.
     *
     * The rule: never drop an event that a seat currently at the table has not
     * been given yet. Cursors are advanced by broadcast() the moment a view goes
     * out, so in practice this keeps a few hundred entries and drops the rest. A
     * player who is disconnected does not hold the log open — they are not in
     * `conns` — so when they come back they are given whatever survives, which
     * is a bounded amount of catching up rather than a wrong game. */
    var MAX_EVENTS = 300;

    function pruneEvents() {
      var excess = state.events.length - MAX_EVENTS;
      if (excess <= 0) return;
      var lowest = Infinity;
      for (var id in conns) {
        var c = room.cursors[conns[id].seat];
        lowest = Math.min(lowest, (typeof c === 'number') ? c : -1);
      }
      var cut = 0;
      while (cut < excess && state.events[cut].id <= lowest) cut++;
      if (cut > 0) state.events.splice(0, cut);
    }

    function persist() {
      pruneEvents();
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
      /* seenAt rides on the socket, not in storage: it is the platform handing
       * back "this connection last said something at". A wrapper that does not
       * supply it simply has no presence information, and the turn clock falls
       * back to its old behaviour rather than guessing. */
      (liveConnections || []).forEach(function (c) {
        conns[c.id] = { seat: c.seat, seenAt: typeof c.seenAt === 'number' ? c.seenAt : undefined };
      });
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
      /* Whose move it is, is a question about the RULES, not about the room —
       * the dealer's discard belongs to the dealer whoever is nominally on turn,
       * and a seat sitting out while its partner plays alone is skipped
       * entirely. Both of those live in game.js, and duplicating the reasoning
       * here is how the two come apart. */
      var seat = G.seatToAct(state);
      if (seat < 0) return -1;
      return state.players[seat].occupant === 'human' ? -1 : seat;
    }

    /* Whose turn it is, whoever they are. */
    function seatOnTurn() {
      return G.seatToAct(state);
    }

    /* Arm the one alarm this object gets, and record what it is for. */
    function armAlarm(kind, at) {
      room.dueKind = kind;
      room.botDue = at;
      persist();
      scheduleAlarm(at);
    }

    /* Has this seat's client been heard from lately?
     *
     * The client pings every twenty-five seconds and the Worker stamps the
     * socket when it does, so a browser that is still open answers this even
     * while its player reads their hand back. A laptop that has gone to sleep,
     * a phone that lost signal and a tab that was killed all leave the socket
     * looking open from here and stop answering — which is the distinction the
     * turn clock actually needs and did not have. */
    function seatIsPresent(seat) {
      if (!presenceWindow) return false;
      var best = null;
      for (var id in conns) {
        if (conns[id].seat !== seat) continue;
        var s = conns[id].seenAt;
        if (typeof s === 'number' && (best === null || s > best)) best = s;
      }
      return best !== null && now() - best <= presenceWindow;
    }

    function scheduleBots() {
      /* A wedged room schedules nothing at all.
       *
       * It used to fall out of this by accident, because the only path that
       * armed anything without a live bot seat also happened to persist and
       * return. Now that a consumed alarm re-arms the turn clock, a wedged room
       * would otherwise wake itself every grace period for ever — and could
       * still declare somebody away in a game that has already stopped. */
      if (room.wedged) {
        room.botDue = 0;
        room.dueKind = null;
        persist();
        return;
      }

      var botSeat = seatNeedingBot();

      if (botSeat >= 0) {
        /* Only a deadline already set FOR A BOT may be kept. Keeping any
         * pending deadline meant the turn clock's — which can be a minute and a
         * half out — silently became the bot's. */
        if (room.dueKind === 'bot' && room.botDue > now()) return;
        armAlarm('bot', now() + botDelay);
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
       * away and played by the computer. Generous on purpose: reading a hand
       * back with a screen reader is a legitimate reason to be slow, and being
       * timed out for thinking would be a worse failure than the one this
       * prevents — which is precisely what it turned out to be doing. See
       * onAlarm for what "not responding" now has to mean. */
      var human = seatOnTurn();
      if (human < 0 || !turnGrace) {
        room.botDue = 0;
        room.dueKind = null;
        persist();
        return;
      }
      if (room.turnSince === null || room.turnSince === undefined) room.turnSince = now();
      /* Never in the past.
       *
       * onAlarm's re-arm branch leaves turnSince deliberately stale, because the
       * grace period is measured from when the turn actually started. Callers
       * that do not refresh it — leave(), notably — then re-derive a deadline
       * that has already gone by, and Cloudflare fires a past-dated alarm at
       * once. Harmless in itself, but it burns a wake and restarts the presence
       * poll from now, so a flapping client at one seat could push another
       * seat's takeover out indefinitely. */
      armAlarm('turn', Math.max(now(), room.turnSince + turnGrace));
    }

    function onAlarm() {
      load();
      room.botDue = 0;
      room.dueKind = null;
      if (room.wedged) { persist(); return; }
      var seat = seatNeedingBot();

      /* Nobody to play for, so this alarm is the turn clock rather than a bot's
       * move: the seat on turn is a person who has not acted in time. */
      if (seat < 0) {
        var waiting = seatOnTurn();
        var idle = room.turnSince === null || room.turnSince === undefined
          ? -1 : now() - room.turnSince;
        if (waiting >= 0 && turnGrace && idle >= turnGrace &&
            state.players[waiting].occupant === 'human') {

          /* NOT RESPONDING IS NOT THE SAME AS THINKING, and conflating them took
           * a present player's cards off them and played them.
           *
           * Once the turn clock fired, the seat was 'away' for the rest of the
           * session: the computer played every remaining turn while the player
           * sat there connected, watching their own hand go down. Nothing put
           * them back — join() is the only thing that clears 'away', and a
           * client that never lost its socket never rejoins. Ninety seconds is
           * an ordinary length of time to spend deciding whether to order it up
           * when the hand has to be read aloud first, so this was reachable in
           * normal play, and once
           * reached it was permanent.
           *
           * A client that is still pinging is still there. Give it far longer,
           * and keep looking rather than deciding now — if the browser really
           * has gone, the next check finds it silent and takes the seat over
           * within the ordinary grace period of it going quiet. */
          if (awayGrace && idle < awayGrace && seatIsPresent(waiting)) {
            armAlarm('turn', now() + turnGrace);
            return;
          }

          state.players[waiting].occupant = 'away';
          /* "You has stopped responding" is what this said to anybody who left
           * their name as You, which is the default. game.js has carried a verb
           * helper for exactly this since the single-player game; the room was
           * writing prose without it. */
          G.note(state, state.players[waiting].name +
            G.vb(state, waiting, ' has', ' have') +
            ' stopped responding. The computer is playing that seat until they come back. ' +
            'Making any move takes the seat straight back.');
          room.turnSince = null;
          broadcast();
          scheduleBots();
          return;
        }
        /* Not time yet, or nobody to count out. Re-arm rather than persist and
         * walk away: this alarm has just been consumed, and leaving the turn
         * clock disarmed means a player who genuinely vanishes a moment later
         * stalls the table for ever, which is the exact failure the clock is
         * here to prevent. */
        scheduleBots();
        return;
      }
      /* The clock restarts whenever the turn changes hands, including when a bot
       * moves. Measuring the grace period from the last HUMAN action meant a
       * player could be marked away for a wait that happened while the computer
       * seats were still playing — the clock had been running against them
       * before it was their turn at all. */
      room.turnSince = now();
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
      // Arriving is itself proof of life, and the first ping is still 25 seconds
      // away. Without this a player who joined and then thought for a minute and
      // a half had no presence on record at all.
      conns[connId] = { seat: seat, seenAt: now() };
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
      var payload = viewFor(connId, c.seat);
      /* A WELCOME, not a view.
       *
       * `welcome` is the only frame that carries the seat, and it is how a client
       * learns which chair it is in. Sending a plain view here meant every player
       * connected successfully, received the whole game, and never found out
       * where they were sitting — seat stayed null, so nothing was ever their
       * turn and neither of them could move. Caught the first time this was run
       * against the real Worker rather than a fake wire. */
      payload.type = 'welcome';
      payload.seat = c.seat;
      persist();
      deliver(connId, payload);
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
        /* lastAck is NOT set here. A view carrying ackSeq means "the state in
         * this frame contains your move", and nothing has been applied yet.
         *
         * It used to be set here, one line after the duplicate guard, which was
         * harmless only while the next thing to leave this function was the view
         * containing the move. The reclaim below broadcasts BEFORE the move is
         * applied, so that early ack went out on a frame that did not contain
         * it: table.js cleared the client's pending move and its answer timer on
         * the ack, and then dropped the `rejected` frame that followed as
         * answering nothing (see the answersPending check in its receive()).
         *
         * The player pressed a card, the card was refused, and they were told
         * nothing at all — not by the refusal, which was discarded, and not by
         * the eight second timeout, which had been cancelled. Silence after a
         * keypress is the exact failure this whole codebase is arranged to
         * prevent, and it was reintroduced by the fix written to prevent it. */
      }

      /* A move is proof the player is at the table, so it takes the seat back.
       *
       * 'away' used to be cleared by join() alone, which means only by opening a
       * new connection — and the client whose player was merely slow never lost
       * its connection and so never rejoins. The computer kept playing their
       * seat for the rest of the session while they sat there pressing keys.
       * Nothing told them to reload, and reloading is not an obvious response to
       * a game that is still drawing itself perfectly. */
      conns[connId].seenAt = now();
      if (state.players[seat].occupant === 'away') {
        state.players[seat].occupant = 'human';
        G.note(state, state.players[seat].name + ' is back.');
        room.turnSince = now();
        /* Told at once, and the pending computer move for that seat cancelled
         * with it. Waiting for the move itself to be applied would be too late:
         * the move that proves the player is back is very often the one that
         * gets refused, because the computer has just played the turn they were
         * answering — and the refusal path broadcasts nothing at all, so the
         * table would never hear they had returned. */
        broadcast();
        scheduleBots();
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
        room.dueKind = null;
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

      /* Acknowledged HERE, on the way out, because this is the first frame that
       * will actually contain the move. A refusal is answered by the rejected
       * frame above and must not be acked at all, or the client throws the
       * refusal away as answering nothing. */
      if (typeof msg.seq === 'number') room.lastAck[seat] = msg.seq;
      room.turnSince = now();
      broadcast();
      scheduleBots();
    }

    /* Prepare the room without dealing.
     *
     * The table used to deal as soon as it was created, so the host had no chance
     * to send anybody the code — by the time they had read it out, the computer
     * had played their seat through half a hand. A room now waits at 'idle' until
     * somebody at it says to begin. */
    function start() {
      load();
      persist();
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

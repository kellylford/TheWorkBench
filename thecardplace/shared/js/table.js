/* The seam between the interface and wherever the game actually is.
 *
 * Offline the game is a JavaScript object in this tab and a move is a function
 * call that returns before the next line runs. Online it is on a server
 * somewhere and a move is a message that may be refused, may arrive twice, and
 * may be answered after the player has given up and pressed the key again.
 *
 * Those are not the same thing, and the interface must not have to know which
 * one it is talking to. Without a seam, `if (online)` spreads to every site that
 * touches the engine — thirty-five of them in ui.js — and the two modes drift
 * apart until the offline game breaks in a way only the online tests catch, or
 * the other way round. That drift is precisely the failure this fork exists to
 * avoid, so it would be a poor thing to reintroduce inside it.
 *
 *   Table.act(action)      request a move. Never assume it worked.
 *   Table.view()           what this seat may see, right now.
 *   Table.drainEvents()    events this seat has not yet been told about.
 *   Table.pending()        the move this client has asked for and not heard back
 *                          about, or null.
 *
 * `act` is deliberately not called `play`: it is a REQUEST. Offline it happens
 * to be answered before it returns; that is an implementation detail of the
 * local mode and not a promise the interface may lean on.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var G = SH.Game;
  var V = SH.View;

  var mode = 'local';      // 'local' | 'online'
  var seat = 0;
  var state = null;        // local mode: the authoritative state, in this tab
  var latestView = null;   // online mode: the last view the server sent
  var latestVersion = -1;
  var pendingEvents = [];  // online mode: events received and not yet drained
  var eventCursor = 0;     // local mode: how far through the event list we have read
  var link = null;         // online mode: the connection object
  var seq = 0;
  var pendingAction = null;
  var pendingTimer = null;
  var listeners = [];
  var rejectHandlers = [];

  /* How long a move may go unanswered before the player is told something is
   * wrong. Not a retry — a retry would risk the move landing twice — just an
   * admission that the request has not come back. */
  var ANSWER_TIMEOUT = 8000;

  function notify() { for (var i = 0; i < listeners.length; i++) listeners[i](); }
  function notifyRejected(info) { for (var i = 0; i < rejectHandlers.length; i++) rejectHandlers[i](info); }

  /* ---------------- setup ---------------- */

  /* Play a game in this tab, as `atSeat`.
   *
   * Offline that is seat 0 and always has been. It is a parameter anyway,
   * because "which seat am I" is the question the whole online build turns on,
   * and a value that is only ever 0 in production is a value nobody has tested. */
  function startLocal(gameState, atSeat) {
    reset();
    mode = 'local';
    state = gameState;
    seat = atSeat || 0;
    return state;
  }

  /* Play a game that lives on a server. `connect` is called with a message
   * handler and must return the connection object. */
  function startOnline(atSeat, connect) {
    reset();
    mode = 'online';
    seat = atSeat;
    link = connect(receive);
    return link;
  }

  function reset() {
    /* Close the old connection rather than merely forgetting it. Dropping the
     * reference left the server-side seat occupied for ever, kept the old link
     * delivering into the same module-level receive as the new one, and left
     * every previously registered listener still attached. */
    if (link && typeof link.close === 'function') {
      try { link.close(); } catch (e) { /* already gone */ }
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingAction = null;
    state = null;
    latestView = null;
    latestVersion = -1;
    pendingEvents = [];
    eventCursor = 0;
    link = null;
    seq = 0;
  }

  function isLocal() { return mode === 'local'; }
  function currentSeat() { return seat; }

  /* ---------------- what this seat can see ---------------- */

  /* Local mode projects on demand rather than handing back the raw state.
   *
   * It would be quicker to return `state` and let the interface read whatever it
   * likes — it is all here, after all. That is exactly why it does not. If the
   * offline interface renders from the same projected shape the online one
   * receives, the projection is exercised every time anybody plays a single
   * player game, and a field missing from js/view.js shows up as a broken screen
   * on the first hand instead of as an online-only bug six weeks later.
   *
   * The offline game becomes the test harness for the online one, for free. */
  function view() {
    if (mode === 'local') return state ? V.forSeat(state, seat) : null;
    return latestView;
  }

  /* Events this seat has not been told about yet, and only those it is entitled
   * to.
   *
   * Draining by CURSOR rather than by splicing a shared array is what makes
   * reconnect work later: the server keeps one authoritative list and each seat
   * remembers how far it has read, so a returning player is given what it missed
   * and not the whole hand again. Re-reading announcements somebody already
   * heard is not a cosmetic problem for a screen reader user — it is the game
   * telling them things are happening that are not. */
  function drainEvents() {
    if (mode === 'local') {
      if (!state) return [];
      var all = G.eventsFor(state, seat);
      var fresh = all.slice(eventCursor);
      eventCursor = all.length;
      return fresh;
    }
    var out = pendingEvents;
    pendingEvents = [];
    return out;
  }

  function resetEventCursor() { eventCursor = 0; pendingEvents = []; }

  /* ---------------- making a move ---------------- */

  /* The move this client has asked for and not yet heard back about.
   *
   * The interface needs this for more than a spinner. With optimistic updates
   * forbidden, pressing a card changes nothing until a view arrives — and for a
   * player who cannot see the screen, "nothing happened" is exactly what a
   * dropped keypress feels like. Something has to say "sent, waiting", and
   * something has to stop the same card being sent twice while they wait. */
  function pending() { return pendingAction; }

  function act(action) {
    if (mode === 'local') {
      if (!state) return { ok: false, reason: 'no game in progress' };
      var r = G.applyAction(state, seat, action);
      if (r.ok) notify();
      return r;
    }
    if (!link) return { ok: false, reason: 'not connected' };

    /* One move in flight at a time. The digit keys act on keydown with no
     * debounce, so a player who presses 3 twice — or holds it — would otherwise
     * send two plays, and the second would be applied to a state the first had
     * already changed. Sequence numbers make a duplicate harmless in transit;
     * this stops it being sent at all. */
    if (pendingAction) return { ok: false, reason: 'still waiting for the last move' };

    seq++;
    pendingAction = { seq: seq, action: action, at: Date.now() };

    /* Arm the timer BEFORE sending. WebSocket.send throws on a closed socket, and
     * that exception escapes to whatever handled the keypress — leaving the move
     * pending with no timer, so this client could never move again and would
     * never be told why. */
    pendingTimer = setTimeout(function () {
      if (!pendingAction) return;
      var stuck = pendingAction;
      pendingAction = null;
      notifyRejected({
        seq: stuck.seq,
        action: stuck.action,
        reason: 'the table has not answered',
        timedOut: true
      });
      notify();
    }, ANSWER_TIMEOUT);

    try {
      link.send({ type: 'action', seq: seq, action: action });
    } catch (e) {
      clearPending(seq);
      notifyRejected({ seq: seq, action: action, reason: 'the connection has gone', dropped: true });
      notify();
      return { ok: false, reason: 'the connection has gone' };
    }

    notify();
    return { ok: 'pending', seq: seq };
  }

  function clearPending(forSeq) {
    if (!pendingAction) return;
    if (forSeq !== undefined && pendingAction.seq !== forSeq) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingAction = null;
  }

  /* ---------------- what the server says ---------------- */

  function receive(msg) {
    if (mode !== 'online' || !msg) return;

    if (msg.type === 'welcome' || msg.type === 'view') {
      /* Views carry a version so a duplicate or out-of-order delivery cannot
       * roll the interface backwards onto a state the player has already moved
       * past. Dropping a stale view is always right; applying one is a card
       * reappearing in a hand it was played from. */
      /* No version, no trust. The guard only compared when a version was
       * present, so a frame without one sailed past it, overwrote an applied
       * view, and left latestVersion untouched — leaving the client showing old
       * state while rejecting the real updates that followed. */
      if (typeof msg.version !== 'number') return;
      if (msg.version <= latestVersion) return;
      latestVersion = msg.version;
      latestView = msg.view;
      /* The seat is settled when the connection is made and never afterwards.
       * Taking it from a message is the mirror image of the rule the server
       * side is built on — and with one module-level receive shared by every
       * connection, a stale link could otherwise move this client into another
       * chair. Only `welcome` may set it, and only once. */
      /* The seat is settled once, from the frame that carries it. `welcome` is
       * the authority; view.seat is the same value the projection stamps on
       * every view, and is accepted only while the seat is still unknown — so a
       * client that somehow misses its welcome can still work out where it is
       * sitting, without a later frame being able to move it. */
      if (msg.type === 'welcome' && typeof msg.seat === 'number') seat = msg.seat;
      else if (seat === null && msg.view && typeof msg.view.seat === 'number') seat = msg.view.seat;
      /* Events arriving on a WELCOME are a backlog, and are marked as one.
       *
       * A welcome is the first frame of a connection that has just opened, so
       * whatever it carries is the history of a table this client has not been
       * watching — either because it has only just arrived, or because it was
       * this browser and it reloaded and lost everything.
       *
       * The distinction has to reach the interface, because the obvious thing to
       * do with a recovered log is speak it, and that is minutes of recitation
       * before the player can find out whose turn it is, with no way to skip. So
       * the flag says how these arrived and the interface decides: they go in
       * the log, and what gets SAID is that they are there.
       *
       * A copy rather than a flag written onto the server's object, because
       * these are handed to the interface and an engine event is not the place
       * to keep a fact about the wire. */
      if (msg.events && msg.events.length) {
        var arriving = msg.events;
        if (msg.type === 'welcome') {
          arriving = msg.events.map(function (e) {
            var copy = {};
            for (var k in e) copy[k] = e[k];
            copy.replay = true;
            return copy;
          });
        }
        pendingEvents = pendingEvents.concat(arriving);
      }

      /* A view answers the move it actually INCLUDES, and says so by echoing the
       * sequence number.
       *
       * This used to clear the pending move on ANY view, which is not a
       * correlation at all — version is a message counter, not "the state that
       * contains your move". So a bot playing at another seat, or any other
       * broadcast at all, cleared the guard while the player's own move was
       * still on the wire, and the next keypress put a SECOND action frame out.
       * One keypress, two moves, both live. Confirmed: two action frames on the
       * wire from a single press.
       *
       * The test missed it because the pending case ran with the bots disabled,
       * which is the one configuration where no unrelated view can arrive — a
       * quiescent table is exactly where this bug cannot happen. */
      if (typeof msg.ackSeq === 'number') clearPending(msg.ackSeq);
      notify();
      return;
    }

    if (msg.type === 'accepted') {
      // The view that carries the change may arrive separately; keep waiting for
      // it rather than declaring the move done on an acknowledgement alone.
      return;
    }

    if (msg.type === 'rejected') {
      /* Only the move still outstanding may be announced.
       *
       * A late refusal for a move the player has long forgotten — one that timed
       * out, or was superseded — used to be spoken anyway, and its attached view
       * was applied with no staleness check at all. That rolled the board
       * backwards AND dropped latestVersion, so the view already applied was
       * accepted a second time when the next frame arrived, replaying every
       * event in it. */
      var answersPending = pendingAction && pendingAction.seq === msg.seq;
      if (!answersPending) return;

      /* Read the action off the pending move BEFORE clearing it.
       *
       * The other two ways a move can fail — the answer timing out, the socket
       * going — both hand the action back, and this one did not. So the
       * interface knew a card had been refused and had no idea WHICH, which is
       * why the refusal could only ever be spoken: there was nothing to point
       * at. A player who cannot see the board hears "you must follow suit" and a
       * player who can gets no mark on the card they just tried. */
      var refused = pendingAction.action;

      clearPending(msg.seq);
      if (msg.view && typeof msg.version === 'number' && msg.version > latestVersion) {
        latestView = msg.view;
        latestVersion = msg.version;
      }
      notifyRejected({ seq: msg.seq, action: refused, reason: msg.reason, fatal: !!msg.fatal });
      notify();
      return;
    }
  }

  function onChange(fn) { listeners.push(fn); }
  function onRejected(fn) { rejectHandlers.push(fn); }

  /* Local mode only: the raw state, for the few things that legitimately need it
   * — the AI, which must reason on full information, and the transcript, which
   * is generated for one seat and redacts itself. Nothing that renders may use
   * it, or the projection stops being exercised. */
  function localState() { return mode === 'local' ? state : null; }

  /* Hang up. Without this the only way a player learns the table has gone is the
   * eight second answer timeout, which is a long time to sit in silence. */
  function close() {
    if (link && typeof link.close === 'function') {
      try { link.close(); } catch (e) { /* already gone */ }
    }
    /* Forget the table, not just the socket. Keeping latestView meant the lobby
     * re-rendered the seats of the table you had just left, with your old seat
     * marked "you", before you had joined anything. */
    reset();
    mode = 'local';
  }

  SH.Table = {
    startLocal: startLocal,
    close: close,
    startOnline: startOnline,
    isLocal: isLocal,
    seat: currentSeat,
    view: view,
    drainEvents: drainEvents,
    resetEventCursor: resetEventCursor,
    act: act,
    pending: pending,
    onChange: onChange,
    onRejected: onRejected,
    localState: localState,
    ANSWER_TIMEOUT: ANSWER_TIMEOUT
  };
})(typeof window !== 'undefined' ? window : globalThis);

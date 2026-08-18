/* Sheephead - the seam between the interface and wherever the game actually is.
 *
 * Offline the game is a JavaScript object in this tab and a move is a function
 * call that returns before the next line runs. Online it is on a server in
 * another country and a move is a message that may be refused, may arrive twice,
 * and may be answered after the player has given up and pressed the key again.
 *
 * Those are not the same thing, and the interface must not have to know which one
 * it is talking to. Without a seam, `if (online)` spreads to every site that
 * touches the engine — thirty-five of them in ui.js — and the two modes drift
 * apart until the offline game breaks in a way only the online tests catch, or
 * the other way round. That drift is precisely the failure this whole fork exists
 * to avoid, so it would be a poor thing to reintroduce inside it.
 *
 * So: one object, two implementations, one interface.
 *
 *   Table.act(action)      request a move. Never assume it worked.
 *   Table.view()           what this seat may see, right now.
 *   Table.events()         events this seat is entitled to, drained.
 *   Table.seat()           which seat this client is playing.
 *
 * `act` is deliberately not called `play` or `doPlay`: it is a REQUEST. Offline
 * it happens to be answered synchronously; that is an implementation detail of
 * the local mode and not a promise the interface may lean on.
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
  var eventCursor = 0;     // how far through the event list this client has read
  var send = null;         // online mode: hands a message to the transport
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }

  /* ---------------- setup ---------------- */

  /* Play a game in this tab, as `atSeat`.
   *
   * Offline that is seat 0 and always has been. It is a parameter anyway,
   * because "which seat am I" is the question the whole online build turns on,
   * and a value that is only ever 0 in production is a value nobody has tested.
   * Passing something else here plays a real game from another chair, against
   * the same AI, through the same interface — which is how the seat handling gets
   * exercised without a server. */
  function startLocal(gameState, atSeat) {
    mode = 'local';
    state = gameState;
    seat = atSeat || 0;
    latestView = null;
    eventCursor = 0;
    send = null;
    return state;
  }

  /* Play a game that lives on a server. `transport` is anything with a send
   * function; the room replies by calling receiveView. */
  function startOnline(atSeat, transport) {
    mode = 'online';
    state = null;
    seat = atSeat;
    latestView = null;
    eventCursor = 0;
    send = transport && transport.send;
  }

  function isLocal() { return mode === 'local'; }
  function currentSeat() { return seat; }

  /* ---------------- what this seat can see ---------------- */

  /* Local mode projects on demand rather than handing back the raw state.
   *
   * It would be quicker to return `state` and let the interface read whatever it
   * likes — it is all here, after all. That is exactly why it does not. If the
   * offline interface renders from the same projected shape the online one
   * receives, then the projection is exercised every time anybody plays a single
   * player game, and a field missing from js/view.js shows up as a broken screen
   * on the very first hand instead of as an online-only bug six weeks later.
   *
   * The offline game becomes the test harness for the online one, for free. */
  function view() {
    if (mode === 'local') return state ? V.forSeat(state, seat) : null;
    return latestView;
  }

  /* Events this seat has not yet seen, and only those it is entitled to.
   *
   * Draining by CURSOR rather than by splicing the array is what makes reconnect
   * work later: the server keeps one authoritative list and each seat remembers
   * how far it has read, so a returning player is given what it missed and not
   * the whole hand again. Re-reading announcements somebody already heard is not
   * a cosmetic problem for a screen reader user — it is the game telling them
   * things are happening that are not. */
  function events() {
    var all;
    if (mode === 'local') {
      if (!state) return [];
      all = G.eventsFor(state, seat);
    } else {
      all = (latestView && latestView.pendingEvents) || [];
    }
    var fresh = all.slice(eventCursor);
    eventCursor = all.length;
    return fresh;
  }

  /* The interface calls this when it has finished a hand and the engine has been
   * reset; local mode's event list is per-game, so the cursor travels with it. */
  function resetEventCursor() { eventCursor = 0; }

  /* ---------------- making a move ---------------- */

  /* Ask for a move. Returns {ok, reason} in local mode and {ok: 'pending'} online.
   *
   * The interface must treat a local {ok: true} and an online {ok: 'pending'} the
   * same way: as "the request went somewhere", never as "the card has moved". The
   * card moves when a view says it has. */
  function act(action) {
    if (mode === 'local') {
      if (!state) return { ok: false, reason: 'no game in progress' };
      var r = G.applyAction(state, seat, action);
      if (r.ok) notify();
      return r;
    }
    if (!send) return { ok: false, reason: 'not connected' };
    send({ type: 'action', action: action });
    return { ok: 'pending' };
  }

  /* The server has sent a new view. Online mode only. */
  function receiveView(v) {
    if (mode !== 'online') return;
    // Views carry a version so that a duplicate or out-of-order delivery cannot
    // roll the interface backwards onto a state the player has already moved past.
    if (latestView && typeof v.version === 'number' &&
        typeof latestView.version === 'number' && v.version <= latestView.version) {
      return;
    }
    latestView = v;
    if (typeof v.seat === 'number') seat = v.seat;
    notify();
  }

  function onChange(fn) { listeners.push(fn); }

  /* Local mode only: the raw state, for the few things that legitimately need it
   * — the AI, which must reason on full information, and the transcript, which is
   * generated for one seat and redacts itself. Nothing that renders may use it. */
  function localState() { return mode === 'local' ? state : null; }

  SH.Table = {
    startLocal: startLocal,
    startOnline: startOnline,
    isLocal: isLocal,
    seat: currentSeat,
    view: view,
    events: events,
    resetEventCursor: resetEventCursor,
    act: act,
    receiveView: receiveView,
    onChange: onChange,
    localState: localState
  };
})(typeof window !== 'undefined' ? window : globalThis);

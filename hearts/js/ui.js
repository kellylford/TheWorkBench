/* Hearts - the interface, and the voice.
 *
 * This game has to be playable with the screen turned off. That is not a
 * decoration on top of a visual game; it decides the shape of everything here.
 *
 * ---- the announcement queue ----
 *
 * There are exactly two live regions and one queue. Everything spoken goes
 * through say(), which serialises per region and leaves a gap between messages,
 * because a live region that is written twice inside a few milliseconds does not
 * read twice — it reads the second half of one sentence and the first half of
 * the next, and the player hears nonsense at the exact moment something
 * important happened.
 *
 * A REQUEST PREEMPTS A GAME EVENT, AND THE EVENT IS REQUEUED RATHER THAN
 * DROPPED. When somebody presses H for their hand while the computer is playing,
 * the hand should be read immediately — but the card that was about to be
 * announced still has to be announced, or the player is left with a trick that
 * silently changed. Dropping it is the easy implementation and the wrong one.
 *
 * ---- what is not a live region ----
 *
 * The log is not one, and neither is the status line. They carry the same words
 * the announcer speaks. Making either of them live would say everything twice
 * and reintroduce the race the queue exists to prevent.
 *
 * ---- no role="application" ----
 *
 * The whole page stays in ordinary browse mode. Every card is a button and every
 * shortcut is also a button on screen, so nothing is reachable only one way. A
 * game that seizes the keyboard takes away the reading controls the player
 * already knows in exchange for shortcuts they have to learn.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;
  var G = SH.Game;
  var AI = SH.AI;

  var el = {};
  var state = null;
  var mySeat = 0;
  var pace = 450;
  var handFocus = 0;
  var selected = {};        // card id -> true, while choosing a pass
  var botTimer = null;
  var paused = false;       // 'wait for me to continue' mode

  /* ---------------- the announcer ---------------- */

  var queues = { polite: [], assertive: [] };
  var busy = { polite: false, assertive: false };
  var SETTLE = 60;          // between messages in the same region
  var HOLD = 250;           // how long a message stays before it is cleared

  function say(text, opts) {
    if (!text) return;
    opts = opts || {};
    var region = opts.assertive ? 'assertive' : 'polite';
    var item = { text: text, request: !!opts.request };

    if (item.request && busy[region]) {
      /* Preempt, and REQUEUE what was interrupted rather than losing it. */
      queues[region].unshift(item);
    } else {
      queues[region].push(item);
    }
    pump(region);
  }

  function pump(region) {
    if (busy[region] || !queues[region].length) return;
    busy[region] = true;
    var item = queues[region].shift();
    var node = region === 'assertive' ? el['say-assertive'] : el['say-polite'];
    node.textContent = '';
    global.setTimeout(function () {
      node.textContent = item.text;
      global.setTimeout(function () {
        busy[region] = false;
        pump(region);
      }, HOLD);
    }, SETTLE);
  }

  /* ---------------- prose ---------------- */

  function seatName(i) {
    return state && state.players[i] ? state.players[i].name : 'seat ' + i;
  }

  function cardText(c) { return C.describe(c); }

  function listOf(items) {
    if (!items.length) return 'nothing';
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function handText() {
    var hand = state.players[mySeat].hand;
    if (!hand.length) return 'Your hand is empty.';
    var bySuit = {};
    hand.forEach(function (c) {
      (bySuit[c.s] = bySuit[c.s] || []).push(C.RANK_NAME[c.r]);
    });
    var parts = [];
    C.SUITS.forEach(function (s) {
      if (!bySuit[s]) return;
      parts.push(C.SUIT_NAME[s] + ': ' + listOf(bySuit[s]));
    });
    /* Grouped by suit rather than read as thirteen card names in a row. Thirteen
     * names is forty seconds of speech and nobody can hold it; four short lists
     * is how a player actually thinks about a hand. */
    return parts.join('. ') + '.';
  }

  function trickText() {
    if (!state.trick.length) return 'Nothing has been played to this trick yet.';
    var parts = state.trick.map(function (t) {
      return seatName(t.seat) + ' played the ' + C.name(t.card);
    });
    var led = state.trick[0].card.s;
    return parts.join(', ') + '. ' + C.SUIT_NAME[led] + ' was led.';
  }

  function scoreText() {
    return state.players.map(function (p) {
      return p.name + ' ' + p.score;
    }).join(', ') + '. Lowest wins.';
  }

  function pointsText() {
    var parts = state.players.map(function (p) {
      var n = G.pointsOf(p.taken);
      return p.name + ' ' + n + (n === 1 ? ' point' : ' points');
    });
    var qs = state.players.filter(function (p) {
      return p.taken.some(function (c) { return c.id === 'QS'; });
    });
    var tail = qs.length ? ' ' + qs[0].name + ' has the queen of spades.'
      : ' The queen of spades has not been played.';
    return 'This hand: ' + parts.join(', ') + '.' + tail;
  }

  function whoText() {
    return state.players.map(function (p) {
      return p.name + ', ' + (p.occupant === 'human' ? 'you' : 'computer');
    }).join('. ') + '.';
  }

  /* ---------------- rendering ---------------- */

  function render() {
    if (!state) return;
    renderStatus();
    renderActions();
    renderHand();
    renderTrick();
    renderPlayers();
    renderHistory();
  }

  function renderStatus() {
    el.status.textContent = statusText();
  }

  function statusText() {
    if (state.phase === 'passing') {
      if (state.passing[mySeat]) {
        var waiting = state.passing.filter(function (p) { return !p; }).length;
        return 'You have passed. Waiting for ' + waiting +
          (waiting === 1 ? ' player' : ' players') + '.';
      }
      return 'Choose three cards to pass ' +
        (state.passDir === 'across' ? 'across' : state.passDir) + '. ' +
        Object.keys(selected).length + ' of 3 chosen.';
    }
    if (state.phase === 'play') {
      if (state.turn === mySeat) {
        return 'Your turn. ' + (state.trick.length
          ? C.SUIT_NAME[state.trick[0].card.s] + ' was led.'
          : 'You lead.');
      }
      return 'Waiting for ' + seatName(state.turn) + '.';
    }
    if (state.phase === 'handOver') {
      return 'Hand ' + state.dealNumber + ' is over. ' + scoreText();
    }
    if (state.phase === 'gameOver') {
      return state.winner >= 0
        ? seatName(state.winner) + ' wins with ' + state.players[state.winner].score + '.'
        : 'The game is over.';
    }
    return '';
  }

  function button(label, onClick, opts) {
    opts = opts || {};
    var b = global.document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (opts.primary) b.className = 'primary';
    if (opts.disabled) {
      /* aria-disabled rather than the disabled attribute, WITH A REASON. A
       * disabled button cannot be focused, so a screen reader user tabbing
       * through never learns it exists or why it is not available. */
      b.setAttribute('aria-disabled', 'true');
      if (opts.reason) b.setAttribute('title', opts.reason);
    }
    b.addEventListener('click', function () {
      if (opts.disabled) {
        say(opts.reason || 'Not available yet.', { assertive: true, request: true });
        return;
      }
      onClick();
    });
    return b;
  }

  function renderActions() {
    el.actions.innerHTML = '';
    var add = function (b) { el.actions.appendChild(b); };

    if (state.phase === 'passing' && !state.passing[mySeat]) {
      var n = Object.keys(selected).length;
      add(button('Pass these three cards', doPass, {
        primary: true,
        disabled: n !== 3,
        reason: n < 3 ? 'Choose ' + (3 - n) + ' more card' + (3 - n === 1 ? '' : 's') + ' first.'
          : 'Choose exactly three.'
      }));
      if (n) add(button('Clear selection', function () {
        selected = {};
        say('Selection cleared.', { request: true });
        render();
      }));
    }

    if (state.phase === 'handOver') {
      add(button('Deal the next hand', function () { act({ type: 'nextHand' }); }, { primary: true }));
    }

    if (state.phase === 'gameOver') {
      add(button('Start a new game', function () { startGame(); }, { primary: true }));
    }

    if (paused && state.phase === 'play' && state.turn !== mySeat) {
      add(button('Continue', function () { runBots(true); }, { primary: true }));
    }

    /* Every shortcut is also a button. */
    add(button('Read my hand', function () { say(handText(), { request: true }); }));
    add(button('Read the trick', function () { say(trickText(), { request: true }); }));
    add(button('Read the scores', function () { say(scoreText(), { request: true }); }));
    add(button('Points so far', function () { say(pointsText(), { request: true }); }));
    add(button("Who's here", function () { say(whoText(), { request: true }); }));
  }

  function renderHand() {
    el.hand.innerHTML = '';
    var hand = state.players[mySeat].hand;
    var legal = {};
    if (state.phase === 'play' && state.turn === mySeat) {
      G.legalPlays(state, mySeat).forEach(function (c) { legal[c.id] = true; });
    }

    hand.forEach(function (c, i) {
      var b = global.document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (C.isRed(c) ? ' red' : '');
      b.dataset.id = c.id;
      b.setAttribute('tabindex', i === handFocus ? '0' : '-1');

      var choosing = state.phase === 'passing' && !state.passing[mySeat];
      if (choosing) {
        b.setAttribute('aria-pressed', selected[c.id] ? 'true' : 'false');
      } else if (state.phase === 'play' && state.turn === mySeat && !legal[c.id]) {
        b.setAttribute('aria-disabled', 'true');
      }

      b.setAttribute('aria-label', cardText(c) +
        (choosing && selected[c.id] ? ', chosen to pass' : '') +
        (b.getAttribute('aria-disabled') === 'true'
          ? ', ' + G.whyNot(state, mySeat, c.id) : ''));

      /* The face. Two skins, and the traditional one is drawn from the same
       * pieces the shared card-overlap audit measures: two corner indices and a
       * pip field. */
      var idxTop = span('idx idx-tl', null);
      idxTop.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
      idxTop.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
      var idxBot = span('idx idx-br', null);
      idxBot.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
      idxBot.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
      b.appendChild(idxTop);

      /* The centre goes inside a .face, and that wrapper is load-bearing rather
       * than tidiness: the stylesheet hides the traditional face in the plain
       * skin with
       *
       *     .card .idx, .card .face { display: none; }
       *
       * and shows it again under .skin-traditional. A pip placed directly on the
       * card is matched by neither rule, so it stayed visible in the plain skin
       * AND unstyled by the traditional red rule — which is how the plain skin
       * ended up showing black hearts. */
      var face = span('face', null);
      face.appendChild(span('pip pip-big', C.SUIT_SYM[c.s]));
      b.appendChild(face);
      b.appendChild(idxBot);

      /* The plain skin's face, built from a .rank and a .suit rather than one
       * string of text — because that is what the red rule names:
       *
       *     .card.red .rank, .card.red .suit { color: var(--card-red); }
       *
       * The first version of this put "5♥" straight into .simple, which matched
       * nothing, and every heart and diamond rendered black in the plain skin.
       * The shared appearance audit caught it on its first run against this
       * game, reading "4H is a red suit but one of its glyphs renders
       * rgb(18, 24, 31)". That is the exact bug that audit was written for,
       * in another game, a year earlier. */
      var simple = span('simple', null);
      simple.appendChild(span('rank', C.RANK_TEXT[c.r]));
      simple.appendChild(span('suit', C.SUIT_SYM[c.s]));
      b.appendChild(simple);

      b.addEventListener('click', function () { handFocus = i; cardActivated(c); });
      b.addEventListener('focus', function () { handFocus = i; });
      el.hand.appendChild(b);
    });

    el['hand-hint'].textContent = handHint();
  }

  function span(cls, text) {
    var s = global.document.createElement('span');
    s.className = cls;
    if (text !== null && text !== undefined) s.textContent = text;
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  function handHint() {
    if (state.phase === 'passing') {
      if (state.passing[mySeat]) return 'Your pass is in. Waiting for the others.';
      return 'Select three cards, then choose Pass these three cards.';
    }
    if (state.phase === 'play' && state.turn === mySeat) {
      if (state.tricksPlayed === 0 && !state.trick.length) return 'The two of clubs leads.';
      if (!state.trick.length && !state.heartsBroken) return 'Hearts have not been broken.';
      if (state.trick.length) return C.SUIT_NAME[state.trick[0].card.s] + ' was led.';
    }
    return '';
  }

  function renderTrick() {
    el.trick.innerHTML = '';
    state.trick.forEach(function (t) {
      var li = global.document.createElement('li');
      li.className = 'mini' + (C.isRed(t.card) ? ' red' : '');
      var who = global.document.createElement('span');
      who.className = 'who';
      who.textContent = seatName(t.seat);
      var what = global.document.createElement('span');
      what.className = 'what';
      /* The suit carries class `s`, and `red` with it, because the stylesheet
       * colours a played card with
       *
       *     .trick .what .s.red { color: var(--card-red); }
       *
       * — the suit glyph itself, not the card around it. Marking only the <li>
       * as red left every heart in the trick rendering in the ordinary ink, and
       * the appearance audit said so: "a red card in the trick renders
       * rgb(242, 247, 244)". `suit` is on it as well so the audit's own glyph
       * search finds it, the same way it finds one in a hand. */
      what.appendChild(span('suit s' + (C.isRed(t.card) ? ' red' : ''), C.SUIT_SYM[t.card.s]));
      what.appendChild(span('idx-rank', C.RANK_TEXT[t.card.r]));
      /* The written-out name is what a screen reader reads; the face beside it is
       * what a sighted player reads. Both are present, neither is a substitute. */
      var sr = global.document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = C.name(t.card);
      what.appendChild(sr);
      li.appendChild(who);
      li.appendChild(what);
      el.trick.appendChild(li);
    });
    if (!state.trick.length) {
      var p = global.document.createElement('li');
      p.className = 'empty';
      p.textContent = 'Nothing played yet.';
      el.trick.appendChild(p);
    }
  }

  function renderPlayers() {
    var body = el['players-table'].querySelector('tbody');
    body.innerHTML = '';
    state.players.forEach(function (p, i) {
      var tr = global.document.createElement('tr');
      if (state.phase === 'play' && state.turn === i) tr.className = 'on-turn';
      cell(tr, 'th', p.name + (i === mySeat ? ' (you)' : ''));
      cell(tr, 'td', String(p.hand.length));
      cell(tr, 'td', String(G.pointsOf(p.taken)));
      cell(tr, 'td', String(p.score));
      body.appendChild(tr);
    });
  }

  function renderHistory() {
    var body = el['history-table'].querySelector('tbody');
    body.innerHTML = '';
    state.history.forEach(function (h) {
      var tr = global.document.createElement('tr');
      cell(tr, 'th', String(h.deal));
      cell(tr, 'td', h.passDir);
      h.points.forEach(function (n) { cell(tr, 'td', String(n)); });
      body.appendChild(tr);
    });
  }

  function cell(tr, tag, text) {
    var c = global.document.createElement(tag);
    if (tag === 'th') c.setAttribute('scope', 'row');
    c.textContent = text;
    tr.appendChild(c);
    return c;
  }

  function log(text) {
    var li = global.document.createElement('li');
    li.textContent = text;
    el.log.appendChild(li);
    while (el.log.children.length > 200) el.log.removeChild(el.log.firstChild);
  }

  /* ---------------- doing things ---------------- */

  function cardActivated(c) {
    if (state.phase === 'passing' && !state.passing[mySeat]) {
      if (selected[c.id]) {
        delete selected[c.id];
        say(C.name(c) + ' removed. ' + Object.keys(selected).length + ' of 3.', { request: true });
      } else if (Object.keys(selected).length >= 3) {
        say('Three already chosen. Remove one first.', { assertive: true, request: true });
      } else {
        selected[c.id] = true;
        say(C.name(c) + ' chosen. ' + Object.keys(selected).length + ' of 3.', { request: true });
      }
      render();
      focusHand();
      return;
    }

    if (state.phase === 'play' && state.turn === mySeat) {
      var r = act({ type: 'play', card: c.id });
      if (!r.ok) say(r.reason, { assertive: true, request: true });
      return;
    }
    say('Not your turn.', { assertive: true, request: true });
  }

  function doPass() {
    var cards = Object.keys(selected);
    var r = act({ type: 'pass', cards: cards });
    if (!r.ok) { say(r.reason, { assertive: true, request: true }); return; }
    selected = {};
  }

  /* Every move the player makes goes through here, and so does every event the
   * engine produced as a result. The engine is the only thing that decides what
   * happened; this only decides how it is said. */
  var lastEvent = 0;

  function act(action) {
    var r = G.applyAction(state, mySeat, action);
    if (r.ok) drain();
    render();
    if (r.ok) { focusForTurn(); runBots(); }
    return r;
  }

  function drain() {
    var events = G.eventsFor(state, mySeat, lastEvent);
    events.forEach(function (e) {
      lastEvent = Math.max(lastEvent, e.id);
      log(e.text);
      say(e.text, { assertive: e.kind === 'moon' || e.kind === 'game' });
    });
  }

  function runBots(force) {
    if (botTimer) { global.clearTimeout(botTimer); botTimer = null; }
    if (!state || state.phase === 'handOver' || state.phase === 'gameOver') return;
    if (G.seatToAct(state) === mySeat) return;
    if (G.seatToAct(state) < 0) return;
    if (paused && !force) return;

    botTimer = global.setTimeout(function () {
      botTimer = null;
      try { AI.act(state); } catch (e) {
        say('The computer players could not continue.', { assertive: true });
        return;
      }
      drain();
      render();
      if (G.seatToAct(state) === mySeat) focusForTurn();
      runBots();
    }, Math.max(pace, 0));
  }

  /* ---------------- focus ---------------- */

  function focusHand() {
    var cards = el.hand.querySelectorAll('.card');
    if (!cards.length) return;
    if (handFocus >= cards.length) handFocus = cards.length - 1;
    if (handFocus < 0) handFocus = 0;
    cards.forEach(function (c, i) { c.setAttribute('tabindex', i === handFocus ? '0' : '-1'); });
    cards[handFocus].focus();
  }

  /* Where the keyboard should be when it becomes the player's turn.
   *
   * The hand when there are cards to play or choose, and the first action button
   * otherwise. Getting this wrong drops focus to <body>, which is silent — the
   * player is simply left nowhere, with no way to know the game is waiting. */
  function focusForTurn() {
    if (!state) return;
    var handPhase = (state.phase === 'passing' && !state.passing[mySeat]) ||
      (state.phase === 'play' && state.turn === mySeat &&
        el.hand.querySelector('.card:not([aria-disabled="true"])'));
    if (handPhase && el.hand.querySelector('.card')) { focusHand(); return; }
    var b = el.actions.querySelector('button');
    if (b) b.focus();
  }

  function onKey(e) {
    if (!state) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    var inHand = e.target.classList && e.target.classList.contains('card');
    if (inHand && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      handFocus += e.key === 'ArrowRight' ? 1 : -1;
      var n = el.hand.querySelectorAll('.card').length;
      if (handFocus < 0) handFocus = 0;
      if (handFocus >= n) handFocus = n - 1;
      focusHand();
      return;
    }

    var k = (e.key || '').toLowerCase();
    var map = {
      h: handText, t: trickText, s: scoreText, p: pointsText, w: whoText
    };
    if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      say(map[k](), { request: true });
    }
  }

  /* ---------------- starting ---------------- */

  function startGame() {
    var name = (el['opt-name'].value || 'You').slice(0, 16);
    pace = parseInt(el['opt-pace'].value, 10);
    paused = pace < 0;
    if (paused) pace = 0;

    var skin = el['opt-skin'].value;
    global.document.body.className = 'skin-' + skin;

    state = G.createGame({
      names: [name, 'East', 'South', 'West'],
      pointsToWin: parseInt(el['opt-points'].value, 10)
    });
    mySeat = 0;
    lastEvent = 0;
    selected = {};
    handFocus = 0;
    el.log.innerHTML = '';

    el['setup-section'].hidden = true;
    el['game-section'].hidden = false;

    G.applyAction(state, mySeat, { type: 'start' });
    drain();
    render();
    focusForTurn();
    runBots();
  }

  function boot() {
    ['status', 'actions', 'hand', 'hand-hint', 'trick', 'players-table', 'history-table',
     'log', 'setup-section', 'game-section', 'setup-form', 'opt-name', 'opt-pace',
     'opt-points', 'opt-skin', 'say-polite', 'say-assertive'].forEach(function (id) {
      el[id] = global.document.getElementById(id);
    });

    global.document.body.className = 'skin-traditional';

    el['setup-form'].addEventListener('submit', function (e) {
      e.preventDefault();
      startGame();
    });
    global.document.addEventListener('keydown', onKey);
  }

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  SH.UI = {
    /* For the browser suites: the same view the interface is drawing from, and
     * which seat it is drawing for. Named _test because nothing in the game may
     * read it — a test hook that becomes load-bearing stops being a test hook. */
    _test: {
      view: function () { return state; },
      seat: function () { return mySeat; },
      say: say
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

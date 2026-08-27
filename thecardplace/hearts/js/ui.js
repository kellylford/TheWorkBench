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

  /* SETTINGS, REMEMBERED — and there is ONE set of controls, in the dialog.
   *
   * Its own key, and that is not cosmetic. localStorage is scoped to the ORIGIN
   * and every game in this repository lives under the same one, so a key shared
   * with another game means a setting changed here changes it there too.
   *
   * The start screen used to carry its own copies of the pace, the target and
   * the card style, with the dialog holding a second set that had to be written
   * back and forth by hand. The old comment on that function said the quiet part
   * out loud — "two forms that disagree about the current pace is worse than one
   * form" — and the answer to that is one form, which is what the other four
   * games on this site already had. The start screen shows a summary and a way
   * in; everything is set in one place, from the setup screen or from the
   * toolbar, and they are the same place. */
  var STORE_KEY = 'hearts.settings.v1';
  var DEFAULTS = { pace: 900, points: 100, skin: 'traditional', autofocus: true };
  var settings = { pace: 900, points: 100, skin: 'traditional', autofocus: true };

  /* THE PACE LADDER, and it is the same five rungs in every game on this site.
   *
   * It used to be two different ladders — this game offered Comfortable, Brisk,
   * Immediate and Wait at 900ms, 450ms, 0 and manual, while euchre, cribbage and
   * sheephead offered Instant, Four seconds, Ten seconds and Manual. So the
   * DEFAULTS differed ninefold between games on the same site, and "brisk" and
   * "four seconds" were words for the same control that told a player nothing
   * about each other.
   *
   * -1 is not a duration and is never treated as one: it means the game waits
   * for a button, however long that takes. */
  var PACE_RUNGS = [0, 900, 2500, 4000];
  var PACE_NAMES = {
    '0': 'Immediate', '900': 'Brisk', '2500': 'Comfortable',
    '4000': 'Relaxed', '-1': 'Wait for me to continue'
  };

  /* A stored pace from before the ladders were merged, snapped to the nearest
   * rung. Somebody on the old 450ms brisk gets the new Brisk. Without this their
   * saved value matches no option, the select falls back to whatever is first in
   * the list, and their choice is silently replaced by one they never made. */
  function normalisePace(n) {
    n = Number(n);
    if (!isFinite(n)) return DEFAULTS.pace;
    if (n < 0) return -1;
    var best = PACE_RUNGS[0];
    for (var i = 1; i < PACE_RUNGS.length; i++) {
      /* Ties go to the slower rung: more time is the safer place to be wrong. */
      if (Math.abs(n - PACE_RUNGS[i]) <= Math.abs(n - best)) best = PACE_RUNGS[i];
    }
    return best;
  }

  /* The rung as it reads in the settings summary, where it sits in a list of
   * short phrases. "Wait for me to continue pace" is not one of them. */
  function paceSummary(n) {
    var w = PACE_NAMES[String(n)];
    if (!w) return 'Brisk pace';
    return Number(n) < 0 ? 'Waits for me to continue' : w + ' pace';
  }

  function loadSettings() {
    var stored = {};
    try { stored = JSON.parse(global.localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { stored = {}; }
    Object.keys(DEFAULTS).forEach(function (k) {
      settings[k] = stored[k] === undefined ? DEFAULTS[k] : stored[k];
    });
    settings.pace = normalisePace(settings.pace);
    settingsToForm();
    applySkin();
    renderSettingsSummary();
  }

  function saveSettings() {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); }
    catch (e) { /* private browsing, a full disk: the game still plays */ }
  }

  function applySkin() {
    global.document.body.className = 'skin-' + settings.skin;
  }

  function settingsToForm() {
    if (el['opt-pace']) el['opt-pace'].value = String(settings.pace);
    if (el['opt-points']) el['opt-points'].value = String(settings.points);
    if (el['opt-skin']) el['opt-skin'].value = settings.skin;
    if (el['opt-autofocus']) el['opt-autofocus'].checked = !!settings.autofocus;
  }

  function readSettingsDialog() {
    if (el['opt-pace']) settings.pace = parseInt(el['opt-pace'].value, 10);
    if (el['opt-points']) settings.points = parseInt(el['opt-points'].value, 10);
    if (el['opt-skin']) settings.skin = el['opt-skin'].value;
    if (el['opt-autofocus']) settings.autofocus = !!el['opt-autofocus'].checked;
    saveSettings();
    settingsToForm();
    applySkin();
    renderSettingsSummary();
  }

  /* What the start screen says instead of showing every control.
   *
   * The same shape as the other four games: a short list of phrases, so
   * somebody can see what they are about to play without opening anything, and
   * open the dialog only when one of them is wrong. */
  function renderSettingsSummary() {
    var node = el['settings-summary'];
    if (!node) return;
    node.textContent = [
      'Playing to ' + settings.points,
      paceSummary(settings.pace),
      settings.skin === 'plain' ? 'Plain cards' : 'Traditional cards',
      settings.autofocus ? 'Focus moves to my cards on my turn' : 'Focus stays where I put it'
    ].join('. ') + '.';
  }

  var handFocus = 0;
  var logFocus = 0;         // which log entry holds the tab stop
  var selected = {};        // card id -> true, while choosing a pass
  var botTimer = null;

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
    lastSpoken = text;
    pump(region);
  }

  /* What was said last, for R. Recorded at the point it is queued rather than
   * when it is spoken, so repeating during a run of messages gives the one the
   * player just heard rather than whatever the queue has reached. */
  var lastSpoken = '';

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
      var n = p.takenPoints;
      return p.name + ' ' + n + (n === 1 ? ' point' : ' points');
    });
    var qs = state.players.filter(function (p) {
      return p.hasQueen;
    });
    var tail = qs.length ? ' ' + qs[0].name + ' has the queen of spades.'
      : ' The queen of spades has not been played.';
    return 'This hand: ' + parts.join(', ') + '.' + tail;
  }

  /* The last completed trick, which is the question a player asks most often
   * after "what is in my hand" — you hear four cards go past and want the one
   * detail you missed. */
  function lastTrickText() {
    if (!state.lastTrick) return 'No trick has been completed yet.';
    var lt = state.lastTrick;
    var parts = lt.cards.map(function (t) {
      return seatName(t.seat) + ' played the ' + C.name(t.card);
    });
    return parts.join(', ') + '. ' + seatName(lt.winner) + ' took it' +
      (lt.points ? ' with ' + lt.points + (lt.points === 1 ? ' point' : ' points') : ', no points') +
      '.';
  }

  /* What has gone, and the two facts that decide how the rest of the hand plays:
   * whether hearts are live, and whether the queen is still out there. */
  function countText() {
    var played = state.tricksPlayed;
    var left = G.HAND - played;
    var queenGone = state.players.some(function (p) { return p.hasQueen; });
    return played + (played === 1 ? ' trick' : ' tricks') + ' played, ' +
      left + ' to go. Hearts ' + (state.heartsBroken ? 'are broken' : 'have not been broken') +
      '. The queen of spades ' + (queenGone ? 'has gone' : 'is still out') + '.';
  }

  /* Who plays after whom, from the current leader round. Trick games in this
   * repository all answer this on O, and it is the thing a new player loses
   * track of first. */
  function orderText() {
    var from = state.trick.length ? state.trick[0].seat : state.leader;
    var names = [];
    for (var i = 0; i < state.players.length; i++) {
      names.push(seatName((from + i) % state.players.length));
    }
    return 'Play goes ' + names.join(', then ') + '.';
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
    syncActionsHeading();
    renderHand();
    renderTrick();
    renderSeatFans();
    renderPlayers();
    renderHistory();
    syncLogTabs();
  }

  function renderStatus() {
    el.status.textContent = statusText();
  }

  function statusText() {
    if (state.phase === 'passing') {
      if (passedIn(mySeat)) {
        var waiting = state.passedIn.filter(function (p) { return !p; }).length;
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
    if (opts.primary) {
      b.className = 'primary';
      /* N presses this. Every game in this repository marks its one
       * game-advancing button the same way and reads it the same way — the key
       * is the same key, and nothing about it is per-game except which button
       * happens to be primary right now. Hearts was the only game without it. */
      b.setAttribute('data-advance', '1');
    }
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

    if (state.phase === 'passing' && !passedIn(mySeat)) {
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

    /* The read-out controls are NOT here. They live in the toolbar, above the
     * game, and the reason is the tab order.
     *
     * They were in this group, after the primary action and before the hand,
     * which put five buttons between the cards and the only thing you can do
     * with them: shift+tab six times from a card to reach "Pass these three
     * cards". Every one of those buttons is worth having and none of them is
     * worth crossing on the way to playing. Euchre keeps them in a toolbar and
     * that is why its hand feels next to its actions. */
  }

  /* The heading goes when the box does.
   *
   * "What you can do" sat over an empty area for most of a hand: on your turn
   * to play a card there are no buttons, so the screen showed a heading, a gap,
   * and nothing. A heading is a promise that something follows it, and for a
   * screen reader user moving by headings it is worse than untidy — they land
   * on it and find nothing there. */
  function syncActionsHeading() {
    var h = global.document.getElementById('actions-h');
    if (!h) return;
    var empty = !el.actions.querySelector('button');
    h.hidden = empty;
    el.actions.hidden = empty;
  }

  function renderHand() {
    el.hand.innerHTML = '';
    var hand = state.players[mySeat].hand;

    /* AN EMPTY HAND SAYS SO.
     *
     * At the end of a hand this was a green band with nothing in it — no cards
     * and no sentence, which looks identical to a hand that failed to draw.
     * The other games all say why the box is empty, and the reason is never in
     * doubt: you have played them all. */
    if (!hand.length) {
      var note = global.document.createElement('p');
      note.className = 'hint';
      note.textContent = state.phase === 'handOver' || state.phase === 'gameOver'
        ? 'All thirteen played. The hand is over.'
        : 'No cards left.';
      el.hand.appendChild(note);
      el['hand-hint'].textContent = '';
      return;
    }

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

      var choosing = state.phase === 'passing' && !passedIn(mySeat);
      if (choosing) {
        b.setAttribute('aria-pressed', selected[c.id] ? 'true' : 'false');
      } else if (state.phase === 'play' && state.turn === mySeat && !legal[c.id]) {
        b.setAttribute('aria-disabled', 'true');
      }

      b.setAttribute('aria-label', cardText(c) +
        (choosing && selected[c.id] ? ', chosen to pass' : '') +
        (b.getAttribute('aria-disabled') === 'true'
          ? ', ' + G.whyNot(state, mySeat, c.id) : ''));

      /* One painter for the hand and the trick, so there is a single answer to
       * "what does a card look like" — and one place to be wrong. Every
       * structural detail it gets right was learned the hard way: the .face
       * wrapper the plain skin hides, and the .simple built from a .rank and a
       * .suit because that is what the red rule names. */
      paintCard(b, c);

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
      if (passedIn(mySeat)) return 'Your pass is in. Waiting for the others.';
      return 'Select three cards, then choose Pass these three cards.';
    }
    if (state.phase === 'play' && state.turn === mySeat) {
      if (state.tricksPlayed === 0 && !state.trick.length) return 'The two of clubs leads.';
      if (!state.trick.length && !state.heartsBroken) return 'Hearts have not been broken.';
      if (state.trick.length) return C.SUIT_NAME[state.trick[0].card.s] + ' was led.';
    }
    return '';
  }

  /* The face of a card, as the stylesheet expects to find it: two corner
   * indices, a centre inside a .face, and a .simple that the plain skin shows
   * instead. Shared by the hand and the trick so there is one answer to "what
   * does a card look like". */
  function paintCard(node, c) {
    var idxTop = span('idx idx-tl', null);
    idxTop.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
    idxTop.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
    var idxBot = span('idx idx-br', null);
    idxBot.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
    idxBot.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
    var face = span('face', null);
    face.appendChild(span('pip pip-big', C.SUIT_SYM[c.s]));
    var simple = span('simple', null);
    simple.appendChild(span('rank', C.RANK_TEXT[c.r]));
    simple.appendChild(span('suit', C.SUIT_SYM[c.s]));
    node.appendChild(idxTop);
    node.appendChild(face);
    node.appendChild(idxBot);
    node.appendChild(simple);
    return node;
  }

  /* Both tricks: the one on the table and the one that has just gone.
   *
   * The second used to exist only as speech. L read it out and nothing showed
   * it, so the moment the next card landed the trick was gone from the screen
   * and a sighted player had no way back to it — while the player beside them
   * could ask for it any time. Every other trick game here draws both. */
  function renderTrick() {
    paintTrick(el.trick, state.trick, null);
    paintTrick(el.lasttrick, state.lastTrick ? state.lastTrick.cards : [], state.lastTrick);
  }

  /* `done` is the completed trick, or null for the one still being played. It
   * decides two things and they are the whole difference: a finished trick has
   * a winner rather than a leader, and it is worth a known number of points. */
  function paintTrick(node, plays, done) {
    if (!node) return;
    node.innerHTML = '';

    if (!plays.length) {
      var empty = global.document.createElement('li');
      empty.className = 'empty';
      empty.textContent = done === null
        ? 'Nothing played to this trick yet.'
        : 'No trick has been completed yet.';
      node.appendChild(empty);
      return;
    }

    /* Who is winning, worked out here rather than trusted from anywhere: the
     * highest card of the suit led, because there is no trump. A finished
     * trick already knows, and says so by seat rather than by position. */
    var best = 0;
    for (var i = 1; i < plays.length; i++) {
      if (C.beats(plays[i].card, plays[best].card)) best = i;
    }
    if (done) {
      for (var j = 0; j < plays.length; j++) if (plays[j].seat === done.winner) best = j;
    }

    plays.forEach(function (t, i) {
      var li = global.document.createElement('li');
      if (i === best) li.className = 'winning';

      var who = global.document.createElement('span');
      who.className = 'who';
      who.textContent = seatName(t.seat) + (i === 0 ? ' (led)' : '');

      /* THE CARD ITSELF, as a .card.mini INSIDE the item.
       *
       * This used to put `mini` on the <li>, which reads fine and is not what
       * the stylesheet means. `.trick .mini { display: none }` then hid the
       * whole entry in the plain skin, and the traditional rule squeezed it into
       * a 3.4rem box — so the trick showed two bare name chips and no cards at
       * all. It looked like a missing feature and was a misplaced class. */
      var mini = global.document.createElement('span');
      mini.className = 'card mini' + (C.isRed(t.card) ? ' red' : '');
      paintCard(mini, t.card);
      mini.setAttribute('aria-hidden', 'true');

      /* The written name is what a screen reader reads; the face beside it is
       * what a sighted player reads. Both present, neither a substitute. */
      var what = global.document.createElement('span');
      what.className = 'what';
      what.textContent = C.name(t.card);

      var flag = global.document.createElement('span');
      flag.className = 'flag';
      flag.textContent = i !== best ? ''
        : done ? 'took it' + (done.points
          ? ', ' + done.points + (done.points === 1 ? ' point' : ' points')
          : ', no points')
          : 'winning so far';

      li.appendChild(who);
      li.appendChild(mini);
      li.appendChild(what);
      li.appendChild(flag);
      node.appendChild(li);
    });
  }

  /* The table, drawn: every seat with the cards it is holding, face down.
   *
   * aria-hidden, deliberately. The players table says all of this in words a
   * few lines below, and a screen reader reading four rows of card backs is
   * noise — the same trap as announcing what a king is worth. This is for the
   * eyes only, and the words are elsewhere and better. */
  /* Named renderSeatFans, not renderSeats.
   *
   * The lobby has a renderSeats of its own, further down, which fills the
   * seats TABLE. Two function declarations with one name in the same scope is
   * not an error — the later one simply wins — so render() called the lobby
   * renderer, the table strip stayed empty, and nothing anywhere complained.
   * A blank green bar where the table should be. */
  function renderSeatFans() {
    var box = el.seats;
    if (!box || !state) return;
    box.innerHTML = '';
    state.players.forEach(function (p, i) {
      var seat = global.document.createElement('div');
      seat.className = 'seat' + (whoActs() === i ? ' seat-turn' : '');
      seat.appendChild(span('seat-name', p.name));
      seat.appendChild(span('seat-role', p.takenPoints ? p.takenPoints + ' taken' : ''));
      var fan = global.document.createElement('div');
      fan.className = 'seat-fan';
      for (var k = 0; k < p.hand.length; k++) fan.appendChild(span('back'));
      seat.appendChild(fan);
      box.appendChild(seat);
    });
  }

  function renderPlayers() {
    var body = el['players-table'].querySelector('tbody');
    body.innerHTML = '';
    state.players.forEach(function (p, i) {
      var tr = global.document.createElement('tr');
      if (state.phase === 'play' && state.turn === i) tr.className = 'on-turn';
      /* Marked only when the name does not already say it — the default name is
       * "You", and "You (you)" reads fine on screen and sounds ridiculous. */
      var isMe = i === mySeat && p.name.toLowerCase() !== 'you';
      cell(tr, 'th', p.name + (isMe ? ' (you)' : ''));
      cell(tr, 'td', String(p.hand.length));
      cell(tr, 'td', String(p.takenPoints));
      cell(tr, 'td', String(p.score));
      body.appendChild(tr);
    });
  }

  function renderHistory() {
    /* THE COLUMN HEADINGS ARE THE PLAYERS, and they have to be written here
     * rather than in the HTML.
     *
     * They were four compass points — North, East, South, West — hardcoded in
     * index.html. The seats are not compass points: seat 0 is whatever the
     * player typed as their name. So the table said "North 25" about a row that
     * was the player's own score, and a screen reader moving cell by cell read
     * out the wrong name against every number in the game. Silent, confident and
     * wrong, which is the worst combination a table can manage. */
    var head = el['history-table'].querySelector('thead tr');
    if (head) {
      head.innerHTML = '';
      cell(head, 'th', 'Hand').setAttribute('scope', 'col');
      cell(head, 'th', 'Passed').setAttribute('scope', 'col');
      state.players.forEach(function (p, i) {
        /* Marked only when the name does not already say it. The default name
         * is "You", and "You (you)" is the kind of thing that reads fine on a
         * screen and sounds ridiculous out loud. */
        var mine = i === mySeat && p.name.toLowerCase() !== 'you';
        var th = cell(head, 'th', p.name + (mine ? ' (you)' : ''));
        th.setAttribute('scope', 'col');
      });
    }

    var body = el['history-table'].querySelector('tbody');
    body.innerHTML = '';
    state.history.forEach(function (h) {
      var tr = global.document.createElement('tr');
      cell(tr, 'th', String(h.deal));
      cell(tr, 'td', h.passDir === 'hold' ? 'nobody passed' : h.passDir);
      h.points.forEach(function (n, i) {
        var td = cell(tr, 'td', String(n));
        /* Named for anybody reading a cell on its own. A bare "25" in a grid is
         * a number without a subject unless the reader happens to be tracking
         * both headers. */
        td.setAttribute('aria-label', state.players[i].name + ' ' + n +
          (n === 1 ? ' point' : ' points') + ' in hand ' + h.deal);
      });
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

  /* THE LOG, WHICH IS HOW YOU FIND OUT WHAT YOU MISSED.
   *
   * This was the odd one out and it was odd in the way that matters. It
   * appended, so the newest entry was at the bottom of two hundred; G focused
   * the FIRST child, which was therefore the oldest thing that had ever
   * happened; and the entries carried no tab stop and answered no arrow keys,
   * so there was no way onward from wherever you landed. A player reported it
   * as the history not reading, which is exactly what it was.
   *
   * Now it is what the other four games do: newest first, one tab stop that
   * moves with you, arrows and Home and End, and a kind on each entry so the
   * scores and the tricks are not a wall of one colour. */
  function pushLog(kind, text) {
    var li = global.document.createElement('li');
    li.className = 'k-' + (kind || 'info');
    li.tabIndex = -1;
    li.textContent = text;
    el.log.insertBefore(li, el.log.firstChild);
    while (el.log.children.length > 200) el.log.removeChild(el.log.lastChild);
  }

  function applyLogTabs() {
    var items = el.log.children;
    for (var i = 0; i < items.length; i++) items[i].tabIndex = i === logFocus ? 0 : -1;
  }

  /* Called after every render. Entries arrive at the TOP, so an index left
   * alone would slide down the list under the reader — this re-reads the index
   * from where focus actually is, which is the only thing that stays put. */
  function syncLogTabs() {
    var items = el.log.children;
    var active = global.document.activeElement;
    for (var i = 0; i < items.length; i++) if (items[i] === active) { logFocus = i; break; }
    if (logFocus >= items.length) logFocus = items.length - 1;
    if (logFocus < 0) logFocus = 0;
    applyLogTabs();
  }

  function focusLogEntry(i) {
    var items = el.log.children;
    if (!items.length) { say('The game log is empty.', { request: true }); return; }
    logFocus = Math.max(0, Math.min(items.length - 1, i));
    applyLogTabs();
    items[logFocus].focus();
  }

  function onLogKeys(e) {
    var items = el.log.children;
    if (!items.length) return;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': e.preventDefault(); focusLogEntry(logFocus + 1); break;
      case 'ArrowUp': case 'ArrowLeft': e.preventDefault(); focusLogEntry(logFocus - 1); break;
      case 'Home': e.preventDefault(); focusLogEntry(0); break;
      case 'End': e.preventDefault(); focusLogEntry(items.length - 1); break;
      case 'PageDown': e.preventDefault(); focusLogEntry(logFocus + 10); break;
      case 'PageUp': e.preventDefault(); focusLogEntry(logFocus - 10); break;
    }
  }

  /* ---------------- doing things ---------------- */

  function cardActivated(c) {
    if (state.phase === 'passing' && !passedIn(mySeat)) {
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

  /* Every move the player makes goes through the TABLE, not the engine.
   *
   * Table is the seam: local play and a table on a server present the same four
   * calls — act, view, drainEvents, onChange — and this file cannot tell which
   * it is talking to. That is the whole point of it. A UI that reaches for the
   * engine directly works beautifully until the day the engine is on somebody
   * else's machine, and then every one of those reaches is a separate bug.
   *
   * Local play still runs the real engine and the real projection through
   * LocalServer, so the interface is drawing from a per-seat view even when
   * there is nobody to hide anything from. Anything else would mean the offline
   * game exercises a path the online game never takes. */
  function act(action) {
    var r = SH.Table.act(action);
    return r ? { ok: true } : { ok: false, reason: 'that move was not accepted' };
  }

  /* Everything the table has said since we last looked. Table.drainEvents keeps
   * the cursor, which matters more online than off: a reconnecting client must
   * not be read the whole hand again from the beginning. */
  function drain() {
    var events = SH.Table.drainEvents();
    events.forEach(function (e) {
      pushLog(e.kind, e.text);
      say(e.text, { assertive: e.kind === 'moon' || e.kind === 'game' });
    });
  }

  /* Where the view came from, and what to do about it.
   *
   * Registered once. The table calls it whether a frame arrived over a socket or
   * a local move produced one, so there is exactly one path from "something
   * happened" to "the screen and the voice say so". */
  var lastMoment = '';

  function onTableChange() {
    state = SH.Table.view();
    if (!state) return;
    drain();
    render();

    /* Focus moves when the GAME MOVED and the move is now ours.
     *
     * Three versions, and the third is here because a player reported the second
     * failing in a way I could not reproduce and therefore reverted.
     *
     *   1. Compare the phase. Right exactly once a hand: every trick after the
     *      first leaves the phase at 'play', so the turn came round twelve more
     *      times and focus never moved.
     *
     *   2. Compare whose turn it was last time. Right whenever the turn visibly
     *      leaves this seat and comes back — and WRONG IN THE ONE CASE THAT
     *      MATTERS MOST. When you play the fourth card of a trick and take it,
     *      the turn goes from you to you: finishTrick sets the leader to the
     *      winner in the same action, so there is no frame in between and no
     *      change to notice. Take a trick and the game sits there waiting on a
     *      hand you cannot reach. Exactly what was reported, twice.
     *
     *   3. Compare a token for the MOMENT. If any of these moved and it is now
     *      ours, the game is waiting on us and focus belongs where the cards
     *      are. If nothing moved, nothing is taken — somebody reading the log
     *      during their own turn is left alone.
     *
     * I reverted version 3 once already, on the grounds that mutation testing
     * could not tell it from version 2. It could not because I never made it
     * play the last card of a trick and win; the case exists, and a fix that
     * cannot be told apart by a test that never enters the failing state is not
     * the same as a fix that is unnecessary. */
    var moment = [state.phase, state.dealNumber, state.tricksPlayed,
      state.trick.length, state.turn, String(state.passedIn)].join('|');
    var mine = whoActs() === mySeat;
    /* Only if they asked for it. Moving focus is help when you are waiting to
     * play and an interruption when you are reading the log — which is why it
     * is a setting in the other games and now here. */
    if (mine && moment !== lastMoment && settings.autofocus) focusForTurn();
    lastMoment = moment;
  }

  /* Whose move, from the VIEW.
   *
   * G.seatToAct cannot be used here: it reads state.passing, which the
   * projection deliberately never carries — the one thing in this game that must
   * not cross a socket. The view says passedIn instead, which is the public part
   * of the same question. */
  function whoActs() {
    if (!state) return -1;
    if (state.phase === 'passing') {
      for (var i = 0; i < state.players.length; i++) {
        if (!state.passedIn[i]) return i;
      }
      return -1;
    }
    if (state.phase === 'play') return state.turn;
    return -1;
  }

  function passedIn(seat) {
    return !!(state && state.passedIn && state.passedIn[seat]);
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
    var handPhase = (state.phase === 'passing' && !passedIn(mySeat)) ||
      (state.phase === 'play' && state.turn === mySeat &&
        el.hand.querySelector('.card:not([aria-disabled="true"])'));
    if (handPhase && el.hand.querySelector('.card')) { focusHand(); return; }
    var b = el.actions.querySelector('button');
    if (b) b.focus();
  }

  /* ONE table of review actions, named the same way in three places: the
   * toolbar buttons carry data-say, the keyboard maps a letter to a name, and
   * this maps the name to what gets said. Adding one means adding it here and
   * to both of the others — which is the point, because a shortcut with no
   * button and a button with no shortcut are both half-built. */
  var SAY = {
    hand: function () { return handText(); },
    trick: function () { return trickText(); },
    last: function () { return lastTrickText(); },
    score: function () { return scoreText(); },
    points: function () { return pointsText(); },
    count: function () { return countText(); },
    order: function () { return orderText(); },
    who: function () { return whoText(); },
    repeat: function () { return lastSpoken || 'Nothing to repeat.'; }
  };
  var KEYS = {
    h: 'hand', t: 'trick', l: 'last', s: 'score', p: 'points',
    c: 'count', o: 'order', w: 'who', r: 'repeat'
  };

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    /* ? BEFORE THE STATE GUARD, and that ordering is the point.
     *
     * Everything below needs a game in progress. The keyboard hints do not —
     * they are most wanted by somebody who has just arrived at the start screen
     * and wants to know whether this thing can be played by keyboard at all.
     * Behind the guard it did nothing there, silently, which is the answer
     * "no". */
    if (e.key === '?') { e.preventDefault(); goToSection('keys-h'); return; }

    if (!state) return;

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
    /* N moves the game forward: deal the next hand, start the game, continue.
     * An ACTION rather than a review, so it is ignored inside the log where the
     * player is reading rather than driving. */
    /* G goes to the log, which is where a player checks what they missed. Same
     * key, same job, in every game here. */
    if (k === 'e') { e.preventDefault(); openExport(); return; }
    if (k === 'b') { e.preventDefault(); openBug(); return; }

    if (k === 'g') { e.preventDefault(); focusLogEntry(0); return; }

    if (k === 'n' && !el.log.contains(e.target)) {
      var adv = el.actions.querySelector('button[data-advance]');
      if (adv && adv.getAttribute('aria-disabled') !== 'true') {
        e.preventDefault();
        adv.click();
      }
      return;
    }

    if (KEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      say(SAY[KEYS[k]](), { request: true });
    }
  }

  /* ---------------- export, and reporting a bug ----------------
   *
   * Both are plain <dialog> elements. A real dialog gets focus trapping, Escape
   * and the accessible role from the browser; every hand-rolled modal gets at
   * least one of those wrong, usually the first.
   */

  /* How to play, and the keyboard hints. Both are already written into this
   * page under real headings, so these move to them rather than opening a
   * dialog with a second copy in it. Focus goes to the heading itself, with a
   * tabindex of -1 so it can take focus without joining the tab order — which
   * is what a screen reader needs to start reading from there. */
  function goToSection(id) {
    var h = global.document.getElementById(id);
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.focus();
    if (h.scrollIntoView) h.scrollIntoView({ block: 'start' });
    say(h.textContent || '', { request: true });
  }

  var lastFocus = null;

  /* One way in, from both places that offer it: the toolbar during a game and
   * the setup screen before one. Same dialog, same controls, so there is nothing
   * to keep in step. */
  function openSettings() {
    openDialog(el['settings-dialog']);
  }

  function openDialog(d) {
    if (!d) return;
    lastFocus = global.document.activeElement;
    d.showModal();
    var first = d.querySelector('textarea, input, button');
    if (first) first.focus();
  }

  function closeDialog(d) {
    if (!d) return;
    d.close();
    /* Back where they were. A dialog that drops focus to <body> on close leaves
     * a screen reader user at the top of the page with no idea the game is
     * still there. */
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* The log as text, which is what makes a bug report worth reading. */
  function buildTranscript() {
    var lines = [];
    lines.push('Hearts — game log');
    if (state) {
      lines.push('Hand ' + state.dealNumber + ', phase ' + state.phase);
      /* What this table is playing to, which is the table's number and not this
       * browser's setting — the two can differ when you have joined somebody
       * else's game, and a transcript that reported the local preference would
       * be reporting the wrong one. */
      lines.push('Playing to ' + G.targetOf(state) + '.');
      lines.push('Scores: ' + state.players.map(function (p) {
        return p.name + ' ' + p.score;
      }).join(', '));
      if (state.history.length) {
        lines.push('');
        lines.push('Hand  Passed      ' + state.players.map(function (p) {
          return p.name;
        }).join('  '));
        state.history.forEach(function (h) {
          lines.push(String(h.deal).padEnd(6) + String(h.passDir).padEnd(12) +
            h.points.join('  ') + (h.shooter >= 0 ? '   (moon: ' + seatName(h.shooter) + ')' : ''));
        });
      }
    }
    lines.push('');
    lines.push('What happened:');
    /* Reversed, because the log reads newest first on screen and a transcript
     * that starts at the end is no use to anybody reading a bug report. */
    [].map.call(el.log.children, function (li) { return li.textContent; })
      .reverse().forEach(function (t) { lines.push('  ' + t); });
    return lines.join('\n');
  }

  function openExport() {
    if (!state) { say('Nothing to export yet.', { assertive: true, request: true }); return; }
    el['export-text'].value = buildTranscript();
    el['export-summary'].textContent = state.history.length + ' completed ' +
      (state.history.length === 1 ? 'hand' : 'hands') + '. ' +
      /* Whether this is a REAL table, not whether Table thinks it is local.
       * Offline play deliberately runs the same server in this tab, so
       * Table.isLocal() is false either way and the summary said "this is an
       * online table" to somebody playing three bots. The table code is the
       * honest signal: it exists only when somebody joined one. */
      (lobby.code
        ? 'This is table ' + lobby.code + ', so what is below is what this seat has been told.'
        : 'This game is running in this tab, against the computer.');
    openDialog(el['export-dialog']);
    say('Export the game log. ' + el['export-summary'].textContent, { request: true });
  }

  function bugReport() {
    var parts = [];
    parts.push('**What went wrong:** ' + (el['bug-title'].value || '(not said)'));
    parts.push('');
    parts.push(el['bug-what'].value || '(no detail given)');
    parts.push('');
    parts.push('Game: Hearts');
    if (state) parts.push('Hand ' + state.dealNumber + ', phase ' + state.phase);
    parts.push('Table: ' + (lobby.code ? 'online, ' + lobby.code : 'against the computer'));
    if (el['bug-include-log'].checked) {
      parts.push('');
      parts.push('```');
      parts.push(buildTranscript());
      parts.push('```');
    }
    return parts.join('\n');
  }

  function refreshBugPreview() {
    /* The preview is the report. Shown rather than described, because "we will
     * include some diagnostic information" is exactly the sentence that makes a
     * person not send one. */
    el['bug-preview'].value = bugReport();
  }

  function openBug() {
    refreshBugPreview();
    openDialog(el['bug-dialog']);
    say('Report a bug. Nothing is sent on its own; the preview shows exactly what ' +
      'will be copied.', { request: true });
  }

  function copyText(text, what) {
    if (global.navigator && global.navigator.clipboard) {
      global.navigator.clipboard.writeText(text).then(function () {
        say(what + ' copied.', { request: true });
      }).catch(function () {
        say('Could not copy. The text is selected instead, so copy it yourself.',
          { assertive: true, request: true });
      });
    } else {
      say('Copying is not available here. The text is in the box.',
        { assertive: true, request: true });
    }
  }

  function downloadTranscript() {
    var text = el['export-text'].value;
    try {
      var blob = new global.Blob([text], { type: 'text/plain' });
      var url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = 'hearts-log.txt';
      global.document.body.appendChild(a);
      a.click();
      global.document.body.removeChild(a);
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
      say('Downloaded.', { request: true });
    } catch (e) {
      say('The download did not start. The log is in the box, so copy it instead.',
        { assertive: true, request: true });
    }
  }
  /* ---------------- the lobby ----------------
   *
   * Everything here is ordinary HTML driven by two calls: SH.Net.createTable to
   * make one, SH.Net.connect to join one. Table.startOnline puts the same seam
   * in front of it that local play already uses, so nothing below this point in
   * the file knows or cares whether the game is here or on a Worker.
   */

  var lobby = { code: null, seat: null };

  function $(id) { return global.document.getElementById(id); }

  function lobbyStatus(text) {
    var node = $('lobby-status');
    if (node) node.textContent = text || '';
    if (text) say(text, { request: true });
  }

  /* Upper case, and only the characters a code can contain. Spaces and dashes
   * are dropped rather than rejected: people write a code down with a dash in
   * it, and refusing that teaches them nothing. */
  function normaliseCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* "9, K, Z, 2, Y" — for reading down a phone. A screen reader says a
   * five-character run as a word, and "9KZ2Y" is not a word. */
  function spellCode(code) { return String(code || '').split('').join(', '); }

  /* The rules the whole table plays by, fixed when it is made.
   *
   * Deliberately not the whole settings object: pace, skin and the player's own
   * name are this browser's business and nobody else's. */
  function roomConfig() {
    return {
      numPlayers: G.SEATS,
      names: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4'],
      pointsToWin: settings.points || G.TARGET,
      difficulty: 'hard'
    };
  }

  function showLobby() {
    el['setup-section'].hidden = true;
    el['game-section'].hidden = true;
    el['lobby-section'].hidden = false;
    $('lobby-choose').hidden = false;
    $('lobby-table').hidden = true;
    lobbyStatus('');
    $('lobby-code').focus();
  }

  function createTable() {
    lobbyStatus('Making a table…');
    $('lobby-create').disabled = true;
    SH.Net.createTable({ config: roomConfig() }).then(function (code) {
      $('lobby-create').disabled = false;
      joinTable(code, null);
    }).catch(function (err) {
      $('lobby-create').disabled = false;
      /* Punctuated, because these two halves are glued together and read aloud
       * as one sentence: "Failed to fetch You can still play" is what the first
       * version said. */
      var why = err && err.message ? String(err.message).replace(/[.s]+$/, '') + '. ' : '';
      lobbyStatus('The table could not be made. ' + why +
        'You can still play against the computer.');
    });
  }

  function joinTable(code, seat) {
    var clean = normaliseCode(code);
    if (clean.length < 5) {
      lobbyStatus('That does not look like a table code. It is five letters and numbers.');
      $('lobby-code').focus();
      return;
    }

    lobby.code = clean;
    lobby.seat = seat;
    lobbyStatus('Joining table ' + spellCode(clean) + '…');

    /* seat may be null: "put me anywhere". The client cannot choose sensibly —
     * it does not know which seats are free until it has connected, and it
     * cannot connect without asking. Guessing produces the obvious result: the
     * second person to arrive asks for seat 0, is told it is taken, and cannot
     * join at all. */
    var myName = (el['opt-name'].value || 'MyPlayerName').slice(0, 16);
    SH.Table.startOnline(seat, function (handler) {
      return SH.Net.connect({ code: clean, seat: seat, name: myName }, handler, onNetStatus);
    });

    $('lobby-choose').hidden = true;
    $('lobby-table').hidden = false;
    $('lobby-code-display').textContent = clean;
    var a = $('lobby-invite');
    if (a) { a.href = inviteLink(clean); a.textContent = inviteLink(clean); }
    renderSeats();
    $('lobby-code-display').focus();
  }

  /* The address of this page with the table already chosen.
   *
   * Built from location rather than hard coded, so it is right on the published
   * site, right on a local file and right behind whatever anybody puts in front
   * of it. It carries the code and nothing else — no name and no seat: the seat
   * is the room's to hand out and the name is the guest's to choose. */
  function inviteLink(code) {
    return global.location.origin + global.location.pathname + '?table=' + encodeURIComponent(code);
  }

  function codeFromUrl() {
    try {
      var m = /[?&]table=([^&#]+)/.exec(global.location.search || '');
      return m ? normaliseCode(decodeURIComponent(m[1])) : '';
    } catch (e) { return ''; }
  }

  /* Somebody followed an invite link. They land on the START screen rather than
   * straight in the game, deliberately: the one thing a link cannot carry is who
   * they are, and an unnamed player at a table is worse than a slow one. */
  var pendingInvite = '';

  function offerInvite(code) {
    pendingInvite = code;
    el['setup-section'].hidden = false;
    el['lobby-section'].hidden = true;
    var note = $('invite-note');
    if (note) {
      note.hidden = false;
      note.textContent = 'You have been invited to table ' + code +
        '. Choose the name the others will see, then join.';
    }
    var go = el['setup-form'] && el['setup-form'].querySelector('button[type="submit"]');
    if (go) go.textContent = 'Join table ' + code;
    var nm = $('opt-name');
    if (nm) { nm.focus(); if (nm.select) nm.select(); }
  }

  function onNetStatus(info) {
    if (!info) return;
    if (info.state === 'open') { lobbyStatus('Connected to table ' + spellCode(lobby.code) + '.'); return; }
    if (info.state === 'closed') { lobbyStatus('The connection dropped. Trying again…'); return; }
    if (info.reason) lobbyStatus(info.reason);
  }

  function renderSeats() {
    var body = $('lobby-seats') && $('lobby-seats').querySelector('tbody');
    if (!body) return;
    body.innerHTML = '';
    var v = SH.Table.view();
    for (var i = 0; i < G.SEATS; i++) {
      var p = v && v.players && v.players[i];
      var tr = global.document.createElement('tr');
      cell(tr, 'th', 'Seat ' + (i + 1) + (i === mySeat ? ' (you)' : ''));
      cell(tr, 'td', p ? p.name : '—');
      cell(tr, 'td', p ? (p.occupant === 'human' ? 'a person' :
        p.occupant === 'away' ? 'away, played by the computer' : 'computer') : 'empty');
      body.appendChild(tr);
    }
  }

  function leaveTable() {
    SH.Table.close();
    lobby.code = null;
    lobby.seat = null;
    showLobby();
    say('You have left the table.', { assertive: true, request: true });
  }
  /* ---------------- starting ---------------- */

  /* Offline play runs a REAL SERVER in this tab.
   *
   * LocalServer is the authoritative engine, the real projection and the real
   * room, with the network replaced by a function call. So a game against the
   * computer takes exactly the path a game against people takes: the same seat
   * projection, the same events, the same refusals. Anything else means the
   * offline game — which is what almost everybody plays — is the one path that
   * is never exercised by the online tests.
   *
   * It also means the bots are the server's business rather than this file's.
   * There is no timer here any more, and no AI.act: the pace control becomes the
   * server's botDelay, which is what it always meant. */
  function startGame() {
    var name = (el['opt-name'].value || 'MyPlayerName').slice(0, 16);
    /* The settings are already in `settings`: there is one set of controls now
     * and every change to them writes through readSettingsDialog. This used to
     * read a second copy off the start screen, which is what made the two able
     * to disagree in the first place. */
    saveSettings();
    settingsToForm();
    applySkin();

    pace = settings.pace < 0 ? 0 : settings.pace;

    selected = {};
    handFocus = 0;
    logFocus = 0;
    el.log.innerHTML = '';
    el['setup-section'].hidden = true;
    el['game-section'].hidden = false;

    var cfg = {
      numPlayers: 4,
      names: [name, 'East', 'South', 'West'],
      pointsToWin: settings.points,
      difficulty: 'hard'
    };
    var srv = SH.LocalServer.create({ config: cfg, latency: 0, botDelay: pace });
    SH.Table.startOnline(null, function (handler) { return srv.connect(null, handler); });

    /* Nothing is dealt until the table says so — the same rule online, where it
     * is the host giving people time to arrive, and offline, where it costs one
     * frame. Sending it before the first view has arrived would be sending it to
     * a table that does not exist yet. */
    dealWhenReady = true;
  }

  var dealWhenReady = false;

  function boot() {
    ['status', 'actions', 'hand', 'hand-hint', 'trick', 'lasttrick', 'players-table', 'history-table',
     'log', 'setup-section', 'game-section', 'setup-form', 'opt-name', 'opt-pace',
     'opt-points', 'opt-skin', 'say-polite', 'say-assertive',
     'seats', 'lobby-section', 'lobby-status', 'lobby-seats',
     'settings-dialog', 'opt-autofocus', 'settings-summary', 'setup-settings',
     'export-dialog', 'export-text', 'export-summary',
     'bug-dialog', 'bug-title', 'bug-what', 'bug-include-log', 'bug-preview'].forEach(function (id) {
      el[id] = global.document.getElementById(id);
    });

    global.document.body.className = 'skin-traditional';

    el['setup-form'].addEventListener('submit', function (e) {
      e.preventDefault();
      /* An invite turns this form into a join. The name has just been read out
       * of it, which is the whole reason the link lands here. */
      if (pendingInvite) {
        var code = pendingInvite;
        pendingInvite = '';
        showLobby();
        joinTable(code, null);
        return;
      }
      startGame();
    });
    global.document.addEventListener('keydown', onKey);
    el.log.addEventListener('keydown', onLogKeys);


    /* The lobby. Every one of these is an ordinary button doing one thing, and
     * the code entry is a plain text input rather than five separate boxes:
     * split inputs look tidy and are miserable with a screen reader, because
     * every keystroke moves focus and the field you are in is never the field
     * you thought. */
    var bind = function (id, ev, fn) { var n = $(id); if (n) n.addEventListener(ev, fn); };

    bind('btn-settings', 'click', openSettings);
    bind('setup-settings', 'click', openSettings);
    bind('settings-close', 'click', function () { closeDialog(el['settings-dialog']); });
    bind('settings-reset', 'click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { settings[k] = DEFAULTS[k]; });
      saveSettings();
      settingsToForm();
      applySkin();
      renderSettingsSummary();
      say('Settings reset to their defaults.', { request: true });
    });
    ['opt-pace', 'opt-points', 'opt-skin', 'opt-autofocus'].forEach(function (id) {
      bind(id, 'change', readSettingsDialog);
    });

    bind('tool-rules', 'click', function () { goToSection('rules-h'); });
    bind('tool-a11y', 'click', function () { goToSection('keys-h'); });
    bind('tool-newgame', 'click', function () {
      if (!global.confirm || global.confirm('Start a new game? The one in progress is lost.')) {
        global.location.reload();
      }
    });

    loadSettings();

    /* Last, so everything it may touch already exists. */
    var invited = codeFromUrl();
    if (invited) offerInvite(invited);

    bind('lobby-create', 'click', createTable);
    bind('lobby-join-form', 'submit', function (e) { e.preventDefault(); joinTable($('lobby-code').value, null); });
    bind('lobby-back', 'click', function () { el['lobby-section'].hidden = true; el['setup-section'].hidden = false; $('opt-name').focus(); });
    bind('lobby-leave', 'click', leaveTable);
    bind('lobby-start', 'click', function () { SH.Table.act({ type: 'start' }); });
    bind('lobby-copy', 'click', function () {
      var code = $('lobby-code-display').textContent;
      if (global.navigator && global.navigator.clipboard) {
        global.navigator.clipboard.writeText(code).then(function () {
          say('Invite link copied. The table code is ' + code + '.', { request: true });
        }).catch(function () { say('Could not copy. The table code is ' + code + '.', { request: true }); });
      } else {
        say('The table code is ' + code + '.', { request: true });
      }
    });
    bind('play-online', 'click', showLobby);
    bind('tool-export', 'click', openExport);
    bind('tool-bug', 'click', openBug);
    bind('export-close', 'click', function () { closeDialog(el['export-dialog']); });
    bind('export-copy', 'click', function () { copyText(el['export-text'].value, 'The log'); });
    bind('export-download', 'click', downloadTranscript);
    bind('bug-close', 'click', function () { closeDialog(el['bug-dialog']); });
    bind('bug-copy', 'click', function () { copyText(bugReport(), 'The report'); });
    bind('bug-open', 'click', function () {
      copyText(bugReport(), 'The report');
      global.open('https://github.com/kellylford/TheWorkBench/issues/new', '_blank', 'noopener');
    });
    ['bug-title', 'bug-what', 'bug-include-log'].forEach(function (id) {
      bind(id, 'input', refreshBugPreview);
      bind(id, 'change', refreshBugPreview);
    });
    bind('tool-log', 'click', function () {
      var first = el.log.querySelector('li');
      if (first) { first.setAttribute('tabindex', '-1'); first.focus(); }
      else say('Nothing has happened yet.', { request: true });
    });
    bind('tool-next', 'click', function () {
      var adv = el.actions.querySelector('button[data-advance]');
      if (adv && adv.getAttribute('aria-disabled') !== 'true') adv.click();
      else say('Nothing to move on to yet.', { assertive: true, request: true });
    });

    /* The toolbar. One handler for the group rather than five bindings: the
     * data-say value and the keyboard map below are the same set of names, so
     * adding a review control means adding it in one place and it works both
     * ways or neither. */
    var toolbar = global.document.querySelector('.toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', function (e) {
        var b2 = e.target.closest && e.target.closest('button[data-say]');
        if (!b2 || !state) return;
        var fn = SAY[b2.getAttribute('data-say')];
        if (fn) say(fn(), { request: true });
      });
    }

    /* Registered ONCE, at start-up, and deliberately not per game: Table keeps
     * its listeners across close() so the interface survives leaving one table
     * and joining another. */
    SH.Table.onChange(function () {
      mySeat = SH.Table.seat() === null ? mySeat : SH.Table.seat();
      onTableChange();
      /* The lobby stays up until a hand is actually dealt. Hiding it the moment
       * a connection opens takes the table code off the screen while the host is
       * still reading it to somebody. */
      if (state && state.phase !== 'idle' && el['lobby-section'] && !el['lobby-section'].hidden) {
        el['lobby-section'].hidden = true;
        el['game-section'].hidden = false;
        focusForTurn();
      }
      if (el['lobby-section'] && !el['lobby-section'].hidden) renderSeats();
      if (dealWhenReady && state && state.phase === 'idle') {
        dealWhenReady = false;
        SH.Table.act({ type: 'start' });
      }
    });
    SH.Table.onRejected(function (info) {
      /* The server said no. Said out loud and assertively, because the player
       * has just done something and nothing visible happened — silence there is
       * indistinguishable from the game having frozen. */
      say(info && info.reason ? info.reason : 'That move was not accepted.',
        { assertive: true, request: true });
      render();
    });
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

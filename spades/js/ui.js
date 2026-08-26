/* Spades - the interface, and the voice.
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
 * silently changed.
 *
 * ---- what this game has to say that the others do not ----
 *
 * TWO NUMBERS, CONSTANTLY. How many tricks the partnership still needs, and how
 * many bags it is carrying. Neither is visible in the cards, both decide every
 * play, and a player who has to hold them in their head is playing a different
 * and much harder game than one who can ask. B reads the contract; the status
 * line carries it without being asked.
 *
 * A NIL IS AN EMERGENCY AND IS ANNOUNCED LIKE ONE. Assertive, the moment it goes
 * down, because it is a hundred points and it is otherwise invisible until the
 * hand is scored.
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
  var STORE_KEY = 'spades.settings.v1';
  var DEFAULTS = { pace: 900, points: 500, skin: 'traditional', autofocus: true };
  var settings = { pace: 900, points: 500, skin: 'traditional', autofocus: true };

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

  /* The bid the player has CHOSEN but not yet placed.
   *
   * Kept out here rather than read off the select, because render() rebuilds the
   * actions area whenever a frame arrives and a value living only in the DOM
   * would be lost with it. Null means nothing chosen yet, which is a real state
   * and distinct from a chosen nil — the same reason player.bid starts null in
   * the engine rather than zero. */
  var pendingBid = null;

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

  function teamName(team) {
    if (!state) return 'team ' + team;
    var names = [];
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].team === team) names.push(seatName(i));
    }
    return names.join(' and ');
  }

  function myTeam() { return state ? state.players[mySeat].team : 0; }

  function listOf(items) {
    if (!items.length) return 'nothing';
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function bidWord(b) { return b === null ? 'still to bid' : b === 0 ? 'nil' : String(b); }

  /* The hand, grouped by suit.
   *
   * The trump suit is NAMED ONCE, at the end, rather than "trump" being appended
   * to each of five spades. Thirteen card names is already forty seconds of
   * speech; five repetitions of one word inside it is how a player stops
   * listening. C.role() says "trump" where a single card is named on its own,
   * which is where it is genuinely needed. */
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
      parts.push(C.SUIT_NAME[s] + (s === C.TRUMP ? ' (trump)' : '') +
        ': ' + listOf(bySuit[s]));
    });
    var spades = bySuit[C.TRUMP] ? bySuit[C.TRUMP].length : 0;
    return parts.join('. ') + '. ' +
      (spades ? spades + (spades === 1 ? ' spade' : ' spades') + '.' : 'No spades.');
  }

  function trickText() {
    if (!state.trick.length) return 'Nothing has been played to this trick yet.';
    var parts = state.trick.map(function (t) {
      return seatName(t.seat) + ' played the ' + C.name(t.card);
    });
    var led = state.trick[0].card.s;
    var w = G.trickWinner(state.trick);
    return parts.join(', ') + '. ' + C.SUIT_NAME[led] + ' was led. ' +
      seatName(w.seat) + ' is winning it.';
  }

  function lastTrickText() {
    if (!state.lastTrick) return 'No trick has been completed yet.';
    var lt = state.lastTrick;
    var parts = lt.cards.map(function (t) {
      return seatName(t.seat) + ' played the ' + C.name(t.card);
    });
    return parts.join(', ') + '. ' + seatName(lt.winner) + ' took it.';
  }

  function scoreText() {
    return teamName(0) + ' ' + state.scores[0] + ' with ' + bagWord(state.bags[0]) + ', ' +
      teamName(1) + ' ' + state.scores[1] + ' with ' + bagWord(state.bags[1]) +
      '. Playing to ' + G.targetOf(state) + '.';
  }

  function bagWord(n) { return n + (n === 1 ? ' bag' : ' bags'); }

  /* THE CONTRACT — the single most useful sentence in this game.
   *
   * What the pair promised, what they have, and therefore what is still needed.
   * A negative "needs" is said as bags rather than as a negative number, because
   * "minus two" is not what is happening: two tricks past the contract IS two
   * bags, and naming them that way is the difference between a player who knows
   * they are sandbagging and one who finds out at the end of the hand. */
  function contractText() {
    if (state.phase === 'bidding') {
      var said = state.players.filter(function (p) { return p.bid !== null; });
      if (!said.length) return 'Nobody has bid yet.';
      return said.map(function (p) {
        return seatName(p.index) + ' ' + bidWord(p.bid);
      }).join(', ') + '.';
    }
    var lines = [];
    for (var t = 0; t < 2; t++) {
      var contract = contractFor(t), took = tricksFor(t);
      var need = contract - took;
      var tail;
      if (need > 0) tail = need + ' more ' + (need === 1 ? 'trick' : 'tricks') + ' needed';
      else if (need === 0) tail = 'made it exactly';
      else tail = (-need) + ' over, ' + bagWord(-need) + ' so far';
      lines.push(teamName(t) + ' bid ' + contract + ', took ' + took + ' — ' + tail);
    }
    /* Your own side first. The other pair's contract matters, but not as much as
     * yours, and a read-out that opens with somebody else's number makes you
     * wait for your own. */
    if (myTeam() === 1) lines.reverse();
    return lines.join('. ') + '.';
  }

  function contractFor(team) {
    var n = 0;
    state.players.forEach(function (p) {
      if (p.team === team && p.bid !== null) n += p.bid;
    });
    return n;
  }

  function tricksFor(team) {
    var n = 0;
    state.players.forEach(function (p) { if (p.team === team) n += p.tricks; });
    return n;
  }

  /* What has gone, and the fact that decides how the rest of the hand plays:
   * whether spades can be led yet. */
  function countText() {
    var played = state.tricksPlayed;
    var left = G.HAND - played;
    return played + (played === 1 ? ' trick' : ' tricks') + ' played, ' +
      left + ' to go. Spades ' +
      (state.spadesBroken ? 'are broken.' : 'have not been broken.');
  }

  function orderText() {
    var from = state.trick.length ? state.trick[0].seat : state.leader;
    var names = [];
    for (var i = 0; i < state.players.length; i++) {
      names.push(seatName((from + i) % state.players.length));
    }
    return 'Play goes ' + names.join(', then ') + '.';
  }

  /* Who is here, AND WHO IS WITH WHOM. In a partnership game that second part is
   * not decoration — a player who has lost track of which two seats are theirs
   * is playing against their own partner. */
  function whoText() {
    var parts = [];
    for (var t = 0; t < 2; t++) {
      var members = state.players.filter(function (p) { return p.team === t; });
      parts.push(members.map(function (p) {
        return p.name + ' (' + (p.occupant === 'human' ? 'a person' : 'computer') + ')';
      }).join(' and ') + (t === myTeam() ? ', your side' : ''));
    }
    return parts.join('. Against: ') + '.';
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
    if (state.phase === 'bidding') {
      if (state.turn === mySeat) {
        return 'Your bid. How many tricks will you take? ' +
          (state.players[G.partnerOf(mySeat)].bid !== null
            ? seatName(G.partnerOf(mySeat)) + ' bid ' +
              bidWord(state.players[G.partnerOf(mySeat)].bid) + '.'
            : 'Your partner has not bid yet.');
      }
      return 'Waiting for ' + seatName(state.turn) + ' to bid.';
    }
    if (state.phase === 'play') {
      /* The contract travels with the turn line, because it is the number the
       * player needs at exactly the moment they are choosing a card. */
      var need = contractFor(myTeam()) - tricksFor(myTeam());
      var tail = need > 0 ? ' You need ' + need + ' more.'
        : need === 0 ? ' Your contract is made.'
        : ' ' + bagWord(-need) + ' over.';
      if (state.turn === mySeat) {
        return 'Your turn. ' + (state.trick.length
          ? C.SUIT_NAME[state.trick[0].card.s] + ' was led.'
          : 'You lead.') + tail;
      }
      return 'Waiting for ' + seatName(state.turn) + '.' + tail;
    }
    if (state.phase === 'handOver') {
      return 'Hand ' + state.dealNumber + ' is over. ' + scoreText();
    }
    if (state.phase === 'gameOver') {
      return state.winner >= 0
        ? teamName(state.winner) + ' win, ' + state.scores[state.winner] +
          ' to ' + state.scores[1 - state.winner] + '.'
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
       * game-advancing button the same way and reads it the same way. */
      b.setAttribute('data-advance', '1');
    }
    if (opts.className) b.className = (b.className ? b.className + ' ' : '') + opts.className;
    if (opts.label) b.setAttribute('aria-label', opts.label);
    if (opts.disabled) {
      /* aria-disabled rather than the disabled attribute, WITH A REASON. A
       * disabled button cannot be focused, so a screen reader user tabbing
       * through never learns it exists or why it is not available. */
      b.setAttribute('aria-disabled', 'true');
      if (opts.reason) b.setAttribute('title', opts.reason);
    }
    /* Reads the attribute rather than the flag it was built with.
     *
     * `opts.disabled` is a snapshot of how things were when the button was
     * created. The bid button outlives that: choosing a bid enables it in place,
     * without a re-render, because re-rendering would destroy the select the
     * player is standing in. A handler closing over the old boolean would go on
     * refusing a bid that is now perfectly valid. */
    b.addEventListener('click', function () {
      if (b.getAttribute('aria-disabled') === 'true') {
        say(b.getAttribute('title') || opts.reason || 'Not available yet.',
          { assertive: true, request: true });
        return;
      }
      onClick();
    });
    return b;
  }

  function renderActions() {
    el.actions.innerHTML = '';
    var add = function (b) { el.actions.appendChild(b); };

    /* THE BID: ONE CHOICE, THEN ONE BUTTON.
     *
     * This was fourteen buttons, one per bid. Every one of them was a tab stop,
     * so choosing a bid meant tabbing past up to thirteen things you did not
     * want — and then doing it again the next hand. It is now a single select
     * and a single button: two tab stops, whatever you decide to bid.
     *
     * NOTHING IS COMMITTED BY THE SELECT. Arrow keys move a closed select's
     * value and fire `change` on every step, so a `change` handler that placed
     * the bid would bid four on the way from three to five — and a screen reader
     * user arrowing down the list to hear the options would bid every number
     * they passed. The handler below only REMEMBERS the choice; the bid is
     * placed by the button and by nothing else. */
    if (state.phase === 'bidding' && state.turn === mySeat) {
      var wrap = global.document.createElement('p');
      wrap.className = 'field bid-field';

      var lab = global.document.createElement('label');
      lab.setAttribute('for', 'bid-select');
      lab.textContent = 'How many tricks will you take?';

      var sel = global.document.createElement('select');
      sel.id = 'bid-select';
      sel.name = 'bid';

      /* A placeholder rather than a default of one, so that the button cannot
       * commit a bid nobody chose. It is the same shape as the pass in hearts:
       * the action is there, visibly, and says what it still needs. */
      sel.appendChild(option('', 'Choose a bid…'));
      G.legalBids(state, mySeat).forEach(function (n) {
        /* "Nil" and not "0" — nobody at a table says zero — and the option says
         * what it costs, because a hundred either way is not something to find
         * out afterwards. An option cannot carry an aria-label, so the price
         * goes in the text where a screen reader will actually read it. */
        sel.appendChild(option(String(n), n === 0
          ? 'Nil — take no tricks at all, worth a hundred either way'
          : n + (n === 1 ? ' trick' : ' tricks')));
      });
      sel.value = pendingBid === null ? '' : String(pendingBid);

      wrap.appendChild(lab);
      wrap.appendChild(sel);
      el.actions.appendChild(wrap);

      /* THE BUTTON SAYS WHAT IT WILL DO.
       *
       * Not "Place this bid", which is a description of the mechanism and tells
       * you nothing about the bid. Once a number is chosen the button becomes
       * "Bid 3" or "Bid nil", so somebody who tabs onto it — having chosen a
       * moment ago, or having been interrupted between choosing and committing —
       * hears what they are about to commit to rather than having to go back to
       * the list to find out. On a hundred-point bet that is worth the words. */
      var go = button(bidButtonLabel(pendingBid), function () {
        if (pendingBid === null) return;
        var n = pendingBid;
        pendingBid = null;
        act({ type: 'bid', bid: n });
      }, {
        primary: true,
        disabled: pendingBid === null,
        reason: 'Choose a bid first, then place it.',
        label: bidButtonName(pendingBid)
      });
      add(go);

      /* Remembers, and updates the button in place. Deliberately NOT a render():
       * rebuilding the actions area would destroy the select the player is
       * standing in and drop focus mid-choice. */
      sel.addEventListener('change', function () {
        pendingBid = sel.value === '' ? null : parseInt(sel.value, 10);
        var ready = pendingBid !== null;
        go.textContent = bidButtonLabel(pendingBid);
        go.setAttribute('aria-label', bidButtonName(pendingBid));
        if (ready) {
          go.removeAttribute('aria-disabled');
          go.removeAttribute('title');
        } else {
          go.setAttribute('aria-disabled', 'true');
          go.setAttribute('title', 'Choose a bid first, then place it.');
        }
      });
    }

    if (state.phase === 'handOver') {
      add(button('Deal the next hand', function () { act({ type: 'nextHand' }); }, { primary: true }));
    }

    if (state.phase === 'gameOver') {
      add(button('Start a new game', function () { startGame(); }, { primary: true }));
    }

    /* The read-out controls are NOT here. They live in the toolbar, above the
     * game, so that nothing sits between the cards and the thing you do with
     * them in the tab order. */
  }

  /* The heading goes when the box does. A heading is a promise that something
   * follows it, and for a screen reader user moving by headings, landing on one
   * with nothing under it is worse than untidy. */
  function syncActionsHeading() {
    var h = global.document.getElementById('actions-h');
    if (!h) return;
    var empty = !el.actions.querySelector('button');
    h.hidden = empty;
    el.actions.hidden = empty;
    if (!empty) {
      h.textContent = state.phase === 'bidding' && state.turn === mySeat
        ? 'Your bid' : 'What you can do';
    }
  }

  function renderHand() {
    el.hand.innerHTML = '';
    var hand = state.players[mySeat].hand;

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
      /* .trump gets the marked border core.css already defines. Spades are trump
       * in every hand of this game, so this is a permanent property of the card
       * rather than something that changes with the bidding — which is why it is
       * safe to paint here and would not be in euchre. */
      b.className = 'card' + (C.isRed(c) ? ' red' : '') + (C.isTrump(c) ? ' trump' : '');
      b.dataset.id = c.id;
      b.setAttribute('tabindex', i === handFocus ? '0' : '-1');

      /* DURING THE BIDDING THE HAND IS SIMPLY A HAND, and says nothing else.
       *
       * It used to be marked unavailable, with ", not yet — the bidding comes
       * first" on every card. That was answering the wrong question. Reading the
       * hand is the WHOLE ACTIVITY of this phase — it is how you decide what to
       * bid — and the answer to "can I play this yet" is not wanted thirteen
       * times while you are counting your spades. Reported as distracting, and
       * it was: eight extra words on every card, thirteen times a hand, all
       * game.
       *
       * The state is not marked either, and that is the same decision rather
       * than a separate one — aria-disabled makes a screen reader say
       * "unavailable" on each card, which is the identical noise in fewer words.
       * Nothing is lost by leaving it off: the status line says it is your bid,
       * the hint under the hand says to choose one, and pressing a card still
       * answers in a sentence, once, on demand.
       *
       * This is the rule the hearts card model states and then has no case for —
       * the test is whether the NAME ALONE would mislead. Here it does not. You
       * are not being invited to play the nine of clubs; the entire screen is a
       * bid. */
      var notMyTurn = state.phase === 'play' && state.turn !== mySeat;
      var illegal = state.phase === 'play' && state.turn === mySeat && !legal[c.id];
      if (notMyTurn || illegal) b.setAttribute('aria-disabled', 'true');

      /* A card that cannot be played during the PLAY says which rule stopped it.
       * That is worth saying, because there the question is live: it is a trick,
       * you are choosing a card, and "you must follow hearts" teaches the game
       * where silence teaches nothing. */
      b.setAttribute('aria-label', C.describe(c) +
        (b.getAttribute('aria-disabled') !== 'true' ? ''
          : notMyTurn ? ', not your turn yet'
          : ', ' + G.whyNot(state, mySeat, c.id)));

      paintCard(b, c);

      b.addEventListener('click', function () { handFocus = i; cardActivated(c); });
      b.addEventListener('focus', function () { handFocus = i; });
      el.hand.appendChild(b);
    });

    el['hand-hint'].textContent = handHint();
  }

  function bidButtonLabel(n) {
    return n === null ? 'Place this bid' : n === 0 ? 'Bid nil' : 'Bid ' + n;
  }

  function bidButtonName(n) {
    if (n === null) return 'Place this bid, once you have chosen one';
    if (n === 0) return 'Bid nil — take no tricks at all, worth a hundred either way';
    return 'Bid ' + n + (n === 1 ? ' trick' : ' tricks');
  }

  function option(value, text) {
    var o = global.document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  function span(cls, text) {
    var s = global.document.createElement('span');
    s.className = cls;
    if (text !== null && text !== undefined) s.textContent = text;
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  function handHint() {
    if (state.phase === 'bidding') {
      return state.turn === mySeat
        ? 'Look at your hand, then choose a bid above. Spades are trump.'
        : 'Waiting for the bidding to come round.';
    }
    if (state.phase === 'play' && state.turn === mySeat) {
      if (state.trick.length) return C.SUIT_NAME[state.trick[0].card.s] + ' was led.';
      if (!state.spadesBroken) return 'Spades have not been broken, so they cannot be led yet.';
      return 'You lead.';
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

  function renderTrick() {
    paintTrick(el.trick, state.trick, null);
    paintTrick(el.lasttrick, state.lastTrick ? state.lastTrick.cards : [], state.lastTrick);
  }

  /* `done` is the completed trick, or null for the one still being played. */
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

    /* Who is winning, worked out from the same function the engine uses so the
     * screen and the score can never disagree about a trick. */
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

      var mini = global.document.createElement('span');
      mini.className = 'card mini' + (C.isRed(t.card) ? ' red' : '') +
        (C.isTrump(t.card) ? ' trump' : '');
      paintCard(mini, t.card);
      mini.setAttribute('aria-hidden', 'true');

      /* The written name is what a screen reader reads; the face beside it is
       * what a sighted player reads. Both present, neither a substitute.
       * describe() rather than name(), so a spade played on a heart trick says
       * it is trump — which is the whole reason that trick went the way it did. */
      var what = global.document.createElement('span');
      what.className = 'what';
      what.textContent = C.describe(t.card);

      var flag = global.document.createElement('span');
      flag.className = 'flag';
      flag.textContent = i !== best ? '' : done ? 'took it' : 'winning so far';

      li.appendChild(who);
      li.appendChild(mini);
      li.appendChild(what);
      li.appendChild(flag);
      node.appendChild(li);
    });
  }

  /* The table, drawn: every seat with the cards it is holding, face down.
   * aria-hidden, deliberately — the players table says all of this in words a
   * few lines below, and a screen reader reading four rows of card backs is
   * noise. */
  function renderSeatFans() {
    var box = el.seats;
    if (!box || !state) return;
    box.innerHTML = '';
    state.players.forEach(function (p, i) {
      var seat = global.document.createElement('div');
      seat.className = 'seat' + (whoActs() === i ? ' seat-turn' : '') +
        (p.team === myTeam() ? ' seat-ours' : '');
      seat.appendChild(span('seat-name', p.name));
      seat.appendChild(span('seat-role',
        p.bid === null ? '' : bidWord(p.bid) + ' · ' + p.tricks));
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
      if ((state.phase === 'play' || state.phase === 'bidding') && state.turn === i) {
        tr.className = 'on-turn';
      }
      /* Marked only when the name does not already say it — the default name is
       * "You", and "You (you)" reads fine on screen and sounds ridiculous. */
      var isMe = i === mySeat && p.name.toLowerCase() !== 'you';
      cell(tr, 'th', p.name + (isMe ? ' (you)' : ''));
      cell(tr, 'td', p.team === myTeam() ? 'Us' : 'Them');
      cell(tr, 'td', bidWord(p.bid));
      cell(tr, 'td', String(p.tricks));
      cell(tr, 'td', String(p.hand.length));
      body.appendChild(tr);
    });

    /* The two team rows: score, bags, and where the contract stands. This is the
     * table a player actually reads during a hand. */
    var tbody = el['teams-table'].querySelector('tbody');
    tbody.innerHTML = '';
    for (var t = 0; t < 2; t++) {
      var tr2 = global.document.createElement('tr');
      var contract = contractFor(t), took = tricksFor(t);
      cell(tr2, 'th', teamName(t) + (t === myTeam() ? ' (you)' : ''));
      cell(tr2, 'td', String(state.scores[t]));
      var bagCell = cell(tr2, 'td', String(state.bags[t]));
      /* Named for anybody reading the cell alone, and warned when the bin is
       * nearly full — nine bags is a hundred points away from a tenth. */
      var limit = G.bagLimitOf(state);
      bagCell.setAttribute('aria-label', teamName(t) + ', ' + bagWord(state.bags[t]) +
        ' of ' + limit + (state.bags[t] >= limit - 1 ? ' — one more costs ' +
          G.bagPenaltyOf(state) : ''));
      if (state.bags[t] >= limit - 1) bagCell.className = 'warn';
      cell(tr2, 'td', state.phase === 'bidding' ? '—' : contract + ' / ' + took);
      tbody.appendChild(tr2);
    }
  }

  function renderHistory() {
    /* THE COLUMN HEADINGS ARE THE PARTNERSHIPS, written here rather than in the
     * HTML, because the seats are not compass points — seat 0 is whatever the
     * player typed as their name. */
    var head = el['history-table'].querySelector('thead tr');
    if (head) {
      head.innerHTML = '';
      cell(head, 'th', 'Hand').setAttribute('scope', 'col');
      for (var t = 0; t < 2; t++) {
        var th = cell(head, 'th', teamName(t) + (t === myTeam() ? ' (you)' : ''));
        th.setAttribute('scope', 'col');
      }
    }

    var body = el['history-table'].querySelector('tbody');
    body.innerHTML = '';
    state.history.forEach(function (h) {
      var tr = global.document.createElement('tr');
      cell(tr, 'th', String(h.deal));
      for (var t = 0; t < 2; t++) {
        var bid = h.bids[t] + h.bids[t + 2];
        var took = h.tricks[t] + h.tricks[t + 2];
        var td = cell(tr, 'td', 'bid ' + bid + ', took ' + took + ' (' +
          (h.delta[t] >= 0 ? '+' : '') + h.delta[t] + ')');
        td.setAttribute('aria-label', teamName(t) + ' bid ' + bid + ', took ' + took +
          ', scored ' + h.delta[t] + ' in hand ' + h.deal);
        if (h.delta[t] < 0) td.className = 'warn';
      }
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

  /* THE LOG, WHICH IS HOW YOU FIND OUT WHAT YOU MISSED. Newest first, one tab
   * stop that moves with you, arrows and Home and End, and a kind on each entry
   * so the scores and the tricks are not a wall of one colour. */
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
    if (state.phase === 'bidding') {
      say('Bidding first. Choose how many tricks you will take.',
        { assertive: true, request: true });
      return;
    }
    if (state.phase === 'play' && state.turn === mySeat) {
      var r = act({ type: 'play', card: c.id });
      if (!r.ok) say(r.reason, { assertive: true, request: true });
      return;
    }
    say('Not your turn.', { assertive: true, request: true });
  }

  /* Every move the player makes goes through the TABLE, not the engine.
   *
   * Table is the seam: local play and a table on a server present the same four
   * calls — act, view, drainEvents, onChange — and this file cannot tell which
   * it is talking to. A UI that reaches for the engine directly works
   * beautifully until the day the engine is on somebody else's machine. */
  function act(action) {
    var r = SH.Table.act(action);
    return r ? { ok: true } : { ok: false, reason: 'that move was not accepted' };
  }

  function drain() {
    var events = SH.Table.drainEvents();
    events.forEach(function (e) {
      pushLog(e.kind, e.text);
      /* A nil going down, a bag penalty and the end of the game interrupt. All
       * three are expensive and none of them is visible in the cards. */
      say(e.text, { assertive: e.kind === 'nil' || e.kind === 'bags' || e.kind === 'game' });
    });
  }

  var lastMoment = '';

  function onTableChange() {
    state = SH.Table.view();
    if (!state) return;
    /* A half-made choice does not survive the turn it was made in. Without this,
     * a bid chosen and not placed would still be sitting in the select when the
     * bidding came round on the NEXT hand, offering a number from a hand that
     * has been shuffled away. */
    if (!(state.phase === 'bidding' && state.turn === mySeat)) pendingBid = null;
    drain();
    render();

    /* Focus moves when the GAME MOVED and the move is now ours.
     *
     * Compared as a token for the MOMENT rather than by watching whose turn it
     * is, because of the case that breaks the obvious version: when you play the
     * fourth card of a trick and take it, the turn goes from you to you —
     * finishTrick sets the leader to the winner in the same action, so there is
     * no frame in between and no change to notice. Take a trick and the game
     * sits there waiting on a hand you cannot reach. That bug was found and
     * fixed twice in the game next door; it is not being reintroduced here. */
    var moment = [state.phase, state.dealNumber, state.tricksPlayed,
      state.trick.length, state.turn,
      state.players.map(function (p) { return p.bid; }).join(',')].join('|');
    var mine = whoActs() === mySeat;
    /* Only if they asked for it. Moving focus is help when you are waiting to
     * play and an interruption when you are reading the log. */
    if (mine && moment !== lastMoment && settings.autofocus) focusForTurn();
    lastMoment = moment;
  }

  /* Whose move, from the VIEW rather than from the engine — the interface may be
   * looking at a projection that arrived over a socket, and G.seatToAct expects
   * the whole state. Here the two agree, because everything it reads is public
   * in this game; that is a property of spades and not a general licence. */
  function whoActs() {
    if (!state) return -1;
    if (state.phase === 'bidding' || state.phase === 'play') return state.turn;
    return -1;
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
   * During the bidding it is the BID BUTTONS and not the hand — the hand is
   * worth reading first, which is what H is for, but the thing you have to do is
   * choose a number. During play it is the hand. Getting this wrong drops focus
   * to <body>, which is silent: the player is left nowhere, with no way to know
   * the game is waiting. */
  function focusForTurn() {
    if (!state) return;
    if (state.phase === 'bidding' && state.turn === mySeat) {
      /* The select, which is where the decision is made. It opens on the
       * placeholder rather than on a number, so nothing is pre-chosen and the
       * announcement that opens the hand is the question rather than an answer
       * to it. */
      var sel = global.document.getElementById('bid-select');
      if (sel) { sel.focus(); return; }
    }
    var handPhase = state.phase === 'play' && state.turn === mySeat &&
      el.hand.querySelector('.card:not([aria-disabled="true"])');
    if (handPhase && el.hand.querySelector('.card')) { focusHand(); return; }
    var b = el.actions.querySelector('button');
    if (b) b.focus();
  }

  /* ONE table of review actions, named the same way in three places: the toolbar
   * buttons carry data-say, the keyboard maps a letter to a name, and this maps
   * the name to what gets said. Adding one means adding it in all three — which
   * is the point, because a shortcut with no button and a button with no
   * shortcut are both half-built. */
  var SAY = {
    hand: function () { return handText(); },
    trick: function () { return trickText(); },
    last: function () { return lastTrickText(); },
    score: function () { return scoreText(); },
    contract: function () { return contractText(); },
    count: function () { return countText(); },
    order: function () { return orderText(); },
    who: function () { return whoText(); },
    repeat: function () { return lastSpoken || 'Nothing to repeat.'; }
  };
  var KEYS = {
    h: 'hand', t: 'trick', l: 'last', s: 'score', b: 'contract',
    c: 'count', o: 'order', w: 'who', r: 'repeat'
  };

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();

    /* THE BID SELECT IS THE ONE FORM CONTROL THE REVIEW KEYS STILL WORK IN.
     *
     * The guard below exists so that typing into a field is typing and not a
     * flurry of announcements, and for every other input on this page that is
     * right. The bid select is the exception, because of where it sits: the
     * player is standing in it deciding what to bid, and the single most useful
     * thing at that moment is H for their hand. With the plain guard they would
     * have to shift+tab out to the toolbar to hear the cards they are bidding
     * on, which is the tab-stop problem this control was built to remove,
     * reappearing one step to the left.
     *
     * So the select simply does not take the form-control exemption, and every
     * shortcut below already preventDefault's itself, so the select's own
     * type-ahead does not also run alongside. None of those letters begins an
     * option, so nothing is taken away: N is held back further down — it is
     * type-ahead for "Nil" AND it would place a bid — and the digits are left
     * alone, which is how somebody who knows they want seven gets there fastest.
     *
     * An earlier version returned early for everything except the review
     * letters, which quietly took G and E with it. Between hands focus sits in
     * this select, so a player pressing G to catch up on the log got nothing,
     * and the shared log audit failed all six of its checks at once. */
    var inBidSelect = e.target.id === 'bid-select';
    if (!inBidSelect && (tag === 'input' || tag === 'select' || tag === 'textarea')) return;

    /* ? BEFORE THE STATE GUARD. Everything below needs a game in progress; the
     * keyboard hints do not, and are most wanted by somebody who has just
     * arrived and wants to know whether this can be played by keyboard at all. */
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

    /* E and G are the same keys in every game here. B is NOT: in the other four
     * it opens the bug reporter, and here it reads the contract — the number a
     * spades player needs more often than any other, which earns the single
     * letter that matches the word. Reporting a bug moves to the toolbar button
     * and to Shift+B, and the keyboard section says so.
     *
     * Checked before KEYS so that the shifted form wins over the plain one. */
    if (k === 'b' && e.shiftKey) { e.preventDefault(); openBug(); return; }
    if (k === 'e') { e.preventDefault(); openExport(); return; }
    if (k === 'g') { e.preventDefault(); focusLogEntry(0); return; }

    /* N is the one key held back inside the bid select, for two reasons that
     * point the same way. It would place the bid, and the bid is the button's
     * job alone. And "n" is the select's own type-ahead for "Nil", which is
     * how somebody who wants nil gets to it — taking that away to commit a bid
     * they had not chosen would be the worst of both. */
    if (k === 'n' && !inBidSelect && !el.log.contains(e.target)) {
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

  /* ---------------- export, and reporting a bug ---------------- */

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
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function buildTranscript() {
    var lines = [];
    lines.push('Spades — game log');
    if (state) {
      lines.push('Hand ' + state.dealNumber + ', phase ' + state.phase);
      /* The rules THIS TABLE plays by, taken from the table's config rather than
       * this browser's settings — the two differ once you have joined somebody
       * else's game, and a transcript reporting the local preference would be
       * reporting the wrong one. */
      lines.push('Playing to ' + G.targetOf(state) + '. ' +
        G.bagLimitOf(state) + ' bags cost ' + G.bagPenaltyOf(state) +
        '. Nil is worth ' + G.nilValueOf(state) + '.');
      lines.push('Score: ' + teamName(0) + ' ' + state.scores[0] +
        ' (' + bagWord(state.bags[0]) + '), ' +
        teamName(1) + ' ' + state.scores[1] + ' (' + bagWord(state.bags[1]) + ')');
      if (state.history.length) {
        lines.push('');
        lines.push('Hand  ' + teamName(0) + ' | ' + teamName(1));
        state.history.forEach(function (h) {
          lines.push(String(h.deal).padEnd(6) +
            'bid ' + (h.bids[0] + h.bids[2]) + ' took ' + (h.tricks[0] + h.tricks[2]) +
            ' (' + (h.delta[0] >= 0 ? '+' : '') + h.delta[0] + ')  |  ' +
            'bid ' + (h.bids[1] + h.bids[3]) + ' took ' + (h.tricks[1] + h.tricks[3]) +
            ' (' + (h.delta[1] >= 0 ? '+' : '') + h.delta[1] + ')');
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
    parts.push('Game: Spades');
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
      a.download = 'spades-log.txt';
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

  /* ---------------- the lobby ---------------- */

  var lobby = { code: null, seat: null };

  function $(id) { return global.document.getElementById(id); }

  function lobbyStatus(text) {
    var node = $('lobby-status');
    if (node) node.textContent = text || '';
    if (text) say(text, { request: true });
  }

  function normaliseCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* "9, K, Z, 2, Y" — for reading down a phone. A screen reader says a
   * five-character run as a word, and "9KZ2Y" is not a word. */
  function spellCode(code) { return String(code || '').split('').join(', '); }

  /* The rules the whole table plays by, fixed when it is made.
   *
   * Deliberately not the whole settings object: pace, skin and the player's own
   * name are this browser's business and nobody else's. Every rule the engine
   * reads has to be here — a table made without bagLimit would play by the
   * engine's default while the host's settings screen said something else. */
  function roomConfig() {
    return {
      numPlayers: G.SEATS,
      names: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4'],
      pointsToWin: settings.points || G.TARGET,
      bagLimit: G.BAG_LIMIT,
      bagPenalty: G.BAG_PENALTY,
      nilValue: G.NIL_VALUE,
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

    var myName = (el['opt-name'].value || 'MyPlayerName').slice(0, 16);
    SH.Table.startOnline(seat, function (handler) {
      return SH.Net.connect({ code: clean, seat: seat, name: myName }, handler, onNetStatus);
    });

    $('lobby-choose').hidden = true;
    $('lobby-table').hidden = false;
    $('lobby-code-display').textContent = clean;
    var a = $('lobby-invite');
    if (a) { a.href = inviteLink(clean); a.textContent = inviteLink(clean); }
    renderLobbySeats();
    $('lobby-code-display').focus();
  }

  /* The address of this page with the table already chosen. Built from location
   * rather than hard coded, so it is right on the published site, right on a
   * local file and right behind whatever anybody puts in front of it. */
  function inviteLink(code) {
    return global.location.origin + global.location.pathname + '?table=' + encodeURIComponent(code);
  }

  function codeFromUrl() {
    try {
      var m = /[?&]table=([^&#]+)/.exec(global.location.search || '');
      return m ? normaliseCode(decodeURIComponent(m[1])) : '';
    } catch (e) { return ''; }
  }

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

  /* Named renderLobbySeats, not renderSeats.
   *
   * There is a renderSeatFans above that fills the table STRIP. Two function
   * declarations with one name in the same scope is not an error — the later
   * one simply wins — and in the game next door that silently emptied the strip
   * with nothing anywhere complaining. Two names, no collision. */
  function renderLobbySeats() {
    var body = $('lobby-seats') && $('lobby-seats').querySelector('tbody');
    if (!body) return;
    body.innerHTML = '';
    var v = SH.Table.view();
    for (var i = 0; i < G.SEATS; i++) {
      var p = v && v.players && v.players[i];
      var tr = global.document.createElement('tr');
      cell(tr, 'th', 'Seat ' + (i + 1) + (i === mySeat ? ' (you)' : ''));
      /* The partnership, which a spades lobby has to show and a hearts lobby
       * must not: who you are sitting with is the first thing anybody wants to
       * know on arriving at a table, and it is decided by the seat you take.
       * Written in the same 1-based numbers as the Seat column beside it —
       * naming the internal indices here would be the only place on any screen
       * that seats are counted from zero. */
      cell(tr, 'td', i % 2 === 0 ? 'Seats 1 and 3' : 'Seats 2 and 4');
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
   * is never exercised by the online tests. */
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

    handFocus = 0;
    logFocus = 0;
    el.log.innerHTML = '';
    el['setup-section'].hidden = true;
    el['game-section'].hidden = false;

    /* Seat order is the partnership: you and South are seats 0 and 2. The names
     * are chosen so that reads correctly out loud — "you and South against East
     * and West" is a sentence a player can hold. */
    var cfg = {
      numPlayers: 4,
      names: [name, 'East', 'South', 'West'],
      pointsToWin: settings.points,
      bagLimit: G.BAG_LIMIT,
      bagPenalty: G.BAG_PENALTY,
      nilValue: G.NIL_VALUE,
      difficulty: 'hard'
    };
    var srv = SH.LocalServer.create({ config: cfg, latency: 0, botDelay: pace });
    SH.Table.startOnline(null, function (handler) { return srv.connect(null, handler); });

    dealWhenReady = true;
  }

  var dealWhenReady = false;

  function boot() {
    ['status', 'actions', 'hand', 'hand-hint', 'trick', 'lasttrick', 'players-table',
     'teams-table', 'history-table',
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
        global.navigator.clipboard.writeText(inviteLink(code)).then(function () {
          say('Invite link copied. The table code is ' + spellCode(code) + '.', { request: true });
        }).catch(function () { say('Could not copy. The table code is ' + spellCode(code) + '.', { request: true }); });
      } else {
        say('The table code is ' + spellCode(code) + '.', { request: true });
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
      if (state && state.phase !== 'idle' && el['lobby-section'] && !el['lobby-section'].hidden) {
        el['lobby-section'].hidden = true;
        el['game-section'].hidden = false;
        focusForTurn();
      }
      if (el['lobby-section'] && !el['lobby-section'].hidden) renderLobbySeats();
      if (dealWhenReady && state && state.phase === 'idle') {
        dealWhenReady = false;
        SH.Table.act({ type: 'start' });
      }
    });
    SH.Table.onRejected(function (info) {
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

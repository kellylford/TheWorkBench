/* Sheephead - interface, keyboard handling and screen reader announcements.
 *
 * Announcement policy: a run of opponent turns is buffered and spoken as one
 * polite message, so nothing gets cut off half way through. Errors go to a
 * separate assertive region. The visible game log is deliberately NOT a live
 * region, so it can be read back at leisure without being spoken twice.
 */
(function (global) {
  'use strict';
  var SH = global.SH;
  var C = SH.Cards, G = SH.Game, AI = SH.AI;

  /* Friendly crew names for the computer players, drawn fresh each game so the
   * table is not the same faces every time. Kept short and distinct so they stay
   * quick to hear and easy to tell apart when announced. */
  var CREW_NAMES = [
    'Old Salt', 'Deck Hand', 'Skipper', 'First Mate', 'Bosun', 'Lookout',
    'Navigator', 'Quartermaster', 'Sea Dog', 'Shipmate', 'Galley Cook', 'Rigger',
    'Swabbie', 'Purser', 'Ensign', 'Commodore', 'Coxswain', 'Mariner',
    'Barnacle', 'Driftwood', 'Castaway', 'Stowaway', 'Anchor', 'Compass',
    'Starboard', 'Portside', 'Tugboat', 'Dinghy', 'Landlubber', 'Seafarer'
  ];

  /* Pick `count` distinct crew names, avoiding whatever the player called
   * themselves so no two seats share a name. */
  function crewNames(count, avoid) {
    var pool = CREW_NAMES.filter(function (nm) {
      return nm.toLowerCase() !== String(avoid || '').trim().toLowerCase();
    });
    return C.shuffle(pool).slice(0, count);
  }
  var STORE_KEY = 'sheephead.settings.v1';

  var state = null;
  var settings = null;
  var timer = null;
  var speech = [];
  var lastSpoken = '';
  var handMode = 'idle';         // idle | play | bury
  var selected = {};             // card id -> true, while burying
  var handFocus = 0;
  var logFocus = 0;

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ['setup-section', 'setup-form', 'game-section', 'status', 'actions', 'hand',
      'trick', 'lasttrick', 'players-table', 'log', 'announcer', 'alerts', 'help-dialog',
      'game-h', 'export-dialog', 'export-text', 'export-summary'].forEach(function (id) {
        el[id] = $(id);
      });

    loadSettings();
    el['setup-form'].addEventListener('submit', onStart);
    $('setup-help').addEventListener('click', openHelp);
    $('btn-help').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', function () { closeDialog(el['help-dialog']); });
    // Escape closes a native dialog without going through our button.
    ['help-dialog', 'export-dialog'].forEach(function (id) {
      el[id].addEventListener('close', restoreDialogFocus);
    });
    $('btn-newgame').addEventListener('click', backToSetup);
    $('btn-log').addEventListener('click', function () { focusLogEntry(0); });
    $('btn-export').addEventListener('click', openExport);
    $('export-close').addEventListener('click', function () { closeDialog(el['export-dialog']); });
    $('export-download').addEventListener('click', downloadExport);
    $('export-copy').addEventListener('click', copyExport);

    document.querySelectorAll('[data-say]').forEach(function (b) {
      b.addEventListener('click', function () { say(b.getAttribute('data-say')); });
    });

    el.hand.addEventListener('keydown', onHandKeys);
    el.log.addEventListener('keydown', onLogKeys);
    document.addEventListener('keydown', onGlobalKeys);
  }

  /* ---------------- settings ---------------- */

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { s = {}; }
    if (s.name) $('opt-name').value = s.name;
    if (s.numPlayers) $('opt-players').value = String(s.numPlayers);
    if (s.allPass) $('opt-allpass').value = s.allPass;
    if (s.difficulty) $('opt-difficulty').value = s.difficulty;
    if (s.pace !== undefined) $('opt-pace').value = String(s.pace);
    if (s.verbose !== undefined) $('opt-verbose').checked = !!s.verbose;
    if (s.autofocus !== undefined) $('opt-autofocus').checked = !!s.autofocus;
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  function readForm() {
    var name = ($('opt-name').value || 'You').trim().slice(0, 16) || 'You';
    var n = parseInt($('opt-players').value, 10);
    var names = [name].concat(crewNames(n - 1, name));
    return {
      name: name,
      names: names,
      numPlayers: n,
      allPass: $('opt-allpass').value,
      difficulty: $('opt-difficulty').value,
      pace: parseInt($('opt-pace').value, 10),
      verbose: $('opt-verbose').checked,
      autofocus: $('opt-autofocus').checked
    };
  }

  /* ---------------- game lifecycle ---------------- */

  function onStart(e) {
    e.preventDefault();
    settings = readForm();
    saveSettings();
    state = G.createGame(settings);
    el['setup-section'].hidden = true;
    el['game-section'].hidden = false;
    el.log.innerHTML = '';
    var d = G.DEAL[settings.numPlayers];
    pushLog('info', settings.numPlayers + ' players. ' + d.hand + ' cards each, ' +
      d.blind + ' card blind. ' + (d.partner ? 'Jack of Diamonds partner.' : 'The picker always plays alone.'));
    dealNext();
  }

  function backToSetup() {
    clearTimeout(timer);
    state = null;
    el['game-section'].hidden = true;
    el['setup-section'].hidden = false;
    $('opt-name').focus();
  }

  function dealNext() {
    clearTimeout(timer);
    selected = {};
    handFocus = 0;
    G.newHand(state);
    drain();
    speech.unshift(' ');            // keeps the deal line from merging with the previous hand
    tick();
  }

  /* Move engine events into the log and the pending speech buffer. */
  function drain() {
    var evts = state.events.splice(0, state.events.length);
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i];
      var text = (!settings.verbose && e.textPlain) ? e.textPlain : e.text;
      pushLog(e.kind, text);
      speech.push(text);
    }
  }

  function isHumanTurn() {
    if (!state) return false;
    if (state.phase === 'pick') return state.turn === 0;
    if (state.phase === 'bury') return state.picker === 0;
    if (state.phase === 'play') return state.turn === 0;
    return false;
  }

  /* The main loop: render, then either hand control to the player or let a
   * computer seat act after the configured pause. */
  function tick() {
    render();
    if (state.phase === 'handOver') { flush(); focusFirstAction(); return; }
    if (isHumanTurn()) { flush(); focusForTurn(); return; }
    if (settings.pace < 0) { flush(); focusFirstAction(); return; }
    timer = setTimeout(function () {
      AI.act(state);
      drain();
      tick();
    }, settings.pace);
  }

  function stepOnce() {
    AI.act(state);
    drain();
    tick();
  }

  /* ---------------- announcements ---------------- */

  function flush() {
    var extra = turnPrompt();
    if (extra) speech.push(extra);
    var msg = speech.filter(function (s) { return s && s.trim(); }).join(' ');
    speech = [];
    if (!msg) return;
    announce(msg);
  }

  function announce(msg) {
    lastSpoken = msg;
    el.announcer.textContent = '';
    setTimeout(function () { el.announcer.textContent = msg; }, 60);
  }

  function alert_(msg) {
    el.alerts.textContent = '';
    setTimeout(function () { el.alerts.textContent = msg; }, 60);
  }

  function turnPrompt() {
    if (!state) return '';
    if (state.phase === 'handOver') return 'Press Enter on Deal next hand to continue.';
    if (!isHumanTurn()) {
      if (settings.pace < 0) return 'Press Enter on Continue for the next play.';
      return '';
    }
    var d = G.DEAL[settings.numPlayers];
    if (state.phase === 'pick') {
      return 'Your turn. Pick up the blind of ' + d.blind + ' cards, or pass? Press H to hear your hand.';
    }
    if (state.phase === 'bury') {
      return 'You picked. Choose ' + d.blind + ' cards to bury, then activate the Bury button.';
    }
    if (state.phase === 'play') {
      var n = state.trick.length;
      if (n === 0) return 'Your lead. Trick ' + trickNumber() + ' of ' + d.hand + '.';
      return 'Your turn to play. ' + describeTrickShort();
    }
    return '';
  }

  /* Which trick we are on, counted from the player's own remaining cards. */
  function trickNumber() {
    var d = G.DEAL[settings.numPlayers];
    return Math.min(d.hand, d.hand - state.players[0].hand.length + (inTrick(0) ? 0 : 1));
  }

  function inTrick(p) {
    return state.trick.some(function (t) { return t.player === p; });
  }

  function describeTrickShort() {
    if (!state.trick.length) return 'Nothing played to this trick yet.';
    var led = C.effSuit(state.trick[0].card);
    var w = state.trick[G.trickWinnerIndex(state.trick)];
    var pts = C.sumPoints(state.trick.map(function (t) { return t.card; }));
    return (led === 'T' ? 'Trump' : C.SUIT_NAME[led]) + ' led. ' +
      state.players[w.player].name + ' is winning with ' + C.name(w.card) + '. ' +
      pts + (pts === 1 ? ' point' : ' points') + ' in the trick so far.';
  }

  /* ---------------- review keys ---------------- */

  function say(what) {
    if (!state) return;
    switch (what) {
      case 'hand': announce(textHand()); break;
      case 'trick': announce(textTrick()); break;
      case 'last': announce(textLastTrick()); break;
      case 'score': announce(textScores()); break;
      case 'teams': announce(textTeams()); break;
      case 'count': announce(textCount()); break;
      case 'repeat': announce(lastSpoken || 'Nothing to repeat.'); break;
    }
  }

  function textHand() {
    var hand = C.sortHand(state.players[0].hand);
    if (!hand.length) return 'Your hand is empty.';
    var groups = { T: [], C: [], S: [], H: [] };
    hand.forEach(function (c) { groups[C.effSuit(c)].push(c); });
    var parts = [];
    if (groups.T.length) {
      parts.push('Trump: ' + groups.T.map(function (c) { return C.name(c); }).join(', '));
    }
    ['C', 'S', 'H'].forEach(function (s) {
      if (groups[s].length) {
        parts.push(C.SUIT_NAME[s] + ': ' + groups[s].map(function (c) { return C.RANK_NAME[c.r]; }).join(', '));
      }
    });
    var msg = 'Your hand, ' + hand.length + (hand.length === 1 ? ' card. ' : ' cards. ') + parts.join('. ') + '.';
    if (settings.verbose) msg += ' Worth ' + C.sumPoints(hand) + ' points.';
    return msg;
  }

  function textTrick() {
    var d = G.DEAL[settings.numPlayers];
    var head = 'Trick ' + trickNumber() + ' of ' + d.hand + '. ';
    if (!state.trick.length) return head + 'Nothing played yet. ' + state.players[state.turn].name + ' to lead.';
    var list = state.trick.map(function (t) {
      return state.players[t.player].name + ', ' + (settings.verbose ? C.describe(t.card) : C.name(t.card));
    }).join('. ');
    return head + list + '. ' + describeTrickShort();
  }

  function textLastTrick() {
    if (!state.lastTrick) return 'No trick has been completed yet this hand.';
    var lt = state.lastTrick;
    var list = lt.plays.map(function (t) {
      return state.players[t.player].name + ', ' + C.name(t.card);
    }).join('. ');
    return 'Last trick. ' + list + '. ' + state.players[lt.winner].name + ' took it for ' + lt.points + ' points.';
  }

  function textScores() {
    var hand = state.players.map(function (p) {
      return p.name + ' ' + p.points + (p.tricksWon === 1 ? ', 1 trick' : ', ' + p.tricksWon + ' tricks');
    }).join('. ');
    var running = state.players.map(function (p) { return p.name + ' ' + p.score; }).join(', ');
    var buried = '';
    if (state.picker === 0 && state.buried.length) {
      buried = ' You buried ' + C.sumPoints(state.buried) + ' points.';
    }
    return 'This hand: ' + hand + '.' + buried + ' Running score: ' + running + '.';
  }

  function textTeams() {
    if (!state) return '';
    if (state.phase === 'pick') return 'Nobody has picked yet. ' + state.players[state.turn].name + ' is deciding.';
    if (state.isLeaster) return 'Leaster. There is no picker; everyone plays for themselves and the fewest points wins. You must take at least one trick to be eligible.';
    if (state.picker < 0) return 'No picker yet.';
    var d = G.DEAL[settings.numPlayers];
    var msg = state.picker === 0 ? 'You are the picker.' : state.players[state.picker].name + ' is the picker.';
    if (!d.partner) return msg + ' With ' + settings.numPlayers + ' players the picker always plays alone.';

    // Once the Jack of Diamonds has shown, everything is public.
    if (state.partnerRevealed) {
      return msg + (state.alone
        ? ' The picker is playing alone.'
        : ' ' + (state.partner === 0 ? 'You are' : state.players[state.partner].name + ' is') + ' the partner.');
    }
    // Still hidden. Only tell the player what their own cards entitle them to know.
    if (state.picker === 0) {
      return msg + (state.alone
        ? ' You have the Jack of Diamonds yourself, so you are playing alone. Nobody else knows that yet.'
        : ' Somebody else holds the Jack of Diamonds and is your secret partner.');
    }
    if (state.partner === 0) {
      return msg + ' You hold the Jack of Diamonds, so you are the secret partner. Nobody else knows yet.';
    }
    return msg + ' The Jack of Diamonds has not been played, so the partner is still unknown — ' +
      'and the picker may be holding it and playing alone.';
  }

  /* Card counting aid. Uses only what the player could legitimately track:
   * cards already played, their own hand, and their own buried cards. */
  function textCount() {
    var seen = {};
    state.played.forEach(function (c) { seen[c.id] = 1; });
    state.players[0].hand.forEach(function (c) { seen[c.id] = 1; });
    if (state.picker === 0) state.buried.forEach(function (c) { seen[c.id] = 1; });
    var unaccounted = C.newDeck().filter(function (c) { return !seen[c.id]; });

    var trumpPlayed = state.played.filter(C.isTrump).length;
    var parts = ['Trump played: ' + trumpPlayed + ' of 14.'];

    var outTrump = unaccounted.filter(C.isTrump).sort(function (a, b) { return C.power(b) - C.power(a); });
    parts.push(outTrump.length
      ? 'Highest trump you have not seen: ' + C.name(outTrump[0]) + '. ' + outTrump.length + ' unseen trump.'
      : 'You have seen every trump.');

    var mine = state.players[0].hand.filter(C.isTrump).sort(function (a, b) { return C.power(b) - C.power(a); });
    if (mine.length) parts.push('Your highest trump: ' + C.name(mine[0]) + '.');

    C.FAIL_SUITS.forEach(function (s) {
      var played = state.played.filter(function (c) { return !C.isTrump(c) && c.s === s; }).length;
      var out = unaccounted.filter(function (c) { return !C.isTrump(c) && c.s === s; });
      parts.push(C.SUIT_NAME[s] + ': ' + played + ' of 6 played, ' +
        (out.length ? 'highest unseen ' + C.RANK_NAME[out[0].r] : 'none unseen') + '.');
    });
    return parts.join(' ');
  }

  /* ---------------- rendering ---------------- */

  function render() {
    renderStatus();
    renderActions();
    renderHand();
    renderTrick(el.trick, state.trick, true);
    renderTrick(el.lasttrick, state.lastTrick ? state.lastTrick.plays : [], false, state.lastTrick);
    renderPlayers();
    syncLogTabs();
  }

  function renderStatus() {
    var d = G.DEAL[settings.numPlayers];
    var s;
    if (state.phase === 'pick') {
      s = isHumanTurn()
        ? 'Your turn: pick up the blind (' + d.blind + ' cards) or pass?'
        : 'Waiting for ' + state.players[state.turn].name + ' to pick or pass.';
    } else if (state.phase === 'bury') {
      s = state.picker === 0
        ? 'You picked. Bury ' + d.blind + ' cards.'
        : state.players[state.picker].name + ' picked and is burying.';
    } else if (state.phase === 'play') {
      s = 'Trick ' + trickNumber() + ' of ' + d.hand + ' — ' +
        (isHumanTurn() ? 'your turn to play.' : state.players[state.turn].name + ' to play.');
    } else if (state.phase === 'handOver') {
      s = 'Hand ' + state.handNumber + ' complete.';
    } else {
      s = '';
    }
    el.status.textContent = s;
  }

  function renderActions() {
    var box = el.actions;
    box.innerHTML = '';
    var d = G.DEAL[settings.numPlayers];

    if (state.phase === 'handOver') {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = state.result ? state.result.summary : '';
      box.appendChild(p);
      box.appendChild(button('Deal next hand', dealNext, true));
      return;
    }

    if (!isHumanTurn()) {
      if (settings.pace < 0) {
        box.appendChild(button('Continue', stepOnce, true));
      } else {
        var w = document.createElement('p');
        w.className = 'hint';
        w.textContent = 'Waiting for ' + state.players[state.turn].name + '…';
        box.appendChild(w);
      }
      return;
    }

    if (state.phase === 'pick') {
      box.appendChild(button('Pick up the blind (' + d.blind + ' cards)', function () {
        G.doPick(state, 0); handFocus = 0; drain(); tick();
      }, true));
      box.appendChild(button('Pass', function () {
        G.doPass(state, 0); drain(); tick();
      }));
      return;
    }

    if (state.phase === 'bury') {
      var n = Object.keys(selected).length;
      var b = button('Bury ' + n + ' of ' + d.blind + ' selected cards', doBury, true);
      b.disabled = n !== d.blind;
      box.appendChild(b);
      var clr = button('Clear selection', function () {
        selected = {}; render(); alert_('Selection cleared.');
      });
      clr.disabled = n === 0;
      box.appendChild(clr);
      return;
    }

    if (state.phase === 'play') {
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = state.trick.length === 0
        ? 'Lead any card from your hand.'
        : 'Follow ' + (C.effSuit(state.trick[0].card) === 'T' ? 'trump' : C.SUIT_NAME[C.effSuit(state.trick[0].card)]) + ' if you can.';
      box.appendChild(hint);
    }
  }

  function button(label, fn, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', fn);
    return b;
  }

  function renderHand() {
    var hand = C.sortHand(state.players[0].hand);
    handMode = 'idle';
    if (state.phase === 'bury' && state.picker === 0) handMode = 'bury';
    else if (state.phase === 'play' && isHumanTurn()) handMode = 'play';

    var legalIds = {};
    if (handMode === 'play') {
      G.legalPlays(state, 0).forEach(function (c) { legalIds[c.id] = 1; });
    }

    el.hand.innerHTML = '';
    if (!hand.length) {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No cards left.';
      el.hand.appendChild(p);
      return;
    }

    if (handFocus >= hand.length) handFocus = hand.length - 1;
    if (handFocus < 0) handFocus = 0;

    // Start the player on a card the rules actually allow, rather than making
    // them arrow past cards that have already been ruled out. They can still
    // reach every card to review it.
    if (handMode === 'play' && !legalIds[hand[handFocus].id]) {
      for (var f = 0; f < hand.length; f++) {
        if (legalIds[hand[f].id]) { handFocus = f; break; }
      }
    }

    hand.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (C.isTrump(c) ? ' trump' : '') + ((c.s === 'H' || c.s === 'D') ? ' red' : '');
      b.dataset.id = c.id;
      b.dataset.index = String(i);
      b.tabIndex = i === handFocus ? 0 : -1;

      var pos = document.createElement('span');
      pos.className = 'pos'; pos.setAttribute('aria-hidden', 'true');
      pos.textContent = String(i + 1 === 10 ? 0 : i + 1);
      var rank = document.createElement('span');
      rank.className = 'rank'; rank.setAttribute('aria-hidden', 'true');
      rank.textContent = C.RANK_TEXT[c.r];
      var suit = document.createElement('span');
      suit.className = 'suit'; suit.setAttribute('aria-hidden', 'true');
      suit.textContent = C.SUIT_SYM[c.s];
      var tag = document.createElement('span');
      tag.className = 'tag'; tag.setAttribute('aria-hidden', 'true');
      tag.textContent = C.isTrump(c) ? 'trump ' + C.points(c) : C.points(c) + ' pts';
      b.appendChild(pos); b.appendChild(rank); b.appendChild(suit); b.appendChild(tag);

      var label = C.describe(c) + ', card ' + (i + 1) + ' of ' + hand.length;
      if (handMode === 'bury') {
        b.setAttribute('aria-pressed', selected[c.id] ? 'true' : 'false');
        label += selected[c.id] ? ', selected to bury' : '';
      } else if (handMode === 'play' && !legalIds[c.id]) {
        b.setAttribute('aria-disabled', 'true');
        label += ', cannot be played, ' + G.illegalReason(state, 0, c.id);
      } else if (handMode === 'idle') {
        b.setAttribute('aria-disabled', 'true');
        label += ', not your turn';
      }
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function () { activateCard(c.id, i); });
      b.addEventListener('focus', function () { handFocus = i; retab(); });
      el.hand.appendChild(b);
    });
  }

  function retab() {
    var cards = el.hand.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) cards[i].tabIndex = i === handFocus ? 0 : -1;
  }

  function renderTrick(node, plays, live, meta) {
    node.innerHTML = '';
    if (!plays || !plays.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = live ? 'Nothing played to this trick yet.' : 'No completed trick yet.';
      node.appendChild(li);
      return;
    }
    var wi = G.trickWinnerIndex(plays);
    plays.forEach(function (t, i) {
      var li = document.createElement('li');
      if (i === wi) li.className = 'winning';
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = state.players[t.player].name + (i === 0 ? ' (led)' : '');
      var what = document.createElement('span');
      what.className = 'what';
      what.textContent = C.name(t.card);
      var flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = i === wi ? (live ? 'winning so far' : 'took the trick') : '';
      li.appendChild(who); li.appendChild(what); li.appendChild(flag);
      node.appendChild(li);
    });
    if (!live && meta) {
      var sum = document.createElement('li');
      sum.textContent = meta.points + ' points to ' + state.players[meta.winner].name + '.';
      node.appendChild(sum);
    }
  }

  function renderPlayers() {
    var tbody = el['players-table'].querySelector('tbody');
    tbody.innerHTML = '';
    var d = G.DEAL[settings.numPlayers];
    state.players.forEach(function (p, i) {
      var tr = document.createElement('tr');
      if (i === 0) tr.className = 'you';
      if (state.turn === i && state.phase !== 'handOver') tr.className += ' turn';

      // Roles must only show what this player is entitled to know: a hidden
      // partner, and a hidden "playing alone", stay off the table.
      var roles = [];
      if (i === state.dealer) roles.push('dealer');
      if (i === state.picker) {
        roles.push('picker');
        if (state.alone && (state.partnerRevealed || i === 0)) roles.push('alone');
      }
      if (!state.isLeaster && !state.alone && state.partner === i && (state.partnerRevealed || i === 0)) roles.push('partner');
      if (state.isLeaster) roles.push('leaster');

      var cells = [
        p.name + (i === 0 ? ' (you)' : ''),
        roles.length ? roles.join(', ') : '—',
        String(p.hand.length),
        String(p.tricksWon),
        String(p.points),
        (p.score > 0 ? '+' : '') + p.score
      ];
      cells.forEach(function (txt, ci) {
        var cell = document.createElement(ci === 0 ? 'th' : 'td');
        if (ci === 0) cell.scope = 'row';
        cell.textContent = txt;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    // A running total. Card points only add up to 120 once every trick has been
    // taken — until then the rest are still in people's hands — so the full
    // accounting is only shown, and only checked, at the end of a hand.
    // Mid-hand it would also leak the bury and the leaster blind.
    var taken = state.players.reduce(function (a, p) { return a + p.points; }, 0);
    var scoreSum = state.players.reduce(function (a, p) { return a + p.score; }, 0);
    var complete = state.phase === 'handOver';
    var cardsLeft = state.players.reduce(function (a, p) { return a + p.hand.length; }, 0);

    var tfoot = el['players-table'].querySelector('tfoot');
    tfoot.innerHTML = '';
    var tr2 = document.createElement('tr');
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = 'Total';
    tr2.appendChild(th);

    var pointsText, total = null;
    if (complete) {
      var buried = C.sumPoints(state.buried);
      var loose = C.sumPoints(state.blind);
      total = taken + buried + loose;
      pointsText = 'taken ' + taken +
        (buried ? ' + buried ' + buried : '') +
        (loose ? ' + blind ' + loose : '') + ' = ' + total;
    } else {
      pointsText = taken + ' taken so far';
    }

    var cells = ['—', String(cardsLeft), state.trickLog.length + ' of ' + d.hand,
      pointsText, String(scoreSum)];
    cells.forEach(function (txt) {
      var td = document.createElement('td');
      td.textContent = txt;
      tr2.appendChild(td);
    });
    if (complete && (total !== C.TOTAL_POINTS || scoreSum !== 0)) {
      tr2.className = 'bad-total';
      tr2.title = total !== C.TOTAL_POINTS
        ? 'Card points total ' + total + ' instead of ' + C.TOTAL_POINTS + '.'
        : 'Game scores total ' + scoreSum + ' instead of zero.';
    }
    tfoot.appendChild(tr2);
  }

  function pushLog(kind, text) {
    var li = document.createElement('li');
    li.className = 'k-' + kind;
    li.tabIndex = -1;
    li.textContent = text;
    el.log.insertBefore(li, el.log.firstChild);
    while (el.log.children.length > 200) el.log.removeChild(el.log.lastChild);
  }

  /* The log is a plain list of plain list items. Each entry is focusable, and
   * arrowing simply moves real DOM focus from one to the next — that alone is
   * what makes a screen reader read the entry out. No live region, no labels,
   * no description attributes: the item's own text is the announcement. */
  function applyLogTabs() {
    var items = el.log.children;
    for (var i = 0; i < items.length; i++) items[i].tabIndex = i === logFocus ? 0 : -1;
  }

  /* Called after re-rendering. New entries are prepended, which shifts whatever
   * the player was reading, so re-anchor on the element that actually has focus. */
  function syncLogTabs() {
    var items = el.log.children;
    var active = document.activeElement;
    for (var i = 0; i < items.length; i++) {
      if (items[i] === active) { logFocus = i; break; }
    }
    if (logFocus >= items.length) logFocus = items.length - 1;
    if (logFocus < 0) logFocus = 0;
    applyLogTabs();
  }

  function focusLogEntry(i) {
    var items = el.log.children;
    if (!items.length) { alert_('The game log is empty.'); return; }
    logFocus = Math.max(0, Math.min(items.length - 1, i));
    applyLogTabs();
    items[logFocus].focus();
  }

  function onLogKeys(e) {
    var items = el.log.children;
    if (!items.length) return;
    switch (e.key) {
      // Newest entry is first, so Down walks back in time.
      case 'ArrowDown': case 'ArrowRight':
        e.preventDefault(); focusLogEntry(logFocus + 1); break;
      case 'ArrowUp': case 'ArrowLeft':
        e.preventDefault(); focusLogEntry(logFocus - 1); break;
      case 'Home':
        e.preventDefault(); focusLogEntry(0); break;
      case 'End':
        e.preventDefault(); focusLogEntry(items.length - 1); break;
      case 'PageDown':
        e.preventDefault(); focusLogEntry(logFocus + 10); break;
      case 'PageUp':
        e.preventDefault(); focusLogEntry(logFocus - 10); break;
    }
  }

  /* ---------------- interaction ---------------- */

  function activateCard(id, index) {
    handFocus = index;
    if (handMode === 'bury') {
      var d = G.DEAL[settings.numPlayers];
      if (selected[id]) {
        delete selected[id];
        alert_(C.name(C.get(id)) + ' unselected.');
      } else if (Object.keys(selected).length >= d.blind) {
        alert_('You have already selected ' + d.blind + ' cards. Unselect one first.');
        return;
      } else {
        selected[id] = true;
        var n = Object.keys(selected).length;
        alert_(C.name(C.get(id)) + ' selected. ' + n + ' of ' + d.blind + '.');
      }
      render();
      focusCard(index);
      return;
    }
    if (handMode === 'play') {
      if (!G.isLegal(state, 0, id)) {
        alert_('You cannot play ' + C.name(C.get(id)) + '. ' + G.illegalReason(state, 0, id));
        return;
      }
      G.doPlay(state, 0, id);
      drain();
      tick();
      return;
    }
    alert_('It is not your turn to play a card.');
  }

  function doBury() {
    var ids = Object.keys(selected);
    var d = G.DEAL[settings.numPlayers];
    if (ids.length !== d.blind) { alert_('Select exactly ' + d.blind + ' cards.'); return; }
    var pts = C.sumPoints(ids.map(function (i) { return C.get(i); }));
    if (!G.doBury(state, ids)) { alert_('Those cards could not be buried.'); return; }
    selected = {};
    handFocus = 0;
    speech.push('You buried ' + pts + ' points.');
    drain();
    tick();
  }

  function focusCard(i) {
    var cards = el.hand.querySelectorAll('.card');
    if (cards[i]) { handFocus = i; retab(); cards[i].focus(); }
  }

  /* Never pull focus out from under someone who is in the middle of something:
   * filling a field, reading the help, or reading back through the log. The
   * announcement still tells them it is their turn. */
  function mayTakeFocus() {
    if (!settings.autofocus) return false;
    if (el['help-dialog'].open || el['export-dialog'].open) return false;
    var a = document.activeElement;
    if (!a) return true;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return false;
    if (el.log.contains(a)) return false;
    return true;
  }

  function focusForTurn() {
    if (!mayTakeFocus()) return;
    if (state.phase === 'pick') {
      var b = el.actions.querySelector('button');
      if (b) b.focus();
      return;
    }
    focusCard(handFocus);
  }

  function focusFirstAction() {
    if (!mayTakeFocus()) return;
    var b = el.actions.querySelector('button');
    if (b) b.focus();
  }

  function onHandKeys(e) {
    var cards = el.hand.querySelectorAll('.card');
    if (!cards.length) return;
    var i = handFocus;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown':
        e.preventDefault(); focusCard(Math.min(cards.length - 1, i + 1)); break;
      case 'ArrowLeft': case 'ArrowUp':
        e.preventDefault(); focusCard(Math.max(0, i - 1)); break;
      case 'Home':
        e.preventDefault(); focusCard(0); break;
      case 'End':
        e.preventDefault(); focusCard(cards.length - 1); break;
    }
  }

  function onGlobalKeys(e) {
    if (!state || el['game-section'].hidden) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (el['help-dialog'].open || el['export-dialog'].open) return;

    // Digits play a card, so they must not fire while reading back the log.
    if (/^[0-9]$/.test(e.key) && !el.log.contains(t)) {
      var idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
      var cards = el.hand.querySelectorAll('.card');
      if (idx < cards.length) {
        e.preventDefault();
        focusCard(idx);
        activateCard(cards[idx].dataset.id, idx);
      } else {
        alert_('You do not have a card ' + (idx + 1) + '.');
      }
      return;
    }

    var k = e.key.toLowerCase();
    if (k === 'g') { e.preventDefault(); focusLogEntry(0); return; }
    if (k === 'e') { e.preventDefault(); openExport(); return; }

    var map = { h: 'hand', t: 'trick', l: 'last', s: 'score', p: 'teams', c: 'count', r: 'repeat' };
    if (map[k]) { e.preventDefault(); say(map[k]); return; }
    if (e.key === '?') { e.preventDefault(); openHelp(); }
  }

  /* ---------------- export ---------------- */

  function buildTranscript() {
    var lines = [].map.call(el.log.children, function (li) { return li.textContent; });
    var head = 'Exported: ' + new Date().toString() + '\n';
    return head + G.transcript(state, lines);
  }

  function openExport() {
    if (!state) return;
    var text = buildTranscript();
    el['export-text'].value = text;
    var bad = state.history.filter(function (h) { return h.problems.length; });
    el['export-summary'].textContent = state.history.length + ' completed ' +
      (state.history.length === 1 ? 'hand' : 'hands') + '. ' +
      (bad.length
        ? bad.length + ' of them did NOT add up correctly — the details are in the text below.'
        : 'Every one of them adds up to 120 points with zero sum scoring.');
    openDialog(el['export-dialog']);
    el['export-text'].focus();
    announce('Export game log. ' + el['export-summary'].textContent);
  }

  function exportFilename() {
    var d = new Date();
    function two(v) { return (v < 10 ? '0' : '') + v; }
    return 'sheephead-log-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
      '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '.txt';
  }

  function downloadExport() {
    var name = exportFilename();
    try {
      var blob = new Blob([el['export-text'].value], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      alert_('Saved as ' + name + '. Check your downloads folder.');
    } catch (e) {
      alert_('This browser would not save the file. Use the text box below: it already has the ' +
        'whole log, so select all and copy.');
    }
  }

  function copyExport() {
    var text = el['export-text'].value;
    function fallback() {
      el['export-text'].focus();
      el['export-text'].select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      alert_(ok ? 'Game log copied to the clipboard.'
        : 'Could not copy automatically. The text is selected, so press Control C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert_('Game log copied to the clipboard.');
      }, fallback);
    } else {
      fallback();
    }
  }

  /* Dialogs must hand focus back where it came from. Native <dialog> does this
   * for showModal, but not for the plain-attribute fallback, so do it here for
   * both and cover Escape via the close event. */
  var dialogReturn = null;

  function openDialog(dlg) {
    var a = document.activeElement;
    dialogReturn = (a && a !== document.body) ? a : null;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function closeDialog(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    restoreDialogFocus();
  }

  function restoreDialogFocus() {
    var back = dialogReturn;
    dialogReturn = null;
    if (back && back.isConnected !== false && document.contains(back)) back.focus();
    else if (state && !el['game-section'].hidden) focusForTurn();
  }

  function openHelp() { openDialog(el['help-dialog']); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);

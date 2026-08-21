/* Cribbage - interface, keyboard handling and screen reader announcements.
 *
 * Announcement policy: a run of computer turns is buffered and spoken as one
 * polite message, so nothing gets cut off half way through. Errors and direct
 * replies to a keypress go to a separate assertive region. The visible game log
 * is deliberately NOT a live region, so it can be read back at leisure without
 * being spoken twice.
 *
 * THE CRIBBAGE-SPECIFIC ACCESSIBILITY DECISION, and the reason several functions
 * here are longer than their equivalents in the other games:
 *
 *   CRIBBAGE IS ARITHMETIC PERFORMED OUT LOUD. A sighted player looks at a pile
 *   of cards, a running count and their own hand, and knows in about a second
 *   which of their cards makes fifteen, which pairs, and which takes the count
 *   past thirty-one. Done by ear, that is a running sum plus four subtractions,
 *   repeated on every turn, while somebody waits.
 *
 *   So the program does the arithmetic and says it. Every card in your hand is
 *   labelled with what it is worth, what count it would make, and what it would
 *   score. Every hand and crib is counted out in its parts rather than as a
 *   total.
 *
 *   That is not coaching, and the line is worth being precise about: it tells
 *   you nothing you could not work out from cards that are face up on the table
 *   in front of everybody. It removes arithmetic, not judgement — which card to
 *   throw and when to risk a count of five are still entirely yours.
 */
(function (global) {
  'use strict';
  var SH = global.SH;
  var C = SH.Cards, G = SH.Game, AI = SH.AI;

  /* Names for the computer player, drawn fresh each game. */
  var CREW_NAMES = [
    'Ruth', 'Marta', 'Dale', 'Otis', 'Winnie', 'Hal', 'June', 'Cyrus',
    'Pearl', 'Vernon', 'Della', 'Amos', 'Nell', 'Gus', 'Iris', 'Roy',
    'Bea', 'Walt', 'Etta', 'Merle', 'Faye', 'Cliff', 'Norma', 'Lloyd'
  ];

  function crewNames(count, avoid) {
    var pool = CREW_NAMES.filter(function (nm) {
      return nm.toLowerCase() !== String(avoid || '').trim().toLowerCase();
    });
    return C.shuffle(pool).slice(0, count);
  }

  /* Its own key, and this is not cosmetic. localStorage is scoped to the ORIGIN,
   * not the path — every game in this repository lives under the same
   * kellylford.github.io — so a key shared with the stable Cribbage would mean
   * every setting changed here also changed there. Only keys THIS build has
   * itself retired may ever appear in OLD_STORE_KEYS, because loadSettings
   * removes them. */
  var STORE_KEY = 'cribbage-mp.settings.v1';
  var OLD_STORE_KEYS = [];

  var NET_IDS = ['net-line', 'net-actions', 'net-reconnect'];
  var LOBBY_IDS = ['lobby-section', 'lobby-status', 'lobby-choose', 'lobby-table',
    'lobby-create', 'lobby-join-form', 'lobby-code', 'lobby-code-display', 'lobby-code-read',
    'lobby-copy', 'lobby-leave', 'lobby-seats', 'lobby-back', 'setup-online',
    'table-code-line', 'lobby-start', 'lobby-start-hint',
    'table-code-actions', 'game-copy-code'];

  var DIALOGS = ['rules-dialog', 'a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'];

  function anyDialogOpen() {
    for (var i = 0; i < DIALOGS.length; i++) if (el[DIALOGS[i]] && el[DIALOGS[i]].open) return true;
    return false;
  }

  var mySeat = 0;

  /* `state` holds a VIEW — what this seat is entitled to see — never the
   * authoritative game. Offline the authoritative game is right there in
   * `local`, and rendering from the projection instead means every single-player
   * hand exercises it: a field missing from js/view.js becomes a broken screen
   * on somebody's first deal rather than an online-only bug found six weeks
   * later by the one person who hit it. */
  var state = null;
  var local = null;
  var settings = null;
  var timer = null;
  var speech = [];
  var lastSpoken = '';
  var lastCount = '';            // the last count read out, for the L key
  var handMode = 'idle';         // idle | play | throw
  var selected = {};             // card id -> true, while choosing what to throw
  var handFocus = 0;
  var logFocus = 0;
  var lastActionsKey = null;
  var actionsRebuilt = false;
  var turnWatch = { key: null, at: 0 };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ['setup-section', 'setup-form', 'game-section', 'status', 'actions', 'hand',
      'pile', 'count-line', 'board', 'crib', 'crib-note', 'crib-section',
      'starter', 'starter-section', 'score-table', 'log', 'announcer', 'alerts',
      'game-h', 'export-dialog', 'export-text', 'export-summary',
      'bug-dialog', 'bug-title', 'bug-what', 'bug-include-log', 'bug-preview',
      'rules-dialog', 'a11y-dialog', 'settings-dialog', 'settings-summary']
      .concat(LOBBY_IDS).concat(NET_IDS).forEach(function (id) { el[id] = $(id); });

    $('setup-online').addEventListener('click', function () {
      settings = readForm();
      saveSettings();
      showLobby();
    });
    $('lobby-back').addEventListener('click', hideLobby);
    $('lobby-create').addEventListener('click', createTable);
    $('lobby-copy').addEventListener('click', copyCode);
    $('game-copy-code').addEventListener('click', copyCode);
    $('net-reconnect').addEventListener('click', reconnect);
    $('lobby-start').addEventListener('click', function () {
      var r = SH.Table.act({ type: 'start' });
      if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
      lobbyStatus('Starting the game…');
    });
    $('lobby-leave').addEventListener('click', leaveTable);
    $('lobby-join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      joinTable($('lobby-code').value, null);
    });
    $('lobby-code').addEventListener('change', function () {
      var clean = normaliseCode($('lobby-code').value);
      if (clean.length >= 5) alert_('Code entered: ' + spellCode(clean) + '.');
    });

    SH.Table.onChange(function () {
      if (!el['lobby-section'].hidden) {
        renderSeats2();
        maybeEnterGame();
        return;
      }
      if (SH.Table.isLocal()) return;      // offline, tick() already did this
      refresh();
      drain();
      tick();
    });
    SH.Table.onRejected(onRejected);

    loadSettings();
    el['setup-form'].addEventListener('submit', onStart);
    $('setup-rules').addEventListener('click', openRules);
    $('setup-a11y').addEventListener('click', openA11y);
    $('btn-rules').addEventListener('click', openRules);
    $('btn-a11y').addEventListener('click', openA11y);
    $('rules-close').addEventListener('click', function () { closeDialog(el['rules-dialog']); });
    $('a11y-close').addEventListener('click', function () { closeDialog(el['a11y-dialog']); });
    $('rules-to-a11y').addEventListener('click', function () { switchDialog('rules-dialog', 'a11y-dialog'); });
    $('a11y-to-rules').addEventListener('click', function () { switchDialog('a11y-dialog', 'rules-dialog'); });
    DIALOGS.forEach(function (id) { el[id].addEventListener('close', restoreDialogFocus); });
    $('btn-newgame').addEventListener('click', backToSetup);
    $('setup-settings').addEventListener('click', openSettings);
    $('btn-settings').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', function () { closeDialog(el['settings-dialog']); });
    $('settings-reset').addEventListener('click', resetSettings);
    ['opt-target', 'opt-difficulty', 'opt-pace', 'opt-verbose', 'opt-autofocus',
      'opt-name', 'opt-skin', 'opt-layout']
      .forEach(function (id) { $(id).addEventListener('change', onSettingChanged); });
    $('btn-log').addEventListener('click', function () { focusLogEntry(0); });
    $('btn-export').addEventListener('click', openExport);
    $('export-close').addEventListener('click', function () { closeDialog(el['export-dialog']); });
    $('export-download').addEventListener('click', downloadExport);
    $('export-copy').addEventListener('click', copyExport);
    $('btn-bug').addEventListener('click', openBug);
    $('bug-close').addEventListener('click', function () { closeDialog(el['bug-dialog']); });
    $('bug-open').addEventListener('click', bugCopyAndOpen);
    $('bug-copy').addEventListener('click', function () {
      copyText(buildBugReport(), el['bug-preview'], 'Report');
    });
    ['bug-title', 'bug-what'].forEach(function (id) {
      el[id].addEventListener('input', refreshBugPreview);
    });
    el['bug-include-log'].addEventListener('change', refreshBugPreview);

    document.querySelectorAll('[data-say]').forEach(function (b) {
      b.addEventListener('click', function () { say(b.getAttribute('data-say')); });
    });

    el.hand.addEventListener('keydown', onHandKeys);
    el.log.addEventListener('keydown', onLogKeys);
    document.addEventListener('keydown', onGlobalKeys);
  }

  /* ---------------- settings ---------------- */

  var DEFAULTS = {
    name: 'You', targetScore: 121, difficulty: 'normal',
    pace: 4000, verbose: true, autofocus: true, skin: 'traditional', layout: 'one'
  };

  /* Rules the engine must not see change part way through a hand. */
  var RULE_FIELDS = ['targetScore', 'difficulty'];

  function applyToForm(s) {
    $('opt-name').value = s.name;
    $('opt-target').value = String(s.targetScore);
    if (!$('opt-target').value) $('opt-target').value = String(DEFAULTS.targetScore);
    $('opt-difficulty').value = s.difficulty;
    $('opt-pace').value = String(s.pace);
    if (!$('opt-pace').value) $('opt-pace').value = String(DEFAULTS.pace);
    $('opt-skin').value = s.skin;
    $('opt-layout').value = s.layout;
    $('opt-verbose').checked = !!s.verbose;
    $('opt-autofocus').checked = !!s.autofocus;
  }

  function loadSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      OLD_STORE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { stored = {}; }
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      s[k] = stored[k] === undefined ? DEFAULTS[k] : stored[k];
    });
    applyToForm(s);
    settings = readForm();
    applySkin();
    renderSettingsSummary();
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(readForm())); } catch (e) { /* private mode */ }
    renderSettingsSummary();
  }

  var PACE_NAMES = {
    '0': 'Instant pace', '4000': 'Four seconds between plays',
    '10000': 'Ten seconds between plays', '-1': 'Manual pace'
  };
  var PACE_WORDS = { '4000': 'four seconds', '10000': 'ten seconds' };
  function paceWords() {
    return PACE_WORDS[String(settings.pace)] || Math.round(settings.pace / 1000) + ' seconds';
  }

  function renderSettingsSummary() {
    if (!el['settings-summary']) return;
    var f = readForm();
    el['settings-summary'].textContent = [
      'Playing to ' + f.targetScore,
      f.difficulty + ' opponent',
      PACE_NAMES[String(f.pace)] || 'Instant pace',
      f.verbose ? 'Counts broken down' : 'Counts as totals',
      f.skin === 'plain' ? 'Plain cards' : 'Traditional cards',
      f.layout === 'two' ? 'Two column desktop' : 'One column'
    ].join('. ') + '.';
  }

  function readForm() {
    var name = ($('opt-name').value || 'You').trim().slice(0, 16) || 'You';
    return {
      name: name,
      names: [name].concat(crewNames(1, name)),
      targetScore: parseInt($('opt-target').value, 10) || DEFAULTS.targetScore,
      difficulty: $('opt-difficulty').value,
      skin: $('opt-skin').value,
      layout: $('opt-layout').value,
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
    var cfg = {};
    Object.keys(settings).forEach(function (k) { cfg[k] = settings[k]; });
    local = G.createGame(cfg);
    SH.Table.startLocal(local, mySeat);
    resetSpeech();
    refresh();
    lastActionsKey = null;
    el['setup-section'].hidden = true;
    el['game-section'].hidden = false;
    el.log.innerHTML = '';
    pushLog('info', 'Cribbage to ' + settings.targetScore + ' against ' + settings.names[1] + '.');
    SH.Table.act({ type: 'start' });
    refresh();
    drain();
    tick();
  }

  function backToSetup() {
    clearTimeout(timer);
    resetSpeech();
    SH.Table.close();
    /* Back to seat 0, and this is not cosmetic: a seat number surviving an
     * online table would have the next single-player game projecting a view for
     * seat 1 while createGame seats the human at 0. */
    mySeat = 0;
    netTroubled = false;
    netState = 'offline';
    showNetTrouble('', false);
    if (el['table-code-line']) { el['table-code-line'].hidden = true; el['table-code-line'].textContent = ''; }
    if (el['table-code-actions']) el['table-code-actions'].hidden = true;
    lobby.code = null;
    lobby.connected = false;
    state = null;
    local = null;
    el['game-section'].hidden = true;
    el['setup-section'].hidden = false;
    applyOnlineSettingLocks();
    $('opt-name').focus();
  }

  function dealNext() {
    clearTimeout(timer);
    selected = {};
    handFocus = 0;
    lastActionsKey = null;
    /* Rule changes take effect at a hand boundary, never part way through a hand
     * already being scored under the old rules. Offline only: online the rules
     * belong to the ROOM and are fixed when the table is made, or every client
     * would quietly overwrite them from its own saved settings on every deal. */
    if (local) RULE_FIELDS.forEach(function (k) { local.config[k] = settings[k]; });
    /* Checked, like every other move. Dealing used to ignore its own result, so
     * when the engine refused it the button simply did nothing and said nothing
     * — the exact silence this whole codebase is arranged to prevent. */
    var r = SH.Table.act({ type: 'nextHand' });
    if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
    refresh();
    drain();
    speech.unshift(' ');
    tick();
  }

  function refresh() { state = SH.Table.view(); return state; }

  function drain() {
    var evts = SH.Table.drainEvents();
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i];
      var text = (!settings.verbose && e.textPlain) ? e.textPlain : e.text;
      pushLog(e.kind, text);
      speech.push(text);
      if (e.kind === 'count') lastCount = e.text;
    }
  }

  /* Is this browser's seat the one the table is waiting for?
   *
   * Not simply `turn === mySeat`, and the discard is why: both players choose at
   * once, so "my move" there means "I have not thrown yet" regardless of whose
   * name is in `turn`. Cutting for deal and dealing the next hand are first-come
   * and either seat may do them. */
  function myMove() {
    if (!state) return false;
    switch (state.phase) {
      case 'cutForDeal': return true;
      case 'discard': return !state.players[mySeat].hasDiscarded;
      case 'play': return state.turn === mySeat;
      case 'count': return state.turn === mySeat;
      case 'roundOver': case 'gameOver': return true;
      default: return false;
    }
  }

  function waitingFor() {
    if (!state) return -1;
    if (state.phase === 'discard') {
      for (var i = 0; i < G.SEATS; i++) if (!state.players[i].hasDiscarded) return i;
      return -1;
    }
    return G.seatToAct(state);
  }

  function tick() {
    render();

    /* Online, pace is not this browser's to set. settings.pace does not describe
     * how fast the player wants to read — it DRIVES THE ENGINE, by deciding when
     * the computer acts. Coherent for a game living in one tab, incoherent for a
     * table: the bots belong to the room, and two clients each running their own
     * timer would be two people trying to deal at once. */
    if (!SH.Table.isLocal()) {
      flush();
      if (myMove()) focusForTurn();
      return;
    }

    if (state.phase === 'roundOver' || state.phase === 'gameOver') {
      flush(); focusFirstAction(); return;
    }
    if (myMove()) { flush(); focusForTurn(); return; }
    if (settings.pace < 0) { flush(); focusFirstAction(); return; }
    if (settings.pace > 0) flush();
    timer = setTimeout(function () {
      AI.act(local);
      refresh();
      drain();
      tick();
    }, settings.pace);
  }

  function stepOnce() {
    if (!SH.Table.isLocal()) return;
    clearTimeout(timer);
    timer = null;
    AI.act(local);
    refresh();
    drain();
    tick();
  }

  /* A move the table refused, or never answered.
   *
   * FOCUS IS RESTORED BEFORE ANYTHING IS SAID. Offline a rejection is
   * synchronous and focus never moves; online it can arrive after a re-render
   * that has already destroyed the button the player was standing on, dropping
   * focus to <body> — the worst outcome for somebody navigating by keyboard,
   * because there is no way back except Tab from the top of the document. */
  function onRejected(info) {
    if (!info) return;
    if (info.reason) {
      alert_(sentence(info.reason) + (info.timedOut
        ? ' Nothing has been played. You can try again.' : ''));
    }
    if (state && myMove()) {
      var cards = el.hand.querySelectorAll('.card');
      if (cards.length && !el.hand.contains(document.activeElement)) focusCard(handFocus);
    }
  }

  /* ---------------- the lobby ---------------- */

  var lobby = { code: null, connected: false };
  var netTroubled = false;
  var netState = 'offline';

  function sentence(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(t) ? t : t + '.';
  }

  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function normaliseCode(raw) {
    return String(raw || '').toUpperCase().split('').filter(function (c) {
      return CODE_ALPHABET.indexOf(c) >= 0;
    }).join('');
  }

  function spellCode(code) { return String(code || '').split('').join(', '); }

  function showLobby() {
    el['setup-section'].hidden = true;
    el['game-section'].hidden = true;
    el['lobby-section'].hidden = false;
    $('lobby-choose').hidden = false;
    $('lobby-table').hidden = true;
    lobbyStatus('');
    $('lobby-code').focus();
  }

  function hideLobby() {
    el['lobby-section'].hidden = true;
    el['setup-section'].hidden = false;
    $('opt-name').focus();
  }

  function lobbyStatus(text) {
    $('lobby-status').textContent = text || '';
    if (text) announce(text);
  }

  function createTable() {
    lobbyStatus('Making a table…');
    $('lobby-create').disabled = true;
    SH.Net.createTable({ config: roomConfig() }).then(function (code) {
      $('lobby-create').disabled = false;
      joinTable(code, null);
    }).catch(function (err) {
      $('lobby-create').disabled = false;
      lobbyStatus('The table could not be made. ' + (err && err.message ? err.message : '') +
        ' You can still play against the computer.');
    });
  }

  /* The rules the whole table plays by, fixed when it is made. Deliberately not
   * the whole settings object: pace, skin, verbosity and the player's own name
   * are this browser's business and nobody else's. */
  function roomConfig() {
    return {
      names: crewNames(2, settings.name),
      targetScore: settings.targetScore,
      difficulty: settings.difficulty
    };
  }

  function joinTable(code, seat) {
    var clean = normaliseCode(code);
    if (clean.length < 5) {
      lobbyStatus('That does not look like a table code. It is five letters and numbers.');
      $('lobby-code').focus();
      return;
    }
    lobby.code = clean;
    lobbyStatus('Joining table ' + spellCode(clean) + '…');
    SH.Table.startOnline(seat, function (handler) {
      return SH.Net.connect({ code: clean, seat: seat, name: settings.name }, handler, onNetStatus);
    });
    showTable(clean);
  }

  function showTable(code) {
    $('lobby-choose').hidden = true;
    $('lobby-table').hidden = false;
    $('lobby-code-display').textContent = code;
    $('lobby-code-read').textContent = 'Read it out as: ' + spellCode(code);
    renderSeats2();
    $('lobby-code-display').focus();
  }

  function showNetTrouble(text, offerReconnect) {
    var line = el['net-line'], actions = el['net-actions'];
    if (!line || !actions) return;
    if (!text) { line.hidden = true; line.textContent = ''; actions.hidden = true; return; }
    line.hidden = false;
    line.textContent = text;
    actions.hidden = !(offerReconnect && lobby.code);
  }

  function reconnect() {
    if (!lobby.code) return;
    showNetTrouble('Reconnecting to table ' + lobby.code + '…', false);
    announceRequested('Reconnecting to table ' + spellCode(lobby.code) + '.');
    joinTable(lobby.code, typeof mySeat === 'number' ? mySeat : null);
  }

  /* Connection state is game state. A player who cannot see the screen has no
   * other way to tell a table where somebody is thinking from one that has died. */
  function onNetStatus(s) {
    lobby.connected = s.state === 'connected';
    netState = s.state;
    var detail = sentence(s.detail);

    if (s.state === 'connecting') lobbyStatus('Connecting…');
    else if (s.state === 'connected') {
      lobbyStatus('Connected to table ' + spellCode(lobby.code) + '.');
      if (netTroubled) {
        announceRequested('Reconnected to table ' + spellCode(lobby.code) +
          ', seat ' + ((typeof mySeat === 'number' ? mySeat : 0) + 1) + '.');
        netTroubled = false;
      }
      showNetTrouble('', false);
    } else if (s.state === 'nosuch') {
      lobbyStatus('There is no table with that code. Check it and try again — ' +
        'it is five letters and numbers, and the letters O, I and L are never used.');
      $('lobby-choose').hidden = false;
      $('lobby-table').hidden = true;
      $('lobby-code').focus();
    } else if (s.state === 'refused') {
      lobbyStatus('That seat is not available. ' + (s.detail || '') + ' Try again.');
      $('lobby-choose').hidden = false;
      $('lobby-table').hidden = true;
      $('lobby-code').focus();
    } else if (s.state === 'lost') {
      netTroubled = true;
      lobbyStatus('The connection to the table was lost. ' + detail);
      showNetTrouble('The connection to this table was lost. ' + detail +
        ' The computer may be playing your seat until you come back.', true);
    } else if (s.state === 'fault') {
      netTroubled = true;
      lobbyStatus('The table stopped: ' + (s.detail || 'something went wrong on the server') + '.');
      showNetTrouble('The table stopped: ' +
        (s.detail || 'something went wrong on the server') + '.', false);
    } else if (s.state === 'failed') {
      netTroubled = true;
      lobbyStatus('Could not reach the table. You can still play against the computer.');
      showNetTrouble('Could not reach the table.', true);
    } else if (s.state === 'closed') {
      showNetTrouble('', false);
    }
    renderSeats2();
  }

  function renderSeats2() {
    var tbody = $('lobby-seats').querySelector('tbody');
    var v = SH.Table.view();
    tbody.innerHTML = '';
    for (var i = 0; i < G.SEATS; i++) {
      var p = v ? v.players[i] : null;
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = 'Seat ' + (i + 1);
      tr.appendChild(th);
      var who = document.createElement('td');
      who.textContent = p ? p.name : '—';
      tr.appendChild(who);
      var st = document.createElement('td');
      var ourSeat = v ? SH.Table.seat() : null;
      if (!v) st.textContent = 'not connected yet';
      else if (i === ourSeat) st.textContent = 'you' + (lobby.connected ? '' : ', connecting');
      else if (p.occupant === 'human') st.textContent = 'a person';
      else if (p.occupant === 'away') st.textContent = 'away, played by the computer';
      else st.textContent = 'the computer';
      tr.appendChild(st);
      tbody.appendChild(tr);
    }
  }

  function maybeEnterGame() {
    var v = SH.Table.view();
    if (!v || v.phase === 'idle') return;
    mySeat = SH.Table.seat();
    local = null;
    el['lobby-section'].hidden = true;
    el['game-section'].hidden = false;
    applyOnlineSettingLocks();

    /* Deliberately NOT resetSpeech(): nothing pending here is stale, it is the
     * lobby telling you where you are, and the deal is about to be announced
     * after it. */
    refresh();
    drain();

    if (lobby.code) {
      speech.unshift('Table ' + spellCode(lobby.code) + ', seat ' + (mySeat + 1) +
        '. You are playing ' + v.players[G.other(mySeat)].name + '.');
      var line = el['table-code-line'];
      line.hidden = false;
      line.textContent = 'Table ' + lobby.code + ' — seat ' + (mySeat + 1);
      line.setAttribute('aria-label',
        'Table code ' + spellCode(lobby.code) + '. You are in seat ' + (mySeat + 1) + '.');
      el['table-code-actions'].hidden = false;
    }
    render();
    flush();
  }

  function leaveTable() {
    SH.Table.close();
    netTroubled = false;
    netState = 'offline';
    showNetTrouble('', false);
    lobby.code = null;
    lobby.connected = false;
    $('lobby-choose').hidden = false;
    $('lobby-table').hidden = true;
    lobbyStatus('You left the table.');
    $('lobby-code').focus();
  }

  function copyCode() {
    var code = lobby.code || $('lobby-code-display').textContent;
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        alert_('Table code ' + spellCode(code) + ' copied.');
      }, function () {
        alert_('The code could not be copied. It is ' + spellCode(code) + '.');
      });
    } else {
      alert_('The code is ' + spellCode(code) + '.');
    }
  }

  /* ---------------- announcements ----------------
   *
   * Both live regions are written by blanking the node and setting the text a
   * moment later. The blank is not decoration — setting the same string twice is
   * not a DOM change and a screen reader says nothing, so "Your turn" following
   * "Your turn" would be silence.
   *
   * That pattern has a race in it, and offline nothing ever triggers it: messages
   * only arrive on a keystroke or a pace timer. Over a socket they will — two
   * views twenty milliseconds apart means the second blank runs before the first
   * write fires, and THE FIRST MESSAGE IS NEVER SPOKEN.
   *
   *   1. ONE QUEUE PER REGION, so a card confirmation cannot delay the hand read
   *      the player then asks for.
   *   2. PASS-THROUGH WHEN IDLE, so single-player at instant pace does not get
   *      slower to fix a problem it does not have.
   *   3. A GAME EVENT NEVER PREEMPTS A REQUEST — and is REQUEUED, not dropped.
   *   4. A NEWER REQUEST SUPERSEDES AN OLDER PENDING ONE, per region.
   */

  var SETTLE = 60;
  var HOLD = 250;

  function newChannel() { return { queue: [], timer: null, inFlight: null, lastAt: 0 }; }
  var channels = { polite: newChannel(), alert: newChannel() };

  function channelNode(name) { return name === 'alert' ? el.alerts : el.announcer; }

  function enqueueSpeech(name, msg, requested) {
    var ch = channels[name];
    if (!msg || !String(msg).trim()) {
      if (requested) {
        if (ch.inFlight) { clearTimeout(ch.inFlight.setTimer); ch.inFlight = null; }
        channelNode(name).textContent = '';
      }
      return;
    }
    if (requested) ch.queue = ch.queue.filter(function (q) { return !q.requested; });
    ch.queue.push({ region: name, msg: String(msg), requested: !!requested });
    pumpSpeech(name);
  }

  function takeNextSpeech(ch) {
    for (var i = 0; i < ch.queue.length; i++) {
      if (ch.queue[i].requested) return ch.queue.splice(i, 1)[0];
    }
    return ch.queue.shift();
  }

  function anyRequestedWaiting(ch) {
    for (var i = 0; i < ch.queue.length; i++) if (ch.queue[i].requested) return true;
    return false;
  }

  function pumpSpeech(name) {
    var ch = channels[name];
    if (!ch.queue.length) return;
    var urgent = anyRequestedWaiting(ch);
    if (urgent && ch.inFlight && !ch.inFlight.requested) {
      clearTimeout(ch.inFlight.setTimer);
      ch.queue.push({ region: name, msg: ch.inFlight.msg, requested: false });
      ch.inFlight = null;
    }
    if (urgent && ch.timer) { clearTimeout(ch.timer); ch.timer = null; }
    if (ch.inFlight || ch.timer) return;
    var since = ch.lastAt ? (Date.now() - ch.lastAt) : HOLD;
    var wait = urgent ? Math.max(0, SETTLE - since) : Math.max(0, HOLD - since);
    if (wait === 0) { deliverSpeech(name); return; }
    ch.timer = setTimeout(function () { ch.timer = null; deliverSpeech(name); }, wait);
  }

  function deliverSpeech(name) {
    var ch = channels[name];
    var item = takeNextSpeech(ch);
    if (!item) return;
    var node = channelNode(name);
    if (ch.inFlight) { clearTimeout(ch.inFlight.setTimer); ch.inFlight = null; }
    lastSpoken = item.msg;
    node.textContent = '';
    item.setTimer = setTimeout(function () {
      node.textContent = item.msg;
      ch.lastAt = Date.now();
      if (ch.inFlight === item) ch.inFlight = null;
      pumpSpeech(name);
    }, SETTLE);
    ch.inFlight = item;
  }

  function resetSpeech() {
    Object.keys(channels).forEach(function (name) {
      var ch = channels[name];
      clearTimeout(ch.timer);
      if (ch.inFlight) clearTimeout(ch.inFlight.setTimer);
      channels[name] = newChannel();
    });
    speech = [];
  }

  function flush() {
    var extra = turnPrompt();
    if (extra) speech.push(extra);
    var msg = speech.filter(function (s) { return s && s.trim(); }).join(' ');
    speech = [];
    if (!msg) return;
    announce(msg);
  }

  function announce(msg) { enqueueSpeech('polite', msg, false); }
  function announceRequested(msg) { enqueueSpeech('polite', msg, true); }
  function alert_(msg) { enqueueSpeech('alert', msg, true); }

  function turnPrompt() {
    if (!state) return '';
    if (state.phase === 'gameOver') return 'Press N or Enter on Start a new game.';
    if (state.phase === 'roundOver') return 'Press N or Enter on Deal the next hand.';
    if (!myMove()) return '';
    if (state.phase === 'cutForDeal') return 'Cut for deal. The lower card deals.';
    if (state.phase === 'discard') {
      return 'Choose two cards to throw to ' +
        (state.dealer === mySeat ? 'your own crib' : opponentName() + '’s crib') +
        '. Press H to hear your six.';
    }
    if (state.phase === 'count') {
      return state.countStage === 2
        ? 'Your crib to count. Press N to turn it over.'
        : 'Your hand to count. Press N to count it.';
    }
    if (state.phase === 'play') {
      var legal = G.legalPlays(state, mySeat);
      if (!legal.length) return 'You cannot play. Say go.';
      return 'Your turn. The count is ' + state.count + '.';
    }
    return '';
  }

  function opponentName() { return state.players[G.other(mySeat)].name; }
  function meName() { return state.players[mySeat].name; }

  /* ---------------- review keys ---------------- */

  function say(what) {
    if (!state) return;
    switch (what) {
      case 'hand': announceRequested(textHand()); break;
      case 'play': announceRequested(textPlay()); break;
      case 'last': announceRequested(lastCount || 'Nothing has been counted yet.'); break;
      case 'score': announceRequested(textScore()); break;
      case 'position': announceRequested(textPosition()); break;
      case 'count': announceRequested(textSeen()); break;
      case 'who': announceRequested(textWho()); break;
      case 'repeat': announceRequested(lastSpoken || 'Nothing to repeat.'); break;
    }
  }

  function textHand() {
    var me = state.players[mySeat];
    var cards = me.hand.filter(function (c) { return c.id; });
    if (!cards.length) {
      if (me.kept.length && me.kept[0].id) {
        return 'You have played all four. You kept ' +
          C.listNames(C.sortHand(me.kept)) + '.';
      }
      return 'Your hand is empty.';
    }
    var sorted = C.sortHand(cards);
    var lead = 'Your ' + G.numWord(sorted.length) +
      (sorted.length === 1 ? ' card: ' : ' cards: ');

    if (state.phase === 'play') {
      /* During the play, every card is read with what it would do — the
       * arithmetic a sighted player does at a glance off cards that are face up
       * in front of everybody. */
      var parts = sorted.map(function (c) {
        var to = state.count + C.value(c);
        if (to > 31) return C.name(c) + ', too big, it would make ' + to;
        var got = G.pointsForPlay(state, c);
        return C.name(c) + ' makes ' + to + (got.total ? ', and scores ' + got.parts.join(' and ') : '');
      });
      return 'The count is ' + state.count + '. ' + lead + parts.join('. ') + '.';
    }

    var msg = lead + sorted.map(function (c) { return C.describe(c); }).join(', ') + '.';
    if (state.phase === 'discard' && !me.hasDiscarded) {
      msg += ' Two of them go to ' +
        (state.dealer === mySeat ? 'your own crib.' : opponentName() + '’s crib.');
    }
    if (state.starter) msg += ' The starter is the ' + C.describe(state.starter) + '.';
    return msg;
  }

  function textPlay() {
    if (state.phase !== 'play' && !state.pile.length) {
      return 'The play has not started yet.';
    }
    var seq = state.pile.slice(state.runStart);
    var head = 'The count is ' + state.count + '. ';
    if (!seq.length) {
      return head + (state.pile.length
        ? 'Nothing down since the count reset. ' + nameFor(state.turn) + ' to lead.'
        : nameFor(state.turn) + ' to lead.');
    }
    var down = seq.map(function (e) {
      return nameFor(e.player) + ' the ' + C.name(e.card);
    }).join(', then ');
    var msg = head + 'Down this run: ' + down + '.';

    if (state.phase === 'play' && state.turn === mySeat) {
      var legal = G.legalPlays(state, mySeat);
      if (!legal.length) {
        msg += ' Nothing in your hand fits under thirty-one, so you must say go.';
      } else {
        var scoring = legal.filter(function (c) { return G.pointsForPlay(state, c).total > 0; });
        msg += scoring.length
          ? ' Scoring plays: ' + scoring.map(function (c) {
            var g = G.pointsForPlay(state, c);
            return C.name(c) + ' for ' + G.numWord(g.total);
          }).join(', ') + '.'
          : ' Nothing you hold scores here.';
      }
    }
    return msg;
  }

  function nameFor(i) {
    if (i < 0 || !state.players[i]) return 'nobody';
    return i === mySeat ? 'you' : state.players[i].name;
  }

  function textScore() {
    var target = state.config.targetScore || 121;
    var me = state.players[mySeat].score, them = state.players[G.other(mySeat)].score;
    var parts = ['You ' + me + ', ' + opponentName() + ' ' + them + ', playing to ' + target + '.'];
    parts.push('You need ' + G.numWord(Math.max(0, target - me)) + ' more; ' +
      opponentName() + ' needs ' + G.numWord(Math.max(0, target - them)) + '.');
    if (state.gamesWon[0] || state.gamesWon[1]) {
      parts.push('Games won: you ' + state.gamesWon[mySeat] + ', ' +
        opponentName() + ' ' + state.gamesWon[G.other(mySeat)] + '.');
    }
    return parts.join(' ');
  }

  function textPosition() {
    if (state.dealer < 0) return 'Nobody has dealt yet. Cut for deal to begin.';
    var msg = (state.dealer === mySeat ? 'You dealt, so it is your crib.'
      : opponentName() + ' dealt, so the crib is theirs.');
    msg += ' ' + (state.starter
      ? 'The starter is the ' + C.describe(state.starter) + '.'
      : 'The starter has not been turned yet.');
    if (state.phase === 'discard') {
      var waiting = waitingFor();
      msg += state.players[mySeat].hasDiscarded
        ? ' Your two are in the crib; waiting for ' + opponentName() + '.'
        : ' You still have to throw two.';
      if (waiting < 0) msg += ' Both throws are in.';
    }
    if (state.phase === 'count') {
      msg += ' Counting: ' + ['the non-dealer’s hand', 'the dealer’s hand', 'the crib'][state.countStage] +
        ' next.';
    }
    if (state.crib.length) {
      msg += ' The crib was ' + C.listNames(C.sortHand(state.crib)) + '.';
    }
    return msg;
  }

  /* What this seat has seen, and what could still come. Uses only cards that are
   * face up plus its own — the same information the computer works from. */
  function textSeen() {
    var seen = {};
    var me = state.players[mySeat];
    me.hand.concat(me.kept, me.played).forEach(function (c) { if (c.id) seen[c.id] = 1; });
    state.pile.forEach(function (e) { seen[e.card.id] = 1; });
    if (state.starter) seen[state.starter.id] = 1;
    (state.discarded[mySeat] || []).forEach(function (id) { seen[id] = 1; });
    var unseen = C.newDeck().filter(function (c) { return !seen[c.id]; });

    var parts = ['You have seen ' + G.numWord(C.DECK_SIZE - unseen.length) + ' of the fifty-two. ' +
      G.numWord(unseen.length) + ' could still be anywhere.'];
    if (state.phase === 'play') {
      var need = 31 - state.count;
      if (need > 0 && need <= 10) {
        var makes31 = unseen.filter(function (c) { return C.value(c) === need; }).length;
        parts.push(G.numWord(makes31) + ' unseen ' + (makes31 === 1 ? 'card makes' : 'cards make') +
          ' thirty-one from here.');
      }
      var to15 = 15 - state.count;
      if (to15 > 0 && to15 <= 10) {
        var makes15 = unseen.filter(function (c) { return C.value(c) === to15; }).length;
        parts.push(G.numWord(makes15) + ' would make fifteen.');
      }
    }
    var tens = unseen.filter(function (c) { return C.value(c) === 10; }).length;
    var fives = unseen.filter(function (c) { return c.r === '5'; }).length;
    parts.push(G.numWord(tens) + ' of the unseen cards are worth ten, and ' +
      G.numWord(fives) + (fives === 1 ? ' is a five.' : ' are fives.'));
    return parts.join(' ');
  }

  function textWho() {
    if (!state) return '';
    var parts = [];
    if (SH.Table.isLocal()) {
      parts.push('You are playing on your own against the computer, which is ' +
        opponentName() + '.');
    } else {
      parts.push('Table ' + (lobby.code ? spellCode(lobby.code) : 'unknown') +
        '. The connection is ' +
        (netState === 'connected' ? 'healthy'
          : netState === 'connecting' ? 'still being made'
            : netState === 'lost' ? 'lost — the computer may be playing your seat'
              : netState === 'fault' ? 'up, but the table has stopped'
                : netState) + '.');
    }
    for (var i = 0; i < G.SEATS; i++) {
      var p = state.players[i];
      var who = p.occupant === 'human' ? (i === mySeat ? 'you' : 'a person')
        : p.occupant === 'away' ? 'away, played by the computer'
          : 'the computer';
      parts.push('Seat ' + (i + 1) + ', ' + p.name + ', ' + who +
        (i === state.dealer ? ', dealing' : '') + '.');
    }
    var w = waitingFor();
    if (w >= 0) {
      var waited = Math.round((Date.now() - turnWatch.at) / 1000);
      parts.push((w === mySeat ? 'The table is waiting for you'
        : 'Waiting for ' + state.players[w].name) +
        (waited >= 3 ? ', for ' + waited + ' seconds now' : '') + '.');
    } else if (state.phase === 'roundOver' || state.phase === 'gameOver') {
      parts.push('The hand is over; the table is waiting for somebody to deal.');
    }
    return parts.join(' ');
  }

  /* ---------------- rendering ---------------- */

  function render() {
    var key = state.phase + ':' + state.turn + ':' + state.handNumber + ':' + state.countStage;
    if (turnWatch.key !== key) { turnWatch.key = key; turnWatch.at = Date.now(); }

    renderStatus();
    renderActions();
    renderHand();
    renderBoard();
    renderPile();
    renderStarter();
    renderCrib();
    renderScore();
    syncLogTabs();
  }

  function renderStatus() {
    var s = '';
    if (state.phase === 'cutForDeal') {
      s = 'Cut for deal — the lower card deals and takes the first crib.';
      if (state.cutForDeal && state.cutForDeal.tie) s += ' That was a tie; cut again.';
    } else if (state.phase === 'discard') {
      s = state.players[mySeat].hasDiscarded
        ? 'Your two are in the crib. Waiting for ' + opponentName() + '.'
        : 'Throw two cards to ' + (state.dealer === mySeat ? 'your crib.' : opponentName() + '’s crib.');
    } else if (state.phase === 'play') {
      s = 'The count is ' + state.count + ' — ' +
        (state.turn === mySeat ? 'your turn.' : opponentName() + ' to play.');
    } else if (state.phase === 'count') {
      s = 'Counting: ' + ['the non-dealer’s hand', 'the dealer’s hand', 'the crib'][state.countStage] +
        (state.turn === mySeat ? ' — yours to count.' : ' — ' + opponentName() + ' is counting.');
    } else if (state.phase === 'roundOver') {
      s = 'Hand ' + state.handNumber + ' complete. You ' + state.players[mySeat].score +
        ', ' + opponentName() + ' ' + state.players[G.other(mySeat)].score + '.';
    } else if (state.phase === 'gameOver') {
      s = (state.gameWinner === mySeat ? 'You win' : opponentName() + ' wins') + ', ' +
        state.players[state.gameWinner].score + ' to ' +
        state.players[G.other(state.gameWinner)].score + '.';
    }
    el.status.textContent = s;
  }

  function actionsKey() {
    if (state.phase === 'roundOver' || state.phase === 'gameOver') return 'over:' + state.phase;
    if (!myMove()) {
      if (!SH.Table.isLocal()) return 'waiting';
      return settings.pace === 0 ? 'waiting' : 'continue';
    }
    if (state.phase === 'cutForDeal') return 'cut';
    if (state.phase === 'discard') return 'throw:' + Object.keys(selected).length;
    if (state.phase === 'count') return 'count:' + state.countStage;
    if (state.phase === 'play') {
      return 'play:' + state.count + ':' + G.legalPlays(state, mySeat).length;
    }
    return 'none';
  }

  function renderActions() {
    var box = el.actions;
    var heading = $('action-h');
    if (heading) {
      heading.textContent =
        state.phase === 'gameOver' ? 'Game over'
          : state.phase === 'roundOver' ? 'Hand complete'
            : myMove() ? 'Your turn'
              : 'Waiting for ' + opponentName();
    }

    var key = actionsKey();
    actionsRebuilt = key !== lastActionsKey;
    if (!actionsRebuilt) return;
    lastActionsKey = key;
    box.innerHTML = '';

    if (state.phase === 'gameOver' || state.phase === 'roundOver') {
      var p = document.createElement('p');
      p.className = 'hint result-headline';
      p.textContent = resultHeadline();
      box.appendChild(p);
      box.appendChild(button(state.phase === 'gameOver' ? 'Start a new game' : 'Deal the next hand',
        dealNext, true, 'N'));
      return;
    }

    if (!myMove()) {
      if (!SH.Table.isLocal()) {
        var wo = document.createElement('p');
        wo.className = 'hint';
        var w = waitingFor();
        wo.textContent = 'Waiting for ' + (w >= 0 ? state.players[w].name : 'the table') + '…';
        box.appendChild(wo);
        return;
      }
      if (settings.pace === 0) {
        var wq = document.createElement('p');
        wq.className = 'hint';
        wq.textContent = 'Waiting…';
        box.appendChild(wq);
        return;
      }
      box.appendChild(button('Continue', stepOnce, true, 'N'));
      if (settings.pace > 0) {
        var note = document.createElement('p');
        note.className = 'hint';
        note.textContent = 'The next play comes on its own after ' + paceWords() +
          '. Continue takes it now.';
        box.appendChild(note);
      }
      return;
    }

    if (state.phase === 'cutForDeal') {
      var h0 = document.createElement('p');
      h0.className = 'hint';
      h0.textContent = state.cutForDeal && state.cutForDeal.tie
        ? 'You cut the same rank, so cut again.'
        : 'Whoever cuts the lower card deals first and takes the first crib.';
      box.appendChild(h0);
      box.appendChild(button('Cut for deal', function () {
        act({ type: 'cut' });
      }, true, 'N'));
      return;
    }

    if (state.phase === 'discard') {
      var n = Object.keys(selected).length;
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Two cards go face down to ' +
        (state.dealer === mySeat ? 'your own crib — you will count them.'
          : opponentName() + '’s crib — they will count them.') +
        ' Nobody sees the crib until the end of the hand.';
      box.appendChild(hint);
      var b = button(n === 2
        ? 'Throw the ' + C.listNames(Object.keys(selected).map(C.get))
        : 'Throw the ' + G.numWord(n) + ' selected ' + (n === 1 ? 'card' : 'cards'),
      doThrow, true);
      b.disabled = n !== 2;
      box.appendChild(b);
      var clr = button('Clear selection', function () {
        selected = {}; render(); alert_('Selection cleared.');
      });
      clr.disabled = n === 0;
      box.appendChild(clr);
      return;
    }

    if (state.phase === 'count') {
      var what = state.countStage === 2 ? 'crib' : 'hand';
      var ch = document.createElement('p');
      ch.className = 'hint';
      ch.textContent = state.countStage === 2
        ? 'Turn the crib over and count it. Neither of you has seen it.'
        : 'Count your hand with the starter as a fifth card.';
      box.appendChild(ch);
      box.appendChild(button('Count my ' + what, function () {
        act({ type: 'next' });
      }, true, 'N'));
      return;
    }

    if (state.phase === 'play') {
      var legal = G.legalPlays(state, mySeat);
      if (!legal.length) {
        var g = document.createElement('p');
        g.className = 'hint';
        g.textContent = 'Nothing in your hand fits under thirty-one, so you must say go. ' +
          opponentName() + ' keeps laying cards until they cannot either.';
        box.appendChild(g);
        box.appendChild(button('Say go', function () { act({ type: 'go' }); }, true, 'N'));
        return;
      }
      var ph = document.createElement('p');
      ph.className = 'hint';
      ph.textContent = 'The count is ' + state.count + '. You can play ' +
        G.numWord(legal.length) + ' of your ' + G.numWord(state.players[mySeat].hand.length) + '.';
      box.appendChild(ph);
    }
  }

  /* One place every action goes through, so a refusal is always spoken and never
   * looks like a dropped keypress. */
  function act(action) {
    var r = SH.Table.act(action);
    if (r && r.ok === false) { alert_(sentence(r.reason)); return false; }
    afterOwnMove();
    return true;
  }

  function afterOwnMove() {
    handFocus = 0;
    refresh();
    drain();
    tick();
  }

  function resultHeadline() {
    if (state.phase === 'gameOver' && state.result) {
      var won = state.gameWinner === mySeat;
      return (won ? 'You win' : opponentName() + ' wins') + ', ' +
        state.players[state.gameWinner].score + ' to ' +
        state.players[G.other(state.gameWinner)].score +
        (state.result.skunk ? ' — a ' + state.result.skunk + '.' : '.');
    }
    if (!state.result || !state.result.counts) return '';
    return state.result.counts.map(function (c) {
      return (c.who === mySeat ? 'your ' : opponentName() + '’s ') + c.kind + ' ' +
        c.result.total;
    }).join(', ') + '.';
  }

  function button(label, fn, primary, shortcut) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (primary) b.className = 'primary';
    if (shortcut) {
      b.setAttribute('aria-keyshortcuts', shortcut);
      b.dataset.advance = '1';
      var k = document.createElement('kbd');
      k.setAttribute('aria-hidden', 'true');
      k.textContent = shortcut;
      b.appendChild(k);
    }
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------------- card faces ---------------- */

  var PIP_LAYOUT = {
    '2': [[2,1],[2,5]],
    '3': [[2,1],[2,3],[2,5]],
    '4': [[1,1],[3,1],[1,5],[3,5]],
    '5': [[1,1],[3,1],[2,3],[1,5],[3,5]],
    '6': [[1,1],[3,1],[1,3],[3,3],[1,5],[3,5]],
    '7': [[1,1],[3,1],[1,3],[3,3],[1,5],[3,5],[2,2]],
    '8': [[1,1],[3,1],[1,3],[3,3],[1,5],[3,5],[2,2],[2,4]],
    '9': [[1,1],[3,1],[1,2],[3,2],[1,4],[3,4],[1,5],[3,5],[2,3]],
    'T': [[1,1],[3,1],[1,2],[3,2],[1,4],[3,4],[1,5],[3,5],[2,2],[2,4]]
  };

  function span(cls, text) {
    var e = document.createElement('span');
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cornerIndex(c, where) {
    var idx = span('idx idx-' + where);
    idx.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
    idx.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
    return idx;
  }

  function cardCentre(c) {
    var face = span('face');
    var layout = PIP_LAYOUT[c.r];
    if (layout) {
      face.className = 'face face-pips';
      layout.forEach(function (pos) {
        var pip = span('pip', C.SUIT_SYM[c.s]);
        pip.style.gridColumn = String(pos[0]);
        pip.style.gridRow = String(pos[1]);
        if (pos[1] >= 4) pip.classList.add('pip-flip');
        face.appendChild(pip);
      });
    } else if (c.r === 'A') {
      face.className = 'face face-ace';
      face.appendChild(span('pip pip-big', C.SUIT_SYM[c.s]));
    } else {
      face.className = 'face face-court';
      face.appendChild(span('court-letter', C.RANK_TEXT[c.r]));
      face.appendChild(span('court-suit', C.SUIT_SYM[c.s]));
    }
    return face;
  }

  function paintCard(el2, c, opts) {
    opts = opts || {};
    el2.appendChild(cornerIndex(c, 'tl'));
    el2.appendChild(cardCentre(c));
    el2.appendChild(cornerIndex(c, 'br'));
    var simple = span('simple');
    simple.appendChild(span('rank', C.RANK_TEXT[c.r]));
    simple.appendChild(span('suit', C.SUIT_SYM[c.s]));
    el2.appendChild(simple);
    if (opts.position) el2.appendChild(span('pos', opts.position));
    if (opts.tag) el2.appendChild(span('tag', opts.tag));
    [].forEach.call(el2.children, function (ch) { ch.setAttribute('aria-hidden', 'true'); });
    return el2;
  }

  function cardClasses(c) { return 'card' + (C.isRed(c) ? ' red' : ''); }

  function renderHand() {
    handMode = 'idle';
    if (state.phase === 'discard' && !state.players[mySeat].hasDiscarded) handMode = 'throw';
    else if (state.phase === 'play' && state.turn === mySeat) handMode = 'play';

    var raw = state.players[mySeat].hand.filter(function (c) { return c.id; });
    var hand = C.sortHand(raw);

    el.hand.classList.toggle('choosing', handMode === 'play');
    el.hand.innerHTML = '';
    if (!hand.length) {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = state.phase === 'count' || state.phase === 'roundOver'
        ? 'All four played. Your hand is counted with the starter.'
        : 'No cards left.';
      el.hand.appendChild(p);
      return;
    }

    if (handFocus >= hand.length) handFocus = hand.length - 1;
    if (handFocus < 0) handFocus = 0;

    var legalIds = {};
    if (handMode === 'play') {
      G.legalPlays(state, mySeat).forEach(function (c) { legalIds[c.id] = 1; });
      /* Start on a card the rules allow, rather than making the player arrow
       * past ones already ruled out. They can still reach every card. */
      if (!legalIds[hand[handFocus].id]) {
        for (var f = 0; f < hand.length; f++) {
          if (legalIds[hand[f].id]) { handFocus = f; break; }
        }
      }
    }

    hand.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cardClasses(c);
      b.dataset.id = c.id;
      b.dataset.index = String(i);
      b.tabIndex = i === handFocus ? 0 : -1;

      var tag = '';
      var label = C.describe(c);

      if (handMode === 'play') {
        var to = state.count + C.value(c);
        if (legalIds[c.id]) {
          var got = G.pointsForPlay(state, c);
          tag = 'makes ' + to + (got.total ? ' · ' + got.total : '');
          /* The arithmetic, said out loud. A sighted player reads this off the
           * table in a second; by ear it is a sum on every turn. */
          label += ', makes ' + to;
          if (got.total) label += ', and scores ' + got.parts.join(' and ');
        } else {
          tag = 'over 31';
          b.setAttribute('aria-disabled', 'true');
          label += ', cannot be played, ' + G.illegalReason(state, mySeat, c.id);
        }
      } else if (handMode === 'throw') {
        b.setAttribute('aria-pressed', selected[c.id] ? 'true' : 'false');
        if (selected[c.id]) { tag = 'to the crib'; label += ', selected to throw'; }
      } else {
        b.setAttribute('aria-disabled', 'true');
        label += ', ' + idleReason();
      }

      paintCard(b, c, { position: String(i + 1), tag: tag });
      label += ', card ' + (i + 1) + ' of ' + hand.length;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function () { activateCard(c.id, i); });
      b.addEventListener('focus', function () { handFocus = i; retab(); });
      el.hand.appendChild(b);
    });
  }

  function idleReason() {
    if (state.phase === 'cutForDeal') return 'for review, nothing is dealt yet';
    if (state.phase === 'discard') return 'for review, your throw is already in';
    if (state.phase === 'play') return 'for review, ' + opponentName() + ' is to play';
    if (state.phase === 'count') return 'for review while the hands are counted';
    return 'not playable right now';
  }

  function retab() {
    var cards = el.hand.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) cards[i].tabIndex = i === handFocus ? 0 : -1;
  }

  /* The board. Decoration — hidden from assistive technology in the markup —
   * because the Score table carries both numbers and the distance still to go. */
  function renderBoard() {
    var box = el.board;
    if (!box) return;
    var target = state.config.targetScore || 121;
    box.innerHTML = '';
    [mySeat, G.other(mySeat)].forEach(function (i) {
      var row = document.createElement('div');
      row.className = 'board-row' + (i === mySeat ? ' mine' : '');
      row.appendChild(span('board-name', state.players[i].name + ' ' + state.players[i].score));
      var track = document.createElement('div');
      track.className = 'board-track';
      var pct = Math.max(0, Math.min(100, (state.players[i].score / target) * 100));
      var fill = span('board-fill');
      fill.style.width = pct + '%';
      track.appendChild(fill);
      var peg = span('board-peg');
      peg.style.left = pct + '%';
      track.appendChild(peg);
      row.appendChild(track);
      box.appendChild(row);
    });
  }

  function renderPile() {
    var node = el.pile;
    el['count-line'].textContent = state.phase === 'play' || state.pile.length
      ? 'Count: ' + state.count : '';
    node.innerHTML = '';
    if (!state.pile.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nothing played yet.';
      node.appendChild(li);
      return;
    }
    state.pile.forEach(function (e, i) {
      var li = document.createElement('li');
      /* Cards from before the last reset are still shown — they are on the table
       * — but marked, because they can no longer be paired or run onto. */
      if (i < state.runStart) li.className = 'spent';
      var who = span('who', nameFor(e.player) + (i === state.runStart ? ' (led)' : ''));
      var mini = document.createElement('span');
      mini.className = cardClasses(e.card) + ' mini';
      paintCard(mini, e.card, {});
      mini.setAttribute('aria-hidden', 'true');
      li.appendChild(who);
      li.appendChild(mini);
      li.appendChild(span('what', C.name(e.card)));
      li.appendChild(span('flag', i < state.runStart ? 'before the reset' : ''));
      node.appendChild(li);
    });
  }

  function renderStarter() {
    var sec = el['starter-section'];
    if (!sec) return;
    if (!state.starter) { sec.hidden = true; return; }
    sec.hidden = false;
    el.starter.innerHTML = '';
    var b = document.createElement('span');
    b.className = cardClasses(state.starter) + ' starter-card';
    paintCard(b, state.starter, { tag: 'starter' });
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', 'The starter: ' + C.describe(state.starter));
    el.starter.appendChild(b);
  }

  function renderCrib() {
    var note = el['crib-note'];
    el.crib.innerHTML = '';
    if (state.crib.length && state.crib[0].id) {
      note.textContent = (state.dealer === mySeat ? 'Your crib' : opponentName() + '’s crib') +
        ', turned over and counted.';
      state.crib.forEach(function (c) {
        var b = document.createElement('span');
        b.className = cardClasses(c);
        paintCard(b, c, {});
        b.setAttribute('role', 'img');
        b.setAttribute('aria-label', C.describe(c));
        el.crib.appendChild(b);
      });
      return;
    }
    note.textContent = state.cribCount
      ? G.numWord(state.cribCount) + ' cards face down in ' +
        (state.dealer === mySeat ? 'your crib' : opponentName() + '’s crib') +
        '. Neither of you may look until the hand is counted.'
      : 'Nothing in the crib yet.';
  }

  function renderScore() {
    var tbody = el['score-table'].querySelector('tbody');
    tbody.innerHTML = '';
    var target = state.config.targetScore || 121;
    [mySeat, G.other(mySeat)].forEach(function (i) {
      var tr = document.createElement('tr');
      if (i === mySeat) tr.className = 'you';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = state.players[i].name + (i === mySeat ? ' (you)' : '');
      tr.appendChild(th);
      var roles = [];
      if (i === state.dealer) roles.push('dealer, takes the crib');
      if (waitingFor() === i) roles.push('to move');
      [roles.length ? roles.join(', ') : '—',
        String(state.players[i].score),
        String(Math.max(0, target - state.players[i].score)),
        String(state.gamesWon[i])].forEach(function (txt) {
        var td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function pushLog(kind, text) {
    var li = document.createElement('li');
    li.className = 'k-' + kind;
    li.tabIndex = -1;
    li.textContent = text;
    el.log.insertBefore(li, el.log.firstChild);
    while (el.log.children.length > 200) el.log.removeChild(el.log.lastChild);
  }

  function applyLogTabs() {
    var items = el.log.children;
    for (var i = 0; i < items.length; i++) items[i].tabIndex = i === logFocus ? 0 : -1;
  }

  function syncLogTabs() {
    var items = el.log.children;
    var active = document.activeElement;
    for (var i = 0; i < items.length; i++) if (items[i] === active) { logFocus = i; break; }
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
      case 'ArrowDown': case 'ArrowRight': e.preventDefault(); focusLogEntry(logFocus + 1); break;
      case 'ArrowUp': case 'ArrowLeft': e.preventDefault(); focusLogEntry(logFocus - 1); break;
      case 'Home': e.preventDefault(); focusLogEntry(0); break;
      case 'End': e.preventDefault(); focusLogEntry(items.length - 1); break;
      case 'PageDown': e.preventDefault(); focusLogEntry(logFocus + 10); break;
      case 'PageUp': e.preventDefault(); focusLogEntry(logFocus - 10); break;
    }
  }

  /* ---------------- interaction ---------------- */

  function activateCard(id, index) {
    handFocus = index;
    if (handMode === 'throw') {
      if (selected[id]) {
        delete selected[id];
        alert_(C.name(C.get(id)) + ' unselected.');
      } else if (Object.keys(selected).length >= 2) {
        alert_('You have already chosen two. Unselect one first.');
        return;
      } else {
        selected[id] = true;
        var n = Object.keys(selected).length;
        alert_(C.name(C.get(id)) + ' selected. ' + G.numWord(n) + ' of two.');
      }
      render();
      focusCard(index);
      return;
    }
    if (handMode === 'play') {
      if (!G.isLegal(state, mySeat, id)) {
        alert_('You cannot play the ' + C.name(C.get(id)) + '. ' +
          G.illegalReason(state, mySeat, id) + '.');
        return;
      }
      act({ type: 'play', card: id });
      return;
    }
    alert_('You cannot play a card right now: ' + idleReason() + '.');
  }

  function doThrow() {
    var ids = Object.keys(selected);
    if (ids.length !== 2) { alert_('Choose exactly two cards.'); return; }
    var names = C.listNames(ids.map(C.get));
    var r = SH.Table.act({ type: 'discard', cards: ids });
    if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
    selected = {};
    handFocus = 0;
    refresh();
    speech.push('You threw the ' + names + '.');
    drain();
    tick();
  }

  function focusCard(i) {
    var cards = el.hand.querySelectorAll('.card');
    if (cards[i]) { handFocus = i; retab(); cards[i].focus(); }
  }

  /* Never pull focus out from under somebody in the middle of something:
   * filling a field, reading the help, or reading back through the log. */
  function mayTakeFocus() {
    if (!settings.autofocus) return false;
    if (anyDialogOpen()) return false;
    var a = document.activeElement;
    if (!a) return true;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return false;
    if (el.log.contains(a)) return false;
    return true;
  }

  function focusForTurn() {
    if (!mayTakeFocus()) return;
    /* Cutting, counting and dealing are decided with a button; throwing and
     * playing are decided with the cards. */
    if (state.phase === 'cutForDeal' || state.phase === 'count' ||
        (state.phase === 'play' && !G.legalPlays(state, mySeat).length)) {
      var b = el.actions.querySelector('button');
      if (b) b.focus();
      return;
    }
    focusCard(handFocus);
  }

  function focusFirstAction() {
    if (!actionsRebuilt) return;
    if (!mayTakeFocus()) return;
    var b = el.actions.querySelector('button');
    if (b && b !== document.activeElement) b.focus();
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
      case 'Home': e.preventDefault(); focusCard(0); break;
      case 'End': e.preventDefault(); focusCard(cards.length - 1); break;
    }
  }

  function onGlobalKeys(e) {
    if (!state || el['game-section'].hidden) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (anyDialogOpen()) return;

    if (/^[1-9]$/.test(e.key) && !el.log.contains(t)) {
      var idx = parseInt(e.key, 10) - 1;
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
    if (k === 'n' && !el.log.contains(t)) {
      var adv = el.actions.querySelector('button[data-advance]');
      if (adv) { e.preventDefault(); adv.click(); }
      return;
    }
    if (k === 'g') { e.preventDefault(); focusLogEntry(0); return; }
    if (k === 'e') { e.preventDefault(); openExport(); return; }
    if (k === 'b') { e.preventDefault(); openBug(); return; }

    var map = {
      h: 'hand', t: 'play', l: 'last', s: 'score',
      p: 'position', c: 'count', w: 'who', r: 'repeat'
    };
    if (map[k]) { e.preventDefault(); say(map[k]); return; }
    if (e.key === '?') { e.preventDefault(); openA11y(); }
  }

  /* ---------------- export ---------------- */

  function buildTranscript() {
    var lines = [].map.call(el.log.children, function (li) { return li.textContent; });
    var head = 'Exported: ' + new Date().toString() + '\n';
    return local ? head + G.transcript(local, mySeat, lines) : head + onlineTranscript(lines);
  }

  /* Online the full history lives on the server and is deliberately not sent —
   * it grows without bound and the client needs it in two places. So what can be
   * written here is what this seat has been told, and it says so rather than
   * presenting a partial log as a complete one. */
  function onlineTranscript(lines) {
    var L = ['Cribbage — online table ' + (lobby.code || '?') + ', seat ' + (mySeat + 1)];
    L.push('Players: ' + state.players.map(function (p, i) {
      return (i + 1) + ' ' + p.name + (i === mySeat ? ' (you)' : '');
    }).join(', '));
    L.push('Score: ' + state.players[0].name + ' ' + state.players[0].score + ', ' +
      state.players[1].name + ' ' + state.players[1].score +
      '. Hands played: ' + state.handsPlayed + '.');
    if (state.handsFailingAudit) {
      L.push('*** The table reports ' + state.handsFailingAudit +
        ' hand(s) that failed its accounting check. ***');
    }
    L.push('');
    L.push('The full hand-by-hand record lives on the server. What follows is the');
    L.push('on-screen log for this seat, newest first.');
    L.push('');
    lines.forEach(function (line) { L.push(line); });
    return L.join('\n');
  }

  function openExport() {
    if (!state) return;
    el['export-text'].value = buildTranscript();
    if (!SH.Table.isLocal()) {
      el['export-summary'].textContent =
        'This is an online table, so the full log lives on the server. What is ' +
        'below is what this seat has been told.';
      openDialog(el['export-dialog']);
      announceRequested('Export game log. ' + el['export-summary'].textContent);
      return;
    }
    var hist = (local && local.history) || [];
    var bad = hist.filter(function (h) { return h.problems.length; });
    el['export-summary'].textContent = hist.length + ' completed ' +
      (hist.length === 1 ? 'hand' : 'hands') + '. ' +
      (bad.length
        ? bad.length + ' failed the accounting check — details are marked in the log.'
        : 'Every hand passed its accounting check.');
    openDialog(el['export-dialog']);
    announceRequested('Export game log. ' + el['export-summary'].textContent);
  }

  function exportFilename() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return 'cribbage-log-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
      '-' + two(d.getHours()) + two(d.getMinutes()) + '.txt';
  }

  function downloadExport() {
    var text = el['export-text'].value;
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 0);
      alert_('Game log downloaded as ' + exportFilename() + '.');
    } catch (e) {
      alert_('The download failed. The log is in the box, and can be copied.');
    }
  }

  function copyText(text, box, what) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert_(what + ' copied to the clipboard.');
      }, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      try {
        box.focus(); box.select(); document.execCommand('copy');
        alert_(what + ' copied to the clipboard.');
      } catch (e) {
        alert_('Copying failed. The text is selected, so Control C will copy it.');
      }
    }
  }

  function copyExport() { copyText(el['export-text'].value, el['export-text'], 'Game log'); }

  /* ---------------- dialogs ---------------- */

  var dialogReturn = null;

  function openDialog(dlg) { dialogReturn = document.activeElement; dlg.showModal(); }
  function closeDialog(dlg) { dlg.close(); }

  function restoreDialogFocus() {
    if (anyDialogOpen()) return;
    if (dialogReturn && document.contains(dialogReturn)) {
      try { dialogReturn.focus(); } catch (e) { /* gone */ }
    }
    dialogReturn = null;
  }

  function switchDialog(fromId, toId) {
    var keep = dialogReturn;
    el[fromId].close();
    el[toId].showModal();
    dialogReturn = keep;
  }

  /* ---------------- bug reports ---------------- */

  var BUG_REPO = 'kellylford/TheWorkBench';
  var GAME_URL = 'https://kellylford.github.io/TheWorkBench/cribbage-multiplayer/';
  var MAX_URL = 6000;

  function bugTitle() {
    var t = (el['bug-title'].value || '').trim();
    return '[cribbage-mp] ' + (t || 'Something went wrong');
  }

  function bugSummary() {
    var L = [];
    L.push('Game: Cribbage Multiplayer (' + GAME_URL + ')');
    L.push('When: ' + new Date().toString());
    L.push('Browser: ' + navigator.userAgent);
    if (state) {
      L.push('Mode: ' + (SH.Table.isLocal() ? 'against the computer'
        : 'online table ' + (lobby.code || '?') + ', seat ' + (mySeat + 1)));
      L.push('Rules: to ' + (state.config.targetScore || 121) +
        ', ' + (state.config.difficulty || 'normal') + ' opponent');
      L.push('Position: hand ' + state.handNumber + ', phase ' + state.phase +
        ', count ' + state.count + ', score ' +
        state.players[0].score + '-' + state.players[1].score);
      L.push('Accounting check: ' + (state.handsFailingAudit
        ? '*** ' + state.handsFailingAudit + ' hand(s) FAILED ***'
        : 'every completed hand passed'));
    }
    return L.join('\n');
  }

  function buildBugReport() {
    var L = [];
    L.push('## What went wrong');
    L.push((el['bug-what'].value || '').trim() || '(not described)');
    L.push('');
    L.push('## Setup');
    L.push('```');
    L.push(bugSummary());
    L.push('```');
    if (el['bug-include-log'].checked && state) {
      L.push('');
      L.push('## Game log');
      L.push('```');
      L.push(buildTranscript());
      L.push('```');
    }
    return L.join('\n');
  }

  function bugIssueUrl() {
    /* The link carries the SUMMARY only. A full transcript runs to tens of
     * thousands of characters and would blow past every browser's URL limit,
     * which is why the whole report goes on the clipboard and the button says
     * so. */
    var body = '## What went wrong\n' + ((el['bug-what'].value || '').trim() || '(see pasted report)') +
      '\n\n## Setup\n```\n' + bugSummary() + '\n```\n\n' +
      '_The full game log is on the clipboard — paste it below this line._\n';
    var url = 'https://github.com/' + BUG_REPO + '/issues/new?title=' +
      encodeURIComponent(bugTitle()) + '&body=' + encodeURIComponent(body);
    return url.length > MAX_URL ? url.slice(0, MAX_URL) : url;
  }

  function refreshBugPreview() { el['bug-preview'].value = buildBugReport(); }

  function openBug() {
    if (!state) return;
    refreshBugPreview();
    openDialog(el['bug-dialog']);
    el['bug-title'].focus();
    announceRequested('Report a bug. Describe what went wrong. Nothing is sent anywhere ' +
      'on its own; the box at the bottom shows exactly what will be copied.');
  }

  function bugCopyAndOpen() {
    copyText(buildBugReport(), el['bug-preview'], 'Report');
    try { window.open(bugIssueUrl(), '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
  }

  /* ---------------- settings plumbing ---------------- */

  function applySkin() {
    var f = readForm();
    document.body.classList.toggle('skin-traditional', f.skin !== 'plain');
    document.body.classList.toggle('skin-plain', f.skin === 'plain');
    document.body.classList.toggle('layout-two-col', f.layout === 'two');
  }

  /* At an online table the rules belong to the room and were fixed when it was
   * made. Leaving the controls live would let a player change a setting, see
   * nothing happen, and reasonably conclude the game was broken. */
  function applyOnlineSettingLocks() {
    var online = !SH.Table.isLocal();
    ['opt-target', 'opt-difficulty'].forEach(function (id) {
      var node = $(id);
      if (node) node.disabled = online;
    });
    var note = $('settings-online-note');
    if (note) note.hidden = !online;
  }

  function openSettings() {
    applyOnlineSettingLocks();
    openDialog(el['settings-dialog']);
    $('opt-target').focus();
  }

  function onSettingChanged() {
    settings = readForm();
    saveSettings();
    applySkin();
    if (state) { lastActionsKey = null; render(); }
  }

  function resetSettings() {
    applyToForm(DEFAULTS);
    onSettingChanged();
    announceRequested('Settings reset to the defaults. ' + el['settings-summary'].textContent);
  }

  function openRules() { openDialog(el['rules-dialog']); }
  function openA11y() { openDialog(el['a11y-dialog']); }

  SH.UI = {
    init: init,
    /* Exposed for the tests, which drive the real page. Nothing in the game uses
     * these. */
    _test: {
      say: say,
      announce: announce,
      announceRequested: announceRequested,
      alert_: alert_,
      resetSpeech: resetSpeech,
      lastSpoken: function () { return lastSpoken; },
      textHand: function () { return textHand(); },
      textPlay: function () { return textPlay(); },
      textScore: function () { return textScore(); },
      textPosition: function () { return textPosition(); },
      textSeen: function () { return textSeen(); },
      textWho: function () { return textWho(); },
      view: function () { return state; },
      seat: function () { return mySeat; },
      myMove: function () { return myMove(); },
      settings: function () { return settings; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

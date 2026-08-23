/* Euchre - interface, keyboard handling and screen reader announcements.
 *
 * Announcement policy: a run of computer turns is buffered and spoken as one
 * polite message, so nothing gets cut off half way through. Errors and direct
 * replies to a keypress go to a separate assertive region. The visible game log
 * is deliberately NOT a live region, so it can be read back at leisure without
 * being spoken twice.
 *
 * THE ONE EUCHRE-SPECIFIC ACCESSIBILITY DECISION, and the reason several
 * functions here are longer than their sheephead equivalents:
 *
 *   A sighted euchre player answers "what would my hand be if hearts were
 *   trump?" by looking at five cards at once. Two of the jacks move suit, one
 *   becomes the best card in the game, and the whole answer arrives in a glance.
 *   Read out card by card, the same question is a memory exercise with a colour
 *   rule in it, performed while three other people wait.
 *
 *   That is not the same game, and it is not a fair one. So the hand read does
 *   the mapping: during the bidding it says what your trump WOULD be, names the
 *   bowers, and counts them. It is not coaching — it tells you nothing you could
 *   not derive — it just removes a workload that only exists if you cannot see
 *   the cards.
 */
(function (global) {
  'use strict';
  var SH = global.SH;
  var C = SH.Cards, G = SH.Game, AI = SH.AI;

  /* Names for the computer players, drawn fresh each game so the table is not
   * the same faces every time. Short and distinct, so they stay quick to hear
   * and easy to tell apart when announced. */
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
   * kellylford.github.io — so a key shared with another game means every setting
   * changed here also changes there.
   *
   * The sharp edge is below: loadSettings() calls removeItem on everything in
   * OLD_STORE_KEYS. Naming another game's key in that list would DELETE somebody
   * else's real settings the first time they opened this one. So: only keys this
   * game has itself retired may ever appear there. */
  var STORE_KEY = 'euchre.settings.v1';
  var OLD_STORE_KEYS = [];

  var NET_IDS = ['net-line', 'net-actions', 'net-reconnect'];
  var LOBBY_IDS = ['lobby-section', 'lobby-status', 'lobby-choose', 'lobby-table',
    'lobby-create', 'lobby-join-form', 'lobby-code', 'lobby-code-display', 'lobby-invite',
    'lobby-copy', 'lobby-leave', 'lobby-seats', 'lobby-back', 'setup-online',
    'table-code-line', 'lobby-start', 'lobby-start-hint',
    'table-code-actions', 'game-copy-code'];

  var DIALOGS = ['a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'];

  function anyDialogOpen() {
    for (var i = 0; i < DIALOGS.length; i++) if (el[DIALOGS[i]] && el[DIALOGS[i]].open) return true;
    return false;
  }

  /* Which seat this browser is playing. Zero offline, and it stays a variable
   * rather than a literal so the online build has one place to set it instead of
   * every site that mentions a seat. */
  var mySeat = 0;

  /* `state` holds a VIEW — what this seat is entitled to see — never the
   * authoritative game.
   *
   * Offline the authoritative game is right there in `local`, and it would be
   * quicker to render straight from it. Rendering from the projection instead
   * means the single-player game exercises the projection on every hand: a field
   * missing from js/view.js becomes a broken screen on somebody's first deal
   * rather than an online-only bug found six weeks later by the one person who
   * hit it. The offline game is the online game's test harness, for free. */
  var state = null;    // the view
  var local = null;    // offline: the authoritative game. null when online.
  var settings = null;
  var timer = null;
  var speech = [];
  var lastSpoken = '';
  var handMode = 'idle';         // idle | play | discard
  var selected = null;           // the card id chosen to put back, while discarding
  var bidAlone = false;          // the "and go alone" toggle, while bidding
  var handFocus = 0;
  var logFocus = 0;
  var lastActionsKey = null;
  var actionsRebuilt = false;

  /* When the seat now on move became responsible for it, so W can say how long
   * somebody has been thinking. Offline that is never interesting; online it is
   * the difference between "they are deciding" and "their laptop has shut". */
  var turnWatch = { key: null, at: 0 };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ['setup-section', 'setup-form', 'game-section', 'status', 'actions', 'hand',
      'trick', 'lasttrick', 'players-table', 'score-table', 'log', 'announcer', 'alerts',
      'deal-section', 'deal-note', 'deal-cards', 'seats',
      'game-h', 'export-dialog', 'export-text', 'export-summary',
      'bug-dialog', 'bug-title', 'bug-what', 'bug-include-log', 'bug-preview',
      'a11y-dialog', 'settings-dialog', 'settings-summary']
      .concat(LOBBY_IDS).concat(NET_IDS).forEach(function (id) {
        el[id] = $(id);
      });

    /* The lobby. Every control is an ordinary button or form, so there is nothing
     * here about keyboard handling: the browser already does it. */
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
      if (r && r.ok === false) { alert_(r.reason + '.'); return; }
      lobbyStatus('Starting the game…');
    });
    $('lobby-leave').addEventListener('click', leaveTable);
    $('lobby-join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      joinTable($('lobby-code').value, null);   // the room decides where we sit
    });

    /* Say back what was typed, once it is a whole code. Somebody who cannot see
     * the field has otherwise no way to check they typed what they meant before
     * committing to it. */
    $('lobby-code').addEventListener('change', function () {
      var clean = normaliseCode($('lobby-code').value);
      if (clean.length >= 5) alert_('Code entered: ' + spellCode(clean) + '.');
    });

    /* Every view, wherever we are.
     *
     * Offline the local loop drives rendering after each action; online there is
     * no local loop, and this IS the loop. Restricting it to the lobby would mean
     * the interface stopped listening the moment a player entered the game:
     * views keep arriving and nothing re-renders, and the board sits frozen at
     * whatever it was at the instant of entry. From the player's side that is
     * indistinguishable from the table having stopped. */
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
    $('a11y-close').addEventListener('click', function () { closeDialog(el['a11y-dialog']); });
    // Each help dialog offers the other, so neither is a dead end.
    $('rules-to-a11y').addEventListener('click', openA11y);
    $('a11y-to-rules').addEventListener('click', function () {
      closeDialog(el['a11y-dialog']);
      goToSection('rules-h');
    });
    // Escape closes a native dialog without going through our button.
    DIALOGS.forEach(function (id) {
      el[id].addEventListener('close', restoreDialogFocus);
    });
    $('btn-newgame').addEventListener('click', backToSetup);
    $('setup-settings').addEventListener('click', openSettings);
    $('btn-settings').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', function () { closeDialog(el['settings-dialog']); });
    $('settings-reset').addEventListener('click', resetSettings);
    // Persist as they go, so nothing is lost by closing with Escape.
    ['opt-points', 'opt-stick', 'opt-alone-rule', 'opt-difficulty', 'opt-pace', 'opt-verbose',
      'opt-autofocus', 'opt-name', 'opt-skin', 'opt-layout']
      .forEach(function (id) {
        $(id).addEventListener('change', onSettingChanged);
      });
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
    // Keep the preview honest: it must always show exactly what will be copied.
    ['bug-title', 'bug-what'].forEach(function (id) {
      el[id].addEventListener('input', refreshBugPreview);
    });
    el['bug-include-log'].addEventListener('change', refreshBugPreview);

    document.querySelectorAll('[data-say]').forEach(function (b) {
      b.addEventListener('click', function () { say(b.getAttribute('data-say')); });

    /* The Next button is the N key, looked up the same way. N has always
     * worked; it was simply never advertised, so nobody was told it existed.
     * Bound here rather than rebuilt with the actions, because the toolbar is
     * static and only the button it points at changes. */
    var toolNext = document.getElementById('tool-next');
    if (toolNext) {
      toolNext.addEventListener('click', function () {
        var adv = el.actions.querySelector('button[data-advance]');
        if (adv) adv.click();
      });
    }
    });

    el.hand.addEventListener('keydown', onHandKeys);
    el.log.addEventListener('keydown', onLogKeys);
    document.addEventListener('keydown', onGlobalKeys);

    /* Last, so everything it may touch already exists. */
    var invited = codeFromUrl();
    if (invited) offerInvite(invited);
  }

  /* ---------------- settings ---------------- */

  var DEFAULTS = {
    name: 'MyPlayerName', pointsToWin: 10, stickTheDealer: false, allowAlone: true,
    difficulty: 'normal', pace: 4000, verbose: true, autofocus: true,
    skin: 'traditional', layout: 'one'
  };

  /* Rules the engine must not see change part way through a hand. Everything
   * else can take effect immediately. */
  var RULE_FIELDS = ['pointsToWin', 'stickTheDealer', 'allowAlone', 'difficulty'];

  function applyToForm(s) {
    $('opt-name').value = s.name;
    $('opt-points').value = String(s.pointsToWin);
    if (!$('opt-points').value) $('opt-points').value = String(DEFAULTS.pointsToWin);
    $('opt-stick').checked = !!s.stickTheDealer;
    $('opt-alone-rule').checked = !!s.allowAlone;
    $('opt-difficulty').value = s.difficulty;
    $('opt-pace').value = String(s.pace);
    // A stored pace that is no longer offered leaves the select with nothing
    // selected, and readForm would then parse '' to NaN and stall the game.
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
    var bits = [
      'Playing to ' + f.pointsToWin,
      f.difficulty + ' opponents',
      f.stickTheDealer ? 'Stick the dealer' : 'Hands may be thrown in',
      f.allowAlone ? 'Going alone allowed' : 'No going alone',
      PACE_NAMES[String(f.pace)] || 'Instant pace',
      f.skin === 'plain' ? 'Plain cards' : 'Traditional cards',
      f.layout === 'two' ? 'Two column desktop' : 'One column'
    ];
    el['settings-summary'].textContent = bits.join('. ') + '.';
  }

  function readForm() {
    var name = ($('opt-name').value || 'MyPlayerName').trim().slice(0, 16) || 'MyPlayerName';
    var names = [name].concat(crewNames(3, name));
    return {
      name: name,
      names: names,
      numPlayers: G.SEATS,
      pointsToWin: parseInt($('opt-points').value, 10) || DEFAULTS.pointsToWin,
      stickTheDealer: $('opt-stick').checked,
      allowAlone: $('opt-alone-rule').checked,
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

    /* An invite turns this form into a join. The name has just been read out of
     * it, which is the whole reason the link lands here rather than dropping
     * somebody nameless into a game already in progress. */
    if (pendingInvite) {
      var code = pendingInvite;
      pendingInvite = '';
      showLobby();
      joinTable(code, null);
      return;
    }
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
    pushLog('info', 'Euchre to ' + settings.pointsToWin + ' points. You are in seat 1; ' +
      settings.names[2] + ' is your partner, across the table. ' +
      settings.names[1] + ' and ' + settings.names[3] + ' are against you.');
    dealNext();
  }

  function backToSetup() {
    clearTimeout(timer);
    resetSpeech();
    SH.Table.close();

    /* Back to seat 0, and this is not cosmetic. mySeat surviving an online table
     * would mean the next single-player game projected a view for seat 3 while
     * createGame seated the human at 0 — you would be dealt another seat's cards
     * at a table that labelled somebody else "(you)". */
    mySeat = 0;
    netTroubled = false;
    showNetTrouble('', false);
    if (el['table-code-line']) { el['table-code-line'].hidden = true; el['table-code-line'].textContent = ''; }
    if (el['table-code-actions']) el['table-code-actions'].hidden = true;
    lobby.code = null;
    lobby.seat = null;
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
    selected = null;
    bidAlone = false;
    handFocus = 0;
    lastActionsKey = null;
    /* Rule changes made mid-game take effect here, at a hand boundary, never part
     * way through a hand already being scored under the old rules.
     *
     * Offline only. Online the rules belong to the ROOM and are fixed when the
     * table is made — otherwise every client would quietly overwrite them from
     * its own saved settings on every deal, and the last person to press Deal
     * would decide what game everybody was playing. */
    if (local) RULE_FIELDS.forEach(function (k) { local.config[k] = settings[k]; });
    /* The first deal is a `start`; every later one is a `nextHand`. Splitting
     * them is what lets an online table wait for its players instead of dealing
     * the moment it is made — and the offline game deals from 'idle' too, where
     * nextHand is refused. */
    var v0 = SH.Table.view();
    SH.Table.act({ type: (v0 && v0.phase === 'idle') ? 'start' : 'nextHand' });
    refresh();
    drain();
    speech.unshift(' ');            // keeps the deal line from merging with the previous hand
    tick();
  }

  /* Pull the latest view. Offline this projects on demand; online it is whatever
   * the server last sent. */
  function refresh() {
    state = SH.Table.view();
    return state;
  }

  /* Move engine events into the log and the pending speech buffer. */
  function drain() {
    var evts = SH.Table.drainEvents();
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i];
      var text = (!settings.verbose && e.textPlain) ? e.textPlain : e.text;
      pushLog(e.kind, text);
      speech.push(text);
    }
  }

  function handSize() { return G.HAND_SIZE; }

  function isHumanTurn() {
    if (!state) return false;
    if (state.phase === 'bid1' || state.phase === 'bid2') return state.turn === mySeat;
    if (state.phase === 'discard') return state.dealer === mySeat;
    if (state.phase === 'play') return state.turn === mySeat;
    return false;
  }

  function amSittingOut() { return state && state.sittingOut === mySeat; }

  /* The main loop: render, then either hand control to the player or let a
   * computer seat act after the configured pause. */
  function tick() {
    render();

    /* Online, pace is not this browser's to set.
     *
     * settings.pace does not describe how fast the player wants to read — it
     * DRIVES THE ENGINE, by deciding when the next computer seat acts. That is a
     * coherent thing for a game living in one tab and an incoherent one for a
     * table: the bots belong to the room, and four clients each running their own
     * timer would be four people trying to deal at once.
     *
     * So online this function renders and speaks and then stops. Moves arrive
     * because the server sends them. What survives of the pace setting is the
     * part that was always about the player rather than the game — how their own
     * announcements are batched — and that lives in the speech queue. */
    if (!SH.Table.isLocal()) {
      flush();
      if (isHumanTurn()) focusForTurn();
      else if (state.phase === 'handOver') focusFirstAction();
      return;
    }

    if (state.phase === 'handOver') { flush(); focusFirstAction(); return; }
    if (isHumanTurn()) { flush(); focusForTurn(); return; }
    if (settings.pace < 0) { flush(); focusFirstAction(); return; }
    // Batching a run of plays into one message exists to stop them cutting each
    // other off mid-word, which is a problem at instant speed and only there.
    // Given whole seconds, each play has room to be spoken as it happens.
    if (settings.pace > 0) flush();
    timer = setTimeout(function () {
      AI.act(local);
      refresh();
      drain();
      tick();
    }, settings.pace);
  }

  /* Take the next computer turn now. In manual pacing this is the only way the
   * game moves; on a timed pace it is a shortcut past a pause you did not want,
   * so the pending timer has to go or the same seat would play twice. */
  function stepOnce() {
    /* Nothing to step online: the room advances on its own clock, and reaching
     * for the local AI here would throw. The button is not rendered online —
     * this is the guard for the keyboard shortcut that reaches the same
     * function. */
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
   * synchronous and focus never moves; online the refusal can arrive after a
   * re-render that has already destroyed the button the player was standing on,
   * dropping focus to <body> — which is the worst possible outcome for somebody
   * navigating by keyboard, because there is no way back except Tab from the top
   * of the document. */
  function onRejected(info) {
    if (!info) return;
    if (info.reason) {
      alert_(sentence(info.reason) + (info.timedOut
        ? ' Nothing has been played. You can try again.' : ''));
    }
    if (state && isHumanTurn()) {
      var cards = el.hand.querySelectorAll('.card');
      if (cards.length && !el.hand.contains(document.activeElement)) focusCard(handFocus);
    }
  }

  /* ---------------- the lobby ----------------
   *
   * Making a table, sharing its code, and sitting down at one.
   *
   * THE CODE IS ONE TEXT FIELD, not five boxes. Split inputs look tidier and are
   * miserable with a screen reader: every keystroke moves focus, so the field
   * you are in is never the field you think you are in, and correcting a typo
   * means guessing where you are.
   *
   * THE CODE IS READ OUT IN WORDS. "P4K7M" spoken by a screen reader is a
   * mumble; "P, 4, K, 7, M" is a code somebody can write down.
   */

  var lobby = { code: null, seat: null, connected: false };

  /* Whether we have told the player something is wrong with the connection, so
   * that coming back can be announced as the news it is rather than passing in
   * silence. */
  var netTroubled = false;
  var netState = 'offline';

  /* A fragment from the wire, made into a sentence. The transport hands back
   * things like "the connection closed", which read out mid-sentence with a
   * lower case start when concatenated straight after a full stop. */
  function sentence(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(t) ? t : t + '.';
  }

  /* The alphabet the server uses. No O, I or L, and no zero or one — a code gets
   * read down a phone, and "was that a one or an I" is a poor first experience of
   * a game built for people who cannot see the screen. */
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function normaliseCode(raw) {
    return String(raw || '').toUpperCase().split('').filter(function (c) {
      return CODE_ALPHABET.indexOf(c) >= 0;
    }).join('');
  }

  function spellCode(code) { return String(code || '').split('').join(', '); }

  /* Somebody followed an invite link.
   *
   * They land on the START screen rather than straight in the game, and that is
   * deliberate: the one thing the link cannot carry is who they are. Sending a
   * name in the URL would mean the host naming their guests, and an empty name
   * at a table is worse than a slow one. So the code is held, the button says
   * what pressing it will do, and the name field is where focus goes. */
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

  /* The lobby's own status line. role="status" on the element, so this is spoken
   * politely without stealing focus — and it goes through the same queue as
   * everything else so it cannot wipe out a game announcement mid-word. */
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

  /* The rules the whole table plays by, fixed when it is made.
   *
   * Deliberately not the whole settings object: pace, skin, verbosity and the
   * player's own name are this browser's business and nobody else's. */
  function roomConfig() {
    return {
      numPlayers: G.SEATS,
      names: crewNames(G.SEATS, settings.name),
      pointsToWin: settings.pointsToWin,
      stickTheDealer: settings.stickTheDealer,
      allowAlone: settings.allowAlone,
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
    lobby.seat = seat;
    lobbyStatus('Joining table ' + spellCode(clean) + '…');

    /* seat may be null: "put me anywhere". The client cannot choose sensibly —
     * it does not know which seats are free until it has connected, and it
     * cannot connect without asking. Guessing produces the obvious result: the
     * second person to arrive asks for seat 0, is told it is taken, and cannot
     * join at all. */
    SH.Table.startOnline(seat, function (handler) {
      return SH.Net.connect(
        { code: clean, seat: seat, name: settings.name },
        handler,
        onNetStatus
      );
    });

    showTable(clean);
  }

  /* The address of this page with the table already chosen.
   *
   * Built from location rather than hard coded, so it is right on the
   * published site, right on a local file, and right behind whatever
   * anybody puts in front of it. The query string carries the code and
   * nothing else — no name, no seat: the person arriving chooses their own
   * name, and the seat is the room's to hand out. */
  function inviteLink(code) {
    var base = location.origin + location.pathname;
    return base + '?table=' + encodeURIComponent(code);
  }

  /* A table code in the address bar, if there is one. */
  function codeFromUrl() {
    try {
      var m = /[?&]table=([^&#]+)/.exec(location.search || '');
      return m ? normaliseCode(decodeURIComponent(m[1])) : '';
    } catch (e) { return ''; }
  }

  function showTable(code) {
    $('lobby-choose').hidden = true;
    $('lobby-table').hidden = false;
    $('lobby-code-display').textContent = code;
    var invite = inviteLink(code);
    var a = $('lobby-invite');
    if (a) { a.href = invite; a.textContent = invite; }
    renderSeats2();
    $('lobby-code-display').focus();
  }

  /* THE STANDING VERSION OF THE CONNECTION STATE, on the game screen.
   *
   * The lobby's status line says all of this too, and the lobby is hidden from
   * the moment the first hand is dealt — so during play it says it to nobody.
   * Nothing is shown while the connection is healthy: a permanent "connected"
   * badge is noise on screen and worse in a screen reader's tab order. */
  function showNetTrouble(text, offerReconnect) {
    var line = el['net-line'];
    var actions = el['net-actions'];
    if (!line || !actions) return;
    if (!text) {
      line.hidden = true;
      line.textContent = '';
      actions.hidden = true;
      return;
    }
    line.hidden = false;
    line.textContent = text;
    actions.hidden = !(offerReconnect && lobby.code);
  }

  /* Take the same seat at the same table again.
   *
   * Deliberately a button rather than an automatic retry. Coming back is a
   * decision with consequences — the computer may have been playing your seat,
   * and a silent reconnect would hide that — so this asks, and says what
   * happened afterwards. Asking for OUR seat rather than "anywhere" is what
   * makes it the same chair: the room lets a seat marked away be reclaimed,
   * which is exactly the state a dropped connection leaves behind. */
  function reconnect() {
    if (!lobby.code) return;
    showNetTrouble('Reconnecting to table ' + lobby.code + '…', false);
    announceRequested('Reconnecting to table ' + spellCode(lobby.code) + '.');
    joinTable(lobby.code, typeof mySeat === 'number' ? mySeat : null);
  }

  /* Connection state is game state.
   *
   * A player who cannot see the screen has no other way to tell a table where
   * everybody is thinking from one that has died. Every state change is said
   * once — not repeatedly, which wears thin fast — and W carries the standing
   * version for anyone who wants to check. */
  function onNetStatus(s) {
    lobby.connected = s.state === 'connected';
    netState = s.state;

    /* Two sentences, not one run together. A detail from the wire tacked on
     * after a full stop with no capital is said exactly as written. */
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
      /* A different thing from a seat being taken, and worth saying so: the
       * commonest cause is a typo, and "that seat is not available" sends
       * somebody looking at seats instead of at the code they typed. */
      lobbyStatus('There is no table with that code. Check it and try again — ' +
        'it is five letters and numbers, and the letters O, I and L are never used.');
      $('lobby-choose').hidden = false;
      $('lobby-table').hidden = true;
      $('lobby-code').focus();
    } else if (s.state === 'refused') {
      lobbyStatus('That seat is not available. ' + (s.detail || '') + ' Try another seat.');
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
      /* No reconnect offered on a fault: the room is telling us its own state is
       * untrustworthy, and rejoining would land in the same broken game. */
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

  function sideLabel(i) {
    return G.teamOf(i) === 0 ? 'Seats 1 and 3' : 'Seats 2 and 4';
  }

  function renderSeats2() {
    var tbody = $('lobby-seats').querySelector('tbody');
    var v = SH.Table.view();
    tbody.innerHTML = '';

    var n = G.SEATS;
    for (var i = 0; i < n; i++) {
      var p = v ? v.players[i] : null;
      var tr = document.createElement('tr');

      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = 'Seat ' + (i + 1);
      tr.appendChild(th);

      var who = document.createElement('td');
      who.textContent = p ? p.name : '—';
      tr.appendChild(who);

      var side = document.createElement('td');
      side.textContent = sideLabel(i);
      tr.appendChild(side);

      var st = document.createElement('td');
      /* Which seat is ours comes from the CONNECTION, not from what we asked
       * for — we no longer ask. */
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

  /* Once the table has dealt and we have a seat, the lobby's job is done. */
  function maybeEnterGame() {
    var v = SH.Table.view();
    if (!v || v.phase === 'idle') return;
    mySeat = SH.Table.seat();
    local = null;                        // the authoritative game is on the server
    el['lobby-section'].hidden = true;
    el['game-section'].hidden = false;
    applyOnlineSettingLocks();

    /* Deliberately NOT resetSpeech(). Clearing the queue makes sense when a game
     * ends and a new one starts, because what is pending describes a game that
     * no longer exists. Nothing pending here is stale: it is the lobby telling
     * you where you are, and the deal is about to be announced after it. */
    refresh();
    drain();

    if (lobby.code) {
      speech.unshift('Table ' + spellCode(lobby.code) + ', seat ' + (mySeat + 1) + '. ' +
        'Your partner is ' + v.players[G.partnerOf(mySeat)].name + ', in seat ' +
        (G.partnerOf(mySeat) + 1) + '.');
      /* And leave it on screen for the rest of the game. The lobby vanishes the
       * moment the first hand is dealt, so without this the code is spoken once
       * and then unavailable — and the host's whole job is to read it to
       * somebody. */
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
    lobby.seat = null;
    lobby.connected = false;
    $('lobby-choose').hidden = false;
    $('lobby-table').hidden = true;
    lobbyStatus('You left the table.');
    $('lobby-code').focus();
  }

  function copyCode() {
    /* Works from the lobby and from the game. The lobby vanishes when play
     * starts, and the code is exactly what somebody needs at that moment. */
    var code = lobby.code || $('lobby-code-display').textContent;
    if (!code) return;
    /* THE LINK, not the code. A code has to be typed by the person receiving
     * it, into a field they have to find first; a link is one activation. The
     * code is still on screen and still gets read out here, because reading it
     * down a phone is the fastest route when somebody is in the room. */
    var link = inviteLink(code);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () {
        alert_('Invite link copied. The table code is ' + code + '.');
      }, function () {
        alert_('The link could not be copied. The table code is ' + code + '.');
      });
    } else {
      alert_('The table code is ' + code + '.');
    }
  }

  /* ---------------- announcements ----------------
   *
   * Both live regions are written the same way: blank the node, then set the text
   * a moment later. The blank is not decoration — setting the same string twice is
   * not a DOM change and a screen reader says nothing, so "Your turn" following
   * "Your turn" would be silence.
   *
   * That pattern has a race in it, and offline nothing ever triggers it. Messages
   * only arrive on a keystroke or a pace timer, so two never overlap. Over a
   * socket they will: two views twenty milliseconds apart means the second blank
   * runs before the first timeout fires, and the first message IS NEVER SPOKEN.
   * Not delayed — gone, with no error and nothing on screen to show it happened.
   *
   * Four rules, and the reasoning matters more than the mechanism:
   *
   *   1. ONE QUEUE PER REGION. The polite announcer and the assertive alerts are
   *      independent channels to the screen reader; a single global queue makes a
   *      card-selection confirmation delay the hand read the player then asks
   *      for, which is a delay invented entirely by the fix.
   *
   *   2. PASS-THROUGH WHEN IDLE. With nothing in flight a message takes the path
   *      it always did. Single-player at instant pace must not get slower to fix
   *      a problem it does not have.
   *
   *   3. A GAME EVENT NEVER PREEMPTS A REQUEST. Press H, a remote play lands
   *      mid-sentence, and the hand read is what you lose — the one message you
   *      explicitly asked for. Requests jump the queue; the event is REQUEUED,
   *      not dropped, because dropping it on purpose is no better than the
   *      accident this exists to prevent.
   *
   *   4. A NEWER REQUEST SUPERSEDES AN OLDER PENDING ONE, per region.
   */

  var SETTLE = 60;   // blank-to-text delay: long enough for the DOM change to register
  /* Minimum time a message keeps its region before the next one replaces it.
   * SETTLE alone is not enough — it covers writing the text, not reading it. */
  var HOLD = 250;

  function newChannel() { return { queue: [], timer: null, inFlight: null, lastAt: 0 }; }
  var channels = { polite: newChannel(), alert: newChannel() };

  function channelNode(name) { return name === 'alert' ? el.alerts : el.announcer; }

  function enqueueSpeech(name, msg, requested) {
    var ch = channels[name];
    if (!msg || !String(msg).trim()) {
      /* A review key with nothing to say clears its region rather than leaving
       * the last announcement sitting there — otherwise the player hears the
       * answer to a question they asked several keystrokes ago as though it were
       * the answer to this one. */
      if (requested) {
        if (ch.inFlight) { clearTimeout(ch.inFlight.setTimer); ch.inFlight = null; }
        channelNode(name).textContent = '';
      }
      return;
    }

    // Rule 4: a newer request replaces an older one still waiting in this region.
    if (requested) {
      ch.queue = ch.queue.filter(function (q) { return !q.requested; });
    }
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

    // Rule 3: an in-flight game event steps aside, and goes back on the queue.
    if (urgent && ch.inFlight && !ch.inFlight.requested) {
      clearTimeout(ch.inFlight.setTimer);
      ch.queue.push({ region: name, msg: ch.inFlight.msg, requested: false });
      ch.inFlight = null;
    }
    // ...and so does one that is merely scheduled. Without this, pressing a
    // review key while an event waits out its hold window puts the answer behind
    // it, which to the player is indistinguishable from a dropped keypress.
    if (urgent && ch.timer) { clearTimeout(ch.timer); ch.timer = null; }

    /* Deliveries within a region are strictly serialized. If a message is
     * mid-flight — blanked, text not yet written — nothing else may start,
     * because starting would cancel its pending write and lose it. Its own
     * completion re-enters this function, so the queue keeps moving. */
    if (ch.inFlight || ch.timer) return;

    /* lastAt of 0 means nothing has been said yet, which must read as "long ago"
     * rather than as 1970 — subtracting an absolute timestamp from Date.now()
     * gives fifty-odd years and silently turns every gap into zero. */
    var since = ch.lastAt ? (Date.now() - ch.lastAt) : HOLD;

    /* Even an urgent message waits a beat after one has just LANDED. Preempting
     * a message not yet written is right; blanking one the instant it appears is
     * not — it gets zero time on the page, and a live region set and cleared in
     * the same tick is never announced at all. Delivered, and silent. */
    var wait = urgent ? Math.max(0, SETTLE - since) : Math.max(0, HOLD - since);
    if (wait === 0) { deliverSpeech(name); return; }
    ch.timer = setTimeout(function () {
      ch.timer = null;
      deliverSpeech(name);
    }, wait);
  }

  function deliverSpeech(name) {
    var ch = channels[name];
    var item = takeNextSpeech(ch);
    if (!item) return;
    var node = channelNode(name);

    if (ch.inFlight) { clearTimeout(ch.inFlight.setTimer); ch.inFlight = null; }

    /* Repeat works on whatever you last heard, from either region. Recording it
     * only for the polite one would make anything routed to the assertive region
     * the one message R could not bring back. */
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

  /* The game says something on its own. */
  function announce(msg) { enqueueSpeech('polite', msg, false); }

  /* The player asked to hear this. Jumps ahead of queued game events. */
  function announceRequested(msg) { enqueueSpeech('polite', msg, true); }

  /* Assertive: errors, and direct feedback on a keypress. Always requested — it
   * is a reply to something the player just did. */
  function alert_(msg) { enqueueSpeech('alert', msg, true); }

  function suitWord(s) { return C.SUIT_NAME[s]; }

  function turnPrompt() {
    if (!state) return '';
    if (state.phase === 'handOver') {
      return state.gameOver
        ? 'Press N or Enter on Start a new game.'
        : 'Press N or Enter on Deal next hand.';
    }
    if (amSittingOut() && state.phase === 'play') {
      return 'You are sitting out this hand while ' + seatName(state.maker) + ' plays alone.';
    }
    if (!isHumanTurn()) return '';

    if (state.phase === 'bid1') {
      return 'Your turn to bid. The upcard is the ' + C.name(state.upcard) + '. ' +
        'Order it up to make ' + suitWord(state.upcard.s).toLowerCase() + ' trump, or pass. ' +
        'Press H to hear your hand with ' + suitWord(state.upcard.s).toLowerCase() + ' as trump.';
    }
    if (state.phase === 'bid2') {
      return 'Your turn to bid. ' + suitWord(state.deniedSuit) + ' were turned down. ' +
        'Name another suit, or pass. Press H to hear what each suit would give you.';
    }
    if (state.phase === 'discard') {
      return 'You took the upcard. Choose one card to put back, then activate the Put back button.';
    }
    if (state.phase === 'play') {
      var n = state.trick.length;
      if (n === 0) return 'Your lead. Trick ' + trickNumber() + ' of ' + handSize() + '.';
      return 'Your turn to play. ' + describeTrickShort();
    }
    return '';
  }

  function trickNumber() {
    return Math.min(handSize(), state.trickLog.length + 1);
  }

  function describeTrickShort() {
    if (!state.trick.length) return 'Nothing played to this trick yet.';
    var led = C.effSuit(state.trick[0].card, state.trump);
    var wi = G.trickWinnerIndex(state.trick, state.trump);
    var w = state.trick[wi];
    var ledWord = led === state.trump ? 'Trump' : suitWord(led);
    return ledWord + ' led. ' + seatName(w.player) + ' is winning with the ' +
      (settings.verbose ? C.describe(w.card, state.trump) : C.name(w.card)) + '.';
  }

  /* ---------------- review keys ---------------- */

  function say(what) {
    if (!state) return;
    switch (what) {
      case 'hand': announceRequested(textHand()); break;
      case 'trick': announceRequested(textTrick()); break;
      case 'last': announceRequested(textLastTrick()); break;
      case 'score': announceRequested(textScores()); break;
      case 'bidding': announceRequested(textBidding()); break;
      case 'count': announceRequested(textCount()); break;
      case 'order': announceRequested(textOrder()); break;
      case 'who': announceRequested(textWho()); break;
      case 'repeat': announceRequested(lastSpoken || 'Nothing to repeat.'); break;
    }
  }

  /* The hand, grouped by trump and then by suit, with the bowers named.
   *
   * Every card is read out in full in both groups. Shortening the non-trump
   * cards to bare ranks under a suit heading changes the pattern half way
   * through the sentence and makes it harder to follow, not easier. */
  function groupedHand(cards, trump) {
    var sorted = C.sortHand(cards, trump);
    var groups = [];
    var current = null;
    sorted.forEach(function (c) {
      var key = C.effSuit(c, trump);
      if (!current || current.key !== key) {
        current = { key: key, cards: [] };
        groups.push(current);
      }
      current.cards.push(c);
    });
    return groups.map(function (g) {
      var label = (trump && g.key === trump) ? 'Trump' : suitWord(g.key);
      return label + ': ' + g.cards.map(function (c) {
        var b = C.bower(c, trump);
        return C.name(c) + (b === 'right' ? ', the right bower'
          : b === 'left' ? ', the left bower' : '');
      }).join(', ');
    }).join('. ');
  }

  function textHand() {
    var hand = state.players[mySeat].hand;
    if (!hand.length) return 'Your hand is empty.';

    var lead = '';
    /* The dealer's sixth card, called out before anything else — it is the thing
     * they actually have to act on. */
    if (state.phase === 'discard' && state.dealer === mySeat && state.upcard) {
      lead = 'You took the ' + C.name(state.upcard) + '. ';
    }

    if (state.phase === 'bid1' && state.upcard) {
      /* THE BIDDING READ. See the note at the top of this file: this is the one
       * place the interface does arithmetic the player could do themselves, and
       * it is here because doing it by ear under time pressure is a different
       * game from doing it by eye. */
      var t = state.upcard.s;
      var mine = hand.filter(function (c) { return C.isTrump(c, t); });
      var rest = hand.filter(function (c) { return !C.isTrump(c, t); });
      var msg = 'With ' + suitWord(t).toLowerCase() + ' as trump you would hold ' +
        countWord(mine.length, 'trump', 'trump') + '. ';
      if (mine.length) msg += groupedHand(mine, t) + '. ';
      msg += rest.length ? 'The rest: ' + groupedHand(rest, t) + '.' : 'Nothing else.';
      if (state.dealer === mySeat) {
        msg += ' You are the dealer, so the ' + C.name(state.upcard) +
          ' would come to you and you would put a card back.';
      } else if (G.partnerOf(mySeat) === state.dealer) {
        msg += ' Your partner is dealing, so the ' + C.name(state.upcard) + ' would go to them.';
      } else {
        msg += ' ' + seatName(state.dealer) + ' is dealing, so the ' + C.name(state.upcard) +
          ' would go to the other side.';
      }
      return msg;
    }

    if (state.phase === 'bid2') {
      var bySuit = 'Your hand: ' + groupedHand(hand, null) + '.';
      var options = [];
      C.SUITS.forEach(function (s) {
        if (s === state.deniedSuit) return;
        var n = hand.filter(function (c) { return C.isTrump(c, s); }).length;
        options.push(suitWord(s).toLowerCase() + ' ' + n);
      });
      return bySuit + ' ' + suitWord(state.deniedSuit) + ' cannot be named. ' +
        'Trump you would hold: ' + options.join(', ') + '.';
    }

    var out = lead + 'Your hand, ' + countWord(hand.length, 'card', 'cards') + '. ' +
      groupedHand(hand, state.trump) + '.';
    if (amSittingOut()) {
      out += ' These are out of play this hand — ' + seatName(state.maker) + ' is playing alone.';
    }
    return out;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function countWord(n, one, many) {
    var words = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
    return (words[n] === undefined ? n : words[n]) + ' ' + (n === 1 ? one : many);
  }

  function textTrick() {
    var head = 'Trick ' + trickNumber() + ' of ' + handSize() + '. ';
    if (!state.trick.length) {
      return head + 'Nothing played yet. ' + seatName(state.turn) + ' to lead.';
    }
    var list = state.trick.map(function (t) {
      return seatName(t.player) + ', ' +
        (settings.verbose ? C.describe(t.card, state.trump) : C.name(t.card));
    }).join('. ');
    return head + list + '. ' + describeTrickShort();
  }

  function textLastTrick() {
    if (!state.lastTrick) return 'No trick has been completed yet this hand.';
    var lt = state.lastTrick;
    var list = lt.plays.map(function (t) {
      return seatName(t.player) + ', ' + C.name(t.card);
    }).join('. ');
    return 'Trick ' + lt.number + '. ' + list + '. ' + seatName(lt.winner) + ' took it.';
  }

  /* Tricks belong to a SIDE in euchre, not to a player, and that is the number
   * that decides the hand. Saying "you have two" without saying what your side
   * has is the wrong number said confidently. */
  function sideTricks(t) {
    var n = 0;
    for (var i = 0; i < G.SEATS; i++) if (G.teamOf(i) === t) n += state.players[i].tricksWon;
    return n;
  }

  function sideWords(t) {
    var a = [];
    for (var i = 0; i < G.SEATS; i++) if (G.teamOf(i) === t) a.push(seatName(i));
    return a.join(' and ');
  }

  function mySide() { return G.teamOf(mySeat); }

  function textScores() {
    var us = mySide(), them = 1 - us;
    var target = state.config.pointsToWin || 10;
    var parts = [];
    parts.push('Tricks this hand: you and ' + seatName(G.partnerOf(mySeat)) + ' ' +
      sideTricks(us) + ', ' + sideWords(them) + ' ' + sideTricks(them) + '.');
    parts.push('Game ' + state.gameNumber + ' to ' + target + ': you ' + state.scores[us] +
      ', them ' + state.scores[them] + '.');
    if (state.gamesWon[0] || state.gamesWon[1]) {
      parts.push('Games won: you ' + state.gamesWon[us] + ', them ' + state.gamesWon[them] + '.');
    }
    if (state.maker >= 0 && !state.gameOver && state.phase !== 'handOver') {
      var mt = G.teamOf(state.maker);
      var need = 3 - sideTricks(mt);
      parts.push(mt === us
        ? (need > 0 ? 'You need ' + countWord(need, 'more trick', 'more tricks') + ' to make it.'
          : 'You have made it.')
        : (need > 0 ? 'They need ' + countWord(need, 'more trick', 'more tricks') + '; ' +
            countWord(3 - sideTricks(us), 'more trick', 'more tricks') + ' euchres them.'
          : 'They have made it.'));
    }
    return parts.join(' ');
  }

  /* Trump, who made it, and where you stand. The one place the disclosure rule
   * lives for the spoken version. */
  function textBidding() {
    if (!state) return '';
    var partner = seatName(G.partnerOf(mySeat));
    var base = 'Your partner is ' + partner + ', in seat ' + (G.partnerOf(mySeat) + 1) + '. ';

    if (state.phase === 'bid1') {
      var decided = biddingSoFar(1);
      return base + 'The upcard is the ' + C.name(state.upcard) + ', so ' +
        suitWord(state.upcard.s).toLowerCase() + ' are on offer. ' +
        seatName(state.dealer) + ' is dealing. ' + decided;
    }
    if (state.phase === 'bid2') {
      return base + 'The ' + C.name(state.upcard) + ' was turned down, so ' +
        suitWord(state.deniedSuit).toLowerCase() + ' cannot be named. ' +
        seatName(state.dealer) + ' is dealing' +
        (state.config.stickTheDealer ? ' and must name a suit if it reaches them' : '') + '. ' +
        biddingSoFar(2);
    }
    if (state.maker < 0) return base + 'Nobody has made trump yet.';

    var msg = base + suitWord(state.trump) + ' are trump, made by ' +
      (state.maker === mySeat ? 'you' : seatName(state.maker)) +
      (G.teamOf(state.maker) === mySide() ? ', on your side' : ', against you') + '. ';
    msg += 'The right bower is the Jack of ' + suitWord(state.trump) +
      ' and the left bower is the Jack of ' + suitWord(C.SAME_COLOUR[state.trump]) + '. ';
    if (state.alone) {
      msg += (state.maker === mySeat ? 'You are' : seatName(state.maker) + ' is') +
        ' playing alone, so ' +
        (state.sittingOut === mySeat ? 'you are' : seatName(state.sittingOut) + ' is') +
        ' sitting this hand out. ';
    }
    msg += 'The upcard was the ' + C.name(state.upcard) +
      (state.upcardStatus === 'turnedDown' ? ', turned down.'
        : ', taken by ' + seatName(state.dealer) + '.');
    return msg;
  }

  /* Who has spoken so far in the round now under way.
   *
   * Only passes can appear here: the moment somebody does anything else the
   * round is over and the phase has moved on. Saying so as a list of names
   * rather than a list of sentences keeps it short, and it is read out often. */
  function biddingSoFar(round) {
    var said = state.bidLog.filter(function (b) {
      return b.action === 'pass' && b.round === round;
    });
    if (!said.length) return 'Nobody has bid yet this round.';
    var names = said.map(function (b) { return seatName(b.player); });
    return names.join(', ') + (said.length === 1 ? ' has passed.' : ' have passed.');
  }

  /* Counting aid. Uses only what this seat could legitimately track: cards
   * already played, its own hand, the upcard everybody saw, and its own
   * discard. */
  function textCount() {
    if (!state.trump) {
      return 'Trump has not been decided yet, so there is nothing to count. ' +
        'The upcard is the ' + C.name(state.upcard) + '.';
    }
    var seen = {};
    state.played.forEach(function (c) { seen[c.id] = 1; });
    state.trick.forEach(function (t) { seen[t.card.id] = 1; });
    state.players[mySeat].hand.forEach(function (c) { seen[c.id] = 1; });
    if (state.upcard) seen[state.upcard.id] = 1;
    if (state.discard) seen[state.discard.id] = 1;
    var unseen = C.newDeck().filter(function (c) { return !seen[c.id]; });

    var trump = state.trump;
    var trumpGone = state.played.concat(state.trick.map(function (t) { return t.card; }))
      .filter(function (c) { return C.isTrump(c, trump); }).length;
    var parts = ['Trump played: ' + trumpGone + ' of 7.'];

    var mine = state.players[mySeat].hand.filter(function (c) { return C.isTrump(c, trump); });
    parts.push(mine.length
      ? 'You hold ' + countWord(mine.length, 'trump', 'trump') + ', highest the ' +
        C.name(C.sortHand(mine, trump)[0]) + '.'
      : 'You hold no trump.');

    var outTrump = unseen.filter(function (c) { return C.isTrump(c, trump); });
    parts.push(outTrump.length
      ? 'Highest trump you have not seen: ' + C.name(C.sortHand(outTrump, trump)[0]) + '. ' +
        countWord(outTrump.length, 'trump', 'trump') + ' unaccounted for.'
      : 'Every trump is accounted for.');

    C.SUITS.forEach(function (s) {
      if (s === trump) return;
      var out = unseen.filter(function (c) { return !C.isTrump(c, trump) && c.s === s; });
      parts.push(suitWord(s) + ': ' + (out.length
        ? countWord(out.length, 'card', 'cards') + ' unseen, highest the ' +
          C.name(C.sortHand(out, trump)[0])
        : 'none unseen'));
    });
    parts.push('The upcard was the ' + C.name(state.upcard) + '.');
    return parts.join(' ');
  }

  function places(k) {
    var words = ['', 'one place', 'two places', 'three places'];
    return words[k] || k + ' places';
  }

  /* Where everyone sits in the running order. A sighted player reads this off the
   * table; without it there is no way to know whether the maker plays before or
   * after you, which changes what it is safe to lead. */
  function textOrder() {
    if (!state) return '';
    var i, k, line;
    var list = [];

    if (state.phase === 'bid1' || state.phase === 'bid2') {
      var round = state.phase === 'bid1' ? 1 : 2;
      var decided = {};
      state.bidLog.forEach(function (b) {
        if (b.action !== 'pass' || b.round === round) decided[b.player] = b.action;
      });
      var start = (state.dealer + 1) % G.SEATS;
      for (k = 0; k < G.SEATS; k++) {
        i = (start + k) % G.SEATS;
        var st = decided[i] === 'pass' ? 'passed'
          : decided[i] ? decided[i]
            : i === state.turn ? 'deciding now' : 'still to decide';
        list.push((k + 1) + ', ' + seatName(i) + roleSuffix(i) + ', ' + st);
      }
      return 'Bidding order, starting to the dealer\'s left. ' + list.join('. ') + '.';
    }

    if (state.phase !== 'play' && state.phase !== 'handOver') {
      return 'Seating order: ' + state.players.map(function (p, n) {
        return seatName(n) + roleSuffix(n);
      }).join(', ') + '.';
    }

    var startSeat = state.trick.length ? state.trick[0].player : state.leader;
    var playedBy = {};
    state.trick.forEach(function (t) { playedBy[t.player] = t.card; });

    var order = [];
    var seat = startSeat;
    for (k = 0; k < G.activeCount(state); k++) {
      order.push(seat);
      seat = G.nextActive(state, seat);
    }

    var youAt = order.indexOf(mySeat);
    var makerAt = order.indexOf(state.maker);
    order.forEach(function (s2, idx) {
      line = (idx + 1) + ', ' + seatName(s2) + roleSuffix(s2);
      if (state.phase === 'play') {
        line += ', ' + (playedBy[s2] ? 'played the ' + C.name(playedBy[s2]) : 'to play');
      }
      list.push(line);
    });

    var msg = 'Play order for this trick, starting with the lead. ' + list.join('. ') + '.';
    if (state.sittingOut >= 0) {
      msg += ' ' + (state.sittingOut === mySeat ? 'You are' : seatName(state.sittingOut) + ' is') +
        ' sitting out, so there are only three cards to this trick.';
    }
    if (youAt === 0) msg += ' You lead.';
    else if (youAt === order.length - 1) msg += ' You play last.';

    if (state.maker >= 0 && makerAt >= 0 && youAt >= 0 && state.maker !== mySeat) {
      var delta = makerAt - youAt;
      msg += delta > 0
        ? ' The maker plays ' + places(delta) + ' after you.'
        : ' The maker plays ' + places(-delta) + ' before you.';
    }

    if (state.phase === 'play' && youAt >= 0 && !playedBy[mySeat]) {
      var after = order.slice(youAt + 1).map(seatName);
      msg += after.length
        ? ' ' + after.length + (after.length === 1 ? ' player plays' : ' players play') +
          ' after you: ' + after.join(', ') + '.'
        : ' Nobody plays after you.';
    }
    return msg;
  }

  /* Who is at the table, and what silence means.
   *
   * Online, waiting is unbounded, and a player who cannot see the screen has no
   * way to tell "they are thinking" from "their tab froze" from "the socket
   * dropped". Those are three different situations with three different
   * responses, and the game is the only thing that knows which one it is. */
  function textWho() {
    if (!state) return '';
    var parts = [];
    if (SH.Table.isLocal()) {
      parts.push('You are playing on your own against the computer. ' +
        'Your partner is ' + seatName(G.partnerOf(mySeat)) + '.');
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
        (i === G.partnerOf(mySeat) ? ', your partner' : '') +
        (G.teamOf(i) === mySide() ? '' : ', against you') + '.');
    }
    var onMove = G.seatToAct(state);
    if (onMove >= 0) {
      var waited = Math.round((Date.now() - turnWatch.at) / 1000);
      parts.push((onMove === mySeat ? 'It is your turn' : 'Waiting for ' + seatName(onMove)) +
        (waited >= 3 ? ', for ' + waited + ' seconds now' : '') + '.');
    } else if (state.phase === 'handOver') {
      parts.push('The hand is over; the table is waiting for somebody to deal.');
    }
    return parts.join(' ');
  }

  /* ---------------- rendering ---------------- */

  function render() {
    var key = state.phase + ':' + state.turn + ':' + state.handNumber;
    if (turnWatch.key !== key) { turnWatch.key = key; turnWatch.at = Date.now(); }

    renderStatus();
    renderActions();
    renderHand();
    renderTrick(el.trick, state.trick, true);
    renderTrick(el.lasttrick, state.lastTrick ? state.lastTrick.plays : [], false, state.lastTrick);
    renderPlayers();
    renderScore();
    renderSeats();
    renderDeal();
    syncLogTabs();
  }

  function renderStatus() {
    var s;
    if (state.phase === 'bid1') {
      s = 'Bidding, round one. The upcard is the ' + C.name(state.upcard) + '. ' +
        (isHumanTurn() ? 'Your turn: order it up or pass?'
          : 'Waiting for ' + seatName(state.turn) + '.');
    } else if (state.phase === 'bid2') {
      s = 'Bidding, round two. ' + suitWord(state.deniedSuit) + ' turned down. ' +
        (isHumanTurn() ? 'Your turn: name a suit or pass?'
          : 'Waiting for ' + seatName(state.turn) + '.');
    } else if (state.phase === 'discard') {
      s = state.dealer === mySeat
        ? 'You took the upcard. Put one card back.'
        : seatName(state.dealer) + ' took the upcard and is putting a card back.';
    } else if (state.phase === 'play') {
      s = suitWord(state.trump) + ' are trump — trick ' + trickNumber() + ' of ' + handSize() +
        ' — ' + (amSittingOut() ? 'you are sitting out this hand.'
          : isHumanTurn() ? 'your turn to play.' : seatName(state.turn) + ' to play.');
    } else if (state.phase === 'handOver') {
      s = 'Hand ' + state.handNumber + ' complete. ' +
        'Score ' + state.scores[mySide()] + ' to ' + state.scores[1 - mySide()] + '.';
    } else {
      s = '';
    }
    el.status.textContent = s;
  }

  /* What the action area should be showing. Rebuilding it every render destroys
   * and recreates the Continue button on each step of manual pacing, which
   * throws focus onto a brand new element and makes the screen reader announce
   * "Continue button" after every single play. If nothing has changed, leave the
   * DOM alone.
   *
   * Deliberately NOT keyed on `bidAlone`: the go-alone toggle rewrites the
   * labels of the buttons beside it in place. Rebuilding on a checkbox change
   * would move focus off the checkbox the player had just ticked. */
  function actionsKey() {
    if (state.phase === 'handOver') {
      return 'over:' + (state.result ? state.result.label : '') + ':' + state.gameOver;
    }
    /* Waiting, never Continue, when the table is somebody else's to advance.
     * Offering Continue online would put a button on screen that cannot do
     * anything, which is worse than no button: a player who cannot see it greyed
     * out has no way to tell it apart from one that works. */
    if (!isHumanTurn()) {
      if (!SH.Table.isLocal()) return 'waiting';
      return settings.pace === 0 ? 'waiting' : 'continue';
    }
    if (state.phase === 'bid1') return 'bid1';
    if (state.phase === 'bid2') return 'bid2';
    if (state.phase === 'discard') return 'discard:' + (selected || '-');
    if (state.phase === 'play') {
      return 'play:' + state.trick.length + ':' +
        (state.trick.length ? C.effSuit(state.trick[0].card, state.trump) : '-');
    }
    return 'none';
  }

  /* N MUST REACH THE PRIMARY ACTION IN EVERY PHASE.
   *
   * The key looks for button[data-advance], and only buttons built with an
   * explicit shortcut carried that marker — so it worked between hands and
   * silently did nothing during the bidding, the discard, the bury. A player
   * found it in cribbage: choose two cards for the crib, press N, nothing.
   * Nothing is the worst answer, because there is no button to have failed.
   *
   * Marked here, after the actions are built, so it cannot be forgotten at any
   * of the places that make one. The marker is NOT aria-keyshortcuts: the
   * toolbar Next button advertises N once, and two elements claiming the same
   * key is ambiguous to anything listing them. */
  function markAdvance() {
    var box = el.actions;
    if (!box) return;
    if (box.querySelector('button[data-advance]')) return;
    var b = box.querySelector('button.primary') || box.querySelector('button');
    if (b) b.setAttribute('data-advance', '1');
  }

  /* Wrapped rather than a call at the bottom, because renderActions returns
   * early in most branches — the discard, the bury, the bidding all end with
   * their own return, which is exactly where the marker was missing. */
  function renderActions() {
    renderActionsInner();
    markAdvance();
  }

  function renderActionsInner() {
    var box = el.actions;

    /* The heading sits outside the rebuild guard below because it is the one
     * thing that has to keep up with each opponent's turn, and retitling a
     * heading disturbs nothing — no focus moves and nothing is announced. */
    var heading = $('action-h');
    if (heading) {
      heading.textContent =
        state.phase === 'handOver' ? 'Hand complete'
          : amSittingOut() && state.phase === 'play' ? 'Sitting out'
            : isHumanTurn() ? 'Your turn'
              : 'Waiting for ' + seatName(G.seatToAct(state) < 0 ? state.turn : G.seatToAct(state));
    }

    var key = actionsKey();
    actionsRebuilt = key !== lastActionsKey;
    if (!actionsRebuilt) return;
    lastActionsKey = key;
    box.innerHTML = '';

    if (state.phase === 'handOver') {
      var p = document.createElement('p');
      p.className = 'hint result-headline';
      p.textContent = resultHeadline();
      box.appendChild(p);
      box.insertBefore(resultChips(), p);
      var nextNo = document.createElement('p');
      nextNo.className = 'next-step';
      nextNo.textContent = state.gameOver
        ? 'Next: a new game, from nothing to nothing.'
        : 'Next: deal hand ' + (state.handNumber + 1) + '.';
      box.appendChild(nextNo);
      box.appendChild(button(state.gameOver ? 'Start a new game' : 'Deal next hand',
        dealNext, true, 'N'));
      return;
    }

    if (!isHumanTurn()) {
      if (!SH.Table.isLocal()) {
        var wo = document.createElement('p');
        wo.className = 'hint';
        var onMove = G.seatToAct(state);
        wo.textContent = 'Waiting for ' + (onMove >= 0 ? seatName(onMove) : 'the table') + '…';
        box.appendChild(wo);
        return;
      }
      if (settings.pace === 0) {
        var w = document.createElement('p');
        w.className = 'hint';
        w.textContent = 'Waiting…';
        box.appendChild(w);
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

    if (state.phase === 'bid1') { buildBid1(box); return; }
    if (state.phase === 'bid2') { buildBid2(box); return; }
    if (state.phase === 'discard') { buildDiscard(box); return; }

    if (state.phase === 'play') {
      var hint = document.createElement('p');
      hint.className = 'hint';
      if (!state.trick.length) {
        hint.textContent = 'Lead any card from your hand. ' + suitWord(state.trump) + ' are trump.';
      } else {
        var led = C.effSuit(state.trick[0].card, state.trump);
        hint.textContent = led === state.trump
          ? 'Trump was led. Follow with trump if you have any — including the left bower, the Jack of ' +
            suitWord(C.SAME_COLOUR[state.trump]) + '.'
          : 'Follow ' + suitWord(led).toLowerCase() + ' if you can.';
      }
      box.appendChild(hint);
    }
  }

  /* The "and go alone" toggle.
   *
   * A real checkbox rather than a pair of buttons for every suit, because six
   * "Name Clubs" / "Name Clubs and go alone" buttons is a lot to tab through to
   * find the one you want. The cost of a toggle is that it changes what the
   * buttons beside it MEAN, and a control whose meaning is invisible is exactly
   * the sort of thing this game exists not to do — so the buttons rewrite their
   * own labels the moment it changes, and always say the whole truth. */
  function aloneToggle(box, relabel) {
    if (state.config.allowAlone === false) return;
    var wrap = document.createElement('p');
    wrap.className = 'field checkbox';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'bid-alone';
    cb.checked = bidAlone;
    var lab = document.createElement('label');
    lab.setAttribute('for', 'bid-alone');
    lab.textContent = 'Play this hand alone — your partner sits out, and it is worth four points ' +
      'only if you take all five tricks';
    cb.addEventListener('change', function () {
      bidAlone = cb.checked;
      relabel();
      alert_(bidAlone
        ? 'Going alone. ' + seatName(G.partnerOf(mySeat)) + ' would sit this hand out.'
        : 'Playing with your partner.');
    });
    wrap.appendChild(cb);
    wrap.appendChild(lab);
    box.appendChild(wrap);
  }

  function buildBid1(box) {
    var suit = state.upcard.s;
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'The upcard is the ' + C.name(state.upcard) + '. Ordering it up makes ' +
      suitWord(suit).toLowerCase() + ' trump and gives that card to ' +
      (state.dealer === mySeat ? 'you, and you put one back'
        : seatName(state.dealer) + ', who is dealing') + '.';
    box.appendChild(hint);

    var orderBtn = button('', function () {
      var r = SH.Table.act({ type: 'order', alone: bidAlone });
      if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
      bidAlone = false;
      afterOwnMove();
    }, true);
    var passBtn = button('Pass', function () {
      var r = SH.Table.act({ type: 'pass' });
      if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
      afterOwnMove();
    });

    /* The button says the whole truth, including the part the checkbox above it
     * is responsible for. A control whose meaning is set somewhere else and not
     * repeated is a control you have to remember the state of. */
    function relabel() {
      orderBtn.textContent = (state.dealer === mySeat ? 'Take it up' : 'Order it up') +
        ' — ' + suitWord(suit).toLowerCase() + ' become trump' +
        (bidAlone ? ', and go alone' : '');
    }
    relabel();

    aloneToggle(box, relabel);
    box.appendChild(orderBtn);
    box.appendChild(passBtn);
  }

  function buildBid2(box) {
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'The ' + C.name(state.upcard) + ' was turned down, so ' +
      suitWord(state.deniedSuit).toLowerCase() + ' cannot be named this hand.';
    box.appendChild(hint);

    var buttons = [];
    function relabel() {
      buttons.forEach(function (b) {
        b.el.textContent = 'Name ' + suitWord(b.suit).toLowerCase() +
          (bidAlone ? ' and go alone' : '');
      });
    }
    aloneToggle(box, relabel);

    C.SUITS.forEach(function (s) {
      if (s === state.deniedSuit) return;
      var b = button('Name ' + suitWord(s).toLowerCase(), function () {
        var r = SH.Table.act({ type: 'call', suit: s, alone: bidAlone });
        if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
        bidAlone = false;
        afterOwnMove();
      }, true);
      buttons.push({ el: b, suit: s });
      box.appendChild(b);
    });
    relabel();

    var forced = state.dealer === mySeat && state.config.stickTheDealer;
    if (forced) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Everybody has passed and stick the dealer is on, so you must name a ' +
        'suit. There is no Pass.';
      box.appendChild(note);
    } else {
      box.appendChild(button('Pass', function () {
        var r = SH.Table.act({ type: 'pass' });
        if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
        afterOwnMove();
      }));
    }
  }

  function buildDiscard(box) {
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'You have six cards. Choose one to put back face down — nobody else will ' +
      'see which. The card you took is at the front of your hand and is marked.';
    box.appendChild(hint);

    var b = button(selected
      ? 'Put back the ' + C.name(C.get(selected))
      : 'Put back the selected card', doDiscard, true);
    b.disabled = !selected;
    box.appendChild(b);
    var clr = button('Clear selection', function () {
      selected = null; render(); alert_('Selection cleared.');
    });
    clr.disabled = !selected;
    box.appendChild(clr);
  }

  /* After this browser makes a move. Offline the engine has already answered, so
   * this renders the result; online the move is only a request and the view that
   * contains it will arrive later — refresh() simply re-reads whatever is
   * current, which is the pre-move state, and that is correct. Optimistic
   * updates are forbidden. */
  function afterOwnMove() {
    handFocus = 0;
    refresh();
    drain();
    tick();
  }

  /* One sentence: who won and how. The chips beside it carry the numbers. */
  function resultHeadline() {
    var r = state.result;
    if (!r) return '';
    if (r.thrownIn) {
      return 'Everybody passed twice, so the hand was thrown in. Nobody scored.';
    }
    var makerSide = G.teamOf(r.maker);
    var whoMade = r.maker === mySeat ? 'You' : seatName(r.maker);
    var head = whoMade + ' made ' + suitWord(r.trump).toLowerCase() +
      (r.alone ? ', alone' : '') + ' and took ' + countWord(r.made, 'trick', 'tricks') + '. ';
    if (r.euchred) {
      return head + (makerSide === mySide()
        ? 'You were euchred — two points against you.'
        : 'Euchred — two points to you.');
    }
    /* Capitalised, because countWord spells numbers out in words and this one
     * starts a sentence. "took five tricks. two points to you." is what a screen
     * reader is given if it does not, and some voices read a lower case start as
     * a continuation of the previous clause. */
    return head + cap(makerSide === mySide()
      ? countWord(r.deltas[mySide()], 'point', 'points') + ' to you.'
      : countWord(r.deltas[1 - mySide()], 'point', 'points') + ' to them.');
  }

  /* The result as a few scannable facts. Decorative: the headline beside it says
   * all of it in prose, so this is aria-hidden rather than making a screen
   * reader hear everything twice. */
  function resultChips() {
    var wrap = document.createElement('div');
    wrap.className = 'chips';
    wrap.setAttribute('aria-hidden', 'true');
    var r = state.result;
    if (!r) return wrap;

    function chip(label, value, cls) {
      var c = document.createElement('span');
      c.className = 'chip' + (cls ? ' ' + cls : '');
      c.appendChild(span('chip-label', label));
      c.appendChild(span('chip-value', value));
      wrap.appendChild(c);
    }

    var mine = r.deltas[mySide()];
    var theirs = r.deltas[1 - mySide()];
    chip('You', mine ? '+' + mine : '0', mine ? 'chip-good' : theirs ? 'chip-bad' : '');
    chip('Them', theirs ? '+' + theirs : '0', theirs ? 'chip-bad' : '');
    if (!r.thrownIn) {
      chip('Trump', suitWord(r.trump));
      chip('Maker', seatName(r.maker) + (r.alone ? ', alone' : ''));
      chip('Tricks', r.made + ' of ' + handSize());
    }
    chip('Game', state.scores[mySide()] + ' – ' + state.scores[1 - mySide()]);
    return wrap;
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

  /* The roles a seat may be shown as. One place, so the table, the decorative
   * seats and the spoken play order can never drift apart. */
  function roleTags(i) {
    var roles = [];
    if (i === state.dealer) roles.push('dealer');
    if (i === state.maker) roles.push(state.alone ? 'maker, alone' : 'maker');
    if (i === state.sittingOut) roles.push('sitting out');
    if (i === G.partnerOf(mySeat)) roles.push('your partner');
    return roles;
  }

  function roleSuffix(i) {
    var r = roleTags(i);
    return r.length ? ', ' + r.join(', ') : '';
  }

  function seatName(i) {
    if (i < 0 || !state.players[i]) return 'the table';
    return state.players[i].name;
  }

  /* Why a card cannot be activated right now. Never says "not your turn" when it
   * IS your turn — while deciding on a bid the cards are for review, which is a
   * different thing entirely and worth saying accurately. */
  function idleReason() {
    if (state.phase === 'bid1' || state.phase === 'bid2') {
      return isHumanTurn()
        ? 'for review while you decide your bid'
        : 'for review, ' + seatName(state.turn) + ' is bidding';
    }
    if (state.phase === 'discard') {
      return state.dealer === mySeat
        ? 'for review while you choose what to put back'
        : 'for review, ' + seatName(state.dealer) + ' is putting a card back';
    }
    if (state.phase === 'handOver') return 'the hand is over';
    if (state.phase === 'play') {
      if (amSittingOut()) return 'you are sitting out while ' + seatName(state.maker) + ' plays alone';
      return 'not your turn, ' + seatName(state.turn) + ' is to play';
    }
    return 'not playable right now';
  }

  /* What was face down, once the hand is over. "The dealer buried a card" tells a
   * player nothing; the card itself tells them everything. */
  function renderDeal() {
    var sec = el['deal-section'];
    if (!sec) return;
    if (state.phase !== 'handOver' || !state.dealt) { sec.hidden = true; return; }

    var up = C.get(state.dealt.upcard);
    var note;
    if (state.result && state.result.thrownIn) {
      note = 'Nobody took the ' + C.name(up) + ' and nobody named a suit, so the hand was thrown in.';
    } else if (state.upcardStatus === 'turnedDown') {
      note = 'The ' + C.name(up) + ' was turned down, so ' +
        suitWord(up.s).toLowerCase() + ' could not be named. ' +
        seatName(state.maker) + ' named ' + suitWord(state.trump).toLowerCase() + ' instead.';
    } else {
      note = seatName(state.dealer) + ' took the ' + C.name(up) + ' and put back the ' +
        (state.discard ? C.name(state.discard) : 'card shown') + '.';
    }
    el['deal-note'].textContent = note;

    var box = el['deal-cards'];
    box.innerHTML = '';
    addRevealRow(box, 'Upcard', [up]);
    if (state.discard) addRevealRow(box, 'Put back', [state.discard]);
    addRevealRow(box, 'Kitty', state.kitty);
    sec.hidden = false;
  }

  function addRevealRow(box, label, cards) {
    var wrap = document.createElement('div');
    wrap.className = 'reveal-row';
    var h = document.createElement('span');
    h.className = 'reveal-label';
    h.textContent = label + ':';
    wrap.appendChild(h);
    if (!cards || !cards.length) {
      var none = document.createElement('span');
      none.className = 'hint';
      none.textContent = 'none';
      wrap.appendChild(none);
    }
    (cards || []).forEach(function (c) {
      var b = document.createElement('span');
      b.className = cardClasses(c);
      paintCard(b, c, { tag: cardTag(c) });
      b.setAttribute('role', 'img');
      b.setAttribute('aria-label', C.describe(c, state.trump));
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  }

  /* ---------------- card faces ---------------- */

  /* Pip positions on a 3 column by 5 row grid, [col, row], following the
   * traditional layouts. Only the nine and the ten need them: everything below
   * the nine is out of a euchre deck, and the jack, queen, king and ace get a
   * court panel or a single large pip. Everything built here is decoration — it
   * is all aria-hidden, and the card's aria-label carries the real information. */
  var PIP_LAYOUT = {
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
        if (pos[1] >= 4) pip.classList.add('pip-flip');   // lower half sits upside down
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
    // The plain skin shows these two instead of the pips and indices.
    var simple = span('simple');
    simple.appendChild(span('rank', C.RANK_TEXT[c.r]));
    simple.appendChild(span('suit', C.SUIT_SYM[c.s]));
    el2.appendChild(simple);
    if (opts.position) el2.appendChild(span('pos', opts.position));
    if (opts.tag) el2.appendChild(span('tag', opts.tag));
    [].forEach.call(el2.children, function (ch) { ch.setAttribute('aria-hidden', 'true'); });
    return el2;
  }

  /* The badge printed on a card. Trump is labelled as well as tinted, and the
   * bowers are named — colour alone would be a rule that only the sighted half
   * of the audience can read, and the left bower is precisely the card whose
   * suit its own face lies about. */
  function cardTag(c) {
    var b = C.bower(c, state.trump);
    if (b === 'right') return 'right bower';
    if (b === 'left') return 'left bower';
    if (C.isTrump(c, state.trump)) return 'trump';
    return '';
  }

  function cardClasses(c) {
    var b = C.bower(c, state.trump);
    return 'card' +
      (C.isTrump(c, state.trump) ? ' trump' : '') +
      (b ? ' bower-card' : '') +
      (C.isRed(c) ? ' red' : '');
  }

  function renderHand() {
    handMode = 'idle';
    if (state.phase === 'discard' && state.dealer === mySeat) handMode = 'discard';
    else if (state.phase === 'play' && isHumanTurn()) handMode = 'play';

    /* While discarding, the card just taken sits at the front of the hand so it
     * is easy to spot — sorting here would bury it back among the others. The
     * hand sorts normally again the moment the discard is committed. */
    var raw = state.players[mySeat].hand;
    var hand;
    if (handMode === 'discard' && state.upcard) {
      var taken = raw.filter(function (c) { return c.id === state.upcard.id; });
      var rest = raw.filter(function (c) { return c.id !== state.upcard.id; });
      hand = taken.concat(C.sortHand(rest, state.trump));
    } else {
      hand = C.sortHand(raw, state.trump);
    }

    var legalIds = {};
    if (handMode === 'play') {
      G.legalPlays(state, mySeat).forEach(function (c) { legalIds[c.id] = 1; });
    }
    // Lets the stylesheet ring the cards you may play, rather than painting over
    // the ones you may not. Purely visual: the labels already say which is which.
    el.hand.classList.toggle('choosing', handMode === 'play');

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
      var justTaken = handMode === 'discard' && state.upcard && c.id === state.upcard.id;
      b.className = cardClasses(c) + (justTaken ? ' from-upcard' : '');
      b.dataset.id = c.id;
      b.dataset.index = String(i);
      b.tabIndex = i === handFocus ? 0 : -1;

      paintCard(b, c, {
        position: String(i + 1),
        tag: justTaken ? 'the upcard' : cardTag(c)
      });

      var label = C.describe(c, state.trump) + ', card ' + (i + 1) + ' of ' + hand.length;
      if (justTaken) label += ', the card you took from the top of the kitty';
      if (handMode === 'discard') {
        b.setAttribute('aria-pressed', selected === c.id ? 'true' : 'false');
        if (selected === c.id) label += ', selected to put back';
      } else if (handMode === 'play' && !legalIds[c.id]) {
        b.setAttribute('aria-disabled', 'true');
        label += ', cannot be played, ' + G.illegalReason(state, mySeat, c.id);
      } else if (handMode === 'idle') {
        b.setAttribute('aria-disabled', 'true');
        label += ', ' + idleReason();
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
    var wi = G.trickWinnerIndex(plays, state.trump);
    plays.forEach(function (t, i) {
      var li = document.createElement('li');
      if (i === wi) li.className = 'winning';
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = seatName(t.player) + (i === 0 ? ' (led)' : '');
      var mini = document.createElement('span');
      mini.className = cardClasses(t.card) + ' mini';
      paintCard(mini, t.card, {});
      mini.setAttribute('aria-hidden', 'true');
      li.appendChild(mini);
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
      sum.textContent = seatName(meta.winner) + ' took trick ' + meta.number + '.';
      node.appendChild(sum);
    }
  }

  function renderPlayers() {
    var tbody = el['players-table'].querySelector('tbody');
    tbody.innerHTML = '';
    state.players.forEach(function (p, i) {
      var tr = document.createElement('tr');
      var cls = [];
      if (i === mySeat) cls.push('you');
      if (G.seatToAct(state) === i && state.phase !== 'handOver') cls.push('turn');
      if (i === state.sittingOut) cls.push('sitting-out');
      tr.className = cls.join(' ');

      var roles = roleTags(i);
      var cells = [
        p.name + (i === mySeat ? ' (you)' : ''),
        'Seat ' + (i + 1) + ', ' + (G.teamOf(i) === mySide() ? 'with you' : 'against you'),
        roles.length ? roles.join(', ') : '—',
        i === state.sittingOut ? 'out' : String(p.hand.length),
        String(p.tricksWon)
      ];
      cells.forEach(function (txt, ci) {
        var cell = document.createElement(ci === 0 ? 'th' : 'td');
        if (ci === 0) cell.scope = 'row';
        cell.textContent = txt;
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    var cardsLeft = state.players.reduce(function (a, p, i) {
      return a + (i === state.sittingOut ? 0 : p.hand.length);
    }, 0);
    var tricks = state.players.reduce(function (a, p) { return a + p.tricksWon; }, 0);

    var tfoot = el['players-table'].querySelector('tfoot');
    tfoot.innerHTML = '';
    var tr2 = document.createElement('tr');
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = 'Total';
    tr2.appendChild(th);
    ['—', '—', String(cardsLeft), tricks + ' of ' + handSize()].forEach(function (txt) {
      var td = document.createElement('td');
      td.textContent = txt;
      tr2.appendChild(td);
    });
    /* Tricks can only exceed five if something has gone badly wrong, and a
     * wrong number that looks plausible is worse than one that shouts. */
    if (tricks > handSize()) {
      tr2.className = 'bad-total';
      tr2.title = 'Tricks total ' + tricks + ' instead of at most ' + handSize() + '.';
    }
    tfoot.appendChild(tr2);
  }

  function renderScore() {
    var tbody = el['score-table'].querySelector('tbody');
    tbody.innerHTML = '';
    var target = state.config.pointsToWin || 10;
    [mySide(), 1 - mySide()].forEach(function (t) {
      var tr = document.createElement('tr');
      if (t === mySide()) tr.className = 'you';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = sideWords(t) + (t === mySide() ? ' (you)' : '');
      tr.appendChild(th);
      [String(sideTricks(t)), state.scores[t] + ' of ' + target, String(state.gamesWon[t])]
        .forEach(function (txt) {
          var td = document.createElement('td');
          td.textContent = txt;
          tr.appendChild(td);
        });
      tbody.appendChild(tr);
    });
  }

  /* Decorative seats: fans of face-down cards, hidden from assistive technology
   * entirely, because the players table above says all of it properly. */
  function renderSeats() {
    var box = el.seats;
    if (!box) return;
    box.innerHTML = '';
    state.players.forEach(function (p, i) {
      var seat = document.createElement('div');
      seat.className = 'seat' + (G.seatToAct(state) === i ? ' seat-turn' : '');
      seat.appendChild(span('seat-name', p.name + (i === mySeat ? ' (you)' : '')));
      var roles = roleTags(i);
      seat.appendChild(span('seat-role', roles.length ? roles.join(', ') : ''));
      var fan = document.createElement('div');
      fan.className = 'seat-fan';
      var n = i === state.sittingOut ? 0 : p.hand.length;
      for (var k = 0; k < n; k++) fan.appendChild(span('back'));
      seat.appendChild(fan);
      box.appendChild(seat);
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
    if (handMode === 'discard') {
      if (selected === id) {
        selected = null;
        alert_(C.name(C.get(id)) + ' unselected.');
      } else {
        selected = id;
        alert_(C.name(C.get(id)) + ' selected to put back. Activate the Put back button to commit.');
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
      /* One move in flight at a time. Table.act refuses a second, and saying so
       * is what makes the refusal distinguishable from a dropped keypress. */
      var r = SH.Table.act({ type: 'play', card: id });
      if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
      afterOwnMove();
      return;
    }
    alert_('You cannot play a card right now: ' + idleReason() + '.');
  }

  function doDiscard() {
    if (!selected) { alert_('Choose a card to put back first.'); return; }
    var card = C.get(selected);
    var r = SH.Table.act({ type: 'discard', card: selected });
    if (r && r.ok === false) { alert_(sentence(r.reason)); return; }
    selected = null;
    handFocus = 0;
    refresh();
    speech.push('You put back the ' + C.name(card) + '.');
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
    if (anyDialogOpen()) return false;
    var a = document.activeElement;
    if (!a) return true;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return false;
    if (el.log.contains(a)) return false;
    return true;
  }

  function focusForTurn() {
    if (!mayTakeFocus()) return;
    /* Bidding and discarding are decided with the buttons, not with the cards,
     * so that is where focus belongs. Playing is decided with the cards. */
    if (state.phase === 'bid1' || state.phase === 'bid2') {
      var b = el.actions.querySelector('button');
      if (b) b.focus();
      return;
    }
    focusCard(handFocus);
  }

  /* Only claim focus when the action area has actually changed. Otherwise
   * stepping through manual pacing would re-focus the same button over and over
   * and announce it every time. */
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
      case 'Home':
        e.preventDefault(); focusCard(0); break;
      case 'End':
        e.preventDefault(); focusCard(cards.length - 1); break;
    }
  }

  function onGlobalKeys(e) {
    /* THE HELP KEY COMES BEFORE THE GUARD, and the ordering is the point.
     *
     * Everything below needs a game in progress. The accessibility hints do
     * not — they are wanted most by somebody who has just arrived at the start
     * screen and is deciding whether this can be played by keyboard at all.
     * Behind the guard, ? did nothing there. Silently, which reads as "no". */
    if (e.key === '?' && !anyDialogOpen()) { e.preventDefault(); openA11y(); return; }

    if (!state || el['game-section'].hidden) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (anyDialogOpen()) return;

    // Digits play a card, so they must not fire while reading back the log.
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

    // N advances: Continue in manual pacing, or Deal next hand. Like the number
    // keys it is an action rather than a review, so it is ignored inside the log
    // where the player is reading rather than driving.
    if (k === 'n' && !el.log.contains(t)) {
      var adv = el.actions.querySelector('button[data-advance]');
      if (adv) { e.preventDefault(); adv.click(); }
      return;
    }
    if (k === 'g') { e.preventDefault(); focusLogEntry(0); return; }
    if (k === 'e') { e.preventDefault(); openExport(); return; }
    if (k === 'b') { e.preventDefault(); openBug(); return; }

    var map = {
      h: 'hand', t: 'trick', l: 'last', s: 'score',
      p: 'bidding', c: 'count', o: 'order', w: 'who', r: 'repeat'
    };
    if (map[k]) { e.preventDefault(); say(map[k]); return; }
    if (e.key === '?') { e.preventDefault(); openA11y(); }
  }

  /* ---------------- export ---------------- */

  function buildTranscript() {
    var lines = [].map.call(el.log.children, function (li) { return li.textContent; });
    var head = 'Exported: ' + new Date().toString() + '\n';
    return local ? head + G.transcript(local, mySeat, lines)
      : head + onlineTranscript(lines);
  }

  /* Online the full history lives on the server and is deliberately not sent —
   * it grows without bound and the client needs it in exactly two places. So
   * what can be written here is what this seat has been told, and it says so
   * rather than presenting a partial log as a complete one. */
  function onlineTranscript(lines) {
    var L = ['Euchre — online table ' + (lobby.code || '?') + ', seat ' + (mySeat + 1)];
    L.push('Players: ' + state.players.map(function (p, i) {
      return (i + 1) + ' ' + p.name + (i === mySeat ? ' (you)' : '');
    }).join(', '));
    L.push('Score: ' + sideWords(0) + ' ' + state.scores[0] + ', ' +
      sideWords(1) + ' ' + state.scores[1] + '. Hands played: ' + state.handsPlayed + '.');
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
    return 'euchre-log-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
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
        box.focus();
        box.select();
        document.execCommand('copy');
        alert_(what + ' copied to the clipboard.');
      } catch (e) {
        alert_('Copying failed. The text is selected, so Control C will copy it.');
      }
    }
  }

  function copyExport() { copyText(el['export-text'].value, el['export-text'], 'Game log'); }

  /* ---------------- dialogs ---------------- */

  var dialogReturn = null;

  function openDialog(dlg) {
    dialogReturn = document.activeElement;
    dlg.showModal();
  }

  function closeDialog(dlg) { dlg.close(); }

  function restoreDialogFocus() {
    /* Only if nothing else has already claimed focus. A dialog that hands focus
     * back to a button that has since been rebuilt would put it on a detached
     * node, which lands on <body>. */
    if (anyDialogOpen()) return;
    if (dialogReturn && document.contains(dialogReturn)) {
      try { dialogReturn.focus(); } catch (e) { /* gone */ }
    }
    dialogReturn = null;
  }

  /* Move from one help screen to the other without the return focus bouncing off
   * the page in between. */
  function switchDialog(fromId, toId) {
    var keep = dialogReturn;
    el[fromId].close();
    el[toId].showModal();
    dialogReturn = keep;
  }

  /* ---------------- bug reports ---------------- */

  var BUG_REPO = 'kellylford/TheWorkBench';
  var GAME_URL = 'https://kellylford.github.io/TheWorkBench/euchre/';
  var MAX_URL = 6000;

  function bugTitle() {
    var t = (el['bug-title'].value || '').trim();
    return '[euchre] ' + (t || 'Something went wrong');
  }

  function bugSummary() {
    var L = [];
    L.push('Game: Euchre (' + GAME_URL + ')');
    L.push('When: ' + new Date().toString());
    L.push('Browser: ' + navigator.userAgent);
    if (state) {
      L.push('Mode: ' + (SH.Table.isLocal() ? 'against the computer'
        : 'online table ' + (lobby.code || '?') + ', seat ' + (mySeat + 1)));
      L.push('Rules: to ' + (state.config.pointsToWin || 10) +
        ', stick the dealer ' + (state.config.stickTheDealer ? 'on' : 'off') +
        ', going alone ' + (state.config.allowAlone === false ? 'off' : 'on') +
        ', ' + (state.config.difficulty || 'normal') + ' opponents');
      L.push('Position: hand ' + state.handNumber + ', phase ' + state.phase +
        ', trump ' + (state.trump ? C.SUIT_NAME[state.trump] : 'not yet decided') +
        ', score ' + state.scores.join('-'));
      var failed = state.handsFailingAudit;
      L.push('Accounting check: ' + (failed
        ? '*** ' + failed + ' hand(s) FAILED ***'
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
     * which is why the whole report goes on the clipboard instead and the button
     * says so. */
    var body = '## What went wrong\n' + ((el['bug-what'].value || '').trim() || '(see pasted report)') +
      '\n\n## Setup\n```\n' + bugSummary() + '\n```\n\n' +
      '_The full game log is on the clipboard — paste it below this line._\n';
    var url = 'https://github.com/' + BUG_REPO + '/issues/new?title=' +
      encodeURIComponent(bugTitle()) + '&body=' + encodeURIComponent(body);
    return url.length > MAX_URL ? url.slice(0, MAX_URL) : url;
  }

  function refreshBugPreview() {
    el['bug-preview'].value = buildBugReport();
  }

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
    ['opt-points', 'opt-stick', 'opt-alone-rule', 'opt-difficulty'].forEach(function (id) {
      var node = $(id);
      if (!node) return;
      node.disabled = online;
    });
    var note = $('settings-online-note');
    if (note) note.hidden = !online;
  }

  function openSettings() {
    applyOnlineSettingLocks();
    openDialog(el['settings-dialog']);
    $('opt-points').focus();
  }

  function onSettingChanged() {
    settings = readForm();
    saveSettings();
    applySkin();
    if (state) {
      /* Pace, speech and appearance take effect immediately; the rules were
       * copied into the game at the last hand boundary and will be again at the
       * next one. Re-rendering here keeps the labels and the hand in step with
       * a skin change without touching the game. */
      lastActionsKey = null;
      render();
    }
  }

  function resetSettings() {
    applyToForm(DEFAULTS);
    onSettingChanged();
    announceRequested('Settings reset to the defaults. ' + el['settings-summary'].textContent);
  }

  /* The rules live on the page now, so this moves to them rather than
   * opening a modal. A modal has no address; the landing page needed one. */
  function openRules() { goToSection('rules-h'); }

  /* Move to a section of this page and start reading there.
   *
   * Focus goes to the heading itself, with tabindex -1 so it can take focus
   * without joining the tab order — which is what a screen reader needs in
   * order to begin reading from that point rather than announcing a jump and
   * leaving the reader where they were. */
  function goToSection(id) {
    var h = document.getElementById(id);
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.focus();
    if (h.scrollIntoView) h.scrollIntoView({ block: 'start' });
    announceRequested(h.textContent || '');
  }

  function openA11y() { openDialog(el['a11y-dialog']); }

  SH.UI = {
    init: init,
    /* Exposed for tests/ui-dom.js and tests/announcements.js, which drive the
     * real page. Nothing in the game uses these. */
    _test: {
      say: say,
      announce: announce,
      announceRequested: announceRequested,
      alert_: alert_,
      resetSpeech: resetSpeech,
      lastSpoken: function () { return lastSpoken; },
      SETTLE: SETTLE,
      HOLD: HOLD,
      textHand: function () { return textHand(); },
      textBidding: function () { return textBidding(); },
      textCount: function () { return textCount(); },
      textOrder: function () { return textOrder(); },
      textScores: function () { return textScores(); },
      textWho: function () { return textWho(); },
      view: function () { return state; },
      seat: function () { return mySeat; },
      settings: function () { return settings; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

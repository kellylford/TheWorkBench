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
  /* Bumping this key retires everyone's saved settings, so a change of default
   * actually reaches people who have played before instead of only new players.
   * v2: default pace moved from fast to relaxed.
   * v3: pace became real seconds. The old 400 and 900 millisecond values are not
   *     options any more, so a stored one would leave the select with no matching
   *     option at all — the bump is doing real work here, not just a default.
   * v4: the default pause came down from five seconds to four. Same reasoning as
   *     v3: 5000 is no longer offered, so a stored one has to be retired. */
  /* Its own key, and this is not cosmetic. localStorage is scoped to the ORIGIN,
   * not the path — both builds live under kellylford.github.io, so inheriting
   * 'sheephead.settings.v4' would mean every setting changed here also changed in
   * the stable game, and vice versa.
   *
   * The sharp edge is below: loadSettings() calls removeItem on everything in
   * OLD_STORE_KEYS. Bumping this fork to v2 while that list still named the
   * stable game's v4 would DELETE a player's real settings the first time they
   * opened the dev build. So: nothing beginning 'sheephead.settings.' may ever
   * appear in this file again. Only keys this fork has itself retired. */
  var STORE_KEY = 'sheephead-mp.settings.v1';
  var OLD_STORE_KEYS = [];
  var DIALOGS = ['rules-dialog', 'a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'];

  function anyDialogOpen() {
    for (var i = 0; i < DIALOGS.length; i++) if (el[DIALOGS[i]].open) return true;
    return false;
  }

  /* Which seat this browser is playing. Zero offline, and it stays a variable
   * rather than a literal so that the online build has one place to set it
   * instead of thirty-five. */
  var mySeat = 0;

  var state = null;
  var settings = null;
  var timer = null;
  var speech = [];
  var lastSpoken = '';
  var handMode = 'idle';         // idle | play | bury
  var selected = {};             // card id -> true, while burying
  var handFocus = 0;
  var logFocus = 0;
  var lastActionsKey = null;
  var actionsRebuilt = false;

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ['setup-section', 'setup-form', 'game-section', 'status', 'actions', 'hand',
      'trick', 'lasttrick', 'players-table', 'log', 'announcer', 'alerts', 'blind',
      'game-h', 'export-dialog', 'export-text', 'export-summary',
      'bug-dialog', 'bug-title', 'bug-what', 'bug-include-log', 'bug-preview',
      'rules-dialog', 'a11y-dialog', 'settings-dialog', 'settings-summary'].forEach(function (id) {
        el[id] = $(id);
      });

    loadSettings();
    el['setup-form'].addEventListener('submit', onStart);
    $('setup-rules').addEventListener('click', openRules);
    $('setup-a11y').addEventListener('click', openA11y);
    $('btn-rules').addEventListener('click', openRules);
    $('btn-a11y').addEventListener('click', openA11y);
    $('rules-close').addEventListener('click', function () { closeDialog(el['rules-dialog']); });
    $('a11y-close').addEventListener('click', function () { closeDialog(el['a11y-dialog']); });
    // Each help dialog offers the other, so neither is a dead end.
    $('rules-to-a11y').addEventListener('click', function () { switchDialog('rules-dialog', 'a11y-dialog'); });
    $('a11y-to-rules').addEventListener('click', function () { switchDialog('a11y-dialog', 'rules-dialog'); });
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
    ['opt-allpass', 'opt-difficulty', 'opt-pace', 'opt-verbose', 'opt-autofocus',
      'opt-black-queens', 'opt-red-queens', 'opt-redeal-doubler', 'opt-name', 'opt-players',
      'opt-skin', 'opt-layout']
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
    });

    el.hand.addEventListener('keydown', onHandKeys);
    el.log.addEventListener('keydown', onLogKeys);
    document.addEventListener('keydown', onGlobalKeys);
  }

  /* ---------------- settings ---------------- */

  var DEFAULTS = {
    name: 'You', numPlayers: 5, allPass: 'leaster', difficulty: 'normal',
    pace: 4000, verbose: true, autofocus: true, skin: 'traditional', layout: 'one',
    blackQueenDoubler: false, redQueenDoubler: false, redealDoubler: false
  };

  /* Rules the engine must not see change part way through a hand. Everything
   * else can take effect immediately. */
  var RULE_FIELDS = ['allPass', 'difficulty', 'blackQueenDoubler', 'redQueenDoubler', 'redealDoubler'];

  function applyToForm(s) {
    $('opt-name').value = s.name;
    $('opt-players').value = String(s.numPlayers);
    $('opt-allpass').value = s.allPass;
    $('opt-difficulty').value = s.difficulty;
    $('opt-pace').value = String(s.pace);
    // A stored pace that is no longer offered leaves the select with nothing
    // selected, and readForm would then parse '' to NaN and stall the game. The
    // store key bump should prevent that; this makes sure it cannot happen.
    if (!$('opt-pace').value) $('opt-pace').value = String(DEFAULTS.pace);
    $('opt-skin').value = s.skin;
    $('opt-layout').value = s.layout;
    $('opt-verbose').checked = !!s.verbose;
    $('opt-autofocus').checked = !!s.autofocus;
    $('opt-black-queens').checked = !!s.blackQueenDoubler;
    $('opt-red-queens').checked = !!s.redQueenDoubler;
    $('opt-redeal-doubler').checked = !!s.redealDoubler;
  }

  function loadSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      // Clear out superseded versions so they do not sit around for ever.
      OLD_STORE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { stored = {}; }
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      s[k] = stored[k] === undefined ? DEFAULTS[k] : stored[k];
    });
    applyToForm(s);
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

  /* How long a pause is, said the way a person would say it. */
  var PACE_WORDS = { '4000': 'four seconds', '10000': 'ten seconds' };
  function paceWords() {
    return PACE_WORDS[String(settings.pace)] || Math.round(settings.pace / 1000) + ' seconds';
  }

  function renderSettingsSummary() {
    if (!el['settings-summary']) return;
    var f = readForm();
    var bits = [
      f.allPass === 'leaster' ? 'Leaster when all pass' : 'Redeal when all pass',
      f.difficulty + ' opponents',
      PACE_NAMES[String(f.pace)] || 'Instant pace',
      f.skin === 'plain' ? 'Plain cards' : 'Traditional cards',
      f.layout === 'two' ? 'Two column desktop' : 'One column'
    ];
    var dbl = [];
    if (f.blackQueenDoubler) dbl.push('black queens');
    if (f.redQueenDoubler) dbl.push('red queens');
    if (f.redealDoubler) dbl.push('redeal');
    bits.push(dbl.length ? 'Doublers: ' + dbl.join(', ') : 'No doublers');
    el['settings-summary'].textContent = bits.join('. ') + '.';
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
      skin: $('opt-skin').value,
      layout: $('opt-layout').value,
      pace: parseInt($('opt-pace').value, 10),
      verbose: $('opt-verbose').checked,
      autofocus: $('opt-autofocus').checked,
      blackQueenDoubler: $('opt-black-queens').checked,
      redQueenDoubler: $('opt-red-queens').checked,
      redealDoubler: $('opt-redeal-doubler').checked
    };
  }

  /* ---------------- game lifecycle ---------------- */

  function onStart(e) {
    e.preventDefault();
    settings = readForm();
    saveSettings();
    var cfg = {};
    Object.keys(settings).forEach(function (k) { cfg[k] = settings[k]; });
    state = G.createGame(cfg);
    lastActionsKey = null;
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
    lastActionsKey = null;
    // Rule changes made mid-game take effect here, at a hand boundary, never
    // part way through a hand already being scored under the old rules.
    RULE_FIELDS.forEach(function (k) { state.config[k] = settings[k]; });
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
    // Batching a run of plays into one message exists to stop them cutting each
    // other off mid-word, which is a problem at instant speed and only there.
    // Given whole seconds, each play has room to be spoken as it happens — which
    // is the entire point of asking for a pause in the first place.
    if (settings.pace > 0) flush();
    timer = setTimeout(function () {
      AI.act(state);
      drain();
      tick();
    }, settings.pace);
  }

  /* Take the next opponent play now. In manual pacing this is the only way the
   * game moves; on a timed pace it is a shortcut past a pause you did not want,
   * so the pending timer has to go or the same seat would play twice. */
  function stepOnce() {
    clearTimeout(timer);
    timer = null;
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
    if (state.phase === 'handOver') return 'Press N or Enter on Deal next hand.';
    // Manual pacing deliberately says nothing here: it would repeat after every
    // single play, which is exactly the sort of thing that wears thin fast.
    if (!isHumanTurn()) return '';
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
      case 'order': announce(textOrder()); break;
      case 'repeat': announce(lastSpoken || 'Nothing to repeat.'); break;
    }
  }

  /* Every card is read out in full, both groups the same way. An earlier version
   * shortened the non-trump cards to bare ranks under a suit heading ("Hearts:
   * Ace, Eight"), which changes the pattern half way through the sentence and
   * makes it harder to follow, not easier. */
  function textHand() {
    var hand = C.sortHand(state.players[0].hand);
    if (!hand.length) return 'Your hand is empty.';

    // Just after picking, call out what came from the blind before anything else
    // — that is the thing the picker actually needs to know right now.
    var lead = '';
    if (state.phase === 'bury' && state.picker === 0 && state.pickedUp && state.pickedUp.length) {
      lead = 'From the blind: ' + state.pickedUp.map(function (id) {
        return C.name(C.get(id));
      }).join(', ') + '. Then your hand. ';
    }

    var trump = [], fail = [];
    hand.forEach(function (c) { (C.isTrump(c) ? trump : fail).push(c); });
    var full = function (c) { return C.name(c); };

    var parts = [];
    parts.push(trump.length ? 'Trump: ' + trump.map(full).join(', ') : 'No trump');
    parts.push(fail.length ? 'Non-trump: ' + fail.map(full).join(', ') : 'No non-trump cards');

    var msg = lead + 'Your hand, ' + hand.length + (hand.length === 1 ? ' card. ' : ' cards. ') +
      parts.join('. ') + '.';
    if (settings.verbose) msg += ' Worth ' + C.sumPoints(hand) + ' points.';
    if (G.DEAL[settings.numPlayers].partner && hasPartnerCard()) {
      msg += ' You hold the Jack of Diamonds, ' + partnerCardMeaning() + '.';
    }
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
    renderSeats();
    renderBlind();
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

  /* What the action area should be showing. Rebuilding it every render destroyed
   * and recreated the Continue button on each step of manual pacing, which threw
   * focus onto a brand new element and made the screen reader announce
   * "Continue button" after every single play. If nothing has changed, leave the
   * DOM alone. */
  function actionsKey() {
    if (state.phase === 'handOver') return 'over:' + (state.result ? state.result.summary : '');
    // Deliberately not keyed on which seat is playing: every pace except instant
    // now offers a Continue button, and keying on the seat would tear it down and
    // build a new one after every single opponent play — which is how the
    // "Continue button. Continue button. Continue button." problem started.
    // The heading names the seat instead, and it updates outside this guard.
    if (!isHumanTurn()) return settings.pace === 0 ? 'waiting' : 'continue';
    if (state.phase === 'pick') return 'pick';
    if (state.phase === 'bury') return 'bury:' + Object.keys(selected).length;
    if (state.phase === 'play') {
      return 'play:' + state.trick.length + ':' +
        (state.trick.length ? C.effSuit(state.trick[0].card) : '-');
    }
    return 'none';
  }

  function renderActions() {
    var box = el.actions;

    // The heading used to read "Your turn" permanently, so a finished hand
    // announced "Hand 2 complete" under a heading claiming it was your move.
    // It sits outside the rebuild guard below because it is the one thing that
    // has to keep up with each opponent's turn, and retitling a heading disturbs
    // nothing — no focus moves and nothing is announced.
    var heading = $('action-h');
    if (heading) {
      heading.textContent =
        state.phase === 'handOver' ? 'Hand complete'
          : isHumanTurn() ? 'Your turn'
            : 'Waiting for ' + seatName(state.turn);
    }

    var key = actionsKey();
    actionsRebuilt = key !== lastActionsKey;
    if (!actionsRebuilt) return;
    lastActionsKey = key;
    box.innerHTML = '';
    var d = G.DEAL[settings.numPlayers];

    if (state.phase === 'handOver') {
      // Just the outcome here. The full accounting is announced, and sits in the
      // game log verbatim, so repeating all of it above the button only served to
      // push the button itself off the bottom of a phone screen.
      var p = document.createElement('p');
      p.className = 'hint result-headline';
      p.textContent = resultHeadline();
      box.appendChild(p);
      box.insertBefore(resultChips(), p);
      var nextNo = document.createElement('p');
      nextNo.className = 'next-step';
      nextNo.textContent = 'Next: deal hand ' + (state.handNumber + 1) + '.';
      box.appendChild(nextNo);
      box.appendChild(button('Deal next hand', dealNext, true, 'N'));
      return;
    }

    if (!isHumanTurn()) {
      if (settings.pace === 0) {
        // Nothing to offer: the opponents have already finished by the time
        // anyone could reach for a button.
        var w = document.createElement('p');
        w.className = 'hint';
        w.textContent = 'Waiting…';
        box.appendChild(w);
        return;
      }
      box.appendChild(button('Continue', stepOnce, true, 'N'));
      // Manual pacing says nothing here on purpose — the button is the whole
      // mechanism and a standing instruction beside it wears thin by the second
      // hand. On a timed pace the button does need a word, because a Continue
      // button next to a game that advances on its own is otherwise a puzzle.
      if (settings.pace > 0) {
        var note = document.createElement('p');
        note.className = 'hint';
        note.textContent = 'The next play comes on its own after ' + paceWords() +
          '. Continue takes it now.';
        box.appendChild(note);
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

  /* The result as a few scannable facts. Decorative: the summary paragraph
   * underneath says all of it in prose, so this is aria-hidden rather than
   * making a screen reader hear everything twice. */
  /* One sentence: who won and how. The chips beside it carry the numbers. */
  function resultHeadline() {
    var r = state.result;
    if (!r) return '';
    if (r.leaster) {
      return state.players[r.winners[0]].name + ' wins the leaster with the fewest points.';
    }
    // One player takes a singular verb, two take a plural, and "You" takes the
    // second person either way.
    var youAreThem = state.picker === 0 && seatName(0).toLowerCase() === 'you';
    if (state.alone) {
      return seatName(state.picker) +
        (r.pickerWins ? (youAreThem ? ' win' : ' wins') : (youAreThem ? ' lose' : ' loses')) +
        ' alone — ' + r.label + '.';
    }
    return seatName(state.picker) + ' and ' + seatName(state.partner) +
      (r.pickerWins ? ' win' : ' lose') + ' — ' + r.label + '.';
  }

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

    var mine = r.deltas[0];
    chip('You', (mine > 0 ? '+' : '') + mine, mine > 0 ? 'chip-good' : mine < 0 ? 'chip-bad' : '');
    if (state.isLeaster) {
      chip('Leaster', state.players[r.winners[0]].name + ' wins');
    } else {
      chip('Picker', seatName(state.picker));
      chip('Points', r.pickerPts + ' to ' + r.oppPts);
    }
    if (r.factor > 1) chip('Doubled', r.factor + ' times', 'chip-note');
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

  /* What holding the Jack of Diamonds means for this player right now. Only ever
   * describes their own position — never anybody else's. */
  /* The roles a seat may be shown as, from this player's point of view. The one
   * place the disclosure rule lives, so the table and the spoken order can never
   * drift apart and start revealing different things. */
  function roleTags(i) {
    var roles = [];
    if (i === state.dealer) roles.push('dealer');
    if (i === state.picker) {
      roles.push('picker');
      if (state.alone && (state.partnerRevealed || i === 0)) roles.push('alone');
    }
    if (!state.isLeaster && !state.alone && state.partner === i &&
        (state.partnerRevealed || i === 0)) roles.push('partner');
    if (state.isLeaster) roles.push('leaster');
    return roles;
  }

  function seatName(i) { return state.players[i].name; }

  /* Why a card cannot be activated right now. Never says "not your turn" when it
   * IS your turn — while deciding on the blind the cards are for review, which
   * is a different thing entirely and worth saying accurately. */
  function idleReason() {
    if (state.phase === 'pick') {
      return isHumanTurn()
        ? 'for review while you decide whether to pick'
        : 'for review, ' + seatName(state.turn) + ' is deciding whether to pick';
    }
    if (state.phase === 'bury') {
      return state.picker === 0
        ? 'for review while you choose what to bury'
        : 'for review, ' + seatName(state.picker) + ' is burying';
    }
    if (state.phase === 'handOver') return 'the hand is over';
    if (state.phase === 'play') return 'not your turn, ' + seatName(state.turn) + ' is to play';
    return 'not playable right now';
  }

  function places(k) {
    var words = ['', 'one place', 'two places', 'three places', 'four places', 'five places'];
    return words[k] || k + ' places';
  }

  /* Where everyone sits in the running order. A sighted player reads this off
   * the table; without it there is no way to know whether the picker plays
   * before or after you, which changes what it is safe to lead. */
  function textOrder() {
    if (!state) return '';
    var n = settings.numPlayers;
    var i, k, tags, line;
    var list = [];

    if (state.phase === 'pick') {
      var decided = {};
      state.pickLog.forEach(function (e) { decided[e.player] = e.action; });
      var pickStart = (state.dealer + 1) % n;
      for (k = 0; k < n; k++) {
        i = (pickStart + k) % n;
        tags = roleTags(i);
        var st = decided[i] === 'pass' ? 'passed'
          : decided[i] === 'pick' ? 'picked'
            : i === state.turn ? 'deciding now' : 'still to decide';
        list.push((k + 1) + ', ' + seatName(i) + (tags.length ? ', ' + tags.join(', ') : '') + ', ' + st);
      }
      return 'Picking order, starting to the dealer\'s left. ' + list.join('. ') + '.';
    }

    if (state.phase !== 'play' && state.phase !== 'handOver') {
      return 'Seating order: ' + state.players.map(function (p) { return p.name; }).join(', ') + '.';
    }

    var startSeat = state.trick.length ? state.trick[0].player : state.leader;
    var playedBy = {};
    state.trick.forEach(function (t) { playedBy[t.player] = t.card; });

    var youAt = -1, pickerAt = -1;
    for (k = 0; k < n; k++) {
      i = (startSeat + k) % n;
      if (i === 0) youAt = k;
      if (i === state.picker) pickerAt = k;
      tags = roleTags(i);
      line = (k + 1) + ', ' + seatName(i) + (tags.length ? ', ' + tags.join(', ') : '');
      if (state.phase === 'play') {
        line += ', ' + (playedBy[i] ? 'played ' + C.name(playedBy[i]) : 'to play');
      }
      list.push(line);
    }

    var msg = 'Play order for this trick, starting with the lead. ' + list.join('. ') + '.';

    if (youAt === 0) msg += ' You lead.';
    else if (youAt === n - 1) msg += ' You play last.';

    if (!state.isLeaster && state.picker >= 0) {
      if (state.picker === 0) {
        msg += ' You are the picker.';
      } else if (pickerAt >= 0 && youAt >= 0) {
        var delta = pickerAt - youAt;
        msg += delta > 0
          ? ' The picker plays ' + places(delta) + ' after you.'
          : ' The picker plays ' + places(-delta) + ' before you.';
      }
    }

    if (state.phase === 'play') {
      var after = [];
      for (k = youAt + 1; k < n; k++) after.push(seatName((startSeat + k) % n));
      if (youAt >= 0 && !playedBy[0]) {
        msg += after.length
          ? ' ' + after.length + (after.length === 1 ? ' player plays' : ' players play') +
            ' after you: ' + after.join(', ') + '.'
          : ' Nobody plays after you.';
      }
    }
    return msg;
  }

  function hasPartnerCard() {
    return state.players[0].hand.some(function (c) { return c.id === G.PARTNER_CARD; });
  }

  function partnerCardMeaning() {
    if (state.picker < 0) return 'the partner card';
    if (state.picker === 0) return 'the partner card, so you are playing alone';
    return 'the partner card, so you are the picker\'s partner';
  }

  /* The blind, revealed once the hand is over. Until then it is nobody's business:
   * during play this section stays hidden entirely. */
  function renderBlind() {
    var sec = $('blind-section');
    if (!sec) return;
    if (state.phase !== 'handOver' || !state.dealt) { sec.hidden = true; return; }

    var blind = state.dealt.blind.map(function (id) { return C.get(id); });
    var buried = state.buried.slice();
    var note;
    if (state.isLeaster) {
      var last = state.trickLog.length ? state.trickLog[state.trickLog.length - 1] : null;
      note = 'Nobody picked, so the blind was worth ' + C.sumPoints(blind) + ' to ' +
        (last ? state.players[last.winner].name : 'whoever took the last trick') + ' with the last trick.';
    } else {
      note = 'The blind, and what ' + state.players[state.picker].name + ' buried (' +
        C.sumPoints(buried) + ' points, counted for the picker\'s team).';
    }
    $('blind-note').textContent = note;

    var box = el.blind;
    box.innerHTML = '';
    addRevealRow(box, 'Blind', blind);
    if (!state.isLeaster) addRevealRow(box, 'Buried', buried);
    sec.hidden = false;
  }

  function addRevealRow(box, label, cards) {
    var wrap = document.createElement('div');
    wrap.className = 'reveal-row';
    var h = document.createElement('span');
    h.className = 'reveal-label';
    h.textContent = label + ':';
    wrap.appendChild(h);
    if (!cards.length) {
      var none = document.createElement('span');
      none.className = 'hint';
      none.textContent = 'none';
      wrap.appendChild(none);
    }
    cards.forEach(function (c) {
      var box = document.createElement('span');
      box.className = cardClasses(c);
      paintCard(box, c, { tag: C.isTrump(c) ? 'trump ' + C.points(c) : C.points(c) + ' pts' });
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', C.describe(c));
      wrap.appendChild(box);
    });
    box.appendChild(wrap);
  }


  /* ---------------- card faces ---------------- */

  /* Pip positions on a 3 column by 5 row grid, [col, row], following the
   * traditional layouts. Everything built here is decoration: it is all
   * aria-hidden, and the card's aria-label carries the real information. */
  var PIP_LAYOUT = {
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

  /* Corner index: rank over a small suit glyph, as on a real card. */
  function cornerIndex(c, where) {
    var idx = span('idx idx-' + where);
    idx.appendChild(span('idx-rank', C.RANK_TEXT[c.r]));
    idx.appendChild(span('idx-suit', C.SUIT_SYM[c.s]));
    return idx;
  }

  /* The middle of the card: pips for number cards, a single large pip for an
   * ace, a monogram panel for the court cards. */
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

  /* Fill a card element with its visible innards. Every piece is hidden from
   * assistive technology; the label on the element itself is what gets read. */
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

  function cardClasses(c) {
    return 'card' + (C.isTrump(c) ? ' trump' : '') + ((c.s === 'H' || c.s === 'D') ? ' red' : '');
  }

  function renderHand() {
    handMode = 'idle';
    if (state.phase === 'bury' && state.picker === 0) handMode = 'bury';
    else if (state.phase === 'play' && isHumanTurn()) handMode = 'play';

    // While burying, the engine keeps the freshly picked-up cards at the front
    // so they are easy to spot. Sorting here would undo that; the hand is sorted
    // again the moment the bury is committed.
    var hand = handMode === 'bury'
      ? state.players[0].hand.slice()
      : C.sortHand(state.players[0].hand);

    var justPicked = {};
    (state.pickedUp || []).forEach(function (id) { justPicked[id] = 1; });
    var partnerRule = G.DEAL[settings.numPlayers].partner;

    var legalIds = {};
    if (handMode === 'play') {
      G.legalPlays(state, 0).forEach(function (c) { legalIds[c.id] = 1; });
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
      var isPartnerCard = partnerRule && c.id === G.PARTNER_CARD;
      b.className = cardClasses(c) +
        (justPicked[c.id] ? ' from-blind' : '') + (isPartnerCard ? ' partner-card' : '');
      b.dataset.id = c.id;
      b.dataset.index = String(i);
      b.tabIndex = i === handFocus ? 0 : -1;

      paintCard(b, c, {
        position: String(i + 1 === 10 ? 0 : i + 1),
        tag: justPicked[c.id] ? 'from blind'
          : isPartnerCard ? 'partner'
            : C.isTrump(c) ? 'trump ' + C.points(c) : C.points(c) + ' pts'
      });

      var label = C.describe(c) + ', card ' + (i + 1) + ' of ' + hand.length;
      if (justPicked[c.id]) label += ', from the blind';
      if (isPartnerCard) label += ', ' + partnerCardMeaning();
      if (handMode === 'bury') {
        b.setAttribute('aria-pressed', selected[c.id] ? 'true' : 'false');
        label += selected[c.id] ? ', selected to bury' : '';
      } else if (handMode === 'play' && !legalIds[c.id]) {
        b.setAttribute('aria-disabled', 'true');
        label += ', cannot be played, ' + G.illegalReason(state, 0, c.id);
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
    var wi = G.trickWinnerIndex(plays);
    plays.forEach(function (t, i) {
      var li = document.createElement('li');
      if (i === wi) li.className = 'winning';
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = state.players[t.player].name + (i === 0 ? ' (led)' : '');
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
      var roles = roleTags(i);
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
    alert_('You cannot play a card right now: ' + idleReason() + '.');
  }

  function doBury() {
    var ids = Object.keys(selected);
    var d = G.DEAL[settings.numPlayers];
    if (ids.length !== d.blind) { alert_('Select exactly ' + d.blind + ' cards.'); return; }
    var pts = C.sumPoints(ids.map(function (i) { return C.get(i); }));
    if (!G.doBury(state, state.picker, ids)) { alert_('Those cards could not be buried.'); return; }
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
    if (anyDialogOpen()) return false;
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
    if (!state || el['game-section'].hidden) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (anyDialogOpen()) return;

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

    var map = { h: 'hand', t: 'trick', l: 'last', s: 'score', p: 'teams', c: 'count', o: 'order', r: 'repeat' };
    if (map[k]) { e.preventDefault(); say(map[k]); return; }
    if (e.key === '?') { e.preventDefault(); openA11y(); }
  }

  /* ---------------- export ---------------- */

  function buildTranscript() {
    var lines = [].map.call(el.log.children, function (li) { return li.textContent; });
    var head = 'Exported: ' + new Date().toString() + '\n';
    return head + G.transcript(state, mySeat, lines);
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
    return 'sheephead-mp-log-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
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

  /* Copy `text`, falling back to selecting the box it came from so the user can
   * press Control C themselves. `box` is the textarea holding the same text. */
  function copyText(text, box, what) {
    function fallback() {
      if (box) { box.focus(); box.select(); }
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      alert_(ok ? what + ' copied to the clipboard.'
        : 'Could not copy automatically. The text is selected, so press Control C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert_(what + ' copied to the clipboard.');
      }, fallback);
    } else {
      fallback();
    }
  }

  function copyExport() {
    copyText(el['export-text'].value, el['export-text'], 'Game log');
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
    if (switching) return;      // handing off to a sibling dialog, not really closing
    var back = dialogReturn;
    dialogReturn = null;
    if (back && back.isConnected !== false && document.contains(back)) back.focus();
    else if (state && !el['game-section'].hidden) focusForTurn();
  }

  /* Move from one help dialog straight to the other, keeping the element that
   * opened the first one as the eventual focus target. */
  var switching = false;

  function switchDialog(fromId, toId) {
    switching = true;
    var keep = dialogReturn;
    var from = el[fromId];
    if (typeof from.close === 'function') from.close(); else from.removeAttribute('open');
    switching = false;
    dialogReturn = keep;
    var to = el[toId];
    if (typeof to.showModal === 'function') to.showModal(); else to.setAttribute('open', '');
    var h = to.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus(); }
  }

  /* ---------------- bug reports ---------------- */

  var BUG_REPO = 'kellylford/TheWorkBench';
  var GAME_URL = 'https://kellylford.github.io/TheWorkBench/sheephead-multiplayer/';
  /* Long URLs get rejected or silently truncated, so the link carries the summary
   * only and the full log rides on the clipboard. */
  var MAX_URL = 6000;

  function bugTitle() {
    var t = (el['bug-title'].value || '').trim();
    return '[sheephead-mp] ' + (t || 'Bug report');
  }

  /* The part that goes in the URL: everything a maintainer needs to triage,
   * without the transcript. */
  function bugSummary() {
    var L = [];
    L.push('### What happened');
    L.push('');
    L.push((el['bug-what'].value || '').trim() || '_(not described)_');
    L.push('');
    L.push('### Game');
    L.push('');
    L.push('- Page: ' + GAME_URL);
    if (state) {
      var d = G.DEAL[settings.numPlayers];
      L.push('- Players: ' + settings.numPlayers + ' (' +
        state.players.map(function (p) { return p.name; }).join(', ') + ')');
      L.push('- Layout: ' + d.hand + ' cards each, ' + d.blind + ' card blind, ' +
        (d.partner ? 'Jack of Diamonds partner' : 'picker always alone'));
      L.push('- Opponent skill: ' + settings.difficulty + '; all pass: ' + settings.allPass +
        '; pace: ' + (PACE_NAMES[String(settings.pace)] || settings.pace + 'ms'));
      L.push('- Hand ' + state.handNumber + ', phase ' + state.phase +
        ', hands completed ' + state.history.length);
      var bad = state.history.filter(function (h) { return h.problems.length; });
      L.push('- Automatic check: ' + (bad.length
        ? '**' + bad.length + ' of ' + state.history.length + ' completed hands FAILED**'
        : 'all ' + state.history.length + ' completed hands add up correctly'));
      if (bad.length) {
        L.push('');
        L.push('Failures:');
        bad.slice(0, 5).forEach(function (h) {
          L.push('- Hand ' + h.handNumber + ': ' + h.problems.join(' '));
        });
      }
    } else {
      L.push('- No game in progress.');
    }
    L.push('');
    L.push('### Environment');
    L.push('');
    L.push('- Browser: ' + navigator.userAgent);
    L.push('- Window: ' + window.innerWidth + ' by ' + window.innerHeight);
    L.push('- Language: ' + (navigator.language || 'unknown'));
    L.push('- Reported: ' + new Date().toString());
    return L.join('\n');
  }

  function buildBugReport() {
    var text = bugSummary();
    if (el['bug-include-log'].checked && state) {
      var lines = [].map.call(el.log.children, function (li) { return li.textContent; });
      text += '\n\n### Game log\n\n```\n' + G.transcript(state, mySeat, lines) + '\n```\n';
    }
    return text;
  }

  function bugIssueUrl() {
    var base = 'https://github.com/' + BUG_REPO + '/issues/new';
    var title = bugTitle();
    var note = el['bug-include-log'].checked && state
      ? '\n\n### Game log\n\n_The full game log is on your clipboard. Paste it here._\n'
      : '\n';
    var body = bugSummary() + note;
    var url = base + '?labels=bug&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    if (url.length > MAX_URL) {
      // Trim the body until the whole link fits, and say so rather than silently cutting.
      var over = url.length - MAX_URL;
      body = body.slice(0, Math.max(0, body.length - over - 80)) +
        '\n\n_(summary truncated for the link; the full report is on your clipboard)_\n';
      url = base + '?labels=bug&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    }
    return url;
  }

  function refreshBugPreview() {
    el['bug-preview'].value = buildBugReport();
  }

  function openBug() {
    if (!el['bug-title'].value) {
      el['bug-title'].value = state && state.phase ? 'Problem during play' : 'Problem with the game';
    }
    refreshBugPreview();
    openDialog(el['bug-dialog']);
    el['bug-title'].focus();
    el['bug-title'].select();
    announce('Report a bug. Describe what happened, then use Copy report and open GitHub. ' +
      'Nothing is sent until you post the issue yourself.');
  }

  function bugCopyAndOpen() {
    var report = buildBugReport();
    var url = bugIssueUrl();
    // Open synchronously inside the click so the popup blocker allows it; the
    // clipboard write settles a moment later, which is fine because the user has
    // to paste it by hand anyway.
    var win = window.open(url, '_blank', 'noopener');
    copyText(report, el['bug-preview'], 'Report');
    if (!win) {
      alert_('Your browser blocked the new tab. The report is on your clipboard — ' +
        'open ' + BUG_REPO + ' issues and paste it.');
    }
  }

  /* One class on <body> switches the whole look. No markup differs between the
   * two skins, so nothing an assistive technology sees can change with it. */
  function applySkin() {
    var skin = ($('opt-skin') && $('opt-skin').value) || 'traditional';
    document.body.classList.toggle('skin-traditional', skin === 'traditional');
    document.body.classList.toggle('skin-plain', skin === 'plain');
    var layout = ($('opt-layout') && $('opt-layout').value) || 'one';
    document.body.classList.toggle('layout-two-col', layout === 'two');
  }

  /* Opponents drawn as a fan of face-down cards. Decoration only: the region is
   * aria-hidden, holds nothing focusable, and repeats what the players table
   * already says properly. */
  function renderSeats() {
    var box = $('seats');
    if (!box) return;
    box.innerHTML = '';
    if (!state || settings.skin === 'plain') { box.hidden = true; return; }
    box.hidden = false;
    for (var i = 1; i < state.players.length; i++) {
      var p = state.players[i];
      var seat = document.createElement('div');
      seat.className = 'seat' + (state.turn === i && state.phase !== 'handOver' ? ' seat-turn' : '');
      seat.appendChild(span('seat-name', p.name));
      seat.appendChild(span('seat-role', roleTags(i).join(', ')));
      var fan = span('seat-fan');
      for (var k = 0; k < p.hand.length; k++) fan.appendChild(span('back'));
      seat.appendChild(fan);
      box.appendChild(seat);
    }
  }

  function openSettings() {
    openDialog(el['settings-dialog']);
    var first = el['settings-dialog'].querySelector('select, input');
    if (first) first.focus();
  }

  /* Settings are live: pace and speech apply at once, rules at the next hand. */
  function onSettingChanged() {
    saveSettings();
    applySkin();          // presentation only, so it applies with or without a game
    if (!state) return;
    var fresh = readForm();
    ['pace', 'verbose', 'autofocus', 'skin', 'layout'].forEach(function (k) { settings[k] = fresh[k]; });
    RULE_FIELDS.forEach(function (k) { settings[k] = fresh[k]; });
    render();
  }

  function resetSettings() {
    applyToForm(DEFAULTS);
    onSettingChanged();
    alert_('Game settings reset to defaults.');
  }

  function openRules() { openDialog(el['rules-dialog']); }
  function openA11y() { openDialog(el['a11y-dialog']); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);

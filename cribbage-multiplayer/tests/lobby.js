/* Playing with other people, through the actual interface.
 *
 * tests/online.js proves the transport and the projection work. tests/room.js
 * proves the room survives eviction. Neither of them touches a single button —
 * so between them they would not notice if "Start a new table" did nothing, if
 * the table code never reached the screen, if the seat list marked the wrong row
 * as you, or if the game screen never appeared once the hand was dealt.
 *
 * Every one of those is a bug that makes multiplayer completely unusable while
 * every engine test stays green. This file clicks the buttons.
 *
 * The network is replaced with js/localserver.js — the real engine, the real
 * authorization gate, the real projection, and a faked wire. What is faked is
 * the network, and only the network.
 *
 *   npm install --no-save jsdom
 *   node tests/lobby.js
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP lobby: jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot() {
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script src="[^"]*"><\/script>/g, '')
    .replace(/<script>SH\.UI\.init\(\);<\/script>/, '');
  const dom = new JSDOM(html, {
    url: 'https://example.org/cribbage-multiplayer/', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const win = dom.window;

  /* SEEDED, for the same reason the layout suite is: a run that deals different
   * cards every time cannot assert what it covered. The counters at the bottom
   * of this file — did a bower come up, did the bidding reach round two, was an
   * unplayable card ever offered — are the whole point of it, and a counter that
   * depends on the shuffle is a counter that reports zero on the day nobody is
   * looking. The seed is chosen so the run reaches the cases it claims to.
   *
   * Set before the game scripts are evaluated, so the very first shuffle is
   * covered. */
  win.Math.random = (() => {
    let s = 20260821;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  })();
  const D = win.HTMLDialogElement;
  if (D) {
    D.prototype.showModal = function () { this.open = true; };
    D.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
  }
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js',
    'js/config.js', '../shared/js/table.js', '../shared/js/net.js', '../shared/js/localserver.js', 'js/ui.js']) {
    win.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  }
  return win;
}

function $(win, id) { return win.document.getElementById(id); }
function cards(win) { return Array.from($(win, 'hand').querySelectorAll('.card')); }
function actionButtons(win) { return Array.from($(win, 'actions').querySelectorAll('button')); }
function findBtn(win, re) { return actionButtons(win).find(b => re.test(b.textContent)); }

async function main() {
  const win = boot();
  const SH = win.SH;
  const G = SH.Game;

  /* The fake room service. Everything above the socket is the real thing. */
  let server = null;
  let lastStatus = null;
  let statusFn = null;
  const CODE = 'P4K7M';

  SH.Net.createTable = function (opts) {
    server = SH.LocalServer.create({
      /* A visible pause before the computer moves. With no delay the other
       * seat throws to the crib in the same tick we do, and the one moment
       * the game genuinely waits for two people at once is never observed. */
      config: opts.config, latency: 1, jitter: true, botDelay: 25
    });
    /* The real service does not deal on creation, and neither does this: a table
     * that starts the moment it is made leaves the host no time to read the code
     * to anybody. */
    server.start();
    return Promise.resolve(CODE);
  };
  SH.Net.connect = function (opts, onMessage, onStatus) {
    statusFn = onStatus;
    const link = server.connect(opts.seat === undefined ? null : opts.seat, onMessage);
    if (!link) {
      onStatus({ state: 'refused', detail: 'that seat is taken' });
      return { send() {}, close() {} };
    }
    onStatus({ state: 'connecting' });
    win.setTimeout(() => onStatus({ state: 'connected' }), 1);
    return {
      send: m => link.send(m),
      close: () => { link.close(); onStatus({ state: 'closed' }); }
    };
  };

  SH.UI.init();
  const T = SH.UI._test;

  /* ---- into the lobby ---- */
  $(win, 'opt-pace').value = '-1';
  $(win, 'opt-name').value = 'Kelly';
  $(win, 'setup-online').click();
  check($(win, 'lobby-section').hidden === false, 'the lobby never appeared');
  check($(win, 'lobby-choose').hidden === false, 'the lobby did not offer a way to make or join');
  check(win.document.activeElement === $(win, 'lobby-code'),
    'focus did not land on the code field, so a keyboard user has to hunt for it');

  /* ---- make a table ---- */
  $(win, 'lobby-create').click();
  await sleep(60);

  check($(win, 'lobby-table').hidden === false, 'the table screen never appeared');
  check($(win, 'lobby-code-display').textContent === CODE,
    'the table code is not on screen: ' + $(win, 'lobby-code-display').textContent);
  /* Spelled out, because "P4K7M" spoken by a screen reader is a mumble and
   * "P, 4, K, 7, M" is a code somebody can write down. */
  check($(win, 'lobby-code-read').textContent.indexOf('P, 4, K, 7, M') >= 0,
    'the code is not spelled out for reading aloud: ' + $(win, 'lobby-code-read').textContent);
  check(win.document.activeElement === $(win, 'lobby-code-display'),
    'focus did not land on the code, which is the one thing the host now needs');

  {
    const rows = Array.from($(win, 'lobby-seats').querySelectorAll('tbody tr'));
    check(rows.length === 2, 'the seat list has ' + rows.length + ' rows for a two seat game');
    const you = rows.filter(r => /\byou\b/.test(r.cells[2].textContent));
    check(you.length === 1,
      you.length + ' rows are marked as you — the seat list stopped answering the one ' +
      'question it exists to answer');
    const bots = rows.filter(r => /computer/.test(r.cells[2].textContent));
    check(bots.length === 1, 'the empty seat is not shown as played by the computer');
  }

  /* ---- and nothing is dealt until somebody says so ---- */
  check($(win, 'game-section').hidden === true,
    'the game started before anybody pressed Start — the host had no chance to send the code');
  check(T.view() === null || T.view().phase === 'idle',
    'a hand was dealt before the table was started');

  $(win, 'lobby-start').click();
  await sleep(120);

  check($(win, 'lobby-section').hidden === true, 'the lobby is still up after the game started');
  check($(win, 'game-section').hidden === false, 'the game screen never appeared');

  /* ---- the code stays on screen for the whole game ---- */
  {
    const line = $(win, 'table-code-line');
    check(line.hidden === false,
      'the table code vanished with the lobby — the host can no longer read it to anybody');
    check(line.textContent.indexOf(CODE) >= 0, 'the standing code line does not show the code');
    check((line.getAttribute('aria-label') || '').indexOf('P, 4, K, 7, M') >= 0,
      'the standing code line is not spelled out for a screen reader');
    check($(win, 'table-code-actions').hidden === false, 'there is no way to copy the code in game');
  }

  /* ---- the rules belong to the table ---- */
  {
    $(win, 'btn-settings').click();
    for (const id of ['opt-target', 'opt-difficulty']) {
      check($(win, id).disabled === true,
        id + ' is still live at an online table, so changing it would appear to do nothing');
    }
    check($(win, 'settings-online-note').hidden === false,
      'nothing explains why the rules cannot be changed at an online table');
    check($(win, 'opt-pace').disabled === false,
      'pace was locked, and pace is the one setting that is genuinely this browser\'s own');
    $(win, 'settings-close').click();
  }

  /* ---- play, from views alone ---- */
  let handsDone = 0;
  let sawWaiting = false;
  let sawDiscardWait = false;
  let guard = 0;
  const handsSeen = new Set();
  while (handsDone < 3 && guard++ < 5000) {
    await sleep(4);
    const v = T.view();
    if (!v) continue;
    const me = T.seat();

    if (v.phase === 'roundOver' || v.phase === 'gameOver') {
      const deal = findBtn(win, /Deal the next hand|Start a new game/);
      /* FOCUS MUST BE SOMEWHERE, and at a hand end it must be on the button that
       * moves the game on.
       *
       * This is a regression test for a bug an independent review found and this
       * file walked straight past twice a run: tick() returns early on the online
       * branch, so focusForTurn — not focusFirstAction — is what runs, and
       * `roundOver` was missing from its list of button phases. It fell through
       * to focusCard on a hand that had just been rebuilt with no cards, which
       * does nothing, leaving focus on the <body> the re-render had dropped it
       * to. The Deal button was on screen and unreachable except by tabbing from
       * the top of the document. It only happened online, which is why every
       * offline test was green.
       *
       * Searching for the button by its text, as this file did, cannot see that:
       * the button exists either way. The check has to be about focus. */
      if (deal) {
        const focused = win.document.activeElement;
        check(focused && focused !== win.document.body,
          'at the end of an online hand focus was left on ' +
          (focused ? focused.tagName : 'nothing') + ' — the Deal button is on screen ' +
          'and reachable only by tabbing from the top of the document');
        check(focused === deal,
          'focus at the end of an online hand is on ' +
          (focused ? focused.tagName + ' "' + (focused.textContent || '').trim().slice(0, 30) + '"' : 'nothing') +
          ' rather than the button that deals the next hand');
        handsSeen.add(v.gameNumber + ':' + v.handNumber);
        handsDone = handsSeen.size;
        deal.click();
      }
      continue;
    }

    /* Online there is nothing to continue: the room advances on its own clock.
     * A Continue button here would be inert, and a button that looks live and is
     * inert is worse than no button for somebody who cannot see it greyed out. */
    if (!T.myMove()) {
      check(!findBtn(win, /^Continue/),
        'a Continue button was offered at an online table, where it can do nothing');
      const hint = $(win, 'actions').querySelector('.hint');
      if (hint && /Waiting for /.test(hint.textContent)) sawWaiting = true;
      /* The one genuinely simultaneous moment in the game. Detected HERE and not
       * in the discard branch below: once our throw is in, myMove() is false, so
       * that branch is never reached again — which is why the first version
       * reported the case as never exercised. The interface has to say the throw
       * landed and that it is waiting, rather than looking stuck. */
      if (v.phase === 'discard' && v.players[me].hasDiscarded) {
        sawDiscardWait = true;
        check(/Waiting for/.test($(win, 'status').textContent),
          'after throwing, the interface does not say it is waiting for the other player: ' +
          $(win, 'status').textContent);
      }
      continue;
    }
    if (SH.Table.pending()) continue;

    if (v.phase === 'cutForDeal') { const b = findBtn(win, /Cut for deal/); if (b) b.click(); continue; }
    if (v.phase === 'discard') {
      const h = cards(win);
      if (h.length >= 2) { h[0].click(); cards(win)[1].click(); }
      const b = findBtn(win, /^Throw/);
      if (b && !b.disabled) b.click();
      continue;
    }
    if (v.phase === 'play') {
      const legal = G.legalPlays(v, me).map(c => c.id);
      const el = cards(win).find(x => legal.indexOf(x.dataset.id) >= 0);
      if (el) el.click();
      else { const g = findBtn(win, /Say go/); if (g) g.click(); }
      continue;
    }
    if (v.phase === 'count') { const b = findBtn(win, /Count my/); if (b) b.click(); continue; }
  }

  check(handsDone >= 3, 'only ' + handsDone + ' hands were played at the online table');
  check(sawWaiting, 'the interface never said who it was waiting for');
  check(sawDiscardWait, 'the simultaneous discard wait was never exercised');
  {
    const truth = server.peek();
    for (const h of truth.history) {
      check(h.problems.length === 0, 'the server audit failed: ' + h.problems.join('; '));
    }
    check(truth.players[SH.Table.seat()].occupant === 'human',
      'the server does not think a person is sitting in our seat');
  }

  /* ---- the connection going wrong is said out loud, and stays on screen ---- */
  {
    statusFn({ state: 'lost', detail: 'the connection closed' });
    await sleep(20);
    const line = $(win, 'net-line');
    check(line.hidden === false,
      'the table was lost and the game screen said nothing — the board would go on ' +
      'drawing a hand that had stopped being true');
    check(line.getAttribute('role') === 'status',
      'the connection notice is not announced politely');
    check(/lost/i.test(line.textContent), 'the connection notice does not say what happened');
    /* A fragment from the wire, made into a sentence. "The connection to this
     * table was lost. the connection closed" is what a screen reader is given
     * otherwise, and it says it exactly as written. */
    check(!/\. [a-z]/.test(line.textContent),
      'a detail from the wire was run on after a full stop in lower case: ' + line.textContent);
    check($(win, 'net-actions').hidden === false, 'no way back was offered after the table was lost');
    check(/computer may be playing your seat/i.test(line.textContent),
      'the player is not told the computer may be playing their seat');

    statusFn({ state: 'connected' });
    await sleep(20);
    check($(win, 'net-line').hidden === true,
      'the connection notice stayed up after the connection came back');
  }

  /* ---- a table code that does not exist ---- */
  {
    statusFn({ state: 'nosuch', detail: '' });
    await sleep(20);
    const msg = $(win, 'lobby-status').textContent;
    check(/no table with that code/i.test(msg),
      'a mistyped code was not reported as a mistyped code: ' + msg);
    check(!/connection/i.test(msg),
      'a mistyped code was reported as a network problem, which sends the player ' +
      'looking in the wrong place: ' + msg);
  }

  /* ---- leaving ---- */
  {
    $(win, 'btn-newgame').click();
    check($(win, 'setup-section').hidden === false, 'New game did not go back to the setup screen');
    check(SH.Table.isLocal(), 'the table was not left behind');
    check(T.seat() === 0,
      'the online seat number survived leaving the table, so the next single-player ' +
      'game would be dealt somebody else\'s cards');
    check($(win, 'table-code-line').hidden === true, 'the old table code is still on screen');
    check($(win, 'opt-target').disabled === false,
      'the rule controls were left disabled after leaving the online table');
  }

  console.log('lobby: ' + checks + ' assertions, ' + handsDone + ' hands at an online table');
  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('lobby: OK');
  process.exit(0);
}

main().catch(e => { console.error('lobby: threw — ' + e.stack); process.exit(1); });

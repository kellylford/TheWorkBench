/* Do all five games have the same shape?
 *
 * Every other audit in this directory asks whether ONE game is right. This one
 * asks whether the games agree with each other, which is a different question
 * and the one nobody was answering: each game passed its own suite while the set
 * of them drifted apart, and it was a player moving between them who noticed.
 *
 * What it checks, and why each of these is the kind of thing that drifts:
 *
 *   THE PACE LADDER. It used to be two ladders. Hearts and spades offered
 *   Comfortable / Brisk / Immediate / Wait at 900ms, 450ms, 0 and manual; the
 *   other three offered Instant / Four seconds / Ten seconds / Manual. Same
 *   control, different words, and DEFAULTS that differed ninefold — so a player
 *   who set a comfortable pace in one game got something nine times faster or
 *   slower in the next.
 *
 *   THE WAY IN TO THE SETTINGS. Four games showed a summary on the start screen
 *   with a button that opens a dialog. Two put the controls inline on the start
 *   screen AND kept a second copy in a dialog that had to be synced by hand.
 *
 *   THE LOG. Called "What has happened" in two games and "Game log" in three,
 *   and only two of them named the list with aria-labelledby.
 *
 *   AND HOW FAR THE LOG IS FROM THE HAND. This is the one that cannot be checked
 *   by reading the markup, because it depends on what is focusable in between.
 *   A player reported wanting the log one tab past their cards; that is only
 *   true if nothing focusable sits between them.
 *
 * The agreement it enforces is written out in shared/TEMPLATE.md, which also
 * carries the parts no test can check — why the toolbar goes above the hand,
 * when a game is allowed to take a shared key for itself, and what to do when
 * adding a sixth game.
 *
 *   node shared/tests/browser/shape.js
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, puppeteerFor } = require('./harness.js');

const GAMES = ['hearts', 'spades', 'euchre', 'cribbage-multiplayer', 'sheephead-multiplayer'];
const root = path.join(__dirname, '..', '..', '..');

const puppeteer = puppeteerFor(path.join(root, 'hearts'));
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

/* The one ladder, and the one spelling of everything around it. Written here
 * rather than read from any game, so that a game changing does not change what
 * it is being held to. */
const PACE = ['0', '900', '2500', '4000', '-1'];
const PACE_LABELS = ['Immediate', 'Brisk', 'Comfortable', 'Relaxed', 'Wait for me to continue'];
const LOG_HEADING = 'What has happened';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = [];

  for (const game of GAMES) {
    const dir = path.join(root, game);
    const { drive } = loadDrive(root, game);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      let s = 20260826;
      Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    });
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href, { waitUntil: 'load' });

    /* ---- before a game starts: the pace ladder and the way in to settings ---- */
    const setup = await page.evaluate(() => {
      const sel = document.getElementById('opt-pace');
      return {
        paceValues: sel ? [...sel.options].map(o => o.value) : null,
        paceLabels: sel ? [...sel.options].map(o => o.textContent.trim()) : null,
        paceDefault: sel ? sel.value : null,
        hasSummary: !!document.getElementById('settings-summary'),
        hasSetupButton: !!document.getElementById('setup-settings'),
        hasToolbarButton: !!document.getElementById('btn-settings'),
        hasDialog: !!document.getElementById('settings-dialog'),
        /* Controls sitting loose on the start screen rather than behind the
         * dialog. The name is expected there; nothing else is. */
        looseOnSetup: (() => {
          const form = document.getElementById('setup-form');
          if (!form) return [];
          return [...form.querySelectorAll('select, input[type=checkbox]')].map(e => e.id);
        })()
      };
    });

    check(setup.paceValues !== null, game + ': has no opt-pace control at all');
    if (setup.paceValues) {
      check(setup.paceValues.join(',') === PACE.join(','),
        game + ': pace rungs are ' + setup.paceValues.join(',') + ', not ' + PACE.join(','));
      check(setup.paceLabels.join('|') === PACE_LABELS.join('|'),
        game + ': pace labels are ' + setup.paceLabels.join(' / ') + ', not ' +
        PACE_LABELS.join(' / '));
      check(PACE.indexOf(setup.paceDefault) >= 0,
        game + ': the default pace ' + setup.paceDefault + ' is not one of the rungs');
    }

    check(setup.hasSummary, game + ': the start screen shows no settings summary');
    check(setup.hasSetupButton, game + ': the start screen has no way into the settings');
    check(setup.hasToolbarButton, game + ': there is no btn-settings in the toolbar');
    check(setup.hasDialog, game + ': there is no settings dialog');
    check(setup.looseOnSetup.length === 0,
      game + ': these controls sit loose on the start screen instead of in the ' +
      'settings dialog: ' + setup.looseOnSetup.join(', '));

    /* ---- start a game, then measure the log ---- */
    await page.evaluate(setupScript(drive, { pace: '0' }));
    await sleep(500);
    /* Some games need a nudge past a first decision before a hand is on screen. */
    for (let i = 0; i < 40; i++) {
      const done = await page.evaluate(drive.playMid);
      if (done) break;
      await sleep(60);
    }

    const log = await page.evaluate(() => {
      const h = document.getElementById('log-h');
      const list = document.getElementById('log');
      const hand = document.getElementById('hand');
      const focusable = [...document.querySelectorAll(
        'a[href], button, select, textarea, input, [tabindex]')]
        .filter(e => e.offsetParent !== null &&
          e.getAttribute('tabindex') !== '-1' &&
          !e.disabled);
      const firstCard = focusable.findIndex(e => hand && hand.contains(e));
      let lastCard = -1;
      focusable.forEach((e, i) => { if (hand && hand.contains(e)) lastCard = i; });
      const inLog = focusable.findIndex(e => list && list.contains(e));
      return {
        heading: h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : null,
        labelled: list ? list.getAttribute('aria-labelledby') : null,
        entries: list ? list.querySelectorAll('li').length : 0,
        handStops: firstCard < 0 ? 0 : (lastCard - firstCard + 1),
        /* How many tab stops sit between the last card and the log. */
        between: (lastCard >= 0 && inLog > lastCard) ? inLog - lastCard - 1 : null,
        after: lastCard >= 0 && inLog > lastCard
      };
    });

    check(log.heading !== null, game + ': there is no log heading');
    if (log.heading !== null) {
      check(log.heading.indexOf(LOG_HEADING) === 0,
        game + ': the log is headed "' + log.heading + '", not "' + LOG_HEADING + '"');
      check(/\bG\b/.test(log.heading),
        game + ': the log heading does not advertise the G shortcut: "' + log.heading + '"');
    }
    check(log.labelled === 'log-h',
      game + ': the log list is not named by its heading (aria-labelledby=' +
      log.labelled + ')');
    check(log.entries > 0, game + ': nothing reached the log, so it was not really checked');

    /* THE HAND IS ONE TAB STOP, and the log is the next thing after it.
     *
     * Both halves matter. A hand with thirteen tab stops is thirteen presses to
     * get past your own cards; a log that is not the next stop after them is a
     * log you have to go looking for. */
    check(log.handStops === 1,
      game + ': the hand holds ' + log.handStops + ' tab stops; it should be a ' +
      'single roving one');
    check(log.after, game + ': the log is not after the hand in the tab order at all');
    check(log.between === 0,
      game + ': there ' + (log.between === 1 ? 'is 1 tab stop' : 'are ' + log.between +
      ' tab stops') + ' between the hand and the log; a player asked for it to be one ' +
      'tab past their cards');

    rows.push('  ' + game.padEnd(24) +
      'pace ' + (setup.paceValues ? setup.paceValues.length : 0) + ' rungs, default ' +
      String(setup.paceDefault).padEnd(5) +
      '  log "' + String(log.heading).slice(0, 18) + '"' +
      '  hand->log gap ' + String(log.between));
    await page.close();
  }

  await browser.close();

  console.log('shape: ' + checks + ' checks across ' + GAMES.length + ' games');
  rows.forEach(r => console.log(r));

  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.error('\nFAIL (' + uniq.length + '):');
    uniq.forEach(f => console.error('  - ' + f));
    console.error('\nThese games are meant to feel like one site. A player who learns ' +
      'the pace control, the settings, or the log in one of them should not have to ' +
      'learn it again in the next.');
    process.exit(1);
  }
  console.log('\nEvery game offers the same pace ladder, the same way into its settings, ' +
    'and the same log in the same place.');
})().catch(e => { console.error('shape: threw — ' + e.stack); process.exit(1); });

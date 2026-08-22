/* The keyboard is the same keyboard in every game.
 *
 * Somebody who learns one of these games should not have to learn the keys
 * again for the next one. That was true by convention and by nothing else, so
 * it drifted: hearts shipped with five shortcuts against the other games'
 * eleven, and without N — the key that moves the game forward — at all.
 *
 * A convention nothing checks is a preference. This is the check.
 *
 * ---- what is actually required ----
 *
 * N, and the review keys the games share. NOT every key every game has: euchre
 * has O for play order because euchre has a play order, and demanding it of
 * cribbage would be demanding a game answer a question it does not have. The
 * shared set is the set a player carries between games.
 *
 * Three properties, and the second is the one that rots:
 *
 *   1. The key exists and is advertised — aria-keyshortcuts on a real control,
 *      so a screen reader can list it and a sighted player can see it.
 *   2. The key DOES something. A handler that reads a marker nothing sets is a
 *      shortcut that silently does nothing, and it looks fine in every review.
 *   3. No two controls claim the same key, because one of them silently loses.
 *
 *   node shared/tests/browser/keys.js <game-directory>
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/keys.js <game-directory>');
  process.exit(2);
}
const repo = path.join(__dirname, '..', '..', '..');
let drive, root;
try { const l = loadDrive(repo, game); drive = l.drive; root = l.dir; }
catch (e) { console.error(e.message); process.exit(2); }

const puppeteer = puppeteerFor(root);
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

/* The set a player carries from one game to the next. */
const SHARED = {
  N: 'move the game forward',
  H: 'read my hand',
  T: 'read the trick or the play',
  S: 'read the scores',
  W: 'who is at the table'
};

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    let s = 20260821;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
  await page.evaluate(setupScript(drive, {}));
  await new Promise(r => setTimeout(r, 400));

  /* ---- 1. advertised, on a real control ---- */
  const advertised = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[aria-keyshortcuts]').forEach(el => {
      const k = (el.getAttribute('aria-keyshortcuts') || '').trim().toUpperCase();
      (out[k] = out[k] || []).push(
        el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 24));
    });
    return out;
  });

  Object.keys(SHARED).forEach(k => {
    check(!!advertised[k],
      k + ' is not advertised anywhere — it should be on a control, so a screen ' +
      'reader can list it and a sighted player can see it. (' + SHARED[k] + ')');
  });

  /* ---- 2. no key claimed twice ---- */
  Object.entries(advertised).forEach(([k, who]) => {
    check(who.length === 1,
      'the ' + k + ' key is claimed by ' + who.length + ' controls (' + who.join(' and ') +
      '), so one of them silently never gets it');
  });

  /* ---- 3. N ACTUALLY MOVES THE GAME ----
   *
   * The property that rots. Every game reads a marker on its one advancing
   * button; a game whose handler reads a marker nothing sets has a shortcut that
   * does nothing at all and looks correct in any review of the code. So this
   * plays a hand to its end and presses N. */
  const finished = await pump(page, drive.playIn, { tries: 90 });
  check(finished, 'could not reach the end of a hand, so N was never tested');

  if (finished) {
    /* STRUCTURAL, not by phase name or test hook.
     *
     * The first version of this read SH.UI._test.view() and expected a phase
     * called handOver. Cribbage calls it roundOver and sheephead does not
     * expose that hook at all, so the check failed on two games for being
     * wrong about them rather than finding anything. What is actually common
     * is the button N presses and the hand it deals. */
    const marked = await page.evaluate(
      () => document.querySelectorAll('#actions button[data-advance]').length);
    check(marked === 1,
      'there are ' + marked + ' buttons marked data-advance between hands; N needs ' +
      'exactly one, and a handler reading a marker nothing sets is a shortcut that ' +
      'silently does nothing');

    if (marked === 1) {
      const before = await page.evaluate(() => ({
        cards: document.querySelectorAll('#hand .card').length,
        label: (document.querySelector('#actions button[data-advance]') || {}).textContent
      }));
      await page.keyboard.press('n');
      await new Promise(r => setTimeout(r, 900));
      const after = await page.evaluate(() => ({
        cards: document.querySelectorAll('#hand .card').length,
        advance: document.querySelectorAll('#actions button[data-advance]').length
      }));
      /* A hand was dealt: cards came back, or the advancing button went away
       * because there is nothing left to advance to. Either is movement; what
       * fails is nothing happening at all. */
      check(after.cards > before.cards || after.advance === 0,
        'pressing N did nothing — ' + before.cards + ' cards before and ' +
        after.cards + ' after, with the "' + String(before.label).trim() +
        '" button still waiting');
    }
  }

  await browser.close();

  console.log(drive.name + ': ' + checks + ' assertions');
  console.log('  advertised: ' + Object.keys(advertised).sort().join(' '));
  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    [...new Set(fails)].slice(0, 12).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('The shared keys are present, unique, and N moves the game on.');
})().catch(e => { console.error('keys: threw — ' + e.stack); process.exit(1); });

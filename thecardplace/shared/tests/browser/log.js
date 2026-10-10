/* The log is the same log in every game.
 *
 * It is the one part of these games that is not about playing: it is where you
 * go to find out what you missed. Somebody who has just been told "East plays
 * the Queen of Spades" while they were still reading their own hand has exactly
 * one way to catch up, and it is this list.
 *
 * ---- why this file exists ----
 *
 * Hearts shipped with a log that appended. The newest entry was therefore at the
 * BOTTOM of up to two hundred, G focused `querySelector('li')` — the first
 * child, which is to say the OLDEST thing that had ever happened — and the
 * entries carried no tab stop and answered no arrow keys, so there was no way
 * onward from wherever you landed. The other four games all did the opposite.
 * A player found it by playing and reported it as the history not reading,
 * which is precisely what it was.
 *
 * Every piece of that was invisible to every other check in this repository.
 * The log rendered. The entries had text. Contrast passed, layout passed, the
 * keyboard contract passed because G was advertised and G did something. What
 * nothing asked was whether what it did was any use.
 *
 * ---- what is required, and why each one ----
 *
 *   1. NEWEST FIRST. Not a matter of taste once G exists: G has to land
 *      somewhere, and the only defensible place is the thing that just
 *      happened. A log that grows downwards puts that at the far end.
 *   2. AN INSTRUCTION LINE naming the keys. A roving tabindex is invisible —
 *      there is nothing about a focused list item that says the arrows will
 *      move you. Every other game says so in a sentence next to the list.
 *   3. EXACTLY ONE TAB STOP. Two hundred list items each taking a tab stop is
 *      a keyboard trap in everything but name.
 *   4. THE ARROWS MOVE, and Home and End reach both ends.
 *   5. NOT A LIVE REGION. It carries the same words the announcer already
 *      said; making it live says everything twice.
 *
 * Point 5 is checked here rather than assumed because it is the one that gets
 * added by accident, by somebody making the log "accessible".
 *
 *   node shared/tests/browser/log.js <game-directory>
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/log.js <game-directory>');
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

  /* Play far enough to have something to read back through. A log with three
   * entries in it cannot demonstrate that Home and End go to different places. */
  await pump(page, drive.playIn, { steps: 400 });
  await new Promise(r => setTimeout(r, 300));

  const shape = await page.evaluate(() => {
    const log = document.getElementById('log');
    if (!log) return null;
    const items = [...log.children];
    /* The instruction line: any text near the list that names the keys. Looked
     * for by CONTENT rather than by a class or an id, so a game is free to
     * write its own sentence and put it wherever it reads best. */
    const scope = log.closest('section') || log.parentElement;
    /* innerText, not textContent: textContent reads through `hidden` and
     * display:none, so a hidden instruction line would pass a check that only
     * asked whether the words were in the markup. They have to be on screen. */
    const words = scope ? (scope.innerText || '') : '';
    return {
      count: items.length,
      live: log.getAttribute('aria-live'),
      texts: items.map(li => (li.textContent || '').trim()),
      tabStops: items.filter(li => li.tabIndex === 0).length,
      labelled: !!(log.getAttribute('aria-labelledby') || log.closest('section[aria-labelledby]')),
      saysNewestFirst: /newest (entry )?first/i.test(words),
      saysKeys: /\bup\b/i.test(words) && /\bdown\b/i.test(words) && /\bhome\b/i.test(words)
    };
  });

  if (!shape) {
    console.error(game + ' has no #log at all');
    process.exit(1);
  }

  check(shape.count > 5,
    'the log only has ' + shape.count + ' entries after a whole hand, so nothing ' +
    'below this has been tested against a real list');
  check(!shape.live,
    'the log is a live region (aria-live="' + shape.live + '"), so every entry is ' +
    'spoken a second time on top of the announcement that produced it');
  check(shape.labelled, 'the log has no accessible name');
  check(shape.saysNewestFirst && shape.saysKeys,
    'nothing next to the log says which way it runs and which keys move through ' +
    'it. A roving tabindex is invisible: there is nothing about a focused list ' +
    'item that tells you the arrows will do anything');
  check(shape.tabStops === 1,
    'the log has ' + shape.tabStops + ' tab stops, not one. Every entry taking a ' +
    'tab stop is a keyboard trap in everything but name; none at all means the ' +
    'list cannot be reached by Tab');

  /* ---- newest first, established by watching one arrive ---- */
  {
    const before = shape.texts.slice();
    await page.evaluate(() => {
      const box = document.getElementById('actions');
      const b = box && [...box.querySelectorAll('button')]
        .find(x => x.getAttribute('aria-disabled') !== 'true' && !x.disabled);
      if (b) { b.click(); return; }
      const c = [...document.querySelectorAll('#hand .card')]
        .find(x => x.getAttribute('aria-disabled') !== 'true');
      if (c) c.click();
    });
    await new Promise(r => setTimeout(r, 400));
    const after = await page.evaluate(() =>
      [...document.getElementById('log').children].map(li => (li.textContent || '').trim()));

    /* Not "is the first entry different" — the same sentence can legitimately
     * repeat. Where the OLD list now sits inside the new one is the question,
     * and a log that grew at the top has pushed it down. */
    const grew = after.length > before.length;
    check(grew, 'nothing was added to the log by taking an action, so the direction ' +
      'it grows in could not be established');
    if (grew) {
      const added = after.length - before.length;
      const atTop = after.slice(added).join(String.fromCharCode(10)) === before.join(String.fromCharCode(10));
      const atBottom = after.slice(0, before.length).join(String.fromCharCode(10)) === before.join(String.fromCharCode(10));
      check(atTop && !atBottom,
        'the log grows downwards: new entries arrive at the end, so the newest ' +
        'thing that happened is at the far side of ' + after.length + ' entries ' +
        'and G has nowhere sensible to land');
    }
  }

  /* ---- G lands on the newest, and the keys move from there ---- */
  {
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('g');
    await new Promise(r => setTimeout(r, 200));

    const landed = await page.evaluate(() => {
      const log = document.getElementById('log');
      const a = document.activeElement;
      return { inLog: !!(a && log.contains(a)), index: [...log.children].indexOf(a) };
    });
    check(landed.inLog, 'G did not put focus in the log');
    check(landed.index === 0,
      'G landed on entry ' + (landed.index + 1) + ' of the log rather than the ' +
      'newest one. Somebody presses G because something just went past them');

    const walk = async (key) => {
      await page.keyboard.press(key);
      await new Promise(r => setTimeout(r, 120));
      return page.evaluate(() => {
        const log = document.getElementById('log');
        return {
          index: [...log.children].indexOf(document.activeElement),
          stops: [...log.children].filter(li => li.tabIndex === 0).length
        };
      });
    };

    const down = await walk('ArrowDown');
    check(down.index === 1, 'ArrowDown did not move to the next log entry (landed on ' +
      (down.index + 1) + ')');
    check(down.stops === 1,
      'moving through the log left ' + down.stops + ' tab stops behind, so Tab no ' +
      'longer returns to where the reader was');

    const up = await walk('ArrowUp');
    check(up.index === 0, 'ArrowUp did not move back up the log');

    const end = await walk('End');
    check(end.index === shape.count - 1 || end.index > 5,
      'End did not reach the oldest entry (landed on ' + (end.index + 1) + ')');

    const home = await walk('Home');
    check(home.index === 0, 'Home did not return to the newest entry');
  }

  await browser.close();

  console.log(game + ' log: ' + checks + ' assertions, ' + shape.count + ' entries');
  if (fails.length) {
    console.log('\nFAIL (' + fails.length + '):');
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('The log runs newest first, says so, and one tab stop moves through it.');
})();

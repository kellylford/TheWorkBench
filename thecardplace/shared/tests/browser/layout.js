/* Does the page hold together at every size, and when the text is turned up?
 *
 * Real headless Chrome across six viewports at two text sizes, failing on
 * anything that makes the game unusable rather than merely ugly:
 *
 *   - a horizontal scrollbar anywhere
 *   - a card too small to read, or one that has lost its shape
 *   - a tap target under the 24px WCAG 2.2 minimum
 *   - a two-column layout whose visual order has come apart from DOM order
 *
 * THE TEXT SIZE CASE IS THE ONE THAT MATTERS. Card sizes are clamped in REM, so
 * the reader's font size always wins and the viewport only chooses within those
 * bounds. The stable Cribbage game in this repository is all px and no rem,
 * which is exactly why its layout came apart when text was scaled — a stylesheet
 * can look identical and behave completely differently here, so it is measured
 * rather than assumed.
 *
 * ---- what this file is ----
 *
 * The fourth and last of the browser audits to be shared. There were four copies
 * of it in two families: euchre and cribbage checked overflow, card size, aspect
 * and tap targets; the two sheephead builds checked all of that plus reading
 * order in the two-column desktop layout, which is invisible to any test that
 * only looks at overflow. Sharing them by taking one family would have quietly
 * dropped the other's best check, so this has BOTH, and the reading-order pass
 * simply skips a game that has no two-column layout to test.
 *
 * Hearts had no layout audit at all, which is what prompted this.
 *
 *   node shared/tests/browser/layout.js <game-directory>
 *
 * Not part of any `npm test`: it launches a browser, and on a machine where
 * somebody is listening to a screen reader that CPU spike is audible.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/layout.js <game-directory>');
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

const VIEWPORTS = [
  { name: 'phone, small', width: 320, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1600, height: 900 },
  { name: 'wide', width: 1920, height: 1080 }
];
const TEXT = [{ name: 'default', px: null }, { name: '150% text', px: 24 }];

/* SEEDED. The computer players are named at random and a long name in a table
 * cell can push a phone sideways at large text, which is how one of these suites
 * went red at random for months while nothing relevant had changed. A suite that
 * fails one run in five trains everybody to re-run it rather than read it. */
const SEED = 20260821;

const MEASURE = () => {
  const doc = document.documentElement;

  const cards = [...document.querySelectorAll('#hand .card')].map(c => {
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });

  /* LINKS COUNT, AND SO DOES THE NARROW DIMENSION. An earlier version looked at
   * `button` only and measured height only, which is why a 21px footer link
   * sailed through it — and the same class of link then turned up in four games
   * the first time this was widened. WCAG 2.2 Target Size (Minimum) is 24 by 24
   * CSS pixels and does not care what tag you used. */
  const taps = [...document.querySelectorAll('button, a, [tabindex="0"]')]
    .filter(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, what: (el.textContent || '').trim().slice(0, 40) || el.id };
    });

  /* WHAT IS ACTUALLY PUSHING THE PAGE SIDEWAYS. An element inside an ancestor
   * that scrolls or clips horizontally is contained by definition and cannot
   * widen the document — reporting the widest element instead named a table
   * inside its own scroller every single time, and sent every investigation to
   * the one place there was nothing to find. */
  const contained = e => {
    for (let p = e.parentElement; p && p !== doc; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  const culprits = [...document.querySelectorAll('body *')]
    .filter(e => e.getBoundingClientRect().right > doc.clientWidth + 1)
    .filter(e => !contained(e))
    .slice(0, 5)
    .map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
      (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''));

  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    cards,
    minTap: taps.length ? Math.min(...taps.map(t => Math.min(t.w, t.h))) : 999,
    smallestTap: taps.reduce((a, t) => (Math.min(t.w, t.h) < Math.min(a.w, a.h) ? t : a),
      taps[0] || { w: 999, h: 999, what: 'none' }),
    culprits: culprits.join(', ') || 'nothing outside a scroller'
  };
};

/* Reading order in a two-column layout. The thing that must hold is that grid
 * placement never desyncs visual order from DOM order — the only reason to use
 * grid rather than positioning, and invisible to any overflow check. */
const READING_ORDER = () => {
  const doc = document.documentElement;
  const blocks = [...document.querySelectorAll(
    '#game-section > section, #game-section > div, .layout-two-col > div')]
    .filter(e => e.offsetParent !== null);
  const domOrder = blocks.map((_, i) => i);
  const visualOrder = blocks
    .map((e, i) => ({ i, r: e.getBoundingClientRect() }))
    .sort((a, b) => (Math.round(a.r.top / 8) - Math.round(b.r.top / 8)) || (a.r.left - b.r.left))
    .map(x => x.i);
  return {
    blocks: blocks.length,
    overflow: doc.scrollWidth - doc.clientWidth,
    matches: JSON.stringify(domOrder) === JSON.stringify(visualOrder),
    dom: domOrder.join(','), vis: visualOrder.join(',')
  };
};

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = pathToFileURL(path.join(root, 'index.html')).href;
  const rows = [];

  async function fresh(width, height, fontPx) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(seed => {
      let s = seed;
      Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    }, SEED);
    await page.goto(url, { waitUntil: 'load' });
    if (fontPx) {
      await page.evaluate(px => { document.documentElement.style.fontSize = px + 'px'; }, fontPx);
    }
    return page;
  }

  for (const vp of VIEWPORTS) {
    for (const ts of TEXT) {
      const page = await fresh(vp.width, vp.height, ts.px);
      await page.evaluate(setupScript(drive, {}));
      await new Promise(r => setTimeout(r, 300));
      await pump(page, drive.playMid || drive.playIn, { tries: 40 });

      const m = await page.evaluate(MEASURE);
      const where = vp.name + ' (' + vp.width + 'px), ' + ts.name;

      check(m.scrollWidth <= m.clientWidth + 1,
        where + ': the page scrolls sideways — ' + m.scrollWidth + ' wide in ' +
        m.clientWidth + '. Pushed by ' + m.culprits);

      check(m.cards.length > 0, where + ': no cards were on screen to measure');

      for (const c of m.cards) {
        check(c.w >= 40, where + ': a card is only ' + Math.round(c.w) + 'px wide');
        const aspect = c.w / c.h;
        check(aspect > 0.6 && aspect < 0.85,
          where + ': a card has lost its shape (' + Math.round(c.w) + ' by ' +
          Math.round(c.h) + ', ratio ' + aspect.toFixed(2) + ')');
      }

      check(m.minTap >= 24,
        where + ': "' + m.smallestTap.what + '" is only ' +
        Math.round(m.smallestTap.w) + ' by ' + Math.round(m.smallestTap.h) + 'px');

      rows.push(where.padEnd(34) + ' cards ' +
        (m.cards.length ? Math.round(m.cards[0].w) + 'px' : '—').padStart(6) +
        '   smallest target ' + Math.round(m.minTap) + 'px' +
        (m.scrollWidth > m.clientWidth + 1 ? '   *** SIDEWAYS SCROLL ***' : ''));
      await page.close();
    }
  }

  /* The two-column pass, for the games that have one. A game without it is not
   * failed for not having it — but it IS said, so "nothing was checked" never
   * looks the same as "everything passed". */
  let twoColRuns = 0;
  for (const [w, h, font] of [[1280, 800, 16], [1280, 800, 24], [1920, 1080, 16], [768, 1024, 16]]) {
    const page = await fresh(w, h, font === 16 ? null : font);
    const hasControl = await page.evaluate(() => !!document.getElementById('opt-layout'));
    if (!hasControl) { await page.close(); continue; }

    await page.evaluate(() => {
      const e = document.getElementById('opt-layout');
      e.value = 'two';
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(setupScript(drive, {}));
    await new Promise(r => setTimeout(r, 400));

    const m = await page.evaluate(READING_ORDER);
    twoColRuns++;

    check(m.blocks > 1, 'two-column @' + w + 'px/' + font + ': only ' + m.blocks +
      ' block(s) on screen, so nothing about order was tested');
    check(m.overflow <= 1,
      'two-column @' + w + 'px/' + font + ': overflows by ' + m.overflow + 'px');
    check(m.matches,
      'two-column @' + w + 'px/' + font +
      ': VISUAL ORDER DIVERGED FROM DOM ORDER (dom ' + m.dom + ' vs visual ' + m.vis + ')');

    rows.push('two-column @' + w + 'px/' + font + 'px'.padEnd(10) +
      '   reading order ' + (m.matches ? 'preserved' : 'BROKEN'));
    await page.close();
  }

  await browser.close();

  console.log(drive.name + ': ' + checks + ' assertions across ' +
    (VIEWPORTS.length * TEXT.length) + ' viewport and text-size combinations');
  for (const r of rows) console.log('  ' + r);
  if (!twoColRuns) {
    console.log('  (no two-column layout in this game, so reading order was not tested)');
  }

  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\nNo horizontal overflow, cards stay legible, targets stay tappable.');
})().catch(e => { console.error('layout: threw — ' + e.stack); process.exit(1); });

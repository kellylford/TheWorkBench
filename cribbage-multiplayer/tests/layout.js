/* Does the page hold together at every size, and when the text is turned up?
 *
 * Drives real headless Chrome across six viewports, at the default text size and
 * at 150%, and fails on anything that would make the game unusable rather than
 * merely ugly:
 *
 *   - a horizontal scrollbar anywhere
 *   - a card too small to read
 *   - a card that has lost its shape
 *   - a tap target under the 24px WCAG 2.2 minimum
 *
 * THE TEXT SIZE CASE IS THE ONE THAT MATTERS. Card sizes here are
 * clamp(3.5rem, 15vw, 5rem) — the bounds are in REM, so the reader's font size
 * always wins and the viewport only chooses within those limits. The Cribbage
 * project in this same repository is all px and no rem, which is exactly why its
 * layout came apart when text was scaled. A stylesheet can look identical and
 * behave completely differently here, so it is measured rather than assumed.
 *
 * Not part of `npm test`: it launches a browser, and on a machine where somebody
 * is listening to a screen reader that CPU spike is audible. CI runs it
 * separately.
 *
 *   npm install --no-save puppeteer
 *   node tests/layout.js
 */
const fs = require('fs');
const path = require('path');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) {
  console.log('SKIP layout: puppeteer is not installed (npm install --no-save puppeteer)');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };

const VIEWPORTS = [
  { name: 'phone, small', width: 320, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet, portrait', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1600, height: 900 },
  { name: 'wide', width: 1920, height: 1080 }
];

const TEXT_SIZES = [
  { name: 'default', css: '' },
  { name: '150% text', css: '150%' }
];

/* Start a game and play far enough in that a hand is on screen with cards, the
 * pile, the board, both tables and the toolbar all rendered. An empty setup
 * screen would pass every check below and prove nothing. */
const DRIVE = `(() => {
  document.getElementById('opt-pace').value = '-1';
  document.getElementById('opt-difficulty').value = 'hard';
  /* The longest name the field will accept, every run. Seeding makes the page
   * repeatable; it does not make it the worst case. Sixteen unbroken characters
   * is the widest a name can legitimately be, and unbroken is the worst case for
   * overflow because there is nowhere to wrap. */
  document.getElementById('opt-name').value = 'Maximilianabrown';
  document.getElementById('setup-form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }));
  const T = SH.UI._test, G = SH.Game;
  const btns = () => [...document.querySelectorAll('#actions button')];
  const find = re => btns().find(b => re.test(b.textContent));
  const cards = () => [...document.querySelectorAll('#hand .card')];
  let guard = 0;
  while (guard++ < 600) {
    const v = T.view();
    if (!v) break;
    const me = T.seat();
    if (v.phase === 'play' && v.pile.length >= 2 && v.turn === me) break;
    if (v.phase === 'cutForDeal') { const b = find(/Cut for deal/); if (b) { b.click(); continue; } }
    if (v.phase === 'roundOver' || v.phase === 'gameOver') {
      const d = find(/Deal the next hand|Start a new game/); if (d) { d.click(); continue; }
    }
    if (v.phase === 'discard' && !v.players[me].hasDiscarded) {
      const h = cards(); h[0].click(); h[1].click();
      const t = find(/^Throw/); if (t && !t.disabled) { t.click(); continue; }
    }
    if (v.phase === 'count' && v.turn === me) { const c = find(/Count my/); if (c) { c.click(); continue; } }
    if (v.phase === 'play' && v.turn === me) {
      const legal = G.legalPlays(v, me).map(c => c.id);
      const el = cards().find(c => legal.includes(c.dataset.id));
      if (el) { el.click(); continue; }
      const g = find(/Say go/); if (g) { g.click(); continue; }
    }
    const cont = find(/Continue/); if (cont) { cont.click(); continue; }
    break;
  }
  return T.view() ? T.view().phase : 'none';
})()`;

const MEASURE = `(() => {
  const doc = document.documentElement;
  const cards = [...document.querySelectorAll('#hand .card')].map(c => {
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, label: c.getAttribute('aria-label') };
  });
  const taps = [...document.querySelectorAll('button, a, [tabindex="0"]')]
    .filter(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, what: (el.textContent || '').trim().slice(0, 40) || el.id };
    });
  /* Anything sticking out past the right edge, named, because "there is a
   * scrollbar" is not something you can act on. */
  const wide = [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 1)
    .slice(0, 5)
    .map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    cards,
    minTap: taps.length ? Math.min(...taps.map(t => Math.min(t.w, t.h))) : 999,
    smallestTap: taps.reduce((a, t) => (Math.min(t.w, t.h) < Math.min(a.w, a.h) ? t : a), taps[0] || { w: 999, h: 999, what: 'none' }),
    wide
  };
})()`;

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');
  const rows = [];

  for (const vp of VIEWPORTS) {
    for (const ts of TEXT_SIZES) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

      /* SEEDED, BECAUSE A LAYOUT TEST THAT MEASURES A DIFFERENT PAGE EVERY RUN
       * IS NOT A TEST. The computer players are named at random, and a long name
       * in a table cell can push a phone sideways at large text — which is how
       * the sibling sheephead suite went red at random for months while nothing
       * relevant had changed. A suite that fails one run in five trains everybody
       * to re-run it rather than read it. */
      await page.evaluateOnNewDocument(() => {
        let s = 20260821;
        Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      });
      await page.goto(url, { waitUntil: 'load' });
      if (ts.css) await page.evaluate(css => { document.documentElement.style.fontSize = css; }, ts.css);
      const phase = await page.evaluate(DRIVE);
      const m = await page.evaluate(MEASURE);
      const where = vp.name + ' (' + vp.width + 'px), ' + ts.name;

      check(phase === 'play' || phase === 'count' || phase === 'roundOver',
        where + ': the game did not get as far as the play (' + phase + ')');
      check(m.scrollWidth <= m.clientWidth + 1,
        where + ': the page scrolls sideways — ' + m.scrollWidth + ' wide in ' +
        m.clientWidth + '. Sticking out: ' + (m.wide.join(', ') || 'nothing found'));
      check(m.cards.length > 0, where + ': no cards were on screen to measure');

      for (const c of m.cards) {
        check(c.w >= 40, where + ': a card is only ' + Math.round(c.w) + 'px wide');
        const aspect = c.w / c.h;
        check(aspect > 0.6 && aspect < 0.85,
          where + ': a card has lost its shape (' + Math.round(c.w) + ' by ' +
          Math.round(c.h) + ', ratio ' + aspect.toFixed(2) + ')');
      }

      /* WCAG 2.2 target size (minimum) is 24 by 24 CSS pixels. */
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

  await browser.close();

  console.log('layout: ' + checks + ' assertions across ' +
    (VIEWPORTS.length * TEXT_SIZES.length) + ' viewport and text-size combinations');
  for (const r of rows) console.log('  ' + r);

  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('layout: OK');
})().catch(e => { console.error('layout: threw — ' + e.stack); process.exit(1); });

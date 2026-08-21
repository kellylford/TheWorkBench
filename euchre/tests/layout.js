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

/* Start a game and play far enough in that a hand is on screen with cards, a
 * trick, both tables and the toolbar all rendered. An empty setup screen would
 * pass every check below and prove nothing. */
const DRIVE = `(() => {
  document.getElementById('opt-pace').value = '-1';
  document.getElementById('opt-difficulty').value = 'hard';
  document.getElementById('setup-form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }));
  const T = SH.UI._test, G = SH.Game;
  const btns = () => [...document.querySelectorAll('#actions button')];
  const find = re => btns().find(b => re.test(b.textContent));
  const cards = () => [...document.querySelectorAll('#hand .card')];
  let guard = 0;
  while (guard++ < 400) {
    const v = T.view();
    if (!v) break;
    if (v.phase === 'play' && v.trick.length >= 2) break;
    if (v.phase === 'handOver') { const d = find(/Deal next hand|Start a new game/); if (d) d.click(); continue; }
    const me = T.seat();
    if (v.phase === 'bid1' && v.turn === me) { (find(/Order it up|Take it up/) || find(/Pass/)).click(); continue; }
    if (v.phase === 'bid2' && v.turn === me) { (find(/^Name /) || find(/Pass/)).click(); continue; }
    if (v.phase === 'discard' && v.dealer === me) { cards()[1].click(); find(/Put back/).click(); continue; }
    if (v.phase === 'play' && v.turn === me && v.sittingOut !== me) {
      const legal = G.legalPlays(v, me).map(c => c.id);
      const el = cards().find(c => legal.includes(c.dataset.id));
      if (el) { el.click(); continue; }
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
      await page.goto(url, { waitUntil: 'load' });
      if (ts.css) await page.evaluate(css => { document.documentElement.style.fontSize = css; }, ts.css);
      const phase = await page.evaluate(DRIVE);
      const m = await page.evaluate(MEASURE);
      const where = vp.name + ' (' + vp.width + 'px), ' + ts.name;

      check(phase === 'play' || phase === 'handOver',
        where + ': the game did not get as far as a played trick (' + phase + ')');
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

/* Layout safety net. jsdom does no layout, so this drives a real headless
 * browser and checks the thing that broke Cribbage: horizontal overflow and
 * unusable card sizes at small widths and at large font sizes.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
let puppeteer;
try { puppeteer = require(path.join(root, 'node_modules', 'puppeteer')); }
catch (e) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const SIZES = [
  { label: 'phone small', w: 320, h: 568 },
  { label: 'phone', w: 375, h: 812 },
  { label: 'phone large', w: 430, h: 932 },
  { label: 'tablet', w: 768, h: 1024 },
  { label: 'laptop', w: 1280, h: 800 },
  { label: 'wide', w: 1920, h: 1080 }
];
const FONTS = [16, 24];      // default, and ~150% browser text zoom

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fails = [];
  console.log('size          font  players  overflow  cardW   handRows  minTap');

  for (const size of SIZES) {
    for (const font of FONTS) {
      for (const players of [3, 5]) {
        const page = await browser.newPage();
        await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
          { waitUntil: 'load' });
        await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);

        // start a game and get into a playing state
        await page.evaluate(p => {
          document.getElementById('opt-players').value = String(p);
          document.getElementById('opt-pace').value = '0';
          document.getElementById('setup-form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }, players);
        await new Promise(r => setTimeout(r, 300));
        await page.evaluate(() => {
          for (let i = 0; i < 40; i++) {
            const bs = [...document.querySelectorAll('#actions button')];
            const pick = bs.find(b => /Pick up the blind/.test(b.textContent));
            if (pick) { pick.click(); continue; }
            const bury = bs.find(b => /^Bury /.test(b.textContent));
            if (bury) {
              const need = +bury.textContent.match(/of (\d+)/)[1];
              [...document.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
              [...document.querySelectorAll('#actions button')]
                .find(b => /^Bury /.test(b.textContent)).click();
              continue;
            }
            break;
          }
        });
        await new Promise(r => setTimeout(r, 400));

        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const cards = [...document.querySelectorAll('#hand .card')];
          const rects = cards.map(c => c.getBoundingClientRect());
          const rows = new Set(rects.map(r => Math.round(r.top))).size;
          const w = rects.length ? Math.round(rects[0].width) : 0;
          const h = rects.length ? Math.round(rects[0].height) : 0;
          // smallest interactive target anywhere on screen
          let minTap = Infinity;
          document.querySelectorAll('button:not([hidden])').forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) minTap = Math.min(minTap, Math.round(r.height));
          });
          // does anything stick out horizontally?
          let widest = 0, culprit = '';
          document.querySelectorAll('body *').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.right > widest) { widest = r.right; culprit = e.id || e.className || e.tagName; }
          });
          return {
            overflow: de.scrollWidth - de.clientWidth,
            cardW: w, cardH: h, rows,
            minTap: minTap === Infinity ? 0 : minTap,
            widest: Math.round(widest), culprit: String(culprit).slice(0, 30),
            clientW: de.clientWidth
          };
        });

        const bad = [];
        if (m.overflow > 1) bad.push('H-OVERFLOW ' + m.overflow + 'px (' + m.culprit + ')');
        if (m.cardW < 40) bad.push('card too small ' + m.cardW);
        if (m.cardW > 0 && Math.abs(m.cardH / m.cardW - 1.4) > 0.15) bad.push('card ratio ' + (m.cardH / m.cardW).toFixed(2));
        if (m.minTap && m.minTap < 24) bad.push('tap target ' + m.minTap + 'px');
        if (bad.length) fails.push(size.label + ' @' + font + 'px ' + players + 'p: ' + bad.join('; '));

        console.log(
          size.label.padEnd(13),
          String(font).padStart(4),
          String(players).padStart(8),
          String(m.overflow).padStart(9),
          String(m.cardW).padStart(6),
          String(m.rows).padStart(10),
          String(m.minTap).padStart(8),
          bad.length ? '  <-- ' + bad.join('; ') : '');
        await page.close();
      }
    }
  }
  await browser.close();

  if (fails.length) {
    console.log('\nLAYOUT PROBLEMS:');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nNo horizontal overflow, cards stay legible, targets stay tappable.');
})();

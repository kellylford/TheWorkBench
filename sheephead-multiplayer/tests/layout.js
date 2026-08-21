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
  console.log('size          font  players  setupOv  overflow  cardW   handRows  minTap');

  for (const size of SIZES) {
    for (const font of FONTS) {
      for (const players of [3, 5]) {
        const page = await browser.newPage();
        await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });

        /* SEEDED, BECAUSE A LAYOUT TEST THAT MEASURES A DIFFERENT PAGE EVERY RUN
         * IS NOT A TEST.
         *
         * The computer players are given names drawn at random from a list, and
         * some of them are long — Quartermaster is thirteen characters. On a
         * 320px phone at 150% text a long name in a table cell pushes the
         * document sideways, so this job went red roughly whenever an unlucky
         * name came up and green the rest of the time. It failed on #70 for
         * exactly that reason, with main green twenty minutes earlier and
         * nothing relevant changed in between.
         *
         * A suite that fails one run in five is worse than no suite: it trains
         * everybody to re-run it rather than read it. */
        await page.evaluateOnNewDocument(() => {
          let s = 20260821;
          Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        });
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
          { waitUntil: 'load' });
        await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);

        /* And the longest name the interface will accept, every time. Seeding
         * alone makes the run repeatable; it does not make it the worst case.
         * The field caps at sixteen characters, so sixteen unbroken characters
         * is the widest a name can legitimately be — and an unbroken token is
         * the worst case for overflow, because there is nowhere to wrap. */
        await page.evaluate(() => {
          const n = document.getElementById('opt-name');
          if (n) n.value = 'Maximilianabrown';
        });

        // Measure the SETUP screen before starting. This test used to start a
        // game first and so never looked at the first screen a player sees —
        // which was overflowing by up to 293px on a phone at large text.
        const setup = await page.evaluate(() => {
          const de = document.documentElement;
          let widest = 0, who = '';
          document.querySelectorAll('#setup-section *').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.right > widest) { widest = r.right; who = e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''); }
          });
          return { overflow: de.scrollWidth - de.clientWidth, who };
        });
        if (setup.overflow > 1) {
          fails.push(size.label + ' @' + font + 'px: SETUP SCREEN overflows by ' +
            setup.overflow + 'px (widest: ' + setup.who + ')');
        }

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
          /* Smallest interactive target anywhere on screen.
           *
           * LINKS COUNT, and so does the narrow dimension — this used to look at
           * `button` only and measure height only, which is why a 21px footer
           * link sailed through it for months while the equivalent check in
           * euchre/ and cribbage-multiplayer/ caught the same link on its first
           * run in each. WCAG 2.2 Target Size (Minimum) is 24 by 24 CSS pixels,
           * and it does not care what tag you used.
           *
           * The element is named, because "tap target 21px" is not something
           * anybody can act on. */
          let minTap = Infinity;
          let minTapWhat = '';
          document.querySelectorAll('button, a, [tabindex="0"]').forEach(el => {
            if (el.offsetParent === null) return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const smaller = Math.round(Math.min(r.width, r.height));
            if (smaller < minTap) {
              minTap = smaller;
              minTapWhat = (el.textContent || '').trim().slice(0, 32) ||
                el.id || el.tagName.toLowerCase();
            }
          });
          /* Which element actually pushes the DOCUMENT wide.
           *
           * This used to report whichever element had the largest right edge,
           * which is not the same question. The players table lives inside a
           * .table-wrap with overflow-x:auto and is legitimately wider than the
           * screen — it scrolls inside its own box. Reporting it as the culprit
           * for a 7px document overflow sent a real investigation down entirely
           * the wrong path, so: skip anything with a scrollable ancestor, and
           * only count elements that stick out past the viewport. */
          const scrolls = e => {
            for (let p = e.parentElement; p; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
            }
            return false;
          };
          let widest = 0, culprit = '';
          document.querySelectorAll('body *').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.right <= de.clientWidth + 1) return;
            if (scrolls(e)) return;
            if (r.right > widest) { widest = r.right; culprit = (e.id || e.className || e.tagName) + '@' + Math.round(r.right); }
          });
          if (!culprit) culprit = 'no element sticks out — the overflow is from a margin or a scrollbar';
          return {
            overflow: de.scrollWidth - de.clientWidth,
            cardW: w, cardH: h, rows,
            minTap: minTap === Infinity ? 0 : minTap,
            minTapWhat: minTapWhat,
            widest: Math.round(widest), culprit: String(culprit).slice(0, 30),
            clientW: de.clientWidth
          };
        });

        const bad = [];
        if (m.overflow > 1) bad.push('H-OVERFLOW ' + m.overflow + 'px (' + m.culprit + ')');
        if (m.cardW < 40) bad.push('card too small ' + m.cardW);
        if (m.cardW > 0 && Math.abs(m.cardH / m.cardW - 1.4) > 0.15) bad.push('card ratio ' + (m.cardH / m.cardW).toFixed(2));
        if (m.minTap && m.minTap < 24) {
          bad.push('tap target "' + m.minTapWhat + '" is ' + m.minTap + 'px (WCAG 2.2 wants 24)');
        }
        if (bad.length) fails.push(size.label + ' @' + font + 'px ' + players + 'p: ' + bad.join('; '));

        console.log(
          size.label.padEnd(13),
          String(font).padStart(4),
          String(players).padStart(8),
          String(setup.overflow).padStart(8),
          String(m.overflow).padStart(9),
          String(m.cardW).padStart(6),
          String(m.rows).padStart(10),
          String(m.minTap).padStart(8),
          bad.length ? '  <-- ' + bad.join('; ') : '');
        await page.close();
      }
    }
  }
  /* The optional two-column desktop layout. The thing that must hold is that
   * grid placement never desyncs visual order from DOM order — that is the only
   * reason this is grid rather than positioning, and it is invisible to any
   * test that only checks overflow. */
  for (const [w, h, font] of [[1280, 800, 16], [1280, 800, 24], [1920, 1080, 16], [768, 1024, 16]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
      { waitUntil: 'load' });
    await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);
    await page.evaluate(() => {
      const e = document.getElementById('opt-layout');
      e.value = 'two';
      e.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('opt-players').value = '5';
      document.getElementById('opt-pace').value = '0';
      document.getElementById('setup-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const blocks = [...document.querySelectorAll('#game-section > section, #game-section > div')]
        .filter(e => e.offsetParent !== null);
      const domOrder = blocks.map((_, i) => i);
      // visual order: by row (top, rounded to absorb sub-pixel), then by column
      const visualOrder = blocks
        .map((e, i) => ({ i, r: e.getBoundingClientRect() }))
        .sort((a, b) => (Math.round(a.r.top / 8) - Math.round(b.r.top / 8)) || (a.r.left - b.r.left))
        .map(x => x.i);
      return {
        overflow: de.scrollWidth - de.clientWidth,
        matches: JSON.stringify(domOrder) === JSON.stringify(visualOrder),
        dom: domOrder.join(','), vis: visualOrder.join(',')
      };
    });
    if (m.overflow > 1) fails.push('two-column @' + w + 'px/' + font + ': overflows by ' + m.overflow + 'px');
    if (!m.matches) {
      fails.push('two-column @' + w + 'px/' + font +
        ': VISUAL ORDER DIVERGED FROM DOM ORDER (dom ' + m.dom + ' vs visual ' + m.vis + ')');
    }
    console.log('two-column   ' + String(font).padStart(4) + String(w).padStart(9) +
      String(m.overflow).padStart(18) + '   reading order ' + (m.matches ? 'preserved' : 'BROKEN'));
    await page.close();
  }

  await browser.close();

  if (fails.length) {
    console.log('\nLAYOUT PROBLEMS:');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nNo horizontal overflow, cards stay legible, targets stay tappable.');
})();

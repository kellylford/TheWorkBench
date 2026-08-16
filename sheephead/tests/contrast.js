/* Text contrast audit.
 *
 * Walks every text-bearing element in a real browser, resolves the actual
 * rendered colour against whatever is actually behind it, and reports anything
 * under the WCAG AA threshold for its size. Muted grey-on-near-black is easy to
 * introduce by eye and hard to notice until somebody with low vision tries it.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
let puppeteer;
try { puppeteer = require(path.join(root, 'node_modules', 'puppeteer')); }
catch (e) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const SCENES = [
  { label: 'setup', setup: false },
  { label: 'mid hand', setup: true, play: true },
  { label: 'hand over', setup: true, play: true, finish: true }
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const failures = [];
  let measured = 0;

  /* Both colour schemes. This used to test whichever one the machine happened to
   * default to, so an entire palette went unmeasured — and CI, defaulting the
   * other way, found unreadable text in the trick area on its very first run.
   * A theme nothing measures is a theme you ship without knowing. */
  for (const scheme of ['light', 'dark']) {
  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
      { waitUntil: 'load' });
    if (scene.setup) {
      await page.evaluate(() => {
        document.getElementById('opt-players').value = '5';
        document.getElementById('opt-pace').value = '0';
        document.getElementById('setup-form')
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await new Promise(r => setTimeout(r, 300));
    }
    if (scene.finish) {
      await page.evaluate(() => {
        for (let i = 0; i < 400; i++) {
          const bs = [...document.querySelectorAll('#actions button')];
          if (bs.find(b => /Deal next hand/.test(b.textContent))) break;
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
          if (/your turn to play/i.test(document.getElementById('status').textContent)) {
            const legal = [...document.querySelectorAll('#hand .card')]
              .filter(c => c.getAttribute('aria-disabled') !== 'true');
            if (legal[0]) { legal[0].click(); continue; }
          }
          break;
        }
      });
      await new Promise(r => setTimeout(r, 600));
    }

    const results = await page.evaluate(() => {
      const lum = ([r, g, b]) => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const blend = (fg, bg) => {
        const a = fg.length > 3 ? fg[3] : 1;
        return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
      };
      // Walk up for the first non-transparent background actually painted behind.
      const bgOf = el => {
        let node = el, acc = null;
        while (node && node !== document.documentElement.parentNode) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c.length && (c.length < 4 || c[3] > 0)) {
            acc = acc ? blend(acc, c) : c;
            if ((c.length < 4 || c[3] === 1)) return acc.slice(0, 3);
          }
          node = node.parentElement;
        }
        return (acc || [0, 0, 0]).slice(0, 3);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };

      const out = [];
      document.querySelectorAll('body *').forEach(el => {
        if (el.closest('.sr-only') || el.classList.contains('sr-only')) return;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
        const text = [...el.childNodes]
          .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        if (!text) return;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const fg = blend(parse(cs.color), bgOf(el));
        const r = ratio(fg, bgOf(el));
        // WCAG AA: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        out.push({
          sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
            (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''),
          text: text.slice(0, 34), size: Math.round(size * 10) / 10,
          ratio: Math.round(r * 100) / 100, need: large ? 3 : 4.5
        });
      });
      return out;
    });

    results.forEach(r => {
      measured++;
      if (r.ratio < r.need) failures.push({ scene: scheme + ' / ' + scene.label, ...r });
    });
    await page.close();
  }
  }
  await browser.close();

  // Report the worst offender per distinct selector, so one repeated element
  // does not drown out the rest.
  const worst = new Map();
  failures.forEach(f => {
    const k = f.scene + '|' + f.sel;
    if (!worst.has(k) || worst.get(k).ratio > f.ratio) worst.set(k, f);
  });
  const list = [...worst.values()].sort((a, b) => a.ratio - b.ratio);

  console.log(measured + ' text elements measured across ' + SCENES.length +
    ' screens in both colour schemes');
  if (list.length) {
    console.log('\nBELOW WCAG AA:');
    console.log('ratio  need  size  where              element                    text');
    list.forEach(f => console.log(
      String(f.ratio).padStart(5), String(f.need).padStart(5), String(f.size).padStart(5),
      ' ' + String(f.scene).padEnd(18).slice(0, 18),
      ' ' + f.sel.padEnd(26).slice(0, 26), ' ' + f.text));
    process.exit(1);
  }
  console.log('\nAll visible text meets WCAG AA for its size.');
})();

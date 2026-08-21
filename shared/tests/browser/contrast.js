/* Text contrast audit — for any game in this repository.
 *
 * Walks every text-bearing element in a real browser, resolves the colour that
 * is actually rendered against whatever is actually painted behind it, and
 * reports anything under the WCAG AA threshold for its size. Muted grey on
 * near-black is easy to introduce by eye and hard to notice until somebody with
 * low vision tries it.
 *
 * This used to live inside sheephead-multiplayer, where it was the only copy —
 * the other two games had no contrast audit at all, so nobody had ever measured
 * them. Nothing in it was ever sheephead-specific except how to start a hand,
 * and that now comes from the game's own tests/drive.js.
 *
 *   node shared/tests/browser/contrast.js <game-directory>
 *
 * Not part of any `npm test`: it launches a browser, and on a machine where
 * somebody is listening to a screen reader that CPU spike is audible.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/contrast.js <game-directory>');
  process.exit(2);
}
const repo = path.join(__dirname, '..', '..', '..');
const root = path.join(repo, game);
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('no such game: ' + root);
  process.exit(2);
}
const drive = require(path.join(root, 'tests', 'drive.js'));

/* puppeteer is installed per game, by that game's CI job. */
let puppeteer;
try { puppeteer = require(path.join(root, 'node_modules', 'puppeteer')); }
catch (e) {
  try { puppeteer = require('puppeteer'); }
  catch (e2) { console.log('SKIP: puppeteer not installed'); process.exit(0); }
}

/* The measurement itself, unchanged from the audit this was lifted from and
 * entirely game-agnostic: relative luminance, alpha-blended against whatever
 * is actually painted behind the element, and the WCAG AA threshold that
 * applies at that size and weight. */
const MEASURE = () => {
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
};

/* Text this family of games renders only in passing.
 *
 * Each entry is a host to put it in and the class it is given, taken from the
 * shared stylesheet the three games grew from. Rendered deliberately, measured,
 * and removed — a game that has no such host is skipped rather than failed, so
 * a new game inherits whichever of these it actually uses.
 */
const TRANSIENT = [
  { host: '#hand', cls: 'hint', text: 'No cards left.' },
  { host: '#trick', cls: 'empty', text: 'Nothing played yet.' },
  { host: '#trick', cls: 'who', text: 'Maximilianabrown' }
];

const PROBE = (TRANSIENT_LIST) => {
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
  const bgOf = el => {
    let node = el;
    while (node && node !== document.documentElement.parentNode) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length && (c.length < 4 || c[3] > 0)) return c.slice(0, 3);
      node = node.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const out = [];
  for (const t of TRANSIENT_LIST) {
    const host = document.querySelector(t.host);
    if (!host) continue;                     // this game does not have one
    const el = document.createElement('p');
    el.className = t.cls;
    el.textContent = t.text;
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      sel: t.host + ' .' + t.cls,
      text: t.text.slice(0, 34),
      size: Math.round(size * 10) / 10,
      ratio: Math.round(ratio(parse(cs.color).slice(0, 3), bgOf(el)) * 100) / 100,
      need: large ? 3 : 4.5
    });
    el.remove();
  }
  return out;
};

const SCENES = [
  { label: 'setup', setup: false },
  { label: 'mid hand', setup: true },
  { label: 'hand over', setup: true, finish: true }
];

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const failures = [];
  let measured = 0;
  let scenesRun = 0;

  for (const scheme of ['light', 'dark']) {
    for (const scene of SCENES) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await page.setViewport({ width: 1280, height: 900 });

      /* Seeded, so the same page is measured every run. Contrast does not
       * depend on the deal, but which elements EXIST does — a game that
       * randomly ends in a different way renders different prose, and an audit
       * that measures a different page each time reports different failures
       * each time. */
      await page.evaluateOnNewDocument(() => {
        let s = 20260821;
        Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      });
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });

      if (scene.setup) {
        await page.evaluate(drive.setup);
        await new Promise(r => setTimeout(r, 300));
      }
      if (scene.finish) {
        await page.evaluate(drive.playIn);
        await new Promise(r => setTimeout(r, 600));
      }

      /* The scene has to have rendered something, or a silently broken drive
       * script turns this whole audit green by measuring an empty page. The
       * setup screen legitimately has no cards, so only the played scenes are
       * held to it. */
      if (scene.setup) {
        const alive = await page.evaluate(`document.querySelectorAll('#hand .card, #players-table tr, .score-table tr').length`);
        if (!alive) {
          failures.push({ scene: scheme + ' / ' + scene.label, sel: '(nothing rendered)',
            text: 'drive.js did not get this game onto the screen', size: 0, ratio: 0, need: 0 });
        }
      }

      const results = await page.evaluate(MEASURE);
      /* TEXT THAT ONLY EXISTS SOMETIMES.
       *
       * Walking the page can only measure what the page happens to be showing,
       * and some text appears for a few seconds in a state a scripted hand may
       * never reach. The hint that replaces your cards when your hand runs empty
       * is one of those, and it was 1.41:1 in light mode — dark slate on dark
       * green — in ALL THREE games, because the felt stays dark in both colour
       * schemes while --ink-dim flips. Every audit had passed every game.
       *
       * So these are rendered on purpose and measured, rather than waited for.
       * A game without one of these elements is skipped, not failed. */
      const transient = await page.evaluate(PROBE, TRANSIENT);
      transient.forEach(t => {
        measured++;
        if (t.ratio < t.need) {
          failures.push({ scene: scheme + ' / ' + scene.label + ' (rendered)',
            sel: t.sel, text: t.text, size: t.size, ratio: t.ratio, need: t.need });
        }
      });

      results.forEach(r => {
        measured++;
        if (r.ratio < r.need) failures.push({ scene: scheme + ' / ' + scene.label, ...r });
      });
      scenesRun++;
      await page.close();
    }
  }
  await browser.close();

  /* The worst offender per distinct selector, so one repeated element does not
   * drown out the rest. */
  const worst = new Map();
  failures.forEach(f => {
    const k = f.scene + '|' + f.sel;
    if (!worst.has(k) || worst.get(k).ratio > f.ratio) worst.set(k, f);
  });
  const list = [...worst.values()].sort((a, b) => a.ratio - b.ratio);

  console.log(drive.name + ': ' + measured + ' text elements measured across ' +
    scenesRun + ' screens in both colour schemes');

  if (measured === 0) {
    console.error('\nnothing was measured at all — that is a broken audit, not a clean one');
    process.exit(1);
  }
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
})().catch(e => { console.error('contrast: threw — ' + e.stack); process.exit(1); });

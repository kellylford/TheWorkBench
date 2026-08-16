/* Cribbage audit.
 *
 * Same measurement approach used on the Sheephead game in this repo: drive a
 * real headless browser, reach states a player actually lands in, and measure
 * rather than eyeball. Checks horizontal overflow, card geometry and internal
 * collisions, text contrast against what is really painted behind it, tap
 * targets, focus visibility, duplicate ids and heading order.
 *
 *   npm install --no-save puppeteer     (or reuse ../../sheephead/node_modules)
 *   node tests/audit.js
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
let puppeteer;
for (const dir of [path.join(root, 'node_modules'), path.join(root, '..', 'sheephead', 'node_modules')]) {
  try { puppeteer = require(path.join(dir, 'puppeteer')); break; } catch (e) { /* try next */ }
}
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

/* Both pages, not just the game. rules.html went unmeasured for months, which is
 * exactly why it was still missing a main landmark, a skip link and table
 * captions long after the game had all three. A page nothing looks at is a page
 * that quietly rots. */
const PAGES = [
  { name: 'game', url: pathToFileURL(path.join(root, 'index.html')).href, deal: true },
  { name: 'rules', url: pathToFileURL(path.join(root, 'rules.html')).href, deal: false }
];
const SIZES = [
  { label: 'phone small', w: 320, h: 568 },
  { label: 'phone', w: 390, h: 844 },
  { label: 'tablet', w: 768, h: 1024 },
  { label: 'laptop', w: 1280, h: 800 },
  { label: 'wide', w: 1920, h: 1080 }
];
const FONTS = [16, 24];

const findings = [];
const note = (sev, area, msg) => findings.push({ sev, area, msg });

/* Get the game to a state where cards are on the table. */
async function deal(page) {
  for (let i = 0; i < 12; i++) {
    const acted = await page.evaluate(() => {
      const vis = b => b && !b.disabled && b.style.display !== 'none' && b.offsetParent !== null;
      const cut = document.getElementById('cutButton');
      const cont = document.getElementById('continueButton');
      if (vis(cut)) { cut.click(); return true; }
      if (vis(cont)) { cont.click(); return true; }
      return false;
    });
    await new Promise(r => setTimeout(r, 180));
    const dealt = await page.evaluate(() =>
      document.querySelectorAll('#playerHand .card').length > 0);
    if (dealt) return true;
    if (!acted) break;
  }
  return page.evaluate(() => document.querySelectorAll('#playerHand .card').length > 0);
}

const MEASURE = () => {
  const de = document.documentElement;
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
  const bgOf = el => {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length && (c.length < 4 || c[3] > 0)) return c.slice(0, 3);
      n = n.parentElement;
    }
    return [255, 255, 255];
  };

  // contrast
  const contrast = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.closest('.sr-only') || el.classList.contains('sr-only')) return;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
    const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!t) return;
    const cs = getComputedStyle(el);
    if (el.tagName === 'BUTTON' && el.disabled) return;          // exempt under 1.4.3
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const [x, y] = [lum(parse(cs.color).slice(0, 3)), lum(bgOf(el))].sort((a, b) => b - a);
    const ratio = (x + 0.05) / (y + 0.05);
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    if (ratio < need) {
      contrast.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''),
        txt: t.slice(0, 26), ratio: Math.round(ratio * 100) / 100, need, size: Math.round(size)
      });
    }
  });

  // cards: size, proportion, and whether their innards collide
  const cards = [...document.querySelectorAll('#playerHand .card')];
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return (w > 0 && h > 0) ? w * h : 0;
  };
  let worstOverlap = 0, overlapWhere = '';
  cards.forEach(c => {
    const parts = [...c.querySelectorAll('.card-rank, .card-suit, .card-center')]
      .map(e => ({ n: e.className.split(' ')[0], r: e.getBoundingClientRect() }));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = overlap(parts[i].r, parts[j].r);
        if (a > 4 && a > worstOverlap) {
          worstOverlap = a; overlapWhere = parts[i].n + ' over ' + parts[j].n;
        }
      }
    }
  });
  const cr = cards.length ? cards[0].getBoundingClientRect() : null;

  // tap targets (block-level interactive things)
  let minTap = Infinity, tapWho = '';
  document.querySelectorAll('button, a, [role="button"]').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (getComputedStyle(e).display === 'inline') return;
    if (r.height < minTap) { minTap = Math.round(r.height); tapWho = e.id || e.className || e.tagName; }
  });

  // structure
  const ids = {};
  let dupIds = [];
  document.querySelectorAll('[id]').forEach(e => {
    ids[e.id] = (ids[e.id] || 0) + 1;
    if (ids[e.id] === 2) dupIds.push(e.id);
  });
  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => +h.tagName[1]);
  let headingJumps = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) headingJumps.push('h' + levels[i - 1] + ' -> h' + levels[i]);
  }

  return {
    overflow: de.scrollWidth - de.clientWidth,
    contrast,
    cardCount: cards.length,
    cardW: cr ? Math.round(cr.width) : 0,
    cardH: cr ? Math.round(cr.height) : 0,
    worstOverlap: Math.round(worstOverlap), overlapWhere,
    minTap: minTap === Infinity ? 0 : minTap, tapWho: String(tapWho).slice(0, 24),
    dupIds, headingJumps,
    hasSkipLink: !!document.querySelector('a[href^="#"]'),
    hasMain: !!document.querySelector('main, [role="main"]'),
    // A table with no caption is anonymous in a screen reader's table list, and
    // headers with no scope leave the cell-to-header association to guesswork.
    tablesNoCaption: [...document.querySelectorAll('table')]
      .filter(t => !t.querySelector('caption')).length,
    thNoScope: [...document.querySelectorAll('th')]
      .filter(t => !t.getAttribute('scope') && !t.getAttribute('headers')).length,
    // Emoji and arrows inside a link land in its accessible name.
    glyphLinks: [...document.querySelectorAll('a')]
      .filter(a => {
        const own = [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        return /[←-⇿☀-➿️]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(own);
      })
      .map(a => a.textContent.trim().slice(0, 30))
  };
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  console.log('page   size          font  overflow  cards  cardW×H   ratio  overlap  minTap');

  for (const pg of PAGES) {
  for (const size of SIZES) {
    for (const font of FONTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: size.w, height: size.h });
      await page.goto(pg.url + '?cb=' + Date.now(), { waitUntil: 'load' });
      await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);
      await new Promise(r => setTimeout(r, 150));
      const dealt = pg.deal ? await deal(page) : true;
      const m = await page.evaluate(MEASURE);

      const ratio = m.cardW ? (m.cardH / m.cardW).toFixed(2) : '-';
      console.log(
        pg.name.padEnd(6),
        size.label.padEnd(13), String(font).padStart(4), String(m.overflow).padStart(9),
        String(m.cardCount).padStart(6), (m.cardW + '×' + m.cardH).padStart(9),
        String(ratio).padStart(7), String(m.worstOverlap).padStart(8), String(m.minTap).padStart(7),
        m.overlapWhere ? '  ' + m.overlapWhere : '');

      const at = pg.name + ' ' + size.label + ' @' + font + 'px';
      if (!dealt) note('warn', 'harness', at + ': could not reach a dealt hand');
      if (!m.hasMain) note('fail', 'structure', at + ': no main landmark');
      if (m.tablesNoCaption) note('fail', 'structure', at + ': ' + m.tablesNoCaption + ' table(s) without a caption');
      if (m.thNoScope) note('fail', 'structure', at + ': ' + m.thNoScope + ' table header(s) without scope');
      m.glyphLinks.forEach(t => note('fail', 'structure',
        at + ': emoji or arrow inside link text — "' + t + '"'));
      if (m.overflow > 1) note('fail', 'layout', at + ': horizontal overflow ' + m.overflow + 'px');
      if (m.worstOverlap > 4) note('fail', 'cards', at + ': card internals overlap (' + m.overlapWhere + ')');
      if (m.cardW && m.cardW < 40) note('fail', 'cards', at + ': cards only ' + m.cardW + 'px wide');
      if (m.cardW && Math.abs(m.cardH / m.cardW - 1.4) > 0.25) {
        note('warn', 'cards', at + ': card aspect ratio ' + ratio + ' (a real card is ~1.4)');
      }
      if (m.minTap && m.minTap < 24) note('fail', 'targets', at + ': smallest target ' + m.minTap + 'px (' + m.tapWho + ')');
      m.contrast.forEach(c => note('fail', 'contrast',
        at + ': ' + c.ratio + ':1 needs ' + c.need + ' — ' + c.sel + ' "' + c.txt + '" at ' + c.size + 'px'));
      if (m.dupIds.length) note('fail', 'structure', at + ': duplicate ids ' + m.dupIds.join(', '));
      if (m.headingJumps.length) note('warn', 'structure', at + ': heading level jumps ' + m.headingJumps.join(', '));
      if (!m.hasSkipLink) note('warn', 'structure', at + ': no skip link');
      await page.close();
    }
  }
  }
  await browser.close();

  // one line per distinct problem, not per viewport it happens at
  const seen = new Map();
  findings.forEach(f => {
    const key = f.sev + '|' + f.area + '|' + f.msg.replace(/^[^:]+: /, '');
    if (!seen.has(key)) seen.set(key, { ...f, where: [f.msg.split(':')[0]] });
    else seen.get(key).where.push(f.msg.split(':')[0]);
  });
  const uniq = [...seen.values()];
  const fails = uniq.filter(f => f.sev === 'fail');
  const warns = uniq.filter(f => f.sev === 'warn');

  console.log('\n' + fails.length + ' failures, ' + warns.length + ' warnings\n');
  [['FAILURES', fails], ['WARNINGS', warns]].forEach(([title, list]) => {
    if (!list.length) return;
    console.log(title + ':');
    list.forEach(f => console.log('  [' + f.area + '] ' + f.msg.replace(/^[^:]+: /, '') +
      '\n      at: ' + [...new Set(f.where)].join(', ')));
    console.log('');
  });
  if (fails.length) process.exit(1);
  console.log('No failures.');
})();

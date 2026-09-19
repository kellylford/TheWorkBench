/* Card faces must not collide with themselves — for any game in this repository.
 *
 * The first traditional skin sized the card responsively but its contents in
 * fixed rem, so on a phone the pips, the corner indices and the centre glyph
 * overlapped into an unreadable smudge. Geometry is the only honest way to check
 * that: measure the real boxes and assert they do not intersect.
 *
 * This lived in one game. The other three drew their cards from the same
 * stylesheet lineage and had never been measured — which is exactly the position
 * the contrast audit was in before it was shared, and it turned up the same bug
 * in four games the first time it ran.
 *
 *   node shared/tests/browser/card-overlap.js <game-directory>
 *
 * Not part of any `npm test`: it launches a browser, and on a machine where
 * somebody is listening to a screen reader that CPU spike is audible.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/card-overlap.js <game-directory>');
  process.exit(2);
}
const repo = path.join(__dirname, '..', '..', '..');
let drive, root;
try { const l = loadDrive(repo, game); drive = l.drive; root = l.dir; }
catch (e) { console.error(e.message); process.exit(2); }

const puppeteer = puppeteerFor(root);
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const SIZES = [
  { label: 'phone small', w: 320 },
  { label: 'phone', w: 390 },
  { label: 'tablet', w: 768 },
  { label: 'laptop', w: 1280 }
];
const FONTS = [16, 24];

/* The smallest table the game will deal, so hands are as long as they get and
 * every rank has a chance to appear. Sheephead at three players deals ten cards
 * each; the games with a fixed table ignore this and deal what they deal. */
const FEWEST = { players: 3, skin: 'traditional' };

const MEASURE = () => {
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return (w > 0 && h > 0) ? w * h : 0;
  };
  const out = { count: 0, worst: 0, pair: '', card: '' };
  document.querySelectorAll('#hand .card').forEach(card => {
    out.count++;
    const label = (card.getAttribute('aria-label') || '').split(',')[0];
    const parts = [];
    card.querySelectorAll('.idx-tl, .idx-br').forEach(e =>
      parts.push({ name: e.className.replace('idx ', ''), r: e.getBoundingClientRect() }));
    card.querySelectorAll('.pip, .court-letter, .court-suit').forEach(e =>
      parts.push({ name: e.className.split(' ')[0], r: e.getBoundingClientRect() }));

    /* An element sticking outside its own card counts as a collision too. */
    const cr = card.getBoundingClientRect();
    parts.forEach(p => {
      const spill = Math.max(cr.left - p.r.left, 0) + Math.max(p.r.right - cr.right, 0) +
        Math.max(cr.top - p.r.top, 0) + Math.max(p.r.bottom - cr.bottom, 0);
      if (spill > 1.5 && spill > out.worst) {
        out.worst = spill; out.pair = p.name + ' outside card'; out.card = label;
      }
    });

    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = overlap(parts[i].r, parts[j].r);
        if (a > 4 && a > out.worst) {          // tolerate a hair of antialiasing
          out.worst = a;
          out.pair = parts[i].name + ' over ' + parts[j].name;
          out.card = label;
        }
      }
    }
  });
  return out;
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fails = [];
  let checked = 0;
  let emptyRuns = 0;

  console.log(drive.name);
  console.log('size          font  cards  worstOverlap  worstPair');

  for (const size of SIZES) {
    for (const font of FONTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: size.w, height: 900 });

      /* Seeded, so the same cards are measured every run. Which ranks are dealt
       * decides which faces get drawn — a court card and a five have different
       * insides — so an unseeded run measures a different thing each time and
       * reports a different answer. */
      await page.evaluateOnNewDocument(() => {
        let s = 20260821;
        Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      });
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
      await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);
      await page.evaluate(setupScript(drive, FEWEST));
      await new Promise(r => setTimeout(r, 350));

      const r = await page.evaluate(MEASURE);
      checked += r.count;
      if (r.count === 0) emptyRuns++;

      if (r.worst > 4) {
        fails.push(size.label + ' @' + font + 'px: ' + r.pair + ' on the ' + r.card +
          ' (' + Math.round(r.worst) + 'px2)');
      }
      console.log(size.label.padEnd(13), String(font).padStart(4), String(r.count).padStart(6),
        String(Math.round(r.worst)).padStart(13), '  ' + (r.pair || '-'));
      await page.close();
    }
  }
  await browser.close();

  /* Nothing on screen is a broken audit, not a clean one. Every previous version
   * of a check like this in this repository has, at some point, quietly measured
   * an empty page and said everything was fine. */
  if (emptyRuns) {
    console.error('\n' + emptyRuns + ' of ' + (SIZES.length * FONTS.length) +
      ' runs had no cards on screen at all. drive.js did not get this game dealt.');
    process.exit(1);
  }

  if (fails.length) {
    console.log('\nOVERLAPPING CARD FACES:');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\n' + checked + ' card faces measured, nothing overlaps.');
})().catch(e => { console.error('card-overlap: threw — ' + e.stack); process.exit(1); });

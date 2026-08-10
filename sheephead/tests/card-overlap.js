/* Card faces must not collide with themselves.
 *
 * The first traditional skin sized the card responsively but its contents in
 * fixed rem, so on a phone the pips, the corner indices and the centre glyph
 * overlapped into an unreadable smudge. Geometry is the only honest way to
 * check that: measure the real boxes and assert they do not intersect.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
let puppeteer;
try { puppeteer = require(path.join(root, 'node_modules', 'puppeteer')); }
catch (e) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const SIZES = [
  { label: 'phone small', w: 320 },
  { label: 'phone', w: 390 },
  { label: 'tablet', w: 768 },
  { label: 'laptop', w: 1280 }
];
const FONTS = [16, 24];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const fails = [];
  let checked = 0;
  console.log('size          font  cards  worstOverlap  worstPair');

  for (const size of SIZES) {
    for (const font of FONTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: size.w, height: 900 });
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
        { waitUntil: 'load' });
      await page.evaluate(f => { document.documentElement.style.fontSize = f + 'px'; }, font);
      // 3 players gives ten-card hands, so every rank appears somewhere
      await page.evaluate(() => {
        document.getElementById('opt-players').value = '3';
        document.getElementById('opt-pace').value = '0';
        document.getElementById('opt-skin').value = 'traditional';
        document.getElementById('setup-form')
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await new Promise(r => setTimeout(r, 350));

      const r = await page.evaluate(() => {
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
          // an element sticking outside its own card counts as a collision too
          const cr = card.getBoundingClientRect();
          parts.forEach(p => {
            const out_ = Math.max(0,
              Math.max(cr.left - p.r.left, 0) + Math.max(p.r.right - cr.right, 0) +
              Math.max(cr.top - p.r.top, 0) + Math.max(p.r.bottom - cr.bottom, 0));
            if (out_ > 1.5 && out_ > out.worst) {
              out.worst = out_; out.pair = p.name + ' outside card'; out.card = label;
            }
          });
          for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
              const a = overlap(parts[i].r, parts[j].r);
              // tolerate a hair of antialiasing overlap
              if (a > 4 && a > out.worst) {
                out.worst = a;
                out.pair = parts[i].name + ' over ' + parts[j].name;
                out.card = label;
              }
            }
          }
        });
        return out;
      });

      checked += r.count;
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

  if (fails.length) {
    console.log('\nOVERLAPPING CARD FACES:');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\n' + checked + ' card faces measured, nothing overlaps.');
})();

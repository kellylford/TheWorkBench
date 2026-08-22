/* Does anything actually appear on the screen?
 *
 * Every other audit here measures things that ARE drawn: their colour, their
 * geometry, their labels. None of them notices when something is not drawn at
 * all, and that turned out to be the whole of a day's bugs in hearts:
 *
 *   - the trick showed two name chips and no cards, all game, because a class
 *     was on the <li> instead of on a card inside it;
 *   - "What you can do" stood over an empty box for most of a hand;
 *   - the seats strip was a blank green bar, because two functions shared a name
 *     and the wrong one won.
 *
 * Seven suites were green through all three. They were found by taking a
 * screenshot and looking, which is not a thing that happens on a schedule.
 *
 * ---- the rule ----
 *
 * A HEADING IS A PROMISE THAT SOMETHING FOLLOWS IT. So: for every visible
 * heading in the game area, the content between it and the next heading must
 * contain something with a non-zero box. That is general, needs no list of ids,
 * and is exactly the shape of all three faults above.
 *
 * For a screen reader user it is not cosmetic. Moving by headings is the normal
 * way to navigate, and a heading with nothing under it means landing somewhere
 * and finding a void — with no way to tell whether the game is broken or you
 * are.
 *
 *   node shared/tests/browser/renders.js <game-directory>
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/renders.js <game-directory>');
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

/* Walk the game area heading by heading, and report what is under each. */
const SECTIONS = () => {
  const area = document.getElementById('game-section') || document.body;
  const heads = [...area.querySelectorAll('h2, h3')]
    .filter(h => h.offsetParent !== null && !h.classList.contains('sr-only'));

  const visible = el => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  return heads.map(h => {
    /* Everything between this heading and the next one, at any depth. */
    let filled = false;
    let node = h.nextElementSibling;
    let text = '';
    while (node && !/^H[23]$/.test(node.tagName)) {
      if (visible(node)) {
        /* A container that is visible but holds nothing is still empty for this
         * purpose — a bordered box with no children is what an empty trick and
         * an empty seats strip both looked like. */
        const hasContent = node.children.length > 0 ||
          (node.textContent || '').trim().length > 0;
        if (hasContent) { filled = true; text += (node.textContent || '').trim().slice(0, 40); }
      }
      node = node.nextElementSibling;
    }
    return { heading: (h.textContent || '').trim().slice(0, 30), filled, sample: text.slice(0, 40) };
  });
};

/* Cards that have been played must be ON SCREEN, not merely in the DOM. */
const TRICK = () => {
  const box = document.getElementById('trick') || document.getElementById('playedCards');
  if (!box) return { present: false };
  const all = [...box.children];
  const placeholder = all.some(e => e.classList.contains('empty') ||
    /nothing|no card|not been/i.test(e.textContent || ''));
  const entries = all.filter(e => !e.classList.contains('empty'));
  const drawn = entries.filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 20 && r.height > 20;
  });
  /* A card FACE inside the entry, rather than just the entry's own box: the
   * failure being guarded against is an entry that renders as a name chip with
   * no card in it. */
  /* THE GLYPHS, not the card container.
   *
   * This listed .card and .mini too, and an empty card box therefore counted as
   * a face — which is the exact bug being guarded against: the container was
   * always there, the rank and suit inside it were not. A check that accepts the
   * box as evidence of the contents is no check at all. */
  const faces = [...box.querySelectorAll('.suit, .pip, .pip-big, .idx-rank, .idx-suit, .rank')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
  return { present: true, placeholder: placeholder,
    entries: entries.length, drawn: drawn.length, faces: faces.length };
};

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    let s = 20260821;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
  await page.evaluate(setupScript(drive, {}));
  await new Promise(r => setTimeout(r, 400));

  /* Mid-hand, which is where the screen is busiest and where all three faults
   * lived. playMid stops with cards in hand and something on the table. */
  await pump(page, drive.playMid || drive.playIn, { tries: 60 });

  const sections = await page.evaluate(SECTIONS);
  check(sections.length >= 3,
    'only ' + sections.length + ' visible headings in the game area — the walk ' +
    'found too little to have checked anything');

  sections.forEach(s => {
    check(s.filled,
      'the heading "' + s.heading + '" has nothing visible under it. A heading is ' +
      'a promise that something follows it, and moving by headings is how a screen ' +
      'reader user navigates — they land here and find a void.');
  });

  const trick = await page.evaluate(TRICK);
  if (trick.present) {
    /* EITHER a placeholder OR real cards. Never nothing.
     *
     * The first version guarded the card check on entries > 0, so a trick that
     * rendered absolutely nothing skipped it in silence — the exact state the
     * audit exists to catch, waved through because there was nothing to
     * measure. An empty trick is a legitimate state and it says so on screen:
     * "Nothing played to this trick yet." A trick box holding neither that nor
     * a card is a bug every time. */
    check(trick.placeholder || trick.entries > 0,
      'the trick box is completely empty — no cards and no "nothing played yet", ' +
      'which is what a card that fails to render looks like');

    if (trick.entries > 0) {
      check(trick.drawn === trick.entries,
        trick.entries + ' cards have been played and only ' + trick.drawn +
        ' entries are big enough to see');
      check(trick.faces > 0,
        'cards have been played and not one card face is drawn in the trick — the ' +
        'entries are there and empty, which is what a misplaced class looks like');
    }
  }

  await browser.close();

  console.log(drive.name + ': ' + checks + ' checks');
  sections.forEach(s => console.log(
    '  ' + (s.filled ? 'ok   ' : 'EMPTY') + '  ' + s.heading.padEnd(24) +
    (s.filled ? s.sample : '')));
  if (trick.present) {
    console.log('  trick: ' + trick.entries + ' played, ' + trick.drawn +
      ' drawn, ' + trick.faces + ' card faces');
  }

  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    [...new Set(fails)].slice(0, 12).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('\nEvery heading has something under it, and played cards are drawn.');
})().catch(e => { console.error('renders: threw — ' + e.stack); process.exit(1); });

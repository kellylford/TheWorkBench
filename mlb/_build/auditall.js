// Accessibility audit for the ballpark guides.
//
//   node auditall.js          five pages, light and dark, desktop width  (the usual run)
//   node auditall.js --full   all thirty-one pages, plus reflow at 320 CSS pixels
//
// Every page comes out of one template (page.py) with one stylesheet, so auditing all
// thirty-one on every run mostly re-tests the same markup. The five in SAMPLE are chosen to
// cover the branches that actually differ: an ordinary park, a park that numbers by parity
// and has letter-suffixed tiers, the park where no source publishes a seat-1 side, the park
// with letter-prefixed identifiers and two numbering schemes, and the landing page, which
// has its own template. Run --full when page.py, shared.css or mkindex.py change - that is
// when a defect can reach a page the sample does not cover.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FULL = process.argv.includes('--full');

const SAMPLE = [
  'index.html',            // its own template
  'buschstadium/index.html',   // ordinary sweep, one seat-1 side
  'dodgerstadium/index.html',  // parity numbering, per-half seat-1 side, suffixed tiers, largest bowl
  'sutterhealthpark/index.html', // no seat-1 side published: the honest-gap branch
  'fenwaypark/index.html',     // letter-prefixed ids, two numbering schemes at once
];

const ALL = ['index.html', 'amfamfield/index.html', 'angelstadium/index.html',
  'buschstadium/index.html', 'chasefield/index.html', 'citifield/index.html',
  'citizensbankpark/index.html', 'comericapark/index.html', 'coorsfield/index.html',
  'daikinpark/index.html', 'dodgerstadium/index.html', 'fenwaypark/index.html',
  'globelifefield/index.html', 'greatamericanballpark/index.html',
  'kauffmanstadium/index.html', 'loandepotpark/index.html', 'nationalspark/index.html',
  'oraclepark/index.html', 'oriolepark/index.html', 'petcopark/index.html',
  'pncpark/index.html', 'progressivefield/index.html', 'ratefield/index.html',
  'rogerscentre/index.html', 'sutterhealthpark/index.html', 'targetfield/index.html',
  'tmobilepark/index.html', 'tropicanafield/index.html', 'truistpark/index.html',
  'wrigleyfield/index.html', 'yankeestadium/index.html'];

const PAGES = FULL ? ALL : SAMPLE;

// Prefer whatever `npx playwright install chromium` put in place. Some sandboxes ship a
// Chromium whose build number does not match the pinned Playwright, in which case the
// default launch throws and the binary has to be pointed at directly. PLAYWRIGHT_CHROMIUM
// overrides both.
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) return null;
  for (const d of fs.readdirSync(root)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
                       'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
                       'chrome-win/chrome.exe']) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

(async () => {
  let b;
  try {
    b = await chromium.launch();
  } catch (e) {
    const exe = findChromium();
    if (!exe) throw e;
    console.log('# default launch failed, using ' + exe);
    b = await chromium.launch({ executablePath: exe });
  }

  let fail = 0;
  console.log('# ' + PAGES.length + ' pages' + (FULL ? ', full sweep with reflow' : ', sample'));
  for (const rel of PAGES) {
    const url = 'file://' + path.resolve(__dirname, '..', rel).replace(/\\/g, '/');
    const out = { page: rel };
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(url); await p.waitForTimeout(700);
      await p.addScriptTag({ path: require.resolve('axe-core') });
      const r = await p.evaluate(async () => await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
      out[scheme] = { v: r.violations.length, inc: r.incomplete.length, pass: r.passes.length,
        ids: r.violations.map(x => x.id + '(' + x.nodes.length + ')') };
      if (r.violations.length) fail++;
      await ctx.close();
    }

    // Structure is checked at desktop width. The 320-pixel pass is the same test a desktop
    // browser applies at 400% zoom, which is the low-vision case rather than a phone case -
    // it is kept, but only on the full sweep, because it is slow and it has not regressed.
    const ctx = await b.newContext({ viewport: FULL ? { width: 320, height: 800 }
                                                    : { width: 1280, height: 900 } });
    const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(500);
    out.structure = await p.evaluate(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => +h.tagName[1]);
      let jumps = 0; for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) jumps++;
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               h1: document.querySelectorAll('h1').length, jumps,
               tables: [...document.querySelectorAll('table')].every(t => t.querySelector('caption')),
               cards: document.querySelectorAll('.sec').length,
               landmarks: document.querySelectorAll('[role="region"],aside,section[aria-label],section[aria-labelledby]').length,
               lang: document.documentElement.lang };
    });
    await ctx.close();
    if (out.structure.h1 !== 1 || out.structure.jumps || !out.structure.tables
        || out.structure.overflow > 0) fail++;
    console.log(JSON.stringify(out));
  }
  await b.close();
  console.log(fail ? '\n*** ' + fail + ' page/scheme combos have problems ***' : '\nALL CLEAN');
})();

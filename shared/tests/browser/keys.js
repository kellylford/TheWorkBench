/* The keyboard is the same keyboard in every game.
 *
 * Somebody who learns one of these games should not have to learn the keys
 * again for the next one. That was true by convention and by nothing else, so
 * it drifted: hearts shipped with five shortcuts against the other games'
 * eleven, and without N — the key that moves the game forward — at all.
 *
 * A convention nothing checks is a preference. This is the check.
 *
 * ---- what is actually required ----
 *
 * N, and the review keys the games share. NOT every key every game has: euchre
 * has O for play order because euchre has a play order, and demanding it of
 * cribbage would be demanding a game answer a question it does not have. The
 * shared set is the set a player carries between games.
 *
 * Three properties, and the second is the one that rots:
 *
 *   1. The key exists and is advertised — aria-keyshortcuts on a real control,
 *      so a screen reader can list it and a sighted player can see it.
 *   2. The key DOES something. A handler that reads a marker nothing sets is a
 *      shortcut that silently does nothing, and it looks fine in every review.
 *   3. No two controls claim the same key, because one of them silently loses.
 *
 *   node shared/tests/browser/keys.js <game-directory>
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/keys.js <game-directory>');
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

/* The set a player carries from one game to the next. */
/* Required only of a game that can have OTHER PEOPLE at the table.
 *
 * W answers "who is here", and the stable sheephead game has no lobby and no
 * second seat — there is nobody to name. Demanding it there is the same mistake
 * as demanding O of cribbage: making a game answer a question it does not have.
 * Detected from the page rather than listed, so a game that gains multiplayer
 * gains the requirement with it. */
const MULTIPLAYER_ONLY = { W: 'who is at the table' };

const SHARED = {
  N: 'move the game forward',
  H: 'read my hand',
  T: 'read the trick or the play',
  L: 'read the last completed trick',
  S: 'read the scores',
  C: 'what has been played so far',

  R: 'repeat the last thing said',
  G: 'go to the log',
  E: 'export the log',
  B: 'report a bug'
};

/* NOT required of every game, and the distinction matters. O is the play order,
 * which only means something where play goes round in a fixed order — euchre,
 * sheephead and hearts have one, cribbage does not, and demanding it there
 * would be demanding a game answer a question it does not have. P is likewise
 * per-game: trump and partners in euchre, points so far in hearts.
 *
 * The shared set is what a player CARRIES between games. Everything else is a
 * game being itself. */

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    let s = 20260821;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });

  /* ---- 0. THE HELP KEY, BEFORE ANY GAME HAS STARTED ----
   *
   * Checked here, on a page that has not been driven, because that is the state
   * it was broken in. Every game's key handler opened with a guard of the shape
   * `if (!state || game-section.hidden) return`, and ? sat behind it — so on the
   * start screen, which is precisely where somebody is deciding whether this
   * thing can be played by keyboard at all, pressing it did nothing. Silently.
   * A silent no is still a no.
   *
   * What counts as working is deliberately loose: a dialog opened, or focus
   * moved to a heading. Hearts writes its hints into the page and the other four
   * put them in a modal, and both are fine — the question is whether the reader
   * ends up somewhere new. */
  {
    await page.evaluate(() => { document.body.focus(); window.__before = document.activeElement; });
    await page.keyboard.press('?');
    await new Promise(r => setTimeout(r, 250));
    const got = await page.evaluate(() => {
      const open = [...document.querySelectorAll('dialog')].filter(d => d.open);
      const a = document.activeElement;
      return {
        dialog: open.length > 0,
        moved: !!(a && a !== document.body && a !== window.__before),
        where: a ? (a.id || a.tagName) : null
      };
    });
    check(got.dialog || got.moved,
      'the ? key does nothing before a game has started. That is the moment ' +
      'somebody is working out whether this can be played by keyboard at all, ' +
      'and the answer they got was silence (focus: ' + got.where + ')');
    await page.evaluate(() => {
      [...document.querySelectorAll('dialog')].forEach(d => { if (d.open) d.close(); });
    });
  }

  await page.evaluate(setupScript(drive, {}));
  await new Promise(r => setTimeout(r, 400));

  /* ---- 1. advertised, on a real control ---- */
  const advertised = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[aria-keyshortcuts]').forEach(el => {
      const k = (el.getAttribute('aria-keyshortcuts') || '').trim().toUpperCase();
      (out[k] = out[k] || []).push(
        el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 24));
    });
    return out;
  });

  /* Does this game have anybody else at the table to ask about? */
  const multiplayer = await page.evaluate(
    () => !!(document.getElementById('lobby-section') || (window.SH && window.SH.Net)));
  const required = Object.assign({}, SHARED, multiplayer ? MULTIPLAYER_ONLY : {});

  Object.keys(required).forEach(k => {
    check(!!advertised[k],
      k + ' is not advertised anywhere — it should be on a control, so a screen ' +
      'reader can list it and a sighted player can see it. (' + required[k] + ')');
  });

  /* ---- 2. no key claimed twice ---- */
  Object.entries(advertised).forEach(([k, who]) => {
    check(who.length === 1,
      'the ' + k + ' key is claimed by ' + who.length + ' controls (' + who.join(' and ') +
      '), so one of them silently never gets it');
  });

  /* ---- 3. N ACTUALLY MOVES THE GAME ----
   *
   * The property that rots. Every game reads a marker on its one advancing
   * button; a game whose handler reads a marker nothing sets has a shortcut that
   * does nothing at all and looks correct in any review of the code. So this
   * plays a hand to its end and presses N. */
  const finished = await pump(page, drive.playIn, { tries: 90 });
  check(finished, 'could not reach the end of a hand, so N was never tested');

  if (finished) {
    /* STRUCTURAL, not by phase name or test hook.
     *
     * The first version of this read SH.UI._test.view() and expected a phase
     * called handOver. Cribbage calls it roundOver and sheephead does not
     * expose that hook at all, so the check failed on two games for being
     * wrong about them rather than finding anything. What is actually common
     * is the button N presses and the hand it deals. */
    const marked = await page.evaluate(
      () => document.querySelectorAll('#actions button[data-advance]').length);
    check(marked === 1,
      'there are ' + marked + ' buttons marked data-advance between hands; N needs ' +
      'exactly one, and a handler reading a marker nothing sets is a shortcut that ' +
      'silently does nothing');

    if (marked === 1) {
      const before = await page.evaluate(() => ({
        cards: document.querySelectorAll('#hand .card').length,
        label: (document.querySelector('#actions button[data-advance]') || {}).textContent
      }));
      await page.keyboard.press('n');
      await new Promise(r => setTimeout(r, 900));
      const after = await page.evaluate(() => ({
        cards: document.querySelectorAll('#hand .card').length,
        advance: document.querySelectorAll('#actions button[data-advance]').length
      }));
      /* A hand was dealt: cards came back, or the advancing button went away
       * because there is nothing left to advance to. Either is movement; what
       * fails is nothing happening at all. */
      check(after.cards > before.cards || after.advance === 0,
        'pressing N did nothing — ' + before.cards + ' cards before and ' +
        after.cards + ' after, with the "' + String(before.label).trim() +
        '" button still waiting');
    }
  }

  /* ---- 4. N REACHES THE PRIMARY ACTION IN EVERY PHASE ----
   *
   * The check above presses N between hands, which is one moment out of a whole
   * game — and a player found the gap by playing: in cribbage you select two
   * cards for the crib, press N, and nothing happens. The throw button had no
   * shortcut, so it carried no marker, so N looked for something that was not
   * there and did nothing. Silently, because there is nothing to say when you
   * find no button.
   *
   * The rule is simple and holds everywhere: WHEREVER THERE IS A PRIMARY ACTION,
   * N MUST REACH IT. A phase with a `.primary` button in the actions area and no
   * data-advance on it is a phase where the key quietly stops working.
   *
   * So this walks a whole hand and checks every distinct arrangement of buttons
   * it meets, rather than one chosen moment. A contract that tests one state is
   * a contract about one state.
   */
  {
    /* A FRESH PAGE. This walk used to run after the section above, which pumps
     * a whole hand to its end — so it started at the finish line and met two
     * arrangements of buttons, both of them end-of-hand. It reported that
     * honestly rather than passing, which is the only reason it was noticed. */
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1280, height: 900 });
    await page2.evaluateOnNewDocument(() => {
      let s = 20260821;
      Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    });
    await page2.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
    await page2.evaluate(setupScript(drive, {}));
    await new Promise(r => setTimeout(r, 400));

    const seenPhases = new Set();
    const gaps = [];

    for (let step = 0; step < 220; step++) {
      const look = await page2.evaluate(() => {
        const box = document.getElementById('actions');
        if (!box) return null;
        const buttons = [...box.querySelectorAll('button')];
        const primary = buttons.filter(b => b.classList.contains('primary'));
        const advance = buttons.filter(b => b.hasAttribute('data-advance'));
        return {
          key: buttons.map(b => (b.textContent || '').trim().slice(0, 18)).join('|'),
          primaryLabels: primary.map(b => (b.textContent || '').trim().slice(0, 30)),
          primaryHasAdvance: primary.length ? primary.some(b => b.hasAttribute('data-advance')) : null,
          advanceCount: advance.length
        };
      });

      if (look && look.key && !seenPhases.has(look.key)) {
        seenPhases.add(look.key);
        if (look.primaryLabels.length && !look.primaryHasAdvance) {
          gaps.push(look.primaryLabels.join(' / '));
        }
      }

      /* Move the game on however this game moves on, without caring which game
       * it is: take the primary action if there is one, otherwise play a card. */
      const moved = await page2.evaluate(() => {
        const box = document.getElementById('actions');
        const primary = box && box.querySelector('button.primary');
        if (primary && primary.getAttribute('aria-disabled') !== 'true' && !primary.disabled) {
          primary.click();
          return true;
        }
        /* Skip cards already chosen. Selecting is a toggle, and taking the
         * first enabled card every time picked the one just selected, unpicked
         * it, and repeated — the walk sat in the cribbage discard for all 220
         * steps flipping one card, and reported two arrangements because two
         * was honestly all it had seen. */
        const cards = [...document.querySelectorAll('#hand .card')]
          .filter(c => c.getAttribute('aria-disabled') !== 'true');
        const card = cards.find(c => c.getAttribute('aria-pressed') !== 'true') || cards[0];
        if (card) { card.click(); return true; }
        const any = box && [...box.querySelectorAll('button')]
          .find(b => b.getAttribute('aria-disabled') !== 'true' && !b.disabled);
        if (any) { any.click(); return true; }
        return false;
      });
      if (!moved) await new Promise(r => setTimeout(r, 80));
    }

    await page2.close();

    check(seenPhases.size >= 3,
      'only met ' + seenPhases.size + ' distinct arrangements of buttons, which is ' +
      'too few to have checked anything about phases');

    check(gaps.length === 0,
      'a primary action N cannot reach: ' + gaps.join('; ') + '. Wherever there ' +
      'is a primary action the key must get to it, or it stops working in that ' +
      'phase and says nothing about why');
  }
  await browser.close();

  console.log(drive.name + ': ' + checks + ' assertions');
  console.log('  advertised: ' + Object.keys(advertised).sort().join(' '));
  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    [...new Set(fails)].slice(0, 12).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('The shared keys are present, unique, and N moves the game on.');
})().catch(e => { console.error('keys: threw — ' + e.stack); process.exit(1); });

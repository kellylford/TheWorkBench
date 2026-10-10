/* Rendered appearance: the things a person spotted by looking, turned into
 * something a machine can check. For any game in this repository.
 *
 * Three real bugs got through every other suite and all three were caught by
 * somebody opening a screenshot:
 *
 *   - the plain skin silently never applied, because applySkin() sat after an
 *     early return;
 *   - unplayable cards were painted over until the pips were unreadable — three
 *     separate times, with three different mechanisms;
 *   - hearts and diamonds rendered BLACK in the default skin, because the red
 *     rule named only elements that exist in the other one.
 *
 * None of that is a contrast failure, an overflow, a geometry error or a
 * labelling mistake, so nothing measured it. A pixel-by-pixel baseline would
 * catch it and would also fail on every deliberate change, which makes it noise.
 * These are the specific properties those bugs violated, measured directly.
 *
 * ---- why this one needed more than a drive file ----
 *
 * The other shared audits only need a game started. This one needs a game
 * stopped in the middle: it measures card faces, and playing a hand out leaves
 * an empty hand and nothing to look at. That is drive.playMid.
 *
 * And the games are not all shaped alike. Cribbage has no trick at all — played
 * cards go to a shared pile — so the checks about a card in the trick cannot
 * run there. Those are declared NOT APPLICABLE for that game and said out loud,
 * rather than passing quietly, because a check that never ran is not a check
 * that passed. That distinction is the whole reason this file counts what it
 * exercised.
 *
 *   node shared/tests/browser/appearance.js <game-directory>
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { loadDrive, setupScript, pump, puppeteerFor } = require('./harness.js');

const game = process.argv[2];
if (!game) {
  console.error('usage: node shared/tests/browser/appearance.js <game-directory>');
  process.exit(2);
}
const repo = path.join(__dirname, '..', '..', '..');
let drive, root;
try { const l = loadDrive(repo, game); drive = l.drive; root = l.dir; }
catch (e) { console.error(e.message); process.exit(2); }

if (!drive.playMid) {
  console.error(game + '/tests/drive.js has no playMid. This audit measures card ' +
    'faces mid-hand — playing a hand out leaves nothing to look at.');
  process.exit(2);
}

const puppeteer = puppeteerFor(root);
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const rgb = s => (s.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
const isRedish = ([r, g, b]) => r > 90 && r > g * 1.6 && r > b * 1.4;

const LOOK = () => {
  const out = { hand: [], mini: [], skin: document.body.className,
    hasTrick: !!document.getElementById('trick') };
  const colourOf = el => {
    const cs = getComputedStyle(el);
    return { color: cs.color, size: parseFloat(cs.fontSize) };
  };
  const visible = el => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;

  document.querySelectorAll('#hand .card').forEach(card => {
    /* EVERY visible suit glyph, not just the first one found. A card shows its
     * suit in several places — the two corner indices and the pip field — and
     * taking only the first meant deleting the red rule from the pips went
     * unnoticed, because the corner index was still red and got measured
     * instead. Any one of them rendering the wrong colour is the bug. */
    const suits = [...card.querySelectorAll('.idx-suit, .suit, .pip, .pip-big, .court-suit')]
      .filter(visible).map(colourOf);
    const rank = [...card.querySelectorAll('.idx-rank, .rank, .court-letter')].find(visible);
    if (!suits.length) return;
    const cs = getComputedStyle(card);
    const after = getComputedStyle(card, '::after');
    out.hand.push({
      id: card.dataset.id,
      red: card.classList.contains('red'),
      disabled: card.getAttribute('aria-disabled') === 'true',
      /* Whatever the current mechanism is, these are where a "you cannot play
       * this" signal can live without being painted over the face. */
      look: cs.backgroundColor + '|' + cs.transform + '|' + cs.boxShadow,
      suits,
      suit: suits[0],
      rank: rank ? colourOf(rank) : null,
      /* A CSS filter does not change any computed colour, so measuring colours
       * can never see a greyscale — it changes the pixels and nothing else. The
       * filter itself is the observable thing, so record it. Likewise an ::after
       * that paints something is how the hatch overlay worked. */
      filter: cs.filter,
      overlay: after.content !== 'none' && after.background !== 'none' &&
        !/rgba\(0, 0, 0, 0\)/.test(after.backgroundColor + ' ' + after.backgroundImage)
        ? after.backgroundImage + ' ' + after.backgroundColor : null,
      width: Math.round(card.getBoundingClientRect().width)
    });
  });

  document.querySelectorAll('#trick .mini').forEach(card => {
    const suit = [...card.querySelectorAll('.idx-suit, .suit, .pip, .pip-big, .court-suit')]
      .find(visible);
    if (!suit) return;
    const r = card.getBoundingClientRect();
    out.mini.push({
      red: card.classList.contains('red'),
      suit: colourOf(suit),
      width: Math.round(r.width)
    });
  });

  return out;
};


(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  /* What actually got exercised. A hand is dealt at random, so a run can easily
   * contain no red card, no unplayable card or no card in the trick — and every
   * check about them then passes by doing nothing. Counted, and asserted on at
   * the end, because a check that never ran is not a check that passed. */
  const ran = { red: 0, black: 0, disabledRed: 0, mini: 0, signal: 0 };

  /* What this game is even capable of showing. Filled in from the first page
   * rather than assumed: cribbage has no trick, so `mini` can never be
   * exercised there and demanding it would be a permanent false failure. */
  const can = { mini: false };

  const rows = [];

  /* Several deals per combination. One deal is a random hand, and a random hand
   * routinely contains no red card, or no unplayable red card, so a single pass
   * leaves whole checks having quietly done nothing. Cheap to repeat, and the
   * coverage counters below say whether it worked. */
  for (const scheme of ['light', 'dark']) {
    for (const skin of ['traditional', 'plain']) {
      for (let deal = 0; deal < 4; deal++) {
        const page = await browser.newPage();
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        await page.setViewport({ width: 1280, height: 900 });

        /* Seeded, but differently per deal: repeatable across runs, and still
         * four different hands within one. An unseeded audit answers a slightly
         * different question every time it is asked. */
        await page.evaluateOnNewDocument(seed => {
          let s = seed;
          Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        }, 20260821 + deal * 7919);

        await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
        await page.evaluate(setupScript(drive, { skin }));
        await new Promise(r => setTimeout(r, 300));
        await pump(page, drive.playMid, { tries: 60 });

        const look = await page.evaluate(LOOK);
        const at = skin + ' / ' + scheme;
        if (look.hasTrick) can.mini = true;

        /* --- the skin the player asked for is the skin they got --- */
        const bodyHasSkin = /skin-traditional/.test(look.skin);
        check(bodyHasSkin === (skin === 'traditional'),
          at + ': choosing the ' + skin + ' skin left the body classed "' + look.skin +
          '" — a whole display mode silently not applying is exactly how the plain skin ' +
          'shipped broken once already');

        check(look.hand.length > 0, at + ': no cards rendered a visible suit glyph at all');

        /* --- hearts and diamonds are red, and clubs and spades are not --- */
        const reds = look.hand.filter(c => c.red);
        const blacks = look.hand.filter(c => !c.red);
        reds.forEach(c => c.suits.forEach(s => {
          ran.red++;
          check(isRedish(rgb(s.color)),
            at + ': ' + c.id + ' is a red suit but one of its glyphs renders ' + s.color +
            ' — a deck with black hearts is the sort of thing nobody files a bug about');
        }));
        ran.black += blacks.length;
        if (reds.length && blacks.length) {
          const r = reds[0].suit.color, b = blacks[0].suit.color;
          check(r !== b,
            at + ': red and black suits render in the same colour (' + r + '), so the two ' +
            'are told apart by shape alone');
        }

        /* --- a card you cannot play is still a card you can read ---
         *
         * The signal has been put ON the card three times now — translucency,
         * 45-degree hatching, greyscale — and each time it took the pips with
         * it. Greyscale is the measurable one: it collapses a red suit to the
         * same colour as a black one, so the deck stops having two colours. */
        look.hand.filter(c => c.red && c.disabled).forEach(c => {
          ran.disabledRed++;
          check(isRedish(rgb(c.suit.color)),
            at + ': ' + c.id + ' cannot be played and its red suit renders ' + c.suit.color +
            ' — knocking a card back must not cost it its colour');
        });

        /* No card may carry a filter, and none may have anything painted across
         * its face. Stated directly rather than inferred from a measurement,
         * because neither mechanism is visible in a computed colour: a greyscale
         * filter changes the pixels and nothing else, and the hatch lived in an
         * ::after that no colour reading would ever notice. Both have shipped. */
        look.hand.forEach(c => {
          check(c.filter === 'none',
            at + ': ' + c.id + ' is rendered through a CSS filter (' + c.filter + '). ' +
            'Filters flatten the red suits and dim the pips, and no colour measurement ' +
            'can see them — the signal has to go around the card, not on it');
          check(!c.overlay,
            at + ': ' + c.id + ' has something painted across its face (' + c.overlay + '). ' +
            'That is how the 45-degree hatch made the pips unreadable');
        });

        /* --- and there still has to BE a signal ---
         *
         * Deliberately not "the card is dropped 0.3rem", because the mechanism
         * has changed three times and pinning it would make this fail on the
         * next honest redesign. The requirement is only that a card you cannot
         * play looks different from one you can, in something other than the
         * glyphs. */
        {
          const on = look.hand.filter(c => !c.disabled);
          const off = look.hand.filter(c => c.disabled);
          if (on.length && off.length) {
            ran.signal++;
            check(on[0].look !== off[0].look,
              at + ': a card you cannot play looks exactly like one you can (' +
              on[0].look + '), so the only thing marking it is the label');
          }
        }

        /* --- a card already played is still readable --- */
        look.mini.forEach(m => {
          ran.mini++;
          check(m.suit.size >= 10,
            at + ': a card in the trick renders its suit at ' + m.suit.size.toFixed(1) +
            'px, which is too small to read');
          if (m.red) {
            check(isRedish(rgb(m.suit.color)),
              at + ': a red card in the trick renders ' + m.suit.color);
          }
        });

        if (deal === 0) {
          const miniNote = look.mini.length
            ? look.mini.length + ' played, suit ' + look.mini[0].suit.size.toFixed(1) + 'px'
            : (look.hasTrick ? 'nothing in the trick yet' : 'this game has no trick');
          rows.push(at.padEnd(24) + look.hand.length + ' in hand (' + reds.length +
            ' red), ' + miniNote);
        }

        await page.close();
      }
    }
  }
  await browser.close();

  console.log(drive.name);
  for (const r of rows) console.log('  ' + r);
  console.log('\nexercised: ' + ran.red + ' red suits, ' + ran.black + ' black, ' +
    ran.disabledRed + ' red on an unplayable card, ' + ran.mini + ' cards in the trick, ' +
    ran.signal + ' hands with both playable and blocked cards');

  /* A check that never ran is not a check that passed — unless the game cannot
   * do the thing at all, which is a different statement and gets said. */
  const WHY = {
    red: 'no red suit was ever rendered, so nothing checked that hearts are red',
    black: 'no black suit was ever rendered',
    disabledRed: 'no unplayable red card came up, so nothing checked that knocking a card back keeps its colour',
    mini: 'no card reached the trick, so nothing checked a played card is readable',
    signal: 'no hand ever held both a playable and an unplayable card, so nothing checked the two look different'
  };
  const notApplicable = [];
  Object.entries(WHY).forEach(([k, why]) => {
    if (ran[k]) return;
    if (k === 'mini' && !can.mini) { notApplicable.push('a trick (this game plays to a shared pile)'); return; }
    fails.push(why);
  });

  if (notApplicable.length) {
    console.log('not applicable to ' + drive.name + ': ' + notApplicable.join('; '));
  }

  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.log('\nFAILURES (' + uniq.length + '):');
    uniq.slice(0, 12).forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nBoth skins render as intended in both colour schemes.');
})().catch(e => { console.error('appearance: threw — ' + e.stack); process.exit(1); });

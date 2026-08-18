/* Rendered appearance: the things a person spotted by looking, turned into
 * something a machine can check.
 *
 * Three real bugs got through every other suite this year and all three were
 * caught by somebody opening a screenshot:
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
 *   node tests/appearance.js
 */
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
let puppeteer;
try { puppeteer = require(path.join(root, 'node_modules', 'puppeteer')); }
catch (e) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const isRedish = ([r, g, b]) => r > 90 && r > g * 1.6 && r > b * 1.4;

/* Get a game into the play phase and report what the cards actually look like. */
const LOOK = () => {
  const out = { hand: [], mini: [], skin: document.body.className };
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
      // Whatever the current mechanism is, these are where a "you cannot play
      // this" signal can live without being painted over the face.
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

async function play(page, skin) {
  await page.evaluate(s => {
    document.getElementById('opt-players').value = '5';
    document.getElementById('opt-pace').value = '0';
    document.getElementById('opt-skin').value = s;
    document.getElementById('opt-skin').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('setup-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, skin);
  await new Promise(r => setTimeout(r, 300));
  /* Stop mid-trick with cards still in hand. Playing on until the hand runs out
   * leaves nothing to measure, which is what made an earlier version of this
   * report "no cards rendered a visible suit glyph at all" on random runs. */
  for (let i = 0; i < 40; i++) {
    const done = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#actions button')];
      const pick = bs.find(b => /Pick up the blind/.test(b.textContent));
      if (pick) { pick.click(); return false; }
      const bury = bs.find(b => /^Bury /.test(b.textContent));
      if (bury) {
        const need = +bury.textContent.match(/of (\d+)/)[1];
        [...document.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
        [...document.querySelectorAll('#actions button')]
          .find(b => /^Bury /.test(b.textContent)).click();
        return false;
      }
      const plays = document.querySelectorAll('#trick .mini').length;
      const inHand = document.querySelectorAll('#hand .card').length;
      if (plays >= 2 && inHand >= 2) return true;
      if (inHand <= 2) return true;                 // do not play the hand dry
      const f = document.querySelector('#hand .card:not([aria-disabled="true"])');
      if (f) { f.click(); return false; }
      return true;
    });
    await new Promise(r => setTimeout(r, 80));
    if (done) break;
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  /* What actually got exercised. A hand is dealt at random, so a run can easily
   * contain no red card, no unplayable card or no card in the trick — and every
   * check about them then passes by doing nothing. Counted, and asserted on at
   * the end, because a check that never ran is not a check that passed. */
  const ran = { red: 0, black: 0, disabledRed: 0, mini: 0, signal: 0 };

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
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?cb=' + Date.now(),
        { waitUntil: 'load' });
      await play(page, skin);
      const look = await page.evaluate(LOOK);
      const at = skin + ' / ' + scheme;

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
      reds.forEach(c => c.suits.forEach(s => { ran.red++; check(isRedish(rgb(s.color)),
        at + ': ' + c.id + ' is a red suit but one of its glyphs renders ' + s.color +
        ' — a deck with black hearts is the sort of thing nobody files a bug about'); }));
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
       * 45-degree hatching, greyscale — and each time it took the pips with it.
       * Greyscale is the measurable one: it collapses a red suit to the same
       * colour as a black one, so the deck stops having two colours. */
      const offReds = look.hand.filter(c => c.red && c.disabled);
      offReds.forEach(c => { ran.disabledRed++; check(isRedish(rgb(c.suit.color)),
        at + ': ' + c.id + ' cannot be played and its red suit renders ' + c.suit.color +
        ' — knocking a card back must not cost it its colour'); });

      /* No card may carry a filter, and none may have anything painted across
       * its face. This is the rule stated directly rather than inferred from a
       * measurement, because neither mechanism is visible in a computed colour:
       * a greyscale filter changes the pixels and nothing else, and the hatch
       * lived in an ::after that no colour reading would ever notice. Both have
       * shipped. Neither should again. */
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
       * Deliberately not "the card is dropped 0.3rem", because the mechanism has
       * changed three times and pinning it would just make this fail on the next
       * honest redesign. The requirement is only that a card you cannot play
       * looks different from one you can, in something other than the glyphs. */
      {
        const on = look.hand.filter(c => !c.disabled);
        const off = look.hand.filter(c => c.disabled);
        if (on.length && off.length) {
          ran.signal++;
          check(on[0].look !== off[0].look,
            at + ': a card you cannot play renders identically to one you can (' +
            on[0].look + ') — the signal has gone entirely');
        }
      }

      /* --- a card played to the trick has to be readable at half the size --- */
      look.mini.forEach(m => {
        ran.mini++;
        check(m.suit.size >= 10,
          at + ': a card played to the trick shows its suit at ' + m.suit.size +
          'px, which is too small to tell a heart from a diamond');
        check(m.width >= 30 && m.width <= 120,
          at + ': a card in the trick is ' + m.width + 'px wide, which is outside anything sane');
      });

      if (deal === 0) {
        const miniNote = look.mini.length
          ? look.mini.length + ' played, suit ' + look.mini[0].suit.size.toFixed(1) + 'px'
          : 'minis not shown in this skin';
        console.log(at.padEnd(24) + look.hand.length + ' in hand (' + reds.length +
          ' red), ' + miniNote);
      }

      await page.close();
      }
    }
  }
  await browser.close();

  console.log('\nexercised: ' + ran.red + ' red suits, ' + ran.black + ' black, ' +
    ran.disabledRed + ' red on an unplayable card, ' + ran.mini + ' cards in the trick, ' + ran.signal + ' hands with both playable and blocked cards');
  Object.entries({
    red: 'no red suit was ever rendered, so nothing checked that hearts are red',
    black: 'no black suit was ever rendered',
    disabledRed: 'no unplayable red card came up, so nothing checked that knocking a card back keeps its colour',
    mini: 'no card reached the trick, so nothing checked a played card is readable',
    signal: 'no hand ever held both a playable and an unplayable card, so nothing checked the two look different'
  }).forEach(([k, why]) => { if (!ran[k]) fails.push(why); });

  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.log('\nFAILURES (' + uniq.length + '):');
    uniq.slice(0, 12).forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nBoth skins render as intended in both colour schemes.');
})();

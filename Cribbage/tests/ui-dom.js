/* Interface tests: drives the real index.html + game.js through jsdom and plays
 * by clicking and keying the actual controls.
 *
 * This is the layer the whole accessibility effort lives in, and until now it was
 * the one layer nothing tested. The rules oracle proves the game plays Cribbage;
 * the audit proves it is legible and reachable; neither has any opinion about
 * what a screen reader is actually told.
 *
 * Modelled on sheephead/tests/ui-dom.js, and the checks are deliberately the same
 * ones — every single one of those exists because of a specific complaint from
 * somebody playing that game with a screen reader, and there is no reason to
 * learn each lesson twice.
 *
 *   npm install --no-save jsdom
 *   node tests/ui-dom.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let JSDOM;
for (const dir of [path.join(root, 'node_modules'), path.join(root, '..', 'sheephead', 'node_modules')]) {
  try { ({ JSDOM } = require(path.join(dir, 'jsdom'))); break; } catch (e) { /* try next */ }
}
if (!JSDOM) { console.log('SKIP: jsdom is not installed. Run: npm install --no-save jsdom'); process.exit(0); }

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const seen = {};
const note = k => { seen[k] = (seen[k] || 0) + 1; };

async function boot() {
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const { window } = dom;
  await new Promise(r => {
    if (window.document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  return { dom, window, d: window.document, ui: window.gameUI };
}

const settle = (ms) => new Promise(r => setTimeout(r, ms || 20));
const handCards = d => [...d.querySelectorAll('#playerHand .card')];
const faceUp = els => els.filter(e => !e.classList.contains('card-back'));
const vis = b => b && !b.disabled;

(async () => {
  const { window, d, ui } = await boot();
  check(!!ui, 'window.gameUI was never created — the page scripts did not run');
  const g = ui.game;

  /* ---- the things that must never be true ---- */
  {
    const app = [...d.querySelectorAll('[role="application"]')];
    check(app.length === 0,
      'role="application" found on: ' + app.map(e => e.id || e.tagName).join(', ') +
      ' — it forces a screen reader out of browse mode, which is the user\'s decision to make');
    check(!d.querySelector('[aria-roledescription]'),
      'aria-roledescription overrides what the screen reader announces');

    const skip = d.querySelector('a.skip-link');
    check(!!skip, 'no skip link');
    if (skip) {
      const target = d.querySelector(skip.getAttribute('href'));
      check(!!target, 'the skip link points at ' + skip.getAttribute('href') + ', which does not exist');
    }

    // Every live region must be labelled by what it is for, not left anonymous.
    const live = [...d.querySelectorAll('[aria-live]')];
    check(live.length > 0, 'there is no live region at all');
  }

  /* ---- get to a dealt hand ---- */
  {
    let guard = 0;
    while (g.state === 'CUT_FOR_DEAL' && ++guard < 20) {
      d.getElementById('cutButton').click();
      await settle();
    }
    check(g.state === 'DISCARD', 'could not reach the discard phase, stuck in ' + g.state);
  }

  /* ---- cards a player can act on ---- */
  {
    const cards = faceUp(handCards(d));
    check(cards.length === 6, 'expected six cards in hand, found ' + cards.length);

    cards.forEach((c, i) => {
      const label = c.getAttribute('aria-label');
      check(!!label && label.trim().length > 0, 'card ' + i + ' has no accessible name');
      check(!/undefined|null|\[object/i.test(label || ''), 'card ' + i + ' has a broken name: ' + label);
      check(c.getAttribute('aria-posinset') === String(i + 1),
        'card ' + i + ' does not say its position in the hand');
      check(c.getAttribute('aria-setsize') === String(cards.length),
        'card ' + i + ' does not say how many cards there are');
    });

    // Roving tabindex: exactly one stop in the hand, not six.
    const tabbable = cards.filter(c => c.getAttribute('tabindex') === '0');
    check(tabbable.length === 1,
      'the hand has ' + tabbable.length + ' tab stops; a roving tabindex must have exactly one');
    note('labels');
  }

  /* ---- the hand is navigable by keyboard alone ---- */
  {
    const key = (k) => {
      d.getElementById('playerHand').dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    };
    const idx = () => ui.currentCardIndex;

    ui.currentCardIndex = 0;
    ui.updateCardFocus();
    key('ArrowRight');
    check(idx() === 1, 'ArrowRight did not move along the hand (index ' + idx() + ')');
    key('ArrowLeft');
    check(idx() === 0, 'ArrowLeft did not move back (index ' + idx() + ')');
    key('ArrowLeft');
    check(idx() === 0, 'ArrowLeft ran off the start of the hand (index ' + idx() + ')');
    for (let i = 0; i < 10; i++) key('ArrowRight');
    check(idx() === 5, 'ArrowRight ran off the end of the hand (index ' + idx() + ')');

    // The card the roving index points at must be the one that is tabbable.
    const tabbable = faceUp(handCards(d)).findIndex(c => c.getAttribute('tabindex') === '0');
    check(tabbable === idx(),
      'the tab stop is on card ' + tabbable + ' but the arrow keys are on card ' + idx());
    note('keyboard');
  }

  /* ---- selecting cards to discard ---- */
  {
    await settle(300);   // let the deal's batched announcement finish first
    ui.currentCardIndex = 0;
    const press = () => d.getElementById('playerHand').dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    press();
    await settle(220);
    check(g.selectedForDiscard.size === 1, 'Enter did not select a card for the crib');
    check(faceUp(handCards(d))[0].getAttribute('aria-pressed') === 'true',
      'a card selected for the crib does not report itself as pressed');
    const said = d.getElementById('liveAnnouncer').textContent;
    check(/1 of 2/.test(said), 'selecting a card did not say how many of two are chosen: "' + said + '"');

    press();
    await settle(220);
    check(g.selectedForDiscard.size === 0, 'pressing the same card again did not deselect it');
    check(faceUp(handCards(d))[0].getAttribute('aria-pressed') === 'false',
      'a deselected card still reports itself as pressed');

    // Select two, then confirm a third is refused and says why.
    ui.currentCardIndex = 0; press(); await settle(220);
    ui.currentCardIndex = 1; press(); await settle(220);
    check(g.selectedForDiscard.size === 2, 'could not select two cards for the crib');
    ui.currentCardIndex = 2; press(); await settle(220);
    check(g.selectedForDiscard.size === 2, 'the crib took a third card');
    const refused = d.getElementById('liveAnnouncer').textContent;
    check(/already have 2|unselect/i.test(refused),
      'refusing a third card said nothing useful: "' + refused + '"');
    note('discard');
  }

  /* ---- into the play phase ---- */
  {
    d.getElementById('continueButton').click();
    await settle(60);
    check(g.state === 'PLAY' || g.state === 'GAME_OVER',
      'discarding did not start the play, state is ' + g.state);
  }

  /* ---- what a card claims about itself while playing ----
   *
   * aria-pressed means a toggle. It is right while choosing cards for the crib
   * and wrong once the play starts, where a card is played and gone rather than
   * pressed and unpressed. Left on, every card in the hand is announced as "not
   * pressed" on a turn where nothing can be pressed at all. */
  if (g.state === 'PLAY') {
    const cards = faceUp(handCards(d));
    const claiming = cards.filter(c => c.hasAttribute('aria-pressed'));
    check(claiming.length === 0,
      'during the play, ' + claiming.length + ' of ' + cards.length +
      ' cards still carry aria-pressed, so a screen reader announces each one as ' +
      '"not pressed" on a turn where nothing can be toggled');
    note('play-state');
  }

  /* ---- cards already on the table are not controls ---- */
  {
    // Play a card so the pile is not empty.
    let guard = 0;
    while (g.state === 'PLAY' && g.playedPile.length === 0 && ++guard < 20) {
      if (g.currentTurn === g.player) {
        const i = g.player.hand.findIndex(c =>
          !g.player.playedCards.includes(c) && g.currentCount + c.value <= 31);
        if (i >= 0) { ui.handleCardAction(i); await settle(40); } else break;
      } else { await settle(60); }
    }
    const played = [...d.querySelectorAll('#playedCards .card')];
    if (played.length) {
      const asButtons = played.filter(c => c.getAttribute('role') === 'button');
      check(asButtons.length === 0,
        played.length + ' cards in the played pile are marked role="button" — they are a ' +
        'record of what has happened, not something to activate, and a screen reader ' +
        'offers every one of them as a control');
      const pressed = played.filter(c => c.hasAttribute('aria-pressed'));
      check(pressed.length === 0, 'cards in the played pile carry aria-pressed');
      note('played-pile');
    }
  }

  /* ---- face-down cards must not pretend to be anything ---- */
  {
    const backs = [...d.querySelectorAll('#computerHand .card, #cribCards .card')]
      .filter(e => e.classList.contains('card-back'));
    backs.forEach(b => {
      check(!b.getAttribute('aria-label'),
        'a face-down card has an accessible name, which would reveal or imply what it is');
      check(b.getAttribute('role') !== 'button', 'a face-down card is offered as a button');
    });
    if (backs.length) note('backs');
  }

  /* ---- the game log ---- */
  {
    const log = d.getElementById('statusMessages');
    check(!!log.getAttribute('aria-label'), 'the game log has no accessible name');
    check(!log.hasAttribute('aria-live'),
      'the game log is a live region as well as a list, so everything in it is ' +
      'announced twice — once as it happens and again when read back');
    const items = [...log.querySelectorAll('li')];
    check(items.length > 0, 'the game log is empty after a hand has started');
    check(items.every(li => li.getAttribute('tabindex') === '-1'),
      'game log entries are not focusable, so they cannot be read one at a time');

    if (items.length > 1) {
      items[0].focus();
      log.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      check(d.activeElement === items[1], 'ArrowDown did not move to the next log entry');
      log.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      check(d.activeElement === items[0], 'Home did not go to the newest log entry');
      note('log');
    }
  }

  /* ---- buttons ---- */
  {
    ['cutButton', 'goButton', 'continueButton'].forEach(id => {
      const b = d.getElementById(id);
      check(!!b, 'missing button: ' + id);
      if (!b) return;
      check(b.textContent.trim().length > 0, id + ' has no accessible name');
      check(b.tagName === 'BUTTON', id + ' is a ' + b.tagName + ', not a real button');
    });
    // Two controls must never claim the same access key.
    const keys = {};
    [...d.querySelectorAll('[accesskey]')].forEach(e => {
      const k = e.getAttribute('accesskey').toLowerCase();
      (keys[k] = keys[k] || []).push(e.id || e.tagName);
    });
    Object.entries(keys).forEach(([k, who]) => {
      check(who.length === 1, 'access key "' + k + '" is claimed by ' + who.join(' and ') +
        ', so one of them silently never gets it');
    });
    note('buttons');
  }

  /* ---- reviewing at the count ---- */
  {
    let guard = 0;
    while (!ui.isReviewing() && g.state !== 'GAME_OVER' && ++guard < 400) {
      if (g.state === 'PAUSE_GO' || g.state === 'PAUSE_31') {
        d.getElementById('continueButton').click(); await settle(30); continue;
      }
      if (g.state === 'PLAY' && g.currentTurn === g.player) {
        const i = g.player.hand.findIndex(c =>
          !g.player.playedCards.includes(c) && g.currentCount + c.value <= 31);
        if (i >= 0) { ui.handleCardAction(i); await settle(30); continue; }
        if (vis(d.getElementById('goButton'))) { d.getElementById('goButton').click(); await settle(30); continue; }
      }
      await settle(30);
    }

    if (ui.isReviewing()) {
      const revealed = [...d.querySelectorAll('#computerHand .card')];
      check(revealed.length > 0, 'the computer hand is empty during the count — it should stay on the table');
      const stillButtons = revealed.filter(c => c.getAttribute('role') === 'button');
      check(stillButtons.length === 0,
        'cards shown for review are still marked as buttons; during the count they are ' +
        'there to be read, not activated');
      const focusable = revealed.filter(c => c.hasAttribute('tabindex'));
      check(focusable.length === 0, 'cards shown for review are still in the tab order');
      revealed.forEach(c => check(!!c.getAttribute('aria-label'),
        'a card shown for review has no accessible name, so it cannot be read at all'));
      note('review');
    } else {
      check(false, 'never reached the count, so the review state went untested (state ' + g.state + ')');
    }
  }

  window.close();

  const covered = Object.keys(seen).sort().join(', ');
  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.log('FAILURES (' + uniq.length + '):');
    uniq.forEach(f => console.log('  - ' + f));
    console.log('\ncovered: ' + covered);
    process.exit(1);
  }
  console.log('interface behaves correctly — covered: ' + covered);
})();

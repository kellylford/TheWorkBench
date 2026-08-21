/* The real page, driven through a real DOM.
 *
 * Everything else in this directory tests the engine, the projection or the
 * room. None of them would notice if the interface never rendered a card, put
 * focus somewhere useless, or labelled a button with a lie. This one plays whole
 * hands by clicking the actual buttons in index.html and reads the actual
 * accessible names off them.
 *
 * The pacing is set to MANUAL for the whole run. That is not a convenience — a
 * timed pace makes the computer's turns arrive on a browser timer, so a test has
 * to sleep and hope, and a test that hopes is a test that goes flaky the first
 * time a machine is busy. On manual pacing every state change is caused by
 * something this file clicked.
 *
 * Needs jsdom. Skips cleanly without it so the pure-Node suites still run on a
 * bare checkout; CI installs it and then refuses to accept a skip.
 *
 *   npm install --no-save jsdom
 *   node tests/ui-dom.js
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP ui-dom: jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot() {
  /* The scripts are stripped and evaluated by hand rather than loaded by jsdom.
   * Loading them as resources needs a file:// origin, and a file:// origin has
   * no localStorage — which the settings layer uses on the first line it runs. */
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script src="[^"]*"><\/script>/g, '')
    .replace(/<script>SH\.UI\.init\(\);<\/script>/, '');

  const dom = new JSDOM(html, {
    url: 'https://example.org/euchre/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;

  /* SEEDED, for the same reason the layout suite is: a run that deals different
   * cards every time cannot assert what it covered. The counters at the bottom
   * of this file — did a bower come up, did the bidding reach round two, was an
   * unplayable card ever offered — are the whole point of it, and a counter that
   * depends on the shuffle is a counter that reports zero on the day nobody is
   * looking. The seed is chosen so the run reaches the cases it claims to.
   *
   * Set before the game scripts are evaluated, so the very first shuffle is
   * covered. */
  win.Math.random = (() => {
    let s = 20260821;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  })();

  /* jsdom has <dialog> but not showModal. The game only needs open/close and the
   * close event, and stubbing them here keeps the test about the game rather
   * than about jsdom's coverage. */
  const D = win.HTMLDialogElement;
  if (D) {
    D.prototype.showModal = function () { this.open = true; };
    D.prototype.show = function () { this.open = true; };
    D.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new win.Event('close'));
    };
  }

  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js',
    'js/table.js', 'js/net.js', 'js/localserver.js', 'js/ui.js']) {
    win.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  }
  win.SH.UI.init();
  return win;
}

function $(win, id) { return win.document.getElementById(id); }
function cards(win) { return Array.from($(win, 'hand').querySelectorAll('.card')); }
function actionButtons(win) { return Array.from($(win, 'actions').querySelectorAll('button')); }

function buttonStarting(win, text) {
  return actionButtons(win).find(b => b.textContent.trim().toLowerCase().startsWith(text.toLowerCase()));
}

function label(el) { return el.getAttribute('aria-label') || el.textContent; }

async function main() {
  const win = boot();
  const doc = win.document;
  const SH = win.SH;
  const G = SH.Game, C = SH.Cards;
  const T = SH.UI._test;

  /* ---- start a game, on manual pacing ---- */
  $(win, 'opt-name').value = 'You';
  $(win, 'opt-pace').value = '-1';
  $(win, 'opt-difficulty').value = 'hard';
  $(win, 'opt-alone-rule').checked = true;
  $(win, 'opt-stick').checked = false;
  $(win, 'opt-points').value = '10';
  $(win, 'setup-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  check($(win, 'game-section').hidden === false, 'the game screen never appeared');
  check($(win, 'setup-section').hidden === true, 'the setup screen was left on show');
  check(T.view() !== null, 'no view reached the interface');

  /* ---- play ---- */
  const seen = { bid1: 0, bid2: 0, discard: 0, play: 0, handOver: 0, alone: 0, sittingOut: 0 };
  let handsDone = 0;
  let bowerLabelled = false;
  let illegalRefused = false;
  let discardTested = false;
  let aloneRelabelTested = false;
  /* Going alone is left to chance in an ordinary run, and on most runs it simply
   * does not come up — which quietly leaves the whole sitting-out path
   * unexercised while the suite reports green. So the first hand where we hold
   * enough trump to make it sensible, we declare. */
  let alonePlayed = false;
  let guard = 0;

  /* PLAY UNTIL THE RUN HAS COVERED WHAT IT CLAIMS TO, not for a fixed number of
   * hands.
   *
   * Twelve hands and a seeded shuffle made this repeatable on one machine and
   * not on another: the same seed produced a deal that reached the second round
   * of bidding locally and never reached it on CI, so the coverage assertion at
   * the bottom failed on a green tree. Seeding is still right — it makes a
   * failure reproducible — but a seed cannot promise a particular case turns up,
   * and asserting that it does is asserting something about the shuffle rather
   * than about the game.
   *
   * Round two happens when all four players pass, which this test cannot force
   * because three of the four are the computer. So: keep dealing until it has
   * happened, with a cap. Thirty hands with nobody ever passing the upcard round
   * IS worth failing on — that would mean the bidding was broken. */
  const MIN_HANDS = 12, MAX_HANDS = 30;
  while (guard++ < 20000) {
    if (handsDone >= MAX_HANDS) break;
    if (handsDone >= MIN_HANDS && seen.bid2 > 0) break;
    const v = T.view();
    if (!v) break;
    seen[v.phase] = (seen[v.phase] || 0) + 1;
    if (v.alone) seen.alone++;
    if (v.sittingOut >= 0) seen.sittingOut++;

    /* Every card in our hand always has a real accessible name that names the
     * card. A button whose label is its own class list is the commonest way a
     * game like this becomes unplayable by ear. */
    for (const [i, el] of cards(win).entries()) {
      const id = el.dataset.id;
      const nm = C.name(C.get(id));
      const lab = label(el);
      check(lab.indexOf(nm) === 0,
        `card ${i + 1} is labelled "${lab}" and should start with "${nm}"`);
      check(/card \d+ of \d+/.test(lab), `card ${i + 1} does not say where it is in the hand: ${lab}`);
      if (v.trump && C.bower(C.get(id), v.trump)) {
        bowerLabelled = true;
        check(/bower/.test(lab), `a bower is not named as one: ${lab}`);
      }
    }

    if (v.phase === 'handOver') {
      handsDone++;
      check($(win, 'deal-section').hidden === false,
        'the upcard and kitty were not revealed at the end of the hand');
      const revealed = $(win, 'deal-cards').querySelectorAll('.card');
      check(revealed.length >= 4,
        'only ' + revealed.length + ' cards were laid out at the end of the hand');
      for (const el of revealed) {
        check((el.getAttribute('aria-label') || '').length > 4,
          'a revealed card has no accessible name');
      }
      /* The outcome, in one sentence, and it has to READ as one. A number spelled
       * out in words at the start of a clause ("took five tricks. two points to
       * you") is what a screen reader is handed if nothing capitalises it, and
       * some voices run it into the sentence before. */
      const headline = $(win, 'actions').querySelector('.result-headline');
      check(!!headline && headline.textContent.length > 20, 'the hand ended with no result sentence');
      for (const part of headline.textContent.split('. ')) {
        const t = part.trim();
        if (!t) continue;
        check(t[0] === t[0].toUpperCase(),
          'a sentence in the result headline starts in lower case: ' + headline.textContent);
      }

      const deal = buttonStarting(win, 'Deal next hand') || buttonStarting(win, 'Start a new game');
      check(!!deal, 'there was no way to deal the next hand');
      deal.click();
      continue;
    }

    const mine = v.turn === T.seat();
    const myDiscard = v.phase === 'discard' && v.dealer === T.seat();

    if (v.phase === 'bid1' && mine) {
      const cb = $(win, 'bid-alone');
      /* The go-alone checkbox rewrites the label of the button beside it. A
       * control whose meaning is set somewhere else and not repeated is a
       * control you have to remember the state of. */
      if (cb && !aloneRelabelTested) {
        aloneRelabelTested = true;
        const order = actionButtons(win).find(b => /order it up|take it up/i.test(b.textContent));
        check(!!order, 'there is no way to order up the upcard');
        const before = order.textContent;
        check(!/go alone/i.test(before), 'the order button claimed to go alone before it was asked to');
        cb.checked = true;
        cb.dispatchEvent(new win.Event('change', { bubbles: true }));
        check(/go alone/i.test(order.textContent),
          'ticking "go alone" did not change what the button says it will do: ' + order.textContent);
        cb.checked = false;
        cb.dispatchEvent(new win.Event('change', { bubbles: true }));
        check(order.textContent === before, 'unticking "go alone" did not put the label back');
      }
      /* Order it up when the upcard suit is worth anything, otherwise pass, so
       * the run reaches both rounds of bidding. */
      const trumpish = v.players[T.seat()].hand
        .filter(c => C.isTrump(C.get(c.id), v.upcard.s)).length;
      /* Deliberately not waiting for a good hand. Going alone on a thin one gets
       * us euchred, which is fine — the point is to walk the interface through a
       * hand where a seat is out of play, and a run that never does that has
       * left the whole path untested while reporting green. */
      if (!alonePlayed && cb && (trumpish >= 2 || (!discardTested && v.dealer === T.seat()))) {
        alonePlayed = true;
        cb.checked = true;
        cb.dispatchEvent(new win.Event('change', { bubbles: true }));
        actionButtons(win).find(b => /order it up|take it up/i.test(b.textContent)).click();
        const after = T.view();
        check(after.alone === true, 'ticking "go alone" and ordering up did not go alone');
        check(after.sittingOut === G.partnerOf(T.seat()),
          'going alone did not sit our partner out');
        /* And the table says so, in the row for the seat it happened to. */
        const rows = Array.from($(win, 'players-table').querySelectorAll('tbody tr'));
        const partnerRow = rows[G.partnerOf(T.seat())];
        check(/sitting out/i.test(partnerRow.textContent),
          'the players table does not say our partner is sitting out: ' + partnerRow.textContent);
        /* The Cards column says "out" rather than a number. Five cards printed
         * beside a seat that is not in the hand is a number that means nothing,
         * and it is read out on every pass through the table. */
        check(partnerRow.cells[3].textContent.trim().toLowerCase() === 'out',
          'the sitting-out seat still shows a card count of ' +
          partnerRow.cells[3].textContent);
        continue;
      }
      /* If we are the dealer, take it up whatever we hold, until the discard has
       * been exercised at least once. Waiting for it to happen by chance leaves
       * the whole six-card path untested on most runs, and the discard is the
       * one place in euchre where the interface has to hold a card back that
       * nobody else may see. */
      const forceDiscard = !discardTested && v.dealer === T.seat();
      const btn = (trumpish >= 2 || forceDiscard)
        ? actionButtons(win).find(b => /order it up|take it up/i.test(b.textContent))
        : buttonStarting(win, 'Pass');
      check(!!btn, 'no bidding button was offered on our turn');
      btn.click();
      continue;
    }

    if (v.phase === 'bid2' && mine) {
      const pass = buttonStarting(win, 'Pass');
      const names = actionButtons(win).filter(b => /^name /i.test(b.textContent));
      check(names.length === 3 || (!pass && names.length === 3),
        'round two offered ' + names.length + ' suits instead of three');
      for (const b of names) {
        check(!new RegExp(C.SUIT_NAME[v.deniedSuit], 'i').test(b.textContent),
          'the turned-down suit was offered: ' + b.textContent);
      }
      const best = names.find(b => {
        const suit = ['C', 'S', 'H', 'D'].find(s =>
          new RegExp(C.SUIT_NAME[s], 'i').test(b.textContent));
        return v.players[T.seat()].hand.filter(c => C.isTrump(C.get(c.id), suit)).length >= 3;
      });
      (best || pass || names[0]).click();
      continue;
    }

    if (myDiscard) {
      const hand = cards(win);
      check(hand.length === 6, 'the dealer has ' + hand.length + ' cards to discard from, not 6');
      const put = buttonStarting(win, 'Put back');
      check(!!put, 'there was no button to put a card back');
      check(put.disabled === true, 'the put-back button was live before a card was chosen');

      /* The card taken from the top of the kitty is at the front of the hand and
       * says so, because a six card hand that all looks alike is exactly where a
       * dealer discards the card they meant to keep. */
      check(hand[0].dataset.id === v.upcard.id,
        'the card the dealer took is not at the front of the hand');
      check(/took from the top of the kitty/.test(label(hand[0])),
        'the card the dealer took is not marked in its label: ' + label(hand[0]));

      const chosen = hand[2].dataset.id;
      hand[2].click();
      /* Re-queried, not reused. Selecting a card re-renders the hand, so the
       * element clicked a moment ago is detached and reading an attribute off it
       * reports the state of a node that is no longer on the page. */
      const chosenNow = cards(win).find(el => el.dataset.id === chosen);
      check(!!chosenNow, 'the card chosen to put back vanished from the hand');
      check(chosenNow.getAttribute('aria-pressed') === 'true',
        'the chosen card is not marked pressed');
      check(/selected to put back/.test(label(chosenNow)),
        'the chosen card does not say it is selected: ' + label(chosenNow));
      const put2 = buttonStarting(win, 'Put back');
      check(put2.disabled === false, 'choosing a card did not make the put-back button usable');
      check(put2.textContent.indexOf(C.name(C.get(chosen))) >= 0,
        'the put-back button does not name the card it will put back: ' + put2.textContent);

      /* Choosing a second card replaces the first rather than adding to it —
       * exactly one card goes back. */
      const hand2 = cards(win);
      const other = hand2.find(el => el.dataset.id !== chosen);
      other.click();
      const pressed = cards(win).filter(el => el.getAttribute('aria-pressed') === 'true');
      check(pressed.length === 1, pressed.length + ' cards were selected to put back at once');

      discardTested = true;
      buttonStarting(win, 'Put back').click();
      check(cards(win).length === 5, 'the dealer still has ' + cards(win).length + ' cards after discarding');
      continue;
    }

    if (v.phase === 'play' && mine && v.sittingOut !== T.seat()) {
      const legalIds = G.legalPlays(v, T.seat()).map(c => c.id);
      const hand = cards(win);
      check(hand.length > 0, 'it is our turn to play and the hand is empty');

      /* Focus must be on a card that can actually be played. Landing a keyboard
       * user on a card the rules have already ruled out means their first
       * keypress is refused. */
      const focused = doc.activeElement;
      if (focused && focused.classList && focused.classList.contains('card')) {
        check(legalIds.indexOf(focused.dataset.id) >= 0,
          'focus landed on a card that cannot be played: ' + label(focused));
      }

      for (const el of hand) {
        const legal = legalIds.indexOf(el.dataset.id) >= 0;
        if (legal) {
          check(el.getAttribute('aria-disabled') !== 'true',
            'a playable card is marked disabled: ' + label(el));
        } else {
          check(el.getAttribute('aria-disabled') === 'true',
            'an unplayable card is not marked disabled: ' + label(el));
          check(/cannot be played, /.test(label(el)),
            'an unplayable card does not say why: ' + label(el));
          check(!/cannot be played, *$/.test(label(el)),
            'an unplayable card gives an empty reason: ' + label(el));
        }
      }

      /* A card the rules forbid must refuse to be played, not merely look
       * disabled — aria-disabled is advisory and a mouse can still reach it. */
      const bad = hand.find(el => legalIds.indexOf(el.dataset.id) < 0);
      if (bad && !illegalRefused) {
        illegalRefused = true;
        const before = v.trick.length;
        bad.click();
        check(T.view().trick.length === before,
          'a card that cannot be played was played anyway: ' + label(bad));
      }

      const play = hand.find(el => legalIds.indexOf(el.dataset.id) >= 0);
      play.click();
      continue;
    }

    /* Not our turn. Manual pacing means the table moves when we say so. */
    const cont = buttonStarting(win, 'Continue');
    if (cont) { cont.click(); continue; }

    /* Sitting out, or waiting with no button: nudge with the N key, which is the
     * documented way to advance. */
    const adv = $(win, 'actions').querySelector('button[data-advance]');
    if (adv) { adv.click(); continue; }
    break;
  }

  check(handsDone >= MIN_HANDS,
    'only ' + handsDone + ' hands were played through the interface');
  check(seen.bid1 > 0 && seen.play > 0, 'the run never reached bidding or play');
  check(seen.bid2 > 0,
    'the second round of bidding never came up in ' + handsDone + ' hands — either the ' +
    'computer orders up absolutely everything, or the upcard round never ends');
  check(discardTested, 'the discard was never exercised');
  check(illegalRefused, 'no unplayable card ever came up, so that path is untested');
  check(bowerLabelled, 'no bower was ever in our hand, so the labelling is untested');
  check(aloneRelabelTested, 'the go-alone toggle was never exercised');
  check(alonePlayed, 'no hand was ever played alone, so the sitting-out path is untested');
  check(seen.sittingOut > 0, 'the interface never rendered a hand with somebody sitting out');

  /* ---- the review keys, at every phase we saw ---- */
  for (const what of ['hand', 'trick', 'last', 'score', 'bidding', 'count', 'order', 'who']) {
    let text = null;
    try {
      const before = $(win, 'announcer').textContent;
      T.say(what);
      await sleep(150);
      text = $(win, 'announcer').textContent;
      check(typeof text === 'string' && text.length > 10,
        'the "' + what + '" review key said nothing useful: ' + JSON.stringify(text));
      check(text !== before || before === '', 'the "' + what + '" review key repeated the last message');
    } catch (e) {
      fails.push('the "' + what + '" review key threw: ' + e.message);
      checks++;
    }
  }

  /* ---- the log ---- */
  {
    const items = Array.from($(win, 'log').children);
    check(items.length > 20, 'the game log only has ' + items.length + ' entries');
    check(items[0].tabIndex === 0, 'the newest log entry is not focusable');
    check(items.every(li => li.textContent.trim().length > 0), 'a log entry is empty');
    /* The log must not be a live region: it is read back at leisure, and a live
     * region would speak every entry as it lands and then again when read. */
    const logEl = $(win, 'log');
    check(!logEl.getAttribute('aria-live'), 'the game log is a live region');
    check(logEl.getAttribute('role') !== 'log' && logEl.getAttribute('role') !== 'alert',
      'the game log has a live role');
  }

  /* ---- the tables ---- */
  {
    const rows = $(win, 'players-table').querySelectorAll('tbody tr');
    check(rows.length === 4, 'the players table has ' + rows.length + ' rows');
    const you = Array.from(rows).filter(r => /\(you\)/.test(r.textContent));
    check(you.length === 1, you.length + ' rows are marked as you');
    const scoreRows = $(win, 'score-table').querySelectorAll('tbody tr');
    check(scoreRows.length === 2, 'the score table has ' + scoreRows.length + ' rows');
    check(/\(you\)/.test(scoreRows[0].textContent), 'the score table does not say which side you are on');
    /* Every table has a caption, because a screen reader announces it on entry
     * and "table with five columns" is not a description of anything. */
    for (const id of ['players-table', 'score-table']) {
      const cap = $(win, id).querySelector('caption');
      check(cap && cap.textContent.trim().length > 20, id + ' has no useful caption');
    }
  }

  /* ---- nothing decorative is exposed twice ---- */
  {
    const seats = $(win, 'seats');
    check(seats.getAttribute('aria-hidden') === 'true',
      'the decorative seats are exposed to assistive technology as well as the players table');
    let unhidden = 0;
    for (const el of cards(win)) {
      for (const child of el.children) {
        if (child.getAttribute('aria-hidden') !== 'true') unhidden++;
      }
    }
    check(unhidden === 0, unhidden + ' pieces of card decoration are not hidden from a screen reader');
    /* And nothing anywhere claims to be an application, which would take browse
     * mode away from the reader without asking. */
    check(doc.querySelectorAll('[role="application"]').length === 0,
      'something on the page is marked role="application"');
  }

  /* ---- the audit ---- */
  {
    const truth = SH.Table.localState();
    check(truth !== null, 'the local game is not reachable for the audit');
    check(truth.history.length >= 12, 'only ' + truth.history.length + ' hands were recorded');
    for (const h of truth.history) {
      check(h.problems.length === 0,
        'hand ' + h.handNumber + ' failed its audit: ' + h.problems.join('; '));
    }
    /* And the export writes them all out. */
    $(win, 'btn-export').click();
    const text = $(win, 'export-text').value;
    check(text.length > 500, 'the exported log is only ' + text.length + ' characters');
    check(/Euchre — game log/.test(text), 'the export has no header');
    check((text.match(/--- Hand /g) || []).length >= 8, 'the export is missing hands');
    $(win, 'export-close').click();
  }

  console.log('ui-dom: ' + checks.toLocaleString() + ' assertions, ' + handsDone + ' hands played ' +
    'by clicking');
  console.log('  reached: ' + Object.entries(seen).map(([k, v]) => k + ' ' + v).join(', '));

  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 25)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('ui-dom: OK');
  process.exit(0);
}

main().catch(e => { console.error('ui-dom: threw — ' + e.stack); process.exit(1); });

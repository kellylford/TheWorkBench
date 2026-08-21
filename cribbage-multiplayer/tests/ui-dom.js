/* The real page, driven through a real DOM.
 *
 * Everything else in this directory tests the engine, the projection or the
 * room. None of them would notice if the interface never rendered a card, put
 * focus somewhere useless, or labelled a button with a lie. This one plays whole
 * hands by clicking the actual buttons in index.html and reads the actual
 * accessible names off them.
 *
 * Pacing is MANUAL throughout. A timed pace makes the computer's turns arrive on
 * a browser timer, so a test has to sleep and hope, and a test that hopes is a
 * test that goes flaky the first time a machine is busy.
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
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script src="[^"]*"><\/script>/g, '')
    .replace(/<script>SH\.UI\.init\(\);<\/script>/, '');
  const dom = new JSDOM(html, {
    url: 'https://example.org/cribbage-multiplayer/',
    pretendToBeVisual: true, runScripts: 'outside-only'
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
  const D = win.HTMLDialogElement;
  if (D) {
    D.prototype.showModal = function () { this.open = true; };
    D.prototype.show = function () { this.open = true; };
    D.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
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
function findBtn(win, re) { return actionButtons(win).find(b => re.test(b.textContent)); }
function label(el) { return el.getAttribute('aria-label') || el.textContent; }

async function main() {
  const win = boot();
  const doc = win.document;
  const SH = win.SH;
  const G = SH.Game, C = SH.Cards;
  const T = SH.UI._test;

  $(win, 'opt-name').value = 'You';
  $(win, 'opt-pace').value = '-1';
  $(win, 'opt-difficulty').value = 'hard';
  $(win, 'opt-target').value = '61';
  $(win, 'setup-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  check($(win, 'game-section').hidden === false, 'the game screen never appeared');
  check(T.view() !== null, 'no view reached the interface');
  check(T.view().phase === 'cutForDeal', 'the game did not start at the cut for deal');

  const seen = { cutForDeal: 0, discard: 0, play: 0, count: 0, roundOver: 0, gameOver: 0 };
  let hands = 0, guard = 0;
  let goTested = false, illegalRefused = false, cribHiddenSeen = false, cribShownSeen = false;
  let arithmeticSeen = false, scoringLabelSeen = false;

  while (hands < 12 && guard++ < 8000) {
    const v = T.view();
    if (!v) break;
    seen[v.phase] = (seen[v.phase] || 0) + 1;

    /* Every card in our hand always has an accessible name that names the card
     * and says where it is. A button labelled with its own class list is the
     * commonest way a game like this becomes unplayable by ear. */
    for (const [i, elc] of cards(win).entries()) {
      const nm = C.name(C.get(elc.dataset.id));
      const lab = label(elc);
      check(lab.indexOf(nm) === 0, `card ${i + 1} is labelled "${lab}", should start "${nm}"`);
      check(/card \d+ of \d+/.test(lab), `card ${i + 1} does not say where it is: ${lab}`);
    }

    if (v.phase === 'cutForDeal') {
      const b = findBtn(win, /Cut for deal/);
      check(!!b, 'there was no way to cut for deal');
      b.click();
      continue;
    }

    if (v.phase === 'discard') {
      /* The crib is face down and the interface says so — including to the
       * dealer, whose crib it is. */
      const note = $(win, 'crib-note').textContent;
      if (v.cribCount === 0) {
        check(/Nothing in the crib/.test(note), 'the crib note is wrong before anything is thrown');
      }
      if (!v.players[T.seat()].hasDiscarded) {
        const hand = cards(win);
        check(hand.length === 6, 'the hand has ' + hand.length + ' cards at the discard, not 6');
        const b0 = findBtn(win, /^Throw/);
        check(!!b0 && b0.disabled, 'the throw button was live before two cards were chosen');
        hand[0].click();
        const one = findBtn(win, /^Throw/);
        check(one.disabled, 'the throw button went live after only one card');
        cards(win)[1].click();
        const two = findBtn(win, /^Throw/);
        check(!two.disabled, 'choosing two cards did not make the throw button usable');
        check(two.textContent.indexOf(' and ') > 0,
          'the throw button does not name both cards: ' + two.textContent);
        /* A third selection is refused rather than silently replacing one. */
        const before = cards(win).filter(x => x.getAttribute('aria-pressed') === 'true').length;
        cards(win)[2].click();
        const after = cards(win).filter(x => x.getAttribute('aria-pressed') === 'true').length;
        check(before === 2 && after === 2, 'a third card was selected for a two-card throw');
        findBtn(win, /^Throw/).click();
      } else {
        /* Waiting for the other player — the one genuinely simultaneous moment
         * in the game, and the interface has to say so rather than looking
         * stuck. */
        const status = $(win, 'status').textContent;
        check(/Waiting for/.test(status),
          'the interface does not say it is waiting for the other player: ' + status);
        const cont = findBtn(win, /Continue/);
        if (cont) cont.click(); else break;
      }
      continue;
    }

    if (v.phase === 'play') {
      cribHiddenSeen = true;
      check($(win, 'crib-note').textContent.indexOf('Neither of you may look') > 0,
        'the crib note does not say the crib is hidden from both players');
      check($(win, 'starter-section').hidden === false, 'the starter is not shown during the play');
      check($(win, 'count-line').textContent === 'Count: ' + v.count,
        'the running count on screen is wrong: ' + $(win, 'count-line').textContent);

      if (v.turn !== T.seat()) {
        const cont = findBtn(win, /Continue/);
        if (cont) { cont.click(); continue; }
        break;
      }

      const legal = G.legalPlays(v, T.seat()).map(c => c.id);
      const hand = cards(win);

      /* THE ARITHMETIC, IN THE LABEL. A sighted player reads the count and their
       * cards and knows in a second what each one makes. */
      for (const elc of hand) {
        const lab = label(elc);
        const card = C.get(elc.dataset.id);
        const to = v.count + C.value(card);
        if (legal.indexOf(elc.dataset.id) >= 0) {
          check(elc.getAttribute('aria-disabled') !== 'true',
            'a playable card is marked disabled: ' + lab);
          check(lab.indexOf('makes ' + to) > 0,
            'a playable card does not say what count it makes: ' + lab);
          arithmeticSeen = true;
          const pts = G.pointsForPlay(v, card);
          if (pts.total) {
            scoringLabelSeen = true;
            check(/and scores /.test(lab), 'a scoring card does not say what it scores: ' + lab);
          }
        } else {
          check(elc.getAttribute('aria-disabled') === 'true',
            'an unplayable card is not marked disabled: ' + lab);
          check(/cannot be played, /.test(lab), 'an unplayable card does not say why: ' + lab);
          check(/past thirty-one/.test(lab),
            'an unplayable card gives the wrong reason: ' + lab);
        }
      }

      /* A card the rules forbid must refuse to be played, not merely look
       * disabled — aria-disabled is advisory and a mouse can still reach it.
       *
       * CHECKED BEFORE THE GO BRANCH BELOW, and that ordering is the whole
       * point. The first draft looked for an unplayable card only after handling
       * a hand with nothing playable — so the one position where EVERY card is
       * unplayable, which is the commonest way to meet one, was skipped, and the
       * run reported that no unplayable card had ever come up. */
      const bad = hand.find(x => legal.indexOf(x.dataset.id) < 0);
      if (bad && !illegalRefused) {
        illegalRefused = true;
        const pileBefore = T.view().pile.length;
        bad.click();
        check(T.view().pile.length === pileBefore,
          'a card that would pass thirty-one was played anyway: ' + label(bad));
      }

      if (!legal.length) {
        goTested = true;
        const g = findBtn(win, /Say go/);
        check(!!g, 'there was no way to say go with an unplayable hand');
        g.click();
        continue;
      }

      const focused = doc.activeElement;
      if (focused && focused.classList && focused.classList.contains('card')) {
        check(legal.indexOf(focused.dataset.id) >= 0,
          'focus landed on a card that cannot be played: ' + label(focused));
      }

      hand.find(x => legal.indexOf(x.dataset.id) >= 0).click();
      continue;
    }

    if (v.phase === 'count') {
      if (v.turn !== T.seat()) {
        const cont = findBtn(win, /Continue/);
        if (cont) { cont.click(); continue; }
        break;
      }
      const b = findBtn(win, /Count my/);
      check(!!b, 'there was no way to count at the count');
      check(/Count my (hand|crib)/.test(b.textContent),
        'the count button does not say what is being counted: ' + b.textContent);
      b.click();
      continue;
    }

    if (v.phase === 'roundOver' || v.phase === 'gameOver') {
      hands++;
      /* Once the crib has been counted it is face up, and every card in it is
       * named. */
      if (v.crib.length) {
        cribShownSeen = true;
        const shown = $(win, 'crib').querySelectorAll('.card');
        check(shown.length === 4, 'the crib was not laid out at the end of the hand');
        for (const elc of shown) {
          check((elc.getAttribute('aria-label') || '').length > 4,
            'a crib card has no accessible name');
        }
      }
      const b = findBtn(win, /Deal the next hand|Start a new game/);
      check(!!b, 'there was no way to deal the next hand');
      b.click();
      continue;
    }

    break;
  }

  check(hands >= 12, 'only ' + hands + ' hands were played through the interface');
  check(seen.play > 0 && seen.count > 0, 'the run never reached the play or the count');
  check(arithmeticSeen, 'no card was ever labelled with the count it would make');
  check(scoringLabelSeen, 'no scoring card ever came up, so that labelling is untested');
  check(illegalRefused, 'no unplayable card ever came up, so that path is untested');
  check(goTested, 'the go path was never exercised');
  check(cribHiddenSeen && cribShownSeen, 'the crib was never seen both hidden and revealed');

  /* ---- the review keys ---- */
  for (const what of ['hand', 'play', 'score', 'position', 'count', 'who']) {
    const before = $(win, 'announcer').textContent;
    try {
      T.say(what);
      await sleep(150);
      const text = $(win, 'announcer').textContent;
      check(typeof text === 'string' && text.length > 10,
        'the "' + what + '" review key said nothing useful: ' + JSON.stringify(text));
      check(text !== before || before === '', 'the "' + what + '" key repeated the last message');
    } catch (e) {
      fails.push('the "' + what + '" review key threw: ' + e.message);
      checks++;
    }
  }

  /* ---- structure ---- */
  {
    const items = Array.from($(win, 'log').children);
    check(items.length > 20, 'the game log only has ' + items.length + ' entries');
    check(items[0].tabIndex === 0, 'the newest log entry is not focusable');
    const logEl = $(win, 'log');
    check(!logEl.getAttribute('aria-live'), 'the game log is a live region');

    /* The board is decoration; the score table is the truth. */
    check($(win, 'board').getAttribute('aria-hidden') === 'true',
      'the pegged board is exposed to assistive technology as well as the score table');
    const rows = $(win, 'score-table').querySelectorAll('tbody tr');
    check(rows.length === 2, 'the score table has ' + rows.length + ' rows');
    check(/\(you\)/.test(rows[0].textContent), 'the score table does not mark your own row');
    const cap = $(win, 'score-table').querySelector('caption');
    check(cap && cap.textContent.trim().length > 20, 'the score table has no useful caption');

    let unhidden = 0;
    for (const elc of cards(win)) {
      for (const child of elc.children) {
        if (child.getAttribute('aria-hidden') !== 'true') unhidden++;
      }
    }
    check(unhidden === 0, unhidden + ' pieces of card decoration are not hidden');
    check(doc.querySelectorAll('[role="application"]').length === 0,
      'something on the page is marked role="application"');
  }

  /* ---- the audit and the export ---- */
  {
    const truth = SH.Table.localState();
    check(truth !== null, 'the local game is not reachable for the audit');
    check(truth.history.length >= 12, 'only ' + truth.history.length + ' hands were recorded');
    for (const h of truth.history) {
      check(h.problems.length === 0,
        'hand ' + h.handNumber + ' failed its audit: ' + h.problems.join('; '));
    }
    $(win, 'btn-export').click();
    const text = $(win, 'export-text').value;
    check(/Cribbage — game log/.test(text), 'the export has no header');
    check((text.match(/--- Hand /g) || []).length >= 12, 'the export is missing hands');
    check(/Starter/.test(text), 'the export does not record the starter');
    check(/Crib/.test(text), 'the export does not record the crib');
    $(win, 'export-close').click();
  }

  console.log('ui-dom: ' + checks.toLocaleString() + ' assertions, ' + hands +
    ' hands played by clicking');
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

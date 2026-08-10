/* DOM-level tests for the interface: drives the real index.html + ui.js through
 * jsdom and plays complete hands by clicking the actual buttons.
 *
 * Requires jsdom:  npm install --no-save jsdom
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('SKIP: jsdom is not installed. Run: npm install --no-save jsdom');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* Let jsdom load the page's own <script> tags, so the scripts run in document
 * order and DOMContentLoaded fires normally — injecting them by hand afterwards
 * means ui.js never gets its listeners attached. */
async function boot(opts) {
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

  // jsdom does not implement <dialog>; stub only what ui.js touches.
  ['rules-dialog', 'a11y-dialog', 'export-dialog', 'bug-dialog'].forEach(id => {
    const dlg = window.document.getElementById(id);
    if (typeof dlg.showModal !== 'function') { dlg.showModal = () => { dlg.open = true; }; dlg.close = () => { dlg.open = false; }; }
  });

  const d = window.document;
  check(typeof window.SH === 'object', 'game scripts did not load');
  // Opponents get crew names, all different, and never the player's own name.
  const seats = [...d.querySelectorAll('#players-table tbody tr th')].map(t => t.textContent);
  if (seats.length) {
    const opps = seats.slice(1);
    check(new Set(opps).size === opps.length, 'two opponents share a name: ' + opps.join(', '));
    check(!opps.some(o => /^You/.test(o)), 'an opponent is named after the player: ' + opps.join(', '));
    check(opps.every(o => /^[A-Z]/.test(o)), 'odd opponent name: ' + opps.join(', '));
  }

  // Help is two separate experiences: game rules, and accessibility guidance.
  {
    const rules = d.getElementById('rules-dialog');
    const a11y = d.getElementById('a11y-dialog');
    const rulesText = rules.textContent;
    const a11yText = a11y.textContent;

    // The rules must not be cluttered with keyboard mechanics...
    check(!/roving|browse mode|NVDA|Tab and Shift/i.test(rulesText),
      'the rules dialog still contains keyboard or screen reader guidance');
    check(/trump|trick|blind|picker/i.test(rulesText), 'the rules dialog lost the game rules');
    // ...and the accessibility hints must not be re-teaching the game.
    check(!/queen of clubs, queen of spades/i.test(a11yText),
      'the accessibility dialog still contains the trump order');
    check(/browse mode|NVDA/i.test(a11yText), 'the accessibility dialog lost the mode guidance');

    // Both reachable from setup, both reachable from each other.
    ['setup-rules', 'setup-a11y'].forEach(id =>
      check(d.getElementById(id), 'missing setup entry point: ' + id));

    d.getElementById('setup-a11y').click();
    check(a11y.open && !rules.open, '? entry point did not open the accessibility dialog');
    d.getElementById('a11y-to-rules').click();
    check(rules.open && !a11y.open, 'switching from accessibility to rules failed');
    d.getElementById('rules-to-a11y').click();
    check(a11y.open && !rules.open, 'switching from rules to accessibility failed');
    d.getElementById('a11y-close').click();
    check(!a11y.open && !rules.open, 'closing left a help dialog open');
  }

  // Screen reader modes are the user's to control: nothing may claim application role.
  const appRoles = [...d.querySelectorAll('[role="application"]')];
  check(appRoles.length === 0,
    'role="application" found on: ' + appRoles.map(e => e.id || e.tagName).join(', '));
  check(!d.querySelector('[aria-roledescription]'),
    'aria-roledescription overrides what the screen reader announces');

  // The hand region must not carry keyboard instructions; that belongs in help.
  check(!d.getElementById('hand').hasAttribute('aria-describedby'),
    'the hand region still has a description that would be read on every card');
  d.getElementById('opt-pace').value = '0';
  d.getElementById('opt-players').value = String(opts.players);
  d.getElementById('opt-difficulty').value = opts.difficulty || 'hard';
  d.getElementById('opt-allpass').value = opts.allPass || 'leaster';
  d.getElementById('setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, window, d };
}

/* jsdom runs timers on the real clock; pace 0 means each AI turn is a
 * setTimeout(...,0), so pump the loop by yielding. */
const tickOver = () => new Promise(r => setTimeout(r, 0));
/* Alerts are cleared and re-set on a short delay so a repeated message is
 * announced again; wait past that before reading the region. */
const settleAlert = () => new Promise(r => setTimeout(r, 120));

function cards(d) { return [...d.querySelectorAll('#hand .card')]; }
function legalCards(d) { return cards(d).filter(c => c.getAttribute('aria-disabled') !== 'true'); }
function actionButtons(d) { return [...d.querySelectorAll('#actions button')]; }
function btn(d, re) { return actionButtons(d).find(b => re.test(b.textContent)); }
function myTurn(d) { return /your turn to play/i.test(d.getElementById('status').textContent); }

async function playHands(players, howMany) {
  const { window, d } = await boot({ players });
  const seen = { focusChecks: 0, focusBad: 0, buries: 0, handsDone: 0, blockedSeen: 0, exports: 0, midChecks: 0, bugs: 0 };
  let guard = 0;

  while (seen.handsDone < howMany && ++guard < 6000) {
    await tickOver();
    const next = btn(d, /Deal next hand/);
    const pick = btn(d, /Pick up the blind/);
    const bury = btn(d, /^Bury /);

    if (next) {
      seen.handsDone++;
      const summary = d.querySelector('#actions .hint').textContent;
      check(/Hand over|Leaster result/.test(summary), 'hand-over summary missing: ' + summary);

      // The visible Total row must show the points adding up.
      const foot = d.querySelector('#players-table tfoot tr');
      check(foot && !/bad-total/.test(foot.className),
        'the players table Total row reports an accounting problem: ' + (foot && foot.textContent));
      check(/= 120$/.test(foot.children[4].textContent),
        'Total row does not show 120: ' + foot.children[4].textContent);
      check(foot.children[5].textContent === '0',
        'game scores are not zero sum: ' + foot.children[5].textContent);

      // Export must open, be audited clean, and contain this hand.
      // Note .click() does not move focus in jsdom, so capture whatever really
      // has focus now — that is what closing the dialog must restore.
      const cameFrom = d.activeElement;
      d.getElementById('btn-export').click();
      const text = d.getElementById('export-text').value;
      check(/add up correctly/.test(text), 'export reports an accounting failure:\n' +
        text.split('\n').filter(l => /FAILED/.test(l)).join('\n'));
      check(text.includes('=== Hand ' + seen.handsDone + ' ==='), 'export is missing hand ' + seen.handsDone);
      check(/Check: ok/.test(text), 'export hand check is not ok');
      check(d.activeElement === d.getElementById('export-text'), 'export dialog did not focus the text');
      d.getElementById('export-close').click();
      seen.exports++;

      // Bug report: preview must be exactly what gets copied, and must carry the
      // transcript when asked and drop it when not.
      d.getElementById('btn-bug').click();
      const bugTitle = d.getElementById('bug-title');
      const bugWhat = d.getElementById('bug-what');
      const incl = d.getElementById('bug-include-log');
      const preview = d.getElementById('bug-preview');
      bugWhat.value = 'The score looked wrong on the last hand.';
      bugWhat.dispatchEvent(new window.Event('input', { bubbles: true }));
      check(/score looked wrong/.test(preview.value), 'preview does not reflect what was typed');
      check(/### Game log/.test(preview.value), 'preview is missing the game log when included');
      check(preview.value.includes('=== Hand ' + seen.handsDone + ' ==='),
        'bug report log is missing the hand just played');
      check(/Browser:/.test(preview.value), 'bug report is missing environment details');
      check(/Players: /.test(preview.value), 'bug report is missing the game setup');

      incl.checked = false;
      incl.dispatchEvent(new window.Event('change', { bubbles: true }));
      check(!/### Game log/.test(preview.value), 'unchecking include-log did not drop the log');
      check(/score looked wrong/.test(preview.value), 'unchecking include-log lost the description');
      incl.checked = true;
      incl.dispatchEvent(new window.Event('change', { bubbles: true }));

      check(/^\[sheephead\] /.test(bugTitle.value) === false, 'title box should hold the bare title');
      d.getElementById('bug-close').click();
      seen.bugs++;
      check(d.activeElement === cameFrom,
        'closing the export dialog did not return focus to where it came from (went to ' +
        (d.activeElement && d.activeElement.id || d.activeElement.tagName) + ')');
      if (seen.handsDone < howMany) next.click();
      continue;
    }
    if (pick) { pick.click(); continue; }
    if (bury) {
      const need = +bury.textContent.match(/of (\d+)/)[1];
      check(bury.disabled, 'Bury button should start disabled with nothing selected');
      const hand = cards(d);
      // select one too many and confirm the extra is refused
      hand.slice(0, need).forEach(c => c.click());
      const b2 = btn(d, /^Bury /);
      check(!b2.disabled, 'Bury button should enable at exactly ' + need + ' selected');
      if (hand.length > need) {
        hand[need].click();
        await settleAlert();
        check(/already selected/i.test(d.getElementById('alerts').textContent),
          'selecting past the limit should be refused with an explanation');
        check(hand[need].getAttribute('aria-pressed') === 'false', 'the refused card must not become selected');
      }
      check(cards(d).filter(c => c.getAttribute('aria-pressed') === 'true').length === need,
        'exactly ' + need + ' cards should be marked selected');
      btn(d, /^Bury /).click();
      seen.buries++;
      continue;
    }

    // Regression: card points only reach 120 once every trick is taken, so
    // nothing may complain about the accounting part way through a hand.
    {
      const foot = d.querySelector('#players-table tfoot tr');
      if (foot && !next) {
        check(!/bad-total/.test(foot.className),
          'mid-hand Total row flagged an accounting problem: ' + foot.textContent);
        check(!/= 120/.test(foot.children[4].textContent),
          'mid-hand Total row claims a 120 total: ' + foot.children[4].textContent);
      }
      const said = d.getElementById('alerts').textContent + ' ' +
        d.getElementById('announcer').textContent + ' ' +
        [...d.querySelectorAll('#log li')].map(li => li.textContent).join(' ');
      check(!/Accounting problem/i.test(said), 'an accounting problem was reported: ' + said.slice(0, 300));
      seen.midChecks++;
    }

    // No instructional prose anywhere in the hand region.
    {
      const text = d.getElementById('hand').textContent;
      check(!/Enter|Space|number key|Arrow|Press /i.test(text),
        'the hand region contains keyboard instructions: ' + text.slice(0, 160));
    }

    if (myTurn(d)) {
      const all = cards(d), legal = legalCards(d);
      check(legal.length > 0, 'a turn with no legal card');
      if (legal.length < all.length) {
        seen.blockedSeen++;
        // focus must land on a card that can actually be played
        const a = d.activeElement;
        seen.focusChecks++;
        const onPlayable = a && a.classList && a.classList.contains('card') &&
          a.getAttribute('aria-disabled') !== 'true';
        if (!onPlayable) {
          seen.focusBad++;
          fails.push('focus landed on "' + (a && a.getAttribute && a.getAttribute('aria-label')) +
            '" but legal cards were: ' + legal.map(c => c.getAttribute('aria-label').split(',')[0]).join(', '));
        }
        // a blocked card must explain itself and refuse to be played
        const blocked = all.find(c => c.getAttribute('aria-disabled') === 'true');
        check(/cannot be played, You must follow/.test(blocked.getAttribute('aria-label')),
          'blocked card lacks a reason: ' + blocked.getAttribute('aria-label'));
        const before = all.length;
        blocked.click();
        check(cards(d).length === before, 'clicking a blocked card played it anyway');
        await settleAlert();
        check(/You cannot play/.test(d.getElementById('alerts').textContent),
          'clicking a blocked card gave no explanation');
      }
      legal[0].click();
      continue;
    }
  }
  check(guard < 6000, players + 'p: game did not finish ' + howMany + ' hands');
  window.close();
  return seen;
}

(async () => {
  for (const players of [3, 4, 5, 6]) {
    const r = await playHands(players, 4);
    console.log(
      players + ' players:',
      r.handsDone + ' hands,',
      r.buries + ' buries,',
      r.blockedSeen + ' turns with blocked cards,',
      'focus-on-playable ' + (r.focusChecks - r.focusBad) + '/' + r.focusChecks + ',', r.exports + ' clean exports,',
      r.midChecks + ' mid-hand accounting checks,',
      r.bugs + ' bug-report checks');
    check(r.focusChecks > 0, players + 'p: never exercised a restricted turn');
  }

  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
    uniq.slice(0, 12).forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nUI behaves correctly at every table size.');
})();

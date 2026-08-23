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

/* A watchdog on the whole process, not just the play loop.
 *
 * The per-iteration deadline added earlier did not fire when the projection was
 * seeded with a gap: most of this suite is `await`, so a hang can sit inside a
 * single iteration and never reach the top of the loop again. A run that hangs
 * reports as a slow machine rather than as the defect it found, which has cost
 * time three separate ways in this project now.
 *
 * unref'd on purpose: it must not keep a healthy run alive, only kill a stuck
 * one. */
const HARD_DEADLINE_MS = 15 * 60 * 1000;
const hardStop = setTimeout(function () {
  console.error('FAILED: the suite stopped making progress and was killed by its own watchdog.');
  process.exit(1);
}, HARD_DEADLINE_MS);
if (typeof hardStop.unref === 'function') hardStop.unref();
const check = (c, m) => { if (!c) fails.push(m); };

/* Let jsdom load the page's own <script> tags, so the scripts run in document
 * order and DOMContentLoaded fires normally — injecting them by hand afterwards
 * means ui.js never gets its listeners attached. */
async function boot(opts) {
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    // jsdom refuses localStorage on an opaque origin, and the app quietly copes
    // with that. Give each window a private in-memory store so settings
    // persistence is actually exercised rather than silently skipped.
    beforeParse(window) {
      const store = {};
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          clear: () => { Object.keys(store).forEach(k => delete store[k]); },
          key: i => Object.keys(store)[i] || null,
          get length() { return Object.keys(store).length; }
        }
      });
    }
  });
  const { window } = dom;
  await new Promise(r => {
    if (window.document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });

  // jsdom does not implement <dialog>; stub only what ui.js touches.
  ['a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'].forEach(id => {
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
    /* A section on the page now, not a dialog — the landing page needed
     * something it could link to, and a modal has no address. */
    const rules = d.getElementById('rules-section');
    const a11y = d.getElementById('a11y-dialog');
    const rulesText = rules.textContent;
    const a11yText = a11y.textContent;

    // The rules must not be cluttered with keyboard mechanics...
    check(!/roving|browse mode|NVDA|Tab and Shift/i.test(rulesText),
      'the rules still contain keyboard or screen reader guidance');
    check(/trump|trick|blind|picker/i.test(rulesText), 'the rules section lost the game rules');
    // ...and the accessibility hints must not be re-teaching the game.
    check(!/queen of clubs, queen of spades/i.test(a11yText),
      'the accessibility dialog still contains the trump order');
    check(/browse mode|NVDA/i.test(a11yText), 'the accessibility dialog lost the mode guidance');

    // Both reachable from setup, both reachable from each other.
    ['setup-rules', 'setup-a11y'].forEach(id =>
      check(d.getElementById(id), 'missing setup entry point: ' + id));

    d.getElementById('setup-a11y').click();
    check(a11y.open, '? entry point did not open the accessibility dialog');

    /* The rules are a page section now, so "go to the rules" closes the dialog
     * and moves focus to the heading rather than opening a second modal. The
     * old check asked whether one dialog had replaced the other, which is a
     * question about the mechanism rather than about the reader getting there. */
    d.getElementById('a11y-to-rules').click();
    check(!a11y.open, 'going to the rules left the accessibility dialog open on top of them');
    check(d.activeElement === d.getElementById('rules-h'),
      'going to the rules did not put focus on the rules heading, so a screen ' +
      'reader is left where it was with no idea anything happened');
    d.getElementById('rules-to-a11y').click();
    check(a11y.open && !rules.open, 'switching from rules to accessibility failed');
    d.getElementById('a11y-close').click();
    check(!a11y.open && !rules.open, 'closing left a help dialog open');
  }

  // The game section's heading is screen-reader-only, so its wording is entirely
  // for assistive technology. It must not name a different kind of widget —
  // "Table" sent people looking for a data table.
  {
    const name = d.getElementById('game-h').textContent.trim();
    check(!/^(table|grid|list|form)$/i.test(name),
      'the game section is named "' + name + '", which names a different widget type');
    check(name.length > 0, 'the game section has no accessible name');
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
  d.getElementById('opt-pace').value = String(opts.pace !== undefined ? opts.pace : 0);
  d.getElementById('opt-players').value = String(opts.players);
  d.getElementById('opt-difficulty').value = opts.difficulty || 'hard';
  d.getElementById('opt-allpass').value = opts.allPass || 'leaster';
  d.getElementById('setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, window, d };
}

/* jsdom runs timers on the real clock; pace 0 means each AI turn is a
 * setTimeout(...,0), so pump the loop by yielding. */
const tickOver = () => new Promise(r => setTimeout(r, 0));
/* Announcements are cleared and re-set on a short delay so a repeated message is
 * announced again, and they are now serialized through one queue so that two
 * arriving together cannot wipe each other out. That means the worst case is a
 * settle plus a wait rather than a single settle, and the old flat 120ms landed
 * right on top of it — passing alone and failing in a full run, which is the
 * least useful way for a test to behave.
 *
 * A fixed sleep tuned to an implementation delay is a standing invitation to
 * this. Prefer waitForSaid below, which asks for what it actually wants. */
const settleAlert = () => new Promise(r => setTimeout(r, 300));

/* Wait until a live region says something (or something specific), rather than
 * sleeping for about as long as it ought to take. */
async function waitForSaid(d, id, match) {
  const node = d.getElementById(id);
  await waitFor(() => {
    const t = node.textContent;
    if (!t) return false;
    return match ? match.test(t) : true;
  }, 1500, 20);
  return node.textContent;
}

/* Poll until a condition holds, up to a deadline. Anywhere a test would
 * otherwise sleep for "about as long as the thing should take", this is the
 * honest version: it survives a loaded CI runner without slowing a quiet
 * machine down, and a timeout says the thing never happened rather than that it
 * was merely late. */
async function waitFor(cond, timeoutMs, stepMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return true;
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, stepMs || 50));
  }
}

function cards(d) { return [...d.querySelectorAll('#hand .card')]; }
function legalCards(d) { return cards(d).filter(c => c.getAttribute('aria-disabled') !== 'true'); }
function actionButtons(d) { return [...d.querySelectorAll('#actions button')]; }
function btn(d, re) { return actionButtons(d).find(b => re.test(b.textContent)); }
function myTurn(d) { return /your turn to play/i.test(d.getElementById('status').textContent); }

async function playHands(players, howMany) {
  const { window, d } = await boot({ players });
  const seen = { focusChecks: 0, focusBad: 0, buries: 0, handsDone: 0, blockedSeen: 0, exports: 0, midChecks: 0, bugs: 0, handSaid: 0, blindMarked: 0, blindRevealed: 0, jdSeen: 0, orderSaid: 0, pickLabels: 0, whoSaid: 0};
  let guard = 0;

  /* A wall-clock watchdog as well as an iteration guard.
   *
   * The iteration guard alone does not stop this suite hanging: most of the loop
   * is `await`, so a game that cannot progress spends its six thousand turns
   * waiting rather than spinning, and the run sits there for a quarter of an hour
   * before anything says so. That reports as a slow machine, not as the defect it
   * found — the same way an unanswered move once reported as a suite timeout.
   *
   * Twelve minutes is far longer than any healthy run (a full six-seat pass takes
   * well under one) and short enough to be a failure rather than a mystery. */
  const deadline = Date.now() + 12 * 60 * 1000;
  let stalled = false;

  while (seen.handsDone < howMany && ++guard < 6000) {
    if (Date.now() > deadline) {
      stalled = true;
      check(false, players + 'p: the game stopped progressing — ' +
        seen.handsDone + ' of ' + howMany + ' hands after ' + guard + ' turns. ' +
        'Status: ' + d.getElementById('status').textContent);
      break;
    }
    await tickOver();
    const next = btn(d, /Deal next hand/);
    const pick = btn(d, /Pick up the blind/);
    const bury = btn(d, /^Bury /);

    if (next) {
      seen.handsDone++;

      /* PRIVATE MESSAGES MUST BE TRUE OF THIS SEAT.
       *
       * The check that was missing, and whose absence shipped a real bug: every
       * hand in which any seat held both black queens, the player was told "You
       * hold both black queens, so this hand counts double" — about somebody
       * else's cards, in the second person. Reproduced against the live build at
       * 130 hands in 400.
       *
       * Two halves of one change landed apart. Private messages were made
       * per-seat, so the engine emits one for EVERY holder rather than only for
       * the single human seat; the interface was still reading the raw event list
       * and would not start filtering for several commits. Each half had a test.
       * The join did not.
       *
       * Asked SEMANTICALLY rather than by bookkeeping. The obvious version —
       * compare the log against the event list — cannot see this at all, because
       * the unfiltered drain SPLICES the events out and leaves nothing to compare
       * against. So: if the log says something that is only true of one seat,
       * that seat had better be this one. */
      {
        const truth = window.SH.Table.localState();
        const mine = window.SH.Table.seat();
        if (truth) {
          /* THIS HAND only. The log is newest-first and keeps every hand, so a
           * "secret partner" line from an earlier hand — when this seat really
           * was the picker — is still sitting there when a later hand ends with
           * somebody else picking. Scanning the whole log found those and called
           * them leaks, which they are not. Entries down to and including this
           * hand's deal line are the ones that belong to it. */
          const all = [...d.querySelectorAll('#log li')].map(li => li.textContent);
          const dealAt = all.findIndex(t => /^Hand \d+\./.test(t));
          const log = all.slice(0, dealAt >= 0 ? dealAt + 1 : all.length).join(' | ');

          (truth.doublers || []).forEach(dbl => {
            const claim = 'You hold ' + dbl.text;
            if (log.indexOf(claim) >= 0) {
              check(dbl.player === mine,
                'the log tells this player "' + claim + '", but seat ' + dbl.player +
                ' holds them. A private message addressed to another seat reached the screen.');
            }
          });

          if (/You have the Jack of Diamonds yourself/.test(log)) {
            check(truth.picker === mine && truth.alone === true,
              'the log says this player holds the Jack and is playing alone, but the picker is seat ' +
              truth.picker + ' and alone is ' + truth.alone);
          }
          if (/Somebody else holds it and is your secret partner/.test(log)) {
            check(truth.picker === mine,
              'the log tells this player they have a secret partner, but the picker is seat ' + truth.picker);
          }
        }
      }

      // The action area carries only the headline now, so the button is not
      // pushed off a phone screen. The full account must still exist — it moved
      // to the log, it did not disappear.
      const headline = d.querySelector('#actions .result-headline').textContent;
      check(/(wins?|lose[s]?) (alone )?— .+\.$/.test(headline) || /leaster/i.test(headline),
        'result headline is malformed: ' + headline);
      check(headline.length < 90, 'the headline is long enough to push the button down: ' + headline);
      const logged = [...d.querySelectorAll('#log li')].map(li => li.textContent);
      const summary = logged.find(t => /Hand over|Leaster result/.test(t)) || '';
      check(summary, 'the full hand summary is not in the game log either');

      // The visible Total row must show the points adding up.
      const foot = d.querySelector('#players-table tfoot tr');
      check(foot && !/bad-total/.test(foot.className),
        'the players table Total row reports an accounting problem: ' + (foot && foot.textContent));
      check(/= 120$/.test(foot.children[4].textContent),
        'Total row does not show 120: ' + foot.children[4].textContent);
      check(foot.children[5].textContent === '0',
        'game scores are not zero sum: ' + foot.children[5].textContent);

      // Result chips summarise the hand at a glance, but must not make a screen
      // reader hear it all twice — the prose summary beside them already says it.
      {
        const chips = d.querySelector('#actions .chips');
        check(chips, 'no result chips at the end of the hand');
        if (chips) {
          check(chips.getAttribute('aria-hidden') === 'true',
            'result chips are not hidden from assistive technology, so the result is announced twice');
          const labels = [...chips.querySelectorAll('.chip-label')].map(e => e.textContent);
          check(labels.includes('You'), 'chips do not show the player their own result: ' + labels.join(','));
          const you = chips.querySelector('.chip .chip-value').textContent;
          check(/^[+-]?\d+$/.test(you), 'the player chip is not a score change: ' + you);
        }
        // The heading must not still claim it is the player's turn.
        check(d.getElementById('action-h').textContent === 'Hand complete',
          'action heading still reads "' + d.getElementById('action-h').textContent + '" after the hand ended');
        check(/^Next: deal hand \d+\.$/.test(d.querySelector('#actions .next-step').textContent),
          'no next-step line telling the player what happens now');
      }

      // The blind must be revealed as actual cards, not just a point total.
      {
        const sec = d.getElementById('blind-section');
        check(!sec.hidden, 'the blind was not revealed at the end of the hand');
        const shown = [...sec.querySelectorAll('.card')].map(c => c.getAttribute('aria-label'));
        check(shown.length >= 2, 'the blind reveal shows no cards: ' + shown.join(' | '));
        shown.forEach(l => check(/ of (Clubs|Spades|Hearts|Diamonds),/.test(l),
          'blind reveal card is not fully named: ' + l));
        // and named in the full summary too, not just rendered
        check(/The blind held .+ of /.test(summary),
          'the logged hand summary does not name the blind cards: ' + summary);
        seen.blindRevealed++;
      }

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
    if (pick) {
      // Deciding on the blind IS your turn. The cards are for review, but they
      // must never claim it is somebody else's turn.
      cards(d).forEach(c => {
        const label = c.getAttribute('aria-label');
        check(!/not your turn/.test(label),
          'a card says "not your turn" while you are deciding whether to pick: ' + label);
        check(/for review while you decide whether to pick/.test(label),
          'a card does not explain why it is unplayable while picking: ' + label);
      });
      seen.pickLabels++;
      pick.click();
      continue;
    }
    if (bury) {
      const need = +bury.textContent.match(/of (\d+)/)[1];

      // The picked-up cards sit at the front of the hand, marked, until burying
      // is committed — so the picker can see what they just took.
      const marked = cards(d).filter(c => /\bfrom-blind\b/.test(c.className));
      check(marked.length === need,
        'expected ' + need + ' cards marked as from the blind, got ' + marked.length);
      check(cards(d).slice(0, need).every(c => /\bfrom-blind\b/.test(c.className)),
        'the blind cards are not at the front of the hand');
      marked.forEach(c => check(/from the blind/.test(c.getAttribute('aria-label')),
        'a blind card does not say so in its label: ' + c.getAttribute('aria-label')));
      // and the same information must reach speech
      d.querySelector('[data-say="hand"]').click();
      await settleAlert();
      check(/^From the blind: /.test(d.getElementById('announcer').textContent),
        'hand announcement does not lead with the blind while burying: ' +
        d.getElementById('announcer').textContent);
      seen.blindMarked++;
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
      // Once committed the hand goes back to normal order and nothing is marked.
      check(cards(d).every(c => !/\bfrom-blind\b/.test(c.className)),
        'cards are still marked as from the blind after burying');
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

        /* The trick counter, which nothing checked.
         *
         * It is the only thing on screen fed by trickLog, so blanking trickLog in
         * the projection changed the display and no test noticed. "A gap in the
         * projection breaks the offline game" is only true where something
         * actually asserts on the part of the screen that gap feeds — otherwise
         * the offline game renders wrong and says nothing, which is the failure
         * mode this whole arrangement was meant to prevent. */
        const tricksCell = (foot.children[3].textContent || '').trim();
        const m = /^(\d+) of (\d+)$/.exec(tricksCell);
        check(!!m, 'the Total row trick counter is malformed: ' + tricksCell);
        if (m) {
          /* Completed tricks must equal what the per-player Tricks column adds up
           * to. Deriving it from cards remaining does not work: between picking
           * and burying the picker is holding two extra cards, so the total is not
           * a clean function of tricks played — which is exactly the sort of thing
           * that makes an invariant look wrong when it is the arithmetic that is
           * wrong. */
          const wonBySeats = [...d.querySelectorAll('#players-table tbody tr')]
            .reduce((a, r) => a + Number((r.children[3].textContent || '0').trim() || 0), 0);
          check(Number(m[1]) === wonBySeats,
            'the Total row says ' + m[1] + ' completed tricks but the seats add up to ' + wonBySeats);
        }
      }
      const said = d.getElementById('alerts').textContent + ' ' +
        d.getElementById('announcer').textContent + ' ' +
        [...d.querySelectorAll('#log li')].map(li => li.textContent).join(' ');
      check(!/Accounting problem/i.test(said), 'an accounting problem was reported: ' + said.slice(0, 300));
      /* NOTHING ADDRESSED TO ANOTHER SEAT MAY REACH THIS PLAYER.
       *
       * This is the check that was missing, and its absence shipped a real bug:
       * every hand where any seat held both black queens, the player was told
       * "You hold both black queens, so this hand counts double" — about
       * somebody else's hand, in the second person. 130 hands in 400.
       *
       * The cause was two halves of one change landing apart. Private events
       * were made per-seat, so the engine emits one for EVERY holder rather than
       * only for the single human; the interface was still reading the raw event
       * list, unfiltered, and would not start using G.eventsFor for several
       * commits. Each half was tested. The join was not.
       *
       * tests/hidden-information.js proves the filter works. tests/projection.js
       * proves the views are clean. Neither could see this, because the question
       * they ask is "is the filter correct" and the question that mattered was
       * "is the filter USED". So this asks the only one that cannot be answered
       * anywhere but here: of everything on the player's screen, is any of it
       * addressed to somebody else? */
      {
        const truth = window.SH.Table.localState();
        if (truth && truth.events) {
          const mine = window.SH.Table.seat();

          /* Compared against what this seat is ENTITLED to, not against the text
           * alone. The same sentence recurs legitimately across hands — "somebody
           * else holds it and is your secret partner" is addressed to seat 0 in
           * one hand and to seat 1 in another — so matching on the words found a
           * leak in an earlier hand's honest log entry. What matters is whether
           * anything on screen is absent from this seat's own filtered list. */
          const allowed = new Set();
          window.SH.Game.eventsFor(truth, mine).forEach(e => {
            allowed.add(e.text);
            if (e.textPlain) allowed.add(e.textPlain);
          });

          const privateElsewhere = new Set(
            truth.events.filter(e => e.audience !== undefined && e.audience !== mine)
              .map(e => e.text)
          );

          const shown = [...d.querySelectorAll('#log li')].map(li => li.textContent);
          const leaked = shown.filter(t => privateElsewhere.has(t) && !allowed.has(t));
          check(leaked.length === 0,
            'a message addressed to another seat reached the player: "' + (leaked[0] || '') + '"');
        }
      }

      seen.midChecks++;
    }

    // WHO IS AT THE TABLE. Added when this game was brought level with euchre/
    // and cribbage-multiplayer/, which already had it. Offline, waiting is
    // bounded by the pace setting; online it is not, and this is the only thing
    // that can tell a player whether silence means somebody is thinking or
    // somebody has gone.
    if (seen.whoSaid < 3) {
      d.querySelector('[data-say="who"]').click();
      await settleAlert();
      const said = d.getElementById('announcer').textContent;
      if (said) {
        seen.whoSaid++;
        check(said.length > 30, 'who-is-here said almost nothing: ' + said);
        // Every seat named, with what is in it.
        const names = [...d.querySelectorAll('#players-table tbody tr')]
          .map(r => r.querySelector('th').textContent.replace(/\s*\(you\)\s*$/, '').trim());
        names.forEach(n => check(said.indexOf(n) >= 0,
          'who-is-here does not mention ' + n + ': ' + said));
        check(/Seat 1,/.test(said), 'who-is-here does not number the seats: ' + said);
        // Playing alone, it must say so rather than describing a table.
        check(/on your own against \d+ computer opponents/.test(said),
          'who-is-here does not say this is a single-player game: ' + said);
        check(/\b(you|a person|the computer|away)\b/.test(said),
          'who-is-here does not say what is in each seat: ' + said);
      }
    }

    // Play order must say who plays when, and — the point of it — where the
    // picker sits relative to you.
    if (myTurn(d) && seen.orderSaid < 3) {
      d.querySelector('[data-say="order"]').click();
      await settleAlert();
      const said = d.getElementById('announcer').textContent;
      if (said) {
        seen.orderSaid++;
        check(/^Play order for this trick, starting with the lead\./.test(said),
          'play order announcement is malformed: ' + said);
        // every seat named exactly once
        const rows = [...d.querySelectorAll('#players-table tbody tr')];
        rows.forEach(r => {
          const nm = r.querySelector('th').textContent.replace(' (you)', '');
          check(said.indexOf(nm) >= 0, 'play order is missing ' + nm + ': ' + said);
        });
        check(said.indexOf(String(players) + ', ') >= 0,
          'play order does not number every seat up to ' + players + ': ' + said);
        // the picker's position relative to you, which is the whole point
        const pickerRow = rows.findIndex(r => /picker/.test(r.children[1].textContent));
        if (pickerRow === 0) {
          check(/You are the picker\./.test(said), 'you are the picker but it was not said: ' + said);
        } else if (pickerRow > 0) {
          check(/The picker plays (one|two|three|four|five) places? (after|before) you\./.test(said),
            'play order does not place the picker relative to you: ' + said);
        }
        // leading and last are worth calling out explicitly
        const played = d.querySelectorAll('#trick li:not(.empty)').length;
        if (played === 0) check(/You lead\./.test(said), 'leading was not announced: ' + said);
      }
    }

    // The jack of diamonds is called out whenever the player holds it, so they
    // know they are the partner without having to work it out.
    if (players >= 4) {
      const jd = cards(d).find(c => c.dataset.id === 'JD');
      if (jd) {
        check(/\bpartner-card\b/.test(jd.className), 'the jack of diamonds is not marked');
        check(/partner card/.test(jd.getAttribute('aria-label')),
          'the jack of diamonds label does not mention the partner card: ' + jd.getAttribute('aria-label'));
        seen.jdSeen++;
      }
      // Nothing else may ever be marked as the partner card.
      check(cards(d).filter(c => /\bpartner-card\b/.test(c.className)).length === (jd ? 1 : 0),
        'something other than the jack of diamonds is marked as the partner card');
    }

    // Whatever the state, "not your turn" may only appear when it really is not.
    {
      const claimsNotYourTurn = cards(d).some(c => /not your turn/.test(c.getAttribute('aria-label')));
      const itIsMyTurn = myTurn(d) || !!btn(d, /Pick up the blind/) || !!btn(d, /^Bury /);
      check(!(claimsNotYourTurn && itIsMyTurn),
        'cards say "not your turn" but it is the player\'s turn — status: ' +
        d.getElementById('status').textContent);
    }

    // No instructional prose anywhere in the hand region.
    {
      const text = d.getElementById('hand').textContent;
      check(!/Enter|Space|number key|Arrow|Press /i.test(text),
        'the hand region contains keyboard instructions: ' + text.slice(0, 160));
    }

    // The hand announcement must read every card the same way: full names in
    // both groups, never a bare rank list under a suit heading.
    if (myTurn(d) && seen.handSaid < 3) {
      d.querySelector('[data-say="hand"]').click();
      await settleAlert();
      const said = d.getElementById('announcer').textContent;
      if (said) {
        seen.handSaid++;
        check(/Trump: |No trump/.test(said), 'hand announcement has no trump section: ' + said);
        check(/Non-trump: |No non-trump cards/.test(said),
          'hand announcement has no non-trump section: ' + said);
        check(!/(Clubs|Spades|Hearts): /.test(said),
          'hand announcement still uses per-suit headings: ' + said);
        // Every card in hand must appear by its full name.
        cards(d).forEach(c => {
          const name = c.getAttribute('aria-label').split(',')[0];
          check(said.indexOf(name) >= 0,
            'hand announcement is missing "' + name + '": ' + said);
        });
      }
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
  check(stalled || guard < 6000, players + 'p: game did not finish ' + howMany + ' hands');
  window.close();
  return seen;
}

/* Manual pacing: the old build appended "Press Enter on Continue for the next
 * play." to every single announcement, which wears thin fast. It must be gone,
 * and N must advance without needing the button. */
async function manualPacing() {
  const { window, d } = await boot({ players: 5, pace: -1 });
  const say = () => d.getElementById('announcer').textContent;
  let advances = 0, sawContinue = 0;
  const seen2 = { kept: 0 };

  for (let i = 0; i < 400 && advances < 12; i++) {
    await new Promise(r => setTimeout(r, 5));
    check(!/Press Enter on Continue/i.test(say()),
      'manual mode still nags about pressing Enter on Continue: ' + say());

    const cont = [...d.querySelectorAll('#actions button')].find(b => /^Continue/.test(b.textContent));
    if (cont) {
      sawContinue++;
      check(cont.getAttribute('aria-keyshortcuts') === 'N', 'Continue does not advertise N');
      // advance with the key, not the button
      const before = d.querySelectorAll('#log li').length;
      const focusBefore = d.activeElement;
      d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      await new Promise(r => setTimeout(r, 5));
      check(d.querySelectorAll('#log li').length > before, 'N did not advance the game');

      // The Continue button must survive the step rather than being rebuilt: a
      // fresh element would take focus and be announced again after every play.
      const contAfter = [...d.querySelectorAll('#actions button')]
        .find(b => /^Continue/.test(b.textContent));
      // Focus is only required to stay put while we are STILL waiting on
      // Continue. When the step ends the wait — your turn arrives, or the hand
      // finishes — moving focus to the new thing to do is correct.
      if (contAfter) {
        check(contAfter === cont,
          'the Continue button was rebuilt, so it would be announced again after every play');
        check(d.activeElement === focusBefore,
          'focus moved while still waiting on Continue (from ' +
          (focusBefore && focusBefore.tagName) + ' to ' +
          (d.activeElement && d.activeElement.tagName) + ')');
        seen2.kept++;
      }
      advances++;
      continue;
    }
    const next = [...d.querySelectorAll('#actions button')].find(b => /^Deal next hand/.test(b.textContent));
    if (next) {
      check(next.getAttribute('aria-keyshortcuts') === 'N', 'Deal next hand does not advertise N');
      d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      await new Promise(r => setTimeout(r, 5));
      continue;
    }
    const pick = [...d.querySelectorAll('#actions button')].find(b => /Pick up the blind/.test(b.textContent));
    if (pick) { pick.click(); continue; }
    const bury = [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent));
    if (bury) {
      const need = +bury.textContent.match(/of (\d+)/)[1];
      [...d.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
      [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent)).click();
      continue;
    }
    if (myTurn(d)) {
      const legal = legalCards(d);
      if (legal[0]) legal[0].click();
    }
  }
  check(sawContinue > 0, 'manual mode never offered a Continue button');
  check(seen2.kept > 0, 'never observed the Continue button surviving a step');
  check(advances >= 12, 'N only advanced ' + advances + ' times');

  // N must not fire while reading back the log.
  const logItem = d.querySelector('#log li');
  if (logItem) {
    logItem.focus();
    const before = d.querySelectorAll('#log li').length;
    // Dispatch ON the log entry so event.target really is inside the log —
    // passing `target` to the constructor does nothing, it is not an init option.
    logItem.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await new Promise(r => setTimeout(r, 5));
    check(d.querySelectorAll('#log li').length === before,
      'N advanced the game while the player was reading the log');
  }
  window.close();
  return { advances, sawContinue, kept: seen2.kept };
}

/* Timed pacing. The pauses used to be 400ms and 900ms, described as "fast" and
 * "relaxed", and the report from sighted players was simply that the cards went
 * by too quickly to follow. They are real seconds now, and because a pause you
 * cannot skip is its own kind of annoying, Continue is offered here too — the
 * pause is a ceiling, not a sentence.
 *
 * What has to hold: the button is there, N works on it, taking it cancels the
 * pending timer rather than queueing a second play, the button is not rebuilt
 * under the player between opponent turns, and left alone the game still moves
 * on by itself. */
async function timedPacing() {
  const { window, d } = await boot({ players: 5, pace: 4000 });
  const conts = () => [...d.querySelectorAll('#actions button')].find(b => /^Continue/.test(b.textContent));
  const logLen = () => d.querySelectorAll('#log li').length;
  const headingText = () => d.getElementById('action-h').textContent;

  // The options offered must be exactly the four the settings screen documents.
  const opts = [...d.getElementById('opt-pace').options].map(o => o.value);
  check(opts.join(',') === '0,4000,10000,-1',
    'the pace options are no longer instant / 4s / 10s / manual: ' + opts.join(','));

  // One log entry per card played, so this counts turns taken exactly. Log
  // length as a whole does not: a completed trick adds entries of its own.
  const plays = () => d.querySelectorAll('#log li.k-play').length;
  let steps = 0, kept = 0, headingsSeen = new Set(), sawNote = 0, autoAdvanced = 0, timerChecked = 0;

  for (let i = 0; i < 400 && steps < 10; i++) {
    await new Promise(r => setTimeout(r, 5));
    const cont = conts();
    if (cont) {
      check(cont.getAttribute('aria-keyshortcuts') === 'N', 'Continue does not advertise N on a timed pace');
      // Unlike manual mode, a timed pause does need a word of explanation beside
      // the button — otherwise a Continue button on a game that advances by
      // itself just looks like a mistake.
      if (/four seconds/i.test(d.getElementById('actions').textContent)) sawNote++;
      headingsSeen.add(headingText());

      // Once, part way in, leave it alone and check the pause really does expire
      // on its own rather than the game sitting there waiting for a press.
      //
      // Polled to a generous deadline rather than slept for a fixed 4.6 seconds:
      // this has to pass on a shared CI runner as well as on a quiet laptop, and
      // "the timer had not fired yet" is not the failure this is looking for.
      if (steps === 3 && !autoAdvanced) {
        const before = logLen();
        const moved = await waitFor(() => logLen() > before, 15000);
        check(moved, 'a four second pace never advanced on its own, even after 15 seconds');
        autoAdvanced++;
        continue;
      }

      const beforePlays = plays();
      const before = logLen();
      const focusBefore = d.activeElement;
      d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      await new Promise(r => setTimeout(r, 5));
      check(logLen() > before, 'N did not advance the game on a timed pace');

      const contAfter = conts();

      /* Assert on the button and on focus HERE, while the state being described
       * is still the state on screen. The cancellation check below waits out a
       * whole four second pause, and the game quite correctly moves on during
       * it — so doing these afterwards made this test fail perhaps one run in
       * three, with a message that blamed the app for something the test had
       * caused by looking too late. Capture and assert in the same breath. */
      if (contAfter) {
        check(contAfter === cont,
          'the Continue button was rebuilt between opponent turns, so it would be announced again each time');
        check(d.activeElement === focusBefore, 'focus moved while still waiting on Continue');
        kept++;
      }
      steps++;

      /* Taking Continue has to CANCEL the pause that was already running, not
       * just jump the queue in front of it. A stale timer does not show up
       * quickly — it is still armed for its original four second deadline — so
       * the only way to see it is to take the step and then wait that deadline
       * out. One press plus one expired pause is two turns. A stale timer makes
       * it three.
       *
       * An earlier version of this check waited 250ms and asserted nothing had
       * happened. It passed just as happily with the cancellation removed, which
       * is worth remembering: a test that cannot fail is not evidence. */
      if (!timerChecked && contAfter && plays() === beforePlays + 1) {
        const mark = plays();
        // Wait until SOMETHING happens rather than for a fixed span, then look at
        // how much happened. A stale timer and the fresh one were armed within
        // milliseconds of each other, so if the cancellation is missing both land
        // in the same breath and the count is 2 or more the first time it moves.
        // Polling this way keeps the check sharp while surviving a slow runner.
        const moved = await waitFor(() => plays() > mark, 15000);
        // Then let it settle before counting. A stale timer and the fresh one
        // were armed within milliseconds of each other, so polling alone can
        // catch the state BETWEEN the two and see a tidy 1 — which is exactly
        // what happened to the first version of this, and it let the deliberate
        // regression through. Wait for the second one to land, then count.
        await new Promise(r => setTimeout(r, 500));
        const gained = plays() - mark;
        check(moved, 'the pause that follows a Continue never expired, even after 15 seconds');
        check(gained <= 1,
          'after taking Continue, ' + gained + ' turns were played in a single pause instead of 1 — ' +
          'the pause that was already running was not cancelled');
        timerChecked++;
      }
      continue;
    }
    const next = [...d.querySelectorAll('#actions button')].find(b => /^Deal next hand/.test(b.textContent));
    if (next) { next.click(); continue; }
    const pick = [...d.querySelectorAll('#actions button')].find(b => /Pick up the blind/.test(b.textContent));
    if (pick) { pick.click(); continue; }
    const bury = [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent));
    if (bury) {
      const need = +bury.textContent.match(/of (\d+)/)[1];
      [...d.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
      [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent)).click();
      continue;
    }
    if (myTurn(d)) {
      const legal = legalCards(d);
      if (legal[0]) legal[0].click();
    }
  }

  check(steps >= 10, 'only got ' + steps + ' Continue steps on a timed pace');
  check(kept > 0, 'never saw the Continue button survive a step on a timed pace');
  check(sawNote > 0, 'the timed pace never explained what Continue is for');
  check(autoAdvanced > 0, 'never got to test that a timed pause expires on its own');
  check(timerChecked > 0, 'never got to test that Continue cancels the running pause');
  // The box is deliberately not rebuilt between opponent turns, so the heading is
  // the only thing left that can say whose turn it is. It must still keep up.
  check(headingsSeen.size > 1,
    'the action heading never changed seat while waiting, so it is stuck: ' + [...headingsSeen].join(' | '));
  window.close();
  return { steps, kept, autoAdvanced, timerChecked, headings: headingsSeen.size };
}

/* Instant keeps the old batching behaviour and offers no Continue: there is no
 * moment in which anyone could reach for it. */
async function instantPacing() {
  const { window, d } = await boot({ players: 5, pace: 0 });
  let checked = 0;
  for (let i = 0; i < 200 && checked < 20; i++) {
    await new Promise(r => setTimeout(r, 5));
    const cont = [...d.querySelectorAll('#actions button')].find(b => /^Continue/.test(b.textContent));
    check(!cont, 'instant pace offered a Continue button');
    checked++;
    const pick = [...d.querySelectorAll('#actions button')].find(b => /Pick up the blind/.test(b.textContent));
    if (pick) { pick.click(); continue; }
    const bury = [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent));
    if (bury) {
      const need = +bury.textContent.match(/of (\d+)/)[1];
      [...d.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
      [...d.querySelectorAll('#actions button')].find(b => /^Bury /.test(b.textContent)).click();
      continue;
    }
    const next = [...d.querySelectorAll('#actions button')].find(b => /^Deal next hand/.test(b.textContent));
    if (next) { next.click(); continue; }
    if (myTurn(d)) {
      const legal = legalCards(d);
      if (legal[0]) legal[0].click();
    }
  }
  window.close();
  return checked;
}

/* The settings dialog: persists, feeds new games, and rule changes may not reach
 * a hand already in progress. */
async function settingsDialog() {
  const { window, d } = await boot({ players: 5 });
  const dlg = d.getElementById('settings-dialog');
  const set = (id, v) => {
    const e = d.getElementById(id);
    if (e.type === 'checkbox') e.checked = v; else e.value = String(v);
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  // Reachable from the toolbar, and from setup.
  d.getElementById('btn-settings').click();
  check(dlg.open, 'the settings dialog did not open from the toolbar');
  d.getElementById('settings-close').click();
  check(!dlg.open, 'the settings dialog did not close');

  set('opt-black-queens', true);
  set('opt-red-queens', true);
  set('opt-redeal-doubler', true);

  // The summary must reflect what was chosen.
  const summary = d.getElementById('settings-summary').textContent;
  check(/black queens/.test(summary) && /red queens/.test(summary) && /redeal/.test(summary),
    'settings summary does not list the doublers: ' + summary);

  // Persisted for next time.
  // Find the settings key rather than naming a version, so bumping the key to
  // push new defaults out does not silently break this test.
  const storeKey = () => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (/^sheephead-mp\.settings\./.test(k)) return k;
    }
    return null;
  };
  check(storeKey() !== null, 'no sheephead-mp settings key was written to localStorage');

  // This fork must never touch the stable game's settings. localStorage is scoped
  // to the ORIGIN, not the path, and both builds publish under kellylford.github.io
  // — so inheriting 'sheephead.settings.v4' meant every setting changed here also
  // changed in the game people actually play. Worse, loadSettings() calls
  // removeItem on everything in OLD_STORE_KEYS, so the first schema bump in this
  // fork would have DELETED a player's real settings.
  //
  // Nothing caught that: it is invisible to every suite, because a test that opens
  // one page cannot see the other page's data being clobbered. Hence this check,
  // which is cheap and would have failed loudly.
  const strayStableKeys = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (/^sheephead\.settings\./.test(k)) strayStableKeys.push(k);
  }
  check(strayStableKeys.length === 0,
    'the multiplayer fork wrote to the stable game\'s localStorage keys: ' + strayStableKeys.join(', '));
  const stored = JSON.parse(window.localStorage.getItem(storeKey()));
  check(stored.blackQueenDoubler === true && stored.redQueenDoubler === true &&
    stored.redealDoubler === true, 'doubler settings were not persisted: ' + JSON.stringify(stored));

  // Reset puts everything back.
  d.getElementById('settings-reset').click();
  const after = JSON.parse(window.localStorage.getItem(storeKey()));
  check(after.blackQueenDoubler === false && after.redQueenDoubler === false &&
    after.redealDoubler === false, 'reset did not clear the doublers');
  check(/No doublers/.test(d.getElementById('settings-summary').textContent),
    'summary does not show doublers off after reset');

  window.close();
  return true;
}

(async () => {
  await settingsDialog();
  console.log('settings dialog: opens, persists, summarises and resets');
  const m = await manualPacing();
  console.log('manual pacing:', m.advances + ' advances via N,', m.kept + ' steps with the same button kept, focus untouched, no nagging');
  const t = await timedPacing();
  console.log('timed pacing:', t.steps + ' Continue steps,', t.kept + ' with the same button kept,',
    t.autoAdvanced + ' pause expired on its own,', t.headings + ' distinct seats named while waiting');
  const inst = await instantPacing();
  console.log('instant pacing:', inst + ' states checked, no Continue button offered');

  for (const players of [3, 4, 5, 6]) {
    const r = await playHands(players, 4);
    console.log(
      players + ' players:',
      r.handsDone + ' hands,',
      r.buries + ' buries,',
      r.blockedSeen + ' turns with blocked cards,',
      'focus-on-playable ' + (r.focusChecks - r.focusBad) + '/' + r.focusChecks + ',', r.exports + ' clean exports,',
      r.midChecks + ' mid-hand accounting checks,',
      r.bugs + ' bug-report checks,',
      r.handSaid + ' hand announcements,',
      r.blindMarked + ' blind-marked buries,',
      r.blindRevealed + ' blind reveals,',
      r.jdSeen + ' jack sightings,',
      r.orderSaid + ' play-order checks,',
      r.whoSaid + ' who-is-here checks,',
      r.pickLabels + ' pick-label checks');
    check(r.focusChecks > 0, players + 'p: never exercised a restricted turn');
    /* A counter that is allowed to read zero is not a check. */
    check(r.whoSaid > 0, players + 'p: never exercised the who-is-here key');
  }

  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
    uniq.slice(0, 12).forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('\nUI behaves correctly at every table size.');
})();

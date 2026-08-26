/* Does the interface behave, for somebody who cannot see it?
 *
 * The rules suites prove the game is spades. This proves the page is playable:
 * that every card can be reached and named, that a card you cannot play says so
 * and says why, that focus is never dropped on the floor, and that the things
 * which must not be live regions are not.
 *
 * ---- what this game has to get right that its neighbours do not ----
 *
 * THE BIDDING IS A SCREEN WITH NO CARDS TO CLICK. A list of bids, a button, and
 * a hand you can read but not play. Focus has to land on the list rather than
 * the cards, the cards have to say why they do nothing, and — the part that
 * earns a test of its own — moving through the list must never place a bid,
 * because a closed select fires change on every arrow key.
 *
 * THE CONTRACT HAS TO BE ASKABLE. It is the number that decides every play and
 * it lives nowhere on a card. B reads it, and B is the one key that means
 * something different here than in the other four games — which is a thing worth
 * testing precisely because it is inconsistent on purpose.
 *
 * Driven through real headless Chrome rather than jsdom, because this game runs
 * a real server in the tab — LocalServer with its own latency — and a test that
 * cannot wait for a frame to arrive would be testing a different program.
 *
 *   node tests/ui-dom.js
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { puppeteerFor } = require('../../shared/tests/browser/harness.js');

const root = path.join(__dirname, '..');
const puppeteer = puppeteerFor(root);
if (!puppeteer) { console.log('SKIP: puppeteer not installed'); process.exit(0); }

const fails = [];
let checks = 0;
const check = (c, m) => { checks++; if (!c) fails.push(m); };
const seen = {};
const note = k => { seen[k] = (seen[k] || 0) + 1; };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Wait for something to become true against the CLOCK, not a tick count.
 *
 * The bots move on the server's own delay, so a loop that counts iterations of a
 * short sleep is not a time budget — it is a bet on how fast the machine is. */
async function until(page, fn, what, seconds) {
  const limit = (seconds || 20) * 1000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(60);
  }
  fails.push('timed out waiting for ' + what);
  checks++;
  return false;
}

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    let s = 20260825;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });

  /* ---- 1. the page itself ---- */
  {
    const m = await page.evaluate(() => ({
      application: document.querySelectorAll('[role="application"]').length,
      polite: document.querySelectorAll('[aria-live="polite"]').length,
      assertive: document.querySelectorAll('[aria-live="assertive"]').length,
      logIsLive: !!document.getElementById('log').getAttribute('aria-live'),
      statusIsLive: !!document.getElementById('status').getAttribute('aria-live'),
      skip: !!document.querySelector('a.skip-link'),
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main').length,
      /* Every table has a caption, because a table with no caption is a grid of
       * numbers with no subject when you land in the middle of it. */
      tables: [...document.querySelectorAll('table')].map(t => ({
        id: t.id, caption: !!t.querySelector('caption'),
        colHeaders: t.querySelectorAll('th[scope="col"]').length
      }))
    }));

    /* No role="application". It takes away the reading controls a screen reader
     * user already knows, in exchange for shortcuts they have to learn. */
    check(m.application === 0, 'the page uses role="application" somewhere');

    /* EXACTLY ONE of each live region. */
    check(m.polite === 1, 'there are ' + m.polite + ' polite live regions, not 1');
    check(m.assertive === 1, 'there are ' + m.assertive + ' assertive live regions, not 1');

    /* And the two things that must NOT be live. Both carry the same words the
     * announcer speaks; making either live says everything twice. */
    check(!m.logIsLive, 'the log is a live region, so every event is spoken twice');
    check(!m.statusIsLive, 'the status line is a live region, so it duplicates the announcer');

    check(m.skip, 'there is no skip link');
    check(m.h1 === 1, 'there are ' + m.h1 + ' h1 elements');
    check(m.main === 1, 'there is not exactly one main landmark');
    m.tables.forEach(t => {
      check(t.caption, 'the ' + (t.id || 'unnamed') + ' table has no caption');
    });
    note('page');
  }

  /* ---- 2. the bidding: ONE tab stop to choose, one button to commit ---- */
  {
    await page.evaluate(() => {
      /* Dispatch change, not just set .value. The pace lives in the settings
       * dialog now, with one set of controls for the whole game, and the value
       * reaches `settings` through the change handler. Setting the field
       * silently leaves the game on its stored pace, and a suite that then waits
       * for a hand to finish times out for reasons that have nothing to do with
       * what it is testing. */
      var p = document.getElementById('opt-pace');
      p.value = '0';
      p.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('setup-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await until(page, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'bidding' && v.turn === SH.UI._test.seat());
    }, 'the bidding to reach this seat');

    const m = await page.evaluate(() => {
      const sel = document.getElementById('bid-select');
      const cards = [...document.querySelectorAll('#hand .card')];
      /* Everything in the actions area that the Tab key will stop on. */
      const stops = [...document.querySelectorAll(
        '#actions button, #actions select, #actions input, #actions a')]
        .filter(e => e.offsetParent !== null && e.getAttribute('tabindex') !== '-1');
      const go = [...document.querySelectorAll('#actions button')]
        .find(b => b.hasAttribute('data-advance'));
      return {
        hasSelect: !!sel,
        tabStops: stops.length,
        optionCount: sel ? sel.options.length : 0,
        optionText: sel ? [...sel.options].map(o => o.textContent.trim()) : [],
        placeholderSelected: sel ? sel.value === '' : false,
        labelled: !!document.querySelector('label[for="bid-select"]'),
        labelText: (document.querySelector('label[for="bid-select"]') || {}).textContent || '',
        focusIsSelect: document.activeElement === sel,
        focusTag: document.activeElement ? document.activeElement.tagName : 'none',
        goExists: !!go,
        goDisabled: go ? go.getAttribute('aria-disabled') : 'no button',
        goReallyDisabled: go ? go.disabled : null,
        goReason: go ? (go.getAttribute('title') || '') : '',
        handCount: cards.length,
        handNamed: cards.every(c => (c.getAttribute('aria-label') || '').length > 3),
        headingSaysBid: (document.getElementById('actions-h').textContent || ''),
        /* What the hand actually reads as, card by card, while bidding. */
        handLabels: cards.map(c => c.getAttribute('aria-label') || ''),
        handMarkedUnavailable: cards.filter(c => c.getAttribute('aria-disabled') === 'true').length
      };
    });

    /* THE WHOLE POINT OF THIS CONTROL. It was fourteen buttons, one per bid, so
     * reaching the bid you wanted meant tabbing past up to thirteen you did not
     * want — every hand, all game. */
    check(m.hasSelect, 'there is no bid select during the bidding');
    check(m.tabStops === 2,
      'the bidding has ' + m.tabStops + ' tab stops; it should be two — choose, then place');

    check(m.optionCount === 15,
      'the bid list has ' + m.optionCount + ' options, not 15 (a placeholder, nil, and 1 to 13)');
    check(m.placeholderSelected,
      'the bid list opens on a real bid rather than a placeholder, so the button ' +
      'could commit a number nobody chose');
    check(m.labelled, 'the bid select has no label element');
    check(/how many/i.test(m.labelText),
      'the bid select is labelled "' + m.labelText + '", which does not ask a question');

    /* Nil says what it costs IN ITS OPTION TEXT. An <option> cannot carry an
     * aria-label, so anything not in the text is not read. */
    const nil = m.optionText.find(t => /^nil/i.test(t)) || '';
    check(nil.length > 0, 'there is no nil option: ' + m.optionText.join(' / '));
    check(/hundred/i.test(nil),
      'the nil option reads "' + nil + '" and does not say what it costs');

    /* The button exists, is aria-disabled rather than disabled so it can still be
     * found and read, and says what it is waiting for. */
    check(m.goExists, 'there is no button to place the bid');
    check(m.goDisabled === 'true',
      'the place-bid button is available with nothing chosen, so it can commit a ' +
      'bid the player never made');
    check(m.goReallyDisabled === false,
      'the place-bid button uses the disabled attribute, so a screen reader user ' +
      'tabbing through never learns it is there or what it needs');
    check(/choose a bid/i.test(m.goReason),
      'the disabled place-bid button gives no reason: "' + m.goReason + '"');

    check(m.focusIsSelect,
      'focus went to ' + m.focusTag + ' rather than the bid select when the bidding ' +
      'reached this seat');
    check(m.headingSaysBid.toLowerCase().includes('bid'),
      'the actions heading says "' + m.headingSaysBid + '" during the bidding');

    check(m.handCount === 13, 'the hand shows ' + m.handCount + ' cards, not 13');
    check(m.handNamed, 'a card has no accessible name, so it cannot be read at all');

    /* THE HAND READS AS A HAND AND NOTHING ELSE.
     *
     * Reading it IS the activity of this phase — it is how you decide what to
     * bid — so every extra word is paid thirteen times while you are counting
     * your spades. Each card used to carry ", not yet — the bidding comes
     * first", which was reported as distracting and was.
     *
     * Marked-unavailable counts as the same noise in fewer words: a screen
     * reader says "unavailable" on each one. Both are checked here because
     * removing only the sentence would not have fixed what was reported. */
    const extra = m.handLabels.filter(l => /,/.test(l.replace(/, trump$/, '')));
    check(extra.length === 0,
      extra.length + ' cards say more than their name while bidding, e.g. "' +
      (extra[0] || '') + '" — reading the hand is the whole point of this phase');
    check(m.handMarkedUnavailable === 0,
      m.handMarkedUnavailable + ' cards are marked unavailable while bidding, so a ' +
      'screen reader says so on every one of them while the player counts the hand');
    note('bidding');
  }

  /* ---- 2b. MOVING THROUGH THE LIST DOES NOT BID ---- */
  {
    /* The reason this control is a select and not fourteen buttons is the tab
     * order; the reason it needs this test is that a closed select fires
     * `change` on EVERY arrow key. A handler that placed the bid on change would
     * bid four on the way from three to five, and a screen reader user arrowing
     * down to hear the options would bid every number they passed. */
    const m = await page.evaluate(async () => {
      const sel = document.getElementById('bid-select');
      sel.focus();
      const seat = SH.UI._test.seat();
      const before = SH.UI._test.view().players[seat].bid;
      const steps = [];
      for (let i = 0; i < 5; i++) {
        sel.selectedIndex = Math.min(sel.selectedIndex + 1, sel.options.length - 1);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 30));
        steps.push(SH.UI._test.view().players[seat].bid);
      }
      const go = [...document.querySelectorAll('#actions button')]
        .find(b => b.hasAttribute('data-advance'));
      return {
        before,
        steps,
        phase: SH.UI._test.view().phase,
        goEnabledAfterChoosing: go ? go.getAttribute('aria-disabled') !== 'true' : false,
        goLabel: go ? (go.textContent || '').trim() : '',
        goName: go ? (go.getAttribute('aria-label') || '') : '',
        selectSurvived: document.getElementById('bid-select') === sel,
        stillFocused: document.activeElement === sel
      };
    });

    check(m.before === null, 'this seat had already bid before the arrow test');
    check(m.steps.every(b => b === null),
      'moving through the bid list PLACED a bid: ' + JSON.stringify(m.steps) +
      ' — arrowing must choose, never commit');
    check(m.phase === 'bidding', 'the phase left the bidding while only arrowing');

    /* Choosing enables the button IN PLACE, without rebuilding the actions area,
     * because a re-render would destroy the select the player is standing in and
     * drop focus mid-choice. */
    check(m.goEnabledAfterChoosing, 'choosing a bid did not enable the place-bid button');

    /* AND THE BUTTON NOW SAYS WHAT IT WILL DO. "Place this bid" describes the
     * mechanism and names no bid; somebody who tabs onto it after choosing —
     * or after being interrupted between choosing and committing — should hear
     * what they are about to commit to. On a hundred-point bet that matters. */
    check(/^Bid /.test(m.goLabel),
      'after choosing, the button still reads "' + m.goLabel + '" and does not ' +
      'name the bid it would place');
    check(m.goName.length > m.goLabel.length,
      'the button has no fuller accessible name: "' + m.goName + '"');
    check(m.selectSurvived,
      'the select was rebuilt when a bid was chosen, which drops focus mid-choice');
    check(m.stillFocused, 'focus left the bid select when a bid was chosen');
    note('arrowing does not bid');
  }

  /* ---- 2c. the review keys still work inside the select ---- */
  {
    /* The bid select is the one form control on this page where H and B still
     * fire. The player is standing in it deciding what to bid, and the most
     * useful thing at that moment is to hear the hand they are bidding on.
     * Having to shift+tab out to the toolbar for that would reintroduce the tab
     * problem this control exists to remove, one step to the left. */
    const heard = await page.evaluate(async () => {
      const sel = document.getElementById('bid-select');
      /* Guarded, and the guard earns its place. If an earlier section leaves the
       * bidding — which is exactly what happens when the select is wired to
       * place a bid on change — this element is gone, and reaching straight for
       * .focus() throws. A throw here abandons the run with every assertion the
       * suite had already collected still unprinted, so the report is a stack
       * trace about a null instead of the four clear failures above it. */
      if (!sel) return '(the bid select was gone by this point)';
      sel.focus();
      const out = [];
      const region = document.getElementById('say-polite');
      const obs = new MutationObserver(() => {
        if (region.textContent) out.push(region.textContent);
      });
      obs.observe(region, { childList: true, characterData: true, subtree: true });
      sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      obs.disconnect();
      return out.join(' | ');
    });
    check(/clubs|diamonds|hearts|spades/i.test(heard),
      'H inside the bid select said "' + heard + '", so the player cannot hear ' +
      'the hand they are bidding on without leaving the control');
    note('review keys in the select');
  }

  /* ---- 3. a card cannot be played during the bidding, and says so ---- */
  {
    const m = await page.evaluate(() => {
      const before = SH.UI._test.view().phase;
      const card = document.querySelector('#hand .card');
      card.click();
      return { before, after: SH.UI._test.view().phase };
    });
    check(m.before === 'bidding' && m.after === 'bidding',
      'clicking a card during the bidding changed the phase from ' + m.before +
      ' to ' + m.after);
    note('cards inert while bidding');
  }

  /* ---- 4. bid, and reach the play ---- */
  {
    await page.evaluate(() => {
      /* Choose, then place. Two steps, deliberately: the select alone must never
       * commit. Guarded like the section above, so that a regression which ends
       * the bidding early reports the assertions that caught it rather than a
       * stack trace about a null. */
      const sel = document.getElementById('bid-select');
      if (!sel) return;
      sel.value = '3';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const go = [...document.querySelectorAll('#actions button')]
        .find(b => b.hasAttribute('data-advance'));
      if (go) go.click();
    });
    await until(page, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'play');
    }, 'the play to begin', 30);

    const m = await page.evaluate(() => {
      const v = SH.UI._test.view();
      return {
        allBid: v.players.every(p => p.bid !== null),
        mine: v.players[SH.UI._test.seat()].bid,
        /* Trump is marked on the cards, permanently, because in this game it
         * always is. */
        spadesMarked: [...document.querySelectorAll('#hand .card')]
          .filter(c => /Spades/.test(c.getAttribute('aria-label') || ''))
          .every(c => c.classList.contains('trump')),
        /* And the accessible name says "trump" on a spade, because a player
         * hearing "the two of spades" while holding the ace of hearts needs to
         * know which one takes the trick. */
        spadeNamesSayTrump: [...document.querySelectorAll('#hand .card')]
          .filter(c => /of Spades/.test(c.getAttribute('aria-label') || ''))
          .every(c => /trump/.test(c.getAttribute('aria-label') || '')),
        nonSpadesDoNot: [...document.querySelectorAll('#hand .card')]
          .filter(c => !/of Spades/.test(c.getAttribute('aria-label') || ''))
          .every(c => !/trump/.test(c.getAttribute('aria-label') || ''))
      };
    });
    check(m.allBid, 'the play began before every seat had bid');
    check(m.mine === 3, 'this seat bid 3 and the view says ' + m.mine);
    check(m.spadesMarked, 'a spade in the hand is not marked as trump visually');
    check(m.spadeNamesSayTrump, 'a spade does not say "trump" in its accessible name');
    check(m.nonSpadesDoNot,
      'a card that is not a spade claims to be trump, which would be worse than saying nothing');
    note('play begins');
  }

  /* ---- 5. an unplayable card says WHICH RULE stopped it ---- */
  {
    await until(page, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'play' && v.turn === SH.UI._test.seat() &&
        document.querySelector('#hand .card[aria-disabled="true"]'));
    }, 'a turn where some card is not legal', 40);

    const m = await page.evaluate(() => {
      const off = [...document.querySelectorAll('#hand .card[aria-disabled="true"]')];
      const on = [...document.querySelectorAll('#hand .card:not([aria-disabled="true"])')];
      return {
        offCount: off.length,
        onCount: on.length,
        /* aria-disabled, NOT the disabled attribute: a disabled button cannot be
         * focused, so somebody tabbing through never learns it is there. */
        reallyDisabled: off.filter(c => c.disabled).length,
        reasons: off.map(c => c.getAttribute('aria-label') || ''),
        oneTabStop: [...document.querySelectorAll('#hand .card')]
          .filter(c => c.getAttribute('tabindex') === '0').length
      };
    });

    check(m.offCount > 0, 'no card was marked unplayable, so nothing was tested');
    check(m.reallyDisabled === 0,
      m.reallyDisabled + ' cards use the disabled attribute rather than aria-disabled, ' +
      'so a screen reader user tabbing through never learns they exist');

    /* The reason has to be the RULE, in words. "Not a legal card here" is a
     * refusal; "you must follow hearts" teaches the game. */
    const RULES = /must follow|spades have not been broken|not a legal card/;
    m.reasons.forEach(r => {
      check(RULES.test(r), 'an unplayable card says "' + r + '", which names no rule');
    });
    check(m.oneTabStop === 1,
      'the hand has ' + m.oneTabStop + ' tab stops; it should be a single roving one');
    note('why not');
  }

  /* ---- 6. B reads the contract, and Shift+B opens the bug reporter ---- */
  {
    /* This is the one keyboard difference from the other four games in this
     * repository, and it is deliberate: the contract is asked for constantly and
     * earns the letter that matches the word. A test exists because a deliberate
     * inconsistency is indistinguishable from a mistake without one. */
    const said = await page.evaluate(async () => {
      const out = [];
      const region = document.getElementById('say-polite');
      const obs = new MutationObserver(() => {
        if (region.textContent) out.push(region.textContent);
      });
      obs.observe(region, { childList: true, characterData: true, subtree: true });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      obs.disconnect();
      return out.join(' | ');
    });
    check(/bid|took|needed|over/i.test(said),
      'B said "' + said + '", which does not look like the contract');

    const dialogOpen = await page.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'B', shiftKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const d = document.getElementById('bug-dialog');
      const open = d.open;
      if (open) d.close();
      return open;
    });
    check(dialogOpen, 'Shift+B did not open the bug reporter');
    note('contract key');
  }

  /* ---- 7. every shortcut is also a button, and the action is next to the cards ---- */
  {
    const m = await page.evaluate(() => {
      const stops = [...document.querySelectorAll(
        '#game-section button, #game-section a, #game-section [tabindex="0"]')]
        .filter(e => e.offsetParent !== null && e.getAttribute('tabindex') !== '-1');
      const firstCard = stops.findIndex(e => e.classList.contains('card'));
      const action = stops.findIndex(e => e.hasAttribute('data-advance'));
      return {
        toolbar: [...document.querySelectorAll('.toolbar button')]
          .map(b => (b.textContent || '').trim()),
        keyshortcuts: [...document.querySelectorAll('.toolbar button[aria-keyshortcuts]')].length,
        firstCard, action
      };
    });

    const WANT = [['hand', /Hand/], ['trick', /Trick/], ['last trick', /Last trick/],
      ['contract', /Bids and contract/], ['scores', /Scores and bags/],
      ['who', /Who is here/], ['next', /Next/], ['log', /Game log/]];
    WANT.forEach(pair => {
      check(m.toolbar.some(l => pair[1].test(l)),
        'the ' + pair[0] + ' shortcut has no button, so it is reachable only by keyboard');
    });
    check(m.keyshortcuts >= 10,
      'only ' + m.keyshortcuts + ' toolbar buttons advertise their shortcut');
    note('shortcuts');
  }

  /* ---- 8. play a hand out: the tables fill in, and focus is never lost ---- */
  {
    let focusLost = 0;
    for (let i = 0; i < 400; i++) {
      const done = await page.evaluate(() => {
        const T = SH.UI._test;
        const v = T.view();
        if (!v) return true;
        if (v.phase === 'handOver' || v.phase === 'gameOver') return true;
        const me = T.seat();
        if (v.phase === 'bidding') {
          if (v.turn !== me) return false;
          const sel = document.getElementById('bid-select');
          if (sel) {
            sel.value = '3';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            const go = [...document.querySelectorAll('#actions button')]
              .find(b => b.hasAttribute('data-advance'));
            if (go && go.getAttribute('aria-disabled') !== 'true') go.click();
          }
          return false;
        }
        if (v.phase === 'play' && v.turn === me) {
          const live = [...document.querySelectorAll('#hand .card')]
            .find(c => c.getAttribute('aria-disabled') !== 'true');
          if (live) { live.click(); return false; }
        }
        return false;
      });
      const onBody = await page.evaluate(() =>
        document.activeElement === document.body ||
        document.activeElement === document.documentElement);
      if (onBody) focusLost++;
      if (done) break;
      await sleep(25);
    }

    /* Focus on <body> is silent: the player is left nowhere, with no way to
     * know the game is waiting for them. A few frames of it while the computer
     * plays is unavoidable; a persistent state of it is the bug. */
    check(focusLost < 40,
      'focus sat on <body> for ' + focusLost + ' samples — a player would be left nowhere');

    const m = await page.evaluate(() => {
      const v = SH.UI._test.view();
      const rows = t => [...document.querySelectorAll('#' + t + ' tbody tr')]
        .map(r => [...r.children].map(c => c.textContent.trim()));
      return {
        phase: v.phase,
        teams: rows('teams-table'),
        players: rows('players-table'),
        history: rows('history-table'),
        log: document.querySelectorAll('#log li').length,
        status: document.getElementById('status').textContent,
        /* The bag cell has to name itself: a bare number in a grid is a number
         * with no subject unless the reader is tracking both headers. */
        bagLabels: [...document.querySelectorAll('#teams-table tbody tr')]
          .map(r => r.children[2] && r.children[2].getAttribute('aria-label'))
      };
    });

    check(m.phase === 'handOver' || m.phase === 'gameOver',
      'the hand never finished, it is still in ' + m.phase);
    check(m.teams.length === 2, 'the partnerships table has ' + m.teams.length + ' rows, not 2');
    check(m.players.length === 4, 'the players table has ' + m.players.length + ' rows, not 4');
    check(m.history.length >= 1, 'the history table is empty after a completed hand');
    check(m.log > 5, 'the log has only ' + m.log + ' entries after a whole hand');
    check(m.status.length > 0, 'the status line is empty at the end of a hand');
    m.bagLabels.forEach((l, i) => {
      check(l && /bag/i.test(l),
        'the bag cell in row ' + i + ' has no accessible name: "' + l + '"');
    });
    note('a hand played out');
  }

  /* ---- 9. nothing threw, the whole way through ---- */
  check(pageErrors.length === 0,
    'the page threw: ' + pageErrors.slice(0, 3).join(' / '));

  await browser.close();

  console.log(checks.toLocaleString() + ' assertions across ' +
    Object.keys(seen).join(', '));
  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.error('\nFAIL (' + uniq.length + '):');
    uniq.slice(0, 15).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('The interface is playable without looking at it.');
})().catch(e => { console.error('ui-dom: threw — ' + e.stack); process.exit(1); });

/* Does the interface behave, for somebody who cannot see it?
 *
 * The rules suites prove the game is hearts. This proves the page is playable:
 * that every card can be reached and named, that a card you cannot play says so
 * and says why, that focus is never dropped on the floor, and that the things
 * which must not be live regions are not.
 *
 * Driven through real headless Chrome rather than jsdom, because this game now
 * runs a real server in the tab — LocalServer with its own latency — and a test
 * that cannot wait for a frame to arrive would be testing a different program.
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
 * short sleep is not a time budget — it is a bet on how fast the machine is.
 * That exact mistake made a sibling suite fail on CI and pass everywhere else. */
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
    let s = 20260821;
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
      main: document.querySelectorAll('main').length
    }));

    /* No role="application". It takes away the reading controls a screen reader
     * user already knows, in exchange for shortcuts they have to learn. */
    check(m.application === 0, 'the page uses role="application" somewhere');

    /* EXACTLY ONE of each live region. Two polite regions racing each other is
     * how a screen reader reads the second half of one sentence and the first
     * half of another. */
    check(m.polite === 1, 'there are ' + m.polite + ' polite live regions, not 1');
    check(m.assertive === 1, 'there are ' + m.assertive + ' assertive live regions, not 1');

    /* And the two things that must NOT be live. Both carry the same words the
     * announcer speaks; making either live says everything twice. */
    check(!m.logIsLive, 'the log is a live region, so every event is spoken twice');
    check(!m.statusIsLive, 'the status line is a live region, so it duplicates the announcer');

    check(m.skip, 'there is no skip link');
    check(m.h1 === 1, 'there are ' + m.h1 + ' h1 elements');
    check(m.main === 1, 'there is not exactly one main landmark');
    note('page');
  }

  /* ---- 2. every shortcut is also a button ---- */
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
      return !!(v && v.phase !== 'idle');
    }, 'the first hand to be dealt');

    /* The review controls live in the TOOLBAR, not the actions area, and that is
     * the point of this check rather than an implementation detail.
     *
     * They were in #actions, between the primary action and the hand, which put
     * five buttons in the way: shift+tab six times from a card to reach "Pass
     * these three cards". Reported by somebody playing it, not by any test here,
     * which is why the tab-order assertion below now exists. */
    const m = await page.evaluate(() => {
      const stops = [...document.querySelectorAll(
        '#game-section button, #game-section a, #game-section [tabindex="0"]')]
        .filter(e => e.offsetParent !== null && e.getAttribute('tabindex') !== '-1');
      const firstCard = stops.findIndex(e => e.classList.contains('card'));
      const action = stops.findIndex(e => e.hasAttribute('data-advance') ||
        /Pass these three|Deal the next|Start a new/.test(e.textContent));
      return {
        toolbar: [...document.querySelectorAll('.toolbar button')]
          .map(b => (b.textContent || '').trim()),
        firstCard: firstCard,
        action: action,
        between: (firstCard >= 0 && action >= 0) ? Math.abs(firstCard - action) - 1 : -1
      };
    });

    const WANT = [['hand', /Hand/], ['trick', /Trick/], ['scores', /Scores/],
      ['points', /Points/], ['who', /Who is here/], ['next', /Next/]];
    WANT.forEach(pair => {
      check(m.toolbar.some(l => pair[1].test(l)),
        'the ' + pair[0] + ' shortcut has no button, so it is reachable only by keyboard');
    });

    /* THE ACTION IS NEXT TO THE CARDS. Nothing between them in the tab order, so
     * one shift+tab from a card reaches the thing you do with cards. */
    check(m.between === 0,
      'there are ' + m.between + ' tab stops between the hand and the primary action; ' +
      'the thing you do with a card should be one shift+tab from the cards');
    note('shortcuts');
  }

  /* ---- 3. the pass: cards are toggles, and say they are ---- */
  {
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      const first = cards[0];
      const id = first.dataset.id;
      const before = first.getAttribute('aria-pressed');
      first.click();
      /* RE-QUERY. render() rebuilds the hand, so the element clicked above is
       * detached the moment it is clicked and its attributes are frozen at what
       * they were. Reading it again reported "false then false" and looked like
       * a broken toggle in the app; the app was fine and this was holding a
       * corpse. */
      const live = document.querySelector('#hand .card[data-id="' + id + '"]');
      const after = live && live.getAttribute('aria-pressed');
      return {
        count: cards.length,
        allButtons: cards.every(c => c.tagName === 'BUTTON'),
        allNamed: cards.every(c => (c.getAttribute('aria-label') || '').length > 3),
        pressedBefore: before, pressedAfter: after,
        nameMentionsChosen: /chosen to pass/.test((live && live.getAttribute('aria-label')) || ''),
        oneTabStop: cards.filter(c => c.getAttribute('tabindex') === '0').length
      };
    });
    check(m.count === 13, 'the hand shows ' + m.count + ' cards, not 13');
    check(m.allButtons, 'a card is not a button, so it cannot be activated by keyboard');
    check(m.allNamed, 'a card has no accessible name, so it cannot be read at all');
    check(m.pressedBefore === 'false' && m.pressedAfter === 'true',
      'a card being chosen for the pass does not toggle aria-pressed (' +
      m.pressedBefore + ' then ' + m.pressedAfter + ')');
    check(m.nameMentionsChosen,
      'a chosen card does not say so in its name — aria-pressed alone is read as ' +
      '"pressed" by some screen readers and not at all by others');

    /* One tab stop for the whole hand, arrows to move within it. Thirteen tab
     * stops is thirteen presses to get past your own cards. */
    check(m.oneTabStop === 1,
      'the hand has ' + m.oneTabStop + ' tab stops; it should be a single roving one');
    note('passing');
  }

  /* ---- 4. a disabled action explains itself ---- */
  {
    const m = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#actions button')]
        .find(x => /Pass these three/.test(x.textContent));
      return b ? {
        ariaDisabled: b.getAttribute('aria-disabled'),
        reallyDisabled: b.disabled,
        title: b.getAttribute('title') || ''
      } : null;
    });
    check(!!m, 'there is no pass button during the passing phase');
    if (m) {
      /* aria-disabled, NOT the disabled attribute. A disabled button cannot be
       * focused, so somebody tabbing through never learns it is there or why. */
      check(m.ariaDisabled === 'true', 'the pass button is not marked aria-disabled with 1 of 3 chosen');
      check(!m.reallyDisabled,
        'the pass button uses the disabled attribute, so it cannot be focused and ' +
        'its reason can never be read');
      check(/more card/.test(m.title),
        'the disabled pass button does not say what is missing (title: "' + m.title + '")');
    }
    note('disabled-reason');
  }

  /* ---- 5. play: unplayable cards say which rule stopped them ---- */
  {
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      cards.filter(c => c.getAttribute('aria-pressed') === 'false').slice(0, 2).forEach(c => c.click());
      const b = [...document.querySelectorAll('#actions button')]
        .find(x => /Pass these three/.test(x.textContent));
      if (b && b.getAttribute('aria-disabled') !== 'true') b.click();
    });
    await until(page, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'play');
    }, 'the play to begin');

    /* Play on until this seat has a card it may not play — which happens the
     * moment a suit is led that it cannot follow, or on the first trick. */
    await until(page, () => {
      const v = SH.UI._test.view();
      if (!v || v.phase !== 'play') return false;
      const me = SH.UI._test.seat();
      if (v.turn === me) {
        const cards = [...document.querySelectorAll('#hand .card')];
        if (cards.some(c => c.getAttribute('aria-disabled') === 'true')) return true;
        const live = cards.find(c => c.getAttribute('aria-disabled') !== 'true');
        if (live) live.click();
      }
      return false;
    }, 'a card this seat may not play', 30);

    const m = await page.evaluate(() => {
      const off = [...document.querySelectorAll('#hand .card[aria-disabled="true"]')];
      return {
        count: off.length,
        names: off.slice(0, 3).map(c => c.getAttribute('aria-label') || ''),
        stillFocusable: off.every(c => !c.disabled)
      };
    });
    check(m.count > 0, 'never found a card this seat may not play');
    if (m.count) {
      /* The name has to carry the RULE. "Queen of Hearts, unavailable" teaches
       * nothing; "you must follow clubs" teaches the game. */
      const RULES = /must follow|not been broken|two of clubs|no points on the first trick/;
      check(m.names.every(n => RULES.test(n)),
        'an unplayable card does not say which rule stopped it: "' + m.names[0] + '"');
      check(m.stillFocusable,
        'an unplayable card uses the disabled attribute, so its reason can never be read');
    }
    note('why-not');
  }

  /* ---- 6. focus is never dropped ---- */
  {
    const m = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    check(m && m !== 'BODY',
      'focus is on <body> during play — the player is left nowhere, silently, with ' +
      'no way to know the game is waiting for them');
    note('focus');
  }

  /* ---- 7. focus follows the turn, AT THE FASTEST PACE ----
   *
   * The pace is the whole point of this section rather than a detail.
   *
   * The focus fix is a comparison of whose turn it was last time, and that is
   * only sound if the in-between state is ever observed. At pace 0 the computer
   * answers immediately, so the worry is that the turn goes ours, theirs, ours
   * between two frames and the change is never seen.
   *
   * I thought I had found that failing on the live site. I had not: focus was
   * elsewhere because I had moved it there myself and nothing had happened
   * since, which is correct behaviour and not a bug. Mutation testing settled
   * it — the old comparison passes this section even at pace 0 and even with
   * focus stolen between turns, because the in-between frame IS delivered.
   *
   * The section stays, at the fastest pace and stealing focus each turn, which
   * is the condition a player is actually in: a click does not move focus, and
   * somebody who just used the toolbar is not sitting on a card. It guards the
   * behaviour. It does not guard a bug I could not reproduce, and saying so
   * here is cheaper than somebody later trusting a comment that overclaims. */
  {
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1280, height: 900 });
    await page2.evaluateOnNewDocument(() => {
      let s = 20260821;
      Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    });
    await page2.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
    await page2.evaluate(() => {
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
    await until(page2, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'passing');
    }, 'the deal at pace 0');

    await page2.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      cards.filter(c => c.getAttribute('aria-pressed') === 'false').slice(0, 3)
        .forEach(c => c.click());
      const g = [...document.querySelectorAll('#actions button')]
        .find(x => /Pass these three/.test(x.textContent));
      if (g && g.getAttribute('aria-disabled') !== 'true') g.click();
    });

    const landed = [];
    for (let t = 0; t < 5; t++) {
      const ok = await until(page2, () => {
        const v = SH.UI._test.view();
        return !!(v && v.phase === 'play' && v.turn === SH.UI._test.seat());
      }, 'turn ' + (t + 1) + ' at pace 0', 15);
      if (!ok) break;
      landed.push(await page2.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.classList && a.classList.contains('card'));
      }));
      /* Play the card AND take focus away, which is what actually happens: a
       * click does not move focus, and a player who just used the toolbar or
       * read the log is not sitting on a card. If focus only ever happened to
       * be right because the previous turn left it there, this is where that
       * shows. */
      await page2.evaluate(() => {
        const c = [...document.querySelectorAll('#hand .card')]
          .find(x => x.getAttribute('aria-disabled') !== 'true');
        if (c) c.click();
        document.getElementById('main').focus();
      });
      await sleep(120);
    }

    check(landed.length >= 4,
      'only reached ' + landed.length + ' of our turns at pace 0');
    check(landed.every(Boolean),
      'focus was in the hand on ' + landed.filter(Boolean).length + ' of ' + landed.length +
      ' turns at pace 0 — the game was waiting on cards the player had to go and find');
    await page2.close();
    note('focus-pace');
  }
  /* ---- 8. TAKING A TRICK MUST NOT STRAND THE PLAYER ----
   *
   * The case a player reported twice, and the one every earlier version of the
   * focus logic missed.
   *
   * Play the fourth card of a trick and win it, and the turn goes from you to
   * you: finishTrick sets the leader to the winner inside the same action, so
   * there is no frame in between and nothing that looks like a change. A check
   * asking "was it my turn last time" says yes both times and moves nothing. You
   * take the trick and the game waits on a hand you cannot reach.
   *
   * Seeded at 12345 SPECIFICALLY, because that deal reaches the state and the
   * suite's usual seed does not. A regression test for a case it never enters is
   * an assertion about nothing — which is exactly why mutation testing could not
   * tell the broken version from the fixed one, and why I reverted a correct fix
   * on the strength of it.
   *
   * Focus is moved away before each play, because a click does not move focus
   * and the point is what the GAME does next, not where the previous turn
   * happened to leave things.
   */
  {
    const page3 = await browser.newPage();
    await page3.setViewport({ width: 1280, height: 900 });
    await page3.evaluateOnNewDocument(() => {
      let s = 12345;
      Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    });
    await page3.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
    await page3.evaluate(() => {
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
    await until(page3, () => {
      const v = SH.UI._test.view();
      return !!(v && v.phase === 'passing');
    }, 'the deal at seed 12345');

    await page3.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      cards.filter(c => c.getAttribute('aria-pressed') === 'false').slice(0, 3)
        .forEach(c => c.click());
      const g = [...document.querySelectorAll('#actions button')]
        .find(x => /Pass these three/.test(x.textContent));
      if (g && g.getAttribute('aria-disabled') !== 'true') g.click();
    });

    let tookATrick = 0;
    let strandedAfterTaking = 0;

    for (let i = 0; i < 30; i++) {
      const mine = await page3.evaluate(() => {
        const v = SH.UI._test.view();
        return !!(v && v.phase === 'play' && v.turn === SH.UI._test.seat());
      });
      if (!mine) { await sleep(60); continue; }

      const onTable = await page3.evaluate(() => SH.UI._test.view().trick.length);

      await page3.evaluate(() => {
        const c = [...document.querySelectorAll('#hand .card')]
          .find(x => x.getAttribute('aria-disabled') !== 'true');
        if (c) c.click();
        document.getElementById('main').focus();     // measure the game, not the click
      });
      await sleep(350);

      const after = await page3.evaluate(() => {
        const v = SH.UI._test.view();
        const a = document.activeElement;
        return {
          stillMine: !!(v && v.phase === 'play' && v.turn === SH.UI._test.seat()),
          inHand: !!(a && a.classList && a.classList.contains('card'))
        };
      });

      /* Four on the table means ours completed the trick, and the turn still
       * being ours means we took it. */
      if (onTable === 3 && after.stillMine) {
        tookATrick++;
        if (!after.inHand) strandedAfterTaking++;
      }
      if (tookATrick >= 2) break;
    }

    check(tookATrick > 0,
      'never took a trick as the last to play, so the case a player reported ' +
      'twice went untested — the seed must reach it or this section proves nothing');
    check(strandedAfterTaking === 0,
      'took a trick and focus was left outside the hand ' + strandedAfterTaking +
      ' time(s) — the game is waiting on cards the player has to go and find');
    await page3.close();
    note('won-trick');
  }
  /* ---- settings, and the help that goes somewhere ---- */
  {
    const page4 = await browser.newPage();
    await page4.setViewport({ width: 1280, height: 900 });
    await page4.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
    await page4.evaluate(() => {
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
    await new Promise(r => setTimeout(r, 400));

    const start = await page4.evaluate(() => document.body.className);
    check(start === 'skin-traditional', 'the game does not start on the traditional skin');

    /* btn-settings, not tool-settings. The other four games on this site name
     * this button btn-settings, and hearts and spades were the two that did not
     * — the same split that had them showing their settings inline on the start
     * screen while everybody else put them behind a dialog. Both are now the
     * majority spelling. */
    const controls = await page4.evaluate(() => ['btn-settings', 'tool-rules',
      'tool-a11y', 'tool-newgame', 'settings-dialog', 'setup-settings',
      'settings-summary']
      .filter(i => !document.getElementById(i)));
    check(controls.length === 0,
      'these controls are missing from the page: ' + controls.join(', ') +
      '. Every other game here has all of them, under Settings and help');
    /* NOT `return` — that skips browser.close() at the bottom, so node never
     * exits and a missing button looks exactly like a hung test. It cost an
     * hour: a leftover id from an interrupted mutation run sat in the page and
     * every run afterwards simply stopped, silently, with no failure printed
     * because the failures are printed after the browser is closed. */
    if (!controls.length) {

    /* Open it the way a player does — focused, then activated — because that is
     * also the only way to find out whether focus comes back afterwards. */
    await page4.evaluate(() => {
      const b = document.getElementById('btn-settings');
      b.focus(); b.click();
    });
    await new Promise(r => setTimeout(r, 150));

    const opened = await page4.evaluate(() => ({
      open: document.getElementById('settings-dialog').open,
      inside: document.getElementById('settings-dialog').contains(document.activeElement)
    }));
    check(opened.open, 'the Settings button did not open the settings dialog');
    check(opened.inside, 'the settings dialog opened and left focus outside it');

    /* A setting that takes effect straight away has to take effect straight
     * away. Hearts had no way to change the card style once a game had begun —
     * this is the check that the new one does more than look like a control. */
    await page4.evaluate(() => {
      const sel = document.getElementById('opt-skin');
      sel.value = 'plain';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 150));
    check(await page4.evaluate(() => document.body.className) === 'skin-plain',
      'choosing the plain card style changed nothing on the page');

    await page4.evaluate(() => document.getElementById('settings-close').click());
    await new Promise(r => setTimeout(r, 150));
    check(await page4.evaluate(() => !document.getElementById('settings-dialog').open),
      'Done did not close the settings dialog');
    check(await page4.evaluate(() => document.activeElement.id) === 'btn-settings',
      'closing the dialog dropped focus rather than returning it to the button ' +
      'that opened it, which leaves a keyboard player at the top of the document');

    /* Remembered. Hearts forgot everything between games, alone among the five:
     * choose the plain style, come back tomorrow, and it is faces again. */
    await page4.reload({ waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 300));
    check(await page4.evaluate(() => document.body.className) === 'skin-plain',
      'the card style was not remembered across a reload');
    check(await page4.evaluate(() => document.getElementById('opt-skin').value) === 'plain',
      'the start screen does not show the style that is actually in force');

    /* The two help buttons move to the sections this page already has, so the
     * test is that focus lands on the heading — not that a dialog opened. */
    for (const [id, want] of [['tool-a11y', 'keys-h'], ['tool-rules', 'rules-h']]) {
      await page4.evaluate((i) => document.getElementById(i).click(), id);
      await new Promise(r => setTimeout(r, 150));
      const landed = await page4.evaluate(() => document.activeElement.id);
      check(landed === want,
        id + ' put focus on "' + landed + '" rather than the ' + want + ' heading, ' +
        'so it announces nothing and the reader is left where they were');
    }

    await page4.evaluate(() => document.body.focus());
    /* Pressed HERE, after the reload, so it is pressed with no game in
     * progress — which is the state it used to fail in. onKey began with
     * `if (!state) return`, so ? did nothing at all on the start screen, which
     * is exactly where somebody wonders whether this can be played by keyboard.
     * Pressing it mid-game would have passed and proved the wrong thing. */
    await page4.keyboard.press('?');
    await new Promise(r => setTimeout(r, 200));
    check(await page4.evaluate(() => document.activeElement.id) === 'keys-h',
      'the ? key did not reach the keyboard hints before a game had started');

    }

    await page4.close();
    note('settings');
  }

  await browser.close();

  check(pageErrors.length === 0, 'the page threw: ' + pageErrors.slice(0, 2).join(' | '));

  /* A section that did not run is not a section that passed. */
  const EXPECTED = ['page', 'shortcuts', 'passing', 'disabled-reason', 'why-not', 'focus', 'focus-pace', 'won-trick', 'settings'];
  EXPECTED.forEach(k => check(seen[k],
    'the "' + k + '" checks never ran, so the suite covered less than it says'));

  console.log(checks + ' assertions — covered: ' + Object.keys(seen).sort().join(', '));
  if (fails.length) {
    const uniq = [...new Set(fails)];
    console.error('\nFAIL (' + uniq.length + '):');
    uniq.slice(0, 12).forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('The interface can be played without seeing it.');
})().catch(e => { console.error('ui-dom: threw — ' + e.stack); process.exit(1); });

/* The lobby, driven the way a person drives it.
 *
 * jsdom loads the real page, and the real ui.js clicks the real buttons. The only
 * thing replaced is the wire: SH.Net is pointed at the in-process server from
 * js/localserver.js instead of a socket, so the client code under test — the
 * lobby, the seat list, the online game path — is exactly what ships.
 *
 * This is the last thing between here and two people at a table, and it is the
 * part where being unable to see the screen matters most. A lobby that "works"
 * but announces nothing leaves a player holding a code they cannot read, at a
 * table they cannot tell they have joined.
 *
 * Requires jsdom:  npm install --no-save jsdom
 *   node tests/lobby.js
 */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HARD_DEADLINE_MS = 8 * 60 * 1000;
const hardStop = setTimeout(function () {
  console.error('FAILED: the lobby suite stopped making progress and was killed by its own watchdog.');
  process.exit(1);
}, HARD_DEADLINE_MS);
if (typeof hardStop.unref === 'function') hardStop.unref();

async function boot() {
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      const store = {};
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          clear: () => {}, key: i => Object.keys(store)[i] || null,
          get length() { return Object.keys(store).length; }
        }
      });
    }
  });
  const { window } = dom;
  await new Promise(r => window.document.readyState === 'complete' ? r() : window.addEventListener('load', r));
  ['a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'].forEach(id => {
    const dlg = window.document.getElementById(id);
    if (typeof dlg.showModal !== 'function') { dlg.showModal = () => { dlg.open = true; }; dlg.close = () => { dlg.open = false; }; }
  });
  return { window, d: window.document };
}

/* Point SH.Net at an in-process room. Same message shapes, same call signatures,
 * no socket. */
function fakeWire(window, opts, shared) {
  const SH = window.SH;
  let server = null;
  /* Shared between windows on purpose: two browsers joining the same code have to
   * reach the SAME room, which is the whole thing being tested. */
  const codes = shared || {};

  SH.Net.createTable = function (o) {
    const code = (opts && opts.code) || 'P4K7M';
    server = SH.LocalServer.create({
      config: (o && o.config) || null,
      latency: (opts && opts.latency) || 2,
      botDelay: (opts && opts.botDelay) || 8
    });
    codes[code] = server;
    server.start();
    return Promise.resolve(code);
  };

  SH.Net.connect = function (o, onMessage, onStatus) {
    const s = codes[o.code];
    if (!s) {
      setTimeout(() => onStatus && onStatus({ state: 'nosuch', detail: 'no table with that code' }), 1);
      return { send() {}, close() {} };
    }
    const link = s.connect(o.seat, onMessage);
    if (!link) {
      setTimeout(() => onStatus && onStatus({ state: 'refused', detail: 'that seat is taken' }), 1);
      return { send() {}, close() {} };
    }
    setTimeout(() => onStatus && onStatus({ state: 'connected' }), 1);
    return link;
  };

  return { get server() { return server; }, codes: codes };
}

(async () => {
  const { window, d } = await boot();
  const wire = fakeWire(window);

  const $ = id => d.getElementById(id);

  /* Record everything the live regions ever say, rather than sampling them.
   *
   * A snapshot reads whatever is there at that instant, and the announcer moves
   * on: by the time the table had dealt, "your table code is P, 4, K, 7, M" had
   * been correctly spoken and correctly replaced by "Hand 1, Dinghy deals". The
   * first version of this test read the second one and concluded the code was
   * never announced, which is the opposite of what happened. */
  const heard = [];
  ['announcer', 'alerts'].forEach(id => {
    const node = $(id);
    const obs = new window.MutationObserver(() => {
      const t = node.textContent;
      if (t && heard[heard.length - 1] !== t) heard.push(t);
    });
    obs.observe(node, { childList: true, characterData: true, subtree: true });
  });
  const said = () => heard.join(' | ');

  /* --- 1. Getting to the lobby at all --- */

  check(!!$('setup-online'), 'there is no way into the lobby from the setup screen');
  $('setup-online').click();
  await sleep(50);
  check($('lobby-section').hidden === false, 'the lobby did not open');
  check($('setup-section').hidden === true, 'the setup screen was left showing behind the lobby');

  /* The code field is ONE input. Five boxes would move focus on every keystroke,
   * so the field you are in is never the one you think you are in. */
  const codeInputs = [...d.querySelectorAll('#lobby-section input[type="text"]')];
  check(codeInputs.length === 1,
    `the code is entered across ${codeInputs.length} fields; it must be one, or every keystroke moves focus`);
  check(!!$('lobby-code').getAttribute('aria-describedby'),
    'the code field has no description saying what a code looks like');

  /* --- 2. Making a table --- */

  $('lobby-create').click();
  await sleep(200);

  /* NOTHING IS DEALT UNTIL SOMEBODY SAYS SO.
   *
   * A table used to start the moment it was made, so the host had no chance to
   * send anybody the code — by the time they had read it out, the computer had
   * played their seat through half a hand. Reported from a real session, and the
   * whole reason the lobby now has a Start button. */
  check($('game-section').hidden === true,
    'the table started dealing before anybody pressed Start, so there was no time to share the code');
  check(!!$('lobby-start'), 'there is no way to start the game');
  check($('lobby-copy') && !$('lobby-copy').disabled, 'there is no way to copy the code');
  await sleep(600);
  check($('game-section').hidden === true,
    'the table dealt itself a moment later, without anybody asking');

  $('lobby-start').click();
  await sleep(300);

  const code = $('lobby-code-display').textContent.trim();
  check(code.length === 5, 'the table code is not five characters: "' + code + '"');
  check(!/[OIL01]/.test(code),
    'the code contains a character that cannot be read aloud safely: "' + code + '"');

  /* THE INVITE LINK, which is what the host actually sends.
   *
   * This used to check that the code was spelled out as "P, 4, K, 7, M" in a
   * line beside it, on the belief that a screen reader would run five upper
   * case characters together into a mumble. They do not — they spell them —
   * so the line was the same code said a second time. What is worth checking
   * is that there is something to SEND: a link carrying this table's code,
   * which the person receiving it can follow instead of finding a field and
   * typing five characters into it. */
  {
    const a = $('lobby-invite');
    check(!!a, 'there is no invite link on the table screen');
    check(a.getAttribute('href').indexOf('table=' + code) > 0,
      'the invite link does not carry this table: ' + a.getAttribute('href'));
    check(a.textContent.indexOf(code) > 0,
      'the invite link is not readable as text: ' + a.textContent);
  }
  /* The ANNOUNCER, specifically — not the visible status line.
   *
   * Checking either-or let a version through that set the text and announced
   * nothing, which for a player who cannot see the line is a table code that was
   * never told to them. The visible line is deliberately not a live region, so
   * the announcer is the only thing that speaks. */
  check(!$('lobby-status').hasAttribute('role'),
    'the visible lobby status is also a live region, so every message is spoken twice');

  /* --- 3. The seat list is a real table --- */

  const seatRows = [...d.querySelectorAll('#lobby-seats tbody tr')];
  check(seatRows.length >= 3, 'the seat list is empty');
  check(seatRows.every(r => r.querySelector('th[scope="row"]')),
    'seat rows have no row headers, so table navigation cannot say which seat a cell belongs to');
  check(!!d.querySelector('#lobby-seats caption'), 'the seat table has no caption');

  const statuses = seatRows.map(r => r.children[2].textContent);
  check(statuses.some(s => /you/i.test(s)), 'the seat list never says which seat is yours: ' + statuses.join(' | '));
  check(statuses.some(s => /computer/i.test(s)),
    'the seat list does not say that empty seats are played by the computer');

  /* --- 4. The game starts, and is playable over the wire --- */

  let guard = 0;
  while (guard++ < 300 && $('game-section').hidden) await sleep(20);
  check($('game-section').hidden === false, 'the game screen never appeared after the table dealt');
  check($('lobby-section').hidden === true, 'the lobby was left showing over the game');

  const cards = () => [...d.querySelectorAll('#hand .card')];
  await sleep(200);
  check(cards().length > 0, 'no cards were rendered from the projected view');

  /* Play until the hand is over, clicking whatever the interface offers. */
  let moves = 0;
  for (let i = 0; i < 3000; i++) {
    await sleep(10);
    const next = [...d.querySelectorAll('#actions button')]
      .find(b => /^(Pick up|Pass|Bury |Deal next|Continue)/i.test(b.textContent));
    if (next && !next.disabled) {
      if (/^Bury /i.test(next.textContent)) {
        cards().slice(0, 2).forEach(c => c.click());
        await sleep(30);
      }
      next.click();
      moves++;
      continue;
    }
    const playable = cards().find(c => c.getAttribute('aria-disabled') !== 'true');
    if (playable) { playable.click(); moves++; continue; }
    if (/complete/i.test($('status').textContent)) break;
  }
  check(moves > 3, 'the game was not playable over the wire: only ' + moves + ' moves were possible');

  /* Nothing in the DOM may carry a card another seat holds. */
  const truth = wire.server.peek();
  const mySeat = window.SH.Table.seat();
  const html = d.body.innerHTML;
  const leaked = [];
  truth.players.forEach((p, i) => {
    if (i === mySeat) return;
    p.hand.forEach(c => { if (html.includes('"' + c.id + '"')) leaked.push(c.id); });
  });
  check(leaked.length === 0, 'another seat\'s cards reached the page: ' + leaked.join(', '));

  /* --- 5. A code that is not a table --- */

  const second = await boot();
  fakeWire(second.window);
  const d2 = second.d;
  const heard2 = [];
  ['announcer', 'alerts'].forEach(id => {
    const node = d2.getElementById(id);
    const obs = new second.window.MutationObserver(() => {
      const t = node.textContent;
      if (t && heard2[heard2.length - 1] !== t) heard2.push(t);
    });
    obs.observe(node, { childList: true, characterData: true, subtree: true });
  });
  d2.getElementById('setup-online').click();
  await sleep(50);
  d2.getElementById('lobby-code').value = 'zzzzz';
  d2.getElementById('lobby-join-form').dispatchEvent(
    new second.window.Event('submit', { bubbles: true, cancelable: true }));
  // Announcements are spaced so a burst cannot wipe itself out, so the refusal
  // lands a moment after the "joining…" line that precedes it.
  await sleep(900);
  /* SPOKEN, not merely displayed.
   *
   * This is the path where a player never reaches a game: a code typed wrong, a
   * seat already taken. They are still in the lobby, and the visible status line
   * is not a live region, so the announcer is the only thing that can tell them.
   * Accepting the visible text here let a build through in which the lobby said
   * nothing aloud at all, which for the person this game is built for is a dead
   * end with no explanation. */
  const spoken2 = heard2.join(' | ');
  check(spoken2.trim().length > 0,
    'joining a table that does not exist was never spoken — only shown on screen');
  check(/no table with that code|not available|could not|not look like/i.test(spoken2),
    'joining a nonexistent table gave no usable spoken explanation: "' + spoken2 + '"');

  /* --- 6. The code field forgives how people type --- */

  const norm = second.window.SH;   // normalisation lives in ui.js; check via the field round trip
  d2.getElementById('lobby-code').value = ' p4k-7m ';
  d2.getElementById('lobby-code').dispatchEvent(new second.window.Event('change', { bubbles: true }));
  await sleep(150);
  check(/P, 4, K, 7, M/.test(heard2.join(' | ')),
    'a code typed with spaces, a dash and lower case was not read back correctly: "' +
    heard2.join(' | ') + '"');

  /* --- 7. TWO PEOPLE AT ONE TABLE ---
   *
   * The thing all of this is for, and until now nothing tested it. Everything
   * before this point exercises one browser talking to a room; this is a second
   * browser joining an existing table by its code, mid-hand, and both of them
   * playing.
   *
   * It is also the first test of the JOINER's experience, which is different from
   * the creator's in every way that matters: they arrive after the deal, into a
   * seat they did not choose, at a table already in progress. */
  {
    const host = await boot();
    const hostWire = fakeWire(host.window, { code: 'M7QRS' });
    host.d.getElementById('setup-online').click();
    await sleep(30);
    host.d.getElementById('lobby-create').click();
    await sleep(250);

    const hostCode = host.d.getElementById('lobby-code-display').textContent.trim();
    check(hostCode === 'M7QRS', 'the host did not get the table code: "' + hostCode + '"');

    // A second browser, sharing only the code.
    const guest = await boot();
    fakeWire(guest.window, {}, hostWire.codes);
    const gHeard = [];
    ['announcer', 'alerts'].forEach(id => {
      const node = guest.d.getElementById(id);
      const obs = new guest.window.MutationObserver(() => {
        const t = node.textContent;
        if (t && gHeard[gHeard.length - 1] !== t) gHeard.push(t);
      });
      obs.observe(node, { childList: true, characterData: true, subtree: true });
    });

    guest.d.getElementById('setup-online').click();
    await sleep(30);
    // Typed the way somebody reads it out: lower case, with a space.
    guest.d.getElementById('lobby-code').value = 'm7 qrs';
    guest.d.getElementById('lobby-join-form').dispatchEvent(
      new guest.window.Event('submit', { bubbles: true, cancelable: true }));

    const sampleGuest = () => {
      ['announcer', 'alerts'].forEach(id => {
        const t = guest.d.getElementById(id).textContent;
        if (t && gHeard.indexOf(t) < 0) gHeard.push(t);
      });
    };

    /* The host waits for the guest before starting — which is the point of the
     * button, and is only possible because the table no longer deals itself. */
    await sleep(200);
    check(host.d.getElementById('game-section').hidden === true,
      'the host was already playing before the guest arrived');
    host.d.getElementById('lobby-start').click();

    let g2 = 0;
    while (g2++ < 400 && guest.d.getElementById('game-section').hidden) { sampleGuest(); await sleep(20); }
    for (let k = 0; k < 40; k++) { sampleGuest(); await sleep(20); }
    check(guest.d.getElementById('game-section').hidden === false,
      'the second player never got into the game: "' + guest.d.getElementById('lobby-status').textContent + '"');

    const hostSeat = host.window.SH.Table.seat();
    const guestSeat = guest.window.SH.Table.seat();
    check(hostSeat !== guestSeat,
      'both players were put in the same seat (' + hostSeat + ')');

    /* Each sees their own cards and nobody else's. This is the whole promise. */
    const truth = hostWire.codes['M7QRS'].peek();
    [[host, hostSeat, 'host'], [guest, guestSeat, 'guest']].forEach(function (pair) {
      const win = pair[0], seat = pair[1], who = pair[2];
      const html = win.d.body.innerHTML;
      const leaked = [];
      truth.players.forEach((p, i) => {
        if (i === seat) return;
        p.hand.forEach(c => { if (html.indexOf('"' + c.id + '"') >= 0) leaked.push(c.id); });
      });
      check(leaked.length === 0, who + " was shown another seat's cards: " + leaked.join(", "));
      const own = [...win.d.querySelectorAll('#hand .card')];
      check(own.length > 0, who + ' has no cards on screen');
    });

    /* THE TABLE MUST BE RIGHT FOR THE SEAT YOU ARE ACTUALLY IN.
     *
     * Four separate places still assumed seat 0 was the player, and every one of
     * them was invisible to a test that only checked for leaked card ids: the
     * players table marked SEAT 0 as "(you)" for everybody, the score chip
     * labelled "You" showed seat 0's result to everybody, the decorative seat fan
     * drew your own hand as an opponent and omitted a real one, and the play
     * order line was gated on whether seat 0 had played.
     *
     * This is the same class as the bug that shipped: mySeat landed in half the
     * file. So the check is not "did a card leak" but "does this screen describe
     * the seat this player is in". */
    [[host, hostSeat, 'host'], [guest, guestSeat, 'guest']].forEach(function (pair) {
      const win = pair[0], seat = pair[1], who = pair[2];
      const rows = [...win.d.querySelectorAll('#players-table tbody tr')];
      check(rows.length > 0, who + ' has no players table');

      const marked = rows.map((r, i) => ({ i, txt: r.querySelector('th').textContent }))
        .filter(r => /\(you\)/.test(r.txt));
      check(marked.length === 1,
        who + ' has ' + marked.length + ' rows marked "(you)" in the players table');
      check(marked.length === 1 && marked[0].i === seat,
        who + ' is in seat ' + seat + ' but the table marks row ' + (marked[0] || {}).i + ' as "(you)"');

      /* The decorative fan shows the OTHER seats: one fewer than the table has.
       *
       * It is only drawn in the traditional skin, so the check is conditional on
       * the box being shown rather than on the list happening to be non-empty —
       * the latter is a silent skip that reports success either way, which is how
       * the seat-fan bug survived its first test. */
      const seatsBox = win.d.getElementById('seats');
      if (!seatsBox.hidden) {
        const fans = [...seatsBox.querySelectorAll('.seat')];
        check(fans.length === rows.length - 1,
          who + ': the opponent display shows ' + fans.length + ' seats at a table of ' + rows.length +
          ' — it either draws your own hand as an opponent or omits a real one');
      }
    });

    // The guest was told where they are, out loud.
    check(/seat \d/i.test(gHeard.join(' | ')),
      'the joining player was never told which seat they got: "' + gHeard.join(' | ') + '"');

    /* Both of them can actually move the game along. */
    let plays = 0;
    for (let i = 0; i < 2500; i++) {
      await sleep(10);
      sampleGuest();
      let acted = false;

      for (const win of [host, guest]) {
        const btns = [...win.d.querySelectorAll('#actions button')];

        /* The Bury button exists before it is usable — it turns on once the
         * right number of cards are selected. Clicking it while disabled and
         * concluding the game was stuck is how this loop first reported a
         * two-player table as unplayable. */
        const bury = btns.find(b => /^Bury /i.test(b.textContent));
        if (bury) {
          if (bury.disabled) {
            [...win.d.querySelectorAll('#hand .card')]
              .filter(c => !/selected/.test(c.className))
              .slice(0, 2).forEach(c => c.click());
            acted = true;
          } else {
            bury.click(); plays++; acted = true;
          }
          continue;
        }

        const other = btns.find(b => /^(Pick up|Pass|Deal next)/i.test(b.textContent) && !b.disabled);
        if (other) { other.click(); plays++; acted = true; continue; }

        if (/your turn/i.test(win.d.getElementById('status').textContent)) {
          const playable = [...win.d.querySelectorAll('#hand .card')]
            .find(c => c.getAttribute('aria-disabled') !== 'true');
          if (playable) { playable.click(); plays++; acted = true; }
        }
      }

      if (!acted && truth.phase === 'handOver') break;
    }

    check(plays > 3, 'two players at one table could not move the game along: ' + plays + ' moves');
  }


  /* Everything the player was told, across the whole run.
   *
   * Asked here rather than at the moment of creation: announcements are spaced
   * so a burst cannot wipe itself out, so a message queued at that instant lands
   * a moment later. Reading the recorder early tested the queue's timing rather
   * than whether the code was ever spoken at all. */
  /* SPOKEN, still spelled. The visible "read it out as" line is gone — a screen
   * reader spells a five character code perfectly well on its own, so the line
   * was the same code twice. The SPOKEN form keeps the spelling, because that
   * one is heard rather than read and costs nobody anything on screen. */
  const spelled = code.split('').join(', ');
  check(said().includes(spelled),
    'the table code was never spoken. A code that is only on screen is a code the '
    + 'player cannot read to anybody. Heard: "' + said() + '"');
  check(/seat [0-9]/i.test(said()),
    'the player was never told which seat they are in: "' + said() + '"');

  if (fails.length) {
    console.error('\nFAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('lobby opened, table made, invite link built and the code read back');
  console.log('seats are a real table with row headers; the game started and played over the wire');
  console.log('no other seat\'s cards reached the page.');
  process.exit(0);
})();

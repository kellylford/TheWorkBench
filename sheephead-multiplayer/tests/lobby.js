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
  ['rules-dialog', 'a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'].forEach(id => {
    const dlg = window.document.getElementById(id);
    if (typeof dlg.showModal !== 'function') { dlg.showModal = () => { dlg.open = true; }; dlg.close = () => { dlg.open = false; }; }
  });
  return { window, d: window.document };
}

/* Point SH.Net at an in-process room. Same message shapes, same call signatures,
 * no socket. */
function fakeWire(window, opts) {
  const SH = window.SH;
  let server = null;
  const codes = {};

  SH.Net.createTable = function (o) {
    const code = 'P4K7M';
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
      setTimeout(() => onStatus && onStatus({ state: 'refused', detail: 'no such table' }), 1);
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

  return { get server() { return server; } };
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

  const code = $('lobby-code-display').textContent.trim();
  check(code.length === 5, 'the table code is not five characters: "' + code + '"');
  check(!/[OIL01]/.test(code),
    'the code contains a character that cannot be read aloud safely: "' + code + '"');

  /* It must be SPELLED somewhere a screen reader will reach. "P4K7M" is a mumble;
   * "P, 4, K, 7, M" is something a person can write down. */
  const spelled = code.split('').join(', ');
  check($('lobby-code-read').textContent.includes(spelled),
    'the code is never spelled out, so it cannot be read to anybody: ' + $('lobby-code-read').textContent);
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
  await sleep(150);
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
  check(/not available|does not|could not|no such|not look like/i.test(spoken2),
    'joining a nonexistent table gave no usable spoken explanation: "' + spoken2 + '"');

  /* --- 6. The code field forgives how people type --- */

  const norm = second.window.SH;   // normalisation lives in ui.js; check via the field round trip
  d2.getElementById('lobby-code').value = ' p4k-7m ';
  d2.getElementById('lobby-code').dispatchEvent(new second.window.Event('change', { bubbles: true }));
  await sleep(150);
  check(/P, 4, K, 7, M/.test(heard2.join(' | ')),
    'a code typed with spaces, a dash and lower case was not read back correctly: "' +
    heard2.join(' | ') + '"');

  /* Everything the player was told, across the whole run.
   *
   * Asked here rather than at the moment of creation: announcements are spaced
   * so a burst cannot wipe itself out, so a message queued at that instant lands
   * a moment later. Reading the recorder early tested the queue's timing rather
   * than whether the code was ever spoken at all. */
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
  console.log('lobby opened, table made, code spelled out and read back');
  console.log('seats are a real table with row headers; the game started and played over the wire');
  console.log('no other seat\'s cards reached the page.');
  process.exit(0);
})();

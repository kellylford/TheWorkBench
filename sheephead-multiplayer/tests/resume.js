/* Coming back after a reload.
 *
 * Two things went wrong when a browser refreshed mid-game, and neither was a
 * crash — the page came back looking perfectly healthy, which is what made them
 * hard to notice and easy to dismiss.
 *
 *   THE TABLE WAS GONE. The code lived in a variable and nowhere else, so a
 *   refresh, or a browser restoring its own tabs, left the player on the New
 *   game screen. The code is the only thing standing between somebody and the
 *   game they were in the middle of, and if they had not written it down there
 *   was no way back at all.
 *
 *   THE GAME LOG WAS EMPTY. The room sends each seat the events it has not been
 *   told about, which is exactly right for a client that still has the ones it
 *   was told about, and exactly wrong for one that has just lost everything. A
 *   player who reads the game by ear came back to a board they could read and no
 *   record whatever of how it got that way.
 *
 * The second fix carries an obvious trap: hand back a whole game's events and
 * the natural thing is to speak them, which is several minutes of recitation
 * before you can find out whose turn it is. So the log and the speech queue part
 * company here, and that division is asserted below rather than assumed.
 *
 * Requires jsdom:  npm install --no-save jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('SKIP: jsdom is not installed. Run: npm install --no-save jsdom');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* One page load. `store` is handed in so a reload can be modelled honestly:
 * a fresh window, keeping only what a real reload would keep. */
async function boot(store) {
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      const local = {};
      const mk = box => ({
        getItem: k => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
        setItem: (k, v) => { box[k] = String(v); },
        removeItem: k => { delete box[k]; },
        clear: () => { Object.keys(box).forEach(k => delete box[k]); },
        key: i => Object.keys(box)[i] || null,
        get length() { return Object.keys(box).length; }
      });
      Object.defineProperty(window, 'localStorage', { configurable: true, value: mk(local) });
      /* sessionStorage SURVIVES a reload and dies with the tab, which is the
       * whole reason the table is kept there. Modelled by handing the same box
       * to the second boot. */
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: mk(store) });
    }
  });
  const { window } = dom;
  await new Promise(r => {
    if (window.document.readyState === 'complete') r();
    else window.addEventListener('load', r);
  });
  const d = window.document;
  ['rules-dialog', 'a11y-dialog', 'export-dialog', 'bug-dialog', 'settings-dialog'].forEach(id => {
    const dlg = d.getElementById(id);
    if (dlg && typeof dlg.showModal !== 'function') { dlg.showModal = () => { dlg.open = true; }; dlg.close = () => { dlg.open = false; }; }
  });
  return { window, d };
}

/* A table that answers like the real room: a welcome carrying a seat, a view,
 * and the backlog of events this seat is entitled to. */
function fakeTransport(window, backlog) {
  let handler = null;
  window.SH.Net.connect = function (opts, onMessage, onStatus) {
    handler = onMessage;
    setTimeout(() => {
      onStatus({ state: 'connected' });
      handler({
        type: 'welcome',
        seat: typeof opts.seat === 'number' ? opts.seat : 0,
        version: 1,
        view: realView(typeof opts.seat === "number" ? opts.seat : 0),
        events: backlog
      });
    }, 0);
    return { send() {}, close() {} };
  };
  return () => handler;
}

/* A REAL projection from the engine, not a hand-written stand-in.
 *
 * The interface reads a great many fields off a view and a stub that misses one
 * fails in a way that says nothing about the thing under test — which is exactly
 * what the first version of this file did. js/view.js is the authority on what a
 * seat may see, so ask it. */
function realView(seat) {
  const sandbox = { console, Math, Date, JSON, Set, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  }
  const G = sandbox.SH.Game;
  const state = G.createGame({
    numPlayers: 5,
    names: ['You', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5'],
    allPass: 'leaster', difficulty: 'hard',
    blackQueenDoubler: false, redQueenDoubler: false, redealDoubler: false
  });
  G.applyAction(state, seat, { type: 'start' });
  // Wind on until somebody has picked, so the view is a hand in progress rather
  // than a table waiting to begin.
  for (let i = 0; i < 200 && state.phase === 'pick'; i++) sandbox.SH.AI.act(state);
  for (let i = 0; i < 200 && state.phase === 'bury'; i++) sandbox.SH.AI.act(state);
  return sandbox.SH.View.forSeat(state, seat);
}

(async () => {
  /* ---------------- 1. The table survives a reload ---------------- */

  const session = {};                       // what sessionStorage keeps across the reload
  {
    const { window, d } = await boot(session);
    fakeTransport(window, []);

    d.getElementById('opt-name').value = 'Kelly';
    d.getElementById('setup-online').click();

    const resume = d.getElementById('lobby-resume');
    check(resume && resume.hidden,
      'a table was offered on a first visit, before anybody had been at one');

    d.getElementById('lobby-code').value = 'V7KY8';
    d.getElementById('lobby-join-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));

    check(!!session['sheephead-mp.table'],
      'sitting down at a table left nothing behind, so a reload has no way back to it');
    window.close();
  }

  /* The reload: a brand new window, keeping only what a browser would keep. */
  {
    const { window, d } = await boot(session);
    fakeTransport(window, []);
    d.getElementById('setup-online').click();

    const resume = d.getElementById('lobby-resume');
    check(resume && !resume.hidden,
      'after a reload the lobby did not offer the table this tab was just at — the code ' +
      'lives in a variable and nothing else, so a refresh loses the game unless the ' +
      'player wrote it down');
    check(/V7KY8/.test(d.getElementById('lobby-resume-text').textContent),
      'the offer does not name the table: ' + d.getElementById('lobby-resume-text').textContent);
    check(/V, 7, K, Y, 8/.test(d.getElementById('lobby-resume-text').textContent),
      'the remembered code is not spelled out, so it cannot be read back or written down');
    check(d.activeElement === d.getElementById('lobby-rejoin'),
      'focus did not land on the way back in. Somebody who has just reloaded mid-game is ' +
      'here to return to their table, not to type a code they may not have');

    /* And it can be declined: an old table must not be inescapable. */
    d.getElementById('lobby-forget').click();
    check(d.getElementById('lobby-resume').hidden, 'the table could not be forgotten');
    check(!session['sheephead-mp.table'], 'forgetting it left it in storage anyway');
    window.close();
  }

  /* ---------------- 2. The log comes back, and is not recited ---------------- */
  {
    const backlog = [];
    for (let i = 0; i < 24; i++) {
      backlog.push({ id: i, kind: 'play', text: 'Seat ' + ((i % 5) + 1) + ' plays a card, ' + i + ' points.' });
    }

    const { window, d } = await boot({});
    fakeTransport(window, backlog);

    d.getElementById('opt-name').value = 'Kelly';
    d.getElementById('setup-online').click();
    d.getElementById('lobby-code').value = 'V7KY8';
    d.getElementById('lobby-join-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }));
    /* The speech queue batches deliberately, so give it time to actually say
     * something before asking what was said. */
    await new Promise(r => setTimeout(r, 2000));

    const logged = [...d.querySelectorAll('#log li')].map(li => li.textContent);
    check(logged.length >= backlog.length,
      'the backlog did not reach the game log: ' + logged.length + ' entries for ' +
      backlog.length + ' events. A player who reads the game by ear came back to no ' +
      'record of the hand they are in the middle of');

    /* The trap the fix walks into if nobody is watching. */
    const spoken = (window.SH.UI.lastSpoken() || '') + ' ';
    const recited = backlog.filter(e => spoken.indexOf(e.text) >= 0).length;
    check(recited <= 2,
      'the backlog was read out: ' + recited + ' of ' + backlog.length + ' restored ' +
      'messages were spoken. That is minutes of recitation before the player can find ' +
      'out whose turn it is, with no way to skip it. The log is for reading back ' +
      'through at your own pace; it says so in its own instructions');
    check(/game log/i.test(spoken),
      'nothing said that there was a backlog to read at all, so it is only discoverable ' +
      'by going and looking: ' + spoken.slice(0, 160));
    window.close();
  }

  if (fails.length) {
    console.error('FAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('a reload is offered its table back, and the restored log is read rather than recited');
})().catch(e => { console.error('the run itself failed: ' + e.stack); process.exit(1); });

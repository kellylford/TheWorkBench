/* The announcement queue: nothing spoken is ever silently lost.
 *
 * Both live regions are written by blanking the node and setting the text a
 * moment later. The blank is required — setting the same string twice is not a
 * DOM change and a screen reader says nothing — and it carries a race that
 * single-player could never trigger, because offline no two messages overlap.
 *
 * Over a socket they will. Two views twenty milliseconds apart means the second
 * blank runs before the first timeout fires, and the first message IS NEVER
 * SPOKEN. Not delayed. Gone, with no error and nothing on screen to show it
 * happened — which for a player who cannot see the screen is the whole game
 * quietly skipping a beat.
 *
 * This file drives the speech functions directly rather than playing hands and
 * hoping two announcements land close together. Timing rules need timing tests;
 * a play-through can only tell you it did not happen to break this time.
 *
 * Requires jsdom:  npm install --no-save jsdom
 *   node tests/announcements.js
 */
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('SKIP: jsdom is not installed. Run: npm install --no-save jsdom');
  process.exit(0);
}
const root = path.join(__dirname, '..');

let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  return window;
}

/* Watch a live region and record every distinct non-empty text it holds. That is
 * as close as a test can get to "what did the screen reader actually say":
 * anything the region never holds was never announced. */
function watch(window, id) {
  const node = window.document.getElementById(id);
  const said = [];
  const obs = new window.MutationObserver(() => {
    const t = node.textContent;
    if (t && said[said.length - 1] !== t) said.push(t);
  });
  obs.observe(node, { childList: true, characterData: true, subtree: true });
  return said;
}

(async () => {
  const window = await boot();
  const UI = window.SH.UI;
  check(UI && typeof UI.announce === 'function', 'the speech API is not exposed');

  /* --- 1. Two automatic messages in a rush: BOTH are spoken --- */
  {
    UI.resetSpeech();
    const said = watch(window, 'announcer');
    UI.announce('first message');
    await sleep(10);
    UI.announce('second message');
    await sleep(900);

    check(said.indexOf('first message') >= 0,
      'the first of two rapid messages was never announced — this is the race the queue exists to fix');
    check(said.indexOf('second message') >= 0, 'the second of two rapid messages was never announced');
    check(said.indexOf('first message') < said.indexOf('second message'),
      'the two messages were announced out of order');
  }

  /* --- 2. Five in a burst: all five, in order --- */
  {
    UI.resetSpeech();
    const said = watch(window, 'announcer');
    const msgs = ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five'];
    for (const m of msgs) { UI.announce(m); await sleep(5); }
    await sleep(2200);

    const heard = msgs.filter(m => said.indexOf(m) >= 0);
    check(heard.length === msgs.length,
      'a burst of five lost ' + (msgs.length - heard.length) + ': only heard ' + JSON.stringify(heard));
    const positions = msgs.map(m => said.indexOf(m));
    const ordered = positions.every((v, i) => i === 0 || v > positions[i - 1]);
    check(ordered, 'a burst of five was announced out of order: ' + JSON.stringify(said));
  }

  /* --- 3. Idle is pass-through: no added delay ---
   *
   * The queue must not make single-player slower to fix a problem single-player
   * does not have. With nothing in flight a message takes the same path it always
   * did, so it lands in about the settle time and nowhere near the hold window
   * that separates messages arriving in a rush. */
  {
    UI.resetSpeech();
    await sleep(400);                     // let any hold window lapse
    const node = window.document.getElementById('announcer');
    const t0 = Date.now();
    UI.announce('a lonely message');
    let landed = -1;
    for (let i = 0; i < 60; i++) {
      await sleep(10);
      if (node.textContent === 'a lonely message') { landed = Date.now() - t0; break; }
    }
    check(landed >= 0, 'an idle message was never announced');
    check(landed >= 0 && landed < 150,
      'an idle message took ' + landed + 'ms — the queue added delay to the case it was supposed to leave alone');
  }

  /* --- 4. A review preempts a game event, and the event is not lost ---
   *
   * Press H while the table is talking and the hand read is what you want first.
   * But the event still has to be said afterwards: dropping it on purpose is no
   * better than dropping it by accident. */
  {
    UI.resetSpeech();
    const said = watch(window, 'announcer');
    UI.announce('a game event nobody asked for');
    await sleep(5);
    UI.announceRequested('the hand you asked to hear');
    await sleep(1200);

    const iAsked = said.indexOf('the hand you asked to hear');
    const iEvent = said.indexOf('a game event nobody asked for');
    check(iAsked >= 0, 'a requested message was never announced');
    check(iEvent >= 0, 'the preempted game event was dropped instead of deferred');
    check(iAsked < iEvent, 'the game event was spoken before the message the player asked for');
  }

  /* --- 5. A requested message pushes past a merely SCHEDULED one ---
   *
   * The first version of the queue returned early whenever a delivery was already
   * scheduled, so pressing a review key while an event was waiting out its hold
   * window put the answer behind it. To the player that is indistinguishable from
   * a dropped keypress, which is the thing this milestone is about not doing. */
  {
    UI.resetSpeech();
    UI.announce('event one');
    UI.announce('event two');            // this one is scheduled, not in flight
    await sleep(80);
    const node = window.document.getElementById('announcer');
    const t0 = Date.now();
    UI.announceRequested('answer me now');
    let landed = -1;
    for (let i = 0; i < 60; i++) {
      await sleep(10);
      if (node.textContent === 'answer me now') { landed = Date.now() - t0; break; }
    }
    check(landed >= 0, 'a requested message was never announced while events were queued');
    check(landed >= 0 && landed < 150,
      'a requested message waited ' + landed + 'ms behind a scheduled event — that reads as a dropped keypress');
  }

  /* --- 6. The assertive region is serialized too ---
   *
   * The original code had this race in BOTH regions and the plan named only one
   * of them. Errors and turn alerts land here, and two arriving together is
   * routine online. */
  {
    UI.resetSpeech();
    const said = watch(window, 'alerts');
    UI.alert('first error');
    await sleep(10);
    UI.alert('second error');
    await sleep(900);
    check(said.indexOf('first error') >= 0, 'the first of two rapid alerts was never announced');
    check(said.indexOf('second error') >= 0, 'the second of two rapid alerts was never announced');
  }

  /* --- 7. Repeat works on whatever you last heard, from either region ---
   *
   * announce() recorded it and alert_() did not, so routing anything important to
   * the assertive region would have made it the one message R could not bring
   * back — while every review key could. */
  {
    UI.resetSpeech();
    UI.announce('a polite thing');
    await sleep(200);
    check(UI.lastSpoken() === 'a polite thing', 'a polite message was not recorded for Repeat');

    UI.alert('an assertive thing');
    await sleep(200);
    check(UI.lastSpoken() === 'an assertive thing',
      'an assertive message was not recorded for Repeat — R would replay the wrong message');
  }

  /* --- 8. Empty means clear, not "leave the last one up" ---
   *
   * A review key with nothing to say must not leave the previous announcement
   * sitting in the region, or the player hears the answer to a question they
   * asked several keystrokes ago as though it were the answer to this one. */
  {
    UI.resetSpeech();
    const node = window.document.getElementById('announcer');
    UI.announceRequested('something to say');
    await sleep(200);
    check(node.textContent === 'something to say', 'the setup message did not land');
    UI.announceRequested('');
    await sleep(120);
    check(node.textContent === '', 'an empty review left the previous announcement in place');
  }

  if (fails.length) {
    console.error('\nFAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('bursts of two and five, both live regions, all delivered and in order');
  console.log('idle messages pass straight through; requested ones preempt without dropping');
  console.log('Nothing announced was silently lost.');
  process.exit(0);
})();

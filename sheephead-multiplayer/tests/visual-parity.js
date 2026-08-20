/* What the game tells you, told both ways.
 *
 * This game was built announcement-first, and for a long time that was the right
 * emphasis — it exists so somebody who cannot see the screen can play a real game
 * of Sheephead. The cost only showed up when a sighted player sat down at it:
 *
 *   "I get indication when I can't play a certain card. Visually if you click
 *    on a card that can't be played nothing happens."
 *
 * Which is exactly right. alert_() is the channel for "that did not work and
 * here is why" — the card you cannot play, the selection that is already full,
 * the move the table refused — and it went to the speech queue and nowhere else.
 * The most ordinary thing a new player does is press the card they want and find
 * out why they cannot have it, and watching rather than listening, that produced
 * nothing whatsoever: no movement, no message, no reason.
 *
 * The RESTING state of an unplayable card was already handled, and handled
 * thoughtfully: flat and cooler and sitting low while the playable cards stand
 * up, with the contrast worked out so a red suit still clears AA. Nothing here
 * changes that. This is about the reply to an action, which had no visual form at
 * all.
 *
 * The rule these assert: anything alert_() says is also written down, and the
 * written copy is aria-hidden so it is not then said twice.
 *
 * Requires jsdom:  npm install --no-save jsdom
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
          removeItem: k => { delete store[k]; }, clear: () => {},
          key: i => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; }
        }
      });
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
  d.getElementById('opt-players').value = '5';
  d.getElementById('opt-pace').value = '0';
  d.getElementById('setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { window, d };
}

(async () => {
  const { window, d } = await boot();
  const flash = d.getElementById('flash');

  check(!!flash, 'there is no visible channel for the messages alert_() speaks');
  check(flash.getAttribute('aria-hidden') === 'true',
    'the written copy of a spoken message is exposed to assistive technology, so ' +
    'every refusal will now be announced twice — once by the announcer and once ' +
    'by this. The visual half of a message must stay visual.');
  check(flash.hidden, 'a message was showing before anything had happened');

  /* ---------------- pressing a card you cannot play ---------------- */

  const bs = () => [...d.querySelectorAll('#actions button')];
  const cards = () => [...d.querySelectorAll('#hand .card')];
  const blocked = () => cards().filter(c => c.getAttribute('aria-disabled') === 'true');

  // Play on until this seat is on turn with at least one card it may not play.
  let guard = 0, found = null;
  while (guard++ < 400) {
    await sleep(5);
    const pick = bs().find(b => /Pick up the blind/.test(b.textContent));
    if (pick) { pick.click(); continue; }
    const bury = bs().find(b => /^Bury /.test(b.textContent));
    if (bury) {
      const n = +bury.textContent.match(/of (\d+)/)[1];
      cards().slice(-n).forEach(c => c.click());
      const go = bs().find(b => /^Bury /.test(b.textContent));
      if (go && !go.disabled) go.click();
      continue;
    }
    const next = bs().find(b => /^Deal next hand/.test(b.textContent));
    if (next) { next.click(); continue; }

    if (/your turn to play/i.test(d.getElementById('status').textContent)) {
      if (blocked().length) { found = blocked()[0]; break; }
      const legal = cards().find(c => c.getAttribute('aria-disabled') !== 'true');
      if (legal) legal.click();
    }
  }

  check(!!found,
    'never reached a turn with an unplayable card in hand, so the thing this file ' +
    'exists to check was never exercised');

  if (found) {
    /* The resting state, which already worked and must keep working. */
    check(found.getAttribute('aria-disabled') === 'true',
      'an unplayable card is not marked unplayable');
    check(found.tabIndex !== undefined && !found.disabled,
      'an unplayable card was made unreachable. It has to stay focusable so it can ' +
      'be read, and clickable so pressing it can explain itself');

    const spokenBefore = window.SH.UI.lastSpoken();
    found.click();

    check(!flash.hidden,
      'pressing a card that cannot be played put nothing on screen. This is the ' +
      'report verbatim: a screen reader user is told which rule stops them and ' +
      'somebody watching the screen gets nothing at all');
    check(/cannot play/i.test(flash.textContent),
      'the visible message does not say the card cannot be played: ' + flash.textContent);
    check(flash.textContent.length > 'You cannot play the Ace of Hearts.'.length - 1,
      'the visible message gives no reason, only a refusal: ' + flash.textContent);

    /* It must carry the SAME reason that is spoken, not a vaguer one. */
    await sleep(120);
    const spoken = window.SH.UI.lastSpoken() || '';
    check(spoken !== spokenBefore, 'nothing was announced for a refused card either');
    check(spoken.indexOf(flash.textContent) >= 0 || flash.textContent.indexOf(spoken) >= 0,
      'the seen and heard versions of the same refusal disagree.\n      seen:  ' +
      flash.textContent + '\n      heard: ' + spoken);

    /* And the card that was pressed says so, so the eye is not left hunting
     * through six cards for the one the message is about. */
    check(found.classList.contains('refused'),
      'the card that was pressed was not marked, so the message on screen belongs ' +
      'to no particular card and the player has to work out which one it means');
  }

  /* ---------------- it does not become wallpaper ---------------- */

  /* A refusal is a reply to something the player just did. Left standing beside a
   * board that has moved on it stops being a reply and starts being furniture. */
  if (found) {
    const seen = flash.textContent;
    await sleep(6500);
    check(flash.hidden || flash.textContent !== seen,
      'the refusal stayed on screen indefinitely: "' + seen + '". It answers a ' +
      'keypress from several plays ago and now describes nothing that is true');
  }

  window.close();

  if (fails.length) {
    console.error('FAILED:');
    [...new Set(fails)].forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('a refused card explains itself on screen as well as out loud, and says which card');
})().catch(e => { console.error('the run itself failed: ' + e.stack); process.exit(1); });

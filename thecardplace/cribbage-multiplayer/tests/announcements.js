/* The announcement queue.
 *
 * This is the most accessibility-critical machinery in the game and the least
 * visible: everything it protects against looks, on screen, like nothing
 * happening at all.
 *
 * Both live regions are written by blanking the node and setting the text a
 * moment later. The blank is not decoration — setting the same string twice is
 * not a DOM change, and a screen reader says nothing, so "Your turn" following
 * "Your turn" would be silence. That pattern has a race in it: two messages
 * twenty milliseconds apart means the second blank runs before the first write
 * fires, and THE FIRST MESSAGE IS NEVER SPOKEN. Not delayed — gone, with no
 * error and nothing on screen to show it happened.
 *
 * Offline nothing ever triggers it, because messages only arrive on a keystroke
 * or a pace timer. Over a socket they will.
 *
 * The four rules under test:
 *
 *   1. One queue per region, so a card confirmation cannot delay the hand read
 *      the player then asks for.
 *   2. Pass-through when idle, so single-player at instant pace does not get
 *      slower to fix a problem it does not have.
 *   3. A game event never preempts a request — and is REQUEUED, not dropped,
 *      because dropping it on purpose is no better than the accident.
 *   4. A newer request supersedes an older pending one, per region.
 *
 *   npm install --no-save jsdom
 *   node tests/announcements.js
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP announcements: jsdom is not installed (npm install --no-save jsdom)');
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
    url: 'https://example.org/cribbage-multiplayer/', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const win = dom.window;
  const D = win.HTMLDialogElement;
  if (D) {
    D.prototype.showModal = function () { this.open = true; };
    D.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
  }
  for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js', 'js/view.js',
    'js/config.js', '../shared/js/table.js', '../shared/js/net.js', '../shared/js/localserver.js', 'js/ui.js']) {
    win.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  }
  win.SH.UI.init();
  return win;
}

/* Everything a region actually SAID, in order.
 *
 * Polling rather than reading the node once: a live region is a stream, not a
 * value. A message that is written and replaced before the next sample would be
 * missed by a slower poll — which is the same thing a screen reader would do —
 * so the sample interval is well under the queue's own hold window. */
function watch(win, node) {
  const seen = [];
  let last = null;
  const timer = win.setInterval(() => {
    const t = node.textContent;
    if (t !== last) { seen.push(t); last = t; }
  }, 5);
  return {
    /* Every change, blanks included. The blank matters: it is what makes the
     * same message spoken twice in a row actually be spoken twice, so a watcher
     * that filters empties cannot tell a repeat from a silent no-op. */
    seen,
    get said() { return seen.filter(Boolean); },
    stop: () => win.clearInterval(timer)
  };
}

async function main() {
  const win = boot();
  const T = win.SH.UI._test;
  const announcer = win.document.getElementById('announcer');
  const alerts = win.document.getElementById('alerts');

  check(announcer.getAttribute('aria-live') === 'polite',
    'the announcer is not a polite live region');
  check(announcer.getAttribute('aria-atomic') === 'true',
    'the announcer is not atomic, so a screen reader may read only the changed part');
  check(alerts.getAttribute('role') === 'alert', 'the alert region is not role=alert');
  check(announcer.classList.contains('sr-only') && alerts.classList.contains('sr-only'),
    'the live regions are visible on screen as well as to a screen reader');

  /* ============ 1. TWO MESSAGES IN A RUSH: NEITHER IS LOST ============
   *
   * The exact race the queue exists for. Without it the first message is blanked
   * by the second before its own write ever fires, and is never spoken. */
  {
    T.resetSpeech();
    const w = watch(win, announcer);
    T.announce('First message about the deal.');
    await sleep(20);
    T.announce('Second message about the play.');
    await sleep(1200);
    w.stop();
    check(w.said.indexOf('First message about the deal.') >= 0,
      'the first of two messages twenty milliseconds apart was never spoken — ' +
      'said: ' + JSON.stringify(w.said));
    check(w.said.indexOf('Second message about the play.') >= 0,
      'the second message was never spoken — said: ' + JSON.stringify(w.said));
    check(w.said.indexOf('First message about the deal.') <
      w.said.indexOf('Second message about the play.'),
      'two game messages were spoken out of order');
  }

  /* ============ 2. FIVE IN A BURST ============ */
  {
    T.resetSpeech();
    const w = watch(win, announcer);
    for (let i = 1; i <= 5; i++) { T.announce('Burst message ' + i + '.'); await sleep(8); }
    await sleep(2600);
    w.stop();
    for (let i = 1; i <= 5; i++) {
      check(w.said.indexOf('Burst message ' + i + '.') >= 0,
        'burst message ' + i + ' was swallowed — said: ' + JSON.stringify(w.said));
    }
  }

  /* ============ 3. A REQUEST JUMPS THE QUEUE, AND THE EVENT SURVIVES ============
   *
   * Press H while a remote play is landing and the hand read is the message you
   * lose — the one you explicitly asked for. Requests go first. The event is put
   * back rather than dropped: deliberately discarding it is no better than the
   * accident this exists to prevent. */
  {
    T.resetSpeech();
    const w = watch(win, announcer);
    T.announce('Somebody else played a card.');
    T.announce('And another one.');
    await sleep(10);
    T.announceRequested('Your hand, five cards.');
    await sleep(1800);
    w.stop();
    const req = w.said.indexOf('Your hand, five cards.');
    const ev2 = w.said.indexOf('And another one.');
    check(req >= 0, 'the message the player asked for was never spoken');
    check(ev2 >= 0, 'a game event was DROPPED to make room for a request, not requeued — ' +
      'said: ' + JSON.stringify(w.said));
    check(req < ev2, 'the request did not jump ahead of the queued game event');
  }

  /* ============ 4. A NEWER REQUEST SUPERSEDES AN OLDER ONE ============
   *
   * Press H and then S: you want the score, not the hand read followed by the
   * score. The alternative is that every burst of feedback pushes your next
   * answer further away. */
  {
    T.resetSpeech();
    const w = watch(win, announcer);
    T.announceRequested('The first answer.');
    T.announceRequested('The second answer.');
    T.announceRequested('The third answer.');
    await sleep(1200);
    w.stop();
    check(w.said.indexOf('The third answer.') >= 0, 'the newest request was never spoken');
    check(w.said.indexOf('The second answer.') < 0,
      'a superseded request was spoken anyway — said: ' + JSON.stringify(w.said));
  }

  /* ============ 5. THE TWO REGIONS ARE INDEPENDENT ============
   *
   * One global queue would make a card-selection confirmation delay the hand
   * read the player then asks for, which is a delay invented entirely by the
   * fix. */
  {
    T.resetSpeech();
    const wp = watch(win, announcer);
    const wa = watch(win, alerts);
    T.announce('A long run of plays that takes a while to say.');
    T.alert_('Ace of Spades selected.');
    await sleep(900);
    wp.stop(); wa.stop();
    check(wa.said.indexOf('Ace of Spades selected.') >= 0,
      'the assertive reply never reached the alert region');
    check(wp.said.indexOf('Ace of Spades selected.') < 0,
      'an assertive message was also put in the polite region and would be said twice');
    check(wa.said.every(s => s.indexOf('long run of plays') < 0),
      'a polite game message leaked into the assertive region');
  }

  /* ============ 6. REPEAT WORKS FOR BOTH REGIONS ============
   *
   * Route the most important message to the assertive region and it becomes the
   * one message a player cannot ask to hear again — while every review key can.
   * So both regions record what was said. */
  {
    T.resetSpeech();
    T.announce('A polite thing.');
    await sleep(400);
    check(T.lastSpoken() === 'A polite thing.', 'Repeat did not record a polite message');
    T.alert_('An urgent thing.');
    await sleep(400);
    check(T.lastSpoken() === 'An urgent thing.',
      'Repeat did not record an assertive message, so it is the one message that ' +
      'cannot be repeated');
  }

  /* ============ 7. AN EMPTY REVIEW CLEARS ITS REGION ============
   *
   * Otherwise the player hears the answer to a question they asked several
   * keystrokes ago as though it were the answer to this one. */
  {
    T.resetSpeech();
    T.announceRequested('Something.');
    await sleep(400);
    check(announcer.textContent === 'Something.', 'the region does not hold the last message');
    T.announceRequested('');
    await sleep(200);
    check(announcer.textContent === '',
      'asking for something with no answer left the previous answer standing');
  }

  /* ============ 8. THE SAME MESSAGE TWICE IS STILL SPOKEN TWICE ============
   *
   * "Your turn" following "Your turn" is a real thing to say, and setting the
   * same string is not a DOM change — which is the whole reason the region is
   * blanked first. If that ever stops happening the second one is silent. */
  {
    T.resetSpeech();
    const w = watch(win, announcer);
    T.announce('Your turn.');
    await sleep(500);
    T.announce('Your turn.');
    await sleep(700);
    w.stop();
    const spoken = w.said.filter(s => s === 'Your turn.').length;
    const blanks = w.seen.filter(s => s === '').length;
    check(blanks >= 1, 'the region was never blanked between the two writes');
    check(spoken >= 2,
      'the same message sent twice was only spoken once: the region is not being ' +
      'blanked between writes, so a repeat is silent');
  }

  console.log('announcements: ' + checks + ' assertions');
  if (fails.length) {
    console.error('\nFAIL (' + fails.length + '):');
    for (const f of [...new Set(fails)].slice(0, 20)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('announcements: OK');
  process.exit(0);
}

main().catch(e => { console.error('announcements: threw — ' + e.stack); process.exit(1); });

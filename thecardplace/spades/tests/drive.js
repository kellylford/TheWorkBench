/* How to get this game onto a screen, for the shared browser audits.
 *
 * See shared/tests/browser/harness.js. The audits measure a rendered page and
 * know nothing about the game on it; this file is the whole of the per-game
 * difference.
 *
 * These drive the game through its INTERFACE, which draws from a per-seat
 * projection rather than the engine state. In spades that projection carries
 * everything these need — bids and trick counts are public — so the trap the
 * hearts version documents (reading a field the projection deliberately
 * withholds) does not exist here. What does exist is the bidding phase: nothing
 * can be played until all four seats have bid, and an audit that only knows how
 * to click cards sits on a bidding screen for ever and reports "never finished a
 * hand".
 *
 * No backslashes in these blocks. They are template literals, and a backslash in
 * one is consumed when the literal is evaluated rather than when it is read, so
 * a character class arrives in the browser with its escape missing — it
 * compiles, runs, and silently matches nothing.
 */
module.exports = {
  name: 'Spades',

  /* Nothing extra: submitting the form deals. Spades has a fixed table of four,
   * so there is no player count to set. */

  /* Stop MID-hand, with cards still in hand and something in the trick.
   *
   * The appearance audit measures card faces, so it needs faces to measure —
   * playing a hand out leaves an empty hand and nothing to look at. Returns true
   * when there is nothing more to do; the audit calls it again after a pause,
   * because the computer plays on a timer and a loop inside the page cannot wait
   * for it. */
  playMid: `(() => {
    const T = SH.UI._test;
    const v = T.view();
    if (!v) return true;
    const me = T.seat();
    const cards = () => [...document.querySelectorAll('#hand .card')];
    const btns = () => [...document.querySelectorAll('#actions button')];
    const bid = () => {
      const sel = document.getElementById('bid-select');
      if (!sel) return false;
      sel.value = '3';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const go = btns().find(b => b.hasAttribute('data-advance'));
      if (!go || go.getAttribute('aria-disabled') === 'true') return false;
      go.click();
      return true;
    };

    if (v.phase === 'bidding') {
      if (v.turn !== me) return false;
      bid();
      return false;
    }
    if (v.phase === 'play') {
      const played = document.querySelectorAll('#trick .mini').length;
      if (played >= 2 && cards().length >= 2) return true;
      if (cards().length <= 2) return true;
      if (v.turn !== me) return false;
      const live = cards().find(c => c.getAttribute('aria-disabled') !== 'true');
      if (live) { live.click(); return false; }
    }
    return true;
  })()`,

  /* Play a hand out to the end, so the audits see a finished hand: the score
   * table, the history row and the result prose, none of which exist on a fresh
   * deal. Legal moves only, whichever comes first — this is not playing well, it
   * is getting the pixels on screen. */
  playIn: `(() => {
    const T = SH.UI._test;
    const cards = () => [...document.querySelectorAll('#hand .card')];
    const btns = () => [...document.querySelectorAll('#actions button')];
    const bid = () => {
      const sel = document.getElementById('bid-select');
      if (!sel) return false;
      sel.value = '3';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const go = btns().find(b => b.hasAttribute('data-advance'));
      if (!go || go.getAttribute('aria-disabled') === 'true') return false;
      go.click();
      return true;
    };
    for (let i = 0; i < 300; i++) {
      const v = T.view();
      if (!v) return true;
      if (v.phase === 'handOver' || v.phase === 'gameOver') return true;
      const me = T.seat();
      if (v.phase === 'bidding') {
        if (v.turn !== me) break;
        if (bid()) continue;
        break;
      }
      if (v.phase === 'play') {
        if (v.turn !== me) break;
        const live = cards().find(c => c.getAttribute('aria-disabled') !== 'true');
        if (live) { live.click(); continue; }
        break;
      }
      break;
    }
    const end = T.view();
    return !end || end.phase === 'handOver' || end.phase === 'gameOver';
  })()`
};

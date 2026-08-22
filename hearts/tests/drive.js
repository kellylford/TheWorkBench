/* How to get this game onto a screen, for the shared browser audits.
 *
 * See shared/tests/browser/harness.js. The audits measure a rendered page and
 * know nothing about the game on it; this file is the whole of the per-game
 * difference. Hearts was the first game written after the harness existed, and
 * it needed four fields and no changes to any shared code.
 *
 * These drive the game through its INTERFACE, which draws from a per-seat
 * projection rather than the engine state. The projection says passedIn — who
 * has finished choosing — and never says passing, because the cards a seat has
 * chosen are the one thing in hearts that must not cross a socket. Reading
 * v.passing here threw inside the page, the pump swallowed it, and the audits
 * reported "never finished a hand" rather than anything about a typo.
 *
 * No backslashes in these blocks. They are template literals, and a backslash in
 * one is consumed when the literal is evaluated rather than when it is read, so
 * a character class arrives in the browser with its escape missing — it
 * compiles, runs, and silently matches nothing.
 */
module.exports = {
  name: 'Hearts',

  /* Nothing extra: submitting the form deals. Hearts has a fixed table of four,
   * so there is no player count to set. */

  /* Stop MID-hand, with cards still in hand and something in the trick.
   *
   * The appearance audit measures card faces, so it needs faces to measure —
   * playing a hand out leaves an empty hand and nothing to look at. Returns true
   * when there is nothing more to do; the audit calls it again after a pause,
   * because the computer plays on a timer and a loop inside the page cannot wait
   * for it. */
  playMid: `(() => {
    const T = SH.UI._test, G = SH.Game;
    const v = T.view();
    if (!v) return true;
    const me = T.seat();
    const cards = () => [...document.querySelectorAll('#hand .card')];
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));

    if (v.phase === 'passing') {
      if (v.passedIn[me]) return false;
      const pick = cards().filter(c => c.getAttribute('aria-pressed') === 'false').slice(0, 3);
      pick.forEach(c => c.click());
      const go = find(/Pass these three/);
      if (go && go.getAttribute('aria-disabled') !== 'true') go.click();
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
    const T = SH.UI._test, G = SH.Game;
    const cards = () => [...document.querySelectorAll('#hand .card')];
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));
    for (let i = 0; i < 200; i++) {
      const v = T.view();
      if (!v) return true;
      if (v.phase === 'handOver' || v.phase === 'gameOver') return true;
      const me = T.seat();
      if (v.phase === 'passing') {
        if (v.passedIn[me]) break;
        const pick = cards().filter(c => c.getAttribute('aria-pressed') === 'false').slice(0, 3);
        pick.forEach(c => c.click());
        const go = find(/Pass these three/);
        if (go && go.getAttribute('aria-disabled') !== 'true') { go.click(); continue; }
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

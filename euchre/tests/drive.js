/* How to get this game onto a screen, for the shared browser audits.
 *
 * See shared/tests/browser/. The audits measure a rendered page and know
 * nothing about the game on it; this file is the whole of the per-game
 * difference. A new game supplies one of these and inherits every audit.
 *
 * Strings, not functions: they run inside the page via page.evaluate.
 *
 * No backslashes in these blocks. They are template literals, and a backslash
 * in one is consumed when the literal is evaluated rather than when it is read,
 * so a character class written here arrives in the browser with the escape
 * missing — it compiles, runs, and silently matches nothing.
 */
module.exports = {
  name: 'Euchre',

  /* Nothing extra: submitting the form deals. */


  /* Stop MID-hand, with cards still in hand and a card or two in the trick.
   *
   * The appearance audit measures card faces and needs faces to measure —
   * playing a hand dry leaves an empty hand and nothing to look at. Returns true
   * when there is nothing more to do; the audit calls it again after a pause,
   * because the computer plays on a timer and a synchronous loop inside the page
   * cannot wait for it. */
  playMid: `(() => {
    const T = SH.UI._test, G = SH.Game;
    const v = T.view();
    if (!v) return true;
    const me = T.seat();
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));
    const cards = () => [...document.querySelectorAll('#hand .card')];
    if (v.phase === 'play') {
      const played = document.querySelectorAll('#trick .mini, #trick li').length;
      if (played >= 2 && cards().length >= 2) return true;
      if (cards().length <= 2) return true;
    }
    if (v.phase === 'bid1' && v.turn === me) {
      (find(/Order it up|Take it up/) || find(/Pass/)).click(); return false;
    }
    if (v.phase === 'bid2' && v.turn === me) {
      (find(/^Name /) || find(/Pass/)).click(); return false;
    }
    if (v.phase === 'discard' && v.dealer === me) {
      cards()[0].click();
      const put = find(/Put back/); if (put) put.click();
      return false;
    }
    if (v.phase === 'play' && v.turn === me && v.sittingOut !== me) {
      const legal = G.legalPlays(v, me).map(c => c.id);
      const el = cards().find(c => legal.includes(c.dataset.id));
      if (el) { el.click(); return false; }
    }
    const cont = find(/Continue/); if (cont) { cont.click(); return false; }
    return false;
  })()`,
  /* Bid, discard if it lands on us, and play until the hand is over, so the
   * audits see a finished hand — the score table and the result prose do not
   * exist on a fresh deal. Legal moves only, first one that fits: this is not
   * playing well, it is getting the pixels on screen. */
  playIn: `(() => {
    const T = SH.UI._test, G = SH.Game;
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));
    const cards = () => [...document.querySelectorAll('#hand .card')];
    for (let i = 0; i < 400; i++) {
      const v = T.view();
      if (!v || v.phase === 'handOver') break;
      const me = T.seat();
      if (v.phase === 'bid1' && v.turn === me) {
        (find(/Order it up|Take it up/) || find(/Pass/)).click(); continue;
      }
      if (v.phase === 'bid2' && v.turn === me) {
        (find(/^Name /) || find(/Pass/)).click(); continue;
      }
      if (v.phase === 'discard' && v.dealer === me) {
        cards()[0].click();
        const put = find(/Put back/); if (put) put.click();
        continue;
      }
      if (v.phase === 'play' && v.turn === me && v.sittingOut !== me) {
        const legal = G.legalPlays(v, me).map(c => c.id);
        const el = cards().find(c => legal.includes(c.dataset.id));
        if (el) { el.click(); continue; }
      }
      const cont = find(/Continue/); if (cont) { cont.click(); continue; }
      break;
    }
    /* Done when the hand is over. Returned rather than just falling out of
     * the loop, because the audit pumps this: a loop inside the page cannot
     * wait for a computer that plays on a timer, so it does what it can
     * synchronously and is called again after a pause. Without a done signal
     * the audit could not tell "the hand is over" from "it is not my turn
     * yet" — and it could not, which is how the hand-over scene spent a
     * while measuring a hand that was still being played. */
    const end = T.view();
    return !end || end.phase === 'handOver';
  })()`
};

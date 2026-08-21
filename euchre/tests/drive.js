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

  setup: `(() => {
    document.getElementById('opt-pace').value = '0';
    document.getElementById('setup-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
  })()`
};

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
  name: 'Cribbage',

  /* Start a table AND cut for the deal. Cribbage deals nothing until the cut is
   * done, so a scene that stopped at the form would have no cards on it at all —
   * and an audit measuring an empty table reports success. The shared audit now
   * refuses to pass a scene that rendered nothing, which is how this was found. */
  setup: `(() => {
    document.getElementById('opt-pace').value = '0';
    document.getElementById('setup-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 20; i++) {
      const cut = [...document.querySelectorAll('#actions button')]
        .find(b => /Cut/.test(b.textContent));
      if (!cut || cut.disabled) break;
      cut.click();
    }
  })()`,

  /* Cut for deal, discard to the crib, peg the hand out, and count it, so the
   * audits see the counting stage — where most of this game's prose and nearly
   * all of its numbers are. Legal moves only, first one that fits. */
  playIn: `(() => {
    const T = SH.UI._test, G = SH.Game;
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));
    const cards = () => [...document.querySelectorAll('#hand .card')];
    for (let i = 0; i < 500; i++) {
      const v = T.view();
      if (!v || v.phase === 'roundOver' || v.phase === 'gameOver') break;
      const me = T.seat();
      if (G.seatToAct(v) !== me) {
        const cont = find(/Continue|Next/); if (cont) { cont.click(); continue; }
        break;
      }
      if (v.phase === 'cutForDeal') { const c = find(/Cut/); if (c) { c.click(); continue; } }
      if (v.phase === 'discard') {
        const need = 2 - document.querySelectorAll('#hand .card.selected').length;
        cards().slice(0, Math.max(need, 0)).forEach(c => c.click());
        const d = find(/crib|Discard/); if (d && !d.disabled) { d.click(); continue; }
      }
      if (v.phase === 'play') {
        const legal = G.legalPlays(v, me).map(c => c.id);
        const el = cards().find(c => legal.includes(c.dataset.id));
        if (el) { el.click(); continue; }
        const go = find(/Go/); if (go) { go.click(); continue; }
      }
      if (v.phase === 'count') { const n = find(/Count|Continue|Next/); if (n) { n.click(); continue; } }
      const cont = find(/Continue|Next/); if (cont) { cont.click(); continue; }
      break;
    }
  })()`
};

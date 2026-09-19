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

  /* Cribbage deals nothing until the cut is done, so a scene that stopped at
   * the form would have no cards on it at all — and an audit measuring an
   * empty table reports success. The shared audit refuses to pass a scene
   * that rendered nothing, which is how this was found. */
  afterStart: `(() => {
    for (let i = 0; i < 20; i++) {
      const cut = [...document.querySelectorAll("#actions button")]
        .find(b => /Cut/.test(b.textContent));
      if (!cut || cut.disabled) break;
      cut.click();
    }
  })()`,


  /* Stop MID-hand, with cards still in hand.
   *
   * Cribbage has no trick at all — cards go to a shared pile — so the audit
   * checks whatever this game does render and says which checks it skipped
   * rather than passing them silently. Returns true when there is nothing more
   * to do; the audit calls it again after a pause, because the computer plays on
   * a timer. */
  playMid: `(() => {
    const T = SH.UI._test, G = SH.Game;
    const v = T.view();
    if (!v) return true;
    const me = T.seat();
    const btns = () => [...document.querySelectorAll('#actions button')];
    const find = re => btns().find(b => re.test(b.textContent));
    const cards = () => [...document.querySelectorAll('#hand .card')];
    /* Peg on until a card in hand has actually been knocked back, or there is
     * almost nothing left.
     *
     * Stopping as soon as two cards had been played left the count low, and at a
     * low count every card is legal — so the appearance audit never once saw an
     * unplayable card and said so, twice, rather than passing. Cribbage marks a
     * card unplayable when it would take the count past thirty-one, which only
     * happens later in the pegging. */
    if (v.phase === 'play') {
      const blocked = cards().some(c => c.getAttribute('aria-disabled') === 'true');
      if (blocked && cards().length >= 2) return true;
      if (cards().length <= 1) return true;
    }
    if (G.seatToAct(v) !== me) {
      const cont = find(/Continue|Next/); if (cont) { cont.click(); }
      return false;
    }
    if (v.phase === 'cutForDeal') { const c = find(/Cut/); if (c) { c.click(); } return false; }
    if (v.phase === 'discard') {
      const chosen = cards().filter(c => c.getAttribute("aria-pressed") === "true");
      const need = 2 - chosen.length;
      cards().slice(0, Math.max(need, 0)).forEach(c => c.click());
      const d = find(/^Throw the/); if (d && !d.disabled) d.click();
      return false;
    }
    if (v.phase === 'play') {
      /* The BIGGEST legal card, not the first.
       *
       * A fixture's job is to reach the interesting state, and the interesting
       * state here is a card knocked back — which cribbage only does when the
       * count would pass thirty-one. Playing whatever came first kept the count
       * low and the audit correctly refused to pass, twice, because nothing had
       * ever checked that an unplayable card keeps its colour. Playing high gets
       * there in a hand or two. */
      const legal = G.legalPlays(v, me).slice()
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      for (const c of legal) {
        const el = cards().find(e => e.dataset.id === c.id);
        if (el) { el.click(); return false; }
      }
      /* The button says "Say go", lower case. A pattern of /Go/ matched nothing,
       * so the drive sat in front of it forever and the audit reported that the
       * hand never ended — which was true, and was the drive script rather than
       * the game. */
      const go = find(/say go/i); if (go) { go.click(); return false; }
    }
    return true;
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
        const chosen = cards().filter(c => c.getAttribute("aria-pressed") === "true");
        const need = 2 - chosen.length;
        cards().slice(0, Math.max(need, 0)).forEach(c => c.click());
        const d = find(/^Throw the/); if (d && !d.disabled) { d.click(); continue; }
      }
      if (v.phase === 'play') {
        const legal = G.legalPlays(v, me).map(c => c.id);
        const el = cards().find(c => legal.includes(c.dataset.id));
        if (el) { el.click(); continue; }
        const go = find(/say go/i); if (go) { go.click(); continue; }
      }
      if (v.phase === 'count') { const n = find(/Count|Continue|Next/); if (n) { n.click(); continue; } }
      const cont = find(/Continue|Next/); if (cont) { cont.click(); continue; }
      break;
    }
    /* Done when the round is over. Returned rather than just falling out of
     * the loop: the audit pumps this, because a loop inside the page cannot
     * wait for a computer that plays on a timer. Without a done signal the
     * audit could not tell a finished hand from a paused one, and cribbage
     * spent a while presenting mid-play as its hand-over scene. */
    const end = T.view();
    return !end || end.phase === 'roundOver' || end.phase === 'gameOver';
  })()`
};

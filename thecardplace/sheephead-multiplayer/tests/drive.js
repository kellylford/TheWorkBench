/* How to get this game onto a screen, for the shared browser audits.
 *
 * The audits in shared/tests/browser/ — contrast, card overlap, and anything
 * added later — measure a rendered page and know nothing about the game on it.
 * This file is the whole of the difference between one game and another: how to
 * start a table, and how to play far enough in that there is something worth
 * measuring.
 *
 * They are strings rather than functions because they run inside the page, via
 * page.evaluate, not in node.
 *
 * A new game supplies one of these and inherits every audit.
 */
module.exports = {
  name: 'Sheephead',

  /* Fill in the setup form and start a table. Pace 0 so the computer plays
   * without waiting — an audit that sits through a human-paced hand takes
   * minutes per scene, times two colour schemes. */
  defaults: { players: 5 },

  /* Nothing extra: submitting the form deals. */


  /* Stop MID-hand, with cards still in hand and something in the trick.
   *
   * The appearance audit measures card faces, so it needs faces to measure:
   * playing on until the hand runs out leaves an empty hand and nothing to look
   * at, which is what made an earlier version report "no cards rendered a
   * visible suit glyph at all" on random runs.
   *
   * Returns true when there is nothing more to do. The audit calls it again
   * after a pause rather than looping in here, because the computer plays on a
   * timer and a synchronous loop inside the page cannot wait for it.
   */
  playMid: `(() => {
    const bs = [...document.querySelectorAll('#actions button')];
    const pick = bs.find(b => /Pick up the blind/.test(b.textContent));
    if (pick) { pick.click(); return false; }
    const bury = bs.find(b => /^Bury /.test(b.textContent));
    if (bury) {
      const need = parseInt(bury.textContent.split('of ')[1], 10);
      [...document.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
      const again = [...document.querySelectorAll('#actions button')]
        .find(b => /^Bury /.test(b.textContent));
      if (again) again.click();
      return false;
    }
    const played = document.querySelectorAll('#trick .mini').length;
    const inHand = document.querySelectorAll('#hand .card').length;
    if (played >= 2 && inHand >= 2) return true;
    if (inHand <= 2) return true;                 // do not play the hand dry
    const next = document.querySelector('#hand .card:not([aria-disabled="true"])');
    if (next) { next.click(); return false; }
    return true;
  })()`,
  /* Play a hand out to the end, so the audits see a finished hand: the score
   * table, the result prose, and the played cards, none of which exist on a
   * fresh deal. Legal moves only, chosen by whatever is first — this is not
   * playing well, it is getting the pixels on screen. */
  playIn: `(() => {
    for (let i = 0; i < 400; i++) {
      const bs = [...document.querySelectorAll('#actions button')];
      if (bs.find(b => /Deal next hand/.test(b.textContent))) break;
      const pick = bs.find(b => /Pick up the blind/.test(b.textContent));
      if (pick) { pick.click(); continue; }
      const bury = bs.find(b => /^Bury /.test(b.textContent));
      if (bury) {
        /* "Bury 2 of 2" — split rather than matched.
         *
         * THIS BLOCK IS A TEMPLATE LITERAL, and a backslash in one is consumed
         * when the literal is evaluated, not when it is read. A character class
         * written here as backslash-d arrives in the browser as a plain d, so
         * the pattern still compiles, still runs, and silently matches nothing
         * — the audit would then bury zero cards and measure a half-played hand
         * while reporting success. Avoided rather than escaped. */
        const need = parseInt(bury.textContent.split('of ')[1], 10);
        [...document.querySelectorAll('#hand .card')].slice(-need).forEach(c => c.click());
        [...document.querySelectorAll('#actions button')]
          .find(b => /^Bury /.test(b.textContent)).click();
        continue;
      }
      if (/your turn to play/i.test(document.getElementById('status').textContent)) {
        const legal = [...document.querySelectorAll('#hand .card')]
          .filter(c => c.getAttribute('aria-disabled') !== 'true');
        if (legal[0]) { legal[0].click(); continue; }
      }
      break;
    }
    /* Done when the hand is over, which this game shows by offering the next
     * deal. Returned rather than just falling out of the loop: the audit
     * pumps this, because a loop inside the page cannot wait for a computer
     * that plays on a timer. */
    return [...document.querySelectorAll('#actions button')]
      .some(b => /Deal next hand|Start a new game/.test(b.textContent));
  })()`
};

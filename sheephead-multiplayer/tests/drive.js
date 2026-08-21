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
  })()`
};

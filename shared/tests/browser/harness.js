/* Getting a card game onto a screen, without knowing which game it is.
 *
 * The audits in this directory measure a rendered page. Each game says how to
 * start itself in its own tests/drive.js. This file is what turns that into
 * something to run, and it exists because the answer was very nearly the same
 * every time: set the pace, maybe set the number of players, maybe set the skin,
 * submit the form.
 *
 * So the shared side owns all of that, and drive.js is left with only what is
 * genuinely particular to the game — a default table size, and any extra step
 * needed before there are cards to look at. Cribbage needs a cut. Nothing else
 * does.
 *
 * ---- the contract ----
 *
 *   name        what to call the game in a report
 *   defaults    optional, e.g. { players: 5 }
 *   afterStart  optional snippet run after the form is submitted
 *   playIn      snippet: play until the hand is over
 *
 * Snippets are strings, because they run inside the page rather than in node.
 *
 * NO BACKSLASHES IN THEM. They are written as template literals, and a backslash
 * in one is consumed when the literal is evaluated rather than when it is read,
 * so a character class arrives in the browser with its escape missing: it
 * compiles, it runs, and it matches nothing. A drive script that quietly matches
 * nothing does not fail, it just stops doing its job.
 */
const path = require('path');
const fs = require('fs');

/* Load a game's drive file, or explain what is missing. A new game that has not
 * written one should be told that, not handed a stack trace. */
function loadDrive(repo, game) {
  const dir = path.join(repo, game);
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error('no such game: ' + dir);
  }
  const p = path.join(dir, 'tests', 'drive.js');
  if (!fs.existsSync(p)) {
    throw new Error(game + ' has no tests/drive.js. The shared browser audits ' +
      'need one to know how to start it — see shared/tests/browser/harness.js ' +
      'for the four fields it holds.');
  }
  const drive = require(p);
  for (const k of ['name', 'playIn']) {
    if (!drive[k]) throw new Error(game + '/tests/drive.js has no ' + k);
  }
  /* A field the harness does not read is worse than a missing one: it sits
   * there looking authoritative, someone edits it to change how the game starts,
   * and nothing happens. `setup` was the old contract — every drive file had one
   * and the harness replaced all of it — and for one release the stable game
   * still carried a `setup` that had stopped being used. */
  const DEAD = { setup: 'the harness builds the setup script now; use defaults ' +
    'and afterStart instead' };
  for (const k of Object.keys(DEAD)) {
    if (drive[k]) {
      throw new Error(game + '/tests/drive.js still has "' + k + '", which nothing ' +
        'reads: ' + DEAD[k]);
    }
  }

  for (const k of ['playIn', 'afterStart']) {
    if (drive[k] && drive[k].indexOf(String.fromCharCode(92)) >= 0) {
      throw new Error(game + '/tests/drive.js: ' + k + ' contains a backslash. ' +
        'These are template literals — the escape is eaten before the browser ' +
        'sees it, and the pattern then matches nothing without failing.');
    }
  }
  return { drive, dir };
}

/* The script that starts a table.
 *
 * Only controls that exist are touched, which is the whole trick: euchre and
 * cribbage have no player-count control at all, and asking for one would throw
 * rather than being ignored.
 */
function setupScript(drive, opts) {
  const o = opts || {};
  const players = o.players != null ? o.players
    : (drive.defaults && drive.defaults.players);
  const skin = o.skin != null ? o.skin : null;
  const pace = o.pace != null ? o.pace : '0';

  return '(() => {\n' +
    '  const set = (id, v) => {\n' +
    '    if (v === null || v === undefined) return false;\n' +
    '    const el = document.getElementById(id);\n' +
    '    if (!el) return false;\n' +
    '    el.value = String(v);\n' +
    '    el.dispatchEvent(new Event("change", { bubbles: true }));\n' +
    '    return true;\n' +
    '  };\n' +
    '  set("opt-pace", ' + JSON.stringify(pace) + ');\n' +
    '  set("opt-players", ' + JSON.stringify(players === undefined ? null : players) + ');\n' +
    '  set("opt-skin", ' + JSON.stringify(skin) + ');\n' +
    '  document.getElementById("setup-form")\n' +
    '    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));\n' +
    (drive.afterStart ? '  ' + drive.afterStart + ';\n' : '') +
    '})()';
}

/* puppeteer is installed per game by that game's CI job, so look there first. */
function puppeteerFor(dir) {
  try { return require(path.join(dir, 'node_modules', 'puppeteer')); }
  catch (e) { /* fall through */ }
  try { return require('puppeteer'); }
  catch (e) { return null; }
}

module.exports = { loadDrive, setupScript, puppeteerFor };

/* The transport is shared. The wiring to it is not, and that is the risk.
 *
 * table.js, net.js and localserver.js were copied into three games and drifted
 * only in a header comment and one Worker hostname. They are one copy now, and
 * the per-game difference is js/config.js: a name and a URL. That is a much
 * smaller thing to get wrong and a much quieter one — two games sharing a
 * workerBase would not throw, would not fail a unit test, and would put two
 * tables of people into each other's rooms. Nobody would find it from the
 * symptom.
 *
 * So the wiring is checked from outside every game, in one place, because the
 * interesting invariant is the one no single game can see: that the URLs are
 * all different.
 *
 *   node shared/tests/wiring.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const GAMES = ['euchre', 'cribbage-multiplayer', 'sheephead-multiplayer', 'hearts', 'spades'];
const SHARED = ['table.js', 'net.js', 'localserver.js'];

/* room.js is shared too, but no browser page loads it — it is the Durable
 * Object, imported by each game's Worker. Checked separately below. */
const SHARED_SERVER = ['room.js'];

const fails = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

/* ---------------- 1. every game is configured, and distinctly -------------- */

const bases = new Map();
const configs = new Map();

for (const g of GAMES) {
  const p = path.join(root, g, 'js', 'config.js');
  if (!fs.existsSync(p)) { fails.push(g + ': js/config.js is missing'); checks++; continue; }
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: g + '/js/config.js' });
  const cfg = sandbox.window.SH && sandbox.window.SH.CONFIG;
  check(!!cfg, g + ': config.js did not set SH.CONFIG');
  if (!cfg) continue;
  configs.set(g, cfg);

  check(typeof cfg.game === 'string' && cfg.game.length > 0,
    g + ': SH.CONFIG.game is empty — it names the game in the log and the page title');
  check(typeof cfg.workerBase === 'string' && /^https:\/\/[^/]+$/.test(cfg.workerBase),
    g + ': SH.CONFIG.workerBase is not a bare https origin (got ' + cfg.workerBase + ')');

  if (bases.has(cfg.workerBase)) {
    fails.push('THE WHOLE POINT OF THIS FILE: ' + g + ' and ' + bases.get(cfg.workerBase) +
      ' both point at ' + cfg.workerBase + '. Two games sharing one room service puts ' +
      'strangers in each other\'s tables and nothing else would have noticed.');
    checks++;
  }
  bases.set(cfg.workerBase, g);
}

/* Each game's Worker should also be recognisably its own, so that a
 * copy-paste that changes the game name and forgets the URL is visible on the
 * page rather than only in a diff. */
for (const [g, cfg] of configs) {
  const stem = g.replace('-multiplayer', '');
  check(cfg.workerBase.includes(stem),
    g + ': workerBase ' + cfg.workerBase + ' does not mention "' + stem +
    '" — copied from another game and not finished?');
}

/* ---------------- 2. the page loads config before it loads the wire -------- */

for (const g of GAMES) {
  const html = fs.readFileSync(path.join(root, g, 'index.html'), 'utf8');

  check(!/src="js\/(table|net|localserver)\.js"/.test(html),
    g + ': index.html still loads its own copy of a shared transport file');

  const iCfg = html.indexOf('js/config.js');
  check(iCfg >= 0, g + ': index.html never loads js/config.js');

  for (const f of SHARED) {
    const tag = '../shared/js/' + f;
    const i = html.indexOf(tag);
    check(i >= 0, g + ': index.html does not load ' + tag);
    if (i >= 0 && iCfg >= 0) {
      check(iCfg < i, g + ': js/config.js is loaded after ' + tag +
        ', so net.js would ask where the Worker is before anybody had said');
    }
  }
}

/* ---------------- 3. the shared files are shared, not copied back ---------- */

for (const g of GAMES) {
  for (const f of SHARED) {
    check(!fs.existsSync(path.join(root, g, 'js', f)),
      g + '/js/' + f + ' is back. It is meant to live in shared/js/ — a copy ' +
      'here loads instead of nothing and drifts silently, which is the state ' +
      'this directory was created to end.');
  }
}

/* ---------------- 4. an unconfigured net.js says so ------------------------ */

{
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'js', 'net.js'), 'utf8'),
    sandbox, { filename: 'shared/js/net.js' });
  const Net = sandbox.window.SH && sandbox.window.SH.Net;
  check(!!Net, 'shared/js/net.js did not export SH.Net when loaded without a config');

  /* Loading must not throw — the game has not asked for anything yet. Using it
   * without a config must, and must say which script tag is missing rather
   * than sending every request to a relative URL on the Pages host, which
   * answers 404 in HTML and reads as "the server is down". */
  let msg = '';
  try {
    Net.defaultBase();
    msg = '(no error)';
  } catch (e) { msg = e.message; }
  check(/config\.js/.test(msg),
    'an unconfigured net.js should name js/config.js in its error, said: ' + msg);
}
/* Is this exact line present in a workflow file? A plain line match rather than
 * a regexp: what is being searched for is itself full of slashes and asterisks,
 * and an escaping mistake here would quietly match nothing and report success —
 * which is precisely the failure this section exists to catch, one level up. */
const listed = (text, line) => text.split(String.fromCharCode(10)).some(l => l.trim() === line);


/* ---------------- 5. the Worker imports the shared room, and CI notices ----

   room.js is the Durable Object. It moved into shared/js/ because euchre's and
   cribbage's copies were identical line for line, and sheephead's differed only
   by MISSING the event-log cap — its log grew without bound in an object that is
   meant to live for days.

   Two things have to hold, and neither is visible from inside a game:

     - every Worker imports the shared one, not a copy of its own;
     - every deploy workflow watches shared/js/, or a fix to the server passes
       its tests, merges, and never reaches the Worker. The deploy simply does
       not run. The live room keeps answering, with the old code, silently.

   The second is the one worth having a test for. Nothing else in this repository
   would ever have said a word about it. */

for (const g of GAMES) {
  for (const f of SHARED_SERVER) {
    check(!fs.existsSync(path.join(root, g, 'js', f)),
      g + '/js/' + f + ' is back — the Durable Object belongs in shared/js/');
  }

  const worker = path.join(root, g, 'worker', 'src', 'index.js');
  if (!fs.existsSync(worker)) { fails.push(g + ': no worker/src/index.js'); checks++; continue; }
  const src = fs.readFileSync(worker, 'utf8');
  check(/from ['"][^'"]*shared\/js\/room\.js['"]|import ['"][^'"]*shared\/js\/room\.js['"]/.test(src),
    g + ': its Worker does not import shared/js/room.js');
  check(!/import ['"]\.\.\/\.\.\/js\/room\.js['"]/.test(src),
    g + ": its Worker still imports the game's own js/room.js");
}

{
  const dir = path.join(root, '.github', 'workflows');
  const deploys = fs.readdirSync(dir).filter(f => /^deploy-.*-room\.yml$/.test(f));

  /* EVERY GAME IN THIS LIST HAS A DEPLOY, not "the counts match".
   *
   * The count equality was a proxy, and it broke the first time a game had a
   * Worker without being a client of the shared transport: hearts ships a room
   * service but its interface still talks to the engine directly, so it is not
   * in GAMES yet and its deploy workflow made four against three. A proxy that
   * fails on a legitimate state is worse than no check — it teaches people to
   * edit the test. The invariant that actually matters is below, and it is
   * applied to every deploy workflow found, hearts included. */
  for (const g of GAMES) {
    const stem = g.replace("-multiplayer", "");
    check(deploys.some(f => f === "deploy" + "-" + stem + "-room.yml"),
      g + " has no deploy-" + stem + "-room.yml");
  }
  check(deploys.length >= GAMES.length,
    "found " + deploys.length + " deploy workflows for " + GAMES.length + " games");
  for (const f of deploys) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8');
    check(/^\s+-\s+'shared\/js\/\*\*'\s*$/m.test(y),
      f + " does not list 'shared/js/**' in its paths. room.js lives there now, " +
      'so a fix to the Durable Object would merge green and never deploy.');
  }

  /* The site publish has the same shape of hole, and had it: euchre/ and
   * cribbage-multiplayer/ were missing, so those two games could be changed,
   * merged and tested green without any of it reaching a single player. It went
   * unnoticed only because they were always merged alongside a directory that
   * was listed. */
  const pub = fs.readFileSync(path.join(dir, 'publish-guide.yml'), 'utf8');
  for (const g of GAMES) {
    check(listed(pub, "- '" + g + "/**'"),
      "publish-guide.yml does not list '" + g + "/**', so changes to that game " +
      'never reach the live site');
  }
  check(/^\s+-\s+'shared\/\*\*'\s*$/m.test(pub),
    "publish-guide.yml does not list 'shared/**', so the transport every game " +
    'loads could change without the site being rebuilt');
}
/* ---------------- report -------------------------------------------------- */

console.log('shared wiring: ' + checks + ' checks across ' + GAMES.length + ' games');
for (const [g, cfg] of configs) {
  console.log('  ' + g.padEnd(24) + cfg.game.padEnd(10) + cfg.workerBase);
}

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('Every game is wired to the shared transport, and to its own room service.');

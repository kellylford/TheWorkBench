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
/* The workflows live at the top of the REPOSITORY, which is no longer the
 * directory the games live in — they are all under thecardplace/ now.
 *
 * Both of these are derived from `root` rather than written down, and that is
 * the point: this file asserts what the path filters say, so a hardcoded
 * 'thecardplace/' here would have to be found and edited by hand the next time
 * the games move. The whole reason they were gathered into one directory is
 * that they are going somewhere else eventually. Derived, the check moves with
 * them and keeps failing for the right reason. */
const repoRoot = path.join(root, '..');
const gamesDir = path.basename(root);
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
  const dir = path.join(repoRoot, '.github', 'workflows');
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
  const sharedJsGlob = "- '" + gamesDir + "/shared/js/**'";
  for (const f of deploys) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8');
    check(listed(y, sharedJsGlob),
      f + ' does not list ' + JSON.stringify(sharedJsGlob.slice(3, -1)) + ' in its ' +
      'paths. room.js lives there now, so a fix to the Durable Object would merge ' +
      'green and never deploy.');
  }

  /* The site publish had the same shape of hole: euchre/ and
   * cribbage-multiplayer/ were both missing from a per-game list, so those two
   * games could be changed, merged and tested green without any of it reaching a
   * single player. It went unnoticed only because they were always merged
   * alongside a directory that was listed.
   *
   * That list is gone. The games are one directory, so the filter is one line,
   * and the hole it could hide in closed with it — a sixth game publishes
   * without anybody remembering to come back here. What is checked now is the
   * one line, which is why this is a single assertion rather than a loop: if it
   * ever goes back to naming games individually, this fails and says so. */
  const pub = fs.readFileSync(path.join(dir, 'publish-guide.yml'), 'utf8');
  const gamesGlob = "- '" + gamesDir + "/**'";
  check(listed(pub, gamesGlob),
    'publish-guide.yml does not list ' + JSON.stringify(gamesDir + '/**') + ', so ' +
    'nothing under it — no game, not the landing page, not the shared transport — ' +
    'reaches the live site when it changes.');
}

/* ---------------- a bug report says where it came from --------------------
 *
 * Every game has a "Report an Issue" button, and what it writes is the only
 * thing a maintainer gets. Two facts decide whether the report can be acted on
 * at all — which build it came from, and which browser — and neither can be
 * recovered afterwards without asking, which costs a round trip and usually the
 * report.
 *
 * Hearts and Spades had neither. They were written after the other three and
 * their reports said "Game: Hearts" and stopped, so a hearts bug arrived naming
 * the game and nothing else. Nothing could see that from inside either game:
 * both were internally consistent, both passed their own suites, and the
 * comparison that matters is with the games next to them.
 *
 * The URL is checked against the directory rather than merely for existing,
 * because the failure that actually happens is a constant copied from the game
 * next door — which produces a report that confidently names the wrong game.
 */
{
  const url = /GAME_URL\s*=\s*'([^']+)'/;

  for (const g of GAMES) {
    const src = fs.readFileSync(path.join(root, g, 'js', 'ui.js'), 'utf8');
    const m = url.exec(src);

    check(!!m, g + ': its bug report carries no GAME_URL, so a report from it ' +
      'does not say which build it came from and nobody can tell without asking.');

    if (m) {
      check(m[1].endsWith('/' + gamesDir + '/' + g + '/'),
        g + ': GAME_URL is ' + m[1] + ', which does not end in ' + gamesDir + '/' +
        g + '/. Copied from another game? A report that names the wrong one is ' +
        'worse than a report that names none.');
      check(m[1].indexOf('https://') === 0,
        g + ': GAME_URL ' + m[1] + ' is not an https URL');
    }

    check(/navigator\.userAgent/.test(src),
      g + ": its bug report does not include the browser. Almost everything " +
      'that goes wrong here goes wrong in one browser and not the others, and ' +
      'the people most likely to file are running a screen reader, where the ' +
      'pairing matters more rather than less.');
  }
}

/* ---------------- the old game addresses still arrive somewhere -----------
 *
 * Every game used to be published at the top of the site, so every game had an
 * address of its own: .../TheWorkBench/euchre/, .../sheephead/ and so on. Those
 * addresses are in the world — each game's "Report an Issue" button pasted its
 * own URL into the report — and after the move all of them answered 404.
 *
 * 404.html rewrites them, and it has two destinations per game rather than one:
 * a bare link goes to the build people play, a deeper link goes to the
 * directory of that exact name. That matters for the two games that have both a
 * single-player original and a multiplayer build. /sheephead/ should open the
 * game; /Cribbage/rules.html should open the file, which exists nowhere else.
 *
 * What the page cannot notice on its own is a directory renamed underneath it:
 * it would go on redirecting to a path that is not there, turning one 404 into
 * two and looking like it worked. So both destinations of every entry have to
 * still be a directory here, every game directory has to be an entry, and the
 * script has to actually produce the right URL — checked by running it.
 */
{
  const p = path.join(repoRoot, '404.html');
  check(fs.existsSync(p),
    'there is no 404.html at the repository root, so every pre-move game URL — ' +
    'the ones already written into filed bug reports — answers with GitHub\'s ' +
    'default 404 and nothing sends the player on to the game.');

  if (fs.existsSync(p)) {
    const html = fs.readFileSync(p, 'utf8');
    const block = /MOVED\s*=\s*\{([\s\S]*?)\}\s*;/.exec(html);
    check(!!block, '404.html no longer has a MOVED map this can check');

    if (block) {
      /* name -> [where a bare link goes, where a deep link goes] */
      const moved = new Map();
      const entry = /'([^']+)'\s*:\s*\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
      for (const m of block[1].matchAll(entry)) moved.set(m[1], [m[2], m[3]]);

      check(moved.size > 0, '404.html has an empty MOVED map — it redirects nothing');

      for (const [from, [live, archive]] of moved) {
        check(fs.existsSync(path.join(root, live)),
          '404.html sends /' + from + '/ to ' + gamesDir + '/' + live +
          '/, which is not there. An old link would land on a second 404, ' +
          'which is worse than the first because it looks handled.');
        check(fs.existsSync(path.join(root, archive)),
          '404.html sends a deep link under /' + from + '/ to ' + gamesDir + '/' +
          archive + '/, which is not there.');
      }

      /* Every directory here is an entry, which is deliberately stronger than
       * "every directory that used to be published". Which ones had an old
       * address is history and is not readable from the tree, so a list of
       * them could quietly lose one — the same shape as the publish filter
       * that was a line short and hid two games for weeks. A game added after
       * the move never had a top-level address, so its entry simply never
       * fires: an unused branch, in exchange for a map that cannot go short. */
      for (const g of fs.readdirSync(root, { withFileTypes: true })) {
        if (!g.isDirectory() || g.name === 'node_modules') continue;
        check(moved.has(g.name),
          gamesDir + '/' + g.name + ' is not in 404.html\'s MOVED map. If it was ' +
          'ever published at the top of the site, that address is a 404 again ' +
          'and nothing else here would mention it.');
      }

      /* A bare link has to reach a game somebody can play, not an archive.
       * This is the whole reason the map has two columns, and it is checked
       * against the landing page rather than against a list written twice:
       * what The Card Place links IS what the game is. */
      const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const played = new Set([...landing.matchAll(/<a class="play" href="([^"/]+)\//g)]
        .map(m => m[1]));
      check(played.size > 0, 'no "Play" links found on the landing page to check against');

      for (const [from, [live]] of moved) {
        if (from === 'shared') continue;
        check(played.has(live),
          '404.html sends /' + from + '/ to ' + live + '/, which is not what The ' +
          'Card Place links. A bare old link should open the build people play, ' +
          'and for Cribbage and Sheephead that is the multiplayer one.');
      }

      /* And it has to actually redirect. That the names line up proves the map
       * is current, not that the script does anything with it — a guard that
       * returns too early passes every assertion above and sends nobody
       * anywhere. So the script is run, against a fake site root: what it does
       * must not depend on where the site is mounted, and using a base that is
       * not this repository's name is what demonstrates that. */
      const script = /<script>([\s\S]*?)<\/script>/.exec(html);
      check(!!script, '404.html has no script, so nothing rewrites the old addresses');

      if (script) {
        const run = (pathname) => {
          let went = null;
          new vm.Script(script[1]).runInNewContext({
            location: { pathname, search: '', hash: '', replace: (u) => { went = u; } }
          });
          return went;
        };
        const want = (pathname, expected, why) =>
          check(run(pathname) === expected,
            '404.html sent ' + pathname + ' to ' + JSON.stringify(run(pathname)) +
            ', expected ' + JSON.stringify(expected) + ' — ' + why);

        for (const [from, [live, archive]] of moved) {
          want('/site/' + from + '/', '/site/' + gamesDir + '/' + live + '/',
            'a bare link opens the game');
          want('/site/' + from + '/index.html',
            '/site/' + gamesDir + '/' + live + '/index.html',
            'index.html is the bare link written out');
          want('/site/' + from + '/deep/file.js',
            '/site/' + gamesDir + '/' + archive + '/deep/file.js',
            'a deep link keeps the rest of the path and goes where the file is');

          /* The loop guard. A missing file INSIDE the games directory is a real
           * 404; rewriting it would send the browser to the same address for
           * ever. */
          want('/site/' + gamesDir + '/' + archive + '/gone.js', null,
            'a genuinely missing file must not be redirected at all');
        }

        want('/site/mlb/nope/', null, 'nothing to do with the games');
        want('/site/', null, 'the site root');

        /* Every object inherits these, so a map read as `MOVED[segment]` says
         * yes to all six. That is exactly what the first draft did: /constructor/
         * matched, the destination came back undefined, and the page sent the
         * visitor to thecardplace/undefined/ — a second 404, with the back entry
         * already spent by location.replace. Nothing above could see it, because
         * every case above is built from the map's own keys. */
        for (const inherited of ['constructor', 'toString', 'valueOf',
          'hasOwnProperty', 'isPrototypeOf', '__proto__']) {
          want('/site/' + inherited + '/', null,
            'a segment that only exists on Object.prototype is not a game');
        }
      }

      /* The rules page is the one deep link a person is likely to be holding,
       * because the old Cribbage page linked it by name. It only survives
       * because deep links go to the archive, so it is worth saying out loud:
       * point them at the live build instead and this file disappears. */
      check(fs.existsSync(path.join(root, 'Cribbage', 'rules.html')),
        'Cribbage/rules.html is gone, and 404.html still sends /Cribbage/rules.html to it');
    }
  }

  const pub404 = fs.readFileSync(path.join(repoRoot, '.github', 'workflows',
    'publish-guide.yml'), 'utf8');
  check(listed(pub404, "- '404.html'"),
    "publish-guide.yml does not list '404.html' in its paths, so a change to " +
    'the page that revives the old game URLs would merge and never publish.');
}

/* ---------------- the landing page counts its own games -------------------
 *
 * "Four card games, free to play in a browser" is the first line anybody reads,
 * and it said four while five were listed below it. Nothing was wrong with the
 * page — every game was there and every link worked — it just opened by
 * miscounting itself, which is the sort of thing a visitor notices and a
 * maintainer never does.
 *
 * It went stale the ordinary way: spades was added, its card was written, and
 * the sentence at the top was not part of adding a game. So the fix is not to
 * write five. It is to make the number something that cannot disagree with the
 * list under it without this failing.
 *
 * Spelled out rather than numeric because that is how the page reads it aloud,
 * and the words are the check — a page that says "5 card games" fails here and
 * should, because it no longer matches the sentence anybody wrote. */
{
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine', 'ten'];
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  /* One per game card. The same marker the stylesheet uses, so a card that
   * renders as a game is a card that counts as one. */
  const cards = (page.match(/<li class="game">/g) || []).length;
  check(cards > 0, 'the landing page has no game cards at all — has the markup changed?');

  const lede = /<p class="lede">\s*([A-Za-z]+) card games/.exec(page);
  check(!!lede,
    'the landing page no longer opens with "<something> card games", so the ' +
    'number it claims cannot be checked against the games it lists');

  if (lede && cards > 0) {
    const claimed = WORDS.indexOf(lede[1].toLowerCase());
    check(claimed === cards,
      'the landing page says "' + lede[1] + ' card games" and lists ' + cards +
      '. Whichever is right, they disagree, and the sentence at the top is the ' +
      'one every visitor reads first. It should say "' +
      (WORDS[cards] || cards) + '".');
  }
}
/* ---------------- every link on every page goes somewhere ------------------
 *
 * The move under thecardplace/ broke the "Back to The Card Place" link on all
 * seven game pages and on Cribbage's rules page, and nothing said so for eight
 * commits. The link read `../thecardplace.html`, which was right when a game
 * sat at the top of the repository and became thecardplace/thecardplace.html
 * the moment it did not. Every other relative path in those pages survived the
 * move because it pointed at something that moved too; this one pointed OUT of
 * the directory, which is exactly the kind of path a directory move breaks and
 * exactly the kind nothing else here was looking at.
 *
 * It is not a subtle failure — it is a 404 on the one link that gets a player
 * back to the other games — and every suite in this repository went green over
 * it. The game tests check the page they are given; the shape audit compares
 * the games with each other; neither one follows a link.
 *
 * So: resolve every relative href and src on every page under this directory,
 * and check that the file is there and that a #fragment names an id that
 * exists. That last part is not padding — the landing page reaches each game's
 * rules with `euchre/#rules-h`, and a renamed heading id would silently land
 * somebody at the top of the game instead of at the rules.
 */
{
  const pages = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      /* Neither is checked in, and both are full of third-party HTML that
       * would drown the real result. */
      if (e.name === 'node_modules' || e.name.indexOf('preview-t') === 0) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.slice(-5) === '.html') pages.push(p);
    }
  })(root);

  check(pages.length > 0, 'no HTML pages found under ' + gamesDir + '/ at all');

  const ids = new Map();
  const idsOf = (file) => {
    if (!ids.has(file)) {
      const html = fs.readFileSync(file, 'utf8');
      ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
    }
    return ids.get(file);
  };

  for (const page of pages) {
    const rel = path.relative(root, page).split(path.sep).join('/');
    const html = fs.readFileSync(page, 'utf8');
    const refs = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]));

    for (const ref of refs) {
      /* Somewhere else entirely, or an anchor on this same page — the first is
       * not ours to check and the second is checked below against itself. */
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;

      const hash = ref.indexOf('#');
      const filePart = hash === -1 ? ref : ref.slice(0, hash);
      const frag = hash === -1 ? '' : ref.slice(hash + 1);

      let target = page;
      if (filePart) {
        target = path.resolve(path.dirname(page), filePart);
        /* A directory URL is served as its index.html, which is how every
         * "Play Euchre" button on the landing page is written. */
        if (filePart.slice(-1) === '/') target = path.join(target, 'index.html');
        if (!fs.existsSync(target)) {
          fails.push(rel + ' links to ' + JSON.stringify(ref) + ', which does not exist. ' +
            'On the live site that is a 404.');
          checks++;
          continue;
        }
        checks++;
      }

      if (frag && target.slice(-5) === '.html') {
        check(idsOf(target).has(frag),
          rel + ' links to ' + JSON.stringify(ref) + ', but nothing in ' +
          path.relative(root, target).split(path.sep).join('/') +
          ' has that id — the link opens the page at the top instead.');
      }
    }
  }
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

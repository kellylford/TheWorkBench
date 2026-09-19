/* Verifies that nothing observable to a non-picker changes based on whether the
 * picker is secretly alone, before the Jack of Diamonds is revealed.
 *
 * Method: run a hand and capture every event message emitted up to the moment of
 * reveal. None of them may contain the words "alone"/"partner is" attributable to
 * a computer picker. Also asserts allyProb for a plain opponent is identical
 * whether state.alone is true or false while hidden. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const sandbox = { console, Math, Date, JSON, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cards.js', 'js/game.js', 'js/ai.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { Game: G, AI, Cards: C } = sandbox.SH;

let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

/* --- 1. allyProb must not depend on the hidden truth --- */
for (const n of [4, 5, 6]) {
  const names = ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n);
  const st = G.createGame({ numPlayers: n, names, allPass: 'leaster', difficulty: 'hard' });
  G.newHand(st);
  st.picker = 1;
  st.partnerRevealed = false;
  // A plain opponent seat (not the picker, not the partner).
  const viewer = 2, q = 3;

  st.alone = false; st.partner = 4 % n === 0 ? 3 : (n > 4 ? 4 : 3);
  if (st.partner === viewer || st.partner === q) st.partner = n - 1;
  const withPartner = G.allyProb(st, viewer, q);

  st.alone = true; st.partner = -1;
  const whenAlone = G.allyProb(st, viewer, q);

  check(withPartner === whenAlone,
    `${n}p: a plain opponent's read of seat ${q} changes with the hidden alone flag ` +
    `(${withPartner} vs ${whenAlone})`);
  check(whenAlone > 0 && whenAlone < 1, `${n}p: hidden partner should be uncertain, got ${whenAlone}`);
}

/* --- 2. no event text leaks "alone" before the reveal --- */
let checkedAlone = 0, checkedPartner = 0;
for (const n of [4, 5, 6]) {
  for (let i = 0; i < 4000; i++) {
    const names = ['You', 'A', 'B', 'C', 'D', 'E'].slice(0, n);
    const st = G.createGame({ numPlayers: n, names, allPass: 'leaster', difficulty: 'hard' });
    G.newHand(st);
    let pre = [];
    let guard = 0;
    while (st.phase !== 'handOver' && ++guard < 500) {
      AI.act(st);
      const evts = st.events.splice(0, st.events.length);
      if (st.phase === 'handOver') break;   // scoring reveals everything, by design
      if (st.partnerRevealed) break;        // the reveal itself is allowed to say it
      pre.push(...evts.map(e => e.text));
    }
    if (st.isLeaster) continue;
    if (st.picker === 0) continue;   // the human picker is told their own situation on purpose

    const blob = pre.join(' ').toLowerCase();
    check(!blob.includes('alone'),
      `${n}p: "alone" leaked before reveal: ` + pre.find(t => t.toLowerCase().includes('alone')));
    check(!blob.includes('secret partner'),
      `${n}p: partner hint leaked before reveal`);
    if (st.alone) checkedAlone++; else checkedPartner++;
  }
}

/* --- 3. the reveal still happens on the play of the Jack, and says the right
 * thing. Detected from the play event itself, since the Jack can fall on the
 * last card of the hand, where the phase has already flipped to handOver. --- */
let revealedAlone = 0, revealedPartner = 0, jdBuriedNaturally = 0;
for (const n of [4, 5, 6]) {
  for (let i = 0; i < 3000; i++) {
    const names = ['P0', 'A', 'B', 'C', 'D', 'E'].slice(0, n);
    const st = G.createGame({ numPlayers: n, names, allPass: 'leaster', difficulty: 'hard' });
    G.newHand(st);
    const playEvents = [];
    let guard = 0;
    while (st.phase !== 'handOver' && ++guard < 500) {
      AI.act(st);
      playEvents.push(...st.events.splice(0, st.events.length).filter(e => e.kind === 'play'));
    }
    if (st.isLeaster) continue;

    const jdEvent = playEvents.find(e => e.card === 'JD');
    // Not played is legal in exactly one case: the picker buried it. The bury
    // heuristic prices trump at -45, so this needs a hand with nothing but trump
    // in it and the Jack among the two highest-point cards there — about one deal
    // in three hundred thousand. This used to assert the Jack was ALWAYS played,
    // which made the suite fail perhaps once in twenty runs for a reason that was
    // never a bug. "Effectively never" is not "never"; say which one you mean.
    if (!jdEvent) {
      check(st.buried.some(c => c.id === 'JD'),
        `${n}p: the Jack of Diamonds was neither played nor buried`);
      jdBuriedNaturally++;
      continue;
    }
    if (st.alone) {
      revealedAlone++;
      check(/playing alone/.test(jdEvent.text), `${n}p: alone reveal wording: ${jdEvent.text}`);
      check(jdEvent.player === st.picker, `${n}p: alone but the Jack came from another seat`);
    } else {
      revealedPartner++;
      check(/partner/.test(jdEvent.text), `${n}p: partner reveal wording: ${jdEvent.text}`);
      check(jdEvent.player === st.partner, `${n}p: the Jack came from a seat that is not the partner`);
    }
    // Everything before the Jack must be silent about the sides.
    const before = playEvents.slice(0, playEvents.indexOf(jdEvent)).map(e => e.text).join(' ').toLowerCase();
    check(!before.includes('alone') && !before.includes('partner'),
      `${n}p: sides leaked in play events before the Jack was played`);
    check(st.partnerRevealed, `${n}p: sides never became public by hand end`);
  }
}

/* --- 4. the picker burying the Jack must stay secret all hand. The computer
 * players price trump at -45 when burying, so they effectively never choose this
 * themselves (see section 3) and the path has to be forced by hand. --- */
let buriedHidden = 0;
for (const n of [4, 5, 6]) {
  for (let i = 0; i < 400; i++) {
    const names = ['P0', 'A', 'B', 'C', 'D', 'E'].slice(0, n);
    const st = G.createGame({ numPlayers: n, names, allPass: 'leaster', difficulty: 'hard' });
    G.newHand(st);
    const d = G.DEAL[n];

    // Put the Jack of Diamonds into seat 0's hand, then let seat 0 pick.
    const seat0 = st.players[0].hand;
    if (!seat0.some(c => c.id === 'JD')) {
      let src = null, list = null;
      for (const pl of st.players) { const k = pl.hand.findIndex(c => c.id === 'JD'); if (k >= 0) { src = k; list = pl.hand; break; } }
      if (src === null) { const k = st.blind.findIndex(c => c.id === 'JD'); if (k >= 0) { src = k; list = st.blind; } }
      const swap = seat0.findIndex(c => c.id !== 'JD');
      const tmp = list[src]; list[src] = seat0[swap]; seat0[swap] = tmp;
    }
    // Treat seat 0 as a computer picker: a human picker is deliberately told
    // their own situation, which is checked separately below.
    st.players[0].isHuman = false;
    st.turn = 0;
    check(G.doPick(st, 0), 'forced pick failed');
    // Bury the Jack plus whatever else is cheapest.
    const hand = st.players[0].hand;
    const bury = ['JD'];
    for (const c of hand) { if (bury.length < d.blind && c.id !== 'JD') bury.push(c.id); }
    check(G.doBury(st, bury), 'forced bury failed');
    check(st.alone === true, `${n}p: burying the Jack should mean playing alone`);
    check(st.partnerRevealed === false, `${n}p: burying the Jack must not reveal anything`);

    let guard = 0;
    const texts = [];
    while (st.phase !== 'handOver' && ++guard < 500) {
      AI.act(st);
      const evts = st.events.splice(0, st.events.length);
      if (st.phase === 'handOver') break;
      texts.push(...evts.map(e => e.text));
      check(!st.partnerRevealed, `${n}p: buried Jack revealed mid-hand`);
    }
    // The only sentence allowed to mention the partner card is the neutral
    // announcement, which is emitted verbatim whether or not the picker is alone.
    const NEUTRAL = 'P0 is the picker. The Jack of Diamonds is the partner card.';
    const rest = texts.filter(t => t !== NEUTRAL).join(' ').toLowerCase();
    check(texts.includes(NEUTRAL), `${n}p: neutral picker announcement missing or reworded`);
    check(!rest.includes('alone') && !rest.includes('partner'),
      `${n}p: buried Jack leaked in play: ` + texts.filter(t => t !== NEUTRAL).find(t => /alone|partner/i.test(t)));
    buriedHidden++;
  }
}

/* --- 5. the human picker IS told their own situation --- */
{
  let toldAlone = 0, toldPartnered = 0, tries = 0;
  while ((toldAlone < 20 || toldPartnered < 20) && ++tries < 4000) {
    const st = G.createGame({ numPlayers: 5, names: ['You', 'A', 'B', 'C', 'D'], allPass: 'leaster', difficulty: 'hard' });
    G.newHand(st);
    st.turn = 0;
    G.doPick(st, 0);
    st.events.length = 0;
    const hand = st.players[0].hand;
    G.doBury(st, [hand[hand.length - 1].id, hand[hand.length - 2].id]);
    const msg = st.events.map(e => e.text).join(' ');
    if (st.alone) { toldAlone++; check(/you are playing alone/i.test(msg), 'human picker not told they are alone: ' + msg); }
    else { toldPartnered++; check(/secret partner/i.test(msg), 'human picker not told they have a partner: ' + msg); }
  }
  console.log('human picker told (alone/partnered):', toldAlone + '/' + toldPartnered);
}

console.log('hidden-alone hands sampled:   ', checkedAlone);
console.log('hidden-partner hands sampled: ', checkedPartner);
console.log('revealed as alone (JD played):', revealedAlone);
console.log('revealed as partner:          ', revealedPartner);
console.log('forced buried-Jack hands:     ', buriedHidden);
console.log('Jack buried by a computer:    ', jdBuriedNaturally, '(expected: almost always 0)');
// Tolerated as a rarity, not as a habit. If the bury heuristic ever stopped
// protecting trump, the Jack would start disappearing in quantity and section 3
// would quietly stop testing the reveal at all — so put a ceiling on it.
check(jdBuriedNaturally <= 9000 * 0.001,
  'the computer players are burying the Jack of Diamonds far too often (' +
  jdBuriedNaturally + ' hands) — the bury heuristic has probably stopped valuing trump');

if (fails.length) {
  const uniq = [...new Set(fails)];
  console.log('\nFAILURES (' + fails.length + ', ' + uniq.length + ' distinct):');
  uniq.slice(0, 15).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nNo hidden information leaked.');

/* Verifies that nothing observable to a non-picker changes based on whether the
 * picker is secretly alone, before the Jack of Diamonds is revealed.
 *
 * Judged through G.eventsFor(state, seat) — the same audience filter the
 * projection layer uses — rather than by reading state.events raw. The engine
 * now addresses private sentences to a seat instead of appending them to a
 * public string when that seat happens to be human, so "what a bystander sees"
 * is a real query rather than something this test had to approximate by
 * skipping the hands where the human was the picker.
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
      pre.push(...evts);   // whole events, audience and all
    }
    if (st.isLeaster) continue;

    /* Judge from a seat that is not the picker, using the same audience filter
     * the projection layer uses. This used to skip hands where seat 0 picked,
     * because the picker was told their own situation and seat 0 was the only
     * seat that could be told anything. Now that private events are addressed to
     * a seat rather than to "the human", every hand can be checked from a
     * bystander's viewpoint — including the ones this test used to throw away. */
    const viewer = st.picker === 0 ? 1 : 0;
    const visible = G.eventsFor({ events: pre }, viewer);
    check(visible.every(e => e.audience === undefined),
      `${n}p: eventsFor returned an event still carrying its audience`);

    const blob = visible.map(e => e.text).join(' ').toLowerCase();
    check(!blob.includes('alone'),
      `${n}p: "alone" leaked before reveal: ` + (visible.find(e => e.text.toLowerCase().includes('alone')) || {}).text);
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
    st.players[0].occupant = 'bot';   // a computer picker
    st.turn = 0;
    check(G.doPick(st, 0), 'forced pick failed');
    // Bury the Jack plus whatever else is cheapest.
    const hand = st.players[0].hand;
    const bury = ['JD'];
    for (const c of hand) { if (bury.length < d.blind && c.id !== 'JD') bury.push(c.id); }
    check(G.doBury(st, 0, bury), 'forced bury failed');
    check(st.alone === true, `${n}p: burying the Jack should mean playing alone`);
    check(st.partnerRevealed === false, `${n}p: burying the Jack must not reveal anything`);

    let guard = 0;
    const texts = [];
    while (st.phase !== 'handOver' && ++guard < 500) {
      AI.act(st);
      const evts = st.events.splice(0, st.events.length);
      if (st.phase === 'handOver') break;
      // Seat 0 is the forced picker here, so seat 1 is the bystander whose view
      // must give nothing away.
      texts.push(...evts.filter(e => e.audience === undefined || e.audience === 1).map(e => e.text));
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
    G.doBury(st, 0, [hand[hand.length - 1].id, hand[hand.length - 2].id]);
    const msg = G.eventsFor(st, 0).map(e => e.text).join(' ');
    if (st.alone) { toldAlone++; check(/you are playing alone/i.test(msg), 'human picker not told they are alone: ' + msg); }
    else { toldPartnered++; check(/secret partner/i.test(msg), 'human picker not told they have a partner: ' + msg); }
  }
  console.log('human picker told (alone/partnered):', toldAlone + '/' + toldPartnered);
}

/* --- 6. eventsFor itself, directly ---
 *
 * Everything above reaches the filter through a real hand, which is the right way
 * to test what players experience and the wrong way to test the filter: when the
 * audience check was deleted to see whether this file would notice, it did not,
 * because section 2 had quietly reimplemented the filter inline instead of
 * calling the one that ships. These assertions use nothing else. */
{
  const fake = {
    events: [
      { kind: 'info', text: 'public one' },
      { kind: 'info', text: 'for seat 0', audience: 0 },
      { kind: 'info', text: 'for seat 1', audience: 1 },
      { kind: 'play', text: 'public two', player: 3, card: 'QC', textPlain: 'plain two' },
      { kind: 'info', text: 'for seat 2', audience: 2 }
    ]
  };

  for (const seat of [0, 1, 2, 3]) {
    const got = G.eventsFor(fake, seat);
    const texts = got.map(e => e.text);

    check(texts.includes('public one') && texts.includes('public two'),
      `seat ${seat} did not receive the public events`);
    check(got.every(e => !('audience' in e)),
      `seat ${seat} received an event still carrying an audience key`);

    /* Ids are stripped too, and that is not tidiness. They are global and
     * monotonic, so the GAPS in the sequence a seat receives count the private
     * events addressed to everybody else — and one of those is "you hold both
     * black queens", so a gap appearing at the bury says a doubler exists and
     * roughly whose it is. The server needs ids to replay to a reconnecting
     * client; a client never does. */
    check(got.every(e => !('id' in e)),
      `seat ${seat} received an event carrying its global id — the gaps count other seats' secrets`);

    for (const other of [0, 1, 2]) {
      const line = 'for seat ' + other;
      if (other === seat) {
        check(texts.includes(line), `seat ${seat} was not given its own private event`);
      } else {
        check(!texts.includes(line), `seat ${seat} was given seat ${other}'s private event`);
      }
    }
  }

  // Seat 3 has no private events of its own and must see only the public pair.
  check(G.eventsFor(fake, 3).length === 2, 'a seat with no private events saw more than the public ones');

  // Other keys survive: textPlain is what the non-verbose log renders, and losing
  // it would silently downgrade every player who turned verbosity off.
  const play = G.eventsFor(fake, 0).find(e => e.kind === 'play');
  check(play && play.textPlain === 'plain two', 'eventsFor dropped textPlain');
  check(play && play.card === 'QC' && play.player === 3, 'eventsFor dropped event detail');

  // The source list is not modified — the server keeps one authoritative array
  // and projects it once per seat, so a filter that mutated it would corrupt
  // every later projection.
  check(fake.events.length === 5, 'eventsFor mutated the source events');
  check(fake.events[1].audience === 0, 'eventsFor stripped the audience from the source');
}

/* --- 7. Event ids never reach a client, so gaps cannot be counted --- */
{
  const fake = {
    events: [
      { id: 0, kind: 'info', text: 'public one' },
      { id: 1, kind: 'info', text: 'secret for seat 1', audience: 1 },
      { id: 2, kind: 'info', text: 'secret for seat 2', audience: 2 },
      { id: 3, kind: 'info', text: 'public two' }
    ]
  };
  const seen0 = G.eventsFor(fake, 0);
  check(seen0.length === 2, 'a bystander received a private event');
  check(seen0.every(e => e.id === undefined), 'a client received global event ids');

  // Two rooms differing only in HOW MANY private events were emitted must look
  // identical to a seat entitled to none of them.
  const few = { events: [ { id: 0, kind: 'info', text: 'a' }, { id: 1, kind: 'info', text: 'b' } ] };
  const many = { events: [
    { id: 0, kind: 'info', text: 'a' },
    { id: 1, kind: 'info', text: 'secret', audience: 3 },
    { id: 2, kind: 'info', text: 'another secret', audience: 4 },
    { id: 3, kind: 'info', text: 'b' }
  ] };
  check(JSON.stringify(G.eventsFor(few, 0)) === JSON.stringify(G.eventsFor(many, 0)),
    'a seat could tell how many private events went to other seats by the gaps in the ids');
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

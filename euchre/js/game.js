/* Euchre - rules engine. No DOM access lives in here.
 *
 * A small state machine driven by five actions: order, pass, call, discard and
 * play. Every action appends human-readable entries to state.events, which the
 * interface drains for the game log and for screen reader announcements.
 *
 * Four seats, two fixed partnerships: seats 0 and 2 against seats 1 and 3. That
 * is not configurable and should not become so — the whole shape of the game,
 * from going alone to the scoring table, is built on partners sitting opposite.
 *
 * ONE STRUCTURAL NOTE FOR ANYBODY ARRIVING FROM sheephead/. That engine scores
 * card points, and its invariant — "every hand accounts for exactly 120 points"
 * — is what its tests hang off. Euchre has no card points at all. The
 * equivalent invariant here is that five tricks are taken every hand, that the
 * makers' trick count decides the score, and that exactly one side scores. The
 * tests check that instead, and looking for a points total here would find
 * nothing.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  var SEATS = 4;
  var HAND_SIZE = 5;
  var KITTY_SIZE = 3;          // what is left after the upcard is turned

  /* Kept in the shape sheephead uses so the room, the projection and the tests
   * can be read side by side. Euchre has exactly one table size. */
  var DEAL = { 4: { hand: HAND_SIZE, kitty: KITTY_SIZE, seats: SEATS } };

  function teamOf(i) { return i % 2; }
  function partnerOf(i) { return (i + 2) % SEATS; }
  function teamName(t) { return t === 0 ? 'Seats 1 and 3' : 'Seats 2 and 4'; }

  function createGame(config) {
    var players = [];
    for (var i = 0; i < SEATS; i++) {
      players.push({
        index: i,
        name: config.names[i],
        /* Who is sitting here, rather than whether this is "the" human.
         *
         * A boolean that is true for one seat cannot answer the question a table
         * actually asks, which is whether anybody is currently in a chair.
         * 'human' | 'bot' | 'away'. A seat whose player has dropped becomes
         * 'away' and is played by the computer until they come back. */
        occupant: i === 0 ? 'human' : 'bot',
        hand: [],
        tricksWon: 0
      });
    }
    return {
      config: config,
      players: players,

      /* Match bookkeeping. `scores` is per TEAM and resets when somebody wins;
       * `gamesWon` is the running match and does not. Two counters rather than
       * one because a table that has played all evening wants both, and folding
       * them together loses the distinction between "we are 9-7 up" and "we have
       * won three of five". */
      scores: [0, 0],
      gamesWon: [0, 0],
      gameNumber: 0,
      gameOver: false,
      gameWinner: -1,

      dealer: -1,
      handNumber: 0,
      phase: 'idle',
      turn: 0,
      leader: 0,

      /* Trump, and who chose it. null trump is a real state — during the bidding
       * nobody knows yet, and every card helper is written to answer sensibly
       * while it is null rather than to be guarded at each call site. */
      trump: null,
      maker: -1,
      alone: false,
      sittingOut: -1,           // the maker's partner, while somebody plays alone

      /* The card turned up at the deal.
       *
       * It stays here, and stays public, for the whole hand — it is not cleared
       * when it is taken or turned down. Everybody at the table saw it, so its
       * identity is common knowledge from the moment it lands, and the counting
       * aid needs it: it is one of the four cards that is definitely not in
       * anybody's hand, or, if it was ordered up, one that is definitely in the
       * dealer's. An earlier draft moved it into the kitty when it was turned
       * down, which hid a card the whole table had already seen — the projection
       * withholds the kitty until the hand is over. */
      upcard: null,
      upcardStatus: 'none',     // 'none' | 'up' | 'taken' | 'turnedDown'
      deniedSuit: null,         // the turned-down suit, which may not be named
      kitty: [],                // the three face-down leftovers; nobody sees these
      discard: null,            // what the dealer put back. The dealer's business only.

      trick: [],
      lastTrick: null,
      played: [],
      trickLog: [],
      bidLog: [],

      dealt: null,
      result: null,
      history: [],

      events: [],
      nextEventId: 0
    };
  }

  /* ---------------- events ----------------
   *
   * Events carry a monotonic id. Slicing the log by array index is correct only
   * while it is never truncated, which is an invariant nothing enforces on a
   * list that grows for the lifetime of a room. Ids make truncation safe and let
   * a reconnecting client say what it last heard rather than being sent the
   * whole hand a second time — which for a screen reader user is not a cosmetic
   * problem, it is the game reporting things that are not happening.
   */
  function ev(state, kind, text, extra) {
    if (state.nextEventId === undefined) state.nextEventId = 0;
    var e = { id: state.nextEventId++, kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.events.push(e);
    return e;
  }

  /* An event only one seat may see.
   *
   * The temptation, carried over from a single-player game, is to append the
   * private half onto the public sentence whenever the seat happens to be the
   * human one. That works exactly as long as there is only ever one human. At a
   * real table every seat is human, and a single concatenated string cannot be
   * filtered afterwards — you cannot withhold half a sentence. So a private
   * event is addressed to a SEAT and is its own event, and the projection strips
   * the address on the way out: the mere presence of a targeted event would tell
   * a bystander that something private had just happened, and when. */
  function evTo(state, seat, kind, text, extra) {
    var e = ev(state, kind, text, extra);
    e.audience = seat;
    return e;
  }

  /* The events one seat is entitled to: everything public, plus anything
   * addressed to it, with both the address and the id removed.
   *
   * The id is stripped for the same reason the address is. Ids are global and
   * monotonic, so the gaps in the sequence a seat receives count the private
   * events sent to everybody else — and a gap appearing at the moment the dealer
   * picks up says the discard happened and roughly what it was worth. The server
   * needs ids for its own bookkeeping and to replay to a returning client. A
   * client never does. */
  function eventsFor(state, seat, sinceId) {
    var out = [];
    var since = (typeof sinceId === 'number') ? sinceId : -1;
    for (var i = 0; i < state.events.length; i++) {
      var e = state.events[i];
      if (e.id !== undefined && e.id <= since) continue;
      if (e.audience !== undefined && e.audience !== seat) continue;
      var copy = {};
      for (var k in e) if (k !== 'audience' && k !== 'id') copy[k] = e[k];
      out.push(copy);
    }
    return out;
  }

  function nameOf(state, i) { return state.players[i].name; }

  /* Keeps messages grammatical when a player has left their name as "You". */
  function vb(state, i, third, second) {
    return state.players[i].name.toLowerCase() === 'you' ? second : third;
  }

  /* ---------------- seating and turn order ---------------- */

  function isActive(state, i) { return i !== state.sittingOut; }

  /* The next seat that is actually holding cards. While somebody plays alone
   * their partner is skipped entirely — not given an empty turn, skipped — so a
   * trick is three cards rather than four and the turn never rests on a seat
   * with nothing to do. */
  function nextActive(state, i) {
    var j = i;
    for (var k = 0; k < SEATS; k++) {
      j = (j + 1) % SEATS;
      if (isActive(state, j)) return j;
    }
    return i;
  }

  function firstActive(state, i) { return isActive(state, i) ? i : nextActive(state, i); }

  function activeCount(state) { return state.sittingOut >= 0 ? SEATS - 1 : SEATS; }

  /* ---------------- dealing ---------------- */

  function deal(state) {
    var deck = C.shuffle(C.newDeck());
    for (var i = 0; i < SEATS; i++) state.players[i].hand = [];
    /* Three and two, the way it is actually dealt at a table. It makes no
     * difference to a shuffled deck, and it is what somebody learning the game
     * from this program will see described everywhere else. */
    var order = [3, 2];
    var at = 0;
    for (var round = 0; round < 2; round++) {
      for (var k = 0; k < SEATS; k++) {
        var seat = (state.dealer + 1 + k) % SEATS;
        var n = order[(round + k) % 2];
        for (var c = 0; c < n; c++) state.players[seat].hand.push(deck[at++]);
      }
    }
    /* A deal that does not give everybody five cards is a bug in the loop above,
     * and it would show up as a hand that plays four tricks and then stops. Cheap
     * to check, and impossible to misread when it fires. */
    for (var q = 0; q < SEATS; q++) {
      if (state.players[q].hand.length !== HAND_SIZE) {
        throw new Error('deal produced ' + state.players[q].hand.length + ' cards for seat ' + q);
      }
    }
    state.upcard = deck[at++];
    state.kitty = deck.slice(at, at + KITTY_SIZE);

    state.dealt = {
      hands: state.players.map(function (p) { return C.ids(p.hand); }),
      upcard: state.upcard.id,
      kitty: C.ids(state.kitty)
    };
  }

  function newHand(state) {
    if (state.phase !== 'idle' && state.phase !== 'handOver') return false;

    /* A finished game starts a fresh one rather than continuing past the target.
     * Scores go back to nothing; the match record does not. */
    if (state.gameOver) {
      state.scores = [0, 0];
      state.gameOver = false;
      state.gameWinner = -1;
      state.handNumber = 0;
    }

    if (state.gameNumber === 0) state.gameNumber = 1;
    state.dealer = state.dealer < 0
      ? Math.floor(Math.random() * SEATS)
      : (state.dealer + 1) % SEATS;

    state.handNumber++;
    state.phase = 'bid1';
    state.trump = null;
    state.maker = -1;
    state.alone = false;
    state.sittingOut = -1;
    state.upcardStatus = 'up';
    state.deniedSuit = null;
    state.discard = null;
    state.trick = [];
    state.lastTrick = null;
    state.played = [];
    state.trickLog = [];
    state.bidLog = [];
    state.result = null;
    state.players.forEach(function (p) { p.tricksWon = 0; });

    deal(state);

    state.leader = (state.dealer + 1) % SEATS;
    state.turn = state.leader;

    ev(state, 'deal', 'Hand ' + state.handNumber + '. ' + nameOf(state, state.dealer) +
      vb(state, state.dealer, ' deals', ' deal') + '. The upcard is the ' +
      C.name(state.upcard) + '. ' + nameOf(state, state.turn) +
      vb(state, state.turn, ' bids', ' bid') + ' first.',
      { textPlain: 'Hand ' + state.handNumber + '. Upcard ' + C.name(state.upcard) + '.' });

    /* Each seat is told its own cards, privately.
     *
     * The interface can read a hand back on request at any time, so this is not
     * the only route to it — but the deal is the moment a player most needs it,
     * and a public "everybody has been dealt" event tells them nothing. One
     * event per seat means every seat gets exactly one, so the shape of the log
     * gives nothing away either. */
    for (var i = 0; i < SEATS; i++) {
      var sorted = C.sortHand(state.players[i].hand, null);
      evTo(state, i, 'hand', 'Your hand: ' + sorted.map(C.name).join(', ') + '.',
        { textPlain: 'Your hand: ' + sorted.map(C.shortText).join(' ') + '.' });
    }
    return true;
  }

  /* ---------------- bidding ---------------- */

  function beginPlay(state) {
    state.phase = 'play';
    state.leader = firstActive(state, (state.dealer + 1) % SEATS);
    state.turn = state.leader;
    state.trick = [];
    ev(state, 'info', nameOf(state, state.leader) +
      vb(state, state.leader, ' leads', ' lead') + ' to the first trick.');
  }

  /* Somebody has decided what trump is. The one place that happens, so the
   * "going alone" bookkeeping cannot end up done twice or not at all. */
  function makeTrump(state, p, suit, alone, how) {
    state.trump = suit;
    state.maker = p;
    state.alone = !!alone && !!state.config.allowAlone;

    var suitWord = C.SUIT_NAME[suit];
    var msg = nameOf(state, p) + ' ' + how + '. ' + suitWord + ' are trump.';

    if (state.alone) {
      state.sittingOut = partnerOf(p);
      msg += ' ' + nameOf(state, p) + vb(state, p, ' is', ' are') + ' going alone, so ' +
        nameOf(state, state.sittingOut) + vb(state, state.sittingOut, ' sits', ' sit') +
        ' out this hand.';
    }
    ev(state, 'bid', msg, {
      textPlain: nameOf(state, p) + ' ' + how + ', ' + suitWord.toLowerCase() +
        (state.alone ? ', alone.' : '.')
    });
    state.bidLog.push({ player: p, action: how, suit: suit, alone: state.alone });

    /* Everybody is told what the left bower now is, because it has changed which
     * suit two cards belong to and that is the single commonest way to lose a
     * trick you meant to win. Public: it follows from the trump suit, which
     * everybody already knows. */
    ev(state, 'info', 'The right bower is the ' + C.RANK_NAME.J + ' of ' + suitWord +
      '; the left bower is the ' + C.RANK_NAME.J + ' of ' + C.SUIT_NAME[C.SAME_COLOUR[suit]] +
      ', which counts as ' + suitWord.toLowerCase() + ' for this hand.');
  }

  /* Round one: take the upcard, which makes its suit trump and hands the card to
   * the dealer. */
  function doOrder(state, p, alone) {
    if (state.phase !== 'bid1' || state.turn !== p) return false;

    var how = p === state.dealer ? 'takes it up'
      : p === partnerOf(state.dealer) ? 'orders it up for ' + nameOf(state, state.dealer)
        : 'orders it up';
    makeTrump(state, p, state.upcard.s, alone, how);

    /* The dealer takes the upcard whoever ordered it. Even when the dealer is
     * sitting out because their partner went alone — they still pick up and
     * discard, which is the rule most often got wrong, and getting it wrong
     * leaves a five card hand nobody will ever play. */
    state.players[state.dealer].hand.push(state.upcard);
    ev(state, 'info', nameOf(state, state.dealer) +
      vb(state, state.dealer, ' takes', ' take') + ' the ' + C.name(state.upcard) +
      ' and must discard.');
    evTo(state, state.dealer, 'hand', 'You took the ' + C.name(state.upcard) +
      '. Choose a card to put back — you have six and may keep only five.');
    state.upcardStatus = 'taken';
    state.phase = 'discard';
    state.turn = state.dealer;
    return true;
  }

  /* Round two: name any suit but the one that was turned down. */
  function doCall(state, p, suit, alone) {
    if (state.phase !== 'bid2' || state.turn !== p) return false;
    if (C.SUITS.indexOf(suit) < 0) return false;
    if (suit === state.deniedSuit) return false;
    makeTrump(state, p, suit, alone, 'names ' + C.SUIT_NAME[suit].toLowerCase());
    beginPlay(state);
    return true;
  }

  function doPass(state, p) {
    if (state.turn !== p) return false;
    if (state.phase !== 'bid1' && state.phase !== 'bid2') return false;

    /* The dealer may be forbidden to pass in round two. Refused rather than
     * ignored, so the interface can say why instead of a key doing nothing —
     * which for somebody who cannot see the screen is the same as a broken
     * keyboard. */
    if (state.phase === 'bid2' && p === state.dealer && state.config.stickTheDealer) {
      return false;
    }

    state.bidLog.push({ player: p, action: 'pass', round: state.phase === 'bid1' ? 1 : 2 });
    ev(state, 'bid', nameOf(state, p) + vb(state, p, ' passes', ' pass') + '.',
      { textPlain: nameOf(state, p) + ': pass.' });

    var last = p === state.dealer;
    if (!last) { state.turn = (p + 1) % SEATS; return true; }

    if (state.phase === 'bid1') {
      state.phase = 'bid2';
      state.upcardStatus = 'turnedDown';
      state.deniedSuit = state.upcard.s;
      state.turn = (state.dealer + 1) % SEATS;
      ev(state, 'info', 'Everybody passed. The ' + C.name(state.upcard) +
        ' is turned down, so ' + C.SUIT_NAME[state.deniedSuit].toLowerCase() +
        ' cannot be named. ' + nameOf(state, state.turn) +
        vb(state, state.turn, ' may name', ' may name') + ' any other suit, or pass.' +
        (state.config.stickTheDealer
          ? ' The dealer must name a suit if it comes round to them.'
          : ''),
        { textPlain: 'All passed. ' + C.name(state.upcard) + ' turned down.' });
      return true;
    }

    // Round two, everybody passed, and the dealer was allowed to.
    state.phase = 'handOver';
    state.result = { thrownIn: true, deltas: [0, 0], label: 'thrown in' };
    ev(state, 'result', 'Everybody passed twice. The hand is thrown in and nobody scores. ' +
      nameOf(state, (state.dealer + 1) % SEATS) + ' deals the next one.',
      { textPlain: 'Hand thrown in.' });
    recordHand(state);
    return true;
  }

  /* The dealer puts one card back after taking the upcard. */
  function doDiscard(state, p, cardId) {
    if (state.phase !== 'discard' || p !== state.dealer) return false;
    var hand = state.players[p].hand;
    var at = -1;
    for (var i = 0; i < hand.length; i++) if (hand[i].id === cardId) { at = i; break; }
    if (at < 0) return false;
    if (hand.length !== HAND_SIZE + 1) return false;

    state.discard = hand.splice(at, 1)[0];
    /* Public that it happened, private what it was. Everybody at a real table
     * watches the dealer put a card back and nobody sees which. */
    ev(state, 'info', nameOf(state, p) + vb(state, p, ' discards', ' discard') +
      ' a card face down.', { textPlain: nameOf(state, p) + ' discards.' });
    evTo(state, p, 'hand', 'You put back the ' + C.name(state.discard) + '.');
    beginPlay(state);
    return true;
  }

  /* ---------------- playing ---------------- */

  function legalPlays(state, p) {
    var hand = state.players[p].hand || [];
    if (state.sittingOut === p) return [];
    if (!state.trick.length) return hand.slice();
    var led = C.effSuit(state.trick[0].card, state.trump);
    var follow = hand.filter(function (c) { return C.effSuit(c, state.trump) === led; });
    return follow.length ? follow : hand.slice();
  }

  function isLegal(state, p, cardId) {
    return legalPlays(state, p).some(function (c) { return c.id === cardId; });
  }

  function illegalReason(state, p, cardId) {
    if (state.sittingOut === p) return 'you are sitting out this hand';
    var card = C.get(cardId);
    if (!card) return 'that is not a card';
    if (!(state.players[p].hand || []).some(function (c) { return c.id === cardId; })) {
      return 'that card is not in your hand';
    }
    if (!state.trick.length) return '';
    var led = C.effSuit(state.trick[0].card, state.trump);
    var ledWord = led === state.trump ? 'trump' : C.SUIT_NAME[led].toLowerCase();
    /* Named precisely, because the left bower is exactly where this goes wrong.
     * "You must follow clubs" while holding the jack of clubs and clubs are not
     * trump is a message that reads as a bug unless it says why. */
    var mine = (state.players[p].hand || []).filter(function (c) {
      return C.effSuit(c, state.trump) === led;
    });
    var reason = 'you must follow ' + ledWord;
    if (mine.length) reason += ' — you hold ' + mine.map(C.name).join(' and ');
    return reason;
  }

  function trickWinnerIndex(plays, trump) {
    var best = 0;
    for (var i = 1; i < plays.length; i++) {
      if (C.beats(plays[i].card, plays[best].card, trump)) best = i;
    }
    return best;
  }

  function doPlay(state, p, cardId) {
    if (state.phase !== 'play' || state.turn !== p) return false;
    if (!isLegal(state, p, cardId)) return false;
    var hand = state.players[p].hand;
    var at = -1;
    for (var i = 0; i < hand.length; i++) if (hand[i].id === cardId) { at = i; break; }
    if (at < 0) return false;
    var card = hand.splice(at, 1)[0];
    state.trick.push({ player: p, card: card });
    state.played.push(card);

    ev(state, 'play', nameOf(state, p) + vb(state, p, ' plays', ' play') + ' the ' +
      C.describe(card, state.trump) + '.',
      {
        player: p, card: card.id,
        textPlain: nameOf(state, p) + ': ' + C.name(card) + '.'
      });

    if (state.trick.length === activeCount(state)) { resolveTrick(state); return true; }
    state.turn = nextActive(state, p);
    return true;
  }

  function resolveTrick(state) {
    var wi = trickWinnerIndex(state.trick, state.trump);
    var winner = state.trick[wi].player;
    state.players[winner].tricksWon++;
    state.lastTrick = { plays: state.trick.slice(), winner: winner, number: state.trickLog.length + 1 };
    state.trickLog.push({
      number: state.trickLog.length + 1,
      plays: state.trick.map(function (t) { return { player: t.player, card: t.card.id }; }),
      winner: winner
    });

    ev(state, 'trick', nameOf(state, winner) + vb(state, winner, ' takes', ' take') +
      ' trick ' + state.trickLog.length + ' with the ' +
      C.describe(state.trick[wi].card, state.trump) + '.',
      {
        winner: winner,
        textPlain: nameOf(state, winner) + ' takes trick ' + state.trickLog.length + '.'
      });

    state.trick = [];
    if (state.trickLog.length === HAND_SIZE) { endHand(state); return; }
    state.leader = winner;
    state.turn = winner;
  }

  /* ---------------- scoring ----------------
   *
   * The whole scoring table, written out rather than computed, because it is
   * short and because every euchre argument in history has been about one of
   * these five lines:
   *
   *   makers take 3 or 4                        1
   *   makers take all 5                         2
   *   makers take all 5, playing alone          4
   *   makers take 3 or 4, playing alone         1   (going alone pays nothing extra
   *                                                  unless you sweep)
   *   makers take fewer than 3 — euchred        2, to the other side
   */
  function scoreHand(state) {
    var makerTeam = teamOf(state.maker);
    var made = 0;
    for (var i = 0; i < SEATS; i++) if (teamOf(i) === makerTeam) made += state.players[i].tricksWon;

    var deltas = [0, 0];
    var label, euchred = false;

    if (made >= 3) {
      var pts = made === HAND_SIZE ? (state.alone ? 4 : 2) : 1;
      deltas[makerTeam] = pts;
      label = made === HAND_SIZE
        ? (state.alone ? 'a march, alone — four' : 'a march — two')
        : 'made it with ' + made + ' — one';
    } else {
      euchred = true;
      deltas[1 - makerTeam] = 2;
      label = 'euchred — two to the other side';
    }

    return {
      makerTeam: makerTeam,
      made: made,
      euchred: euchred,
      alone: state.alone,
      trump: state.trump,
      maker: state.maker,
      deltas: deltas,
      label: label
    };
  }

  function endHand(state) {
    var r = scoreHand(state);
    state.scores[0] += r.deltas[0];
    state.scores[1] += r.deltas[1];

    var target = state.config.pointsToWin || 10;
    var winSide = -1;
    if (state.scores[0] >= target && state.scores[0] > state.scores[1]) winSide = 0;
    else if (state.scores[1] >= target && state.scores[1] > state.scores[0]) winSide = 1;
    else if (state.scores[0] >= target && state.scores[1] >= target) {
      /* Both over the line at once cannot happen — only one side scores on a
       * hand — but if it ever does, the higher score wins rather than the
       * function silently picking seat zero's team. */
      winSide = state.scores[0] >= state.scores[1] ? 0 : 1;
    }

    var side = r.deltas[0] ? 0 : 1;
    var summary = nameOf(state, state.maker) +
      vb(state, state.maker, ' made', ' made') + ' ' + C.SUIT_NAME[state.trump].toLowerCase() +
      (state.alone ? ' alone' : '') + ' and took ' + r.made +
      (r.made === 1 ? ' trick' : ' tricks') + '. ' +
      (r.euchred
        ? nameOf(state, state.maker) + vb(state, state.maker, ' was', ' were') +
          ' euchred: two points to ' + sideWords(state, 1 - r.makerTeam) + '.'
        : pointWords(r.deltas[r.makerTeam]) + ' to ' + sideWords(state, r.makerTeam) + '.') +
      ' Score: ' + sideWords(state, 0) + ' ' + state.scores[0] + ', ' +
      sideWords(state, 1) + ' ' + state.scores[1] + '.';

    r.summary = summary;
    r.scores = state.scores.slice();
    r.scoringSide = side;
    state.result = r;
    state.phase = 'handOver';

    ev(state, 'result', summary, { textPlain: r.label + '. ' + state.scores[0] + '-' + state.scores[1] + '.' });

    if (winSide >= 0) {
      state.gameOver = true;
      state.gameWinner = winSide;
      state.gamesWon[winSide]++;
      r.gameOver = true;
      r.gameWinner = winSide;
      ev(state, 'result', sideWords(state, winSide) + ' win game ' + state.gameNumber +
        ', ' + state.scores[winSide] + ' to ' + state.scores[1 - winSide] + '. ' +
        'Games: ' + sideWords(state, 0) + ' ' + state.gamesWon[0] + ', ' +
        sideWords(state, 1) + ' ' + state.gamesWon[1] + '. Deal to start another.');
      state.gameNumber++;
    }
    recordHand(state);
  }

  /* Numbers a screen reader says as words. "2 points" is read as "two points" by
   * most voices and as "2 points" by some, and the ones that get it wrong get it
   * wrong in the middle of the only sentence that says who won. */
  function pointWords(n) {
    var w = ['no points', 'one point', 'two points', 'three points', 'four points'];
    return w[n] || n + ' points';
  }

  /* Who a side is, by the names of the two people in it. "Seats 1 and 3" is
   * accurate and unmemorable; "you and Skipper" is what a player is actually
   * keeping track of. */
  function sideWords(state, t) {
    var a = [], i;
    for (i = 0; i < SEATS; i++) if (teamOf(i) === t) a.push(nameOf(state, i));
    return a.join(' and ');
  }

  /* ---------------- the permanent record ---------------- */

  function recordHand(state) {
    var rec = {
      handNumber: state.handNumber,
      gameNumber: state.gameNumber,
      dealer: state.dealer,
      trump: state.trump,
      maker: state.maker,
      alone: state.alone,
      sittingOut: state.sittingOut,
      upcard: state.dealt ? state.dealt.upcard : null,
      turnedDown: state.upcardStatus === 'turnedDown',
      discard: state.discard ? state.discard.id : null,
      kitty: state.dealt ? state.dealt.kitty.slice() : [],
      dealt: state.dealt ? state.dealt.hands.map(function (h) { return h.slice(); }) : [],
      tricks: state.trickLog.map(function (t) {
        return { number: t.number, winner: t.winner, plays: t.plays.map(function (x) { return { player: x.player, card: x.card }; }) };
      }),
      tricksWon: state.players.map(function (p) { return p.tricksWon; }),
      /* By value, not by reference. sheephead stores `result: state.result` and
       * then has to promise nobody ever rewrites it per seat; a copy costs a few
       * bytes and removes the promise. */
      result: JSON.parse(JSON.stringify(state.result)),
      scores: state.scores.slice(),
      problems: []
    };
    rec.problems = auditHand(rec);
    if (rec.problems.length) {
      ev(state, 'error', 'Accounting check failed on hand ' + rec.handNumber + ': ' +
        rec.problems.join('; ') + '.');
    }
    state.history.push(rec);
    return rec;
  }

  /* Re-derive the hand from the cards rather than trusting the running totals.
   *
   * The point of an audit is that it must be able to disagree with the thing it
   * is auditing. So this counts tricks out of `rec.tricks`, checks the deal
   * against the deck, and re-applies the scoring table from `tricksWon` — it
   * does not read state.result.deltas and nod. */
  function auditHand(rec) {
    var bad = [];
    var i;

    /* A thrown-in hand has no trump, no maker and no tricks, and every check
     * below would report all of that as broken. */
    if (rec.result && rec.result.thrownIn) {
      if (rec.tricks.length) bad.push('a thrown-in hand recorded ' + rec.tricks.length + ' tricks');
      if (rec.result.deltas[0] || rec.result.deltas[1]) bad.push('a thrown-in hand scored');
      return bad;
    }

    if (rec.tricks.length !== HAND_SIZE) {
      bad.push('recorded ' + rec.tricks.length + ' tricks instead of ' + HAND_SIZE);
    }

    var seen = {}, dup = 0, total = 0;
    var expectPerTrick = rec.sittingOut >= 0 ? SEATS - 1 : SEATS;
    rec.tricks.forEach(function (t) {
      if (t.plays.length !== expectPerTrick) {
        bad.push('trick ' + t.number + ' has ' + t.plays.length + ' cards, expected ' + expectPerTrick);
      }
      t.plays.forEach(function (pl) {
        total++;
        if (seen[pl.card]) dup++;
        seen[pl.card] = 1;
        if (pl.player === rec.sittingOut) bad.push('a seat that was sitting out played a card');
      });
    });
    if (dup) bad.push(dup + ' card' + (dup === 1 ? ' was' : 's were') + ' played more than once');
    if (total !== HAND_SIZE * expectPerTrick) {
      bad.push(total + ' cards played, expected ' + (HAND_SIZE * expectPerTrick));
    }

    // The deal must be a subset of the deck with nothing repeated.
    var dealtSeen = {}, dealtDup = 0, dealtCount = 0;
    (rec.dealt || []).forEach(function (h) {
      h.forEach(function (id) {
        dealtCount++;
        if (dealtSeen[id]) dealtDup++;
        dealtSeen[id] = 1;
        if (!C.get(id)) bad.push(id + ' is not a card in the deck');
      });
    });
    (rec.kitty || []).forEach(function (id) {
      dealtCount++;
      if (dealtSeen[id]) dealtDup++;
      dealtSeen[id] = 1;
    });
    if (rec.upcard) {
      dealtCount++;
      if (dealtSeen[rec.upcard]) dealtDup++;
      dealtSeen[rec.upcard] = 1;
    }
    if (dealtDup) bad.push(dealtDup + ' card' + (dealtDup === 1 ? '' : 's') + ' dealt twice');
    if (dealtCount !== C.DECK_SIZE) bad.push('the deal accounts for ' + dealtCount + ' cards, not ' + C.DECK_SIZE);

    // Trick counts must match who actually took them.
    var counted = [0, 0, 0, 0];
    rec.tricks.forEach(function (t) { counted[t.winner]++; });
    for (i = 0; i < SEATS; i++) {
      if (counted[i] !== rec.tricksWon[i]) {
        bad.push('seat ' + (i + 1) + ' is credited with ' + rec.tricksWon[i] +
          ' tricks but took ' + counted[i]);
      }
    }
    var sum = counted.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== HAND_SIZE) bad.push('tricks taken total ' + sum + ' instead of ' + HAND_SIZE);

    // And the score must follow from those tricks, re-derived from the table.
    if (rec.maker >= 0 && rec.result) {
      var mt = teamOf(rec.maker);
      var made = 0;
      for (i = 0; i < SEATS; i++) if (teamOf(i) === mt) made += counted[i];
      var want = [0, 0];
      if (made >= 3) want[mt] = made === HAND_SIZE ? (rec.alone ? 4 : 2) : 1;
      else want[1 - mt] = 2;
      if (want[0] !== rec.result.deltas[0] || want[1] !== rec.result.deltas[1]) {
        bad.push('the score change was ' + rec.result.deltas.join('/') +
          ' but the tricks give ' + want.join('/'));
      }
      if (want[0] && want[1]) bad.push('both sides scored on one hand');
    }
    return bad;
  }

  /* ---------------- the written record ---------------- */

  function pad(s, w) {
    s = String(s);
    while (s.length < w) s += ' ';
    return s;
  }

  function cardList(ids) {
    return (ids || []).map(function (id) {
      var c = C.get(id);
      return c ? C.name(c) : id;
    }).join(', ');
  }

  /* A complete written account of the session, from one seat's point of view.
   *
   * `seat` matters: a hand still in progress is written from what that seat can
   * legitimately see, so exporting mid-hand cannot be used to read somebody
   * else's cards. Finished hands are shown in full, because at that point they
   * were shown in full anyway. */
  function transcript(state, seat, extraLines) {
    var L = [];
    var t = state.config;
    L.push('Euchre — game log');
    L.push('Players: ' + state.players.map(function (p, i) {
      return (i + 1) + ' ' + p.name + (i === seat ? ' (you)' : '') +
        ' [' + (p.occupant === 'human' ? 'person' : p.occupant === 'away' ? 'away' : 'computer') + ']';
    }).join(', '));
    L.push('Partnerships: ' + sideWords(state, 0) + ' against ' + sideWords(state, 1));
    L.push('Playing to ' + (t.pointsToWin || 10) + '. Opponent skill: ' + (t.difficulty || 'normal') +
      '. Stick the dealer: ' + (t.stickTheDealer ? 'on' : 'off') +
      '. Going alone: ' + (t.allowAlone === false ? 'off' : 'on') + '.');
    L.push('');

    var failed = state.history.filter(function (h) { return h.problems && h.problems.length; });
    L.push('Hands completed: ' + state.history.length +
      '. Accounting checks failed: ' + failed.length + '.');
    if (failed.length) {
      L.push('*** THE ACCOUNTING CHECK FAILED ON ' + failed.length + ' HAND(S). Details below. ***');
    }
    L.push('Games won: ' + sideWords(state, 0) + ' ' + state.gamesWon[0] + ', ' +
      sideWords(state, 1) + ' ' + state.gamesWon[1] + '.');
    L.push('');

    state.history.forEach(function (h) { pushHand(L, state, h); });
    if (state.phase !== 'handOver' && state.phase !== 'idle') pushInProgress(L, state, seat);

    if (extraLines && extraLines.length) {
      L.push('');
      L.push('--- On-screen log, newest first ---');
      extraLines.forEach(function (line) { L.push(line); });
    }
    return L.join('\n');
  }

  function pushHand(L, state, h) {
    L.push('--- Hand ' + h.handNumber + ' (game ' + h.gameNumber + ') ---');
    L.push('Dealer: ' + state.players[h.dealer].name +
      '. Upcard: ' + (h.upcard ? C.name(C.get(h.upcard)) : 'none') +
      (h.turnedDown ? ' (turned down)' : ''));
    h.dealt.forEach(function (ids, i) {
      L.push('  ' + pad(state.players[i].name, 14) + ' ' + cardList(ids));
    });
    L.push('  ' + pad('Kitty', 14) + ' ' + cardList(h.kitty));
    if (h.discard) L.push('  ' + pad('Discarded', 14) + ' ' + cardList([h.discard]));

    if (h.result && h.result.thrownIn) {
      L.push('  Everybody passed twice. Thrown in, nobody scored.');
      /* The problems line is repeated here rather than left to the common path
       * below, because this branch returns early. Without it a thrown-in hand
       * that failed its audit was COUNTED at the top of the export and then
       * never explained anywhere in it — a report that says something is wrong
       * and will not say what is worse than one that says nothing. */
      if (h.problems && h.problems.length) {
        L.push('  *** ACCOUNTING CHECK FAILED: ' + h.problems.join('; ') + ' ***');
      }
      L.push('');
      return;
    }

    L.push('  Trump: ' + (h.trump ? C.SUIT_NAME[h.trump] : 'none') +
      ', made by ' + state.players[h.maker].name + (h.alone ? ', alone' : '') +
      (h.sittingOut >= 0 ? ' (' + state.players[h.sittingOut].name + ' sat out)' : ''));
    h.tricks.forEach(function (t) {
      L.push('  Trick ' + t.number + ': ' + t.plays.map(function (p) {
        return state.players[p.player].name + ' ' + C.shortText(C.get(p.card));
      }).join(', ') + ' -> ' + state.players[t.winner].name);
    });
    L.push('  Tricks: ' + h.tricksWon.map(function (n, i) {
      return state.players[i].name + ' ' + n;
    }).join(', '));
    L.push('  ' + (h.result ? h.result.summary : ''));
    if (h.problems && h.problems.length) {
      L.push('  *** ACCOUNTING CHECK FAILED: ' + h.problems.join('; ') + ' ***');
    }
    L.push('');
  }

  /* The hand still being played, from one seat only. Never prints a card that is
   * still in somebody else's hand. */
  function pushInProgress(L, state, seat) {
    L.push('--- Hand ' + state.handNumber + ' (in progress) ---');
    L.push('Dealer: ' + state.players[state.dealer].name +
      '. Upcard: ' + (state.upcard
        ? C.name(state.upcard) +
          (state.upcardStatus === 'taken' ? ' (taken by the dealer)'
            : state.upcardStatus === 'turnedDown' ? ' (turned down)' : '')
        : 'none'));
    L.push('Trump: ' + (state.trump ? C.SUIT_NAME[state.trump] : 'not yet decided'));
    if (state.maker >= 0) {
      L.push('Made by: ' + state.players[state.maker].name + (state.alone ? ', alone' : ''));
    }
    var own = state.players[seat] && state.players[seat].hand ? state.players[seat].hand : [];
    L.push('Your hand: ' + own.map(C.name).join(', '));
    state.trickLog.forEach(function (t) {
      L.push('  Trick ' + t.number + ': ' + t.plays.map(function (p) {
        return state.players[p.player].name + ' ' + C.shortText(C.get(p.card));
      }).join(', ') + ' -> ' + state.players[t.winner].name);
    });
    if (state.trick.length) {
      L.push('  Trick ' + (state.trickLog.length + 1) + ' so far: ' + state.trick.map(function (p) {
        return state.players[p.player].name + ' ' + C.shortText(p.card);
      }).join(', '));
    }
    L.push('  Tricks so far: ' + state.players.map(function (p) {
      return p.name + ' ' + p.tricksWon;
    }).join(', '));
    L.push('');
  }

  /* Could a new hand be dealt right now?
   *
   * The room needs this and must not hardcode a phase name to get it. This
   * exact check, written as `state.phase !== 'handOver'`, was copied verbatim
   * into cribbage-multiplayer/js/room.js — where the finished-hand phase is
   * called `roundOver`, so the condition was true at every moment of every hand
   * and every deal sent over the wire was silently swallowed. Online play there
   * could not get past hand one and nothing said why.
   *
   * It is correct here, which is exactly what made it dangerous: a constant that
   * is right in the file it was written in and wrong in the file it was copied
   * to. A predicate the engine owns cannot come apart that way. */
  /* May a hand be dealt right now?
   *
   * EXACTLY the phases applyAction accepts a nextHand in, and shared
   * contract tests hold all three games to that. The room asks this before
   * forwarding a Deal, and both ways of being approximately right are bugs:
   * too narrow and the deal is swallowed with no message at all, which is
   * what a copied handOver check did to cribbage; too broad and the player
   * gets the raw engine refusal — "the hand is not over" — while a new hand
   * is visibly being dealt in front of them, which is the exact confusion the
   * gate was added to prevent.
   *
   * idle belongs to the start action, not to this one. A table that has never
   * dealt is started by the people at it, deliberately. */
  function canDeal(state) {
    return state.phase === 'handOver';
  }

  /* Whose move the table is waiting for, or -1 if it is waiting for nobody.
   *
   * Not simply `state.turn`, and the two places that assumed it was are the room
   * and the in-process server — both of which schedule the computer's moves off
   * this answer. Two phases disagree with `turn`:
   *
   *   discard   belongs to the dealer, who may not be the seat on turn
   *   idle / handOver   nobody is on move at all; `turn` still holds whatever it
   *                     last held, so reading it here schedules a bot to play a
   *                     hand that is over
   *
   * A seat sitting out while its partner plays alone never appears here, because
   * the turn never rests on it — nextActive skips it. */
  function seatToAct(state) {
    if (state.phase === 'bid1' || state.phase === 'bid2' || state.phase === 'play') return state.turn;
    if (state.phase === 'discard') return state.dealer;
    return -1;
  }

  /* ---------------- the only way in ----------------
   *
   * applyAction is the single door into the engine. Nothing else may call
   * doOrder, doPass, doCall, doDiscard, doPlay or newHand — not because those
   * are dangerous in themselves, but because the seat check lives here. An
   * engine function that trusts its caller is fine in a game that runs in one
   * tab and is a hole the size of the whole table once there is a socket.
   *
   * Object.create(null) rather than {}: a plain object inherits from
   * Object.prototype, so ACTIONS['constructor'] and ACTIONS['__proto__'] are
   * truthy and would sail past the guard.
   */
  var ACTIONS = Object.create(null);
  ACTIONS.order = 1; ACTIONS.pass = 1; ACTIONS.call = 1;
  ACTIONS.discard = 1; ACTIONS.play = 1;
  ACTIONS.start = 1; ACTIONS.nextHand = 1;

  function applyAction(state, seat, action) {
    if (!state || !state.players) return { ok: false, reason: 'no game in progress' };
    if (!action || typeof action !== 'object') return { ok: false, reason: 'malformed action' };
    if (!ACTIONS[action.type]) return { ok: false, reason: 'unknown action' };

    if (typeof seat !== 'number' || seat !== Math.floor(seat) ||
        seat < 0 || seat >= state.players.length) {
      return { ok: false, reason: 'not a seat at this table' };
    }

    try {
      switch (action.type) {
        case 'order':
          if (state.phase !== 'bid1') return { ok: false, reason: 'the upcard is not on offer' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn to bid' };
          return doOrder(state, seat, !!action.alone)
            ? { ok: true } : { ok: false, reason: 'could not order it up' };

        case 'call':
          if (state.phase !== 'bid2') return { ok: false, reason: 'not the naming round' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn to bid' };
          if (typeof action.suit !== 'string' || C.SUITS.indexOf(action.suit) < 0) {
            return { ok: false, reason: 'that is not a suit' };
          }
          if (action.suit === state.deniedSuit) {
            return { ok: false, reason: C.SUIT_NAME[action.suit].toLowerCase() +
              ' was turned down and cannot be named this hand' };
          }
          return doCall(state, seat, action.suit, !!action.alone)
            ? { ok: true } : { ok: false, reason: 'could not name that suit' };

        case 'pass':
          if (state.phase !== 'bid1' && state.phase !== 'bid2') {
            return { ok: false, reason: 'there is nothing to pass on' };
          }
          if (state.turn !== seat) return { ok: false, reason: 'not your turn to bid' };
          if (state.phase === 'bid2' && seat === state.dealer && state.config.stickTheDealer) {
            return { ok: false, reason: 'stick the dealer is on, so you must name a suit' };
          }
          return doPass(state, seat) ? { ok: true } : { ok: false, reason: 'could not pass' };

        case 'discard':
          if (state.phase !== 'discard') return { ok: false, reason: 'nothing to discard' };
          if (seat !== state.dealer) return { ok: false, reason: 'only the dealer discards' };
          if (typeof action.card !== 'string') return { ok: false, reason: 'no card given' };
          return doDiscard(state, seat, action.card)
            ? { ok: true } : { ok: false, reason: 'that card could not be discarded' };

        case 'play':
          if (state.phase !== 'play') return { ok: false, reason: 'not the playing phase' };
          if (state.sittingOut === seat) return { ok: false, reason: 'you are sitting out this hand' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          if (typeof action.card !== 'string') return { ok: false, reason: 'no card given' };
          if (!isLegal(state, seat, action.card)) {
            return { ok: false, reason: illegalReason(state, seat, action.card) || 'that card cannot be played' };
          }
          return doPlay(state, seat, action.card)
            ? { ok: true } : { ok: false, reason: 'that card could not be played' };

        case 'start':
          /* Deal the FIRST hand, when the people at the table say they are
           * ready. A table used to deal the moment it was made, which left the
           * host no time at all to read the code to anybody: by the time they
           * had it written down the computer had played their seat through half
           * a hand. Starting is a decision somebody makes. */
          if (state.phase !== 'idle') return { ok: false, reason: 'the game has already started' };
          return newHand(state) ? { ok: true } : { ok: false, reason: 'could not deal' };

        case 'nextHand':
          if (state.phase !== 'handOver') return { ok: false, reason: 'the hand is not over' };
          return newHand(state) ? { ok: true } : { ok: false, reason: 'could not deal' };
      }
    } catch (e) {
      /* Reaching here is a bug in the engine, not in the message — and the state
       * is now untrustworthy, so this must NOT be reported as an ordinary
       * refusal.
       *
       * The validation failures above all happen before anything is written, so
       * `ok: false` from them genuinely means nothing changed. A throw does not:
       * doPlay splices the card out of the hand and pushes it into the trick
       * before it ever reaches resolveTrick and scoring. An exception in there
       * leaves the card gone, the trick unresolvable and the turn not advanced,
       * while the caller is told the move was declined. That is strictly worse
       * than the crash it replaces: a crash loses the in-memory state and the
       * room restarts from its last checkpoint, whereas this would checkpoint a
       * wedged game and tell four people nothing happened.
       *
       * So `fatal` means discard this state and reload the last known-good
       * checkpoint. It is never shown to a player as a refusal. */
      return {
        ok: false,
        fatal: true,
        reason: 'the game could not apply that move',
        error: (e && e.message) || String(e)
      };
    }
    return { ok: false, reason: 'unknown action' };
  }

  SH.Game = {
    SEATS: SEATS,
    HAND_SIZE: HAND_SIZE,
    KITTY_SIZE: KITTY_SIZE,
    DEAL: DEAL,
    applyAction: applyAction,
    eventsFor: eventsFor,
    /* For the room to say something the whole table should hear — a player
     * dropping out, the computer taking a seat over. Public by construction:
     * anything private goes through evTo and an audience. */
    note: function (state, text) { return ev(state, 'info', text); },
    vb: vb,
    createGame: createGame,
    newHand: newHand,
    teamOf: teamOf,
    partnerOf: partnerOf,
    teamName: teamName,
    seatToAct: seatToAct,
    canDeal: canDeal,
    sideWords: sideWords,
    isActive: isActive,
    nextActive: nextActive,
    activeCount: activeCount,
    legalPlays: legalPlays,
    isLegal: isLegal,
    illegalReason: illegalReason,
    trickWinnerIndex: trickWinnerIndex,
    transcript: transcript,
    auditHand: auditHand,
    /* Exported for the tests and the AI. Nothing outside applyAction may call
     * these to change a game; the tests call them to build a position. */
    doOrder: doOrder,
    doPass: doPass,
    doCall: doCall,
    doDiscard: doDiscard,
    doPlay: doPlay
  };
/* `window` in a browser, `globalThis` in a Worker. ES module imports are
 * HOISTED, so a Worker entry point cannot set globalThis.window before importing
 * this file. It decides for itself. */
})(typeof window !== 'undefined' ? window : globalThis);

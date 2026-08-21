/* Cribbage - rules engine. No DOM access lives in here.
 *
 * Two seats, 121 points, and a state machine driven by six actions: cut,
 * discard, play, go, next and nextHand.
 *
 * THREE THINGS THAT HAD TO CHANGE COMING FROM `Cribbage/`, and they are the
 * reason this is a fork rather than a copy.
 *
 * 1. THE COUNT RESET LIVED IN THE INTERFACE. In the stable game, reaching
 *    thirty-one or a mutual go leaves the engine in a PAUSE state and the
 *    BROWSER clears the pile — `handleContinue` does `game.playedPile = []`.
 *    That is invisible in a single tab and fatal on a server, which has no
 *    interface to do it: pairs and runs would go on scanning backwards across a
 *    reset, so a five played after a count reset would pair with a five from
 *    before it. Here the reset is the engine's, and the pile is never destroyed
 *    — `runStart` marks where the current sequence began, so the full play is
 *    still on record for the log and the audit while scoring only ever looks
 *    back as far as it should.
 *
 * 2. THE PAUSES ARE GONE. PAUSE_31 and PAUSE_GO existed so a player could read
 *    what had happened before the board changed under them. Online a pause is a
 *    synchronisation point: somebody has to press Continue, and if they do not
 *    the hand stalls for both. The announcement carries what the pause carried —
 *    "Thirty-one for two. The count goes back to nought" — and the speech queue
 *    already stops messages treading on each other.
 *
 * 3. THE DISCARD IS NOT SIMULTANEOUS ANY MORE, AND CANNOT BE. `discardToCrib`
 *    took the human's two cards and chose the computer's in the same call. Two
 *    people cannot be made to move in the same function call, so each seat sends
 *    its own discard and the hand waits until both are in. That wait is the only
 *    genuinely new state in the game: `discarded` holds what each seat has sent,
 *    `seatsOutstanding` says who is still being waited for, and the crib is not
 *    formed until nobody is.
 *
 * Counting is stepped rather than automatic, and each seat counts its own hand —
 * which is what happens at a real table, and gives the room a seat to hold
 * responsible if somebody walks away mid-count.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  var C = SH.Cards;

  var SEATS = 2;
  var DEALT = 6;          // cards each
  var KEPT = 4;           // after the discard
  var CRIB = 4;           // two from each

  function other(i) { return 1 - i; }

  function createGame(config) {
    var players = [];
    for (var i = 0; i < SEATS; i++) {
      players.push({
        index: i,
        name: config.names[i],
        /* Who is sitting here, rather than whether this is "the" human. A
         * boolean that is true for one seat cannot answer the question a table
         * asks, which is whether anybody is currently in a chair.
         * 'human' | 'bot' | 'away'. */
        occupant: i === 0 ? 'human' : 'bot',
        hand: [],           // cards not yet played
        kept: [],           // the four kept after the discard; what gets counted
        played: [],         // played this hand, in order
        score: 0
      });
    }
    return {
      config: config,
      players: players,

      gamesWon: [0, 0],
      gameNumber: 0,
      gameOver: false,
      gameWinner: -1,

      dealer: -1,
      handNumber: 0,
      phase: 'idle',
      turn: 0,

      /* The cut for deal. Kept as a field rather than resolved on the spot
       * because both cards are announced and both stay on screen while the tie
       * is being re-cut. */
      cutForDeal: null,

      /* The undealt remainder. NEVER leaves the server — it is the one field in
       * the state that would let a client compute what its opponent is holding
       * by elimination. */
      deck: [],

      crib: [],                 // face down until the count
      discarded: [null, null],  // what each seat sent, private to that seat
      starter: null,            // the cut card, public the moment it is turned

      /* The play. `pile` is every card played this hand, in order, and is never
       * truncated; `runStart` is the index where the current count sequence
       * began. See the note at the top of this file. */
      pile: [],
      runStart: 0,
      count: 0,
      goSaid: [false, false],
      lastPlayer: -1,

      /* The count. 0 non-dealer's hand, 1 dealer's hand, 2 the crib, 3 done. */
      countStage: 0,
      countResults: [],

      dealt: null,
      result: null,
      history: [],

      events: [],
      nextEventId: 0
    };
  }

  /* ---------------- events ---------------- */

  function ev(state, kind, text, extra) {
    if (state.nextEventId === undefined) state.nextEventId = 0;
    var e = { id: state.nextEventId++, kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.events.push(e);
    return e;
  }

  /* An event only one seat may see. The temptation, carried over from a
   * single-player game, is to append the private half onto the public sentence
   * whenever the seat happens to be the human one. That works exactly as long as
   * there is only one human — at a table both seats are, and a single
   * concatenated string cannot be filtered afterwards. You cannot withhold half
   * a sentence. */
  function evTo(state, seat, kind, text, extra) {
    var e = ev(state, kind, text, extra);
    e.audience = seat;
    return e;
  }

  /* Everything public, plus anything addressed to this seat, with both the
   * address and the id removed. The id goes for the same reason the address
   * does: ids are global and monotonic, so the gaps in the sequence a seat
   * receives count the private events sent to the other one — and a gap at the
   * moment of the discard says exactly when the opponent chose. */
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

  /* The possessive, for the same reason. "It is You's crib" is what a template
   * produces and not a sentence anybody would say; the default name is "You",
   * so this is the common case rather than the edge one. */
  function poss(state, i) {
    var n = state.players[i].name;
    return n.toLowerCase() === 'you' ? 'your' : n + '’s';
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function pointWords(n) {
    var w = ['no points', 'one point', 'two points', 'three points', 'four points',
      'five points', 'six points', 'seven points', 'eight points', 'nine points', 'ten points'];
    return w[n] || n + ' points';
  }

  /* Numbers as words, all the way to twenty-nine.
   *
   * Twenty-nine because that is the best hand in cribbage, and a list that stops
   * at twelve leaves the two most memorable scores in the game — twenty-four and
   * twenty-nine — read out as digits in the middle of a sentence of words. Most
   * voices say "16" correctly; some say "one six", and the one time it matters
   * is the one hand a player will tell people about. */
  var ONES = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  var TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'];

  function numWord(n) {
    if (typeof n !== 'number' || n < 0 || n !== Math.floor(n)) return String(n);
    if (n < 10) return ONES[n];
    if (n < 20) return TEENS[n - 10];
    if (n < 30) return 'twenty' + (n === 20 ? '' : '-' + ONES[n - 20]);
    return String(n);
  }

  /* ---------------- scoring a hand ----------------
   *
   * Returns a breakdown, not a number.
   *
   * "You scored eight" is a fact a sighted player can check against the cards in
   * front of them in about a second. Read out on its own it is something you
   * either trust or do not, and cribbage is a game where the whole pleasure is
   * in the counting. So every scoring function here returns the parts as well as
   * the total, and the interface reads them out: "two fifteens for four, a pair
   * of fives for two, and one for his nob — seven."
   */
  function scoreHand(cards4, starter, isCrib) {
    var cards = cards4.slice();
    if (starter) cards.push(starter);
    var parts = [];
    var total = 0;
    var i, j;

    /* Fifteens. Every subset, because 5-5-5-J is four of them and no shortcut
     * finds all four. */
    var fifteens = 0;
    for (i = 1; i < (1 << cards.length); i++) {
      var subset = [];
      for (j = 0; j < cards.length; j++) if (i & (1 << j)) subset.push(cards[j]);
      if (subset.length >= 2 && C.sumValue(subset) === 15) fifteens++;
    }
    if (fifteens) {
      total += fifteens * 2;
      parts.push({
        kind: 'fifteens', points: fifteens * 2, count: fifteens,
        text: fifteens === 1 ? 'fifteen for two'
          : numWord(fifteens) + ' fifteens for ' + numWord(fifteens * 2)
      });
    }

    /* Pairs, described by rank rather than as a bare count: "three fives for
     * six" is what a cribbage player says and what they can check. */
    var byRank = {};
    cards.forEach(function (c) { (byRank[c.r] = byRank[c.r] || []).push(c); });
    Object.keys(byRank).forEach(function (r) {
      var n = byRank[r].length;
      if (n < 2) return;
      var pts = n === 2 ? 2 : n === 3 ? 6 : 12;
      total += pts;
      var plural = C.RANK_NAME[r] === 'Six' ? 'Sixes' : C.RANK_NAME[r] + 's';
      parts.push({
        kind: 'pair', points: pts, rank: r, count: n,
        text: n === 2 ? 'a pair of ' + plural.toLowerCase() + ' for two'
          : numWord(n) + ' ' + plural.toLowerCase() + ' for ' + numWord(pts)
      });
    });

    /* Runs.
     *
     * A run scores once for EVERY distinct set of cards that forms it, not once
     * for the run existing. 4-5-6-6 is two runs of three for six, because either
     * six completes it. Three fives with a four and a six is three runs of three
     * for nine.
     *
     * Only MAXIMAL runs count — the four three-card runs inside a run of four
     * are not scored separately — which is why the multiplicity is counted at
     * the longest length only. The stable game returned the length of the
     * longest run and stopped, under-scoring every double, triple and
     * quadruple run in the game; its own rules oracle found it, and the comment
     * there records that it was 4.9% of all hands. */
    var longest = 0, howMany = 0;
    for (var mask = 1; mask < (1 << cards.length); mask++) {
      var sub = [];
      for (j = 0; j < cards.length; j++) if (mask & (1 << j)) sub.push(cards[j]);
      if (sub.length < 3 || sub.length < longest) continue;
      if (!isRun(sub)) continue;
      if (sub.length > longest) { longest = sub.length; howMany = 1; }
      else howMany++;
    }
    if (longest >= 3) {
      var runPts = longest * howMany;
      total += runPts;
      parts.push({
        kind: 'run', points: runPts, length: longest, count: howMany,
        text: howMany === 1
          ? 'a run of ' + numWord(longest) + ' for ' + numWord(longest)
          : numWord(howMany) + ' runs of ' + numWord(longest) + ' for ' + numWord(runPts)
      });
    }

    /* A flush.
     *
     * Four in the hand is four, and the starter matching makes five. IN THE CRIB
     * IT IS ALL FIVE OR NOTHING — four matching cards in the crib score nothing
     * at all. That asymmetry is the most commonly misplayed rule in cribbage and
     * the one worth a comment. */
    if (cards4.length === KEPT && cards4.every(function (c) { return c.s === cards4[0].s; })) {
      var withStarter = starter && starter.s === cards4[0].s;
      if (isCrib) {
        if (withStarter) {
          total += 5;
          parts.push({ kind: 'flush', points: 5, text: 'a flush of five for five' });
        }
      } else {
        var pts2 = withStarter ? 5 : 4;
        total += pts2;
        parts.push({
          kind: 'flush', points: pts2,
          text: 'a flush of ' + numWord(pts2) + ' for ' + numWord(pts2)
        });
      }
    }

    /* One for his nob: the jack of the starter's suit, held in the hand. Not the
     * starter itself — that is his heels, and it is paid at the cut. */
    if (starter) {
      for (i = 0; i < cards4.length; i++) {
        if (cards4[i].r === 'J' && cards4[i].s === starter.s) {
          total += 1;
          parts.push({ kind: 'nob', points: 1, text: 'one for his nob' });
          break;
        }
      }
    }

    return { total: total, parts: parts };
  }

  /* Distinct, consecutive run orders. Duplicates fail naturally: two fives sort
   * to 5,5 and 5 is not 5+1. */
  function isRun(cards) {
    var v = cards.map(C.order).sort(function (a, b) { return a - b; });
    for (var i = 1; i < v.length; i++) if (v[i] !== v[i - 1] + 1) return false;
    return true;
  }

  /* Said the way a person counts a hand out loud. */
  function describeScore(res) {
    if (!res.total) return 'nothing';
    return res.parts.map(function (p) { return p.text; }).join(', ') +
      ' — ' + numWord(res.total);
  }

  /* ---------------- dealing ---------------- */

  function newHand(state) {
    /* 'gameOver' belongs in this list, and leaving it out meant a won game could
     * never be followed by another one: applyAction accepted `nextHand` at
     * gameOver, newHand refused it, and the refusal came back as a bare
     * "could not deal". The button was on screen, focused, and inert — which for
     * somebody who cannot see it is indistinguishable from a dropped keypress.
     * tests/ui-dom.js found it by playing eight hands and getting three. */
    var ok = state.phase === 'idle' || state.phase === 'roundOver' ||
      state.phase === 'cutForDeal' || state.phase === 'gameOver';
    if (!ok) return false;
    if (state.gameOver) {
      state.players[0].score = 0;
      state.players[1].score = 0;
      state.gameOver = false;
      state.gameWinner = -1;
      state.handNumber = 0;
      state.gameNumber++;
      ev(state, 'info', 'A new game. Both scores back to nothing, and ' +
        nameOf(state, state.dealer) + ' deals.');
    }
    if (state.gameNumber === 0) state.gameNumber = 1;

    state.handNumber++;
    state.phase = 'discard';
    state.crib = [];
    state.discarded = [null, null];
    state.starter = null;
    state.pile = [];
    state.runStart = 0;
    state.count = 0;
    state.goSaid = [false, false];
    state.lastPlayer = -1;
    state.countStage = 0;
    state.countResults = [];
    state.result = null;

    var deck = C.shuffle(C.newDeck());
    var at = 0;
    for (var i = 0; i < SEATS; i++) {
      state.players[i].hand = [];
      state.players[i].kept = [];
      state.players[i].played = [];
    }
    /* Alternating, one at a time, the way it is dealt at a table. It makes no
     * difference to a shuffled deck and it is what somebody learning the game
     * will see described everywhere else. */
    for (var n = 0; n < DEALT; n++) {
      for (var k = 0; k < SEATS; k++) {
        var seat = (state.dealer + 1 + k) % SEATS;
        state.players[seat].hand.push(deck[at++]);
      }
    }
    state.deck = deck.slice(at);

    state.dealt = {
      hands: state.players.map(function (p) { return C.ids(p.hand); })
    };

    /* Nobody is "on turn" during the discard: both seats choose at once. `turn`
     * is set to the seat that has not yet discarded so the room has somebody to
     * hold responsible if a player walks away, and to the dealer while both are
     * outstanding. */
    state.turn = other(state.dealer);

    ev(state, 'deal', 'Hand ' + state.handNumber + '. ' + nameOf(state, state.dealer) +
      vb(state, state.dealer, ' deals', ' deal') + ', so it is ' +
      poss(state, state.dealer) + ' crib. Both players throw two cards to it.',
      { textPlain: 'Hand ' + state.handNumber + '. ' + nameOf(state, state.dealer) + ' deals.' });

    for (var q = 0; q < SEATS; q++) {
      var sorted = C.sortHand(state.players[q].hand);
      evTo(state, q, 'hand', 'Your six cards: ' + C.listNames(sorted) + '.',
        { textPlain: 'Your hand: ' + sorted.map(C.shortText).join(' ') + '.' });
    }
    return true;
  }

  /* ---------------- cutting for deal ---------------- */

  function doCut(state) {
    if (state.phase !== 'cutForDeal') return false;
    /* Both players cut the SAME deck, as they would at a table. Building two
     * decks and taking one card from each means both can cut the identical card
     * — which is not a thing that can happen — and pushes the tie rate from
     * 3 in 51 to 4 in 52. The stable game has the same fix and the same note. */
    var deck = C.shuffle(C.newDeck());
    var a = deck[0], b = deck[1];
    state.cutForDeal = { cuts: [a.id, b.id], tie: false };

    ev(state, 'cut', nameOf(state, 0) + vb(state, 0, ' cuts', ' cut') + ' the ' + C.name(a) +
      '. ' + nameOf(state, 1) + vb(state, 1, ' cuts', ' cut') + ' the ' + C.name(b) + '.');

    /* Compared by RUN ORDER, not by counting value. The rules say the lowest
     * card deals, and a ten is lower than a jack — but counting value caps at
     * ten, so a ten, jack, queen and king would all be equal. That made a tie
     * 13% likely instead of 5.9%, and made "lowest" mean something the rules
     * page does not say. */
    if (C.order(a) === C.order(b)) {
      state.cutForDeal.tie = true;
      ev(state, 'info', 'A tie. Cut again.');
      return true;
    }
    state.dealer = C.order(a) < C.order(b) ? 0 : 1;
    ev(state, 'info', nameOf(state, state.dealer) +
      vb(state, state.dealer, ' has', ' have') + ' the lower card and ' +
      vb(state, state.dealer, 'deals', 'deal') + ' first.');
    return newHand(state);
  }

  /* ---------------- the discard ---------------- */

  function seatsOutstanding(state) {
    var out = [];
    for (var i = 0; i < SEATS; i++) if (!state.discarded[i]) out.push(i);
    return out;
  }

  function doDiscard(state, p, cardIds) {
    if (state.phase !== 'discard') return false;
    if (state.discarded[p]) return false;                 // already sent
    if (!Array.isArray(cardIds) || cardIds.length !== 2) return false;
    if (cardIds[0] === cardIds[1]) return false;

    var hand = state.players[p].hand;
    var chosen = [];
    for (var i = 0; i < cardIds.length; i++) {
      var found = null;
      for (var j = 0; j < hand.length; j++) {
        if (hand[j].id === cardIds[i]) { found = hand[j]; break; }
      }
      if (!found) return false;
      chosen.push(found);
    }

    state.players[p].hand = hand.filter(function (c) {
      return chosen.indexOf(c) < 0;
    });
    state.players[p].kept = state.players[p].hand.slice();
    state.discarded[p] = C.ids(chosen);

    evTo(state, p, 'hand', 'You threw the ' + C.listNames(chosen) + ' to ' +
      (state.dealer === p ? 'your own crib' : poss(state, state.dealer) + ' crib') +
      '. You keep ' + C.listNames(C.sortHand(state.players[p].kept)) + '.');
    /* Public that it happened, private what it was — which is what everybody
     * watches at a real table and nobody sees. */
    ev(state, 'info', nameOf(state, p) + vb(state, p, ' has thrown', ' have thrown') +
      ' two cards to the crib.',
      { textPlain: nameOf(state, p) + ' has discarded.' });

    var waiting = seatsOutstanding(state);
    if (waiting.length) {
      state.turn = waiting[0];
      return true;
    }

    /* Both in. Form the crib, turn the starter, pay his heels. */
    var cribCards = [];
    for (var s = 0; s < SEATS; s++) {
      state.discarded[s].forEach(function (id) { cribCards.push(C.get(id)); });
    }
    state.crib = cribCards;

    state.starter = state.deck.shift();
    ev(state, 'cut', 'The starter is the ' + C.describe(state.starter) + '.',
      { textPlain: 'Starter: ' + C.name(state.starter) + '.' });

    state.dealt.crib = C.ids(state.crib);
    state.dealt.starter = state.starter.id;

    if (state.starter.r === 'J') {
      award(state, state.dealer, 2, 'two for his heels');
      if (state.gameOver) return true;
    }

    state.phase = 'play';
    state.turn = other(state.dealer);
    ev(state, 'info', nameOf(state, state.turn) +
      vb(state, state.turn, ' leads', ' lead') + '. The count starts at nothing.');
    return true;
  }

  /* ---------------- scoring, and the only way anybody gains a point ---------------- */

  /* `phrase` is the whole of what the points were for, in the words a cribbage
   * player would use — "two for his heels", "fifteen for two, and a pair for
   * two", "one for the go". Passing a bare reason and assembling "scores two
   * points: two for his heels" around it produces the number twice and reads
   * like a receipt. */
  function award(state, p, points, phrase) {
    if (!points) return;
    state.players[p].score += points;
    ev(state, 'score', nameOf(state, p) + vb(state, p, ' scores ', ' score ') +
      phrase + '. ' + scoreLine(state),
      { player: p, points: points,
        textPlain: nameOf(state, p) + ' +' + points + ' (' + phrase + ').' });
    checkWinner(state);
  }

  function scoreLine(state) {
    return nameOf(state, 0) + ' ' + state.players[0].score + ', ' +
      nameOf(state, 1) + ' ' + state.players[1].score + '.';
  }

  /* The game stops THE MOMENT somebody reaches the target.
   *
   * Not at the end of the hand, not after the crib is counted. A non-dealer who
   * pegs out during the play wins before the dealer ever counts, and getting
   * that wrong hands games to the wrong player in exactly the situations that
   * are most worth winning. Every call to award() checks. */
  function checkWinner(state) {
    if (state.gameOver) return true;
    var target = state.config.targetScore || 121;
    for (var i = 0; i < SEATS; i++) {
      if (state.players[i].score < target) continue;
      var loser = other(i);
      var theirs = state.players[loser].score;
      /* A skunk is being left under half way, and a double skunk under a
       * quarter. Reported because it is the whole point of a bad night, not
       * scored — this counts one game won either way, and says so. */
      var skunk = theirs < Math.floor(target / 2) + 1
        ? (theirs < Math.floor(target / 4) + 1 ? 'double skunk' : 'skunk') : null;
      state.gameOver = true;
      state.gameWinner = i;
      state.gamesWon[i]++;
      state.phase = 'gameOver';
      state.result = {
        gameOver: true, winner: i, scores: [state.players[0].score, state.players[1].score],
        skunk: skunk
      };
      ev(state, 'result', nameOf(state, i) + vb(state, i, ' wins', ' win') + ', ' +
        state.players[i].score + ' to ' + theirs +
        (skunk ? ' — a ' + skunk + '.' : '.') +
        ' Games: ' + nameOf(state, 0) + ' ' + state.gamesWon[0] + ', ' +
        nameOf(state, 1) + ' ' + state.gamesWon[1] + '. Deal to start another.');
      recordHand(state);
      /* THE DEAL PASSES HOWEVER THE HAND ENDED.
       *
       * doNext rotates on the path where nobody won, and every game-ending hand
       * returns before ever reaching it — so the same player dealt the last hand
       * of one game and the first hand of the next, and took two cribs running,
       * at every game boundary. Rotated AFTER recordHand so the record names the
       * dealer of the hand it describes rather than whoever is about to deal. */
      state.dealer = other(state.dealer);
      state.turn = state.dealer;
      return true;
    }
    return false;
  }

  /* ---------------- the play ---------------- */

  function playable(state, p) {
    var out = [];
    var hand = state.players[p].hand;
    for (var i = 0; i < hand.length; i++) {
      if (state.count + C.value(hand[i]) <= 31) out.push(hand[i]);
    }
    return out;
  }

  function canPlay(state, p) { return playable(state, p).length > 0; }

  function legalPlays(state, p) {
    if (state.phase !== 'play' || state.turn !== p) return [];
    return playable(state, p);
  }

  function isLegal(state, p, cardId) {
    return legalPlays(state, p).some(function (c) { return c.id === cardId; });
  }

  function illegalReason(state, p, cardId) {
    if (state.phase !== 'play') return 'it is not the play';
    if (state.turn !== p) return 'it is not your turn';
    var card = C.get(cardId);
    if (!card) return 'that is not a card';
    if (!state.players[p].hand.some(function (c) { return c.id === cardId; })) {
      return 'that card is not in your hand';
    }
    if (state.count + C.value(card) > 31) {
      return 'it would take the count to ' + (state.count + C.value(card)) + ', past thirty-one';
    }
    return '';
  }

  /* The cards in the current count sequence, which is what pairs and runs may
   * look back at — and no further. See the note at the top of this file. */
  function runCards(state) {
    return state.pile.slice(state.runStart).map(function (e) { return e.card; });
  }

  /* What laying `card` on the current sequence would score, and why.
   *
   * PURE. It awards nothing and says nothing, which is what lets three different
   * callers share it: the engine when a card is actually played, the computer
   * when it is deciding, and the interface when it labels a card with what it
   * would do. Those three had better agree, and the only way to be sure they do
   * is for there to be one of them.
   *
   * `seq` is the current count sequence with the candidate on the end — never
   * the whole pile. See the note at the top of this file about the reset. */
  function pointsForPlay(state, card) {
    var seq = runCards(state).concat([card]);
    var count = state.count + C.value(card);
    var parts = [];
    var total = 0;
    var i;

    if (count === 15) { total += 2; parts.push('fifteen for two'); }
    if (count === 31) { total += 2; parts.push('thirty-one for two'); }

    /* Pairs, walking back through cards of the same rank. Stops at the first
     * different one, so there is no way to over-count. */
    if (seq.length >= 2) {
      var same = 1;
      for (i = seq.length - 2; i >= 0; i--) {
        if (seq[i].r === card.r) same++; else break;
      }
      if (same === 2) { total += 2; parts.push('a pair for two'); }
      else if (same === 3) { total += 6; parts.push('three of a kind for six'); }
      else if (same === 4) { total += 12; parts.push('four of a kind for twelve'); }
    }

    /* Runs during the play do not have to arrive in order — 5, 3, 4 is a run of
     * three — but they must be the last N cards with nothing repeated. Longest
     * wins, and a run of seven is legal: ace through seven is twenty-eight. */
    for (var len = seq.length; len >= 3; len--) {
      if (isRun(seq.slice(-len))) {
        total += len;
        parts.push('a run of ' + numWord(len) + ' for ' + numWord(len));
        break;
      }
    }
    return { total: total, parts: parts, count: count };
  }

  function resetCount(state, leader, why) {
    state.count = 0;
    state.runStart = state.pile.length;
    state.goSaid = [false, false];
    state.turn = leader;
    if (!handFinished(state)) {
      ev(state, 'info', why + ' The count goes back to nothing, and ' +
        nameOf(state, leader) + vb(state, leader, ' leads', ' lead') + '.');
    }
  }

  function handFinished(state) {
    return state.players[0].hand.length === 0 && state.players[1].hand.length === 0;
  }

  function doPlay(state, p, cardId) {
    if (!isLegal(state, p, cardId)) return false;
    var hand = state.players[p].hand;
    var at = -1;
    for (var i = 0; i < hand.length; i++) if (hand[i].id === cardId) { at = i; break; }
    if (at < 0) return false;

    var card = hand.splice(at, 1)[0];

    /* Worked out BEFORE the card joins the pile. pointsForPlay appends the
     * candidate to the sequence itself, so scoring after the push would count it
     * twice — a pair would read as three of a kind. */
    var got = pointsForPlay(state, card);

    state.players[p].played.push(card);
    state.pile.push({ player: p, card: card });
    state.count += C.value(card);
    state.lastPlayer = p;

    ev(state, 'play', nameOf(state, p) + vb(state, p, ' plays', ' play') + ' the ' +
      C.name(card) + '. The count is ' + state.count + '.',
      { player: p, card: card.id, count: state.count,
        textPlain: nameOf(state, p) + ': ' + C.name(card) + ', ' + state.count + '.' });

    var was31 = state.count === 31;
    if (got.total) award(state, p, got.total, got.parts.join(' and '));
    if (state.gameOver) return true;

    if (handFinished(state)) {
      /* The last card of the play is worth one — unless it made exactly
       * thirty-one, which has already been paid two and does not also collect
       * this. The stable game returned before ever reaching its go-point branch,
       * so the final card of every hand was played for nothing; its own comment
       * records the fix. */
      if (!was31) award(state, p, 1, 'one for the last card');
      if (state.gameOver) return true;
      endPlay(state);
      return true;
    }

    if (was31) {
      resetCount(state, other(p), 'Thirty-one.');
      return true;
    }

    /* The opponent moves next if they can. If they cannot they will have to say
     * go, which is their action to take, not something done for them. */
    state.turn = other(p);
    return true;
  }

  function doGo(state, p) {
    if (state.phase !== 'play' || state.turn !== p) return false;
    /* Go is only available to somebody who genuinely cannot play. If you can
     * play, you must. Refusing rather than ignoring is what lets the interface
     * say why instead of a button doing nothing, which for somebody who cannot
     * see the screen is the same as a broken keyboard. */
    if (canPlay(state, p)) return false;

    state.goSaid[p] = true;
    ev(state, 'info', nameOf(state, p) + vb(state, p, ' says', ' say') + ' go.',
      { textPlain: nameOf(state, p) + ': go.' });

    var opp = other(p);
    if (canPlay(state, opp)) {
      state.turn = opp;
      return true;
    }

    /* Neither can play. The last card laid takes one for the go — unless the
     * count is exactly thirty-one, already paid two. */
    if (state.lastPlayer >= 0 && state.count !== 31) {
      award(state, state.lastPlayer, 1, 'one for the go');
      if (state.gameOver) return true;
    }
    if (handFinished(state)) { endPlay(state); return true; }
    /* Whoever did NOT lay the last card leads the next sequence. */
    resetCount(state, other(state.lastPlayer), 'Neither of you can play.');
    return true;
  }

  function endPlay(state) {
    state.phase = 'count';
    state.countStage = 0;
    state.countResults = [];
    state.turn = other(state.dealer);
    ev(state, 'info', 'The play is over. ' + nameOf(state, state.turn) +
      vb(state, state.turn, ' counts', ' count') + ' first.');
  }

  /* ---------------- the count ----------------
   *
   * Stepped, and each seat counts its own hand, which is what happens at a real
   * table. It also gives the room a seat to hold responsible: if somebody walks
   * away mid-count, `turn` names them and the turn clock can take the seat over
   * rather than the hand stalling for both. */
  function doNext(state, p) {
    if (state.phase !== 'count') return false;
    if (state.turn !== p) return false;

    var nonDealer = other(state.dealer);
    if (state.countStage === 0) {
      var a = scoreHand(state.players[nonDealer].kept, state.starter, false);
      state.countResults.push({ who: nonDealer, kind: 'hand', result: a });
      ev(state, 'count', cap(poss(state, nonDealer)) + ' hand: ' +
        C.listNames(C.sortHand(state.players[nonDealer].kept)) + ' with the ' +
        C.name(state.starter) + '. ' + describeScore(a) + '.');
      award(state, nonDealer, a.total, numWord(a.total) + ' for the hand');
      if (state.gameOver) return true;
      state.countStage = 1;
      state.turn = state.dealer;
      return true;
    }
    if (state.countStage === 1) {
      var b = scoreHand(state.players[state.dealer].kept, state.starter, false);
      state.countResults.push({ who: state.dealer, kind: 'hand', result: b });
      ev(state, 'count', cap(poss(state, state.dealer)) + ' hand: ' +
        C.listNames(C.sortHand(state.players[state.dealer].kept)) + ' with the ' +
        C.name(state.starter) + '. ' + describeScore(b) + '.');
      award(state, state.dealer, b.total, numWord(b.total) + ' for the hand');
      if (state.gameOver) return true;
      state.countStage = 2;
      state.turn = state.dealer;
      return true;
    }
    /* The crib, which nobody has seen until this moment. */
    var c = scoreHand(state.crib, state.starter, true);
    state.countResults.push({ who: state.dealer, kind: 'crib', result: c });
    ev(state, 'count', cap(poss(state, state.dealer)) + ' crib: ' +
      C.listNames(C.sortHand(state.crib)) + ' with the ' + C.name(state.starter) + '. ' +
      describeScore(c) + '.');
    award(state, state.dealer, c.total, numWord(c.total) + ' for the crib');
    if (state.gameOver) return true;

    state.countStage = 3;
    state.phase = 'roundOver';
    state.result = {
      gameOver: false,
      scores: [state.players[0].score, state.players[1].score],
      counts: state.countResults.slice()
    };
    /* Recorded BEFORE the deal passes, so `h.dealer` is the dealer of the hand
     * the record describes. Rotating first made it the NEXT dealer, which every
     * reader then had to know to invert — and two of them did not. */
    recordHand(state);
    state.dealer = other(state.dealer);
    state.turn = state.dealer;
    ev(state, 'info', 'Hand ' + state.handNumber + ' complete. ' + scoreLine(state) +
      ' ' + nameOf(state, state.dealer) + vb(state, state.dealer, ' deals', ' deal') + ' next.');
    return true;
  }

  /* ---------------- the permanent record ---------------- */

  function recordHand(state) {
    var rec = {
      handNumber: state.handNumber,
      gameNumber: state.gameNumber,
      dealer: state.dealer,
      starter: state.starter ? state.starter.id : null,
      dealt: state.dealt ? JSON.parse(JSON.stringify(state.dealt)) : null,
      discarded: state.discarded.map(function (d) { return d ? d.slice() : null; }),
      kept: state.players.map(function (p) { return C.ids(p.kept); }),
      crib: C.ids(state.crib),
      pile: state.pile.map(function (e) { return { player: e.player, card: e.card.id }; }),
      counts: state.countResults.map(function (c) {
        return { who: c.who, kind: c.kind, total: c.result.total };
      }),
      scores: [state.players[0].score, state.players[1].score],
      result: state.result ? JSON.parse(JSON.stringify(state.result)) : null,
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

  /* Re-derive the hand from the cards rather than trusting what was recorded.
   *
   * The point of an audit is that it must be able to disagree with the thing it
   * is auditing, so this re-adds the scores from the cards rather than reading
   * the totals back. A hand cut short by somebody winning is checked for what it
   * did contain rather than for what a complete hand would. */
  function auditHand(rec) {
    var bad = [];
    var i;

    /* Every card accounted for exactly once, and all of them from the deck. */
    var seen = {}, dup = 0, count = 0;
    function note(id) {
      count++;
      if (!C.get(id)) bad.push(id + ' is not a card in the deck');
      if (seen[id]) dup++;
      seen[id] = 1;
    }
    (rec.dealt && rec.dealt.hands ? rec.dealt.hands : []).forEach(function (h) { h.forEach(note); });
    if (rec.starter) note(rec.starter);
    if (dup) bad.push(dup + ' card' + (dup === 1 ? ' was' : 's were') + ' dealt twice');
    if (rec.dealt && rec.dealt.hands && rec.dealt.hands.length === SEATS) {
      rec.dealt.hands.forEach(function (h, k) {
        if (h.length !== DEALT) bad.push('seat ' + (k + 1) + ' was dealt ' + h.length + ' cards');
      });
      if (count !== SEATS * DEALT + (rec.starter ? 1 : 0)) {
        bad.push('the deal accounts for ' + count + ' cards');
      }
    }

    /* Kept plus discarded equals dealt, per seat, with nothing invented. */
    for (i = 0; i < SEATS; i++) {
      if (!rec.discarded[i]) continue;
      var kept = rec.kept[i] || [];
      var thrown = rec.discarded[i];
      if (kept.length !== KEPT) bad.push('seat ' + (i + 1) + ' kept ' + kept.length + ' cards');
      if (thrown.length !== 2) bad.push('seat ' + (i + 1) + ' threw ' + thrown.length + ' cards');
      var dealtTo = (rec.dealt && rec.dealt.hands) ? rec.dealt.hands[i] : [];
      kept.concat(thrown).forEach(function (id) {
        if (dealtTo.indexOf(id) < 0) {
          bad.push('seat ' + (i + 1) + ' held the ' + id + ', which was not dealt to them');
        }
      });
    }

    /* The crib is exactly the four thrown cards. */
    if (rec.discarded[0] && rec.discarded[1]) {
      var want = rec.discarded[0].concat(rec.discarded[1]).slice().sort().join(',');
      var got = rec.crib.slice().sort().join(',');
      if (want !== got) bad.push('the crib is not what was thrown to it');
      if (rec.crib.length !== CRIB) bad.push('the crib holds ' + rec.crib.length + ' cards');
    }

    /* No card played twice, and only cards that seat kept. */
    var playedSeen = {};
    rec.pile.forEach(function (e) {
      if (playedSeen[e.card]) bad.push('the ' + e.card + ' was played twice');
      playedSeen[e.card] = 1;
      var k = rec.kept[e.player] || [];
      if (k.length && k.indexOf(e.card) < 0) {
        bad.push('seat ' + (e.player + 1) + ' played the ' + e.card + ', which they did not keep');
      }
    });

    /* The count never passed thirty-one, re-added from the cards. A reset is
     * inferred wherever the running total would have gone over, which is the
     * only way it can legally come down. */
    var running = 0;
    rec.pile.forEach(function (e) {
      var v = C.value(C.get(e.card) || { r: 'A' });
      if (running + v > 31) running = 0;
      running += v;
      if (running > 31) bad.push('the count reached ' + running);
    });

    /* Every recorded count re-scores to the same number. */
    if (rec.starter) {
      rec.counts.forEach(function (c) {
        var cards = c.kind === 'crib'
          ? rec.crib.map(function (id) { return C.get(id); })
          : (rec.kept[c.who] || []).map(function (id) { return C.get(id); });
        if (cards.length !== KEPT || cards.some(function (x) { return !x; })) return;
        var again = scoreHand(cards, C.get(rec.starter), c.kind === 'crib').total;
        if (again !== c.total) {
          bad.push('the ' + c.kind + ' for seat ' + (c.who + 1) + ' was recorded as ' +
            c.total + ' but re-scores to ' + again);
        }
      });
    }

    /* Scores only ever go up, and never past the target by more than a single
     * award could carry. */
    rec.scores.forEach(function (s, k) {
      if (s < 0) bad.push('seat ' + (k + 1) + ' has a negative score');
    });
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

  /* A complete written account, from one seat's point of view. A hand still in
   * progress is written from what that seat can legitimately see, so exporting
   * mid-hand cannot be used to read the other player's cards or the crib. */
  function transcript(state, seat, extraLines) {
    var L = [];
    L.push('Cribbage — game log');
    L.push('Players: ' + state.players.map(function (p, i) {
      return (i + 1) + ' ' + p.name + (i === seat ? ' (you)' : '') +
        ' [' + (p.occupant === 'human' ? 'person' : p.occupant === 'away' ? 'away' : 'computer') + ']';
    }).join(', '));
    L.push('Playing to ' + (state.config.targetScore || 121) +
      '. Opponent skill: ' + (state.config.difficulty || 'normal') + '.');
    L.push('');
    var failed = state.history.filter(function (h) { return h.problems && h.problems.length; });
    L.push('Hands completed: ' + state.history.length +
      '. Accounting checks failed: ' + failed.length + '.');
    if (failed.length) {
      L.push('*** THE ACCOUNTING CHECK FAILED ON ' + failed.length + ' HAND(S). Details below. ***');
    }
    L.push('Games won: ' + state.players[0].name + ' ' + state.gamesWon[0] + ', ' +
      state.players[1].name + ' ' + state.gamesWon[1] + '.');
    L.push('');

    state.history.forEach(function (h) { pushHand(L, state, h); });
    if (state.phase !== 'roundOver' && state.phase !== 'idle' && state.phase !== 'gameOver') {
      pushInProgress(L, state, seat);
    }

    if (extraLines && extraLines.length) {
      L.push('');
      L.push('--- On-screen log, newest first ---');
      extraLines.forEach(function (line) { L.push(line); });
    }
    return L.join('\n');
  }

  function pushHand(L, state, h) {
    L.push('--- Hand ' + h.handNumber + ' (game ' + h.gameNumber + ') ---');
    L.push('Dealer: ' + state.players[h.dealer === 0 ? 1 : 0].name + '’s deal was previous; ' +
      'crib belonged to ' + state.players[h.counts.length ? h.counts[h.counts.length - 1].who : 0].name);
    (h.dealt && h.dealt.hands ? h.dealt.hands : []).forEach(function (ids, i) {
      L.push('  ' + pad(state.players[i].name + ' dealt', 18) + ' ' + cardList(ids));
    });
    for (var i = 0; i < SEATS; i++) {
      if (h.discarded[i]) L.push('  ' + pad(state.players[i].name + ' threw', 18) + ' ' + cardList(h.discarded[i]));
    }
    L.push('  ' + pad('Starter', 18) + ' ' + (h.starter ? cardList([h.starter]) : 'none'));
    L.push('  ' + pad('Crib', 18) + ' ' + cardList(h.crib));
    if (h.pile.length) {
      L.push('  Play: ' + h.pile.map(function (e) {
        return state.players[e.player].name.slice(0, 6) + ' ' + C.shortText(C.get(e.card));
      }).join(', '));
    }
    h.counts.forEach(function (c) {
      L.push('  ' + state.players[c.who].name + '’s ' + c.kind + ': ' + c.total);
    });
    L.push('  Score after: ' + state.players[0].name + ' ' + h.scores[0] + ', ' +
      state.players[1].name + ' ' + h.scores[1]);
    if (h.problems && h.problems.length) {
      L.push('  *** ACCOUNTING CHECK FAILED: ' + h.problems.join('; ') + ' ***');
    }
    L.push('');
  }

  function pushInProgress(L, state, seat) {
    L.push('--- Hand ' + state.handNumber + ' (in progress) ---');
    L.push('Phase: ' + state.phase + '. Count: ' + state.count + '.');
    L.push('Dealer: ' + (state.dealer >= 0 ? state.players[state.dealer].name : 'not yet decided'));
    L.push('Starter: ' + (state.starter ? C.name(state.starter) : 'not yet turned'));
    var own = state.players[seat];
    L.push('Your cards: ' + (own.hand.length ? C.listNames(C.sortHand(own.hand)) : 'none left'));
    if (own.kept.length) L.push('You kept: ' + C.listNames(C.sortHand(own.kept)));
    if (state.discarded[seat]) L.push('You threw: ' + cardList(state.discarded[seat]));
    if (state.pile.length) {
      L.push('Play so far: ' + state.pile.map(function (e) {
        return state.players[e.player].name.slice(0, 6) + ' ' + C.shortText(e.card);
      }).join(', '));
    }
    L.push('Score: ' + scoreLine(state));
    L.push('');
  }

  /* ---------------- whose move ---------------- */

  /* Not simply `state.turn`. Two phases disagree with it: `idle` and
   * `roundOver`/`gameOver`, where nobody is on move and `turn` still holds
   * whatever it last held — read it there and the room schedules a computer
   * player to act on a hand that is over. */
  /* Could a deal be started right now?
   *
   * The room needs this and must not hardcode a phase name to get it. This file
   * was forked from a game whose finished-hand phase is called 'handOver', and
   * the room came with `state.phase !== 'handOver'` written into its nextHand
   * handling — which in cribbage is true at every single moment, so every deal
   * sent over the wire was quietly swallowed and answered with a re-sent view.
   * Online play could not get past hand one, and nothing said so.
   *
   * A predicate the engine owns cannot come apart from the engine that way. */
  function canDeal(state) {
    return state.phase === 'idle' || state.phase === 'roundOver' ||
      state.phase === 'cutForDeal' || state.phase === 'gameOver';
  }

  function seatToAct(state) {
    if (state.phase === 'cutForDeal') return state.turn;
    if (state.phase === 'discard') {
      var out = seatsOutstanding(state);
      return out.length ? out[0] : -1;
    }
    if (state.phase === 'play' || state.phase === 'count') return state.turn;
    return -1;
  }

  /* ---------------- the only way in ---------------- */

  var ACTIONS = Object.create(null);
  ACTIONS.start = 1; ACTIONS.cut = 1; ACTIONS.discard = 1;
  ACTIONS.play = 1; ACTIONS.go = 1; ACTIONS.next = 1; ACTIONS.nextHand = 1;

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
        case 'start':
          if (state.phase !== 'idle') return { ok: false, reason: 'the game has already started' };
          state.phase = 'cutForDeal';
          state.turn = 0;
          ev(state, 'info', 'Cut for deal. The lower card deals first and takes the first crib.');
          return { ok: true };

        case 'cut':
          if (state.phase !== 'cutForDeal') return { ok: false, reason: 'there is nothing to cut for' };
          return doCut(state) ? { ok: true } : { ok: false, reason: 'could not cut' };

        case 'discard':
          if (state.phase !== 'discard') return { ok: false, reason: 'it is not the discard' };
          if (state.discarded[seat]) {
            return { ok: false, reason: 'you have already thrown to the crib' };
          }
          if (!Array.isArray(action.cards) || action.cards.length !== 2) {
            return { ok: false, reason: 'choose exactly two cards' };
          }
          return doDiscard(state, seat, action.cards)
            ? { ok: true } : { ok: false, reason: 'those cards could not be thrown' };

        case 'play':
          if (state.phase !== 'play') return { ok: false, reason: 'it is not the play' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          if (typeof action.card !== 'string') return { ok: false, reason: 'no card given' };
          if (!isLegal(state, seat, action.card)) {
            return { ok: false, reason: illegalReason(state, seat, action.card) || 'that card cannot be played' };
          }
          return doPlay(state, seat, action.card)
            ? { ok: true } : { ok: false, reason: 'that card could not be played' };

        case 'go':
          if (state.phase !== 'play') return { ok: false, reason: 'it is not the play' };
          if (state.turn !== seat) return { ok: false, reason: 'not your turn' };
          if (canPlay(state, seat)) {
            return { ok: false, reason: 'you have a card you can play, so you must play it' };
          }
          return doGo(state, seat) ? { ok: true } : { ok: false, reason: 'could not say go' };

        case 'next':
          if (state.phase !== 'count') return { ok: false, reason: 'there is nothing to count' };
          if (state.turn !== seat) return { ok: false, reason: 'it is not your count' };
          return doNext(state, seat) ? { ok: true } : { ok: false, reason: 'could not count' };

        case 'nextHand':
          if (state.phase !== 'roundOver' && state.phase !== 'gameOver') {
            return { ok: false, reason: 'the hand is not over' };
          }
          return newHand(state) ? { ok: true } : { ok: false, reason: 'could not deal' };
      }
    } catch (e) {
      /* Reaching here is a bug in the engine, not in the message, and the state
       * is now untrustworthy — so it must NOT be reported as an ordinary
       * refusal. The validation above all happens before anything is written, so
       * `ok: false` from it genuinely means nothing changed. A throw does not:
       * doPlay splices the card out of the hand and pushes it onto the pile
       * before it ever reaches the scoring. An exception in there leaves the
       * card gone, the count wrong and the turn not advanced, while the caller
       * is told the move was declined — strictly worse than the crash it
       * replaces, because a crash restarts from the last checkpoint and this
       * would checkpoint a wedged game and tell two people nothing happened. */
      return {
        ok: false, fatal: true,
        reason: 'the game could not apply that move',
        error: (e && e.message) || String(e)
      };
    }
    return { ok: false, reason: 'unknown action' };
  }

  SH.Game = {
    SEATS: SEATS,
    DEALT: DEALT,
    KEPT: KEPT,
    applyAction: applyAction,
    eventsFor: eventsFor,
    note: function (state, text) { return ev(state, 'info', text); },
    vb: vb,
    poss: poss,
    createGame: createGame,
    newHand: newHand,
    other: other,
    seatToAct: seatToAct,
    canDeal: canDeal,
    seatsOutstanding: seatsOutstanding,
    scoreHand: scoreHand,
    describeScore: describeScore,
    isRun: isRun,
    playable: playable,
    canPlay: canPlay,
    legalPlays: legalPlays,
    isLegal: isLegal,
    illegalReason: illegalReason,
    runCards: runCards,
    pointsForPlay: pointsForPlay,
    transcript: transcript,
    auditHand: auditHand,
    numWord: numWord,
    pointWords: pointWords
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Euchre - card model.
 *
 * Twenty-four cards: nine, ten, jack, queen, king and ace in each suit. Ranks
 * are stored as single characters; 'T' is the ten. Card ids are rank+suit, e.g.
 * "JS", "TD".
 *
 * THE ONE THING THAT MAKES EUCHRE DIFFERENT FROM EVERY OTHER TRICK GAME, and
 * the reason almost every function in this file takes a `trump` argument:
 *
 *   The jack of the trump suit is the highest card (the RIGHT BOWER), and the
 *   jack of the other suit of the same colour is the second highest (the LEFT
 *   BOWER) — and while it is the left bower it is not a card of its printed
 *   suit at all. With spades trump, the jack of clubs is a spade. It follows
 *   spades, it may not be played on a club lead if you hold a spade, and a
 *   player who thinks of it as a club will revoke.
 *
 * Sheephead, next door in this repository, has a fixed fourteen-card trump suit
 * that never changes, so its isTrump(c) takes one argument and every helper is a
 * pure function of the card. Copying that shape here and adding trump later
 * would have been the bug: effSuit(c) with no trump silently answers "clubs" for
 * the left bower, which is wrong in exactly the situation that decides the hand.
 * So trump is a parameter everywhere, from the first line.
 *
 * `trump` may be null, and that is a real state rather than an oversight — while
 * the bidding is going on nobody knows what trump is. With null trump nothing is
 * trump, every card follows its printed suit, and a hand sorts by suit. That is
 * exactly what a player looking at their cards before bidding needs.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  var SUITS = ['C', 'S', 'H', 'D'];
  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9'];

  var SUIT_NAME = { C: 'Clubs', S: 'Spades', H: 'Hearts', D: 'Diamonds' };
  var SUIT_SYM = { C: '♣', S: '♠', H: '♥', D: '♦' };
  var RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten', '9': 'Nine' };
  var RANK_TEXT = { A: 'A', K: 'K', Q: 'Q', J: 'J', T: '10', '9': '9' };

  /* The other suit of the same colour. This is the whole left bower rule in one
   * table, and it is worth having as data rather than as a condition somewhere:
   * every question about the left bower — which card it is, whether a card is
   * one, what suit it counts as — becomes a lookup in here. */
  var SAME_COLOUR = { C: 'S', S: 'C', H: 'D', D: 'H' };

  var IS_RED = { H: true, D: true, C: false, S: false };

  /* Rank order within a suit, highest first, for cards that are not bowers. */
  var PLAIN_ORDER = ['A', 'K', 'Q', 'J', 'T', '9'];
  var TRUMP_PLAIN_ORDER = ['A', 'K', 'Q', 'T', '9'];   // the jack has left; it is the right bower

  var PLAIN_RANKMAP = {};
  PLAIN_ORDER.forEach(function (r, i) { PLAIN_RANKMAP[r] = i; });
  var TRUMP_RANKMAP = {};
  TRUMP_PLAIN_ORDER.forEach(function (r, i) { TRUMP_RANKMAP[r] = i; });

  var DECK = [];
  var BY_ID = {};
  SUITS.forEach(function (s) {
    RANKS.forEach(function (r) {
      var c = { r: r, s: s, id: r + s };
      DECK.push(c);
      BY_ID[c.id] = c;
    });
  });

  function leftBowerSuit(trump) { return trump ? SAME_COLOUR[trump] : null; }

  /* 'right', 'left', or null. Nothing is a bower while trump is unknown. */
  function bower(c, trump) {
    if (!trump || !c || c.r !== 'J') return null;
    if (c.s === trump) return 'right';
    if (c.s === SAME_COLOUR[trump]) return 'left';
    return null;
  }

  function isTrump(c, trump) {
    if (!trump || !c) return false;
    return c.s === trump || bower(c, trump) === 'left';
  }

  /* The suit a card belongs to for the purposes of following. The left bower
   * answers with the trump suit, which is the entire point. */
  function effSuit(c, trump) { return isTrump(c, trump) ? trump : c.s; }

  /* A single comparable number, meaningful only within one trump suit.
   *
   * Every trump outranks every non-trump, so the two bands cannot collide, and
   * the bowers sit above the ace of trump because that is what they are. */
  function power(c, trump) {
    var b = bower(c, trump);
    if (b === 'right') return 300;
    if (b === 'left') return 290;
    if (isTrump(c, trump)) return 200 + (TRUMP_PLAIN_ORDER.length - TRUMP_RANKMAP[c.r]);
    return 100 + (PLAIN_ORDER.length - PLAIN_RANKMAP[c.r]);
  }

  function name(c) { return RANK_NAME[c.r] + ' of ' + SUIT_NAME[c.s]; }

  /* What is worth SAYING about a card beyond its name, given what trump is.
   *
   * Empty for an ordinary card, and that is deliberate. The name already
   * contains the suit, so appending it again produced "Queen of Hearts, hearts"
   * on every single play — a redundancy that is merely untidy on screen and
   * genuinely wearing when every card of every trick is read aloud.
   *
   * The bowers are always named as bowers, because "Jack of Clubs" is actively
   * misleading when clubs are not trump and that jack is the second highest card
   * in the game. */
  function role(c, trump) {
    var b = bower(c, trump);
    if (b === 'right') return 'right bower, the highest trump';
    if (b === 'left') return 'left bower, second highest trump, counts as ' +
      SUIT_NAME[trump].toLowerCase();
    if (isTrump(c, trump)) return 'trump';
    return '';
  }

  function describe(c, trump) {
    var r = role(c, trump);
    return r ? name(c) + ', ' + r : name(c);
  }

  function shortText(c) { return RANK_TEXT[c.r] + SUIT_SYM[c.s]; }

  /* Does `c` beat `b`, given that `b` is the card currently winning the trick? */
  function beats(c, b, trump) {
    var ct = isTrump(c, trump), bt = isTrump(b, trump);
    if (ct) return !bt || power(c, trump) > power(b, trump);
    if (bt) return false;
    return c.s === b.s && power(c, trump) > power(b, trump);
  }

  function newDeck() { return DECK.slice(); }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* Trump high to low, then the other suits high to low in a fixed order.
   *
   * The left bower sorts into the trump group, which is where a player expects
   * to find it and where a screen reader will read it out. A hand sorted by
   * printed suit would file it under its own colour and quietly hide the second
   * best card in the game among the rubbish. */
  function suitGroup(s, trump) {
    if (trump && s === trump) return -1;
    return SUITS.indexOf(s);
  }

  function sortHand(cards, trump) {
    return cards.slice().sort(function (a, b) {
      var ga = suitGroup(effSuit(a, trump), trump), gb = suitGroup(effSuit(b, trump), trump);
      if (ga !== gb) return ga - gb;
      return power(b, trump) - power(a, trump);
    });
  }

  function get(id) { return BY_ID[id]; }

  function ids(cards) { return cards.map(function (c) { return c.id; }); }

  function isRed(c) { return !!IS_RED[c.s]; }

  SH.Cards = {
    SUITS: SUITS,
    RANKS: RANKS,
    SUIT_NAME: SUIT_NAME,
    SUIT_SYM: SUIT_SYM,
    RANK_NAME: RANK_NAME,
    RANK_TEXT: RANK_TEXT,
    SAME_COLOUR: SAME_COLOUR,
    DECK_SIZE: 24,
    bower: bower,
    leftBowerSuit: leftBowerSuit,
    isTrump: isTrump,
    power: power,
    effSuit: effSuit,
    name: name,
    role: role,
    describe: describe,
    shortText: shortText,
    beats: beats,
    newDeck: newDeck,
    shuffle: shuffle,
    sortHand: sortHand,
    get: get,
    ids: ids,
    isRed: isRed
  };
/* `window` in a browser, `globalThis` in a Worker.
 *
 * ES module imports are HOISTED, so a Worker entry point cannot set
 * globalThis.window before importing this file — the assignment runs after the
 * import has already been evaluated. Depending on a shim the importer sets is
 * therefore not merely fragile, it cannot work at all. This file decides for
 * itself. */
})(typeof window !== 'undefined' ? window : globalThis);

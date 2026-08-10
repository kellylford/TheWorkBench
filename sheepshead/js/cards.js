/* Sheepshead - card model.
 * Ranks are stored as single characters; 'T' is the ten. Card ids are rank+suit, e.g. "QC", "TD".
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  var SUITS = ['C', 'S', 'H', 'D'];
  var FAIL_SUITS = ['C', 'S', 'H'];
  var RANKS = ['A', 'T', 'K', 'Q', 'J', '9', '8', '7'];

  var SUIT_NAME = { C: 'Clubs', S: 'Spades', H: 'Hearts', D: 'Diamonds' };
  var SUIT_SYM = { C: '♣', S: '♠', H: '♥', D: '♦' };
  var RANK_NAME = { A: 'Ace', T: 'Ten', K: 'King', Q: 'Queen', J: 'Jack', '9': 'Nine', '8': 'Eight', '7': 'Seven' };
  var RANK_TEXT = { A: 'A', T: '10', K: 'K', Q: 'Q', J: 'J', '9': '9', '8': '8', '7': '7' };
  var POINTS = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };

  /* Trump, highest first: all queens, all jacks, then the diamond suit. */
  var TRUMP_ORDER = ['QC', 'QS', 'QH', 'QD', 'JC', 'JS', 'JH', 'JD', 'AD', 'TD', 'KD', '9D', '8D', '7D'];
  var FAIL_RANK_ORDER = ['A', 'T', 'K', '9', '8', '7'];

  var TRUMP_RANKMAP = {};
  TRUMP_ORDER.forEach(function (id, i) { TRUMP_RANKMAP[id] = i; });
  var FAIL_RANKMAP = {};
  FAIL_RANK_ORDER.forEach(function (r, i) { FAIL_RANKMAP[r] = i; });

  var DECK = [];
  var BY_ID = {};
  SUITS.forEach(function (s) {
    RANKS.forEach(function (r) {
      var c = { r: r, s: s, id: r + s };
      DECK.push(c);
      BY_ID[c.id] = c;
    });
  });

  function isTrump(c) { return c.r === 'Q' || c.r === 'J' || c.s === 'D'; }

  /* A single comparable number. Every trump outranks every fail card. */
  function power(c) {
    return isTrump(c) ? 200 - TRUMP_RANKMAP[c.id] : 100 - FAIL_RANKMAP[c.r];
  }

  /* The suit a card follows: trump forms its own suit. */
  function effSuit(c) { return isTrump(c) ? 'T' : c.s; }

  function points(c) { return POINTS[c.r]; }

  function sumPoints(cards) {
    var t = 0;
    for (var i = 0; i < cards.length; i++) t += POINTS[cards[i].r];
    return t;
  }

  function name(c) { return RANK_NAME[c.r] + ' of ' + SUIT_NAME[c.s]; }

  function describe(c) {
    var p = POINTS[c.r];
    return name(c) + ', ' + (isTrump(c) ? 'trump' : SUIT_NAME[c.s] + ' fail') +
      ', ' + p + (p === 1 ? ' point' : ' points');
  }

  function shortText(c) { return RANK_TEXT[c.r] + SUIT_SYM[c.s]; }

  /* Does `c` beat `b`, given that `b` is the card currently winning the trick? */
  function beats(c, b) {
    if (isTrump(c)) return !isTrump(b) || power(c) > power(b);
    return !isTrump(b) && c.s === b.s && power(c) > power(b);
  }

  /* `exclude` is a list of card ids to leave out, used to size the deck to the
   * table. Only zero-point cards are ever excluded, so a hand is always 120. */
  function newDeck(exclude) {
    if (!exclude || !exclude.length) return DECK.slice();
    var skip = {};
    exclude.forEach(function (id) { skip[id] = 1; });
    return DECK.filter(function (c) { return !skip[c.id]; });
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var GROUP = { T: 0, C: 1, S: 2, H: 3 };

  /* Trump high-to-low, then each fail suit high-to-low. */
  function sortHand(cards) {
    return cards.slice().sort(function (a, b) {
      var ga = GROUP[effSuit(a)], gb = GROUP[effSuit(b)];
      if (ga !== gb) return ga - gb;
      return power(b) - power(a);
    });
  }

  function get(id) { return BY_ID[id]; }

  function ids(cards) { return cards.map(function (c) { return c.id; }); }

  SH.Cards = {
    SUITS: SUITS,
    FAIL_SUITS: FAIL_SUITS,
    RANKS: RANKS,
    SUIT_NAME: SUIT_NAME,
    SUIT_SYM: SUIT_SYM,
    RANK_NAME: RANK_NAME,
    RANK_TEXT: RANK_TEXT,
    TRUMP_ORDER: TRUMP_ORDER,
    TOTAL_POINTS: 120,
    isTrump: isTrump,
    power: power,
    effSuit: effSuit,
    points: points,
    sumPoints: sumPoints,
    name: name,
    describe: describe,
    shortText: shortText,
    beats: beats,
    newDeck: newDeck,
    shuffle: shuffle,
    sortHand: sortHand,
    get: get,
    ids: ids
  };
})(window);

/* Cribbage - card model.
 *
 * A whole 52-card deck, and no trump: cribbage is the odd one out among the
 * games in this repository in that no suit ever outranks another. Suits matter
 * in exactly two places — a flush, and one for his nob — and nowhere else.
 *
 * Two different numbers live on every card, and confusing them is the single
 * commonest cribbage bug:
 *
 *   value  what it counts for during the play and for fifteens. Ace is one, and
 *          the ten, jack, queen and king are ALL ten.
 *   order  where it sits in a run, and which card is lower when cutting for
 *          deal. Ace is one and the king is thirteen, so a ten is genuinely
 *          lower than a jack.
 *
 * The stable game in `Cribbage/` had this exact confusion in cutForDeal: it
 * compared by counting value, so a ten, jack, queen and king were all equal and
 * a tie came up 13% of the time instead of the 5.9% it should. The comment
 * beside the fix there is worth reading. Keeping the two as separately named
 * fields, rather than one function with a flag, is the cheapest way to stop it
 * happening again.
 *
 * Card ids are rank+suit, e.g. "AS", "TD". The ten is 'T' in an id and in the
 * rank field so that every id is two characters — "10S" would be three and
 * every substring assumption in the codebase would need a special case.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  var SUITS = ['C', 'S', 'H', 'D'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

  var SUIT_NAME = { C: 'Clubs', S: 'Spades', H: 'Hearts', D: 'Diamonds' };
  var SUIT_SYM = { C: '♣', S: '♠', H: '♥', D: '♦' };
  var RANK_NAME = {
    A: 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six',
    '7': 'Seven', '8': 'Eight', '9': 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King'
  };
  var RANK_TEXT = {
    A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
    '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K'
  };

  var IS_RED = { H: true, D: true, C: false, S: false };

  /* What a card counts for. Ace one, court cards ten. */
  var VALUE = {
    A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    T: 10, J: 10, Q: 10, K: 10
  };

  /* Where a card sits in a run, and which is lower at the cut. Ace one, king
   * thirteen. NOT the same as VALUE, and the difference is load-bearing. */
  var ORDER = {
    A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    T: 10, J: 11, Q: 12, K: 13
  };

  var DECK = [];
  var BY_ID = {};
  SUITS.forEach(function (s) {
    RANKS.forEach(function (r) {
      var c = { r: r, s: s, id: r + s };
      DECK.push(c);
      BY_ID[c.id] = c;
    });
  });

  function value(c) { return VALUE[c.r]; }
  function order(c) { return ORDER[c.r]; }

  function name(c) { return RANK_NAME[c.r] + ' of ' + SUIT_NAME[c.s]; }

  function shortText(c) { return RANK_TEXT[c.r] + SUIT_SYM[c.s]; }

  /* What to say about a card beyond its name. In cribbage that is its counting
   * value, and only when the value and the rank are not the same word — saying
   * "Seven of Clubs, worth seven" is noise, and saying "King of Clubs, worth
   * ten" is the thing a player actually has to hold in their head while adding
   * up to thirty-one. */
  var VALUE_WORD = ['nothing', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten'];

  function describe(c) {
    if (VALUE[c.r] === ORDER[c.r] && c.r !== 'A') return name(c);
    return name(c) + ', worth ' + VALUE_WORD[VALUE[c.r]];
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

  /* Ascending by run order, then by suit so a hand reads the same way twice.
   * Cribbage hands are counted, not played competitively by suit, so low-to-high
   * is what a player expects to hear — the opposite of the trick games next
   * door, where the strongest card comes first. */
  function sortHand(cards) {
    return cards.slice().sort(function (a, b) {
      if (ORDER[a.r] !== ORDER[b.r]) return ORDER[a.r] - ORDER[b.r];
      return SUITS.indexOf(a.s) - SUITS.indexOf(b.s);
    });
  }

  function sumValue(cards) {
    var t = 0;
    for (var i = 0; i < cards.length; i++) t += VALUE[cards[i].r];
    return t;
  }

  function get(id) { return BY_ID[id]; }
  function ids(cards) { return cards.map(function (c) { return c.id; }); }
  function isRed(c) { return !!IS_RED[c.s]; }

  /* A list of cards, said the way a person would say it: "the Ace of Spades",
   * "the Ace of Spades and the Five of Hearts", "A, B and C". Used everywhere a
   * score is broken down, which is most of cribbage. */
  function listNames(cards) {
    var n = cards.map(name);
    if (n.length === 0) return 'nothing';
    if (n.length === 1) return n[0];
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }

  SH.Cards = {
    SUITS: SUITS,
    RANKS: RANKS,
    SUIT_NAME: SUIT_NAME,
    SUIT_SYM: SUIT_SYM,
    RANK_NAME: RANK_NAME,
    RANK_TEXT: RANK_TEXT,
    DECK_SIZE: 52,
    value: value,
    order: order,
    name: name,
    describe: describe,
    shortText: shortText,
    newDeck: newDeck,
    shuffle: shuffle,
    sortHand: sortHand,
    sumValue: sumValue,
    get: get,
    ids: ids,
    isRed: isRed,
    listNames: listNames
  };
/* `window` in a browser, `globalThis` in a Worker. ES module imports are
 * HOISTED, so a Worker entry point cannot set globalThis.window before importing
 * this file — the assignment runs after the import has already been evaluated.
 * This file decides for itself. */
})(typeof window !== 'undefined' ? window : globalThis);

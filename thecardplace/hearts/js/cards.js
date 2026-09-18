/* Hearts - card model.
 *
 * A full fifty-two card pack. Ranks are single characters and 'T' is the ten, so
 * a card id is rank+suit: "QS" is the queen of spades, "TD" the ten of diamonds.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OTHER GAMES IN THIS REPOSITORY: there is no
 * trump. None. Every card follows its printed suit, a trick is won by the
 * highest card of the suit led, and nothing ever beats a suit it does not
 * belong to.
 *
 * That sounds like less to get wrong and is really an invitation to get one
 * thing very wrong. Euchre next door passes `trump` into almost every function,
 * because in euchre the jack of clubs can be a spade. Sheephead has a fixed
 * fourteen-card trump suit. Copying either shape into hearts would leave a
 * parameter that is always null and a set of branches that never run — dead code
 * that looks like it is doing something, in exactly the file where somebody
 * later reaches for "how does this game rank cards".
 *
 * So the signatures here are honest: power(c) and beats(c, b) take a card and
 * nothing else, because in hearts a card's rank is a property of the card.
 *
 * The two cards that matter more than their rank suggests — the queen of spades
 * at thirteen points and every heart at one — are NOT special-cased here. They
 * are worth points, which is scoring, and scoring lives in game.js. A card model
 * that knows the queen of spades is dangerous would have to be told again the
 * day somebody wants a variant where she is not.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  var SUITS = ['C', 'D', 'S', 'H'];
  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

  var SUIT_NAME = { C: 'Clubs', D: 'Diamonds', S: 'Spades', H: 'Hearts' };
  var SUIT_SYM = { C: '♣', D: '♦', S: '♠', H: '♥' };
  var RANK_NAME = {
    A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten',
    '9': 'Nine', '8': 'Eight', '7': 'Seven', '6': 'Six',
    '5': 'Five', '4': 'Four', '3': 'Three', '2': 'Two'
  };
  var RANK_TEXT = {
    A: 'A', K: 'K', Q: 'Q', J: 'J', T: '10',
    '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2'
  };

  var IS_RED = { H: true, D: true, C: false, S: false };

  /* Ace high, deuce low. Two is 2 and the ace is 14, so the number reads the way
   * a player says it and there is nothing to translate when comparing. */
  var RANK_VALUE = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    T: 10, J: 11, Q: 12, K: 13, A: 14
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

  /* The suit a card follows. Its own, always — but it exists as a function
   * because every other game in this repository has one, the shared code and
   * the tests read better for it, and a hearts variant with a trump suit would
   * change this and nothing else. */
  function effSuit(c) { return c.s; }

  /* Comparable within a suit only. Deliberately NOT comparable across suits:
   * the ace of clubs and the two of hearts have no ordering in this game, and a
   * number that let you write `power(a) > power(b)` across suits would invite
   * exactly the bug where a heart is thought to beat a club it was discarded on.
   * beats() is the function that knows what a trick means. */
  function power(c) { return RANK_VALUE[c.r]; }

  function name(c) { return RANK_NAME[c.r] + ' of ' + SUIT_NAME[c.s]; }

  /* A card is its name. Nothing else.
   *
   * This used to add "one point" to every heart and "thirteen points" to the
   * queen of spades. That is not information a hearts player is missing — it
   * is the entire game, stated back to them on most of the cards in the deck,
   * every time one is read out.
   *
   * Kept as a function returning nothing rather than deleted, because the
   * shape is right: a card CAN have something worth saying beyond its name.
   * In euchre a jack can be the second-highest card in the game while printed
   * as a club, and not saying so is actively misleading. Hearts has no such
   * case. The test is whether the name alone would mislead, not whether more
   * could be said. */
  function role(c) { return ''; }

  function describe(c) {
    var r = role(c);
    return r ? name(c) + ', ' + r : name(c);
  }

  function shortText(c) { return RANK_TEXT[c.r] + SUIT_SYM[c.s]; }

  /* Does `c` beat `b`, where `b` is the card currently winning the trick?
   *
   * No trump, so this is the whole of it: a card that is not of the led suit
   * cannot win, however high. The suit comparison is against the winning card
   * rather than against a remembered lead, because the winning card is always of
   * the led suit — nothing else can have taken the lead. */
  function beats(c, b) {
    if (c.s !== b.s) return false;
    return power(c) > power(b);
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

  /* Clubs, diamonds, spades, hearts; high to low within each.
   *
   * Alternating colours, which is how a physical hand gets arranged and what
   * makes a misread less likely on screen. Hearts last because they are what the
   * hand is about — a player looking for "how exposed am I" finds them together
   * at the end, next to the queen of spades sitting at the bottom of her suit. */
  function sortHand(cards) {
    return cards.slice().sort(function (a, b) {
      var ga = SUITS.indexOf(a.s), gb = SUITS.indexOf(b.s);
      if (ga !== gb) return ga - gb;
      return power(b) - power(a);
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
    DECK_SIZE: 52,
    effSuit: effSuit,
    power: power,
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

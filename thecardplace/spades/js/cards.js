/* Spades - card model.
 *
 * A full fifty-two card pack. Ranks are single characters and 'T' is the ten, so
 * a card id is rank+suit: "AS" is the ace of spades, "TD" the ten of diamonds.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OTHER GAMES IN THIS REPOSITORY: the trump
 * suit is a constant. Not chosen at the deal like euchre's, not a fourteen-card
 * construction like sheephead's, not absent like hearts'. Spades are trump, in
 * every hand, for ever.
 *
 * That is the one fact worth being careful about here, because it cuts both
 * ways. Euchre next door threads `trump` through nearly every function, because
 * in euchre the jack of clubs can be a spade — and copying that shape into this
 * file would leave a parameter that is always 'S' at every call site, which is
 * noise that looks like meaning. Hearts next door has beats(c, b) taking a card
 * and nothing else, because it has no trump at all — and copying THAT shape
 * would quietly lose the whole game.
 *
 * So the signatures here are honest in the other direction: beats() knows about
 * spades because in this game every card comparison does, and no function takes
 * a trump argument because there is nothing to pass.
 *
 * A card's rank is a property of the card, as in hearts. What is NOT a property
 * of the card is whether it can win a trick, which depends entirely on what was
 * led — and that is beats(), below, and nowhere else.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};

  var SUITS = ['C', 'D', 'H', 'S'];
  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

  /* The trump suit, named once. Everything below that needs to know reads this
   * rather than writing 'S', so the single place a variant would change is the
   * single place this is written. */
  var TRUMP = 'S';

  var SUIT_NAME = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
  var SUIT_SYM = { C: '♣', D: '♦', H: '♥', S: '♠' };
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

  /* The suit a card follows. Its own, always — no card in this game is printed
   * as one suit and played as another. It exists as a function because every
   * other game in this repository has one and the shared code reads better for
   * it. */
  function effSuit(c) { return c.s; }

  function isTrump(c) { return c.s === TRUMP; }

  /* Comparable within a suit only. Deliberately NOT comparable across suits: the
   * two of spades beats the ace of hearts and no single number can express that
   * while also ranking the ace above the king. A `power` that tried would invite
   * exactly the bug where a high heart is thought to beat a low spade.
   *
   * beats() is the function that knows what a trick means. */
  function power(c) { return RANK_VALUE[c.r]; }

  function name(c) { return RANK_NAME[c.r] + ' of ' + SUIT_NAME[c.s]; }

  /* What is worth saying about a card beyond its name.
   *
   * "Trump" on every spade, and nothing on anything else. This is the test the
   * hearts card model states and then has no case for: does the name alone
   * mislead? Here it can. A player hearing "the two of spades" while holding the
   * ace of hearts needs to know which of those takes the trick, and in this game
   * it is the two.
   *
   * It is not said on the whole hand read-out, where thirteen repetitions of one
   * word is noise — handText groups the suits and names the trump suit once. It
   * is said where a single card is named on its own. */
  function role(c) { return isTrump(c) ? 'trump' : ''; }

  function describe(c) {
    var r = role(c);
    return r ? name(c) + ', ' + r : name(c);
  }

  function shortText(c) { return RANK_TEXT[c.r] + SUIT_SYM[c.s]; }

  /* Does `c` beat `b`, where `b` is the card currently winning the trick?
   *
   * Three cases and they have to be in this order:
   *
   *   - a trump against a non-trump wins, whatever the ranks
   *   - a non-trump against a trump loses, whatever the ranks
   *   - otherwise the suits must match, and the higher rank wins
   *
   * The last line is what handles both "both trumps" and "both of the led suit"
   * with one comparison, and the suit check is against the winning card rather
   * than a remembered lead because the winning card is always either of the led
   * suit or a trump — nothing else can have taken the lead. */
  function beats(c, b) {
    if (isTrump(c) && !isTrump(b)) return true;
    if (!isTrump(c) && isTrump(b)) return false;
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

  /* Clubs, diamonds, hearts, spades; high to low within each.
   *
   * Trump last, which is the opposite of hearts' arrangement and deliberate. In
   * hearts the hearts go last because they are the danger. Here the spades go
   * last because they are the resource: a player deciding whether to bid four
   * wants to find their trump length in one place, at the end, where the hand
   * ends rather than somewhere in the middle of it.
   *
   * The suit order still alternates colour — clubs, diamonds, hearts, spades is
   * black, red, red, black, which is not a perfect alternation. It cannot be:
   * putting the black trump suit at the end leaves the two reds adjacent
   * somewhere. Between a misread across two red suits and a trump holding split
   * across the hand, the first is the cheaper mistake. */
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
    TRUMP: TRUMP,
    SUIT_NAME: SUIT_NAME,
    SUIT_SYM: SUIT_SYM,
    RANK_NAME: RANK_NAME,
    RANK_TEXT: RANK_TEXT,
    DECK_SIZE: 52,
    effSuit: effSuit,
    isTrump: isTrump,
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

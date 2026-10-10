/* Brings a player's saved settings across from the old address.
 *
 * The games used to be served from kellylford.github.io/TheWorkBench/... and are now at
 * theideaplace.github.io/TheWorkBench/... Browsers keep localStorage per address, so the
 * settings saved at the old address would be left behind. The old address now serves a
 * forwarding page (kellylford/kellylford.github.io), which still runs at the old address,
 * so it can read those settings. It passes them here in the link, after
 * "#tip-settings=".
 *
 * This runs before a game reads its settings. It copies only the games' own settings keys,
 * never overwrites anything already saved here, and then removes the settings from the
 * address bar. Anyone can craft such a link, so nothing but known keys holding JSON is
 * accepted.
 */
(function () {
  'use strict';

  var MARK = '#tip-settings=';
  var ALLOWED = /^(cribbage-mp|euchre|hearts|sheephead|sheephead-mp|spades)\.settings\.v\d+$/;

  var hash = window.location.hash || '';
  if (hash.indexOf(MARK) !== 0) return;

  try {
    var data = JSON.parse(decodeURIComponent(hash.slice(MARK.length)));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      Object.keys(data).forEach(function (key) {
        var value = data[key];
        if (!ALLOWED.test(key) || typeof value !== 'string' || value.length > 20000) return;
        try { JSON.parse(value); } catch (e) { return; }
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
      });
    }
  } catch (e) {
    // A damaged link just means starting with default settings.
  }

  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (e) {
    // Leaving the hash in place is harmless.
  }
})();

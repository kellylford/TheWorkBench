/* What this game is, and where its room service lives.
 *
 * Everything else about the transport — table.js, net.js, localserver.js and
 * room.js — is shared by every game in this repository and lives in
 * ../shared/js/. This file is the whole of the per-game difference: a name for
 * the log, and one Worker hostname. It must load before any of the shared
 * scripts.
 *
 * shared/tests/wiring.js checks from outside every game that no two of them
 * point at the same room service — sharing one would not throw, would not fail a
 * unit test, and would seat two tables of strangers in each other's rooms.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  SH.CONFIG = {
    game: 'Hearts',
    workerBase: 'https://hearts-room.quickmail.workers.dev'
  };
})(typeof window !== 'undefined' ? window : globalThis);

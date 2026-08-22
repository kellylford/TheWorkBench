/* What this game is, and where its room service lives.
 *
 * Everything else about the transport — table.js, net.js, localserver.js — is
 * shared by every game in this repository and lives in ../shared/js/. This file
 * is the whole of the per-game difference: a name for the log, and one Worker
 * hostname. It must load before any of the shared scripts.
 *
 * The three transport files used to be copied per game and drifted only in
 * their header comment and this one URL, which meant a fix to the wire had to
 * be made three times and was, more than once, made twice.
 */
(function (global) {
  'use strict';
  var SH = global.SH = global.SH || {};
  SH.CONFIG = {
    game: 'Euchre',
    workerBase: 'https://euchre-room.quickmail.workers.dev'
  };
})(typeof window !== 'undefined' ? window : globalThis);

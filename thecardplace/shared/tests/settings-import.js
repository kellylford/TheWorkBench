// Tests shared/js/settings-import.js: settings carried over from the old kellylford.github.io
// address are imported once, only for the games' own keys, and never over settings already
// saved at the new address.
//
//   node shared/tests/settings-import.js   (from thecardplace/)

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'settings-import.js'), 'utf8');

function run(hash, existing) {
  const store = new Map(Object.entries(existing || {}));
  const replaced = [];
  const window = {
    location: { hash, pathname: '/TheWorkBench/thecardplace/euchre/', search: '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    history: { replaceState: (s, t, url) => replaced.push(url) },
  };
  vm.runInNewContext(source, { window, JSON, Object, Array, decodeURIComponent });
  return { store: Object.fromEntries(store), replaced };
}

const link = (data) => '#tip-settings=' + encodeURIComponent(JSON.stringify(data));
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); } catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('settings import');

check('imports each game\'s saved settings and clears the address bar', () => {
  const r = run(link({ 'euchre.settings.v1': '{"speed":2}', 'sheephead.settings.v4': '{"a":1}' }));
  assert.deepStrictEqual(r.store, { 'euchre.settings.v1': '{"speed":2}', 'sheephead.settings.v4': '{"a":1}' });
  assert.deepStrictEqual(r.replaced, ['/TheWorkBench/thecardplace/euchre/']);
});

check('never overwrites settings already saved at the new address', () => {
  const r = run(link({ 'euchre.settings.v1': '{"speed":2}' }), { 'euchre.settings.v1': '{"speed":9}' });
  assert.strictEqual(r.store['euchre.settings.v1'], '{"speed":9}');
});

check('ignores keys that aren\'t a game\'s settings', () => {
  const r = run(link({ 'room': 'x', 'evil.settings.v1': '{}', 'euchre.settings': '{}', '__proto__': '{}' }));
  assert.deepStrictEqual(r.store, {});
});

check('ignores values that aren\'t JSON text', () => {
  const r = run(link({ 'hearts.settings.v1': 'not json', 'spades.settings.v1': 5 }));
  assert.deepStrictEqual(r.store, {});
});

check('a damaged link imports nothing and still tidies the address', () => {
  const r = run('#tip-settings=%7Bbroken');
  assert.deepStrictEqual(r.store, {});
  assert.strictEqual(r.replaced.length, 1);
});

check('does nothing at all without the marker', () => {
  const r = run('#something-else');
  assert.deepStrictEqual(r.store, {});
  assert.deepStrictEqual(r.replaced, []);
});

console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
process.exit(failures ? 1 : 0);

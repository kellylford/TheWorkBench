/* No raw control characters in source. They are invisible, and they are wrong.
 *
 * This exists because of four regexes that could never match anything:
 *
 *     check(!/<BS>(alone|partner)<BS>/i.test(r.reason), ...)
 *     .filter(c => !/<BS>selected<BS>/.test(c.className))
 *
 * Both were written as \b — a word boundary — and both arrived in the file as
 * an actual 0x08 backspace. A regex containing a real backspace matches nothing
 * a card game ever says, so `!test(...)` was true whatever it was given: the
 * first assertion had never once been capable of failing, and the second asked
 * about a state no card was ever in.
 *
 * HOW THEY GET IN. A backslash escape that passes through a shell heredoc, an
 * echo, or any tool that interprets escapes comes out the other side as the
 * character rather than the two characters that spell it. The file still
 * parses. The tests still pass — more reliably than before, in fact, because an
 * assertion that cannot fail cannot fail. And a diff shows nothing, because
 * most terminals and most review interfaces render 0x08 as nothing at all.
 *
 * That is the whole problem: every ordinary way of looking at the code agrees
 * it is fine. The only thing that can see it is something that looks at bytes,
 * so this looks at bytes.
 *
 * WHAT IS ALLOWED. Tab, newline and carriage return, because they are how text
 * files are shaped. Everything else below 0x20, and 0x7F, is refused — there is
 * no legitimate reason for a raw one in any of these files, and every
 * legitimate USE has an escape: write the two characters, not the one byte.
 * tests/authorization.js genuinely wants 0x01 as a fingerprint separator, and
 * spells it \u0001 now: exactly as fast, survives every editor, and can be
 * read by somebody who did not write it.
 *
 *   node shared/tests/no-control-characters.js
 */
const fs = require('fs');
const path = require('path');

/* The card games. This file lives inside them and speaks for them; the rest of
 * the repository is other people's projects with their own conventions. */
const root = path.join(__dirname, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

/* Anything whose bytes are not meant to be read as text. Checked by extension
 * rather than by sniffing, because a false positive here is a scary failure
 * about a font file and a false negative is only a missed check on a binary
 * nobody edits by hand. */
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.mp3', '.mp4', '.wav']);

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);   // tab, newline, carriage return

/* Make a control character visible. Built from character CODES rather than
 * written as a regular expression with escapes in it, because a regex literal
 * full of backslash-x escapes is precisely what this file exists to catch — and
 * the first draft of this line arrived with its character class replaced by the
 * characters it was meant to match. The guard caught itself, which is the best
 * evidence it works that anybody could ask for. */
function visible(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x0a || code === 0x0d) { out += ' '; continue; }
    if (code < 0x20 || code === 0x7f) {
      out += '<0x' + code.toString(16).padStart(2, '0') + '>';
      continue;
    }
    out += ch;
  }
  return out;
}

function nameOf(b) {
  if (b === 0x08) return 'backspace — almost certainly a \\b that lost its backslash';
  if (b === 0x1b) return 'escape';
  if (b === 0x00) return 'NUL';
  if (b === 0x0c) return 'form feed';
  if (b === 0x0b) return 'vertical tab';
  if (b === 0x7f) return 'delete';
  return 'control character';
}

const files = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    } else if (e.isFile() && !BINARY.has(path.extname(e.name).toLowerCase())) {
      files.push(path.join(dir, e.name));
    }
  }
})(root);

const fails = [];
let scanned = 0;
let bytes = 0;

for (const f of files) {
  let d;
  try { d = fs.readFileSync(f); } catch (e) { continue; }
  scanned++;
  bytes += d.length;

  let line = 1;
  let col = 1;
  for (let i = 0; i < d.length; i++) {
    const b = d[i];
    if (b === 0x0a) { line++; col = 1; continue; }
    if ((b < 0x20 || b === 0x7f) && !ALLOWED.has(b)) {
      /* The surrounding text, with the offender made visible. Without this the
       * failure names a line number in a file that looks perfectly fine when
       * you open it. */
      const from = Math.max(0, i - 40);
      const context = visible(d.slice(from, Math.min(d.length, i + 25)).toString('utf8'));
      fails.push(path.relative(root, f).replace(/\\/g, '/') +
        ':' + line + ':' + col + ' — ' + nameOf(b) + ' (0x' +
        b.toString(16).padStart(2, '0') + ')\n      …' + context + '…');
    }
    col++;
  }
}

console.log('control characters: ' + scanned + ' files, ' +
  Math.round(bytes / 1024) + ' KiB scanned');
console.log('  allowed: tab, newline, carriage return. Everything else must be ' +
  'written as an escape.');

if (fails.length) {
  console.error('\nFAIL (' + fails.length + '):');
  for (const f of fails) console.error('  - ' + f);
  console.error('\nWrite the escape rather than the character: \\b for a word ' +
    'boundary, \\u0001 for a separator. If a shell heredoc produced this, quote ' +
    'the delimiter or write the file with a tool that does not interpret escapes.');
  process.exit(1);
}
console.log('No source file carries a control character that cannot be seen.');

// escapeHtml() checks (node only, no browser needed).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../src/safe-html.js');

console.log('--- escapeHtml ---');
const payload = '<img src=x onerror=alert(1)>';
const out = escapeHtml(payload);
assert.strictEqual(out, '&lt;img src=x onerror=alert(1)&gt;');
assert.ok(!/[<>]/.test(out), 'no raw angle brackets survive, so no tag can be created');

// Quotes: an attribute value can't be broken out of.
const attack = '" onmouseover="alert(1)';
assert.strictEqual(escapeHtml(attack), '&quot; onmouseover=&quot;alert(1)');
assert.strictEqual(escapeHtml("' onfocus='alert(1)"), '&#39; onfocus=&#39;alert(1)');
assert.strictEqual(escapeHtml('`x`'), '&#96;x&#96;');
for (const s of [attack, "it's", '`tpl`']) assert.ok(!/["'`]/.test(escapeHtml(s)), `quotes escaped in ${s}`);

// Ampersand is escaped exactly once (no double-escaping of the entities it creates).
assert.strictEqual(escapeHtml('a & b <c>'), 'a &amp; b &lt;c&gt;');
assert.strictEqual(escapeHtml('&lt;'), '&amp;lt;', 'existing entities are shown literally, not decoded');

// Ordinary text and non-strings.
assert.strictEqual(escapeHtml('Charminar, Hyderabad'), 'Charminar, Hyderabad');
assert.strictEqual(escapeHtml('हैदराबाद 🚗'), 'हैदराबाद 🚗');
assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(undefined), '');
assert.strictEqual(escapeHtml(42), '42');
console.log('✓ escapeHtml neutralises tags, quotes and ampersands.');

// Regression guard: any line that writes HTML (innerHTML / insertAdjacentHTML /
// Leaflet popups) and uses a geocoder-style `.label` must escape it.
console.log('\n--- Source audit ---');
const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => /\.(html|js)$/.test(f) && !/^vrp-(engine|extras)\.js$/.test(f));
const offenders = [];
for (const f of files) {
  fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
    if (/(innerHTML|insertAdjacentHTML|outerHTML|bindPopup|bindTooltip)/.test(line) && /\.label\b/.test(line) && !/escapeHtml\(/.test(line)) {
      offenders.push(`${f}:${i + 1}`);
    }
  });
}
assert.deepStrictEqual(offenders, [], 'unescaped .label in HTML sinks: ' + offenders.join(', '));
for (const f of files.filter(f => f.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  if (src.includes('src="config.js"')) {
    assert.ok(src.indexOf('src="safe-html.js"') !== -1 && src.indexOf('src="safe-html.js"') < src.indexOf('src="config.js"'), `${f}: safe-html.js must load before the app modules`);
  }
}
console.log(`✓ ${files.length} source files: no unescaped labels in HTML sinks; safe-html.js loads before the app modules on every page.`);

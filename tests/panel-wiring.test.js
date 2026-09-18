'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
//
// Panel wiring regression guard: the "Balance" and "Last move" tiles are the
// two places where the Expressive design previously lived only in CSS while
// the HTML/JS still spoke legacy markup (`.md-card .md-eval`, a hidden
// `#eval-bar-black`, `.class-*` chip classes, win-probability pills absent
// from the meter, a
// fulcrum that could never move because `--eval-pct` was set on the wrong
// node). This test locks the wiring so a future edit cannot silently
// disconnect the layers again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// ── 1. Every element id referenced by the controller must exist in markup ──
const jsIdRefs = new Set();
for (const m of js.matchAll(/\$\('#([a-z0-9-]+)'\)/gi)) jsIdRefs.add(m[1]);
for (const m of js.matchAll(/getElementById\('([a-z0-9-]+)'\)/g)) jsIdRefs.add(m[1]);
const missing = [...jsIdRefs].filter((id) => !htmlIds.has(id));
assert.deepEqual(missing, [], `sidepanel.js references ids missing from sidepanel.html: ${missing.join(', ')}`);

// ── 2. Balance tile contract (`.md-balance` component) ──
const balanceHtml = html.match(/<section id="eval-section"[\s\S]*?<\/section>/)[0];
assert.match(balanceHtml, /class="md-balance"/, 'Balance section uses the .md-balance component, not legacy .md-card .md-eval');
assert.match(balanceHtml, /md-balance__orb/, 'decorative orbs present');
assert.match(balanceHtml, /md-balance__head/, 'head (kicker + description) present');
assert.doesNotMatch(balanceHtml, /id="eval-score"/, 'duplicate big score headline removed — the +/- score lives in the ribbon side labels');
assert.doesNotMatch(balanceHtml, /id="eval-win-prob"/, 'win-probability moved inside the meter, not a standalone headline');
assert.match(balanceHtml, /id="eval-bar-white-pct"/, 'white-side win-probability pill present in the meter');
assert.match(balanceHtml, /id="eval-bar-black-pct"/, 'black-side win-probability pill present in the meter');
assert.match(balanceHtml, /id="eval-stale-badge"/, 'stale cache badge element present');
assert.match(balanceHtml, /md-balance__ribbon/, 'ribbon container present');
assert.match(balanceHtml, /md-balance__fulcrum/, 'morphing fulcrum present (was missing)');
assert.match(balanceHtml, /eval-side/, 'piece-identity side labels present');
assert.doesNotMatch(balanceHtml, /id="eval-bar-black"|class="eval-bar-black"|md-eval__|eval-bar-container/, 'no legacy dual-bar / .md-eval markup remains');
assert.ok(!css.includes('.eval-bar-black'), 'no dead .eval-bar-black rule in CSS');
assert.match(css, /\.md-balance__fulcrum \{[\s\S]*?left: calc\(var\(--eval-pct/, 'fulcrum position reads --eval-pct');
assert.match(js, /dom\.evalSection\.style\.setProperty\('--eval-pct'/, 'JS sets --eval-pct on the tile (ancestor of the fulcrum)');
assert.ok(!js.includes("dom.evalSection.style.setProperty('--eval-pct', String(pct));\n      dom.evalBar"), '--eval-pct is not set on the bar itself');
assert.ok(css.includes('.eval-bar-pct'), '.eval-bar-pct in-meter pill rule exists');
assert.ok(css.includes('.eval-bar-pct--left') && css.includes('.eval-bar-pct--right'), 'left/right pill placements exist');
assert.ok(css.includes('.md-skeleton'), '.md-skeleton shimmer rule exists in CSS');
assert.match(js, /dom\.evalBarWhitePct/, 'JS sets the white-side win-probability pill');
assert.match(js, /dom\.evalBarBlackPct/, 'JS sets the black-side win-probability pill');

// ── 3. Last-move verdict tile contract ──
const verdictHtml = html.match(/<section id="move-class-section"[\s\S]*?<\/section>/)[0];
assert.match(verdictHtml, /aria-live="polite"/, 'verdict tile announces updates politely');
assert.doesNotMatch(verdictHtml, /class="move-class-display/, 'dead .move-class-display alias class removed (id kept for JS)');
assert.ok(css.includes('.md-verdict__stage'), '.md-verdict__stage rule exists');
assert.ok(css.includes('.md-verdict__empty'), '.md-verdict__empty rule exists');
assert.ok(css.includes('.md-verdict__mover'), '.md-verdict__mover rule exists');
assert.match(verdictHtml, /md-verdict__empty/, 'empty ghost state present in HTML');
assert.ok(!css.includes('.class-badge') && !css.includes('.class-accuracy'), 'legacy .class-* chip rules removed from CSS');
assert.ok(!js.includes('class-badge') && !js.includes('class-accuracy'), 'legacy .class-* chip classes removed from JS');
assert.match(js, /md-verdict__symbol/, 'JS renders the annotation symbol in its own expressive span');
assert.match(js, /md-verdict__mover/, 'JS renders the move identity line');
assert.match(js, /md-verdict__ring-val/, 'JS renders the accuracy figure without the muted .class-accuracy override');
assert.match(js, /renderMoveClassificationEmpty/, 'JS provides empty state handler');

// ── 4. Every component class used by the two tiles has a CSS rule ──
const classUses = new Set();
for (const m of balanceHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => classUses.add(c));
for (const m of verdictHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => classUses.add(c));
for (const m of js.matchAll(/class="md-verdict__([a-z-]+)/g)) classUses.add('md-verdict__' + m[1]);
for (const m of js.matchAll(/class="md-balance__([a-z-]+)/g)) classUses.add('md-balance__' + m[1]);
for (const m of js.matchAll(/class="eval-([a-z-]+)/g)) classUses.add('eval-' + m[1]);
// Utilities and identity helpers are shared tokens, not tile components.
const SHARED = new Set(['md-typescale-label-md', 'md-typescale-body-md', 'md-typescale-label-lg', 'piece-dot', 'piece-dot--light', 'piece-dot--dark']);
const uncovered = [...classUses].filter((c) => c && !SHARED.has(c) && !new RegExp(`\\.${c}\\b`).test(css));
assert.deepEqual(uncovered, [], `tile classes without CSS rules: ${uncovered.join(', ')}`);

// ── 5. Verdict role palette covers every label classifyMove can emit ──
const engineJs = fs.readFileSync(path.join(ROOT, 'engine/hint-engine.js'), 'utf8');
const labels = [...engineJs.matchAll(/label = '([^']+)'/g)].map((m) => m[1].toLowerCase());
assert.ok(labels.length >= 8, 'classifyMove label set found in engine');
for (const label of labels) {
  assert.ok(new RegExp(`data-verdict="${label}"`).test(css), `CSS styles data-verdict="${label}"`);
}

console.log('panel wiring OK — Balance + Last move sections are fully wired (HTML ⇄ CSS ⇄ JS)');

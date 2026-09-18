'use strict';
// Static regression guard for the fail-closed content-side context signal.
// The background repeats this gate; this catches accidental broadening before
// an untrusted board snapshot reaches the local policy route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

assert.match(content, /function classifyAnalysisEligibility\(site\)/, 'content attaches a dedicated Maia eligibility classifier');
for (const context of ['analysis-board', 'study', 'completed-game']) {
  assert.match(content, new RegExp(`context: '${context}'`), `${context} is an explicit allowed review context`);
}
assert.match(content, /context: 'live-or-unknown'/, 'ordinary game routes fail closed');
assert.match(content, /getClientRects\(\)\.length/, 'a hidden end-game template cannot prove review safety');
assert.match(content, /completedText\.test\(element\.textContent/, 'completed-game classification requires visible terminal text');
assert.doesNotMatch(content, /offline-analysis/, 'the broad offline-analysis context is not an allowed Maia route');
assert.match(background, /function getMaiaEligibility/, 'background independently validates eligibility');
assert.match(background, /const MAIA_SAFE_CONTEXTS = new Set\(\['analysis-board', 'study', 'completed-game'\]\)/, 'background allowlist matches the content signal');

console.log('maia context safety tests passed');

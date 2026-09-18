'use strict';
// Static guard for the separate Maia UI/lifecycle surface. Browser/model
// execution is covered by the worker contract and manual packaged smoke path;
// this test catches accidental reconnection to objective widgets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'sidepanel/sidepanel.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

for (const id of [
  'setting-analysis-engine', 'setting-maia-model', 'maia-settings-block', 'maia-panel', 'maia-move-list',
  'maia-policy-caption', 'maia-install-state', 'maia-install-detail',
  'btn-maia-install', 'btn-maia-cancel', 'btn-maia-remove',
  'setting-maia-self-elo', 'setting-maia-opponent-elo', 'setting-maia-link-ratings',
  'setting-maia-hint-count', 'setting-maia-auto-analyze', 'setting-maia-show-outcome'
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} exists in the separate Maia UI`);
}
assert.match(html, /\.\.\/engine\/maia\/maia-model-manifest\.js/, 'panel loads packaged Maia manifest');
assert.match(html, /\.\.\/engine\/maia\/maia-contract\.js/, 'panel loads packaged Maia contract');
assert.match(html, /data-objective-setting/, 'objective settings are explicitly markable for hiding');
assert.match(js, /Local Maia policy · study only/, 'Maia footer labels its local policy semantics');

for (const fn of ['renderMaiaAnalysis', 'handleMaiaAnalysisResult', 'handleMaiaAnalysisError', 'renderMaiaModelStatus', 'refreshMaiaModelStatus']) {
  assert.match(js, new RegExp(`function ${fn}\\(`), `${fn} is wired`);
}
for (const type of ['maia_analysis_update', 'maia_analysis_error', 'maia_status_update', 'maia_install_model', 'maia_remove_model']) {
  assert.match(js, new RegExp(`['"]${type}['"]`), `${type} has panel routing`);
}
assert.match(js, /if \(isMaiaMode\(\)\) return;[\s\S]*?const effectiveColor/, 'objective renderer exits in Maia mode');
assert.match(html, /Maia-3 predicts likely human moves, not an objective engine evaluation/, 'Maia result panel keeps policy semantics visible');
assert.match(js, /Probabilities are normalized over legal moves only/, 'Maia UI labels legal policy semantics');
assert.match(js, /expectedMaiaRequestId/, 'Maia UI correlates results so same-FEN setting/mode changes cannot render stale policy');
assert.match(js, /settingsLoaded && shouldAutoAnalyze/, 'automatic analysis waits for restored preferences');
assert.match(js, /finishInitialPreferenceLoad/, 'initial dispatch waits for persisted engine and player settings');
assert.match(js, /inferredPlayerColorNeedsPersistence/, 'early board state cannot overwrite a saved Maia setting record');
assert.match(html, /role="progressbar"/, 'model download progress has an accessible progressbar role');
assert.match(js, /aria-valuenow/, 'model download progress reports its current value');
assert.match(js, /not an engine evaluation/, 'Maia UI does not call LDW an evaluation');
assert.match(css, /\.maia-panel/, 'Maia panel style exists');
assert.match(css, /\.maia-move__probability/, 'policy probability style exists');
assert.match(css, /#app\.engine-maia/, 'Maia mode has a distinct app state');

assert.ok(manifest.permissions.includes('offscreen'), 'offscreen permission is declared');
assert.ok(manifest.optional_host_permissions.includes('https://raw.githubusercontent.com/*'), 'model host is optional and narrowly scoped');
assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/, 'Wasm execution is allowed without unsafe eval');
assert.match(manifest.content_security_policy.extension_pages, /raw\.githubusercontent\.com/, 'manifest CSP permits approved model origin');

console.log('maia UI and manifest wiring tests passed');

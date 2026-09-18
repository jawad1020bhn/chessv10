'use strict';
// Guard rails around the packaged local runtime. The real weights are
// intentionally user-installed and therefore not required by Node tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(ROOT, 'engine/maia/maia-worker.js'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'engine/maia/maia-engine-client.js'), 'utf8');
const host = fs.readFileSync(path.join(ROOT, 'offscreen.js'), 'utf8');
const offscreen = fs.readFileSync(path.join(ROOT, 'offscreen.html'), 'utf8');
const tool = fs.readFileSync(path.join(ROOT, 'tools/verify-maia-artifact.js'), 'utf8');

assert.match(worker, /indexedDB\.open\(DB_NAME, DB_VERSION\)/, 'verified model is stored in IndexedDB');
assert.match(worker, /dbPromise = null/, 'a transient IndexedDB open failure can be retried');
assert.match(worker, /crypto\.subtle\.digest\('SHA-256', buffer\)/, 'worker computes SHA-256 itself');
assert.match(worker, /buffer\.byteLength !== model\.expectedBytes/, 'worker rejects unexpected model byte length');
assert.match(worker, /throwIfAborted\(controller\.signal\)/, 'cancellation is checked between download, verification, and session promotion');
assert.match(worker, /modelLifecycleEpoch/, 'worker guards concurrent install/remove/cache lifecycle operations');
assert.match(worker, /digest !== model\.sha256/, 'worker rejects unexpected model hash');
assert.match(worker, /stagedSession = await createSession\(buffer, model\)[\s\S]*?await putRecord\(/, 'session opens before staged blob is promoted');
assert.match(worker, /transaction\.oncomplete = \(\) => resolve\(\)/, 'model persistence waits for IndexedDB transaction completion');
assert.match(worker, /metadataMatches\(expected, inputMetadata\.find/, 'worker verifies pinned input metadata as well as names');
assert.match(worker, /metadataMatches\(expected, outputMetadata\.find/, 'worker verifies pinned output metadata as well as names');
assert.match(worker, /executionProviders: \['wasm'\]/, 'local worker uses packaged Wasm provider');
assert.match(worker, /MaiaPreprocess\.decodePolicy/, 'worker decodes legal policy locally');
assert.match(worker, /message\.protocol !== PROTOCOL/, 'worker rejects mismatched internal protocol messages');
assert.match(worker, /fetch\(model\.url/, 'only the manifest-approved model URL is fetched');
assert.doesNotMatch(worker, /importScripts\([^)]*https?:/i, 'worker never imports executable runtime code from a network URL');

assert.match(client, /OFFSCREEN_REASON = 'WORKERS'/, 'Chrome-114 offscreen worker reason is used');
assert.match(client, /clients\.matchAll/, 'client retains Chrome-114 context fallback');
assert.match(client, /IDLE_CLOSE_MS/, 'offscreen host has an idle lifecycle');
assert.match(client, /protocol: PROTOCOL/, 'host requests are protocol versioned');
assert.match(host, /sender\?\.id !== chrome\.runtime\.id/, 'offscreen host only accepts this extension');
assert.match(host, /message\?\.protocol !== PROTOCOL/, 'offscreen host checks protocol version');
assert.match(host, /suppliedRequestId/, 'offscreen host preserves correlated panel request IDs');
assert.match(offscreen, /wasm-unsafe-eval/, 'offscreen CSP permits packaged Wasm runtime');
assert.match(offscreen, /raw\.githubusercontent\.com/, 'offscreen CSP only allows approved model host');
assert.match(tool, /createHash\('sha256'\)/, 'release helper independently hashes artifacts');

for (const asset of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'LICENSE', 'NOTICE.md']) {
  assert.ok(fs.existsSync(path.join(ROOT, 'vendor/onnxruntime-web', asset)), `packaged ONNX Runtime asset exists: ${asset}`);
}

console.log('maia runtime safety tests passed');

'use strict';
// Ensures Maia dispatch remains local and never falls through to the objective
// cloud/provider workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const listeners = {};
const values = {
  settings: {
    analysisEngine: 'maia3',
    maiaModelId: 'maia3-browser-fp16',
    maiaSideToMoveElo: 1500,
    maiaOpponentElo: 1600,
    maiaLinkRatings: false,
    maiaHintCount: 3,
    maiaShowHumanOutcome: true,
    maiaAutoAnalyze: false
  },
  assistedPlayerColor: 'w'
};
const sent = [];
let remoteFetches = 0;

function storageGet(keys, callback) {
  const result = {};
  for (const key of keys === null ? Object.keys(values) : (Array.isArray(keys) ? keys : [keys])) {
    if (Object.hasOwn(values, key)) result[key] = values[key];
  }
  if (callback) { callback(result); return undefined; }
  return Promise.resolve(result);
}

const chrome = {
  storage: {
    local: {
      get: storageGet,
      set(object, callback) { Object.assign(values, object); callback?.(); return Promise.resolve(); },
      remove() { return Promise.resolve(); }
    },
    onChanged: { addListener() {} }
  },
  alarms: { get(_name, callback) { callback(null); }, create() {}, onAlarm: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} }, onActivated: { addListener() {} }, async query() { return []; } },
  sidePanel: { async setPanelBehavior() {} },
  scripting: { async executeScript() { return []; } },
  permissions: { async contains() { return true; } },
  runtime: {
    getURL(pathname) { return `chrome-extension://test/${pathname}`; },
    onMessage: { addListener(listener) { listeners.message = listener; } },
    onInstalled: { addListener() {} },
    async sendMessage(message) { sent.push(message); return undefined; }
  }
};

const context = {
  chrome,
  console: { log() {}, warn() {}, error() {} },
  navigator: { onLine: true },
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  async fetch(url) { remoteFetches++; throw new Error(`Unexpected objective provider call: ${url}`); }
};
context.globalThis = context;
vm.createContext(context);
context.importScripts = (...files) => {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
assert.equal(typeof listeners.message, 'function');

const predictCalls = [];
const lifecycleCalls = [];
function successfulPolicyResponse(payload) {
  const blackToMove = String(payload.fen).split(/\s+/)[1] === 'b';
  const moves = blackToMove
    ? [{ uci: 'e7e5', probability: 0.7, rank: 1 }, { uci: 'd7d5', probability: 0.3, rank: 2 }]
    : [{ uci: 'e2e4', probability: 0.7, rank: 1 }, { uci: 'd2d4', probability: 0.3, rank: 2 }];
  return {
    ok: true,
    data: {
      fen: payload.fen,
      model: context.MaiaModelManifest.get(payload.modelId),
      ratingContext: payload.ratingContext,
      hintCount: payload.hintCount,
      history: { mode: 'current-position-model', stateCount: 1, detail: 'Current board only.' },
      moves,
      humanOutcome: { enabled: true, scope: 'current-position', perspective: 'side-to-move', win: 0.5, draw: 0.2, loss: 0.3 }
    }
  };
}
context.MaiaEngineClient = {
  async predict(payload) {
    predictCalls.push(payload);
    return successfulPolicyResponse(payload);
  },
  async getStatus(modelId) { lifecycleCalls.push(['status', modelId]); return { ok: true, status: { state: 'not-installed', modelId, progress: 0 } }; },
  async install(modelId) { lifecycleCalls.push(['install', modelId]); return { ok: true, accepted: true }; },
  async cancelInstall(modelId) { lifecycleCalls.push(['cancel', modelId]); return { ok: true }; },
  async remove(modelId) { lifecycleCalls.push(['remove', modelId]); return { ok: true }; }
};

function send(message) {
  return new Promise(resolve => {
    const isAsync = listeners.message(message, {}, resolve);
    if (isAsync !== true) queueMicrotask(() => resolve(undefined));
  });
}

async function waitFor(type, previous = 0) {
  for (let index = 0; index < 100; index++) {
    const matches = sent.filter(message => message?.type === type);
    if (matches.length > previous) return matches.at(-1);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

(async () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const before = sent.filter(message => message?.type === 'maia_analysis_update').length;
  const response = await send({
    type: 'request_analysis',
    engineId: 'maia3',
    requestId: 'panel-first-request',
    tabId: 4,
    fen: START,
    playerColor: 'w',
    positionReliable: true,
    turnReliable: true,
    gameInfo: { historyQuality: 'unavailable', analysisEligibility: { allowed: true, context: 'analysis-board' } }
  });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'panel-first-request');
  const update = await waitFor('maia_analysis_update', before);
  assert.equal(predictCalls.length, 1);
  assert.equal(predictCalls[0].requestId, 'panel-first-request', 'panel request ID crosses to the local host client');
  assert.equal(predictCalls[0].sideToMoveElo, undefined, 'only normalized ratingContext crosses to the local client');
  assert.equal(predictCalls[0].ratingContext.sideToMoveElo, 1500);
  assert.equal(predictCalls[0].ratingContext.opponentElo, 1600);
  assert.equal(update.data.kind, 'maia-analysis/v1');
  assert.equal(update.data.engineId, 'maia3');
  assert.equal(update.data.requestId, 'panel-first-request', 'worker-boundary result retains its originating request ID');
  assert.equal(update.data.topMove.uci, 'e2e4');
  assert.equal(Object.hasOwn(update.data, 'pvs'), false, 'Maia result is not coerced into objective PVs');
  assert.equal(sent.some(message => message?.type === 'analysis_update'), false, 'Maia uses its own update channel');
  assert.equal(remoteFetches, 0, 'Maia must not contact objective analysis providers');

  // In a known-safe review context, an explicit Refresh may inspect a
  // reviewed opponent-to-move FEN. Automatic Maia requests remain tied to the
  // selected player's turn in the panel.
  const REVIEW_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const reviewBefore = sent.filter(message => message?.type === 'maia_analysis_update').length;
  const reviewResponse = await send({
    type: 'request_analysis', engineId: 'maia3', requestId: 'review-opponent-turn', tabId: 4,
    fen: REVIEW_FEN, playerColor: 'w', positionReliable: true, turnReliable: true, refresh: true,
    gameInfo: { historyQuality: 'unavailable', analysisEligibility: { allowed: true, context: 'analysis-board' } }
  });
  assert.equal(reviewResponse.ok, true);
  const reviewUpdate = await waitFor('maia_analysis_update', reviewBefore);
  assert.equal(reviewUpdate.data.requestId, 'review-opponent-turn');
  assert.equal(predictCalls.length, 2, 'manual safe-context review reaches the local policy for the FEN side to move');

  // A newer same-FEN request (for example after a rating/hint setting change)
  // supersedes its predecessor rather than rendering an older policy late.
  const deferredPredictions = [];
  context.MaiaEngineClient.predict = payload => {
    predictCalls.push(payload);
    return new Promise(resolve => deferredPredictions.push({ payload, resolve }));
  };
  const staleUpdateCount = sent.filter(message => message?.type === 'maia_analysis_update').length;
  const requestBase = {
    type: 'request_analysis', engineId: 'maia3', tabId: 4, fen: START,
    playerColor: 'w', positionReliable: true, turnReliable: true, refresh: true,
    gameInfo: { historyQuality: 'unavailable', analysisEligibility: { allowed: true, context: 'analysis-board' } }
  };
  const staleResponse = await send({ ...requestBase, requestId: 'panel-stale-request' });
  const currentResponse = await send({ ...requestBase, requestId: 'panel-current-request' });
  assert.equal(staleResponse.ok, true);
  assert.equal(currentResponse.ok, true);
  assert.equal(deferredPredictions.length, 2);
  deferredPredictions[0].resolve(successfulPolicyResponse(deferredPredictions[0].payload));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.filter(message => message?.type === 'maia_analysis_update').length, staleUpdateCount, 'superseded same-FEN result is not broadcast');
  deferredPredictions[1].resolve(successfulPolicyResponse(deferredPredictions[1].payload));
  const currentUpdate = await waitFor('maia_analysis_update', staleUpdateCount);
  assert.equal(currentUpdate.data.requestId, 'panel-current-request');

  // Unsafe/unknown contexts fail closed before a local prediction starts.
  const blockedBefore = sent.filter(message => message?.type === 'maia_analysis_error').length;
  const blocked = await send({
    type: 'request_analysis', engineId: 'maia3', tabId: 4,
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    playerColor: 'b', positionReliable: true, turnReliable: true,
    gameInfo: { analysisEligibility: { allowed: false, context: 'live-or-unknown', reason: 'Blocked in test.' } }
  });
  assert.equal(blocked.ok, false);
  const blockedEvent = await waitFor('maia_analysis_error', blockedBefore);
  assert.equal(blockedEvent.data.errorDetail.code, 'context_blocked');
  assert.equal(predictCalls.length, 4, 'blocked context cannot reach the local model');
  assert.equal(remoteFetches, 0);

  const status = await send({ type: 'maia_get_status', modelId: 'maia3-browser-fp16' });
  assert.equal(status.ok, true);
  assert.equal(status.model.expectedBytes, 45683686);
  const install = await send({ type: 'maia_install_model', modelId: 'maia3-browser-fp16' });
  assert.equal(install.ok, true);
  assert.deepEqual(lifecycleCalls.map(call => call[0]), ['status', 'install']);
  assert.equal(remoteFetches, 0, 'model lifecycle routing does not use the objective fetch coordinator');

  console.log('maia background routing tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

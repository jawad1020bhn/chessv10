/*
 * Maia-3 local inference worker.
 *
 * This file runs only inside the extension's packaged offscreen document. It
 * never accepts model URLs or executable code from messages: model metadata is
 * read from the packaged manifest and the downloaded ONNX bytes are SHA-256
 * verified before activation.
 */
'use strict';

importScripts(
  '../core-utils.js',
  '../analysis-contract.js',
  'maia-model-manifest.js',
  'maia-contract.js',
  'maia-preprocess.js',
  '../../vendor/onnxruntime-web/ort.wasm.min.js'
);

const ORT = self.ort;
const PROTOCOL = 'maia-host/v1';
const DB_NAME = 'chess-hint-maia-models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MAX_EXTRA_DOWNLOAD_BYTES = 1024 * 1024;

if (ORT?.env?.wasm) {
  ORT.env.wasm.wasmPaths = new URL('../../vendor/onnxruntime-web/', self.location.href).href;
  // The extension is not cross-origin isolated in v1. A single Wasm thread is
  // the predictable portable path; later releases can measure accelerators.
  ORT.env.wasm.numThreads = 1;
}

let dbPromise = null;
let activeSession = null;
let activeModelId = null;
let activeDownload = null;
// Async cache loading, downloading, cancellation, and removal can overlap in
// a persistent worker. A monotonic epoch makes an older operation harmless
// once a newer lifecycle command has superseded it.
let modelLifecycleEpoch = 0;
let predictionQueue = Promise.resolve();
const cancelledRequests = new Set();
let modelStatus = {
  state: 'not-installed',
  modelId: MaiaModelManifest.DEFAULT_MODEL_ID,
  progress: 0,
  size: 0,
  detail: 'Maia-3 has not been downloaded yet.'
};

function publicStatus() {
  return {
    state: modelStatus.state,
    modelId: modelStatus.modelId,
    progress: Number(modelStatus.progress) || 0,
    size: Number(modelStatus.size) || 0,
    detail: String(modelStatus.detail || ''),
    ready: modelStatus.state === 'ready'
  };
}

function emitStatus(next = {}) {
  modelStatus = { ...modelStatus, ...next };
  postMessage({ type: 'maia-status', status: publicStatus() });
}

function emitProgress(progress, detail) {
  const value = Math.max(0, Math.min(100, Math.floor(Number(progress) || 0)));
  modelStatus = { ...modelStatus, state: 'downloading', progress: value, detail: detail || modelStatus.detail };
  postMessage({ type: 'maia-progress', status: publicStatus() });
}

function errorMessage(error) {
  if (error?.name === 'AbortError') return 'Maia model download was cancelled.';
  return String(error?.message || error || 'Maia-3 is unavailable.');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function beginModelLifecycle() {
  modelLifecycleEpoch += 1;
  return modelLifecycleEpoch;
}

function isCurrentLifecycle(epoch) {
  return epoch === modelLifecycleEpoch;
}

function throwIfSuperseded(epoch) {
  if (isCurrentLifecycle(epoch)) return;
  const error = new Error('This Maia model operation was superseded by a newer request.');
  error.name = 'LifecycleSupersededError';
  throw error;
}

function emitError(requestId, code, message, extras = {}) {
  postMessage({
    type: 'maia-error',
    requestId: requestId || '',
    error: {
      code: String(code || 'maia_error'),
      message: String(message || 'Maia-3 is unavailable.'),
      suggestion: extras.suggestion || 'retry'
    }
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Unable to open Maia model storage.'));
    request.onblocked = () => reject(new Error('Maia model storage is busy in another extension context.'));
    request.onupgradeneeded = event => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(database);
    };
  });
  dbPromise = opening;
  // A rejected open must not permanently poison Retry after a transient
  // IndexedDB/profile failure.
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function getRecord(modelId) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(modelId);
    request.onerror = () => reject(request.error || new Error('Unable to read Maia model storage.'));
    request.onsuccess = () => resolve(request.result || null);
  }));
}

function putRecord(record) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).put(record);
    // A request's success event precedes durable transaction completion. Wait
    // for `oncomplete` before making the session active so quota/abort errors
    // cannot leave a ready model whose verified Blob was never persisted.
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || request.error || new Error('Unable to save Maia model.'));
    transaction.onabort = () => reject(transaction.error || request.error || new Error('Saving the Maia model was aborted.'));
  }));
}

function deleteRecord(modelId) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).delete(modelId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || request.error || new Error('Unable to remove Maia model.'));
    transaction.onabort = () => reject(transaction.error || request.error || new Error('Removing the Maia model was aborted.'));
  }));
}

function deleteRecordForLifecycle(modelId, epoch) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(modelId);
    request.onsuccess = () => {
      if (request.result?.lifecycleEpoch === epoch) store.delete(modelId);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || request.error || new Error('Unable to remove Maia model.'));
    transaction.onabort = () => reject(transaction.error || request.error || new Error('Removing the Maia model was aborted.'));
  }));
}

function modelMetadata(model) {
  return {
    id: model.id,
    displayName: model.displayName,
    artifactVersion: model.artifactVersion,
    sourceRevision: model.sourceRevision,
    sha256: model.sha256
  };
}

function isMatchingRecord(record, model) {
  return Boolean(record && record.id === model.id &&
    record.artifactVersion === model.artifactVersion &&
    record.sha256 === model.sha256 &&
    Number(record.size) === Number(model.expectedBytes) &&
    record.data instanceof Blob);
}

async function sha256(buffer) {
  if (!self.crypto?.subtle) throw new Error('Secure digest support is unavailable in this browser.');
  const digest = await self.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function releaseSession() {
  // Clear the shared references before awaiting release. A later lifecycle
  // action cannot have its newly activated session nulled by this older async
  // cleanup when the runtime yields during `session.release()`.
  const session = activeSession;
  activeSession = null;
  activeModelId = null;
  if (session && typeof session.release === 'function') {
    try { await session.release(); } catch (_) {}
  }
}

function metadataMatches(expected, metadata) {
  if (!metadata || metadata.name !== expected.name || metadata.type !== expected.type || !Array.isArray(metadata.shape)) return false;
  if (metadata.shape.length !== expected.shape.length) return false;
  // Symbolic batch dimensions vary by exporter (for example `batch_size` or
  // `unk__0`), so lock every concrete manifest dimension and accept symbols
  // only where the manifest deliberately says `batch`.
  return expected.shape.every((dimension, index) => {
    if (dimension === 'batch') return true;
    return Number(metadata.shape[index]) === Number(dimension);
  });
}

async function createSession(buffer, model) {
  if (!ORT?.InferenceSession) throw new Error('The packaged ONNX Runtime failed to load.');
  const session = await ORT.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  // Fail closed if an asset changed its contract even if its digest metadata was
  // accidentally updated without the accompanying preprocessing change.
  const inputNames = Array.isArray(session.inputNames) ? session.inputNames : [];
  const outputNames = Array.isArray(session.outputNames) ? session.outputNames : [];
  const inputMetadata = Array.isArray(session.inputMetadata) ? session.inputMetadata : [];
  const outputMetadata = Array.isArray(session.outputMetadata) ? session.outputMetadata : [];
  for (const expected of Object.values(model.inputs)) {
    if (!inputNames.includes(expected.name) || !metadataMatches(expected, inputMetadata.find(item => item?.name === expected.name))) {
      try { await session.release?.(); } catch (_) {}
      throw new Error(`Maia model input '${expected.name}' does not match the approved contract.`);
    }
  }
  for (const expected of Object.values(model.outputs)) {
    if (!outputNames.includes(expected.name) || !metadataMatches(expected, outputMetadata.find(item => item?.name === expected.name))) {
      try { await session.release?.(); } catch (_) {}
      throw new Error(`Maia model output '${expected.name}' does not match the approved contract.`);
    }
  }
  return session;
}

async function activateBuffer(buffer, model, epoch = modelLifecycleEpoch) {
  const newSession = await createSession(buffer, model);
  if (!isCurrentLifecycle(epoch)) {
    try { await newSession.release?.(); } catch (_) {}
    return false;
  }
  await releaseSession();
  if (!isCurrentLifecycle(epoch)) {
    try { await newSession.release?.(); } catch (_) {}
    return false;
  }
  activeSession = newSession;
  activeModelId = model.id;
  emitStatus({
    state: 'ready',
    modelId: model.id,
    progress: 100,
    size: buffer.byteLength,
    detail: `${model.displayName} is ready on this device.`
  });
  return true;
}

async function loadStoredModel(model, epoch = modelLifecycleEpoch) {
  emitStatus({ state: 'loading', modelId: model.id, progress: 0, detail: 'Checking local Maia model…' });
  let record = null;
  try {
    record = await getRecord(model.id);
  } catch (error) {
    if (isCurrentLifecycle(epoch)) {
      emitStatus({ state: 'error', modelId: model.id, progress: 0, detail: errorMessage(error) });
    }
    return;
  }
  if (!isCurrentLifecycle(epoch)) return;
  if (!record) {
    emitStatus({ state: 'not-installed', modelId: model.id, progress: 0, size: 0, detail: 'Download Maia-3 to enable its local hints.' });
    return;
  }
  if (!isMatchingRecord(record, model)) {
    try {
      if (isCurrentLifecycle(epoch)) await deleteRecord(model.id);
    } catch (_) {}
    if (isCurrentLifecycle(epoch)) {
      emitStatus({ state: 'not-installed', modelId: model.id, progress: 0, size: 0, detail: 'The cached Maia model is out of date. Download it again.' });
    }
    return;
  }
  try {
    const buffer = await record.data.arrayBuffer();
    if (!isCurrentLifecycle(epoch)) return;
    const digest = await sha256(buffer);
    if (!isCurrentLifecycle(epoch)) return;
    if (digest !== model.sha256 || buffer.byteLength !== model.expectedBytes) {
      throw new Error('The cached Maia model did not pass integrity verification.');
    }
    await activateBuffer(buffer, model, epoch);
  } catch (error) {
    if (!isCurrentLifecycle(epoch)) return;
    try { await deleteRecord(model.id); } catch (_) {}
    // Do not tear down an already-active verified session belonging to a
    // concurrent/recent lifecycle action merely because this cache reload
    // failed. Explicit removal owns session teardown.
    if (isCurrentLifecycle(epoch)) {
      emitStatus({ state: 'error', modelId: model.id, progress: 0, size: 0, detail: `${errorMessage(error)} Download Maia-3 again.` });
    }
  }
}

async function prepareStorage(model) {
  if (!navigator.storage) return;
  try {
    const estimate = await navigator.storage.estimate?.();
    const free = Number(estimate?.quota || 0) - Number(estimate?.usage || 0);
    // Reserve a small working margin because the verified download and the
    // IndexedDB Blob can coexist while ONNX Runtime initializes.
    if (Number(estimate?.quota) > 0 && free < model.expectedBytes + 8 * 1024 * 1024) {
      throw new Error(`Maia-3 needs about ${Math.ceil((model.expectedBytes + 8 * 1024 * 1024) / (1024 * 1024))} MB of free browser storage.`);
    }
    await navigator.storage.persist?.();
  } catch (error) {
    // Storage estimates are advisory across Chromium profiles. A genuine
    // low-storage error is actionable; unsupported persistence is not.
    if (/needs about .*free browser storage/i.test(String(error?.message || error))) throw error;
  }
}

async function readDownload(response, model, signal) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength && declaredLength > model.expectedBytes + MAX_EXTRA_DOWNLOAD_BYTES) {
    throw new Error('Maia model download is larger than the approved artifact.');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    emitProgress(100, 'Verifying Maia model…');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let reported = -1;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > model.expectedBytes + MAX_EXTRA_DOWNLOAD_BYTES) {
      try { await reader.cancel(); } catch (_) {}
      throw new Error('Maia model download exceeded the approved size.');
    }
    chunks.push(value);
    const progress = declaredLength > 0
      ? Math.floor((received / declaredLength) * 100)
      : Math.floor((received / model.expectedBytes) * 100);
    if (progress >= reported + 2 || progress === 100) {
      reported = progress;
      emitProgress(Math.min(99, progress), `Downloading Maia model… ${Math.min(99, progress)}%`);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  emitProgress(100, 'Verifying Maia model…');
  return bytes.buffer;
}

async function installModel(modelId) {
  const model = MaiaModelManifest.get(modelId);
  if (activeSession && activeModelId === model.id) {
    emitStatus({ state: 'ready', modelId: model.id, progress: 100, detail: `${model.displayName} is already ready.` });
    return;
  }
  if (activeDownload) return activeDownload.promise;
  const epoch = beginModelLifecycle();
  const controller = new AbortController();
  const task = (async () => {
    let stagedSession = null;
    let promotedRecord = false;
    emitStatus({ state: 'downloading', modelId: model.id, progress: 0, detail: 'Preparing Maia model download…' });
    try {
      await prepareStorage(model);
      throwIfAborted(controller.signal);
      throwIfSuperseded(epoch);
      const response = await fetch(model.url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Maia model download failed (${response.status}).`);
      const buffer = await readDownload(response, model, controller.signal);
      throwIfAborted(controller.signal);
      throwIfSuperseded(epoch);
      if (buffer.byteLength !== model.expectedBytes) {
        throw new Error(`Maia model size check failed (${buffer.byteLength} bytes received).`);
      }
      const digest = await sha256(buffer);
      throwIfAborted(controller.signal);
      throwIfSuperseded(epoch);
      if (digest !== model.sha256) throw new Error('Maia model integrity check failed.');
      emitStatus({ state: 'loading', modelId: model.id, progress: 100, detail: 'Starting Maia-3 locally…' });
      stagedSession = await createSession(buffer, model);
      throwIfAborted(controller.signal);
      throwIfSuperseded(epoch);
      // The old verified record remains active until this new session has
      // opened successfully. Only then do we promote the new verified blob.
      await putRecord({
        id: model.id,
        artifactVersion: model.artifactVersion,
        sha256: model.sha256,
        size: buffer.byteLength,
        timestamp: Date.now(),
        lifecycleEpoch: epoch,
        data: new Blob([buffer], { type: 'application/octet-stream' })
      });
      promotedRecord = true;
      throwIfAborted(controller.signal);
      throwIfSuperseded(epoch);
      await releaseSession();
      throwIfSuperseded(epoch);
      activeSession = stagedSession;
      stagedSession = null;
      activeModelId = model.id;
      emitStatus({ state: 'ready', modelId: model.id, progress: 100, size: buffer.byteLength, detail: `${model.displayName} is ready on this device.` });
    } catch (error) {
      if (stagedSession && typeof stagedSession.release === 'function') {
        try { await stagedSession.release(); } catch (_) {}
      }
      if (promotedRecord && (error?.name === 'AbortError' || error?.name === 'LifecycleSupersededError')) {
        try { await deleteRecordForLifecycle(model.id, epoch); } catch (_) {}
      }
      // A staged session has already been released above. Preserve any
      // independently active verified session until the user explicitly
      // removes it rather than turning a failed replacement into downtime.
      if (!isCurrentLifecycle(epoch) || error?.name === 'LifecycleSupersededError') return;
      if (error?.name === 'AbortError') {
        emitStatus({ state: 'not-installed', modelId: model.id, progress: 0, detail: 'Maia model download cancelled.' });
      } else {
        emitStatus({ state: 'error', modelId: model.id, progress: 0, detail: errorMessage(error) });
      }
    } finally {
      if (activeDownload?.controller === controller) activeDownload = null;
    }
  })();
  activeDownload = { controller, promise: task };
  return task;
}

async function removeModel(modelId) {
  const model = MaiaModelManifest.get(modelId);
  const epoch = beginModelLifecycle();
  const download = activeDownload;
  if (download?.controller) download.controller.abort();
  // Permit a deliberate new install to begin immediately; the aborted task is
  // epoch-guarded and cannot promote or announce a stale model afterwards.
  if (activeDownload === download) activeDownload = null;
  cancelledRequests.clear();
  await releaseSession();
  if (!isCurrentLifecycle(epoch)) return;
  try { await deleteRecord(model.id); } catch (error) {
    if (isCurrentLifecycle(epoch)) {
      emitStatus({ state: 'error', modelId: model.id, progress: 0, size: 0, detail: errorMessage(error) });
    }
    return;
  }
  if (isCurrentLifecycle(epoch)) {
    emitStatus({ state: 'not-installed', modelId: model.id, progress: 0, size: 0, detail: 'Maia model removed from this device.' });
  }
}

async function predict(message) {
  const requestId = String(message.requestId || '');
  const model = MaiaModelManifest.get(message.modelId);
  if (cancelledRequests.has(requestId)) {
    cancelledRequests.delete(requestId);
    emitError(requestId, 'cancelled', 'Maia analysis was cancelled.', { suggestion: 'none' });
    return;
  }
  if (!activeSession || activeModelId !== model.id || modelStatus.state !== 'ready') {
    emitError(requestId, 'model_not_ready', 'Download and load Maia-3 before requesting hints.', { suggestion: 'install' });
    return;
  }
  const preparation = MaiaPreprocess.preparePosition(message.fen, message.hintCount);
  if (!preparation.ok) {
    emitError(requestId, preparation.reason, 'Maia-3 needs a complete position with legal moves.', { suggestion: 'wait' });
    return;
  }
  const sideToMoveElo = MaiaContract.normalizeRating(message.ratingContext?.sideToMoveElo);
  const linkedRatings = message.ratingContext?.linkedRatings !== false;
  const opponentElo = linkedRatings
    ? sideToMoveElo
    : MaiaContract.normalizeRating(message.ratingContext?.opponentElo);
  const started = Date.now();
  try {
    const feeds = {
      [model.inputs.tokens.name]: new ORT.Tensor('float32', preparation.tokens, [1, 64, 12]),
      [model.inputs.sideToMoveElo.name]: new ORT.Tensor('float32', Float32Array.of(sideToMoveElo), [1]),
      [model.inputs.opponentElo.name]: new ORT.Tensor('float32', Float32Array.of(opponentElo), [1])
    };
    const outputs = await activeSession.run(feeds);
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      emitError(requestId, 'cancelled', 'Maia analysis was cancelled.', { suggestion: 'none' });
      return;
    }
    const policyTensor = outputs[model.outputs.policy.name];
    const ldwTensor = outputs[model.outputs.ldw.name];
    if (!policyTensor || !ldwTensor) throw new Error('Maia model output is incomplete.');
    const policy = MaiaPreprocess.decodePolicy(message.fen, policyTensor.data, message.hintCount);
    if (!policy.ok) {
      emitError(requestId, policy.reason, 'Maia-3 could not build a legal move policy.', { suggestion: 'retry' });
      return;
    }
    const outcome = message.showHumanOutcome === false ? null : MaiaPreprocess.decodeLdw(ldwTensor.data);
    const data = MaiaContract.buildAnalysis({
      fen: message.fen,
      requestId,
      timestamp: Date.now(),
      elapsedMs: Date.now() - started,
      model: modelMetadata(model),
      ratingContext: { sideToMoveElo, opponentElo, linkedRatings },
      hintCount: message.hintCount,
      history: model.history,
      moves: policy.moves,
      humanOutcome: outcome,
      showHumanOutcome: message.showHumanOutcome,
      warnings: message.historyUnavailable && model.history.stateCount > 1
        ? ['Full game history is unavailable for this position.']
        : []
    });
    if (data.error) {
      emitError(requestId, data.errorDetail?.code, data.errorDetail?.message, data.errorDetail);
      return;
    }
    postMessage({ type: 'maia-result', requestId, data });
  } catch (error) {
    emitError(requestId, 'inference_failed', errorMessage(error), { suggestion: 'retry' });
  }
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.protocol !== PROTOCOL) {
    emitError(message.requestId, 'protocol_mismatch', 'Unsupported Maia worker protocol.', { suggestion: 'retry' });
    return;
  }
  const modelId = message.modelId || MaiaModelManifest.DEFAULT_MODEL_ID;
  switch (message.type) {
    case 'maia-worker-init': {
      const model = MaiaModelManifest.get(modelId);
      if (activeSession && activeModelId === model.id) {
        emitStatus({ state: 'ready', modelId: model.id, progress: 100, detail: `${model.displayName} is already ready.` });
      } else {
        loadStoredModel(model);
      }
      break;
    }
    case 'maia-worker-status':
      postMessage({ type: 'maia-status-result', requestId: String(message.requestId || ''), status: publicStatus() });
      break;
    case 'maia-worker-install':
      installModel(modelId);
      break;
    case 'maia-worker-cancel-install':
      if (activeDownload?.controller) activeDownload.controller.abort();
      break;
    case 'maia-worker-remove':
      removeModel(modelId);
      break;
    case 'maia-worker-cancel':
      if (message.requestId) cancelledRequests.add(String(message.requestId));
      break;
    case 'maia-worker-predict':
      predictionQueue = predictionQueue
        .catch(() => {})
        .then(() => predict(message));
      break;
    default:
      emitError(message.requestId, 'unknown_request', 'Unknown Maia worker request.', { suggestion: 'none' });
  }
};

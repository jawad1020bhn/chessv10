/* Maia local inference offscreen host. */
(function () {
  'use strict';

  const WORKER_PATH = 'engine/maia/maia-worker.js';
  const PROTOCOL = 'maia-host/v1';
  const REQUEST_TIMEOUTS = Object.freeze({
    predict: 45000,
    status: 12000
  });

  let worker = null;
  let currentModelId = 'maia3-browser-fp16';
  const pending = new Map();

  function sendRuntimeEvent(data) {
    try {
      const result = chrome.runtime.sendMessage({ type: 'maia_host_event', protocol: PROTOCOL, data });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }

  function settle(requestId, response) {
    const pendingRequest = pending.get(requestId);
    if (!pendingRequest) return false;
    pending.delete(requestId);
    clearTimeout(pendingRequest.timer);
    try { pendingRequest.respond(response); } catch (_) {}
    return true;
  }

  function failAllPending(message) {
    for (const [requestId, request] of pending.entries()) {
      pending.delete(requestId);
      clearTimeout(request.timer);
      try {
        request.respond({
          ok: false,
          error: { code: 'worker_unavailable', message, suggestion: 'retry' }
        });
      } catch (_) {}
    }
  }

  function attachWorker(nextWorker) {
    nextWorker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'maia-result') {
        settle(String(message.requestId || ''), { ok: true, data: message.data });
        return;
      }
      if (message.type === 'maia-status-result') {
        settle(String(message.requestId || ''), { ok: true, status: message.status });
        return;
      }
      if (message.type === 'maia-error') {
        const response = { ok: false, error: message.error || { code: 'maia_error', message: 'Maia-3 is unavailable.', suggestion: 'retry' } };
        if (!settle(String(message.requestId || ''), response)) sendRuntimeEvent(message);
        return;
      }
      if (message.type === 'maia-status' || message.type === 'maia-progress') {
        sendRuntimeEvent(message);
      }
    };
    nextWorker.onerror = event => {
      const message = event?.message || 'The Maia local inference worker stopped unexpectedly.';
      failAllPending(message);
      if (worker === nextWorker) {
        try { nextWorker.terminate(); } catch (_) {}
        worker = null;
      }
      sendRuntimeEvent({ type: 'maia-error', error: { code: 'worker_crashed', message, suggestion: 'retry' } });
    };
    nextWorker.onmessageerror = () => {
      const message = 'The Maia local inference worker sent an invalid response.';
      failAllPending(message);
      if (worker === nextWorker) {
        try { nextWorker.terminate(); } catch (_) {}
        worker = null;
      }
      sendRuntimeEvent({ type: 'maia-error', error: { code: 'worker_protocol_error', message, suggestion: 'retry' } });
    };
  }

  function getWorker(modelId) {
    if (worker) return worker;
    currentModelId = modelId || currentModelId;
    worker = new Worker(chrome.runtime.getURL(WORKER_PATH));
    attachWorker(worker);
    worker.postMessage({ protocol: PROTOCOL, type: 'maia-worker-init', modelId: currentModelId });
    return worker;
  }

  function postWithReply(type, message, sendResponse, timeout) {
    // The panel/background may supply a request ID so a settings change or
    // engine switch can discard an older same-FEN response. Preserve it across
    // every hop; generate one only for host callers that do not provide one.
    const suppliedRequestId = String(message?.requestId || '');
    const requestId = suppliedRequestId && !pending.has(suppliedRequestId)
      ? suppliedRequestId
      : (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        try {
          sendResponse({
            ok: false,
            error: { code: 'host_timeout', message: 'Maia-3 took too long to respond.', suggestion: 'retry' }
          });
        } catch (_) {}
      }
    }, timeout);
    pending.set(requestId, { respond: sendResponse, timer });
    try {
      getWorker(message.modelId).postMessage({ ...message, protocol: PROTOCOL, type, requestId });
    } catch (error) {
      settle(requestId, { ok: false, error: { code: 'host_unavailable', message: String(error?.message || error), suggestion: 'retry' } });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'maia-offscreen' || message?.protocol !== PROTOCOL || sender?.id !== chrome.runtime.id) return false;
    const modelId = message.modelId || currentModelId;
    currentModelId = modelId;
    switch (message.type) {
      case 'maia_host_ping':
        getWorker(modelId);
        sendResponse({ ok: true, host: 'ready' });
        return false;
      case 'maia_status':
        postWithReply('maia-worker-status', { modelId }, sendResponse, REQUEST_TIMEOUTS.status);
        return true;
      case 'maia_predict':
        postWithReply('maia-worker-predict', message, sendResponse, REQUEST_TIMEOUTS.predict);
        return true;
      case 'maia_install':
        getWorker(modelId).postMessage({ protocol: PROTOCOL, type: 'maia-worker-install', modelId });
        sendResponse({ ok: true, accepted: true });
        return false;
      case 'maia_cancel_install':
        getWorker(modelId).postMessage({ protocol: PROTOCOL, type: 'maia-worker-cancel-install', modelId });
        sendResponse({ ok: true, accepted: true });
        return false;
      case 'maia_remove':
        getWorker(modelId).postMessage({ protocol: PROTOCOL, type: 'maia-worker-remove', modelId });
        sendResponse({ ok: true, accepted: true });
        return false;
      case 'maia_cancel':
        getWorker(modelId).postMessage({ protocol: PROTOCOL, type: 'maia-worker-cancel', requestId: message.requestId });
        sendResponse({ ok: true, accepted: true });
        return false;
      default:
        sendResponse({ ok: false, error: { code: 'unknown_host_request', message: 'Unknown Maia host request.', suggestion: 'none' } });
        return false;
    }
  });
})();

/* Background-side client for the Maia offscreen inference host. */
(function (root) {
  'use strict';

  const OFFSCREEN_PATH = 'offscreen.html';
  const PROTOCOL = 'maia-host/v1';
  // Chrome 114 added the WORKERS reason; manifest.json pins that minimum.
  const OFFSCREEN_REASON = 'WORKERS';
  const IDLE_CLOSE_MS = 2 * 60 * 1000;
  let creationPromise = null;
  let activeRequests = 0;
  let idleCloseTimer = null;

  function chromeApi() {
    if (!root.chrome?.runtime) throw new Error('Chrome extension APIs are unavailable.');
    return root.chrome;
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function runtimeMessage(message) {
    const chrome = chromeApi();
    const result = chrome.runtime.sendMessage(message);
    const response = result && typeof result.then === 'function' ? await result : result;
    if (!response) throw new Error('The Maia local host did not respond.');
    return response;
  }

  async function hostExists() {
    const chrome = chromeApi();
    const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
    if (typeof chrome.runtime.getContexts === 'function') {
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [documentUrl]
        });
        return Array.isArray(contexts) && contexts.length > 0;
      } catch (_) {
        // Older/enterprise Chromium variants can expose a partial method;
        // retain the service-worker client fallback below.
      }
    }
    if (root.clients && typeof root.clients.matchAll === 'function') {
      const clients = await root.clients.matchAll({ type: 'window', includeUncontrolled: true });
      return clients.some(client => client.url === documentUrl);
    }
    return false;
  }

  async function ensureHost() {
    const chrome = chromeApi();
    if (await hostExists()) return;
    if (!chrome.offscreen?.createDocument) {
      throw new Error('This Chrome version cannot start Maia local inference.');
    }
    if (!creationPromise) {
      creationPromise = (async () => {
        if (await hostExists()) return;
        try {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_PATH,
            reasons: [OFFSCREEN_REASON],
            justification: 'Run the user-installed Maia-3 ONNX model locally for chess move-policy hints.'
          });
        } catch (error) {
          // A simultaneous service-worker wakeup may have created it first.
          if (!(await hostExists())) throw error;
        }
      })().finally(() => { creationPromise = null; });
    }
    await creationPromise;
    // The document can exist a fraction before its listener is registered.
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const response = await runtimeMessage({ target: 'maia-offscreen', protocol: PROTOCOL, type: 'maia_host_ping' });
        if (response?.ok) return;
      } catch (error) {
        lastError = error;
      }
      await delay(75 * (attempt + 1));
    }
    throw lastError || new Error('The Maia local host did not become ready.');
  }

  function clearIdleClose() {
    if (idleCloseTimer) {
      clearTimeout(idleCloseTimer);
      idleCloseTimer = null;
    }
  }

  function scheduleIdleClose() {
    clearIdleClose();
    idleCloseTimer = setTimeout(async () => {
      idleCloseTimer = null;
      if (activeRequests > 0) {
        scheduleIdleClose();
        return;
      }
      try { await closeHost(); } catch (_) {}
    }, IDLE_CLOSE_MS);
  }

  async function request(type, payload = {}) {
    clearIdleClose();
    activeRequests++;
    let keepHostAlive = type === 'maia_install';
    try {
      await ensureHost();
      const response = await runtimeMessage({ target: 'maia-offscreen', protocol: PROTOCOL, type, ...payload });
      // A status read can occur while a streamed install/session startup is
      // still active. Do not arm the idle closer in that state: closing the
      // offscreen document would terminate the worker mid-install.
      if (type === 'maia_status' && ['downloading', 'loading'].includes(response?.status?.state)) {
        keepHostAlive = true;
      }
      if (response?.ok === false && response.error) return response;
      return response;
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      // Installation is asynchronous: terminal worker status events notify
      // background, which then schedules cleanup. Predict/status calls may
      // schedule a close only when no long-running install is reported.
      if (!keepHostAlive) scheduleIdleClose();
    }
  }

  function validateModelId(modelId) {
    const manifest = root.MaiaModelManifest;
    return manifest?.has?.(modelId) ? modelId : manifest?.DEFAULT_MODEL_ID || modelId;
  }

  async function getStatus(modelId) {
    return request('maia_status', { modelId: validateModelId(modelId) });
  }

  async function install(modelId) {
    return request('maia_install', { modelId: validateModelId(modelId) });
  }

  async function cancelInstall(modelId) {
    return request('maia_cancel_install', { modelId: validateModelId(modelId) });
  }

  async function remove(modelId) {
    return request('maia_remove', { modelId: validateModelId(modelId) });
  }

  async function cancel(requestId, modelId) {
    return request('maia_cancel', { requestId, modelId: validateModelId(modelId) });
  }

  async function predict(payload = {}) {
    return request('maia_predict', {
      ...payload,
      modelId: validateModelId(payload.modelId)
    });
  }

  async function closeHost() {
    clearIdleClose();
    const chrome = chromeApi();
    if (!chrome.offscreen?.closeDocument || !(await hostExists())) return;
    await chrome.offscreen.closeDocument();
  }

  const exported = Object.freeze({
    OFFSCREEN_PATH,
    PROTOCOL,
    ensureHost,
    getStatus,
    install,
    cancelInstall,
    remove,
    cancel,
    predict,
    scheduleIdleClose,
    closeHost
  });

  root.MaiaEngineClient = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

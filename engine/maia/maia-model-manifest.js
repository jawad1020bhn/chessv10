/*
 * Maia-3 model manifest.
 *
 * The executable runtime stays packaged with the extension. This manifest
 * describes a user-downloaded ONNX data asset whose immutable revision and
 * SHA-256 are checked before it is activated.
 */
(function (root) {
  'use strict';

  const MODEL_DOWNLOAD_ORIGIN = 'https://raw.githubusercontent.com/*';
  const DEFAULT_MODEL_ID = 'maia3-browser-fp16';

  // The first release uses the approved Maia platform browser artifact. Keep
  // the commit SHA in the URL so `main` changes cannot alter model behavior.
  // Its input contract is deliberately explicit: this browser artifact uses a
  // single current-board tensor, unlike the separate history-8 checkpoint path.
  const MODELS = Object.freeze({
    [DEFAULT_MODEL_ID]: Object.freeze({
      id: DEFAULT_MODEL_ID,
      displayName: 'Maia-3 browser model',
      family: 'Maia-3',
      artifactVersion: '3',
      sourceRevision: '0013cc8e6ec52c88f5b3d694781d4cc8427cb91a',
      url: 'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/0013cc8e6ec52c88f5b3d694781d4cc8427cb91a/public/maia3/maia3_simplified.onnx',
      expectedBytes: 45683686,
      sha256: '405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856',
      history: Object.freeze({
        mode: 'current-position-model',
        stateCount: 1,
        detail: 'This approved browser artifact uses the current board only.'
      }),
      inputs: Object.freeze({
        tokens: Object.freeze({ name: 'tokens', type: 'float32', shape: ['batch', 64, 12] }),
        sideToMoveElo: Object.freeze({ name: 'elo_self', type: 'float32', shape: ['batch'] }),
        opponentElo: Object.freeze({ name: 'elo_oppo', type: 'float32', shape: ['batch'] })
      }),
      outputs: Object.freeze({
        policy: Object.freeze({ name: 'logits_move', type: 'float32', shape: ['batch', 4352] }),
        ldw: Object.freeze({ name: 'logits_value', type: 'float32', shape: ['batch', 3] })
      })
    })
  });

  function has(modelId) {
    // Do not let inherited names such as `__proto__` pass model validation
    // when a persisted setting or message supplies an arbitrary string.
    return Object.prototype.hasOwnProperty.call(MODELS, modelId);
  }

  function get(modelId) {
    return has(modelId) ? MODELS[modelId] : MODELS[DEFAULT_MODEL_ID];
  }

  const exported = Object.freeze({
    DEFAULT_MODEL_ID,
    MODEL_DOWNLOAD_ORIGIN,
    MODELS,
    get,
    has
  });

  root.MaiaModelManifest = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

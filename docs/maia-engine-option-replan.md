# Maia-3 as a Full Engine Option — Revised Implementation Plan

**Plan date:** 2026-09-18  
**Supersedes:** the product recommendation in [`maia-engine-upgrade-report.md`](./maia-engine-upgrade-report.md)  
**Planning assumption:** the requester has confirmed all required rights for Maia-3 code, weights, conversion, caching, and educational extension distribution.

---

## 1. Decision and scope

Maia-3 will be a **first-class selectable engine** in Chess Hint Assistant.

It will have:

- its own engine selector entry;
- its own settings section, independent of objective-engine sources and the existing heuristic “Play human” controls;
- an explicit model install/status/remove lifecycle;
- direct move hints from its legal-move policy;
- its own result contract, renderer, tests, verified model storage, and worker runtime;
- optional, separately requested objective comparison later—not an implicit dependency on the other engines.

> **Implementation update (2026-09-18):** The implemented v1 uses the approved, commit-pinned `maia3_simplified.onnx` browser artifact as model ID `maia3-browser-fp16`, rather than the hypothetical Maia3-5M export described in this earlier planning draft. Its verified 45,683,686-byte SHA-256 is recorded in [`maia-v1-runtime.md`](./maia-v1-runtime.md); it has a `[1, 64, 12]` current-position input contract. The former eight-state/5M path remains a future replacement only after an independently pinned browser export and golden vectors exist.

The initial engine runs locally in the browser. Larger variants remain out of the first implementation scope until they pass the same correctness and performance gates.

### What “full engine option” means here

“Full” means Maia is selectable at the same routing, status, refresh, persistence, and hint-rendering level as the current engine path. Selecting Maia causes a Maia analysis request, returns Maia’s own top legal moves, and drives the main hint presentation.

It does **not** mean falsifying the model’s output to imitate an objective search engine. Maia still produces a ranking of likely human moves, not a centipawn score, search depth, mate proof, or multi-ply principal variation. The engine option must preserve that distinction in the UI and data schema.

---

## 2. User-facing behavior

### Engine selector

Replace the current ambiguous two-way “Engine / Human” choice with a top-level **Analysis engine** selector:

| Option | What it does | Uses |
|---|---|---|
| **Objective engine** | Existing best-move coaching, tactical hints, evaluation bar, PVs, and source failover | Chess-API, Lichess Cloud, Masters Explorer, tablebase, local fallback, and current style controls |
| **Maia-3** | Gives direct hints for the legal move(s) a similarly rated human is most likely to choose | Downloaded Maia model only; no cloud-engine request by default |

The existing `humanLikeMode` is retained beneath **Objective engine settings** as a separate, clearly named mode:

> **Human-style objective hints** — uses the existing HumanForm heuristic to choose among safe objective candidates.

It is not renamed Maia, and Maia does not inherit its 600–1600 sparring slider or its style reranking.

### Maia main hint

When Maia is selected and the model is ready, the leading Maia policy row is its highest-probability legal move:

```text
Maia-3 likely move
Nf3
Likely choice: 38%  •  1500 vs 1500 Lichess Blitz  •  Current position only
```

The alternatives panel shows the next configured top moves:

```text
Other likely moves
1. Nf3   38%
2. d4    27%
3. c4    18%
```

The card must always include this short disclosure:

> Maia-3 predicts likely human moves. It is not an objective best-move evaluation.

If configured, a separate **Human outcome tendency** row can show the modelled W/D/L probabilities with the perspective stated in words. It must not appear in the objective evaluation bar or be called “evaluation.”

### Maia-only behavior

When `analysisEngine === 'maia3'`:

- `request_analysis` routes to Maia; it does **not** call `performCloudAnalysis` by default.
- Existing cloud-source checkboxes, analysis quality, candidate line count, and aggressive/ultra style controls do not affect Maia output. They remain visible only in an **Objective engine** settings section.
- The current centipawn evaluation bar, evaluation sparkline, last-move “accuracy,” critical-moment score swing, threat/mate claims, and engine PV text are hidden or replaced by a neutral “Objective analysis is not active” state.
- A stale objective result must never remain visible after switching to Maia.
- A missing/failed Maia model must show its own install/retry status. It must not silently substitute Chess-API, Lichess Cloud, or the local alpha-beta engine; that would violate the selected-engine promise.

An explicit future **Compare with objective engine** button may request a second analysis. It is separate from normal Maia hints, uses the user’s enabled sources and the existing coordinator, and presents results side-by-side.

### Maia move profiling after the user moves

V1 does not grade a played move with Maia. Its policy rows expose rank, SAN/UCI, and legal-policy percentage only. They are clearly headed **Likely human moves** and described as a learned human prediction, never a judgement of chess quality. A future played-move profile would need its own pre-move policy capture and must use likelihood wording rather than Objective’s “Best / Good / Blunder” grades.

---

## 3. Separate Maia settings

Create a dedicated **Maia-3 engine** section. Do not put Maia controls under “Analysis sources,” because it is neither a remote source nor a quality profile for an objective engine.

### Proposed persisted settings

Use flat settings initially to match the current storage and migration style:

```js
{
  analysisEngine: 'objective',       // 'objective' | 'maia3'

  // Maia-only configuration
  maiaModelId: 'maia3-browser-fp16',
  maiaSideToMoveElo: 1500,
  maiaOpponentElo: 1500,
  maiaLinkRatings: true,
  maiaHintCount: 3,                 // 1 | 3 | 5
  maiaShowHumanOutcome: true,
  maiaAutoAnalyze: false            // manual by default in review contexts
}
```

Use **Side to move rating** rather than “your rating” in the UI. Maia always predicts the player whose turn appears in the FEN; that player may be the opponent or a reviewed historical player. Automatic Maia analysis remains tied to the selected player's turn, while an explicit Refresh in a permitted review/study/completed-game context may inspect either side to move. The opponent rating is still a model input. A “Keep ratings equal” switch updates both values together.

Clamp UI values to the model’s documented 600–2600 Lichess Blitz range. Store them separately from `sparringStrength`, which remains the 600–1600 HumanForm setting.

### Proposed Maia settings UI

```text
Analysis engine
  [ Objective engine ] [ Maia-3 ]

Maia-3 engine                                  (shown when Maia is selected)
  Model: Maia-3 browser model (recommended)                 [Manage model]
  Status: Not installed / Downloading / Ready

  Predict side to move:  [ 1500 ] Lichess Blitz
  Opponent rating:       [ 1500 ] Lichess Blitz  [Keep equal]
  Likely moves to show:  [ 1 ] [ 3 ] [ 5 ]
  [x] Show human game outlook
  [ ] Analyze automatically during eligible review

  Current context: Current-position browser model (no invented history)
  [Download Maia-3 browser model] [Cancel] [Remove model]
  Maia predicts human moves, not an objective best move.
```

When **Objective engine** is selected, show a separate section containing the existing quality, candidate-lines, style, HumanForm, and source toggles. Switching engines does not erase the other engine’s configuration.

### Migration rules

1. Default all existing users to `analysisEngine: 'objective'`.
2. Preserve `humanLikeMode` and `sparringStrength` exactly. Do not turn them into Maia values.
3. Add Maia defaults only if absent; never initiate a model download during migration.
4. Clamp malformed persisted Maia ratings to 1500 and `maiaHintCount` to 3.
5. On model changes, retain the prior verified blob until the replacement is validated.

---

## 4. Engine routing and result contracts

### Routing change

Refactor the current `request_analysis` handler into a small engine dispatcher:

```text
request_analysis
  ├─ validate FEN, tab, current position, and eligibility
  ├─ load + normalize settings
  ├─ if analysisEngine === 'maia3'
  │    └─ performMaiaAnalysis(...)
  └─ otherwise
       └─ performCloudAnalysis(...)
```

`performCloudAnalysis` stays the objective path. `performMaiaAnalysis` is a new local-engine path and must not be added to `semanticSourceOrder()` or the normal `api-coordinator` provider list.

Track active analysis by **engine and position**, not one global `lastAnalyzedFen`. Otherwise switching from Objective to Maia on the same FEN could be incorrectly deduplicated, or a Maia response could overwrite an objective response.

Suggested state shape:

```js
const engineAnalysisState = {
  objective: { lastFenKey: null, inProgress: false },
  maia3:     { lastFenKey: null, inProgress: false }
};
```

Every request also carries the existing tab/position generation token. A response is rendered only if its engine ID, FEN key, and generation all still match the active request.

### Maia analysis result

Use a native Maia result instead of inserting pseudo-centipawns into `AnalysisContract`:

```js
{
  kind: 'maia-analysis/v1',
  engineId: 'maia3',
  source: 'maia3-local',
  fen: '<complete current FEN>',
  positionKey: '<canonical key>',
  requestId: '<uuid>',
  timestamp: 0,
  elapsedMs: 0,

  model: {
    id: 'maia3-browser-fp16',
    displayName: 'Maia-3 browser model',
    artifactVersion: '3',
    sourceRevision: '0013cc8e6ec52c88f5b3d694781d4cc8427cb91a',
    sha256: '405bf76c…75b856'
  },

  ratingContext: {
    sideToMoveElo: 1500,
    opponentElo: 1500,
    scale: 'lichess-blitz',
    linkedRatings: true
  },

  history: {
    mode: 'current-position-model',
    stateCount: 1,
    detail: 'This approved browser artifact uses the current board only.'
  },

  topMove: {
    uci: 'g1f3',
    rank: 1,
    probability: 0.38
  },
  moves: [
    { uci: 'g1f3', rank: 1, probability: 0.38 },
    { uci: 'd2d4', rank: 2, probability: 0.27 }
  ],

  humanOutcome: {
    enabled: true,
    scope: 'current-position',
    perspective: 'side-to-move',
    win: 0.31,
    draw: 0.42,
    loss: 0.27
  },

  status: 'ready',
  warnings: []
}
```

Required invariants:

- `topMove` is the highest-ranked **legal** policy move, not a property named `bestMove`.
- `moves` is ordered, unique, legal in the original FEN, finite, and normalized over legal actions only.
- The panel derives any displayed SAN from the **position before** the UCI move using `ChessHintEngine.uciToSan` or a shared tested helper; the native policy contract keeps UCI as its canonical move identity.
- `humanOutcome` is optional and labelled with its scope and perspective.
- The result contains no `score`, `scoreType`, `depth`, `confidence` pretending to be engine confidence, or multi-ply `pvs`.

Add `engine/maia/maia-contract.js` with a `validateMaiaAnalysis()` function. Continue to use `engine/analysis-contract.js` unchanged for objective results. Both can share legal-move helpers, but not result semantics.

### Extension messages

Keep the existing objective messages backward compatible and add dedicated Maia messages:

```text
Side panel → background
  request_analysis                 # persisted engine selection controls routing
  maia_get_status
  maia_install_model
  maia_cancel_install
  maia_remove_model

Background ↔ offscreen host
  maia-host/v1 envelope
  maia-status / maia-install / maia-cancel-install / maia-remove / maia-predict
  maia-result / maia-error / maia-status events

Background → side panel
  maia_status_update
  maia_analysis_update
  maia_analysis_error
```

Host traffic uses the packaged `maia-host/v1` protocol. Correlated requests carry a request ID and model ID; analysis requests additionally carry the existing tab/position generation context. The offscreen host accepts only same-extension messages with the matching protocol and exposes no external connection surface.

---

## 5. Maia runtime architecture

### Chosen runtime

```text
sidepanel/sidepanel.js
  │ settings + user action
  ▼
background.js
  │ validates active engine, position token, eligibility, and request ID
  ▼
offscreen.html / offscreen.js
  │ owns a dedicated worker and model lifecycle
  ▼
engine/maia/maia-worker.js
  │ local ONNX Runtime Web/Wasm session, tensor work, legal mask, output decode
  ▼
IndexedDB model blob + packaged ONNX Runtime JS/Wasm
```

This makes Maia a proper extension engine without making the ephemeral MV3 service worker or the side-panel UI responsible for a large inference session.

### Required new files

```text
offscreen.html
offscreen.js
engine/maia/maia-engine-client.js      # background-side offscreen client
engine/maia/maia-contract.js           # native settings/result validation
engine/maia/maia-model-manifest.js     # immutable approved artifact metadata
engine/maia/maia-preprocess.js         # current-position tokens, orientation, vocabulary
engine/maia/maia-worker.js             # IndexedDB lifecycle + worker-only ONNX session
vendor/onnxruntime-web/                # pinned packaged Runtime Web assets
tools/verify-maia-artifact.js          # independent byte/digest checker
docs/maia-v1-runtime.md                # provenance and browser smoke-test record
```

### Manifest changes

Add the smallest necessary extension capabilities:

- `offscreen` permission;
- an MV3-safe extension-page CSP that includes `'wasm-unsafe-eval'`;
- packaged ONNX Runtime JavaScript/Wasm assets—never a CDN runtime;
- the exact GitHub Raw model origin in both `optional_host_permissions` and `connect-src`;
- no `unlimitedStorage` permission in V1; the worker performs an advisory storage preflight before download.

The existing minimum Chrome version is 114. The offscreen implementation must include a `clients.matchAll()` fallback because `chrome.runtime.getContexts()` was introduced after that minimum version.

### Install/cache lifecycle

1. User selects Maia and chooses **Download Maia-3 browser model**.
2. Background ensures a single offscreen host exists and forwards the install request.
3. The host checks storage availability, downloads the immutable approved model, streams progress, supports cancellation, and verifies SHA-256.
4. A staged IndexedDB record becomes active only after byte-size/digest verification and successful ONNX session creation.
5. A verified cached model loads locally on future requests; inference makes no model-host network request.
6. Model failure quarantines/deletes only the invalid record and reports a specific retry/removal state.
7. **Remove model** clears the Maia artifact and releases the worker/session. V1 intentionally keeps no persistent Maia prediction cache.

Keep the active model session in the offscreen worker only while needed. Close the offscreen document on a deliberate idle timer; recreate it safely for the next request.

### Model manifest

Compile immutable information into the extension package. At minimum:

```js
{
  id: 'maia3-browser-fp16',
  displayName: 'Maia-3 browser model',
  artifactVersion: '3',
  sourceRevision: '0013cc8e6ec52c88f5b3d694781d4cc8427cb91a',
  url: 'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/0013cc8e6ec52c88f5b3d694781d4cc8427cb91a/public/maia3/maia3_simplified.onnx',
  expectedBytes: 45683686,
  sha256: '405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856',
  inputs: {
    tokens: { name: 'tokens', type: 'float32', shape: ['batch', 64, 12] },
    sideToMoveElo: { name: 'elo_self', type: 'float32', shape: ['batch'] },
    opponentElo: { name: 'elo_oppo', type: 'float32', shape: ['batch'] }
  },
  outputs: {
    policy: { name: 'logits_move', type: 'float32', shape: ['batch', 4352] },
    ldw: { name: 'logits_value', type: 'float32', shape: ['batch', 3] }
  }
}
```

The final tensor names/types/shapes are taken from the approved exported artifact and are locked by preprocessing/contract tests. The first release intentionally uses the 12-channel current-position browser artifact; a future eight-state export requires its own immutable manifest and golden vectors.

---

## 6. Maia preprocessing and history behavior

### Initial model contract

Use the approved Maia-3 browser artifact with one current board state of 64 squares × 12 piece channels. The worker supplies raw Float32 side-to-move/opponent rating inputs and visibly records that this artifact has no historical-state input.

For black-to-move positions, reproduce the reference mirroring exactly:

- mirror the board state(s) as required by the approved tokenizer;
- form legal moves in model orientation;
- mask illegal actions before softmax;
- unmirror selected actions back to standard UCI;
- revalidate every returned move against the original FEN.

### History pipeline

Add a `currentGameInfo` value in the side panel, retain it when `handlePositionUpdate()` runs, and forward it in every `request_analysis` message. V1 preserves explicit `historyQuality: 'unavailable'` rather than losing or inventing an empty history.

A future history-capable artifact may use a trustworthy payload from `content.js` only when it can derive it from authoritative site state. That future payload should contain either:

```js
{
  historyQuality: 'exact',
  initialFen: '<complete FEN>',
  uciMoves: ['e2e4', 'e7e5', ...]
}
```

or:

```js
{
  historyQuality: 'unavailable'
}
```

V1 does not reconstruct or pad historical states because the selected artifact has one current-position input. A future eight-state artifact may legally replay exact moves and label any padding separately; it must never infer history from board placement.

Never infer move history, castling rights, en-passant state, or prior FENs from board placement alone. If the current FEN itself is incomplete/unreliable, return a Maia-specific unavailable error rather than a move hint.

### Policy and WDL decoding

- Build the full legal-action mask from the complete FEN.
- Set every nonlegal action to negative infinity before stable softmax.
- Sort and return only the configured top 1, 3, or 5 legal moves.
- Do not sample moves for hint mode. The same FEN, ratings, and model must return the same displayed ordering.
- Decode LDW in its model-defined perspective. A current-position WDL is a modelled human-game outlook, not a score for each candidate move.
- Candidate-specific WDL, if added later, requires successor-position inference with correct side/rating swap and perspective inversion. It is not part of the first engine option.

---

## 7. Side-panel rendering changes

### New panel state

Maintain independent state so engine switches are safe:

```js
let settings = { analysisEngine: 'objective', /* independent Maia settings */ };
let lastAnalysis = null;             // Objective result only
let lastMaiaAnalysis = null;         // Native maia-analysis/v1 result only
let currentGameInfo = { historyQuality: 'unavailable' };
let maiaModelStatus = { state: 'not-installed' };
let expectedMaiaRequestId = null;
```

On engine switch:

1. Persist `analysisEngine`.
2. Invalidate/ignore in-flight results from the other engine using engine ID + position token.
3. Clear the hero card and engine-specific supporting areas.
4. Hide any stale objective evaluation components in Maia mode.
5. Show a Maia readiness prompt or request the current position only after the model is ready and the user initiates analysis (unless `maiaAutoAnalyze` is enabled in an eligible review context).

### Maia rendering functions

Add separate functions rather than branching every objective renderer indefinitely:

```text
handleMaiaAnalysisResult(data)
handleMaiaAnalysisError(data)
handleMaiaStatusUpdate(data)
renderMaiaAnalysis(data)
renderMaiaEmptyState(reason)
renderMaiaPending()
renderMaiaModelStatus(status)
updateEngineModeUI()
```

`renderMaiaAnalysis()` creates its ordered policy rows and uses the existing tested UCI-to-SAN helper only for display. It does not call `generateHints()`, `selectPVForStyle()`, `updateEvalBar()`, `renderCriticalMoment()`, or `renderMoveClassification()` with Maia data.

### Diagnostics

The Maia settings card owns the local model diagnostic state:

```text
Maia-3 browser model · pinned v3
Not installed / Downloading / Loading / Ready locally / Needs attention
43.6 MB local download · progress · Download / Cancel / Remove
```

This state is distinct from the remote provider-health list and never contributes to cloud request counts. The normal **Clear caches** button leaves the downloaded IndexedDB model intact; only **Remove model** deletes it.

---

## 8. Implemented file map

| File | V1 implementation |
|---|---|
| `manifest.json` | Declares the MV3 offscreen permission, a Wasm-safe extension CSP, and the narrow optional GitHub Raw download origin. All runtime code remains packaged. |
| `background.js` | Normalizes independent Maia settings, dispatches selected Maia requests without entering the cloud coordinator, tracks per-engine position/in-progress state, applies fair-play eligibility, and owns install/status/remove routing. |
| `content.js` | Labels recognised analysis, study, and visibly completed-game contexts; unknown/live contexts fail closed. It explicitly reports unavailable history because V1 does not infer it from page DOM. |
| `engine/analysis-contract.js`, `engine/api-coordinator.js`, objective engines | Remain objective-only. Maia is neither a provider nor a pseudo-PV result. |
| `engine/maia/maia-contract.js` | Defines the native `maia-analysis/v1` schema, settings normalization, legal-policy validation, and Maia-specific errors. |
| `engine/maia/maia-model-manifest.js` | Pins the single approved version-3 browser artifact, source revision, byte length, SHA-256, and exact current-position tensor contract. |
| `engine/maia/maia-preprocess.js` | Builds `[1, 64, 12]` tokens, applies Black-side normalization, maps all 4,352 actions, masks legal moves, and decodes policy/LDW logits. |
| `engine/maia/maia-engine-client.js`, `offscreen.*`, `engine/maia/maia-worker.js` | Provide a protocol-tagged background/offscreen/worker host, verified IndexedDB model storage, Wasm inference, lifecycle commands, and idle-host cleanup. |
| `sidepanel/sidepanel.{html,css,js}` | Provides the top-level engine choice, distinct Maia controls, install/progress/cancel/remove UI, safe engine-specific rendering, and visible likelihood wording. |
| `vendor/onnxruntime-web/` | Contains the pinned locally packaged ONNX Runtime Web assets and licence/notice. |
| `tools/verify-maia-artifact.js`, `docs/maia-v1-runtime.md` | Provide independent artifact verification and release/runtime smoke-test instructions. |
| `tests/maia-*.test.js` | Cover preprocessing, native contract behavior, background routing, UI wiring, and static runtime safety guards. |

---

## 9. Delivery phases

### Phase 1 — Engine selection, contract, and routing — complete

- Added `analysisEngine: 'objective' | 'maia3'` with safe defaults for existing users.
- Kept Maia ratings, hint count, outlook, and auto-analysis settings independent from objective sources and HumanForm.
- Added `maia-analysis/v1`; it has legal policy moves and no centipawn, depth, mate claim, or invented PV fields.
- Added per-engine position/in-progress bookkeeping and mode/FEN/generation checks so a late result cannot render in the other engine mode.
- Proved selected Maia routing does not call the objective cloud path by default.

### Phase 2 — Approved artifact and deterministic core — complete

- Pinned `maia3_simplified.onnx`, model ID `maia3-browser-fp16`, artifact version `3`, source revision `0013cc8e6ec52c88f5b3d694781d4cc8427cb91a`, byte length `45,683,686`, and its SHA-256 in the packaged manifest.
- Implemented the approved `[1, 64, 12]` current-position preprocessing contract and Float32 Elo inputs.
- Implemented Black orientation, castling, en passant, promotion/underpromotion action decoding, legal-only softmax, and post-decode legal validation.
- Added a standalone verifier and regression fixtures. The real artifact has also passed a local Wasm inference smoke test.

### Phase 3 — MV3 local runtime and model lifecycle — complete

- Packaged ONNX Runtime Web/Wasm; no runtime script or model executable code is loaded from a CDN.
- Added a single offscreen host with a Chrome-114-compatible document lookup fallback and `maia-host/v1` protocol checks.
- Added streamed download progress, cancellation, byte-count/SHA-256 verification, staged session creation, IndexedDB persistence, cached-model re-verification, corruption recovery, removal, and idle close scheduling.
- Kept inference off the side-panel thread and released staged sessions when installation promotion fails.

### Phase 4 — Direct Maia hint experience and fair play — complete

- Maia has a leading legal policy move, ordered likely alternatives, probability labels, ratings disclosure, and optional current-position human outcome tendency.
- Objective evaluation widgets remain hidden in Maia mode; there is no silent fallback to cloud or local objective engines.
- Maia requests are manual by default and are denied outside supported analysis-board, study, or completed-game contexts. No move or board interaction is automated.

### Phase 5 — Release validation — remaining manual work

Automated syntax checks, manifest validation, `git diff --check`, the full Node test suite, artifact verification, and a direct local inference smoke test pass. Before publishing, perform the browser matrix below in real Chrome:

1. Load the unpacked extension and grant the optional model-download permission.
2. Download the model; verify progress, exact digest failure handling, IndexedDB persistence, restart/offline cached load, retry, cancel, and remove.
3. Confirm the offscreen worker starts, local inference returns legal hints, and idle cleanup/recreation works.
4. Confirm switching engine modes during an in-flight request never exposes stale objective or Maia content.
5. Exercise keyboard-only and reduced-motion UI, safe/denied page contexts, and low-storage/network interruption paths.

The prior Playwright Chromium download attempt was blocked by external TLS resets, so this browser validation is not yet recorded as complete.

### Phase 6 — Future artifact/features, explicitly outside V1

A future history-capable or larger Maia export must have its own immutable manifest, source provenance, exact input contract, golden vectors, storage/benchmark budget, and user-facing context disclosure. That is the only context in which the historical eight-state discussion in this document applies. Other possible future work is a separately downloadable larger model, explicit multi-rating comparison, optional WebGPU/WebNN acceleration, and candidate-specific modelled outcomes.

---

## 10. Acceptance criteria

### Product behavior

- [x] Maia-3 is a top-level engine option, not a style flag or cloud source checkbox.
- [x] Maia settings are separate from objective sources, quality, styles, HumanForm, and sparring strength.
- [x] Maia produces a direct legal top-move hint and 1/3/5 likely alternatives.
- [x] Maia selection bypasses cloud objective-engine requests by default.
- [x] Missing/downloading/error states are recoverable and never silently select another engine.
- [x] Objective mode retains its existing behavior and does not render Maia data.
- [x] Engine mode, FEN, request, and position-generation guards prevent stale cross-engine rendering.

### Correctness behavior

- [x] Display-bound Maia moves are validated as legal in the complete original FEN.
- [x] Black normalization, castling, en passant, White promotion, and Black underpromotion have regression coverage.
- [x] Policy percentages are normalized only across legal actions.
- [x] The current-position-only context is recorded and visible; V1 has no padded or invented history.
- [x] Native results contain no fabricated objective score, depth, mate claim, or PV.

### Extension/runtime behavior

- [x] ONNX Runtime assets, worker scripts, and executable code are packaged; no remote code executes.
- [x] The model is user-installed, byte-count/SHA-256 verified, stored in IndexedDB rather than `chrome.storage.local`, and removable.
- [x] The offscreen host handles concurrent creation, protocol tagging, and Chrome-114 lookup fallback.
- [x] Inference runs outside the panel UI thread.
- [ ] Complete real-Chrome unpacked-extension validation remains required before release.

### Educational/fair-play behavior

- [x] Recognised analysis/study/completed-game contexts are allowed; known live, unknown, and unverified contexts are denied before inference.
- [x] Maia is manual by default and does not automate a move or board interaction.
- [x] “Likely” / human-prediction wording remains alongside Maia hints.

---

## 11. Test and release plan

### Automated coverage included in V1

```text
tests/maia-preprocess.test.js
tests/maia-background-routing.test.js
tests/maia-runtime-safety.test.js
tests/maia-ui-wiring.test.js
tools/verify-maia-artifact.js
```

Key assertions cover settings normalization, native-result validation, legal-only masking and decoding, Black orientation, special moves, source pinning, local-only runtime safeguards, host protocol checks, lifecycle ordering, CSP/vendor packaging, selected-engine cloud bypass, safe eligibility routing, and panel wiring. Run all repository tests with:

```sh
for test in tests/*.test.js; do node "$test"; done
node tools/verify-maia-artifact.js /path/to/maia3_simplified.onnx
```

### Browser/manual matrix before release

Test Chrome 114 and current stable with a clean profile, a cached/offline model, interrupted download, insufficient storage, panel close/reopen, service-worker restart, engine switch while inference is active, keyboard-only navigation, reduced motion, safe/denied contexts, and representative positions including Black to move, castling, en passant, check, promotion, and invalid FEN. Record actual artifact bytes, installation time, cold session setup, warm inference p50/p95, memory/storage use, and recovery behavior rather than assuming performance targets.

---

## 12. Explicit V1 non-goals

- Replacing objective chess analysis or representing a learned human-move policy as Stockfish-style evaluation.
- Merging Maia probabilities into the existing HumanForm heuristic.
- Auto-downloading the model, migrating users into Maia mode, or silently falling back to a different engine.
- Using a remote undocumented website API, loading executable code from a CDN, or sampling random primary hints.
- Inventing historical states, padded history, or a history control for the approved current-position-only artifact.
- Shipping a larger/history-capable model, WebGPU/WebNN acceleration, model-vs-model play, multi-rating batches, or candidate-specific outcome inference without a separate validated release.

---

## 13. Release completion checklist

1. Run the complete automated suite and the independent artifact verifier against the release download.
2. Complete the real-Chrome manual matrix, including permission, download/integrity, IndexedDB, offline load, inference, cancel/remove, idle-host, safe-context, and engine-switch checks.
3. Re-run checks after any browser-only fix and record the tested Chrome versions and observed performance in `maia-v1-runtime.md`.
4. Keep future history-capable model work on a separately pinned/exported contract rather than changing V1 semantics in place.

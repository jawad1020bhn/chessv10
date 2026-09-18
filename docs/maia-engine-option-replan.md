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
- its own result contract, renderer, cache namespace, tests, and worker runtime;
- optional, separately requested objective comparison later—not an implicit dependency on the other engines.

The initial engine is **Maia3-5M**, running locally in the browser. Maia3-23M becomes an optional downloaded model only after it passes the same correctness and performance gates. Maia3-79M is out of the first implementation scope.

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

When Maia is the selected engine and the model is ready, the hero hint uses Maia’s highest-probability legal move:

```text
Maia-3 likely move
Nf3
Likely choice: 38%  •  1500 vs 1500 Lichess Blitz  •  Full game context
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

If configured, a separate **Human game outlook** row can show the modelled W/D/L probabilities with the perspective stated in words. It must not appear in the objective evaluation bar or be called “evaluation.”

### Maia-only behavior

When `analysisEngine === 'maia3'`:

- `request_analysis` routes to Maia; it does **not** call `performCloudAnalysis` by default.
- Existing cloud-source checkboxes, analysis quality, candidate line count, and aggressive/ultra style controls do not affect Maia output. They remain visible only in an **Objective engine** settings section.
- The current centipawn evaluation bar, evaluation sparkline, last-move “accuracy,” critical-moment score swing, threat/mate claims, and engine PV text are hidden or replaced by a neutral “Objective analysis is not active” state.
- A stale objective result must never remain visible after switching to Maia.
- A missing/failed Maia model must show its own install/retry status. It must not silently substitute Chess-API, Lichess Cloud, or the local alpha-beta engine; that would violate the selected-engine promise.

An explicit future **Compare with objective engine** button may request a second analysis. It is separate from normal Maia hints, uses the user’s enabled sources and the existing coordinator, and presents results side-by-side.

### Maia move profiling after the user moves

In Maia mode, replace objective “Best / Good / Blunder” grading with a distinctly named result:

```text
Maia move profile
You played Bxh7+ — rank 4 of 31 legal moves, 6% likely at 1500.
```

Possible labels are **very likely**, **common**, **less common**, and **unusual for this rating**. These describe model likelihood only; they do not judge chess quality. Objective grade/accuracy remains available only when objective analysis is explicitly requested.

---

## 3. Separate Maia settings

Create a dedicated **Maia-3 engine** section. Do not put Maia controls under “Analysis sources,” because it is neither a remote source nor a quality profile for an objective engine.

### Proposed persisted settings

Use flat settings initially to match the current storage and migration style:

```js
{
  analysisEngine: 'objective',       // 'objective' | 'maia3'

  // Maia-only configuration
  maiaModelId: 'maia3-5m',
  maiaSideToMoveElo: 1500,
  maiaOpponentElo: 1500,
  maiaLinkRatings: true,
  maiaHintCount: 3,                 // 1 | 3 | 5
  maiaUseExactHistory: true,
  maiaShowHumanOutcome: true,
  maiaAutoAnalyze: false            // manual by default in review contexts
}
```

Use **Side to move rating** rather than “your rating” in the UI. Maia always predicts the player whose turn appears in the FEN; that player may be the opponent or a reviewed historical player. The opponent rating is still a model input. A “Keep ratings equal” switch updates both values together.

Clamp UI values to the model’s documented 600–2600 Lichess Blitz range. Store them separately from `sparringStrength`, which remains the 600–1600 HumanForm setting.

### Proposed Maia settings UI

```text
Analysis engine
  [ Objective engine ] [ Maia-3 ]

Maia-3 engine                                  (shown when Maia is selected)
  Model: Maia3-5M (recommended)                 [Manage model]
  Status: Not installed / Downloading / Ready

  Predict side to move:  [ 1500 ] Lichess Blitz
  Opponent rating:       [ 1500 ] Lichess Blitz  [Keep equal]
  Likely moves to show:  [ 1 ] [ 3 ] [ 5 ]
  [x] Use full game context when available
  [x] Show human game outlook
  [ ] Analyze automatically during eligible review

  Current context: Full game context
  [Download Maia3-5M] [Cancel] [Remove model]
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
    id: 'maia3-5m',
    artifactVersion: '<pinned version>',
    sha256: '<artifact digest>'
  },

  ratingContext: {
    sideToMoveElo: 1500,
    opponentElo: 1500,
    scale: 'lichess-blitz',
    linkedRatings: true
  },

  history: {
    mode: 'exact-uci-history', // or 'padded-current-position'
    stateCount: 8,
    inputHash: '<non-display cache identity>'
  },

  topMove: {
    uci: 'g1f3',
    san: 'Nf3',
    rank: 1,
    probability: 0.38
  },
  moves: [
    { uci: 'g1f3', san: 'Nf3', rank: 1, probability: 0.38 },
    { uci: 'd2d4', san: 'd4',  rank: 2, probability: 0.27 }
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
- `san` is generated from the **position before** the UCI move using `ChessHintEngine.uciToSan` or a shared tested helper.
- `humanOutcome` is optional and labelled with its scope and perspective.
- The result contains no `score`, `scoreType`, `depth`, `confidence` pretending to be engine confidence, or multi-ply `pvs`.

Add `engine/maia/maia-contract.js` with a `validateMaiaAnalysis()` function. Continue to use `engine/analysis-contract.js` unchanged for objective results. Both can share legal-move helpers, but not result semantics.

### Extension messages

Keep the existing objective messages backward compatible and add dedicated Maia messages:

```text
Side panel → background
  request_analysis                 # engine selected in persisted settings
  maia_install_model
  maia_cancel_install
  maia_remove_model
  maia_get_status
  maia_cancel_analysis

Background ↔ offscreen host
  maia_host_connect/v1
  maia_install/v1
  maia_predict/v1
  maia_cancel/v1
  maia_status/v1
  maia_result/v1
  maia_error/v1

Background → side panel
  maia_status_update
  maia_analysis_update
  maia_analysis_error
```

Each message must include a protocol version, request ID, model ID, and when relevant a tab ID and position generation token. The background accepts only messages from this extension ID and never exposes an external connection surface.

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
engine/maia/maia-engine-client.js      # background-side host client
engine/maia/maia-contract.js           # pure input/output validation
engine/maia/maia-preprocess.js         # history, tokens, orientation, vocabulary
engine/maia/maia-model-store.js         # verified IndexedDB staging/promote/remove
engine/maia/maia-result-cache.js        # small, separate prediction cache
engine/maia/maia-model-manifest.js      # immutable approved artifact metadata
engine/maia/maia-worker.js              # worker-only ONNX Runtime session
engine/maia/data/maia3-moves.json       # approved 4,352-action vocabulary
vendor/onnxruntime-web/<pinned-version>/
tools/                                  # reproducible artifact/export verification
```

### Manifest changes

Add the smallest necessary extension capabilities:

- `offscreen` permission;
- an MV3-safe extension-page CSP that includes `'wasm-unsafe-eval'`;
- packaged ONNX Runtime JavaScript/Wasm assets—never a CDN runtime;
- exact model download origin in `optional_host_permissions` and `connect-src` after the artifact delivery host is final;
- `unlimitedStorage` only as an optional permission if preflight testing proves it necessary.

The existing minimum Chrome version is 114. The offscreen implementation must include a `clients.matchAll()` fallback because `chrome.runtime.getContexts()` was introduced after that minimum version.

### Install/cache lifecycle

1. User selects Maia and chooses **Download Maia3-5M**.
2. Background ensures a single offscreen host exists and forwards the install request.
3. The host checks storage availability, downloads the immutable approved model, streams progress, supports cancellation, and verifies SHA-256.
4. A staged IndexedDB record becomes active only after byte-size/digest verification and successful ONNX session creation.
5. A verified cached model loads locally on future requests; inference makes no model-host network request.
6. Model failure quarantines/deletes only the invalid record and reports a specific retry/removal state.
7. **Remove model** clears the Maia artifact and Maia prediction cache, then releases the worker/session.

Keep the active model session in the offscreen worker only while needed. Close the offscreen document on a deliberate idle timer; recreate it safely for the next request.

### Model manifest

Compile immutable information into the extension package. At minimum:

```js
{
  id: 'maia3-5m',
  displayName: 'Maia3-5M',
  artifactVersion: '...',
  url: 'https://<approved-host>/<immutable-path>',
  byteLength: 0,
  sha256: '...',
  sourceCheckpointSha256: '...',
  moveVocabularySha256: '...',
  inputs: {
    tokens: { type: 'float32', shape: ['batch', 64, 96] },
    selfElo: { type: '<approved type>', shape: ['batch'] },
    opponentElo: { type: '<approved type>', shape: ['batch'] }
  },
  outputs: {
    policy: { type: 'float32', shape: ['batch', 4352] },
    ldw: { type: 'float32', shape: ['batch', 3] }
  }
}
```

The final tensor names/types/shapes must be taken from the approved exported artifact and locked by parity tests. The shown dimensions represent the canonical released 8-state model path; do not substitute the previously observed 12-channel “simplified” browser model without an explicit artifact decision and new golden vectors.

---

## 6. Maia preprocessing and history behavior

### Initial model contract

Use the approved canonical Maia3-5M artifact with eight board-state slots. Each state has 64 squares × 12 piece channels. The worker builds the expected historical tensor and provides side-to-move/opponent rating inputs.

For black-to-move positions, reproduce the reference mirroring exactly:

- mirror the board state(s) as required by the approved tokenizer;
- form legal moves in model orientation;
- mask illegal actions before softmax;
- unmirror selected actions back to standard UCI;
- revalidate every returned move against the original FEN.

### History pipeline

Add a `currentGameInfo` value in the side panel, retain it when `handlePositionUpdate()` runs, and forward it in every `request_analysis` message. The current polling fallback creates and then loses an empty history; this must be corrected.

`content.js` should expose a trustworthy history only when it can derive it from authoritative site state. The history payload should contain either:

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

The worker reconstructs the last eight states by legally replaying the exact moves. If unavailable but the current FEN is complete and reliable, it repeats the current state to fill the history slots and sets `history.mode: 'padded-current-position'`.

Never infer move history, castling rights, en-passant state, or prior FENs from board placement alone. If the current FEN itself is incomplete/unreliable, return a Maia-specific unavailable error rather than a move hint.

### Policy and WDL decoding

- Build the full legal-action mask from the complete FEN.
- Set every nonlegal action to negative infinity before stable softmax.
- Sort and return only the configured top 1, 3, or 5 legal moves.
- Do not sample moves for hint mode. The same FEN/history/ratings/model must return the same displayed ordering.
- Decode LDW in its model-defined perspective. A current-position WDL is a modelled human-game outlook, not a score for each candidate move.
- Candidate-specific WDL, if added later, requires successor-position inference with correct side/rating swap and perspective inversion. It is not part of the first engine option.

---

## 7. Side-panel rendering changes

### New panel state

Maintain independent state so engine switches are safe:

```js
let activeEngine = 'objective';
let lastObjectiveAnalysis = null;
let lastMaiaAnalysis = null;
let currentGameInfo = { historyQuality: 'unavailable' };
let maiaRuntimeStatus = { state: 'not-installed' };
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
renderMaiaAnalysis(data)
renderMaiaHero(topMove, context)
renderMaiaAlternatives(moves)
renderMaiaOutcome(outcome)
renderMaiaMoveProfile(...)
renderMaiaModelStatus(status)
resetObjectiveOnlyUiForMaia()
```

`renderMaiaAnalysis()` may reuse existing safe visual primitives such as `renderFromTo()` and UCI-to-SAN conversion, but it must not call `generateHints()`, `selectPVForStyle()`, `updateEvalBar()`, `renderCriticalMoment()`, or `renderMoveClassification()` with Maia data.

### Diagnostics

Add a local **Maia model** status row outside the existing remote provider-health list:

```text
Maia3-5M · Local
Ready · 42 MB stored · Wasm SIMD · warm inference 183 ms
```

This data is diagnostic only. Do not report it as cloud provider health or remote request count. The normal **Clear caches** button should clear small analysis/result caches but leave a downloaded model intact unless the user explicitly chooses **Remove model**.

---

## 8. File-by-file implementation plan

| File | Change |
|---|---|
| `manifest.json` | Add `offscreen`, MV3-safe Wasm CSP, packaged runtime paths, and narrowly scoped optional model-host/storage permissions. |
| `background.js` | Import Maia client, add defaults/migration, engine dispatcher, per-engine position state, offscreen creation/Port lifecycle, install/status/remove handlers, Maia routing, and engine-specific messages. |
| `engine/analysis-contract.js` | Keep objective-only. Optionally expose shared legal helpers if that avoids duplication, but never make Maia look like a PV score result. |
| `engine/analysis-policy.js` | Add `analysisEngine` normalization/migration. Make Objective-only quality/style/source functions explicitly ignore Maia. |
| `engine/api-coordinator.js` | No Maia provider entry. Continue to protect remote calls used only by Objective mode or an explicit future comparison. |
| `engine/human-form.js` | No behavioral replacement. Rename UI labels around it to make its heuristic role clear. |
| `engine/hint-engine.js` | Keep objective behavior. Reuse only SAN/from-to primitives for Maia; do not rerank policy. |
| `engine/cloud-engine.js` | Do not add Maia as a cloud provider. Add local engine display metadata only if useful. |
| `content.js` | Add review/live eligibility and exact-history extraction where trustworthy; return explicit unavailable history otherwise. |
| `sidepanel/sidepanel.html` | Add Analysis engine selector, dedicated Maia settings panel, install/status controls, Maia disclosure, model diagnostic row, and Maia-specific result labels. |
| `sidepanel/sidepanel.css` | Style the engine selector, model progress/error states, rating controls, likelihood rows, and Maia-mode hidden objective sections accessibly. |
| `sidepanel/sidepanel.js` | Persist/forward game info, route render state by engine, render Maia outputs separately, avoid stale cross-engine UI, and manage Maia controls. |
| `engine/maia/*`, `offscreen.*`, `vendor/*`, `tools/*` | Add the isolated model runtime, artifact manifest, preprocessing, storage, tests, and reproducible vendor/export tooling. |
| `tests/*` | Add Maia core, lifecycle, migration, UI wiring, and full-engine routing coverage. |

---

## 9. Implementation phases and order

### Phase 1 — Engine selection and contracts

**Build**

- `analysisEngine` setting and safe migration.
- Objective/Maia UI sections and engine switch state reset.
- `maia-analysis/v1` contract plus a fake Maia adapter returning fixture moves.
- Per-engine dedupe/current-position state.
- Routing test proving selected Maia bypasses cloud providers.

**Done when**

- Maia appears as a selectable engine.
- Settings are fully separate.
- Existing Objective and HumanForm behavior remains unchanged.
- Fake Maia output can render top move + alternatives without an objective score/pv.

### Phase 2 — Model artifact and pure inference core

**Build**

- Pinned Maia3-5M browser artifact and immutable manifest.
- Approved 4,352-action vocabulary.
- Tensor/history builder, mirroring, legal mask, stable softmax, SAN conversion, and output validator.
- Golden vectors against the approved source model/export.

**Done when**

- Normal, black-to-move, castling, en-passant, check, and underpromotion positions match reference top-K/probabilities within agreed tolerance.
- No invalid move can leave the core.
- Padded-history output is explicitly marked when exact history is missing.

### Phase 3 — MV3 worker, storage, and model controls

**Build**

- Bundled ONNX Runtime Web/Wasm and extension CSP update.
- Offscreen host creation with Chrome-114 compatibility fallback.
- Worker request/response/cancel protocol.
- Download progress, hash verification, IndexedDB staging/atomic promotion, corruption recovery, and removal.

**Done when**

- A user can install, cancel, retry, use offline, and remove Maia3-5M.
- A model download or worker crash cannot return a stale hint.
- Model inference stays off the side-panel main thread.

### Phase 4 — Direct Maia hint experience

**Build**

- Main hero move, likelihood alternatives, rating/history disclosure, optional human outlook, and Maia move-profile view.
- Model diagnostics and engine-specific error states.
- No silent fallback to objective engine.
- Manual Maia analysis by default; optional automatic behavior only in an eligible review context.

**Done when**

- Maia operates end-to-end as the selected engine.
- Selecting it produces its own direct hints and never reuses an old objective evaluation.
- Switching between engines is immediate, clear, and safe.

### Phase 5 — Trusted history adapters and quality pass

**Build**

- Site-specific exact-history extraction where it can be proven reliable.
- Explicit history-quality messaging for every supported source.
- Performance benchmarks and accessibility/privacy review.
- Optional objective comparison button, only after the standalone Maia engine is complete.

**Done when**

- Full-context Maia works where trusted history is available.
- Elsewhere it safely and visibly uses current-position padding.
- Browser benchmark targets are met on Chrome 114 and current stable.

### Phase 6 — Optional larger model / advanced features

Only after v1:

- add a separately downloadable Maia3-23M model with its own manifest and benchmark evidence;
- add an explicit multi-rating comparison view;
- evaluate WebGPU/WebNN as an optional accelerator;
- add candidate-specific modelled WDL;
- consider a native-messaging implementation for advanced desktop users.

---

## 10. Acceptance criteria

### Required product behavior

- [ ] **Maia-3 is a top-level engine option**, not a hidden style flag or a cloud source checkbox.
- [ ] **Maia settings are separate** from Objective sources, quality, styles, HumanForm, and sparring strength.
- [ ] Selecting Maia produces a direct, legal top-move hint and 1/3/5 likely alternatives.
- [ ] Selecting Maia does not issue a cloud objective-engine request by default.
- [ ] Maia model missing/downloading/error states are recoverable and never silently change the selected engine.
- [ ] Objective engine mode behaves exactly as it did before Maia is installed.
- [ ] Current mode/state cannot display a stale objective score in Maia mode or a stale Maia hint in Objective mode.

### Required correctness behavior

- [ ] All displayed Maia moves are legal in the complete original FEN.
- [ ] Black orientation, castling, en passant, and all promotions pass reference fixtures.
- [ ] Policy percentages are normalized only across legal moves.
- [ ] Exact vs padded history is recorded, cached separately, and visible to the user.
- [ ] No Maia result has an invented centipawn score, depth, mate claim, or fabricated PV.

### Required extension/runtime behavior

- [ ] ONNX Runtime JS/Wasm, worker scripts, and all executable code are packaged; no CDN scripts or remote code are executed.
- [ ] Model is user-installed, hash-verified, stored outside `chrome.storage.local`, and removable.
- [ ] The offscreen host is created once under concurrent requests and works on Chrome 114.
- [ ] Request ID + FEN + engine ID + position generation prevent stale rendering.
- [ ] Inference runs outside the panel UI thread.

### Required educational/fair-play behavior

- [ ] Maia is enabled only in supported review/study/completed-game/offline-FEN contexts.
- [ ] Known live/rated/unknown contexts are denied by the background before Maia inference or automatic hinting.
- [ ] Maia is manual by default and never automates a move or board interaction.
- [ ] “Likely” / “human prediction” wording remains visible next to every Maia hint.

---

## 11. Test plan

### New automated tests

```text
tests/maia-contract.test.js
tests/maia-preprocess.test.js
tests/maia-legal-mask.test.js
tests/maia-history.test.js
tests/maia-engine-routing.test.js
tests/maia-model-store.test.js
tests/maia-host-lifecycle.test.js
tests/maia-settings-migration.test.js
tests/maia-panel-wiring.test.js
tests/fair-play-eligibility.test.js
```

Key assertions:

- legacy settings stay in Objective mode and preserve HumanForm behavior;
- Maia routing invokes no `apiCoordinator` remote job unless a user explicitly asks for comparison;
- switched engines do not share dedupe/cache/render state;
- legal masking rejects illegal mapped moves and handles rare promotions;
- exact history replays legally; unavailable history uses labelled padding;
- black orientation decodes to valid original-board UCI;
- model digest mismatch, aborted download, quota failure, corrupt cache, host loss, and worker error all recover cleanly;
- concurrent install/predict requests create one offscreen host and correlate every response;
- Maia UI displays policy percentages and never calls objective score renderers;
- known live/rated/unknown contexts issue no Maia prediction.

### Browser/manual matrix

Test at minimum:

- Chrome 114 and current stable;
- clean profile, cached model, no network after cached model load, interrupted network, low disk/quota, panel close/reopen, and service-worker restart;
- Windows, macOS, and Linux where available; integrated graphics/CPU baseline and a lower-memory device;
- keyboard-only, screen reader, reduced motion, install/progress/cancel/remove/error state accessibility;
- representative positions: opening, middle game, endgame, black to move, castling, en passant, check, mate/stalemate, promotion, and invalid/unreliable FEN.

### Performance gates

Record rather than assume:

- artifact download bytes and install time;
- cold session initialization;
- warm one-position inference p50/p95;
- panel long tasks / input responsiveness;
- renderer/worker memory and IndexedDB storage;
- failure rate and recovery behavior.

Use these results to decide whether to expose Maia3-23M. Do not make WebGPU or multi-threaded Wasm a required v1 path.

---

## 12. Explicit non-goals for the first Maia engine release

- Replacing objective chess analysis or pretending Maia has Stockfish-style scores.
- Merging Maia probabilities into the existing heuristic HumanForm score.
- Auto-downloading a large model on install or migrating users into Maia mode.
- Running Maia as a remote undocumented web-site API.
- Automatically falling back to a different engine while the UI still says Maia.
- Sampling random moves for the main educational hint.
- Shipping Maia3-23M/79M, WebGPU, model-vs-model play, or multi-rating batches before the 5M engine is stable.

---

## 13. Recommended first implementation slice

Implement the following vertical slice first:

1. Add the **Objective engine / Maia-3** selector and independent persisted settings.
2. Add the typed Maia result + fake worker fixture.
3. Make the panel render a direct Maia hero move and alternatives without objective evaluation widgets.
4. Route selected Maia requests through a new `performMaiaAnalysis()` function and prove cloud providers are untouched.
5. Add the real Maia3-5M worker/runtime only after the UI/contract tests make engine switching safe.

This gives the extension the requested full engine architecture from the first merge, while keeping model storage, browser inference, and site-history work isolated and testable in later phases.

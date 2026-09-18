# Maia-3 Engine Upgrade — Decision Report and Implementation Plan

**Research date:** 2026-09-18  
**Repository assessed:** `jawad1020bhn/chessv10` / Chess Hint Assistant  
**Historical status:** This was the initial technical and licensing assessment.

> **Implementation decision update — 2026-09-18:** The requester has confirmed that all legal approvals are in place and has selected a different product direction: Maia-3 will be a **full, selectable engine option** with its own settings and direct move hints. The revised, implementation-ready plan is [`maia-engine-option-replan.md`](./maia-engine-option-replan.md). The licensing no-go language below records the original evidence and is superseded for this project by that confirmation; the technical fidelity and fair-play requirements remain relevant.

---

## Executive decision

Add **Maia-3 as an opt-in, browser-local human-move prediction capability**, not as another objective chess engine provider.

The recommended first product is a dual-track review experience:

1. Keep the existing objective analysis pipeline, evaluation bar, PVs, tactical warnings, and source-quality rules for “what is strongest?”
2. Add a separately labeled **“Likely human moves (Maia-3)”** card for “what would a player around this Lichess Blitz rating likely choose?”
3. Only make a Maia move the prominent coaching suggestion after a separate, fresh objective verification is available. Otherwise it remains a prediction, never a “best move.”

The preferred runtime is a **dedicated worker hosted by a packaged MV3 offscreen document**, using locally bundled ONNX Runtime Web/Wasm and a model downloaded only after an explicit user action. The 5M checkpoint is the right first benchmark candidate because it is dramatically smaller than the 23M and 79M variants. It is **not** approved for shipping yet: the weight-use/distribution terms and a reproducible browser artifact remain unresolved.

### Go / no-go today

| Decision | Status | Why |
|---|---:|---|
| Use Maia’s existing web site as an undocumented API | **No** | No stable, documented general inference API was found. Do not scrape or reverse-engineer it. |
| Treat Maia policy/WDL as Stockfish centipawns or PVs | **No** | Maia predicts human behavior; its WDL values are learned human-game outcome signals, not searched chess evaluations. |
| Put Maia in `api-coordinator` as another cloud provider | **No** | It is local inference with materially different semantics, lifecycle, cache keys, and result type. |
| Copy the official GPL frontend worker or AGPL inference code into this extension now | **No** | That would make licensing/distribution obligations a deliberate product decision, not an incidental implementation detail. |
| Build a fixture-driven, separately typed Maia path and real fair-play gate | **Yes, in parallel** | This is useful even while model authorization is pending, provided no upstream model/code is copied. |
| Ship a real Maia model to users | **No-go pending gates** | Written permission/terms, authoritative artifact provenance, parity tests, fair-play enforcement, and browser benchmarks are required first. |

---

## 1. What Maia-3 is — and is not

Maia-3 is a Chessformer-based model family built to **predict human moves**, conditioned on the player to move and opponent ratings. The official announcement describes a 600–2600 **Lichess Blitz** rating range and reports 57.1% move-matching accuracy on its standard test set. That is valuable for post-game coaching, natural-move explanations, realistic sparring, and showing how choices change by level.

It is not an objective search engine:

- A high policy probability means “the model expects a similarly rated human to play this legal move,” not “this is objectively best.”
- A low-probability move can be the best tactical move.
- Maia’s WDL/value head models human-game outcomes under its training distribution. It must never drive this extension’s centipawn evaluation bar, last-move grade, mate claims, or engine-depth labels.
- The official UCI wrapper emits a synthetic centipawn-like display derived from its WDL only for UCI compatibility. That is not a Stockfish evaluation and should not enter `AnalysisContract.finalizeAnalysis`.
- Sampling is appropriate for a separate “play a human-like opponent” mode, but not for a review recommendation. Review mode should rank the deterministic legal policy at temperature 1 and display its probabilities.

### Product language to use

Use language such as:

> **Likely human moves — Maia-3**  
> Predicted for a 1500 Lichess Blitz player against a 1500 opponent. This is a human-move prediction, not an engine evaluation.

Avoid:

- “Maia best move”
- “Maia +1.7 evaluation”
- “Depth 18 Maia”
- “This move has a 60% chance to win” when the number is merely policy probability

The official product itself presents Maia together with Stockfish rather than replacing it. That is the right conceptual model for this extension.

---

## 2. Current repository assessment

### Existing architecture and the Maia gap

| Surface | Current behavior | Maia implication |
|---|---|---|
| `manifest.json` | MV3, minimum Chrome 114; CSP is `script-src 'self'` and does not permit WebAssembly. No `offscreen` or `unlimitedStorage` permission. | Local ONNX inference needs a CSP amendment containing `'wasm-unsafe-eval'`; an offscreen host needs `offscreen`. |
| `background.js` | Owns settings, remote-source routing, cache/fallback policy, message handling, and the existing “human” form session. | Keep it as coordinator and eligibility authority. Do **not** run a model session in its ephemeral service worker. |
| `engine/api-coordinator.js` | Queues Chess-API, Lichess Cloud, and Masters Explorer work with quotas and position tokens. | Keep Maia outside its normal provider ordering. Reuse it only if an optional objective verification request is made. |
| `engine/analysis-contract.js` | Canonicalizes objective PVs, centipawns/mates, source confidence, and legal PV validation. | Preserve this contract for objective results. Add a separately typed `MaiaPrediction` validator; do not coerce policy into `pvs`. |
| `engine/analysis-policy.js` | Classifies sources as engine/opening/local and adjusts quality/MultiPV for `humanLikeMode`. | Add mode migration carefully, but do not classify Maia as a deep engine, opening database, or remote provider. |
| `engine/human-form.js` | Deterministic 600–1600 heuristic that selects among already-safe objective candidates. | This is **not Maia**. Retain it as “Human — coach heuristic” unless a future product decision replaces it explicitly. |
| `engine/hint-engine.js` | Re-ranks objective PVs based on style and heuristic naturalness. | Do not re-rank Maia policy with these heuristics; doing so destroys the meaning of Maia probabilities. |
| `content.js` | Produces a FEN, reliability flags, and site metadata. It does not return trusted UCI history. | Exact Maia-3 history input cannot be reconstructed from the normal path today. |
| `sidepanel/sidepanel.js` | Its polling fallback explicitly creates `gameInfo.moveHistory: []`, and its later `request_analysis` message does not preserve a trusted game-history payload. | Phase one must use a clearly labeled padded-history fallback or first capture, retain, and forward trusted history. |
| side-panel UI | “Engine / Human” currently toggles the heuristic human mode and a 600–1600 sparring-strength slider. | Add a third, distinct choice; do not silently reinterpret existing “Human” preferences as Maia. |

### Important fair-play discrepancy

The repository headers say the extension never assists in rated or live online games. The executable flow currently does the opposite in important respects:

- The side panel polls the board every 2–5 seconds.
- It requests analysis when it is the assisted player’s turn.
- `background.js` explicitly uses the priority `current-player-turn`.
- The request handler has no robust classification that rejects live/rated positions.

A comment is not an enforcement mechanism. Maia would add a highly actionable “likely move” path, so it **must not be enabled in this flow**. A real server-side-independent eligibility gate is a launch prerequisite for Maia and should be designed to protect the existing objective feature as well.

---

## 3. Model and artifact findings

### Released model family

The official Maia-3 registry identifies these standard checkpoints:

| Variant | Official checkpoint size | Intended use | Recommendation |
|---|---:|---|---|
| Maia3-5M | 20,968,049 bytes (`.pt`) | First try / CPU / chess GUIs | **First browser spike only** |
| Maia3-23M | 91,799,307 bytes (`.pt`) | Better accuracy | Benchmark after 5M meets correctness and UX budgets |
| Maia3-79M | 315,651,851 bytes (`.pt`) | Best reported accuracy | Not suitable for the first consumer browser release |

The downloaded checkpoint size is not the final browser cost. ONNX export, FP16/quantization, Wasm buffers, session initialization, transient download buffers, and the browser renderer can multiply disk and memory pressure. Do not promise a user-facing download or memory figure until the exact approved artifact is benchmarked.

### Critical fidelity distinction: released checkpoint vs. platform ONNX file

The official UCI source for released Maia-3 checkpoints defaults to **eight board-state slots, including the current position**. It concatenates eight 12-piece-channel tokenizations into a canonical `tokens` input of shape approximately `[batch, 64, 96]`; it also accepts self and opponent Elo inputs. When exact history is absent, the official UCI implementation pads by repeating the earliest/current available state.

The official Maia platform frontend contains a different `maia3_simplified.onnx` browser artifact whose public worker uses `[batch, 64, 12]`, raw Elo arrays, a 4,352-move policy, and a 3-logit LDW head. Its tracked blob is 45,683,686 bytes after an FP16 change. The frontend repository does **not** publish a separate artifact manifest that ties that blob unambiguously to one of the public checkpoint releases, documents the transformation, or grants a standalone model-asset license.

Therefore:

1. Do not assume the 12-channel browser artifact is a drop-in export of the released 8-history checkpoint.
2. Do not use the frontend artifact or its worker as the production implementation shortcut.
3. Before browser work begins, obtain an authoritative model contract: source checkpoint revision/hash, expected tensor names/types/shapes, move vocabulary version, export command, expected outputs, and redistribution terms.
4. Build parity fixtures against the selected canonical checkpoint. A model that merely loads is not evidence that preprocessing is faithful.

### History requirements

Use exactly one of these modes in a model result:

| Mode | Preconditions | Behavior | User-visible label |
|---|---|---|---|
| `exact-uci-history` | Trusted initial FEN plus a legal UCI move sequence, or trusted chronological full FEN states | Reconstruct up to the latest eight board states in order, matching the approved model contract | “Full game context” |
| `padded-current-position` | Complete, reliable current FEN but no trustworthy history | Repeat the current state into the required history slots, following the reference fallback | “Current position only” |
| `unavailable` | Invalid or incomplete FEN; unreliable castling/en-passant state where legality cannot be trusted | Do not invoke Maia | “A verified position is required” |

Do not infer history from piece placement, move counters, DOM move labels, or a guessed opening. In particular, do not synthesize castling/en-passant rights from a DOM board snapshot. For a policy model, an incorrect legal mask is worse than no result.

---

## 4. Legal and licensing gate

This is the first hard blocker, not a release-checklist footnote.

| Component | Observed status | Required action |
|---|---|---|
| `CSSLab/maia3` inference code | AGPL-3.0 | Decide intentionally whether the extension can comply. Obtain legal review before incorporating/adapting it. |
| `CSSLab/maia-platform-frontend` | GPL-3.0 | Do not copy its TypeScript, worker, preprocessing, or bundled ONNX asset without accepting the implications. |
| 5M / 23M Hugging Face cards | Cards say “CC BY 4.0 (paper); see repo for code/weights license”; API metadata did not declare a separate, clear weight license | Treat weight use, conversion, download, caching, and redistribution rights as unresolved. |
| 79M Hugging Face card | States AGPLv3 | Treat as an explicit copyleft candidate, not a permissive fallback. |
| ONNX Runtime Web | MIT | Bundle a pinned reviewed version and preserve its notices. |
| This repository | No root `LICENSE` file was present during the assessment | Establish the extension’s own licensing/distribution posture before mixing in copyleft components. |

The official announcement calls the models free to download/use, but that is not a substitute for unambiguous terms governing conversion and redistribution in a Chrome extension. This report is not legal advice.

### Questions to resolve in writing with CSSLab / rights holder

1. May this project download, convert to ONNX, cache, and redistribute the specific Maia3-5M checkpoint in a public Chrome extension?
2. What exact license applies to each weight file independently of the code repository and the research paper?
3. Is the platform’s `maia3_simplified.onnx` a supported public artifact? If so, what source checkpoint, input contract, license, SHA-256, and attribution apply?
4. Is an independently written browser inference adapter permitted, and what notices/trademark attribution are required?
5. Is eight-state history mandatory for the selected artifact’s intended accuracy, and are there approved browser export instructions and parity vectors?

### License decision branches

- **If written, compatible weight/artifact permission is received:** build the browser-local plan below with the required notices and source offer obligations.
- **If AGPL/GPL compliance is accepted for the extension:** publish the corresponding source and all required notices in the distribution; validate obligations with counsel, especially if a hosted fallback is contemplated.
- **If neither condition is acceptable:** do not label a different heuristic or model “Maia.” Keep the current human-form mode or select a separately licensed human-move model.

---

## 5. Delivery options considered

| Option | Advantages | Costs / risks | Decision |
|---|---|---|---|
| **Browser-local ONNX/Wasm** | FEN and ratings stay local after download; works offline after cache; no inference operating cost; fits a side-panel review workflow | Model licensing/export, download lifecycle, memory, storage, browser parity work | **Recommended**, after gates |
| Self-hosted Maia API | Can use native PyTorch/UCI directly; central updates and potentially higher throughput | Sends positions/ratings to a server; cost, abuse controls, latency, privacy policy, operational burden, AGPL network-use questions | Not default; only reconsider as an explicit, compliant opt-in service |
| Native-messaging companion | Strong desktop performance and most direct UCI compatibility | Separate installer, OS support, security review, poor consumer onboarding | Advanced developer/enterprise option only |
| Side-panel-owned worker | Fewer lifecycle components | Session and download disappear when the panel is destroyed; UI becomes the model process owner | Inferior to an offscreen host for the durable feature |
| Scrape/use `maiachess.com` endpoints | No model conversion work | Unsupported, brittle, privacy/fair-play risks, not a public API | Reject |

---

## 6. Recommended technical architecture

### Runtime topology

```text
Trusted content script
  └─ complete FEN + game eligibility + optional exact UCI history
       │
Side panel ── user action / display only ───────────────────────────────┐
       │                                                                 │
       ▼                                                                 │
background.js: settings normalization, fair-play eligibility,           │
position-generation token, request correlation, objective routing       │
       │                                                                 │
       ├── existing objective path ──> Chess-API / Lichess / tablebase  │
       │                                                                 │
       └── Maia request ──> offscreen.html / offscreen.js               │
                               └─ packaged Maia worker                  │
                                   ├─ bundled ONNX Runtime JS + Wasm     │
                                   ├─ IndexedDB model cache              │
                                   └─ approved ONNX model                │
                                                                         │
background.js <── typed prediction / status / correlated error ─────────┘
       └── side panel renders objective analysis and Maia card separately
```

### Why an offscreen host

An MV3 service worker should coordinate, not own a long-lived model session. A packaged offscreen document can host a dedicated worker without blocking the side panel and can survive panel recreation long enough to finish a user-requested download or inference. The extension’s Chrome minimum is 114, which supports the Offscreen API and the `WORKERS` reason.

Implementation details that matter:

- Add the `offscreen` permission and a static packaged `offscreen.html`.
- Use reason `WORKERS` with a truthful justification such as “run local, user-requested Maia model inference off the side-panel thread.”
- Chrome permits one offscreen document per profile. Serialize creation with one shared promise.
- `chrome.runtime.getContexts()` starts in Chrome 116, but this extension supports Chrome 114. Implement the documented `clients.matchAll()` fallback when determining whether the document already exists.
- The offscreen document has only `chrome.runtime` among extension APIs. Pass settings and requests over a versioned runtime message/Port protocol; use IndexedDB directly inside the host.
- Include a request ID, tab/position generation token, host generation, timeout, and cancellation/stale-response handling on every request.
- Close the document after an intentional idle period and release/terminate the worker. `WORKERS` does not provide a useful automatic idle lifetime.

### Proposed new modules

These are proposed names, not files that already exist:

```text
engine/maia/
  maia-contract.js        # pure input/output validator; no objective scores
  maia-preprocess.js      # approved tensor/history/mirroring/move-map code
  maia-result-cache.js    # small prediction cache, separate from model blob
  maia-model-manifest.js  # compiled, immutable model metadata and SHA-256
  maia-host-client.js     # background-side request correlation
  maia-worker.js          # no DOM; ONNX session and typed-array transfer
  maia-model-store.js     # IndexedDB staging, verification, atomic promotion

offscreen.html
offscreen.js
vendor/onnxruntime-web/<pinned-version>/...
tools/                    # reproducible export/vendor verification tooling, if licensed
```

The implementation may use different names, but the boundaries are important: preprocessing and result validation need to be independently unit-testable; the worker must not contain UI policy; and the background must remain the authority for eligibility and current-position checks.

### Model download and storage lifecycle

1. The user deliberately chooses **Download Maia-3** after seeing source, version, expected size, attribution, and local-storage notice.
2. Before download, call `navigator.storage.estimate()` and require a conservative free-space budget covering the asset, staging copy, and session initialization.
3. Fetch only an immutable, approved URL from a **compiled model manifest**. Never accept a model URL, SHA, or behavior-changing manifest from settings, a remote config file, or page content.
4. Stream progress; support cancellation through `AbortController`; cap accepted byte size.
5. Compute SHA-256 with `crypto.subtle.digest` before opening the model. Verify content length when supplied.
6. Store a verified blob in a versioned IndexedDB record. Download into a staging record and atomically promote only after digest verification; retain the last known-good model until replacement succeeds.
7. On model-open failure, delete/quarantine the corrupt record, give a retry/removal path, and never silently fall back to an unknown remote model.
8. Offer **Remove Maia model**. It deletes the model and prediction cache and terminates/releases the active worker session.

Use IndexedDB (or another quota-managed web store) for model blobs, not `chrome.storage.local`, whose default quota is only 10 MB. Start without `unlimitedStorage`; if preflight or real-world testing shows normal quota is inadequate, request it as an optional permission with a clear user explanation. Persistent web storage is helpful but not a substitute for a remove/re-download recovery path.

### Manifest and CSP changes

After the artifact origin is chosen, make the smallest audited changes. The final host must be exact, controlled, immutable, CORS-tested, and compatible with extension downloads. Do not use a CDN script or remotely loaded Wasm.

Illustrative direction only:

```json
{
  "permissions": ["sidePanel", "activeTab", "storage", "scripting", "alarms", "offscreen"],
  "optional_permissions": ["unlimitedStorage"],
  "optional_host_permissions": ["https://approved-model-host.example/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src https://lichess.org https://explorer.lichess.ovh https://tablebase.lichess.ovh https://chess-api.com https://approved-model-host.example;"
  }
}
```

The model itself is downloadable data, which Chrome’s extension AI guidance permits; all code that executes it—including ONNX Runtime JS, Wasm binaries, worker code, and mapping logic—must be packaged with the extension. Pin the runtime version and artifact hashes. Validate the actual bundle under MV3 CSP before release.

Start with a single-threaded SIMD Wasm configuration. Do not make WebGPU, WebNN, SharedArrayBuffer, cross-origin isolation, or multithreaded Wasm a v1 dependency. They may be measured later behind capability detection, but they materially expand the browser/device test matrix.

---

## 7. Data contract and inference rules

### Separate result type

Do not add fake `score`, `scoreType`, `depth`, or multi-ply `pv` fields solely to fit existing engine UI code. Preserve `AnalysisContract.finalizeAnalysis` for objective providers and add a separate validator, for example:

```js
{
  kind: 'maia-prediction/v1',
  source: 'maia3',
  requestId: '...',
  positionKey: '...',
  model: {
    id: 'maia3-5m',
    artifactVersion: '...',
    sha256: '...',
    runtime: 'onnxruntime-web@<pinned>'
  },
  ratingContext: {
    selfElo: 1500,
    opponentElo: 1500,
    scale: 'lichess-blitz',
    linkedRatings: true
  },
  history: {
    mode: 'exact-uci-history', // or padded-current-position
    stateCount: 8,
    inputHash: '...'
  },
  moves: [
    { rank: 1, uci: 'e2e4', probability: 0.3124 },
    { rank: 2, uci: 'd2d4', probability: 0.2711 }
  ],
  humanOutcome: {
    scope: 'current-position', // never call this an engine evaluation
    perspective: 'side-to-move',
    win: 0.31,
    draw: 0.42,
    loss: 0.27
  },
  objectiveVerification: {
    status: 'not-requested' // verified | unavailable | stale | not-requested
  },
  elapsedMs: 0,
  warnings: []
}
```

Validator requirements:

- The current FEN must be complete and reliable before preprocessing.
- Rating inputs must be finite, integral as required by the approved artifact, and UI-clamped to the published 600–2600 Lichess Blitz range. Do not extrapolate merely because internal UCI options accept a broader number.
- Every returned UCI move must be legal in the original, unmirrored current FEN.
- Reject non-finite logits/probabilities, duplicates, invalid ranks, invalid WDL values, and policy sums outside a small floating-point tolerance.
- Send only top-K legal moves and normalized WDL to the background/panel. Keep raw 4,352 logits inside the worker except in explicit development diagnostics.
- Cache key must include model ID/version/SHA, preprocessing/move-map version, complete position identity, ratings, history mode and history hash, and top-K. It must never collide with an objective analysis cache key.

### Faithful inference checklist

For the selected approved model contract:

1. Build the exact eight chronological board states, left-padding as the reference requires.
2. Tokenize every state using the approved piece-channel order and orientation behavior.
3. Mirror black-to-move positions/moves exactly as the reference does, then convert selected moves back to ordinary UCI before display.
4. Generate legal moves from the complete FEN using the extension’s chess legality code; explicitly test castling, en passant, checks/pins, and all promotion pieces.
5. Mask every illegal policy action **before** softmax; normalize only across legal logits.
6. Use stable softmax (subtract the legal maximum) and deterministic ranking for coaching.
7. Preserve the model’s LDW/WDL perspective. If later displaying a candidate-specific outcome, do the reference-style successor inference with swapped player/opponent roles and an explicit perspective inversion; do not reuse the current-position WDL as if it belonged to each move.
8. Compare golden vectors against a licensed reference implementation before and after any FP16/quantization conversion.

---

## 8. UX, settings, and objective safety rules

### Settings migration

The current boolean `humanLikeMode` and `sparringStrength` have an established heuristic meaning. Preserve it.

Introduce an explicit mode such as:

```text
recommendationMode:
  'objective' | 'heuristic-human' | 'maia-human'
```

Migration rule:

- Existing `humanLikeMode: true` → `recommendationMode: 'heuristic-human'`.
- Existing `humanLikeMode: false` → `recommendationMode: 'objective'`.
- Never auto-download or auto-enable Maia.
- Keep the current 600–1600 `sparringStrength` for `HumanForm` unchanged.
- Add `maiaSelfElo`, `maiaOpponentElo`, and `maiaLinkRatings` separately, defaulting to a safe documented value such as 1200/1200. “Self” always means the side whose move is being predicted, not necessarily the extension user.

Replace the current two-way Engine/Human segmented control with accessible, explicitly distinct options:

| Choice | Meaning |
|---|---|
| **Objective** | Existing engine/source-based strongest recommendation |
| **Human — coach** | Existing deterministic `HumanForm` heuristic over objective candidates |
| **Human — Maia-3** | Learned rating-conditioned legal-move prediction; requires a downloaded model |

### Maia UI

For a first release, render Maia in a dedicated card below or beside the objective result:

- Model/version badge and current status: not installed, downloading, verifying, loading, ready, unavailable, or failed.
- Rating context: “Predicting the side to move at 1500 vs 1500 Lichess Blitz.”
- History context: “Full game context” or the honest “Current position only.”
- Top 3–5 legal moves with SAN and UCI-derived board highlights, each with policy percentage.
- A short, persistent disclosure: “Likely human move, not the best move.”
- Optional “Human game outlook” W/D/L only with its correct modelled-human wording and perspective.
- Retry, cancel, and Remove model controls with accessible progress (`aria-live`, textual percentage, and no color-only state).

Keep these components independent:

- The existing evaluation bar remains objective.
- Existing `renderHints`, tactical warnings, critical-moment score deltas, mate text, and source confidence remain tied to `AnalysisContract` output.
- Existing aggressive/ultra style selection applies to objective candidate ordering only. It must not silently re-rank the Maia distribution.
- Do not reuse `record_human_recommendation`/correlation tracking in a way that incentivizes copying a model in live play.

### Objective verification before a Maia move becomes a coaching recommendation

A Maia policy card can safely say “likely.” A main hint saying “play this” needs an independent chess-quality signal.

Recommended rule:

1. If a fresh objective PV already contains the exact Maia candidate, attach its objective context.
2. Otherwise, only when the user has enabled Chess-API and its coordinator budget/cooldown allows it, issue **one** queued `searchmoves` request containing the top small set of Maia moves. Chess-API documents a `searchmoves` request field for this use case.
3. If verification is unavailable, stale, disabled, or rate-limited, keep the card prediction-only. Do not silently enable another network provider, do not call a shallow local result “verified,” and do not hide the status.
4. Never let the verification request bypass the current coordinator’s quota, position-token, or fair-play guard.

This is intentionally more conservative than blending a probability with an evaluation into one opaque score.

### Fair-play gating design

Before any model inference, objective verification, or auto-analysis request:

1. Have `content.js` produce an explicit `analysisEligibility` object from site-specific, trustworthy state: `study`, `analysis-board`, `completed-game`, `live`, `rated-live`, or `unknown`.
2. Treat `live`, `rated-live`, and `unknown` as **deny by default** for Maia recommendations. A user toggle must not override a known live/rated state.
3. Validate this decision in `background.js`, not only in the side panel, and bind it to the active tab/position token.
4. Permit Maia only for a completed-game review, a site analysis/study board, or an explicit offline FEN/PGN review workflow.
5. Make Maia manually requested in v1; do not run it on every board poll or “your turn.”
6. Never automate moves, inject clicks/keystrokes, or surface move arrows on the played board in the disallowed states.

If robust per-site classification cannot be implemented and maintained, Maia should be offered only in an explicit pasted-FEN/imported-PGN offline review surface rather than on live-site pages.

---

## 9. File-level implementation map

| Existing file | Planned change |
|---|---|
| `manifest.json` | Add `offscreen`; add MV3-safe Wasm CSP; add the narrowly scoped model-download host only after delivery origin is approved; consider optional `unlimitedStorage`. Do not add a broad host permission. |
| `background.js` | Add migration/defaults, model permission/status routing, offscreen lifecycle, request IDs, fair-play eligibility enforcement, stale cancellation, and separate `maia_*` messages. Preserve objective routing. |
| `engine/analysis-contract.js` | Leave `finalizeAnalysis` objective-only. Optionally share legal UCI helpers, but do not add Maia scores/PVs to its canonical result. |
| `engine/analysis-policy.js` | Migrate the mode safely; retain old heuristic semantics; add no fake “deep engine” class for Maia. |
| `engine/api-coordinator.js` | Do not add `maia3` to default provider order. Add a properly budgeted targeted verification job only if required. |
| `engine/human-form.js` | Keep as the current heuristic fallback. Update labels/comments only once the three-mode UI is introduced. |
| `engine/hint-engine.js` | Keep style reranking for objective/heuristic mode. Add a clear integration point for a separately verified Maia choice, not probability mutation. |
| `engine/cloud-engine.js` | At most add display metadata for a local human-model capability; do not present it as a cloud source. |
| `content.js` | Add robust eligibility classification and, where authoritative data exists, exact move-history acquisition. Never fabricate history. |
| `sidepanel/sidepanel.js` | Capture, retain, and forward trusted `gameInfo`/move history instead of constructing or losing the current empty history; hold objective and Maia state independently; render model/download/status UI; respect request tokens. |
| `sidepanel/sidepanel.html` / CSS | Add three-mode settings, Maia ratings, download/remove state, disclosure, progress, and accessible cards. |
| New `engine/maia/*`, `offscreen.*`, vendor tooling | Implement the isolated runtime described above after artifact approval. |

---

## 10. Phased implementation plan

### Phase 0 — Product, legal, and fair-play gate

**Deliverables**

- Written model/code/artifact rights decision and attribution plan.
- A decision on the extension’s own license/source-distribution posture.
- Approved definition of “review only” and supported sites/workflows.
- A background-enforced, deny-by-default `analysisEligibility` contract and tests.
- UX copy approved to distinguish human prediction from objective analysis.

**Exit criteria**

- No known live/rated/unknown position can produce a Maia request.
- There is an authoritative artifact path, SHA-256, license, and model contract—or the project deliberately pauses real Maia work.

### Phase 1 — Reproducible model spike (isolated from product code)

**Deliverables**

- A licensed, reproducible converter/export process for Maia3-5M, or an upstream-approved browser artifact with complete provenance.
- `model-manifest` fields: source revision, source checkpoint digest, export-tool versions/command, ONNX SHA-256, tensor input/output schema, move-map hash, notices.
- Golden fixtures from the reference path for normal, black-to-move, castling, en-passant, promotion, check, and sparse endgame positions.
- A quantitative comparison of 5M against 23M on target browser hardware.

**Exit criteria**

- Browser outputs match the reference within agreed logit/probability tolerances after legal masking.
- The selected artifact has a documented, redistributable provenance chain.
- The team chooses a measured performance/download budget rather than relying on model-name parameter counts.

### Phase 2 — Pure Maia core and test harness

**Deliverables**

- Pure `maia-contract`, history builder, orientation/mirroring, vocabulary, legal-mask, stable-softmax, and result-cache modules.
- A fake inference adapter so all routing/UI tests run without a proprietary or large model fixture.
- Settings migration from legacy `humanLikeMode`.

**Exit criteria**

- Unit tests prove no illegal move can survive, policy sums are normalized, black/promotion/en-passant cases round-trip, and history mode is visible in the result.
- Existing human-form behavior is unchanged for migrated users.

### Phase 3 — MV3 runtime, model lifecycle, and secure messaging

**Deliverables**

- Bundled, pinned ONNX Runtime Web/Wasm assets and third-party notices.
- Static offscreen document + dedicated worker + Chrome 114 compatibility fallback.
- Explicit download/cancel/resume/error/remove UX.
- IndexedDB staging, digest verification, atomic promotion, corrupt-cache recovery, and idle teardown.
- Versioned message protocol and stale/cancellation behavior.

**Exit criteria**

- No remote script/Wasm/dynamic code execution occurs.
- A cancelled or corrupt download never becomes active.
- Two simultaneous panel requests create one host and receive only their correlated responses.
- The feature works after a service-worker restart and a panel close/reopen.

### Phase 4 — Dual-track UI and guarded coaching integration

**Deliverables**

- Independent objective and Maia state in the side panel.
- Three-mode selector, separate Maia ratings, status/progress controls, history and model disclosures.
- Prediction-only display by default; optional objective verification through the existing budgeted path.
- Site eligibility UX that explains why Maia is unavailable where it is blocked.

**Exit criteria**

- The objective evaluation bar cannot be populated from Maia output.
- A Maia result cannot overwrite a more recent FEN’s UI.
- A move is never called “best” solely because Maia ranks it first.
- Accessibility review passes keyboard, focus, screen-reader status, and error-recovery scenarios.

### Phase 5 — Performance, reliability, privacy, and release pilot

**Deliverables**

- Browser matrix results: minimum Chrome 114 plus current stable on Windows, macOS, and Linux; representative integrated and discrete GPUs; low-memory CPU device where possible.
- Cold-download, cold-load, warm-inference p50/p95, memory, disk, worker responsiveness, and failure metrics.
- Privacy disclosure and model-source attribution.
- A limited opt-in pilot with no raw FEN/history telemetry by default.

**Exit criteria**

- Numerical parity, fair-play gates, and regression suite are green.
- Warm inference meets the agreed user-visible budget without blocking side-panel interactions.
- Failure falls back honestly to objective/heuristic behavior, never a hidden hosted Maia service.

### Phase 6 — Only after v1 proves itself

Consider, in this order:

1. Exact history support on additional site adapters.
2. An explicit “compare 1200 / 1600 / 2000” batch view, triggered by the user rather than every position.
3. Candidate-specific modelled WDL after move, with correct extra inference and copy.
4. Measured WebGPU/WebNN acceleration behind a capability flag.
5. A 23M optional model only if its accuracy benefit justifies download, latency, and memory costs.
6. Native-messaging integration for advanced local users.

Do not expose 79M as a casual drop-down choice until it has a separate storage, memory, device, and license decision.

---

## 11. Required test plan

### Unit tests

Add focused tests such as:

- `tests/maia-contract.test.js`: schema, finite values, WDL normalization, duplicate/rank rejection, independent cache key.
- `tests/maia-preprocess.test.js`: tensor layout, eight-state padding order, black mirroring, move-map round trips.
- `tests/maia-legal-mask.test.js`: castling, en passant, pinned pieces, check evasions, underpromotions, and no-legal-move behavior.
- `tests/maia-storage.test.js`: manifest digest, staging/promotion, cache incompatibility, corrupt blob, removal, quota error.
- `tests/maia-host.test.js`: host create race, Chrome 114 `clients.matchAll` fallback, worker crash/reconnect, request correlation, stale cancellation.
- `tests/settings-migration.test.js`: legacy Human mode stays heuristic and Maia remains off.
- `tests/fair-play-eligibility.test.js`: known live/rated/unknown states deny model and verification requests.

### Model parity tests

Maintain a small licensed fixture set with reference outputs. Compare:

- input tensor shape/order and Elo type;
- legal action indices and black-move unmirroring;
- top-K legal actions/order;
- masked probability values and total probability;
- LDW output perspective;
- approved conversion precision tolerance.

Run parity before accepting a new model version, a new ONNX Runtime version, a move-map update, or FP16/quantization change.

### Integration and manual tests

- Download on a clean profile; cancel at multiple points; offline retry; interrupted connection; content-length absent; hash mismatch; IndexedDB quota/full; model open failure; remove while inference is queued.
- Close/reopen the panel and suspend/restart the service worker during a download and during inference.
- Change tabs/FENs quickly; prove stale output cannot render.
- Confirm a cached model makes no model-host request during normal inference.
- Confirm blocked/live/unknown contexts make no model or objective-verification request.
- Screen-reader announcement of downloading, ready, unavailable, verification status, and prediction disclaimer.
- Validate the final packed extension with MV3 CSP; no CDN, `eval`, `new Function`, data-URL worker, or remotely hosted executable asset.

### Baseline recorded for this study

Before report changes, the manifest parsed successfully and all existing Node test files passed:

```text
analysis-contract, api-coordinator, attack-v2, background-smoke,
core-utils, early-king-hunt, hint-engine, human-form, local-engine,
panel-wiring
```

No production behavior changes were made as part of the research itself.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Weight/code license ambiguity | Cannot legally distribute a real Maia feature | Resolve in writing first; do not copy “simplified” artifacts as a workaround |
| Simplified ONNX differs from released checkpoint | Silent incorrect/weak predictions | Use a provenance manifest and golden parity tests; retain eight-state semantics unless approved otherwise |
| FEN/history is unreliable | Illegal or misleading policy output | Require reliable FEN, honest padded fallback, never fabricate history |
| Users confuse human likelihood with chess quality | Bad coaching and trust loss | Separate card/type, permanent disclosure, objective comparison, no centipawn conversion |
| Live-game assistance | Fair-play and platform-policy harm | Background-enforced default-deny eligibility and manual review-only v1 |
| Large download or quota failure | Poor onboarding | 5M first, preflight, progress/cancel/remove, IndexedDB recovery, optional storage permission only if required |
| Model-host redirects/CORS change | Downloads break or need broad permissions | Use a controlled immutable delivery origin or validate a pinned upstream path before release; avoid `<all_urls>` |
| Browser memory/latency varies | Frozen panel/battery drain | Worker/offscreen isolation, one active inference, explicit benchmark gates, no WebGPU dependency initially |
| Objective provider quota increases | More rate limits | Reuse fresh PVs first; only one queued `searchmoves` verification with enabled-provider consent |
| Styles mutate Maia distribution | Mislabelled policy percentages | Keep Maia and objective style ranking separate |

---

## 13. Final implementation recommendation

Proceed with the following sequence:

1. **Fix the fair-play boundary and settle the legal/artifact questions.** These are non-negotiable gates.
2. **Build a separately typed, fixture-driven Maia adapter**, with no upstream source/model copied until authorized.
3. **Use browser-local ONNX/Wasm in an offscreen-hosted worker**, with a verified, user-installed 5M artifact.
4. **Ship Maia first as a clearly labeled prediction overlay**, alongside the extension’s objective analysis—not inside its centipawn/PV contract.
5. **Only add “Maia-informed coaching suggestion” after fresh objective verification**, and do so through the existing quota-aware routing path.
6. **Benchmark 23M only after the 5M pilot is correct, safe, and usable**; avoid a 79M consumer option for now.

This plan delivers the distinctive value Maia offers—human context—without pretending it is Stockfish, weakening current quality guarantees, or making hidden licensing, storage, privacy, and fair-play tradeoffs.

---

## Sources consulted

### Maia-3

- [Official Maia-3 announcement on Lichess](https://lichess.org/@/ashtonanderson/blog/introducing-maia-3-free-and-open-source/vCPPRtX3) — purpose, rating range, reported move-matching accuracy, and intended dual Maia/Stockfish analysis.
- [CSSLab Maia-3 repository](https://github.com/CSSLab/maia3) and [LICENSE](https://github.com/CSSLab/maia3/blob/main/LICENSE) — official UCI implementation, model aliases, and AGPL-3.0 code licensing.
- [Maia3-5M](https://huggingface.co/UofTCSSLab/Maia3-5M), [Maia3-23M](https://huggingface.co/UofTCSSLab/Maia3-23M), and [Maia3-79M](https://huggingface.co/UofTCSSLab/Maia3-79M) model cards — checkpoint names/sizes and model-card licensing text.
- [Chessformer / Maia-3 paper](https://arxiv.org/abs/2605.19091) — model architecture and human-move prediction research.
- [CSSLab Maia platform frontend](https://github.com/CSSLab/maia-platform-frontend) and the [FP16 ONNX change](https://github.com/CSSLab/maia-platform-frontend/commit/0013cc8e6ec52c88f5b3d694781d4cc8427cb91a) — browser-worker reference mechanics and the distinct simplified ONNX artifact.

### Chrome MV3 and runtime

- [Extensions and AI](https://developer.chrome.com/docs/extensions/ai) — client-side model lifecycle guidance and the fact that model data is not remotely hosted code.
- [MV3 extension-page CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — Wasm CSP requirement and packaged-code restriction.
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — static offscreen document, one-document limit, runtime-only API access, and worker use.
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) and [permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list) — quota and `unlimitedStorage` behavior.
- [ONNX Runtime Web deployment guidance](https://onnxruntime.ai/docs/tutorials/web/deploy.html) — local JS/Wasm asset deployment and execution-provider considerations.

### Objective-verification capability

- [Chess-API documentation](https://chess-api.com/) — current `searchmoves`, MultiPV, depth, and request behavior used for the optional guarded verification design.

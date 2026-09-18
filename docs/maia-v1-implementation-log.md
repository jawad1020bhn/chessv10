# Maia-3 V1 implementation log and continuation roadmap

**Product:** Chess Hint Assistant

**Release target:** `13.1.0 — Maia-3 local policy hints`

**Implementation date:** 2026-09-18

**Implementation commit:** `1e041ec1526a0ce12515acf623c1fa76652859e9` (`feat: add local Maia-3 policy engine`)

**Status:** V1 feature implementation is complete; real-Chrome release certification remains a manual verification item.

This is the ongoing engineering log for Maia-3. It records what V1 actually implements, the boundaries that must remain intact, and the work that can safely be taken forward in later releases. It supplements the detailed [engine-option replan](./maia-engine-option-replan.md) and [runtime/artifact record](./maia-v1-runtime.md).

---

## 1. V1 product outcome

Maia-3 is a **selectable local engine mode**, not a cloud provider, a style flag, or a renamed version of the existing HumanForm heuristic.

When a user selects Maia-3 on an eligible review page and requests analysis, the extension:

1. runs the user-installed ONNX model in the browser;
2. masks the model policy to legal moves for the exact FEN;
3. presents the highest-probability legal moves as **likely human moves** for the selected rating context; and
4. optionally shows a learned current-position win/draw/loss tendency for the side to move.

It does **not** generate centipawn scores, depth, mate claims, principal variations, objective best-move labels, or played-move grades from Maia output.

---

## 2. What was implemented in V1

### 2.1 Engine selection and Maia-specific UI

| Area | V1 implementation | Status |
|---|---|---:|
| Engine selection | Adds **Objective** and **Maia-3** as distinct top-level engine choices. | Complete |
| Maia settings | Separate settings block for model build, side-to-move rating, opponent rating, linked ratings, number of hints, manual/automatic behavior, and human outcome display. | Complete |
| Result presentation | Dedicated Maia panel labeled **Learned move policy** / **Likely human moves**. It lists SAN/UCI and probability only. | Complete |
| Semantic disclosure | Persistent UI text says: “Maia-3 predicts likely human moves, not an objective engine evaluation.” | Complete |
| Objective separation | Objective evaluation, PV, balance, critical-moment, move-classification, and coach widgets are hidden in Maia mode. | Complete |
| Lifecycle controls | **Download model**, **Cancel**, and **Remove** controls with model size, progress bar, live status, ready/error states, and accessible progress/status attributes. | Complete |
| Accessibility/motion | Uses semantic labels, live/status regions, progressbar attributes, keyboard-native controls, and reduced-motion coverage. | Complete |

### 2.2 Local model/runtime implementation

| Area | V1 implementation | Status |
|---|---|---:|
| Model path | User explicitly grants an optional, narrowly scoped host permission and clicks **Download model**. There is no automatic model download. | Complete |
| Artifact pinning | The artifact URL uses an immutable source revision and is checked against exact byte size and SHA-256 before activation. | Complete |
| Storage | Verified bytes are stored as a Blob in IndexedDB, not `chrome.storage.local`. **Remove model** deletes the stored model. | Complete |
| Browser runtime | ONNX Runtime Web 1.30.0 is packaged locally with its MIT license and notice. No runtime script is loaded from a CDN. | Complete |
| Execution host | A Manifest V3 offscreen document owns a dedicated worker so inference survives side-panel lifecycle changes. | Complete |
| Inference | Uses the packaged Wasm execution provider, single-threaded by default for non-cross-origin-isolated extension compatibility. | Complete |
| Lifecycle safety | Download cancellation, storage retry, transaction-complete persistence, epoch protection, session release, immediate reinstall, and idle host cleanup are implemented. | Complete |

### 2.3 Policy fidelity and result contract

| Area | V1 implementation | Status |
|---|---|---:|
| Board preprocessing | Implements the artifact’s `[1, 64, 12]` current-position tensor layout, including Black-to-move normalization and piece-color swapping. | Complete |
| Rating inputs | Sends `elo_self` and `elo_oppo`; linked ratings deliberately send the same value to both inputs. | Complete |
| Legal policy | Decodes the 4,352-action policy vocabulary, including promotions, and normalizes only over legal moves. | Complete |
| Black moves | Mirrors model actions back to original-board legal UCI before rendering. | Complete |
| Outcome head | Decodes exactly three Loss/Draw/Win logits as a learned human outcome tendency for the side to move. | Complete |
| Native schema | `maia-analysis/v1` rejects objective-only fields such as `score`, `depth`, `mate`, `pvs`, `pv`, `bestMove`, and `evaluation`. | Complete |
| History honesty | The approved V1 browser artifact is current-position-only. V1 does not reconstruct, pad, or invent historical board states. | Complete |

### 2.4 Routing, safety, and request integrity

| Area | V1 implementation | Status |
|---|---|---:|
| Cloud bypass | A selected Maia request uses `performMaiaAnalysis`; it does not enter the objective cloud-provider coordinator or silently fall back to an objective/local engine. | Complete |
| Allowed contexts | Maia is allowed only on recognised `analysis-board`, `study`, and `completed-game` contexts. | Complete |
| Fail-closed behavior | Live, unknown, incomplete, unreliable, and hidden-template contexts are denied. Completed-game detection requires visible terminal-result evidence. | Complete |
| Automatic analysis | Maia is manual by default. Automatic Maia analysis requires a verified FEN, an explicitly permitted context, the selected player’s turn, and the Maia-specific opt-in. | Complete |
| Manual review | In a permitted review/study/completed-game context, **Refresh** can inspect the FEN side to move even if it is not the selected player. | Complete |
| Startup privacy race | The panel restores the persisted engine selection and assisted-player color before it may dispatch the initial board request; a saved Maia selection cannot briefly route through Objective/cloud analysis. | Complete |
| Stale results | Request IDs are preserved from panel → background → offscreen host → worker → panel. Same-FEN, out-of-order responses and stale engine-mode status events are suppressed. | Complete |

---

## 3. Pinned V1 artifact

| Field | Value |
|---|---|
| Model ID | `maia3-browser-fp16` |
| Display name | Maia-3 browser model |
| Artifact version | `3` |
| Source revision | `0013cc8e6ec52c88f5b3d694781d4cc8427cb91a` |
| Download size | `45,683,686` bytes |
| SHA-256 | `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856` |
| Inputs | `tokens` `[batch, 64, 12]`, `elo_self` `[batch]`, `elo_oppo` `[batch]` |
| Outputs | `logits_move` `[batch, 4352]`, `logits_value` `[batch, 3]` |
| Context model | Current position only |

The canonical metadata lives in [`engine/maia/maia-model-manifest.js`](../engine/maia/maia-model-manifest.js). Do not change the URL, revision, size, hash, tensor names, shapes, or action vocabulary without a new immutable artifact record and dedicated regression vectors.

---

## 4. Validation completed for V1

### Automated checks

- JavaScript syntax checks for every touched runtime and UI file.
- `manifest.json` parsing.
- `git diff --check`.
- Full repository Node test suite.
- Dedicated Maia coverage:
  - `tests/maia-background-routing.test.js`
  - `tests/maia-context-safety.test.js`
  - `tests/maia-preprocess.test.js`
  - `tests/maia-runtime-safety.test.js`
  - `tests/maia-ui-wiring.test.js`

### Artifact and inference checks

- `node tools/verify-maia-artifact.js /path/to/maia3_simplified.onnx` verified the exact V1 byte count and SHA-256.
- A direct ONNX Runtime Web/Wasm smoke test loaded the artifact, validated its input/output names, ran inference, decoded a 4,352-entry policy, and returned legal Black-to-move opening moves including `e7e5`, `d7d5`, `c7c5`, `e7e6`, and `c7c6`.

### Manual verification still required before a public release

The environment used for implementation did not have a local Chrome/Chromium binary, and the attempted Playwright Chromium download failed due to network TLS resets. The following real-browser checks are therefore still required:

1. Load the unpacked extension in Chrome 114 and current stable.
2. Confirm narrow side-panel layout, keyboard navigation, and reduced-motion behavior.
3. Download the model, watch real progress updates, cancel an interrupted download, retry, remove, and reinstall.
4. Verify model persistence through panel close/reopen and service-worker/offscreen lifecycle changes.
5. Switch Objective ↔ Maia during active inference and confirm no stale panel result appears.
6. Test safe analysis/study/completed-game routes and denied live/unknown routes.
7. Record cold session setup, warm inference p50/p95, memory, and IndexedDB storage use on representative devices.

---

## 5. Known V1 boundaries

These are deliberate V1 boundaries, not defects to paper over with fabricated behavior.

- **No model weights are bundled.** The user installs the model explicitly.
- **No historical eight-state input.** The selected artifact uses only the current position.
- **No synthetic history.** Do not pad or infer prior positions from DOM state, FEN counters, or opening guesses.
- **No objective reinterpretation.** Never map policy probabilities or learned LDW values into centipawns, engine strength, mate scores, PVs, or move grades.
- **No automatic live-game assistance.** Maia remains unavailable outside the explicit review contexts.
- **No silent fallback.** If the local model is absent or fails, show Maia’s lifecycle/error state; do not substitute cloud or heuristic output under the Maia label.
- **No accelerator promise.** V1 intentionally uses a portable Wasm path. WebGPU/WebNN remains future work and must retain a tested Wasm fallback.

---

## 6. Recommended continuation roadmap

### V1.1 — Real Chrome certification and UI polish

**Goal:** turn the implemented UI into a browser-certified release without changing Maia semantics.

- Run the manual browser matrix in section 4 on Chrome 114 and current stable.
- Measure panel layout at common side-panel widths and high-DPI/scaled displays.
- Tune visual density, copy, focus states, status transitions, and progress feedback from observed behavior.
- Benchmark cold model load, warm inference, memory, and storage; publish measured values rather than assumptions.
- Add browser automation or an unpacked-extension smoke harness once a stable Chromium acquisition path is available.

**Exit criteria:** all V1 manual checks documented, no console/CSP/worker errors, and measured performance is acceptable on the supported device baseline.

### V1.2 — Runtime resilience and model-management quality

**Goal:** make model ownership and recovery more transparent without broadening data access.

- Add a clear model metadata/details view: artifact version, hash prefix, local size, install date, and last successful load.
- Improve user-facing recovery for quota failures, offline installs, permission revocation, corrupt cached models, and interrupted upgrades.
- Add an explicit “check local model” integrity action if it can run without unexpected heavy work.
- Test extension update migration and IndexedDB schema migration paths.
- Add telemetry-free local timing diagnostics that the user can copy/export voluntarily.

**Exit criteria:** failed installs/removals/restarts recover predictably and never leave a misleading ready state.

### V1.3 — Maia policy learning experience

**Goal:** improve comprehension while preserving policy-prediction semantics.

- Add an optional compact explanation of the selected rating context and legal-only normalization.
- Consider a controlled side-by-side rating comparison, clearly labeled as multiple Maia policy queries rather than objective analysis.
- Add optional policy-distribution details such as legal-move count and “other legal moves” probability mass.
- Improve empty/error states for unavailable positions and uninstalled models.

**Do not add:** objective labels, synthetic evaluation bars, or a “Maia best move” label.

### V2.0 — History-capable Maia artifact (only if independently approved)

**Goal:** support a future model that genuinely requires historical board states.

This work must begin only after there is a separately approved, immutable artifact with:

- source provenance and redistribution approval;
- exact input/output names, types, shapes, and action vocabulary;
- golden preprocessing/inference vectors;
- a documented policy for trusted chronological history;
- storage and browser benchmark budgets; and
- a user-visible disclosure of exact-history versus unavailable-history behavior.

A future history model may replay **trusted** chronological moves/states. It must not infer history from piece placement or silently pad a current board unless that exact fallback is part of the approved model contract and is explicitly labeled.

### V2.x — Optional acceleration and model catalog

**Goal:** broaden capability while keeping local, verified, semantic-safe behavior.

- Evaluate opt-in WebGPU/WebNN acceleration behind capability checks and benchmark gates.
- Keep the Wasm provider as a tested fallback.
- Support multiple user-selectable models only through manifest entries with independent immutable URLs, byte counts, hashes, contracts, storage accounting, and removal controls.
- Add per-model compatibility checks before download and preserve the policy-only result contract for every Maia-family model.

---

## 7. Non-negotiable invariants for every future change

A continuation must preserve all of the following:

1. **Maia remains a human-move policy predictor.**
2. **Every rendered move is legal for the exact verified FEN.**
3. **Objective and Maia result schemas remain separate.**
4. **Model code is packaged; model bytes are explicitly user-installed and integrity-verified.**
5. **Maia does not silently trigger objective cloud analysis or fall back to it.**
6. **Unknown/live/unreliable contexts fail closed.**
7. **No history is invented.**
8. **Every async result remains correlated to its originating request, FEN, engine mode, and relevant settings.**
9. **Any model replacement receives a new artifact manifest, tests, documentation, and browser validation.**

---

## 8. How to append future log entries

Append a new entry above this section for every planned or shipped Maia release using this template:

```md
## YYYY-MM-DD — Maia Vx.y — Short release name

**Status:** planned | in progress | validated | released

### Goal
One sentence describing the user-facing outcome.

### Changes
- Runtime:
- UI:
- Safety/semantics:
- Documentation:

### Validation
- Automated:
- Browser/manual:
- Artifact/model evidence:

### Decisions and limitations
- What intentionally remains out of scope:
- Migration/compatibility notes:

### Next actions
1. ...
```

Keep this file factual: distinguish implemented behavior from future proposals, record exact artifact changes, and never mark browser validation complete unless it has actually been run.

# Maia-3 v1 local runtime

This document records the browser model and runtime actually shipped for the first Maia engine option.

## What v1 does

- Adds **Maia-3** as a top-level engine selection next to Objective analysis.
- Runs its model locally in an extension offscreen document and dedicated worker.
- Shows a deterministic, legal-only top 1, 3, or 5 learned likely moves for the selected rating context.
- Keeps Maia results separate from objective scores, depth, PVs, HumanForm, and objective move classifications.
- Is manual by default and is denied on live/unknown routes. The supported contexts are recognised analysis boards, studies, and visibly completed games; an explicit Refresh can inspect the FEN side to move during those review contexts.

The extension does not package model weights. The user explicitly grants the narrowly scoped model-host permission and clicks **Download model**. The verified bytes live in IndexedDB, not `chrome.storage.local`, and **Remove model** deletes them. On panel startup, the engine choice and assisted-player preference are restored before the first board can dispatch analysis, so a saved Maia selection cannot race into the default Objective/cloud route.

## Pinned first-release artifact

| Field | Value |
|---|---|
| Model ID | `maia3-browser-fp16` |
| Display name | Maia-3 browser model |
| Artifact version | `3` |
| Artifact format | ONNX, Float32 inputs / browser Wasm execution |
| Immutable source | `CSSLab/maia-platform-frontend` commit `0013cc8e6ec52c88f5b3d694781d4cc8427cb91a` |
| Asset path | `public/maia3/maia3_simplified.onnx` |
| Download bytes | `45,683,686` |
| SHA-256 | `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856` |
| Model inputs | `tokens` `[1, 64, 12]`, `elo_self` `[1]`, `elo_oppo` `[1]` |
| Model outputs | `logits_move` `[1, 4352]`, `logits_value` `[1, 3]` |

The manifest (`engine/maia/maia-model-manifest.js`) is the source of truth. The download URL is commit-pinned, and activation requires the exact byte length, SHA-256, and ONNX input/output names, Float32 types, and concrete tensor dimensions. A failure never becomes a hint and the invalid stored record is removed.

## Context and history disclosure

This approved browser artifact is a **current-position model**. It consumes a single `[64, 12]` board tensor rather than an eight-state history tensor. The panel explicitly says that it uses the current position only and that the extension did not fabricate history. `content.js` forwards `historyQuality: 'unavailable'` unless a future adapter can prove a site history payload is authoritative.

Black-to-move positions are vertically mirrored and colors swapped before tensorization. Legal moves are generated from the original complete FEN, converted to model orientation for policy lookup, decoded, converted back, and revalidated before display.

The 4,352 policy actions are generated algorithmically rather than copied as a large JSON table:

- normal UCI actions: `square(from) * 64 + square(to)`, where `a1 = 0`;
- promotions in normalized White orientation: `4096 + (fromFile * 8 + toFile) * 4 + promotion`, with promotion order `q`, `r`, `b`, `n`.

Softmax is applied only across those legal actions. `logits_value` is decoded as loss/draw/win in the model's side-to-move context and is labelled **human outcome tendency**, never evaluation.

## Runtime lifecycle

```text
side panel → background dispatcher → offscreen host → Maia worker → ONNX Runtime Web/Wasm
                                                        ↕
                                                   IndexedDB Blob
```

The packaged ONNX Runtime Web 1.30.0 assets and its MIT license notice are in `vendor/onnxruntime-web/`; no CDN script is loaded. The worker makes model-host requests only while installing. It checks browser storage availability, streams download progress, supports cancellation, hashes the completed bytes, opens a session, then promotes the verified IndexedDB record. The previous verified record is not replaced until a new session opens successfully.

The background creates one offscreen host under Chrome 114's `WORKERS` reason, uses `chrome.runtime.getContexts()` with a `clients.matchAll()` fallback, and asks it to close after idle time. A later request recreates the host and reloads the verified blob.

## Quick verification

Run the model-free checks from the repository root:

```sh
for test in tests/*.test.js; do node "$test"; done
python3 -m json.tool manifest.json >/dev/null
```

`tests/maia-preprocess.test.js` covers the pinned artifact metadata, board orientation, legal-only softmax, black decoding, promotions, LDW semantics, and rejection of pseudo-PV/score data. `tests/maia-background-routing.test.js` proves a Maia selection sends no request through the objective-provider route. `tests/maia-ui-wiring.test.js` covers the separate engine, model lifecycle, and policy UI wiring.

To independently check a downloaded artifact before installation, run:

```sh
node tools/verify-maia-artifact.js /path/to/maia3_simplified.onnx
```

For a browser smoke test: load the unpacked extension, open a recognised analysis/study board with a verified FEN, select **Maia-3** in Settings, click **Download model**, wait for **Ready locally**, then press Refresh. After that, disconnecting from the model host should still permit local inference from the IndexedDB blob.

'use strict';
// Maia-3 local policy preprocessing/contract regression tests. These tests
// deliberately do not load the 45 MB ONNX model; they lock the deterministic
// browser-side model contract and legal-policy decoding instead.
const assert = require('node:assert/strict');

require('../engine/core-utils.js');
require('../engine/analysis-contract.js');
const manifest = require('../engine/maia/maia-model-manifest.js');
const contract = require('../engine/maia/maia-contract.js');
const prep = require('../engine/maia/maia-preprocess.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

// ── Pinned artifact metadata ──────────────────────────────────────────
const model = manifest.get();
assert.equal(model.id, manifest.DEFAULT_MODEL_ID);
assert.equal(model.expectedBytes, 45683686);
assert.equal(model.artifactVersion, '3');
assert.equal(model.sha256, '405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856');
assert.equal(model.sourceRevision, '0013cc8e6ec52c88f5b3d694781d4cc8427cb91a');
assert.equal(model.inputs.tokens.name, 'tokens');
assert.deepEqual(model.inputs.tokens.shape, ['batch', 64, 12]);
assert.equal(model.outputs.policy.name, 'logits_move');
assert.equal(model.outputs.ldw.name, 'logits_value');
assert.equal(model.history.mode, 'current-position-model');
assert.equal(manifest.has('__proto__'), false, 'only own manifest keys are valid model IDs');
assert.equal(manifest.get('__proto__'), model, 'invalid/inherited model IDs fall back to the approved model');

// ── Exact 4,352-action Maia-3 mapping ─────────────────────────────────
assert.equal(prep.actionIndex('a1a1'), 0);
assert.equal(prep.actionIndex('a1h8'), 63);
assert.equal(prep.actionIndex('e2e4'), (12 * 64) + 28);
assert.equal(prep.actionMove(796), 'e2e4');
assert.equal(prep.actionIndex('a7a8q'), 4096);
assert.equal(prep.actionIndex('a7a8r'), 4097);
assert.equal(prep.actionIndex('a7a8b'), 4098);
assert.equal(prep.actionIndex('a7a8n'), 4099);
assert.equal(prep.actionIndex('h7h8n'), 4351);
assert.equal(prep.actionMove(4351), 'h7h8n');
assert.equal(prep.actionIndex('a2a1q'), -1, 'only normalized rank-7-to-rank-8 promotion actions exist');

// ── Board tensor orientation ──────────────────────────────────────────
const startTokens = prep.boardToTokens(START);
assert.equal(startTokens.length, 64 * 12);
assert.equal(startTokens[8 * 12 + 0], 1, 'white pawn a2 uses the first white-pawn slot');
assert.equal(startTokens[48 * 12 + 6], 1, 'black pawn a7 uses the black-pawn slot');
assert.equal(startTokens[4 * 12 + 5], 1, 'white king e1 is on square-major channel 5');

const blackTokens = prep.boardToTokens(AFTER_E4);
// For a Black move, Maia normalizes the side to move to White: original black
// e7 pawn becomes a white e2 pawn, and original white e4 pawn becomes black e5.
assert.equal(blackTokens[12 * 12 + 0], 1, 'black e7 pawn mirrors to normalized white e2');
assert.equal(blackTokens[36 * 12 + 6], 1, 'white e4 pawn mirrors to normalized black e5');
assert.equal(prep.mirrorMove('e7e5'), 'e2e4');

// ── Legal-only softmax/decoding ───────────────────────────────────────
const logits = new Float32Array(prep.POLICY_SIZE);
logits.fill(-30);
logits[prep.actionIndex('e2e4')] = 5;
logits[prep.actionIndex('d2d4')] = 4;
logits[prep.actionIndex('e1e8')] = 999; // impossible move must never leak
const decoded = prep.decodePolicy(START, logits, 3);
assert.equal(decoded.ok, true);
assert.deepEqual(decoded.moves.map(move => move.uci).slice(0, 2), ['e2e4', 'd2d4']);
assert.ok(decoded.moves.every(move => globalThis.AnalysisContract.isLegalMove(START, move.uci)));
assert.ok(decoded.moves[0].probability > decoded.moves[1].probability);
assert.ok(decoded.moves.reduce((sum, move) => sum + move.probability, 0) <= 1);

const blackLogits = new Float32Array(prep.POLICY_SIZE);
blackLogits.fill(-30);
blackLogits[prep.actionIndex(prep.mirrorMove('e7e5'))] = 5;
const blackDecoded = prep.decodePolicy(AFTER_E4, blackLogits, 1);
assert.equal(blackDecoded.ok, true);
assert.equal(blackDecoded.moves[0].uci, 'e7e5', 'decoded policy mirrors back to the original black move');
assert.equal(globalThis.AnalysisContract.isLegalMove(AFTER_E4, blackDecoded.moves[0].uci), true);

const PROMOTION = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
const promotionLogits = new Float32Array(prep.POLICY_SIZE);
promotionLogits.fill(-30);
promotionLogits[prep.actionIndex('a7a8n')] = 6;
const promotionDecoded = prep.decodePolicy(PROMOTION, promotionLogits, 1);
assert.equal(promotionDecoded.ok, true);
assert.equal(promotionDecoded.moves[0].uci, 'a7a8n');

const CASTLE = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
const castleLogits = new Float32Array(prep.POLICY_SIZE);
castleLogits.fill(-30);
castleLogits[prep.actionIndex('e1g1')] = 6;
assert.equal(prep.decodePolicy(CASTLE, castleLogits, 1).moves[0].uci, 'e1g1', 'castling remains a legal normal action');

const EN_PASSANT = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2';
const epLogits = new Float32Array(prep.POLICY_SIZE);
epLogits.fill(-30);
epLogits[prep.actionIndex('e5d6')] = 6;
assert.equal(prep.decodePolicy(EN_PASSANT, epLogits, 1).moves[0].uci, 'e5d6', 'en passant is retained in the legal policy mask');

const BLACK_PROMOTION = 'k7/8/8/8/8/8/p7/7K b - - 0 1';
const blackPromotionLogits = new Float32Array(prep.POLICY_SIZE);
blackPromotionLogits.fill(-30);
blackPromotionLogits[prep.actionIndex(prep.mirrorMove('a2a1n'))] = 6;
assert.equal(prep.decodePolicy(BLACK_PROMOTION, blackPromotionLogits, 1).moves[0].uci, 'a2a1n', 'black underpromotion unmirrors to original-board UCI');

// ── LDW semantics are an optional learned tendency, not an eval ───────
const outcome = prep.decodeLdw(Float32Array.of(-1, 0, 1));
assert.ok(outcome);
assert.equal(outcome.scope, 'current-position');
assert.equal(outcome.perspective, 'side-to-move');
assert.ok(Math.abs(outcome.win + outcome.draw + outcome.loss - 1) < 1e-9);
assert.ok(outcome.win > outcome.draw && outcome.draw > outcome.loss);

// ── Native Maia contract rejects illegal/extraneous objective fields ──
const analysis = contract.buildAnalysis({
  fen: START,
  requestId: 'test',
  model,
  ratingContext: { sideToMoveElo: 1500, opponentElo: 1750, linkedRatings: false },
  hintCount: 3,
  history: model.history,
  moves: decoded.moves,
  humanOutcome: outcome
});
assert.equal(analysis.kind, 'maia-analysis/v1');
assert.equal(analysis.engineId, 'maia3');
assert.equal(analysis.source, 'maia3-local');
assert.equal(analysis.topMove.uci, 'e2e4');
assert.equal(analysis.ratingContext.opponentElo, 1750);
assert.equal(Object.hasOwn(analysis, 'pvs'), false, 'Maia schema has no fabricated principal variations');
assert.equal(Object.hasOwn(analysis, 'score'), false, 'Maia schema has no fabricated centipawn score');
assert.equal(contract.validateMaiaAnalysis({
  fen: START, model, moves: decoded.moves, hintCount: 3, score: 42
}).ok, false, 'native Maia validator rejects objective score fields rather than silently accepting them');
assert.equal(contract.validateMaiaAnalysis({
  fen: START, model, moves: decoded.moves, hintCount: 3
}).ok, true, 'native Maia validator accepts legal policy data');

const rejected = contract.buildAnalysis({
  fen: START,
  model,
  moves: [{ uci: 'e1e8', probability: 1 }]
});
assert.equal(rejected.error, true);
assert.equal(rejected.errorDetail.code, 'illegal_policy_move');

const normalized = contract.normalizeSettings({
  analysisEngine: 'maia3', maiaSideToMoveElo: 200, maiaOpponentElo: 9999,
  maiaLinkRatings: false, maiaHintCount: 4
}, manifest);
assert.equal(normalized.analysisEngine, 'maia3');
assert.equal(normalized.maiaSideToMoveElo, 600);
assert.equal(normalized.maiaOpponentElo, 2600);
assert.equal(normalized.maiaHintCount, 3);
assert.equal(contract.normalizeSettings({ maiaModelId: '__proto__' }, manifest).maiaModelId, manifest.DEFAULT_MODEL_ID,
  'invalid inherited model IDs cannot survive persisted-settings normalization');

console.log('maia preprocessing and contract tests passed');

'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// Tests for the offline sparring form model (engine/human-form.js) and its
// integration with hint-engine's human-like selection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = {
  window: {},
  chrome: { runtime: { getURL: value => value } },
  fetch: () => Promise.reject(new Error('offline test')),
  console: { log() {}, warn() {}, error() {} },
  Math, Promise, setTimeout, clearTimeout
};
vm.createContext(sandbox);
for (const file of ['human-form.js', 'chaos-attack.js', 'early-king-hunt.js', 'hint-engine.js']) {
  vm.runInContext(fs.readFileSync(require.resolve(`../engine/${file}`), 'utf8'), sandbox);
}
const form = sandbox.HumanForm || sandbox.window.HumanForm;
const engine = sandbox.window.ChessHintEngine;

// ── Rating normalization & anchors ─────────────────────────────────────
assert.equal(form.normalizeRating(5000), 1600, 'rating clamps to the max anchor');
assert.equal(form.normalizeRating(-10), 600, 'rating clamps to the min anchor');
assert.equal(form.normalizeRating(undefined), form.RATING_DEFAULT);
assert.equal(form.normalizeRating('1100'), 1100);

// Calibration is monotonic between anchors.
const c900 = form.calibrate(900);
const c1100 = form.calibrate(1100);
const c1300 = form.calibrate(1300);
assert.ok(c900.marginScale > c1100.marginScale && c1100.marginScale > c1300.marginScale,
  'margin scale shrinks as strength rises');
assert.ok(c900.slipChance > c1100.slipChance && c1100.slipChance > c1300.slipChance,
  'slip chance falls as strength rises');
// Anchor rows reproduce exactly at their rating.
const exact = JSON.parse(JSON.stringify(form.calibrate(600)));
assert.deepEqual(exact, { ...form.ANCHORS[0] });

// ── Session determinism ────────────────────────────────────────────────
const session = form.createSession({ rating: 1000, seed: 'game-test-1' });
assert.equal(session.rating, 1000);
assert.ok(Number.isFinite(session.form) && session.form >= -1 && session.form <= 1);

const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const p1 = form.paramsFor(session, fen, 0);
const p1again = form.paramsFor(session, fen, 0);
assert.deepEqual(p1, p1again, 'params are deterministic per (session, fen)');
assert.ok(p1.marginScale > 0 && p1.slipChance >= 0 && p1.slipChance <= 0.55);
assert.equal(p1.rating, 1000);

// paramsFor tolerates a missing session / garbage eval without throwing.
assert.equal(form.paramsFor(null, fen, 0), null);
form.paramsFor(session, fen, Number.NaN);

// ── Winning relaxation is score-based only ─────────────────────────────
const equalParams = form.paramsFor(session, fen, 0);
const winningParams = form.paramsFor(session, fen, 800);
const losingParams = form.paramsFor(session, fen, -400);
assert.ok(winningParams.marginScale > equalParams.marginScale,
  'clearly winning positions relax the choice pool');
assert.ok(winningParams.slipChance > equalParams.slipChance,
  'clearly winning positions slip more (humans stop calculating precisely)');
assert.ok(losingParams.marginScale < equalParams.marginScale,
  'losing positions tighten up slightly');

// ── Integration: human-like selection stays safe under the form model ──
const attackFen = '4k3/8/8/8/8/8/8/3Q2K1 w - - 0 1';
const quiet = { score: 50, scoreType: 'cp', depth: 25, pv: ['d1d2'] };
const forcingCheck = { score: 20, scoreType: 'cp', depth: 25, pv: ['d1h5'] };

// Determinism holds through the full selection pipeline.
const ctx = { formSession: { ...session } };
const selA = engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'super_ultra_aggressive', 'w', true, ctx);
const selB = engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'super_ultra_aggressive', 'w', true, ctx);
assert.deepEqual(
  JSON.parse(JSON.stringify(selA)),
  JSON.parse(JSON.stringify(selB)),
  'form-driven selection must be deterministic per (session seed, fen)'
);

// A different session seed may legitimately produce a different in-character
// pick for the same position — but both picks must be legal shortlist members.
const otherSession = form.createSession({ rating: 700, seed: 'game-other-42' });
const selOther = engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'super_ultra_aggressive', 'w', true,
  { formSession: otherSession });
const allowed = new Set([quiet.pv[0], forcingCheck.pv[0]]);
assert.ok(allowed.has(selOther[0].pv[0]), 'every pick comes from the candidate pool');

// Hard safety survives the form model at every strength: fastest mate wins.
const hugeCp = { score: 900, scoreType: 'cp', depth: 30, pv: ['d1d3'] };
const slowerMate = { score: 5, scoreType: 'mate', depth: 30, pv: ['d1d2'] };
const fastestMate = { score: 2, scoreType: 'mate', depth: 30, pv: ['d1h5'] };
for (const strength of [600, 800, 1100, 1400, 1600]) {
  const s = form.createSession({ rating: strength, seed: `safety-${strength}` });
  const picked = engine.selectPVForStyle([hugeCp, slowerMate, fastestMate], attackFen, 'super_ultra_aggressive', 'w', true,
    { formSession: s })[0];
  assert.equal(picked.score, 2, `strength ${strength} must preserve the fastest forced mate`);
}

// No formSession in context → legacy behavior (no crash, deterministic).
const legacy = engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'aggressive', 'w', true, {});
assert.equal(legacy[0].pv[0], 'd1h5',
  'without a form session the aggressive style keeps its sound forcing route');

// ── Human-mode thinking policy ─────────────────────────────────────────
const policySandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
vm.createContext(policySandbox);
vm.runInContext(fs.readFileSync(require.resolve('../engine/analysis-policy.js'), 'utf8'), policySandbox);
const policy = policySandbox.window.AnalysisPolicy || policySandbox.AnalysisPolicy;

assert.equal(policy.resolveMultiPv({ humanLikeMode: true }), 5,
  'human mode auto width requests the maximum candidate pool');
assert.equal(policy.resolveMultiPv({ humanLikeMode: true, candidateLines: 3 }), 3,
  'an explicit candidate-lines choice still wins over human mode');
assert.equal(policy.resolveMultiPv({}), 2, 'non-human auto width stays narrow');

const humanQuality = policy.resolveQuality({ humanLikeMode: true });
assert.equal(humanQuality.id, 'balanced',
  'human mode Auto holds steady balanced-class depth');
const humanUltraQuality = policy.resolveQuality({
  humanLikeMode: true, style: 'super_ultra_aggressive', earlyKingHuntEnabled: true
});
assert.equal(humanUltraQuality.chessApiDepth, humanQuality.chessApiDepth,
  'human mode cancels the ultra-style depth escalation');
const deepRespected = policy.resolveQuality({ humanLikeMode: true, analysisQuality: 'deep' });
assert.equal(deepRespected.id, 'deep', 'explicit quality choices are honored in human mode');

console.log('human-form tests passed');

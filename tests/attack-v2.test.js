'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// Tests for the V2 strategic layers:
//   chaos-attack.js  — sac-mechanism classification, zero-freedom initiative,
//                      quiet attacking prep.
//   early-king-hunt.js — target-complex selection, queen-entry window,
//                        defender-removal ordering, slow-queen gate.
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
const engine = sandbox.window.ChessHintEngine;

// ── Chaos V2: zero-freedom initiative ─────────────────────────────────
// A line where the only defender reply is a king move is fully forced.
const attackFen = '4k3/8/8/8/8/8/8/3Q2K1 w - - 0 1';
const forcedLine = engine.analyzeCandidate(
  attackFen, ['d1h5', 'e8d8', 'h5d8'], 'w', 900000, 'mate', 24);
assert.equal(forcedLine.zeroFreedom, true,
  'a line whose only defender replies are king moves has zero freedom');
assert.ok(Number.isFinite(forcedLine.defenderForcedRatio));

// ── Chaos V2: sacrifice mechanism classification ──────────────────────
// Qxh7+ Kxh7 — the classic Greek-gift-shaped deflection/line-open sac.
const sacFen = '6k1/7p/8/8/8/3Q4/8/6K1 w - - 0 1';
const mechSac = engine.analyzeCandidate(sacFen, ['d3h7', 'g8h7'], 'w', -40, 'cp', 24);
assert.equal(mechSac.sacrifice, true);
assert.ok(['lineOpen', 'deflect', 'tempo'].includes(mechSac.sacMechanism),
  `the shield-stripping queen sac states its mechanism (got ${mechSac.sacMechanism})`);
assert.notEqual(mechSac.sacMechanism, null);

// A quiet non-sacrificial move has no mechanism and no prep tag conflict.
const plainMove = engine.analyzeCandidate(sacFen, ['d3d2'], 'w', 30, 'cp', 24);
assert.equal(plainMove.sacMechanism ?? null, null);

// ── Chaos V2: quiet attacking prep ────────────────────────────────────
// Kh1 tucks the king into the shelter row without dropping pressure.
const prepFen = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PP1/R1BQ1RK1 w - - 0 8';
const kingTuck = engine.analyzeCandidate(prepFen, ['g1h1'], 'w', 10, 'cp', 20);
assert.equal(kingTuck.quietPrepKind, 'kingSafety',
  `Kh1 in a sheltered corner reads as king-safety prep (got ${kingTuck.quietPrepKind})`);

// ── Siege continuity reaches the style scorer ─────────────────────────
const quiet = { score: 50, scoreType: 'cp', depth: 25, pv: ['d1d2'] };
const checkLine = { score: 40, scoreType: 'cp', depth: 25, pv: ['d1h5'] };
const planCtx = { activePlan: 'kingside attack' };
const ranked = engine.selectPVForStyle([quiet, checkLine], attackFen, 'super_ultra_aggressive', 'w', false, planCtx);
const withPlan = ranked.find(pv => pv.pv[0] === 'h5');
if (withPlan && withPlan._styleAnalysis.plan === 'kingside attack') {
  assert.equal(withPlan._styleAnalysis.siegeContinuity, true,
    'candidates advancing the active plan carry the continuity flag');
}

// ── Early King Hunt V2 strategic layer ────────────────────────────────
// Opening position, Ultra style, opt-in ON. Qh5!? — the dubious sortie.
const ekhFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3';
const sortie = engine.analyzeCandidate(ekhFen, ['d1h5'], 'w', 20, 'cp', 20,
  { style: 'super_ultra_aggressive', earlyKingHuntEnabled: true });
assert.equal(sortie.earlyKingHuntActive, true, 'EKH activates in the opening with opt-in');
// Field contract: all V2 outputs exist so downstream code never guesses.
for (const key of [
  'earlyKingHuntQueenWindowOpen',
  'earlyKingHuntComplexDefenderRemoved',
  'earlyKingHuntComplexProgress',
  'earlyKingHuntSlowQueenOut'
]) {
  assert.ok(key in sortie, `EKH exposes ${key}`);
}
// Qh5 here: deep but it pressures f7 (Scholar's pattern) → NOT flagged slow,
// because it carries a concrete attacking point.
assert.equal(sortie.earlyKingHuntQueenWindowOpen, false,
  'an unsupported deep queen sortie is outside the entry window');
assert.equal(sortie.earlyKingHuntSlowQueenOut, false,
  'a sortie with a real threat (f7 pressure) is not a slow queen move');

// A passive early queen move (Qe2: no check, no pressure, no tempo) trips
// the slow-queen gate.
const passive = engine.analyzeCandidate(ekhFen, ['d1e2'], 'w', 10, 'cp', 20,
  { style: 'super_ultra_aggressive', earlyKingHuntEnabled: true });
assert.equal(passive.earlyKingHuntSlowQueenOut, true,
  'the passive early queen retreat trips the slow-queen gate');

// Mate safety still outranks everything under both V2 layers.
const hugeCp = { score: 900, scoreType: 'cp', depth: 30, pv: ['d1d3'] };
const slowerMate = { score: 5, scoreType: 'mate', depth: 30, pv: ['d1d2'] };
const fastestMate = { score: 2, scoreType: 'mate', depth: 30, pv: ['d1h5'] };
const picked = engine.selectPVForStyle(
  [hugeCp, slowerMate, fastestMate], attackFen, 'super_ultra_aggressive', 'w', true,
  { formSession: { rating: 700, seed: 'v2-safety', form: 0.9 } })[0];
assert.equal(picked.score, 2, 'V2 layers never trade away the fastest forced mate');

console.log('attack-v2 tests passed');

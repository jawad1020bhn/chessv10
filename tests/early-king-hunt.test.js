'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// This project is a study/research tool for engine-style research and does not
// automate moves in rated or live games.
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
for (const file of ['engine/chaos-attack.js', 'engine/early-king-hunt.js', 'engine/hint-engine.js']) {
  vm.runInContext(fs.readFileSync(require.resolve(`../${file}`), 'utf8'), sandbox, { filename: file });
}

const hunt = sandbox.EarlyKingHunt;
const engine = sandbox.window.ChessHintEngine;
assert.equal(typeof hunt.createEngine, 'function');
assert.equal(typeof engine.selectPVForStyle, 'function');

const openingFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const directAttackPv = ['d1h5'];
const quietPv = ['d2d3'];

// The phase gate is independently testable and cannot be activated by the
// checkbox alone for another style or after the opening window.
const moduleEngine = hunt.createEngine({
  detectGamePhase: engine.detectGamePhase,
  isSquareAttacked: () => false,
  pieceAttacksSquare: () => false,
  findKing: () => null
});
assert.equal(moduleEngine.isActive('normal', true, openingFen), false);
assert.equal(moduleEngine.isActive('aggressive', true, openingFen), false);
assert.equal(moduleEngine.isActive('super_ultra_aggressive', false, openingFen), false);
assert.equal(moduleEngine.isActive('super_ultra_aggressive', true, openingFen), true);
assert.equal(moduleEngine.phaseInfo(openingFen.replace(' 4 4', ' - 17'), 'super_ultra_aggressive', true).active, false);

const active = engine.analyzeCandidate(
  openingFen, directAttackPv, 'w', 30, 'cp', 22,
  { style: 'super_ultra_aggressive', earlyKingHuntEnabled: true }
);
assert.equal(active.earlyKingHuntActive, true);
assert.equal(active.earlyKingHuntPhase, 'opening');
assert.ok(active.earlyKingHuntDirectAttack, 'the enabled system recognizes the direct king attack');
assert.ok(active.earlyKingHuntImmediateThreat > 0, 'the enabled system sees the immediate threat');
assert.ok(active.earlyKingHuntBonus === 0, 'feature computation remains pure until style scoring');

const selectedEarly = engine.selectPVForStyle(
  [
    { score: 80, scoreType: 'cp', depth: 22, pv: quietPv },
    { score: 30, scoreType: 'cp', depth: 22, pv: directAttackPv }
  ],
  openingFen,
  'super_ultra_aggressive',
  'w',
  false,
  { earlyKingHuntEnabled: true }
);
assert.equal(selectedEarly[0].pv[0], 'd1h5', 'the enabled early hunt can prefer the direct attack within its risk budget');
assert.equal(selectedEarly[0]._styleAnalysis.earlyKingHuntActive, true);
assert.ok(selectedEarly[0]._styleAnalysis.earlyKingHuntBonus > 0);
assert.ok(selectedEarly[0]._styleAnalysis.reasons.some(reason => reason.includes('Early King Hunt')));

// Disabled behavior remains the existing Ultra Super Aggressive ranking and
// has no active early feature state.
const selectedOff = engine.selectPVForStyle(
  [
    { score: 80, scoreType: 'cp', depth: 22, pv: quietPv },
    { score: 30, scoreType: 'cp', depth: 22, pv: directAttackPv }
  ],
  openingFen,
  'super_ultra_aggressive',
  'w',
  false,
  { earlyKingHuntEnabled: false }
);
assert.equal(selectedOff[0].pv[0], 'd1h5', 'the disabled setting leaves the existing Ultra Super Aggressive choice path intact');
assert.equal(selectedOff[0]._styleAnalysis.earlyKingHuntActive, false);
assert.equal(selectedOff[1]._styleAnalysis.earlyKingHuntActive, false);

// The exact same flag must not leak into Normal or Aggressive.
for (const style of ['normal', 'aggressive']) {
  const candidate = engine.analyzeCandidate(
    openingFen, directAttackPv, 'w', 30, 'cp', 22,
    { style, earlyKingHuntEnabled: true }
  );
  assert.equal(candidate.earlyKingHuntActive, false, `${style} ignores the Early King Hunt flag`);
}

// The transition boundary fades and then fully disables the module.
const transitionFen = openingFen.replace(' 4 4', ' - 12 12');
const transition = engine.analyzeCandidate(
  transitionFen, directAttackPv, 'w', 30, 'cp', 22,
  { style: 'super_ultra_aggressive', earlyKingHuntEnabled: true }
);
assert.equal(transition.earlyKingHuntActive, true);
assert.ok(transition.earlyKingHuntIntensity < 1 && transition.earlyKingHuntIntensity > 0);
const late = engine.analyzeCandidate(
  openingFen.replace(' 4 4', ' - 17 17'), directAttackPv, 'w', 30, 'cp', 22,
  { style: 'super_ultra_aggressive', earlyKingHuntEnabled: true }
);
assert.equal(late.earlyKingHuntActive, false);

console.log('early king hunt tests passed');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sandbox = { console, Math, Date, Number, Boolean, String, Array, Object, Set, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['engine/core-utils.js', 'engine/analysis-contract.js', 'engine/analysis-policy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const contract = sandbox.AnalysisContract;
const policy = sandbox.AnalysisPolicy;
const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const legal = contract.generateLegalMoves(start);
assert.ok(legal.includes('e2e4'));
assert.ok(legal.includes('g1f3'));
assert.equal(legal.includes('e2e5'), false);
assert.equal(contract.isLegalMove(start, 'e2e4'), true);
assert.equal(contract.isLegalMove(start, 'e2e5'), false);

const afterE4 = contract.applyMoveToFen(start, 'e2e4');
assert.equal(afterE4, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

const rejected = contract.finalizeAnalysis({
  source: 'chess-api',
  scorePerspective: 'white',
  pvs: [{ score: 30, scoreType: 'cp', depth: 18, pv: ['e2e5'] }]
}, start);
assert.equal(rejected.pvs.length, 0);
assert.equal(rejected.qualityClass, 'unavailable');

const blackFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const flipped = contract.finalizeAnalysis({
  source: 'lichess-cloud',
  scorePerspective: 'side-to-move',
  depth: 30,
  pvs: [{ score: 120, scoreType: 'cp', depth: 30, pv: ['e7e5'] }]
}, blackFen);
assert.equal(flipped.pvs[0].score, -120);
assert.equal(flipped.scorePerspective, 'white');
assert.equal(flipped.bestMove, 'e7e5');

const unreliable = contract.finalizeAnalysis({
  source: 'chess-api',
  pvs: [{ score: 20, scoreType: 'cp', depth: 12, pv: ['e2e4'] }]
}, start, { positionReliable: false });
assert.equal(unreliable.exactHintBlocked.reason, 'unreliable_position');
assert.equal(unreliable.pvs.length, 0);

const migrated = policy.migrateLegacySettings({ depthTarget: 30, cloudDepth: 10, whiteRepertoire: 'x' });
assert.equal(migrated.analysisQuality, 'deep');
assert.equal(migrated.candidateLines, 5);
assert.equal(migrated.whiteRepertoire, undefined);
assert.equal(policy.resolveMultiPv({ candidateLines: 'auto', style: 'normal' }), 2);
assert.equal(policy.resolveMultiPv({ candidateLines: 'auto', style: 'aggressive' }), 3);
assert.equal(policy.resolveMultiPv({ candidateLines: 'auto', style: 'super_ultra_aggressive' }), 5);
assert.equal(policy.describeQuality('opening-statistics').label, 'Opening statistics');
assert.equal(policy.shouldReplaceHumanWithEngine({ source: 'masters-explorer' }, start), false);

const localLabel = policy.qualityClassFor({ source: 'local-engine', depth: 3 });
assert.equal(localLabel, 'shallow-engine');

console.log('analysis-contract tests passed');

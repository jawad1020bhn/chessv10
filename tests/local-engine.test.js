'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sandbox = { console, Math, Date, Number, Boolean, String, Array, Object, Set, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['engine/core-utils.js', 'engine/analysis-contract.js', 'engine/local-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const result = sandbox.LocalEngine.analyze(start, { multiPv: 3, maxDepth: 2, timeMs: 120 });
assert.ok(result);
assert.equal(result.source, 'local-engine');
assert.ok(result.pvs.length >= 1);
assert.ok(sandbox.AnalysisContract.isLegalMove(start, result.pvs[0].pv[0]));
assert.ok(result.pvs.length <= 3);

const mateThreat = '6k1/8/6K1/8/8/8/8/7R w - - 0 1';
const mate = sandbox.LocalEngine.analyze(mateThreat, { multiPv: 1, maxDepth: 3, timeMs: 200 });
assert.ok(mate.pvs[0].pv[0]);
assert.ok(sandbox.AnalysisContract.isLegalMove(mateThreat, mate.pvs[0].pv[0]));

console.log('local-engine tests passed');

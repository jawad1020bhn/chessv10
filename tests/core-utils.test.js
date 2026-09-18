'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// This project is a study/research tool for building a chess engine that can
// play in a variety of styles (normal, aggressive, ultra-aggressive). It is
// intended for learning, offline analysis, and engine-variation research. It
// is anti-cheat compliant and fair-play safe: it never assists a player in a
// rated or live online game, and it must not be used to gain an unfair
// advantage against human opponents.
const assert = require('node:assert/strict');
require('../engine/core-utils.js');
const core = globalThis.ChessCore;

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
assert.ok(core.parseFen(start));
assert.equal(core.parseFen('8/8/8/8/8/8/8/8 w - - 0 1'), null, 'positions need exactly one king per side');
assert.equal(core.parseFen('not a fen'), null);
assert.equal(core.applyUciToPlacement(start, 'e2e4'), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');

const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
assert.equal(core.applyUciToPlacement(castle, 'e1g1'), 'r3k2r/8/8/8/8/8/8/R4RK1');
const promotion = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
assert.equal(core.applyUciToPlacement(promotion, 'a7a8n'), 'N3k3/8/8/8/8/8/8/4K3');
const ep = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2';
assert.equal(core.applyUciToPlacement(ep, 'e5d6'), '4k3/8/3P4/8/8/8/8/4K3');

const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
assert.equal(core.didUciProduceFen(start, 'e2e4', afterE4), true);
assert.equal(core.didUciProduceFen(start, 'd2d4', afterE4), false);
assert.equal(core.didUciProduceFen(start, 'e2e4', afterE4.replace(' b ', ' w ')), false, 'side to move must flip');

assert.equal(core.reconcileFen(start, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), afterE4);
const kingMoved = 'r3k2r/8/8/8/8/8/4K3/R6R b KQkq - 1 1';
assert.equal(core.reconcileFen(castle, kingMoved), 'r3k2r/8/8/8/8/8/4K3/R6R b kq - 1 1');
const blackReplyObserved = 'r6r/8/8/8/8/4k3/4K3/R6R w kq - 0 1';
assert.equal(
  core.reconcileFen('r3k2r/8/8/8/8/8/4K3/R6R b kq - 1 1', blackReplyObserved),
  'r6r/8/8/8/8/4k3/4K3/R6R w - - 2 2'
);

assert.equal(core.escapeHtml(`<img src=x onerror='x'>&"`), '&lt;img src=x onerror=&#39;x&#39;&gt;&amp;&quot;');
assert.equal(core.clampNumber(140, 0, 100), 100);
assert.equal(core.clampNumber('bad', 0, 100, 50), 50);
console.log('core-utils tests passed');

'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// This project is a study/research tool for building a chess engine that can
// play in a variety of styles (normal, aggressive, ultra-aggressive). It is
// intended for learning, offline analysis, and engine-variation research. It
// is anti-cheat compliant and fair-play safe: it never assists a player in a
// rated or live online game, and it must not be used to gain an unfair
// advantage against human opponents.
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
vm.runInContext(fs.readFileSync(require.resolve('../engine/chaos-attack.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(require.resolve('../engine/early-king-hunt.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(require.resolve('../engine/hint-engine.js'), 'utf8'), sandbox);
const engine = sandbox.window.ChessHintEngine;

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
assert.equal(engine.uciToSan('e2e4', start), 'e4');
assert.equal(engine.applyMoveToFen(start, 'e2e4'), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
assert.equal(engine.OPENING_REPERTOIRES, undefined, 'attacking repertoires are removed from the engine API');
assert.equal(typeof engine.styleSafetyAllows, 'function');

const castleCheck = '5k2/8/8/8/8/8/8/4K2R w K - 0 1';
assert.equal(engine.uciToSan('e1g1', castleCheck), 'O-O+');

const pinnedDisambiguation = 'k3r3/8/8/8/8/2N1N3/8/4K3 w - - 0 1';
assert.equal(engine.uciToSan('c3d5', pinnedDisambiguation), 'Nd5', 'a pinned alternate mover must not force SAN disambiguation');
const scholarsMate = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
assert.equal(engine.uciToSan('h5f7', scholarsMate), 'Qxf7#');

const rookCapture = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
assert.equal(engine.applyMoveToFen(rookCapture, 'a1a8').split(' ')[2], 'Kk', 'moving and captured rooks remove both queen-side rights');


// Rebuilt three-mode style engine.
assert.deepEqual(Object.keys(engine.PLAYING_STYLES), ['normal', 'aggressive', 'super_ultra_aggressive']);
const attackFen = '4k3/8/8/8/8/8/8/3Q2K1 w - - 0 1';
const quiet = { score: 50, scoreType: 'cp', depth: 25, pv: ['d1d2'] };
const forcingCheck = { score: 20, scoreType: 'cp', depth: 25, pv: ['d1h5'] };
assert.equal(engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'normal', 'w')[0].pv[0], 'd1d2');
assert.equal(engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'aggressive', 'w')[0].pv[0], 'd1h5', 'Aggressive should prefer a sound forcing route to a faster win');
assert.deepEqual(
  JSON.parse(JSON.stringify(engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'super_ultra_aggressive', 'w'))),
  JSON.parse(JSON.stringify(engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'super_ultra_aggressive', 'w'))),
  'style scoring must be deterministic and free of candidate-history mutation'
);

const clearlyWinningQuiet = { ...quiet, score: 300 };
const costlyCheck = { ...forcingCheck, score: 220 };
assert.equal(engine.selectPVForStyle([clearlyWinningQuiet, costlyCheck], attackFen, 'aggressive', 'w')[0].pv[0], 'd1d2', 'Aggressive must not spend outside its tighter winning budget');

const fastestMate = { score: 2, scoreType: 'mate', depth: 30, pv: ['d1h5'] };
const slowerMate = { score: 5, scoreType: 'mate', depth: 30, pv: ['d1d2'] };
const hugeCp = { score: 900, scoreType: 'cp', depth: 30, pv: ['d1d3'] };
for (const style of Object.keys(engine.PLAYING_STYLES)) {
  assert.equal(engine.selectPVForStyle([hugeCp, slowerMate, fastestMate], attackFen, style, 'w')[0].score, 2, `${style} must preserve the fastest forced mate`);
}

const sacrificeFen = '6k1/7p/8/8/8/3Q4/8/6K1 w - - 0 1';
const realSac = engine.analyzeCandidate(sacrificeFen, ['d3h7', 'g8h7'], 'w', -40, 'cp', 24);
const fakeSac = engine.analyzeCandidate(sacrificeFen, ['d3h7', 'g8f8'], 'w', -40, 'cp', 24);
assert.equal(realSac.sacrifice, true, 'material must actually disappear after the reply');
assert.equal(fakeSac.sacrifice, false, 'an expensive piece capturing a pawn is not automatically a sacrifice');
const safeQueenMove = { score: 100, scoreType: 'cp', depth: 24, pv: ['d3d2'] };
const speculativeQueenSac = { score: -40, scoreType: 'cp', depth: 24, pv: ['d3h7', 'g8h7'] };
const superUltraChoice = engine.selectPVForStyle([safeQueenMove, speculativeQueenSac], sacrificeFen, 'super_ultra_aggressive', 'w')[0];
assert.equal(superUltraChoice.pv[0], 'd3h7');
assert.equal(superUltraChoice._styleAnalysis.sacrificeSoundness, 'speculative');

const aggressiveHint = engine.generateHints({ fen: attackFen, pvs: [quiet, forcingCheck], moveHistory: [] }, 5, 'w', 'aggressive', 'none');
assert.equal(aggressiveHint.main, 'Qh5+', 'the hero leads with the move itself — no style-name label');
assert.ok(!/choice:/i.test(aggressiveHint.main), 'no "… choice:" prefix ever reaches the hero');
const aggressiveIdea = aggressiveHint.captions.find(c => c.kind === 'idea');
assert.equal(aggressiveIdea?.label, 'Fast-win idea', 'the style idea travels as a caption item, outside the hero');
assert.ok(aggressiveIdea?.text.length > 0, 'the idea caption carries the reason text');
assert.equal(aggressiveHint.pvs[0].pv[0], 'd1h5');

// Best-reply / expected-line text belongs on the "Why this move" rail, not the hero.
const replyFen = '4k3/8/8/8/8/8/8/3Q2K1 w - - 0 1';
const replyPv = { score: 400, scoreType: 'cp', depth: 20, pv: ['d1d8', 'e8d8'] };
const replyHint = engine.generateHints({ fen: replyFen, pvs: [replyPv], moveHistory: [] }, 5, 'w', 'normal', 'none');
const replyCaption = replyHint.captions.find(c => c.kind === 'reply');
assert.equal(replyCaption?.label, 'Best reply');
assert.match(replyCaption?.text || '', /best reply/i);
assert.doesNotMatch(replyHint.main, /best reply/i, 'the reply line must not crowd the Your move hero');

const oppTurnFen = '4k3/q7/8/8/8/8/2Q5/6K1 b - - 0 1';
const oppTurnPv = { score: 50, scoreType: 'cp', depth: 18, pv: ['a7d4', 'c2d1'] };
const oppHint = engine.generateHints({ fen: oppTurnFen, pvs: [oppTurnPv], moveHistory: [] }, 5, 'w', 'normal', 'none');
const expectedLine = oppHint.captions.find(c => c.kind === 'reply');
assert.equal(expectedLine?.label, 'Expected line');
assert.match(expectedLine?.text || '', /best reply/i);
assert.doesNotMatch(oppHint.main, /best reply/i, 'opponent-turn reply stays off the hero');

const legacyLevelHint = engine.generateHints({ fen: attackFen, pvs: [quiet], moveHistory: [] }, 1, 'w', 'normal', 'none');
assert.equal(legacyLevelHint.level, 5, 'exact-only mode normalizes legacy level requests');
assert.equal(legacyLevelHint.main, 'Qd2', 'legacy level requests receive the exact move with no label prefix');
assert.ok(legacyLevelHint.bestMoveFromTo?.includes('d1 → d2'));

// Human-like mode stays inside objective/style budgets but prefers natural plans.
const naturalFen = '4k3/8/8/8/8/8/8/3QK1N1 w - - 0 1';
const engineQueenMove = { score: 20, scoreType: 'cp', depth: 24, pv: ['d1d2'] };
const naturalDevelopment = { score: 10, scoreType: 'cp', depth: 24, pv: ['g1f3'] };
assert.equal(engine.selectPVForStyle([engineQueenMove, naturalDevelopment], naturalFen, 'normal', 'w', false)[0].pv[0], 'd1d2');
const humanNormal = engine.selectPVForStyle(
  [engineQueenMove, naturalDevelopment],
  naturalFen,
  'normal',
  'w',
  true,
  { activePlan: 'complete development' }
);
assert.equal(humanNormal[0].pv[0], 'g1f3');
assert.match(humanNormal[0]._styleAnalysis.humanSummary, /develops a new piece naturally/);
assert.equal(humanNormal[0]._styleAnalysis.planContinuity, true);
assert.equal(
  engine.selectPVForStyle([quiet, forcingCheck], attackFen, 'aggressive', 'w', true)[0].pv[0],
  'd1h5',
  'human-like Aggressive must preserve the fastest sound forcing route'
);

for (const style of Object.keys(engine.PLAYING_STYLES)) {
  assert.equal(
    engine.selectPVForStyle([hugeCp, slowerMate, fastestMate], attackFen, style, 'w', true)[0].score,
    2,
    `human-like ${style} must preserve the fastest forced mate`
  );
}

const onePvHumanHint = engine.generateHints({ fen: naturalFen, pvs: [naturalDevelopment], moveHistory: [] }, 5, 'w', 'normal', 'none', true);
assert.doesNotMatch(onePvHumanHint.main, /^Human choice:/, 'human-like hint leads with the move, not a style label');
assert.match(onePvHumanHint.main, /^[a-hNBRQK]/);
assert.equal(onePvHumanHint.styleAnalysis.limitedCandidates, true);
// Style policy must never replace a forced mate with a non-mating line.
const forcedMateFen = '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1';
const forcedMatePv = { score: 1, scoreType: 'mate', depth: 28, pv: ['f7g7'] };
const highCpOtherPv = { score: 900, scoreType: 'cp', depth: 28, pv: ['f7f8'] };
const mateSafe = engine.selectPVForStyle(
  [forcedMatePv, highCpOtherPv], forcedMateFen, 'normal', 'w', false
);
assert.equal(mateSafe[0].pv[0], 'f7g7', 'style policy cannot displace a forced mate');

// Chaos Attack should recognize concrete attack features instead of only checks.
const stormFen = '6k1/6pp/6P1/5P2/8/8/6PP/6K1 w - - 0 1';
const stormAnalysis = engine.analyzeCandidate(stormFen, ['f5f6'], 'w', 10, 'cp', 20);
assert.ok(stormAnalysis.penetration >= 2, 'advanced attacking pieces count as enemy-half penetration');
assert.ok(stormAnalysis.pawnStorm >= 2, 'pawns advancing on the enemy king wing count as a pawn storm');
const pawnStormAdvance = engine.analyzeCandidate('6k1/8/8/8/6P1/8/8/6K1 w - - 0 1', ['g4g5'], 'w', 10, 'cp', 20);
assert.equal(pawnStormAdvance.pawnStormDelta, 1, 'only a new pawn-storm advance receives the style bonus');
const invade = engine.analyzeCandidate('6k1/8/8/8/8/5N2/8/6K1 w - - 0 1', ['f3g5'], 'w', 10, 'cp', 20);
assert.equal(invade.penetrationDelta, 1, 'only a move entering enemy territory receives penetration credit');

// Human-like Chaos prefers strong attacks over merely natural quiet moves.
const chaosRefFen = '6k1/7p/8/8/8/3Q4/8/6K1 w - - 0 1';
const safeQuietMove = { score: 100, scoreType: 'cp', depth: 24, pv: ['d3d2'] };
const attackSacMove = { score: 90, scoreType: 'cp', depth: 24, pv: ['d3h7', 'g8h7'] };
const humanChaosResult = engine.selectPVForStyle(
  [safeQuietMove, attackSacMove],
  chaosRefFen,
  'super_ultra_aggressive',
  'w',
  true
);
assert.equal(humanChaosResult[0].pv[0], 'd3h7', 'Human-like Chaos prefers strong attacks over merely natural quiet moves');
assert.ok(humanChaosResult[0]._styleAnalysis.penetrationDelta > 0, 'recognizes penetration feature');
assert.ok(humanChaosResult[0]._styleAnalysis.kingPressureDelta > 0, 'recognizes king-pressure delta feature');

// Human Chaos coach voice: prefix + plan must be human-flavored, not engine-speak.
const humanChaosHint = engine.generateHints(
  { fen: chaosRefFen, pvs: [attackSacMove, safeQuietMove], moveHistory: [] },
  5, 'w', 'super_ultra_aggressive', 'none', true
);
assert.doesNotMatch(humanChaosHint.main, /^Human Chaos Attack choice:/, 'human-like Chaos leads with the move, not a style label');
assert.match(humanChaosHint.main, /^[a-hNBRQK]/);
assert.doesNotMatch(humanChaosHint.main, /Why it feels natural/, 'verbose reason list removed');
assert.doesNotMatch(humanChaosHint.main, /Human plan:/, 'plan merged into the move line');
assert.ok(!/^Chaos Attack \(vs <=1100\) choice:/.test(humanChaosHint.main), 'raw engine-prefix must not leak in human mode');

// Ultra Super Aggressive must never prefix the hero with its style name: the
// user picked the style in settings, so the panel leads with the move.
const ultraHint = engine.generateHints(
  { fen: chaosRefFen, pvs: [attackSacMove, safeQuietMove], moveHistory: [] },
  5, 'w', 'super_ultra_aggressive', 'none'
);
assert.ok(!/Ultra Super Aggressive/i.test(ultraHint.main), 'no "Ultra Super Aggressive Attack choice:" label in the hero');
assert.match(ultraHint.main, /^Q/, 'the hero leads with the move itself');
const ultraIdea = ultraHint.captions.find(c => c.kind === 'idea');
assert.equal(ultraIdea?.label, 'Maximum-pressure idea', 'pressure idea surfaces as a caption item outside the hero');
assert.ok(ultraHint.captions.some(c => c.kind === 'sacrifice'), 'sacrifice context surfaces as a caption item');

// ── Grafted Berserker-vocabulary features (Chaos Attack additions) ──
const chaosWeights = engine.PLAYING_STYLES.super_ultra_aggressive.weights;
for (const key of ['attackUnits', 'practicalChances', 'complexityStructural', 'greekGift', 'drawContempt', 'overload', 'developmentWithAttack']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
assert.equal(engine.PLAYING_STYLES.super_ultra_aggressive.phaseAggressionScale, 1.5, 'Chaos exposes a phase aggression scale');

const featureKeys = ['attackUnits', 'attackUnitDelta', 'practicalChancesScore', 'structuralComplexity', 'isGreekGift', 'drawContemptScore', 'overloadScore', 'tempoThreatCount', 'developmentWithAttack', 'fen'];
const e4Features = engine.analyzeCandidate(start, ['e2e4'], 'w', 20, 'cp');
for (const key of featureKeys) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// A4 — Greek gift: bishop takes h7 with the enemy king on g8 (castled).
const greekGiftFen = 'r1bq1rk1/pppp1p1p/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQ - 4 5';
const greekGiftMove = engine.analyzeCandidate(greekGiftFen, ['c4h7'], 'w', 40, 'cp');
assert.equal(greekGiftMove.isGreekGift, true, 'bishop takes h7 with a castled king is a Greek gift');
const nonGreek = engine.analyzeCandidate(greekGiftFen, ['c4d5'], 'w', 20, 'cp');
assert.equal(nonGreek.isGreekGift, false, 'a non-h7 bishop move is not a Greek gift');
// Black Greek gift: bishop captures the h2 pawn with the White king castled on g1.
const blackGreekFen = '4k3/8/8/8/8/6b1/7P/6K1 b - - 0 1';
assert.equal(engine.analyzeCandidate(blackGreekFen, ['g3h2'], 'b', 50, 'cp').isGreekGift, true, 'bishop takes h2 with a castled White king is a Black Greek gift');
const blackNonGreekFen = '4k3/8/8/8/8/6b1/8/6K1 b - - 0 1';
assert.equal(engine.analyzeCandidate(blackNonGreekFen, ['g3h2'], 'b', 50, 'cp').isGreekGift, false, 'a bishop move that captures nothing is not a Greek gift');

// A5 — Draw contempt: near-equal quiet positions are penalized.
const drawContemptNearEqual = engine.analyzeCandidate('6k1/8/8/8/8/8/8/6K1 w - - 0 1', ['g1f2'], 'w', 20, 'cp');
assert.ok(drawContemptNearEqual.drawContemptScore < 0, 'near-equal quiet position gets negative draw-contempt score');
const drawContemptClear = engine.analyzeCandidate('6k1/8/8/8/8/8/8/6K1 w - - 0 1', ['g1f2'], 'w', 250, 'cp');
assert.equal(drawContemptClear.drawContemptScore, 0, 'clear advantage is not draw-contempted');
// Draw contempt must actually be applied as a penalty inside style scoring.
const drawContemptPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['d1d2'] }, { score: 15, scoreType: 'cp', depth: 20, pv: ['d1d3'] }],
  '4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.ok(drawContemptPick[0]._styleAnalysis.risks.includes('rejects a near-equal calm position'), 'near-equal quiet Chaos move is draw-contempted');

// A1 — Attack units respond to the moving piece joining the king-zone attack.
assert.ok(e4Features.attackUnitDelta >= 0, 'attack unit delta is defined and non-negative from the start position');
// C1 — attack sub-total is exposed for the two-phase re-rank.
assert.ok(Number.isFinite(humanChaosResult[0]._styleAnalysis.attackSubTotal), 'style analysis exposes the attack sub-total tiebreaker');

// ── Advanced Chaos Attack primitives ──
// B1 — King cage: covering a king escape square tightens the mating net.
const cageMove = engine.analyzeCandidate('6k1/8/8/8/6N1/8/8/6K1 w - - 0 1', ['g4h6'], 'w', 10, 'cp', 20);
assert.equal(cageMove.kingCageDelta, 1, 'covering an escape square tightens the cage');
assert.equal(cageMove.kingCageAfter, 1, 'cage coverage exposes the after count');
// B1 — Suffocation: a check that seals every escape square of an edge king (5/5).
const suffocation = engine.analyzeCandidate('6k1/5pp1/6N1/8/4N3/8/8/6K1 w - - 0 1', ['e4f6'], 'w', 10, 'cp', 20);
assert.equal(suffocation.kingSuffocation, true, 'a check that seals every escape square suffocates the king');
assert.equal(suffocation.kingCageAfter, 5, 'the suffocation cage is fully closed');
assert.equal(suffocation.givesCheck, true, 'the sealing move itself is a check');
// B2 + B4 — A rook landing on the back-rank escape square is a back-rank
// threat; a check from a square touching the king is a contact check.
const rookMateNet = engine.analyzeCandidate('6k1/6pp/8/8/8/8/8/5RK1 w - - 0 1', ['f1f8'], 'w', 10, 'cp', 20);
assert.equal(rookMateNet.backRank, true, 'a rook landing on the back-rank escape square is a back-rank threat');
assert.equal(rookMateNet.contactCheck, true, 'a check from a square touching the king is a contact check');
assert.equal(rookMateNet.givesCheck, true, 'the rook delivers check from the back rank');
assert.equal(rookMateNet.kingSuffocation, false, 'the king still has one flight square — not a full suffocation');
// B2 — Back-rank threat without a check (knight slides onto the escape square).
const backRankKnight = engine.analyzeCandidate('6k1/8/4N3/8/8/8/8/6K1 w - - 0 1', ['e6f8'], 'w', 10, 'cp', 20);
assert.equal(backRankKnight.backRank, true, 'landing on the back-rank square next to the king is a back-rank threat');
assert.equal(backRankKnight.contactCheck, false, 'a non-checking knight hop is not a contact check');
// B3 — Pawn-shield strike: capture the shield pawn standing next to the king.
const shieldStrike = engine.analyzeCandidate('6k1/6p1/5P2/8/8/8/8/6K1 w - - 0 1', ['f6g7'], 'w', 10, 'cp', 20);
assert.equal(shieldStrike.shieldStrike, true, 'capturing the pawn next to the king strips the shield');
// B5 — Exchange sacrifice near the king (rook offered for a defended knight at the king\'s doorstep).
const exchangeSac = engine.analyzeCandidate('6k1/5pp1/5n2/8/8/8/8/5RK1 w - - 0 1', ['f1f6', 'g7f6'], 'w', 10, 'cp', 20);
assert.equal(exchangeSac.exchangeSac, true, 'a rook offered within two squares of the king for a minor is an exchange sacrifice');
// B6 — King chase: the enemy king has left its home row.
const kingChase = engine.analyzeCandidate('8/7k/8/8/8/8/8/6K1 w - - 0 1', ['g1f2'], 'w', 10, 'cp', 20);
assert.equal(kingChase.chased, true, 'an enemy king off its home row is a hunt target');
// B7 — Uncastled-king punishment: king still on e8, bishop delivers a check.
const uncastledPunish = engine.analyzeCandidate('4k3/8/8/8/B7/8/8/6K1 w - - 0 1', ['a4c6'], 'w', 10, 'cp', 20);
assert.equal(uncastledPunish.punishUncastled, true, 'checking the king still on e8 punishes the uncastled king');
assert.equal(uncastledPunish.givesCheck, true, 'the diagonal bishop check reaches e8');
// B8 — Rook lift: the rook advances into the enemy half.
const rookLiftMove = engine.analyzeCandidate('6k1/8/8/8/8/8/8/5RK1 w - - 0 1', ['f1f5'], 'w', 10, 'cp', 20);
assert.equal(rookLiftMove.rookLiftMove, true, 'a rook advancing into the enemy half is a rook lift');
// The classic Chaos sac (Qxh7+) drags the king out — the *next* moves get the
// hunt bonus since the king leaves its castle only via the opponent's reply.
const cageSac = engine.analyzeCandidate(chaosRefFen, ['d3h7', 'g8h7'], 'w', 90, 'cp', 24);
assert.equal(cageSac.chased, false, 'the king is still home before the sacrifice lands');
assert.equal(cageSac.exchangeSac, false, 'a queen sacrifice is not an exchange sacrifice');
// Feature exposure + weights.
for (const key of ['kingCage', 'kingSuffocation', 'backRank', 'shieldStrike', 'contactCheck', 'exchangeSac', 'kingChase', 'punishUncastled', 'rookLift']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['kingCageDelta', 'kingCageAfter', 'kingSuffocation', 'backRank', 'shieldStrike', 'contactCheck', 'exchangeSac', 'chased', 'punishUncastled', 'rookLiftMove']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack kill-geometry primitives ──
// C1 — King mobility: a rook check that erases flight squares traps the king.
const mobilityTrap = engine.analyzeCandidate('7k/8/8/8/8/8/8/1R4K1 w - - 0 1', ['b1b8'], 'w', 10, 'cp', 20);
assert.equal(mobilityTrap.kingMobilityDelta, 1, 'a rook check that erases a flight square traps the king');
assert.equal(mobilityTrap.kingMobilityAfter, 2, 'mobility exposes the remaining legal king moves');
// C2 — Smothered mate: edge king sealed by its own pieces + knight check.
const smothered = engine.analyzeCandidate('6rk/6pp/3N4/8/8/8/8/6K1 w - - 0 1', ['d6f7'], 'w', 10, 'cp', 20);
assert.equal(smothered.smotheredMate, true, 'the king smothered by its own pieces with a knight check');
assert.equal(smothered.givesCheck, true, 'the sealing knight delivers the check');
// C3 — Anastasia-family mate: corner king, file check, knight on the flight.
const anastasia = engine.analyzeCandidate('7k/4N1p1/8/8/8/8/8/6KR w - - 0 1', ['h1h5'], 'w', 10, 'cp', 20);
assert.equal(anastasia.anastasiaMate, true, 'file check + knight covering the back-rank flight is the Anastasia net');
// C4 — Arabian-family mate: corner king, rank check beside the king, knight
// covering the diagonal flight.
const arabian = engine.analyzeCandidate('7k/7p/4N3/8/8/8/8/5KR1 w - - 0 1', ['g1g8'], 'w', 10, 'cp', 20);
assert.equal(arabian.arabianMate, true, 'rank check beside the king + knight on the diagonal flight is the Arabian net');
assert.equal(arabian.givesCheck, true, 'the Arabian rook delivers check');
// C5 — Boden mate: castled king attacked by two criss-cross bishops.
const boden = engine.analyzeCandidate('6k1/7B/8/8/8/8/B7/6K1 w - - 0 1', ['a2b3'], 'w', 10, 'cp', 20);
assert.equal(boden.bodenMate, true, 'two bishops on crossing diagonals attack the castled king');
// C6 — Forced mate sequence: check + forced reply + mate, with a mate score.
const mateNet = engine.analyzeCandidate('7k/8/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8', 'h8g7', 'a8g8'], 'w', 5, 'mate', 20);
assert.equal(mateNet.forcedMateNet, true, 'a checking move into a mate-scored forcing PV starts a forced mate sequence');
assert.equal(mateNet.givesCheck, true, 'the sequence opens with a check');
const quietNet = engine.analyzeCandidate('7k/8/8/8/8/8/8/R5K1 w - - 0 1', ['a1a2'], 'w', 5, 'cp', 20);
assert.equal(quietNet.forcedMateNet, false, 'a quiet non-mating move is not a forced mate sequence');
// C7 — Undefended defender: our move captures a loose piece guarding the king.
const looseDefender = engine.analyzeCandidate('6k1/8/7n/8/8/8/8/6KR w - - 0 1', ['h1h6'], 'w', 10, 'cp', 20);
assert.equal(looseDefender.undefendedHit, true, 'capturing an undefended piece beside the king exploits a loose defender');
const defendedKnight = engine.analyzeCandidate('6k1/5n2/7n/8/8/8/8/6KR w - - 0 1', ['h1h6'], 'w', 10, 'cp', 20);
assert.equal(defendedKnight.undefendedHit, false, 'a piece defended by its own side is not a loose defender');
// Weights + feature exposure.
for (const key of ['kingMobility', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'forcedMateNet', 'undefendedHit']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['kingMobilityBefore', 'kingMobilityAfter', 'kingMobilityDelta', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'forcedMateNet', 'undefendedHit']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack mating-square arithmetic primitives ──
// D1 — Per-mating-square attacker/defender count: a square where our
// attackers outnumber the defenders is a square we can force. Four attackers
// (two knights, bishop, rook) versus two defenders (king + rook) on f7 wins
// that mating square by force.
const forceWinSquare = engine.analyzeCandidate('r4rk1/ppp2ppp/8/4N1N1/2B5/8/PPPP11PP/R4RK1 w - - 0 1', ['a2a3'], 'w', 10, 'cp', 20);
assert.equal(forceWinSquare.maxSquareOutnumber, 2, 'four attackers vs two defenders wins a mating square by force');
assert.equal(forceWinSquare.squareOutnumber, 1, 'the outnumbered mating square count is exposed');
assert.equal(forceWinSquare.squareOutnumberDelta, 0, 'a quiet move does not change the mating-square arithmetic');
// D2 — Creating the outnumber: Qh5 joins a knight against the h7 shield pawn,
// where only the king answers — a new mating square where attackers beat
// defenders.
const outnumberCreate = engine.analyzeCandidate('r4rk1/ppp2ppp/8/6N1/8/8/PPPP1PPP/R2Q1RK1 w - - 0 1', ['d1h5'], 'w', 0, 'cp', 20);
assert.equal(outnumberCreate.squareOutnumberDelta, 1, 'the queen lift creates a mating square where attackers outnumber defenders');
assert.equal(outnumberCreate.maxSquareOutnumber, 1, 'the newly outnumbered square is the h7 shield pawn');
assert.equal(outnumberCreate.squareOutnumber, 1, 'the after count of outnumbered squares is exposed');
// D3 — The arithmetic changes selection: Qh5 with the outnumber beats a quiet
// move even at equal material.
const matingPick = engine.selectPVForStyle(
  [{ score: 10, scoreType: 'cp', depth: 20, pv: ['a2a3'] }, { score: 0, scoreType: 'cp', depth: 20, pv: ['d1h5'] }],
  'r4rk1/ppp2ppp/8/6N1/8/8/PPPP1PPP/R2Q1RK1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.equal(matingPick[0].pv[0], 'd1h5', 'outnumbering the defenders on a mating square beats a quiet move');
assert.ok(matingPick[0]._styleAnalysis.reasons.includes('creates a mating square where attackers outnumber defenders'), 'the style scoring recognizes the new mating square');
const forceWinReasons = engine.selectPVForStyle(
  [{ score: 10, scoreType: 'cp', depth: 20, pv: ['a2a3'] }, { score: 5, scoreType: 'cp', depth: 20, pv: ['g1f2'] }],
  'r4rk1/ppp2ppp/8/4N1N1/2B5/8/PPPP11PP/R4RK1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.ok(forceWinReasons[0]._styleAnalysis.reasons.includes('outnumbers the defenders on a mating square by force'), 'a two-to-one mating square is scored as winnable by force');
// Weights + feature exposure.
for (const key of ['matingMath', 'squareOutnumber']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['squareOutnumber', 'squareOutnumberDelta', 'maxSquareOutnumber', 'mateMathBalance']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack position-level exploitation primitives ──
// E1 — Hanging piece anywhere on the board: capturing an undefended knight far
// from the king is a positional grab, distinct from the king-zone
// undefendedHit.
const hangCapture = engine.analyzeCandidate('6k1/8/8/8/4n3/8/8/4R1K1 w - - 0 1', ['e1e4'], 'w', 30, 'cp', 20);
assert.equal(hangCapture.hangingPieceGrab, true, 'capturing an undefended piece anywhere is a positional grab');
assert.equal(hangCapture.undefendedHit, false, 'a piece far from the king is not a king-zone defender');
assert.equal(hangCapture.plan, 'snap up the hanging piece', 'the plan names the hanging piece');
// E1b — Attack branch without capture: a rook sliding up the a-file attacks an
// undefended pawn.
const hangAttack = engine.analyzeCandidate('6k1/p7/8/8/8/8/8/R5K1 w - - 0 1', ['a1a6'], 'w', 20, 'cp', 20);
assert.equal(hangAttack.hangingPieceGrab, true, 'attacking an undefended piece without capturing is also a grab');
// E1c — Defended pieces are not hanging (the f6 knight guards e4).
const hangDefended2 = engine.analyzeCandidate('6k1/8/5n2/8/4n3/8/8/4R1K1 w - - 0 1', ['e1e4'], 'w', 30, 'cp', 20);
assert.equal(hangDefended2.hangingPieceGrab, false, 'a piece defended by its own side is not hanging');
// E2 — Back-rank fragility: king trapped on the crowded back rank (own rook on
// the side square, shield pawn unmoved) while our rook slams the back rank.
const backRank = engine.analyzeCandidate('r4rk1/ppp2ppp/8/8/8/8/PPPP1PPP/4R1K1 w - - 0 1', ['e1e8'], 'w', 30, 'cp', 20);
assert.equal(backRank.backRankExploit, true, 'a rook landing on the enemy back rank exploits the fragile king');
assert.equal(backRank.backRankFragile, true, 'the crowded-back-rank condition is exposed');
assert.equal(backRank.plan, 'exploit the cramped back rank', 'the plan names the back-rank fragility');
// E2b — An empty back rank is not fragile.
const backRankClear = engine.analyzeCandidate('6k1/8/8/8/8/8/8/4R1K1 w - - 0 1', ['e1e8'], 'w', 30, 'cp', 20);
assert.equal(backRankClear.backRankExploit, false, 'a king with a clear back rank is not fragile');
assert.equal(backRankClear.backRankFragile, false, 'the fragility condition stays off without the crowded rank');
// E2c — The grab changes selection over a quiet king move.
const exploitPick = engine.selectPVForStyle(
  [{ score: 10, scoreType: 'cp', depth: 20, pv: ['g1g2'] }, { score: 0, scoreType: 'cp', depth: 20, pv: ['e1e4'] }],
  '6k1/8/8/8/4n3/8/8/4R1K1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.equal(exploitPick[0].pv[0], 'e1e4', 'position-level hanging-piece grabs beat quiet king moves');
assert.ok(exploitPick[0]._styleAnalysis.reasons.includes('snaps up a piece the opponent left undefended'), 'the style scoring recognizes the positional grab');
// Weights + feature exposure.
for (const key of ['hangingPieceGrab', 'backRankExploit']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['hangingPieceGrab', 'backRankExploit', 'backRankFragile']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack opening-trap primitives ──
// F1 — Scholar's mate net: Qh5 (or Qxf7) with a bishop on c4 eyeing the same
// f-pawn while the enemy king is still at home.
const scholarFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const scholarSetup = engine.analyzeCandidate(scholarFen, ['d1h5'], 'w', 30, 'cp', 20);
assert.equal(scholarSetup.scholarTrap, true, 'the queen lift with a covering bishop lays the Scholar\'s net');
assert.equal(scholarSetup.plan, 'lay the Scholar\'s mate trap on f7', 'the plan names the Scholar\'s trap');
const scholarFinish = engine.analyzeCandidate('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7'], 'w', 60, 'cp', 20);
assert.equal(scholarFinish.scholarTrap, true, 'Qxf7 with the covering bishop is the Scholar\'s finish');
assert.equal(scholarFinish.givesCheck, true, 'the finish is a check');
// F2 — Legal's mate net: the knight hops to e5 while a bishop on c4 trains on
// f7 and the enemy king is still at home.
const legalsSetup = engine.analyzeCandidate(scholarFen, ['f3e5'], 'w', 40, 'cp', 20);
assert.equal(legalsSetup.legalsTrap, true, 'knight to e5 with the c4 bishop builds the Legal\'s net');
assert.equal(legalsSetup.plan, 'spring the Legal\'s mate trap on e5', 'the plan names the Legal\'s trap');
// F3 — Lasker trap: a pawn falls onto f2 with check while the White king is
// still stuck on e1 (the Albin countergambit trap shape).
const laskerFen = 'rnbqkbnr/ppp2ppp/8/4P3/1BP5/4p3/PP3PPP/RNBQKBNR b KQkq - 0 6';
const laskerSetup = engine.analyzeCandidate(laskerFen, ['e3f2'], 'b', 50, 'cp', 20);
assert.equal(laskerSetup.laskerTrap, true, 'the pawn falling on f2 with check springs the Lasker trap');
assert.equal(laskerSetup.givesCheck, true, 'the falling pawn gives check on the home square king');
assert.equal(laskerSetup.plan, 'spring the Lasker trap on the king\'s rank', 'the plan names the Lasker trap');
// F4 — No trap without the geometry: a quiet move in the same position.
const quietTrap = engine.analyzeCandidate(scholarFen, ['d2d3'], 'w', 20, 'cp', 20);
assert.equal(quietTrap.scholarTrap, false, 'a quiet move is not a Scholar\'s trap');
assert.equal(quietTrap.legalsTrap, false, 'a quiet move is not a Legal\'s trap');
assert.equal(quietTrap.laskerTrap, false, 'a quiet move is not a Lasker trap');
// F5 — The trap shapes change selection against a quiet move.
const trapPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['d2d3'] }, { score: 10, scoreType: 'cp', depth: 20, pv: ['d1h5'] }],
  scholarFen, 'super_ultra_aggressive', 'w');
assert.equal(trapPick[0].pv[0], 'd1h5', 'the Scholar\'s mate setup beats a quiet developing move');
assert.ok(trapPick[0]._styleAnalysis.reasons.includes('lays the Scholar\'s mate net on the f-pawn'), 'the style scoring recognizes the trap setup');
// Weights + feature exposure.
for (const key of ['scholarTrap', 'legalsTrap', 'laskerTrap']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['scholarTrap', 'legalsTrap', 'laskerTrap']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack second-move vision primitives ──
// G1 — The PV's own second ply already lands a second blow: the knight
// follow-up on b6 forks the a8 rook and the d7 queen.
const forkVision = engine.analyzeCandidate('r3k3/3q4/8/8/8/2N5/8/6K1 w - - 0 1', ['c3d5', 'e8e7', 'd5b6'], 'w', 20, 'cp', 20);
assert.equal(forkVision.followUpVision, true, 'a follow-up that forks two major pieces shows second-move vision');
assert.equal(forkVision.followUpFork, true, 'the fork flag is exposed');
assert.equal(forkVision.followUpCheck, false, 'the knight fork is not a check');
// G1b — A follow-up check after a forced recapture (Bxf7+ Kxf7 Qh5+).
const checkVision = engine.analyzeCandidate('6k1/5p2/8/8/2B5/8/8/3Q2K1 w - - 0 1', ['c4f7', 'g8f7', 'd1h5'], 'w', 20, 'cp', 20);
assert.equal(checkVision.followUpVision, true, 'a follow-up that keeps checking shows second-move vision');
assert.equal(checkVision.followUpCheck, true, 'the follow-up check flag is exposed');
// G1c — A dead-end follow-up has no vision.
const deadEndVision = engine.analyzeCandidate('r3k3/3q4/8/8/8/2N5/8/6K1 w - - 0 1', ['c3d5', 'e8e7', 'g1h1'], 'w', 20, 'cp', 20);
assert.equal(deadEndVision.followUpVision, false, 'a quiet king shuffle follow-up is not second-move vision');
// G1d — The vision changes selection: the move whose own follow-up forks beats
// the identical first move with a dead follow-up.
const visionPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['c3d5', 'e8e7', 'g1h1'] }, { score: 15, scoreType: 'cp', depth: 20, pv: ['c3d5', 'e8e7', 'd5b6'] }],
  'r3k3/3q4/8/8/8/2N5/8/6K1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.equal(visionPick[0].pv[0], 'c3d5', 'the same first move with a fork follow-up wins the selection');
assert.ok(visionPick[0]._styleAnalysis.reasons.some(r => r.includes('follow-up')), 'the style scoring recognizes the second-move vision');
// Weights + feature exposure.
assert.ok(Number.isFinite(chaosWeights.followUpVision), 'Chaos weights expose followUpVision');
for (const key of ['followUpVision', 'followUpCheck', 'followUpFork', 'followUpCapture', 'followUpCageStep']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack self-safety hard gate ──
// H1 — A move that leaves our own king with zero legal escapes (and is not a
// check or mate) is hard-refused by the style ranking.
const trappedFen = '6kr/8/8/8/8/8/5PPP/1r4K1 w - - 0 1';
const trappedKing = engine.analyzeCandidate(trappedFen, ['g1h1'], 'w', 30, 'cp', 20);
assert.equal(trappedKing.ownKingTrapped, true, 'walking the king into a 0-escape corner is flagged as trapped');
assert.equal(trappedKing.ownEscapesAfter, 0, 'the escape count is exposed');
assert.equal(trappedKing.givesCheck, false, 'a quiet trap is not excused by a check');
const safeKing = engine.analyzeCandidate(trappedFen, ['g1f1'], 'w', 0, 'cp', 20);
assert.equal(safeKing.ownKingTrapped, false, 'a king move with escape squares is not trapped');
// H1b — The gate changes selection: the higher-scored but suicidal Kh1 is
// refused; the quieter safe king move wins for both Chaos and Aggressive.
const gatePick = engine.selectPVForStyle(
  [{ score: 30, scoreType: 'cp', depth: 20, pv: ['g1h1'] }, { score: 0, scoreType: 'cp', depth: 20, pv: ['g1f1'] }],
  trappedFen, 'super_ultra_aggressive', 'w');
assert.equal(gatePick[0].pv[0], 'g1f1', 'Chaos refuses a move that boxes in its own king');
assert.ok(gatePick[0]._styleAnalysis.eligible, 'the safe move is eligible');
const gatePickAgg = engine.selectPVForStyle(
  [{ score: 30, scoreType: 'cp', depth: 20, pv: ['g1h1'] }, { score: 0, scoreType: 'cp', depth: 20, pv: ['g1f1'] }],
  trappedFen, 'aggressive', 'w');
assert.equal(gatePickAgg[0].pv[0], 'g1f1', 'Aggressive also refuses the trapped-king move');
// H1c — A check that leaves our king boxed is not trapped (the initiative is
// preserved): Qg2+ with the queen on the g-file.
const checkEscape = engine.analyzeCandidate('7k/8/8/8/8/8/8/6KQ w - - 0 1', ['g1g2'], 'w', 20, 'cp', 20);
assert.equal(checkEscape.givesCheck, true, 'the queen lift is a check');
assert.equal(checkEscape.ownKingTrapped, false, 'a checking move keeps the initiative and is not trapped');
// Weights + feature exposure.
for (const key of ['ownKingTrapped', 'ownEscapesAfter']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// ── Chaos Attack tactical-toolkit primitives ──
// H2 — Knight fork: the d4 knight leaps to d5 attacking the e7 king and the
// c7 queen at once — a royal fork, the biggest double attack there is.
const royalFork = engine.analyzeCandidate('8/2q1k3/8/8/3N4/8/8/6K1 w - - 0 1', ['d4d5'], 'w', 15, 'cp', 20);
assert.equal(royalFork.knightForkMove, true, 'a knight attacking two enemy pieces is a fork');
assert.equal(royalFork.knightForkCount, 2, 'both enemy pieces are forked');
assert.equal(royalFork.royalFork, true, 'a fork touching the king is royal');
assert.equal(royalFork.plan, 'fork the king and queen with the knight', 'the plan names the royal fork');
// H2b — Same geometry without a king among the targets: still a fork, not royal.
const plainFork = engine.analyzeCandidate('6k1/2q1r3/8/8/3N4/8/8/6K1 w - - 0 1', ['d4d5'], 'w', 15, 'cp', 20);
assert.equal(plainFork.knightForkMove, true, 'two non-royal targets are still a fork');
assert.equal(plainFork.knightForkCount, 2, 'the fork count is exposed');
assert.equal(plainFork.royalFork, false, 'a fork without the king is not royal');
// H2c — A quiet knight move attacks nothing twice: no fork.
const noFork = engine.analyzeCandidate('8/2q1k3/8/8/3N4/8/8/6K1 w - - 0 1', ['d4e2'], 'w', 20, 'cp', 20);
assert.equal(noFork.knightForkMove, false, 'a knight move attacking at most one piece is not a fork');
assert.equal(noFork.knightForkCount, 0, 'the fork count stays zero');
// H2d — The fork changes selection: the fork beats a quiet move even with a
// lower raw score, for both the style ranking and human-like mode.
const forkPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['d4e2'] }, { score: 15, scoreType: 'cp', depth: 20, pv: ['d4d5'] }],
  '6k1/2q1r3/8/8/3N4/8/8/6K1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.equal(forkPick[0].pv[0], 'd4d5', 'the forking knight wins the selection');
assert.ok(forkPick[0]._styleAnalysis.reasons.includes('forks 2 enemy pieces with the knight'), 'the style scoring names the fork');
const forkPickHuman = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['d4e2'] }, { score: 15, scoreType: 'cp', depth: 20, pv: ['d4d5'] }],
  '6k1/2q1r3/8/8/3N4/8/8/6K1 w - - 0 1', 'super_ultra_aggressive', 'w', true);
assert.equal(forkPickHuman[0].pv[0], 'd4d5', 'human-like Chaos also loves the fork');
const royalPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['d4e2'] }, { score: 15, scoreType: 'cp', depth: 20, pv: ['d4d5'] }],
  '8/2q1k3/8/8/3N4/8/8/6K1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.ok(royalPick[0]._styleAnalysis.reasons.includes('forks the king and a second piece with the knight'), 'a royal fork is named as the king fork');

// H3 — Pin: the f1 rook slides to f3, pinning the f6 knight to the f8 king
// (absolute pin — the knight cannot move without exposing the king).
const absolutePin = engine.analyzeCandidate('5k2/8/5n2/8/8/8/8/5RK1 w - - 0 1', ['f1f3'], 'w', 15, 'cp', 20);
assert.equal(absolutePin.pinToKing, true, 'a slider pinning a piece to the king is an absolute pin');
assert.equal(absolutePin.pinToQueen, false, 'no queen is behind the pinned piece');
assert.equal(absolutePin.plan, 'pin a piece to the enemy king', 'the plan names the absolute pin');
// H3b — The same geometry with the queen behind the knight: a relative pin.
const relativePin = engine.analyzeCandidate('6k1/5q2/5n2/8/8/8/8/5RQ1 w - - 0 1', ['f1f3'], 'w', 15, 'cp', 20);
assert.equal(relativePin.pinToQueen, true, 'a slider pinning a piece to the queen is a relative pin');
assert.equal(relativePin.pinToKing, false, 'the king is not on the pinning ray');

// H4 — Skewer: the e1 rook lands on e4, attacking the e6 king with the e7
// queen directly behind it — the king must step off the line and the queen
// falls.
const kingSkewer = engine.analyzeCandidate('8/4q3/4k3/8/8/8/8/4R1K1 w - - 0 1', ['e1e4'], 'w', 15, 'cp', 20);
assert.equal(kingSkewer.skewerCount, 1, 'a king skewered to the queen behind it counts one skewer');
assert.equal(kingSkewer.givesCheck, true, 'the skewer is also a check');
assert.equal(kingSkewer.plan, 'skewer the king or queen to the piece behind', 'the plan names the skewer');
// H4b — Queen-front skewer: the e6 queen is attacked with the e7 rook behind it.
const queenSkewer = engine.analyzeCandidate('8/4r3/4q3/8/8/8/8/4R1K1 w - - 0 1', ['e1e4'], 'w', 15, 'cp', 20);
assert.equal(queenSkewer.skewerCount, 1, 'a queen skewered to the piece behind it counts one skewer');

// H5 — Discovered attack: the e3 bishop steps to d2 and the e1 rook gains a
// fresh attack on the e7 rook — two threats from one move.
const discovered = engine.analyzeCandidate('6k1/4r3/8/8/8/4B3/8/4R1K1 w - - 0 1', ['e3d2'], 'w', 15, 'cp', 20);
assert.equal(discovered.discoveredAttack, true, 'stepping a piece off a slider\'s line reveals a discovered attack');
assert.equal(discovered.discoveredCheck, false, 'an attack on a rook is not a discovered check');
assert.equal(discovered.plan, 'unveil a discovered attack', 'the plan names the discovered attack');
// H5b — The same reveal with the king on the e-file is a discovered check.
const discoveredCheck = engine.analyzeCandidate('8/4k3/8/8/8/4B3/8/4R1K1 w - - 0 1', ['e3d2'], 'w', 15, 'cp', 20);
assert.equal(discoveredCheck.discoveredCheck, true, 'revealing the rook against the king is a discovered check');
assert.equal(discoveredCheck.discoveredAttack, true, 'a discovered check is also a discovered attack');
assert.equal(discoveredCheck.plan, 'unveil a discovered check', 'the plan names the discovered check');
// H5c — Moving the rook itself directly to e4 creates no discovery (its own
// attack is the move, not a reveal).
const noDiscovery = engine.analyzeCandidate('6k1/4r3/8/8/8/4B3/8/4R1K1 w - - 0 1', ['e1e4'], 'w', 20, 'cp', 20);
assert.equal(noDiscovery.discoveredAttack, false, 'a direct rook attack is not a discovered attack');

// H6 — Endgame coup: the endgame is the highest-blunder phase at every rating
// band, so Chaos hunts there — a check, a capture, our king marching toward
// the enemy king, or a major piece on the enemy's 7th rank.
const kingMarch = engine.analyzeCandidate('8/8/8/4k3/8/8/5PK1/8 w - - 0 1', ['g2f3'], 'w', 15, 'cp', 20);
assert.equal(kingMarch.endgameCoup, true, 'our king walking toward the enemy king in the endgame is a coup');
// H6b — A rook landing on the enemy 7th rank in the endgame is a coup.
const seventhRank = engine.analyzeCandidate('6k1/8/8/8/8/8/8/4R1K1 w - - 0 1', ['e1e7'], 'w', 10, 'cp', 20);
assert.equal(seventhRank.endgameCoup, true, 'a major piece on the enemy 7th rank is a coup');
// H6c — Quiet endgame moves are not coups: a rook shuffle, a pawn push.
const quietRook = engine.analyzeCandidate('6k1/8/8/8/8/8/8/4R1K1 w - - 0 1', ['e1e3'], 'w', 20, 'cp', 20);
assert.equal(quietRook.endgameCoup, false, 'a quiet rook shuffle is not a coup');
const quietPawn = engine.analyzeCandidate('8/8/8/4k3/8/8/5PK1/8 w - - 0 1', ['f2f3'], 'w', 20, 'cp', 20);
assert.equal(quietPawn.endgameCoup, false, 'a quiet pawn push is not a coup');
// H6d — The coup is endgame-only: Qh5+ (a check) in the middlegame is not one.
const midgameCheck = engine.analyzeCandidate('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', ['d1h5'], 'w', 20, 'cp', 20);
assert.equal(midgameCheck.endgameCoup, false, 'a middlegame check is not an endgame coup');
// H6e — The coup changes selection over a quiet endgame move.
const coupPick = engine.selectPVForStyle(
  [{ score: 20, scoreType: 'cp', depth: 20, pv: ['e1e3'] }, { score: 10, scoreType: 'cp', depth: 20, pv: ['e1e7'] }],
  '6k1/8/8/8/8/8/8/4R1K1 w - - 0 1', 'super_ultra_aggressive', 'w');
assert.equal(coupPick[0].pv[0], 'e1e7', 'the endgame coup beats the quiet shuffle');
assert.ok(coupPick[0]._styleAnalysis.reasons.includes('exploits the endgame blind spot'), 'the style scoring names the endgame coup');
// Weights + feature exposure.
for (const key of ['knightFork', 'pin', 'skewer', 'discoveredAttack', 'endgameCoup']) {
  assert.ok(Number.isFinite(chaosWeights[key]), `Chaos weights expose ${key}`);
}
for (const key of ['knightForkMove', 'knightForkCount', 'royalFork', 'pinToKing', 'pinToQueen', 'skewerCount', 'discoveredAttack', 'discoveredCheck', 'endgameCoup']) {
  assert.ok(key in e4Features, `analyzeCandidate exposes ${key}`);
}

// Move classification — win-probability rating (mover-perspective).
const rq = (before, after, opts) => engine.classifyMove(before, after, opts);
// A quiet equality-maintaining move rates "Best" for White.
assert.equal(rq(0, 0, { moverColor: 'w' }).label, 'Best');
// White drops ~100cp in an equal position (~9% win chance) — an inaccuracy.
assert.equal(rq(0, -100, { moverColor: 'w' }).label, 'Inaccuracy');
// Losing ~300cp (~25% win chance) is a genuine blunder.
assert.equal(rq(0, -300, { moverColor: 'w' }).label, 'Blunder');
// Mover perspective: White's eval swinging from +50 to -50 means Black
// gained ~9% win chance, so it rates "Great" for Black — not a blunder.
assert.equal(rq(50, -50, { moverColor: 'b' }).label, 'Great');
// The mirror case — Black loses ~9% win chance — is an inaccuracy.
assert.equal(rq(-50, 50, { moverColor: 'b' }).label, 'Inaccuracy');
// Mate handling: both sides already have a forced mate → essentially ~100%
// win chance, so the move rates "Best" instead of being mis-scored as cp=1.
assert.equal(rq(2, 1, { moverColor: 'w', scoreTypeBefore: 'mate', scoreTypeAfter: 'mate' }).label, 'Best');
// Converting from a winning-ish position to a forced mate is brilliant.
assert.equal(rq(0, 1, { moverColor: 'w', scoreTypeBefore: 'cp', scoreTypeAfter: 'mate' }).label, 'Brilliant');
// Accuracy is exposed and bounded.
const acc = rq(0, -200, { moverColor: 'w' });
assert.ok(acc.accuracy >= 0 && acc.accuracy <= 100, 'accuracy is a bounded 0-100 rating');
assert.equal(typeof acc.winChanceLost, 'number');
assert.equal(typeof acc.winChanceGained, 'number');

console.log('hint-engine tests passed');
console.log('chaos-style regression tests passed');

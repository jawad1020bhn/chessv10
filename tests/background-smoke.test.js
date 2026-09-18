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
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const listeners = {};
const values = {};
const sentMessages = [];
const remoteUrls = [];
let remoteMode = 'deny';
let remoteFetches = 0;

function storageGet(keys, callback) {
  let result = {};
  if (keys === null) result = { ...values };
  else for (const key of (Array.isArray(keys) ? keys : [keys])) {
    if (Object.hasOwn(values, key)) result[key] = values[key];
  }
  if (callback) { callback(result); return undefined; }
  return Promise.resolve(result);
}

const chrome = {
  storage: {
    local: {
      get: storageGet,
      set(object, callback) { Object.assign(values, object); callback?.(); return Promise.resolve(); },
      remove(keys, callback) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key];
        callback?.();
        return Promise.resolve();
      }
    },
    onChanged: { addListener() {} }
  },
  alarms: { get(_name, callback) { callback(null); }, create() {}, onAlarm: { addListener() {} } },
  tabs: {
    onRemoved: { addListener() {} },
    onActivated: { addListener() {} },
    async query() { return []; }
  },
  sidePanel: { async setPanelBehavior() {} },
  runtime: {
    onMessage: { addListener(listener) { listeners.message = listener; } },
    onInstalled: { addListener() {} },
    async sendMessage(message) { sentMessages.push(message); }
  },
  scripting: { async executeScript() { return []; } }
};

const context = {
  chrome,
  console: { log() {}, warn() {}, error() {} },
  navigator: { onLine: true },
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  async fetch(url) {
    remoteFetches++;
    remoteUrls.push(url);

    const makeResponse = data => ({
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      async json() { return data; }
    });
    if (remoteMode === 'tablebase' && url.includes('tablebase.lichess.ovh')) {
      return makeResponse({
        category: 'win', dtz: 1, dtm: 1, checkmate: false, stalemate: false,
        moves: [{ uci: 'h1h8', san: 'Rh8+', category: 'win', dtz: 1, dtm: 1 }]
      });
    }
    if (remoteMode === 'masters' && url.includes('explorer.lichess.ovh/master')) {
      return makeResponse({
        white: 12, draws: 5, black: 3,
        moves: [{ uci: 'e2e4', san: 'e4', white: 8, draws: 3, black: 1, averageRating: 2400 }],
        topGames: []
      });
    }
    if (remoteMode === 'masters' && url.includes('explorer.lichess.ovh/lichess')) {
      // Player-explorer enrichment used by the sparring-range popularity path.
      return makeResponse({
        white: 400, draws: 210, black: 300,
        moves: [{ uci: 'b1c3', san: 'Nc3', white: 180, draws: 95, black: 125, averageRating: 1750 }],
        topGames: []
      });
    }
    // Lichess cloud-eval reports cp/mate relative to the side to move. For a
    // black-to-move position, +120cp means Black is better and must be stored
    // as -120 (White-relative) for the eval bar / ranking / classification.
    // Non-target providers return a benign "empty" so the fallback chain moves
    // on quickly without network-retry backoff sleeps.
    if (remoteMode === 'cloud') {
      if (url.includes('cloud-eval')) {
        return makeResponse({
          depth: 30, knodes: 500,
          pvs: [{ cp: 120, moves: 'd8e7 g1f3 g8f6' }, { cp: 90, moves: 'f8e8 g1f3 g8f6' }]
        });
      }
      return makeResponse({ type: 'error', error: 'empty' });
    }
    // chess-api.com reports eval/centipawns/mate from White's perspective, so a
    // white-relative mate score must NOT be re-flipped for black-to-move.
    if (remoteMode === 'chessapi') {
      if (url.includes('chess-api.com')) {
        return makeResponse({
          depth: 18, move: 'e8e7', mate: -3, san: 'Ke7',
          continuationArr: ['e1d1', 'e7d7'], fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1'
        });
      }
      return makeResponse({ type: 'error', error: 'empty' });
    }
    throw new Error(`Unexpected remote call: ${url}`);
  }
};
context.globalThis = context;
vm.createContext(context);
context.importScripts = (...files) => {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
};
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
assert.equal(typeof listeners.message, 'function', 'service worker message listener is registered');

function send(message) {
  return new Promise(resolve => {
    const asyncResponse = listeners.message(message, {}, resolve);
    if (asyncResponse !== true) queueMicrotask(() => resolve(undefined));
  });
}

(async () => {
  const health = await send({ type: 'health_check' });
  assert.equal(remoteFetches, 0, 'passive health status must not contact providers');
  assert.equal(health['chess-api'].passive, true);
  assert.equal(health.lichess.passive, true);

  const diagnostics = await send({ type: 'get_api_diagnostics' });
  assert.ok(diagnostics.providers.chessApi);
  assert.equal(diagnostics.remoteCallsAvoidedByCache, 0);

  const waitForMessage = async (type, previousCount) => {
    // Poll for up to ~5s with real delays so slow async workflows (coalesced
    // provider retries, backoff sleeps) are not missed by a tight microtask loop.
    for (let attempt = 0; attempt < 250; attempt++) {
      const matches = sentMessages.filter(message => message?.type === type);
      if (matches.length > previousCount) return matches.at(-1);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${type}`);
  };

  await send({ type: 'panel_state', open: true, tabId: 7 });
  const turnUnknownUpdates = sentMessages.filter(message => message?.type === 'turn_status_update').length;
  const unknownTurn = await send({
    type: 'request_analysis', tabId: 7,
    fen: '8/8/8/8/8/8/4K3/6kR w - - 0 1', playerColor: 'w'
  });
  assert.equal(unknownTurn.turnStatus, 'turn_unknown', 'analysis is withheld when turn information is not verified');
  await waitForMessage('turn_status_update', turnUnknownUpdates);
  assert.equal(remoteFetches, 0, 'an unknown turn never starts a provider request');

  remoteMode = 'tablebase';
  const tablebaseUpdates = sentMessages.filter(message => message?.type === 'analysis_update').length;
  await send({
    type: 'request_analysis',
    tabId: 7,
    fen: '8/8/8/8/8/8/4K3/6kR w - - 0 1',
    playerColor: 'w',
    multiPv: 3,
    hintLevel: 3,
    positionReliable: true,
    turnReliable: true
  });
  const tablebaseUpdate = await waitForMessage('analysis_update', tablebaseUpdates);
  assert.equal(tablebaseUpdate.data.source, 'tablebase');
  assert.equal(tablebaseUpdate.data.hintLevel, 5, 'all requests produce exact-move hints regardless of legacy requested level');
  assert.equal(tablebaseUpdate.data.exactHintBlocked, null);
  assert.equal(remoteUrls.filter(url => url.includes('tablebase.lichess.ovh')).length, 1);
  assert.equal(remoteUrls.filter(url => url.includes('cloud-eval') || url.includes('chess-api.com')).length, 0,
    'a successful tablebase result prevents engine analysis');

  remoteMode = 'masters';
  const openingUpdates = sentMessages.filter(message => message?.type === 'analysis_update').length;
  await send({
    type: 'request_analysis',
    tabId: 7,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playerColor: 'w',
    multiPv: 3,
    hintLevel: 3,
    positionReliable: true,
    turnReliable: true
  });
  const openingUpdate = await waitForMessage('analysis_update', openingUpdates);
  assert.equal(openingUpdate.data.source, 'masters-explorer');
  assert.equal(openingUpdate.data.exactHintBlocked, null, 'a new game resets exact-hint cooldown state');
  assert.equal(remoteUrls.filter(url => url.includes('/master?')).length, 1);
  assert.equal(remoteUrls.filter(url => url.includes('/lichess?')).length, 0,
    'Masters success does not trigger unconditional opening enrichment');
  assert.equal(remoteUrls.filter(url => url.includes('cloud-eval') || url.includes('chess-api.com')).length, 0,
    'one successful opening source stops the fallback chain');

  // ── Score normalization regression tests ──────────────────────────
  // Black-to-move, midgame position (not tablebase-eligible, not opening).
  const midgameBlackFen = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b - - 0 12';

  remoteMode = 'cloud';
  const cloudUpdates = sentMessages.filter(message => message?.type === 'analysis_update').length;
  await send({
    type: 'request_analysis',
    tabId: 7,
    fen: midgameBlackFen,
    playerColor: 'b',
    multiPv: 3,
    positionReliable: true,
    turnReliable: true
  });
  const cloudUpdate = await waitForMessage('analysis_update', cloudUpdates);
  assert.equal(cloudUpdate.data.source, 'lichess-cloud');
  // Mock returns +120cp (Black better, side-to-move-relative); the pipeline must
  // store it White-relative, i.e. negative, so Black's advantage is not inverted.
  assert.ok(cloudUpdate.data.pvs[0].score < 0,
    `lichess cloud cp must be normalized to White's perspective for a black-to-move position (got ${cloudUpdate.data.pvs[0].score})`);

  // chess-api mate is white-relative: -3 means White is mated in 3. For a
  // black-to-move position the score must stay negative (not re-flipped).
  remoteMode = 'chessapi';
  const chessApiUpdates = sentMessages.filter(message => message?.type === 'analysis_update').length;
  await send({
    type: 'request_analysis',
    tabId: 7,
    fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
    playerColor: 'b',
    multiPv: 3,
    positionReliable: true,
    turnReliable: true
  });
  const chessApiUpdate = await waitForMessage('analysis_update', chessApiUpdates);
  assert.equal(chessApiUpdate.data.source, 'chess-api');
  assert.equal(chessApiUpdate.data.pvs[0].scoreType, 'mate');
  assert.equal(chessApiUpdate.data.pvs[0].score, -3,
    'chess-api mate must stay White-relative (negative = White is mated) for a black-to-move position');

  // ── Human-likeness correlation guard ────────────────────────────────
  // Standard mode: playing the engine's suggested move is "sensible".
  // Human-like mode: a blind copy of the engine's exact top pick (while a
  // different human recommendation was offered) is bot-like, so it must NOT
  // count as sensible. Everything else (following the human move or any own
  // natural move) is human-like and fair-play safe.
  const guardFen = '4k3/8/8/8/8/8/8/3Q2K1 w - - 0 1';
  context.recordEngineRecommendation(guardFen, 'd1d2');
  const stdMatch = context.recordPlayerMove(guardFen, { playerUci: 'd1d2' });
  assert.equal(stdMatch.sensible, true, 'standard mode: playing the suggested move is sensible');
  assert.equal(stdMatch.matched, true, 'standard mode: matched flag mirrors sensible');
  const stdOther = context.recordPlayerMove(guardFen, { playerUci: 'd1h5' });
  assert.equal(stdOther.sensible, false, 'standard mode: ignoring the suggestion is not sensible');

  context.resetCorrelationTracker();
  context.recordEngineRecommendation(guardFen, 'd1d2');
  context.recordHumanRecommendation(guardFen, 'd1h5');
  const humanRec = context.recordPlayerMove(guardFen, { playerUci: 'd1h5' });
  assert.equal(humanRec.sensible, true, 'human-like mode: following the human recommendation is sensible');
  const humanBotCopy = context.recordPlayerMove(guardFen, { playerUci: 'd1d2' });
  assert.equal(humanBotCopy.sensible, false, 'human-like mode: copying the engine top pick is bot-like and not sensible');
  const humanOwn = context.recordPlayerMove(guardFen, { playerUci: 'd1d3' });
  assert.equal(humanOwn.sensible, true, 'human-like mode: playing an own natural move stays human-like');
  const guardStats = context.getCorrelationStats();
  assert.equal(guardStats.total, 3, 'correlation guard records all three player moves');
  assert.equal(guardStats.matches, 2, 'two of three moves are human-like/sensible');

  console.log('background smoke tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

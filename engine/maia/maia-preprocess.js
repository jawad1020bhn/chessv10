/*
 * Maia-3 browser-model preprocessing and policy decoding.
 *
 * The approved first-release ONNX artifact uses a [batch, 64, 12] current
 * position tensor and a 4,352-action vocabulary. The action vocabulary is
 * deterministic: 4,096 from/to pairs followed by 256 rank-7-to-rank-8
 * promotion actions ordered q, r, b, n.
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const PROMOTIONS = 'qrbn';
  const POLICY_SIZE = 4352;
  const PIECES = Object.freeze(['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k']);
  const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

  function squareIndex(square) {
    if (!/^[a-h][1-8]$/.test(square || '')) return -1;
    return (Number(square[1]) - 1) * 8 + FILES.indexOf(square[0]);
  }

  function squareFromIndex(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 0 || value >= 64) return null;
    return FILES[value % 8] + String(Math.floor(value / 8) + 1);
  }

  function actionIndex(move) {
    const uci = String(move || '').toLowerCase();
    if (!UCI.test(uci)) return -1;
    const from = squareIndex(uci.slice(0, 2));
    const to = squareIndex(uci.slice(2, 4));
    if (from < 0 || to < 0) return -1;
    if (uci.length === 4) return from * 64 + to;
    // Promotion output actions describe White-oriented rank-7 -> rank-8 moves.
    if (uci[1] !== '7' || uci[3] !== '8') return -1;
    const promotion = PROMOTIONS.indexOf(uci[4]);
    if (promotion < 0) return -1;
    const fromFile = FILES.indexOf(uci[0]);
    const toFile = FILES.indexOf(uci[2]);
    return 4096 + (fromFile * 8 + toFile) * 4 + promotion;
  }

  function actionMove(index) {
    const value = Number(index);
    if (!Number.isInteger(value) || value < 0 || value >= POLICY_SIZE) return null;
    if (value < 4096) {
      const from = squareFromIndex(Math.floor(value / 64));
      const to = squareFromIndex(value % 64);
      return from && to ? from + to : null;
    }
    const promotionIndex = value - 4096;
    const pair = Math.floor(promotionIndex / 4);
    const promotion = PROMOTIONS[promotionIndex % 4];
    const fromFile = Math.floor(pair / 8);
    const toFile = pair % 8;
    return FILES[fromFile] + '7' + FILES[toFile] + '8' + promotion;
  }

  function mirrorSquare(square) {
    if (!/^[a-h][1-8]$/.test(square || '')) return null;
    return square[0] + String(9 - Number(square[1]));
  }

  function mirrorMove(move) {
    const uci = String(move || '').toLowerCase();
    if (!UCI.test(uci)) return null;
    const from = mirrorSquare(uci.slice(0, 2));
    const to = mirrorSquare(uci.slice(2, 4));
    return from && to ? from + to + (uci[4] || '') : null;
  }

  function swapPieceColor(piece) {
    return piece === piece.toUpperCase() ? piece.toLowerCase() : piece.toUpperCase();
  }

  function isBlackToMove(fen) {
    return String(fen || '').trim().split(/\s+/)[1] === 'b';
  }

  function boardToTokens(fen) {
    const parsed = root.ChessCore?.parseFen?.(fen);
    if (!parsed) return null;
    const black = parsed.parts[1] === 'b';
    const tokens = new Float32Array(64 * 12);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        let piece = parsed.board[row][col];
        if (!piece) continue;
        // Board rows are FEN rank 8 -> 1. The tensor uses chess square order
        // a1..h8, and black-to-move positions are vertically mirrored while
        // colors are swapped, matching the approved browser model path.
        let rank = 8 - row;
        if (black) {
          rank = 9 - rank;
          piece = swapPieceColor(piece);
        }
        const pieceIndex = PIECES.indexOf(piece);
        if (pieceIndex < 0) return null;
        const index = ((rank - 1) * 8 + col) * 12 + pieceIndex;
        tokens[index] = 1;
      }
    }
    return tokens;
  }

  function legalActionEntries(fen) {
    const api = root.AnalysisContract;
    if (!api || typeof api.generateLegalMoves !== 'function') return [];
    const black = isBlackToMove(fen);
    const byIndex = new Map();
    for (const originalUci of api.generateLegalMoves(fen)) {
      const modelUci = black ? mirrorMove(originalUci) : originalUci;
      const index = actionIndex(modelUci);
      if (index >= 0 && index < POLICY_SIZE && !byIndex.has(index)) {
        byIndex.set(index, { index, uci: originalUci, modelUci });
      }
    }
    return [...byIndex.values()];
  }

  function decodePolicy(fen, rawLogits, hintCount) {
    const logits = rawLogits instanceof Float32Array ? rawLogits : new Float32Array(rawLogits || []);
    if (logits.length !== POLICY_SIZE) return { ok: false, reason: 'unexpected_policy_shape', moves: [] };
    const legal = legalActionEntries(fen);
    if (!legal.length) return { ok: false, reason: 'no_legal_moves', moves: [] };
    let max = -Infinity;
    for (const entry of legal) {
      const logit = Number(logits[entry.index]);
      if (!Number.isFinite(logit)) return { ok: false, reason: 'invalid_policy_logit', moves: [] };
      if (logit > max) max = logit;
    }
    let sum = 0;
    const scored = legal.map(entry => {
      const weight = Math.exp(Number(logits[entry.index]) - max);
      sum += weight;
      return { ...entry, weight };
    });
    if (!Number.isFinite(sum) || sum <= 0) return { ok: false, reason: 'invalid_policy_distribution', moves: [] };
    const count = Math.max(1, Math.min(5, Number(hintCount) || 3));
    const moves = scored
      .map(entry => ({ uci: entry.uci, probability: entry.weight / sum }))
      .sort((left, right) => right.probability - left.probability || left.uci.localeCompare(right.uci))
      .slice(0, count)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    return { ok: true, reason: '', moves, legalMoveCount: legal.length };
  }

  function decodeLdw(rawLogits) {
    const logits = rawLogits instanceof Float32Array ? rawLogits : new Float32Array(rawLogits || []);
    if (logits.length !== 3) return null;
    const loss = Number(logits[0]);
    const draw = Number(logits[1]);
    const win = Number(logits[2]);
    if (![loss, draw, win].every(Number.isFinite)) return null;
    const max = Math.max(loss, draw, win);
    const lossWeight = Math.exp(loss - max);
    const drawWeight = Math.exp(draw - max);
    const winWeight = Math.exp(win - max);
    const total = lossWeight + drawWeight + winWeight;
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
      enabled: true,
      scope: 'current-position',
      perspective: 'side-to-move',
      win: winWeight / total,
      draw: drawWeight / total,
      loss: lossWeight / total
    };
  }

  function preparePosition(fen, hintCount) {
    const parsed = root.ChessCore?.parseFen?.(fen);
    if (!parsed) return { ok: false, reason: 'invalid_fen' };
    const tokens = boardToTokens(fen);
    const legal = legalActionEntries(fen);
    if (!tokens || !legal.length) return { ok: false, reason: legal.length ? 'tokenization_failed' : 'no_legal_moves' };
    return {
      ok: true,
      tokens,
      legalMoveCount: legal.length,
      hintCount: Math.max(1, Math.min(5, Number(hintCount) || 3)),
      blackToMove: parsed.parts[1] === 'b'
    };
  }

  const exported = Object.freeze({
    POLICY_SIZE,
    PIECES,
    squareIndex,
    squareFromIndex,
    actionIndex,
    actionMove,
    mirrorSquare,
    mirrorMove,
    boardToTokens,
    legalActionEntries,
    decodePolicy,
    decodeLdw,
    preparePosition
  });

  root.MaiaPreprocess = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

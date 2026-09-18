/*
 * On-device alpha-beta fallback. Not Stockfish, but a legal MultiPV searcher
 * that keeps the coach useful when cloud providers are silent.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 */
(function (root) {
  'use strict';

  const PIECE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ]
  };

  function contract() {
    return root.AnalysisContract;
  }

  function pstValue(type, row, col, white) {
    const table = PST[type];
    if (!table) return 0;
    const index = white ? row * 8 + col : (7 - row) * 8 + col;
    return table[index] || 0;
  }

  function evaluateWhite(fen) {
    const parsed = root.ChessCore.parseFen(fen);
    if (!parsed) return 0;
    let score = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = parsed.board[row][col];
        if (!piece) continue;
        const type = piece.toLowerCase();
        const white = piece === piece.toUpperCase();
        const value = (PIECE[type] || 0) + pstValue(type, row, col, white);
        score += white ? value : -value;
      }
    }
    return score;
  }

  function mvvLva(fen, uci) {
    const parsed = root.ChessCore.parseFen(fen);
    if (!parsed) return 0;
    const fromCol = uci.charCodeAt(0) - 97;
    const fromRow = 8 - Number(uci[1]);
    const toCol = uci.charCodeAt(2) - 97;
    const toRow = 8 - Number(uci[3]);
    const mover = parsed.board[fromRow][fromCol];
    const captured = parsed.board[toRow][toCol];
    if (!captured || !mover) return 0;
    return (PIECE[captured.toLowerCase()] || 0) * 10 - (PIECE[mover.toLowerCase()] || 0);
  }

  function orderedMoves(fen) {
    const moves = contract().generateLegalMoves(fen);
    return moves.sort((left, right) => mvvLva(fen, right) - mvvLva(fen, left));
  }

  function isCaptureOrPromo(fen, uci) {
    const parsed = root.ChessCore.parseFen(fen);
    if (!parsed) return Boolean(uci[4]);
    const toCol = uci.charCodeAt(2) - 97;
    const toRow = 8 - Number(uci[3]);
    return Boolean(uci[4] || parsed.board[toRow][toCol]);
  }

  function search(fen, depth, alpha, beta, maximizing, deadline, state) {
    if (state.nodes++ % 64 === 0 && Date.now() >= deadline) {
      state.timedOut = true;
      return evaluateWhite(fen);
    }
    const moves = orderedMoves(fen);
    if (!moves.length) {
      const parsed = root.ChessCore.parseFen(fen);
      const white = parsed?.parts[1] === 'w';
      if (parsed && contract().kingInCheck(parsed.board, white)) {
        return white ? -100000 + state.ply : 100000 - state.ply;
      }
      return 0;
    }
    if (depth <= 0) return quiesce(fen, alpha, beta, maximizing, deadline, state, 2);

    if (maximizing) {
      let best = -Infinity;
      for (const move of moves) {
        const next = contract().applyMoveToFen(fen, move);
        if (!next) continue;
        state.ply++;
        const score = search(next, depth - 1, alpha, beta, false, deadline, state);
        state.ply--;
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta || state.timedOut) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      const next = contract().applyMoveToFen(fen, move);
      if (!next) continue;
      state.ply++;
      const score = search(next, depth - 1, alpha, beta, true, deadline, state);
      state.ply--;
      if (score < best) best = score;
      if (score < beta) beta = score;
      if (alpha >= beta || state.timedOut) break;
    }
    return best;
  }

  function quiesce(fen, alpha, beta, maximizing, deadline, state, qDepth) {
    const stand = evaluateWhite(fen);
    if (qDepth <= 0 || state.timedOut) return stand;
    if (maximizing) {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    } else {
      if (stand <= alpha) return stand;
      if (stand < beta) beta = stand;
    }
    const noisy = orderedMoves(fen).filter(move => isCaptureOrPromo(fen, move));
    for (const move of noisy) {
      const next = contract().applyMoveToFen(fen, move);
      if (!next) continue;
      const score = quiesce(next, alpha, beta, !maximizing, deadline, state, qDepth - 1);
      if (maximizing) {
        if (score > alpha) alpha = score;
        if (alpha >= beta) return alpha;
      } else {
        if (score < beta) beta = score;
        if (alpha >= beta) return beta;
      }
    }
    return maximizing ? alpha : beta;
  }

  function analyze(fen, options = {}) {
    const api = contract();
    if (!api || !root.ChessCore?.parseFen(fen)) return null;
    const multiPv = Math.max(1, Math.min(5, Number(options.multiPv) || 1));
    const maxDepth = Math.max(1, Math.min(8, Number(options.maxDepth) || 4));
    const timeMs = Math.max(40, Math.min(1200, Number(options.timeMs) || 180));
    const deadline = Date.now() + timeMs;
    const rootMoves = api.generateLegalMoves(fen);
    if (!rootMoves.length) return null;

    const whiteToMove = fen.split(' ')[1] !== 'b';
    let ranked = rootMoves.map(move => ({ move, score: 0, pv: [move] }));
    let reached = 1;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextRanked = [];
      for (const entry of ranked) {
        const child = api.applyMoveToFen(fen, entry.move);
        if (!child) continue;
        const state = { nodes: 0, ply: 1, timedOut: false };
        const score = search(child, depth - 1, -Infinity, Infinity, !whiteToMove, deadline, state);
        nextRanked.push({
          move: entry.move,
          score,
          pv: [entry.move],
          nodes: state.nodes,
          timedOut: state.timedOut
        });
        if (Date.now() >= deadline) break;
      }
      if (!nextRanked.length) break;
      nextRanked.sort((left, right) => whiteToMove ? right.score - left.score : left.score - right.score);
      ranked = nextRanked;
      reached = depth;
      if (Date.now() >= deadline) break;
    }

    const selected = ranked.slice(0, multiPv);
    const pvs = selected.map((entry, index) => {
      const child = api.applyMoveToFen(fen, entry.move);
      const reply = child ? api.generateLegalMoves(child)[0] : null;
      return {
        multipv: index + 1,
        scoreType: Math.abs(entry.score) >= 90000 ? 'mate' : 'cp',
        score: Math.abs(entry.score) >= 90000
          ? (entry.score > 0 ? Math.max(1, 8 - reached) : -Math.max(1, 8 - reached))
          : entry.score,
        depth: reached,
        seldepth: reached,
        pv: reply ? [entry.move, reply] : [entry.move],
        nodes: entry.nodes || 0,
        nps: 0,
        time: timeMs
      };
    });

    return {
      fen,
      source: 'local-engine',
      pvs,
      bestMove: pvs[0]?.pv[0] || null,
      depth: reached,
      scorePerspective: 'white',
      isLocalEngine: true,
      timestamp: Date.now()
    };
  }

  const exported = { analyze, evaluateWhite };
  root.LocalEngine = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

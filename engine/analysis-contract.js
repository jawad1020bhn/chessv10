/*
 * Strict analysis contract: legal-move validation, PV hygiene, and a single
 * result shape every provider must pass through before style scoring or UI.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 */
(function (root) {
  'use strict';

  const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function parseFen(fen) {
    const core = root.ChessCore;
    return core && typeof core.parseFen === 'function' ? core.parseFen(fen) : null;
  }

  function squareName(row, col) {
    return String.fromCharCode(97 + col) + (8 - row);
  }

  function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function isWhitePiece(piece) {
    return Boolean(piece) && piece === piece.toUpperCase();
  }

  function findKing(board, white) {
    const symbol = white ? 'K' : 'k';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (board[row][col] === symbol) return { row, col };
      }
    }
    return null;
  }

  function pathClear(board, fromRow, fromCol, toRow, toCol) {
    const dr = Math.sign(toRow - fromRow);
    const dc = Math.sign(toCol - fromCol);
    let row = fromRow + dr;
    let col = fromCol + dc;
    while (row !== toRow || col !== toCol) {
      if (!inBounds(row, col) || board[row][col]) return false;
      row += dr;
      col += dc;
    }
    return true;
  }

  function attacksSquare(board, target, byWhite) {
    const pawn = byWhite ? 'P' : 'p';
    const pawnRow = target.row + (byWhite ? 1 : -1);
    for (const dc of [-1, 1]) {
      const col = target.col + dc;
      if (inBounds(pawnRow, col) && board[pawnRow][col] === pawn) return true;
    }
    const knight = byWhite ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT) {
      const row = target.row + dr;
      const col = target.col + dc;
      if (inBounds(row, col) && board[row][col] === knight) return true;
    }
    const king = byWhite ? 'K' : 'k';
    for (const [dr, dc] of KING) {
      const row = target.row + dr;
      const col = target.col + dc;
      if (inBounds(row, col) && board[row][col] === king) return true;
    }
    const bishop = byWhite ? 'B' : 'b';
    const rook = byWhite ? 'R' : 'r';
    const queen = byWhite ? 'Q' : 'q';
    for (const [dr, dc] of BISHOP) {
      let row = target.row + dr;
      let col = target.col + dc;
      while (inBounds(row, col)) {
        const piece = board[row][col];
        if (piece) {
          if (piece === bishop || piece === queen) return true;
          break;
        }
        row += dr;
        col += dc;
      }
    }
    for (const [dr, dc] of ROOK) {
      let row = target.row + dr;
      let col = target.col + dc;
      while (inBounds(row, col)) {
        const piece = board[row][col];
        if (piece) {
          if (piece === rook || piece === queen) return true;
          break;
        }
        row += dr;
        col += dc;
      }
    }
    return false;
  }

  function kingInCheck(board, white) {
    const king = findKing(board, white);
    return !king || attacksSquare(board, king, !white);
  }

  function cloneBoard(board) {
    return board.map(row => row.slice());
  }

  function applyUciToBoard(board, uci, epSquare) {
    const fromCol = uci.charCodeAt(0) - 97;
    const fromRow = 8 - Number(uci[1]);
    const toCol = uci.charCodeAt(2) - 97;
    const toRow = 8 - Number(uci[3]);
    const promo = uci[4] || '';
    const next = cloneBoard(board);
    const piece = next[fromRow][fromCol];
    if (!piece) return null;
    const white = isWhitePiece(piece);
    const type = piece.toLowerCase();
    const destEmpty = !next[toRow][toCol];
    next[fromRow][fromCol] = null;
    next[toRow][toCol] = promo
      ? (white ? promo.toUpperCase() : promo.toLowerCase())
      : piece;
    if (type === 'k' && Math.abs(fromCol - toCol) === 2) {
      const rookFrom = toCol === 6 ? 7 : 0;
      const rookTo = toCol === 6 ? 5 : 3;
      next[fromRow][rookTo] = next[fromRow][rookFrom];
      next[fromRow][rookFrom] = null;
    }
    if (type === 'p' && fromCol !== toCol && destEmpty) {
      const expectedEp = epSquare && epSquare !== '-' ? epSquare : '';
      if (expectedEp && expectedEp !== uci.slice(2, 4)) return null;
      next[fromRow][toCol] = null;
    }
    return next;
  }

  function pushMove(moves, fromRow, fromCol, toRow, toCol, promo) {
    moves.push(squareName(fromRow, fromCol) + squareName(toRow, toCol) + (promo || ''));
  }

  function generatePseudoLegal(parsed) {
    const board = parsed.board;
    const white = parsed.parts[1] === 'w';
    const ep = parsed.parts[3] || '-';
    const rights = parsed.parts[2] || '-';
    const moves = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece || isWhitePiece(piece) !== white) continue;
        const type = piece.toLowerCase();
        if (type === 'p') {
          const dir = white ? -1 : 1;
          const start = white ? 6 : 1;
          const promoRow = white ? 0 : 7;
          const one = row + dir;
          if (inBounds(one, col) && !board[one][col]) {
            if (one === promoRow) for (const promo of ['q', 'r', 'b', 'n']) pushMove(moves, row, col, one, col, promo);
            else pushMove(moves, row, col, one, col);
            const two = row + dir * 2;
            if (row === start && inBounds(two, col) && !board[two][col]) pushMove(moves, row, col, two, col);
          }
          for (const dc of [-1, 1]) {
            const captureCol = col + dc;
            if (!inBounds(one, captureCol)) continue;
            const target = board[one][captureCol];
            if (target && isWhitePiece(target) !== white) {
              if (one === promoRow) for (const promo of ['q', 'r', 'b', 'n']) pushMove(moves, row, col, one, captureCol, promo);
              else pushMove(moves, row, col, one, captureCol);
            } else if (ep !== '-' && squareName(one, captureCol) === ep) {
              pushMove(moves, row, col, one, captureCol);
            }
          }
        } else if (type === 'n') {
          for (const [dr, dc] of KNIGHT) {
            const toRow = row + dr;
            const toCol = col + dc;
            if (!inBounds(toRow, toCol)) continue;
            const target = board[toRow][toCol];
            if (!target || isWhitePiece(target) !== white) pushMove(moves, row, col, toRow, toCol);
          }
        } else if (type === 'k') {
          for (const [dr, dc] of KING) {
            const toRow = row + dr;
            const toCol = col + dc;
            if (!inBounds(toRow, toCol)) continue;
            const target = board[toRow][toCol];
            if (!target || isWhitePiece(target) !== white) pushMove(moves, row, col, toRow, toCol);
          }
        } else {
          const rays = type === 'b' ? BISHOP : type === 'r' ? ROOK : BISHOP.concat(ROOK);
          for (const [dr, dc] of rays) {
            let toRow = row + dr;
            let toCol = col + dc;
            while (inBounds(toRow, toCol)) {
              const target = board[toRow][toCol];
              if (!target) pushMove(moves, row, col, toRow, toCol);
              else {
                if (isWhitePiece(target) !== white) pushMove(moves, row, col, toRow, toCol);
                break;
              }
              toRow += dr;
              toCol += dc;
            }
          }
        }
      }
    }

    const back = white ? 7 : 0;
    const king = findKing(board, white);
    if (king && king.row === back && king.col === 4 && !kingInCheck(board, white)) {
      const canKing = rights.includes(white ? 'K' : 'k');
      const canQueen = rights.includes(white ? 'Q' : 'q');
      if (canKing && !board[back][5] && !board[back][6] &&
          !attacksSquare(board, { row: back, col: 5 }, !white) &&
          !attacksSquare(board, { row: back, col: 6 }, !white)) {
        pushMove(moves, back, 4, back, 6);
      }
      if (canQueen && !board[back][3] && !board[back][2] && !board[back][1] &&
          !attacksSquare(board, { row: back, col: 3 }, !white) &&
          !attacksSquare(board, { row: back, col: 2 }, !white)) {
        pushMove(moves, back, 4, back, 2);
      }
    }
    return moves;
  }

  function generateLegalMoves(fen) {
    const parsed = parseFen(fen);
    if (!parsed) return [];
    const white = parsed.parts[1] === 'w';
    const legal = [];
    for (const uci of generatePseudoLegal(parsed)) {
      const next = applyUciToBoard(parsed.board, uci, parsed.parts[3]);
      if (next && !kingInCheck(next, white)) legal.push(uci);
    }
    return legal;
  }

  function isLegalMove(fen, uci) {
    return UCI.test(uci || '') && generateLegalMoves(fen).includes(uci);
  }

  function applyMoveToFen(fen, uci) {
    const parsed = parseFen(fen);
    if (!parsed || !UCI.test(uci || '')) return null;
    const white = parsed.parts[1] === 'w';
    const nextBoard = applyUciToBoard(parsed.board, uci, parsed.parts[3]);
    if (!nextBoard || kingInCheck(nextBoard, white)) return null;
    const fromCol = uci.charCodeAt(0) - 97;
    const fromRow = 8 - Number(uci[1]);
    const toCol = uci.charCodeAt(2) - 97;
    const toRow = 8 - Number(uci[3]);
    const moving = parsed.board[fromRow][fromCol];
    if (!moving) return null;
    const captured = parsed.board[toRow][toCol];
    const type = moving.toLowerCase();
    const core = root.ChessCore;
    const placement = core.boardToPlacement(nextBoard);
    let rights = parsed.parts[2] === '-' ? '' : parsed.parts[2];
    const fromSq = uci.slice(0, 2);
    const toSq = uci.slice(2, 4);
    if (fromSq === 'e1') rights = rights.replace(/[KQ]/g, '');
    if (fromSq === 'e8') rights = rights.replace(/[kq]/g, '');
    if (fromSq === 'h1' || toSq === 'h1') rights = rights.replace(/K/g, '');
    if (fromSq === 'a1' || toSq === 'a1') rights = rights.replace(/Q/g, '');
    if (fromSq === 'h8' || toSq === 'h8') rights = rights.replace(/k/g, '');
    if (fromSq === 'a8' || toSq === 'a8') rights = rights.replace(/q/g, '');
    let ep = '-';
    if (type === 'p' && Math.abs(fromRow - toRow) === 2) {
      ep = fromSq[0] + String((Number(fromSq[1]) + Number(toSq[1])) / 2);
    }
    const isEp = type === 'p' && fromCol !== toCol && !captured;
    const halfmove = type === 'p' || captured || isEp ? 0 : Number(parsed.parts[4]) + 1;
    const fullmove = Number(parsed.parts[5]) + (white ? 0 : 1);
    return `${placement} ${white ? 'b' : 'w'} ${rights || '-'} ${ep} ${halfmove} ${fullmove}`;
  }

  function normalizeMateScore(score) {
    const value = Number(score);
    if (!Number.isFinite(value) || value === 0) return 0;
    return value > 0 ? Math.max(1, Math.round(value)) : Math.min(-1, Math.round(value));
  }

  function normalizeCentipawns(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 0;
    return Math.max(-30000, Math.min(30000, Math.round(value)));
  }

  function normalizeScoreToWhite(rawScore, scoreType, perspective) {
    const type = scoreType === 'mate' ? 'mate' : 'cp';
    const score = type === 'mate' ? normalizeMateScore(rawScore) : normalizeCentipawns(rawScore);
    if (perspective === 'side-to-move') return { score, scoreType: type, scorePerspective: 'side-to-move' };
    return { score, scoreType: type, scorePerspective: 'white' };
  }

  function flipScore(score) {
    return Number(score) ? -Number(score) : 0;
  }

  function sourceConfidence(source, extras = {}) {
    if (source === 'tablebase') return 1;
    if (source === 'local-engine') {
      const depth = Number(extras.depth) || 0;
      return depth >= 6 ? 0.72 : depth >= 4 ? 0.58 : 0.42;
    }
    if (source === 'lichess-cloud') {
      const depth = Number(extras.depth) || 0;
      const base = depth >= 30 ? 0.92 : depth >= 20 ? 0.82 : 0.7;
      return extras.stale ? Math.max(0.4, base - 0.18) : base;
    }
    if (source === 'chess-api') {
      const depth = Number(extras.depth) || 0;
      const base = depth >= 16 ? 0.8 : depth >= 12 ? 0.72 : 0.58;
      return extras.stale ? Math.max(0.38, base - 0.16) : base;
    }
    if (source === 'masters-explorer' || source === 'opening-explorer') {
      const games = Number(extras.games) || 0;
      const base = games >= 200 ? 0.55 : games >= 20 ? 0.42 : 0.28;
      return extras.stale ? Math.max(0.2, base - 0.08) : base;
    }
    return 0.25;
  }

  function validatePvLine(fen, pv) {
    if (!Array.isArray(pv) || !pv.length) return { ok: false, reason: 'empty_pv', moves: [] };
    let cursor = fen;
    const moves = [];
    for (let index = 0; index < pv.length; index++) {
      const uci = String(pv[index] || '');
      if (!UCI.test(uci)) return { ok: false, reason: 'malformed_uci', moves };
      if (!isLegalMove(cursor, uci)) {
        return index === 0
          ? { ok: false, reason: 'illegal_first_move', moves }
          : { ok: true, reason: 'truncated_illegal_continuation', moves };
      }
      const next = applyMoveToFen(cursor, uci);
      if (!next) {
        return index === 0
          ? { ok: false, reason: 'illegal_first_move', moves }
          : { ok: true, reason: 'truncated_illegal_continuation', moves };
      }
      moves.push(uci);
      cursor = next;
    }
    return { ok: true, reason: '', moves };
  }

  function emptyResult(fen, extras = {}) {
    return {
      fen,
      source: extras.source || 'unknown',
      pvs: [],
      bestMove: null,
      score: 0,
      scoreType: 'cp',
      scorePerspective: 'white',
      depth: 0,
      timestamp: extras.timestamp || Date.now(),
      stale: Boolean(extras.stale),
      cached: Boolean(extras.cached),
      confidence: 0,
      positionReliable: extras.positionReliable !== false,
      qualityClass: extras.qualityClass || 'unavailable',
      rejectedPvs: extras.rejectedPvs || 0
    };
  }

  function finalizeAnalysis(raw, requestedFen, extras = {}) {
    const parsed = parseFen(requestedFen);
    if (!parsed) return emptyResult(requestedFen, { ...extras, qualityClass: 'unavailable' });
    const source = raw?.source || extras.source || 'unknown';
    const timestamp = Number(raw?.timestamp) || extras.timestamp || Date.now();
    const positionReliable = extras.positionReliable !== false;
    if (!positionReliable && source !== 'tablebase') {
      const blocked = emptyResult(requestedFen, { ...extras, source, timestamp, qualityClass: extras.qualityClass || 'unreliable' });
      blocked.exactHintBlocked = {
        reason: 'unreliable_position',
        message: 'Exact-move hints need a verified FEN. This board snapshot is incomplete.'
      };
      blocked.positionReliable = false;
      return blocked;
    }

    const incoming = Array.isArray(raw?.pvs) ? raw.pvs : [];
    const accepted = [];
    let rejected = 0;
    const sideToMove = parsed.parts[1] === 'b';
    for (const pv of incoming) {
      const validated = validatePvLine(requestedFen, pv?.pv || []);
      if (!validated.ok || !validated.moves.length) {
        rejected++;
        continue;
      }
      const perspective = pv.scorePerspective || raw.scorePerspective || extras.scorePerspective || 'white';
      let normalized = normalizeScoreToWhite(pv.score, pv.scoreType, perspective);
      if (perspective === 'side-to-move' && sideToMove) {
        normalized = { ...normalized, score: flipScore(normalized.score), scorePerspective: 'white' };
      } else {
        normalized = { ...normalized, scorePerspective: 'white' };
      }
      accepted.push({
        multipv: accepted.length + 1,
        scoreType: normalized.scoreType,
        score: normalized.score,
        depth: Number(pv.depth) || Number(raw.depth) || 0,
        seldepth: Number(pv.seldepth) || 0,
        pv: validated.moves,
        nodes: Number(pv.nodes) || 0,
        nps: Number(pv.nps) || 0,
        time: Number(pv.time) || 0,
        _masterData: pv._masterData || null
      });
    }

    if (!accepted.length) {
      return emptyResult(requestedFen, {
        ...extras,
        source,
        timestamp,
        rejectedPvs: rejected,
        qualityClass: extras.qualityClass || 'unavailable'
      });
    }

    accepted.sort((left, right) => {
      const leftMate = left.scoreType === 'mate';
      const rightMate = right.scoreType === 'mate';
      if (leftMate && rightMate) {
        if (Math.sign(left.score) !== Math.sign(right.score)) return right.score - left.score;
        return Math.abs(left.score) - Math.abs(right.score);
      }
      if (leftMate && left.score > 0) return -1;
      if (rightMate && right.score > 0) return 1;
      if (leftMate && left.score < 0) return 1;
      if (rightMate && right.score < 0) return -1;
      return right.score - left.score;
    });
    accepted.forEach((pv, index) => { pv.multipv = index + 1; });

    const best = accepted[0];
    const games = accepted.reduce((sum, pv) => sum + Number(pv._masterData?.totalGames || 0), 0);
    const confidence = sourceConfidence(source, {
      depth: best.depth || raw.depth,
      stale: Boolean(raw?.stale || extras.stale),
      games
    });
    return {
      ...raw,
      fen: requestedFen,
      source,
      pvs: accepted,
      bestMove: best.pv[0],
      score: best.score,
      scoreType: best.scoreType,
      scorePerspective: 'white',
      depth: Number(raw?.depth) || best.depth || 0,
      timestamp,
      stale: Boolean(raw?.stale || extras.stale),
      cached: Boolean(raw?.cached || extras.cached),
      confidence,
      positionReliable,
      rejectedPvs: rejected,
      qualityClass: extras.qualityClass || raw?.qualityClass || 'unknown',
      cacheAgeMs: Number(raw?.cacheAgeMs || extras.cacheAgeMs || 0)
    };
  }

  const exported = {
    generateLegalMoves,
    isLegalMove,
    applyMoveToFen,
    validatePvLine,
    normalizeScoreToWhite,
    sourceConfidence,
    finalizeAnalysis,
    emptyResult,
    kingInCheck,
    attacksSquare,
    findKing
  };
  root.AnalysisContract = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

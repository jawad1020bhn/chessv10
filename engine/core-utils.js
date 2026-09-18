/*
 * Shared, dependency-free helpers used by the service worker and side panel.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 * This project is a study/research tool for building a chess engine that can
 * play in a variety of styles (normal, aggressive, ultra-aggressive). It is
 * intended for learning, offline analysis, and engine-variation research. It
 * is anti-cheat compliant and fair-play safe: it never assists a player in a
 * rated or live online game, and it must not be used to gain an unfair
 * advantage against human opponents.
 */
(function (root) {
  'use strict';

  function parsePlacement(placement) {
    if (typeof placement !== 'string') return null;
    const rows = placement.split('/');
    if (rows.length !== 8) return null;
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    let whiteKings = 0, blackKings = 0;
    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (/^[1-8]$/.test(ch)) col += Number(ch);
        else if (/^[prnbqkPRNBQK]$/.test(ch)) {
          if (col >= 8) return null;
          board[r][col++] = ch;
          if (ch === 'K') whiteKings++;
          if (ch === 'k') blackKings++;
        } else return null;
      }
      if (col !== 8) return null;
    }
    return whiteKings === 1 && blackKings === 1 ? board : null;
  }

  function boardToPlacement(board) {
    return board.map(row => {
      let result = '', empty = 0;
      for (const piece of row) {
        if (piece) {
          if (empty) result += empty;
          result += piece;
          empty = 0;
        } else empty++;
      }
      return result + (empty || '');
    }).join('/');
  }

  function parseFen(fen) {
    if (typeof fen !== 'string') return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length !== 6) return null;
    const board = parsePlacement(parts[0]);
    if (!board || !/^[wb]$/.test(parts[1])) return null;
    if (!/^(?:-|K?Q?k?q?)$/.test(parts[2]) || new Set(parts[2]).size !== parts[2].length) return null;
    if (!/^(?:-|[a-h][36])$/.test(parts[3])) return null;
    if (!/^\d+$/.test(parts[4]) || !/^[1-9]\d*$/.test(parts[5])) return null;
    return { parts, board };
  }

  function coords(square) {
    if (!/^[a-h][1-8]$/.test(square || '')) return null;
    return { row: 8 - Number(square[1]), col: square.charCodeAt(0) - 97 };
  }

  function applyUciToPlacement(fen, uci) {
    const parsed = parseFen(fen);
    if (!parsed || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
    const board = parsed.board.map(row => [...row]);
    const from = coords(uci.slice(0, 2)), to = coords(uci.slice(2, 4));
    const piece = board[from.row][from.col];
    if (!piece) return null;
    const destinationWasEmpty = !board[to.row][to.col];
    board[from.row][from.col] = null;
    board[to.row][to.col] = uci[4]
      ? (piece === piece.toUpperCase() ? uci[4].toUpperCase() : uci[4])
      : piece;

    if (piece.toLowerCase() === 'k' && Math.abs(from.col - to.col) === 2) {
      const rookFrom = to.col === 6 ? 7 : 0;
      const rookTo = to.col === 6 ? 5 : 3;
      board[from.row][rookTo] = board[from.row][rookFrom];
      board[from.row][rookFrom] = null;
    }
    if (piece.toLowerCase() === 'p' && from.col !== to.col && destinationWasEmpty) {
      board[from.row][to.col] = null;
    }
    return boardToPlacement(board);
  }

  function didUciProduceFen(previousFen, uci, actualFen) {
    const previous = parseFen(previousFen), actual = parseFen(actualFen);
    if (!previous || !actual || previous.parts[1] === actual.parts[1]) return false;
    return applyUciToPlacement(previousFen, uci) === actual.parts[0];
  }

  function inferTransition(previousFen, observedFen) {
    const previous = parseFen(previousFen), observed = parseFen(observedFen);
    if (!previous || !observed) return null;
    const oldBoard = previous.board, newBoard = observed.board;
    const removed = [], added = [], changed = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (oldBoard[r][c] !== newBoard[r][c]) {
        changed.push({ r, c, before: oldBoard[r][c], after: newBoard[r][c] });
        if (oldBoard[r][c] && !newBoard[r][c]) removed.push({ r, c, piece: oldBoard[r][c] });
        if (newBoard[r][c] && oldBoard[r][c] !== newBoard[r][c]) added.push({ r, c, piece: newBoard[r][c], before: oldBoard[r][c] });
      }
    }
    if (changed.length < 2 || changed.length > 4) return null;
    const moverIsWhite = previous.parts[1] === 'w';
    const own = p => p && (p === p.toUpperCase()) === moverIsWhite;
    const fromCandidates = changed.filter(s => own(s.before) && !own(s.after));
    const toCandidates = changed.filter(s => own(s.after) && s.after !== s.before);
    if (fromCandidates.length < 1 || toCandidates.length < 1) return null;
    const from = fromCandidates.find(s => s.before.toLowerCase() === 'k') || fromCandidates.find(s => s.before.toLowerCase() !== 'r') || fromCandidates[0];
    const to = toCandidates.find(s => s.after.toLowerCase() === from.before.toLowerCase() || from.before.toLowerCase() === 'p' && s.after.toLowerCase() !== 'p') || toCandidates[0];
    return { from, to, changed, oldBoard, newBoard };
  }

  function reconcileFen(previousFen, observedFen) {
    const observed = parseFen(observedFen);
    if (!observed) return null;
    if (!previousFen) return observedFen;
    const previous = parseFen(previousFen);
    if (!previous) return observedFen;
    const transition = inferTransition(previousFen, observedFen);
    if (!transition) return observedFen;

    let rights = previous.parts[2] === '-' ? '' : previous.parts[2];
    const { from, to } = transition;
    const fromSquare = String.fromCharCode(97 + from.c) + (8 - from.r);
    const toSquare = String.fromCharCode(97 + to.c) + (8 - to.r);
    const moving = from.before;
    if (moving === 'K') rights = rights.replace(/[KQ]/g, '');
    if (moving === 'k') rights = rights.replace(/[kq]/g, '');
    const rookRights = { a1: 'Q', h1: 'K', a8: 'q', h8: 'k' };
    if (moving.toLowerCase() === 'r' && rookRights[fromSquare]) rights = rights.replace(rookRights[fromSquare], '');
    if (to.before && to.before.toLowerCase() === 'r' && rookRights[toSquare]) rights = rights.replace(rookRights[toSquare], '');

    let ep = '-';
    if (moving.toLowerCase() === 'p' && Math.abs(from.r - to.r) === 2 && from.c === to.c) {
      ep = fromSquare[0] + ((Number(fromSquare[1]) + Number(toSquare[1])) / 2);
    }
    const capture = Boolean(to.before) || (moving.toLowerCase() === 'p' && from.c !== to.c);
    const halfmove = moving.toLowerCase() === 'p' || capture ? 0 : Number(previous.parts[4]) + 1;
    const fullmove = Number(previous.parts[5]) + (previous.parts[1] === 'b' ? 1 : 0);
    const active = previous.parts[1] === 'w' ? 'b' : 'w';
    return `${observed.parts[0]} ${active} ${rights || '-'} ${ep} ${halfmove} ${fullmove}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }

  function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  root.ChessCore = { parsePlacement, boardToPlacement, parseFen, applyUciToPlacement, didUciProduceFen, inferTransition, reconcileFen, escapeHtml, clampNumber };
})(typeof globalThis !== 'undefined' ? globalThis : this);

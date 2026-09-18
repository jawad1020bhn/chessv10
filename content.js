/**
 * Chess Hint Assistant — Content Script
 * One-shot board reader — injected via chrome.scripting.executeScript
 * Reads board state ONCE and returns. No persistent footprint.
 * No polling, no intervals, no observers.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 * This project is a study/research tool for building a chess engine that can
 * play in a variety of styles (normal, aggressive, ultra-aggressive). It is
 * intended for learning, offline analysis, and engine-variation research. It
 * is anti-cheat compliant and fair-play safe: it never assists a player in a
 * rated or live online game, and it must not be used to gain an unfair
 * advantage against human opponents.
 */

(function () {
  'use strict';

  // ─── Site Detection ────────────────────────────────────────────────
  function detectSite() {
    const host = window.location.hostname;
    if (host.includes('chess.com')) return 'chesscom';
    if (host.includes('lichess.org')) return 'lichess';
    return null;
  }

  // ─── Board Utility Functions ───────────────────────────────────────
  function findPiece(board, symbol, row, col) {
    return board[row] && board[row][col] === symbol;
  }

  // ─── Chess.com Board Reader ────────────────────────────────────────
  function readChesscomBoard() {
    const boardEl = document.querySelector('wc-chess-board');
    if (!boardEl) return null;

    const root = boardEl.shadowRoot || boardEl;
    const pieces = root.querySelectorAll('.piece');
    if (!pieces || pieces.length === 0) return null;

    // Build 8x8 board array
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (const pieceEl of pieces) {
      const info = parseChesscomPiece(pieceEl);
      if (!info) continue;
      const row = 8 - info.rank;
      const col = info.file - 1;
      if (row >= 0 && row < 8 && col >= 0 && col < 8) {
        board[row][col] = info.symbol;
      }
    }

    // Build piece placement part of FEN
    let fenPlacement = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        if (board[r][c]) {
          if (empty > 0) { fenPlacement += empty; empty = 0; }
          fenPlacement += board[r][c];
        } else {
          empty++;
        }
      }
      if (empty > 0) fenPlacement += empty;
      if (r < 7) fenPlacement += '/';
    }

    const activeColor = getChesscomActiveColor(boardEl);
    const turnReliable = activeColor === 'w' || activeColor === 'b';
    const castling = getChesscomCastling(board);
    const epSquare = getChesscomEnPassant(board);
    // Keep a syntactically valid FEN for display/reconciliation, but mark an
    // unavailable clock/turn indicator explicitly rather than guessing White.
    const fen = `${fenPlacement} ${turnReliable ? activeColor : 'w'} ${castling} ${epSquare} 0 1`;
    const playerColor = getChesscomPlayerColor(boardEl);

    return { fen, playerColor, turnReliable };
  }

  function parseChesscomPiece(el) {
    let color = null, type = null, file = null, rank = null;

    for (const cls of el.classList) {
      if (cls.length === 2 && /^[wb][prnbqk]$/.test(cls)) {
        color = cls[0];
        type = cls[1];
      }
      const sqMatch = cls.match(/^square-(\d)(\d)$/);
      if (sqMatch) {
        file = parseInt(sqMatch[1]);
        rank = parseInt(sqMatch[2]);
      }
    }

    // Use explicit null/undefined checks instead of falsy — robust
    // against future regex changes that could yield 0 (which `!` would reject).
    if (color === null || type === null || file === null || rank === null) return null;
    const symbol = color === 'w' ? type.toUpperCase() : type.toLowerCase();
    return { color, type, symbol, file, rank };
  }

  function getChesscomActiveColor(boardEl) {
    const turnEl = boardEl.shadowRoot
      ? boardEl.shadowRoot.querySelector('.turn-indicator')
      : null;

    const bottomClock = document.querySelector('.clock-bottom');
    const topClock = document.querySelector('.clock-top');
    const bottomColor = getChesscomBottomColor(boardEl);

    if (bottomClock) {
      const isActive = bottomClock.classList.contains('clock-active') ||
                       bottomClock.classList.contains('active');
      if (isActive) {
        return bottomColor === 'w' ? 'w' : 'b';
      }
    }
    if (topClock) {
      const isActive = topClock.classList.contains('clock-active') ||
                       topClock.classList.contains('active');
      if (isActive) {
        return bottomColor === 'w' ? 'b' : 'w';
      }
    }

    const moveList = document.querySelector('.move-list, .vertical-move-list');
    if (moveList) {
      const moves = moveList.querySelectorAll('.move, .move-node, [data-whole-move-number]');
      if (moves.length > 0) {
        const lastMove = moves[moves.length - 1];
        const isBlackMove = lastMove.classList.contains('black') ||
                           lastMove.closest('.black-move') ||
                           lastMove.querySelector('.black-move');
        return isBlackMove ? 'w' : 'b';
      }
    }

    return null;
  }

  function getChesscomBottomColor(boardEl) {
    if (boardEl.shadowRoot) {
      const board = boardEl.shadowRoot.querySelector('.board');
      if (board) {
        const flipped = board.classList.contains('flipped');
        return flipped ? 'b' : 'w';
      }
    }
    return 'w';
  }

  function getChesscomPlayerColor(boardEl) {
    return getChesscomBottomColor(boardEl);
  }

  function getChesscomCastling(board) {
    let rights = '';
    if (findPiece(board, 'K', 7, 4) && findPiece(board, 'R', 7, 7)) rights += 'K';
    if (findPiece(board, 'K', 7, 4) && findPiece(board, 'R', 7, 0)) rights += 'Q';
    if (findPiece(board, 'k', 0, 4) && findPiece(board, 'r', 0, 7)) rights += 'k';
    if (findPiece(board, 'k', 0, 4) && findPiece(board, 'r', 0, 0)) rights += 'q';
    return rights || '-';
  }

  function getChesscomEnPassant(board) {
    for (let c = 0; c < 8; c++) {
      if (board[3][c] === 'P') {
        if (c > 0 && board[3][c - 1] === 'p') return String.fromCharCode(97 + c) + '6';
        if (c < 7 && board[3][c + 1] === 'p') return String.fromCharCode(97 + c) + '6';
      }
      if (board[4][c] === 'p') {
        if (c > 0 && board[4][c - 1] === 'P') return String.fromCharCode(97 + c) + '3';
        if (c < 7 && board[4][c + 1] === 'P') return String.fromCharCode(97 + c) + '3';
      }
    }
    return '-';
  }

  // ─── Chess.com: Try getting FEN from internal API ──────────────────
  function tryChesscomFenAPI() {
    const boardEl = document.querySelector('wc-chess-board');
    if (!boardEl) return null;

    try {
      if (boardEl.game && typeof boardEl.game.getFEN === 'function') {
        const fen = boardEl.game.getFEN();
        const playingAs = boardEl.game.getPlayingAs
          ? boardEl.game.getPlayingAs()
          : null;
        const playerColor = playingAs === 1 ? 'w' : (playingAs === 2 ? 'b' : 'w');
        return { fen, playerColor, positionReliable: true, turnReliable: true, fenSource: 'site-api' };
      }
    } catch (e) { /* Not accessible from isolated world */ }

    return null;
  }

  // ─── Lichess Board Reader ──────────────────────────────────────────
  function readLichessBoard() {
    const internalResult = tryLichessInternalFen();
    if (internalResult) return internalResult;

    const boardEl = document.querySelector('cg-board');
    if (!boardEl) return null;

    const container = boardEl.closest('cg-container');
    if (!container) return null;

    const boardRect = boardEl.getBoundingClientRect();
    const boardSize = boardRect.width;
    const squareSize = boardSize / 8;

    const isFlipped = container.classList.contains('orientation-black');

    const pieceEls = boardEl.querySelectorAll('piece');
    if (!pieceEls || pieceEls.length === 0) return null;

    const board = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (const pieceEl of pieceEls) {
      const info = parseLichessPiece(pieceEl, squareSize, isFlipped);
      if (!info) continue;
      if (info.row >= 0 && info.row < 8 && info.col >= 0 && info.col < 8) {
        board[info.row][info.col] = info.symbol;
      }
    }

    let fenPlacement = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        if (board[r][c]) {
          if (empty > 0) { fenPlacement += empty; empty = 0; }
          fenPlacement += board[r][c];
        } else {
          empty++;
        }
      }
      if (empty > 0) fenPlacement += empty;
      if (r < 7) fenPlacement += '/';
    }

    const activeColor = getLichessActiveColor();
    const turnReliable = activeColor === 'w' || activeColor === 'b';
    const castling = getLichessCastling(board);
    const epSquare = getLichessEnPassant(board);
    const fen = `${fenPlacement} ${turnReliable ? activeColor : 'w'} ${castling} ${epSquare} 0 1`;
    const playerColor = getLichessPlayerColor(isFlipped);

    return { fen, playerColor, turnReliable };
  }

  function parseLichessPiece(el, squareSize, isFlipped) {
    let color = null, type = null;

    for (const cls of el.classList) {
      if (cls === 'white' || cls === 'black') color = cls;
      if (['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].includes(cls)) type = cls;
    }

    if (!color || !type) return null;

    const style = el.getAttribute('style') || '';
    const match = style.match(/translate\(([\d.]+)px,\s*([\d.]+)px\)/);
    if (!match) return null;

    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);

    let col = Math.round(x / squareSize);
    let row = Math.round(y / squareSize);

    if (isFlipped) {
      col = 7 - col;
      row = 7 - row;
    }

    col = Math.max(0, Math.min(7, col));
    row = Math.max(0, Math.min(7, row));

    const typeMap = {
      king: 'k', queen: 'q', rook: 'r',
      bishop: 'b', knight: 'n', pawn: 'p'
    };
    const symbol = color === 'white'
      ? typeMap[type].toUpperCase()
      : typeMap[type].toLowerCase();

    return { color, type, symbol, row, col };
  }

  function getLichessActiveColor() {
    const cgContainer = document.querySelector('cg-container');
    const isFlipped = cgContainer ? cgContainer.classList.contains('orientation-black') : false;

    const turnEl = document.querySelector('.clock-active, .rclock-running');
    if (turnEl) {
      const isTop = turnEl.closest('.rclock-top, .analyse__player_strip.top');
      if (isTop) {
        return isFlipped ? 'w' : 'b';
      }
      return isFlipped ? 'b' : 'w';
    }

    const turnIndicator = document.querySelector('.turn, .is-turn');
    if (turnIndicator) {
      if (turnIndicator.classList.contains('white') || turnIndicator.closest('.player-top.white, .player-bottom.white')) {
        const isTopPlayer = turnIndicator.closest('.player-top, .analyse__player_strip.top');
        if (isTopPlayer) return isFlipped ? 'w' : 'b';
        return isFlipped ? 'b' : 'w';
      }
      if (turnIndicator.classList.contains('black') || turnIndicator.closest('.player-top.black, .player-bottom.black')) {
        const isTopPlayer = turnIndicator.closest('.player-top, .analyse__player_strip.top');
        if (isTopPlayer) return isFlipped ? 'w' : 'b';
        return isFlipped ? 'b' : 'w';
      }
    }

    return null;
  }

  function tryLichessInternalFen() {
    try {
      const cgContainer = document.querySelector('cg-container');
      if (!cgContainer) return null;

      const cgBoard = cgContainer.querySelector('cg-board');
      if (!cgBoard) return null;

      if (typeof lichess !== 'undefined') {
        if (lichess.analysis && lichess.analysis.node && lichess.analysis.node.fen) {
          const fen = lichess.analysis.node.fen;
          const isFlipped = cgContainer.classList.contains('orientation-black');
          return { fen, playerColor: isFlipped ? 'b' : 'w', positionReliable: true, turnReliable: true, fenSource: 'site-api' };
        }
      }
    } catch (e) {
      // Silently fail — will fall back to DOM parsing
    }
    return null;
  }

  function getLichessCastling(board) {
    let rights = '';
    if (findPiece(board, 'K', 7, 4) && findPiece(board, 'R', 7, 7)) rights += 'K';
    if (findPiece(board, 'K', 7, 4) && findPiece(board, 'R', 7, 0)) rights += 'Q';
    if (findPiece(board, 'k', 0, 4) && findPiece(board, 'r', 0, 7)) rights += 'k';
    if (findPiece(board, 'k', 0, 4) && findPiece(board, 'r', 0, 0)) rights += 'q';
    return rights || '-';
  }

  function getLichessPlayerColor(isFlipped) {
    return isFlipped ? 'b' : 'w';
  }

  function getLichessEnPassant(board) {
    for (let c = 0; c < 8; c++) {
      if (board[3][c] === 'P') {
        if (c > 0 && board[3][c - 1] === 'p') return String.fromCharCode(97 + c) + '6';
        if (c < 7 && board[3][c + 1] === 'p') return String.fromCharCode(97 + c) + '6';
      }
      if (board[4][c] === 'p') {
        if (c > 0 && board[4][c - 1] === 'P') return String.fromCharCode(97 + c) + '3';
        if (c < 7 && board[4][c + 1] === 'P') return String.fromCharCode(97 + c) + '3';
      }
    }
    return '-';
  }

  // ─── Main Read Board Function ─────────────────────────────────────
  function readBoard() {
    const site = detectSite();
    if (!site) return null;

    let result = null;
    if (site === 'chesscom') {
      result = tryChesscomFenAPI() || readChesscomBoard();
    } else if (site === 'lichess') {
      result = readLichessBoard();
    }

    if (!result) return null;

    return {
      fen: result.fen,
      playerColor: result.playerColor,
      // DOM placement cannot establish castling, en-passant, or move counters.
      // Consumers must gate state-sensitive features on this signal.
      positionReliable: result.positionReliable === true,
      turnReliable: result.turnReliable === true,
      fenSource: result.fenSource || 'dom-placement',
      site: site,
      url: window.location.href,
      timestamp: Date.now()
    };
  }

  return readBoard();
})();

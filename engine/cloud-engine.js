/**
 * Chess Hint Assistant — Cloud Engine
 *
 * Cloud Provider Metadata
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 * This project is a study/research tool for building a chess engine that can
 * play in a variety of styles (normal, aggressive, ultra-aggressive). It is
 * intended for learning, offline analysis, and engine-variation research. It
 * is anti-cheat compliant and fair-play safe: it never assists a player in a
 * rated or live online game, and it must not be used to gain an unfair
 * advantage against human opponents.
 *
 * NOTE: The actual API calls are made in background.js (service worker context).
 * This file provides the hint-engine with cloud API metadata and utilities.
 */

(function () {
  'use strict';

  // ─── Cloud API Metadata ──────────────────────────────────────────────
  const API_ENDPOINTS = {
    chessApi: {
      url: 'https://chess-api.com/v1',
      name: 'Chess-API.com',
      quality: 'Stockfish 18 NNUE (live, depth ~12-18)',
      latency: '~1-5s',
      multiPV: false,
      method: 'POST',
      alwaysEvaluates: true
    },
    lichessCloudEval: {
      url: 'https://lichess.org/api/cloud-eval',
      name: 'Lichess Cloud Eval',
      quality: 'Cached depth 40-75+ (deepest when available)',
      latency: '~1-3s (if cached)',
      multiPV: true,
      method: 'GET',
      alwaysEvaluates: false
    },
    lichessMastersExplorer: {
      url: 'https://explorer.lichess.ovh/master',
      name: 'Lichess Masters Explorer',
      quality: 'Human grandmaster game statistics (natural moves)',
      latency: '~0.5-2s',
      multiPV: true,
      method: 'GET',
      alwaysEvaluates: false,
      isHumanSource: true
    },
    lichessOpeningExplorer: {
      url: 'https://explorer.lichess.ovh/lichess',
      name: 'Lichess Opening Explorer',
      quality: 'Player game statistics',
      latency: '~1-2s',
      multiPV: false,
      method: 'GET'
    },
    lichessTablebase: {
      url: 'https://tablebase.lichess.ovh/standard',
      name: 'Lichess Tablebase',
      quality: 'Perfect play (<=7 pieces)',
      latency: '~0.5-1s',
      multiPV: false,
      method: 'GET'
    }
  };

  // ─── Source Labels for UI ────────────────────────────────────────────
  const SOURCE_LABELS = {
    'chess-api': { label: 'Chess-API.com', badge: 'ENGINE', quality: 'Deep engine' },
    'lichess-cloud': { label: 'Lichess Cloud', badge: 'CLOUD', quality: 'Cloud cached' },
    'masters-explorer': { label: 'Masters DB', badge: 'BOOK', quality: 'Opening statistics' },
    'opening-explorer': { label: 'Opening Explorer', badge: 'BOOK', quality: 'Opening statistics' },
    'local-engine': { label: 'Local engine', badge: 'LOCAL', quality: 'Local engine' },
    'tablebase': { label: 'Tablebase', badge: 'TB', quality: 'Perfect' }
  };

  // ─── Source Quality Ranking ──────────────────────────────────────────
  function getSourceRank(source) {
    const ranks = {
      'tablebase': 5,
      'lichess-cloud': 4,
      'chess-api': 3,
      'masters-explorer': 2  // Human source, lower engine rank but higher "naturalness"
    };
    return ranks[source] || 0;
  }

  function getSourceInfo(source) {
    return SOURCE_LABELS[source] || { label: source, badge: 'CLOUD', quality: 'Unknown' };
  }

  // ─── Public API ──────────────────────────────────────────────────────
  window.ChessCloudEngine = {
    API_ENDPOINTS,
    SOURCE_LABELS,
    getSourceRank,
    getSourceInfo
  };

})();

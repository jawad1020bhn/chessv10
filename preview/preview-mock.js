/**
 * DEV PREVIEW ONLY — not shipped in the extension.
 *
 * Stubs the chrome.* runtime with canned position + analysis data so the
 * real sidepanel.js runs end-to-end in a plain browser tab. Every message
 * sidepanel.js sends is answered locally; no network requests are made.
 */
(function () {
  'use strict';

  const listeners = [];
  const store = {};

  // Scholar's mate net: White to move, Qxf7# available. Interesting because
  // it exercises mate text, a from→to lockup, multi-PV style re-ranking,
  // and (in aggressive styles) the idea/cost/risk caption rail.
  const PREVIEW_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

  function mockAnalysis(fen) {
    return {
      fen,
      source: 'lichess-cloud',
      depth: 22,
      stale: false,
      confidence: 0.93,
      qualityClass: 'deep-engine',
      openingData: { opening: "Scholar's Mate Attack" },
      moveHistory: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'],
      pvs: [
        { score: 1, scoreType: 'mate', depth: 24, pv: ['h5f7'] },
        { score: 320, scoreType: 'cp', depth: 22, pv: ['h5g6'] },
        { score: 40, scoreType: 'cp', depth: 21, pv: ['b1c3'] }
      ]
    };
  }

  function dispatch(message) {
    listeners.forEach((fn) => { try { fn(message, {}, () => {}); } catch (e) { console.error(e); } });
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function route(message) {
    switch (message && message.type) {
      case 'read_board':
        // ?noboard freezes the pre-game state so the hero welcome can be
        // inspected in isolation.
        if (new URLSearchParams(location.search).has('noboard')) return {};
        return {
          fen: PREVIEW_FEN,
          tabId: 'preview',
          playerColor: 'w',
          positionReliable: true,
          turnReliable: true,
          fenSource: 'site-verified',
          site: 'preview',
          url: 'about:blank',
          timestamp: Date.now()
        };
      case 'request_analysis':
        // Simulate provider latency, then push an analysis_update like background.js does
        await delay(600);
        const fen = message.fen || PREVIEW_FEN;
        // A quieter first snapshot, then the mate net — the swing from
        // +0.4 to mate-in-1 classifies as a Blunder (the last move was
        // Black's Nf6, which allowed Qxf7#), and the Balance tile leans
        // "you" with a +M1 headline. Both Expressive states demo at once.
        // The quiet pass carries a near-best alternative so the
        // "Also consider" rail demos too (it rightly hides once a mate
        // exists — nothing shares its value).
        dispatch({
          type: 'analysis_update',
          data: {
            ...mockAnalysis(fen),
            pvs: [
              { score: 40, scoreType: 'cp', depth: 18, pv: ['b1c3'] },
              { score: 34, scoreType: 'cp', depth: 18, pv: ['d2d3'] },
              { score: 28, scoreType: 'cp', depth: 17, pv: ['c1e3'] }
            ]
          }
        });
        await delay(480);
        // Append ?hold to freeze the quiet pass (alternatives visible,
        // no mate yet) — handy for inspecting that state in isolation.
        if (!new URLSearchParams(location.search).has('hold')) {
          dispatch({ type: 'analysis_update', data: mockAnalysis(fen) });
        }
        return null;
      case 'health_check':
        return {};
      case 'get_correlation_stats':
        return { matches: 3, total: 5 };
      case 'record_player_move':
        return { matched: true };
      case 'panel_state':
      case 'player_color_changed':
      case 'reset_correlation':
      case 'clear_caches':
      case 'record_human_recommendation':
        return null;
      default:
        return null;
    }
  }

  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (value) => value,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (message, callback) => {
        const promise = route(message);
        if (typeof callback === 'function') {
          promise.then((value) => callback(value));
          return undefined;
        }
        return promise;
      }
    },
    storage: {
      local: {
        get: (key, callback) => {
          const result = {};
          if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
          callback(result);
        },
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); }
      }
    }
  };
})();

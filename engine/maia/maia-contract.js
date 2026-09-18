/*
 * Maia-3 analysis contract.
 *
 * Maia returns a learned human-move policy, not an objective chess score. This
 * module intentionally does not share AnalysisContract.finalizeAnalysis's
 * centipawn/PV schema.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'maia-analysis/v1';
  const ENGINE_ID = 'maia3';
  const SOURCE = 'maia3-local';
  const RATING_MIN = 600;
  const RATING_MAX = 2600;
  const RATING_DEFAULT = 1500;
  const HINT_COUNTS = Object.freeze([1, 3, 5]);
  const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  // These belong to objective engine semantics. Reject rather than silently
  // carrying them across the worker boundary and risking a policy result being
  // rendered as an evaluation/PV in a future UI change.
  const OBJECTIVE_ONLY_FIELDS = Object.freeze(['score', 'scoreType', 'depth', 'mate', 'pvs', 'pv', 'bestMove', 'evaluation']);

  function clamp(value, min, max, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function normalizeRating(value, fallback = RATING_DEFAULT) {
    return clamp(value, RATING_MIN, RATING_MAX, fallback);
  }

  function normalizeHintCount(value, fallback = 3) {
    const parsed = Number(value);
    return HINT_COUNTS.includes(parsed) ? parsed : fallback;
  }

  function normalizeEngine(value) {
    return value === ENGINE_ID ? ENGINE_ID : 'objective';
  }

  function normalizeSettings(raw = {}, manifest) {
    const modelId = manifest && typeof manifest.has === 'function' && manifest.has(raw.maiaModelId)
      ? raw.maiaModelId
      : (manifest?.DEFAULT_MODEL_ID || raw.maiaModelId || 'maia3-browser-fp16');
    const linked = raw.maiaLinkRatings !== false;
    const sideToMoveElo = normalizeRating(raw.maiaSideToMoveElo);
    return {
      analysisEngine: normalizeEngine(raw.analysisEngine),
      maiaModelId: modelId,
      maiaSideToMoveElo: sideToMoveElo,
      maiaOpponentElo: linked
        ? sideToMoveElo
        : normalizeRating(raw.maiaOpponentElo),
      maiaLinkRatings: linked,
      maiaHintCount: normalizeHintCount(raw.maiaHintCount),
      maiaShowHumanOutcome: raw.maiaShowHumanOutcome !== false,
      maiaAutoAnalyze: raw.maiaAutoAnalyze === true
    };
  }

  function canonicalFenKey(fen) {
    const fields = String(fen || '').trim().split(/\s+/);
    return fields.length >= 4 ? fields.slice(0, 4).join(' ') : '';
  }

  function legalApi() {
    return root.AnalysisContract || null;
  }

  function isCompleteFen(fen) {
    return Boolean(root.ChessCore?.parseFen?.(fen));
  }

  function normalizeOutcome(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const win = Number(raw.win);
    const draw = Number(raw.draw);
    const loss = Number(raw.loss);
    if (![win, draw, loss].every(Number.isFinite)) return null;
    if (win < 0 || draw < 0 || loss < 0) return null;
    const total = win + draw + loss;
    if (!(total > 0)) return null;
    return {
      enabled: raw.enabled !== false,
      scope: raw.scope === 'after-candidate' ? 'after-candidate' : 'current-position',
      perspective: raw.perspective === 'white' ? 'white' : 'side-to-move',
      win: win / total,
      draw: draw / total,
      loss: loss / total
    };
  }

  function validateMoves(fen, rawMoves, limit) {
    const api = legalApi();
    if (!api || typeof api.isLegalMove !== 'function') return { ok: false, reason: 'legality_unavailable', moves: [] };
    if (!Array.isArray(rawMoves) || rawMoves.length === 0) return { ok: false, reason: 'no_legal_policy_moves', moves: [] };
    const accepted = [];
    const seen = new Set();
    let previousProbability = Infinity;
    for (const raw of rawMoves) {
      if (accepted.length >= limit) break;
      const uci = String(raw?.uci || '').toLowerCase();
      const probability = Number(raw?.probability);
      if (!UCI.test(uci) || seen.has(uci) || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        return { ok: false, reason: 'invalid_policy_move', moves: [] };
      }
      if (probability > previousProbability + 1e-10 || !api.isLegalMove(fen, uci)) {
        return { ok: false, reason: probability > previousProbability ? 'unsorted_policy' : 'illegal_policy_move', moves: [] };
      }
      previousProbability = probability;
      seen.add(uci);
      accepted.push({
        rank: accepted.length + 1,
        uci,
        probability
      });
    }
    return accepted.length ? { ok: true, reason: '', moves: accepted } : { ok: false, reason: 'no_legal_policy_moves', moves: [] };
  }

  function makeError(fen, code, message, extras = {}) {
    return {
      kind: SCHEMA,
      engineId: ENGINE_ID,
      source: SOURCE,
      fen: String(fen || ''),
      positionKey: canonicalFenKey(fen),
      error: true,
      errorDetail: {
        code: String(code || 'maia_unavailable'),
        message: String(message || 'Maia-3 is unavailable.'),
        suggestion: extras.suggestion || 'retry'
      },
      model: extras.model || null,
      timestamp: Date.now()
    };
  }

  function buildAnalysis(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const fen = String(raw.fen || '');
    if (!isCompleteFen(fen)) return makeError(fen, 'invalid_fen', 'Maia-3 needs a complete, verified FEN.', { suggestion: 'wait' });
    const forbidden = OBJECTIVE_ONLY_FIELDS.find(field => Object.hasOwn(raw, field));
    if (forbidden) {
      return makeError(fen, 'objective_field_not_allowed', `Maia-3 policy results cannot contain '${forbidden}'.`, { suggestion: 'retry' });
    }
    const context = raw.ratingContext || {};
    const model = raw.model || {};
    const hintCount = normalizeHintCount(raw.hintCount || raw.moves?.length || 3);
    const validated = validateMoves(fen, raw.moves, hintCount);
    if (!validated.ok) return makeError(fen, validated.reason, 'Maia-3 returned an unusable move policy.', { model, suggestion: 'retry' });
    const history = raw.history && typeof raw.history === 'object'
      ? {
          mode: raw.history.mode || 'current-position-model',
          stateCount: Math.max(1, Number(raw.history.stateCount) || 1),
          detail: raw.history.detail || ''
        }
      : { mode: 'current-position-model', stateCount: 1, detail: '' };
    const sideToMoveElo = normalizeRating(context.sideToMoveElo);
    const linkedRatings = context.linkedRatings !== false;
    const opponentElo = linkedRatings
      ? sideToMoveElo
      : normalizeRating(context.opponentElo);
    const outcome = raw.showHumanOutcome === false ? null : normalizeOutcome(raw.humanOutcome);
    const analysis = {
      kind: SCHEMA,
      engineId: ENGINE_ID,
      source: SOURCE,
      fen,
      positionKey: canonicalFenKey(fen),
      requestId: String(raw.requestId || ''),
      timestamp: Number(raw.timestamp) || Date.now(),
      elapsedMs: Math.max(0, Number(raw.elapsedMs) || 0),
      model: {
        id: String(model.id || ''),
        displayName: String(model.displayName || 'Maia-3'),
        artifactVersion: String(model.artifactVersion || ''),
        sourceRevision: String(model.sourceRevision || ''),
        sha256: String(model.sha256 || '')
      },
      ratingContext: {
        sideToMoveElo,
        opponentElo,
        scale: 'lichess-blitz',
        linkedRatings
      },
      history,
      topMove: validated.moves[0],
      moves: validated.moves,
      humanOutcome: outcome,
      status: 'ready',
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(value => String(value)).slice(0, 8) : []
    };
    return analysis;
  }

  function validateMaiaAnalysis(raw = {}) {
    const data = buildAnalysis(raw);
    return data.error ? { ok: false, error: data } : { ok: true, data };
  }

  const exported = Object.freeze({
    SCHEMA,
    ENGINE_ID,
    SOURCE,
    RATING_MIN,
    RATING_MAX,
    RATING_DEFAULT,
    HINT_COUNTS,
    OBJECTIVE_ONLY_FIELDS,
    normalizeRating,
    normalizeHintCount,
    normalizeEngine,
    normalizeSettings,
    canonicalFenKey,
    normalizeOutcome,
    validateMoves,
    validateMaiaAnalysis,
    buildAnalysis,
    makeError
  });

  root.MaiaContract = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

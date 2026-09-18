/*
 * Analysis quality, MultiPV, ensemble rules, and user-facing quality labels.
 * Settings describe goals. This module maps them onto provider-specific work.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 */
(function (root) {
  'use strict';

  const QUALITY_IDS = Object.freeze(['auto', 'fast', 'balanced', 'deep']);
  const CANDIDATE_IDS = Object.freeze(['auto', 3, 5]);
  const MAX_PROVIDER_LINES = 5;

  const QUALITY_PROFILES = Object.freeze({
    fast: {
      id: 'fast',
      label: 'Fast',
      chessApiDepth: 8,
      chessApiTimeMs: 50,
      localDepth: 3,
      localTimeMs: 80,
      preferLocalBeforeCloud: false,
      preferLocalOnHumanSource: true
    },
    balanced: {
      id: 'balanced',
      label: 'Balanced',
      chessApiDepth: 12,
      chessApiTimeMs: 100,
      localDepth: 5,
      localTimeMs: 220,
      preferLocalBeforeCloud: false,
      preferLocalOnHumanSource: true
    },
    deep: {
      id: 'deep',
      label: 'Deep',
      chessApiDepth: 18,
      chessApiTimeMs: 160,
      localDepth: 6,
      localTimeMs: 450,
      preferLocalBeforeCloud: false,
      preferLocalOnHumanSource: true
    },
    auto: {
      id: 'auto',
      label: 'Auto',
      chessApiDepth: 12,
      chessApiTimeMs: 100,
      localDepth: 4,
      localTimeMs: 180,
      preferLocalBeforeCloud: false,
      preferLocalOnHumanSource: true
    }
  });

  function normalizeQuality(value) {
    return QUALITY_IDS.includes(value) ? value : 'auto';
  }

  function normalizeCandidateLines(value) {
    if (value === 3 || value === 5 || value === '3' || value === '5') return Number(value);
    return 'auto';
  }

  function migrateLegacySettings(raw = {}) {
    const next = { ...raw };
    if (next.analysisQuality == null && next.depthTarget != null) {
      const depth = Number(next.depthTarget);
      if (depth >= 30) next.analysisQuality = 'deep';
      else if (depth >= 20) next.analysisQuality = 'balanced';
      else if (depth >= 15) next.analysisQuality = 'fast';
      else next.analysisQuality = 'auto';
    }
    if (next.candidateLines == null && next.cloudDepth != null) {
      const lines = Number(next.cloudDepth);
      if (lines >= 5) next.candidateLines = 5;
      else if (lines >= 3) next.candidateLines = 3;
      else next.candidateLines = 'auto';
    }
    delete next.depthTarget;
    delete next.cloudDepth;
    delete next.whiteRepertoire;
    delete next.blackRepertoire;
    delete next.repertoire;
    next.analysisQuality = normalizeQuality(next.analysisQuality);
    next.candidateLines = normalizeCandidateLines(next.candidateLines);
    return next;
  }

  function resolveQuality(settings = {}, extras = {}) {
    const requested = normalizeQuality(settings.analysisQuality);
    if (requested !== 'auto') return QUALITY_PROFILES[requested];
    // Offline sparring realism: a club-strength human calculates at one steady
    // depth regardless of how aggressive they feel, so in "play human" Auto
    // mode we hold the balanced profile and cancel the ultra-style escalation.
    // Consistent (not occasionally superhuman) calculation is what reads as
    // human. Explicit Fast/Deep choices are still honored above.
    if (settings.humanLikeMode === true) return QUALITY_PROFILES.balanced;
    if (extras.earlyKingHunt || settings.style === 'super_ultra_aggressive') {
      return { ...QUALITY_PROFILES.auto, chessApiDepth: 14, localDepth: 5, localTimeMs: 240 };
    }
    return QUALITY_PROFILES.auto;
  }

  function resolveMultiPv(settings = {}, extras = {}) {
    const requested = normalizeCandidateLines(settings.candidateLines);
    if (requested === 3 || requested === 5) return requested;
    // Offline sparring realism: in "play human" mode the form model's
    // shortlist/slip selection needs a wide candidate pool, so auto width is
    // always maximum MultiPV. An explicit user choice still wins.
    if (settings.humanLikeMode === true) return MAX_PROVIDER_LINES;
    if (extras.earlyKingHunt || settings.style === 'super_ultra_aggressive') return 5;
    if (settings.style === 'aggressive') return 3;
    return 2;
  }

  function clampProviderLines(multiPv) {
    return Math.max(1, Math.min(MAX_PROVIDER_LINES, Number(multiPv) || 2));
  }

  function qualityClassFor(result = {}, extras = {}) {
    if (!result || result.error) return 'unavailable';
    if (extras.positionReliable === false) return 'unreliable';
    if (result.source === 'tablebase') return 'perfect';
    if (result.stale) return 'stale-fallback';
    if (result.source === 'masters-explorer' || result.source === 'opening-explorer') return 'opening-statistics';
    if (result.source === 'local-engine') {
      return (result.depth || 0) >= 5 ? 'local-engine' : 'shallow-engine';
    }
    if (result.source === 'lichess-cloud' || result.source === 'chess-api') {
      if (result.cached && !result.stale && (result.depth || 0) >= 20) return 'cloud-cached';
      if ((result.depth || 0) >= 18) return 'deep-engine';
      if ((result.depth || 0) > 0 && (result.depth || 0) < 12) return 'shallow-engine';
      return result.cached ? 'cloud-cached' : 'deep-engine';
    }
    return 'unknown';
  }

  const QUALITY_LABELS = Object.freeze({
    perfect: { id: 'perfect', label: 'Perfect', badge: 'TB', detail: 'Tablebase, exact play' },
    'deep-engine': { id: 'deep-engine', label: 'Deep engine', badge: 'ENGINE', detail: 'Live engine evaluation' },
    'cloud-cached': { id: 'cloud-cached', label: 'Cloud cached', badge: 'CLOUD', detail: 'Fresh cached engine evaluation' },
    'local-engine': { id: 'local-engine', label: 'Local engine', badge: 'LOCAL', detail: 'On-device search fallback' },
    'shallow-engine': { id: 'shallow-engine', label: 'Shallow engine', badge: 'SHALLOW', detail: 'Limited depth, use with care' },
    'opening-statistics': { id: 'opening-statistics', label: 'Opening statistics', badge: 'BOOK', detail: 'Human game frequency, not an engine eval' },
    'stale-fallback': { id: 'stale-fallback', label: 'Stale fallback', badge: 'STALE', detail: 'Older cached result while providers are unavailable' },
    unreliable: { id: 'unreliable', label: 'Unverified position', badge: 'WAIT', detail: 'Board snapshot is incomplete' },
    unavailable: { id: 'unavailable', label: 'Unavailable', badge: '—', detail: 'No usable analysis yet' },
    unknown: { id: 'unknown', label: 'Unknown', badge: '—', detail: 'Source not classified' }
  });

  function describeQuality(qualityClass) {
    return QUALITY_LABELS[qualityClass] || QUALITY_LABELS.unknown;
  }

  function isHumanSource(source) {
    return source === 'masters-explorer' || source === 'opening-explorer';
  }

  function isEngineSource(source) {
    return source === 'chess-api' || source === 'lichess-cloud' || source === 'local-engine';
  }

  function shouldReplaceHumanWithEngine(result, fen, settings = {}) {
    if (!result || !isHumanSource(result.source)) return false;
    // Offline sparring realism: in "play human" mode, human-game statistics
    // remain a legitimate selection signal well past the opening, so the
    // engine-override that normally discards human data after move ~10 is
    // deferred to the extended sparring range instead.
    if (settings.humanLikeMode === true) {
      const fullmove = Number(String(fen || '').split(' ')[5]) || 1;
      return fullmove > 18 || countPiecesForRange(fen) < 20;
    }
    const reliability = root.ApiReliability;
    if (reliability && typeof reliability.isPlausibleOpeningFen === 'function') {
      return !reliability.isPlausibleOpeningFen(fen);
    }
    const fullmove = Number(String(fen || '').split(' ')[5]) || 1;
    return fullmove > 10 || settings.style === 'super_ultra_aggressive';
  }

  function countPiecesForRange(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    let count = 0;
    for (const character of placement) if (/[prnbqkPRNBQK]/.test(character)) count++;
    return count;
  }

  // Extended sparring range check used by background routing.
  function isSparringRangeFen(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    const fullmove = Number(parts[5]) || 1;
    return fullmove <= 18 && countPiecesForRange(fen) >= 20;
  }

  function attachQuality(result, extras = {}) {
    if (!result || result.error) return result;
    const qualityClass = extras.qualityClass || qualityClassFor(result, extras);
    const meta = describeQuality(qualityClass);
    result.qualityClass = qualityClass;
    result.qualityLabel = meta.label;
    result.qualityDetail = meta.detail;
    result.qualityBadge = meta.badge;
    return result;
  }

  function chessApiRequestParams(profile, multiPv) {
    return {
      depth: profile.chessApiDepth,
      maxThinkingTime: profile.chessApiTimeMs,
      variants: clampProviderLines(multiPv)
    };
  }

  const exported = {
    QUALITY_IDS,
    CANDIDATE_IDS,
    QUALITY_PROFILES,
    QUALITY_LABELS,
    MAX_PROVIDER_LINES,
    normalizeQuality,
    normalizeCandidateLines,
    migrateLegacySettings,
    resolveQuality,
    resolveMultiPv,
    clampProviderLines,
    qualityClassFor,
    describeQuality,
    isHumanSource,
    isEngineSource,
    shouldReplaceHumanWithEngine,
    isSparringRangeFen,
    attachQuality,
    chessApiRequestParams
  };
  root.AnalysisPolicy = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Human Form Model — rating-calibrated sparring realism.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 * This project is a study/research tool for building a chess engine that can
 * play in a variety of styles (normal, aggressive, ultra-aggressive). It is
 * intended for learning, offline analysis, and engine-variation research. It
 * is anti-cheat compliant and fair-play safe: it never assists a player in a
 * rated or live online game, and it must not be used to gain an unfair
 * advantage against human opponents.
 *
 * Purpose: an offline sparring partner must behave like a REAL player of the
 * chosen strength, because you cannot learn to defend sharp attacking play
 * against an opponent whose accuracy never wavers. This module models how a
 * club-strength human actually plays:
 *
 *   1. FORM      — a sticky per-session "good day / bad day" value that drifts
 *                  the whole personality looser or tighter.
 *   2. RATING    — a strength slider (600–1600). Lower strengths keep a wider
 *                  pool of acceptable moves and take more harmless slips.
 *   3. RELAXATION— real players stop calculating precisely when clearly
 *                  winning; the model mirrors that score-based effect.
 *
 * Hard safety is NOT modeled here and cannot be overridden here: mate
 * preservation, own-king-trap vetoes, and risk budgets all live in
 * hint-engine.js (styleSafetyAllows) and run AFTER this module narrows the
 * choice pool. Every parameter this module emits only ever widens or narrows
 * the shortlist of ALREADY-safe candidates.
 *
 * Everything is deterministic given (session seed, fen): the same position in
 * the same session always yields the same parameters, so hints never flicker.
 *
 * Script-loading mirrors chaos-attack.js / early-king-hunt.js (classic global,
 * UMD-friendly) and CommonJS-export for the vm test harness.
 */
(function (root) {
  'use strict';

  const RATING_MIN = 600;
  const RATING_MAX = 1600;
  const RATING_DEFAULT = 1100;

  // Strength anchors. Interpolated linearly between adjacent rows.
  //   marginScale     — scales the style shortlist margin (how many near-best
  //                     candidates stay "in character").
  //   naturalnessScale— weight of human-naturalness vs raw style score.
  //   slipChance      — probability (per position, deterministic) of choosing a
  //                     slightly worse-but-safe candidate from the shortlist.
  //   slipLossCeiling — hard cap, in centipawns of eval loss, for any slipped
  //                     candidate. Never large enough to matter tactically.
  const ANCHORS = [
    { rating: 600,  marginScale: 1.45, naturalnessScale: 1.25, slipChance: 0.38, slipLossCeiling: 128 },
    { rating: 900,  marginScale: 1.20, naturalnessScale: 1.12, slipChance: 0.28, slipLossCeiling: 112 },
    { rating: 1100, marginScale: 1.00, naturalnessScale: 1.00, slipChance: 0.20, slipLossCeiling: 100 },
    { rating: 1300, marginScale: 0.85, naturalnessScale: 0.90, slipChance: 0.13, slipLossCeiling: 88 },
    { rating: 1600, marginScale: 0.70, naturalnessScale: 0.80, slipChance: 0.07, slipLossCeiling: 72 }
  ];

  function normalizeRating(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return RATING_DEFAULT;
    return Math.min(RATING_MAX, Math.max(RATING_MIN, n));
  }

  function interpolate(rating) {
    const r = normalizeRating(rating);
    if (r <= ANCHORS[0].rating) return { ...ANCHORS[0] };
    if (r >= ANCHORS[ANCHORS.length - 1].rating) return { ...ANCHORS[ANCHORS.length - 1] };
    for (let i = 0; i < ANCHORS.length - 1; i++) {
      const low = ANCHORS[i];
      const high = ANCHORS[i + 1];
      if (r >= low.rating && r <= high.rating) {
        const t = (r - low.rating) / (high.rating - low.rating);
        return {
          rating: r,
          marginScale: low.marginScale + t * (high.marginScale - low.marginScale),
          naturalnessScale: low.naturalnessScale + t * (high.naturalnessScale - low.naturalnessScale),
          slipChance: low.slipChance + t * (high.slipChance - low.slipChance),
          slipLossCeiling: low.slipLossCeiling + t * (high.slipLossCeiling - low.slipLossCeiling)
        };
      }
    }
    return { ...ANCHORS[1] };
  }

  // Stable string hash -> [0,1). Same construction as hint-engine's
  // stableFenFraction so both modules agree on determinism semantics.
  function stableFraction(text, salt = '') {
    let hash = 2166136261;
    for (const ch of `${text}|${salt}`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  // Approximate standard normal from three uniform draws, clamped to [-1, 1].
  function softNormal(text, salt) {
    const u = stableFraction(text, salt) + stableFraction(text, salt + '#2') +
      stableFraction(text, salt + '#3');
    return Math.max(-1, Math.min(1, (u - 1.5) / 1.5));
  }

  function createSession(options = {}) {
    const rating = normalizeRating(options.rating);
    const seed = String(options.seed ||
      `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`);
    // Sticky form for this session: one good/bad-day draw, reused everywhere.
    const form = softNormal(seed, 'form');
    return { rating, seed, form };
  }

  /**
   * Selection parameters for one position.
   * @param {object} session  from createSession()
   * @param {string} fen      current position (determinism key)
   * @param {number} evalCp   evaluation from the SPARRING PLAYER's perspective
   */
  function paramsFor(session, fen, evalCp = 0) {
    if (!session) return null;
    const base = interpolate(session.rating);
    const evalValue = Number.isFinite(Number(evalCp)) ? Number(evalCp) : 0;

    // 1) Session form shifts the whole personality.
    let marginScale = base.marginScale * (1 + session.form * 0.12);
    let slipChance = base.slipChance * Math.max(0.5, Math.min(1.5, 1 - session.form * 0.3));

    // 2) Winning relaxation: humans stop calculating precisely when the game
    //    is clearly theirs. Score-based only — no external signals.
    const WIN_THRESHOLD = 250;
    const WIN_FULL = 1050;
    if (evalValue > WIN_THRESHOLD) {
      const relax = Math.min(1, (evalValue - WIN_THRESHOLD) / (WIN_FULL - WIN_THRESHOLD));
      marginScale *= 1 + 0.6 * relax;
      slipChance *= 1 + 0.5 * relax;
    } else if (evalValue < -150) {
      // Slightly tighter when worse — weaker players tighten up when losing.
      marginScale *= 0.92;
    }

    // 3) Per-position micro-drift keeps consecutive decisions from feeling
    //    machine-uniform, while staying deterministic per position.
    const microDrift = softNormal(String(fen || ''), session.seed + '|drift') * 0.06;

    return {
      rating: session.rating,
      form: Number(session.form.toFixed(3)),
      marginScale: Number((marginScale + microDrift).toFixed(4)),
      naturalnessScale: base.naturalnessScale,
      slipChance: Number(Math.min(0.55, slipChance).toFixed(4)),
      slipLossCeiling: Math.round(base.slipLossCeiling)
    };
  }

  const exported = {
    RATING_MIN,
    RATING_MAX,
    RATING_DEFAULT,
    ANCHORS,
    normalizeRating,
    calibrate: interpolate,
    createSession,
    paramsFor
  };

  root.HumanForm = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

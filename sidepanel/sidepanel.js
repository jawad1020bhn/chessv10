/**
 * Chess Hint Assistant — Side Panel Controller
 * Turn-Based Analysis Engine with cloud providers and a local fallback.
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

  // ─── State ─────────────────────────────────────────────────────────
  let currentFen = null;
  let lastPositionFen = null;
  let lastAnalyzedFen = null;
  let playerColor = null;          // Auto-detected from board orientation
  let assistedPlayerColor = null;  // User-selected: which player to assist (null = not yet set)
  let activeTabId = 'active';       // Included in position-generation tokens
  let positionReliable = false;     // True only when the site supplied a complete FEN
  let turnReliable = false;         // True only when the site supplied an active color
  const EXACT_HINT_LEVEL = 5;
  let lastAnalysis = null;
  let prevEval = null;
  let prevScoreType = 'cp';
  let evalHistory = [];
  let lastCriticalAlert = null;
  let isRefreshing = false;
  let refreshSafetyTimer = null;
  let humanPlanState = null;

  const normalizeStyle = (style) => {
    if (style === 'normal' || style === 'aggressive' || style === 'super_ultra_aggressive') return style;
    return ['super_aggressive', 'ultra_aggressive_stealth', 'kamikaze', 'berserker'].includes(style)
      ? 'super_ultra_aggressive'
      : 'normal';
  };

  let settings = {
    analysisQuality: 'auto',
    candidateLines: 'auto',
    style: 'normal',
    // Kept as a style-scoped preference. The engine activates it only when
    // style === 'super_ultra_aggressive'; other styles ignore it completely.
    earlyKingHuntEnabled: false,
    humanLikeMode: false,
    sparringStrength: 1100,
    autoAnalyze: true,
    showThreats: true,
    showCriticalMoments: true,
    // Still gate background fetching that feeds the coach tab (opening name,
    // tablebase-backed winning plans); the explore UI is gone.
    showOpeningExplorer: true,
    showTablebase: true,
    useChessApi: true,
    useLichessCloud: true,
    useMastersExplorer: true
  };

  const STYLE_DESCRIPTIONS = {
    normal: 'Objective best play, reliable conversion, and solid defense. This is the engine\'s strongest recommendation with no style bias.',
    aggressive: 'Win as fast as possible through sound, forcing play. Push the initiative and keep pressure on the enemy king without throwing material away.',
    super_ultra_aggressive: 'Fearless, organized attack: build up soundly, then break through with checks, pawn storms, forks, pins and bold sacrifices to finish fast against <=1100 opponents.'
  };

  function updateStyleDescription() {
    const el = $('#style-description');
    if (!el) return;
    el.textContent = STYLE_DESCRIPTIONS[settings.style] || STYLE_DESCRIPTIONS.normal;
  }

  function isEarlyKingHuntActive() {
    return settings.style === 'super_ultra_aggressive' && settings.earlyKingHuntEnabled === true;
  }

  // The preference is preserved when the user changes style, but the control
  // is unavailable outside Ultra Super Aggressive and the engine receives a
  // true flag only through the exact style-scoped predicate above.
  function updateEarlyKingHuntUI() {
    const container = $('#early-king-hunt-setting');
    const checkbox = $('#setting-early-king-hunt');
    if (!container || !checkbox) return;
    const styleAllowsSetting = settings.style === 'super_ultra_aggressive';
    container.hidden = !styleAllowsSetting;
    container.setAttribute('aria-hidden', styleAllowsSetting ? 'false' : 'true');
    checkbox.disabled = !styleAllowsSetting;
    checkbox.checked = settings.earlyKingHuntEnabled === true;
  }

  // ─── DOM References ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const h = (value) => ChessCore.escapeHtml(value);
  const clamp = (value, min, max, fallback = min) => ChessCore.clampNumber(value, min, max, fallback);

  const dom = {
    engineStatus: $('#engine-status'),
    statusDot: $('.status-dot'),
    statusText: $('.status-text'),
    positionContext: $('#position-context'),
    positionTurn: $('#position-turn'),
    evalBarWhite: $('#eval-bar-white'),
    evalBar: $('#eval-bar'),
    evalSection: $('#eval-section'),
    evalBarWhitePct: $('#eval-bar-white-pct'),
    evalBarBlackPct: $('#eval-bar-black-pct'),
    evalStaleBadge: $('#eval-stale-badge'),
    evalWhiteLabel: $('#eval-white-label'),
    evalBlackLabel: $('#eval-black-label'),
    evalDescription: $('#eval-description'),
    openingName: $('#opening-name'),
    gamePhase: $('#game-phase'),
    analysisQuality: $('#analysis-quality'),
    materialBalance: $('#material-balance'),
    hintText: $('#hint-text'),
    hintFromTo: $('#hint-fromto'),
    heroWelcome: $('#hero-welcome'),
    ideaSection: $('#idea-section'),
    ideaList: $('#idea-list'),
    hintCard: $('#hint-card'),
    altsSection: $('#alts-section'),
    altsList: $('#alts-list'),
    evalSpark: $('#eval-sparkline'),
    moveClassSection: $('#move-class-section'),
    moveClassDisplay: $('#move-class-display'),
    settingsPanel: $('#settings-panel'),
    btnSettings: $('#btn-settings'),
    btnCloseSettings: $('#btn-close-settings'),
    btnRefresh: $('#btn-refresh'),
    btnHealthCheck: $('#btn-health-check'),
    btnClearCaches: $('#btn-clear-caches'),
    // Features
    playerSelector: $('#player-selector'),
    criticalMomentSection: $('#critical-moment-section'),
    criticalMomentText: $('#critical-moment-text'),
    criticalMomentDetail: $('#critical-moment-detail'),
    correlationStat: $('#correlation-stat')
  };

  // ─── Turn-Based State ──────────────────────────────────────────────
  let isPlayerTurn = true;             // Is it currently the assisted player's turn?
  let waitingForOpponent = false;      // Are we waiting for opponent to move?
  let turnJustChanged = false;         // Did the turn just change to the player?

  // Track player's actual moves vs engine recommendations.
  // We remember the FEN at the moment the engine returned its recommendation;
  // when the side panel later observes a new FEN where it's no longer the player's
  // turn (i.e. the player just moved), we infer the move and report it to background.
  let lastEngineRecommendationFen = null;
  let lastEngineRecommendationUci = null;

  // ─── Board Reading with Jitter ───────────────────────────────────
  let boardReadTimer = null;
  const READ_INTERVAL_MIN = 2000;
  const READ_INTERVAL_MAX = 5000;

  function startBoardReading() {
    if (boardReadTimer) return;
    readBoardFromBackground();
    scheduleNextRead();
  }

  function stopBoardReading() {
    if (boardReadTimer) {
      clearTimeout(boardReadTimer);
      boardReadTimer = null;
    }
  }

  function scheduleNextRead() {
    const delay = READ_INTERVAL_MIN + Math.random() * (READ_INTERVAL_MAX - READ_INTERVAL_MIN);
    boardReadTimer = setTimeout(async () => {
      await readBoardFromBackground();
      scheduleNextRead();
    }, delay);
  }

  async function readBoardFromBackground() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'read_board' });
      if (result && result.fen) {
        activeTabId = result.tabId ?? activeTabId;
        chrome.runtime.sendMessage({ type: 'panel_state', open: true, tabId: activeTabId }).catch(() => {});
        handlePositionUpdate({
          fen: result.fen,
          playerColor: result.playerColor,
          positionReliable: result.positionReliable === true,
          turnReliable: result.turnReliable === true,
          fenSource: result.fenSource || 'dom-placement',
          gameInfo: { site: result.site, url: result.url, timestamp: result.timestamp, moveHistory: [], tabId: activeTabId }
        });
      }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── Toast Notification System ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  const TOAST_DURATION = 3500;
  const TOAST_MAX = 3;
  let toastCount = 0;

  function showToast(message, type = 'info', duration = TOAST_DURATION) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Limit toasts
    while (container.children.length >= TOAST_MAX) {
      const oldest = container.firstElementChild;
      if (oldest) oldest.remove();
    }

    const safeType = Object.hasOwn({ success: 1, error: 1, warning: 1, info: 1 }, type) ? type : 'info';
    const toast = document.createElement('div');
    toast.className = `toast toast-${safeType}`;
    // The icon is a Material-symbol mask rendered by CSS — no text glyphs.
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    const messageElement = document.createElement('span');
    messageElement.className = 'toast-message';
    messageElement.textContent = String(message ?? '');
    toast.append(icon, messageElement);
    container.appendChild(toast);
    attachSwipeDismiss(toast);

    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Drag a toast sideways past ~56px and it flings away instead of waiting
  // out its timer. Below the threshold it springs back home.
  function attachSwipeDismiss(toast) {
    let startX = null;
    let dx = 0;
    const settle = () => {
      if (startX === null) return;
      startX = null;
      if (Math.abs(dx) > 56) {
        toast.classList.add('dismiss-swipe');
        toast.style.transform = `translateX(${dx > 0 ? 130 : -130}%)`;
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 240);
      } else if (dx !== 0) {
        toast.classList.add('dismiss-swipe');
        toast.style.transform = '';
        setTimeout(() => toast.classList.remove('dismiss-swipe'), 240);
      }
      dx = 0;
    };
    toast.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      try { toast.setPointerCapture(e.pointerId); } catch (err) {}
    });
    toast.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 4) toast.style.transform = `translateX(${dx}px)`;
    });
    toast.addEventListener('pointerup', settle);
    toast.addEventListener('pointercancel', settle);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── Keyboard Shortcuts ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  let shortcutHelpVisible = false;
  const shortcutDialog = document.getElementById('shortcut-help');
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function openShortcuts() {
    if (!shortcutDialog) return;
    shortcutHelpVisible = true;
    shortcutDialog.classList.remove('md-dialog--closing');
    shortcutDialog.style.display = 'block';
    const closeBtn = document.getElementById('btn-close-shortcut-help');
    if (closeBtn) closeBtn.focus();
  }

  function closeShortcuts() {
    if (!shortcutDialog || shortcutDialog.style.display === 'none') return;
    shortcutHelpVisible = false;
    shortcutDialog.classList.add('md-dialog--closing');
    setTimeout(() => {
      shortcutDialog.style.display = 'none';
      shortcutDialog.classList.remove('md-dialog--closing');
      if (dom.btnSettings) dom.btnSettings.focus();
    }, REDUCED_MOTION ? 0 : 200);
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept if user is in an input/select field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      switch (key) {
        case 'r':
          e.preventDefault();
          if (dom.btnRefresh) dom.btnRefresh.click();
          break;
        case 's':
          e.preventDefault();
          if (dom.settingsPanel && dom.settingsPanel.classList.contains('md-sheet--closing')) {
            openSettingsSheet();   // cancel the closing motion, come straight back
          } else if (dom.settingsPanel && dom.settingsPanel.style.display !== 'none') {
            closeSettingsSheet();
          } else {
            openSettingsSheet();
          }
          break;
        case 'escape':
          if (shortcutHelpVisible) {
            closeShortcuts();
          } else if (dom.settingsPanel && dom.settingsPanel.style.display !== 'none') {
            closeSettingsSheet();
          }
          break;
        case '?':
          e.preventDefault();
          if (shortcutHelpVisible) {
            closeShortcuts();
          } else {
            openShortcuts();
          }
          break;
        default:
          break;
      }
    });
  }

  // The shortcut dialog is modal: Tab cycles inside it until it closes.
  function initDialogFocusTrap() {
    if (!shortcutDialog) return;
    const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';
    shortcutDialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(shortcutDialog.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  function finishRefresh() {
    if (refreshSafetyTimer) clearTimeout(refreshSafetyTimer);
    refreshSafetyTimer = null;
    if (dom.btnRefresh) dom.btnRefresh.classList.remove('spinning');
    isRefreshing = false;
  }

  function inferMoveSan(prevFen, currFen) {
    if (!prevFen || !currFen || !window.ChessCore || typeof window.ChessCore.inferTransition !== 'function') return null;
    const t = window.ChessCore.inferTransition(prevFen, currFen);
    if (!t || !t.from || !t.to) return null;
    const fromSquare = String.fromCharCode(97 + t.from.c) + (8 - t.from.r);
    const toSquare = String.fromCharCode(97 + t.to.c) + (8 - t.to.r);
    let promo = '';
    if (t.from.before && t.from.before.toLowerCase() === 'p' && (t.to.r === 0 || t.to.r === 7)) {
      if (t.to.after && t.to.after.toLowerCase() !== 'p') {
        promo = t.to.after.toLowerCase();
      }
    }
    const uci = fromSquare + toSquare + promo;
    if (window.ChessHintEngine && typeof window.ChessHintEngine.uciToSan === 'function') {
      return window.ChessHintEngine.uciToSan(uci, prevFen);
    }
    return uci;
  }

  function setBalanceLoadingState(hasPrevScore = false) {
    if (dom.evalSection) {
      dom.evalSection.dataset.state = 'loading';
    }
    if (dom.evalStaleBadge) dom.evalStaleBadge.style.display = 'none';
    if (!hasPrevScore) {
      // First analysis of the position: shimmer placeholders instead of
      // static dashes so the loading state feels alive, not broken.
      renderBalanceSkeleton();
    } else if (dom.evalDescription) {
      dom.evalDescription.textContent = 'Analyzing position…';
    }
  }

  // Skeleton shimmer reads the tile's role color via currentColor.
  function renderBalanceSkeleton() {
    if (dom.evalDescription) {
      dom.evalDescription.innerHTML = '<span class="md-skeleton" style="width:58%">&#8203;</span>';
    }
    if (dom.evalWhiteLabel) {
      dom.evalWhiteLabel.innerHTML = '<span class="md-skeleton" style="width:3.5ch">&#8203;</span>';
    }
    if (dom.evalBlackLabel) {
      dom.evalBlackLabel.innerHTML = '<span class="md-skeleton" style="width:3.5ch">&#8203;</span>';
    }
  }

  function setBalanceErrorState(errorMsg = 'Analysis unavailable') {
    if (dom.evalSection) {
      dom.evalSection.dataset.state = 'error';
      dom.evalSection.dataset.lean = 'even';
      dom.evalSection.style.setProperty('--eval-pct', '50');
    }
    if (dom.evalDescription) dom.evalDescription.textContent = errorMsg;
    if (dom.evalStaleBadge) dom.evalStaleBadge.style.display = 'none';
    if (dom.evalWhiteLabel) dom.evalWhiteLabel.textContent = '—';
    if (dom.evalBlackLabel) dom.evalBlackLabel.textContent = '—';
    if (dom.evalBarWhite) dom.evalBarWhite.style.transform = 'scaleX(0.5)';
    renderEvalSparkline();
  }

  function setBalanceEmptyState() {
    if (dom.evalSection) {
      dom.evalSection.dataset.state = 'empty';
      dom.evalSection.dataset.lean = 'even';
      dom.evalSection.style.setProperty('--eval-pct', '50');
    }
    if (dom.evalDescription) dom.evalDescription.textContent = 'Waiting for analysis…';
    if (dom.evalStaleBadge) dom.evalStaleBadge.style.display = 'none';
    if (dom.evalWhiteLabel) dom.evalWhiteLabel.textContent = '—';
    if (dom.evalBlackLabel) dom.evalBlackLabel.textContent = '—';
    if (dom.evalBarWhite) dom.evalBarWhite.style.transform = 'scaleX(0.5)';
    renderEvalSparkline();
  }

  // ─── Initialize ────────────────────────────────────────────────────
  function init() {
    loadSettings();
    applySettingsToUI();
    bindEvents();
    initMdSliders();
    initSegmentedControls();
    initKeyboardShortcuts();
    initSettingsFocusTrap();
    initDialogFocusTrap();
    chrome.runtime.sendMessage({ type: 'panel_state', open: true }).catch(() => {});
    window.addEventListener('pagehide', () => {
      chrome.runtime.sendMessage({ type: 'panel_state', open: false, tabId: activeTabId }).catch(() => {});
    }, { once: true });
    startBoardReading();
    syncWelcome();
    setBalanceEmptyState();
    renderMoveClassificationEmpty();
    initScrollElevation();
    initVersionStamp();
    updateEngineStatus('connecting', 'Connecting to cloud...');
    updateCorrelationStat();   // initialise "0 / 0 (0%)" display
    runHealthCheck();          // passive status only; does not call providers
  }

  // ─── Scroll-aware app bar elevation ─────────────────────────────────
  // One rAF-throttled scroll listener flips `.is-scrolled` on the app shell;
  // the CSS carries the whole visual response.
  function initScrollElevation() {
    const canvas = document.querySelector('.md-canvas');
    const app = document.getElementById('app');
    if (!canvas || !app) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      app.classList.toggle('is-scrolled', canvas.scrollTop > 4);
    };
    canvas.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
  }

  // ─── Version stamp ──────────────────────────────────────────────────
  function initVersionStamp() {
    const el = document.getElementById('app-version-stamp');
    if (!el) return;
    const manifest = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
    el.textContent = manifest ? `Felt · v${manifest.version}` : '';
  }

  // Focus trap for the settings panel so Tab can't escape
  // to the underlying UI while it's open. Also moves focus into the panel on
  // open and restores it to the settings button on close.
  function initSettingsFocusTrap() {
    if (!dom.settingsPanel) return;
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const getFocusable = () => Array.from(dom.settingsPanel.querySelectorAll(FOCUSABLE))
      .filter(el => el.offsetParent !== null && !el.disabled);

    dom.settingsPanel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // When the panel is shown, move focus into it; when hidden, restore.
    const observer = new MutationObserver(() => {
      const isVisible = dom.settingsPanel.style.display !== 'none';
      if (isVisible) {
        const focusable = getFocusable();
        if (focusable.length > 0 && !dom.settingsPanel.contains(document.activeElement)) {
          focusable[0].focus();
        }
      }
    });
    observer.observe(dom.settingsPanel, { attributes: true, attributeFilter: ['style'] });
  }

  function loadSettings() {
    chrome.storage.local.get('settings', (result) => {
      if (result.settings) {
        const migrated = window.AnalysisPolicy
          ? window.AnalysisPolicy.migrateLegacySettings(result.settings)
          : result.settings;
        settings = {
          ...settings,
          ...migrated,
          style: normalizeStyle(migrated.style),
          earlyKingHuntEnabled: migrated.earlyKingHuntEnabled === true,
          analysisQuality: window.AnalysisPolicy
            ? window.AnalysisPolicy.normalizeQuality(migrated.analysisQuality)
            : (migrated.analysisQuality || 'auto'),
          candidateLines: window.AnalysisPolicy
            ? window.AnalysisPolicy.normalizeCandidateLines(migrated.candidateLines)
            : (migrated.candidateLines || 'auto')
        };
        applySettingsToUI();
        if (settings.style !== result.settings.style) chrome.storage.local.set({ settings });
        if (lastAnalysis) renderAnalysis(lastAnalysis);
      }
    });
    chrome.storage.local.get('assistedPlayerColor', (result) => {
      if (result.assistedPlayerColor) {
        assistedPlayerColor = result.assistedPlayerColor;
        updatePlayerSelectorUI();
      }
    });
  }

  // ─── M3E slider: custom visuals driven by the native range input ─────
  function initMdSliders() {
    $$('[data-md-slider]').forEach((slider) => {
      const input = slider.querySelector('input[type="range"]');
      const fill = slider.querySelector('.md-slider__fill');
      const handle = slider.querySelector('.md-slider__handle');
      if (!input || !fill || !handle) return;

      const render = () => {
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const frac = Math.min(1, Math.max(0, (Number(input.value) - min) / (max - min)));
        fill.style.width = `${frac * 100}%`;
        handle.style.left = `${frac * 100}%`;
      };

      let bumpTimer = null;
      const bumpChip = () => {
        const chip = document.getElementById('sparring-strength-value');
        if (!chip) return;
        chip.classList.add('is-bumped');
        clearTimeout(bumpTimer);
        bumpTimer = setTimeout(() => chip.classList.remove('is-bumped'), 140);
      };

      input.addEventListener('input', () => { render(); bumpChip(); });
      input.addEventListener('pointerdown', () => slider.classList.add('is-dragging'));
      window.addEventListener('pointerup', () => slider.classList.remove('is-dragging'));
      render();
    });
  }

  function saveSettings() {
    return Promise.all([
      chrome.storage.local.set({ settings }),
      chrome.storage.local.set({ assistedPlayerColor })
    ]);
  }

  function applySettingsToUI() {
    const mapping = {
      'setting-analysis-quality': settings.analysisQuality,
      'setting-candidate-lines': settings.candidateLines,
      'setting-style': settings.style,
      'setting-early-king-hunt': settings.earlyKingHuntEnabled,
      'setting-human-like-mode': settings.humanLikeMode,
      'setting-sparring-strength': settings.sparringStrength,
      'setting-auto-analyze': settings.autoAnalyze,
      'setting-show-threats': settings.showThreats,
      'setting-show-critical-moments': settings.showCriticalMoments,
      'setting-use-chess-api': settings.useChessApi,
      'setting-use-lichess-cloud': settings.useLichessCloud,
      'setting-use-masters-explorer': settings.useMastersExplorer,
    };
    Object.entries(mapping).forEach(([id, val]) => {
      const el = $(`#${id}`);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    const humanStatus = document.querySelector('.human-mode-status');
    if (humanStatus) humanStatus.textContent = settings.humanLikeMode ? 'On' : 'Off';
    const strengthRow = document.getElementById('sparring-strength-row');
    if (strengthRow) strengthRow.hidden = !settings.humanLikeMode;
    const strengthOutput = document.getElementById('sparring-strength-value');
    if (strengthOutput) strengthOutput.textContent = String(settings.sparringStrength);
    const thinkingNote = document.getElementById('human-thinking-note');
    if (thinkingNote) thinkingNote.hidden = !settings.humanLikeMode;
    $$('.human-mode-opt').forEach(btn => {
      const active = (btn.dataset.mode === 'on') === settings.humanLikeMode;
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    updateStyleDescription();
    updateEarlyKingHuntUI();
    syncExpressiveControls();
    syncAllSegments();
  }

  function syncExpressiveControls() {
    $$('[data-expressive-setting]').forEach((btn) => {
      const field = $(`#${btn.dataset.expressiveSetting}`);
      if (!field) return;
      const selected = String(field.type === 'checkbox' ? field.checked : field.value) === String(btn.dataset.value);
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    $$('.human-mode-opt').forEach((btn) => {
      const active = (btn.dataset.mode === 'on') === settings.humanLikeMode;
      btn.classList.toggle('is-selected', active);
    });
  }

  // ─── Player Selector ──────────────────────────────────────────────
  function updatePlayerSelectorUI() {
    if (!dom.playerSelector) return;
    $$('.player-btn').forEach(btn => {
      const selected = btn.dataset.color === assistedPlayerColor;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    // The pill picks up the piece identity (light for White, dark for Black)
    dom.playerSelector.dataset.selected = assistedPlayerColor || 'w';
    layoutSegmented(dom.playerSelector);
  }

  // ─── Segmented controls: sliding selection pill ────────────────────
  // One shared pill per radiogroup springs to the checked option. Measuring
  // happens in JS so the motion stays GPU-friendly (transform + width only).
  const segmentedGroups = [];

  function layoutSegmented(group) {
    if (!group) return;
    const indicator = group.querySelector('.md-segmented__indicator');
    const selected = group.querySelector('[aria-checked="true"]');
    if (!indicator || !selected) return;
    // Groups inside the hidden settings sheet measure as zero — stay
    // transparent and re-measure when the sheet opens.
    if (group.offsetWidth === 0 || selected.offsetWidth === 0) {
      group.classList.remove('is-ready');
      return;
    }
    group.style.setProperty('--seg-x', `${selected.offsetLeft}px`);
    group.style.setProperty('--seg-y', `${selected.offsetTop}px`);
    group.style.setProperty('--seg-w', `${selected.offsetWidth}px`);
    group.style.setProperty('--seg-h', `${selected.offsetHeight}px`);
    group.classList.add('is-ready');
  }

  function syncAllSegments() {
    segmentedGroups.forEach(layoutSegmented);
  }

  function initSegmentedControls() {
    $$('.md-btn-group[role="radiogroup"]').forEach((group) => {
      if (!group.querySelector('.md-segmented__indicator')) {
        const indicator = document.createElement('span');
        indicator.className = 'md-segmented__indicator';
        indicator.setAttribute('aria-hidden', 'true');
        group.prepend(indicator);
      }
      segmentedGroups.push(group);
      // Re-measure when the panel itself resizes (text wraps change targets)
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => layoutSegmented(group)).observe(group);
      }
    });
    // Fonts shift metrics — re-layout once they settle.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => syncAllSegments()).catch(() => {});
    }
    requestAnimationFrame(syncAllSegments);
  }

  // ─── Event Binding ─────────────────────────────────────────────────
  function bindEvents() {
    // Player selector buttons
    $$('.player-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newColor = btn.dataset.color;
        if (newColor === assistedPlayerColor) return;
        assistedPlayerColor = newColor;
        if (currentFen && turnReliable) {
          isPlayerTurn = (currentFen.split(' ')[1] || 'w') === assistedPlayerColor;
          waitingForOpponent = !isPlayerTurn;
        }
        updatePlayerSelectorUI();
        updatePositionContext();
        // Update ARIA
        $$('.player-btn').forEach(b => b.setAttribute('aria-checked', b.dataset.color === assistedPlayerColor ? 'true' : 'false'));
        saveSettings();
        lastEngineRecommendationFen = null;
        lastEngineRecommendationUci = null;
        chrome.runtime.sendMessage({ type: 'player_color_changed' }).catch(() => {});
        if (lastAnalysis) {
          renderAnalysis(lastAnalysis);
        }
        if (currentFen) {
          requestAnalysis();
        }
      });
    });

    // Non-destructive refresh — coordinator keeps caches, quotas and cooldowns
    if (dom.btnRefresh) {
      dom.btnRefresh.addEventListener('click', () => {
        if (isRefreshing) return;
        isRefreshing = true;
        dom.btnRefresh.classList.add('spinning');
        updateEngineStatus('analyzing', 'Refreshing analysis...');
        requestAnalysis(true);
        refreshSafetyTimer = setTimeout(finishRefresh, 20000);
      });
    }

    // Health check button
    if (dom.btnHealthCheck) {
      dom.btnHealthCheck.addEventListener('click', () => {
        runHealthCheck();
      });
    }

    // Clear caches button
    if (dom.btnClearCaches) {
      const ORIGINAL_TEXT = dom.btnClearCaches.textContent || 'Clear Caches';
      dom.btnClearCaches.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'clear_caches' }).catch(() => {});
        showToast('All caches cleared', 'success', 2500);
        if (dom.btnClearCaches) {
          dom.btnClearCaches.textContent = 'Caches Cleared!';
          // Restore the *exact* original label.
          setTimeout(() => { dom.btnClearCaches.textContent = ORIGINAL_TEXT; }, 2000);
        }
      });
    }

    // Theme toggle removed — dark only

    // Settings and CSP-safe shortcut-help close button + scrim dismissal
    const closeShortcutHelp = document.getElementById('btn-close-shortcut-help');
    if (closeShortcutHelp) closeShortcutHelp.addEventListener('click', closeShortcuts);
    const shortcutScrim = document.querySelector('[data-close-shortcuts]');
    if (shortcutScrim) shortcutScrim.addEventListener('click', closeShortcuts);
    if (dom.btnSettings) dom.btnSettings.addEventListener('click', openSettingsSheet);
    if (dom.btnCloseSettings) dom.btnCloseSettings.addEventListener('click', closeSettingsSheet);

    const settingEls = {
      'setting-analysis-quality': (v) => { settings.analysisQuality = v; },
      'setting-candidate-lines': (v) => { settings.candidateLines = v === 'auto' ? 'auto' : parseInt(v, 10); },
      'setting-style': (v) => { settings.style = normalizeStyle(v); },
      'setting-early-king-hunt': (v) => { settings.earlyKingHuntEnabled = v === true; },
      'setting-human-like-mode': (v) => { settings.humanLikeMode = v; },
      'setting-sparring-strength': (v) => {
        const strength = Math.round(Number(v));
        settings.sparringStrength = Number.isFinite(strength) ? strength : 1100;
        const out = document.getElementById('sparring-strength-value');
        if (out) out.textContent = String(settings.sparringStrength);
      },
      'setting-auto-analyze': (v) => { settings.autoAnalyze = v; },
      'setting-show-threats': (v) => { settings.showThreats = v; },
      'setting-show-critical-moments': (v) => { settings.showCriticalMoments = v; },
      'setting-use-chess-api': (v) => { settings.useChessApi = v; },
      'setting-use-lichess-cloud': (v) => { settings.useLichessCloud = v; },
      'setting-use-masters-explorer': (v) => { settings.useMastersExplorer = v; },
    };

    Object.entries(settingEls).forEach(([id, handler]) => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('change', () => {
        const val = el.type === 'checkbox' ? el.checked : el.value;
        handler(val);
        const savePromise = saveSettings();
        applySettingsToUI();
        if ((id === 'setting-style' || id === 'setting-human-like-mode' || id === 'setting-early-king-hunt' || id === 'setting-show-threats') && lastAnalysis) {
          humanPlanState = null;
          renderAnalysis(lastAnalysis);
          // Human mode changes routing policy too (steady depth, max MultiPV),
          // so a fresh analysis must replace results fetched under the old one.
          if (id === 'setting-human-like-mode' && currentFen) {
            savePromise.finally(() => requestAnalysis(true));
          }
        }
        if (['setting-use-chess-api', 'setting-use-lichess-cloud', 'setting-use-masters-explorer', 'setting-analysis-quality', 'setting-candidate-lines'].includes(id) && currentFen) {
          // Ensure the worker sees the new source policy before it routes.
          savePromise.finally(() => requestAnalysis(true));
        }
      });
    });

    chrome.runtime.onMessage.addListener(handleMessage);

    // Human-mode segmented control (Engine | Human) drives the hidden checkbox.
    $$('.human-mode-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = $('#setting-human-like-mode');
        if (!el) return;
        const on = btn.dataset.mode === 'on';
        if (el.checked === on) return;
        el.checked = on;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    $$('[data-expressive-setting]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = $(`#${btn.dataset.expressiveSetting}`);
        if (!field || field.disabled) return;
        if (String(field.value) === String(btn.dataset.value)) return;
        field.value = btn.dataset.value;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    // APG radiogroup pattern: arrow keys rove between options and select.
    $$('.md-btn-group[role="radiogroup"]').forEach((group) => {
      group.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const items = Array.from(group.querySelectorAll('[role="radio"]'));
        const index = items.indexOf(document.activeElement);
        if (index === -1) return;
        e.preventDefault();
        const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        const next = items[(index + dir + items.length) % items.length];
        next.focus();
        next.click();
      });
    });

    // The style choice stack is a radiogroup too — same roving behavior.
    $$('.md-choice-stack[role="radiogroup"]').forEach((group) => {
      group.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const items = Array.from(group.querySelectorAll('[role="radio"]'));
        const index = items.indexOf(document.activeElement);
        if (index === -1) return;
        e.preventDefault();
        const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        const next = items[(index + dir + items.length) % items.length];
        next.focus();
        next.click();
      });
    });
  }

  // ─── Passive Provider Status and Local Usage Diagnostics ─────────────
  let healthCheckInFlight = false;

  function formatCooldown(ms) {
    const totalSeconds = Math.max(0, Math.ceil((ms || 0) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  }

  function renderPassiveProvider(element, result) {
    if (!element) return;
    if (!result) {
      element.textContent = 'No recent data';
      element.className = 'api-status unknown';
      return;
    }
    const suffix = result.cooldownRemainingMs > 0 ? ` ${formatCooldown(result.cooldownRemainingMs)}` : '';
    element.textContent = `${result.label || 'No recent data'}${suffix}`;
    const healthy = result.state === 'healthy';
    const slow = result.state === 'slow';
    element.className = `api-status ${healthy ? 'online' : (slow || result.state === 'unknown' ? 'unknown' : 'error')}`;
  }

  function renderApiDiagnostics(diagnostics) {
    if (!diagnostics) return;
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = String(value ?? 0); };
    setText('api-cache-avoided', diagnostics.remoteCallsAvoidedByCache);
    setText('api-requests-coalesced', diagnostics.requestsCoalesced);
    setText('api-stale-served', diagnostics.staleResultsServed);
    setText('api-stale-dropped', diagnostics.staleJobsDropped);
    const calls = document.getElementById('api-provider-calls');
    if (calls) {
      const labels = {
        chessApi: 'Chess-API', lichessCloud: 'Lichess Cloud', mastersExplorer: 'Masters DB',
        openingExplorer: 'Opening', tablebase: 'Tablebase'
      };
      calls.textContent = Object.entries(diagnostics.providers || {})
        .map(([provider, data]) => `${labels[provider] || provider}: ${data.calls || 0} call${data.calls === 1 ? '' : 's'} · ${data.label || 'No recent data'}`)
        .join(' | ') || 'No remote calls yet';
    }
  }

  function runHealthCheck() {
    if (healthCheckInFlight) return;
    healthCheckInFlight = true;
    if (dom.btnHealthCheck) {
      dom.btnHealthCheck.disabled = true;
      dom.btnHealthCheck.textContent = 'Refreshing...';
    }
    const restoreButton = () => {
      healthCheckInFlight = false;
      if (dom.btnHealthCheck) {
        dom.btnHealthCheck.disabled = false;
        dom.btnHealthCheck.textContent = 'Refresh status';
      }
    };
    const safetyTimer = setTimeout(restoreButton, 5000);
    chrome.runtime.sendMessage({ type: 'health_check' }, results => {
      clearTimeout(safetyTimer);
      restoreButton();
      if (chrome.runtime.lastError || !results) return;
      renderPassiveProvider(document.getElementById('health-chessapi'), results['chess-api']);
      renderPassiveProvider(document.getElementById('health-lichess'), results.lichess);
      renderPassiveProvider(document.getElementById('health-masters'), results.masters);
      renderPassiveProvider(document.getElementById('health-opening'), results.opening);
      renderPassiveProvider(document.getElementById('health-tablebase'), results.tablebase);
      renderApiDiagnostics(results.diagnostics);
    });
  }

  // ─── Handle Messages ───────────────────────────────────────────────
  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'analysis_update':
        handleAnalysisResult(message.data);
        break;
      case 'analysis_error':
        handleAnalysisError(message.data);
        break;
      case 'turn_status_update':
        handleTurnStatusUpdate(message.data);
        break;
      case 'opening_data_update':
        handleOpeningDataUpdate(message.data);
        break;
    }
    return false;
  }

  function updatePositionContext() {
    if (!dom.positionContext || !dom.positionTurn) return;
    const verified = positionReliable && turnReliable;
    dom.positionContext.classList.toggle('verified', verified);
    dom.positionContext.classList.toggle('partial', !positionReliable && turnReliable);
    dom.positionContext.classList.toggle('pending', !turnReliable);
    dom.positionTurn.textContent = !turnReliable
      ? 'Waiting for a game'
      : (isPlayerTurn ? 'Your turn' : 'Opponent turn');
  }

  // Hide engine scaffolding (eval bar, position info) until a board position
  // is detected, so the hint section shows alone instead of dead placeholders.
  function syncWelcome() {
    const app = document.getElementById('app');
    if (app) app.classList.toggle('no-position', !currentFen);
    // The welcome block lives inside the hero stage: visible only while no
    // board exists at all, hidden the moment any real content can land.
    if (dom.heroWelcome) dom.heroWelcome.hidden = Boolean(currentFen);
  }

  function handlePositionUpdate(message) {
    const prevFen = currentFen;
    currentFen = message.fen;
    if (prevFen && prevFen !== currentFen) {
      lastPositionFen = prevFen;
    }
    syncWelcome();
    const positionChanged = !prevFen || prevFen.split(' ').slice(0, 4).join(' ') !== currentFen.split(' ').slice(0, 4).join(' ');
    playerColor = message.playerColor || 'w';
    positionReliable = message.positionReliable === true;
    turnReliable = message.turnReliable === true;
    if (assistedPlayerColor === null) {
      assistedPlayerColor = playerColor;
      updatePlayerSelectorUI();
      saveSettings();
    }
    if (prevFen && currentFen && isNewGame(prevFen, currentFen)) {
      evalHistory = [];
      prevEval = null;
      prevScoreType = 'cp';
      lastCriticalAlert = null;
      lastPositionFen = null;
      lastAnalyzedFen = null;
      isPlayerTurn = true;
      waitingForOpponent = false;
      renderMoveClassificationEmpty();
      setBalanceEmptyState();
      // Reset the engine-side correlation tracker + sacrifice history.
      chrome.runtime.sendMessage({ type: 'reset_correlation' }).catch(() => {});
      if (window.ChessHintEngine && typeof window.ChessHintEngine.resetSacrificeHistory === 'function') {
        window.ChessHintEngine.resetSacrificeHistory();
      }
      // Clear local engine-recommendation tracking too.
      lastEngineRecommendationFen = null;
      lastEngineRecommendationUci = null;
      humanPlanState = null;
    }

    // Turn-based analysis — check whose turn it is before analyzing
    const activeColor = currentFen ? (currentFen.split(' ')[1] || 'w') : 'w';
    const effectiveColor = assistedPlayerColor || playerColor || 'w';
    const wasPlayerTurn = isPlayerTurn;
    isPlayerTurn = activeColor === effectiveColor;
    waitingForOpponent = !isPlayerTurn;
    turnJustChanged = !wasPlayerTurn && isPlayerTurn; // Turn just changed to player's turn
    updatePositionContext();

    // Detect that the player just moved (transition
    // from "player's turn" to "opponent's turn" while we had a stored engine
    // recommendation for the previous FEN). Infer the move by applying the
    // engine's recommended UCI to the previous FEN and comparing placements —
    // if they match, the player played the engine move; otherwise we still
    // report the actual resulting FEN so background can record "didn't match".
    if (wasPlayerTurn && !isPlayerTurn && lastEngineRecommendationFen && lastEngineRecommendationUci) {
      tryReportPlayerMove(lastEngineRecommendationFen, lastEngineRecommendationUci, currentFen);
      lastEngineRecommendationFen = null;
      lastEngineRecommendationUci = null;
    }

    if (!turnReliable) {
      isPlayerTurn = false;
      waitingForOpponent = false;
      updateEngineStatus('unknown', 'Turn unavailable: waiting for a verified position');
      if (dom.hintText) dom.hintText.textContent = 'Turn information is unavailable for this board.';
      if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      hideIdeaRail();
      return;
    }

    if (isPlayerTurn) {
      // It's the player's turn — request analysis
      if (positionChanged && (settings.autoAnalyze || turnJustChanged)) {
        requestAnalysis();
      }
      updateEngineStatus(wasPlayerTurn ? 'online' : 'analyzing', turnJustChanged ? 'Your turn: analyzing...' : 'Your turn');
    } else {
      // It's the opponent's turn — show waiting status, no API calls
      const playerLabel = effectiveColor === 'w' ? 'White' : 'Black';
      updateEngineStatus('online', `Opponent's turn: waiting...`);
      if (dom.hintText && !lastAnalysis) {
        dom.hintText.textContent = `Waiting for opponent's move...`;
        if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      }
    }
  }

  // Compare the player's actual resulting FEN to the
  // FEN we'd get if they'd played the engine's recommendation. If they match
  // (piece placement + side to move, ignoring move counters), record a match.
  // Otherwise, we still try to derive the actual UCI from the FEN diff and
  // report that. Falls back gracefully if anything is unclear.
  function tryReportPlayerMove(engineFen, engineUci, actualFen) {
    if (!engineFen || !engineUci || !actualFen) return;
    // Background has the stored engine UCI for this FEN and applies it before
    // comparing the observed resulting placement, including special moves.
    chrome.runtime.sendMessage({
      type: 'record_player_move',
      prevFen: engineFen,
      actualFen: actualFen
    }).then((result) => {
      // result may be null if no stored engine recommendation for that FEN.
      if (result && typeof result.matched === 'boolean') updateCorrelationStat();
    }).catch(() => {});
  }

  // Pull current correlation stats from background and render them in
  // the "Sensible moves" row of the position-info card: high = you are
  // following the coach's reasoning, low = blindly copying engine picks.
  function updateCorrelationStat() {
    if (!dom.correlationStat) return;
    chrome.runtime.sendMessage({ type: 'get_correlation_stats' }).then((stats) => {
      if (!stats) {
        dom.correlationStat.textContent = '0 / 0 (0%)';
        return;
      }
      const pct = stats.total > 0 ? Math.round((stats.matches / stats.total) * 100) : 0;
      dom.correlationStat.textContent = `${stats.matches} / ${stats.total} (${pct}%)`;
      // Color cue — green = own thinking, yellow = mixed, red = copying.
      if (stats.total === 0) {
        dom.correlationStat.style.color = 'var(--text-secondary)';
      } else if (pct >= 80) {
        dom.correlationStat.style.color = 'var(--accent-green)';
      } else if (pct >= 60) {
        dom.correlationStat.style.color = 'var(--accent-yellow)';
      } else {
        dom.correlationStat.style.color = 'var(--accent-red)';
      }
    }).catch(() => {
      dom.correlationStat.textContent = '\u2013';
    });
  }

  // Handle turn status updates from background script
  function handleTurnStatusUpdate(data) {
    if (!data) return;
    isPlayerTurn = data.isPlayerTurn;
    waitingForOpponent = data.waitingForOpponent;
    if (data.reason === 'turn_unknown') turnReliable = false;
    updatePositionContext();

    if (data.reason === 'turn_unknown') {
      updateEngineStatus('unknown', 'Turn unavailable: waiting for a verified position');
      if (dom.hintText) dom.hintText.textContent = 'Turn information is unavailable for this board.';
      if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      return;
    }

    if (isPlayerTurn) {
      updateEngineStatus('analyzing', 'Your turn: analyzing...');
    } else {
      updateEngineStatus('online', "Opponent's turn: waiting...");
      if (dom.hintText && !lastAnalysis) {
        dom.hintText.textContent = `Waiting for opponent's move...`;
        if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      }
    }
  }

  function isNewGame(oldFen, newFen) {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const newPlacement = newFen.split(' ')[0];
    const startPlacement = startFen.split(' ')[0];
    if (newPlacement === startPlacement && oldFen.split(' ')[0] !== startPlacement) return true;
    const oldMoveNum = parseInt(oldFen.split(' ')[5]) || 1;
    const newMoveNum = parseInt(newFen.split(' ')[5]) || 1;
    if (newMoveNum < oldMoveNum - 2) return true;
    return false;
  }

  function handleAnalysisResult(data) {
    if (!data || !currentFen) return;
    // A slower cloud response for an earlier position must never overwrite the
    // current board. Compare placement + turn because reconstructed counters
    // may legitimately differ between the request and the next poll.
    const resultKey = (data.fen || '').split(' ').slice(0, 4).join(' ');
    const currentKey = currentFen.split(' ').slice(0, 4).join(' ');
    if (!resultKey || resultKey !== currentKey) return;
    const wasUserRefresh = isRefreshing;
    lastAnalysis = data;

    if (data.pvs && data.pvs.length > 0) {
      const bestPV = data.pvs[0];
      const effectiveColor = assistedPlayerColor || playerColor || 'w';
      // Convert score to player's perspective for consistent tracking
      const evalScore = effectiveColor === 'w' ? bestPV.score : -bestPV.score;
      evalHistory.push({ fen: data.fen, score: evalScore, scoreType: bestPV.scoreType });
      if (evalHistory.length > 50) evalHistory.shift();
      if (prevEval !== null) {
        // The mover is the side that just played — the opposite of the
        // current side to move. Rating from the mover's perspective keeps
        // the sign correct for both players. Normalise evals back to
        // White's perspective (classifyMove's contract) first.
        const prevWhite = effectiveColor === 'w' ? prevEval : -prevEval;
        const currWhite = effectiveColor === 'w' ? evalScore : -evalScore;
        const fenActiveColor = (data.fen || '').split(' ')[1] || 'w';
        const moverColor = fenActiveColor === 'w' ? 'b' : 'w';

        let moveSan = null;
        if (lastAnalyzedFen && data.fen && lastAnalyzedFen !== data.fen) {
          moveSan = inferMoveSan(lastAnalyzedFen, data.fen);
        } else if (lastPositionFen && data.fen && lastPositionFen !== data.fen) {
          moveSan = inferMoveSan(lastPositionFen, data.fen);
        }
        if (!moveSan && Array.isArray(data.moveHistory) && data.moveHistory.length > 0) {
          const lastMove = data.moveHistory[data.moveHistory.length - 1];
          if (typeof lastMove === 'string' && lastMove) {
            moveSan = lastMove.length >= 4 && /^[a-h][1-8][a-h][1-8]/.test(lastMove) && window.ChessHintEngine?.uciToSan
              ? window.ChessHintEngine.uciToSan(lastMove, data.fen)
              : lastMove;
          }
        }

        renderMoveClassification(prevWhite, currWhite, {
          moverColor,
          moveSan,
          scoreTypeBefore: prevScoreType || 'cp',
          scoreTypeAfter: bestPV.scoreType
        });
      } else {
        renderMoveClassificationEmpty();
      }
      prevEval = evalScore;
      prevScoreType = bestPV.scoreType;
      lastAnalyzedFen = data.fen;

      // Remember the engine's first-choice move +
      // the FEN it was recommended for, so when the player makes their move
      // we can compare and update the correlation tracker.
      if (data.fen && bestPV.pv && bestPV.pv.length > 0) {
        lastEngineRecommendationFen = data.fen;
        lastEngineRecommendationUci = bestPV.pv[0];
      }
    }

    updateEngineStatus('online', data.stale ? 'Cached analysis (stale)' : 'Analysis complete');
    renderAnalysis(data);
    runHealthCheck();

    // Toast only on user-initiated refresh, not every
    // auto-analysis. The `isRefreshing` flag is set when the user clicks
    // Refresh and cleared only when this workflow settles.
    if (data.source && wasUserRefresh) {
      const sourceNames = { 'chess-api': 'Chess-API', 'lichess-cloud': 'Lichess Cloud', 'masters-explorer': 'Masters DB', 'opening-explorer': 'Opening Cache', 'tablebase': 'Tablebase', 'local-engine': 'Local engine' };
      showToast(`Analysis ready via ${sourceNames[data.source] || data.source}`, 'success', 2000);
    }

    if (data.exactHintBlocked) {
      showToast(data.exactHintBlocked.message, 'warning', 3500);
    }

    // Refresh the correlation stat in the UI.
    updateCorrelationStat();
    if (wasUserRefresh) finishRefresh();
  }

  function handleAnalysisError(data) {
    if (!data) return;
    if (data.fen && currentFen && data.fen.split(' ').slice(0, 4).join(' ') !== currentFen.split(' ').slice(0, 4).join(' ')) return;
    const errorMsg = data.error || 'Cloud analysis unavailable.';
    if (isRefreshing) finishRefresh();
    updateEngineStatus('error', errorMsg);
    setBalanceErrorState(errorMsg);
    // Show toast for errors
    showToast(errorMsg, 'error', 4000);
    if (dom.hintText) {
      // The background already classifies retry, wait, and hard-budget states.
      // Do not suggest Refresh for a state where it cannot help.
      dom.hintText.textContent = errorMsg;
    }
    hideIdeaRail();
  }

  function handleOpeningDataUpdate(data) {
    if (!data || !data.openingData) return;
    // Update opening data in last analysis if we have it
    if (lastAnalysis && lastAnalysis.fen === data.fen) {
      lastAnalysis.openingData = data.openingData;
      if (dom.openingName && data.openingData.opening) {
        dom.openingName.textContent = data.openingData.opening;
      }
    }
  }

  // ─── Request Analysis ──────────────────────────────────────────────
  function requestAnalysis(refresh = false) {
    if (!currentFen) return;
    updateEngineStatus('analyzing', refresh ? 'Refreshing...' : 'Analyzing...');
    setBalanceLoadingState(prevEval !== null);
    const colorToSend = assistedPlayerColor || playerColor || 'w';
    chrome.runtime.sendMessage({
      type: 'request_analysis',
      fen: currentFen,
      playerColor: colorToSend,
      multiPv: window.AnalysisPolicy
        ? window.AnalysisPolicy.resolveMultiPv(settings, { earlyKingHunt: isEarlyKingHuntActive() })
        : 3,
      hintLevel: EXACT_HINT_LEVEL,
      refresh: refresh,
      tabId: activeTabId,
      positionReliable,
      turnReliable
    }).catch(() => {});
  }

  // ─── Render Analysis ───────────────────────────────────────────────
  function renderAnalysis(data) {
    const effectiveColor = assistedPlayerColor || playerColor || 'w';
    const objectivePvs = data.pvs || [];
    const earlyKingHuntActive = isEarlyKingHuntActive();
    const styledPvs = objectivePvs.length > 0 && data.source !== 'tablebase' &&
      (objectivePvs.length > 1 || settings.humanLikeMode || earlyKingHuntActive)
      ? window.ChessHintEngine.selectPVForStyle(
          objectivePvs,
          data.fen,
          settings.style,
          effectiveColor,
          settings.humanLikeMode,
          {
            activePlan: humanPlanState?.activePlan || null,
            openingData: data.openingData,
            earlyKingHuntEnabled: earlyKingHuntActive,
            formSession: settings.humanLikeMode ? (data.formSession || null) : null
          }
        )
      : objectivePvs;
    const viewData = { ...data, pvs: styledPvs };

    // Track the move the panel actually recommends. In human-like mode
    // this is the human-natural styled pick (possibly different from the raw
    // engine top move); the correlation guard uses it to distinguish human-like
    // play from blind engine-top copies, and the FEN-diff reporter uses it as
    // the expected move for the position.
    if (styledPvs.length > 0 && styledPvs[0].pv && styledPvs[0].pv.length > 0) {
      lastEngineRecommendationFen = data.fen;
      lastEngineRecommendationUci = styledPvs[0].pv[0];
      if (settings.humanLikeMode) {
        chrome.runtime.sendMessage({
          type: 'record_human_recommendation',
          fen: data.fen,
          uci: styledPvs[0].pv[0]
        }).catch(() => {});
      }
    }

    // The evaluation bar remains objective; every move-oriented section below
    // uses the same style-selected ordering.
    if (objectivePvs.length > 0) {
      const bestPV = objectivePvs[0];
      updateEvalBar(bestPV.score, bestPV.scoreType, effectiveColor, data.stale === true);
      updateEvalDescription(bestPV.score, bestPV.scoreType, effectiveColor);
    }
    renderPositionInfo(viewData);
    renderHints(viewData);

    if (data.exactHintBlocked) {
      return;
    }

    if (settings.showCriticalMoments) {
      renderCriticalMoment(effectiveColor);
    } else if (dom.criticalMomentSection) {
      dom.criticalMomentSection.style.display = 'none';
    }
  }

  function updateEvalBar(score, scoreType, effectiveColor, isStale = false) {
    const isWhite = effectiveColor === 'w';
    const displayScore = isWhite ? score : -score;
    // Single-ended meter: the white fill grows from the left to White's
    // winning share; the inverse-surface remainder is Black's share.
    const whiteWinPct = window.ChessHintEngine.formatEvalBar(score, scoreType, true);
    const winFraction = whiteWinPct / 100;
    if (dom.evalBarWhite) {
      dom.evalBarWhite.style.transform = `scaleX(${winFraction})`;
    }

    // The win-probability breakdown lives inside the meter: the left pill
    // sits over White's share, the right pill over Black's remainder. "You"
    // and "Opp" follow the assisted player's color.
    const whiteShare = Math.round(whiteWinPct);
    const blackShare = 100 - whiteShare;
    if (dom.evalBarWhitePct) dom.evalBarWhitePct.textContent = `${isWhite ? 'You' : 'Opp'} ${whiteShare}%`;
    if (dom.evalBarBlackPct) dom.evalBarBlackPct.textContent = `${isWhite ? 'Opp' : 'You'} ${blackShare}%`;

    const scoreStr = scoreType === 'mate'
      ? (displayScore > 0 ? `+M${displayScore}` : `-M${Math.abs(displayScore)}`)
      : (displayScore >= 0 ? `+${(displayScore / 100).toFixed(1)}` : (displayScore / 100).toFixed(1));
    const oppStr = scoreType === 'mate'
      ? (displayScore > 0 ? `-M${displayScore}` : `+M${Math.abs(displayScore)}`)
      : (displayScore < 0 ? `+${(-displayScore / 100).toFixed(1)}` : (-displayScore / 100).toFixed(1));
    if (dom.evalBar) {
      const evalPawns = scoreType === 'mate'
        ? (displayScore > 0 ? 10 : -10) * Math.sign(displayScore || 1)
        : score / 100;
      const pct = Math.round(whiteWinPct);
      dom.evalBar.setAttribute('aria-valuenow', String(Math.max(-10, Math.min(10, evalPawns))));
      dom.evalBar.setAttribute('aria-valuetext', `${scoreStr} for ${isWhite ? 'White' : 'Black'}`);
      // The fulcrum reads `--eval-pct` from an ancestor, so it lives on the
      // tile, not on the bar itself.
      if (dom.evalSection) dom.evalSection.style.setProperty('--eval-pct', String(pct));
    }
    if (dom.evalStaleBadge) dom.evalStaleBadge.style.display = isStale ? 'inline-flex' : 'none';
    if (dom.evalSection) {
      const lean = scoreType === 'mate'
        ? (displayScore > 0 ? 'you' : 'opp')
        : (displayScore > 30 ? 'you' : (displayScore < -30 ? 'opp' : 'even'));
      dom.evalSection.dataset.lean = lean;
      dom.evalSection.dataset.state = isStale ? 'stale' : 'data';
    }
    if (dom.evalWhiteLabel) dom.evalWhiteLabel.textContent = isWhite ? scoreStr : oppStr;
    if (dom.evalBlackLabel) dom.evalBlackLabel.textContent = isWhite ? oppStr : scoreStr;
    renderEvalSparkline();
  }

  // ─── Eval trend sparkline ──────────────────────────────────────────
  // The Balance tile already owns evalHistory; this draws the last stretch
  // of it as a single quiet polyline under the ribbon. White's perspective,
  // clamped to ±6 pawns, with a dashed zero line and an end dot. Hidden
  // until two points exist so early positions stay calm.
  const SPARK_WINDOW = 20;
  function renderEvalSparkline() {
    if (!dom.evalSpark) return;
    const points = evalHistory.slice(-SPARK_WINDOW);
    if (points.length < 2) {
      dom.evalSpark.classList.remove('is-live');
      dom.evalSpark.replaceChildren();
      return;
    }
    const W = 120, H = 28, MID = H / 2;
    const clampPawns = (cp) => Math.max(-600, Math.min(600, cp)) / 100;
    // Mate scores sit at the rail; centipawn scores map linearly to ±6.
    const values = points.map((p) => (p.scoreType === 'mate' ? Math.sign(p.score || 1) * 6 : clampPawns(p.score)));
    const min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(max - min, 1.5);
    const step = W / (points.length - 1);
    const y = (v) => MID - ((v - min) / span - 0.5) * (H - 8);
    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const lastX = ((points.length - 1) * step).toFixed(1);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    zero.setAttribute('class', 'spark-zero');
    zero.setAttribute('x1', '0'); zero.setAttribute('x2', String(W));
    zero.setAttribute('y1', String(MID)); zero.setAttribute('y2', String(MID));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'spark-line');
    line.setAttribute('d', d);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'spark-dot');
    dot.setAttribute('cx', lastX);
    dot.setAttribute('cy', y(values[values.length - 1]).toFixed(1));
    dot.setAttribute('r', '2.5');
    svg.append(zero, line, dot);
    dom.evalSpark.replaceChildren(svg);
    dom.evalSpark.classList.add('is-live');
  }

  function updateEvalDescription(score, scoreType, effectiveColor) {
    const desc = window.ChessHintEngine.describeEval(score, scoreType, effectiveColor === 'w', true);
    if (dom.evalDescription) dom.evalDescription.textContent = desc;
  }

  function updateEngineStatus(status, text) {
    if (dom.statusDot) dom.statusDot.className = `status-dot ${status}`;
    if (dom.statusText) dom.statusText.textContent = text;
    const app = document.getElementById('app');
    if (app) app.classList.toggle('analyzing', status === 'analyzing' || status === 'connecting');
  }

  let settingsSheetCloseTimer = null;

  function openSettingsSheet() {
    if (!dom.settingsPanel) return;
    if (settingsSheetCloseTimer) clearTimeout(settingsSheetCloseTimer);
    dom.settingsPanel.classList.remove('md-sheet--closing');
    dom.settingsPanel.style.display = 'flex';
    // The sheet was hidden, so its segmented groups measured as zero.
    requestAnimationFrame(() => requestAnimationFrame(syncAllSegments));
    runHealthCheck();
  }

  function closeSettingsSheet() {
    if (!dom.settingsPanel) return;
    const panel = dom.settingsPanel;
    if (panel.style.display === 'none' || panel.classList.contains('md-sheet--closing')) return;
    panel.classList.add('md-sheet--closing');
    settingsSheetCloseTimer = setTimeout(() => {
      panel.style.display = 'none';
      panel.classList.remove('md-sheet--closing');
      settingsSheetCloseTimer = null;
    }, REDUCED_MOTION ? 0 : 210);
  }

  function renderPositionInfo(data) {
    if (dom.openingName) {
      if (data.openingData && data.openingData.opening) {
        dom.openingName.textContent = data.openingData.opening;
      } else {
        const opening = window.ChessHintEngine.detectOpening(data.moveHistory);
        dom.openingName.textContent = opening ? opening.name : '\u2013';
      }
    }
    if (dom.gamePhase && data.fen) {
      const phase = window.ChessHintEngine.detectGamePhase(data.fen);
      dom.gamePhase.textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
    }
    if (dom.analysisQuality) {
      const quality = window.AnalysisPolicy
        ? window.AnalysisPolicy.describeQuality(data.qualityClass || window.AnalysisPolicy.qualityClassFor(data))
        : { label: data.qualityLabel || '—' };
      const stale = data.stale ? ' · stale' : '';
      const confidence = Number.isFinite(data.confidence) ? ` · ${Math.round(data.confidence * 100)}%` : '';
      dom.analysisQuality.textContent = `${quality.label}${stale}${confidence}`;
      dom.analysisQuality.title = quality.detail || '';
    }
    if (dom.materialBalance && data.fen) {
      const assessment = window.ChessHintEngine.assessPosition(data.fen);
      const balance = assessment.material.balance;
      const effectiveColor = assistedPlayerColor || 'w';
      const playerBalance = effectiveColor === 'w' ? balance : -balance;
      if (playerBalance > 0) { dom.materialBalance.textContent = `You +${playerBalance}`; dom.materialBalance.style.color = 'var(--accent-green)'; }
      else if (playerBalance < 0) { dom.materialBalance.textContent = `Opp +${Math.abs(playerBalance)}`; dom.materialBalance.style.color = 'var(--accent-red)'; }
      else { dom.materialBalance.textContent = 'Equal'; dom.materialBalance.style.color = 'var(--text-secondary)'; }
    }
  }

  // ─── Critical Moment Alert ────────────────────────────────────────
  function renderCriticalMoment(effectiveColor) {
    if (!dom.criticalMomentSection) return;

    if (!evalHistory || evalHistory.length < 2) {
      dom.criticalMomentSection.style.display = 'none';
      return;
    }

    const lastEval = evalHistory[evalHistory.length - 1];
    const alert = window.ChessHintEngine.detectCriticalMoment(
      evalHistory,
      lastEval.score,
      lastEval.scoreType,
      effectiveColor
    );

    if (!alert) {
      dom.criticalMomentSection.style.display = 'none';
      lastCriticalAlert = null;
      return;
    }

    if (lastCriticalAlert && lastCriticalAlert.type === alert.type) {
      dom.criticalMomentSection.style.display = 'block';
      return;
    }

    lastCriticalAlert = alert;
    dom.criticalMomentSection.style.display = 'block';
    dom.criticalMomentSection.style.animation = 'none';
    dom.criticalMomentSection.offsetHeight;
    dom.criticalMomentSection.style.animation = '';

    if (dom.criticalMomentText) dom.criticalMomentText.textContent = alert.message;
    if (dom.criticalMomentDetail) dom.criticalMomentDetail.textContent = alert.detail;
  }

  // ─── Caption rail ("Why this move") ────────────────────────────────
  // The hero shows only the move. Every supporting sentence the engine
  // produces travels as a caption item and renders here, outside the hero.
  const IDEA_KINDS = new Set(['idea', 'capture', 'sacrifice', 'cost', 'risk', 'kinghunt', 'posture', 'reply']);

  function renderIdeaRail(captions) {
    if (!dom.ideaSection || !dom.ideaList) return;
    const items = Array.isArray(captions) ? captions.filter(c => c && c.text) : [];
    if (items.length === 0) {
      hideIdeaRail();
      return;
    }
    dom.ideaList.textContent = '';
    items.forEach((caption, index) => {
      const kind = IDEA_KINDS.has(caption.kind) ? caption.kind : 'posture';
      const row = document.createElement('div');
      row.className = `md-idea__row md-idea__row--${kind}`;
      row.setAttribute('role', 'listitem');
      row.style.setProperty('--i', String(index));
      const icon = document.createElement('span');
      icon.className = 'md-idea__icon';
      icon.setAttribute('aria-hidden', 'true');
      const texts = document.createElement('div');
      texts.className = 'md-idea__texts';
      if (caption.label) {
        const label = document.createElement('span');
        label.className = 'md-idea__label';
        label.textContent = caption.label;
        texts.appendChild(label);
      }
      const body = document.createElement('span');
      body.className = 'md-idea__body';
      body.textContent = caption.text;
      texts.appendChild(body);
      row.append(icon, texts);
      dom.ideaList.appendChild(row);
    });
    dom.ideaSection.hidden = false;
  }

  function hideIdeaRail() {
    if (!dom.ideaSection) return;
    dom.ideaSection.hidden = true;
    if (dom.ideaList) dom.ideaList.textContent = '';
  }

  // ─── Also consider (alternative lines) ─────────────────────────────
  // Candidate PVs beyond the recommended move, rendered read-only in the
  // caption-rail dialect: piece chip + SAN + a share-of-best meter. Only
  // lines close to the best score qualify — real alternatives, not filler.
  function renderAlternatives(data) {
    if (!dom.altsSection || !dom.altsList) return;
    const pvs = Array.isArray(data.pvs) ? data.pvs : [];
    const effectiveColor = assistedPlayerColor || playerColor || 'w';
    const rows = [];
    for (let i = 1; i < pvs.length && rows.length < 3; i++) {
      const pv = pvs[i];
      if (!pv || !Array.isArray(pv.pv) || !pv.pv[0]) continue;
      const uci = pv.pv[0];
      const san = window.ChessHintEngine && typeof window.ChessHintEngine.uciToSan === 'function'
        ? window.ChessHintEngine.uciToSan(uci, data.fen)
        : uci;
      if (!san) continue;
      const isWhite = effectiveColor === 'w';
      // Score in the assisted player's perspective; alternatives are judged
      // by how much of the best line's value they keep.
      const myScore = isWhite ? pv.score : -pv.score;
      const bestScore = (() => {
        const b = pvs[0];
        if (!b) return myScore;
        const bs = isWhite ? b.score : -b.score;
        return b.scoreType === 'mate' ? (bs > 0 ? 10000 - Math.abs(bs) * 100 : -10000 + Math.abs(bs) * 100)
          : bs;
      })();
      const mineLinear = pv.scoreType === 'mate' ? (myScore > 0 ? 10000 - Math.abs(myScore) * 100 : -10000 + Math.abs(myScore) * 100)
        : myScore;
      const share = bestScore > 0 ? Math.max(5, Math.min(100, Math.round((mineLinear / bestScore) * 100))) : 100;
      if (share < 70 && pv.scoreType !== 'mate') continue;   // clearly worse: not worth the pixels
      const scoreStr = pv.scoreType === 'mate'
        ? (myScore > 0 ? `M${Math.abs(myScore)}` : `−M${Math.abs(myScore)}`)
        : `${myScore >= 0 ? '+' : ''}${(myScore / 100).toFixed(1)}`;
      rows.push({
        san,
        piece: PIECE_GLYPHS[effectiveColor === 'w' ? 'White' : 'Black'][sanPieceName(san)] || '',
        sideClass: effectiveColor === 'w' ? 'md-alt-row--white' : 'md-alt-row--black',
        scoreStr,
        isMate: pv.scoreType === 'mate',
        share
      });
    }
    dom.altsList.textContent = '';
    if (rows.length === 0) {
      dom.altsSection.hidden = true;
      return;
    }
    rows.forEach((row, index) => {
      const el = document.createElement('div');
      el.className = `md-alt-row ${row.sideClass}`;
      el.setAttribute('role', 'listitem');
      el.style.setProperty('--i', String(index));
      el.style.setProperty('--share', String(row.share));
      const piece = document.createElement('span');
      piece.className = 'md-alt-row__piece';
      piece.setAttribute('aria-hidden', 'true');
      piece.textContent = row.piece;
      const san = document.createElement('span');
      san.className = 'md-alt-row__san';
      san.textContent = row.san;
      const meter = document.createElement('span');
      meter.className = 'md-alt-row__meter';
      meter.title = `Keeps about ${row.share}% of the best line's value`;
      const fill = document.createElement('span');
      fill.className = 'md-alt-row__meter-fill';
      meter.appendChild(fill);
      const score = document.createElement('span');
      score.className = 'md-alt-row__score' + (row.isMate ? ' is-mate' : '');
      score.textContent = row.scoreStr;
      el.append(piece, san, meter, score);
      dom.altsList.appendChild(el);
    });
    dom.altsSection.hidden = false;
  }

  // "Nf3" → "knight"; supports O-O castling (king), captures, and promotions.
  function sanPieceName(san) {
    const s = String(san || '');
    if (/^O-O/.test(s)) return 'king';
    const letter = s.charAt(0);
    const map = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
    return map[letter] || 'pawn';
  }

  function hideAlternatives() {
    if (!dom.altsSection) return;
    dom.altsSection.hidden = true;
    if (dom.altsList) dom.altsList.textContent = '';
  }

  // "White: knight: d1 → f3" becomes a piece-glyph + squares lockup.
  // Anything that isn't that shape falls back to plain text.
  const PIECE_GLYPHS = {
    White: { pawn: '\u2659', knight: '\u2658', bishop: '\u2657', rook: '\u2656', queen: '\u2655', king: '\u2654' },
    Black: { pawn: '\u265F', knight: '\u265E', bishop: '\u265D', rook: '\u265C', queen: '\u265B', king: '\u265A' }
  };

  function renderFromTo(raw) {
    if (!dom.hintFromTo) return;
    const match = /^(White|Black): ([a-z]+): ([a-h][1-8]) \u2192 ([a-h][1-8])$/.exec(raw || '');
    if (!match) {
      dom.hintFromTo.textContent = raw;
      return;
    }
    const [, side, pieceName, from, to] = match;
    const glyph = (PIECE_GLYPHS[side] || PIECE_GLYPHS.White)[pieceName] || '';
    const pieceCls = side === 'White' ? 'is-white' : 'is-black';
    dom.hintFromTo.innerHTML =
      `<span class="sq-piece ${pieceCls}">${glyph}</span>` +
      `<span class="sq">${h(from)}</span>` +
      `<span class="sq-arrow" aria-hidden="true">\u2192</span>` +
      `<span class="sq">${h(to)}</span>`;
    const warningEl = document.getElementById('fair-play-warning');
    if (warningEl) warningEl.style.display = 'none';
  }

  // ─── Hint Rendering ────────────────────────────────────────────────
  function renderHints(data) {
    if (data.exactHintBlocked) {
      if (dom.hintText) dom.hintText.textContent = data.exactHintBlocked.message;
      if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      hideAlternatives();
      if (dom.hintCard) dom.hintCard.className = 'hint-card exact-move blocked';
      hideIdeaRail();
      const warningEl = document.getElementById('fair-play-warning');
      const warningText = document.getElementById('fair-play-warning-text');
      if (warningEl) warningEl.style.display = 'flex';
      if (warningText) warningText.textContent = data.exactHintBlocked.message;
      return;
    }
    if (!data.pvs || data.pvs.length === 0) {
      if (dom.hintText) dom.hintText.textContent = 'Waiting for analysis...';
      if (dom.hintFromTo) dom.hintFromTo.style.display = 'none';
      hideIdeaRail();
      hideAlternatives();
      return;
    }

    // Convert currEval to player's perspective to match prevEval
    // Both must be in the same perspective for correct move classification
    const effectiveColor = assistedPlayerColor || 'w';
    const currEvalPlayerPerspective = effectiveColor === 'w'
      ? (data.pvs[0]?.score || 0)
      : -(data.pvs[0]?.score || 0);

    const effectiveHintLevel = EXACT_HINT_LEVEL;
    const hints = window.ChessHintEngine.generateHints(
      { ...data, prevEval, currEval: currEvalPlayerPerspective },
      effectiveHintLevel,
      effectiveColor,
      settings.style,
      null,
      settings.humanLikeMode,
      {
        activePlan: humanPlanState?.activePlan || null,
        earlyKingHuntEnabled: isEarlyKingHuntActive(),
        formSession: settings.humanLikeMode ? (data.formSession || null) : null
      }
    );
    if (settings.humanLikeMode && hints.styleAnalysis?.plan) {
      humanPlanState = { activePlan: hints.styleAnalysis.plan, startedAtFen: data.fen };
    }

    if (dom.hintText) {
      if (hints.bestMoveFromTo) {
        // The lockup (big piece + squares) is the hero content — the SAN label
        // would be redundant beside it, so it stays silent.
        dom.hintText.textContent = '';
        dom.hintText.classList.remove('fade-in');
      } else {
        dom.hintText.textContent = hints.main;
        dom.hintText.classList.add('fade-in');
        setTimeout(() => dom.hintText.classList.remove('fade-in'), 300);
      }
    }

    const captions = Array.isArray(hints.captions) ? hints.captions.slice() : [];
    if (settings.showThreats && hints.threat) {
      const alreadyCaptioned = captions.some((caption) => caption.kind === 'reply');
      if (!alreadyCaptioned) {
        captions.push({
          kind: 'reply',
          label: hints.threatLabel || 'Best reply',
          text: hints.threat
        });
      }
    } else {
      for (let i = captions.length - 1; i >= 0; i--) {
        if (captions[i].kind === 'reply') captions.splice(i, 1);
      }
    }
    renderIdeaRail(captions);
    renderAlternatives(data);

    if (dom.hintFromTo) {
      if (hints.bestMoveFromTo) {
        dom.hintFromTo.style.display = '';
        renderFromTo(hints.bestMoveFromTo);
      } else {
        dom.hintFromTo.style.display = 'none';
      }
    }

    if (dom.hintCard) {
      const styleClass = settings.style === 'super_ultra_aggressive' ? ' super-ultra-mode' : '';
      const humanClass = settings.humanLikeMode ? ' human-mode' : '';
      dom.hintCard.className = 'hint-card exact-move' + styleClass + humanClass;
    }

  }

  function renderMoveClassificationEmpty() {
    if (!dom.moveClassSection || !dom.moveClassDisplay) return;
    dom.moveClassSection.dataset.verdict = 'none';
    dom.moveClassSection.dataset.state = 'empty';
    dom.moveClassDisplay.innerHTML = `
      <div class="md-verdict__empty">
        <span class="md-verdict__empty-icon" aria-hidden="true"></span>
        <p class="md-verdict__empty-text">Play a move to see how it rated</p>
      </div>
    `;
  }

  function renderMoveClassification(evalBefore, evalAfter, opts) {
    if (!dom.moveClassSection || !dom.moveClassDisplay) return;
    const cls = window.ChessHintEngine.classifyMove(evalBefore, evalAfter, opts || {});
    const swing = cls.winChanceLost > 0
      ? `Win −${cls.winChanceLost}%`
      : (cls.winChanceGained > 0 ? `Win +${cls.winChanceGained}%` : 'Held the evaluation');
    const acc = clamp(cls.accuracy, 0, 100, 0);
    const effectiveColor = assistedPlayerColor || playerColor || 'w';
    const moverColor = (opts && opts.moverColor) || (effectiveColor === 'w' ? 'b' : 'w');
    const isPlayerMover = moverColor === effectiveColor;

    let moverText = '';
    if (opts && opts.moveSan) {
      moverText = isPlayerMover ? `You played ${opts.moveSan}` : `Opponent played ${opts.moveSan}`;
    } else {
      moverText = isPlayerMover ? 'Your last move' : "Opponent's last move";
    }

    // A settings change re-renders the same stored analysis; only a genuinely
    // new classification earns the pop + count-up.
    const isNewVerdict = dom.moveClassSection.dataset.verdictKey !== `${opts && opts.moveSan}|${cls.label}|${acc}`;
    dom.moveClassSection.dataset.verdictKey = `${opts && opts.moveSan}|${cls.label}|${acc}`;

    dom.moveClassSection.dataset.verdict = cls.label.toLowerCase();
    dom.moveClassSection.dataset.state = 'data';
    const symbol = cls.symbol
      ? ` <span class="md-verdict__symbol" aria-hidden="true">${h(cls.symbol)}</span>`
      : '';
    dom.moveClassDisplay.innerHTML = `
      <div class="md-verdict__copy">
        <p class="md-verdict__mover">${h(moverText)}</p>
        <p class="md-verdict__label">${h(cls.label)}${symbol}</p>
        <p class="md-verdict__metric">${h(swing)}</p>
      </div>
      <div class="md-verdict__ring" style="--acc: ${acc}" role="img" title="Engine accuracy estimate for this move (${acc}/100)" aria-label="Engine accuracy estimate ${acc} of 100">
        <span class="md-verdict__ring-stack">
          <span class="md-verdict__ring-val">${h(acc)}</span>
          <span class="md-verdict__ring-cap">/ 100</span>
        </span>
      </div>
    `;
    if (isNewVerdict && !REDUCED_MOTION) {
      dom.moveClassSection.classList.remove('pop');
      void dom.moveClassSection.offsetHeight;
      dom.moveClassSection.classList.add('pop');
      const ringVal = dom.moveClassDisplay.querySelector('.md-verdict__ring-val');
      if (ringVal) animateCountUp(ringVal, acc, 520);
    }
  }

  // Small rAF count-up for the verdict accuracy figure. Ends exactly on the
  // real value; skipped entirely under reduced motion.
  function animateCountUp(el, target, duration) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);   // ease-out cubic
      el.textContent = String(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ─── Start ─────────────────────────────────────────────────────────
  init();
})();

/*
 * Central, dependency-free API request coordinator.
 *
 * All remote traffic is serialized, quota-checked, coalesced, cached and
 * classified here. The module is usable from the MV3 service worker and from
 * Node tests through dependency injection.
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

  const QUOTA_STORAGE_KEY = 'apiQuotaState';
  const METRICS_STORAGE_KEY = 'apiUsageMetrics';
  const CACHE_INDEX_STORAGE_KEY = 'apiCacheIndex';
  const CACHE_STORAGE_PREFIX = 'apiCache:';
  const WINDOW_MS = 60 * 1000;
  const METRICS_WINDOW_MS = 10 * 60 * 1000;

  const PRIORITIES = Object.freeze({
    'manual-current-position': 1,
    'current-player-turn': 2,
    'current-position-tablebase': 3,
    'opening-enrichment': 4,
    'background-refresh': 5,
    'health-check': 6
  });

  const DEFAULT_GLOBAL_POLICY = Object.freeze({
    maxRemoteCallsPerMinute: 12,
    maxRemoteCallsPerGame: 80,
    maxEnrichmentCallsPerMinute: 2,
    reservedCurrentPositionCalls: 3,
    maxRequestsPerPosition: 3,
    maxEnrichmentCallsPerPosition: 1,
    maxQueueLengthPerProvider: 20,
    maxTotalQueueLength: 50,
    maxRetriesPerWorkflow: 1,
    memoryCacheEntries: 300,
    persistentCacheEntries: 500,
    retryBaseMs: 1000,
    retryCapMs: 15000
  });

  function canonicalAnalysisFen(fen) {
    if (typeof fen !== 'string') return '';
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return '';
    return parts.slice(0, 4).join(' ');
  }

  function countFenPieces(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    let count = 0;
    for (const character of placement) if (/[prnbqkPRNBQK]/.test(character)) count++;
    return count;
  }

  function isPlausibleOpeningFen(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    const fullmove = Number(parts[5]) || 1;
    return fullmove <= 10 && countFenPieces(fen) >= 24;
  }

  function isEarlyOpeningFen(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    const fullmove = Number(parts[5]) || 1;
    // A fullmove number of 5 covers the first five moves by White/Black.
    return fullmove <= 5 && countFenPieces(fen) >= 24;
  }

  function planPositionWorkflow(fen, settings = {}) {
    const tablebaseEligible = settings.showTablebase !== false && countFenPieces(fen) <= 7;
    const openingEligible = settings.showOpeningExplorer === true && isPlausibleOpeningFen(fen);
    const earlyOpening = isEarlyOpeningFen(fen);
    const enabled = {
      chessApi: settings.useChessApi !== false,
      lichessCloud: settings.useLichessCloud !== false,
      mastersExplorer: settings.useMastersExplorer !== false
    };
    // Opening theory benefits from the Masters database. From move six onward,
    // prefer engine analysis: Chess-API, then Lichess Cloud, then Masters.
    const preferredSources = earlyOpening
      ? ['masters-explorer', 'lichess-cloud', 'chess-api']
      : ['chess-api', 'lichess-cloud', 'masters-explorer'];
    const providerEnabled = {
      'chess-api': enabled.chessApi,
      'lichess-cloud': enabled.lichessCloud,
      'masters-explorer': enabled.mastersExplorer
    };
    const analysisSources = preferredSources.filter(source => providerEnabled[source]);
    return {
      tablebaseEligible,
      openingEligible,
      earlyOpening,
      analysisSources,
      engineSources: analysisSources.filter(source => source === 'chess-api' || source === 'lichess-cloud'),
      humanSources: analysisSources.filter(source => source === 'masters-explorer')
    };
  }

  function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined) return 0;
    const text = String(value).trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return now + Math.max(0, Number(text) * 1000);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) && parsed > now ? parsed : 0;
  }

  function priorityValue(priority) {
    return PRIORITIES[priority] || PRIORITIES['background-refresh'];
  }

  function isLowPriority(priority) {
    return priorityValue(priority) >= PRIORITIES['opening-enrichment'];
  }

  function cloneSerializable(value) {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function defaultProviderState() {
    return {
      recentRequests: [],
      lastRequestAt: 0,
      cooldownUntil: 0,
      disabledUntil: 0,
      consecutive429s: 0,
      consecutive5xx: 0,
      consecutiveNetworkErrors: 0,
      consecutiveMalformedResponses: 0,
      circuitState: 'healthy',
      halfOpenProbeActive: false,
      lastAttemptAt: 0,
      lastSuccessAt: 0,
      recentLatency: 0,
      successCount: 0,
      failureCount: 0,
      lastStatus: 0,
      lastErrorType: ''
    };
  }

  function defaultGlobalState() {
    return {
      recentRequests: [],
      gameCounts: {},
      positionCounts: {}
    };
  }

  function makeMemoryStorage() {
    const values = new Map();
    return {
      async get(key) { return values.get(key); },
      async set(key, value) { values.set(key, cloneSerializable(value)); },
      async remove(keys) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) values.delete(key);
      }
    };
  }

  class ApiRequestCoordinator {
    constructor(options = {}) {
      this.policies = options.policies || {};
      this.globalPolicy = { ...DEFAULT_GLOBAL_POLICY, ...(options.globalPolicy || {}) };
      this.storage = options.storage || makeMemoryStorage();
      this.fetchFn = options.fetchFn || ((...args) => fetch(...args));
      this.now = options.now || (() => Date.now());
      this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
      this.random = options.random || Math.random;
      this.logger = options.logger || console;
      this.isOnline = options.isOnline || (() => typeof navigator === 'undefined' || navigator.onLine !== false);

      this.providerStates = {};
      this.globalState = defaultGlobalState();
      this.queues = new Map();
      this.processing = new Set();
      this.inFlight = new Map();
      this.activeJobs = new Map();
      this.currentPositions = new Map();
      this.memoryCache = new Map();
      this.cacheIndex = [];
      this.metrics = { events: [] };
      this.persistTimer = null;
      this.persistChain = Promise.resolve();
      this.cachePersistChain = Promise.resolve();
      this.sequence = 0;

      for (const provider of Object.keys(this.policies)) {
        this.providerStates[provider] = defaultProviderState();
        this.queues.set(provider, []);
      }
      this.ready = this._hydrate();
    }

    async _hydrate() {
      try {
        const [savedQuota, savedMetrics, savedIndex] = await Promise.all([
          this.storage.get(QUOTA_STORAGE_KEY),
          this.storage.get(METRICS_STORAGE_KEY),
          this.storage.get(CACHE_INDEX_STORAGE_KEY)
        ]);
        if (savedQuota && typeof savedQuota === 'object') {
          for (const provider of Object.keys(this.policies)) {
            if (savedQuota.providers?.[provider]) {
              this.providerStates[provider] = {
                ...defaultProviderState(),
                ...savedQuota.providers[provider],
                halfOpenProbeActive: false
              };
            }
          }
          this.globalState = { ...defaultGlobalState(), ...(savedQuota.global || {}) };
        }
        if (savedMetrics && Array.isArray(savedMetrics.events)) {
          this.metrics.events = savedMetrics.events;
        }
        if (Array.isArray(savedIndex)) this.cacheIndex = savedIndex;
        this._pruneState(this.now());
      } catch (error) {
        this.logger.warn?.('[API Coordinator] Could not restore persisted state:', error?.message || error);
      }
    }

    _pruneState(now) {
      for (const state of Object.values(this.providerStates)) {
        state.recentRequests = (state.recentRequests || []).filter(at => now - at < WINDOW_MS);
      }
      this.globalState.recentRequests = (this.globalState.recentRequests || []).filter(entry => {
        const at = typeof entry === 'number' ? entry : entry?.at;
        return Number.isFinite(at) && now - at < WINDOW_MS;
      });
      for (const [key, value] of Object.entries(this.globalState.gameCounts || {})) {
        if (!value || now - value.updatedAt > 24 * 60 * 60 * 1000) delete this.globalState.gameCounts[key];
      }
      for (const [key, value] of Object.entries(this.globalState.positionCounts || {})) {
        if (!value || now - value.updatedAt > 60 * 60 * 1000) delete this.globalState.positionCounts[key];
      }
      this.metrics.events = (this.metrics.events || []).filter(event => now - event.at < METRICS_WINDOW_MS);
    }

    async _persistNow() {
      const persist = async () => {
        this._pruneState(this.now());
        await Promise.all([
          this.storage.set(QUOTA_STORAGE_KEY, {
            providers: cloneSerializable(this.providerStates),
            global: cloneSerializable(this.globalState)
          }),
          this.storage.set(METRICS_STORAGE_KEY, cloneSerializable(this.metrics))
        ]);
      };
      this.persistChain = this.persistChain.then(persist, persist);
      return this.persistChain;
    }

    _schedulePersist() {
      if (this.persistTimer) return;
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this._persistNow().catch(() => {});
      }, 250);
    }

    async flush() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      await this._persistNow();
    }

    _metric(type, provider = '') {
      this.metrics.events.push({ at: this.now(), type, provider });
      this._pruneState(this.now());
      this._schedulePersist();
    }

    _cacheStorageKey(cacheKey) {
      return CACHE_STORAGE_PREFIX + cacheKey;
    }

    _touchMemoryCache(cacheKey, record) {
      this.memoryCache.delete(cacheKey);
      this.memoryCache.set(cacheKey, record);
      while (this.memoryCache.size > this.globalPolicy.memoryCacheEntries) {
        this.memoryCache.delete(this.memoryCache.keys().next().value);
      }
    }

    async _readCache(cacheKey) {
      if (!cacheKey) return null;
      let record = this.memoryCache.get(cacheKey) || null;
      if (!record) {
        try {
          const stored = await this.storage.get(this._cacheStorageKey(cacheKey));
          if (stored?.cacheKey === cacheKey) record = stored;
        } catch (_) {}
      }
      if (!record) return null;
      const now = this.now();
      if (!Number.isFinite(record.staleUntil) || now >= record.staleUntil) {
        this.memoryCache.delete(cacheKey);
        this.storage.remove(this._cacheStorageKey(cacheKey)).catch(() => {});
        return null;
      }
      this._touchMemoryCache(cacheKey, record);
      return {
        record,
        fresh: now < record.freshUntil,
        stale: now >= record.freshUntil,
        ageMs: Math.max(0, now - record.createdAt)
      };
    }

    async _writeCache(cacheKey, data, cachePolicy, metadata = {}) {
      if (!cacheKey || !cachePolicy) return;
      const now = this.now();
      const freshTtlMs = Math.max(0, cachePolicy.freshTtlMs || 0);
      const staleTtlMs = Math.max(freshTtlMs, cachePolicy.staleTtlMs || freshTtlMs);
      const record = {
        cacheKey,
        data: cloneSerializable(data),
        createdAt: now,
        freshUntil: now + freshTtlMs,
        staleUntil: now + staleTtlMs,
        negative: false,
        source: metadata.source || '',
        depth: metadata.depth || 0
      };
      this._touchMemoryCache(cacheKey, record);
      if (cachePolicy.persistent !== false) {
        try { await this._persistCacheRecord(record); }
        catch (error) { this.logger.warn?.('[API Coordinator] Persistent cache write failed:', error?.message || error); }
      }
    }

    async _writeNegativeCache(cacheKey, cachePolicy, errorType, status = 0, ttlOverride = 0) {
      if (!cacheKey || !cachePolicy) return;
      const ttl = Math.max(0, ttlOverride || cachePolicy.negativeTtlMs || 0);
      if (!ttl) return;
      const now = this.now();
      const record = {
        cacheKey,
        data: null,
        createdAt: now,
        freshUntil: now + ttl,
        staleUntil: now + ttl,
        negative: true,
        errorType,
        status
      };
      this._touchMemoryCache(cacheKey, record);
      if (cachePolicy.persistent !== false) {
        try { await this._persistCacheRecord(record); }
        catch (error) { this.logger.warn?.('[API Coordinator] Negative-cache write failed:', error?.message || error); }
      }
    }

    async _persistCacheRecord(record) {
      const persist = async () => {
        const storageKey = this._cacheStorageKey(record.cacheKey);
        await this.storage.set(storageKey, record);
        this.cacheIndex = this.cacheIndex.filter(entry => entry.storageKey !== storageKey);
        this.cacheIndex.push({ storageKey, at: record.createdAt });
        const removed = [];
        while (this.cacheIndex.length > this.globalPolicy.persistentCacheEntries) {
          removed.push(this.cacheIndex.shift().storageKey);
        }
        await this.storage.set(CACHE_INDEX_STORAGE_KEY, this.cacheIndex);
        if (removed.length) await this.storage.remove(removed);
      };
      this.cachePersistChain = this.cachePersistChain.then(persist, persist);
      return this.cachePersistChain;
    }

    _cacheResult(cacheState, extra = {}) {
      const { record, stale } = cacheState;
      if (record.negative) {
        this._metric('negativeHit', extra.provider);
        return {
          ok: false,
          cached: true,
          negative: true,
          errorType: record.errorType || 'not_found',
          status: record.status || 0
        };
      }
      this._metric(stale ? 'staleServed' : 'cacheHit', extra.provider);
      return {
        ok: true,
        data: cloneSerializable(record.data),
        cached: true,
        stale: Boolean(stale),
        cacheAgeMs: cacheState.ageMs,
        ...extra
      };
    }

    async getCached(cacheKey, provider = '') {
      await this.ready;
      const cacheState = await this._readCache(cacheKey);
      return cacheState ? this._cacheResult(cacheState, { provider }) : null;
    }

    _requestKey(spec) {
      return [
        spec.provider,
        spec.endpointClass || 'default',
        spec.cacheKey || '',
        spec.requestKey || '',
        spec.request?.method || 'GET',
        spec.request?.url || ''
      ].join('|');
    }

    async request(spec) {
      await this.ready;
      const policy = this.policies[spec?.provider];
      if (!policy) throw new Error(`Unknown API provider: ${spec?.provider}`);
      if (!spec.request?.url || typeof spec.parse !== 'function') {
        throw new Error('Coordinator requests require request.url and parse(response)');
      }

      const normalized = {
        endpointClass: 'analysis',
        priority: 'current-player-turn',
        allowStale: true,
        refresh: false,
        ...spec,
        cachePolicy: { ...(spec.cachePolicy || {}) }
      };
      const cacheState = normalized.cacheKey ? await this._readCache(normalized.cacheKey) : null;
      if (cacheState?.record.negative) return this._cacheResult(cacheState, { provider: normalized.provider });
      if (cacheState && !normalized.refresh && (cacheState.fresh || normalized.allowStale)) {
        const result = this._cacheResult(cacheState, { provider: normalized.provider });
        if (cacheState.stale && normalized.revalidate && this.canSchedule(normalized.provider, 'background-refresh')) {
          this._scheduleRevalidation(normalized);
        }
        return result;
      }
      if (cacheState?.fresh && normalized.refresh) {
        const minAge = normalized.cachePolicy.minRefreshAgeMs || 60 * 1000;
        if (cacheState.ageMs < minAge) return this._cacheResult(cacheState, { provider: normalized.provider });
      }

      if (!this.isOnline()) {
        return cacheState && !cacheState.record.negative
          ? this._cacheResult(cacheState, { provider: normalized.provider, offline: true })
          : { ok: false, errorType: 'offline' };
      }

      const requestKey = this._requestKey(normalized);
      if (this.inFlight.has(requestKey)) {
        this._metric('coalesced', normalized.provider);
        return this.inFlight.get(requestKey);
      }

      const providerQueue = this.queues.get(normalized.provider);
      const totalQueued = [...this.queues.values()].reduce((sum, queue) => sum + queue.length, 0);
      if (providerQueue.length >= this.globalPolicy.maxQueueLengthPerProvider || totalQueued >= this.globalPolicy.maxTotalQueueLength) {
        this._metric('queueDropped', normalized.provider);
        return cacheState && !cacheState.record.negative
          ? this._cacheResult(cacheState, { provider: normalized.provider, queueFull: true })
          : { ok: false, errorType: 'queue_full' };
      }

      let resolveJob;
      const promise = new Promise(resolve => { resolveJob = resolve; });
      const job = {
        id: ++this.sequence,
        spec: normalized,
        policy,
        requestKey,
        cacheFallback: cacheState && !cacheState.record.negative ? cacheState : null,
        resolve: resolveJob,
        enqueuedAt: this.now(),
        controller: null,
        cancelWait: null,
        timedOut: false,
        cancelled: false,
        cancelReason: ''
      };
      this.inFlight.set(requestKey, promise);
      for (const active of this.activeJobs.values()) {
        if (active.spec.provider === normalized.provider &&
            priorityValue(normalized.priority) < priorityValue(active.spec.priority)) {
          active.cancelled = true;
          active.cancelReason = 'preempted';
          if (active.controller) active.controller.abort();
          else active.cancelWait?.();
        }
      }
      providerQueue.push(job);
      providerQueue.sort((a, b) => priorityValue(a.spec.priority) - priorityValue(b.spec.priority) || a.id - b.id);
      promise.finally(() => {
        if (this.inFlight.get(requestKey) === promise) this.inFlight.delete(requestKey);
      });
      this._processProvider(normalized.provider).catch(error => {
        this.logger.error?.('[API Coordinator] Queue processor failed:', error?.message || error);
      });
      return promise;
    }

    _scheduleRevalidation(spec) {
      const revalidateSpec = {
        ...spec,
        priority: 'background-refresh',
        refresh: true,
        allowStale: false,
        revalidate: false
      };
      Promise.resolve().then(() => this.request(revalidateSpec)).catch(() => {});
    }

    async _processProvider(provider) {
      if (this.processing.has(provider)) return;
      this.processing.add(provider);
      const queue = this.queues.get(provider);
      try {
        while (queue.length) {
          queue.sort((a, b) => priorityValue(a.spec.priority) - priorityValue(b.spec.priority) || a.id - b.id);
          const job = queue.shift();
          let result;
          try {
            result = await this._runJob(job);
          } catch (error) {
            result = { ok: false, errorType: 'coordinator_error', message: error?.message || String(error) };
          }
          job.resolve(result);
        }
      } finally {
        this.processing.delete(provider);
        if (queue.length) this._processProvider(provider).catch(() => {});
      }
    }

    _samePosition(a, b) {
      if (!a || !b) return true;
      return String(a.tabId ?? 'active') === String(b.tabId ?? 'active') &&
        a.gameId === b.gameId && a.sequence === b.sequence &&
        a.canonicalFen === b.canonicalFen;
    }

    isPositionCurrent(token) {
      if (!token) return true;
      const current = this.currentPositions.get(String(token.tabId ?? 'active'));
      return Boolean(current && this._samePosition(current, token));
    }

    updatePosition(token) {
      if (!token?.canonicalFen) return;
      const tabId = String(token.tabId ?? 'active');
      this.currentPositions.set(tabId, { ...token, tabId });

      for (const [provider, queue] of this.queues) {
        const retained = [];
        for (const job of queue) {
          if (job.spec.positionToken && String(job.spec.positionToken.tabId ?? 'active') === tabId && !this._samePosition(job.spec.positionToken, token)) {
            this._metric('staleDropped', provider);
            job.resolve({ ok: false, errorType: 'stale_position', stalePosition: true });
          } else retained.push(job);
        }
        queue.splice(0, queue.length, ...retained);
      }

      for (const job of this.activeJobs.values()) {
        if (job.spec.positionToken && String(job.spec.positionToken.tabId ?? 'active') === tabId &&
            !this._samePosition(job.spec.positionToken, token)) {
          job.cancelled = true;
          job.cancelReason = 'stale_position';
          if (!job.controller) job.cancelWait?.();
          else if (isLowPriority(job.spec.priority)) job.controller.abort();
        }
      }
    }

    cancelTab(tabId) {
      const key = String(tabId ?? 'active');
      this.currentPositions.delete(key);
      for (const [provider, queue] of this.queues) {
        const retained = [];
        for (const job of queue) {
          if (String(job.spec.positionToken?.tabId ?? '') === key) {
            job.resolve({ ok: false, errorType: 'cancelled', stalePosition: true });
          } else retained.push(job);
        }
        queue.splice(0, queue.length, ...retained);
      }
      for (const job of this.activeJobs.values()) {
        if (String(job.spec.positionToken?.tabId ?? '') === key) {
          job.cancelled = true;
          job.cancelReason = 'cancelled';
          if (!job.controller) job.cancelWait?.();
          else if (isLowPriority(job.spec.priority)) job.controller.abort();
        }
      }
    }

    _availability(provider, now = this.now()) {
      const state = this.providerStates[provider];
      if (state.disabledUntil > now) {
        state.circuitState = 'disabled';
        return { allowed: false, errorType: 'disabled', until: state.disabledUntil };
      }
      if (state.cooldownUntil > now) {
        state.circuitState = 'cooldown';
        return { allowed: false, errorType: 'cooldown', until: state.cooldownUntil };
      }
      if ((state.circuitState === 'cooldown' || state.circuitState === 'disabled') &&
          state.cooldownUntil <= now && state.disabledUntil <= now) {
        state.circuitState = 'half-open';
      }
      if (state.circuitState === 'half-open' && state.halfOpenProbeActive) {
        return { allowed: false, errorType: 'half_open_busy', until: 0 };
      }
      return { allowed: true, errorType: '', until: 0 };
    }

    _fallbackOrError(job, errorType, extra = {}) {
      if (job.cacheFallback) {
        return this._cacheResult(job.cacheFallback, {
          provider: job.spec.provider,
          refreshFailed: true,
          refreshErrorType: errorType,
          ...extra
        });
      }
      return { ok: false, errorType, ...extra };
    }

    _positionBudgetKey(token) {
      if (!token) return '';
      return `${token.tabId ?? 'active'}:${token.gameId ?? 'game'}:${token.canonicalFen || ''}`;
    }

    _gameBudgetKey(token) {
      if (!token) return '';
      return `${token.tabId ?? 'active'}:${token.gameId ?? 'game'}`;
    }

    _budgetStatus(job, now) {
      this._pruneState(now);
      const state = this.providerStates[job.spec.provider];
      const policy = job.policy;
      const providerLimit = Math.max(1, policy.conservativeRequestsPerMinute || 1);
      const globalRecent = this.globalState.recentRequests;
      const enrichmentRecent = globalRecent.filter(entry => typeof entry === 'object' && entry.enrichment).length;
      const lowPriority = isLowPriority(job.spec.priority);

      if (lowPriority && globalRecent.length >= this.globalPolicy.maxRemoteCallsPerMinute - this.globalPolicy.reservedCurrentPositionCalls) {
        return { allowed: false, hard: true, errorType: 'reserved_capacity' };
      }
      if (job.spec.endpointClass === 'enrichment' && enrichmentRecent >= this.globalPolicy.maxEnrichmentCallsPerMinute) {
        return { allowed: false, hard: true, errorType: 'enrichment_budget' };
      }

      const gameKey = this._gameBudgetKey(job.spec.positionToken);
      if (gameKey && (this.globalState.gameCounts[gameKey]?.count || 0) >= this.globalPolicy.maxRemoteCallsPerGame) {
        return { allowed: false, hard: true, errorType: 'game_budget' };
      }
      const positionKey = this._positionBudgetKey(job.spec.positionToken);
      const positionEntry = positionKey ? this.globalState.positionCounts[positionKey] : null;
      if (positionEntry && positionEntry.count >= this.globalPolicy.maxRequestsPerPosition) {
        return { allowed: false, hard: true, errorType: 'position_budget' };
      }
      if (positionEntry && job.spec.endpointClass === 'enrichment' &&
          positionEntry.enrichmentCount >= this.globalPolicy.maxEnrichmentCallsPerPosition) {
        return { allowed: false, hard: true, errorType: 'position_enrichment_budget' };
      }

      const waits = [];
      if (state.recentRequests.length >= providerLimit) waits.push(state.recentRequests[0] + WINDOW_MS - now);
      if (globalRecent.length >= this.globalPolicy.maxRemoteCallsPerMinute) {
        const first = typeof globalRecent[0] === 'number' ? globalRecent[0] : globalRecent[0].at;
        waits.push(first + WINDOW_MS - now);
      }
      const spacing = Math.max(0, (policy.minSpacingMs || 0) - (now - state.lastRequestAt));
      if (spacing > 0) waits.push(spacing);
      const waitMs = Math.max(0, ...waits);
      return waitMs > 0
        ? { allowed: false, hard: lowPriority, waitMs, errorType: 'quota_wait' }
        : { allowed: true, hard: false, waitMs: 0, errorType: '' };
    }

    async _sleepForJob(job, ms) {
      let cancel;
      const cancelled = new Promise(resolve => { cancel = () => resolve('cancelled'); });
      job.cancelWait = cancel;
      try {
        return await Promise.race([
          this.sleep(ms).then(() => 'elapsed'),
          cancelled
        ]);
      } finally {
        if (job.cancelWait === cancel) job.cancelWait = null;
      }
    }

    async _waitAndReserve(job) {
      while (true) {
        if (job.cancelled) return { ok: false, errorType: job.cancelReason || 'cancelled' };
        if (!this.isPositionCurrent(job.spec.positionToken)) return { ok: false, errorType: 'stale_position' };
        const now = this.now();
        const availability = this._availability(job.spec.provider, now);
        if (!availability.allowed) return { ok: false, errorType: availability.errorType, cooldownUntil: availability.until };
        const budget = this._budgetStatus(job, now);
        if (budget.allowed) {
          const state = this.providerStates[job.spec.provider];
          state.recentRequests.push(now);
          state.lastRequestAt = now;
          state.lastAttemptAt = now;
          this.globalState.recentRequests.push({
            at: now,
            provider: job.spec.provider,
            enrichment: job.spec.endpointClass === 'enrichment'
          });
          const gameKey = this._gameBudgetKey(job.spec.positionToken);
          if (gameKey) {
            const previous = this.globalState.gameCounts[gameKey] || { count: 0, updatedAt: now };
            this.globalState.gameCounts[gameKey] = { count: previous.count + 1, updatedAt: now };
          }
          const positionKey = this._positionBudgetKey(job.spec.positionToken);
          if (positionKey) {
            const previous = this.globalState.positionCounts[positionKey] || { count: 0, enrichmentCount: 0, updatedAt: now };
            this.globalState.positionCounts[positionKey] = {
              count: previous.count + 1,
              enrichmentCount: previous.enrichmentCount + (job.spec.endpointClass === 'enrichment' ? 1 : 0),
              updatedAt: now
            };
          }
          this._metric('remoteCall', job.spec.provider);
          await this._persistNow();
          return { ok: true };
        }
        if (budget.hard || !Number.isFinite(budget.waitMs) || budget.waitMs <= 0) {
          return { ok: false, errorType: budget.errorType };
        }
        await this._sleepForJob(job, budget.waitMs);
        // Deliberately loop and re-read the clock and all windows after waiting.
      }
    }

    async _runJob(job) {
      if (!this.isPositionCurrent(job.spec.positionToken)) {
        this._metric('staleDropped', job.spec.provider);
        return this._fallbackOrError(job, 'stale_position', { stalePosition: true });
      }

      const cacheState = job.spec.cacheKey ? await this._readCache(job.spec.cacheKey) : null;
      if (cacheState?.record.negative) return this._cacheResult(cacheState, { provider: job.spec.provider });
      if (cacheState && !job.spec.refresh && (cacheState.fresh || job.spec.allowStale)) {
        return this._cacheResult(cacheState, { provider: job.spec.provider });
      }
      if (cacheState?.fresh && job.spec.refresh &&
          cacheState.ageMs < (job.spec.cachePolicy.minRefreshAgeMs || 60 * 1000)) {
        return this._cacheResult(cacheState, { provider: job.spec.provider });
      }
      if (cacheState && !cacheState.record.negative) job.cacheFallback = cacheState;

      const state = this.providerStates[job.spec.provider];
      this.activeJobs.set(job.id, job);
      try {
        const reservation = await this._waitAndReserve(job);
        if (!reservation.ok) return this._fallbackOrError(job, reservation.errorType, reservation);
        if (state.circuitState === 'half-open') state.halfOpenProbeActive = true;
        return await this._executeWithPolicy(job);
      } finally {
        state.halfOpenProbeActive = false;
        this.activeJobs.delete(job.id);
      }
    }

    _retryCount(job, kind) {
      if (this.providerStates[job.spec.provider].circuitState === 'degraded') return 0;
      const configured = kind === 'server_error' ? job.policy.retry5xx : job.policy.retryNetwork;
      return Math.min(this.globalPolicy.maxRetriesPerWorkflow, Math.max(0, configured || 0));
    }

    async _retry(job, attempt) {
      const cap = this.globalPolicy.retryCapMs;
      const exponential = Math.min(cap, this.globalPolicy.retryBaseMs * Math.pow(2, attempt));
      await this._sleepForJob(job, this.random() * exponential);
      if (!this.isPositionCurrent(job.spec.positionToken)) return { ok: false, errorType: 'stale_position' };
      return this._waitAndReserve(job);
    }

    async _executeWithPolicy(job) {
      let attempt = 0;
      while (true) {
        if (!this.isPositionCurrent(job.spec.positionToken)) {
          return this._fallbackOrError(job, 'stale_position', { stalePosition: true });
        }
        const startedAt = this.now();
        job.controller = new AbortController();
        job.timedOut = false;
        const timeoutMs = job.spec.request.timeoutMs || 15000;
        const timeoutId = setTimeout(() => {
          job.timedOut = true;
          job.controller.abort();
        }, timeoutMs);

        let response;
        try {
          const requestOptions = {
            method: job.spec.request.method || 'GET',
            headers: { Accept: 'application/json', ...(job.spec.request.headers || {}) },
            signal: job.controller.signal
          };
          if (job.spec.request.body !== undefined) requestOptions.body = job.spec.request.body;
          response = await this.fetchFn(job.spec.request.url, requestOptions);
        } catch (error) {
          clearTimeout(timeoutId);
          if (!this.isPositionCurrent(job.spec.positionToken)) {
            return this._fallbackOrError(job, 'stale_position', { stalePosition: true });
          }
          if (job.cancelled) {
            return this._fallbackOrError(job, job.cancelReason || 'cancelled');
          }
          const errorType = job.timedOut || error?.name === 'AbortError' ? 'timeout' : 'network';
          const retries = this._retryCount(job, 'network');
          if (attempt < retries) {
            attempt++;
            const reservation = await this._retry(job, attempt);
            if (reservation.ok) continue;
          }
          await this._recordFailure(job.spec.provider, errorType, 0);
          if (!job.cacheFallback) {
            await this._writeNegativeCache(job.spec.cacheKey, job.spec.cachePolicy, errorType, 0,
              job.spec.cachePolicy.networkFailureTtlMs || 20 * 1000);
          }
          return this._fallbackOrError(job, errorType);
        }
        clearTimeout(timeoutId);

        const status = Number(response?.status) || 0;
        const latency = Math.max(0, this.now() - startedAt);
        if (status >= 200 && status < 300) {
          let data;
          try {
            data = await job.spec.parse(response);
          } catch (error) {
            await this._recordFailure(job.spec.provider, 'malformed_response', status);
            return this._fallbackOrError(job, 'malformed_response', { status });
          }
          if (data === null || data === undefined || (job.spec.isEmpty && job.spec.isEmpty(data))) {
            await this._recordSuccess(job.spec.provider, status, latency);
            if (!job.cacheFallback) {
              await this._writeNegativeCache(job.spec.cacheKey, job.spec.cachePolicy, 'empty', status,
                job.spec.cachePolicy.emptyTtlMs || job.spec.cachePolicy.negativeTtlMs);
            }
            return job.cacheFallback
              ? this._fallbackOrError(job, 'empty', { status })
              : { ok: false, errorType: 'empty', negative: true, status };
          }
          await this._recordSuccess(job.spec.provider, status, latency);
          await this._writeCache(job.spec.cacheKey, data, job.spec.cachePolicy, {
            source: job.spec.provider,
            depth: data?.depth || 0
          });
          if (!this.isPositionCurrent(job.spec.positionToken)) {
            return { ok: false, errorType: 'stale_position', stalePosition: true, cachedForLater: true };
          }
          return { ok: true, data, cached: false, stale: false, status, provider: job.spec.provider };
        }

        if (status === 429) {
          const retryAfter = response.headers?.get?.('Retry-After');
          const cooldownUntil = await this._recordRateLimit(job.spec.provider, retryAfter);
          this._dropLowPriority(job.spec.provider, 'cooldown');
          return this._fallbackOrError(job, 'rate_limit', { status, cooldownUntil });
        }

        if (status === 401 || status === 403) {
          const disabledUntil = await this._recordDisabled(job.spec.provider, status);
          this._dropLowPriority(job.spec.provider, 'disabled');
          return this._fallbackOrError(job, 'authorization', { status, disabledUntil });
        }

        if (status === 404) {
          await this._recordNotFound(job.spec.provider, status, latency);
          if (!job.cacheFallback) {
            await this._writeNegativeCache(job.spec.cacheKey, job.spec.cachePolicy, 'not_found', status,
              job.spec.cachePolicy.notFoundTtlMs || job.spec.cachePolicy.negativeTtlMs);
          }
          return job.cacheFallback
            ? this._fallbackOrError(job, 'not_found', { status })
            : { ok: false, errorType: 'not_found', negative: true, status };
        }

        if (status === 400 || (status >= 400 && status < 500 && status !== 408)) {
          await this._recordClientError(job.spec.provider, status);
          if (!job.cacheFallback) {
            await this._writeNegativeCache(job.spec.cacheKey, job.spec.cachePolicy, 'http_' + status, status,
              job.spec.cachePolicy.badRequestTtlMs || 5 * 60 * 1000);
          }
          return this._fallbackOrError(job, 'http_' + status, { status });
        }

        const errorType = status === 408 ? 'timeout' : 'server_error';
        const retries = status === 408 ? this._retryCount(job, 'network') : this._retryCount(job, 'server_error');
        if (attempt < retries && this.isPositionCurrent(job.spec.positionToken)) {
          attempt++;
          const reservation = await this._retry(job, attempt);
          if (reservation.ok) continue;
        }
        await this._recordFailure(job.spec.provider, errorType, status);
        if (!job.cacheFallback) {
          await this._writeNegativeCache(job.spec.cacheKey, job.spec.cachePolicy, errorType, status,
            job.spec.cachePolicy.networkFailureTtlMs || 20 * 1000);
        }
        return this._fallbackOrError(job, errorType, { status });
      }
    }

    async _recordSuccess(provider, status, latency) {
      const state = this.providerStates[provider];
      state.lastStatus = status;
      state.lastErrorType = '';
      state.lastSuccessAt = this.now();
      state.successCount++;
      state.consecutive5xx = Math.max(0, state.consecutive5xx - 1);
      state.consecutiveNetworkErrors = Math.max(0, state.consecutiveNetworkErrors - 1);
      state.consecutiveMalformedResponses = Math.max(0, state.consecutiveMalformedResponses - 1);
      state.consecutive429s = Math.max(0, state.consecutive429s - 1);
      state.recentLatency = state.recentLatency ? Math.round(state.recentLatency * 0.7 + latency * 0.3) : latency;
      state.circuitState = state.consecutive5xx || state.consecutiveNetworkErrors ? 'degraded' : 'healthy';
      await this._persistNow();
    }

    async _recordNotFound(provider, status, latency) {
      const state = this.providerStates[provider];
      state.lastStatus = status;
      state.lastErrorType = 'not_found';
      state.recentLatency = state.recentLatency ? Math.round(state.recentLatency * 0.7 + latency * 0.3) : latency;
      state.circuitState = state.cooldownUntil > this.now() ? 'cooldown' : 'healthy';
      await this._persistNow();
    }

    async _recordFailure(provider, errorType, status) {
      const state = this.providerStates[provider];
      const wasHalfOpen = state.circuitState === 'half-open';
      state.failureCount++;
      state.lastStatus = status || 0;
      state.lastErrorType = errorType;
      if (errorType === 'server_error') state.consecutive5xx++;
      if (errorType === 'network' || errorType === 'timeout') state.consecutiveNetworkErrors++;
      if (errorType === 'malformed_response') state.consecutiveMalformedResponses++;
      state.circuitState = 'degraded';
      if (state.consecutiveMalformedResponses >= 3) {
        state.disabledUntil = Math.max(state.disabledUntil, this.now() + 24 * 60 * 60 * 1000);
        state.circuitState = 'disabled';
      } else if (wasHalfOpen || state.consecutive5xx + state.consecutiveNetworkErrors >= 3) {
        const cooldown = Math.min(this.policies[provider].maxCooldownMs || 30 * 60 * 1000, 60 * 1000);
        state.cooldownUntil = Math.max(state.cooldownUntil, this.now() + cooldown);
        state.circuitState = 'cooldown';
      }
      await this._persistNow();
    }

    async _recordClientError(provider, status) {
      const state = this.providerStates[provider];
      state.lastStatus = status;
      state.lastErrorType = 'http_' + status;
      // A validated permanent client error belongs to this request, not to
      // provider health, so it never opens or degrades the provider circuit.
      await this._persistNow();
    }

    async _recordRateLimit(provider, retryAfterValue) {
      const state = this.providerStates[provider];
      const policy = this.policies[provider];
      state.failureCount++;
      state.lastStatus = 429;
      state.lastErrorType = 'rate_limit';
      state.consecutive429s++;
      const escalations = [
        policy.defaultCooldownMs || 2 * 60 * 1000,
        5 * 60 * 1000,
        15 * 60 * 1000,
        30 * 60 * 1000
      ];
      const adaptiveMs = escalations[Math.min(escalations.length - 1, state.consecutive429s - 1)];
      const serverUntil = parseRetryAfter(retryAfterValue, this.now());
      const cappedAdaptiveMs = Math.min(adaptiveMs, policy.maxCooldownMs || 60 * 60 * 1000);
      state.cooldownUntil = Math.max(state.cooldownUntil, serverUntil, this.now() + cappedAdaptiveMs);
      state.circuitState = 'cooldown';
      await this._persistNow();
      return state.cooldownUntil;
    }

    async _recordDisabled(provider, status) {
      const state = this.providerStates[provider];
      state.failureCount++;
      state.lastStatus = status;
      state.lastErrorType = 'authorization';
      state.disabledUntil = Math.max(state.disabledUntil, this.now() + 24 * 60 * 60 * 1000);
      state.circuitState = 'disabled';
      await this._persistNow();
      return state.disabledUntil;
    }

    _dropLowPriority(provider, reason) {
      const queue = this.queues.get(provider) || [];
      const retained = [];
      for (const job of queue) {
        if (isLowPriority(job.spec.priority)) {
          job.resolve(this._fallbackOrError(job, reason));
          this._metric('queueDropped', provider);
        } else retained.push(job);
      }
      queue.splice(0, queue.length, ...retained);
    }

    // Returns a non-mutating scheduling decision for a prospective request.
    // Routing uses this to fail over before it spends a request on a provider
    // that is cooling down, disabled, or blocked by a hard budget.
    getScheduleStatus(provider, options = {}) {
      const policy = this.policies[provider];
      if (!policy) return { allowed: false, hard: true, errorType: 'unknown_provider', waitMs: 0 };
      const now = this.now();
      const availability = this._availability(provider, now);
      if (!availability.allowed) {
        return { allowed: false, hard: true, errorType: availability.errorType, until: availability.until || 0, waitMs: 0 };
      }
      this._pruneState(now);
      const queue = this.queues.get(provider) || [];
      const totalQueued = [...this.queues.values()].reduce((sum, entries) => sum + entries.length, 0);
      if (queue.length >= this.globalPolicy.maxQueueLengthPerProvider || totalQueued >= this.globalPolicy.maxTotalQueueLength) {
        return { allowed: false, hard: true, errorType: 'queue_full', waitMs: 0 };
      }
      const spec = {
        provider,
        priority: options.priority || 'current-player-turn',
        endpointClass: options.endpointClass || 'analysis',
        positionToken: options.positionToken || null
      };
      const budget = this._budgetStatus({ spec, policy }, now);
      // A current-position request may wait for ordinary spacing/window quota;
      // only hard budgets mean that routing must skip this provider entirely.
      return { ...budget, allowed: !budget.hard, until: 0 };
    }

    canSchedule(provider, priority = 'current-player-turn', options = {}) {
      return this.getScheduleStatus(provider, { ...options, priority }).allowed;
    }

    providerStatus(provider) {
      const state = this.providerStates[provider];
      if (!state) return { state: 'unknown', label: 'No recent data' };
      const now = this.now();
      const availability = this._availability(provider, now);
      if (!availability.allowed && availability.errorType === 'disabled') {
        return { state: 'disabled', label: 'Unavailable', until: availability.until };
      }
      if (!availability.allowed) {
        return {
          state: state.lastStatus === 429 ? 'rate-limited' : 'cooldown',
          label: state.lastStatus === 429 ? 'Rate limited' : 'Cooling down',
          until: availability.until
        };
      }
      if (state.circuitState === 'half-open') return { state: 'half-open', label: 'Recovery check pending' };
      if (!state.lastAttemptAt) return { state: 'unknown', label: 'No recent data' };
      if (state.circuitState === 'degraded') return { state: 'degraded', label: 'Unavailable' };
      if (state.recentLatency > 5000) return { state: 'slow', label: 'Slow' };
      return { state: 'healthy', label: 'Healthy' };
    }

    getDiagnostics() {
      const now = this.now();
      this._pruneState(now);
      const count = type => this.metrics.events.filter(event => event.type === type).length;
      const providers = {};
      for (const provider of Object.keys(this.policies)) {
        const state = this.providerStates[provider];
        const status = this.providerStatus(provider);
        providers[provider] = {
          ...status,
          calls: this.metrics.events.filter(event => event.type === 'remoteCall' && event.provider === provider).length,
          cooldownRemainingMs: Math.max(0, (status.until || 0) - now),
          lastAttemptAt: state.lastAttemptAt,
          lastSuccessAt: state.lastSuccessAt,
          recentLatency: state.recentLatency,
          lastStatus: state.lastStatus,
          queueLength: (this.queues.get(provider) || []).length
        };
      }
      return {
        windowMinutes: 10,
        remoteCallsAvoidedByCache: count('cacheHit') + count('negativeHit'),
        requestsCoalesced: count('coalesced'),
        staleResultsServed: count('staleServed'),
        staleJobsDropped: count('staleDropped'),
        providers
      };
    }

    async clearCaches(prefix = '') {
      await this.ready;
      if (!prefix) this.memoryCache.clear();
      else for (const key of this.memoryCache.keys()) if (key.startsWith(prefix)) this.memoryCache.delete(key);
      const removed = this.cacheIndex
        .filter(entry => !prefix || entry.storageKey.slice(CACHE_STORAGE_PREFIX.length).startsWith(prefix))
        .map(entry => entry.storageKey);
      this.cacheIndex = this.cacheIndex.filter(entry => !removed.includes(entry.storageKey));
      if (removed.length) await this.storage.remove(removed);
      await this.storage.set(CACHE_INDEX_STORAGE_KEY, this.cacheIndex);
      // Quotas, cooldowns and passive health intentionally remain untouched.
    }
  }

  const exported = {
    ApiRequestCoordinator,
    canonicalAnalysisFen,
    countFenPieces,
    isPlausibleOpeningFen,
    isEarlyOpeningFen,
    planPositionWorkflow,
    parseRetryAfter,
    PRIORITIES,
    DEFAULT_GLOBAL_POLICY,
    makeMemoryStorage
  };
  root.ApiReliability = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

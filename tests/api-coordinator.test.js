'use strict';
// EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
// This project is a study/research tool for building a chess engine that can
// play in a variety of styles (normal, aggressive, ultra-aggressive). It is
// intended for learning, offline analysis, and engine-variation research. It
// is anti-cheat compliant and fair-play safe: it never assists a player in a
// rated or live online game, and it must not be used to gain an unfair
// advantage against human opponents.
const assert = require('node:assert/strict');
const {
  ApiRequestCoordinator,
  canonicalAnalysisFen,
  parseRetryAfter,
  planPositionWorkflow
} = require('../engine/api-coordinator.js');

class FakeStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  async get(key) { return this.values.get(key); }
  async set(key, value) { this.values.set(key, JSON.parse(JSON.stringify(value))); }
  async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) this.values.delete(key); }
}

class FakeClock {
  constructor(now = 1_000_000) { this.value = now; this.sleeps = []; }
  now = () => this.value;
  sleep = async ms => { this.sleeps.push(ms); this.value += Math.max(0, Math.ceil(ms)); };
  advance(ms) { this.value += ms; }
}

function response(status, data = {}, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => normalized[String(name).toLowerCase()] ?? null },
    async json() { return data; },
    async text() { return JSON.stringify(data); }
  };
}

const policies = {
  test: {
    maxConcurrent: 1,
    minSpacingMs: 1000,
    conservativeRequestsPerMinute: 6,
    defaultCooldownMs: 120_000,
    maxCooldownMs: 3_600_000,
    retry5xx: 0,
    retryNetwork: 0
  }
};

function makeCoordinator({ storage = new FakeStorage(), clock = new FakeClock(), fetchFn, globalPolicy = {} } = {}) {
  return new ApiRequestCoordinator({
    policies,
    storage,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    fetchFn: fetchFn || (async () => response(200, { value: 'ok' })),
    globalPolicy: {
      maxRemoteCallsPerMinute: 12,
      maxRemoteCallsPerGame: 80,
      maxEnrichmentCallsPerMinute: 2,
      reservedCurrentPositionCalls: 3,
      ...globalPolicy
    },
    logger: { warn() {}, error() {}, log() {} }
  });
}

function requestSpec(overrides = {}) {
  return {
    provider: 'test',
    endpointClass: 'analysis',
    cacheKey: 'analysis:test-position',
    priority: 'current-player-turn',
    cachePolicy: {
      freshTtlMs: 100,
      staleTtlMs: 1000,
      negativeTtlMs: 500,
      notFoundTtlMs: 500,
      minRefreshAgeMs: 1,
      persistent: true
    },
    request: { url: 'https://example.test/eval', timeoutMs: 1000 },
    parse: async result => result.json(),
    ...overrides
  };
}

(async () => {
  const base = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq e3 0 1';
  assert.equal(canonicalAnalysisFen(base), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq e3');
  assert.equal(canonicalAnalysisFen(base.replace(' 0 1', ' 42 99')), canonicalAnalysisFen(base), 'safe counters are ignored');
  assert.notEqual(canonicalAnalysisFen(base.replace('KQkq', 'KQ')), canonicalAnalysisFen(base), 'castling rights remain significant');
  assert.notEqual(canonicalAnalysisFen(base.replace('e3', '-')), canonicalAnalysisFen(base), 'en-passant remains significant');

  assert.equal(parseRetryAfter('120', 1_000), 121_000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:03:00 GMT', 60_000), 180_000);
  assert.equal(parseRetryAfter('invalid', 1_000), 0);

  const openingPlan = planPositionWorkflow('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { showOpeningExplorer: true, showTablebase: true });
  assert.deepEqual(openingPlan.analysisSources, ['masters-explorer', 'lichess-cloud', 'chess-api']);
  assert.equal(openingPlan.openingEligible, true);
  assert.equal(openingPlan.tablebaseEligible, false);
  const middlePlan = planPositionWorkflow('4k3/8/8/3p4/3P4/8/8/4K2R w - - 0 30', { showOpeningExplorer: true, showTablebase: true });
  assert.deepEqual(middlePlan.analysisSources, ['chess-api', 'lichess-cloud', 'masters-explorer'], 'after the first five moves, Chess-API leads, then Lichess Cloud, then Masters');
  assert.equal(middlePlan.openingEligible, false);
  assert.equal(middlePlan.tablebaseEligible, true, 'seven-or-fewer-piece positions route to tablebase first');
  const disabledSourcePlan = planPositionWorkflow('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
    useChessApi: false, useLichessCloud: true, useMastersExplorer: false
  });
  assert.deepEqual(disabledSourcePlan.analysisSources, ['lichess-cloud'], 'disabled providers are excluded from routing');

  // Coalescing occurs before queue insertion and one provider never overlaps itself.
  {
    const clock = new FakeClock();
    let calls = 0, active = 0, maxActive = 0;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return response(200, { call: calls });
      }
    });
    const [a, b, c] = await Promise.all([
      coordinator.request(requestSpec()),
      coordinator.request(requestSpec()),
      coordinator.request(requestSpec())
    ]);
    assert.equal(calls, 1);
    assert.equal(maxActive, 1);
    assert.equal(a.data.call, 1);
    assert.equal(b.data.call, 1);
    assert.equal(c.data.call, 1);

    await Promise.all([
      coordinator.request(requestSpec({ cacheKey: 'second' })),
      coordinator.request(requestSpec({ cacheKey: 'third' }))
    ]);
    assert.equal(maxActive, 1, 'per-provider jobs are serialized');
    assert.ok(clock.sleeps.some(ms => ms >= 1000), 'minimum spacing is applied with a fresh clock after waiting');
    await coordinator.flush();
  }

  // Quota timestamps survive a worker restart and still enforce spacing.
  {
    const storage = new FakeStorage();
    const clock = new FakeClock();
    const first = makeCoordinator({ storage, clock });
    await first.request(requestSpec({ cacheKey: 'restart-one' }));
    await first.flush();
    const before = clock.now();
    const second = makeCoordinator({ storage, clock });
    await second.request(requestSpec({ cacheKey: 'restart-two' }));
    assert.ok(clock.now() >= before + 1000, 'restored lastRequestAt prevents a restart burst');
    await second.flush();
  }

  // A 429 persists its Retry-After cooldown and is never retried in-workflow.
  {
    const storage = new FakeStorage();
    const clock = new FakeClock();
    let calls = 0;
    const first = makeCoordinator({
      storage,
      clock,
      fetchFn: async () => { calls++; return response(429, {}, { 'Retry-After': '120' }); }
    });
    const limited = await first.request(requestSpec({ cacheKey: 'limited' }));
    assert.equal(limited.ok, false);
    assert.equal(limited.errorType, 'rate_limit');
    assert.equal(calls, 1);
    await first.flush();

    const restarted = makeCoordinator({
      storage,
      clock,
      fetchFn: async () => { calls++; return response(200, { shouldNotRun: true }); }
    });
    const blocked = await restarted.request(requestSpec({ cacheKey: 'limited-after-restart' }));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorType, 'cooldown');
    assert.equal(calls, 1, 'no provider call occurs during a persisted cooldown');
    await restarted.flush();
  }

  // Router preflight identifies a hard game budget without issuing another call.
  {
    const clock = new FakeClock();
    const coordinator = makeCoordinator({ clock, globalPolicy: { maxRemoteCallsPerGame: 1 } });
    const token = { tabId: 'tab-1', gameId: 'game-1', sequence: 1, canonicalFen: 'position-1' };
    coordinator.updatePosition(token);
    await coordinator.request(requestSpec({ cacheKey: 'budgeted', positionToken: token }));
    const status = coordinator.getScheduleStatus('test', { priority: 'current-player-turn', endpointClass: 'analysis', positionToken: token });
    assert.equal(status.allowed, false);
    assert.equal(status.hard, true);
    assert.equal(status.errorType, 'game_budget');
    await coordinator.flush();
  }

  // Negative caching prevents repeated known-404 traffic.
  {
    const clock = new FakeClock();
    let calls = 0;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => { calls++; return response(404); }
    });
    const first = await coordinator.request(requestSpec({ cacheKey: 'not-found' }));
    const second = await coordinator.request(requestSpec({ cacheKey: 'not-found' }));
    assert.equal(first.negative, true);
    assert.equal(second.negative, true);
    assert.equal(calls, 1);
    await coordinator.flush();
  }

  // Stale-while-usable returns immediately without another provider call.
  {
    const clock = new FakeClock();
    let calls = 0;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => { calls++; return response(200, { value: calls }); }
    });
    await coordinator.request(requestSpec({ cacheKey: 'stale' }));
    clock.advance(150);
    const stale = await coordinator.request(requestSpec({ cacheKey: 'stale' }));
    assert.equal(stale.ok, true);
    assert.equal(stale.stale, true);
    assert.equal(calls, 1);
    await coordinator.flush();
  }

  // Repeated refreshes coalesce, preserve cached fallback, and obey quota.
  {
    const clock = new FakeClock();
    let calls = 0;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => { calls++; await Promise.resolve(); return response(200, { value: calls }); }
    });
    await coordinator.request(requestSpec({ cacheKey: 'refresh' }));
    clock.advance(2);
    const [one, two] = await Promise.all([
      coordinator.request(requestSpec({ cacheKey: 'refresh', refresh: true })),
      coordinator.request(requestSpec({ cacheKey: 'refresh', refresh: true }))
    ]);
    assert.equal(calls, 2, 'two refresh clicks produce one revalidation');
    assert.equal(one.data.value, two.data.value);
    await coordinator.flush();
  }

  // A failed refresh never destroys the previously usable cached result.
  {
    const clock = new FakeClock();
    let calls = 0;
    let fail = false;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => {
        calls++;
        if (fail) throw new Error('offline');
        return response(200, { value: 'cached-good' });
      }
    });
    const fallbackCachePolicy = { ...requestSpec().cachePolicy, staleTtlMs: 5000 };
    await coordinator.request(requestSpec({ cacheKey: 'refresh-fallback', cachePolicy: fallbackCachePolicy }));
    clock.advance(2);
    fail = true;
    const refreshed = await coordinator.request(requestSpec({ cacheKey: 'refresh-fallback', cachePolicy: fallbackCachePolicy, refresh: true }));
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.data.value, 'cached-good');
    assert.equal(refreshed.refreshFailed, true);
    const stillCached = await coordinator.request(requestSpec({ cacheKey: 'refresh-fallback', cachePolicy: fallbackCachePolicy }));
    assert.equal(stillCached.data.value, 'cached-good');
    assert.equal(calls, 2, 'failed refresh preserves cache instead of causing a third call');
    await coordinator.flush();
  }

  // Advancing the position removes queued stale work and blocks stale UI data.
  {
    const clock = new FakeClock();
    let release;
    let calls = 0;
    const coordinator = makeCoordinator({
      clock,
      fetchFn: async () => {
        calls++;
        await new Promise(resolve => { release = resolve; });
        return response(200, { value: calls });
      }
    });
    const oldToken = { tabId: 'active', gameId: 1, sequence: 1, canonicalFen: 'old' };
    const newToken = { tabId: 'active', gameId: 1, sequence: 2, canonicalFen: 'new' };
    coordinator.updatePosition(oldToken);
    const active = coordinator.request(requestSpec({ cacheKey: 'active-old', positionToken: oldToken }));
    while (!release) await Promise.resolve();
    const queued = coordinator.request(requestSpec({ cacheKey: 'queued-old', positionToken: oldToken }));
    await Promise.resolve();
    coordinator.updatePosition(newToken);
    release();
    const [activeResult, queuedResult] = await Promise.all([active, queued]);
    assert.equal(activeResult.stalePosition, true);
    assert.equal(queuedResult.stalePosition, true);
    assert.equal(calls, 1, 'queued old-position work never reaches fetch');
    await coordinator.flush();
  }

  // Low-priority enrichment cannot consume capacity reserved for current positions.
  {
    const clock = new FakeClock();
    let calls = 0;
    const coordinator = makeCoordinator({
      clock,
      globalPolicy: { maxRemoteCallsPerMinute: 2, reservedCurrentPositionCalls: 1 },
      fetchFn: async () => { calls++; return response(200, { value: calls }); }
    });
    await coordinator.request(requestSpec({ cacheKey: 'current' }));
    const enrichment = await coordinator.request(requestSpec({
      cacheKey: 'enrichment',
      endpointClass: 'enrichment',
      priority: 'opening-enrichment'
    }));
    assert.equal(enrichment.ok, false);
    assert.equal(enrichment.errorType, 'reserved_capacity');
    assert.equal(calls, 1);
    await coordinator.flush();
  }

  console.log('api-coordinator tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

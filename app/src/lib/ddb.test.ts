import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { recentBuckets, queryPodFlows, queryEdgeSeries, getFlowsWindow, getFlowsWindowPair,
  flowsCacheSize, ddbSocketAgent, getDns, getCollectionHistory, mapPool,
  cachedLens, lensCacheKey, windowPlan, windowPairPlan } from './ddb';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => { ddbMock.reset(); });
afterEach(() => { vi.useRealTimers(); });

describe('recentBuckets', () => {
  it('returns n descending ISO strings on the 5-min grid in collector format', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T11:47:33.123Z'));
    expect(recentBuckets(3)).toEqual([
      '2026-07-08T11:45:00Z',
      '2026-07-08T11:40:00Z',
      '2026-07-08T11:35:00Z',
    ]);
  });

  it('emits exact grid boundary when now is on the boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    expect(recentBuckets(1)).toEqual(['2026-07-08T12:00:00Z']);
  });
});

describe('queryPodFlows', () => {
  const item = (edgeHash: string, bucket: string) => ({
    pk: `FLOW#${bucket}#nfm-eks-demo`,
    sk: `DATA_TRANSFERRED#INTRA_AZ#${edgeHash}`,
    edgeHash, bucket, monitor: 'nfm-eks-demo',
    metric: 'DATA_TRANSFERRED', category: 'INTRA_AZ', value: 1, unit: 'Bytes',
    a: { podName: 'api-1', podNamespace: 'shop' }, b: {}, traversedConstructs: [],
  });

  it('queries GSI1 and GSI2, merges, dedupes and sorts by bucket desc', async () => {
    const a = item('aaa', '2026-07-08T11:40:00Z');
    const b = item('bbb', '2026-07-08T11:45:00Z');
    const c = item('ccc', '2026-07-08T11:35:00Z');
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.IndexName === 'GSI1') return { Items: [a, b] };
      if (input.IndexName === 'GSI2') return { Items: [b, c] }; // b duplicated across GSIs
      throw new Error(`unexpected index ${input.IndexName}`);
    });

    const flows = await queryPodFlows('shop', 'api-1', 10);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    const indexes = calls.map((call) => call.args[0].input.IndexName).sort();
    expect(indexes).toEqual(['GSI1', 'GSI2']);
    for (const call of calls) {
      const input = call.args[0].input;
      expect(Object.values(input.ExpressionAttributeValues ?? {})).toContain('POD#shop/api-1');
    }
    expect(flows).toHaveLength(3); // deduped: a, b, c
    expect(flows.map((f) => f.edgeHash)).toEqual(['bbb', 'aaa', 'ccc']); // bucket desc
  });

  it('slices to the requested limit after merging', async () => {
    const a = item('aaa', '2026-07-08T11:40:00Z');
    const b = item('bbb', '2026-07-08T11:45:00Z');
    const c = item('ccc', '2026-07-08T11:35:00Z');
    ddbMock.on(QueryCommand).callsFake((input) =>
      input.IndexName === 'GSI1' ? { Items: [a, b] } : { Items: [c] });
    const flows = await queryPodFlows('shop', 'api-1', 2);
    expect(flows.map((f) => f.edgeHash)).toEqual(['bbb', 'aaa']);
  });
});

describe('getFlowsWindow', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  it('queries each of the n recent buckets and concats the flows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T11:47:33.123Z'));
    ddbMock.on(QueryCommand).callsFake((input) => {
      const pk = (input.ExpressionAttributeValues ?? {})[':pk'] as string;
      return { Items: [{ edgeHash: `e-${pk}`, bucket: pk.split('#')[1], monitor: 'nfm-eks-demo' }] };
    });

    const flows = await getFlowsWindow(3);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(3);
    const pks = calls.map((c) => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk']).sort();
    expect(pks).toEqual([
      'FLOW#2026-07-08T11:35:00Z#nfm-eks-demo',
      'FLOW#2026-07-08T11:40:00Z#nfm-eks-demo',
      'FLOW#2026-07-08T11:45:00Z#nfm-eks-demo',
    ]);
    expect(flows).toHaveLength(3); // 1 flow per bucket, concatenated
  });
});

describe('getFlowsWindow in-flight cache', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  // The cache is module-level state: each test pins a fake system time in a
  // LATER 5-min bucket than every earlier test's (monotonic file order), so the
  // version sweep drops prior tests' entries — and the 15s cycle-probe memo
  // (keyed on Date.now deltas) can never leak backwards.
  const flowItem = (pk: string) =>
    ({ edgeHash: `e-${pk}`, bucket: pk.split('#')[1], monitor: 'nfm-eks-demo' });

  it('issues the underlying bucket queries once for concurrent identical calls within the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T13:00:00.000Z'));
    ddbMock.on(QueryCommand).callsFake((input) =>
      ({ Items: [flowItem((input.ExpressionAttributeValues ?? {})[':pk'] as string)] }));

    const [a, b] = await Promise.all([getFlowsWindow(12), getFlowsWindow(12)]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // 12 buckets x 1 monitor, ONCE
    expect(a).toHaveLength(12);
    expect(b).toEqual(a);

    await getFlowsWindow(12); // still within TTL → served from cache, no new queries
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);
  });

  it('stays cached across time within one cycle+bucket, re-queries when the boundary rolls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T14:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    // Collector data only changes per cycle, so mere time passage (well past
    // the old 10s TTL) within the same bucket+cycle must NOT refetch.
    vi.setSystemTime(new Date('2026-07-08T14:00:20.000Z'));
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    // The 5-min grid rolled — the window's bucket list itself shifted.
    vi.setSystemTime(new Date('2026-07-08T14:05:00.001Z'));
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24);
  });

  it('does not cache a rejected fetch (next call within TTL re-queries)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T15:00:00.000Z'));
    ddbMock.on(QueryCommand).rejectsOnce(new Error('boom')).resolves({ Items: [] });

    await expect(getFlowsWindow(12)).rejects.toThrow('boom');

    // Same instant (within TTL) — the rejected promise must have been evicted.
    const flows = await getFlowsWindow(12);
    expect(flows).toEqual([]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24);
  });
});

describe('getDns', () => {
  it('returns the dns attribute of DNS#latest/all when present', async () => {
    const dns = { enabled: true, topDomains: [{ name: 'a.svc.cluster.local', count: 3, internal: true }],
      failures: [], latency: { p50: 1, p90: 2, p95: 3, max: 4, count: 5 }, queryTypes: [],
      resolution: { nodes: [], links: [] }, nameFlow: [] };
    ddbMock.on(GetCommand).resolves({ Item: { pk: 'DNS#latest', sk: 'all', dns } });

    await expect(getDns()).resolves.toEqual(dns);

    const input = ddbMock.commandCalls(GetCommand)[0].args[0].input;
    expect(input.Key).toEqual({ pk: 'DNS#latest', sk: 'all' });
  });

  it('returns null when the item is missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(getDns()).resolves.toBeNull();
  });
});

describe('getCollectionHistory', () => {
  const stats = (rows: number) =>
    ({ started: 4, succeeded: 4, failed: 0, throttled: 0, rows });
  // DDB returns the STATUS#collect partition descending by sk: the 'latest'
  // pointer row ('l' > '2') sorts after every ISO cycleTs, so it arrives FIRST.
  const historyItems = [
    { pk: 'STATUS#collect', sk: 'latest', cycleTs: '2026-07-10T03:10:00Z', stats: stats(120) },
    { pk: 'STATUS#collect', sk: '2026-07-10T03:10:00Z', stats: stats(120) },
    { pk: 'STATUS#collect', sk: '2026-07-10T03:05:00Z', stats: stats(90) },
    { pk: 'STATUS#collect', sk: '2026-07-10T03:00:00Z', stats: stats(150) },
  ];

  it('queries STATUS#collect descending, excludes the latest pointer, returns oldest→newest', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: historyItems });

    const history = await getCollectionHistory(24);

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(Object.values(input.ExpressionAttributeValues ?? {})).toContain('STATUS#collect');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(25); // n + 1 to absorb the 'latest' pointer row
    expect(history).toHaveLength(3); // 'latest' excluded
    expect(history.map((h) => h.cycleTs)).toEqual([
      '2026-07-10T03:00:00Z', '2026-07-10T03:05:00Z', '2026-07-10T03:10:00Z',
    ]); // oldest→newest for left-to-right sparklines
    expect(history.map((h) => h.stats.rows)).toEqual([150, 90, 120]);
    expect(history[2]).toEqual({ cycleTs: '2026-07-10T03:10:00Z', stats: stats(120) });
  });

  it('caps the result at n newest cycles', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: historyItems });
    const history = await getCollectionHistory(2);
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(3);
    expect(history.map((h) => h.cycleTs)).toEqual([
      '2026-07-10T03:05:00Z', '2026-07-10T03:10:00Z',
    ]); // 2 newest, still oldest→newest
  });

  it('returns [] when the partition has no items', async () => {
    ddbMock.on(QueryCommand).resolves({});
    await expect(getCollectionHistory()).resolves.toEqual([]);
  });
});

describe('mapPool', () => {
  it('runs every task exactly once and concatenates all results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    const results = await mapPool(items, 2, async (i) => {
      seen.push(i);
      return i * 10;
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items); // each item processed exactly once
    expect(results).toEqual([10, 20, 30, 40, 50]); // order preserved regardless of completion order
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const limit = 4;
    await mapPool(items, limit, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return null;
    });
    expect(maxInFlight).toBeLessThanOrEqual(limit);
    expect(maxInFlight).toBeGreaterThan(1); // sanity: the pool did overlap work, not run serially
  });

  it('handles a limit larger than the item count (falls back to full parallelism)', async () => {
    const results = await mapPool([1, 2], 40, async (i) => i * 2);
    expect(results).toEqual([2, 4]);
  });

  it('handles an empty items array without invoking fn', async () => {
    const fn = vi.fn(async () => 1);
    const results = await mapPool([] as number[], 5, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('getFlowsWindowPair cache', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  // Same module-level-cache convention as the getFlowsWindow tests above: each
  // test pins a distinct fake system time far (>> TTL) beyond any earlier test's.
  it('serves concurrent and repeat calls within the TTL from one underlying query set', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T15:30:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const [a, b] = await Promise.all([getFlowsWindowPair(6), getFlowsWindowPair(6)]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // 2n buckets x 1 monitor, ONCE
    expect(b).toEqual(a);

    await getFlowsWindowPair(6); // still within TTL → served from cache, no new queries
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);
  });

  it('stays cached within one cycle+bucket, re-queries when the boundary rolls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T16:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindowPair(6);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    vi.setSystemTime(new Date('2026-07-08T16:00:20.000Z')); // same bucket+cycle → cached
    await getFlowsWindowPair(6);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    vi.setSystemTime(new Date('2026-07-08T16:05:00.001Z')); // grid rolled
    await getFlowsWindowPair(6);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24);
  });

  it('does not cache a rejected pair fetch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T16:30:00.000Z'));
    ddbMock.on(QueryCommand).rejects(new Error('boom'));
    await expect(getFlowsWindowPair(6)).rejects.toThrow('boom');

    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const { current, prior } = await getFlowsWindowPair(6); // immediate retry re-queries
    expect(current).toEqual([]);
    expect(prior).toEqual([]);
  });

  it('keeps deduping onto an in-flight fetch that outlives the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T17:30:00.000Z'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ddbMock.on(QueryCommand).callsFake(async () => { await gate; return { Items: [] }; });

    const first = getFlowsWindowPair(6);
    // Time passes while the fetch is still in flight (a 7d window under DDB
    // throttling routinely runs 10s+): within the same cycle+bucket a fresh
    // call must join the pending fetch, never launch a duplicate fan-out.
    vi.setSystemTime(new Date('2026-07-08T17:30:10.001Z'));
    const second = getFlowsWindowPair(6);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // ONE underlying query set
    expect(b).toEqual(a);
  });

  it('shares one concurrency budget across both pair halves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T18:30:00.000Z'));
    let inFlight = 0;
    let maxInFlight = 0;
    ddbMock.on(QueryCommand).callsFake(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); // yield so concurrent workers overlap
      inFlight--;
      return { Items: [] };
    });

    await getFlowsWindowPair(60); // n=60 > 36 -> 2x5 closed-hour HFLOW parts across the two halves

    // Two per-half pools would double the fan-out ceiling past the socket pool
    // (2 x BUCKET_QUERY_CONCURRENCY x monitors) — the halves must share one.
    expect(maxInFlight).toBeLessThanOrEqual(40);
  });
});

describe('flows cache eviction', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  it('drops stale-version entries on the next cache access so old windows are not retained', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T19:30:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindow(12); // sweeps every stale entry from earlier tests, then caches w:12
    await getFlowsWindowPair(6);
    expect(flowsCacheSize()).toBe(2);

    vi.setSystemTime(new Date('2026-07-08T19:35:00.001Z')); // boundary rolled → both stale
    await getFlowsWindow(3);
    expect(flowsCacheSize()).toBe(1); // only the fresh n=3 entry survives
  });
});

describe('flows cache versioning (collector cycle)', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  // The cycle probe (STATUS#collect latest) is memoized ~15s, so tests advance
  // 20s between phases to force a re-probe while staying inside one 5-min bucket.
  it('re-queries when the collector writes a new cycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T20:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });

    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    vi.setSystemTime(new Date('2026-07-08T20:00:20.000Z')); // same bucket; probe memo expired
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'B', stats: {} } });
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(24); // new data → refetch
  });

  it('falls back to boundary-only versioning when the status probe fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T20:30:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).rejects(new Error('status unavailable'));

    await getFlowsWindow(12); // probe failure must not fail the request
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    vi.setSystemTime(new Date('2026-07-08T20:30:20.000Z')); // still same bucket
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // still cached
  });

  it('keeps deduping onto an in-flight fetch across a version roll', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T22:04:50.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ddbMock.on(QueryCommand).callsFake(async () => { await gate; return { Items: [] }; });

    const first = getFlowsWindowPair(6);
    await vi.advanceTimersByTimeAsync(0); // drain microtasks so the entry lands pre-roll

    // The 5-min grid rolls while the fetch is still in flight. A pending fetch
    // must keep absorbing callers (its data is at most one cycle stale) —
    // sweeping it re-launches the same full fan-out concurrently, the exact
    // pileup the 2026-07-14 OOM hotfix removed.
    vi.setSystemTime(new Date('2026-07-08T22:05:00.001Z'));
    const second = getFlowsWindowPair(6);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // ONE fan-out
    expect(b).toEqual(a);
  });

  it('keeps the last known cycle when the probe starts failing (no flush flip-flop)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T22:20:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'STICKY', stats: {} } });

    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12);

    // A transient probe blip (DDB throttling — likeliest exactly under load)
    // must not flip the version and flush every cached window.
    vi.setSystemTime(new Date('2026-07-08T22:20:20.000Z')); // memo expired, same bucket
    ddbMock.on(GetCommand).rejects(new Error('throttled'));
    await getFlowsWindow(12);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // still cached
  });

  it('memoizes the cycle probe — at most one STATUS GetCommand per memo window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T22:40:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });

    await getFlowsWindow(12);
    await getFlowsWindow(6);
    await cachedLens('probe-memo-check', async () => 1);

    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
  });

  it('clears the idle timer when an entry is dropped, so nothing pins evicted results', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T23:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });

    await getFlowsWindow(12); // settles → arms its idle timer
    expect(vi.getTimerCount()).toBe(1);

    vi.setSystemTime(new Date('2026-07-08T23:05:00.001Z')); // roll → old entry swept
    await getFlowsWindow(12);
    // The swept entry's timer must be cleared — a live timer closure would keep
    // the old window's flow arrays reachable for the full 330s max-age.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cap eviction never drops a pending fetch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T23:20:00.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ddbMock.on(QueryCommand).callsFake(async () => { await gate; return { Items: [] }; });

    const pending = getFlowsWindowPair(6); // in flight, held open by the gate
    await vi.advanceTimersByTimeAsync(0); // entry lands as the OLDEST key in the map

    // Param churn floods the cache past the 200-entry cap while the fetch is
    // still in flight — the oldest-first eviction must skip the pending entry.
    for (let i = 0; i < 230; i++) await cachedLens(`churn:${i}`, async () => i);

    const joined = getFlowsWindowPair(6); // must join the pending fetch, not re-launch
    release();
    await Promise.all([pending, joined]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(12); // ONE fan-out
  });
});

describe('cachedLens (route aggregate cache)', () => {
  it('computes once per key per version and returns the cached result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T00:30:00.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });
    const compute = vi.fn(async () => ({ total: 42 }));

    const a = await cachedLens('cost?buckets=12', compute);
    const b = await cachedLens('cost?buckets=12', compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it('keys results by cache key so different params never collide', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T00:40:00.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });
    const c1 = vi.fn(async () => 1);
    const c2 = vi.fn(async () => 2);

    expect(await cachedLens('net?buckets=12', c1)).toBe(1);
    expect(await cachedLens('net?buckets=72', c2)).toBe(2);
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the collector cycle changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T00:50:00.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });
    const compute = vi.fn(async () => 'v');

    await cachedLens('movers?buckets=6', compute);
    vi.setSystemTime(new Date('2026-07-09T00:50:20.000Z')); // probe memo expired
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'B', stats: {} } });
    await cachedLens('movers?buckets=6', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('caps the cache entry count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T01:00:00.000Z'));
    ddbMock.on(GetCommand).resolves({ Item: { cycleTs: 'A', stats: {} } });

    for (let i = 0; i < 230; i++) await cachedLens(`cap:${i}`, async () => i);
    expect(flowsCacheSize()).toBeLessThanOrEqual(200);
  });
});

describe('lensCacheKey', () => {
  it('is stable across query-param order and distinct per route', () => {
    expect(lensCacheKey('cost', 'https://x/api/analytics/cost?b=2&a=1'))
      .toBe(lensCacheKey('cost', 'https://x/api/analytics/cost?a=1&b=2'));
    expect(lensCacheKey('cost', 'https://x/api?a=1'))
      .not.toBe(lensCacheKey('latency', 'https://x/api?a=1'));
    expect(lensCacheKey('anomalies', 'https://x/api?buckets=12&sigma=3'))
      .toContain('sigma=3');
  });

  it('re-encodes params so delimiter characters inside values cannot forge a colliding key', () => {
    // buckets=12%26sigma%3D9 is ONE param whose value contains '&sigma=9' after
    // decoding — it must never share a cache key with the two-param request.
    expect(lensCacheKey('anomalies', 'https://x/api?buckets=12%26sigma%3D9'))
      .not.toBe(lensCacheKey('anomalies', 'https://x/api?buckets=12&sigma=9'));
  });
});

describe('ddb socket pool', () => {
  it('uses a keep-alive agent sized above the query fan-out ceiling', () => {
    expect(ddbSocketAgent.options.keepAlive).toBe(true);
    // One window/pair fetch keeps BUCKET_QUERY_CONCURRENCY(40) buckets in flight
    // x ~5 monitors ≈ 200 concurrent queries, and two differently-keyed fetches
    // (e.g. w:2016 + p:2016) can overlap — the pool must cover ~400, with room
    // for monitor growth. The SDK default 50-socket agent queued the rest
    // (observed live as socket-capacity warnings + menu latency + queue-held
    // memory before the OOM).
    expect(ddbSocketAgent.maxSockets).toBeGreaterThanOrEqual(400);
  });
});

describe('queryEdgeSeries', () => {
  it('queries GSI3 by EDGE#<hash> newest first with limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ edgeHash: 'abc', bucket: '2026-07-08T11:45:00Z' }] });
    const series = await queryEdgeSeries('abc', 50);
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.IndexName).toBe('GSI3');
    expect(Object.values(input.ExpressionAttributeValues ?? {})).toContain('EDGE#abc');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(50);
    expect(series).toHaveLength(1);
  });
});

describe('windowPlan / windowPairPlan', () => {
  it('n <= 36 stays raw and matches recentBuckets exactly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:00:00.000Z'));
    const plan = windowPlan(12);
    expect(plan.parts.every(p => p.grain === 'raw')).toBe(true);
    expect(plan.buckets).toEqual(recentBuckets(12));
    expect(plan.windowSeconds).toBe(12 * 300);
  });

  it('n > 36 quantizes to H=round(n/12) closed hours plus the open-hour 5-min tail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:17:33.000Z')); // open hour 02:00, tail = 02:00..02:15
    const plan = windowPlan(288); // 24h -> H=24
    const raw = plan.parts.filter(p => p.grain === 'raw');
    const hourly = plan.parts.filter(p => p.grain === 'hourly');
    expect(raw.map(p => p.bucket)).toEqual(
      ['2026-07-09T02:15:00Z', '2026-07-09T02:10:00Z', '2026-07-09T02:05:00Z', '2026-07-09T02:00:00Z']);
    expect(hourly).toHaveLength(24);
    expect(hourly[0].bucket).toBe('2026-07-09T01:00:00Z'); // newest CLOSED hour
    expect(hourly[23].bucket).toBe('2026-07-08T02:00:00Z');
    expect(plan.buckets).toEqual(plan.parts.map(p => p.bucket)); // newest-first, tail then hours
    expect(plan.windowSeconds).toBe(24 * 3600 + 4 * 300);
  });

  it('7d (2016) plans 168 closed hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T03:02:00.000Z'));
    const plan = windowPlan(2016);
    expect(plan.parts.filter(p => p.grain === 'hourly')).toHaveLength(168);
  });

  it('pair plan over 36 buckets is symmetric closed hours with NO tail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T03:20:00.000Z')); // open hour 03:00
    const pair = windowPairPlan(288); // H=24 per half
    expect(pair.current).toHaveLength(24);
    expect(pair.prior).toHaveLength(24);
    expect(pair.current.every(p => p.grain === 'hourly')).toBe(true);
    expect(pair.current[0].bucket).toBe('2026-07-09T02:00:00Z'); // newest closed hour
    expect(pair.prior[0].bucket).toBe('2026-07-08T02:00:00Z');   // continues where current ends
    expect(pair.windowSeconds).toBe(24 * 3600);
  });

  it('pair plan at or under 36 buckets keeps the raw split', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T04:00:00.000Z'));
    const pair = windowPairPlan(6);
    expect(pair.current.every(p => p.grain === 'raw')).toBe(true);
    expect(pair.current.map(p => p.bucket)).toEqual(recentBuckets(12).slice(0, 6));
    expect(pair.prior.map(p => p.bucket)).toEqual(recentBuckets(12).slice(6));
  });

  // NO fake timers on purpose (exempt from the file's monotonic-fake-time
  // convention): the injectable `now` alone must determine every bucket string,
  // including the raw tail that recentBuckets produces — otherwise callers
  // passing a historical `now` would silently mix in wall-clock buckets.
  it('an explicit now parameter determines every bucket without fake timers', () => {
    const plan = windowPlan(288, Date.parse('2026-07-01T10:17:00Z')); // open hour 10:00
    const raw = plan.parts.filter(p => p.grain === 'raw');
    const hourly = plan.parts.filter(p => p.grain === 'hourly');
    expect(raw.map(p => p.bucket)).toEqual(
      ['2026-07-01T10:15:00Z', '2026-07-01T10:10:00Z', '2026-07-01T10:05:00Z', '2026-07-01T10:00:00Z']);
    expect(hourly[0].bucket).toBe('2026-07-01T09:00:00Z');
  });
});

describe('grain-aware window fetch', () => {
  const prevMonitors = process.env.MONITORS;
  beforeEach(() => { process.env.MONITORS = 'nfm-eks-demo=eks-demo'; });
  afterEach(() => {
    if (prevMonitors === undefined) delete process.env.MONITORS;
    else process.env.MONITORS = prevMonitors;
  });

  it('n > 36 queries HFLOW partitions for closed hours and FLOW for the tail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T05:07:00.000Z')); // tail = 05:05, 05:00
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getFlowsWindow(288);

    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string)
      .filter(pk => pk?.startsWith('FLOW#') || pk?.startsWith('HFLOW#'));
    const hflow = pks.filter(pk => pk.startsWith('HFLOW#'));
    const flow = pks.filter(pk => pk.startsWith('FLOW#'));
    expect(hflow).toHaveLength(24); // 24 closed hours x 1 monitor
    expect(hflow).toContain('HFLOW#2026-07-09T04:00:00Z#nfm-eks-demo');
    expect(flow).toHaveLength(2);   // 05:05 + 05:00 tail
    expect(flow).toContain('FLOW#2026-07-09T05:05:00Z#nfm-eks-demo');
  });

  it('n <= 36 keeps today\'s raw path byte-identical', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T06:00:00.000Z'));
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await getFlowsWindow(12);
    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string)
      .filter(pk => pk?.startsWith('FLOW#'));
    expect(pks).toHaveLength(12);
  });

  it('pair with n > 36 fetches 2H closed hours, split symmetrically, no tail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T07:03:00.000Z'));
    ddbMock.on(QueryCommand).callsFake((input) => {
      const pk = (input.ExpressionAttributeValues ?? {})[':pk'] as string;
      if (!pk?.startsWith('HFLOW#')) return { Items: [] };
      return { Items: [{ edgeHash: `e-${pk}`, bucket: pk.split('#')[1],
        monitor: 'nfm-eks-demo', value: 1 }] };
    });

    const { current, prior } = await getFlowsWindowPair(288);

    expect(current).toHaveLength(24);
    expect(prior).toHaveLength(24);
    expect(current[0].bucket).toBe('2026-07-09T06:00:00Z'); // newest closed hour
    const pks = ddbMock.commandCalls(QueryCommand)
      .map(c => (c.args[0].input.ExpressionAttributeValues ?? {})[':pk'] as string);
    expect(pks.filter(pk => pk?.startsWith('FLOW#'))).toHaveLength(0); // no tail
  });
});

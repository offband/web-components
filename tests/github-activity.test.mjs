import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.HTMLElement = class {};
globalThis.customElements = {
  define() {},
  get() { return undefined; }
};

const {
  CACHE_FRESH_TTL_MS,
  CACHE_STALE_TTL_MS,
  activityCacheKey,
  fetchActivity,
  loadActivity,
  normalizeCommit,
  parseLimit,
  parseRepos,
  relativeTime,
  repoCommitsUrl
} = await import('../components/github-activity/github-activity.js');

const NOW = Date.parse('2026-09-27T12:00:00Z');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value(key) { return values.get(key); }
  };
}

function cachedRecord(savedAt, items, failedRepos = []) {
  return JSON.stringify({ version: 1, savedAt: new Date(savedAt).toISOString(), items, failedRepos });
}

function normalized(repo = 'sift', sha = 'a'.repeat(7)) {
  return {
    sha,
    repo,
    message: 'Cached change',
    date: '2026-09-27T11:00:00.000Z',
    url: `https://github.com/offband/${repo}/commit/${sha}`,
    repoUrl: `https://github.com/offband/${repo}`
  };
}

function commit(sha, date, message = 'Change') {
  return {
    sha,
    html_url: 'https://attacker.example/not-used',
    commit: {
      message,
      committer: { date }
    }
  };
}

test('parses only explicit valid repository names', () => {
  assert.deepEqual(parseRepos('sift, dredge,../all,sift,site ctl,sitectl'), [
    'sift',
    'dredge',
    'sitectl'
  ]);
  assert.deepEqual(parseRepos(''), []);
});

test('constrains limits', () => {
  assert.equal(parseLimit(undefined), 5);
  assert.equal(parseLimit('0'), 1);
  assert.equal(parseLimit('200'), 20);
});

test('constructs only repository-scoped API requests', () => {
  const url = new URL(repoCommitsUrl('offband', 'sift', 4));
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(url.pathname, '/repos/offband/sift/commits');
  assert.equal(url.searchParams.get('per_page'), '4');
});

test('cache keys normalize repository order, case, and duplicates', () => {
  assert.equal(
    activityCacheKey({ account: 'Offband', repos: 'Sitectl,sift,SIFT', limit: '6' }),
    activityCacheKey({ account: 'offband', repos: ['sift', 'sitectl'], limit: 6 })
  );
});

test('normalizes safe GitHub links without trusting API URLs', () => {
  const item = normalizeCommit(
    'offband',
    'sift',
    commit('a'.repeat(40), '2026-09-27T12:00:00Z', 'First line\nDetails')
  );
  assert.equal(item.message, 'First line');
  assert.equal(item.url, `https://github.com/offband/sift/commit/${'a'.repeat(40)}`);
  assert.equal(item.repoUrl, 'https://github.com/offband/sift');
});

test('selects commits chronologically across configured repositories', async () => {
  const requests = [];
  const payloads = {
    sift: [commit('a'.repeat(40), '2026-09-25T00:00:00Z', 'Sift')],
    dredge: [commit('b'.repeat(40), '2026-09-27T00:00:00Z', 'Dredge')],
    sitectl: [commit('c'.repeat(40), '2026-09-26T00:00:00Z', 'Sitectl')]
  };
  const fetchImpl = async (url) => {
    requests.push(url);
    const repo = new URL(url).pathname.split('/')[3];
    return { ok: true, json: async () => payloads[repo] };
  };

  const result = await fetchActivity({
    account: 'offband',
    repos: ['sift', 'dredge', 'sitectl'],
    limit: 2,
    fetchImpl
  });

  assert.deepEqual(result.items.map((item) => item.repo), ['dredge', 'sitectl']);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => url.startsWith('https://api.github.com/repos/offband/')));
  assert.ok(requests.every((url) => !url.includes('/users/') && !url.includes('/orgs/')));
});

test('keeps successful repositories when another is unavailable', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/missing/')) return { ok: false, status: 404 };
    return {
      ok: true,
      json: async () => [commit('d'.repeat(40), '2026-09-27T00:00:00Z')]
    };
  };
  const result = await fetchActivity({
    account: 'offband',
    repos: ['sift', 'missing'],
    limit: 4,
    fetchImpl
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.failedRepos, ['missing']);
});

test('fresh cache is returned without a live request', async () => {
  const options = { account: 'offband', repos: ['sift'], limit: 4 };
  const key = activityCacheKey(options);
  let fetches = 0;
  const result = await loadActivity({
    ...options,
    now: NOW,
    storage: storage({ [key]: cachedRecord(NOW - CACHE_FRESH_TTL_MS, [normalized()]) }),
    fetchImpl: async () => { fetches += 1; }
  });
  assert.equal(result.source, 'cache');
  assert.equal(result.items[0].repo, 'sift');
  assert.equal(fetches, 0);
});

test('stale cache renders immediately while live data revalidates and replaces it', async () => {
  const options = { account: 'offband', repos: ['sift'], limit: 4 };
  const key = activityCacheKey(options);
  const store = storage({ [key]: cachedRecord(NOW - CACHE_FRESH_TTL_MS - 1, [normalized()]) });
  const seen = [];
  const result = await loadActivity({
    ...options,
    now: () => NOW,
    storage: store,
    onCached: (value) => seen.push(value.items[0].message),
    fetchImpl: async () => ({ ok: true, json: async () => [commit('b'.repeat(40), '2026-09-27T12:00:00Z', 'Fresh')] })
  });
  assert.deepEqual(seen, ['Cached change']);
  assert.equal(result.source, 'live');
  assert.equal(result.items[0].message, 'Fresh');
  assert.equal(JSON.parse(store.value(key)).items[0].message, 'Fresh');
});

test('live failure falls back to allowed stale cache', async () => {
  const options = { account: 'offband', repos: ['sift'], limit: 4 };
  const key = activityCacheKey(options);
  const result = await loadActivity({
    ...options,
    now: NOW,
    storage: storage({ [key]: cachedRecord(NOW - CACHE_FRESH_TTL_MS - 1, [normalized()]) }),
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  assert.equal(result.source, 'stale');
  assert.equal(result.stale, true);
});

test('cache older than the stale window is ignored', async () => {
  const options = { account: 'offband', repos: ['sift'], limit: 4 };
  const key = activityCacheKey(options);
  await assert.rejects(loadActivity({
    ...options,
    now: NOW,
    storage: storage({ [key]: cachedRecord(NOW - CACHE_STALE_TTL_MS - 1, [normalized()]) }),
    fetchImpl: async () => ({ ok: false, status: 404 })
  }), /configured repositories/);
});

test('storage read and write failures do not break live rendering', async () => {
  const readDenied = { getItem() { throw new Error('denied'); }, setItem() {} };
  const writeDenied = { getItem() { return null; }, setItem() { throw new Error('quota'); } };
  for (const store of [readDenied, writeDenied]) {
    const result = await loadActivity({
      account: 'offband', repos: ['sift'], now: NOW, storage: store,
      fetchImpl: async () => ({ ok: true, json: async () => [commit('c'.repeat(40), '2026-09-27T12:00:00Z')] })
    });
    assert.equal(result.items.length, 1);
  }
});

test('partial success is cached with scoped failure metadata', async () => {
  const options = { account: 'offband', repos: ['sift', 'missing'], limit: 4 };
  const key = activityCacheKey(options);
  const store = storage();
  const result = await loadActivity({
    ...options, now: NOW, storage: store,
    fetchImpl: async (url) => url.includes('/missing/')
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => [commit('d'.repeat(40), '2026-09-27T12:00:00Z')] }
  });
  assert.deepEqual(result.failedRepos, ['missing']);
  assert.deepEqual(JSON.parse(store.value(key)).failedRepos, ['missing']);
});

test('cached data cannot expand beyond explicitly configured repositories', async () => {
  const options = { account: 'offband', repos: ['sift'], limit: 4 };
  const key = activityCacheKey(options);
  const result = await loadActivity({
    ...options, now: NOW,
    storage: storage({ [key]: cachedRecord(NOW, [normalized('sift'), normalized('secret', 'b'.repeat(7))]) }),
    fetchImpl: async () => { throw new Error('must not fetch'); }
  });
  assert.deepEqual(result.items.map((item) => item.repo), ['sift']);
});

test('network and 5xx failures retry once, while 404 does not retry', async () => {
  for (const first of [new TypeError('network'), { ok: false, status: 503 }]) {
    let calls = 0;
    const delays = [];
    const result = await fetchActivity({
      account: 'offband', repos: ['sift'],
      sleep: async (delay) => delays.push(delay), random: () => 0.5,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          if (first instanceof Error) throw first;
          return first;
        }
        return { ok: true, json: async () => [commit('e'.repeat(40), '2026-09-27T12:00:00Z')] };
      }
    });
    assert.equal(result.items.length, 1);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [150]);
  }

  let calls = 0;
  await assert.rejects(fetchActivity({
    account: 'offband', repos: ['missing'], sleep: async () => {},
    fetchImpl: async () => { calls += 1; return { ok: false, status: 404 }; }
  }), /configured repositories/);
  assert.equal(calls, 1);
});

test('fails explicitly when every configured repository is unavailable', async () => {
  await assert.rejects(
    fetchActivity({
      account: 'offband',
      repos: ['missing'],
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /configured repositories/
  );
});

test('formats relative timestamps', () => {
  assert.equal(relativeTime('2026-09-27T11:00:00Z', Date.parse('2026-09-27T12:00:00Z')), '1 hour ago');
});

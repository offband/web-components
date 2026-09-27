import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.HTMLElement = class {};
globalThis.customElements = {
  define() {},
  get() { return undefined; }
};

const {
  fetchActivity,
  normalizeCommit,
  parseLimit,
  parseRepos,
  relativeTime,
  repoCommitsUrl
} = await import('../components/github-activity/github-activity.js');

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

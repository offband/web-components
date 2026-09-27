const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const ACCOUNT_PATTERN = /^(?!-)[a-z0-9-]{1,39}(?<!-)$/i;
const REPO_PATTERN = /^(?!\.{1,2}$)[a-z0-9._-]{1,100}$/i;
const stylesheetUrl = new URL('./github-activity.css', import.meta.url);

export function parseAccount(value) {
  const account = String(value || '').trim();
  return ACCOUNT_PATTERN.test(account) ? account : '';
}

export function parseRepos(value) {
  const candidates = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();

  return candidates.reduce((repos, candidate) => {
    const repo = String(candidate || '').trim();
    const key = repo.toLowerCase();
    if (!REPO_PATTERN.test(repo) || seen.has(key)) return repos;
    seen.add(key);
    repos.push(repo);
    return repos;
  }, []);
}

export function parseLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

export function relativeTime(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'recently';

  const elapsed = Math.max(0, now - timestamp);
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const unit = units.find(([, milliseconds]) => elapsed >= milliseconds);
  if (!unit) return 'just now';
  return formatter.format(-Math.floor(elapsed / unit[1]), unit[0]);
}

export function safeRepoUrl(account, repo) {
  const safeAccount = parseAccount(account);
  const safeRepo = parseRepos([repo])[0];
  if (!safeAccount || !safeRepo) return '';
  return `https://github.com/${safeAccount}/${safeRepo}`;
}

export function normalizeCommit(account, repo, commit) {
  const sha = String(commit?.sha || '').trim();
  const date = commit?.commit?.committer?.date || commit?.commit?.author?.date || '';
  const timestamp = new Date(date).getTime();
  const repoUrl = safeRepoUrl(account, repo);

  if (!repoUrl || !/^[a-f0-9]{7,64}$/i.test(sha) || !Number.isFinite(timestamp)) {
    return null;
  }

  const firstLine = String(commit?.commit?.message || 'Commit').split('\n')[0].trim();
  return {
    sha: sha.slice(0, 7),
    repo,
    message: firstLine || 'Commit',
    date: new Date(timestamp).toISOString(),
    url: `${repoUrl}/commit/${sha}`,
    repoUrl
  };
}

export function repoCommitsUrl(account, repo, limit) {
  const base = safeRepoUrl(account, repo);
  if (!base) return '';
  const url = new URL(base.replace('https://github.com/', 'https://api.github.com/repos/') + '/commits');
  url.searchParams.set('per_page', String(parseLimit(limit)));
  return url.href;
}

export async function fetchActivity({ account, repos, limit = DEFAULT_LIMIT, signal, fetchImpl = fetch }) {
  const safeAccount = parseAccount(account);
  const safeRepos = parseRepos(repos);
  const safeLimit = parseLimit(limit);

  if (!safeAccount || !safeRepos.length) {
    throw new TypeError('GitHub activity requires a valid account and at least one explicit repository.');
  }

  const requests = safeRepos.map(async (repo) => {
    const response = await fetchImpl(repoCommitsUrl(safeAccount, repo, safeLimit), {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) throw new Error(`${repo}: GitHub returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error(`${repo}: invalid GitHub response`);
    return payload.map((commit) => normalizeCommit(safeAccount, repo, commit)).filter(Boolean);
  });

  const settled = await Promise.allSettled(requests);
  const failedRepos = [];
  const items = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else failedRepos.push(safeRepos[index]);
  });

  if (failedRepos.length === safeRepos.length) {
    throw new Error('GitHub activity is unavailable for the configured repositories.');
  }

  return {
    items: items
      .sort((left, right) => new Date(right.date) - new Date(left.date))
      .slice(0, safeLimit),
    failedRepos
  };
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function activityLink(className, text, href, label) {
  const link = element('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (label) link.setAttribute('aria-label', label);
  return link;
}

export class GitHubActivity extends HTMLElement {
  static observedAttributes = ['account', 'repos', 'limit'];

  #request = 0;
  #controller;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = stylesheetUrl.href;

    this.region = element('section', 'activity');
    this.region.setAttribute('aria-label', 'Recent GitHub activity');
    this.region.setAttribute('aria-live', 'polite');
    root.append(stylesheet, this.region);
  }

  connectedCallback() {
    this.refresh();
  }

  disconnectedCallback() {
    this.#controller?.abort();
  }

  attributeChangedCallback(_name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) this.refresh();
  }

  get account() {
    return this.getAttribute('account') || '';
  }

  set account(value) {
    this.setAttribute('account', value);
  }

  get repos() {
    return parseRepos(this.getAttribute('repos'));
  }

  set repos(value) {
    this.setAttribute('repos', parseRepos(value).join(','));
  }

  get limit() {
    return parseLimit(this.getAttribute('limit'));
  }

  set limit(value) {
    this.setAttribute('limit', String(parseLimit(value)));
  }

  async refresh() {
    const request = ++this.#request;
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#renderState('loading', 'Loading recent GitHub activity…');

    try {
      const result = await fetchActivity({
        account: this.account,
        repos: this.repos,
        limit: this.limit,
        signal: this.#controller.signal
      });
      if (request !== this.#request) return;
      if (!result.items.length) {
        this.#renderState('empty', 'No recent public commits were found.');
        return;
      }
      this.#renderItems(result.items, result.failedRepos);
    } catch (error) {
      if (error?.name === 'AbortError' || request !== this.#request) return;
      this.#renderState('error', error instanceof TypeError
        ? error.message
        : 'Recent GitHub activity is temporarily unavailable.');
    }
  }

  #renderState(state, message) {
    this.region.replaceChildren();
    this.region.dataset.state = state;
    this.region.setAttribute('aria-busy', String(state === 'loading'));
    const status = element('p', 'status', message);
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    this.region.append(status);
  }

  #renderItems(items, failedRepos) {
    this.region.replaceChildren();
    this.region.dataset.state = 'ready';
    this.region.setAttribute('aria-busy', 'false');
    const list = element('ol', 'list');

    items.forEach((item) => {
      const row = element('li', 'item');
      const identity = element('div', 'identity');
      identity.append(
        activityLink('sha', item.sha, item.url, `View commit ${item.sha} in ${item.repo}`),
        activityLink('repo', item.repo, item.repoUrl, `View ${item.repo} on GitHub`)
      );
      const message = activityLink('message', item.message, item.url, `View commit: ${item.message}`);
      const time = element('time', 'time', relativeTime(item.date));
      time.dateTime = item.date;
      time.title = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeZone: 'UTC'
      }).format(new Date(item.date));
      row.append(identity, message, time);
      list.append(row);
    });

    this.region.append(list);
    if (failedRepos.length) {
      const note = element(
        'p',
        'notice',
        `${failedRepos.length} configured ${failedRepos.length === 1 ? 'repository is' : 'repositories are'} unavailable.`
      );
      this.region.append(note);
    }
  }
}

if (!customElements.get('github-activity')) {
  customElements.define('github-activity', GitHubActivity);
}

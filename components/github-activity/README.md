# `<github-activity>`

Displays recent commits from an explicit list of public GitHub repositories.
The component uses GitHub's unauthenticated public API and does not discover
repositories or read generated site data.

```html
<script type="module" src="./github-activity.js"></script>

<github-activity
  account="offband"
  repos="sift,dredge,sitectl"
  limit="4">
</github-activity>
```

## Public API

| Attribute/property | Required | Description |
| --- | --- | --- |
| `account` | Yes | GitHub user or organization that owns every configured repository. |
| `repos` | Yes | Comma-separated repository names. The matching property accepts a string or array. |
| `limit` | No | Total commits to display. Defaults to 5 and is constrained to 1–20. |

`refresh()` repeats the request using the current attributes. Changing a public
attribute or property refreshes a connected component automatically.

Repository names are never discovered. Invalid names are ignored, unavailable
repositories do not expand the configured scope, and one failed repository does
not suppress successful results from the others. If every configured repository
fails, the component shows its error state.

## States and accessibility

The shadow DOM contains a labelled live region and an ordered list. Loading and
empty states use a status message; the error state uses an alert. Commit and
repository links are constructed only from validated account, repository, and
commit identifiers and always point to `https://github.com`.

## Theming

Set these custom properties on the element or an ancestor:

| Property | Default |
| --- | --- |
| `--github-activity-background` | `#0d1117` |
| `--github-activity-color` | `#e8eaed` |
| `--github-activity-muted-color` | `#8b949e` |
| `--github-activity-accent` | `#ff7817` |
| `--github-activity-repo-color` | `#56d364` |
| `--github-activity-error-color` | `#ff7b72` |
| `--github-activity-border` | `#30363d` |
| `--github-activity-radius` | `0.5rem` |
| `--github-activity-font` | system monospace stack |
| `--github-activity-font-size` | `0.875rem` |
| `--github-activity-gap` | `1rem` |
| `--github-activity-item-padding` | `1rem` |

The component does not inherit structural styles from a host site.

## Network behavior

The component requests:

```text
GET https://api.github.com/repos/{account}/{repo}/commits?per_page={limit}
```

No token is sent. GitHub applies its unauthenticated API rate limit per source
address. Private repositories and OAuth are intentionally unsupported.

## Standalone example

From the repository root:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/components/github-activity/example.html>.

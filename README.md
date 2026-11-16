# Local Jira Board

A localhost Kanban board for every Jira Cloud ticket assigned to you or reported by you, across every project. It is meant to sit on your machine so you do not have to hop between Jira boards.

The browser talks only to the local server. The server talks to Jira (when a token is present) using Basic auth with your email and API token.

## Run

Requires Node 20 or newer. There are no package dependencies.

```bash
cd local_jira_dashboard
npm start
```

Then open [http://127.0.0.1:8787](http://127.0.0.1:8787).

To force demo data even if a token is configured:

```bash
npm run start:mock
```

If `JIRA_BASE_URL`, `JIRA_EMAIL` or the token is missing, the server starts in demo mode automatically and the page shows which setting is missing.

## Setup (live Jira data)

1. Create an API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/tokens): **Security → API tokens → Create API token**.
2. Copy the example env file and fill it in:

   ```bash
   cp .env.example .env
   ```

   Fields:

   | Variable | Purpose |
   | --- | --- |
   | `JIRA_BASE_URL` | Required. Your Jira Cloud site, no trailing slash, e.g. `https://your-site.atlassian.net` |
   | `JIRA_EMAIL` | Required. The Atlassian account email the token belongs to, e.g. `you@example.com` |
   | `JIRA_API_TOKEN` | Required. The token itself (or use the Keychain option below) |
   | `PORT` | Optional listen port. Default: `8787` |
   | `MOCK` | Set to `1` to force demo mode |
   | `JIRA_KEYCHAIN_SERVICE` | Optional macOS Keychain service name. Default: `jira-api-token` |

3. Restart `npm start`. The setup banner should disappear and your tickets will load.

Never commit `.env`. The token is not printed or logged.

### macOS Keychain fallback

If `JIRA_API_TOKEN` is empty, the server will look up a generic password on macOS:

```bash
security add-generic-password -s jira-api-token -a you@example.com -w
```

Use the same account as `JIRA_EMAIL`. You can override the service name with `JIRA_KEYCHAIN_SERVICE`.

## Features

- One board for all projects, using JQL `(assignee = currentUser() OR reporter = currentUser())`.
- Default view hides Done tickets resolved more than 14 days ago. Toggle **Include all Done** to see the rest.
- Columns by status category: To Do, In Progress, Done. Optional project swimlanes.
- Filters for assigned vs reported, issue type, priority, and free-text search.
- **Sort within columns:** Recently updated (default), Recently assigned, Priority, Key, or Jira order. The choice is saved in `localStorage` (along with the assigned window and the recently-assigned toggle).
- **Recently assigned to me:** a toggle plus a window (24 hours / 7 days / 30 days) that narrows the board to tickets assigned to you within that window. Live mode uses `assignee = currentUser() AND assignee CHANGED TO currentUser() AFTER -7d` (window substituted from a fixed allowlist).
- **Card badges:** `updated 3h ago` (full timestamp on hover) and a green `new to me` badge for tickets assigned to you within the selected window (24 hours by default), with `assigned 5h ago` when the assignment time is known.
- **Theme toggle:** a System / Light / Dark switch in the header. System (the default) follows your device's light/dark setting live; Light and Dark override it. The choice is saved in `localStorage` and applied by a tiny inline script before the first paint, so there is no flash on load. It is a keyboard-operable radiogroup (Tab to it, then arrow keys, Home and End) with a visible focus ring.
- **Project colors:** every project gets a stable color from a fixed colorblind-friendly palette (Okabe-Ito and Paul Tol hues plus a slate). Cards get a colored left stripe and a colored project-key badge, and the project filter is a row of color chips that doubles as a legend. Light and dark themes are tuned so stripes have at least 3:1 contrast against the card and badge text at least 4.5:1.
- Cards show key (link to Jira), summary, project, type, priority, assignee, and status.
- Manual refresh, plus auto-refresh every 3 minutes (paused while a drawer, picker, or drag is active).
- Drag a card to another column to transition it. If several transitions map to that category, a picker is shown. Transitions that need a screen or required fields are not guessed; you get a clear message instead.
- Click a card to edit summary, priority, or assignee, and to add comments. Updates are optimistic and roll back if Jira (or the demo store) rejects them.

### Theme

- `public/index.html` sets `data-theme="system|light|dark"` on `<html>` from `localStorage` (`localJiraBoard.theme.v1`) before the stylesheet loads. Missing, invalid or unreadable storage means System.
- `public/styles.css` has one set of tokens written as `light-dark(<light>, <dark>)`. `data-theme` only sets `color-scheme` (`light`, `dark`, or `light dark` for System), so System follows `prefers-color-scheme` with no duplicated rules, and the per-theme project color pairs switch the same way.
- This needs a browser with CSS `light-dark()`: Chrome/Edge 123+, Safari 17.5+, or Firefox 120+.

### Project colors

- The color is picked from `fnv1a(PROJECT_KEY) % 10`, so the same key gets the same color on every machine. If two visible projects land on the same color, the later one (alphabetically) moves to the next free slot, so up to 10 projects get distinct colors. With more projects, colors are shared as evenly as possible. Because of this, a project's color can shift when the set of projects on your board changes.
- Click a project's dot in the chip row to pick another color from the palette. Overrides are stored in your browser's `localStorage` (`localJiraBoard.projectColors.v1`) and never leave your machine. Use **Use default** in the picker, or **Reset colors**, to undo them.
- The palette's olive is a darker yellow-green (`#5F6F14`) than a typical olive so it stays clearly apart from orange in light mode, by both hue and lightness. Tests check orange vs olive and that no two palette colors get closer than a minimum color distance in either theme.
- Click a project's name in the chip row to filter the board to it; click it again (or **All**) to clear.

## API additions

`GET /api/issues` accepts:

| Param | Values | Effect |
| --- | --- | --- |
| `includeDone` | `1` / `true` | Include Done tickets resolved more than 14 days ago |
| `assignedWithin` | `24h` (default), `7d`, `30d` | Window used for the `new to me` badge and the recently-assigned view. Anything else returns `400 invalid_window` |
| `recentlyAssigned` | `1` / `true` | Return only tickets assigned to you within the window |

Each issue carries `newToMe` (boolean) and `assignedAt` (ISO time or `null`). The response also has `assignedWithin`, `assignedAtSkipped` (how many assignment times could not be looked up) and `warning`.

### How "assigned Xh ago" is found (live mode)

The recent-assignment JQL gives the set of tickets. For those tickets only, the server calls `GET /rest/api/3/issue/{key}/changelog` and takes the latest entry that set the assignee to you. This is bounded: at most 50 tickets per refresh, 5 in flight at once, and at most two changelog calls per ticket (the first page, plus the last page for histories over 100 entries). If a ticket is over the cap or a lookup fails, it still shows `new to me` but without the `assigned Xh ago` text, and `assignedAtSkipped` says how many were affected. A failure of the extra recent-assignment query never breaks the board; you get a toast and the badges are skipped.

## Security

- The server binds to `127.0.0.1` only, not `0.0.0.0`.
- Requests whose `Host` is not `127.0.0.1` or `localhost` are rejected (protects against DNS rebinding).
- Write requests whose `Origin` or `Referer` is not the local dashboard are rejected (protects against CSRF from a webpage).
- Write calls to Jira happen only when you take an action in the UI: drag a card, save an edit, or add a comment.
- The API token stays on the server. It is read from `.env` or the Keychain and is never sent to the browser, written to logs, or committed.

## Tests

```bash
npm test
```

The tests run against demo data or an injected fake `fetch`; they never call Jira.

## Known limits

- A Jira site URL, account email and API token are all required for live data. Without them, the board uses clearly fake sample tickets (project keys like `DEMO-1`).
- `currentUser()` is the token owner. Use a token for the account whose tickets you want to see.
- Transitions that open a Jira screen or require extra fields (for example a resolution) cannot be finished here. Open the ticket in Jira for those.
- Assignee search uses Jira's assignable-user API, so it only returns people you are allowed to assign on that project.
- Comments are plain text (converted to/from Atlassian Document Format on the server). There is no rich-text editor, and you cannot create or delete tickets.
- `new to me` and the recently-assigned view depend on Jira's `CHANGED` operator, which only sees assignments recorded in the issue history. Tickets created already assigned to you count as assigned at creation. Each refresh makes one extra search plus up to 50 changelog lookups.
- In mock mode the assignment times are fake and fixed relative to the server start.
- Jira may rate-limit heavy refreshes (`429`). Wait and try again.
- The live search uses `POST /rest/api/3/search/jql` with `nextPageToken` pagination, capped at 5,000 issues (50 pages of 100).
- This is a local personal board, not a replacement for Jira workflows, permissions, or official boards.

## Layout

```
server.mjs              HTTP server (bind, static files, routing)
lib/config.mjs          .env and Keychain loading
lib/security.mjs        Host/origin checks and safe static paths
lib/jira-client.mjs     Live Jira Cloud REST client
lib/windows.mjs         Allowlist of assigned-window values (24h / 7d / 30d)
lib/mock-store.mjs      In-memory demo data and writes
lib/handlers.mjs        JSON API
public/                 Vanilla HTML/CSS/JS UI (logic.js: relative time, sorting, prefs, project colors, theme)
test/api.test.mjs       Mock-mode API and security tests
test/logic.test.mjs     Relative time, sorting, and prefs tests
test/colors.test.mjs    Project color hashing, collisions, overrides, contrast, and distinguishability tests
test/theme.test.mjs     Theme choice, persistence, head script, toggle markup, and CSS token contrast tests
test/jira-client.test.mjs  Live client tests against an injected fake fetch (no network)
```

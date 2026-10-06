# Improvements and Feature Ideas

A review of the AEP Query Editor as of commit `78ad50c` (2026-10-04), covering
[backend/server.js](../backend/server.js), [frontend/src/](../frontend/src/) and the
deployment config. Items are grouped by type and ordered by priority within each group.
**Status (2026-10-06):** 1.1 and 1.3 are implemented (see [FIX_SET_1.md](FIX_SET_1.md)); everything else is still open.

## Summary

| # | Item | Type | Effort | Priority |
|---|------|------|--------|----------|
| 1.1 | Postgres client leaks when a query fails — **done** | Bug | S | High |
| 1.2 | Duplicate column names collapse in results | Bug | S | High |
| 1.3 | Multi-statement input crashes the query route — **done** | Bug | S | High |
| 1.4 | Unbounded result size; no statement timeout | Robustness | S | High |
| 2.1 | Direct endpoints are an open proxy (SSRF) | Security | M | High |
| 2.2 | Legacy `api/` functions accept secrets in the body | Security / cleanup | S | High |
| 2.3 | `cors()` allows every origin | Security | S | Medium |
| 2.4 | No rate limiting | Security | S | Medium |
| 2.5 | `SANDBOX_NAME` not URL-encoded | Security | S | Low |
| 3.1 | New IMS token + connection lookup on every query | Performance | M | Medium |
| 3.2 | Results grid renders every row | Performance | M | Medium |
| 4.x | Feature ideas (export, history, autocomplete, …) | Feature | S–L | See §4 |
| 5.x | Tests, CI, code structure | Engineering | M | Medium |

Effort: **S** ≈ under half a day, **M** ≈ 1–2 days, **L** ≈ several days.

---

## 1. Bugs and robustness

### 1.1 Postgres client leaks when a query fails
In `/api/query` and `/api/query/direct`, `client.end()` is only reached on success.
A syntax error or permission error throws past it, leaving the connection open until
the server or AEP closes it. Over many failed queries this exhausts the connection
slots that Query Service allows per org.

**Fix:** wrap the work in `try { … } finally { await client.end().catch(() => {}) }`.
The same applies to `/api/connect` and `/api/connect/direct` when `connect()` succeeds
but a later step fails.

### 1.2 Duplicate column names collapse in results
`pg` returns rows as objects keyed by column name. `SELECT a.id, b.id FROM …` yields
two `id` fields but only one key, so one column's values are lost. The grid
also uses column names as React keys, which triggers duplicate-key warnings.

**Fix:** query with `rowMode: 'array'` and return `rows` as arrays aligned with
`columns`. Update `ResultsTable` and `handleCopyResults` in
[QueryPane.jsx](../frontend/src/QueryPane.jsx) to index by position.

### 1.3 Multi-statement input crashes the query route
If the selected text contains two statements (`SELECT 1; SELECT 2;`), `client.query`
returns an **array** of results, and `result.fields.map` throws `TypeError`. The user
sees an unhelpful error.

**Fix:** either reject multi-statement input with a clear message, or support it and
return one result set per statement. The second option is better, and the UI could
show a tab per result set.

### 1.4 Unbounded result size; no statement timeout
A `SELECT *` on a large dataset streams every row into server memory, serialises it
as one JSON response and renders it all in the browser. On Vercel this hits the
function memory and duration limits. There is also no way to stop a long-running
query.

**Fix:**
- Add a configurable row cap (e.g. 10,000) using a `pg-cursor` read, or append a
  `LIMIT` when none is present. Return `truncated: true` so the UI can say
  "showing first 10,000 rows".
- Set `statement_timeout` on the connection, and have the client abort with an
  `AbortController` (see §4.4 Cancel).

### 1.5 Smaller issues
- **Objects render as `[object Object]`.** `String(v)` is used for every cell. JSON or
  array values should be rendered with `JSON.stringify`, and the full value shown on hover or click.
- **Copy Results produces malformed TSV** when a value contains a tab or newline.
  Quote or escape such values.
- **`isExecuting()` in `QueryPane`'s imperative handle** reads a stale `executing` value
  because the handle closes over the render it was created in. Use a ref.
- **Direct-mode server default port is still 5432** (`parseInt(port) || 5432`)
  while the UI now defaults to 80. Align them so a blank port behaves the same everywhere.
- **User errors return HTTP 500.** SQL errors from Postgres are client errors; return
  400 with the Postgres `code` and `position` so the editor can highlight the failing token.

---

## 2. Security

### 2.1 Direct endpoints are an open proxy (SSRF)
`/api/connect/direct` and `/api/query/direct` accept any `host` and `port` with no
session. Anyone who can reach the deployment can use the server to
probe or connect to arbitrary hosts, including internal addresses (e.g. `169.254.169.254`, `10.x`).
Response timing and error text ("connection refused" versus "timeout") also reveal
which ports are open.

**Fix (pick one or combine):**
- Allow-list hosts: only `*.platform-query.adobe.io` (configurable through an env var).
- Reject private, loopback and link-local addresses after DNS resolution.
- Return a generic error message for connection failures.

### 2.2 Legacy `api/` functions accept secrets in the request body
The root [api/](../api/) folder holds the original serverless functions. They take
`CLIENT_SECRET` in the body, send `Access-Control-Allow-Origin: *`, and pre-date the
encrypted session cookie. `vercel.json` now routes `/api/*` to the `backend` service,
so these files appear to be unused. If any deployment still serves them, they bypass
the session model.

**Fix:** confirm they aren't served, then delete `api/` and the root `package.json`
dependencies that exist only for it.

### 2.3 `cors()` allows every origin
`app.use(cors())` sends `Access-Control-Allow-Origin: *`. The session cookie is
`SameSite=Strict`, which protects the AEP routes. However, the direct routes take
credentials in the body and can be called from any site. The frontend and backend
share an origin (Vite proxy in dev, Vercel rewrites in prod), so CORS isn't needed.

**Fix:** remove `cors()`, or restrict it to an explicit origin list.

### 2.4 No rate limiting
`/api/session` verifies credentials against Adobe IMS, so without rate limiting it can be
used to test stolen keys. The direct routes can be used to brute-force passwords.

**Fix:** add `express-rate-limit` (or Vercel's firewall rules) on `/api/session`
and `/api/*/direct`.

### 2.5 `SANDBOX_NAME` not URL-encoded
`/api/connect` builds `…/sandboxes/${SANDBOX_NAME}` from client input. A value
containing `/` or `?` changes the Adobe path. The impact is limited because the
request uses the user's own token, but encode it with `encodeURIComponent`.

### 2.6 TLS verification disabled
Every `pg` client uses `ssl: { rejectUnauthorized: false }`, which allows a
man-in-the-middle on the Postgres connection. AEP Query Service presents a publicly
trusted certificate, so `rejectUnauthorized: true` should work for AEP hosts. Keep
the opt-out only for non-AEP hosts, if those are supported at all. The connect-string
`sslmode` (e.g. `verify-full`) could drive this setting.

---

## 3. Performance

### 3.1 Three round-trips before every query
Each `/api/query` call fetches a new IMS token, calls `connection_parameters`, then
opens a new Postgres connection. That adds roughly 0.5–1.5 s of overhead to every query.

**Options:**
- Cache the IMS token (≈24 h validity) and the connection parameters in the sealed
  session cookie, or in an in-memory LRU keyed by session, and refresh on 401.
- For the local Express server, keep a small `pg.Pool` per session/sandbox. On
  serverless, a cached token alone removes most of the overhead.

### 3.2 Results grid renders every row
`ResultsTable` creates one `<tr>` per row. Rendering 10,000+ rows makes the tab slow.
**Fix:** virtualise rows (e.g. `@tanstack/react-virtual`). The fixed row height
(`ROW_H = 36`) makes this straightforward.

### 3.3 Bundle size
The Vite build warns about a large chunk. Lazy-load `DatasetExplorer` (it's AEP-only)
and CodeMirror with `React.lazy` / dynamic `import()`.

---

## 4. Feature ideas

### 4.1 Export results (S)
Add **Download CSV** and **Download JSON** next to Copy Results. This is quick and
commonly requested.

### 4.2 Query history (S)
Keep the last *N* executed queries per sandbox or host in `localStorage`, with
timestamp, duration and row count. Show them in a dropdown or side panel and click
one to load it into the editor. Never store the results.

### 4.3 Saved queries and snippets (M)
Allow named saved queries, plus built-in AEP templates such as:
- profile snapshot row count by merge policy
- latest batch per dataset (`_acp_system_metadata.ingestTime`)
- identity namespace distribution
- `SHOW TABLES` / table size checks

Export and import the saved queries as JSON so a team can share them.

### 4.4 Cancel a running query (M)
Add a **Stop** button. On the client, abort with `AbortController`. On the server,
detect `req.on('close')` and call `pg_cancel_backend`, or close the client.
Pairs with the statement timeout in §1.4.

### 4.5 Schema-aware autocomplete (M)
CodeMirror's `sql()` accepts a `schema` option. Feed it the tables and fields already
loaded by the Dataset Explorer (AEP mode), or the output of `SHOW TABLES` /
`information_schema.columns` (Direct mode). This gives table and nested field
completion such as `_tenant.loyalty.points`.

### 4.6 Dataset Explorer for Direct Connection (M–L)
The options are analysed in [DBExploreOptions.md](DBExploreOptions.md). The
recommended first step is a SQL-only explorer built from `SHOW TABLES` and
`information_schema`.

### 4.7 Persist editor panes (S)
Pane queries are lost on reload. Save pane labels and SQL text in `localStorage`, and
allow renaming panes.

### 4.8 Result grid usability (M)
- Click a header to sort (client-side) and filter columns.
- Resize columns and show or hide them.
- Expand a cell to see the full value, with pretty-printed JSON for nested XDM.
- Pin the first column.

### 4.9 Multiple result sets (S, after 1.3)
Show one sub-tab per statement when a selection contains several statements.

### 4.10 Explain plan (S)
Add an **Explain** button that runs `EXPLAIN <query>` and shows the plan in a
monospace panel. Query Service supports `EXPLAIN`.

### 4.11 Quick charts (M)
Draw a bar or line chart from a two- or three-column result. This is useful for
counts by day or by segment without leaving the tool.

### 4.12 Connection profiles (S)
Save named Direct connection profiles (host, port, database, user, **no password**) and
choose one from a dropdown, alongside the connect-string paste.

### 4.13 Keyboard shortcuts and help (S)
- `Ctrl/Cmd+Enter` to run, `Ctrl/Cmd+Shift+Enter` to run all, `Ctrl+S` to save the
  query, `Alt+1..3` to switch panes.
- Add a `?` overlay listing the shortcuts.

### 4.14 Dark mode (S–M)
The design tokens are already centralised in the `C` object in
[App.jsx](../frontend/src/App.jsx), and CodeMirror ships `theme-one-dark`. Add a
theme toggle that follows `prefers-color-scheme`.

### 4.15 Session expiry warning (S)
The session's `expiresAt` is known on the client. Show a countdown or warning about
10 minutes before the 8-hour session expires, rather than failing on the next query.

---

## 5. Engineering and maintainability

### 5.1 Tests (M)
The backend `test` script is a placeholder, and there are no frontend tests. Good first targets:
- `parseConnectString` (pure function: psql, key=value, URI, quoting, errors)
- `seal` / `unseal` round-trip, tamper detection and expiry
- `toExplorerDataset`, `extractFields`, `toRegistrySchemaId` (pure functions in
  `server.js`)
- route tests with `supertest`, with `axios` and `pg` mocked

Use Vitest for both packages.

### 5.2 CI (S)
Add a GitHub Actions workflow on push and pull requests that runs `npm ci`, `oxlint`, the tests and `vite build`.
The workflow should block merges to `master`, which deploys to production.

### 5.3 Split large files (M)
- `server.js` (≈680 lines) → `routes/session.js`, `routes/query.js`,
  `routes/explorer.js`, `lib/aep.js`, `lib/pg.js`. The repeated
  `new Client({...}) → connect → query → end` block appears 4 times and should be
  one helper (which also fixes §1.1 in one place).
- `App.jsx` (≈900 lines) → `ConnectionCard`, `DirectConnectionForm`,
  `AepConnectionForm`, `ConsolePanel`, plus a `useConnection` hook.
- The `C` design-token object is duplicated in `App.jsx` and `QueryPane.jsx` and
  must be kept in sync by hand. Move it to a shared `tokens.js`.

### 5.4 Error-message helper (S)
`err.response?.data?.title || err.response?.data?.message || err.message` is
repeated about 8 times. Extract it into one `aepError(err)` helper.

### 5.5 Structured logging (S)
The server logs almost nothing. Add per-request logs (route, sandbox, duration,
row count, error code — **never** SQL text with literals or any credentials) to
help debug production issues.

### 5.6 Housekeeping
- Remove the unused `frontend/public/favicon_old.*` files and `docs/frontend-vite-template.md`
  if they're no longer referenced.
- Fill in the empty `description` and `author` fields in `backend/package.json`.
- Add a LICENSE if the repository is public.

---

## 6. Suggested order

1. **Quick fixes (about 1 day):** §1.1, §1.2, §1.3, §1.5, §2.2, §2.3, §2.5, §5.4
2. **Hardening (about 2 days):** §1.4 row cap and timeout, §2.1 host allow-list, §2.4 rate limits, §5.1 tests, §5.2 CI
3. **High-value features:** §4.1 export, §4.2 history, §4.7 persist panes, §4.4 cancel, §3.1 token caching
4. **Larger features:** §4.5 autocomplete, §4.6 Direct explorer, §4.8 grid usability, §3.2 virtualisation

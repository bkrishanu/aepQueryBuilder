# AEP Query Editor

A browser-based SQL workbench for **Adobe Experience Platform (AEP) Query Service**.
Connect with AEP API credentials or raw database parameters, browse every dataset and schema field in a searchable explorer, and run one or many SQL statements across up to five editor tabs.

**Live:** https://aep-query-builder-1oz5.vercel.app

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting started (local)](#getting-started-local)
- [Connecting](#connecting)
- [Dataset Explorer](#dataset-explorer)
- [Query editor](#query-editor)
- [Results](#results)
- [Console log](#console-log)
- [Security](#security)
- [Deploying to Vercel](#deploying-to-vercel)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Features

| Area | What you get |
|------|--------------|
| **Connection** | Two modes — **AEP API** (OAuth server-to-server + sandbox picker) or **Direct Connection** (host / port / database / user / password) |
| **Credential security** | Uploaded config is verified with Adobe IMS and kept only in an encrypted, HttpOnly session cookie — never in browser storage |
| **Dataset Explorer** | Searchable tree of every customer dataset and Profile Snapshot, grouped into *Profile Enabled*, *Non Profile Enabled*, *Profile Snapshots* (by merge policy), *System* and *Segment Snapshot*; collapses to a slim rail to give the editor more room |
| **Schema browsing** | Expand a dataset to see its full field hierarchy with datatype icons; copy any fully qualified field path (arrays copied as `field[0]`) |
| **Query editor** | CodeMirror 6 SQL editor with syntax highlighting and autocompletion; runs the statement under the cursor or every selected statement; **Ctrl+Enter** to run; fills the window height |
| **Query control** | Compact icon Run / Cancel buttons with tooltips; cancelling stops the statement on the server and closes the connection |
| **Multiple tabs** | Up to 5 independent query tabs, each with its own editor and results |
| **Results grid** | One result block per statement with Success / Failed status and PostgreSQL errors; sticky headers, 20-row × 5-column viewport with scrolling, one-click tab-delimited copy for Excel / Sheets |
| **Reliability** | Every Postgres connection is closed on success, error, timeout or cancel — failed queries don't leak Query Service connection slots |
| **Console** | Timestamped activity log for every connection, query and explorer action |

---

## Architecture

```
frontend/   React 19 + Vite + Tailwind CSS 4 + CodeMirror 6
backend/    Node.js + Express 5 — AEP API proxy, OAuth, Postgres client, credential sessions
```

| Layer | Local URL | Responsibility |
|-------|-----------|----------------|
| Frontend | `http://localhost:5173` | All UI |
| Backend | `http://localhost:4000` | Adobe IMS token exchange, AEP Platform API calls, Postgres query execution, encrypted session cookie |

During development Vite proxies `/api/*` to the backend, so the browser only ever talks to one origin. In production Vercel does the same via `vercel.json` rewrites.

---

## Getting started (local)

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| npm | 9+ |

### 1. Clone and install

```bash
git clone https://github.com/bkrishanu/aepQueryBuilder.git
cd aepQueryBuilder

cd frontend && npm install
cd ../backend && npm install
```

### 2. (Optional) set a session key

The backend encrypts your AEP credentials with a key derived from `SESSION_SECRET`.
Locally it is optional — without it a random key is generated at start-up and you simply re-upload your config after each backend restart.

```bash
cp backend/.env.example backend/.env
# generate a value and paste it into backend/.env as SESSION_SECRET=...
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Run

```bash
# terminal 1
cd backend
npm run dev        # auto-reloads (nodemon); or: npm start

# terminal 2
cd frontend
npm run dev
```

Open **http://localhost:5173**.

---

## Connecting

Use the toggle in the **Configuration** card to choose a mode. The mode can't be switched while connected — disconnect first. After a successful connection the card collapses to a one-line summary; use the chevron to expand it again.

### Mode 1 — AEP API

#### Prepare a config file

Create a `.json` file from your **OAuth Server-to-Server** credential in the [Adobe Developer Console](https://developer.adobe.com/console):

```json
{
  "CLIENT_SECRET": "your_client_secret",
  "API_KEY":       "your_client_id",
  "SCOPES":        "openid, AdobeID, read_organizations, additional_info.projectedProductContext, session",
  "IMS_ORG":       "XXXXXXXXXXXXXXXXXXXXXXXX@AdobeOrg"
}
```

| Key | Required | Description |
|-----|:--------:|-------------|
| `API_KEY` | ✅ | Client ID of the credential |
| `CLIENT_SECRET` | ✅ | Client secret of the credential |
| `SCOPES` | ✅ | Comma-separated OAuth scopes (spaces after commas are normalised automatically) |
| `IMS_ORG` | ✅ | IMS Organization ID |

Any other keys (e.g. `TECHNICAL_ACCOUNT_ID`) are ignored. The credential needs access to Query Service, Catalog, Schema Registry, Sandbox Management and (for Profile Snapshots) the Real-Time Customer Profile merge policy API.

#### Steps

1. **Upload Config JSON** — the backend verifies the credentials with Adobe IMS. On success the card shows **Secured in session** and **Organization** is filled in. Invalid credentials are rejected immediately with Adobe's error message.
2. **Load Sandboxes** — lists the org's sandboxes and fills in **Tenant**.
3. **Select a sandbox → Connect** — the header pill turns green and the Dataset Explorer starts loading.
4. **Disconnect** ends the connection. **Forget** (next to *Secured in session*, available when disconnected) deletes the stored credentials. **Re-upload Config** replaces them.

The credential session lasts **8 hours** and survives page refreshes. When it expires the app resets the AEP state and asks you to upload the config again.

### Mode 2 — Direct Connection

Connect straight to any Postgres-compatible endpoint (including the AEP Query Service host) without AEP APIs.

| Field | Example | Notes |
|-------|---------|-------|
| Host | `acme.platform-query.adobe.io` | Required |
| Port | `5432` | Defaults to 5432 |
| Database | `prod:all` | Required |
| User | `ABC123@AdobeOrg` | Required |
| Password | `••••••` | Never persisted — re-enter each session |

Host, port, database and user are remembered in `sessionStorage` for the tab's lifetime. SSL is always used. The Dataset Explorer is only available in AEP API mode.

---

## Dataset Explorer

The panel to the left of the query editor (above it on small screens) lists the datasets in the connected sandbox.

Once connected, the collapse button in the panel header folds the explorer into a slim rail on wide screens (down to its header strip on small screens), so the query editor gets the space. Click the rail or the button again to expand it. Loaded datasets, expanded nodes, search and scroll position are kept; nothing is reloaded.

### Sections

```text
Profile Enabled                 customer datasets with tags.unifiedProfile = enabled:true
 └── dataset_a        1,234     ← table name, record count
      └── _tenant
           └── attributes
                └── email

Non Profile Enabled             all other customer datasets
 └── dataset_b       98,765

Profile Snapshots               SYSTEM datasets named "Profile-Snapshot*"
 ├── Default Time-based  [DEFAULT] [EDGE ACTIVE]    ← merge policy
 │    └── profile_snapshot_export_…   12,345
 └── Gold Customers
      └── profile_snapshot_export_…    6,789

System                          AJO / journey system datasets (fixed list, by name)
 └── ajo_message_feedback_event_dataset   ← expands to schema fields

Segment Snapshot                datasets named "Segmentdefinition-Snapshot*"
 └── segmentdefinition_snapshot_abc       ← expands to schema fields
```

| What | Source |
|------|--------|
| Which datasets appear | `classification.managedBy = "CUSTOMER"`; `managedBy = "SYSTEM"` whose name starts with `Profile-Snapshot`; any dataset whose name starts with `Segmentdefinition-Snapshot` (case-insensitive, shown only under *Segment Snapshot*); and non-customer datasets whose name matches the `SYSTEM_DATASET_NAMES` list in `backend/server.js` (AJO datasets, *Journeys*, *Journey Step Events*). All other system datasets are hidden. |
| Dataset name | `tags["adobe/pqs/table"]` (the name you query) |
| Record count | `extensions.adobe_lakeHouse.metrics.rowCount`, formatted `1,234,567` |
| Profile Enabled | `tags.unifiedProfile[0] = "enabled:true"` |
| Merge policy | `tags.unifiedProfile` entry `mergePolicyId:<id>` → name, `default` (**DEFAULT** badge) and `isActiveOnEdge` (**EDGE ACTIVE** badge) from the merge policy API |

### Loading behaviour

- All Catalog pages (100 datasets each) are fetched automatically and streamed in as they arrive — the tree is usable before loading finishes. Duplicates are removed.
- Merge policies are fetched once per ID and cached for the sandbox; refreshes skip ones already known.
- A dataset's **schema is loaded only when you expand it**, then cached. Datasets sharing a schema reuse it. Profile Snapshot datasets have no schema view and never call the Schema Registry. System and Segment Snapshot datasets expand to their schema fields like customer datasets.
- The **refresh** button reloads the list while keeping the current tree visible; expanded schemas refresh in the background.

### Schema fields

Fields are shown by **name** (not title) at any nesting depth, with an icon per datatype — hover the icon for the exact type:

| Icon | Types |
|------|-------|
| Text | string |
| Hash | integer, long, short, byte |
| Calculator | number, double, float |
| Toggle | boolean |
| Calendar | date |
| Clock | date-time |
| Folder | object |
| List | array (tooltip shows the item type, e.g. `array<string>`) |
| Layers | map |
| File | unknown |

### Copying

Hover any dataset or field and click the copy icon (or press **C** on the selected row). A toast confirms what was copied.

| Row | Copied value |
|-----|--------------|
| Dataset | table name, e.g. `customer_events` |
| Field | fully qualified path, e.g. `_tenant.attributes.email` |
| Field under an array | each array addresses its first element: `customer.orders[0].items[0].productId` |
| Array of primitives | `customer.emails[0]` |
| Array of arrays | `matrix[0][0]` |

The tree always shows plain names; `[0]` appears only in the copied value (and the hover tooltip).

### Search and navigation

- **Search** filters as you type, case-insensitively, across dataset names and merge policy names. Matches are highlighted and group counts show `matches / total`. A matching merge policy shows all of its snapshot datasets.
- The search bar stays fixed; only the tree scrolls. Only on-screen rows are rendered, so thousands of datasets and fields stay smooth.
- **Keyboard:** click the tree (or press ↓ in the search box), then

  | Key | Action |
  |-----|--------|
  | ↑ / ↓, Home / End, PgUp / PgDn | Move selection |
  | → | Expand, or step into the first child |
  | ← | Collapse, or jump to the parent |
  | Enter / Space | Toggle expand |
  | C | Copy the selected dataset name or field path |

- Expanded nodes, search text, scroll position, loaded datasets and schemas are kept per org + sandbox — across refreshes, disconnect / reconnect and sandbox switches.

---

## Query editor

CodeMirror 6 with a DBeaver-style light theme: line numbers, bracket matching, active-line highlight, SQL autocompletion and syntax colours (bold blue keywords, red strings, green numbers, italic comments, purple `NULL` / `TRUE` / `FALSE`). Font: Cascadia Code → Consolas → Courier New.

On large screens the editor fills the window height (at least 420px) and widens when the Dataset Explorer is collapsed.

### Tabs

| Action | How |
|--------|-----|
| Add a tab | `+` next to the tabs (hidden once 5 are open) |
| Switch | Click a tab — editor text and results are preserved |
| Close | `×` on the tab (the last tab can't be closed) |
| Run | **▶ Run** (or **Ctrl+Enter**; **⌘ Enter** also works on macOS) runs the active tab |
| Cancel | **■ Cancel** appears while a query runs; it cancels the statement on the server and closes the connection |

### What Run / Ctrl+Enter runs

Statements end with `;`. Semicolons inside strings, quoted identifiers, `$$` bodies and comments are ignored.

| Situation | Runs |
|-----------|------|
| One statement in the editor | That statement |
| Several statements, nothing selected | The statement under the cursor |
| Text is selected | Every statement in the selection, in order |

When several statements run, each gets its own result block marked **Success** or **Failed** (with the PostgreSQL error and its line/column). A failing statement doesn't stop the ones after it. A second Run while a query is in flight is ignored.

Each tab has **Editor** and **Results** sub-tabs; Results shows a row-count badge after a query runs (or the number of result sets, red if any failed).

---

## Results

- Header shows the row count, column count and execution time. Statements that return no columns (`SET`, `CREATE`, `INSERT` …) show the command and rows affected.
- When several statements run, each gets its own block with a **Success** / **Failed** chip and the statement text, under a summary line (`3 statements · 2 succeeded · 1 failed`).
- A failed statement shows the PostgreSQL error, the line and column it points at, and any hint. Statements after it still run; if the connection itself drops, the rest are marked **Skipped**.
- A cancelled run shows **Query cancelled**; a run that couldn't start (auth, connection) shows **Query failed** with the reason.
- Up to **5 columns** share the full width; more columns get a fixed width with horizontal scrolling.
- Up to **20 rows** are visible; more rows scroll vertically with a sticky header.
- The **copy** icon on each result block copies it as tab-delimited text with headers — paste directly into Excel or Google Sheets.

---

## Console log

A terminal-style panel at the bottom records every action with a millisecond timestamp — `›` info, `⚠` warning, `✖` error. It auto-scrolls to the newest entry; **Clear** empties it.

---

## Security

| Concern | How it's handled |
|---------|------------------|
| Config secrets in the browser | The config is posted once to `POST /api/session`, verified with Adobe IMS, encrypted with **AES-256-GCM** and returned as the `aep_session` cookie: **HttpOnly** (page scripts can't read it), **SameSite=Strict** (not sent cross-site), **Secure** over HTTPS, scoped to `/api`. Nothing is written to `sessionStorage` / `localStorage`; config left there by older versions is deleted on load. |
| Secrets in requests | Credentials are never sent in request bodies. AEP routes decrypt them from the cookie on the server and ignore any credential fields a client sends. |
| Expiry and tampering | Sessions expire after 8 hours (checked inside the encrypted payload as well as by the cookie). Modified or expired cookies are rejected. **Forget** clears the cookie immediately. |
| Server state | None — sessions are stateless, which suits serverless hosting. Rotating `SESSION_SECRET` signs everyone out. |
| Access tokens | Never stored. A fresh IMS token is requested per backend call and lives only in memory for that request. |
| Direct-mode password | Kept in memory only; never written to browser storage. |

---

## Deploying to Vercel

The root `vercel.json` defines two services on one domain:

| Service | Root | Runs as |
|---------|------|---------|
| `frontend` | `frontend/` | Vite build, served as a static SPA |
| `backend` | `backend/` | Express app (`server.js`) as a Node serverless function |

Requests to `/api/*` are routed to the backend; everything else to the frontend.

### Steps

1. Import `bkrishanu/aepQueryBuilder` at [vercel.com/new](https://vercel.com/new). Vercel picks up `vercel.json`.
2. **Set `SESSION_SECRET`** (Project → Settings → Environment Variables, Production) to 32+ random characters. **Without it the deployed backend refuses to create sessions and config upload fails** with *"Server misconfigured: SESSION_SECRET … must be set"*.
3. Deploy. Every push to `master` redeploys automatically.

> Environment variable changes only apply to **new** deployments — redeploy after adding or changing `SESSION_SECRET`.
>
> Vercel blocks deployments whose commit author email isn't linked to a GitHub account. Set the repo's Git email to your GitHub email (`git config user.email "you@example.com"`) and push a new commit; redeploying an older commit keeps its original author.

---

## API reference

All endpoints return `{ "error": "…" }` with a 4xx/5xx status on failure.

### Session

| Method | Endpoint | Body | Result |
|--------|----------|------|--------|
| `POST` | `/api/session` | config JSON | Verifies with IMS, sets `aep_session` cookie, returns `{ IMS_ORG, expiresAt }` |
| `GET` | `/api/session` | — | `{ IMS_ORG, expiresAt }` or `401` |
| `DELETE` | `/api/session` | — | Clears the cookie (`204`) |

### AEP API mode (require the session cookie)

Without a valid cookie these return `401 { "code": "SESSION_REQUIRED" }`.

| Method | Endpoint | Body | Result |
|--------|----------|------|--------|
| `POST` | `/api/sandboxes` | — | `{ sandboxes: [{ name, title }], tenant }` |
| `POST` | `/api/connect` | `SANDBOX_NAME` | Verifies Postgres connectivity; `{ host, port, dbName, username }` |
| `POST` | `/api/query` | `SANDBOX_NAME`, `queries` (array) or `query` | NDJSON stream — see [Query results](#query-results) |
| `POST` | `/api/datasets` | `SANDBOX_NAME`, `knownMergePolicyIds?` | NDJSON stream of `page`, `mergePolicies`, `done` / `error` messages |
| `POST` | `/api/schema` | `SANDBOX_NAME`, `schemaId` | `{ schemaId, title, fields: [{ name, type, itemType?, arrayDims?, children? }] }` |

### Direct Connection mode

| Method | Endpoint | Body | Result |
|--------|----------|------|--------|
| `POST` | `/api/connect/direct` | `host`, `port`, `dbName`, `user`, `password` | Verifies connectivity |
| `POST` | `/api/query/direct` | same + `queries` (array) or `query` | NDJSON stream — see [Query results](#query-results) |
| `POST` | `/api/query/cancel` | `token` (from `started`), `statement`, `startedAt` (from `statement`) | Postgres CancelRequest, plus a Query Service API cancel in AEP mode; `{ sent, api }` |

### Query results

Statements run one after another on a single connection, which is always closed afterwards (success, error or cancel). The response is newline-delimited JSON:

```js
{ type: 'started', cancelToken }    // connected; token is null without SESSION_SECRET
{ type: 'statement', index, startedAt } // before each statement runs
{ type: 'done', results, duration } // the run finished
{ type: 'error', error }            // the run never started (auth, connection parameters, connection failure)
```

Each entry in `results` is one result set:

```js
{ statement, status: 'success' | 'error' | 'cancelled' | 'skipped', columns, rows, rowCount, command, duration,
  error?, position?, hint?, code? }   // error fields only when status !== 'success'
```

A SQL error is reported in its entry, not as an HTTP error.

**Cancelling.** Cancel posts the `cancelToken` and the running statement to `/api/query/cancel`. The token is encrypted with `SESSION_SECRET`, so it can't be forged to target another host. Any server instance can handle the cancel, which matters on Vercel, where the function running the query isn't told when the browser drops the request. The endpoint does two things:

1. Sends a PostgreSQL CancelRequest. Plain PostgreSQL honours this; Query Service ignores it.
2. In AEP mode, cancels through the Query Service API. The API can't filter by SQL text, so the server lists queries created since the statement started (including hidden ones, `excludeHidden=false`), picks the newest unfinished one whose SQL matches the running statement, and sends `PATCH /data/foundation/query/queries/{id}` with `{ "op": "cancel" }`. This uses the session cookie's credentials. Direct mode has no API credentials, so only step 1 applies there.

Once the database stops the statement it comes back as `cancelled` and the rest of the run as `skipped`. The editor waits up to 20 seconds for this; otherwise it reports *Cancel not confirmed* — the query may still be running. The console logs what each path did, including the recent queries the API returned when nothing matched.

---

## Project structure

```
aepQueryBuilder/
├── frontend/
│   ├── src/
│   │   ├── App.jsx              Layout, configuration card, connection flow, tabs, console
│   │   ├── DatasetExplorer.jsx  Virtualized dataset / schema / merge-policy tree
│   │   ├── QueryPane.jsx        Editor + results for one query tab
│   │   ├── SqlEditor.jsx        CodeMirror 6 SQL editor, theme and Ctrl+Enter keymap
│   │   ├── sqlStatements.js     Statement splitting and cursor / selection resolution
│   │   ├── Button.jsx           Shared button and icon-button (tooltip) components
│   │   ├── api.js               Shared API client + session-expiry signal
│   │   └── index.css            Tailwind entry, scrollbars, animations
│   ├── public/                  Logo and favicons
│   └── vite.config.js           Vite + Tailwind + /api dev proxy
├── backend/
│   ├── server.js                Express app — every API route
│   ├── .env.example             SESSION_SECRET template
│   └── vercel.json              Backend function config
├── api/                         Legacy standalone serverless functions (not routed by vercel.json)
├── docs/                        Requirement specs and change notes
├── vercel.json                  Frontend + backend services and /api rewrite
└── README.md
```

### docs/

| File | Contents |
|------|----------|
| [project.md](docs/project.md) | Original project requirements |
| [CHANGES.md](docs/CHANGES.md) | UI modernisation and branding requirements |
| [DATASET.md](docs/DATASET.md) | Dataset Explorer specification |
| [DATASET_ENHANCE.md](docs/DATASET_ENHANCE.md) | Array-path copy and scrollable explorer enhancements |
| [PROFILE_SNAPSHOT.md](docs/PROFILE_SNAPSHOT.md) | Profile Snapshot and merge policy support |
| [SYSTEM_DATASET.md](docs/SYSTEM_DATASET.md) | System and Segment Snapshot dataset groups |
| [DBExploreOptions.md](docs/DBExploreOptions.md) | Options for a Dataset Explorer in Direct Connection mode (analysis) |
| [FIX_SET_1.md](docs/FIX_SET_1.md) | Icon controls, Cancel Query, connection-leak fix, multi-statement execution, Ctrl+Enter |
| [IMPROVEMENTS.md](docs/IMPROVEMENTS.md) | Codebase review: bugs, security, performance and feature ideas |
| [frontend-vite-template.md](docs/frontend-vite-template.md) | Original Vite + React template notes |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| *Failed to parse config* | The file must be valid JSON — no trailing commas or comments |
| *Config rejected: Adobe IMS rejected the credentials* | Check `API_KEY`, `CLIENT_SECRET` and `SCOPES` against the Developer Console credential |
| *Server misconfigured: SESSION_SECRET … must be set* | Add `SESSION_SECRET` in Vercel and redeploy (see [Deploying](#deploying-to-vercel)) |
| *Credential session expired* | Sessions last 8 hours, and a backend restart without `SESSION_SECRET` ends them — upload the config again |
| *Connection failed* (AEP) | Confirm the sandbox is active and the credential has Query Service access |
| *Connection failed* (Direct) | Check host, port, database, user and password |
| Dataset Explorer is empty | It needs AEP API mode; check the console for Catalog errors and the credential's Catalog access |
| Merge policy shows a warning icon / raw ID | The merge policy lookup failed (hover for details); refresh to retry — the credential needs Profile access |
| Query returns no rows | Table names are case-sensitive — copy them from the Dataset Explorer |
| Wrong statement runs | Place the cursor inside the statement you want, or select it. End every statement with `;` |
| Only one of several statements ran | With nothing selected, only the statement under the cursor runs — select all of them to run them in order |
| A long query won't stop | Click the red **Cancel** icon next to Run (or **Cancel query** in Results); closing the tab or disconnecting also cancels it |
| *Cancel not confirmed* | The database didn't confirm within 20 seconds, so the query may still be running — check **Queries > Logs** in AEP. The console lists what the Query Service API returned |
| Cancel doesn't work in Direct mode against Query Service | Query Service ignores the Postgres cancel signal, and Direct mode has no API credentials to cancel through the API — use AEP API mode |
| Dataset Explorer is just a thin strip | It's collapsed — click the strip (or the header arrow on small screens) to expand it |
| `+` tab button missing | Maximum of 5 tabs — close one first |
| Vercel: *GitHub user not found* | The commit's author email isn't on your GitHub account — fix `git config user.email` and push a new commit |

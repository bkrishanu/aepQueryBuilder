# AEP Query Connector

A professional web-based query tool for **Adobe Experience Platform (AEP) Query Service**. Connect via AEP API credentials or directly with raw database parameters, write SQL with full syntax highlighting, and execute queries across up to three independent editor tabs — all from the browser.

---

## Architecture

```
frontend/   ← React + Vite + Tailwind CSS
backend/    ← Node.js + Express (API proxy + Postgres client)
```

| Layer | URL (dev) | Purpose |
|-------|-----------|---------|
| Frontend | `http://localhost:5173` | React UI — all user interaction |
| Backend | `http://localhost:4000` | AEP API calls, OAuth token exchange, Postgres execution |

In development, Vite proxies all `/api` requests to the backend automatically — no CORS configuration required.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18+ |
| npm | 9+ |
| Git | any recent version |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/bkrishanu/aepQueryBuilder.git
cd aepQueryBuilder
```

### 2. Install dependencies

```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install
```

### 3. Start the backend

```bash
cd backend
npm run dev      # development — auto-reloads on file changes
# or
npm start        # production
```

The backend starts on **port 4000**.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Connection Modes

The tool supports two independent ways to connect to AEP Query Service. Use the toggle in the top-right corner of the **Configuration** card to switch between them. Switching is disabled while a connection is active — disconnect first.

---

### Mode 1 — AEP API (OAuth + Sandbox)

Authenticates via Adobe IMS OAuth and resolves connection parameters automatically from the AEP platform APIs.

#### Prepare your config file

Create a `.json` file with the following structure:

```json
{
  "CLIENT_SECRET":        "your_client_secret_here",
  "API_KEY":              "your_api_key_here",
  "SCOPES":               "AdobeID, openid, read_organizations, additional_info.projectedProductContext, additional_info.roles, adobeio_api, read_client_secret, manage_client_secrets, campaign_sdk, campaign_config_server_general, deliverability_service_general, session, user_management_sdk",
  "IMS_ORG":              "XXXXXXXXXXXXXXXXXXXXXXXX@AdobeOrg",
  "TECHNICAL_ACCOUNT_ID": "XXXXXXXXXXXXXXXXXXXXXXXX@techacct.adobe.com",
  "CONTAINER_ID":         "tenant"
}
```

> **Where to find these values:** Log in to [Adobe Developer Console](https://developer.adobe.com/console), open your project, and select the **OAuth Server-to-Server** credential.

| Key | Description |
|-----|-------------|
| `CLIENT_SECRET` | Client Secret of your AEP API credential |
| `API_KEY` | Client ID of your AEP API credential |
| `SCOPES` | OAuth scopes — spaces after commas are automatically normalised by the backend |
| `IMS_ORG` | Your Adobe IMS Organization ID |
| `TECHNICAL_ACCOUNT_ID` | Technical Account ID from Developer Console |
| `CONTAINER_ID` | Container to use — typically `tenant` |

#### Steps

1. Click **Upload Config JSON** and select your config file.  
   The **Organization (IMS_ORG)** field populates automatically. The config is stored in `sessionStorage` and persists for the browser session; re-upload to replace it.

2. Click **Load Sandboxes**.  
   The backend fetches a fresh OAuth token and retrieves all available sandboxes. The **Tenant** field populates from the connection parameters host.

3. Select a sandbox from the **Sandbox** dropdown, then click **Connect**.  
   A green status pill in the header confirms a successful connection.

4. Write and execute queries (see [Query Editor](#query-editor) below).

5. To end the session, click **Disconnect**.

---

### Mode 2 — Direct Connection

Bypasses AEP APIs entirely. Enter raw Postgres credentials and connect directly to any compatible database.

| Field | Example | Notes |
|-------|---------|-------|
| **Host** | `foo.platform-query.adobe.io` | Full hostname |
| **Port** | `5432` | Default Postgres port |
| **Database** | `dbname` | Database / schema name |
| **User** | `username` | Database username |
| **Password** | `••••••` | Masked — never stored in sessionStorage |

Host, Port, Database, and User are persisted in `sessionStorage` across page refreshes. Password must be re-entered each session.

Click **Connect** once all required fields (Host, Database, User) are filled.

---

## Query Editor

The editor uses **CodeMirror 6** with full SQL syntax highlighting in a DBeaver-style **white** theme:

| Token | Colour |
|-------|--------|
| Keywords (`SELECT`, `FROM`, `WHERE`, …) | Bold dark-blue |
| Built-in functions | Dark cyan |
| Strings | Dark red |
| Numbers | Dark green |
| Comments | Grey-green italic |
| Operators (`=`, `>`, `*`, …) | Blue |
| `NULL` / `TRUE` / `FALSE` | Deep purple bold |
| Identifiers | Near-black |

**Font:** Courier New  
**Features:** line numbers, bracket matching, active-line highlight, text selection, horizontal + vertical scrollbars.

---

## Multiple Query Tabs

Up to **3 independent query tabs** can be open simultaneously. Each tab has its own editor and results — running one tab does not affect another.

| Action | How |
|--------|-----|
| **Add a tab** | Click the `+` button next to the tab bar (hidden when 3 tabs are open) |
| **Switch tabs** | Click the tab label — editor content and results are preserved |
| **Close a tab** | Hover the tab and click `×` (the last remaining tab cannot be closed) |
| **Execute** | Click the **Execute** button (right side of tab bar) to run the active tab |

### Smart query execution

When you click **Execute**, the editor resolves which statement to run:

| Scenario | What runs |
|----------|-----------|
| Text is **selected** | Only the selected text |
| Cursor is inside a statement (multi-query editor) | Only the statement at the cursor |
| Single statement in the editor | That statement |

This means you can write multiple semicolon-separated queries in one editor and run them one at a time by placing the cursor inside or selecting the desired statement.

---

## Results

Each tab has its own **Results** sub-tab:

- **≤ 5 columns** — columns distribute evenly across the full panel width.
- **6+ columns** — each column gets a fixed width; horizontal scrollbar appears.
- **50 rows** are visible before the vertical scrollbar activates.
- **Copy Results** button copies all data to the clipboard in tab-delimited format (paste directly into Excel or Google Sheets).

---

## Console Log

A persistent terminal-style panel at the bottom of the page logs all actions with timestamps:

| Icon | Meaning |
|------|---------|
| `›` | Info — normal operations |
| `⚠` | Warning — e.g. empty query |
| `✖` | Error — connection failures, query errors |

Click **Clear** to reset the log. The console auto-scrolls to the latest entry.

---

## Security Notes

- **Access tokens are never stored.** A fresh OAuth token is requested on every backend API call and held only in server memory for the duration of that request.
- The config file is stored in `sessionStorage` — cleared automatically when the browser tab is closed.
- All AEP API calls are proxied through the Node.js backend. `CLIENT_SECRET` is never sent to or exposed in the browser.
- In Direct Connection mode, **passwords are never written to sessionStorage** — only host, port, DB name, and user are persisted.

---

## Project Structure

```
aepQueryBuilder/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          ← Main UI — configuration card, pane management, connection logic
│   │   ├── QueryPane.jsx    ← Self-contained query editor + results tab component
│   │   ├── SqlEditor.jsx    ← CodeMirror 6 SQL editor with DBeaver light theme
│   │   └── index.css        ← Tailwind entry + global font
│   ├── vite.config.js       ← Vite + Tailwind + /api proxy config
│   └── package.json
├── backend/
│   ├── server.js            ← Express API server — all routes
│   └── package.json
├── project.md               ← Original requirements
└── README.md
```

---

## API Reference (Backend)

### AEP API mode

| Method | Endpoint | Body fields | Description |
|--------|----------|-------------|-------------|
| `POST` | `/api/sandboxes` | `API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG` | Get OAuth token → list sandboxes + derive tenant |
| `POST` | `/api/connect` | `API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG`, `SANDBOX_NAME` | Get OAuth token → retrieve sandbox → get connection params → verify Postgres |
| `POST` | `/api/query` | `API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG`, `SANDBOX_NAME`, `query` | Get OAuth token → get connection params → execute SQL → return rows |

### Direct Connection mode

| Method | Endpoint | Body fields | Description |
|--------|----------|-------------|-------------|
| `POST` | `/api/connect/direct` | `host`, `port`, `dbName`, `user`, `password` | Verify Postgres connectivity — no AEP API calls |
| `POST` | `/api/query/direct` | `host`, `port`, `dbName`, `user`, `password`, `query` | Execute SQL directly — no AEP API calls |

All endpoints return `{ error: "..." }` with HTTP 4xx/5xx on failure.

---

## Deploying to Vercel

The project is pre-configured for a **single Vercel deployment** — the React frontend and all API routes deploy together from the repository root.

### How it works

| Part | How it runs on Vercel |
|------|-----------------------|
| Frontend (`frontend/`) | Built with `vite build`, served as a static site from `frontend/dist/` |
| Backend (`api/*.js`) | Vercel Serverless Functions — auto-discovered from the `api/` directory |

All `/api/*` requests are routed to the matching serverless function. Everything else (`/*`) is served by the React SPA. No separate backend service is needed.

### Steps

1. **Push to GitHub** — ensure the repository is up to date:
   ```bash
   git push
   ```

2. **Import the project in Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Click **Add New → Project** and import `bkrishanu/aepQueryBuilder`
   - Vercel will auto-detect the `vercel.json` at the root

3. **No environment variables are required** — all credentials are supplied at runtime by uploading your config JSON in the UI.

4. **Deploy** — click **Deploy**. Vercel will:
   - Run `npm install` at the root (installs `axios` and `pg` for the serverless functions)
   - Run `cd frontend && npm install && npm run build`
   - Serve `frontend/dist/` as the static frontend
   - Expose `api/*.js` as serverless functions at `/api/*`

5. Once deployed, open the Vercel URL and use the tool exactly as in local development.

### Re-deploying after changes

Every push to `master` triggers an automatic redeploy on Vercel if you enable **Git Integration** in the Vercel project settings.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Failed to parse config JSON file" | Ensure the file is valid JSON — no trailing commas, no comments |
| "Failed to load sandboxes" | Check `API_KEY`, `CLIENT_SECRET`, and `SCOPES` in your config file |
| "Connection failed" (AEP mode) | Verify the sandbox is active and your credential has Query Service access |
| "Connection failed" (Direct mode) | Check host, port, database name, username, and password; ensure SSL is accepted |
| Query returns no rows | AEP dataset names are case-sensitive — verify the exact name |
| Multiple queries fail | Place the cursor inside the desired statement, or select the text to run |
| CORS error in browser | Ensure the backend is running on port 4000 and `npm run dev` is active in the frontend |
| `+` button not appearing | Maximum of 3 query tabs — close one before adding another |

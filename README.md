# AEP Query Connector

A web-based query tool for **Adobe Experience Platform (AEP) Query Service**. Upload your AEP credentials as a JSON config file, select a sandbox, connect, and execute SQL queries directly against your AEP datasets — all from the browser.

---

## Architecture

```
frontend/   ← React + Vite + Tailwind CSS (UI)
backend/    ← Node.js + Express (API proxy + Postgres client)
```

The UI is served on `http://localhost:5173` (dev) and the backend API runs on `http://localhost:4000`. In development, Vite proxies all `/api` requests to the backend automatically.

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

### 3. Prepare your config file

Create a JSON file on your local machine with the following structure:

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

> **Where to find these values:**
> Log in to [Adobe Developer Console](https://developer.adobe.com/console), open your project, select the **OAuth Server-to-Server** credential, and copy the values.

| Key | Description |
|-----|-------------|
| `CLIENT_SECRET` | Client Secret of your AEP API credential |
| `API_KEY` | Client ID of your AEP API credential |
| `SCOPES` | Comma-separated OAuth scopes (spaces after commas are automatically stripped by the backend) |
| `IMS_ORG` | Your Adobe IMS Organization ID (found in Admin Console or Developer Console) |
| `TECHNICAL_ACCOUNT_ID` | Technical Account ID from your Developer Console credential |
| `CONTAINER_ID` | Container to use — typically `tenant` |

### 4. Start the backend

```bash
cd backend
npm run dev      # development (auto-reload)
# or
npm start        # production
```

The backend starts on **port 4000**.

### 5. Start the frontend

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Using the Tool

### Step 1 — Upload Config
Click **Upload Config JSON** and select the JSON file you prepared in step 3. The **Organization (IMS_ORG)** field will auto-populate. The config is stored in `sessionStorage` and persists for the browser session; re-upload to replace it.

### Step 2 — Load Sandboxes
Click **Load Sandboxes**. This calls the Adobe IMS token endpoint to obtain a fresh access token, then fetches all available sandboxes for your org. The **Tenant** field will also be populated from the connection parameters host.

### Step 3 — Select Sandbox & Connect
Choose a sandbox from the **Sandbox** dropdown, then click **Connect**. A green indicator confirms a successful connection; red indicates a failure (check the Console Log for details).

### Step 4 — Write & Execute Queries
Switch to the **Query Editor** tab, write your SQL, and click **Execute**. Results appear in the **Results** tab. Use **Copy Results** to copy the data as tab-delimited text (paste directly into Excel).

### Step 5 — Monitor Logs
All actions are timestamped in the **Console Log** panel at the bottom. Click **Clear Logs** to reset it.

---

## Security Notes

- **Access tokens are never stored.** A fresh OAuth token is requested on every backend API call and exists only in server memory for the duration of that request.
- The config file is stored in `sessionStorage` — it is cleared automatically when the browser tab is closed.
- All AEP API calls are proxied through the Node.js backend, so your `CLIENT_SECRET` is never exposed to the browser.

---

## Deploying to Vercel

This project uses a **frontend + backend** split. Vercel handles the React frontend as a static site and the Express backend as serverless functions via the Vercel CLI.

### Option A — Monorepo deployment (recommended)

1. Install the [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
2. From the project root: `vercel`
3. Set the **Root Directory** to `frontend` for the frontend project.
4. For the backend, create a second Vercel project pointing to the `backend` folder, or convert it to Vercel serverless functions (rename `server.js` routes to `api/*.js` files).

### Option B — Separate deployments

| Service | Folder | Platform |
|---------|--------|----------|
| Frontend | `frontend/` | Vercel (static) |
| Backend | `backend/` | Vercel Functions / Railway / Render |

Set the environment variable `VITE_API_BASE_URL` in your Vercel frontend deployment to point to your deployed backend URL, and update `frontend/src/App.jsx` `axios.create({ baseURL })` accordingly.

---

## Project Structure

```
aepQueryBuilder/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          ← Main UI component
│   │   └── index.css        ← Tailwind entry
│   ├── vite.config.js       ← Vite + Tailwind + proxy config
│   └── package.json
├── backend/
│   ├── server.js            ← Express API server
│   └── package.json
├── project.md               ← Original requirements
└── README.md
```

---

## API Reference (Backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sandboxes` | Fetch OAuth token → list all sandboxes + derive tenant |
| `POST` | `/api/connect` | Fetch OAuth token → retrieve sandbox → get connection params → test Postgres connection |
| `POST` | `/api/query` | Fetch OAuth token → get connection params → execute SQL → return rows |

All endpoints expect JSON body with `API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG`, (and `SANDBOX_NAME` / `query` where applicable).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Failed to parse config JSON file" | Ensure the file is valid JSON with no trailing commas |
| "Failed to load sandboxes" | Check `API_KEY`, `CLIENT_SECRET`, and `SCOPES` in your config |
| "Connection failed" | Verify the selected sandbox is active and your credential has Query Service access |
| Query returns no rows | Confirm the dataset name; AEP dataset names are case-sensitive |
| CORS error in browser | Ensure the backend is running on port 4000 and the Vite proxy is active |

# Dataset Explorer for Direct Connection — Options Analysis

Status: analysis only. No code has been changed.
Scope: how the two connection modes reach Adobe Experience Platform (AEP) Query Service, why the Dataset Explorer works only in AEP API mode today, and what it would take to support Direct Connection.

---

## 1. TL;DR

- **Both modes run queries the same way.** They open a PostgreSQL wire-protocol connection to Query Service (`{tenant}.platform-query.adobe.io`) with the `pg` driver. The only difference is where the Postgres credentials come from.
- **The Dataset Explorer does not use Query Service at all.** It reads the AEP **Catalog** API (dataset list) and the **Schema Registry** API (field tree). Both are REST APIs that need an OAuth access token plus `x-api-key`, `x-gw-ims-org-id` and `x-sandbox-name` headers. Direct Connection has only a Postgres host, user and password, so it can't call them.
- **Is it possible?** Partly. A Direct Connection explorer would have to get its metadata **through SQL** (`SHOW TABLES` and similar) rather than REST. That can give you the dataset list and name-based grouping. It can't reliably give you profile-enabled status, merge policies, record counts (cheaply) or the full nested XDM field tree. A hybrid mode that also takes API credentials gets everything back, but then it's essentially AEP API mode.

---

## 2. How each mode connects today

### 2.1 AEP API mode

```text
Browser ──(config.json once)──▶ POST /api/session ──▶ Adobe IMS (verify) ──▶ sealed HttpOnly cookie
Browser ──▶ POST /api/connect  { SANDBOX_NAME }
              backend: IMS token ─▶ Sandbox API ─▶ GET /data/foundation/query/connection_parameters
                                                        └─▶ { host, port, dbName, username, token }
                       pg.Client(host, port, dbName, username, password = token).connect()
Browser ──▶ POST /api/query    { SANDBOX_NAME, query }   (same steps, then client.query(sql))
Browser ──▶ POST /api/datasets { SANDBOX_NAME }          (Catalog REST, streamed NDJSON)
Browser ──▶ POST /api/schema   { SANDBOX_NAME, schemaId } (Schema Registry REST)
```

The credentials (`API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG`) live only in an AES-256-GCM sealed cookie. `requireSession` injects them into each request ([backend/server.js](../backend/server.js)):

```js
function requireSession(req, res, next) {
  ...
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {}
  for (const f of CRED_FIELDS) delete body[f]
  req.body = { ...body, ...session.c }
  next()
}
```

Queries obtain the Postgres credentials from the Query Service **connection_parameters** API. The password is a short-lived token minted per request:

```js
// POST /api/query
const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })
const cpRes = await axios.get(
  'https://platform.adobe.io/data/foundation/query/connection_parameters',
  { headers: { Authorization: `Bearer ${token}`, 'x-api-key': API_KEY,
               'x-gw-ims-org-id': IMS_ORG, 'x-sandbox-name': SANDBOX_NAME } }
)
const { host, port, dbName, username, token: pgToken } = cpRes.data
const client = new Client({ host, port, database: dbName, user: username,
                            password: pgToken, ssl: { rejectUnauthorized: false } })
await client.connect()
const result = await client.query(query)
```

### 2.2 Direct Connection mode

```text
Browser (form: host, port, dbName, user, password)
   ──▶ POST /api/connect/direct { host, port, dbName, user, password }   pg connect + end
   ──▶ POST /api/query/direct   { host, port, dbName, user, password, query }
```

No IMS, no REST APIs, no session cookie. The user pastes the values shown under **Queries → Credentials** in the AEP UI (or uses non-expiring Query Service credentials). The backend opens Postgres directly:

```js
// POST /api/query/direct
const client = new Client({
  host, port: parseInt(port, 10) || 5432, database: dbName, user,
  password: password || '', ssl: { rejectUnauthorized: false },
})
await client.connect()
const result = await client.query(query)
```

On the frontend ([frontend/src/App.jsx](../frontend/src/App.jsx)), the password stays in React state and is sent with **every** query request:

```js
const endpoint = connMode === 'direct' ? '/query/direct' : '/query'
const payload  = connMode === 'direct'
  ? { host: directHost, port: directPort, dbName: directDb, user: directUser, password: directPwd }
  : { SANDBOX_NAME: selectedSandbox }
```

### 2.3 Side-by-side

| Aspect | AEP API mode | Direct Connection |
|---|---|---|
| User supplies | `API_KEY`, `CLIENT_SECRET`, `SCOPES`, `IMS_ORG` (config file) + sandbox pick | `host`, `port`, `dbName`, `user`, `password` |
| Where secrets live | Sealed HttpOnly cookie, never in JS | React state; sent in every request body |
| Postgres password | Fresh token from `connection_parameters` per request | Whatever the user typed (expiring token ≈ 24h, or non-expiring credential) |
| Sandbox | Chosen from Sandbox API list | Implicit in `dbName` (e.g. `prod:all`) |
| IMS org | From config | Implicit in `user` (e.g. `ABC123@AdobeOrg`) |
| Query execution | Postgres wire protocol | Postgres wire protocol (identical) |
| Can call Catalog / Schema Registry / Merge Policy APIs | **Yes** | **No** (no client id, no OAuth token) |
| Route protection | `requireSession` | None |

---

## 3. Why the Dataset Explorer is AEP-mode only

1. **The gate is in App.jsx.** In Direct mode `explorerCreds` is `null`, so the explorer shows its "available in AEP API mode" placeholder:

   ```js
   const explorerCreds = useMemo(() => (
     connMode === 'aep' && connStatus === 'connected' && session && selectedSandbox
       ? { IMS_ORG: session.IMS_ORG, SANDBOX_NAME: selectedSandbox }
       : null
   ), [connMode, connStatus, session, selectedSandbox])
   ```

2. **Every explorer data source is a Platform REST API:**

   | Explorer feature | Source today | Needs |
   |---|---|---|
   | Dataset list, PQS table name | Catalog `GET /dataSets` → `tags["adobe/pqs/table"]` | OAuth + API key |
   | Record count | Catalog `extensions.adobe_lakeHouse.metrics.rowCount` | OAuth + API key |
   | Profile Enabled / Non Profile | Catalog `tags.unifiedProfile` | OAuth + API key |
   | Customer vs. system filtering | Catalog `classification.managedBy` | OAuth + API key |
   | Profile Snapshot → merge policy | Catalog tag + UPS `mergePolicies/{id}` | OAuth + API key |
   | System / Segment Snapshot groups | Catalog `name` | OAuth + API key |
   | Schema field tree (nested, typed) | Schema Registry `xed-full` | OAuth + API key |

3. **The explorer is wired to these endpoints.** `DatasetExplorer.jsx` posts to `/api/datasets` and `/schema` with `{ IMS_ORG, SANDBOX_NAME }`, and its per-sandbox cache is keyed on `${IMS_ORG}|${SANDBOX_NAME}`.

**Could the Direct Connection password be reused as a Bearer token?** For expiring credentials, the password *is* an IMS access token. But Platform APIs also require `x-api-key` (the client id the token was issued to), which Direct Connection doesn't have. Non-expiring credentials aren't IMS tokens at all. Don't build on this.

---

## 4. Is a Direct Connection explorer possible?

Yes, but only using metadata that Query Service exposes **through SQL**. These are the relevant tools. Run the probes in §4.2 against your sandbox before committing to a design, because Query Service's Postgres catalog support is partial and output columns can vary.

### 4.1 SQL metadata sources

| Need | SQL candidate | Notes |
|---|---|---|
| List datasets | `SHOW TABLES;` | Documented. Returns the PQS table name, plus `dataSetId` and dataset display name (`dataSet`) on current versions. Lists system datasets too. |
| Hide system datasets | `SET drop_system_datasets = true;` (session setting) | Verify it exists in your org; it is what the AEP docs suggest for BI/psql clients. |
| Top-level columns + types | `SELECT * FROM <table> LIMIT 0;` | Uses `result.fields` (name, `dataTypeID`). Cheap: no rows are scanned. Nested XDM objects come back as a single struct/record column. |
| Columns via catalog | `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '<table>';` or `pg_catalog` queries | Partially supported, for BI tools (Power BI, Tableau, DBeaver). Nested structs may appear as one opaque type. Test it. |
| Nested field names | `SELECT to_json(<struct_col>) FROM <table> LIMIT 1;` | Infers keys from **data**, not schema. Missing/null branches are invisible, and it costs a real query. |
| Record count | `SELECT COUNT(1) FROM <table>;` | A full scan, slow on large datasets. Only run it on demand. |

### 4.2 Probe script (run in the app's Direct Connection query pane)

```sql
SHOW TABLES;
SET drop_system_datasets = true; SHOW TABLES;
SELECT * FROM <some_table> LIMIT 0;
SELECT table_name, column_name, data_type
  FROM information_schema.columns WHERE table_name = '<some_table>';
SELECT to_json(_<tenant>) FROM <some_table> LIMIT 1;
```

Record which columns each returns, how nested XDM shows up, and the latency of each statement.

### 4.3 Feature parity in a SQL-only explorer

| Feature | Achievable via SQL? | How / caveat |
|---|---|---|
| Dataset list + search | ✅ | `SHOW TABLES` |
| Copy table name | ✅ | Table name from `SHOW TABLES` |
| System group | ✅ | Match `dataSet` display name against `SYSTEM_DATASET_NAMES` |
| Segment Snapshot group | ✅ | Name prefix `Segmentdefinition-Snapshot` |
| Profile Snapshot group (flat) | ✅ | Name prefix `Profile-Snapshot` |
| Merge-policy sub-grouping, DEFAULT/EDGE badges | ❌ | Needs UPS merge policy API |
| Profile Enabled vs. Non Profile | ❌ | `unifiedProfile` tag isn't exposed through SQL. Would collapse into a single "Datasets" group. |
| Customer vs. system filtering | ⚠️ | Only if `drop_system_datasets` works, or name heuristics |
| Record count | ⚠️ | On-demand `COUNT(1)` only, never automatically for the whole list |
| Top-level fields + types | ✅ | `LIMIT 0` or `information_schema` |
| Full nested field tree + copy `a.b[0].c` paths | ⚠️ | Only partially, via data sampling. Types/arrays may be unreliable. |
| Keyboard nav, virtualization, highlighting | ✅ | Unchanged UI code |

**Verdict:** a useful but reduced explorer is feasible: list, search, name-based groups and top-level columns. Matching the AEP-mode experience (profile grouping, merge policies, accurate nested schemas) is **not** possible over SQL alone.

---

## 5. Options

### Option A — SQL-only explorer (no extra credentials)

Use only the Direct Connection's Postgres credentials.

**Backend: new routes** (sketch, not implemented):

```js
// POST /api/datasets/direct   → same NDJSON shape as /api/datasets
const client = new Client({ host, port, database: dbName, user, password, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows } = await client.query('SHOW TABLES')
const datasets = rows.map(r => classifyByName({ id: r.dataSetId || r.name, table: r.name, name: r.dataSet || r.name }))
send({ type: 'page', start: 0, datasets })
send({ type: 'done', scanned: rows.length, total: datasets.length })
await client.end()

// POST /api/schema/direct { table }  → { fields: [{ name, type, children? }] }
const r = await client.query(`SELECT * FROM ${pgIdent(table)} LIMIT 0`)
const fields = r.fields.map(f => ({ name: f.name, type: pgTypeName(f.dataTypeID) }))
```

`classifyByName` would reuse the name rules from `toExplorerDataset` (System list, `Segmentdefinition-Snapshot`, `Profile-Snapshot`). Today those rules are mixed with Catalog-only checks (`managedBy`, `unifiedProfile`), so they'd need to be pulled out into a shared helper. `pgIdent` must quote/validate the table name, because SQL identifiers can't be bound as parameters.

**Frontend changes:**
- Give `DatasetExplorer` a data-source adapter (or `mode` prop) so the dataset and schema endpoints aren't hard-coded to `/api/datasets` and `/schema`.
- In direct mode, the cache key becomes `${host}|${dbName}|${user}`.
- In direct mode, hide or merge the groups that can't be computed: Profile Enabled / Non Profile → one "Datasets" group, and Profile Snapshots shown flat without merge policies.
- `explorerCreds` in App.jsx must return a value for `connMode === 'direct'`.

**Pros:** no new credentials, and it works for users who only have Query Service access.
**Cons:** reduced features (§4.3). Each call opens a new Postgres connection to Query Service, which has noticeable handshake latency. Nested schemas are approximate.

### Option B — Hybrid: Direct Connection + optional API credentials

Keep Direct Connection for queries. Optionally let the user also upload the AEP config file, used **only** for the explorer. The sandbox comes from `dbName` (`prod:all` → `prod`) and the org from `user`. The existing `/api/datasets` and `/api/schema` routes can be reused as-is.

**Pros:** full feature parity with zero new metadata code.
**Cons:** the user needs API credentials anyway, which is exactly what AEP API mode already supports, so the value over AEP mode is small. You also have to handle a mismatch between the uploaded org/sandbox and the Postgres org/sandbox.

### Option C — Option A first, then upgrade to B when API credentials are present

Ship the SQL-only explorer. If an API session cookie also exists, switch the same component to the Catalog/Schema Registry adapter. This gives the most flexibility and needs the most code.

**Recommendation:** first run the probes in §4.2. If `SHOW TABLES` returns `dataSet`/`dataSetId`, and `LIMIT 0` / `information_schema` give usable columns, build **Option A**, structured so that Option C is a later drop-in. If the probes show poor nested-field support, decide whether top-level columns are good enough before investing.

---

## 6. Changes needed regardless of option

1. **Secure the direct credentials before multiplying their use.** An explorer adds many requests per session. Today each one would carry the Postgres password in the body, and `/api/connect/direct` / `/api/query/direct` have no session guard. Extend the existing sealed-cookie mechanism (`seal` / `requireSession`) to direct credentials: post them once to a `/api/session/direct`, and have the direct routes read them from the cookie.
2. **Restrict the target host.** The direct routes connect to any host the caller supplies, so the backend can be used to probe arbitrary hosts (SSRF). Allow-list `*.platform-query.adobe.io` (and the port) before adding more direct endpoints.
3. **Reuse Postgres connections where possible.** Query Service connections are slow to establish. Consider running `SHOW TABLES` and multiple `LIMIT 0` probes on one connection per request, or a short-lived per-session pool on non-serverless hosts. On Vercel, keep it per request.
4. **Factor the name-based classification** out of `toExplorerDataset` so both modes share the System / Segment Snapshot / Profile Snapshot rules.
5. **Make `DatasetExplorer` source-agnostic.** Use the adapter/props for the endpoints and cache key, plus a flag for which groups are supported.
6. **Docs:** update the README's Dataset Explorer section to describe the direct-mode capabilities and limits.

---

## 7. Open questions to settle with the probes

- Which columns does `SHOW TABLES` return in your org (`name`, `dataSetId`, `dataSet`, `description`, …)?
- Does `SET drop_system_datasets = true` work, and does it hide the AJO/System datasets you now *want* to show?
- How does `information_schema.columns` / `LIMIT 0` represent nested XDM structs and arrays?
- What is the latency of a cold Postgres connection plus `SHOW TABLES` for your sandbox size?

import axios from 'axios'

// ─── shared API client ───────────────────────────────────────────────────────
// AEP credentials live in an HttpOnly session cookie set by POST /api/session;
// the browser sends it automatically on same-origin requests and page scripts
// never see the secrets. When the backend reports the session is gone, a
// SESSION_EXPIRED event is broadcast so the app can reset its state.
export const SESSION_EXPIRED = 'aep:session-expired'

export const notifySessionExpired = () => window.dispatchEvent(new Event(SESSION_EXPIRED))

export const isSessionError = (status, body) => status === 401 && body?.code === 'SESSION_REQUIRED'

const api = axios.create({ baseURL: '/api', withCredentials: true })

api.interceptors.response.use(undefined, (err) => {
  // GET /session is the "is there a session?" probe — a 401 there is expected
  const probe = err.config?.method === 'get' && err.config?.url === '/session'
  if (!probe && isSessionError(err.response?.status, err.response?.data)) notifySessionExpired()
  return Promise.reject(err)
})

// Server settings (default Postgres port, result limits) from GET /api/config,
// fetched once. The backend owns these values; the UI never hard-codes them.
let configPromise = null
export const getServerConfig = () => (configPromise ??= api.get('/config')
  .then(res => res.data)
  .catch(() => { configPromise = null; return null }))

export default api

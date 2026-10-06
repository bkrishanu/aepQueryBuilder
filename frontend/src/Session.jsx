import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Clock3, TriangleAlert, X, Upload } from 'lucide-react'

// ─── credential session countdown ─────────────────────────────────────────────
// The AEP credential session ends at `expiresAt` (set by the backend). Each
// component ticks on its own, so the once-a-second update re-renders only
// itself and not the whole app.
const SESSION_WARN_MS = 10 * 60 * 1000
const URGENT_MS = 2 * 60 * 1000

// remembered per browser tab so a reload doesn't warn again for the same session
const WARNED_KEY = 'aepqe.sessionWarned'

/** "54:07", or "1:02:09" past an hour. */
function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const spoken = (ms) => {
  const min = Math.ceil(ms / 60000)
  return min > 1 ? `${min} minutes` : 'less than a minute'
}

function useRemaining(expiresAt) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return expiresAt - now
}

/**
 * Header pill counting down to `expiresAt`. Calls onWarn once per session when
 * SESSION_WARN_MS remain, and onExpire when the time is up — before the next
 * API call would fail on the expired cookie.
 */
export function SessionTimer({ expiresAt, onWarn, onExpire }) {
  const remaining = useRemaining(expiresAt)
  const cbs = useRef({ onWarn, onExpire })
  useLayoutEffect(() => { cbs.current = { onWarn, onExpire } })

  const warn = remaining <= SESSION_WARN_MS
  const expired = remaining <= 0
  useEffect(() => {
    if (!warn || expired) return
    let warned = null
    try { warned = sessionStorage.getItem(WARNED_KEY) } catch { /* storage unavailable */ }
    if (warned === String(expiresAt)) return
    try { sessionStorage.setItem(WARNED_KEY, String(expiresAt)) } catch { /* storage unavailable */ }
    cbs.current.onWarn?.()
  }, [warn, expired, expiresAt])
  useEffect(() => {
    if (expired) cbs.current.onExpire?.()
  }, [expired])

  const tone = remaining <= URGENT_MS
    ? 'border-rose-300/40 bg-rose-500/25 text-rose-50'
    : warn ? 'border-amber-300/40 bg-amber-400/20 text-amber-50' : 'border-white/15 bg-white/10 text-white'
  return (
    <span
      role="timer"
      aria-label={`Credential session expires in ${spoken(remaining)}`}
      title={`Credential session expires at ${new Date(expiresAt).toLocaleTimeString()}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur-sm whitespace-nowrap ${tone}`}
    >
      <Clock3 size={13} strokeWidth={2.25} aria-hidden="true" />
      <span className="hidden sm:inline">Session</span>
      {formatRemaining(remaining)}
    </span>
  )
}

/**
 * Warning shown once when the session is about to end. Query tabs are already
 * saved locally; Renew re-uploads the config to start a fresh session.
 */
export function SessionWarning({ expiresAt, onRenew, onDismiss }) {
  const remaining = useRemaining(expiresAt)
  return (
    <div
      role="alert"
      className="toast-in fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-amber-200 bg-surface shadow-xl shadow-black/10"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <TriangleAlert size={16} strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Session expires in <span className="tabular-nums">{formatRemaining(remaining)}</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Your query tabs are saved in this browser. Copy or download any results you need — when the
            session ends you'll need to upload your config again. Renew now to keep working without interruption.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRenew}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-xs font-semibold text-white hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            >
              <Upload size={13} strokeWidth={2.25} /> Renew session
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-surface px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

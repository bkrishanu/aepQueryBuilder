import { useState } from 'react'
import { History, Search, Trash2, X } from 'lucide-react'
import { Popover } from './Overlay.jsx'
import { HISTORY_LIMIT } from './queryHistory.js'

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 2 * 86400) return 'yesterday'
  return new Date(ts).toLocaleDateString()
}

const formatDuration = (ms) => (ms == null ? null : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

const STATUS_DOT = {
  success:   'bg-emerald-500',
  error:     'bg-rose-500',
  cancelled: 'bg-amber-500',
}

/**
 * Dropdown of the target's recent queries (see queryHistory.js). Choosing one
 * loads it into the active editor tab — it is never run automatically.
 */
export default function HistoryPanel({ anchor, entries, targetLabel, onSelect, onRemove, onClear, onClose }) {
  const [search, setSearch] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const needle = search.trim().toLowerCase()
  const shown = needle ? entries.filter(e => e.query.toLowerCase().includes(needle)) : entries

  return (
    <Popover anchor={anchor} onClose={onClose} label="Query history" align="end" className="w-[28rem]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <History size={15} strokeWidth={2.25} className="shrink-0 text-blue-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Query history</p>
            <p className="truncate text-[11px] text-slate-400" title={targetLabel}>
              {targetLabel ? `${targetLabel} · last ${HISTORY_LIMIT} queries` : 'Connect to see history'}
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close history" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>

      {entries.length > 0 && (
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="relative">
            <Search size={13} strokeWidth={2.25} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search history…"
              aria-label="Search query history"
              className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-8 pr-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      )}

      <ul className="explorer-scroll max-h-[min(24rem,60vh)] overflow-y-auto py-1">
        {entries.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-slate-400">
            {targetLabel ? 'No queries run against this target yet.' : 'Pick a sandbox or Direct Connection host to see its history.'}
          </li>
        )}
        {entries.length > 0 && shown.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-slate-400">No queries match “{search.trim()}”.</li>
        )}
        {shown.map(e => (
          <li key={e.id} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(e)}
              title="Load into the active editor tab"
              className="block w-full px-4 py-2 pr-10 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-blue-50"
            >
              <code className="line-clamp-2 break-all font-mono text-[12px] leading-snug text-slate-700">{e.query}</code>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400 tabular-nums">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status] || STATUS_DOT.success}`} aria-label={e.status} />
                <span title={new Date(e.executedAt).toLocaleString()}>{timeAgo(e.executedAt)}</span>
                {e.duration != null && <span>· {formatDuration(e.duration)}</span>}
                {e.rowCount != null && <span>· {plural(e.rowCount, 'row')}</span>}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              aria-label="Remove from history"
              title="Remove from history"
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-slate-400 opacity-0 hover:bg-slate-200 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </li>
        ))}
      </ul>

      {entries.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs">
          <span className="text-slate-400">{entries.length.toLocaleString()} {entries.length === 1 ? 'query' : 'queries'} · stored in this browser</span>
          {confirmClear ? (
            <span className="flex items-center gap-2">
              <span className="text-slate-600">Clear all?</span>
              <button type="button" onClick={() => { onClear(); setConfirmClear(false) }} className="font-semibold text-rose-600 hover:underline">Clear</button>
              <button type="button" onClick={() => setConfirmClear(false)} className="font-semibold text-slate-500 hover:underline">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600">
              <Trash2 size={12} strokeWidth={2.25} /> Clear history
            </button>
          )}
        </div>
      )}
    </Popover>
  )
}

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

// ─── JsonTree ─────────────────────────────────────────────────────────────────
// Collapsible view of a JSON value — nested XDM objects and arrays read as an
// outline instead of one long line. Nodes shallower than `expandDepth` start
// open; large containers show their children in chunks.
const CHUNK = 200

export default function JsonTree({ value, expandDepth = 2 }) {
  return (
    <ul role="tree" className="font-mono text-[12px] leading-relaxed text-slate-700">
      <Node value={value} depth={0} expandDepth={expandDepth} isLast />
    </ul>
  )
}

function Scalar({ value }) {
  if (value === null) return <span className="italic text-slate-400">null</span>
  if (typeof value === 'string') return <span className="text-emerald-700 break-words">"{value}"</span>
  if (typeof value === 'number') return <span className="text-blue-700">{value}</span>
  if (typeof value === 'boolean') return <span className="text-violet-700">{String(value)}</span>
  return <span>{String(value)}</span>
}

function Node({ name, value, depth, expandDepth, isLast }) {
  const container = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const entries = container ? (isArray ? value.map((v, i) => [i, v]) : Object.entries(value)) : []
  const [open, setOpen] = useState(depth < expandDepth)
  const [shown, setShown] = useState(CHUNK)
  const comma = isLast ? '' : ','

  const key = name !== undefined && (
    <>
      <span className={typeof name === 'number' ? 'text-slate-400' : 'text-sky-700'}>
        {typeof name === 'number' ? name : `"${name}"`}
      </span>
      <span className="text-slate-400">: </span>
    </>
  )

  if (!container) {
    return (
      <li role="treeitem" className="pl-5">
        {key}<Scalar value={value} />{comma}
      </li>
    )
  }

  const [openCh, closeCh] = isArray ? ['[', ']'] : ['{', '}']
  const summary = isArray ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} key${entries.length === 1 ? '' : 's'}`
  if (!entries.length) {
    return (
      <li role="treeitem" className="pl-5">
        {key}<span className="text-slate-500">{openCh}{closeCh}</span>{comma}
      </li>
    )
  }

  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="group inline-flex items-start text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <ChevronRight size={14} strokeWidth={2.25} className={`mt-[3px] mr-1.5 shrink-0 text-slate-400 transition-transform group-hover:text-slate-700 ${open ? 'rotate-90' : ''}`} />
        <span>
          {key}
          <span className="text-slate-500">{openCh}</span>
          {!open && (
            <>
              <span className="mx-1 rounded bg-slate-100 px-1.5 text-[11px] text-slate-500">{summary}</span>
              <span className="text-slate-500">{closeCh}</span>{comma}
            </>
          )}
        </span>
      </button>
      {open && (
        <>
          <ul role="group" className="ml-[6px] border-l border-slate-200 pl-2">
            {entries.slice(0, shown).map(([k, v], i) => (
              <Node
                key={k}
                name={k}
                value={v}
                depth={depth + 1}
                expandDepth={expandDepth}
                isLast={i === entries.length - 1}
              />
            ))}
            {entries.length > shown && (
              <li className="pl-5">
                <button
                  type="button"
                  onClick={() => setShown(s => s + CHUNK)}
                  className="text-[11px] font-semibold text-blue-600 hover:underline"
                >
                  Show {Math.min(CHUNK, entries.length - shown).toLocaleString()} more of {(entries.length - shown).toLocaleString()}…
                </button>
              </li>
            )}
          </ul>
          <span className="pl-5 text-slate-500">{closeCh}{comma}</span>
        </>
      )}
    </li>
  )
}

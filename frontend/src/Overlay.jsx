import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Modal ────────────────────────────────────────────────────────────────────
// Centered dialog over a dimmed backdrop. Closes on Escape or a click on the
// backdrop; focus moves into the dialog (an element marked data-autofocus, else
// the dialog itself) and back to where it was on close.
export function Modal({ label, onClose, children, className = 'max-w-3xl' }) {
  const boxRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const prev = document.activeElement
    const box = boxRef.current
    ;(box?.querySelector('[data-autofocus]') || box)?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current() } }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full flex-col rounded-xl border border-slate-200 bg-surface shadow-xl focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ─── Popover ──────────────────────────────────────────────────────────────────
// Panel anchored under (or, without room, over) `anchor`, rendered in a portal
// with fixed positioning so scrolling containers (the results grid) never clip
// it. Closes on Escape — returning focus to the anchor — or a pointer press
// outside both the panel and the anchor.
export function Popover({ anchor, onClose, label, align = 'start', className = 'w-72', children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose })

  useLayoutEffect(() => {
    const place = () => {
      const panel = ref.current
      if (!anchor?.isConnected || !panel) return
      const a = anchor.getBoundingClientRect()
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      const margin = 8
      let left = align === 'end' ? a.right - w : a.left
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin))
      let top = a.bottom + 6
      if (top + h > window.innerHeight - margin && a.top - h - 6 > margin) top = a.top - h - 6
      setPos({ left, top: Math.max(margin, top) })
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return
      onCloseRef.current()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCloseRef.current()
      anchor?.focus?.()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className={`toast-in z-50 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-surface text-slate-700 shadow-xl shadow-black/10 ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}

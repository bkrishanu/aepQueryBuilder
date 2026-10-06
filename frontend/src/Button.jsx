import { LoaderCircle } from 'lucide-react'

// ─── Btn ──────────────────────────────────────────────────────────────────────
// Shared button used across the app.
//   variant: primary | success | stop | danger | secondary | ghost
//   size:    sm (32px) | md (38px)
//   icon:    a lucide-react icon component; swapped for a spinner while loading
//   iconClassName: extra classes for the icon (e.g. 'fill-current' for a solid glyph)
const VARIANTS = {
  primary:
    'text-white border-blue-700 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 ' +
    'dark:border-blue-600 dark:hover:to-blue-600 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(30,64,175,0.35)] focus-visible:ring-blue-500/40',
  success:
    'text-white border-emerald-700 bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 ' +
    'dark:border-emerald-600 dark:hover:to-emerald-600 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(6,95,70,0.35)] focus-visible:ring-emerald-500/40',
  stop:
    'text-white border-rose-700 bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 ' +
    'dark:border-rose-600 dark:hover:to-rose-600 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(159,18,57,0.35)] focus-visible:ring-rose-500/40',
  danger:
    'text-rose-600 border-rose-200 bg-surface hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 ' +
    'shadow-[0_1px_2px_rgba(15,23,42,0.06)] focus-visible:ring-rose-500/30',
  secondary:
    'text-slate-700 border-slate-300 bg-surface hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 ' +
    'shadow-[0_1px_2px_rgba(15,23,42,0.06)] focus-visible:ring-blue-500/30',
  ghost:
    'text-slate-500 border-transparent bg-transparent hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-blue-500/30',
}

const SIZES = {
  sm: { btn: 'h-8 px-3 text-[13px] gap-1.5 rounded-md', icon: 14 },
  md: { btn: 'h-[38px] px-4 text-sm gap-2 rounded-lg',  icon: 16 },
}

export default function Btn({
  onClick, disabled, variant = 'primary', size = 'md', loading = false,
  icon: Icon, iconClassName = '', title, children, className = '',
}) {
  const s = SIZES[size]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center border font-semibold tracking-[0.01em] whitespace-nowrap select-none transition-all duration-150 focus:outline-none focus-visible:ring-4 active:translate-y-px disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none disabled:active:translate-y-0 ${s.btn} ${VARIANTS[variant]} ${className}`}
    >
      {loading
        ? <LoaderCircle size={s.icon} strokeWidth={2.25} className="animate-spin shrink-0" />
        : Icon && <Icon size={s.icon} strokeWidth={2.25} className={`shrink-0 ${iconClassName}`} />}
      {children}
    </button>
  )
}

// ─── IconBtn ──────────────────────────────────────────────────────────────────
// Compact square icon-only button with a hover/focus tooltip.
//   label:    accessible name (aria-label) and tooltip text — required
//   shortcut: optional key hint shown in the tooltip, e.g. "Ctrl+Enter"
//   keyShortcuts: the same in aria-keyshortcuts syntax, e.g. "Control+Enter"
//   align:    tooltip alignment under the button — center | end (use end near
//             the right edge of the screen so the tooltip never overflows)
const ICON_SIZES = {
  sm: { btn: 'h-8 w-8 rounded-md',          icon: 15 },
  md: { btn: 'h-[38px] w-[38px] rounded-lg', icon: 17 },
}

export function IconBtn({
  icon: Icon, label, shortcut, keyShortcuts, onClick, disabled, variant = 'secondary', size = 'md',
  loading = false, iconClassName = '', align = 'center', className = '',
}) {
  const s = ICON_SIZES[size]
  return (
    <span className="group/tip relative inline-flex shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        aria-busy={loading || undefined}
        className={`inline-flex items-center justify-center border select-none transition-all duration-150 focus:outline-none focus-visible:ring-4 active:translate-y-px disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none disabled:active:translate-y-0 ${s.btn} ${VARIANTS[variant]} ${className}`}
      >
        {loading
          ? <LoaderCircle size={s.icon} strokeWidth={2.25} className="animate-spin" />
          : <Icon size={s.icon} strokeWidth={2.25} className={iconClassName} />}
      </button>
      <span
        aria-hidden="true"
        className={`theme-fixed pointer-events-none absolute top-full z-30 dark:ring-1 dark:ring-white/10 mt-1.5 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-within/tip:opacity-100 ${
          align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'
        }`}
      >
        {label}
        {shortcut && <span className="ml-1.5 rounded bg-white/15 px-1 py-px font-mono text-[10px] text-slate-200">{shortcut}</span>}
      </span>
    </span>
  )
}

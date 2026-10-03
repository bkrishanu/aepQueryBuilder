import { LoaderCircle } from 'lucide-react'

// ─── Btn ──────────────────────────────────────────────────────────────────────
// Shared button used across the app.
//   variant: primary | success | danger | secondary | ghost
//   size:    sm (32px) | md (38px)
//   icon:    a lucide-react icon component; swapped for a spinner while loading
//   iconClassName: extra classes for the icon (e.g. 'fill-current' for a solid glyph)
const VARIANTS = {
  primary:
    'text-white border-blue-700 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(30,64,175,0.35)] focus-visible:ring-blue-500/40',
  success:
    'text-white border-emerald-700 bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(6,95,70,0.35)] focus-visible:ring-emerald-500/40',
  danger:
    'text-rose-600 border-rose-200 bg-white hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 ' +
    'shadow-[0_1px_2px_rgba(15,23,42,0.06)] focus-visible:ring-rose-500/30',
  secondary:
    'text-slate-700 border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 ' +
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

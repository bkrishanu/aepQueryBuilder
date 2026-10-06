import { Sun, Moon, Monitor } from 'lucide-react'

const OPTIONS = [
  { id: 'light',  label: 'Light theme',             icon: Sun },
  { id: 'dark',   label: 'Dark theme',              icon: Moon },
  { id: 'system', label: 'System theme (follows your OS)', icon: Monitor },
]

/** Light / Dark / System segmented control, styled for the dark brand header. */
export default function ThemeToggle({ value, onChange }) {
  const select = (id) => onChange(id)
  const onKeyDown = (e) => {
    const i = OPTIONS.findIndex(o => o.id === value)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length]
    select(next.id)
    e.currentTarget.querySelector(`[data-theme-option="${next.id}"]`)?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      onKeyDown={onKeyDown}
      className="flex items-center gap-0.5 rounded-full border border-white/15 bg-white/10 p-0.5 backdrop-blur-sm"
    >
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const on = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            data-theme-option={id}
            tabIndex={on ? 0 : -1}
            onClick={() => select(id)}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 ${
              on ? 'bg-white/20 text-white shadow-sm' : 'text-sky-100/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon size={14} strokeWidth={2.25} />
          </button>
        )
      })}
    </div>
  )
}

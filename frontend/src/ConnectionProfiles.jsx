import { useState } from 'react'
import { ChevronDown, BookmarkPlus, Save, Pencil, Trash2, Check, X } from 'lucide-react'
import Btn from './Button.jsx'
import { PROFILE_FIELDS } from './profiles.js'

// Saved Direct Connection profiles (see profiles.js) — never includes the password.
const FIELDS = PROFILE_FIELDS
const MAX_NAME = 60

const pick = (fields) => Object.fromEntries(FIELDS.map(f => [f, (fields[f] || '').trim()]))
const sameFields = (a, b) => FIELDS.every(f => (a[f] || '').trim() === (b[f] || '').trim())

/**
 * Profile dropdown with Save as new / Update / Rename / Delete. Selecting a
 * profile fills the connection fields through onApply; they stay editable.
 * `fields` is the current { host, port, dbName, user } of the form.
 */
export default function ConnectionProfiles({ profiles, onChange, fields, onApply, addLog, inputClassName, labelClassName }) {
  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState(null)   // null | 'new' | 'rename'
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selected = profiles.find(p => p.id === selectedId) || null
  const modified = selected && !sameFields(selected, fields)

  const select = (id) => {
    setSelectedId(id)
    setConfirmDelete(false)
    setEditing(null)
    const p = profiles.find(x => x.id === id)
    if (p) {
      onApply(p)
      addLog('info', `Profile "${p.name}" loaded — enter the password to connect.`)
    }
  }

  const startEdit = (mode) => {
    setEditing(mode)
    setError('')
    setConfirmDelete(false)
    setName(mode === 'rename' ? selected.name : (fields.user && fields.host ? `${fields.user}@${fields.host.split('.')[0]}` : ''))
  }

  const commitName = () => {
    const n = name.trim().slice(0, MAX_NAME)
    if (!n) { setError('Enter a profile name.'); return }
    const clash = profiles.find(p => p.name.toLowerCase() === n.toLowerCase() && p.id !== (editing === 'rename' ? selectedId : null))
    if (clash) { setError(`A profile named "${clash.name}" already exists.`); return }
    if (editing === 'new') {
      const p = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: n, ...pick(fields) }
      onChange([...profiles, p].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(p.id)
      addLog('info', `Profile "${n}" saved (the password is not stored).`)
    } else {
      onChange(profiles.map(p => (p.id === selectedId ? { ...p, name: n } : p)).sort((a, b) => a.name.localeCompare(b.name)))
      addLog('info', `Profile renamed to "${n}".`)
    }
    setEditing(null)
  }

  const update = () => {
    onChange(profiles.map(p => (p.id === selectedId ? { ...p, ...pick(fields) } : p)))
    addLog('info', `Profile "${selected.name}" updated with the current fields.`)
  }

  const remove = () => {
    onChange(profiles.filter(p => p.id !== selectedId))
    addLog('info', `Profile "${selected.name}" deleted.`)
    setSelectedId('')
    setConfirmDelete(false)
  }

  return (
    <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
      <div className="col-span-12 md:col-span-6 lg:col-span-5">
        <label htmlFor="direct-profile" className={labelClassName}>Saved Profile</label>
        {editing ? (
          <input
            id="direct-profile"
            autoFocus
            type="text"
            value={name}
            maxLength={MAX_NAME}
            onChange={e => { setName(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); else if (e.key === 'Escape') setEditing(null) }}
            placeholder="Profile name"
            aria-invalid={!!error}
            aria-describedby={error ? 'direct-profile-error' : undefined}
            className={inputClassName}
          />
        ) : (
          <div className="relative">
            <select
              id="direct-profile"
              value={selectedId}
              onChange={e => select(e.target.value)}
              disabled={profiles.length === 0}
              className={`${inputClassName} appearance-none pr-9 cursor-pointer`}
            >
              <option value="">{profiles.length ? '— Select a profile —' : 'No saved profiles yet'}</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        )}
      </div>

      <div className="col-span-12 md:col-span-6 lg:col-span-7 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Btn variant="primary" icon={Check} onClick={commitName}>{editing === 'new' ? 'Save profile' : 'Rename'}</Btn>
            <Btn variant="secondary" icon={X} onClick={() => setEditing(null)}>Cancel</Btn>
          </>
        ) : confirmDelete ? (
          <>
            <span className="text-sm text-slate-600">Delete “{selected?.name}”?</span>
            <Btn variant="danger" icon={Trash2} onClick={remove}>Delete</Btn>
            <Btn variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          </>
        ) : (
          <>
            <Btn
              variant="secondary"
              icon={BookmarkPlus}
              onClick={() => startEdit('new')}
              disabled={!fields.host?.trim()}
              title={fields.host?.trim() ? 'Save the current host, port, database and user as a profile' : 'Fill in a host first'}
            >
              Save as new
            </Btn>
            {selected && (
              <>
                <Btn variant="secondary" icon={Save} onClick={update} disabled={!modified} title={modified ? 'Save the current fields into this profile' : 'No changes to save'}>
                  Update
                </Btn>
                <Btn variant="secondary" icon={Pencil} onClick={() => startEdit('rename')}>Rename</Btn>
                <Btn variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete</Btn>
              </>
            )}
          </>
        )}
      </div>
      {(error || (selected && modified && !editing)) && (
        <p id="direct-profile-error" className={`col-span-12 -mt-1 text-[11px] ${error ? 'text-rose-600' : 'text-slate-400'}`} role={error ? 'alert' : undefined}>
          {error || `Fields differ from “${selected.name}” — Update saves them to the profile.`}
        </p>
      )}
    </div>
  )
}

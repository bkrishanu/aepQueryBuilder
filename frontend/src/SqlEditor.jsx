import { useRef, useMemo, useEffect, useLayoutEffect, useImperativeHandle, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView, keymap, Decoration, WidgetType } from '@codemirror/view'
import { Prec, StateField, StateEffect } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { resolveStatements, splitStatements } from './sqlStatements.js'

// ─── DBeaver-inspired light theme (white background) ─────────────────────────
// Colour mapping mirrors DBeaver's SQL syntax on a white editor background:
//   keywords     → bold cornflower-blue   #0000cd  (DBeaver bold blue)
//   functions    → dark cyan              #007080
//   strings      → dark red/brown         #a31515
//   numbers      → dark green             #008000
//   comments     → grey-green italic      #5f7a5f
//   operators    → dark blue              #0000ff
//   punctuation  → dark grey              #555555
//   identifiers  → near-black             #1f2328
//   background   → white                  #ffffff
//   cursor line  → translucent light blue (lets selection show through)
//   selection    → saturated blue tint    #9ec5fe (focused) / #c9dcf5 (blurred)
const MONO_FONT = "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"

// Colours for the light (DBeaver) and dark editor themes. The dark theme pairs
// with One Dark's syntax colours (oneDarkHighlightStyle).
const PALETTES = {
  light: {
    bg: '#ffffff', text: '#1f2328', caret: '#1f2328',
    selection: '#c9dcf5', selectionFocused: '#9ec5fe',
    match: '#fde68a80', matchOutline: '#f59e0b55',
    activeLine: 'rgba(37, 99, 235, 0.06)', activeLineGutter: '#eef2fb',
    gutterBg: '#f5f5f5', gutterText: '#999999', gutterBorder: '#dddddd',
    bracket: '#c8e6c8', bracketOutline: '#4caf50',
    scrollTrack: '#f5f5f5', scrollThumb: '#cccccc', scrollThumbHover: '#aaaaaa',
    placeholder: '#aaaaaa',
    errorMsgBg: '#fff1f2', errorMsgText: '#be123c',
  },
  dark: {
    bg: '#0d1526', text: '#d6deeb', caret: '#e2e8f0',
    selection: '#1e3a5f', selectionFocused: '#264f80',
    match: 'rgba(250, 204, 21, 0.18)', matchOutline: 'rgba(250, 204, 21, 0.35)',
    activeLine: 'rgba(96, 165, 250, 0.07)', activeLineGutter: '#16223a',
    gutterBg: '#0f182b', gutterText: '#5c6a85', gutterBorder: '#1f2b44',
    bracket: 'rgba(74, 222, 128, 0.18)', bracketOutline: '#22c55e',
    scrollTrack: '#0d1526', scrollThumb: '#2a3a57', scrollThumbHover: '#3b4f74',
    placeholder: '#5c6a85',
    errorMsgBg: 'rgba(225, 29, 72, 0.12)', errorMsgText: '#fda4af',
  },
}

const makeTheme = (c, dark) => EditorView.theme(
  {
    '&': {
      backgroundColor: c.bg,
      color: c.text,
      fontFamily: MONO_FONT,
      fontSize: '13px',
      height: '100%',
    },
    '.cm-content': {
      caretColor: c.caret,
      padding: '12px 16px',
      minHeight: '100%',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: MONO_FONT,
    },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { lineHeight: '1.6' },

    // cursor
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret },

    // selection — CodeMirror paints the selection layer *behind* the text, so
    // the active-line background below must stay translucent or it hides it.
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: c.selection,
    },
    // must match the specificity of CodeMirror's base-theme focused selector
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-content ::selection': {
      backgroundColor: c.selectionFocused,
    },
    // other occurrences of the selected word
    '.cm-selectionMatch': {
      backgroundColor: c.match,
      outline: `1px solid ${c.matchOutline}`,
      borderRadius: '2px',
    },

    // active line highlight (translucent so selections remain visible)
    '.cm-activeLine': { backgroundColor: c.activeLine },
    '.cm-activeLineGutter': { backgroundColor: c.activeLineGutter },

    // gutter
    '.cm-gutters': {
      backgroundColor: c.gutterBg,
      color: c.gutterText,
      borderRight: `1px solid ${c.gutterBorder}`,
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },

    // matched brackets
    '.cm-matchingBracket': {
      backgroundColor: c.bracket,
      outline: `1px solid ${c.bracketOutline}`,
    },

    // scrollbar (webkit)
    '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: c.scrollTrack },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      background: c.scrollThumb,
      borderRadius: '4px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': { background: c.scrollThumbHover },

    // placeholder
    '.cm-placeholder': { color: c.placeholder },

    // SQL error reported by the server (see errorField)
    '.cm-sqlError': {
      textDecoration: 'underline wavy #e11d48',
      textUnderlineOffset: '3px',
      backgroundColor: 'rgba(225, 29, 72, 0.08)',
    },
    '.cm-sqlErrorLine': { backgroundColor: 'rgba(225, 29, 72, 0.05)' },
    '.cm-sqlErrorMsg': {
      margin: '2px 0 4px',
      padding: '3px 8px',
      borderLeft: '3px solid #e11d48',
      backgroundColor: c.errorMsgBg,
      color: c.errorMsgText,
      fontSize: '12px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
    },
  },
  { dark }
)

const lightTheme = makeTheme(PALETTES.light, false)
const darkTheme  = [makeTheme(PALETTES.dark, true), syntaxHighlighting(oneDarkHighlightStyle)]

// SQL token colours — DBeaver style on white background
const sqlHighlightStyle = [
  // keywords  (SELECT, FROM, WHERE, …)
  { tag: 'keyword', color: '#0000cd', fontWeight: 'bold' },
  // type keywords (INT, VARCHAR, …)
  { tag: 'typeName', color: '#0000cd', fontWeight: 'bold' },
  // built-in functions
  { tag: 'function(name)', color: '#007080' },
  { tag: 'variableName', color: '#1f2328' },
  // strings
  { tag: 'string', color: '#a31515' },
  { tag: 'string2', color: '#a31515' },
  // numbers
  { tag: 'number', color: '#008000' },
  // comments
  { tag: 'comment', color: '#5f7a5f', fontStyle: 'italic' },
  { tag: 'lineComment', color: '#5f7a5f', fontStyle: 'italic' },
  { tag: 'blockComment', color: '#5f7a5f', fontStyle: 'italic' },
  // operators  (=, >, <, *, …)
  { tag: 'operator', color: '#0000ff' },
  { tag: 'compareOperator', color: '#0000ff' },
  // punctuation / separators
  { tag: 'punctuation', color: '#555555' },
  { tag: 'separator', color: '#555555' },
  // identifiers / schema names
  { tag: 'name', color: '#1f2328' },
  { tag: 'propertyName', color: '#1f2328' },
  // special literals (NULL, TRUE, FALSE)
  { tag: 'bool', color: '#7b00d4', fontWeight: 'bold' },
  { tag: 'null', color: '#7b00d4', fontWeight: 'bold' },
]

// Ctrl+Enter / Cmd+Enter → run. Highest precedence: the default keymap binds
// Mod-Enter to "insert blank line".
const runKeymap = (onRun) => {
  const run = () => { onRun(); return true }
  return Prec.highest(keymap.of([
    { key: 'Mod-Enter', run },
    { key: 'Ctrl-Enter', run },
  ]))
}

// ─── server error highlighting ───────────────────────────────────────────────
// The failing token is underlined, its line tinted and the message shown
// beneath it. Cleared as soon as the document changes.
const setErrorEffect = StateEffect.define()

class ErrorMessageWidget extends WidgetType {
  constructor(message) { super(); this.message = message }
  eq(other) { return other.message === this.message }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-sqlErrorMsg'
    el.setAttribute('role', 'alert')
    el.textContent = this.message
    return el
  }
}

const errorField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorEffect)) continue
      if (!e.value) return Decoration.none
      const { from, to, message } = e.value
      const line = tr.state.doc.lineAt(from)
      const ranges = [Decoration.line({ class: 'cm-sqlErrorLine' }).range(line.from)]
      if (to > from) ranges.push(Decoration.mark({ class: 'cm-sqlError', attributes: { title: message } }).range(from, to))
      ranges.push(Decoration.widget({ widget: new ErrorMessageWidget(message), block: true, side: 1 }).range(line.to))
      return Decoration.set(ranges, true)
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: f => EditorView.decorations.from(f),
})

/** [from, to) of the token starting at `pos`: a run of identifier characters, else one character. */
function tokenAt(doc, pos) {
  const text = doc.sliceString(pos, Math.min(doc.length, pos + 200))
  const m = /^[\w$.]+|^"[^"\n]*"?|^'[^'\n]*'?/.exec(text)
  return [pos, pos + (m ? m[0].length : Math.min(1, text.length))]
}

// errors whose cursor jump already happened (the jump runs once, not on every remount)
const jumped = new WeakSet()

/**
 * Show `error` ({ from, statement, position, message }) in the view: from is the
 * statement's offset in the document, position Postgres' 1-based offset in it.
 * Skipped when the statement text has since been edited.
 */
function applyError(view, error) {
  if (!error) {
    if (view.state.field(errorField).size) view.dispatch({ effects: setErrorEffect.of(null) })
    return
  }
  const { from, statement, position, message } = error
  const doc = view.state.doc
  if (doc.sliceString(from, from + statement.length) !== statement) return
  let pos = from + Math.max(0, Math.min(statement.length, (position || 1) - 1))
  if (pos >= from + statement.length && pos > from) pos-- // "at end of input" → last character
  const [tFrom, tTo] = tokenAt(doc, pos)
  const effects = [setErrorEffect.of({ from: tFrom, to: Math.min(tTo, from + statement.length), message })]
  if (jumped.has(error)) { view.dispatch({ effects }); return }
  jumped.add(error)
  view.dispatch({ effects, selection: { anchor: tFrom }, scrollIntoView: true })
  view.focus()
}

// ─── SqlEditor component ──────────────────────────────────────────────────────
/**
 * Exposes `getStatementsToRun()` via ref (see resolveStatements) so the parent
 * can resolve what to execute. Ctrl+Enter (and Cmd+Enter on macOS) calls
 * `onRun`, the same action as the Run button. `error` (see applyError) marks
 * where the server reported a SQL error and moves the cursor there once.
 * `dark` switches to the dark editor theme.
 */
const SqlEditor = forwardRef(function SqlEditor({ value, onChange, placeholder, onRun, error, dark = false }, ref) {
  const cmRef = useRef(null)
  const onRunRef = useRef(onRun)
  useLayoutEffect(() => { onRunRef.current = onRun })

  useImperativeHandle(ref, () => ({
    getStatementsToRun() {
      const view = cmRef.current?.view
      if (!view) return { mode: 'single', statements: splitStatements(value) }
      const { from, to } = view.state.selection.main
      return resolveStatements(view.state.doc.toString(), from, to)
    },
  }))

  // the editor mounts after the error is known (Results → Editor tab), so apply
  // it both on creation and whenever it changes
  const errorRef = useRef(error)
  useLayoutEffect(() => { errorRef.current = error })
  useEffect(() => {
    const view = cmRef.current?.view
    if (view) applyError(view, error)
  }, [error])

  // Stable extensions, so CodeMirror is only reconfigured when the theme changes.
  const extensions = useMemo(() => [
    sql(),
    dark ? darkTheme : lightTheme,
    errorField,
    EditorView.lineWrapping,
    runKeymap(() => onRunRef.current?.()),
  ], [dark])

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={extensions}
      onCreateEditor={view => applyError(view, errorRef.current)}
      theme="none"        // we supply our own theme above
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        syntaxHighlighting: true,
      }}
      style={{ height: '100%', fontSize: '13px' }}
    />
  )
})

export default SqlEditor

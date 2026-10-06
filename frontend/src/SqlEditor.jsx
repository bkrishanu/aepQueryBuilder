import { useRef, useMemo, useLayoutEffect, useImperativeHandle, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
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

const dbeaverTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#ffffff',
      color: '#1f2328',
      fontFamily: MONO_FONT,
      fontSize: '13px',
      height: '100%',
    },
    '.cm-content': {
      caretColor: '#1f2328',
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
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1f2328' },

    // selection — CodeMirror paints the selection layer *behind* the text, so
    // the active-line background below must stay translucent or it hides it.
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#c9dcf5',
    },
    // must match the specificity of CodeMirror's base-theme focused selector
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-content ::selection': {
      backgroundColor: '#9ec5fe',
    },
    // other occurrences of the selected word
    '.cm-selectionMatch': {
      backgroundColor: '#fde68a80',
      outline: '1px solid #f59e0b55',
      borderRadius: '2px',
    },

    // active line highlight (translucent so selections remain visible)
    '.cm-activeLine': { backgroundColor: 'rgba(37, 99, 235, 0.06)' },
    '.cm-activeLineGutter': { backgroundColor: '#eef2fb' },

    // gutter
    '.cm-gutters': {
      backgroundColor: '#f5f5f5',
      color: '#999999',
      borderRight: '1px solid #dddddd',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },

    // matched brackets
    '.cm-matchingBracket': {
      backgroundColor: '#c8e6c8',
      outline: '1px solid #4caf50',
    },

    // scrollbar (webkit)
    '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: '#f5f5f5' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      background: '#cccccc',
      borderRadius: '4px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': { background: '#aaaaaa' },

    // placeholder
    '.cm-placeholder': { color: '#aaaaaa' },
  },
  { dark: false }
)

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

// ─── SqlEditor component ──────────────────────────────────────────────────────
/**
 * Exposes `getStatementsToRun()` via ref (see resolveStatements) so the parent
 * can resolve what to execute. Ctrl+Enter (and Cmd+Enter on macOS) calls
 * `onRun`, the same action as the Run button.
 */
const SqlEditor = forwardRef(function SqlEditor({ value, onChange, placeholder, onRun }, ref) {
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

  // Stable extensions, so CodeMirror is not reconfigured on every render.
  const extensions = useMemo(() => [
    sql(),
    dbeaverTheme,
    EditorView.lineWrapping,
    runKeymap(() => onRunRef.current?.()),
  ], [])

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={extensions}
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

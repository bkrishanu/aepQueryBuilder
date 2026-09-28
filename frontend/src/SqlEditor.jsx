import { useRef, useImperativeHandle, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'

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
//   cursor line  → very light blue        #e8f0fe
//   selection    → light blue tint        #add6ff
const dbeaverTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#ffffff',
      color: '#1f2328',
      fontFamily: "'Courier New', Courier, monospace",
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
      fontFamily: "'Courier New', Courier, monospace",
    },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { lineHeight: '1.6' },

    // cursor
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1f2328' },

    // selection
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#add6ff',
    },

    // active line highlight
    '.cm-activeLine': { backgroundColor: '#e8f0fe' },
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

// ─── helper: resolve the query to run ────────────────────────────────────────
/**
 * Given the full editor content and the current CodeMirror EditorState,
 * returns the single SQL statement that should be executed:
 *
 *   1. If the user has a text selection → run only that selection.
 *   2. Otherwise → split the full text on ";" boundaries, find the statement
 *      whose character range contains the cursor, and run that one.
 *   3. If only one statement exists → run it regardless of cursor position.
 */
export function resolveQueryToRun(editorState) {
  if (!editorState) return null

  const fullText = editorState.doc.toString()
  const sel = editorState.selection.main

  // 1. Text selected → run selection
  if (!sel.empty) {
    const selected = fullText.slice(sel.from, sel.to).trim()
    if (selected) return selected
  }

  // 2. Split into statements on semicolons (keep trailing semicolons)
  const stmts = []
  let pos = 0
  for (const part of fullText.split(/(?<=;)/)) {
    const trimmed = part.trim()
    const start = pos
    const end = pos + part.length
    pos = end
    if (trimmed) stmts.push({ text: trimmed, start, end })
  }

  if (stmts.length === 0) return fullText.trim() || null

  // Only one statement → run it
  if (stmts.length === 1) return stmts[0].text

  // 3. Find statement that contains the cursor
  const cursor = sel.from
  const hit = stmts.find(s => cursor >= s.start && cursor <= s.end)
  if (hit) return hit.text

  // Cursor past end → run last statement
  return stmts[stmts.length - 1].text
}

// ─── SqlEditor component ──────────────────────────────────────────────────────
/**
 * Exposes `getQueryToRun()` via ref so the parent can call it on Execute.
 */
const SqlEditor = forwardRef(function SqlEditor({ value, onChange, placeholder }, ref) {
  const cmRef = useRef(null)

  useImperativeHandle(ref, () => ({
    getQueryToRun() {
      const view = cmRef.current?.view
      if (!view) return value.trim() || null
      return resolveQueryToRun(view.state)
    },
  }))

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={[
        sql(),
        dbeaverTheme,
        EditorView.lineWrapping,
      ]}
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

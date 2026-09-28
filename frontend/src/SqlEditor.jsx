import { useRef, useImperativeHandle, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'

// ─── DBeaver-inspired dark theme ─────────────────────────────────────────────
// Colour mapping mirrors DBeaver's default SQL dark theme:
//   keywords     → bold cornflower-blue   #6495ed
//   functions    → cyan                   #00bcd4
//   strings      → olive/khaki            #c8b400
//   numbers      → light-green            #8bc34a
//   comments     → grey-green italic      #7a9f60
//   operators    → sky                    #79c0ff
//   punctuation  → muted slate            #8b8fa8
//   identifiers  → off-white              #e8eaf0
//   background   → deep navy              #0f1117
//   cursor line   → subtle highlight      #1e2233
//   selection     → blue tint             #264f78
const dbeaverTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#0f1117',
      color: '#e8eaf0',
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '13px',
      height: '100%',
    },
    '.cm-content': {
      caretColor: '#528bff',
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
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#528bff' },

    // selection
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#264f78',
    },

    // active line highlight
    '.cm-activeLine': { backgroundColor: '#1e2233' },
    '.cm-activeLineGutter': { backgroundColor: '#1a1d27' },

    // gutter
    '.cm-gutters': {
      backgroundColor: '#12141c',
      color: '#3a3d52',
      borderRight: '1px solid #2a2d3e',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },

    // matched brackets
    '.cm-matchingBracket': {
      backgroundColor: '#2a3a5e',
      outline: '1px solid #528bff',
    },

    // scrollbar (webkit)
    '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: '#12141c' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      background: '#2a2d3e',
      borderRadius: '4px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': { background: '#3a3d52' },

    // placeholder
    '.cm-placeholder': { color: '#3a3d52' },
  },
  { dark: true }
)

// SQL token colours matching DBeaver dark theme
const sqlHighlightStyle = [
  // keywords  (SELECT, FROM, WHERE, …)
  { tag: 'keyword', color: '#6495ed', fontWeight: 'bold' },
  // type keywords (INT, VARCHAR, …)
  { tag: 'typeName', color: '#6495ed', fontWeight: 'bold' },
  // built-in functions / operators
  { tag: 'function(name)', color: '#00bcd4' },
  { tag: 'variableName', color: '#e8eaf0' },
  // strings
  { tag: 'string', color: '#c8b400' },
  { tag: 'string2', color: '#c8b400' },
  // numbers
  { tag: 'number', color: '#8bc34a' },
  // comments
  { tag: 'comment', color: '#7a9f60', fontStyle: 'italic' },
  { tag: 'lineComment', color: '#7a9f60', fontStyle: 'italic' },
  { tag: 'blockComment', color: '#7a9f60', fontStyle: 'italic' },
  // operators  (=, >, <, *, …)
  { tag: 'operator', color: '#79c0ff' },
  { tag: 'compareOperator', color: '#79c0ff' },
  // punctuation / separators
  { tag: 'punctuation', color: '#8b8fa8' },
  { tag: 'separator', color: '#8b8fa8' },
  // identifiers / schema names
  { tag: 'name', color: '#e8eaf0' },
  { tag: 'propertyName', color: '#e8eaf0' },
  // special literals (NULL, TRUE, FALSE)
  { tag: 'bool', color: '#c084fc', fontWeight: 'bold' },
  { tag: 'null', color: '#c084fc', fontWeight: 'bold' },
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

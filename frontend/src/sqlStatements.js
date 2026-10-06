// ─── SQL statement splitting & resolution ────────────────────────────────────
// Statements end at a semicolon. Semicolons inside string literals, quoted
// identifiers, dollar-quoted bodies and comments are not boundaries. A final
// statement without a semicolon is still accepted.

/** Index just past the closing quote of a literal opened at `i`. */
function skipQuoted(text, i, quote) {
  // E'…' strings allow backslash escapes; everywhere else a quote is escaped by doubling it
  const backslashEscapes = quote === "'" && /[eE]/.test(text[i - 1] || '') && !/[\w$]/.test(text[i - 2] || '')
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j]
    if (backslashEscapes && c === '\\') { j++; continue }
    if (c === quote) {
      if (text[j + 1] === quote) { j++; continue }
      return j + 1
    }
  }
  return text.length
}

/**
 * Split SQL text into statements: [{ text, from, to }], where from/to are
 * offsets into the original document (`offset` is added to positions in `text`).
 * Segments holding only whitespace or comments are dropped.
 */
export function splitStatements(text, offset = 0) {
  const out = []
  let start = 0
  let hasCode = false
  const push = (end) => {
    if (hasCode) {
      const raw = text.slice(start, end)
      const lead = raw.length - raw.trimStart().length
      const body = raw.trim()
      out.push({ text: body, from: offset + start + lead, to: offset + start + lead + body.length })
    }
    start = end
    hasCode = false
  }

  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '-' && next === '-') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? text.length : nl
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else if (c === "'" || c === '"' || c === '`') {
      hasCode = true
      i = skipQuoted(text, i, c)
    } else if (c === '$' && !/[\w$]/.test(text[i - 1] || '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))
      hasCode = true
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length)
        i = end === -1 ? text.length : end + tag[0].length
      } else {
        i++
      }
    } else if (c === ';') {
      push(++i)
    } else {
      if (!/\s/.test(c)) hasCode = true
      i++
    }
  }
  push(text.length)
  return out
}

/**
 * The statement the cursor belongs to. Inside a statement → that one. In the
 * gap between two statements → the previous one while still on its last line
 * (e.g. right after its semicolon), otherwise the next one.
 */
function statementAtCursor(doc, stmts, cursor) {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]
    if (cursor < s.from) {
      const prev = stmts[i - 1]
      return prev && !doc.slice(prev.to, cursor).includes('\n') ? prev : s
    }
    if (cursor <= s.to) return s
  }
  return stmts[stmts.length - 1]
}

/**
 * Decide what Run / Ctrl+Enter executes:
 *   - text selected        → every statement in the selection   (mode 'selection')
 *   - one statement total  → that statement                     (mode 'single')
 *   - several statements   → the statement under the cursor     (mode 'cursor')
 * Returns { mode, statements: [{ text, from, to }] } — statements may be empty.
 */
export function resolveStatements(doc, selFrom, selTo) {
  if (selFrom !== selTo) {
    const from = Math.min(selFrom, selTo)
    const selected = splitStatements(doc.slice(from, Math.max(selFrom, selTo)), from)
    if (selected.length) return { mode: 'selection', statements: selected }
  }
  const stmts = splitStatements(doc)
  if (stmts.length <= 1) return { mode: 'single', statements: stmts }
  return { mode: 'cursor', statements: [statementAtCursor(doc, stmts, selFrom)] }
}

// ─── run shortcut ────────────────────────────────────────────────────────────
// Ctrl+Enter everywhere; macOS also accepts Cmd+Enter (shown as ⌘ Enter).
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const RUN_SHORTCUT      = IS_MAC ? '⌘ Enter' : 'Ctrl+Enter'
export const RUN_SHORTCUT_ARIA = IS_MAC ? 'Meta+Enter Control+Enter' : 'Control+Enter'

/** True for the Run shortcut: Ctrl+Enter, or Cmd+Enter on macOS. */
export const isRunShortcut = (e) => e.key === 'Enter' && (e.ctrlKey || (IS_MAC && e.metaKey)) && !e.altKey && !e.shiftKey

// ─── Query Service cancellation ──────────────────────────────────────────────
// Query Service ignores the Postgres cancel signal, and its API can cancel only
// "batch queries issued over HTTP and CTAS or INSERT INTO queries" — a SELECT
// sent from a SQL client always runs to completion.
const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/

/** True for INSERT INTO and CREATE TABLE … AS statements, which Query Service can cancel. */
export function isQsCancellable(sql) {
  const s = String(sql || '').replace(LEADING_NOISE, '').toLowerCase()
  return /^insert\s+into\b/.test(s) || (/^create\s+table\b/.test(s) && /\bas\b/.test(s))
}

/** True when the connection goes to Adobe Query Service (AEP mode, or a Direct host on adobe.io). */
export const isQueryServiceTarget = (endpoint, payload) =>
  endpoint === '/query' || /\.adobe\.io$/i.test(String(payload?.host || '').trim())

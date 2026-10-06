---

# 3. Additional Stability, Usability & Data Handling Improvements

## Objective

Address several smaller but important issues impacting data rendering, result copying, query execution state management, configuration consistency, and error handling.

---

## 3.1 Render Complex Objects Correctly

### Problem Statement

Currently, every cell value is rendered using:

```javascript
String(value)
```

When a column contains:

- JSON objects
- Arrays
- Nested structures

the UI displays:

```text
[object Object]
```

which makes the data unreadable.

### Requirements

#### Display Logic

- Detect object and array values.
- Render them using:

```javascript
JSON.stringify(value)
```

- Support pretty-printing when appropriate.
- Preserve scalar values such as:
  - String
  - Number
  - Boolean
  - Date

without modification.

#### User Experience

Provide a mechanism to view the complete value.

Examples:

- Tooltip on hover
- Expandable cell
- Modal popup
- Side panel viewer

The full JSON value should always be accessible even when truncated in the grid.

#### Example

Current Behavior:

```text
[object Object]
```

Expected Behavior:

```json
{
  "id": "12345",
  "status": "active"
}
```

---

## 3.2 Fix Copy Results TSV Export

### Problem Statement

The "Copy Results" feature produces malformed TSV output when cell values contain:

- Tabs (`\t`)
- Newlines (`\n`)
- Carriage returns (`\r`)

This causes copied data to be incorrectly pasted into:

- Excel
- Google Sheets
- Text editors
- BI tools

### Requirements

- Properly escape or quote problematic values.
- Ensure multi-line content remains within the same cell.
- Preserve original value formatting.
- Generate standards-compliant TSV output.

### Example

Input Value:

```text
Customer Name
John Doe
```

Should not split into multiple rows when pasted.

#### Expected Behavior

Use appropriate quoting or escaping before generating TSV.

---

## 3.3 Fix Stale Query Execution State

### Problem Statement

Within the `QueryPane` imperative handle, the function:

```javascript
isExecuting()
```

can return outdated values because it closes over the render where it was originally created.

This results in stale state behavior and inaccurate execution tracking.

### Requirements

- Replace stale closure usage with a React ref.
- Keep execution state synchronized with the latest render.
- Ensure callers always receive the current execution status.
- Prevent race conditions during query execution.

### Expected Outcome

`isExecuting()` should always reflect the current query execution state.

---

## 3.4 Align Default Port Configuration

### Problem Statement

There is currently an inconsistency between client-side and server-side defaults.

#### UI Default

```text
80
```

#### Server Default

```javascript
parseInt(port) || 5432
```

As a result, leaving the port field blank may lead to different connection behavior depending on where the value is evaluated.

### Requirements

- Define a single source of truth for default port configuration.
- Ensure UI and backend use the same default value.
- A blank port should behave identically everywhere.
- Minimize user confusion during connection setup.

### Expected Outcome

Connection behavior should remain consistent regardless of where validation occurs.

---

## 3.5 Improve SQL Error Handling

### Problem Statement

SQL validation and syntax errors currently return:

```http
HTTP 500
```

These are user-generated query errors rather than server failures.

Using HTTP 500 makes troubleshooting difficult and prevents the UI from providing accurate feedback.

### Requirements

#### API Behavior

Return:

```http
HTTP 400
```

for user query and SQL validation errors.

#### Include Postgres Metadata

Expose useful PostgreSQL error details including:

```json
{
  "code": "42601",
  "position": "142",
  "message": "syntax error near FROM"
}
```

#### UI Enhancements

Use the returned metadata to:

- Highlight the failing SQL token.
- Move cursor to error location.
- Display inline validation messages.
- Improve overall troubleshooting experience.

### Error Classification

#### Return HTTP 400

Examples:

- SQL syntax errors
- Invalid table references
- Invalid column names
- Unsupported SQL statements

#### Return HTTP 500

Examples:

- Internal application exceptions
- Unhandled backend failures
- Infrastructure issues
- Database connectivity failures

### Expected Outcome

Users should receive actionable feedback directly within the editor, enabling faster query correction and reducing support effort.

---

# Consolidated Expected Outcome

After all enhancements are implemented:

## Data Accuracy

- Duplicate columns are preserved correctly.
- No data is lost due to column name collisions.

## Scalability

- Large datasets are fetched using cursor-based pagination.
- Memory usage remains predictable within Vercel limits.

## User Experience

- JSON and array fields render correctly.
- Full object values can be inspected easily.
- Pagination provides smooth navigation through large result sets.

## Reliability

- Query execution state remains accurate.
- Configuration defaults remain consistent across client and server.

## Error Handling

- SQL errors are returned as HTTP 400.
- PostgreSQL error metadata is exposed.
- Query editor can highlight exact error locations.

## Compatibility

- Existing query functionality remains unchanged.
- Sorting, filtering, exports, copy operations, and dataset exploration continue to work as expected.
- The solution remains extensible for future capabilities such as query cancellation, infinite scrolling, and result caching.
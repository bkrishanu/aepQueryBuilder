# Query Editor & Query Execution Enhancements

## Overview

Review the existing codebase and implement the following enhancements without breaking any existing functionality. The focus should be on improving usability, reliability, query execution flexibility, and connection management.

---

# 1. Modernize Query Action Buttons

## Current Issue

The query editor currently uses large rectangular buttons that consume unnecessary screen space and do not align with a modern developer-oriented interface.

## Required Changes

- Replace existing rectangular action buttons with compact icon-based controls.
- Use intuitive and industry-standard icons for actions.
- Examples:
  - Execute Query → Run/Execute icon
  - Cancel Query → Stop/Cancel icon
  - Other actions should use relevant icons where appropriate
- Provide tooltips on hover.
- Add accessibility labels (ARIA labels).
- Ensure styling is consistent with the application's modern UI theme.
- Maintain responsiveness across different screen sizes.

### New Feature: Cancel Query

Introduce a **Cancel Query** button.

#### Requirements

- Display the Cancel Query button while a query is running.
- Allow users to cancel long-running queries.
- Show clear feedback when execution is cancelled.
- Properly terminate any active database operation.
- Clean up all associated resources and connections.
- Re-enable query execution controls after cancellation.

### Acceptance Criteria

- Query execution can be cancelled successfully.
- No abandoned database connections remain after cancellation.
- User receives visual confirmation of cancellation.

---

# 2. Fix PostgreSQL Client Connection Leaks

## Current Issue

In:

- `/api/query`
- `/api/query/direct`

the PostgreSQL client is only closed on successful execution.

When a query fails due to:

- Syntax errors
- Permission issues
- Invalid SQL
- Timeout failures
- Connection failures
- Unexpected exceptions

execution bypasses `client.end()` and leaves connections open.

Over time, these orphaned connections can exhaust the Query Service connection pool available to the organization.

## Required Changes

Refactor the query execution flow to guarantee database connection cleanup regardless of the execution outcome.

### Requirements

- Use proper resource management patterns.
- Ensure connections are released on both success and failure.
- Implement robust error handling using `try/catch/finally` or an equivalent approach.
- Validate behavior during:
  - SQL syntax failures
  - Permission failures
  - Query timeout scenarios
  - Network interruptions
  - User-triggered query cancellations

### Acceptance Criteria

- No PostgreSQL client leaks occur.
- Failed queries do not consume additional connection slots.
- Long-running application sessions remain stable.
- Active connection counts remain consistent over time.

---

# 3. Support Single Query and Multi-Statement Execution

## Current Issue

Executing multiple SQL statements such as:

```sql
SELECT 1;
SELECT 2;
```

causes the application to fail because the PostgreSQL driver returns an array of result sets while the current implementation assumes a single result object.

Current behavior eventually triggers errors such as:

```javascript
result.fields.map(...)
```

resulting in runtime exceptions and poor user experience.

---

## Query Parsing Rules

### Query Termination

- Every SQL statement must end with a semicolon (`;`).
- Semicolons are used to determine query boundaries.
- The query engine should identify:
  - Single queries
  - Multiple queries
  - Selected query blocks
  - Cursor-position queries

---

## Scenario 1: Single Query in Editor

### Example

```sql
SELECT * FROM customers;
```

### Expected Behavior

- Execute the query directly.
- Display results normally.
- Maintain current workflow.

---

## Scenario 2: Multiple Queries with No Selection

### Example

```sql
SELECT * FROM customers;

SELECT * FROM accounts;

SELECT * FROM transactions;
```

### Expected Behavior

If no text is selected:

- Determine which query contains the active cursor.
- Execute only that query.
- Return only the corresponding result set.

---

## Scenario 3: Execute Selected Query

### Example Selection

```sql
SELECT * FROM accounts;
```

### Expected Behavior

- Execute only the selected query.
- Ignore all other queries in the editor.
- Display the selected query results.

---

## Scenario 4: Execute Multiple Selected Queries

### Example Selection

```sql
SELECT * FROM customers;
SELECT * FROM accounts;
```

### Expected Behavior

- Execute all selected queries sequentially.
- Return results for each query independently.
- Present result sets separately.

### Example Output

```text
Query 1 Results
----------------
(customer results)

Query 2 Results
----------------
(account results)
```

---

## Scenario 5: Mixed Success and Failure Handling

### Example

```sql
SELECT * FROM customers;
INVALID SQL;
SELECT * FROM accounts;
```

### Expected Behavior

- Clearly indicate which queries succeeded.
- Clearly indicate which queries failed.
- Display PostgreSQL error messages for failed statements.
- Continue showing successful query results whenever possible.
- Prevent application crashes.

### Example Output

```text
Query 1: Success

Query 2: Failed
Syntax error near ...

Query 3: Success
```

---

## Additional Requirements

- Support multiple result sets returned by PostgreSQL.
- Render each result set independently.
- Prevent runtime errors caused by array-based query responses.
- Maintain backward compatibility for single-query execution.

---

# 4. Keyboard Shortcut Support

## New Feature

Support query execution using:

```text
CTRL + ENTER
```

---

## Expected Behavior

The shortcut should follow the exact same execution logic as the Run button.

### Single Query

```text
Execute the query.
```

### Multiple Queries

```text
Execute the query where the cursor is currently positioned.
```

### Selected Query

```text
Execute only the selected query.
```

### Multiple Selected Queries

```text
Execute all selected queries.
```

---

## Additional Requirements

- Prevent accidental double execution.
- Show query execution progress.
- Disable repeated execution requests while a query is already running.
- Ensure the shortcut works consistently across supported browsers.
- Ensure shortcut behavior matches the Run button exactly.

---

# Expected Outcome

After implementation, the Query Editor should provide:

- Modern icon-based controls.
- Query cancellation capability.
- Proper PostgreSQL connection cleanup.
- No database connection leaks.
- Robust handling of single-query execution.
- Support for multi-query execution.
- Cursor-based query execution.
- Selection-based query execution.
- Multiple result-set rendering.
- Graceful handling of mixed success/failure scenarios.
- CTRL + ENTER execution support.
- Improved user experience, performance, and overall reliability.
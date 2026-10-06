# Query Result Handling & Pagination Enhancements

## Objective

Review the existing query execution and result rendering implementation and implement enhancements to:

1. Correctly handle duplicate column names returned by SQL queries.
2. Support scalable loading of large result sets using cursor-based pagination.
3. Prevent server memory issues and improve overall UI performance.
4. Maintain full backward compatibility with existing functionality.

---

# 1. Handle Duplicate Column Names in Query Results

## Problem Statement

The `pg` library returns query results as objects keyed by column name. When multiple columns share the same name, values from one column overwrite another, resulting in data loss.

Additionally, the results grid uses column names as React keys, which causes duplicate-key warnings.

### Example

```sql
WITH webData AS (
    SELECT
        _id,
        eventType,
        timestamp,
        identityMap['ECID'][0].id AS pID
    FROM web_sdk_events
),
mobileData AS (
    SELECT
        _id,
        eventType,
        timestamp,
        identityMap['ECID'][0].id AS pID
    FROM mobile_event_web_sdk
)

SELECT
    w._id,
    m._id
FROM webData w
INNER JOIN mobileData m
    ON w.pID = m.pID;
```

Both selected columns are named `_id`, resulting in duplicate field names.

---

## Requirements

### Data Integrity

- Preserve all returned columns, even when multiple columns share the same name.
- Prevent value overwrites caused by duplicate object keys.
- Ensure no data loss occurs during query execution or transformation.

### Column Management

- Generate unique internal identifiers for duplicate columns.
- Retain original column names for display purposes.
- Support:
  - Joins
  - CTEs
  - Aliases
  - Nested queries
  - `SELECT *` queries

### UI Requirements

- Eliminate React duplicate-key warnings.
- Clearly distinguish duplicate columns in the results grid.

Example display formats:

```text
_id
_id (2)
_id (3)
```

or

```text
webData._id
mobileData._id
```

whichever best aligns with the existing UI design.

### Compatibility

- Maintain compatibility with all existing query results.
- Ensure exports continue to work correctly.
- Ensure copy-to-clipboard functionality continues to function correctly.
- Preserve sorting and filtering behavior.

---

# 2. Implement Scalable Result Loading with Pagination

## Problem Statement

The current implementation:

- Loads every returned row into server memory.
- Serializes the complete result set into a single JSON payload.
- Renders all rows in the browser at once.

For large datasets this can:

- Exceed Vercel memory limits.
- Exceed serverless execution duration limits.
- Cause browser performance degradation.
- Prevent users from efficiently navigating large result sets.

There is currently no mechanism to limit or paginate results.

---

## Solution Approach

Implement cursor-based result fetching using `pg-cursor` or an equivalent streaming solution.

The application should retrieve rows in manageable batches rather than loading the entire result set into memory.

---

## Requirements

### Row Limits

Introduce configurable limits:

| Setting | Default Value |
|----------|-------------|
| Maximum Rows | 10,000 |
| Page Size | 100 |
| Cursor Batch Size | 500 |

The values should be configurable through application settings or environment variables.

---

### Cursor-Based Fetching

Use `pg-cursor` to:

- Read rows in batches.
- Minimize memory usage.
- Avoid loading entire datasets into memory.
- Support predictable server resource consumption.

---

### Pagination

Implement server-side pagination.

Requirements:

- Load only rows required for the current page.
- Allow navigation between pages.
- Avoid re-running the query when navigating between pages.
- Support future scalability improvements.

Example:

```text
Page 1: Rows 1 - 100
Page 2: Rows 101 - 200
Page 3: Rows 201 - 300
```

---

### User Messaging

Display contextual messages such as:

```text
Showing first 100 rows.
```

```text
Showing rows 101-200 of 10,000.
```

```text
Results limited to first 10,000 rows.
```

---

### Performance

The solution should:

- Support large datasets efficiently.
- Remain within Vercel memory limits.
- Reduce API response sizes.
- Improve browser rendering performance.
- Minimize initial load times.

---

### UI Requirements

Implement:

- Pagination controls
- Loading indicators
- Empty-state messages
- Error handling messages

Examples:

```text
Loading results...
```

```text
No records found.
```

```text
Maximum result limit reached.
```

---

### Backward Compatibility

Ensure existing functionality continues to work:

- Query execution
- Sorting
- Filtering
- CSV export
- Copy results
- Query history
- Dataset explorer integration

No existing features should regress.

---

# Future-Ready Enhancements

Design the implementation to support future capabilities including:

- Query cancellation
- Infinite scrolling
- Background result fetching
- Cached query results
- Virtualized grid rendering
- Progressive result loading

---

# Expected Outcome

After implementation:

- Duplicate column names are displayed correctly without data loss.
- React duplicate-key warnings are eliminated.
- Large query results are paginated efficiently.
- Server memory consumption remains controlled.
- Browser performance is improved.
- Users can navigate large result sets without re-running queries.
- The application remains fully backward compatible and scalable for future enhancements.
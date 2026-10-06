# Query Workspace Enhancements

## Objective

Enhance the Query Workspace experience by introducing query persistence, export capabilities, session awareness, improved result grid functionality, saved connection profiles, and theme support while maintaining all existing functionality and application behavior.

---

## 1. Export Query Results

Add the following actions next to the existing **Copy Results** button:

### New Actions
- Download CSV
- Download JSON

### Requirements
- Export only the currently displayed query results.
- Preserve column headers.
- Respect any active sorting and filtering.
- Downloaded files should be generated client-side.
- Maintain existing Copy Results functionality.

---

## 2. Query History Management

Implement a query history feature using `localStorage`.

### Requirements
Store the last **N executed queries** per sandbox or host.

Each history entry should contain:

- Query text
- Execution timestamp
- Execution duration
- Returned row count

### Security Requirements
- Never store query results.
- Never store session information.
- Never store passwords or authentication tokens.

### User Experience
- Display history in a dropdown or collapsible side panel.
- Allow users to select a previous query.
- Loading a query from history should populate the active editor tab.
- Automatically remove the oldest entries when the configured limit is reached.

---

## 3. Persist Query Tabs

Currently, query tabs are lost when the browser is refreshed.

### Requirements

Persist the following in `localStorage`:

- Tab name
- SQL query text
- Tab order
- Active tab selection

### Additional Features

#### Rename Tabs
Allow users to rename any tab.

#### Restore Tabs
On application reload:

- Restore all previously opened tabs.
- Restore tab names.
- Restore SQL contents.
- Restore the active tab.

### Constraints
- Do not automatically execute restored queries.
- Restore editor state only.

---

## 4. Result Grid Usability Improvements

Enhance the results grid to provide a more powerful data exploration experience.

### Column Management

Implement:

- Column resizing
- Show/Hide columns
- Column picker interface

### Cell Expansion

Users should be able to:

- Expand a cell to see its complete value
- View formatted JSON
- View nested XDM objects and arrays in a readable format

### Column Pinning

- Pin the first column by default
- Keep the pinned column visible during horizontal scrolling

### Sorting

Implement client-side sorting:

- Click column header to sort ascending
- Click again to sort descending
- Clearly indicate sort direction

### Filtering

Add column-level filtering:

- Text search
- Value filtering where applicable
- Active filter indicators

---

## 5. Query Explain Plan

Add an **Explain** button alongside the existing query execution controls.

### Behavior

When clicked, execute:

```sql
EXPLAIN <query>
```

using the current query from the active editor tab.

### Display Requirements

Show results in a dedicated panel, drawer, or modal.

The Explain output should:

- Use a monospace font
- Preserve formatting and indentation
- Support scrolling
- Support copy-to-clipboard functionality

### Error Handling

- Display execution errors clearly
- Preserve the original query content

---

## 6. Saved Direct Connection Profiles

Implement reusable direct connection profiles.

### Profile Fields

Store:

- Profile Name
- Host
- Port
- Database
- Username

### Do Not Store

- Passwords
- Session tokens
- Authentication secrets

### Functionality

Users should be able to:

- Create profiles
- Edit profiles
- Delete profiles
- Select profiles from a dropdown

### User Experience

When a profile is selected:

- Automatically populate the connection fields
- Allow users to modify values before connecting

### Compatibility

- Continue supporting the existing connection-string paste workflow
- Existing connection functionality must remain unchanged

### Storage

Save profiles locally using `localStorage`.

---

## 7. Theme Support

Implement complete theme support.

### Modes

- Light Theme
- Dark Theme
- System Theme

### Requirements

- Respect browser `prefers-color-scheme`
- Persist user selection across sessions
- Apply theme consistently across all screens and components

### UI Expectations

Ensure:

- Good contrast ratios
- Readable typography
- Consistent colors and spacing
- Smooth theme transitions where appropriate

---

## 8. Session Expiration Awareness

The client already receives the session `expiresAt` value.

### Countdown Timer

Display a visible countdown showing the remaining session duration.

### Expiration Warning

Approximately 10 minutes before expiration:

- Show a warning notification
- Clearly communicate remaining time
- Allow users to save work before the session expires

### Session Duration Update

Update session expiration from its current configuration to:

**1 Hour**

### Additional Requirements

- Countdown should update in real time.
- Warning notifications should only appear once per session.
- Prevent unexpected query failures due to unnoticed session expiration.

---

# General Requirements

## Functional Requirements

- Maintain all existing functionality.
- Do not introduce breaking changes.
- Preserve existing workflows and user interactions.

## Technical Requirements

- Follow the current application architecture.
- Reuse existing components wherever possible.
- Use localStorage only for non-sensitive user preferences and state.
- Avoid storing confidential information.

## UX Requirements

- Deliver a modern and polished user experience.
- Ensure responsive behavior across screen sizes.
- Maintain accessibility standards.
- Keep interactions intuitive and consistent with the existing design language.

## Success Criteria

The application should provide:

- Persistent query workspaces
- Improved query result exploration
- Export functionality
- Explain plan visibility
- Reusable connection profiles
- Session expiration awareness
- Theme customization

while preserving all existing features and behavior.
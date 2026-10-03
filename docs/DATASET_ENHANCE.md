# Dataset Explorer Enhancements

## Overview

The initial implementation looks fantastic. To further improve usability and scalability for large Adobe Experience Platform (AEP) environments, the following enhancements should be implemented.

---

# Enhancement 1: Array Field Copy Behavior

## Current Behavior

Every schema field supports copying its fully qualified field path.

Example:

```text
customer.address.city
```

---

## New Requirement

When copying array fields, the copied path should automatically include the first array element notation (`[0]`).

This ensures that generated field paths can be directly used in queries and expressions without requiring additional manual edits.

---

## Rules

- Array fields should always use `[0]` notation.
- Display names in the tree should remain unchanged.
- Only copied values should include `[0]`.
- Support nested arrays.
- Support arrays of primitive values.
- Support arrays of objects.
- Support arrays nested inside other arrays.
- Support complex schema structures.

---

## Example 1: Array of Strings

### Schema Structure

```text
customer
 └── emails [array]
```

### Copied Value

```text
customer.emails[0]
```

---

## Example 2: Array of Objects

### Schema Structure

```text
customer
 └── addresses [array]
      ├── city
      └── country
```

### Copied Values

```text
customer.addresses[0].city
```

```text
customer.addresses[0].country
```

---

## Example 3: Nested Arrays

### Schema Structure

```text
customer
 └── orders [array]
      └── items [array]
           └── productId
```

### Copied Value

```text
customer.orders[0].items[0].productId
```

---

## Example 4: AEP Tenant Schema

### Schema Structure

```text
_ibmnaamericaspartnersandbox
 └── accounts
      └── transactions [array]
           └── amount
```

### Copied Value

```text
_ibmnaamericaspartnersandbox.accounts.transactions[0].amount
```

---

## Success Criteria

- Copying an array field automatically appends `[0]`.
- Child fields under arrays correctly include parent array notation.
- Nested arrays generate multiple `[0]` segments where applicable.
- Copied values are immediately usable in queries and calculations.

---

# Enhancement 2: Scrollable Dataset Explorer

## Problem Statement

Many AEP environments contain hundreds or even thousands of datasets.

Rendering all datasets in a static panel makes navigation difficult and negatively impacts user experience.

---

## Requirement

The Dataset Explorer should support a dedicated scrollable container.

---

## Layout Requirements

The search bar should remain accessible while users browse datasets.

Recommended layout:

```text
+--------------------------------------+
| Search Dataset...                    |
+--------------------------------------+
|                                      |
| Profile Enabled                      |
|   Dataset A                          |
|   Dataset B                          |
|   Dataset C                          |
|                                      |
| Non Profile Enabled                  |
|   Dataset X                          |
|   Dataset Y                          |
|   Dataset Z                          |
|                                      |
|        Scrollable Area               |
|                                      |
+--------------------------------------+
```

---

## UI Behavior

### Search Bar

- Visible at all times.
- Positioned at the top of the explorer.
- Not affected by dataset scrolling.

### Dataset Tree

- Independently scrollable.
- Occupies available container height.
- Supports mouse wheel scrolling.
- Supports trackpad scrolling.
- Supports keyboard navigation.

### Tree Expansion

- Expanded node state should be preserved.
- Dataset expansion should be responsive.
- Deep hierarchy navigation should remain smooth.

---

## Performance Requirements

### Virtualized Rendering

Because environments may contain more than 1000 datasets:

- Render only visible nodes.
- Avoid rendering the entire tree simultaneously.
- Support incremental rendering.

### Lazy Loading

- Schema details should only be loaded when a dataset is expanded.
- Child nodes should be rendered on demand.

### State Preservation

The application should preserve:

- Scroll position
- Expanded dataset nodes
- Expanded schema nodes
- Search results

during refreshes and data reloads.

---

## User Experience Requirements

The Dataset Explorer should provide:

- Smooth scrolling
- Fast dataset search
- Responsive tree expansion
- Minimal visual lag
- Consistent performance in large environments

---

## Success Criteria

The enhancement is considered complete when:

- Users can comfortably navigate hundreds or thousands of datasets.
- The dataset panel supports independent scrolling.
- The search bar remains accessible while scrolling.
- Tree expansion remains responsive.
- Array fields copy with automatic `[0]` notation.
- Nested arrays generate valid fully qualified field paths.
- Large AEP environments maintain smooth performance and usability.
# Profile Snapshot Dataset Support

## Overview

Enhance the Dataset Explorer to support **Profile Snapshot datasets** in addition to the existing CUSTOMER-managed datasets.

The goal is to provide visibility into Profile Snapshot datasets and organize them by their associated Merge Policies while maintaining the same user experience, scalability, and search capabilities available for standard datasets.

---

# Dataset Inclusion Rules

## Existing Behavior

Display datasets where:

```json
classification.managedBy = "CUSTOMER"
```

---

## New Behavior

Continue displaying all CUSTOMER-managed datasets.

Additionally, include SYSTEM-managed datasets only when:

```json
classification.managedBy = "SYSTEM"
```

AND

```text
Dataset Name starts with "Profile-Snapshot"
```

Examples:

```text
Profile-Snapshot
Profile-Snapshot-Default
Profile-Snapshot-GoldCustomers
Profile-Snapshot-PremiumCustomers
```

---

## Exclusions

All other SYSTEM-managed datasets must remain hidden.

Examples:

```text
Segment Export Dataset
Identity Graph Dataset
System Processing Dataset
```

These datasets should not be displayed in the Dataset Explorer.

---

# Merge Policy Identification

Profile Snapshot datasets include Merge Policy information within:

```json
tags.unifiedProfile
```

Example:

```json
[
  "mergePolicyId:dde2d674-f658-47b3-9ee4-8a37f5d53bf3"
]
```

Extract:

```text
dde2d674-f658-47b3-9ee4-8a37f5d53bf3
```

and use it as the Merge Policy Identifier.

---

# Merge Policy API

For every Profile Snapshot dataset, retrieve Merge Policy details using the Merge Policy API.

## Endpoint

```http
GET https://platform.adobe.io/data/core/ups/config/mergePolicies/<MERGE_POLICY_ID>
```

---

## Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
x-api-key: <API_KEY>
x-gw-ims-org-id: <IMS_ORG>
x-sandbox-name: <SANDBOX_NAME>
```

---

# Merge Policy Attributes

Extract and display the following properties from the Merge Policy response.

## Merge Policy Name

```json
name
```

---

## Default Merge Policy Indicator

```json
default
```

When:

```json
true
```

display a badge:

```text
DEFAULT
```

---

## Edge Active Indicator

```json
isActiveOnEdge
```

When:

```json
true
```

display a badge:

```text
EDGE ACTIVE
```

---

# Explorer Hierarchy

Create a new top-level section named:

```text
Profile Snapshots
```

This section should exist alongside:

```text
Profile Enabled
Non Profile Enabled
```

---

## Required Hierarchy

```text
Profile Enabled
 ├── Dataset A
 ├── Dataset B

Non Profile Enabled
 ├── Dataset C
 ├── Dataset D

Profile Snapshots
 ├── Merge Policy A
 │    └── Profile-Snapshot-A
 │
 ├── Merge Policy B
 │    └── Profile-Snapshot-B
 │
 └── Merge Policy C
      └── Profile-Snapshot-C
```

---

# Merge Policy Node Display

Every Merge Policy node should display:

## Merge Policy Name

Example:

```text
Real-Time Customer Profile
Gold Customers
Premium Banking Customers
```

---

## Status Indicators

Example:

```text
Real-Time Customer Profile
[DEFAULT]
[EDGE ACTIVE]
```

---

## Example Hierarchy

```text
Profile Snapshots
 ├── Real-Time Customer Profile
 │    [DEFAULT]
 │    [EDGE ACTIVE]
 │
 │    └── Profile-Snapshot
 │
 ├── Gold Customers
 │
 │    └── Profile-Snapshot-GoldCustomers
 │
 └── Premium Customers
      └── Profile-Snapshot-PremiumCustomers
```

---

# Dataset Information Display

Profile Snapshot datasets should display the same metadata currently available for regular datasets.

## Dataset Name

Source:

```json
tags["adobe/pqs/table"]
```

### Requirements

- Display dataset table name
- Support copy-to-clipboard
- Display copy icon
- Show success toast notification

---

## Row Count

Source:

```json
extensions.adobe_lakeHouse.metrics.rowCount
```

### Requirements

- Display record count
- Format using thousand separators

Examples:

```text
1234 → 1,234
1000000 → 1,000,000
```

---

# Schema Handling

## Important Requirement

Profile Snapshot datasets should NOT display schema fields.

No schema exploration is required.

---

## Do Not Perform

For Profile Snapshot datasets:

```text
Do not call Schema Registry API.
Do not retrieve schema definitions.
Do not display columns.
Do not display field hierarchy.
Do not display datatype icons.
Do not allow field copy operations.
```

---

## Hierarchy Limit

The hierarchy should stop at the dataset level.

Example:

```text
Profile Snapshots
 ├── Real-Time Customer Profile
 │    └── Profile-Snapshot
 │
 └── Gold Customers
      └── Profile-Snapshot-GoldCustomers
```

No child nodes should exist beneath the dataset.

---

# Search Functionality

Search should continue to work across all sections.

## Search Scope

Search should match:

### Dataset Names

Examples:

```text
Profile-Snapshot
customer_profile
transaction_events
```

### Merge Policy Names

Examples:

```text
Real-Time Customer Profile
Gold Customers
Premium Banking Customers
```

---

## Search Behavior

- Case-insensitive
- Real-time filtering
- Preserve hierarchy
- Maintain expanded node state where possible

---

# Performance Requirements

## Merge Policy Caching

Merge Policy details should be cached.

Requirements:

- Fetch once per Merge Policy ID
- Reuse cached result
- Prevent duplicate API calls

---

## Schema Optimization

Since schemas are not displayed for Profile Snapshot datasets:

- Do not perform Schema Registry requests
- Reduce network traffic
- Reduce memory consumption
- Improve explorer responsiveness

---

## Scalability

The implementation should support:

- Hundreds of Profile Snapshot datasets
- Hundreds of Merge Policies
- Large enterprise AEP environments
- Fast filtering and navigation

---

# User Experience Requirements

The Profile Snapshot section should support:

- Expand/collapse behavior
- Search filtering
- Copy dataset name
- Display row count
- Status badges
- Dark mode
- Responsive layout
- Smooth scrolling
- Persistent expansion state

---

# Success Criteria

The enhancement is considered complete when:

✅ CUSTOMER-managed datasets continue functioning exactly as today.

✅ SYSTEM-managed datasets are displayed only when the dataset name begins with:

```text
Profile-Snapshot
```

✅ Merge Policy IDs are extracted from:

```json
tags.unifiedProfile
```

✅ Merge Policy API is executed using the extracted Merge Policy ID.

✅ Merge Policy Name is displayed.

✅ Default Merge Policies display a DEFAULT badge.

✅ Edge-enabled Merge Policies display an EDGE ACTIVE badge.

✅ Profile Snapshot datasets are grouped beneath their Merge Policy.

✅ Dataset name copy functionality works.

✅ Row counts are displayed.

✅ Search works across datasets and Merge Policies.

✅ Merge Policy responses are cached.

✅ Schema APIs are never called for Profile Snapshot datasets.

✅ No columns are displayed for Profile Snapshot datasets.

✅ Performance remains responsive in large AEP environments.
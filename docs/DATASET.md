# Dataset Explorer

## AI Implementation Prompt

Create a new **Dataset Explorer Panel** for Adobe Experience Platform (AEP) connections.

The objective is to provide users with a searchable, hierarchical explorer that displays datasets and schema fields, similar to a database object explorer.

The implementation should be scalable, performant, visually modern, and support environments containing hundreds or thousands of datasets.

---

## Dataset Retrieval

Retrieve datasets using the AEP Catalog API.

### Endpoint

```http
GET https://platform.adobe.io/data/foundation/catalog/dataSets?limit=100&start=0
```

### Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
x-api-key: <API_KEY>
x-gw-ims-org-id: <IMS_ORG>
x-sandbox-name: <SANDBOX_NAME>
```

---

## Pagination Logic

The API returns a maximum of 100 datasets per request.

Implement automatic pagination.

Example:

```text
limit=100&start=0
limit=100&start=100
limit=100&start=200
limit=100&start=300
...
```

Continue executing requests until an empty response is returned.

Example:

```json
{}
```

Requirements:

- No user intervention required
- Automatic recursive or iterative fetching
- Merge all responses into a single dataset collection
- Prevent duplicates
- Handle 1000+ datasets efficiently

---

## Dataset Filtering

Only display datasets satisfying:

```json
classification.managedBy = "CUSTOMER"
```

All other datasets should be excluded from the explorer.

---

## Dataset Information Display

Display the following information for every dataset.

### Dataset Name

Source:

```json
tags["adobe/pqs/table"]
```

Requirements:

- Display dataset table name
- Add copy-to-clipboard functionality
- Provide copy icon
- Show copied confirmation toast

---

### Record Count

Source:

```json
extensions.adobe_lakeHouse.metrics.rowCount
```

Requirements:

- Display record count
- Format with thousand separators

Examples:

```text
1234 → 1,234
1000000 → 1,000,000
```

---

## Profile Enabled Classification

Datasets must be separated into two sections.

### Profile Enabled

Condition:

```json
tags.unifiedProfile[0] = "enabled:true"
```

### Non Profile Enabled

All remaining datasets.

---

## Required Tree Structure

```text
Profile Enabled
 ├── Dataset A
 │    ├── Column1
 │    ├── Column2
 │    └── Object1
 │         └── ChildField
 │
 └── Dataset B

Non Profile Enabled
 ├── Dataset C
 └── Dataset D
```

---

## Search Functionality

Add dataset search capability.

Requirements:

- Search while typing
- Case-insensitive
- Search dataset names only
- Search across both profile groups
- Preserve hierarchy during filtering
- Instant filtering experience

---

## Schema Retrieval

When a dataset is expanded, retrieve schema information.

### Endpoint

```http
GET https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas/<SCHEMA_ID>
```

### Headers

```http
Accept: application/vnd.adobe.xed-full+json; version=1
Authorization: Bearer <ACCESS_TOKEN>
x-api-key: <API_KEY>
x-gw-ims-org-id: <IMS_ORG>
x-sandbox-name: <SANDBOX_NAME>
```

---

## Schema ID Transformation

The Schema Registry API requires a transformed schema identifier.

Example input from dataset response:

```text
https://ns.adobe.com/ibmnaamericaspartnersandbox/schemas/69032988f5b87083039a0bafaf20c377ce058c92599c465a
```

Expected value:

```text
_ibmnaamericaspartnersandbox.schemas.69032988f5b87083039a0bafaf20c377ce058c92599c465a
```

Transformation rule:

```text
https://ns.adobe.com/{tenant}/schemas/{schemaId}
```

becomes

```text
_{tenant}.schemas.{schemaId}
```

---

## Column Extraction Requirements

Extract all fields recursively from the schema definition.

Requirements:

- Use field names only
- Do not display field titles
- Preserve hierarchy
- Support unlimited nesting depth

Supported field types:

- String
- Integer
- Long
- Double
- Number
- Boolean
- Date
- DateTime
- Object
- Array
- Array of Objects
- String Array
- Map
- Nested Complex Structures

---

## Column Tree Display

Display columns as expandable tree nodes.

Example:

```text
_ibmnaamericaspartnersandbox
 └── attributes
      ├── attr1
      ├── attr2
      └── preferences
           └── setting1
```

Requirements:

- Expand/Collapse support
- Nested hierarchy support
- Smooth animations
- Preserve expanded state during search

---

## Fully Qualified Column Copy

Every field should have copy functionality.

The copied value should include the complete hierarchy path.

Example hierarchy:

```text
_ibmnaamericaspartnersandbox
 └── attributes
      └── attr1
```

Copied value:

```text
_ibmnaamericaspartnersandbox.attributes.attr1
```

Additional examples:

```text
customer.email
customer.address.city
profile.identities.crmId
```

Requirements:

- Copy icon beside every field
- Clipboard support
- Copied confirmation toast

---

## Datatype Icons

Display datatype-specific icons beside columns.

Suggested type mapping:

### String

```text
Text Icon
```

### Integer / Long

```text
Hash Icon
```

### Number / Double

```text
Calculator Icon
```

### Boolean

```text
Toggle Icon
```

### Date

```text
Calendar Icon
```

### DateTime

```text
Clock Icon
```

### Object

```text
Folder Icon
```

### Array

```text
List Icon
```

### Map

```text
Layers Icon
```

### Unknown

```text
File Icon
```

Requirements:

- Consistent appearance
- Tooltip displaying datatype

---

## Performance Requirements

### Dataset Loading

- Automatic API pagination
- Progressive loading
- Deduplication
- Background fetching

### Schema Loading

- Load schema only when dataset node expands
- Cache schema response
- Prevent duplicate schema requests

### Scalability

Must efficiently support:

- 1000+ datasets
- Deep hierarchical schemas
- Large schemas with thousands of fields

---

## UI Requirements

The Dataset
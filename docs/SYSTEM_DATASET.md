Enhance the Dataset Explorer UI with the following grouping logic and functionality updates:

### 1. Add a New Dataset Group: "System"

Create a new top-level group called **System** and display the following datasets under this group:

- AJO Message Feedback Event Dataset
- AJO Push Tracking Experience Event Dataset
- AJO Push Profile Dataset
- AJO Consent Service Dataset
- AJO Email Tracking Experience Event Dataset
- AJO Classification Dataset
- AJO Profile Counters Extension
- AJO Entity Dataset
- AJO Secondary Recipient Feedback Event Dataset
- AJO Interactive Messaging Profile Dataset
- AJO STO Summary Dataset
- AJO Inbound Activity Event Dataset
- AJO Surfaces Dataset
- Journeys
- Journey Step Events
- AJO ExD Decision Event Dataset
- AJO Live Activities Feedback Event Dataset
- AJO Channel Tracking Event Dataset
- AJO Message Export Dataset
- AJO Message Event Metadata Dataset

### 2. System Group Behavior

The **System** group should behave exactly like the existing:

- Profile
- Profile Snapshot
- Non Profile

groups.

Implement all existing capabilities available in these groups, including but not limited to:

- Expand / Collapse
- Dataset Search
- Dataset Selection
- Schema Viewing
- Field Explorer
- Copy Field Paths
- Filtering
- Pagination
- Dataset Details View
- Any current dataset actions available in other groups

The user experience and functionality should remain fully consistent across all dataset groups.

### 3. Add a New Dataset Group: "Segment Snapshot"

Create a separate top-level group called **Segment Snapshot**.

Grouping rule:

- Any dataset whose name starts with **"Segmentdefinition-Snapshot"**
- Automatically place it under the **Segment Snapshot** group.
- Do not display these datasets under any other group.

Example:

- Segmentdefinition-Snapshot-ABC
- Segmentdefinition-Snapshot-Customer-Eligible
- Segmentdefinition-Snapshot-CreditCard

should all appear under:

Segment Snapshot
 ├── Segmentdefinition-Snapshot-ABC
 ├── Segmentdefinition-Snapshot-Customer-Eligible
 └── Segmentdefinition-Snapshot-CreditCard

### 4. Dataset Grid Columns

The newly created groups should display the same dataset table structure and metadata columns as existing groups.

Include the following columns:

- Dataset Name
- Dataset ID
- Schema Name
- Record Count
- Batch Count
- Created Date
- Last Modified Date
- Dataset Type
- Group Name
- Actions

Ensure sorting, filtering, searching, and pagination work consistently across these columns.

### 5. Implementation Requirements

- Do not impact existing Profile, Profile Snapshot, or Non Profile grouping logic.
- Classification should be dynamic and driven from dataset names.
- Existing functionality must remain unchanged.
- Follow current coding patterns and component architecture.
- Preserve backward compatibility.
- Use the same visual design, styling, icons, and interactions as existing dataset groups.
- Ensure newly added groups participate in global search and filtering functionality.
- Maintain responsiveness across desktop and mobile views.

### Expected Result

The Dataset Explorer should contain the following top-level groups:

- Profile
- Profile Snapshot
- Non Profile
- System
- Segment Snapshot

with System and Segment Snapshot providing the same user experience and capabilities as the existing dataset groups.
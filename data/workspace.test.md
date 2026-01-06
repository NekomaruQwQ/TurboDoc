# Test Workspace Documentation

This document explains the test workspace structure in `workspace.test.json` and what each section tests.

## Overview

The test workspace contains **3 named groups** and **3 ungrouped crates**, demonstrating all data model features matching [frontend/data.ts](../frontend/data.ts).

---

## Data Model Structure

### Current Schema (from `data.ts`)

```typescript
interface ItemCrate {
    name: string;
    pinnedPages: string[];           // Array of path strings
    currentPage: string | null;      // Path string or null
    currentVersion: string;
}
```

**Key design decisions:**

1. **Simple page representation**: Pages are just path strings (e.g., `"tokio/struct.Runtime.html"`)
2. **Derived preview state**: A page is a "preview page" if `currentPage` is NOT in `pinnedPages`
3. **Derived pinned+active state**: A page is "pinned and active" if `currentPage` IS in `pinnedPages`
4. **Group items**: Wrapped as `{ type: "crate", data: ItemCrate }` for future extensibility
5. **Ungrouped items**: Same `Item[]` wrapper structure as group items

---

## Named Groups

### 1. "Async Runtime" Group (Expanded)

**Purpose:** Tests async runtime crates with multiple versions and page states.

#### `tokio` (Expanded)
- **Version:** 1.42.0
- **Pinned Pages:**
  - `tokio/struct.Runtime.html`
  - `tokio/task/index.html`
- **Current Page:** `tokio/sync/struct.Mutex.html` (NOT in pinnedPages → preview)
- **Tests:**
  - Multiple pinned pages
  - Preview page (currentPage not in pinnedPages)

#### `async-std` (Collapsed)
- **Version:** 1.13.0
- **Pinned Pages:** None (empty array)
- **Current Page:** `null`
- **Tests:**
  - Collapsed crate state
  - Empty pinnedPages array
  - null currentPage

---

### 2. "Serialization" Group (Expanded)

**Purpose:** Tests serialization ecosystem with different page configurations.

#### `serde` (Expanded)
- **Version:** 1.0.215
- **Pinned Pages:**
  - `serde/trait.Serialize.html`
  - `serde/trait.Deserialize.html`
- **Current Page:** `serde/trait.Deserialize.html` (IS in pinnedPages → pinned and active)
- **Tests:**
  - Trait documentation references
  - **Edge case:** currentPage that IS in pinnedPages (VS Code-style active pinned tab)

#### `serde_json` (Expanded)
- **Version:** 1.0.132
- **Pinned Pages:** `serde_json/fn.from_str.html`
- **Current Page:** `null`
- **Tests:**
  - Function documentation reference
  - Pinned pages but no currently open page

---

### 3. "Graphics & Math" Group (Collapsed)

**Purpose:** Tests collapsed group with pre-1.0 crates.

#### `glam` (Collapsed)
- **Version:** 0.29.2 (pre-1.0)
- **Pinned Pages:**
  - `glam/struct.Vec3.html`
  - `glam/struct.Mat4.html`
- **Current Page:** `null`
- **Tests:**
  - Pre-1.0 version handling (0.x series)
  - Collapsed group AND collapsed crate (nested collapsing)
  - Multiple pinned pages with no current page

---

## Ungrouped Crates

**Purpose:** Tests crates not organized into groups (displayed in "Not Yet Grouped" section).

### `anyhow` (Expanded)
- **Version:** 1.0.93
- **Pinned Pages:** None (empty array)
- **Current Page:** `anyhow/struct.Error.html` (NOT in pinnedPages → preview)
- **Tests:**
  - Ungrouped crate with only preview page
  - Empty pinnedPages with non-null currentPage

### `thiserror` (Collapsed)
- **Version:** 1.0.69 (NOT latest available)
- **Pinned Pages:** None (empty array)
- **Current Page:** `null`
- **Tests:**
  - **Version choice:** User chose 1.0.69 instead of latest 2.0.x (stability preference)
  - No pages (freshly added crate)

### `regex` (Expanded)
- **Version:** 1.11.1
- **Pinned Pages:** `regex/struct.Regex.html`
- **Current Page:** `regex/struct.Captures.html` (NOT in pinnedPages → preview)
- **Tests:**
  - Both pinned and preview pages simultaneously

---

## Edge Cases Covered

### Data Model
- ✅ Empty `pinnedPages` array (`async-std`, `anyhow`, `thiserror`)
- ✅ `null` currentPage (`async-std`, `serde_json`, `glam`, `thiserror`)
- ✅ `currentPage` that IS in `pinnedPages` (`serde` - pinned and active)
- ✅ `currentPage` that is NOT in `pinnedPages` (`tokio`, `anyhow`, `regex` - preview)

### Version Handling
- ✅ Pre-1.0 versions (`glam` - 0.29.x series)
- ✅ Version choice different from latest (`thiserror` - 1.0.69 vs 2.0.x)

### Page States (Derived)
- ✅ Multiple pinned pages (`tokio`, `serde`, `glam`)
- ✅ Only pinned pages, no current (`serde_json`, `glam`)
- ✅ Only preview, no pinned (`anyhow`)
- ✅ Both pinned and preview (`tokio`, `regex`)
- ✅ Pinned page is also current (`serde`)
- ✅ No pages at all (`async-std`, `thiserror`)

### UI States
- ✅ Expanded groups (`Async Runtime`, `Serialization`)
- ✅ Collapsed groups (`Graphics & Math`)
- ✅ Expanded crates (`tokio`, `serde`, `serde_json`, `anyhow`, `regex`)
- ✅ Collapsed crates (`async-std`, `glam`, `thiserror`)
- ✅ Nested collapsing (collapsed group + collapsed crate)

### Group Structure
- ✅ Items wrapped as `{ type: "crate", data: {...} }` for future extensibility
- ✅ Ungrouped uses same `Item[]` wrapper structure

---

## Usage

### Copy to target/debug for testing:
```powershell
Copy-Item data\workspace.test.json target\debug\data\workspace.json
```

### Or manually test the app to verify:
1. Load app - workspace should load correctly
2. Verify all edge cases render properly
3. Test interactions (expand/collapse, navigate, pin/unpin)

### Reset to empty workspace:
```powershell
Remove-Item target\debug\data\workspace.json
```

---

## Validation Checklist

When using this test workspace, verify:

**Structure:**
- [ ] All 3 named groups render correctly
- [ ] "Not Yet Grouped" section displays 3 ungrouped crates
- [ ] Group items are properly unwrapped from `{ type, data }` structure

**UI States:**
- [ ] Expanded/collapsed states match expectations
- [ ] Nested collapsing works (Graphics & Math group + glam crate)

**Versions:**
- [ ] Version selectors show correct current version
- [ ] Pre-1.0 versions display correctly (`glam`)
- [ ] Current version ≠ latest handled (`thiserror`)

**Pages:**
- [ ] Pinned pages show unpin button
- [ ] Preview pages (currentPage NOT in pinnedPages) show in italic with pin button
- [ ] Pinned+active page (currentPage IS in pinnedPages) shows as active with unpin button (`serde`)
- [ ] Clicking page navigates iframe correctly

**Persistence:**
- [ ] Workspace persists after reload
- [ ] No data loss or corruption

---

## Determining Page State (Implementation Reference)

Given `crate: ItemCrate` and a page path `page: string`:

```typescript
// Is this page pinned?
const isPinned = crate.pinnedPages.includes(page);

// Is this page the currently active page?
const isActive = crate.currentPage === page;

// Is this page a preview? (active but not pinned)
const isPreview = isActive && !isPinned;

// Is this page pinned and active?
const isPinnedAndActive = isActive && isPinned;
```

**Display logic:**
- Preview pages: italic text, show Pin icon
- Pinned pages: normal text, show PinOff icon
- Active page: highlighted background (regardless of pinned state)

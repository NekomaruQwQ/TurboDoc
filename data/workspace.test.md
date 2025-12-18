# Test Workspace Documentation

This document explains the test workspace structure in `workspace.test.json` and what each section tests.

## Overview

The test workspace contains **3 named groups** and **3 ungrouped crates**, demonstrating all data model features matching [frontend/data.ts](../frontend/data.ts).

---

## Data Model Structure

### Key Differences from Plan Document

**The actual implementation uses a SIMPLER structure than originally planned:**

1. **Field naming**: camelCase (e.g., `isExpanded`, `currentVersion`)
2. **Links only**: Simplified `CrateLinks` instead of full `CrateMetadata` (no description, license, etc.)
3. **Page model**: `pinnedPages` + `currentPage` (simpler than plan's `docs_pages` + `docs_open_page`)
4. **Group items**: Wrapped as `{ type: "crate", data: ItemCrate }` for future extensibility
5. **No extra fields**: Pages don't have `title` or `lastAccessed` fields

---

## Named Groups

### 1. "Async Runtime" Group (Expanded)

**Purpose:** Tests async runtime crates with multiple versions and page states.

#### `tokio` (Expanded)
- **Version:** 1.42.0
- **Links:** Complete (repository, homepage, documentation)
- **Version Groups:** 4 groups across different major.minor series (1.42, 1.40, 1.0, 0.2)
- **Pinned Pages:**
  - `tokio/struct.Runtime.html`
  - `tokio/task/index.html`
- **Current Page:** `tokio/sync/struct.Mutex.html` (unpinned - half-open state)
- **Tests:**
  - Multiple pinned pages
  - Half-open page (currentPage with pinned=false)
  - Complete links metadata

#### `async-std` (Collapsed)
- **Version:** 1.13.0
- **Links:** Partial (no homepage)
- **Version Groups:** 3 groups (1.13, 1.12, 1.0)
- **Pages:** None
- **Tests:**
  - Collapsed crate state
  - Missing optional links field (homepage)
  - Empty pinnedPages array
  - null currentPage

---

### 2. "Serialization" Group (Expanded)

**Purpose:** Tests serialization ecosystem with different page configurations.

#### `serde` (Expanded)
- **Version:** 1.0.215
- **Links:** Complete with homepage
- **Version Groups:** 2 groups (1.0.x series, 0.9.x series)
- **Pinned Pages:**
  - `serde/trait.Serialize.html`
  - `serde/trait.Deserialize.html`
- **Current Page:** `serde/trait.Deserialize.html` (pinned=true)
- **Tests:**
  - Trait documentation references
  - **Edge case:** currentPage that is ALSO pinned (VS Code-style active pinned tab)
  - Multiple major version series

#### `serde_json` (Expanded)
- **Version:** 1.0.132
- **Links:** Partial (no homepage)
- **Version Groups:** 1 group (all 1.0.x)
- **Pinned Pages:** `serde_json/fn.from_str.html`
- **Current Page:** null
- **Tests:**
  - Function documentation reference
  - Pinned pages but no currently open page
  - Single version group

---

### 3. "Graphics & Math" Group (Collapsed)

**Purpose:** Tests collapsed group with pre-1.0 crates.

#### `glam` (Collapsed)
- **Version:** 0.29.2 (pre-1.0)
- **Links:** Partial (no homepage)
- **Version Groups:** 3 groups (0.29.x, 0.28.x, 0.20.x)
- **Pinned Pages:**
  - `glam/struct.Vec3.html`
  - `glam/struct.Mat4.html`
- **Current Page:** null
- **Tests:**
  - Pre-1.0 version handling (0.x series)
  - Collapsed group AND collapsed crate (nested collapsing)
  - Multiple pinned pages with no current page

---

## Ungrouped Crates

**Purpose:** Tests crates not organized into groups (displayed in "Not Yet Grouped" section).

### `anyhow` (Expanded)
- **Version:** 1.0.93
- **Links:** Partial (no homepage)
- **Version Groups:** 1 group (all 1.0.x)
- **Pinned Pages:** None
- **Current Page:** `anyhow/struct.Error.html` (unpinned)
- **Tests:**
  - Ungrouped crate with only half-open page
  - Empty pinnedPages with non-null currentPage

### `thiserror` (Collapsed)
- **Version:** 1.0.69 (NOT latest available)
- **Links:** Partial (no homepage)
- **Version Groups:** 3 groups (2.0.x, 2.0.0-rc, 1.0.x)
- **Pages:** None
- **Tests:**
  - **Version choice:** User chose 1.0.69 instead of latest 2.0.9 (stability preference)
  - Pre-release version in groups (2.0.0-rc.1)
  - No pages (freshly added crate)

### `regex` (Expanded)
- **Version:** 1.11.1
- **Links:** MISSING (null) - simulates failed metadata fetch
- **Version Groups:** 4 groups, including yanked 0.2.11
- **Pinned Pages:** `regex/struct.Regex.html`
- **Current Page:** `regex/struct.Captures.html` (unpinned)
- **Tests:**
  - **Missing links field** (metadata fetch failed)
  - Yanked version in version groups
  - Both pinned and half-open pages

---

## Edge Cases Covered

### Data Model
- ✅ Empty `pinnedPages` array (`async-std`, `anyhow`, `thiserror`)
- ✅ `null` currentPage (`async-std`, `serde_json`, `glam`, `thiserror`)
- ✅ Missing `links` field entirely (`regex`)
- ✅ Missing optional `homepage` in links (multiple crates)
- ✅ `currentPage` that is also pinned (`serde`)

### Version Handling
- ✅ Pre-1.0 versions (`glam` - 0.29.x series)
- ✅ Version choice different from latest (`thiserror` - 1.0.69 vs 2.0.9)
- ✅ Pre-release versions (`thiserror` - 2.0.0-rc.1)
- ✅ Yanked versions (`regex` - 0.2.11)
- ✅ Multiple major version series (`serde` - 0.9.x and 1.0.x)

### Page States
- ✅ Multiple pinned pages (`tokio`, `serde`, `glam`)
- ✅ Only pinned pages, no half-open (`serde_json`, `glam`)
- ✅ Only half-open, no pinned (`anyhow`, `regex` current)
- ✅ Half-open page that is also pinned (`serde`)
- ✅ No pages at all (`async-std`, `thiserror`)

### UI States
- ✅ Expanded groups (`Async Runtime`, `Serialization`)
- ✅ Collapsed groups (`Graphics & Math`)
- ✅ Expanded crates (`tokio`, `serde`, `anyhow`, `regex`)
- ✅ Collapsed crates (`async-std`, `serde_json`, `glam`, `thiserror`)
- ✅ Nested collapsing (collapsed group + collapsed crate)

### Group Structure
- ✅ Items wrapped as `{ type: "crate", data: {...} }` for future extensibility
- ✅ Direct `ItemCrate[]` for ungrouped (no wrapping needed)

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

**Links & Metadata:**
- [ ] External links (repository, documentation) work
- [ ] Missing links field handled gracefully (`regex`)
- [ ] Missing homepage handled gracefully (multiple crates)

**Versions:**
- [ ] Version selectors show correct groups
- [ ] Pre-1.0 versions display correctly (`glam`)
- [ ] Pre-release versions marked distinctly (`thiserror`)
- [ ] Yanked versions shown with warning (`regex`)
- [ ] Current version ≠ latest handled (`thiserror`)

**Pages:**
- [ ] Pinned pages show unpin button
- [ ] Half-open pages (currentPage with pinned=false) show in italic with pin button
- [ ] Clicking page navigates iframe correctly
- [ ] `currentPage` that is also pinned shows as active (`serde`)

**Persistence:**
- [ ] Workspace persists after reload
- [ ] No data loss or corruption

---

## Simplified vs Original Plan

The test workspace follows the **actual [frontend/data.ts](../frontend/data.ts)** implementation, which is SIMPLER than the original plan:

**Removed from original plan:**
- ~~`title` and `lastAccessed` on pages~~ (not in data.ts)
- ~~`description`, `license`, `latest_version` in metadata~~ (not in data.ts)
- ~~`metadataError` field~~ (not in data.ts)
- ~~Complex version group labels~~ (data.ts uses simpler structure)

**Current structure advantages:**
- Simpler to implement
- Easier to maintain
- Can add fields incrementally as needed
- Type-safe with TypeScript definitions

The test workspace validates that the actual implementation works correctly, not the original plan.

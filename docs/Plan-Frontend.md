# TurboDoc Frontend Implementation Plan

> **📖 For completed work and design decisions, see [README.md](./README.md)**

## Overview

This document tracks the **remaining implementation work** for TurboDoc's frontend UI (Phase 5+).

**Completed (Phases 1-4):**
- ✅ Data model (Workspace, Cache types)
- ✅ API integration (crates.io client with rate limiting)
- ✅ IPC layer (timeout handling, error recovery)
- ✅ State management (AppContext with dual state)

**Next Up (Phase 5):**
- 🚧 UI Components (Explorer, SearchBar, GroupList, CrateCard, PageList, etc.)

---

## Visual Reference

### Target UI Layout

```
┌─────────────────────────────────┐
│ [Search crate and page...    ] │  ← Search bar
├─────────────────────────────────┤
│ Not Yet Grouped                 │  ← Ungrouped section (if any)
│  ┌─────────────────────────┐   │
│  │ serde      [v] [...]    │   │  ← Crate card (collapsed)
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│ ▼ My Project Dependencies      │  ← Named group (expanded)
│  ┌─────────────────────────┐   │
│  │ tokio                   │   │
│  │ [crates.io] [repo]      │   │
│  │ [1.42.0 (latest) ▼]    │   │
│  │                         │   │
│  │ 🏠 Home                 │   │
│  │ _struct.Runtime_ 📌    │   │  ← Preview page (italic)
│  │ tokio::task 📌⊗        │   │  ← Pinned page
│  │ tokio::sync 📌⊗        │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ serde (collapsed)       │   │
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│ [+ Add Group]                   │
└─────────────────────────────────┘
```

### Crate Card Design
- **Header section:**
  - Crate name (clickable, bold)
  - External links (crates.io, repository, homepage) as small icon buttons
  - Version selector dropdown (right-aligned)
  - "..." menu for actions (move, remove, refresh)
- **Body section (expandable):**
  - Home link with house icon (always visible)
  - Documentation pages list
  - Preview page shown in italic with pin button
  - Pinned pages shown normally with unpin button
  - Active page highlighted with accent background

---

## 🚨 Implementation Strategy

### Mandatory Rules

1. **Top-to-Down, Incremental Implementation**
   - Start from the **top of the visual hierarchy** (App → Explorer → SearchBar → Groups → CrateCard → PageList)
   - Implement **one component at a time** from parent to children
   - **Do NOT skip ahead** or implement multiple components in parallel
   - **Complete each component fully** (styling, interaction, error states) before moving to the next

2. **Immediate Visual Feedback with HMR**
   - Leverage Hot Module Replacement (HMR) for instant visual feedback
   - After implementing each component, **verify visually in the browser**
   - Test all interactive states (hover, click, expand, collapse, loading, error)
   - Iterate on the component until it's **visually and functionally correct**
   - Only move to the next component when current one is **fully complete**

3. **Update This Document After Each Component**
   - **Mark completed components** with ✅ in the checklist below
   - Add **notes about implementation decisions** or deviations from plan
   - Document **discovered issues** or **future improvements** needed
   - Keep the plan as a **living document** that tracks progress

### Iteration Workflow Per Component

```
1. Read component spec from this plan
2. Implement component structure (JSX, basic props)
3. Check HMR → Verify structure in browser
4. Add styling (Tailwind classes)
5. Check HMR → Verify visual design
6. Add interactions (onClick, onChange, etc.)
7. Check HMR → Verify interactions work
8. Add loading/error states
9. Check HMR → Verify edge cases
10. Mark component as ✅ in this plan
11. Commit changes (optional)
12. Move to next component
```

---

## Phase 5: UI Components

### Implementation Checklist

```
Component Path                                  Status  Notes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[✓] frontend/explorer/index.tsx                 Explorer, groups, items, ExplorerItemList
[✓] frontend/explorer/ExplorerItemProps.ts               ExplorerItemProps<T> interface
[✓] frontend/explorer/ExplorerGroupHeader.tsx   Group header with rename and menu
[✓] frontend/explorer/ExplorerGroupMenu.tsx     Group menu (expand/collapse all, move, remove)
[✓] frontend/explorer/components/misc.tsx       ExplorerGroupHeaderCommon, ExplorerGroupActions, CreateGroupComponent
[✓] frontend/explorer/crate/CrateCard.tsx       Collapsible crate card with header
[✓] frontend/explorer/crate/CratePageList.tsx   Page list + CratePageItem
[ ] frontend/explorer/search-bar.tsx            Search input
[ ] frontend/explorer/search-results.tsx        Search dropdown
[✓] frontend/explorer/crate/CrateVersionSelector.tsx  Version selector
[✓] frontend/explorer/crate/CrateMenu.tsx       Crate actions menu
```

### Component Specifications

#### **Explorer Component** (`frontend/explorer/index.tsx`)

**Status:** ✅ Implemented

**Purpose:** Main container for sidebar

**Props:** None (uses AppContext)

**Architecture:**
- **Callback-based data flow**: Updates flow through typed callbacks (`updateItems`, `updateItem`, `setExpanded`, `removeItem`) instead of components calling `appContext` directly
- **`ExplorerItemProps<T>` interface** (`ExplorerItemProps.ts`): Generic props for item components with standard CRUD callbacks
- **Component hierarchy**: `Explorer` → `ExplorerUngrouped`/`ExplorerGroup` → `ExplorerItem` → `CrateCard`
- **Tagged union downcasting**: `ExplorerItem` uses `as any` cast when forwarding `updateItem` callback from `Item` to `ItemCrate` - pragmatic tradeoff since type safety is enforced by the switch statement

**Inline Components (in `index.tsx`):**
- **ExplorerUngrouped**: Renders "Ungrouped" section with expand/collapse all button
- **ExplorerGroup**: Named group with `ExplorerGroupHeader` and item list
- **ExplorerItemList**: Shared component for rendering item lists (used by both ungrouped and groups)
- **ExplorerItem**: Renders `Item` tagged union - switches on `item.type` to render appropriate component (currently only `CrateCard`)

**Extracted Components:**
- **ExplorerGroupHeader** (`ExplorerGroupHeader.tsx`): Header for named groups with rename state (inline input) and group menu
- **ExplorerGroupHeaderCommon** (`components/misc.tsx`): Shared header layout with title and action slot
- **ExplorerGroupActions** (`components/misc.tsx`): Typed slot wrapper for header action buttons
- **CreateGroupComponent** (`components/misc.tsx`): "Add Group" button that transforms into inline input

**Responsibilities:**
- Manages search state (query, results, isSearching)
- Renders SearchBar component
- Conditionally renders SearchResults (when query is not empty)
- Renders ungrouped section and named groups
- Renders AddGroupButton

**State:**
```typescript
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
const [isSearching, setIsSearching] = useState(false);
```

**Layout:**
```tsx
<div className="flex flex-col h-full p-4 gap-4">
  <SearchBar
    value={searchQuery}
    onChange={setSearchQuery}
    onSearch={handleSearch}
    isLoading={isSearching}
  />
  {searchQuery && (
    <SearchResults
      results={searchResults}
      onSelect={handleSelectCrate}
    />
  )}
  <ExplorerUngrouped ... />
  {workspace.groups.map(group => <ExplorerGroup ... />)}
  <button onClick={handleAddGroup}>+ Add Group</button>
</div>
```

**Actions to Implement:**
- `appContext.addGroup(name: string)` - Add new group

**Search Implementation:**
- Uses `searchCrates(query)` from `@/services/crates-api`
- API endpoint: `https://crates.io/api/v1/crates?q={query}`
- Returns: `{ name: string, description: string | null }[]`
- Rate limited: 1-second delay between requests (handled by API module)
- Debounced: 300ms delay before triggering search

---

#### **SearchBar Component** (`frontend/explorer/search-bar.tsx`)

**Purpose:** Search input field

**Props:**
```typescript
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  isLoading: boolean;
}
```

**Features:**
- Debounced search (300ms)
- Clear button (appears when value is not empty)
- Loading spinner (when isSearching)
- Escape key clears input
- Enter key triggers search

**Layout:**
```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" />
  <Input
    placeholder="Search crate and page..."
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={handleKeyDown}
    className="pl-9 pr-9"
  />
  {isLoading && <Spinner className="absolute right-3 ..." />}
  {value && !isLoading && (
    <X onClick={handleClear} className="absolute right-3 ..." />
  )}
</div>
```

**Icons:** `Search`, `X` (lucide-react)

---

#### **SearchResults Component** (`frontend/explorer/search-results.tsx`)

**Purpose:** Dropdown showing search results

**Props:**
```typescript
interface SearchResultsProps {
  results: SearchResult[];
  onSelect: (crateName: string) => void;
}

interface SearchResult {
  name: string;
  description: string | null;
}
```

**Features:**
- Scrollable list (max height)
- Hover states
- Click adds crate to ungrouped
- Empty state ("No results found")

**Layout:**
```tsx
<div className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto bg-popover rounded-md shadow-lg">
  {results.length === 0 ? (
    <div className="p-4 text-muted-foreground">No results found</div>
  ) : (
    results.map(result => (
      <div
        key={result.name}
        onClick={() => onSelect(result.name)}
        className="p-3 hover:bg-accent cursor-pointer"
      >
        <div className="font-semibold">{result.name}</div>
        {result.description && (
          <div className="text-sm text-muted-foreground">{result.description}</div>
        )}
      </div>
    ))
  )}
</div>
```

**Actions to Implement:**
- `appContext.addCrate(crateName: string)` - Add crate to ungrouped

**Design Decision: Include Descriptions**
- **Decision**: Search returns `{ name: string, description: string | null }[]`
- **Rationale**: Users need context when choosing from search results
- **Implementation**: Display description below crate name in search dropdown
- **Null handling**: Gracefully handle crates without descriptions (don't render description line)
- **Confirmed**: API implementation in `crates-api.ts` returns this structure

---

#### **CrateCard Component** (`frontend/explorer/crate/CrateCard.tsx`)

**Status:** ✅ Implemented

**Purpose:** Card displaying crate info and pages

**Props:** Uses `ExplorerItemProps<ItemCrate>` from ExplorerItemProps.ts

**Features:**
- Collapsible page list (Radix Collapsible, no shadcn Card wrapper for simpler styling)
- Clickable crate name (toggles collapse)
- Version selector with navigation support
- "..." menu (external links, move, refresh, remove)
- Auto-syncs version from current page URL

**Layout:**
```tsx
<Collapsible>
    <div className='flex flex-row items-stretch px-1 gap-1'>
        <CollapsibleTrigger>{crate.name}</CollapsibleTrigger>
        <CrateVersionSelector crate={crate} crateCache={crateCache} setVersion={...} />
        <CrateMenu crate={crate} removeItem={props.removeItem} />
    </div>
    <CollapsibleContent>
        <CratePageList crate={crate} updateCrate={props.updateItem} />
    </CollapsibleContent>
</Collapsible>
```

**Implementation notes:**
- `crateCache` fetched synchronously via `getCrateCache()` (triggers async refetch in background)
- External links use `app.navigateTo()` which triggers iframe navigation - Rust host intercepts and opens non-docs.rs URLs in system browser
- Uses `currentPage.type === 'crate'` checks instead of string `.startsWith()` for URL matching

**Version change behavior:**
- If currently viewing this crate's docs, navigates to new version URL
- Otherwise, just updates `crate.currentVersion`

**Auto-version sync:**
- Detects when `currentPage` URL has different version than `crate.currentVersion`
- Automatically updates to match (handles "latest" and specific versions)

---

#### **CrateVersionSelector Component** (`frontend/explorer/crate/CrateVersionSelector.tsx`)

**Status:** ✅ Implemented

**Purpose:** Version selector dropdown

**Props:**
```typescript
{
    crate: ReadonlyDeep<ItemCrate>;
    crateCache: ReadonlyDeep<CrateCache> | undefined;
    setVersion(version: string): void;
}
```

**Features:**
- Uses shadcn Select (Radix UI)
- Shows "latest" as first option (stores literal string)
- Shows first non-yanked version from each of the 5 most recent version groups
- Shows current version if not in the list above
- Validates version exists before calling `setVersion`
- "..." placeholder item for future full version list popup

**Version List Logic:**
```typescript
function getDisplayVersions(currentVersion, versionGroups): string[] {
    const versions = ['latest'];
    const seen = new Set(['latest']);
    for (const group of versionGroups?.slice(0, 5) ?? []) {
        const latestInGroup = group.versions[0] ?? null;
        if (latestInGroup && !seen.has(latestInGroup.num) && !latestInGroup.yanked) {
            versions.push(latestInGroup.num);
            seen.add(latestInGroup.num);
        }
    }
    if (!seen.has(currentVersion)) {
        versions.push(currentVersion);
    }
    return versions;
}
```

**Version update:** CrateCard passes `setVersion` callback that handles navigation to new version URL

---

#### **CrateMenu Component** (`frontend/explorer/crate/CrateMenu.tsx`)

**Status:** ✅ Implemented

**Purpose:** Actions menu for crate (also hosts external links)

**Props:**
```typescript
interface CrateMenuProps {
    crate: ReadonlyDeep<ItemCrate>;
    removeItem: () => void;
}
```

**Features:**
- Dropdown from "..." button (shadcn DropdownMenu)
- External links (Repository, Homepage) at top - moved from CrateCard header
- Move to group (submenu with "Ungrouped" + all named groups)
- Refresh metadata (invalidates cache, triggers refetch)
- Remove crate (uses `removeItem` callback, destructive styling)

**Menu items:**
1. Repository link (if available)
2. Homepage link (if available)
3. (separator)
4. Move to group → submenu with Ungrouped + named groups
5. Refresh metadata
6. (separator)
7. Remove crate (destructive)

**Implementation notes:**
- External links: Uses `CrateLink` helper (moved from CrateCard), opens via `app.navigateTo()`
- Move: Creates new Item, adds to target group, then calls `removeItem()` to remove from source
- Refresh: Uses `app.refreshCrateCache(name)` which deletes cache entry
- Remove: Uses `removeItem` callback from `ExplorerItemProps`
- Added `refreshCrateCache(name)` method to AppContext

**Icons:** `MoreVertical`, `FolderInput`, `RefreshCw`, `Trash2`, `ExternalLink` (lucide-react)

---

#### **CratePageList Component** (`frontend/explorer/crate/CratePageList.tsx`)

**Status:** ✅ Implemented

**Purpose:** List of documentation pages with symbol parsing and color coding

**Props:**
```typescript
interface CratePageListProps {
    crate: ReadonlyDeep<ItemCrate>;
    updateCrate: (updater: (crate: ItemCrate) => void) => void;
}
```

**Features:**
- Home page (always present)
- Preview page (italic, with outline pin icon on hover)
- Pinned pages (with filled pin icon)
- Active page highlighted
- Click navigates to page
- Symbol parsing with One Dark color coding

**Symbol Parsing:**
- **`CrateSymbol` interface**: `{ module: string[], symbol: string, type: SymbolType }`
- **`SymbolType`**: `'module' | 'struct' | 'enum' | 'fn' | 'trait' | 'macro' | 'type' | 'constant' | 'unknown'`
- **`parseSymbol(path)`**: Converts docs.rs paths to structured symbol info:
  - `glam/f32/struct.Vec2.html` → `{ module: ["glam", "f32"], symbol: "Vec2", type: "struct" }`
  - `tokio/runtime/` → `{ module: ["tokio"], symbol: "runtime", type: "module" }`

**One Dark Color Coding** (CSS variables in `global.css`):
- Yellow (`--color-yellow`): struct, enum, type
- Cyan (`--color-cyan`): trait
- Blue (`--color-blue`): fn
- Orange (`--color-orange`): macro, constant
- Default: module, unknown

**Rendering:** Module path in default color, symbol name colored by type

**CratePageItem (inline component):**
- Handles individual page rendering with hover state
- Pin icon: outline for preview (shown on hover), filled for pinned
- Compares `pathSegments.join('/')` for active page detection

**Icons:** `Home`, `Pin` (lucide-react)

---

## Phase 6: Integration & Polish

**After all components are complete:**

1. **Wire up IPC navigation events**
   - Implement 'navigated' event handler in AppContext
   - Auto-detect navigation in iframe
   - Update current page (preview page logic)
   - Auto-add crate if not in workspace

2. **Test cross-crate navigation**
   - Follow links between crates
   - Verify auto-add works
   - Check version handling

3. **Test workspace persistence**
   - Add/remove crates
   - Pin/unpin pages
   - Rename/delete groups
   - Verify saves across app restarts

4. **Polish loading/error states**
   - Add loading skeletons
   - Error boundaries
   - Toast notifications (optional)
   - Accessibility (ARIA labels)

---

## Visual Design Reference

### Detailed Component Styling

#### Explorer Panel
- **Background**: `hsl(var(--background))`
- **Border**: Subtle right border divider
- **Padding**: 16px
- **Width**: Max 400px, min 200px (resizable)

#### Search Bar
- **Layout**: Full width with icon (magnifying glass on left)
- **Styling**: Rounded corners
- **Focus state**: Ring/outline using `hsl(var(--ring))`
- **Icon**: Lucide `Search` (left side, 16px)
- **Clear button**: Lucide `X` (right side, appears when value is not empty)
- **Loading spinner**: Right side, replaces clear button when searching

#### Group
- **Ungrouped section**:
  - Lighter background: `hsl(var(--muted))`
  - Label: "Not Yet Grouped" in muted foreground color
  - No border, subtle distinction from regular groups
- **Regular groups**:
  - Card-like appearance
  - Background: `hsl(var(--card))`
  - Border: `hsl(var(--border))`
  - Rounded corners: `rounded-md`
- **Group header**:
  - Hover effect: `bg-accent` on hover
  - Smooth transitions for all state changes
- **Expand/collapse animation**:
  - Smooth height transition
  - Chevron rotation: 90deg when expanded

#### Crate Card
- **Card component**: Use shadcn/ui Card
- **Padding**: Compact (12px / `p-3`)
- **Layout**: Flex row for header items
- **Spacing**: 8px gaps between header items
- **Header items**:
  - Crate icon: 16px (lucide `Package`)
  - External link icons: 12px (lucide `ExternalLink`)
  - Version dropdown: Compact, right-aligned
  - Menu button: Subtle, appears on hover (lucide `MoreVertical`)

#### Version Combobox
- **Width**: Fixed width (128px / `w-32`)
- **Latest indicator**: Green dot or "(latest)" label
- **Older versions**: Gray/dim text color
- **Pre-release**: Yellow/orange indicator
- **Yanked**: Red warning indicator

#### Page List
- **Indentation**: 24px from left (ml-6)
- **Item spacing**: 4px vertical gap
- **Home page**:
  - Icon: Lucide `Home` (12px)
  - Always visible first item
- **Preview page**:
  - Text: Italic (`italic` class)
  - Pin icon: Lucide `Pin` (12px)
  - Color: Normal foreground
- **Pinned pages**:
  - Text: Normal (not italic)
  - Unpin icon: Lucide `PinOff` (12px)
  - Color: Normal foreground
- **Hover state**:
  - Background: `hsl(var(--accent))`
  - Transition: Smooth (150ms)
- **Active page**:
  - Background: `hsl(var(--accent))` with higher opacity
  - Font weight: Medium or semibold

### Color Palette (from global.css)

- **Background**: `hsl(var(--background))`
- **Foreground**: `hsl(var(--foreground))`
- **Card**: `hsl(var(--card))`
- **Card Foreground**: `hsl(var(--card-foreground))`
- **Muted**: `hsl(var(--muted))`
- **Muted Foreground**: `hsl(var(--muted-foreground))`
- **Accent**: `hsl(var(--accent))`
- **Accent Foreground**: `hsl(var(--accent-foreground))`
- **Destructive**: `hsl(var(--destructive))`
- **Border**: `hsl(var(--border))`
- **Ring**: `hsl(var(--ring))`

### Spacing System

- **Information density**: Compact 8px grid
- **Panel padding**: Comfortable 16px
- **UI element gaps**: Consistent 4px
- **Card padding**: 12px (`p-3`)
- **List item padding**: 4px vertical, 8px horizontal

### Typography Hierarchy

- **Monospace font**: Consistent with code (from global.css)
- **Group names**: Larger, semibold
- **Crate names**: Medium, bold
- **Page links**: Normal weight
- **Preview pages**: Italic for emphasis
- **Muted text**: Reduced opacity or muted color

### Icon Reference (Lucide React)

| Component | Icon | Size | Usage |
|-----------|------|------|-------|
| Search | `Search` | 16px | Search bar (left) |
| Clear | `X` | 16px | Search bar (right, conditional) |
| External Link | `ExternalLink` | 12px | Crate external links |
| Home | `Home` | 12px | Home page in page list |
| Pin | `Pin` | 12px | Pin button for preview pages |
| Unpin | `PinOff` | 12px | Unpin button for pinned pages |
| Menu | `MoreVertical` | 16px | Crate/group actions menu |
| Expand | `ChevronDown` | 16px | Group/crate expanded state |
| Collapse | `ChevronRight` | 16px | Group/crate collapsed state |
| Expand All | `ChevronsDown` | 12px | Expand all items in group |
| Collapse All | `ChevronsUp` | 12px | Collapse all items in group |
| Move Up | `ChevronUp` | 12px | Move group up |
| Move Down | `ChevronDown` | 12px | Move group down |
| Rename | `Pencil` | 12px | Rename group |
| Add | `Plus` | 16px | Add group button |
| Confirm | `Check` | 12px | Confirm rename/add |
| Delete | `Trash2` | 16px | Delete group/crate |
| Package | `Package` | 16px | Crate icon |

---

## Change History

Brief timeline of significant changes (design decisions are documented in component specs above):

- **2026-01**: Initial Phase 5 implementation - Explorer architecture with callback-based data flow
- **2026-01**: `currentPage` moved from per-crate to global `Workspace` level
- **2026-01**: Refactored crate components into `crate/` subdirectory
- **2026-01**: Added symbol parsing with One Dark color coding
- **2026-01**: `workspace.currentPage` changed from URL string to `Page` tagged union
- **2026-01**: Group editing features - add/rename/delete groups, move up/down, expand/collapse all
  - `ExplorerGroupMenu.tsx`: Dropdown menu for group actions (move up/down, remove with confirmation)
  - `CreateGroupComponent`: Inline input for creating new groups
  - `ExplorerGroupActions`: Children-based slot pattern for header actions (`ReactElement` typed)
  - `CratePageItem`: Simplified hover state using Tailwind `group/page` pattern (removed `useState`)
- **2026-01**: Refactored explorer group components
  - Extracted `ExplorerGroupHeader.tsx`: Manages rename state, renders header with menu
  - Created `components/misc.tsx`: Shared components (`ExplorerGroupHeaderCommon`, `ExplorerGroupActions`, `CreateGroupComponent`)
  - Added `ExplorerItemList`: Shared item list renderer for groups
  - `ExplorerGroupMenu`: Added "Expand all" / "Collapse all" menu items, removed toggle button from header

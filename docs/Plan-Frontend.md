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
[✓] frontend/explorer/index.tsx                 Explorer, groups, items
[✓] frontend/explorer/common.d.ts               ExplorerItemProps<T> interface
[✓] frontend/explorer/crate/CrateCard.tsx       Collapsible crate card with header
[✓] frontend/explorer/crate/CratePageList.tsx   Page list + CratePageItem
[ ] frontend/explorer/search-bar.tsx            Search input
[ ] frontend/explorer/search-results.tsx        Search dropdown
[✓] frontend/explorer/crate/CrateVersionSelector.tsx  Version selector
[✓] frontend/explorer/crate/CrateMenu.tsx       Crate actions menu
```

### Component Specifications

#### **Explorer Component** (`frontend/explorer/index.tsx`)

**Purpose:** Main container for sidebar

**Props:** None (uses AppContext)

**Responsibilities:**
- Manages search state (query, results, isSearching)
- Renders SearchBar component
- Conditionally renders SearchResults (when query is not empty)
- Renders GroupList component
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
  <GroupList />
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

#### **GroupList Component** (`frontend/explorer/group-list.tsx`)

**Purpose:** Container for all groups

**Props:** None (uses AppContext)

**Responsibilities:**
- Renders "Not Yet Grouped" section (if ungrouped.length > 0)
- Renders all named groups

**Layout:**
```tsx
<div className="flex flex-col gap-2 flex-1 overflow-y-auto">
  {workspace.ungrouped.length > 0 && (
    <div className="mb-2">
      <div className="text-sm text-muted-foreground mb-2">Not Yet Grouped</div>
      {workspace.ungrouped.map(crate => (
        <CrateCard key={crate.name} crate={crate} groupIndex={-1} />
      ))}
    </div>
  )}
  {workspace.groups.map((group, index) => (
    <Group key={group.name} group={group} groupIndex={index} />
  ))}
</div>
```

---

#### **Group Component** (`frontend/explorer/group.tsx`)

**Purpose:** Collapsible group with header

**Props:**
```typescript
interface GroupProps {
  group: Group;
  groupIndex: number;
}
```

**Features:**
- Collapsible (using Radix Collapsible)
- Editable group name (inline input on click)
- Delete button (with confirmation)
- Expand/collapse icon (ChevronDown/ChevronRight)

**Layout:**
```tsx
<Collapsible open={!group.isCollapsed} onOpenChange={handleToggle}>
  <CollapsibleTrigger className="w-full">
    <div className="flex items-center gap-2 p-2 hover:bg-accent rounded">
      <ChevronRight className={cn("h-4 w-4 transition", !group.isCollapsed && "rotate-90")} />
      {isEditing ? (
        <Input
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      ) : (
        <span onClick={handleStartEdit}>{group.name}</span>
      )}
      <Trash2 onClick={handleDelete} className="h-4 w-4 ml-auto opacity-0 group-hover:opacity-100" />
    </div>
  </CollapsibleTrigger>
  <CollapsibleContent>
    {group.crates.map(crate => (
      <CrateCard key={crate.name} crate={crate} groupIndex={groupIndex} />
    ))}
  </CollapsibleContent>
</Collapsible>
```

**Actions to Implement:**
- `appContext.renameGroup(groupIndex: number, newName: string)` - Rename group
- `appContext.removeGroup(groupIndex: number)` - Delete group
- `appContext.toggleGroupCollapse(groupIndex: number)` - Toggle collapse state

**Icons:** `ChevronRight`, `Trash2` (lucide-react)

---

#### **CrateCard Component** (`frontend/explorer/crate/CrateCard.tsx`)

**Status:** ✅ Implemented

**Purpose:** Card displaying crate info and pages

**Props:** Uses `ExplorerItemProps<ItemCrate>` from common.d.ts

**Features:**
- Collapsible page list (Radix Collapsible)
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

#### **PageList Component** (`frontend/explorer/page-list.tsx`)

**Purpose:** List of documentation pages

**Props:**
```typescript
interface PageListProps {
  crate: ItemCrate;
}
```

**Features:**
- Home page (always present)
- Preview page (italic, with pin icon)
- Pinned pages (with unpin icon)
- Active page highlighted
- Click navigates to page

**Layout:**
```tsx
<div className="ml-6 mt-2 flex flex-col gap-1">
  <div
    onClick={() => handleNavigate('home')}
    className={cn("flex items-center gap-2 p-1 cursor-pointer hover:bg-accent rounded",
                  crate.currentPage === 'home' && "bg-accent")}
  >
    <Home className="h-3 w-3" />
    <span>Home</span>
  </div>
  {crate.pinnedPages.map(page => (
    <div
      key={page.path}
      onClick={() => handleNavigate(page.path)}
      className={cn(
        "flex items-center gap-2 p-1 cursor-pointer hover:bg-accent rounded",
        crate.currentPage === page.path && "bg-accent",
        !page.pinned && "italic"
      )}
    >
      <span className="flex-1">{page.title || page.path}</span>
      {page.pinned ? (
        <PinOff onClick={(e) => handleUnpin(e, page.path)} className="h-3 w-3" />
      ) : (
        <Pin onClick={(e) => handlePin(e, page.path)} className="h-3 w-3" />
      )}
    </div>
  ))}
</div>
```

**Actions to Implement:**
- `appContext.setOpenPage(crateName: string, pagePath: string)` - Navigate to page
- `appContext.pinPage(crateName: string, pagePath: string)` - Pin page
- `appContext.unpinPage(crateName: string, pagePath: string)` - Unpin page

**Icons:** `Home`, `Pin`, `PinOff` (lucide-react)

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
| Menu | `MoreVertical` | 16px | Crate actions menu |
| Expand | `ChevronDown` | 16px | Group/crate expanded state |
| Collapse | `ChevronRight` | 16px | Group/crate collapsed state |
| Add | `Plus` | 16px | Add group button |
| Delete | `Trash2` | 16px | Delete group/crate |
| Package | `Package` | 16px | Crate icon |

---

## Notes & Deviations

**Pre-Phase 5 Refactoring:**
- **2025-01**: Refactored `context.ts` to use `ReadonlyDeep<T>` from type-fest for type-level immutability
- **2025-01**: Refactored `ipc.ts` to use singleton pattern with `IPC.getInstance()` for cleaner initialization

**Phase 5 Implementation Notes:**

**Explorer Architecture (2025-01):**
- **Callback-based data flow**: Updates flow through typed callbacks (`updateItems`, `updateItem`, `setExpanded`, `removeItem`) instead of components calling `appContext` directly
- **`ExplorerItemProps<T>` interface** (`common.d.ts`): Generic props for item components with standard CRUD callbacks
- **Component hierarchy**: `Explorer` → `ExplorerUngrouped`/`ExplorerGroup` → `ExplorerItem` → `CrateCard`
- **Tagged union downcasting**: `ExplorerItem` uses `as any` cast when forwarding `updateItem` callback from `Item` to `ItemCrate` - pragmatic tradeoff since type safety is enforced by the switch statement

**CrateCard + PageList (2025-01, refactored 2026-01):**
- **File structure**: Split into `crate/CrateCard.tsx` and `crate/CratePageList.tsx` (moved from `items/crate.tsx`)
- Collapsible card using Radix Collapsible (removed shadcn Card wrapper for simpler styling)
- External links use `app.navigateTo()` which triggers iframe navigation - Rust host intercepts and opens non-docs.rs URLs in system browser
- `crateCache` fetched synchronously via `getCrateCache()` (triggers async refetch in background)
- **Auto-version sync**: When user navigates to different version in iframe, `currentVersion` updates automatically
- **Preview page**: Derived from `workspace.currentPage` URL - if it belongs to crate and not in `pinnedPages`, shown in italic
- **Pin icons**: Single `Pin` icon - outline for preview (hover-to-show), filled for pinned
- **CratePageItem**: Inline component in `CratePageList.tsx` handling individual page rendering with hover state

**Symbol Parsing & Color Coding (2026-01):**
- **`CrateSymbol` interface**: `{ module: string[], symbol: string, type: SymbolType }`
- **`SymbolType`**: `'module' | 'struct' | 'enum' | 'fn' | 'trait' | 'macro' | 'type' | 'constant' | 'unknown'`
- **`parseSymbol(path)`**: Converts docs.rs paths to structured symbol info:
  - `glam/f32/struct.Vec2.html` → `{ module: ["glam", "f32"], symbol: "Vec2", type: "struct" }`
  - `tokio/runtime/` → `{ module: ["tokio"], symbol: "runtime", type: "module" }`
- **One Dark color coding** (CSS variables in `global.css`):
  - Yellow (`--color-yellow`): struct, enum, type
  - Cyan (`--color-cyan`): trait
  - Blue (`--color-blue`): fn
  - Orange (`--color-orange`): macro, constant
  - Default: module, unknown
- **Rendering**: Module path in default color, symbol name colored by type

**CrateVersionSelector (2026-01):**
- **File**: `crate/CrateVersionSelector.tsx`
- **Props**: `{ crate, crateCache, setVersion(version) }` - callback-based version update
- **Version list**: "latest" + first non-yanked version from top 5 groups + current version
- **"latest" behavior**: Stores literal string "latest" (docs.rs supports `/crate/latest/` URLs)
- **Yanked handling**: Skips yanked versions in display list (uses `group.versions[0]` with yanked check)
- **"..." placeholder**: Disabled item at bottom for future full version list popup
- **Navigation**: CrateCard passes `setVersion` that navigates to new version URL if currently viewing crate docs

**CrateMenu (2026-01):**
- **File**: `crate/CrateMenu.tsx`
- **Position**: Menu button ("...") on same line as crate name and version selector
- **Menu items** (top to bottom):
  1. Repository link (if available)
  2. Homepage link (if available)
  3. (separator)
  4. Move to group (submenu with Ungrouped + named groups)
  5. Refresh metadata
  6. (separator)
  7. Remove crate (destructive)
- **CrateLink helper**: Moved from CrateCard - handles external link navigation via `app.navigateTo()`
- **Move logic**: Creates new Item, adds to target, then removes from source via callback
- **Refresh**: Uses `app.refreshCrateCache(name)` - deletes cache entry to force refetch
- **AppContext addition**: `refreshCrateCache(crateName)` method added

**CrateCard Layout (2026-01 refactor):**
- **Header row**: `[crate name] [version selector] [menu button]` - all on one line
- **External links**: Moved from header row into CrateMenu dropdown
- **Version change**: CrateCard handles navigation - if viewing current crate, navigates to new version URL

**Data Model Changes (2025-01):**
- `currentPage` moved from `ItemCrate` to `Workspace` level (global current page as full URL)
- `ItemCrate.pinnedPages` simplified to `string[]` (just paths, no separate `CratePage` interface)
- IPC `navigated` event listener in AppContext updates `workspace.currentPage` automatically

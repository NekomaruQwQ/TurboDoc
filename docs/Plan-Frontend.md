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
│  │ _struct.Runtime_ 📌    │   │  ← Half-open page (italic)
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
  - Half-open page shown in italic with pin button
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
Component Path                              Status  Notes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ ] frontend/explorer/index.tsx             Explorer container
[ ] frontend/explorer/search-bar.tsx        Search input
[ ] frontend/explorer/search-results.tsx    Search dropdown
[ ] frontend/explorer/group-list.tsx        Group container
[ ] frontend/explorer/group.tsx             Group component
[ ] frontend/explorer/crate-card.tsx        Crate card
[ ] frontend/explorer/version-combobox.tsx  Version selector
[ ] frontend/explorer/crate-menu.tsx        Crate actions menu
[ ] frontend/explorer/page-list.tsx         Page tree
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

#### **CrateCard Component** (`frontend/explorer/crate-card.tsx`)

**Purpose:** Card displaying crate info and pages

**Props:**
```typescript
interface CrateCardProps {
  crate: ItemCrate;
  groupIndex: number; // -1 for ungrouped
}
```

**Features:**
- Collapsible page list
- Clickable crate name (navigates to home)
- External links (crates.io, repo)
- Version combobox
- "..." menu (move, remove, refresh)

**Layout:**
```tsx
<Card className="p-3">
  <div className="flex items-center gap-2">
    <Package className="h-4 w-4" />
    <span className="font-semibold cursor-pointer" onClick={handleGoHome}>
      {crate.name}
    </span>
    {crateInfo?.links.repository && (
      <ExternalLink onClick={() => window.open(crateInfo.links.repository)} className="h-3 w-3" />
    )}
    <VersionCombobox crate={crate} crateInfo={crateInfo} />
    <CrateMenu crate={crate} groupIndex={groupIndex} />
  </div>
  <Collapsible open={!crate.isCollapsed} onOpenChange={handleToggle}>
    <CollapsibleContent>
      <PageList crate={crate} />
    </CollapsibleContent>
  </Collapsible>
</Card>
```

**State:**
- Fetch `crateInfo` via `appContext.getCrateInfo(crate.name)` on mount

**Actions to Implement:**
- `appContext.toggleCrateCollapse(crateName: string)` - Toggle page list
- `appContext.navigateTo(url: string)` - Navigate to home page

**Icons:** `Package`, `ExternalLink` (lucide-react)

---

#### **VersionCombobox Component** (`frontend/explorer/version-combobox.tsx`)

**Purpose:** Version selector dropdown

**Props:**
```typescript
interface VersionComboboxProps {
  crate: ItemCrate;
  crateInfo: CrateInfo | undefined;
}
```

**Features:**
- Uses Radix Select
- Shows version groups (max 5)
- Latest version with "(latest)" label
- Green indicator for latest in group
- Grey/dim for older versions

**Layout:**
```tsx
<Select value={crate.currentVersion} onValueChange={handleVersionChange}>
  <SelectTrigger className="w-32">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {crateInfo?.versionGroups.map(group => (
      <SelectItem key={group.latest} value={group.latest}>
        {group.latest} {group.latest === crateInfo.versions[0].num && "(latest)"}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Actions to Implement:**
- `appContext.updateCrateVersion(crateName: string, version: string)` - Change version

---

#### **CrateMenu Component** (`frontend/explorer/crate-menu.tsx`)

**Purpose:** Actions menu for crate

**Props:**
```typescript
interface CrateMenuProps {
  crate: ItemCrate;
  groupIndex: number;
}
```

**Features:**
- Dropdown from "..." button (Radix DropdownMenu)
- Move to group (submenu with group list)
- Remove crate (with confirmation)
- Refresh metadata (re-fetch from crates.io)

**Layout:**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger>
    <MoreVertical className="h-4 w-4" />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {workspace.groups.map((group, index) => (
          <DropdownMenuItem onClick={() => handleMove(index)}>
            {group.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuItem onClick={handleRefresh}>Refresh metadata</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={handleRemove} className="text-destructive">
      Remove crate
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Actions to Implement:**
- `appContext.moveCrate(crateName: string, toGroupIndex: number)` - Move crate
- `appContext.removeCrate(crateName: string)` - Remove crate
- `appContext.refreshCrateMetadata(crateName: string)` - Force refetch

**Icons:** `MoreVertical` (lucide-react)

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
- Half-open page (italic, with pin icon)
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
   - Update current page (half-open page logic)
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
- **Half-open page**:
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
- **Half-open pages**: Italic for emphasis
- **Muted text**: Reduced opacity or muted color

### Icon Reference (Lucide React)

| Component | Icon | Size | Usage |
|-----------|------|------|-------|
| Search | `Search` | 16px | Search bar (left) |
| Clear | `X` | 16px | Search bar (right, conditional) |
| External Link | `ExternalLink` | 12px | Crate external links |
| Home | `Home` | 12px | Home page in page list |
| Pin | `Pin` | 12px | Pin button for half-open pages |
| Unpin | `PinOff` | 12px | Unpin button for pinned pages |
| Menu | `MoreVertical` | 16px | Crate actions menu |
| Expand | `ChevronDown` | 16px | Group/crate expanded state |
| Collapse | `ChevronRight` | 16px | Group/crate collapsed state |
| Add | `Plus` | 16px | Add group button |
| Delete | `Trash2` | 16px | Delete group/crate |
| Package | `Package` | 16px | Crate icon |

---

## Notes & Deviations

_(Add notes here as you implement components)_

**Example:**
- **2024-01-15**: Changed SearchBar debounce from 300ms to 500ms for better UX
- **2024-01-16**: Added loading skeleton to CrateCard while fetching metadata

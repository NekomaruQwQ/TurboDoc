# TurboDoc Frontend Documentation

## Overview

TurboDoc is a documentation viewer for Rust crates with local caching and workspace management. The app displays docs.rs documentation in an iframe with a sidebar explorer for managing crates, versions, and pages.

**Key Features:**
- Search and add crates from crates.io
- Version selection with intelligent grouping
- Pin/unpin documentation pages (VS Code-style tabs)
- Named groups for organizing crates
- Workspace persistence across sessions
- Automatic cross-crate navigation
- Local caching with graceful degradation

---

## Requirements & Design Goals

### User Experience Goals

#### Primary Workflows
1. **Quick Reference**: Users quickly jump between documentation pages across multiple crates
2. **Learning**: Users explore API documentation while reading related types/modules
3. **Cross-referencing**: Users follow links between crates and keep relevant pages accessible

#### Interaction Patterns

**Search & Discovery:**
- Global search bar finds crates by name or description
- Search results appear as dropdown below search bar
- Clicking result adds crate to a selected group
- Automatic metadata fetch (description, links, versions) on add

**Navigation:**
- Clicking page in sidebar → loads in iframe
- Clicking link in iframe docs → auto-detects navigation via IPC (planned)
- Navigating to new page → appears as "preview" page (not pinned)
- Clicking pin icon → promotes preview page to pinned
- Only one preview page per crate (like VS Code tabs)

**Organization:**
- Menu-based move between groups (V1)
- Create named groups with "+ Add Group" button (at top or bottom)
- Rename groups by clicking pencil icon
- Expand/collapse groups with chevron toggle
- Delete groups with confirmation
- Crates within groups auto-sorted alphabetically by name
- Drag-and-drop to reorder (future enhancement)

**Version Management:**
- Version selector shows ~5 most relevant versions:
  - Latest version (always shown)
  - Latest from each major.minor series
  - Pre-release versions marked distinctly
  - Yanked versions shown with warning
- Changing version → reloads iframe with new version
- Current version persisted per-crate in workspace

### Feature Requirements

#### Must Have (V1)
- ✅ Search crates from crates.io
- ✅ Display crate metadata (description, links)
- ✅ Version selection with intelligent grouping
- ✅ Pin/unpin documentation pages
- ✅ Preview page system (VS Code-style)
- ✅ Symbol type color coding (One Dark theme)
- ✅ Named groups for organization
- ✅ Workspace persistence across sessions
- ✅ Automatic cross-crate navigation (IPC 'navigated' event)
- ⬜ Loading states and error handling
- ✅ Move crates between groups via menu

#### Should Have (Future)
- 🔲 Drag-and-drop reordering
- 🔲 Keyboard shortcuts (Cmd+K search, Cmd+P pages, etc.)
- 🔲 Page title extraction from HTML
- 🔲 Full-text search within cached docs
- 🔲 Toast notifications for actions
- ✅ Import crates from URLs (partial - import implemented, export pending)

#### Won't Have (Out of Scope)
- ❌ Multiple documentation sources (only docs.rs for now)
- ❌ Theme toggle (backend forces dark mode)
- ❌ Offline-first mode (cache is transparent)

### Performance Goals

- **Instant navigation**: Page changes feel immediate (<100ms perceived latency)
- **Smooth scrolling**: 60fps scrolling in explorer and iframe
- **Fast search**: Search results appear within 300ms of typing
- **Efficient rendering**: Large workspaces (50+ crates) remain responsive
- **Small bundle**: Frontend JS bundle <500KB gzipped

---

## Architecture Overview

### Core Principles

1. **Familiarity**: Borrows patterns from VS Code (tabs, sidebar, command palette)
2. **Efficiency**: Minimizes clicks to access frequently-used pages
3. **Clarity**: Always shows current state (active page, loading, errors)
4. **Forgiveness**: Auto-save, undo-friendly operations, confirmation for destructive actions
5. **Progressive disclosure**: Collapses details by default, expands on demand
6. **Performance**: Optimized for large workspaces (50+ crates)

### Technology Stack

- **Frontend**: React 18 + TypeScript
- **Type Utilities**: type-fest for `ReadonlyDeep` type-level immutability
- **State Management**: Immer for immutable updates
- **UI Components**: Radix UI primitives + shadcn/ui
- **Styling**: Tailwind CSS with OKLCH color space
- **Icons**: Font Awesome (switched from Lucide React for better icon variety)
- **Backend**: Tauri (Rust) with WebView2
- **IPC**: Custom message passing with singleton pattern and timeout handling

### Component Architecture

**Component Hierarchy:**
```
App (contains AppContext)
├── ResizablePanelGroup (horizontal)
│   ├── ResizablePanel (left - explorer)
│   │   └── Explorer
│   │       ├── SearchBar
│   │       ├── SearchResults (conditional overlay/dropdown)
│   │       ├── ExplorerCreateGroupComponent (insertAt="top")
│   │       ├── ExplorerGroup[] (for each named group)
│   │       │   ├── ExplorerGroupHeader (collapsible, editable name, menu)
│   │       │   └── CrateCard[] (for each crate in group, auto-sorted by name)
│   │       └── ExplorerCreateGroupComponent (insertAt="bottom")
│   ├── ResizableHandle
│   └── ResizablePanel (right - docs viewer)
│       └── iframe (docs.rs content, ref stored in context)
```

**CrateCard component structure:**
```
CrateCard
├── CrateHeader
│   ├── CrateIcon (Rust logo)
│   ├── CrateName (clickable → navigate to home)
│   ├── CrateLinks (ExternalLink icons for crates.io, repo, homepage)
│   ├── VersionCombobox (Radix Select with version groups)
│   └── CrateMenu ("..." → DropdownMenu for move/remove/refresh)
└── PageList (collapsible)
    ├── HomePage (Home icon, always present)
    ├── Page[] (pinnedPages, with pin/unpin icons)
    │   └── Italic styling if page.path === currentPage && !page.pinned
```

**Component Responsibilities:**

- **Explorer**: Main container for sidebar, manages search state and results
- **SearchBar**: Single input field with debounced search (300ms), clear button, loading state
- **SearchResults**: Dropdown/modal below search bar, click adds crate to a group
- **ExplorerCreateGroupComponent**: Button that transforms to inline input; `insertAt` prop controls placement ("top" or "bottom")
- **ExplorerGroup**: Collapsible group with editable name, auto-sorted items, menu for actions
- **ExplorerGroupHeader**: Header with chevron toggle, rename button, dropdown menu (expand/collapse all, import, move, remove)
- **CrateCard**: Card layout with header (name, version, menu) and collapsible page list
- **CrateVersionSelector**: Radix Select showing version groups (max 5), latest version marked
- **CrateMenu**: Radix DropdownMenu with external links, move/remove/refresh options (uses `CrateMenuItem` helper)
- **CratePageList**: Page list with home page, preview page (italic), and pinned pages; symbol color coding

### Visual Reference

**Target UI Layout:**
```
┌─────────────────────────────────┐
│ [Search crate and page...    ] │  ← Search bar
├─────────────────────────────────┤
│ [+ Add Group]                   │  ← Create group (top)
├─────────────────────────────────┤
│ ▼ My Project Dependencies      │  ← Named group (expanded)
│  ┌─────────────────────────┐   │
│  │ serde                   │   │  ← Crate card (auto-sorted)
│  │ [1.0.0 ▼]     [...]     │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ tokio                   │   │
│  │ [1.42.0 ▼]    [...]     │   │
│  │─────────────────────────│   │
│  │ tokio::runtime          │   │  ← Home/root module
│  │ tokio::runtime::Runtime │   │  ← Pinned page
│  │ _tokio::task_    📌     │   │  ← Preview page (italic)
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│ ▶ Utilities                    │  ← Named group (collapsed)
├─────────────────────────────────┤
│ [+ Add Group]                   │  ← Create group (bottom)
└─────────────────────────────────┘
```

**Crate Card Design:**
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

## Development Workflow

### Mandatory Implementation Rules

1. **Top-to-Down, Incremental Implementation**
   - Start from the top of the visual hierarchy (App → Explorer → SearchBar → Groups → CrateCard → PageList)
   - Implement one component at a time from parent to children
   - Do NOT skip ahead or implement multiple components in parallel
   - Complete each component fully (styling, interaction, error states) before moving to the next

2. **Immediate Visual Feedback with HMR**
   - Leverage Hot Module Replacement (HMR) for instant visual feedback
   - After implementing each component, verify visually in the browser
   - Test all interactive states (hover, click, expand, collapse, loading, error)
   - Iterate on the component until it's visually and functionally correct
   - Only move to the next component when current one is fully complete

3. **Update Plan Document After Each Component**
   - Mark completed components with ✅ in the plan document
   - Add notes about implementation decisions or deviations from plan
   - Document discovered issues or future improvements needed
   - Keep the plan as a living document that tracks progress

### Iteration Workflow Per Component

```
1. Read component spec from plan
2. Implement component/module structure (JSX, basic props, or core functions)
6. Add styling (Tailwind classes, for UI components)
8. Add interactions (onClick, onChange, etc.)
10. Add loading/error states
11. Check HMR → Verify edge cases
13. Mark component as ✅ in plan
14. Commit changes (optional)
15. Move to next component
```

---

## Visual Design System

### Colors
- Based on existing Tailwind theme in `global.css`
- OKLCH color space for perceptual uniformity
- Dark background with high-contrast text
- Accent color for active/selected states
- Muted colors for secondary information

### Typography
- Monospace font for consistency with code
- Clear hierarchy: group names > crate names > page links
- Italic for preview pages (emphasis without weight)

### Spacing
- Compact 8px grid for information density
- Comfortable 16px padding for panels
- Consistent 4px gaps between UI elements

### Icons (Font Awesome)
- Search: `faMagnifyingGlass`
- External link: `faArrowUpRightFromSquare`
- Home: `faHouse`
- Pin: `faThumbtack`
- Menu: `faEllipsisVertical`
- Collapse: `faChevronDown` / `faChevronRight`
- Add: `faPlus`
- Trash: `faTrash`
- Expand All: `faAnglesDown`
- Collapse All: `faAnglesUp`
- Move Up/Down: `faChevronUp` / `faChevronDown`
- Rename: `faPencil`
- Confirm: `faCheck`
- Package: `faBox`

---

## Completed Implementation (Phases 1-5)

### Phase 1: Data Model

**Status:** ✅ Complete. See <frontend/data.ts>.

#### Design Decisions

**1. Workspace/Cache Split**
- **Decision**: Split into workspace.json (user data) + cache.json (API data)
- **Rationale**:
  - Smaller workspace file (~90% reduction, better for version control)
  - Independent cache management (can clear without losing workspace)
  - Non-fatal cache failures (graceful degradation to empty cache)
  - Separate save timing (workspace: immediate, cache: on metadata fetch)
- **Trade-off**: More complex persistence (2 files vs 1), but benefits outweigh complexity

**2. Preview Page (Derived State)**
- **Decision**: Derive preview state from `workspace.currentPage` (global) and `crate.pinnedPages`
- **UX Concept**: Global currentPage URL, per-crate pinned pages (like VS Code preview tabs)
  - Preview pages appear in italic to indicate temporary status
  - Navigating to a new page updates global `currentPage`
  - Only one preview page per crate at a time (derived from URL matching)
- **Pinning Behavior**:
  - Clicking pin icon on preview page: adds path to `pinnedPages` (promotes to permanent)
  - Clicking unpin icon on pinned page: removes from `pinnedPages` (page disappears unless currently active)
- **Implementation**: Preview page is identified when `currentPage` belongs to crate but path is NOT in `pinnedPages`
  - `workspace.currentPage` is a `Page` tagged union (`PageCrate | PageUnknown`)
  - `PageCrate` contains `{ crateName, crateVersion, pathSegments }` for structured URL handling
  - `crate.pinnedPages` is `string[]` of relative paths (e.g., `["tokio/runtime/"]`)
  - IPC 'navigated' event parses URL via `parseUrl()` and updates `workspace.currentPage`
  - `buildUrl(page)` reconstructs the full URL when needed for navigation
- **Rationale**: Global currentPage simplifies state; preview state derived from URL + pin status
- **Trade-off**: Slightly more computation on render (negligible, worth the simplification)

**3. Collapsible Groups**
- **Decision**: Groups have `expanded: boolean` state for collapse/expand
- **Rationale**: Users can hide groups they're not actively using, reducing visual clutter
- **Implementation**: Chevron in group header toggles state; collapsed groups show only header

**4. Auto-Sorted Group Items**
- **Decision**: Items within groups are automatically sorted alphabetically by `name`
- **Rationale**: Consistent ordering makes it easy to find crates; no manual reordering needed
- **Implementation**: Sort applied in `updateItems()` callback after any modification

**5. Single-Level Expandability**
- **Decision**: Only crate cards are expandable/collapsible (removed nested page list collapse)
- **Rationale**: Expander-inside-expander is confusing UX
- **Simplification**: Page list always visible when crate card is expanded

#### Implementation Summary

- **Workspace/Cache Split**: Clean separation of user data vs API data in separate files (~90% size reduction for workspace)
- **Derived Preview State**: No duplication, derive from pinnedPages + currentPage
- **Collapsible Groups**: Groups have expand/collapse state with chevron toggle
- **Auto-Sorted Items**: Items within groups sorted alphabetically by name
- **DocsPage Interface**: Proper structure for page data with pin state and metadata
- **Single-Level Expandability**: Only crate cards expand/collapse (no nested expanders)

---

### Phase 2: API Integration

**Status:** ✅ Complete

**Files:**
- `frontend/services/crates-api.ts` - API client with rate limiting
- `frontend/utils/version-group.ts` - Version grouping logic

#### Crates.io API Client

**Features:**
- Rate limiting (1-second delay between requests)
- Automatic retry on 429 (rate limit)
- Proper User-Agent header for crawler policy
- Error handling (404, network errors, timeouts)
- Search functionality

**Functions:**
- `searchCrates(query: string)` - Search crates by name/description
- `fetchCrateInfo(crateName: string)` - Fetch metadata and versions
- `fetchCrateVersions(crateName: string)` - Fetch version list only

#### Version Grouping Algorithm

**Logic:**
- Groups versions by semver compatibility.
- Shows latest + 4 unique major.minor groups, folding others in sub-menus
- Handles pre-release versions (alpha, beta, rc)
- Marks yanked versions
- Uses `semver` package for correct parsing and sorting

**Example:**
```
1.42.0 (latest) ← Latest stable
1.41.3          ← Latest in 1.41.x
1.40.0          ← Latest in 1.40.x
1.0.0           ← First stable
0.9.5           ← Latest pre-1.0
```

#### Design Decisions

**1. Rate Limiting**
- **Decision**: Enforce 1-second delay between crates.io API requests
- **Rationale**: Follows crates.io crawler policy, prevents rate limiting errors
- **Trade-off**: Slower when adding many crates rapidly (necessary for API compliance)

**2. Metadata Caching**
- **Decision**: Cache crate metadata for 24 hours in cache.json
- **Rationale**: Reduces API calls, improves startup performance, metadata rarely changes
- **Trade-off**: Stale data possible (acceptable, can manually refresh via menu)

**3. Minimal API Response**
- **Decision**: Fetch only essential data (links, versions) from crates.io
- **Rationale**: Without full type definitions, keep response structure simple
- **What we fetch**: repository, homepage, documentation URLs + version list with yanked status
- **What we don't fetch**: description, license, download counts

**4. Version Grouping Algorithm**
- **Decision**: Show latest + 4 unique major.minor versions, handle pre-release and yanked
- **Semver Compatibility Theory**: According to semver, version A is a superset of version B if A > B and A is compatible with B
  - Within a major.minor series (e.g., 1.2.x), later patches are supersets of earlier ones
  - We only care about the latest version in each major.minor group since it contains all fixes from earlier patches
  - Example: 1.2.5 is compatible with and supersedes 1.2.0, 1.2.1, 1.2.2, 1.2.3, 1.2.4
- **Structure**: `versionGroups: { latest: string, versions: CrateVersion[] }[]`
  - Each group contains the latest version string and all versions in that major.minor series
  - Groups are sorted newest to oldest
  - Maximum 5 groups displayed (latest + 4 historical major.minor series)
- **Display**: Shows ~5 most recent semver-compatible groups in version selector dropdown
- **Rationale**: Matches crates.io UX, covers 99% of use cases, handles edge cases correctly
- **Trade-off**: Users can't select older patch versions directly (acceptable for docs viewer)
- **Implementation**: Uses `semver` package for correct parsing and sorting, handles pre-release versions (alpha, beta, rc), marks yanked versions

**5. Search Implementation**
- **Decision**: Use crates.io search API (`/api/v1/crates?q=...`)
- **Rationale**: Well-documented, supports both crate name and description search
- **Trade-off**: No docs.rs-specific search (acceptable, crates.io is canonical)
- **Verification**: ✅ CORS works in WebView2 environment

**6. Graceful Degradation**
- **Decision**: Handle metadata fetch failures gracefully
- **Implementation**: Return stale cache on fetch failure, show crate with limited info rather than error
- **Rationale**: Better UX - partial information is better than nothing

#### Testing

**Unit Tests:**
- `frontend/utils/version-group.test.ts` - Version grouping logic
  - Happy path scenarios
  - Edge cases (pre-release, yanked, single version)
  - Real-world examples (tokio, serde)

**Integration Tests:**
- `frontend/services/crates-api.integration.test.ts` - API client
  - Rate limiting enforcement
  - Error handling (404, network errors)
  - Real API calls (serde, tokio)

#### Implementation Summary

- **Rate Limiting**: 1s delay between requests (crates.io crawler policy compliance)
- **Retry Logic**: Automatic retry on 429 (rate limit) responses
- **Proper User-Agent**: Browser-like User-Agent header for API compliance
- **Metadata Caching**: 24h TTL in cache.json (reduces API calls)
- **Minimal API Response**: Fetch only essential data (links, versions)
- **Version Grouping**: Latest + 4 unique major.minor groups, handles pre-release/yanked
- **Search API**: Uses crates.io `/api/v1/crates?q=...` (CORS verified)
- **Graceful Degradation**: Stale cache on fetch failure, partial info over errors

---

### Phase 3: IPC Integration

**Status:** ✅ Complete

**Files:**
- `frontend/ipc.ts` - IPC message passing with timeout
- `frontend/constants.ts` - Timeout and rate limit constants
- `src/app.rs` - Backend IPC handlers

#### Type System

**Message Types:**
- `IPCEvent` - Events from host (e.g., `navigated`)
- `IPCRequest` - Requests to host (load/save workspace/cache)
- `IPCResponse` - Responses from host (discriminated union by success)

**Type-Safe Response Variants:** `IPCResponseVariants` map enables compile-time checking of response shapes per message type. `getResponseAsync<T>()` returns properly typed responses.

#### IPC Class API

**Singleton Pattern:**
- `IPC.getInstance()` - Lazy-initialized singleton, registers WebView2 listener once
- Separates event handlers (multiple per type) from response handlers (single pending per type)

**Methods:**
- `on(type, handler)` - Register event handler, returns cleanup function for useEffect
- `getResponseAsync<T>(type, timeoutMs?)` - Wait for response with timeout (default: 5s)

#### Exported Functions

| Function | Returns | On Error |
|----------|---------|----------|
| `loadWorkspace()` | `Promise<unknown>` | Throws |
| `saveWorkspace(workspace)` | `Promise<void>` | Throws |
| `loadCache()` | `Promise<unknown>` | Returns `null` (non-fatal) |
| `saveCache(cache)` | `Promise<void>` | Logs error (non-fatal) |

**Note:** Load functions return `unknown` since no runtime validation is performed.

#### Design Decisions

**1. Timeout Handling**
- **Decision**: Add 5-second timeout to all IPC requests via `getResponseAsync()`
- **Rationale**: Prevents infinite hangs if backend crashes or IPC fails
- **Trade-off**: False positives if backend is slow (unlikely, 5s is generous)

**2. Separate Load/Save Handlers**
- **Decision**: Separate IPC handlers for workspace and cache
- **Rationale**: Independent persistence strategies (workspace: immediate, cache: on-fetch)
- **Benefit**: Cache failures don't affect workspace operations

**3. Non-Fatal Cache Operations**
- **Decision**: Cache load returns `null`, cache save logs but doesn't throw
- **Rationale**: App can function without cache; stale/missing cache is acceptable
- **Benefit**: Graceful degradation when cache is corrupted or missing

**4. Unvalidated Return Types**
- **Decision**: Load functions return `unknown` instead of typed objects
- **Rationale**: IPC layer doesn't perform schema validation; caller is responsible
- **Benefit**: Honest typing, validation logic stays in context layer

#### Implementation Summary

- **Singleton IPC**: Lazy-initialized `IPC.getInstance()` ensures single message listener
- **Type-Safe Responses**: `IPCResponseVariants` map enables compile-time checking
- **Event Subscription**: `on()` returns cleanup function (idiomatic React pattern)
- **IPC Timeout**: 5s timeout prevents hangs
- **Non-Fatal Cache**: Cache errors logged but don't crash app
- **Unvalidated Returns**: Load functions return `unknown` for honest typing

---

### Phase 4: State Management

**Status:** ✅ Core Complete (workspace actions deferred to Phase 5)

**Files:**
- `frontend/context.ts` - AppContext class definition
- `frontend/app.tsx` - useAppContext hook and App component

See <frontend/context.ts>.

#### State Snapshot Pattern

**How it works:**
1. User action triggers `appContext.updateWorkspace()` or similar method
2. Method calls `setWorkspace()` → React state updates
3. React re-renders App component
4. **NEW AppContext instance** created with updated state snapshots
5. Context consumers re-render with fresh AppContext

**Key insight:** Each AppContext instance is an **immutable snapshot** of app state at render time. Methods are called synchronously during event handlers, so they always read the correct current state. React's batching ensures consistency.

**Type-Level Immutability:**
- State types use `ReadonlyDeep<T>` from type-fest to enforce immutability at the type level
- Combined with Immer's `produce`, this creates a robust immutable update pattern
- Prevents accidental mutations at compile time while allowing ergonomic nested updates

**Validation:**
- ✅ No stale closure bugs (each render gets fresh snapshot)
- ✅ Mutations trigger re-renders correctly (setWorkspace/setCache)
- ✅ No infinite loops (empty useEffect deps run once on mount)
- ✅ Works with React 18 concurrent features (state updates batched properly)

#### Design Decisions

**1. Class-Based Context**
- **Decision**: AppContext is a class, not a plain object with methods
- **Rationale**: Encapsulation, cleaner method organization, hides React state management details
- **Trade-off**: Less conventional than plain objects, but better separation of concerns

**2. No Memoization**
- **Decision**: AppContext is recreated on every render (no useMemo)
- **Rationale**: AppContext holds ALL app-level state, so App only re-renders when that state changes (which is when we want context consumers to re-render)
- **Trade-off**: New instance per render, but no performance issue since App only has this state
- **Key insight**: If we later add other state to App, we'd need memoization; for now, unnecessary
- **Confirmed**: State snapshot pattern works correctly - no stale closures, methods read current state

**3. Private updateCache**
- **Decision**: `updateCache()` is private, only `getCrateInfo()` can mutate cache
- **Rationale**: Ensures cache saves are exclusively triggered by API fetches, which are naturally rate-limited (1s by crates.io API)
- **Trade-off**: Less flexible, but prevents accidental cache saves

**4. Graceful Degradation**
- **Decision**: `getCrateInfo()` returns stale cache if refetch fails, `undefined` only if no cache exists
- **Rationale**: Stale metadata is better than no metadata (versions rarely change drastically)
- **Trade-off**: Users might see outdated info, but acceptable (can manually refresh via menu)

**5. iframe Ref in AppContext**
- **Decision**: AppContext owns the iframe ref, not App component
- **Rationale**: Centralized navigation logic, methods can directly manipulate iframe
- **Trade-off**: Ref is recreated on each render, but React handles `.current` correctly

**6. Single useEffect for Loading**
- **Decision**: Empty dependency array `[]` in useEffect despite ESLint warning
- **Rationale**: We want `load()` to run exactly once per page load (on mount)
- **Validation**: Adding `appContext` to deps would cause infinite loop (AppContext recreated each render)
- **Confirmed**: Works correctly - runs once on mount in production, twice in dev (React 18 Strict Mode)

**7. Deferred Workspace Actions**
- **Decision**: Workspace mutation methods (addCrate, removeCrate, pinPage, etc.) NOT implemented yet
- **Rationale**: Implement alongside UI components for immediate testing via HMR
- **Plan**: Add methods incrementally as each UI component needs them

**8. Deferred IPC Navigation Handler**
- **Decision**: IPC 'navigated' event handling NOT implemented yet
- **Rationale**: Requires page list UI to be functional for visual verification
- **Plan**: Implement when building Explorer page tree component

**9. Remove NavigationContext**
- **Decision**: No separate NavigationContext, manage iframe in AppContext
- **Rationale**: Avoids redundant state and sync issues, simpler architecture
- **Trade-off**: AppContext is slightly larger (acceptable, still cohesive)
- **Confirmed**: Implemented - `viewerRef` and `navigateTo()` are part of AppContext

**10. Navigation: Auto-Add Crates (Planned)**
- **Decision**: Auto-add crates to a default group when navigating to unknown crate
- **Rationale**: Seamless cross-crate navigation, discoverability
- **Trade-off**: Workspace can grow large (acceptable, user can remove)
- **Status**: Not yet implemented - requires IPC 'navigated' event handler (see decision 8)

#### Save Strategy

- **Workspace**: Saves immediately on every change via `updateWorkspace()` (no debouncing)
  - Workspace is small (~1KB), saves are fast, ensures data safety
- **Cache**: Saves only when `getCrateInfo()` fetches from API (auto-rate-limited to 1s)
  - Cache updates are infrequent and naturally rate-limited by API calls

#### Implementation Summary

- **Class-Based AppContext**: Better encapsulation, cleaner API than plain objects
- **State Snapshot Pattern**: Recreate AppContext per render for correct state access
- **ReadonlyDeep Types**: type-fest `ReadonlyDeep<T>` enforces immutability at type level
- **No Memoization**: AppContext holds all state, recreated per render (no perf issue)
- **Immer for Mutations**: Simplifies deeply nested updates, prevents bugs (~13KB bundle cost)
- **Dual State Management**: Workspace + cache with separate save strategies
- **Private updateCache**: Enforces cache saves only via getCrateInfo (naturally rate-limited)
- **Graceful Degradation**: getCrateInfo returns stale cache on fetch failure
- **No NavigationContext**: Navigation managed in AppContext (simpler, avoids sync issues)
- **Deferred Actions**: Workspace mutations implemented alongside UI (immediate testing via HMR)
- **Name-Based Actions**: Cleaner API than index-based (more robust on reorder)
- **Immediate Workspace Saves**: No debouncing (file is small ~1KB, ensures data safety)
- **Cache Saves on Fetch**: Auto-rate-limited by API (only on metadata fetch, ~1s intervals)
- **iframe Ref in Context**: Centralized navigation logic
- **Auto-Add Crates**: Planned for seamless cross-crate navigation (deferred)

---

### Phase 5: UI Components

**Status:** ✅ Core Complete (SearchBar and SearchResults remaining)

**Files:**
- `frontend/explorer/index.tsx` - Explorer, ExplorerGroup, ExplorerItem
- `frontend/explorer/ExplorerItemProps.ts` - Generic props interface for item components
- `frontend/explorer/ExplorerGroupHeader.tsx` - Group header with rename, collapse toggle, and inline menu
- `frontend/explorer/ExplorerCreateGroupComponent.tsx` - Add group button/input with `insertAt` prop
- `frontend/explorer/crate/CrateCard.tsx` - Collapsible crate card with header
- `frontend/explorer/crate/CratePageList.tsx` - Page list with symbol parsing + CratePageItem
- `frontend/explorer/crate/CrateVersionSelector.tsx` - Version selector dropdown
- `frontend/explorer/crate/CrateMenu.tsx` - Crate actions menu (links, move, refresh, remove) with CrateMenuItem helper

#### Explorer Component (`frontend/explorer/index.tsx`)

**Status:** ✅ Implemented

**Purpose:** Main container for sidebar

**Props:** None (uses AppContext)

**Search Implementation:**
- Uses `searchCrates(query)` from `@/services/crates-api`
- API endpoint: `https://crates.io/api/v1/crates?q={query}`
- Returns: `{ name: string, description: string | null }[]`
- Rate limited: 1-second delay between requests (handled by API module)
- Debounced: 300ms delay before triggering search

#### Explorer Architecture

**Callback-Based Data Flow:**
- Updates flow through typed callbacks (`updateItems`, `updateItem`, `setExpanded`, `removeItem`) instead of components calling `appContext` directly
- **Rationale**: Decouples components from global state, enables reuse and testing
- **Trade-off**: More boilerplate passing callbacks, but better separation of concerns

**`ExplorerItemProps<T>` Interface:** Generic props for item components with standard CRUD callbacks (`updateItem`, `setExpanded`, `removeItem`). See `ExplorerItemProps.ts`.

**Component Hierarchy:**
- `Explorer` → `ExplorerCreateGroupComponent` + `ExplorerGroup[]` → `ExplorerItem[]` → `CrateCard`
- **ExplorerGroup**: Renders group header and item list; items are auto-sorted by name
- **ExplorerItem**: Renders `Item` tagged union - switches on `item.type` to render appropriate component

**Tagged Union Downcasting:**
- `ExplorerItem` uses `as any` cast when forwarding `updateItem` callback from `Item` to `ItemCrate`
- **Rationale**: Pragmatic tradeoff since type safety is enforced by the switch statement
- **Trade-off**: Cast is safe because switch guarantees correct type, but loses compile-time checking

---

#### SearchBar Component (`frontend/explorer/search-bar.tsx`)

**Status:** ⬜ Not yet implemented

**Purpose:** Search input field

**Features:**
- Debounced search (300ms)
- Clear button (appears when value is not empty)
- Loading spinner (when isSearching)
- Escape key clears input
- Enter key triggers search

**Icons:** `faMagnifyingGlass`, `faXmark` (Font Awesome)

---

#### SearchResults Component (`frontend/explorer/search-results.tsx`)

**Status:** ⬜ Not yet implemented

**Purpose:** Dropdown showing search results

**Features:**
- Scrollable list (max height)
- Hover states
- Click adds crate to a selected group
- Empty state ("No results found")

**Actions to Implement:**
- `appContext.addCrate(crateName: string, groupIndex: number)` - Add crate to specified group

**Design Decision: Include Descriptions**
- **Decision**: Search returns `{ name: string, description: string | null }[]`
- **Rationale**: Users need context when choosing from search results
- **Implementation**: Display description below crate name in search dropdown
- **Null handling**: Gracefully handle crates without descriptions (don't render description line)
- **Confirmed**: API implementation in `crates-api.ts` returns this structure

---

#### Design Decisions

**1. Inline vs Extracted Components**
- **Decision**: Small, tightly-coupled components stay inline in `index.tsx`; reusable components extracted to separate files
- **Inline**: `ExplorerGroup`, `ExplorerItem`
- **Extracted**: `ExplorerGroupHeader`, `ExplorerCreateGroupComponent`
- **Rationale**: Reduces file count for simple components, extracts when reuse or complexity warrants

**2. Group Header with Inline Menu**
- **Decision**: `ExplorerGroupHeader` contains all group actions inline (rename, menu with expand/collapse all, import, move, delete)
- **Rationale**: Single component handles all group header interactions; simpler than separate menu component
- **Implementation**: Dropdown menu triggered by ellipsis button, dialogs for destructive actions

**3. Rename State Management**
- **Decision**: Rename state (`isRenaming`, `editedName`) lives in `ExplorerGroupHeader`, not parent
- **Rationale**: Encapsulation - parent doesn't need to know about rename UI state
- **Trade-off**: Slightly more complex header component, but cleaner parent

**4. Create Group with insertAt**
- **Decision**: `ExplorerCreateGroupComponent` has `insertAt` prop ("top" or "bottom")
- **Rationale**: Users can add groups at beginning or end of list
- **Implementation**: Two instances rendered by Explorer, one at top and one at bottom

---

#### CrateCard Component (`frontend/explorer/crate/CrateCard.tsx`)

**Status:** ✅ Implemented

**Purpose:** Card displaying crate info and pages

**Props:** Uses `ExplorerItemProps<ItemCrate>` from ExplorerItemProps.ts

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

**Features:**
- Collapsible page list (Radix Collapsible, no shadcn Card wrapper for simpler styling)
- Clickable crate name (toggles collapse)
- Version selector with navigation support
- "..." menu (external links, move, refresh, remove)
- Auto-syncs version from current page URL

**Design Decisions:**

**1. No Card Wrapper**
- **Decision**: Use Radix Collapsible directly without shadcn Card component
- **Rationale**: Simpler styling, less nesting, card-like appearance achieved with Tailwind
- **Trade-off**: Less semantic markup, but cleaner DOM

**2. Version Auto-Sync**
- **Decision**: Detect when `currentPage` URL has different version than `crate.currentVersion`, auto-update to match
- **Rationale**: User navigating via iframe links should see correct version in selector
- **Implementation**: Handles both "latest" and specific version strings

**3. External Links in Menu**
- **Decision**: Move external links (Repository, Homepage) from CrateCard header to CrateMenu
- **Rationale**: Reduces header clutter, groups all crate actions in one place
- **Trade-off**: Extra click to access links, but cleaner UI

**4. Version Change Navigation**
- **Decision**: If currently viewing this crate's docs, navigate to new version URL; otherwise just update `crate.currentVersion`
- **Rationale**: Changing version while viewing should navigate; changing while viewing another crate should not
- **Implementation**: Uses `currentPage.type === 'crate'` checks instead of string `.startsWith()`

---

#### CrateVersionSelector Component (`frontend/explorer/crate/CrateVersionSelector.tsx`)

**Status:** ✅ Implemented

**Purpose:** Version selector dropdown

**Features:**
- Uses shadcn Select (Radix UI)
- Shows "latest" as first option (stores literal string)
- Shows first non-yanked version from each of the 5 most recent version groups
- Shows current version if not in the list above
- Validates version exists before calling `setVersion`
- "..." placeholder item for future full version list popup

**Design Decisions:**

**1. "latest" as Literal String**
- **Decision**: Store literal string "latest" instead of resolved version number
- **Rationale**: Preserves user intent, automatically updates when new version released
- **Trade-off**: Requires resolving "latest" to actual version for URL building

**2. Current Version Always Shown**
- **Decision**: If current version not in top 5 groups, append it to list
- **Rationale**: User should always see and be able to return to their selected version
- **Trade-off**: List can exceed 5 items in edge cases

---

#### CrateMenu Component (`frontend/explorer/crate/CrateMenu.tsx`)

**Status:** ✅ Implemented

**Purpose:** Actions menu for crate (also hosts external links)

**Implementation notes:**
- Uses extracted `CrateMenuItem` helper for consistent menu item rendering
- Uses `CrateMenuLink` helper for external links (Crates.io, Repository, Homepage)
- Move: Creates new Item, adds to target group, then calls `removeItem()` to remove from source
- Refresh: Uses `app.refreshCrateCache(name)` which deletes cache entry
- Remove: Uses `removeItem` callback from `ExplorerItemProps`

**Icons:** `faEllipsisVertical`, `faRightToBracket`, `faRotate`, `faTrash`, `faArrowUpRightFromSquare` (Font Awesome)

**Menu Items:**
1. Crates.io link (always available)
2. Repository link (if available)
3. Homepage link (if available)
4. (separator)
5. Move to group → submenu with all named groups
6. (separator)
7. Refresh metadata
8. (separator)
9. Remove crate (destructive)

**Design Decisions:**

**1. Move Implementation**
- **Decision**: Create new Item, add to target group, then call `removeItem()` to remove from source
- **Rationale**: Avoids complex cross-group state management; atomic from user perspective
- **Trade-off**: Brief moment where item exists in both locations (imperceptible)

**2. Refresh Cache**
- **Decision**: `app.refreshCrateCache(name)` deletes cache entry, triggering refetch on next access
- **Rationale**: Simple invalidation pattern; lazy refetch avoids unnecessary API calls
- **Implementation**: Added `refreshCrateCache(name)` method to AppContext

**3. External Links via navigateTo**
- **Decision**: External links use `app.navigateTo()` which sets iframe src
- **Rationale**: Rust host intercepts navigation and opens non-docs.rs URLs in system browser
- **Trade-off**: Relies on host interception; fallback would open in iframe (acceptable)

---

#### CratePageList Component (`frontend/explorer/crate/CratePageList.tsx`)

**Status:** ✅ Implemented

**Purpose:** List of documentation pages with symbol parsing and color coding

**CratePageItem (inline component):**
- Handles individual page rendering with hover state
- Pin icon: outline for preview (shown on hover), filled for pinned
- Compares `pathSegments.join('/')` for active page detection

**Icons:** `faHouse`, `faThumbtack` (Font Awesome)

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

**Design Decisions:**

**1. Symbol Parsing from URL**
- **Decision**: Parse symbol type from docs.rs URL path patterns
- **Rationale**: docs.rs uses consistent URL patterns (e.g., `struct.Name.html`, `fn.name.html`)
- **Implementation**: Regex matching on path segments
- **Trade-off**: Relies on docs.rs URL conventions; may break if they change (unlikely)

**2. Module Path Display**
- **Decision**: Show module path in default color, symbol name colored by type
- **Rationale**: Visual hierarchy - module provides context, symbol is the focus
- **Implementation**: `module.join("::")` + `::` + colored symbol name

**3. CratePageItem Hover State**
- **Decision**: Use Tailwind `group/page` pattern for hover state instead of `useState`
- **Rationale**: CSS-only hover is more performant; no state management needed
- **Trade-off**: Slightly more complex Tailwind classes

**4. Pin Icon Variants**
- **Decision**: Outline pin icon for preview pages (shown on hover), filled for pinned pages
- **Rationale**: Visual distinction between temporary (preview) and permanent (pinned) pages
- **Implementation**: Conditional icon rendering based on `isPinned` prop

**5. Active Page Detection**
- **Decision**: Compare `pathSegments.join('/')` for active page detection
- **Rationale**: Normalized path comparison avoids URL encoding issues
- **Trade-off**: Assumes path segments are already normalized (they are, from `parseUrl`)

---

#### ExplorerGroupHeader Component (`frontend/explorer/ExplorerGroupHeader.tsx`)

**Status:** ✅ Implemented

**Purpose:** Group header with collapse toggle, rename, and dropdown menu

**Features:**
- Chevron toggle to expand/collapse group
- Clickable group name to toggle collapse
- Pencil button (on hover) to rename group
- Ellipsis menu with all group actions

**Menu Items:**
1. Expand all items
2. Collapse all items
3. (separator)
4. Import (opens dialog to paste docs.rs URLs)
5. (separator) - only for non-frozen groups
6. Move group up (disabled if first)
7. Move group down (disabled if last)
8. (separator)
9. Remove group (destructive, with confirmation dialog)

**Design Decisions:**

**1. Expand/Collapse All**
- **Decision**: Menu items instead of header toggle button
- **Rationale**: Reduces header clutter; expand/collapse all is less frequent action
- **Trade-off**: Requires opening menu; acceptable for infrequent operation

**2. Move Up/Down**
- **Decision**: Separate menu items for move up and move down
- **Rationale**: Clear, explicit actions; no drag-and-drop complexity
- **Trade-off**: More clicks than drag-and-drop (future enhancement)

**3. Remove Confirmation**
- **Decision**: Always show confirmation dialog for group deletion
- **Rationale**: Groups may contain crates that would be lost; prevents accidental data loss
- **Implementation**: Dialog triggered by menu item

**4. Import Feature**
- **Decision**: Add "Import" menu item available for all groups
- **Rationale**: Bulk-add crates with pinned pages from docs.rs URLs
- **Implementation**:
  - Dialog with textarea for pasting URLs (one per line)
  - Uses `parseUrl()` to validate URLs - only accepts `docs.rs/<crate>/<version>/...` format
  - Groups URLs by crate name, creates one `Item` per crate with all pages pinned
  - Ignores version in URL, always uses "latest"
  - Silently drops invalid/non-docs.rs URLs
- **Placement**: After "Collapse all", before move actions
- **Trade-off**: No validation that URLs point to existing pages (acceptable for bulk import)

---

#### Implementation Summary

- **Callback-Based Data Flow**: Updates via typed callbacks, decoupled from global state
- **ExplorerItemProps<T>**: Generic interface for item components with CRUD callbacks
- **Tagged Union Handling**: `ExplorerItem` switches on `item.type` with pragmatic cast
- **Inline Components**: Small components (`ExplorerGroup`, `ExplorerItem`) in `index.tsx`
- **Collapsible Groups**: Groups have expand/collapse state with chevron toggle in header
- **Auto-Sorted Items**: Items sorted alphabetically by name after any modification
- **Rename State Encapsulation**: Rename UI state lives in `ExplorerGroupHeader`
- **Create Group with insertAt**: Two instances at top and bottom of explorer
- **CrateCard Collapsible**: Radix Collapsible without Card wrapper
- **Version Auto-Sync**: Detects version mismatch from current page URL
- **External Links in Menu**: CrateMenu hosts links (Crates.io, Repository, Homepage)
- **CrateMenuItem Helper**: Extracted helper for consistent menu item rendering
- **Symbol Parsing**: Parse docs.rs URL patterns for type information
- **One Dark Colors**: CSS variables for consistent syntax highlighting
- **Hover with group/page**: CSS-only hover state using Tailwind groups

---

### Phase 6: Integration & Polish

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
- **Icon**: `faMagnifyingGlass` (left side, 16px)
- **Clear button**: `faXmark` (right side, appears when value is not empty)
- **Loading spinner**: Right side, replaces clear button when searching

#### Group
- **All groups** (no special "ungrouped" section):
  - Card-like appearance with subtle background
  - Rounded corners: `rounded-md`
- **Group header**:
  - Chevron icon toggles between `faChevronRight` (collapsed) and `faChevronDown` (expanded)
  - Clickable group name to toggle collapse
  - Pencil button (visible on hover) for rename
  - Ellipsis menu button always visible
  - Text color: `text-muted-foreground`
- **Expand/collapse**:
  - Collapsed: only header visible
  - Expanded: header + item list visible

#### Crate Card
- **Card component**: Use shadcn/ui Card
- **Padding**: Compact (12px / `p-3`)
- **Layout**: Flex row for header items
- **Spacing**: 8px gaps between header items
- **Header items**:
  - Crate icon: 16px (`faBox`)
  - External link icons: 12px (`faArrowUpRightFromSquare`)
  - Version dropdown: Compact, right-aligned
  - Menu button: Subtle, appears on hover (`faEllipsisVertical`)

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
  - Icon: `faHouse` (12px)
  - Always visible first item
- **Preview page**:
  - Text: Italic (`italic` class)
  - Pin icon: `faThumbtack` (12px)
  - Color: Normal foreground
- **Pinned pages**:
  - Text: Normal (not italic)
  - Unpin icon: `faThumbtack` (12px)
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

- **Base font size**: 14px (set in `:root` in global.css)
- **Font families**: Ubuntu Light (sans) and Ubuntu Mono (monospace)
- **Group names**: `text-lg` (larger), semibold
- **Crate names**: `font-mono`, normal weight
- **Page links**: `font-mono font-light`
- **Preview pages**: Italic for emphasis
- **Muted text**: `text-muted-foreground` or reduced opacity

### Icon Reference (Font Awesome)

| Component | Icon | Usage |
|-----------|------|-------|
| Search | `faMagnifyingGlass` | Search bar (left) |
| Clear | `faXmark` | Search bar (right, conditional) |
| External Link | `faArrowUpRightFromSquare` | Crate external links |
| Pin | `faThumbtack` | Pin/unpin button for pages |
| Menu | `faEllipsisVertical` | Crate/group actions menu |
| Expand All | `faAnglesDown` | Expand all items in group |
| Collapse All | `faAnglesUp` | Collapse all items in group |
| Move Up | `faArrowUp` | Move group up |
| Move Down | `faArrowDown` | Move group down |
| Import | `faFileImport` | Import crates from URLs |
| Move to Group | `faRightToBracket` | Move crate to another group |
| Rename | `faPencil` | Rename group |
| Add | `faPlus` | Add group button |
| Confirm | `faCheck` | Confirm rename/add |
| Refresh | `faRotate` | Refresh crate metadata |
| Delete | `faTrash` | Delete group/crate |
| More Versions | `faEllipsis` | Version selector placeholder |

---

## File Structure

```
TurboDoc/
├── frontend/
│   ├── app.tsx                    ✅ App component with useAppContext hook
│   ├── context.ts                 ✅ AppContext class definition
│   ├── data.ts                    ✅ Type definitions + URL parsing (parseUrl, buildUrl)
│   ├── global.css                 ✅ Global styles + One Dark color palette (14px base font)
│   ├── ipc.ts                     ✅ IPC message passing with timeout
│   ├── constants.ts               ✅ Constants (timeouts, rate limits)
│   ├── services/
│   │   └── crates-api.ts          ✅ Crates.io API client
│   ├── utils/
│   │   └── version-group.ts       ✅ Version grouping logic
│   ├── 3rdparty/
│   │   └── shadcn/                ✅ shadcn/ui components (Select, DropdownMenu, Collapsible, etc.)
│   └── explorer/
│       ├── index.tsx              ✅ Explorer, ExplorerGroup, ExplorerItem
│       ├── ExplorerItemProps.ts   ✅ ExplorerItemProps<T> interface
│       ├── ExplorerGroupHeader.tsx ✅ Group header with collapse toggle, rename, menu
│       ├── ExplorerCreateGroupComponent.tsx  ✅ Add group button/input (insertAt prop)
│       └── crate/
│           ├── CrateCard.tsx      ✅ Collapsible crate card with header
│           ├── CratePageList.tsx  ✅ Page list with symbol parsing + CratePageItem
│           ├── CrateVersionSelector.tsx  ✅ Version selector dropdown
│           └── CrateMenu.tsx      ✅ Crate actions menu + CrateMenuItem helper
├── src/
│   └── app.rs                     ✅ Backend IPC handlers
└── docs/
    └── README.md                  📄 This file
```

---

## Open Questions & Assumptions

### Assumptions Made

1. **Crates.io API CORS**: Assuming CORS is enabled for frontend access
   - ✅ **Verified**: CORS works in WebView2 environment
   - Fallback plan: Proxy API calls through Rust backend if CORS blocked (not needed)

2. **Semver compliance**: All crate versions follow semver format (enforced by crates.io)
   - ✅ **Confirmed**: crates.io enforces semver, safe to rely on

3. **Single preview page**: Each crate has at most one preview page at a time (like VS Code)
   - Data model: `currentPage` is a preview page if not in `pinnedPages`

4. **No nested groups**: Groups cannot contain other groups (flat structure)
   - ✅ **Confirmed**: Data model enforces this - `Group` contains `Item[]`, not other groups

5. **Page paths**: Always relative URLs from docs.rs root
   - Structure: `CratePage.path` is relative (e.g., "struct.Vec3.html")
   - Full URL: `https://docs.rs/{crate}/{version}/{path}`

6. **Clean workspace.json**: workspace.json never contains cached fields
   - Cached fields (versions, versionGroups, links) only exist in cache.json
   - ✅ **Confirmed**: workspace/cache split enforces this separation

7. **Item discriminated union**: Group items use `Item[]` type (discriminated union)
   - ✅ **Confirmed**: `Item = Expandable & ({ type: "crate", ... })`
   - This allows future extension (e.g., `type: "folder"` for nested organization)

### Items to Verify During Implementation

1. **CORS support**: ✅ **Verified** - WebView2 allows cross-origin fetch to crates.io
2. **User-Agent requirement**: ✅ **Verified** - Using browser-like User-Agent works
3. **Search API format**: ✅ **Verified** - `/api/v1/crates?q=...` returns `{crates: [{name, description}]}`
4. **Immer compatibility**: ✅ **Verified** - Immer works correctly with TypeScript types

### Resolved Clarifications

All initial questions have been answered through implementation. No outstanding clarifications needed for Phase 5.

---

## Success Criteria

### Phase 1-4 (Completed)
- ✅ Data model defined with workspace/cache split
- ✅ Crates.io API integration with rate limiting
- ✅ Version grouping algorithm implemented and tested
- ✅ IPC layer with timeout handling and error recovery
- ✅ AppContext class with dual state management
- ✅ Workspace and cache persistence across app restarts

### Phase 5 (Mostly Complete)
- ⬜ Users can search and add crates to workspace (SearchBar/SearchResults remaining)
- ✅ Crates display with metadata, version selection, and external links
- ✅ Users can organize crates into named groups (add, rename, delete, move up/down)
- ✅ Groups are collapsible with chevron toggle
- ✅ Crates within groups auto-sorted alphabetically by name
- ✅ Navigation in iframe updates explorer state automatically (IPC 'navigated' event)
- ✅ Users can pin/unpin documentation pages
- ✅ Preview page system works like VS Code tabs
- ✅ Symbol parsing with One Dark color coding
- ✅ Expand/collapse all items in groups
- ✅ Move crates between groups via menu
- ⬜ UI polish and loading/error states

### Overall Success Metrics
- Navigation feels instant (<100ms perceived latency)
- Search results appear within 300ms
- Large workspaces (50+ crates) remain responsive
- No stale state bugs or infinite re-render loops

---

## Change History

Brief timeline of significant changes (design decisions are documented in component specs above):

- **2026-01**: Merged Plan-Frontend.md content into README.md (component specs, visual design reference, Phase 6)
- **2026-01**: Updated icon references from Lucide React to Font Awesome
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
- **2026-01**: Switched from Lucide React to Font Awesome icons
- **2026-01**: Moved shadcn files to `3rdparty/shadcn/` directory
- **2026-01**: Added Import feature to group menu
  - Bulk-add crates from docs.rs URLs with pinned pages
  - Available for all groups
  - Uses `parseUrl()` to validate and parse URLs
  - Groups URLs by crate, ignores version (uses "latest")
- **2026-01-10**: Refactor: Rearrange text sizing and spacing
  - Set 14px base font size in `:root` (global.css)
  - Consistent typography hierarchy with Ubuntu fonts
- **2026-01-10**: Feature: Collapsible groups + auto-sorting
  - Groups now have `expanded` state with chevron toggle
  - Items within groups auto-sorted alphabetically by `name`
  - Extracted `CrateMenuItem` helper from `CrateMenu`
- **2026-01-10**: Remove the Ungrouped group
  - All crates now belong to named groups
  - `ExplorerCreateGroupComponent` with `insertAt` prop ("top" or "bottom")
  - Simplified component hierarchy (no special ungrouped section)

---

## Future Enhancements (Out of Scope)

### UI/UX
- Drag-and-drop for reordering crates and groups
- Keyboard shortcuts (Cmd+K search, Cmd+P pages, etc.)
- Dark/light theme toggle (currently forced dark by backend)
- Toast notifications for errors/success
- Page title extraction from HTML

### Features
- Multiple documentation sources beyond docs.rs
- Offline mode improvements
- Full-text search within cached docs
- Export/import workspace
- Workspace size limits and warnings

### Code Quality
- Extract reusable RateLimiter class (deferred until second API needs rate limiting)
  - Current: Module-level state in `crates-api.ts` works well for single API
  - Future: When adding rate limiting for additional APIs, extract into `utils/rate-limiter.ts`

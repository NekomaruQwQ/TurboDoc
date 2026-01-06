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
- Clicking result adds crate to "Not Yet Grouped" section
- Automatic metadata fetch (description, links, versions) on add

**Navigation:**
- Clicking page in sidebar → loads in iframe
- Clicking link in iframe docs → auto-detects navigation via IPC (planned)
- Navigating to new page → appears as "preview" page (not pinned)
- Clicking pin icon → promotes preview page to pinned
- Only one preview page per crate (like VS Code tabs)

**Organization:**
- Menu-based move between groups (V1)
- Create named groups with "+ Add Group" button
- Rename groups by clicking group name
- Delete groups with confirmation
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
- ⬜ Pin/unpin documentation pages
- ⬜ Preview page system (VS Code-style)
- ⬜ Named groups for organization
- ✅ Workspace persistence across sessions
- ⬜ Automatic cross-crate navigation
- ⬜ Loading states and error handling
- ⬜ Move crates between groups via menu

#### Should Have (Future)
- 🔲 Drag-and-drop reordering
- 🔲 Keyboard shortcuts (Cmd+K search, Cmd+P pages, etc.)
- 🔲 Page title extraction from HTML
- 🔲 Full-text search within cached docs
- 🔲 Toast notifications for actions
- 🔲 Export/import workspace

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
- **Icons**: Lucide React
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
│   │       ├── GroupList
│   │       │   ├── UngroupedSection (renders if ungrouped.length > 0)
│   │       │   │   └── CrateCard[] (for each ungrouped crate)
│   │       │   └── Group[] (for each named group)
│   │       │       ├── GroupHeader (collapsible, editable name, delete button)
│   │       │       └── CrateCard[] (for each crate in group)
│   │       └── AddGroupButton
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
- **SearchResults**: Dropdown/modal below search bar, click adds crate to ungrouped
- **GroupList**: Renders ungrouped section first, then all named groups
- **Group**: Collapsible group with editable name, delete button, uses Radix Collapsible
- **CrateCard**: Card layout with header (name, links, version, menu) and collapsible page list
- **VersionCombobox**: Radix Select showing version groups (max 5), latest version marked
- **CrateMenu**: Radix DropdownMenu with move/remove/refresh options
- **PageList**: Collapsible list with home page, preview page (italic), and pinned pages

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

### Icons (Lucide React)
- Search: `Search`
- External link: `ExternalLink`
- Home: `Home`
- Pin: `Pin`
- Unpin: `PinOff`
- Menu: `MoreVertical`
- Collapse: `ChevronDown` / `ChevronRight`
- Add: `Plus`
- Trash: `Trash2`

---

## Completed Implementation (Phases 1-4)

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
- **Decision**: Remove `docs_preview_page` field, derive from `pinnedPages` and `currentPage`
- **UX Concept**: Each crate has exactly one preview slot tracked via `currentPage` (like VS Code preview tabs)
  - Preview pages appear in italic to indicate temporary status
  - Navigating to a new page replaces existing preview page (if any)
  - Only one preview page per crate at a time
- **Pinning Behavior**:
  - Clicking pin icon on preview page: sets `pinned = true` (promotes to permanent)
  - Clicking unpin icon on pinned page: sets `pinned = false` (demotes to preview, replaces previous preview if any)
- **Implementation**: Preview page is identified as `currentPage` where `currentPage` is NOT in `pinnedPages`
  - `pinnedPages` array contains pinned page paths
  - `currentPage` references the currently active page path
- **Rationale**: Avoids state duplication; preview state derived from current page + pin status
- **Trade-off**: Slightly more computation on render (negligible, worth the simplification)

**3. Ungrouped as Array**
- **Decision**: `ungrouped: ItemCrate[]` instead of `ungrouped: Group`
- **Rationale**: Simpler data structure, no group name/expansion state needed
- **Trade-off**: Special-case rendering logic (acceptable, clearer separation)

**4. Single-Level Expandability**
- **Decision**: Only crate cards are expandable/collapsible (removed nested page list collapse)
- **Rationale**: Expander-inside-expander is confusing UX
- **Simplification**: Page list always visible when crate card is expanded

#### Implementation Summary

- **Workspace/Cache Split**: Clean separation of user data vs API data in separate files (~90% size reduction for workspace)
- **Derived Preview State**: No duplication, derive from pinnedPages + currentPage
- **Ungrouped as Array**: Simpler than Group, clearer special-case handling
- **DocsPage Interface**: Proper structure for page data with pin state and metadata
- **Single-Level Expandability**: Only crate cards expand/collapse (no nested expanders)

---

### Phase 2: API Integration

**Status:** ✅ Complete

**Files:**
- `frontend/services/crates-api.ts` - API client with rate limiting
- `frontend/utils/version-group.ts` - Version grouping logic
- `frontend/utils/url-parser.ts` - URL parsing utilities

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

#### URL Parser

**Functions:**
- `parseDocsRsUrl(url: string)` - Parse docs.rs URLs into `{ crate, version, page }`
- `buildDocsRsUrl(crate, version, page?)` - Build docs.rs URLs

**Pattern:** `/crate/version/path/to/page.html`

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

**Type-Safe Response Variants:**
```typescript
type IPCResponseVariants = {
    'workspace-loaded': { content: string };
    'workspace-saved': {};
    'cache-loaded': { content: string };
    'cache-saved': {};
}
```
- `getResponseAsync<T>()` returns properly typed `IPCResponseVariants[T]`
- Compile-time checking of response shapes per message type

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
- **Decision**: Auto-add crates to ungrouped when navigating to unknown crate
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
- **Auto-Add Crates**: Planned for seamless cross-crate navigation (deferred to Phase 5)

---

## File Structure

```
TurboDoc/
├── frontend/
│   ├── app.tsx                    ✅ App component with useAppContext hook
│   ├── context.ts                 ✅ AppContext class definition
│   ├── data.ts                    ✅ Type definitions (Workspace, Cache, etc.)
│   ├── ipc.ts                     ✅ IPC message passing with timeout
│   ├── constants.ts               ✅ Constants (timeouts, rate limits)
│   ├── services/
│   │   └── crates-api.ts          ✅ Crates.io API client
│   ├── utils/
│   │   ├── version-group.ts       ✅ Version grouping logic
│   │   └── url-parser.ts          ✅ URL parsing utilities
│   └── explorer/
│       ├── index.tsx              ✅ Explorer, groups, items
│       ├── common.d.ts            ✅ ExplorerItemProps<T> interface
│       └── items/
│           └── crate.tsx          ✅ CrateCard component
├── src/
│   └── app.rs                     ✅ Backend IPC handlers
└── docs/
    ├── README.md                  📄 This file
    └── Plan-Frontend.md           📋 Remaining work (Phase 5+)
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

7. **Item discriminated union**: Ungrouped items use `Item[]` type (discriminated union)
   - ✅ **Confirmed**: `Item = Expandable & ({ type: "crate", data: ItemCrate })`
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

### Phase 5+ (In Progress)
- ⬜ Users can search and add crates to workspace
- ⬜ Crates display with metadata, version selection, and external links
- ⬜ Users can organize crates into named groups
- ⬜ Navigation in iframe updates explorer state automatically
- ⬜ Users can pin/unpin documentation pages
- ⬜ Preview page system works like VS Code tabs
- ⬜ UI is responsive and matches design mockup
- ⬜ All interactions are smooth with proper loading/error states

### Overall Success Metrics
- Navigation feels instant (<100ms perceived latency)
- Search results appear within 300ms
- Large workspaces (50+ crates) remain responsive
- No stale state bugs or infinite re-render loops

---

## Next Steps

See [Plan-Frontend.md](./Plan-Frontend.md) for remaining work:
- Phase 5: UI Components (Explorer, SearchBar, GroupList, CrateCard, etc.)
- Phase 6: Styling and UX Polish
- Phase 7: Integration & Testing

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

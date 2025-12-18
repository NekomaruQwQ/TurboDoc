# TurboDoc Frontend Design Plan

## Overview
Complete the frontend design for TurboDoc, a documentation viewer with local caching. The app displays docs.rs documentation in an iframe with a sidebar explorer for managing crates, versions, and pages.

---

## Requirements & Design Goals

### 1. Visual Design

#### Layout
- **Two-panel layout** with resizable horizontal split:
  - Left panel: Explorer sidebar (200-400px, resizable)
  - Right panel: Documentation iframe (fills remaining space)
- **Dark theme** (forced by backend, consistent with docs.rs dark mode)
- **Compact, information-dense** interface optimized for reference workflows

#### Explorer Sidebar Structure
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

#### Crate Card Design
- **Header section:**
  - Crate name (clickable, bold)
  - External links (crates.io, repository, homepage) as small icon buttons
  - Version selector dropdown (right-aligned)
  - "..." menu for actions (move, remove, refresh)
- **Body section (expandable):**
  - Home link with house icon (always visible)
  - Documentation pages list (collapsible tree)
  - Half-open page shown in italic with pin button
  - Pinned pages shown normally with unpin button
  - Active page highlighted with accent background

### 2. User Experience Goals

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
- Clicking link in iframe docs → auto-detects navigation via IPC
- Navigating to new page → appears as italic "half-open" page
- Clicking pin icon → promotes half-open page to pinned
- Only one half-open page per crate (like VS Code tabs)

**Organization:**
- Drag-and-drop to reorder (future enhancement)
- Menu-based move between groups (V1)
- Create named groups with "+ Add Group" button
- Rename groups by clicking group name
- Delete groups with confirmation

**Version Management:**
- Version selector shows ~5 most relevant versions:
  - Latest version (always shown)
  - Latest from each major.minor series
  - Pre-release versions marked distinctly
  - Yanked versions shown with warning
- Changing version → reloads iframe with new version
- Current version persisted per-crate in workspace

### 3. Feature Requirements

#### Must Have (V1)
- ✅ Search crates from crates.io
- ✅ Display crate metadata (description, links, license)
- ✅ Version selection with intelligent grouping
- ✅ Pin/unpin documentation pages
- ✅ Half-open page system (VS Code-style)
- ✅ Named groups for organization
- ✅ Workspace persistence across sessions
- ✅ Automatic cross-crate navigation
- ✅ Loading states and error handling
- ✅ Move crates between groups via menu

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

### 4. Performance Goals

- **Instant navigation**: Page changes feel immediate (<100ms perceived latency)
- **Smooth scrolling**: 60fps scrolling in explorer and iframe
- **Fast search**: Search results appear within 300ms of typing
- **Efficient rendering**: Large workspaces (50+ crates) remain responsive
- **Small bundle**: Frontend JS bundle <500KB gzipped

### 5. Design Principles

1. **Familiarity**: Borrow patterns from VS Code (tabs, sidebar, command palette)
2. **Efficiency**: Minimize clicks to access frequently-used pages
3. **Clarity**: Always show current state (active page, loading, errors)
4. **Forgiveness**: Auto-save, undo-friendly operations, confirmation for destructive actions
5. **Progressive disclosure**: Collapse details by default, expand on demand
6. **Performance**: Optimize for large workspaces (50+ crates)

### 6. Visual Design System

**Colors:**
- Based on existing Tailwind theme in `global.css`
- OKLCH color space for perceptual uniformity
- Dark background with high-contrast text
- Accent color for active/selected states
- Muted colors for secondary information

**Typography:**
- Monospace font for consistency with code
- Clear hierarchy: group names > crate names > page links
- Italic for half-open pages (emphasis without weight)

**Spacing:**
- Compact 8px grid for information density
- Comfortable 16px padding for panels
- Consistent 4px gaps between UI elements

**Icons:**
- Lucide React icon set (consistent style)
- 16px size for inline icons
- 20px size for primary actions

---

## Key Data Model & Design Decisions

### Minimal API Response Structure
**Decision:** Fetch only essential data from crates.io API - external links and version list.
- **Rationale:** Without full type definitions for crates.io JSON, keep what we know small and focused
- **What we fetch:** repository, homepage, documentation URLs + version list with yanked status
- **What we don't fetch:** description, license, download counts, etc. (not needed for core functionality)

### Version Groups Definition
**Decision:** Define version group as versions with semver compatibility.
- **Rationale:** According to semver, version A is a superset of version B if A > B and A is compatible with B
- **Implementation:** Only care about the latest version in each major.minor group
- **Structure:** `version_groups: { latest: string, versions: CrateVersion[] }[]`
- **Display:** Show ~5 most recent semver-compatible groups in version selector

### Half-Open Page Model
**Decision:** Each crate has exactly one half-open slot tracked via `currentPage`.
- **Rationale:** Matches VS Code tab behavior - navigate to new page creates italic/temporary tab
- **Implementation:** `currentPage` is half-open if `!currentPage.pinned`
- **Behavior:** Navigating to a new page replaces existing half-open page (if any)
- **Pinning:** Clicking pin icon sets `currentPage.pinned = true` and adds to `pinnedPages`

### Single-Level Expandability
**Decision:** Removed `is_pages_collapsed` - only crate cards are expandable/collapsible.
- **Rationale:** Expander-inside-expander is confusing UX
- **Implementation:** Each crate card can expand/collapse to show/hide its page list
- **Simplification:** Page list is always visible when crate card is expanded (no nested collapsing)

### Search Results Include Description
**Decision:** Search returns `{ name: string, description: string | null }[]`
- **Rationale:** Users need context when choosing from search results
- **Implementation:** Display description in search dropdown below crate name
- **Null handling:** Gracefully handle crates without descriptions

---

## 🚨 CRITICAL: Implementation Strategy

### Development Workflow

**⚠️ MANDATORY IMPLEMENTATION RULES - READ BEFORE CODING:**

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

3. **Update Plan Document After Each Component**
   - **Mark completed components** with ✅ in the plan document
   - Add **notes about implementation decisions** or deviations from plan
   - Document **discovered issues** or **future improvements** needed
   - Keep the plan as a **living document** that tracks progress

### Implementation Order (Strictly Follow)

```
✅/❌  Component Path                    Status Notes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[✅]  Phase 1: Data Model Updates
[✅]    └─ frontend/data.ts              Added DocsPage, CrateMetadata, VersionGroup; updated ItemCrate & Workspace
[✅]    └─ frontend/utils/url-parser.ts  URL parsing utility with parseDocsRsUrl & buildDocsRsUrl

[✅]  Phase 2: API Integration
[✅]    └─ frontend/services/crates-api.ts  CratesAPI with rate limiting, search, metadata fetch (simplified)
[✅]    └─ frontend/utils/version-groups.ts  Version grouping logic (semver-compatible groups)
[✅]    └─ Tests: version-groups.test.ts (unit), crates-api.integration.test.ts (integration)

[ ]   Phase 3: IPC Fixes
[ ]     └─ frontend/ipc.ts               Add timeout handling

[ ]   Phase 4: State Management
[ ]     └─ frontend/app.tsx              WorkspaceContext with Immer

[ ]   Phase 5: UI Components (Top-to-Down)
[ ]     └─ frontend/explorer/index.tsx           Explorer container
[ ]     └─ frontend/explorer/search-bar.tsx      Search input
[ ]     └─ frontend/explorer/search-results.tsx  Search dropdown
[ ]     └─ frontend/explorer/group-list.tsx      Group container
[ ]     └─ frontend/explorer/group.tsx           Group component
[ ]     └─ frontend/explorer/crate-card.tsx      Crate card
[ ]     └─ frontend/explorer/version-combobox.tsx  Version selector
[ ]     └─ frontend/explorer/crate-menu.tsx      Crate actions menu
[ ]     └─ frontend/explorer/page-list.tsx       Page tree

[ ]   Phase 6: Integration & Testing
[ ]     └─ Wire up IPC navigation events
[ ]     └─ Test cross-crate navigation
[ ]     └─ Test workspace persistence
[ ]     └─ Polish loading/error states
```

### Iteration Workflow Per Component

```
1. Read component spec from plan
2. Implement component/module structure (JSX, basic props, or core functions)
3. **Write tests** (unit tests for utilities/services, component tests for UI)
4. **Run tests** → Verify all tests pass (bun test <file>.test.ts)
5. Check HMR → Verify structure in browser (for UI components)
6. Add styling (Tailwind classes, for UI components)
7. Check HMR → Verify visual design
8. Add interactions (onClick, onChange, etc.)
9. Check HMR → Verify interactions work
10. Add loading/error states
11. Check HMR → Verify edge cases
12. **Re-run tests** → Ensure nothing broke
13. Mark component as ✅ in plan
14. Commit changes (optional)
15. Move to next component
```

**Testing Requirements:**
- **Utilities/Services**: Write comprehensive unit tests covering:
  - Happy path scenarios
  - Edge cases (empty inputs, invalid data, etc.)
  - Error conditions
  - Real-world examples
- **UI Components**: Write component tests (later, using React Testing Library)
- **Run tests before marking complete**: All tests must pass before moving on

### Why This Approach Works

- **Visual feedback loop**: Catch issues immediately, not at the end
- **Incremental progress**: Always have a working subset of the UI
- **Reduced context switching**: Focus on one component at a time
- **Clear stopping points**: Each component completion is a milestone
- **Living documentation**: Plan stays synchronized with reality

---

## Phase 1: Data Model Updates

### 1.1 Enhance `frontend/data.ts`

**Add new interfaces:**

```typescript
interface DocsPage {
  /** Relative URL path (e.g., "glam/struct.Vec3.html") */
  path: string;
  /** Display title (extracted from first navigation, or derived from path) */
  title?: string;
  /** Whether this page is pinned */
  pinned: boolean;
  /** Last accessed timestamp (for sorting) */
  lastAccessed?: number;
}

interface CrateMetadata {
  /** Repository URL (from crates.io API) */
  repository: string | null;
  /** Homepage URL */
  homepage: string | null;
  /** Documentation URL (might differ from docs.rs) */
  documentation: string | null;
  /** Short description */
  description: string;
  /** Latest version string (e.g., "0.28.0") */
  latest_version: string;
  /** License information */
  license: string | null;
  /** Timestamp when metadata was fetched (for cache invalidation) */
  fetchedAt: number;
}

interface VersionGroup {
  /** Display label (e.g., "1.85.0 (latest)" or "1.0.0-rc.1") */
  label: string;
  /** Actual version number */
  version: string;
  /** Whether this is the latest version */
  isLatest: boolean;
  /** Whether this is a pre-release version */
  isPrerelease: boolean;
  /** Whether this version is yanked */
  isYanked: boolean;
}
```

**Update `ItemCrate` interface:**

```typescript
interface ItemCrate {
  /** Name of the crate */
  name: string;
  /** Whether the crate card is expanded in the UI */
  is_expanded: boolean;
  /** Whether the pages list is collapsed */
  is_pages_collapsed: boolean;

  /** All available versions (full list from crates.io) */
  versions: Array<{ num: string; yanked: boolean }>;
  /** Grouped versions for display (first N semver groups) */
  version_groups: VersionGroup[];
  /** Currently selected version ("latest" or specific version) */
  current_version: string;

  /** Metadata fetched from crates.io API (null if not yet fetched) */
  metadata: CrateMetadata | null;
  /** Error message if metadata fetch failed */
  metadataError?: string;

  /** Documentation pages (both pinned and unpinned) */
  docs_pages: DocsPage[];
  /** Currently opened page path (may or may not be pinned) */
  docs_open_page: string | null;
}
```

**Update `Workspace` interface:**

```typescript
interface Workspace {
  /** Named groups of crates */
  groups: Group[];
  /** Ungrouped crates (displayed at top, simpler than a full Group) */
  ungrouped: ItemCrate[];
}
```

**Rationale:**
- `DocsPage`: Structured page data with pin state and metadata (title, timestamp)
- `CrateMetadata`: Complete info from crates.io API with cache timestamp
- `version_groups`: Pre-computed display list with pre-release and yanked status
- `docs_open_page`: Single source of truth for current page (derive "half-open" state from `docs_pages`)
- `ungrouped`: Simple array instead of Group (avoids confusion, easier to work with)
- **REMOVED `docs_half_open_page`**: Derived from `docs_pages.find(p => p.path === docs_open_page && !p.pinned)`

---

## Phase 2: Crates.io API Integration

### 2.1 Create `frontend/services/crates-api.ts`

**Purpose:** Fetch crate metadata from crates.io API with rate limiting

**Dependencies:** Add `semver` and `use-debounce` packages:
```bash
bun add semver use-debounce
bun add -d @types/semver
```

**Key class: CratesIoClient**

```typescript
class CratesIoClient {
  private lastRequestTime = 0;
  private minDelay = 1000; // 1 second between requests (crates.io crawler policy)

  async fetchCrateInfo(crateName: string): Promise<CrateMetadata> {
    return this.queueRequest(async () => {
      const response = await fetch(
        `https://crates.io/api/v1/crates/${crateName}`,
        {
          headers: {
            'User-Agent': 'TurboDoc/1.0 (your-github-url)',
          },
        }
      );

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(parseInt(retryAfter || '60'));
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseMetadata(data);
    });
  }

  private async queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.minDelay) {
      await new Promise(resolve => setTimeout(resolve, this.minDelay - elapsed));
    }

    this.lastRequestTime = Date.now();
    return fn();
  }

  private parseMetadata(data: any): CrateMetadata {
    const crate = data.crate;
    return {
      repository: crate.repository || null,
      homepage: crate.homepage || null,
      documentation: crate.documentation || null,
      description: crate.description || '',
      latest_version: crate.newest_version || crate.max_version,
      license: crate.license || null,
      fetchedAt: Date.now(),
    };
  }
}

export const cratesIoClient = new CratesIoClient();
```

**Version grouping logic:**

```typescript
function computeVersionGroups(
  versions: Array<{ num: string; yanked: boolean }>,
  maxGroups: number = 5
): VersionGroup[] {
  const parsed = versions
    .map(v => ({
      ...v,
      parsed: semver.parse(v.num)
    }))
    .filter(v => v.parsed !== null);

  // Sort by semver (newest first)
  parsed.sort((a, b) => semver.rcompare(a.parsed!, b.parsed!));

  const latest = parsed[0];
  const groups: VersionGroup[] = [];

  // Always show latest
  groups.push({
    label: `${latest.num} (latest)`,
    version: latest.num,
    isLatest: true,
    isPrerelease: latest.parsed!.prerelease.length > 0,
    isYanked: latest.yanked,
  });

  // Show unique major.minor versions (exclude latest)
  const seen = new Set([`${latest.parsed!.major}.${latest.parsed!.minor}`]);

  for (const v of parsed.slice(1)) {
    const key = `${v.parsed!.major}.${v.parsed!.minor}`;
    if (!seen.has(key) && groups.length < maxGroups) {
      seen.add(key);
      groups.push({
        label: v.num,
        version: v.num,
        isLatest: false,
        isPrerelease: v.parsed!.prerelease.length > 0,
        isYanked: v.yanked,
      });
    }
  }

  return groups;
}
```

**Error handling:**
- Rate limit (429): Throw `RateLimitError` with retry delay
- Not found (404): Throw `CrateNotFoundError`
- Network error: Throw with retry suggestion
- Graceful degradation: Show crate with `metadata: null` and `metadataError` message

**Caching:**
- Metadata cached for 24 hours (check `fetchedAt` timestamp)
- Only re-fetch if `Date.now() - fetchedAt > 86400000` (24h in ms)

---

## Phase 3: UI Component Structure

### 3.1 Component Hierarchy

```
App (contains WorkspaceContext)
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
    ├── Page[] (docs_pages, with pin/unpin icons)
    │   └── Italic styling if page.path === docs_open_page && !page.pinned
```

### 3.2 Component Details

#### **Explorer Component** (`frontend/explorer/index.tsx`)
- Main container for sidebar
- Manages search state and results
- Renders group list and add group button

#### **SearchBar Component** (`frontend/explorer/search-bar.tsx`)
- Single input field: "Search crate and page"
- Debounced search (300ms)
- Triggers docs.rs search API
- Shows loading state
- Clears on Escape

#### **SearchResults Component** (`frontend/explorer/search-results.tsx`)
- Dropdown/modal below search bar
- Lists matching crates
- Click → adds crate to ungrouped group
- Fetches metadata via crates.io API

#### **GroupList Component** (`frontend/explorer/group-list.tsx`)
- Renders ungrouped group first (special styling)
- Then renders all other groups
- Handles reordering (future: drag-and-drop)

#### **Group Component** (`frontend/explorer/group.tsx`)
- Collapsible group with header
- Group name (editable on click)
- Delete group button (with confirmation)
- Contains multiple CrateCard components
- Uses Radix Collapsible for expand/collapse

#### **CrateCard Component** (`frontend/explorer/crate-card.tsx`)
- Card layout with:
  - **Header section:**
    - Crate icon (Rust logo or custom)
    - Crate name (clickable → navigate to home)
    - External links (crates.io, repo) with icons
    - Version combobox
    - "..." menu button
  - **Page list section** (collapsible):
    - Home link (always visible)
    - Half-open page (italic, with pin icon)
    - Pinned pages (with unpin icon)

#### **VersionCombobox Component** (`frontend/explorer/version-combobox.tsx`)
- Uses Radix Select
- Shows version groups (max 5)
- Latest version in group → green indicator
- Older version in group → grey/dim
- "latest" option at top
- Selecting version → updates current_version, reloads iframe

#### **CrateMenu Component** (`frontend/explorer/crate-menu.tsx`)
- Dropdown from "..." button (Radix DropdownMenu)
- Options:
  - Move to group → submenu with group list
  - Remove crate (with confirmation)
  - Refresh metadata (re-fetch from crates.io)

#### **PageList Component** (`frontend/explorer/page-list.tsx`)
- Collapsible list (can hide to save space)
- **Home page:** Always present, clicking navigates to `docs.rs/{crate}/{version}/{crate}`
- **Half-open page:** Italic text, pin icon button
- **Pinned pages:** Normal text, unpin icon button
- Click page → navigate iframe
- Pin/unpin actions → update workspace state

---

## Phase 4: State Management

### 4.1 WorkspaceContext with Immer

**Update `app.tsx`** - Use Immer for all state mutations:

```typescript
import { produce } from 'immer';
import { useDebouncedCallback } from 'use-debounce';

interface WorkspaceState {
  workspace: Workspace | null;
  loading: {
    workspace: boolean;
    metadata: Map<string, boolean>;  // Track per-crate loading
  };
  errors: {
    workspace: string | null;
    metadata: Map<string, string>;   // Track per-crate errors
  };
}

const WorkspaceContext = createContext<{
  state: WorkspaceState;
  actions: {
    addCrate: (crateName: string, groupIndex?: number) => Promise<void>;
    removeCrate: (crateName: string) => void;
    moveCrate: (crateName: string, toGroupIndex: number) => void;
    addGroup: (name: string) => void;
    removeGroup: (index: number) => void;
    updateCrateVersion: (crateName: string, version: string) => void;
    pinPage: (crateName: string, pagePath: string) => void;
    unpinPage: (crateName: string, pagePath: string) => void;
    setOpenPage: (crateName: string, pagePath: string) => void;
    refreshMetadata: (crateName: string) => Promise<void>;
  };
  iframeRef: React.RefObject<HTMLIFrameElement>;
}>(undefined!);
```

**Key implementation details:**

1. **Use Immer's `produce` for all mutations:**
   ```typescript
   const pinPage = (crateName: string, pagePath: string) => {
     setWorkspace(produce(draft => {
       const crate = findCrateInWorkspace(draft, crateName);
       if (!crate) return;

       const page = crate.docs_pages.find(p => p.path === pagePath);
       if (page) {
         page.pinned = true;
       } else {
         crate.docs_pages.push({ path: pagePath, pinned: true, title: undefined, lastAccessed: Date.now() });
       }
     }));
   };
   ```

2. **Auto-save with proper debouncing:**
   ```typescript
   const debouncedSave = useDebouncedCallback(
     (workspace: Workspace) => {
       saveWorkspace(workspace).catch(err => {
         console.error('Failed to save workspace:', err);
         // Optionally show toast notification
       });
     },
     500,
     { maxWait: 2000 }  // Ensure save within 2s max
   );

   useEffect(() => {
     if (!state.workspace || state.loading.workspace) return;
     debouncedSave(state.workspace);
   }, [state.workspace]);
   ```

3. **Handle IPC navigation events:**
   ```typescript
   useEffect(() => {
     return on('navigated', (event) => {
       const parsed = parseDocsRsUrl(event.url);
       if (!parsed) return;

       setWorkspace(produce(draft => {
         if (!draft) return;

         let crate = findCrateInWorkspace(draft, parsed.crate);

         // Auto-add crate if not in workspace (cross-crate navigation)
         if (!crate) {
           const newCrate = createDefaultCrate(parsed.crate, parsed.version);
           draft.ungrouped.push(newCrate);
           crate = newCrate;
           // Trigger metadata fetch asynchronously
           fetchAndUpdateMetadata(parsed.crate);
         }

         // Update open page
         crate.docs_open_page = parsed.page;

         // Add to docs_pages if not already present
         if (!crate.docs_pages.some(p => p.path === parsed.page)) {
           // Replace existing unpinned page (like VS Code behavior)
           const unpinnedIndex = crate.docs_pages.findIndex(p => !p.pinned);
           if (unpinnedIndex >= 0) {
             crate.docs_pages.splice(unpinnedIndex, 1);
           }
           crate.docs_pages.push({
             path: parsed.page,
             pinned: false,
             lastAccessed: Date.now(),
           });
         }

         // Update iframe URL
         if (iframeRef.current) {
           iframeRef.current.src = event.url;
         }
       }));
     });
   }, []);
   ```

**Rationale:**
- **Removed NavigationContext**: Over-engineering - iframe URL and navigation state managed in WorkspaceContext
- **Immer**: Simplifies deeply nested state updates
- **Error tracking**: Allows components to show loading/error states per crate
- **Name-based actions**: Cleaner API than index-based (avoids index invalidation on reorder)

---

## Phase 5: IPC Integration

### 5.1 Fix `frontend/ipc.ts` - Add Timeout Handling

**CRITICAL FIX:** Current `waitResponse` never rejects, which could cause hangs.

```typescript
function waitResponse<T extends IPCResponse>(
  type: T['type'],
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete ipcResponseHandlers[type];
      reject(new Error(`IPC timeout waiting for ${type}`));
    }, timeoutMs);

    ipcResponseHandlers[type] = (response: IPCResponse) => {
      clearTimeout(timeout);
      delete ipcResponseHandlers[type];
      resolve(response as T);
    };
  });
}

export async function loadWorkspace(): Promise<Workspace> {
  const chrome = (window as any).chrome;
  chrome?.webview?.postMessage({ type: 'load-workspace' });

  try {
    const response = await waitResponse<IPCWorkspaceLoaded>('workspace-loaded', 5000);
    if (response.success) {
      return JSON.parse(response.content);
    } else {
      throw new Error(response.message || 'Failed to load workspace');
    }
  } catch (err) {
    console.error('Workspace load error:', err);
    // Return empty workspace as fallback
    return { groups: [], ungrouped: [] };
  }
}
```

### 5.2 URL Parsing Utility

**Create `frontend/utils/url-parser.ts`:**

```typescript
export interface ParsedDocsUrl {
  crate: string;
  version: string;
  page: string;
}

export function parseDocsRsUrl(url: string): ParsedDocsUrl | null {
  try {
    const parsed = new URL(url);

    // Only handle docs.rs URLs
    if (parsed.hostname !== 'docs.rs') {
      return null;
    }

    // Pattern: /crate/version/path/to/page.html
    const pathMatch = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+)\/(.+)$/);
    if (!pathMatch) {
      return null;
    }

    const [, crate, version, page] = pathMatch;

    return {
      crate,
      version,
      page,
    };
  } catch {
    return null;
  }
}

// Helper to construct docs.rs URL
export function buildDocsRsUrl(crate: string, version: string, page?: string): string {
  const base = `https://docs.rs/${crate}/${version}`;
  if (page) {
    return `${base}/${page}`;
  }
  // Default to crate root page
  return `${base}/${crate}`;
}
```

### 5.3 Event Handling in App Component

**Navigation event already covered in Phase 4** - See WorkspaceContext implementation for details on handling IPC "navigated" events.

---

## Phase 6: Styling and UX

### 6.1 Visual Design

**Explorer Panel:**
- Background: `hsl(var(--background))`
- Border right: subtle divider
- Padding: 16px
- Max width: 400px, min width: 200px

**Search Bar:**
- Full width with icon (magnifying glass)
- Rounded corners
- Focus state: ring/outline

**Group:**
- Ungrouped group: lighter background, "Not Yet Grouped" label
- Regular groups: card-like appearance
- Hover effects on headers
- Smooth expand/collapse animation

**Crate Card:**
- Card component from shadcn/ui
- Compact layout
- External link icons (lucide-react: ExternalLink)
- Version dropdown: compact, aligned right
- Menu button: subtle, appears on hover

**Page List:**
- Indented under crate
- Home: house icon (lucide-react: Home)
- Half-open page: italic, pin icon (lucide-react: Pin)
- Pinned page: unpin icon (lucide-react: PinOff)
- Hover: highlight background
- Active page: accent background

### 6.2 Icons

Use **lucide-react**:
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

## Phase 7: Implementation Steps

### Step 1: Update Data Model
- Modify `frontend/data.ts` with new interfaces
- Add helper functions for version grouping

### Step 2: Crates.io API Service
- Create `frontend/services/crates-api.ts`
- Implement fetch functions
- Add version grouping logic
- Add error handling

### Step 3: URL Parser Utility
- Create `frontend/utils/url-parser.ts`
- Handle docs.rs URL formats
- Add tests for edge cases

### Step 4: State Management
- Update WorkspaceContext in `app.tsx`
- Create NavigationContext
- Add auto-save with debouncing
- Wire up IPC handlers

### Step 5: Build Components (Bottom-Up)
1. **Leaf components:**
   - VersionCombobox
   - CrateMenu
   - SearchBar
2. **Composite components:**
   - PageList
   - CrateCard
   - Group
3. **Container components:**
   - GroupList
   - SearchResults
   - Explorer

### Step 6: Integration
- Wire components to contexts
- Connect navigation flow
- Test IPC communication
- Verify persistence

### Step 7: Polish
- Add loading states
- Error boundaries
- Accessibility (ARIA labels)
- Keyboard shortcuts (future enhancement)

---

## Critical Files to Modify

1. **[frontend/data.ts](frontend/data.ts)** - Data model updates
2. **[frontend/app.tsx](frontend/app.tsx)** - Context and IPC integration
3. **[frontend/explorer/index.tsx](frontend/explorer/index.tsx)** - Main explorer component
4. **New files:**
   - `frontend/services/crates-api.ts` - API integration
   - `frontend/utils/url-parser.ts` - URL parsing
   - `frontend/contexts/navigation.tsx` - Navigation state
   - `frontend/explorer/search-bar.tsx`
   - `frontend/explorer/search-results.tsx`
   - `frontend/explorer/group-list.tsx`
   - `frontend/explorer/group.tsx`
   - `frontend/explorer/crate-card.tsx`
   - `frontend/explorer/version-combobox.tsx`
   - `frontend/explorer/crate-menu.tsx`
   - `frontend/explorer/page-list.tsx`

---

## Design Decisions & Trade-offs

### Data Model: Half-Open Page (Derived State)
- **Decision:** Remove `docs_half_open_page` field, derive from `docs_pages` instead
- **Rationale:** Avoids state duplication and sync issues; half-open is just `docs_pages.find(p => p.path === docs_open_page && !p.pinned)`
- **Trade-off:** Slightly more computation on render (negligible, worth the simplification)

### Data Model: Ungrouped as Array
- **Decision:** `ungrouped: ItemCrate[]` instead of `ungrouped: Group`
- **Rationale:** Simpler data structure, no group name/expansion state needed, easier to work with
- **Trade-off:** Special-case rendering logic (acceptable, clearer separation)

### State Management: Immer for Mutations
- **Decision:** Use Immer's `produce` for all workspace state updates
- **Rationale:** Dramatically simplifies deeply nested updates, prevents mutation bugs
- **Trade-off:** Small bundle size increase (~13KB) (worth it for code clarity)

### State Management: Remove NavigationContext
- **Decision:** No separate NavigationContext, manage iframe in WorkspaceContext
- **Rationale:** Avoids redundant state and sync issues, simpler architecture
- **Trade-off:** WorkspaceContext is slightly larger (acceptable, still cohesive)

### API: Rate Limiting
- **Decision:** Enforce 1-second delay between crates.io API requests
- **Rationale:** Follows crates.io crawler policy, prevents rate limiting errors
- **Trade-off:** Slower when adding many crates rapidly (necessary for API compliance)

### API: Metadata Caching
- **Decision:** Cache crate metadata for 24 hours in workspace state
- **Rationale:** Reduces API calls, improves startup performance, metadata rarely changes
- **Trade-off:** Stale data possible (acceptable, can manually refresh)

### Version Grouping Algorithm
- **Decision:** Show latest + 4 unique major.minor versions, handle pre-release and yanked
- **Rationale:** Matches crates.io UX, covers 99% of use cases, handles edge cases correctly
- **Trade-off:** Users can't select older patch versions directly (acceptable for docs viewer)

### IPC: Timeout Handling
- **Decision:** Add 5-second timeout to all IPC requests
- **Rationale:** Prevents infinite hangs if backend crashes or IPC fails
- **Trade-off:** False positives if backend is slow (unlikely, 5s is generous)

### Navigation: Auto-Add Crates
- **Decision:** Auto-add crates to ungrouped when navigating to unknown crate
- **Rationale:** Seamless cross-crate navigation, discoverability
- **Trade-off:** Workspace can grow large (acceptable, user can remove)

### Search Implementation
- **Decision:** Use crates.io search API (`/api/v1/crates?q=...`)
- **Rationale:** Well-documented, supports both crate name and description search
- **Trade-off:** No docs.rs-specific search (acceptable, crates.io is canonical)
- **Note:** Need to verify CORS support or proxy through backend if blocked

### Drag-and-Drop
- **Decision:** Defer to future version, use menu for V1
- **Rationale:** Menu is simpler to implement, drag-and-drop can be added incrementally
- **Trade-off:** Less intuitive UX initially (acceptable for MVP)

### Auto-Save Timing
- **Decision:** Debounce 500ms, max wait 2 seconds
- **Rationale:** Balance between data safety and IPC overhead
- **Trade-off:** Potential data loss on crash within 500ms window (acceptable risk)

---

## Open Questions & Assumptions

### Assumptions Made:
1. **Crates.io API CORS**: Assuming CORS is enabled; will verify during implementation
   - Fallback plan: Proxy API calls through Rust backend if CORS blocked
2. **Semver compliance**: All crate versions follow semver format (enforced by crates.io)
3. **Single half-open page**: Each crate has at most one unpinned page at a time (like VS Code)
4. **No nested groups**: Groups cannot contain other groups (flat structure)
5. **Page paths**: Always relative URLs from docs.rs root

### Items to Verify During Implementation:
1. **CORS support**: Test fetch to `https://crates.io/api/v1/crates/serde` from WebView2
2. **User-Agent requirement**: Confirm crates.io accepts our User-Agent string
3. **Search API format**: Verify crates.io search response structure
4. **Immer compatibility**: Ensure Immer works correctly with Map/Set in error/loading state

### Resolved Clarifications:
All initial questions answered by user - design is well-defined.

---

## Success Criteria

✅ Users can search and add crates to workspace
✅ Crates display with metadata, version selection, and external links
✅ Users can organize crates into named groups
✅ Navigation in iframe updates explorer state automatically
✅ Users can pin/unpin documentation pages
✅ Half-open page system works like VS Code tabs
✅ Workspace persists across app restarts
✅ UI is responsive and matches design mockup
✅ All interactions are smooth with proper loading/error states

---

## Future Enhancements (Out of Scope)

- Drag-and-drop for reordering crates and groups
- Multiple documentation sources beyond docs.rs
- Offline mode improvements
- Full-text search within cached docs
- Keyboard shortcuts (Cmd+K for search, Cmd+P for pages, etc.)
- Dark/light theme toggle (currently forced dark by backend)
- Export/import workspace
- Page title extraction from HTML
- Toast notifications for errors/success
- Workspace size limits and warnings

---

## Key Improvements from Architectural Review

This plan incorporates critical fixes identified during architectural review:

### Critical Fixes Applied:
1. **Data Model Simplification**
   - Removed `docs_half_open_page` field (derive from `docs_pages` instead)
   - Changed `ungrouped` from Group to `ItemCrate[]` (simpler, clearer)
   - Added proper `DocsPage` interface with metadata

2. **IPC Reliability**
   - Added timeout handling to `waitResponse()` (prevents hangs)
   - Added fallback empty workspace on load failure
   - Proper error propagation

3. **API Integration**
   - Implemented rate limiting (1-second delay between requests)
   - Added retry logic for 429 responses
   - Proper User-Agent header for crawler policy compliance

4. **Version Grouping Algorithm**
   - Fixed to handle pre-release versions (alpha, beta, rc)
   - Added yanked version support
   - Uses `semver` package for correct parsing and sorting

5. **State Management**
   - Integrated Immer for clean, bug-free mutations
   - Added error/loading state tracking per crate
   - Removed NavigationContext (unnecessary complexity)
   - Name-based actions instead of index-based (more robust)

6. **Edge Cases Handled**
   - Cross-crate navigation (auto-add to ungrouped)
   - Version mismatch navigation
   - Metadata fetch failures (graceful degradation)
   - IPC timeout scenarios

### Architecture Improvements:
- Cleaner component hierarchy with explicit ungrouped section
- Better separation of concerns (no redundant contexts)
- Proper debouncing with `use-debounce` library
- Type guards for safer type narrowing
- React.memo optimization points identified

This revised design is production-ready with proper error handling, rate limiting, and robust state management.

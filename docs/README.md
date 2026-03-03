# TurboDoc Frontend Documentation

## Overview

TurboDoc is a universal documentation viewer with local caching and workspace management. The app displays documentation in an iframe with a sidebar explorer for managing items, versions, and pages.

The frontend uses a **multi-provider architecture** where each documentation source (e.g., Rust crates) is implemented as a `Provider` plugin that returns a uniform view model.

**Key Features:**
- Multi-provider documentation viewing (currently: unified Rust provider)
- Search and add crates from crates.io
- Version selection with intelligent grouping
- Pin/unpin documentation pages (VS Code-style tabs)
- Named groups for organizing items
- Workspace persistence via Hono HTTP API
- Automatic cross-crate navigation
- Symbol parsing with One Dark color coding

---

## Requirements & Design Goals

### User Experience Goals

#### Primary Workflows
1. **Quick Reference**: Users quickly jump between documentation pages across multiple crates
2. **Learning**: Users explore API documentation while reading related types/modules
3. **Cross-referencing**: Users follow links between crates and keep relevant pages accessible

#### Interaction Patterns

**Navigation:**
- Clicking page in sidebar loads in iframe
- Navigating in iframe triggers `navigated` WebView2 event, auto-detects crate
- Navigating to a new page appears as "preview" page (not pinned)
- Clicking pin icon promotes preview page to pinned
- Only one preview page per crate (like VS Code tabs)

**Organization:**
- Menu-based move between groups
- Create named groups with "+ Add Group" button
- Rename groups by clicking pencil icon
- Expand/collapse groups with chevron toggle
- Delete groups with confirmation
- Items within groups auto-sorted by `sortKey`
- Move groups up/down/under via dropdown menu

**Version Management:**
- Version selector shows recommended versions (latest + semver-grouped)
- Changing version reloads iframe with new version URL
- Current version persisted per-item in workspace
- Auto-sync: version selector updates when iframe navigates to different version

### Feature Requirements

#### Implemented
- Search and add crates from crates.io (via provider import action)
- Display crate metadata (description, links)
- Version selection with intelligent grouping
- Pin/unpin documentation pages
- Preview page system (VS Code-style)
- Symbol type color coding (One Dark theme)
- Named groups for organization
- Workspace persistence across sessions
- Automatic cross-crate navigation (navigated event)
- Move items between groups via menu
- Import crates from docs.rs URLs
- Unified Rust provider (docs.rs + doc.rust-lang.org + windows-docs-rs)

#### Remaining
- Unified search bar (deferred to post-v0.2)
- Preset picker UI
- Loading states and error handling
- Keyboard shortcuts
- Toast notifications

### Performance Goals

- **Instant navigation**: Page changes feel immediate (<100ms perceived latency)
- **Smooth scrolling**: 60fps scrolling in explorer and iframe
- **Efficient rendering**: Large workspaces (50+ crates) remain responsive
- **Small bundle**: Frontend JS bundle <500KB gzipped

---

## Architecture Overview

### Core Metaphor

TurboDoc is an "enhanced tabbed browser with inactive tab resources released" — not a hierarchical resource manager. The tree depth is strictly limited.

### Core Principles

1. **Familiarity**: Borrows patterns from VS Code (tabs, sidebar, preview pages)
2. **Efficiency**: Minimizes clicks to access frequently-used pages
3. **Clarity**: Always shows current state (active page, version, pin status)
4. **Forgiveness**: Auto-save, confirmation for destructive actions
5. **Progressive disclosure**: Collapses details by default, expands on demand
6. **Performance**: Optimized for large workspaces (50+ crates)

### Three-Layer Architecture

| **Component** | **Tech Stack** | **Role** | **Key Responsibilities** |
|---|---|---|---|
| **Host** | C# WinUI 3 (.NET 10) + WebView2 | **The Shell** | Window management. Intercepts doc URL requests and forwards them to the server's `/proxy?url=` endpoint. Sends `navigated` events to frontend via `PostWebMessageAsJson`. Opens external URLs in system browser. |
| **Server** | TypeScript (Bun + Hono) | **The Brain** | REST endpoints for split workspace persistence (`/api/v1/workspace/app`, `/workspace/:providerId`). HTTP proxy with SQLite caching and LRU eviction (`/proxy?url=`). Dark mode injection at serve time. Serves frontend assets via Vite middleware. |
| **Frontend** | React + Vite | **The Face** | UI rendering (Explorer, Navigation). Fetches data from `/api/v1/*` via `hono/client`. Provider-based architecture for multi-source docs. |

### Request Flow

```
WebView2 iframe navigates to https://docs.rs/serde/latest/serde/
  │
  ├─ OnFrameNavigationStarting: post "navigated" event to frontend
  │
  └─ OnWebResourceRequested (GET, ProxiedUrls match):
       │
       │  C# host forwards to Bun:
       │  GET http://localhost:$TURBODOC_PORT/proxy?url=https%3A%2F%2Fdocs.rs%2Fserde%2Flatest%2Fserde%2F
       │
       └─ Bun /proxy handler:
            ├─ Cache HIT + fresh?  → serve cached body + dark mode injection
            ├─ Cache HIT + stale?  → conditional revalidation (If-None-Match / If-Modified-Since)
            │    ├─ 304 Not Modified → update policy, serve cached body
            │    └─ 2xx             → replace cache entry, serve new body
            └─ Cache MISS          → fetch upstream, cache if storable, serve
```

### Technology Stack

- **Frontend**: React 19 + TypeScript (strict mode)
- **Build**: Vite 7 with React SWC plugin
- **State Management**: Immer (`useImmer`) for immutable updates
- **Type Utilities**: type-fest for `ReadonlyDeep` type-level immutability
- **UI Components**: Radix UI primitives + shadcn/ui (vendored in `3rdparty/shadcn/`)
- **Styling**: Tailwind CSS v4 with OKLCH color space
- **Icons**: Font Awesome
- **Utilities**: remeda (functional), semver, zod
- **Server**: Bun + Hono (API + HTTP proxy with SQLite cache) + Vite (middleware mode) on `$TURBODOC_PORT`
- **Host**: C# WinUI 3 (.NET 10) + WebView2 — window management and request forwarding
- **IPC**: Hono HTTP API for CRUD + WebView2 `PostWebMessageAsJson` for navigation events

### Sidebar Layout

```
┌─────────────────────────────────┐
│ [+ Import Crates]               │  ← Provider action (rust)
├─────────────────────────────────┤
│   ▶ Ungrouped                   │  ← Ungrouped items
│   ▼ My Project                  │  ← Group (expanded)
│       tokio                     │
│       async-std                 │
│   ▶ Utilities                   │  ← Group (collapsed)
│   [+ Add Group]                 │  ← Create group button
└─────────────────────────────────┘
```

### Component Hierarchy

```
src/index.tsx (entry point, appData loading, uiState from localStorage, auto-save)
└── AppContextProvider
    └── App (ResizablePanelGroup)
        ├── Explorer (left panel)
        │   └── ExplorerProvider (per provider in preset; owns provider data + cache)
        │       ├── ProviderAction nodes (e.g., Import dialog)
        │       ├── ExplorerGroup (variant="ungrouped")
        │       │   ├── ExplorerGroupHeader (variant="ungrouped")
        │       │   └── ExplorerItem[] (sorted by sortKey)
        │       ├── ExplorerGroup[] (variant="default", per group in groupOrder)
        │       │   ├── ExplorerGroupHeader (collapsible, editable name, dropdown menu)
        │       │   └── ExplorerItem[] (sorted by sortKey, shown when group expanded)
        │       └── ExplorerCreateGroupComponent
        └── iframe (right panel, docs viewer)
```

**ExplorerItem structure:**
```
ExplorerItem (Radix Collapsible)
├── Item name (clickable, toggles collapse)
├── ExplorerItemVersionSelector (shadcn Select, if item.versions exists)
├── ExplorerItemMenu (DropdownMenu: move to group, links, actions)
└── CollapsibleContent
    └── ExplorerPageList
        └── ExplorerPage[] (sorted by sortKey)
            ├── ExplorerPageName (text or symbol with color coding)
            └── ExplorerPagePinningButton (pin/unpin icon)
```

### Component Responsibilities

- **Explorer** (`ui/explorer/index.tsx`): Top-level container; iterates providers in current preset
- **ExplorerProvider** (inline): Owns per-provider data (`useProviderData`) and cache (`useProviderCache`), constructs `ProviderContext`, calls `provider.render()`, renders provider actions and groups
- **ExplorerGroup** (inline): Renders group header + filtered/sorted items; handles ungrouped vs named variants
- **ExplorerGroupHeader** (`ExplorerGroupHeader.tsx`): Chevron toggle, rename input, dropdown menu (expand/collapse all, move up/down/under, delete with confirmation)
- **ExplorerCreateGroupComponent** (`ExplorerCreateGroupComponent.tsx`): Button that transforms to inline input for creating new groups
- **ExplorerItem** (`ExplorerItem.tsx`): Collapsible card with name, version selector, menu; expansion state via `useProviderUiState`
- **ExplorerItemMenu** (`ExplorerItemMenu.tsx`): Move to group submenu, external links, custom actions
- **ExplorerPageList** (`ExplorerPageList.tsx`): Sorted page list with symbol color coding and pinning buttons

### Identification Scheme

| Entity | Global ID Format | Example |
|--------|------------------|---------|
| Provider | `<provider>` | `rust` |
| Group | `<provider>:<group_name>` | `rust:My Project` |
| Item | `<provider>:<item_name>` | `rust:tokio` |
| Page (global) | Full URL | `https://docs.rs/tokio/latest/tokio/` |
| Page (local) | `<semantic>` | `runtime/struct.Runtime` |

- URLs always start with `https://` (protocol assumed, not stored in some contexts)
- Provider guarantees item name uniqueness within itself
- Group names are unique within a provider (used as keys in `groups` Record)
- Ungrouped items use empty string `""` as the group name

### Provider System

Providers register in `providers/index.ts` and implement the `Provider<T, TCache>` interface from `core/data.ts`. Each provider's `render()` returns a `ProviderOutput` containing:
- `items: Record<string, Item>` — uniform view models with pages, links, actions, versions
- `actions?: ProviderAction[]` — provider-level UI (e.g., import dialog)

View models contain callbacks (e.g., `setPinned`, `setCurrentVersion`, `invoke`) that update provider data via Immer. View models are derived on every render — never memoized, never serialized. See `core/data.ts` for the full type definitions.

**Current:** `rust` (docs.rs + doc.rust-lang.org + windows-docs-rs). **Planned:** `rust.cargo`, `cpp.cppreference`, `cpp.msdocs`, etc.

**Data flow:**
```
[Disk/Storage]                         [Deserialization]         [Runtime]
workspace.app.json ───────────────────► AppContext ──────────────► global state (presets)
workspace.<providerId>.json ──────────► useProviderData ────────► ProviderOutput (View Model)
localStorage (turbodoc:ui-state) ─────► UiState ────────────────► current URL + expansion state
HTTP proxy SQLite cache ──────────────► useProviderCache ───────► in-memory API response cache
```

#### Unified Rust Provider

The `rust` provider (`providers/rust/`) handles three documentation domains as a single provider. Originally planned as separate `rust.crate` and `rust.std` providers, merged for simplicity:
- Both handle Rust documentation with identical page structure
- Symbol parsing and color coding are the same
- Simpler mental model for users (one "Rust" section in sidebar)
- URL routing handled internally via `getBaseUrlForCrate()`

Supported domains:
- **docs.rs** — third-party crates: `https://docs.rs/{crate}/{version}/{path...}`
- **doc.rust-lang.org** — std, core, alloc, proc_macro: `https://doc.rust-lang.org/{crate}/{path...}` (with optional `nightly|stable|1.x.y` version prefix)
- **microsoft.github.io/windows-docs-rs** — `windows` crate only (no versioning in URL)

`getBaseUrlForCrate()` in `url.ts` determines the base URL based on crate name. Other `windows-*` crates (e.g., `windows-sys`, `windows-core`) use docs.rs as usual — only the main `windows` crate uses the microsoft.github.io host.

**Cross-crate navigation:** When the iframe navigates to a URL handled by a different crate (e.g., a docs.rs page links to `doc.rust-lang.org/std/vec/struct.Vec.html`), the provider's `parseUrl()` recognizes both URL patterns and auto-imports the crate if not present.

#### Preset System

Users select a preset to determine which providers appear and their order. Presets are stored in `AppData.presets`. Users can create custom presets. Switching presets doesn't delete provider data — it's preserved but hidden. The preset picker UI is not yet built.

```typescript
const presets = {
  "Rust": { providers: ["rust"] },
  "Empty": { providers: [] },
};
```

#### Cross-Provider Navigation (Future)

Currently handled within the unified `rust` provider (cross-crate). When multiple providers exist, the planned algorithm:
1. Each provider attempts to parse the navigated URL (provider-specific `parseUrl`)
2. First matching provider handles the import
3. Auto-import to target provider
4. Navigate to the new page

---

## Development Workflow

### Running the Dev Server

```
just server    # Starts Bun + Hono API/proxy + Vite dev server on $TURBODOC_PORT
just app       # Starts C# WinUI host (dotnet run), connects to server at $TURBODOC_PORT
```

The server and host are started separately. The server must be running before the host is launched.

### Mandatory Implementation Rules

1. **Top-to-Down, Incremental Implementation**
   - Start from the top of the visual hierarchy
   - Implement one component at a time from parent to children
   - Complete each component fully (styling, interaction, error states) before moving to the next

2. **Immediate Visual Feedback with HMR**
   - Leverage Hot Module Replacement for instant visual feedback
   - Test all interactive states (hover, click, expand, collapse, loading, error)
   - Iterate on the component until it's visually and functionally correct

3. **Update Plan Document After Each Component**
   - Mark completed components with checkmarks in the plan document
   - Add notes about implementation decisions or deviations from plan

---

## Visual Design System

### Colors
- Based on existing Tailwind theme in `global.css`
- OKLCH color space for perceptual uniformity
- Dark background with high-contrast text
- Accent color for active/selected states
- Muted colors for secondary information

### One Dark Symbol Colors (CSS variables in `global.css`)
- Yellow (`--color-yellow`): type (struct, enum)
- Cyan (`--color-cyan`): interface (trait)
- Blue (`--color-blue`): function
- Orange (`--color-orange`): macro, constant
- Default: namespace (module), unknown

### Typography
- Monospace font for item names and page links (`font-mono`)
- Clear hierarchy: group names (`text-lg font-semibold`) > item names (`font-mono`) > page links (`font-mono font-light`)
- Italic for preview pages (emphasis without weight)
- Base font size: 14px (set in `:root` in `global.css`)
- Font families: Ubuntu Light (sans) and Ubuntu Mono (monospace)

### Spacing
- Compact 8px grid for information density
- Comfortable 16px padding for panels
- Consistent 4px gaps between UI elements
- Card padding: 12px (`p-3`)

### Icons (Font Awesome)

| Component | Icon | Usage |
|-----------|------|-------|
| External Link | `faArrowUpRightFromSquare` | Item external links |
| Pin | `faThumbtack` | Pin/unpin button for pages |
| Menu | `faEllipsisVertical` | Item/group actions menu |
| Expand All | `faAnglesDown` | Expand all items in group |
| Collapse All | `faAnglesUp` | Collapse all items in group |
| Move Up | `faArrowUp` | Move group up |
| Move Down | `faArrowDown` | Move group down |
| Move to Top | `faArrowUpFromBracket` | Move group to top |
| Move Under | `faRightToBracket` | Move group under another |
| Move to Group | `faRightToBracket` | Move item to another group |
| Rename | `faPencil` | Rename group |
| Add | `faPlus` | Add group button |
| Confirm | `faCheck` | Confirm rename/add |
| Delete | `faTrash` | Delete group/item |
| More Versions | `faEllipsis` | Version selector placeholder |
| Chevron | `faChevronDown` / `faChevronRight` | Group expand/collapse |

---

## Design Decisions

Design decisions that shaped the current architecture. Organized by area.

### Architecture

**Dynamic Provider Dispatch**
- Providers register themselves with a common `Provider` interface (dynamic dispatch)
- Shared code only knows the interface, cannot access provider-specific internals
- Adding a new provider is isolated work — no central type modifications
- Separation of concerns is enforced by the type system, not just convention

**API Response Caching via HTTP Proxy**
- Provider API calls (e.g., crates.io) are routed through the server's `/proxy?url=` endpoint
- The proxy's SQLite cache handles persistence, RFC 7234 freshness, conditional revalidation, and LRU eviction
- Frontend keeps an in-memory cache (`useProviderCache` → `useImmer({})`) for within-session state — not persisted, starts empty on each app launch
- No separate cache files, endpoints, or schema validation needed — the proxy is the single caching layer

**Data Model vs View Model**

| Aspect | Data Model | View Model |
|--------|------------|------------|
| Purpose | Storage/serialization format | Runtime with behavior |
| Provider data | `unknown` at app level | Uniform structure |
| Type casting | Single point: deserialization | Already typed |
| Location | Persisted (IPC) | Derived in memory |

- Clean separation between what's stored and what's displayed
- Provider-specific data stays opaque at app level — type safety at boundaries
- View models contain callbacks — never serialized, derived fresh each render
- Single point of type casting reduces runtime type errors

**URL Routing**
- URL routing (`parseUrl`, `buildUrl`) is provider-specific, not part of the `Provider` interface
- No central dispatch; each provider handles its own URL patterns
- rust.std version handling: stable/nightly for now; specific version selection (1.83.0, etc.) supported later

**Import Mechanism**
- No `importItem` method on the `Provider` interface — import UI varies too much between providers
- Instead, providers render custom import UI via `ProviderAction` with `type: "node"` (React components)
- More flexible than a standardized import method

**Migration & Compatibility**
- Server-side auto-migration: on startup, if legacy `workspace.json` exists, splits it into `workspace.app.json` and `workspace.<providerId>.json`, then renames the original to `workspace.json.migrated` (UI state is dropped — starts fresh from localStorage)
- On startup, if workspace files don't exist or don't match expected format, initialize with empty defaults
- Provider ID `"app"` is reserved (collides with static endpoint path)

**Provider API Surface**
- No `serialize`/`deserialize` methods — view model callbacks operate data directly via Immer
- No provider collapsing in sidebar — provider visibility controlled solely by preset

**"Dumb Pipe" Delegate Pattern**
- All proxy and caching logic lives in the Bun server, not in the WebView2 event loop
- The C# host is a thin forwarding shim — intercepts doc URL requests and delegates to the server's `/proxy?url=` endpoint
- Decouples host (windowing) from logic (caching/parsing), improving maintainability and type safety

**Architectural Constraints**
- No URL Rewriting: the WebView still believes it is browsing `docs.rs` directly
- No SSL Proxy: proxying happens after WebView2 intercepts the request intent
- Configurable Port: combined server (Hono API + proxy + Vite dev server) port set via `$TURBODOC_PORT` env var (required)

**Dark Mode Injection (Serve-Time)**
- Cache stores clean upstream content; dark mode injection applied at serve time
- Technique: insert `<script>window.localStorage.setItem('rustdoc-theme', 'dark');</script>` after `<meta charset="UTF-8">` in rustdoc HTML responses
- Benefits: change injection logic without invalidating cache; could later make dark mode a user preference toggle

### Data Model

**Split Workspace Persistence**
- Workspace split into two server-persisted file categories:
  - `workspace.app.json` — global app state (presets). Loaded eagerly in `index.tsx`.
  - `workspace.<providerId>.json` — per-provider user data (groups, provider-specific data). Loaded lazily per-provider by `useProviderData` hook.
- Transient UI state (`currentUrl`, `expandedItems`, `expandedGroups`) stored in **localStorage** (`turbodoc:ui-state`), not on the server. Loaded synchronously on startup, auto-saved on every change. Validated with Zod `uiStateSchema` on load; invalid/missing data falls back to empty defaults (default URL `https://docs.rs/`, everything collapsed).
- API response caching (e.g., crates.io metadata) handled by the HTTP proxy's SQLite cache — no separate cache files or endpoints. Provider keeps an in-memory cache (`useProviderCache` → `useImmer({})`) for within-session state, populated on demand from proxy responses.
- Server-persisted via Hono HTTP API (`/api/v1/workspace/app`, `/workspace/:providerId`)
- `"app"` is a reserved path segment — cannot be used as a provider ID
- Auto-save on every state change (no debouncing — files are small)
- App data save failures are fatal (throw); provider data failures are non-fatal (log + return `{}`)
- Server-side migration: on startup, if legacy `workspace.json` exists, auto-splits into new files and renames original to `.migrated`
- **Provider data write guard**: the server rejects a PUT to `/workspace/:providerId` if the new JSON payload is less than 30% the size of the existing file on disk (HTTP 409). This prevents accidental data loss from frontend bugs or state resets. The check is skipped when the existing file is smaller than 256 bytes, since small files can legitimately shrink by large ratios. Future: a `?force=true` query parameter could bypass the guard for legitimate bulk deletions.

**Preview Page (Derived State)**
- Preview state derived from `uiState.currentUrl` (localStorage) and per-item `pinnedPages`
- A page is "preview" when it matches `currentUrl` but is NOT in `pinnedPages`
- Preview pages render italic with outline pin icon (visible on hover)
- Pinned pages render normal with filled pin icon
- `Page.pinned = null` means pinning is disabled for that page (e.g., home page)

**Provider-Opaque Data**
- `ProviderData.data` is `unknown` at app level — only the provider knows its shape
- Single point of type casting at deserialization boundary
- Enforced by the type system, not just convention

**Eager Cleanup**
- Orphaned UI state entries (`expandedItems`, `expandedGroups`) are removed when content changes
- Prevents stale references from accumulating across workspace mutations

**"latest" as Literal String**
- Version selector stores the literal string `"latest"`, not a resolved version number
- Preserves user intent: automatically picks up new releases without manual update
- Resolved to actual version only when building URLs

### State Management

**View Model Derivation**

```
AppData + ProviderData (React state) ──► provider.render() ──► React render
              │
              └── Immer updates (new refs only for changed parts)
```

- `provider.render()` called on every React render — no memoization
- View models contain callbacks (closures over Immer updaters) — never serialized
- Immer ensures immutable updates with minimal reference changes
- Object creation is fast; DOM updates are the bottleneck — no memoization needed yet
- View model derivation is a pure function of data model — easy to reason about
- `ProviderContext` constructed in `ExplorerProvider` using `useProviderData` and `useProviderCache` hooks from `context.ts`

**Three State Atoms**
- `index.tsx` owns two atoms: `appData` (presets, async from server) and `uiState` (current URL + expansion states, sync from localStorage)
- Provider data is lazily loaded per-provider inside `ExplorerProvider` via `useProviderData` hook
- Each atom has independent auto-save via `useEffect` — a change in one slice doesn't trigger writes to others

**Hybrid IPC**
- App data CRUD via Hono HTTP API (`/api/v1/workspace/app`)
- Per-provider data CRUD via Hono HTTP API (`/api/v1/workspace/:providerId`)
- UI state via localStorage (`turbodoc:ui-state`) — no server round-trip
- API response caching via HTTP proxy (`/proxy?url=`) — SQLite with RFC 7234 freshness and LRU eviction
- Navigation events via WebView2 `postMessage` (low-latency, event-driven)
- All operations except app data are non-fatal (log errors, don't crash)

**Class-Based AppContext**
- AppContext is a class (not a plain object) that owns the iframe ref (`viewerRef`), `appData`, and `uiState`
- Encapsulates navigation logic, hides React state management details from consumers
- Recreated on every render (no memoization) — holds app-level + UI state, so re-renders only happen when state changes
- Provider data is NOT stored in AppContext — each provider loads its own data lazily

**Graceful Degradation**
- Stale proxy cache preferred over no data: if upstream refetch fails, the proxy serves the cached response
- App fully functional without cached API data (loads with empty in-memory cache, fetches on demand via proxy)
- Fetch errors are logged but non-fatal — items render without version selectors or metadata links

### UI Patterns

**Callback-Based Data Flow**
- UI components receive view model objects with callbacks, not raw state
- Components don't call `appContext` directly — decoupled from global state
- Provider-specific logic stays in `Provider.render()`, not in UI code

**ItemLink vs ItemAction Separation**
- `ItemLink` opens URLs (rendered as anchor elements); `ItemAction` invokes callbacks (rendered as buttons)
- Separate types enforce different UI treatment

**Collapsible Items**
- Items use Radix Collapsible (not shadcn Card wrapper — simpler DOM)
- Expansion state stored in centralized `UiState` via `useProviderUiState` hook
- Default: collapsed (both items and groups)
- Toggled by clicking item name

**Group Management**
- Groups stored as `Record<string, { items: string[] }>` with separate `groupOrder` array
- Ungrouped items: those not listed in any group (filtered in ExplorerGroup)
- Rename: atomic update of group key, groupOrder entry, and expandedGroups entry
- Delete: confirmation dialog, removes group key (items become ungrouped)
- Move: up/down/to-top/under-another via dropdown menu

**Symbol Parsing**
- Parse symbol type from docs.rs URL path patterns (e.g., `struct.Name.html`)
- `PageName.type = "symbol"` with `path: { type: IdentType, name: string }[]`
- Language-agnostic `IdentType` mapped to One Dark colors via `getIdentColor()`
- Module path in default color, symbol name colored by type

**Hover States**
- Page pin icon uses Tailwind `group/page` + `invisible group-hover/page:visible` pattern
- Group rename button uses `group/header` + `invisible group-hover/header:visible`
- CSS-only hover is more performant than `useState`

**Auto-Import on Navigation**
- When iframe navigates to an unknown crate, the provider auto-creates an entry
- Enables seamless cross-crate navigation (follow a link → crate appears in sidebar)
- New crates default to `"latest"` version; user can pin pages or change version later

**Version Auto-Sync**
- When iframe navigates to a URL with a different version, the version selector auto-updates
- Handles both `"latest"` and specific version strings
- Ensures the selector always reflects what the user is actually viewing

---

## File Structure

```
TurboDoc/
├── package.json                # Bun project
├── .justfile                   # Task runner (just server, just app)
├── vite.config.ts              # Root: src/, aliases: @/ → src/, @shadcn/ → 3rdparty/shadcn/
├── tsconfig.json               # ESNext, bundler mode, strict
├── biome.json                  # Biome linter (formatter disabled)
├── components.json             # shadcn/ui config (new-york style)
│
│ # C# WinUI host (WebView2 shell)
├── TurboDoc.csproj             # .NET 10, WinUI 3, x64
├── TurboDoc.slnx               # Solution file
├── App.xaml / App.xaml.cs       # WinUI application entry
├── MainWindow.xaml / .xaml.cs   # WebView2 window, request interception, proxy forwarding
├── WindowUtils.cs              # Window sizing and title bar customization
├── App.manifest                # Application manifest
│
├── src/
│   ├── index.html              # Entry HTML
│   ├── index.tsx               # React entry point (workspace loading, auto-save, IPC listener)
│   ├── global.css              # Global styles + One Dark color palette
│   ├── global.tailwind.css     # Tailwind CSS entry point
│   │
│   ├── app/                    # Frontend application code
│   │   ├── core/
│   │   │   ├── data.ts         # Zod schemas + inferred types (AppData, ProviderData, UiState, Provider, Item, Page, etc.)
│   │   │   ├── context.ts      # AppContext class, React context providers and hooks (useProviderData, useProviderCache, useProviderUiState)
│   │   │   ├── ipc.ts          # Hono HTTP client (workspace + cache CRUD) + WebView2 event listener (navigated)
│   │   │   ├── ui-state-storage.ts # localStorage-based UI expansion state (load/save with Zod validation)
│   │   │   └── prelude.ts      # State<T> type helper + cn() utility
│   │   │
│   │   ├── providers/
│   │   │   ├── index.ts        # Provider registry (Record<string, Provider>)
│   │   │   └── rust/           # Unified Rust provider
│   │   │       ├── index.tsx   # Provider implementation (render, URL handling, page parsing, cache types)
│   │   │       ├── url.ts      # URL parsing/building (docs.rs, doc.rust-lang.org, windows-docs-rs)
│   │   │       ├── url.test.ts
│   │   │       ├── import.tsx  # Import dialog (ProviderAction with type: "node")
│   │   │       ├── crates-api.ts                  # crates.io API client (via HTTP proxy) with rate limiting
│   │   │       └── crates-api.integration.test.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── App.tsx         # Main layout (ResizablePanelGroup: explorer + iframe viewer)
│   │   │   ├── common/
│   │   │   │   └── Icon.tsx    # Icon wrapper (FontAwesome)
│   │   │   └── explorer/
│   │   │       ├── index.tsx                       # Explorer, ExplorerProvider, ExplorerGroup
│   │   │       ├── ExplorerGroupHeader.tsx         # Group header (collapse, rename, dropdown menu)
│   │   │       ├── ExplorerCreateGroupComponent.tsx # Add group button/input
│   │   │       ├── ExplorerItem.tsx                # Collapsible item card with version selector
│   │   │       ├── ExplorerItemMenu.tsx            # Item menu (move to group, links, actions)
│   │   │       └── ExplorerPageList.tsx            # Page list with symbol colors + pinning
│   │   │
│   │   └── utils/
│   │       ├── version-group.ts      # Semver version grouping
│   │       └── version-group.test.ts
│   │
│   └── server/
│       ├── index.ts            # Hono router + Vite dev server ($TURBODOC_PORT)
│       ├── api.ts              # API endpoints (split workspace CRUD, legacy migration)
│       ├── proxy.ts            # /proxy?url= route handler + dark mode injection
│       ├── http-cache.ts       # SQLite HTTP cache (bun:sqlite, LRU eviction)
│       └── common.ts           # Shared config, database setup, utilities
│
├── 3rdparty/
│   └── shadcn/                 # Vendored shadcn/ui components
│       ├── components/ui/      # button, card, dialog, dropdown-menu, input, select, separator, etc.
│       └── lib/utils.ts
│
└── docs/
    ├── README.md               # This file
    └── Bug-v0.2-Migration.md   # Bug tracker for v0.2 migration
```

---

## Open Questions & Assumptions

### Assumptions Made

1. **Crates.io API CORS**: Verified — CORS works in WebView2 environment
2. **Semver compliance**: Confirmed — crates.io enforces semver, safe to rely on
3. **Single preview page**: Each crate has at most one preview page at a time (derived from `currentUrl`)
4. **No nested groups**: Groups contain items, not other groups (flat structure)
5. **Item discriminated union**: `ProviderOutput.items` uses `Record<string, Item>` (uniform view model)

### Remaining Items

1. **Unified search**: Deferred to post-v0.2 — will need `Provider` interface extension
   - Single search bar at the top of explorer
   - Each provider that supports search contributes results
   - Results grouped by provider (like PowerToys Run)
   - Providers without search support are skipped
2. **Preset picker UI**: Not yet built — switching presets requires manual workspace edit
3. **Loading/error states**: Not yet implemented — no skeletons, spinners, or error boundaries
4. **Prod build**: Vite prod build not configured — dev mode only via `just server`
5. **Bun as child process**: Dev server started manually via `just server`; auto-launch from host deferred

---

## Success Criteria

### Completed
- [x] Multi-provider architecture with view model derivation
- [x] Workspace/cache persistence via Hono HTTP API
- [x] Unified Rust provider (docs.rs + doc.rust-lang.org + windows-docs-rs)
- [x] Pin/unpin documentation pages with preview page system
- [x] Version selection with semver grouping
- [x] Named groups with full CRUD (create, rename, reorder, delete)
- [x] Move items between groups
- [x] Import crates from docs.rs URLs
- [x] Symbol parsing with One Dark color coding
- [x] Automatic cross-crate navigation via `navigated` event
- [x] Auto-save workspace and cache on every change
- [x] HTTP proxy with SQLite cache and dark mode injection (v0.3)
- [x] C# WinUI 3 host replacing Rust host (v0.3)

### Remaining
- [ ] Unified search bar
- [ ] Preset picker UI
- [ ] Loading/error states
- [ ] Keyboard shortcuts
- [ ] Cross-provider navigation (partially done via unified rust provider)

---

## Change History

- **2026-03**: Move `currentUrl` from server-persisted `appData` to localStorage-backed `uiState`: eliminates HTTP PUT on every navigation, synchronous restore on startup; `appData` now contains only presets
- **2026-03**: Migrate provider cache to HTTP proxy: crates.io API calls routed through `/proxy?url=`, SQLite cache handles persistence and RFC 7234 freshness; removed `cache.<providerId>.json` files, server cache endpoints, cache schema registry (`cache-schemas.ts`), Zod cache schemas (`cache.ts`), and cache IPC functions; `useProviderCache` simplified to in-memory `useImmer({})`
- **2026-03**: UI state moved to localStorage (`turbodoc:ui-state`): synchronous load on startup, no server round-trip; server `/workspace/ui` endpoint and `workspace.ui.json` file removed entirely
- **2026-03**: Fix auto-save race: `useProviderData`/`useProviderCache` now gate saves behind `loadedRef` flag; null-safe access to `ctx.data.crates` in Rust provider
- **2026-03**: Split workspace persistence: `workspace.json` → `workspace.app.json` + `workspace.<providerId>.json` + `workspace.ui.json` with independent endpoints and auto-save; server-side auto-migration from legacy format
- **2026-03**: Merged Plan-v0.3.md into README (three-layer architecture, request flow, server design decisions)
- **2026-03**: Rust host removed entirely; replaced with C# WinUI 3 (.NET 10) + WebView2
- **2026-03**: Bun server completed: HTTP proxy (`/proxy?url=`), SQLite cache with LRU eviction, dark mode injection
- **2026-03**: `data.d.ts` migrated to `data.ts` with Zod-based schema definitions
- **2026-03**: Build system: `.justfile` replaces Nushell scripts; `effect` package removed
- **2026-02**: Merged Plan-v0.2.md into README (architecture decisions, identification scheme, provider details)
- **2026-02**: Updated README to reflect v0.2 architecture (provider system, new component hierarchy, Hono server)
- **2026-02**: Directory restructure: frontend code moved from `frontend/` to `src/app/`
- **2026-02**: IPC migrated from WebView2 postMessage to Hono HTTP API for workspace/cache CRUD
- **2026-01**: Unified Rust provider: merged docs.rs + doc.rust-lang.org + windows-docs-rs
- **2026-01**: Provider-based architecture (Plan-v0.2): dynamic dispatch, view model pattern
- **2026-01**: Import feature: bulk-add crates from docs.rs URLs
- **2026-01**: Group management: add, rename, reorder (up/down/under), delete with confirmation
- **2026-01**: Symbol parsing with One Dark color coding
- **2026-01**: Switched from Lucide React to Font Awesome icons
- **2026-01**: Set 14px base font size, Ubuntu fonts
- **2026-01**: Collapsible groups + auto-sorting by `sortKey`
- **2026-01**: Removed "Ungrouped" as special group — ungrouped items derived by exclusion

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
- Data persistence via Hono HTTP API
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
- Data persistence across sessions
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
| **Host** | Rust (winit + WebView2) | **The Shell** | Window management. Intercepts doc URL requests and forwards them to the server's `/proxy?url=` endpoint. Sends `navigated` events to frontend via `PostWebMessageAsJson`. Opens external URLs in system browser. Spawns the server and ensures cleanup via Job Object. |
| **Server** | TypeScript (Bun + Hono) | **The Brain** | REST endpoints for split data persistence (`/api/v1/data/preset`, `/data/:providerId`). Batch crate metadata lookup with dedicated SQLite cache (`POST /api/v1/crates`). HTTP proxy with SQLite caching and LRU eviction (`/proxy?url=`). Dark mode injection at serve time. Serves frontend assets via Vite middleware. |
| **Frontend** | Svelte 5 + Vite | **The Face** | UI rendering (Explorer, Navigation). Fetches data from `/api/v1/*` via `hono/client`. Provider-based architecture for multi-source docs. |

### Request Flow

```
WebView2 iframe navigates to https://docs.rs/serde/latest/serde/
  │
  ├─ OnFrameNavigationStarting: post "navigated" event to frontend
  │
  └─ OnWebResourceRequested (GET, ProxiedUrls match):
       │
       │  Rust host forwards to Bun:
       │  GET http://localhost:$TURBODOC_PORT/proxy?url=https%3A%2F%2Fdocs.rs%2Fserde%2Flatest%2Fserde%2F
       │
       └─ Bun /proxy handler:
            ├─ Cache HIT + fresh?  → serve cached body + dark mode injection
            ├─ Cache HIT + stale?  → serve cached body immediately
            │    └─ background:      conditional revalidation (If-None-Match / If-Modified-Since)
            │         ├─ 304 Not Modified → update policy in cache
            │         └─ 2xx             → replace cache entry
            └─ Cache MISS          → fetch upstream, cache if storable, serve
```

### Technology Stack

- **Frontend**: Svelte 5 + TypeScript (strict mode); reactivity via runes (`$state`, `$derived`, `$effect`)
- **Build**: Vite 7 with `@sveltejs/vite-plugin-svelte`
- **State Management**: Svelte 5 `$state` proxies (deep reactive); direct mutation, no Immer
- **Type Utilities**: type-fest (used by `ReadonlyDeep` markers in a few places)
- **UI Components**: shadcn-svelte — vendored Bits UI primitives in `frontend/3rdparty/shadcn/`; paneforge (via the Resizable wrapper) for split panes
- **Styling**: Tailwind CSS v4 with OKLCH color space; `class={[...]}` for conditional classes (no `cn()` in app code)
- **Icons**: `@lucide/svelte` (icons imported individually for tree-shaking)
- **Utilities**: remeda (functional), semver, zod
- **Server**: Bun + Hono (API + HTTP proxy with SQLite cache) + Vite (middleware mode) on `$TURBODOC_PORT`
- **Host**: Rust (winit + WebView2) — window management, request forwarding, server lifecycle
- **IPC**: Hono HTTP API for CRUD + WebView2 `PostWebMessageAsJson` for navigation events; mitt-based event bus inside the frontend (`createSubscriber` bridges into Svelte reactivity)

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
frontend/index.ts (entry point: mount(App, ...))
└── App.svelte (owns appData $state, navigateTo context, IPC `navigated` listener,
                ResizablePanelGroup layout)
    ├── Explorer.svelte (left panel; receives appData as prop, iterates providers in preset)
    │   └── ExplorerProvider.svelte (per provider; owns ProviderDataStore, derives view
    │                                model via provider.render(ctx), wires up effects)
    │       ├── InputActionDialog.svelte (renders provider-supplied "input" actions, e.g. Import)
    │       ├── ExplorerGroup (variant="ungrouped")
    │       │   ├── ExplorerGroupHeader (variant="ungrouped")
    │       │   └── ExplorerItem[] (sorted by sortKey)
    │       ├── ExplorerGroup[] (variant="default", per group in groupOrder)
    │       │   ├── ExplorerGroupHeader (collapsible, editable name, dropdown menu)
    │       │   └── ExplorerItem[] (sorted by sortKey, shown when group expanded)
    │       └── ExplorerCreateGroupComponent
    └── iframe (right panel, docs viewer)
```

**ExplorerItem.svelte structure:**
```
ExplorerItem (shadcn-svelte Collapsible.Root, backed by Bits UI)
├── Item name (Collapsible.Trigger, clickable, toggles collapse)
├── Version selector (shadcn-svelte Select.Root, if item.versions exists)
├── ExplorerItemMenu (shadcn-svelte DropdownMenu.Root: move to group, links, actions)
└── Collapsible.Content
    └── ExplorerPageList
        └── ExplorerPage[] (sorted by sortKey)
            ├── ExplorerPageName (text or symbol with color coding)
            └── Pin/unpin icon
```

### Component Responsibilities

- **Explorer** (`frontend/ui/explorer/Explorer.svelte`): Top-level container; iterates providers in current preset
- **ExplorerProvider** (`ExplorerProvider.svelte`): Owns per-provider data via `ProviderDataStore` (Svelte 5 `$state` class), constructs `ProviderContext`, calls `provider.render()` inside a `$derived`, wires up the optional `provider.setupEffects(ctx)` hook in component init
- **ExplorerGroup** (`ExplorerGroup.svelte`): Renders group header + filtered/sorted items; handles ungrouped vs named variants
- **ExplorerGroupHeader** (`ExplorerGroupHeader.svelte`): Chevron toggle, rename input, dropdown menu (expand/collapse all, move up/down/under, delete with confirmation)
- **ExplorerCreateGroupComponent** (`ExplorerCreateGroupComponent.svelte`): Button that transforms to inline input for creating new groups
- **ExplorerItem** (`ExplorerItem.svelte`): Collapsible card with name, version selector, menu; expansion state via `itemExpanded(providerId, itemId)` accessor
- **ExplorerItemMenu** (`ExplorerItemMenu.svelte`): Move to group submenu, external links, custom actions
- **ExplorerPageList** (`ExplorerPageList.svelte`): Sorted page list with symbol color coding and pinning buttons
- **InputActionDialog** (`InputActionDialog.svelte`): Generic dialog for `ProviderAction` of type `"input"` — provider supplies labels and an `invoke(value)` callback; the dialog owns the textarea/input UI

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

Providers register in `frontend/providers/index.ts` and implement the `Provider<T>` interface from `frontend/core/data.ts`. Each provider's `render()` returns a `ProviderOutput` containing:
- `items: Record<string, Item>` — uniform view models with pages, links, actions, versions
- `actions?: ProviderAction[]` — provider-level UI (e.g., import dialog)

View models contain callbacks (e.g., `setPinned`, `setCurrentVersion`, `invoke`) that update provider data by directly mutating the `$state`-proxied store. View models are derived inside a `$derived` block — never memoized manually, never serialized. See `frontend/core/data.ts` for the full type definitions.

**Current:** `rust` (docs.rs + doc.rust-lang.org + windows-docs-rs). **Planned:** `rust.cargo`, `cpp.cppreference`, `cpp.msdocs`, etc.

**Data flow:**
```
[Disk/Storage]                         [Deserialization]         [Runtime]
preset.json ───────────────────► App.svelte $state ────────► appData prop (presets)
<providerId>.json ──────────► ProviderDataStore.load() ────► ProviderOutput (View Model)
localStorage (turbodoc:current-url) ──► currentUrl.value ──────► current URL (createSubscriber)
localStorage (turbodoc:expanded) ────► groupExpanded/itemExpanded ► expansion state
Dedicated crates_cache SQLite table ──► cache.svelte.ts ──────► in-memory API response $state (per-provider)
```

**Navigation flow:**
```
navigateTo(url) ──► iframe.src = url
                        │
                        └─► WebView2 fires "navigated" IPC event
                              │
                              └─► App.svelte handler: storage.save("currentUrl", url)
                                    │
                                    └─► mitt event ──► createSubscriber wakes every
                                          `currentUrl.value` reader in the component tree
```

#### Unified Rust Provider

The `rust` provider (`frontend/providers/rust/`) handles three documentation domains as a single provider. Originally planned as separate `rust.crate` and `rust.std` providers, merged for simplicity:
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

### Running the App

```
just install   # Installs dependencies for both server/ and frontend/
just build     # Builds the Rust host app
just run       # Launches the app (host spawns server, then opens the WebView2 window)
```

The Rust host (`src/main.rs`) handles the full lifecycle: spawning the Bun server, waiting for server readiness (probes the TCP port), then opening the WebView2 window. A Windows Job Object ensures the server is killed when the host exits.

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
- All styling consolidated in `frontend/global.css` (Tailwind, theme tokens, Zinc palette in `:root` + `.dark`, Radix Collapsible animation)
- OKLCH color space for perceptual uniformity
- Dark background with high-contrast text
- shadcn Zinc palette (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`); dark mode triggered by `class="dark"` on `<html>` plus `@custom-variant dark (&:is(.dark *))`
- `--input` token at 15% transparent white doubles as the interactive-highlight color (used as `bg-input/50` for hover states and `border-input` for field borders)

### One Dark Symbol Colors (CSS variables in `frontend/global.css`)
- Yellow (`--color-yellow`): type (struct, enum)
- Cyan (`--color-cyan`): interface (trait)
- Blue (`--color-blue`): function
- Orange (`--color-orange`): macro, constant
- Default: namespace (module), unknown

### Typography
- Monospace font for item names and page links (`font-mono`)
- Clear hierarchy: group names (`text-lg font-semibold`) > item names (`font-mono`) > page links (`font-mono font-light`)
- Italic for preview pages (emphasis without weight)
- Base font size: 14px (set in `:root` in `frontend/global.css`)
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

**API Response Caching**
- Crate metadata (crates.io API) uses a dedicated `crates_cache` SQLite table (`server/crates-cache.ts`) — stores raw upstream response bodies with a simple 24-hour TTL. No LRU eviction needed (entries are small). On upstream failure, stale entries are served as fallback. Fetches use plain `fetch()` directly to crates.io, not through the HTTP proxy.
- Documentation page caching uses the HTTP proxy's SQLite cache (`server/http-cache.ts`) — RFC 7234 freshness, conditional revalidation, LRU eviction, stale-while-revalidate
- Each provider manages its own in-memory cache for within-session state — not persisted, starts empty on each app launch (e.g., Rust provider uses a module-level store subscribed to via `useSyncExternalStore`)
- On provider load, the frontend batch-fetches all uncached crate metadata via `POST /api/v1/crates` — the server serves fresh cache hits from the `crates_cache` table and fetches upstream (in parallel) for stale/missing entries, returning normalized `CrateMetadata` for all requested crates. The frontend never constructs crates.io URLs or parses raw crates.io responses.
- Force-refresh: `POST /api/v1/crates?refresh=true` bypasses the cache freshness check and always fetches upstream. Limited to a single crate per request to prevent bulk hits to crates.io. Triggered from the "Refresh Metadata" action in the crate's explorer menu.

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
- No `importItem` method on the `Provider` interface — import UI varies too much between providers.
- Instead, providers expose a `ProviderAction` with `type: "input"`: pure data (label, icon, dialog title/description, placeholder, multiline, callback). The Explorer renders the dialog via the generic `InputActionDialog.svelte`.
- Earlier (React) iterations of this codebase used `type: "node"` carrying a `ReactNode` — the Svelte migration replaced that with the declarative `"input"` shape, eliminating the need for providers to ship UI components.

**Migration & Compatibility**
- Server-side auto-migration: on startup, if legacy `workspace.json` exists, splits it into `preset.json` and `<providerId>.json`, then renames the original to `workspace.json.migrated` (UI state is dropped — starts fresh from localStorage)
- On startup, if data files don't exist or don't match expected format, initialize with empty defaults
- Provider ID `"preset"` is reserved (collides with static endpoint path)

**Provider API Surface**
- No `serialize`/`deserialize` methods — view model callbacks operate data directly via Immer
- No provider collapsing in sidebar — provider visibility controlled solely by preset

**"Dumb Pipe" Delegate Pattern**
- All proxy and caching logic lives in the Bun server, not in the WebView2 event loop
- The Rust host is a thin forwarding shim — intercepts doc URL requests and delegates to the server's `/proxy?url=` endpoint
- Decouples host (windowing) from logic (caching/parsing), improving maintainability and type safety

**Architectural Constraints**
- No URL Rewriting: the WebView still believes it is browsing `docs.rs` directly
- No SSL Proxy: proxying happens after WebView2 intercepts the request intent
- Configurable Port: combined server (Hono API + proxy + Vite dev server) binds to `$TURBODOC_PORT`

**Dark Mode Injection (Serve-Time)**
- Cache stores clean upstream content; dark mode injection applied at serve time
- Technique: insert `<script>window.localStorage.setItem('rustdoc-theme', 'dark');</script>` after `<meta charset="UTF-8">` in rustdoc HTML responses
- Benefits: change injection logic without invalidating cache; could later make dark mode a user preference toggle

### Data Model

**Split Data Persistence**
- Workspace split into two server-persisted file categories:
  - `preset.json` — global app state (presets). Loaded eagerly in `frontend/index.tsx`.
  - `<providerId>.json` — per-provider user data (groups, provider-specific data). Loaded lazily per-provider by `useProviderData` hook.
- Transient UI state stored in **localStorage** as individual slots, not on the server. Two slot types managed by `frontend/core/localStorage.ts`:
  - **Primitive** (`turbodoc:current-url`): current URL, simple get/set
  - **Array** (`turbodoc:expanded`): flat string array of expanded item/group keys. Key format: `<providerId>:<itemId>` for items, `<providerId>:group:<groupId>` for groups. Membership-check hooks (`useGroupExpanded`, `useItemExpanded`) with selective re-rendering via mitt events — only hooks whose specific key changed re-render.
  - Each slot validated with Zod on load; invalid/missing data falls back to empty defaults (default URL `https://docs.rs/`, nothing expanded). See `frontend/core/localStorage.ts` and `frontend/core/uiState.ts`.
- Crate metadata caching uses a dedicated `crates_cache` SQLite table with 24-hour TTL (separate from the HTTP proxy cache). Each provider manages its own in-memory cache for within-session state, populated on demand from the batch endpoint (e.g., Rust provider uses a module-level store with `useSyncExternalStore`).
- Server-persisted via Hono HTTP API (`/api/v1/data/preset`, `/data/:providerId`)
- `"preset"` is a reserved path segment — cannot be used as a provider ID
- Auto-save on every state change (no debouncing — files are small)
- App data save failures are fatal (throw); provider data failures are non-fatal (log + return `{}`)
- Server-side migration: on startup, if legacy `workspace.json` exists, auto-splits into new files and renames original to `.migrated`
- **Provider data write guard**: the server rejects a PUT to `/data/:providerId` if the new JSON payload is less than 30% the size of the existing file on disk (HTTP 409). This prevents accidental data loss from frontend bugs or state resets. The check is skipped when the existing file is smaller than 256 bytes, since small files can legitimately shrink by large ratios. Future: a `?force=true` query parameter could bypass the guard for legitimate bulk deletions.

**Preview Page (Derived State)**
- Preview state derived from `currentUrl` (localStorage) and per-item `pinnedPages`
- A page is "preview" when it matches `currentUrl` but is NOT in `pinnedPages`
- Preview pages render italic with outline pin icon (visible on hover)
- Pinned pages render normal with filled pin icon
- `Page.pinned = null` means pinning is disabled for that page (e.g., home page)

**Provider-Opaque Data**
- `ProviderData.data` is `unknown` at app level — only the provider knows its shape
- Single point of type casting at deserialization boundary
- Enforced by the type system, not just convention

**Eager Cleanup**
- Orphaned UI state entries (expanded items/groups) are removed when content changes
- Prevents stale references from accumulating across data mutations

**"latest" as Literal String**
- Version selector stores the literal string `"latest"`, not a resolved version number
- Preserves user intent: automatically picks up new releases without manual update
- Resolved to actual version only when building URLs

### State Management

**View Model Derivation**

```
AppData + ProviderData ($state) ──► provider.render() inside $derived ──► render
              │
              └── direct mutation on the $state proxy
```

- `provider.render()` is a pure data-derivation function called inside a `$derived` block in `ExplorerProvider.svelte`. It re-runs whenever its dependencies (`ctx.data`, `ctx.currentUrl`, the `cache.svelte.ts` store) change — Svelte 5 tracks reads automatically.
- Per-provider effects (URL sync, batch fetches, seeding) live in the optional `provider.setupEffects(ctx)` method, called once at host init. Implementations live in `*.svelte.ts` modules so their `$effect` runes bind to the host component's lifecycle.
- View models contain callbacks (closures over `$state`-mutating functions) — never serialized.
- Direct mutation on `$state` proxies replaces Immer drafts — `ctx.data.crates[name] = …` is reactive.
- `ProviderContext` is constructed once in `ExplorerProvider.svelte` with reactive getters over the `ProviderDataStore` (`@/core/providerData.svelte`).

**Independent State Atoms**
- `App.svelte` owns `appData` ($state, async from server) and the `navigated` IPC event handler (writes `currentUrl` to localStorage).
- `currentUrl` consumed via the `currentUrl.value` reactive accessor (`@/core/uiState.svelte`) in components that need it (`ExplorerPageList`, etc.) — not routed through any global state container.
- Expansion state managed per-component via the `groupExpanded`/`itemExpanded` factories — each accessor reads/writes its own key in the `turbodoc:expanded` localStorage slot. mitt events filter by element so only the matching subscribers re-render.
- Provider data is lazily loaded per-provider inside `ExplorerProvider.svelte` via `ProviderDataStore.load()`.
- Each atom has independent auto-save — a change in one slice doesn't trigger writes to others.

**Hybrid IPC**
- App data CRUD via Hono HTTP API (`/api/v1/data/preset`)
- Per-provider data CRUD via Hono HTTP API (`/api/v1/data/:providerId`)
- UI state via localStorage (`turbodoc:current-url`, `turbodoc:expanded`) — no server round-trip
- API response caching via HTTP proxy (`/proxy?url=`) — SQLite with RFC 7234 freshness and LRU eviction
- Navigation events via WebView2 `postMessage` (low-latency, event-driven)
- All operations except app data are non-fatal (log errors, don't crash)

**Decomposed Root State (no AppContext class)**
- `appData` ($state) lives in `App.svelte`; passed as prop to `Explorer.svelte` (only consumer; no context needed).
- `navigateTo(url)` is a Svelte context entry (`navigateTo.set` / `navigateTo.get`) published by `App.svelte` and consumed by `ExplorerProvider`, `ExplorerItemMenu`, `ExplorerPageList`.
- The iframe ref is captured via `bind:this` inside `App.svelte` — only consumer is the `<iframe>` element itself.
- `currentUrl` read via the `currentUrl.value` accessor — not part of root state.
- Provider data loaded lazily per-provider inside `ExplorerProvider.svelte`.

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
- Items use Radix Collapsible directly (not part of shadcn's standard component set; bundled separately as `@radix-ui/react-collapsible`)
- Expansion state managed per-component via `useItemExpanded(providerId, itemId)` hook from `frontend/core/uiState.ts`
- Groups use `useGroupExpanded(providerId, groupId)` — same underlying `useExpanded` hook
- Default: collapsed (both items and groups)
- Toggled by clicking item name (items) or group header (groups)
- Bulk operations (Expand All / Collapse All) via imperative `expandItems()` / `collapseItems()` helpers

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
├── .justfile                   # Task runner (just install, just build, just run, etc.)
├── biome.json                  # Biome linter (formatter disabled)
├── Cargo.toml                  # Rust host app
├── src/
│   ├── main.rs                 # Entry point (job object, server spawn, TCP readiness probe, cleanup)
│   ├── app.rs                  # WebView2 window, event handlers, proxy forwarding
│   └── webview.rs              # WebView2 COM wrapper (environment, controller, events)
│
├── frontend/                   # Svelte 5 frontend (own package.json + tsconfig.json)
│   ├── package.json            # Frontend dependencies (Svelte, bits-ui, paneforge, @lucide/svelte, etc.)
│   ├── tsconfig.json           # Extends root tsconfig
│   ├── vite.config.ts          # Root: frontend/, aliases: @/ → frontend/, @server/ → server/, @shadcn/ → frontend/3rdparty/shadcn/
│   ├── svelte.config.ts        # Svelte preprocessor + global warning suppression for a11y/state-ref rules
│   ├── components.json         # shadcn-svelte CLI config (baseColor: zinc, framework: svelte)
│   ├── index.html              # Entry HTML
│   ├── index.ts                # Svelte entry point (`mount(App, ...)`)
│   ├── global.css              # Tailwind imports, shadcn Zinc OKLCH palette (`:root` + `.dark`), `@theme inline` token mapping, One Dark symbol palette, Bits UI Collapsible animation
│   │
│   ├── core/
│   │   ├── data.ts                 # Zod schemas + inferred types (AppData, ProviderData, Provider, Item, Page, IconProp, ProviderAction)
│   │   ├── context.ts              # Svelte setContext/getContext keys (`navigateTo`, `provider`, `providerData`)
│   │   ├── providerData.svelte.ts  # `ProviderDataStore` reactive class — `$state` data + load + autosave
│   │   ├── ipc.ts                  # Hono HTTP client (data CRUD) + WebView2 event listener (navigated)
│   │   ├── localStorage.ts         # Typed localStorage abstraction (Zod validation, mitt events, primitive + array APIs)
│   │   └── uiState.svelte.ts       # Reactive accessors over mitt+localStorage (currentUrl, groupExpanded, itemExpanded) + imperative helpers
│   │
│   ├── providers/
│   │   ├── index.ts            # Provider registry (Record<string, Provider>)
│   │   └── rust/               # Unified Rust provider
│   │       ├── index.ts            # Provider implementation (render, URL handling, page parsing, getImportCratesAction inlined)
│   │       ├── effects.svelte.ts   # Per-provider $effect setup (URL sync, batch fetches, seed crates)
│   │       ├── cache.svelte.ts     # `$state` singleton: in-memory crate metadata cache + batch fetch
│   │       ├── url.ts              # URL parsing/building (docs.rs, doc.rust-lang.org, windows-docs-rs)
│   │       └── url.test.ts
│   │
│   ├── 3rdparty/
│   │   └── shadcn/             # Vendored shadcn-svelte primitives (Bits UI / paneforge)
│   │       ├── components/ui/  # button, card, dialog, dropdown-menu, input, resizable, select, separator, collapsible
│   │       └── lib/utils.ts    # cn() — clsx + tailwind-merge wrapper (used internally by vendored components only)
│   │
│   ├── ui/
│   │   ├── App.svelte          # Root: appData $state, navigateTo context, IPC `navigated` listener, Resizable layout
│   │   ├── common/
│   │   │   └── Icon.svelte     # Icon wrapper (lucide-svelte)
│   │   └── explorer/
│   │       ├── Explorer.svelte                  # Top-level: iterates providers in current preset
│   │       ├── ExplorerProvider.svelte          # Owns ProviderDataStore, derives view model, sets up effects
│   │       ├── ExplorerGroup.svelte             # Group renderer (default + ungrouped variants)
│   │       ├── ExplorerGroupHeader.svelte       # Group header (collapse, rename, dropdown menu)
│   │       ├── ExplorerCreateGroupComponent.svelte # Add group button/input
│   │       ├── ExplorerItem.svelte              # Collapsible item card with version selector
│   │       ├── ExplorerItemMenu.svelte          # Item menu (move to group, links, actions)
│   │       ├── ExplorerPageList.svelte          # Page list with symbol colors + pinning
│   │       └── InputActionDialog.svelte         # Generic dialog for `"input"` ProviderAction
│   │
│   ├── utils/
│   │   ├── version-group.ts    # Semver version grouping
│   │   └── version-group.test.ts
│
├── server/                     # Bun + Hono server (own package.json + tsconfig.json)
│   ├── package.json            # Server dependencies (Hono, bun:sqlite, etc.)
│   ├── tsconfig.json           # Extends root tsconfig
│   ├── index.ts                # Hono router + Vite dev server ($TURBODOC_PORT)
│   ├── api.ts                  # API endpoints (split data CRUD, batch crate lookup, legacy migration)
│   ├── proxy.ts                # /proxy?url= route handler + dark mode injection
│   ├── http-cache.ts           # SQLite HTTP cache for doc pages (bun:sqlite, LRU eviction)
│   ├── crates-cache.ts         # Dedicated SQLite cache for crates.io API responses (TTL-based)
│   └── common.ts               # Shared config, database setup, utilities
│
├── target/                     # Build output (Rust + runtime data)
│   └── data/                       # Runtime data directory ($TURBODOC_DATA)
│       ├── cache.sqlite            # SQLite database (HTTP proxy cache + crates metadata cache, WAL mode)
│       ├── preset.json             # Global app state (presets)
│       └── <id>.json               # Per-provider user data
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

---

## Success Criteria

### Completed
- [x] Multi-provider architecture with view model derivation
- [x] Data/cache persistence via Hono HTTP API
- [x] Unified Rust provider (docs.rs + doc.rust-lang.org + windows-docs-rs)
- [x] Pin/unpin documentation pages with preview page system
- [x] Version selection with semver grouping
- [x] Named groups with full CRUD (create, rename, reorder, delete)
- [x] Move items between groups
- [x] Import crates from docs.rs URLs
- [x] Symbol parsing with One Dark color coding
- [x] Automatic cross-crate navigation via `navigated` event
- [x] Auto-save data and cache on every change
- [x] HTTP proxy with SQLite cache and dark mode injection (v0.3)
- [x] Rust host with WebView2 (winit + webview2-com)

### Remaining
- [ ] Unified search bar
- [ ] Preset picker UI
- [ ] Loading/error states
- [ ] Keyboard shortcuts
- [ ] Cross-provider navigation (partially done via unified rust provider)

---

## Change History

- **2026-05**: Migrate frontend from React 19 to Svelte 5: replace React+useImmer state with Svelte 5 runes (`$state` proxies for deep reactivity, `$derived` for view models, `$effect` for side effects); replace shadcn/ui (vendored Radix) with shadcn-svelte (vendored Bits UI / paneforge) at the same `frontend/3rdparty/shadcn/` path and `@shadcn/*` alias; replace FontAwesome icons with `@lucide/svelte`; replace React contexts with Svelte `setContext`/`getContext` exposed as `navigateTo.get()/set()`, `provider.get()/set()`, `providerData.get()/set()`; new `ProviderDataStore` reactive class (`frontend/core/providerData.svelte.ts`) replaces `useProviderDataLoader`; new reactive accessors over mitt+localStorage in `frontend/core/uiState.svelte.ts` (`currentUrl.value`, `groupExpanded(p,g)`, `itemExpanded(p,i)`) using `createSubscriber` from `svelte/reactivity` instead of `useSyncExternalStore`; redesign `ProviderAction` — drop the generic `"node"` (ReactNode) variant, replace with declarative `"input"` shape rendered by a generic `InputActionDialog.svelte`; redesign `ProviderContext` — drop `updateData(updater)` since direct `$state` mutation is now reactive; add optional `Provider.setupEffects(ctx)` method (lives in `*.svelte.ts` modules) for per-provider URL sync / cache fetches; rust provider's module-level cache becomes a `$state` singleton in `cache.svelte.ts`; `IconProp` redefined as `{ type: "lucide"; icon: Component<LucideProps> }`; entry `index.tsx` → `index.ts` with `mount(App, ...)`; vite-plugin-react-swc replaced by `@sveltejs/vite-plugin-svelte`; drop `@radix-ui/*`, `react`, `react-dom`, `@vitejs/plugin-react-swc`, `use-immer`, `immer`, `lucide-react`, `@fortawesome/*`, `react-resizable-panels`; keep `clsx`/`tailwind-merge` for vendored `cn` helper but app code uses Svelte's native `class={[...]}`; drop `frontend/core/prelude.ts` (no more `State<T>` tuple); `tsc --noEmit` removed from frontend's check pipeline (svelte-check now covers all .ts and .svelte files); `svelte.config.ts` adds global warning suppression for a11y rules and `state_referenced_locally` (matching existing biome-disabled a11y rules)
- **2026-05**: Migrate frontend back from HeroUI v3 to shadcn/ui: restore vendored Radix primitives in `frontend/3rdparty/shadcn/` (Button, Card, Dialog, DropdownMenu, Input, Resizable, Select, Separator, lib/utils.ts) and `components.json` from jj history (parent of HeroUI migration); replace HeroUI compound APIs with Radix-based shadcn equivalents (`Select`/`SelectTrigger`/`SelectContent`/`SelectItem`, `DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuSub*`, `Dialog`/`DialogContent`/`DialogHeader`/`DialogFooter`); replace `useOverlayState` with `useState<boolean>`; rewrite `global.css` with the shadcn Zinc OKLCH palette in `:root`/`.dark`, drop `@heroui/styles` and `global.theme.css`; switch `<html data-theme="dark">` to `<html class="dark">` + `@custom-variant dark (&:is(.dark *))`; revert HeroUI-native styling tweaks (`rounded-3xl` cards / `rounded-2xl` icon buttons → `rounded-md`); drop `useDeferredMount` since Radix mounts cheaply; preserve every post-migration improvement (group-header decomposition, `useGroupExpanded`/`useItemExpanded` localStorage hooks, `NavigateToProvider`, orphan-cleanup `useEffect`, Refresh Metadata menu item, Collapsible animation); add `@shadcn/*` paths entry to root `tsconfig.json`; drop deps `@heroui/react`, `@heroui/styles`; re-add `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`
- **2026-04**: Replace WinUI host with Rust host: revive Rust webview host (`src/app.rs`, `src/webview.rs`) using winit + webview2-com; merge launcher into host process (`src/main.rs` spawns server, polls lock file, opens window, cleans up lock on exit); remove `app/` directory (C# WinUI 3), `.slnx`, `Directory.Build.props`, `out/`; proxy delegation preserved (host forwards doc URLs to server's `/proxy?url=` endpoint); IPC removed (frontend uses Hono HTTP API); `HOSTED_URL` and `PROXIED_URL` split into separate constants for future flexibility
- **2026-03**: Add force-refresh for crates.io metadata: `POST /api/v1/crates?refresh=true` bypasses cache freshness and always fetches upstream; limited to a single crate per request (server returns 400 for multiple); "Refresh Metadata" menu item added to crate actions in explorer (skipped for std-library crates); new `deleteCrateCache()` helper evicts a crate from the in-memory store so `useSyncExternalStore` triggers a re-render while the fresh fetch is in flight
- **2026-03**: Extract crates.io caching into dedicated system: new `server/crates-cache.ts` with `crates_cache` SQLite table (stores raw upstream response bodies, 24-hour TTL, no LRU); `POST /api/v1/crates` now reads from dedicated cache and fetches directly to crates.io (not through HTTP proxy); stale entries served as fallback on upstream failure; removed synthetic `Cache-Control` injection for crates.io URLs from `server/proxy.ts`; `handleProxy` un-exported (only used internally by proxy route); `CrateMetadata` type and `parseCrateMetadata` moved from `api.ts` to `crates-cache.ts` (re-exported from `api.ts` for frontend compatibility)
- **2026-03**: Remove unused `?cache=none` proxy bypass: no caller ever passed the parameter; removed `noCache` param from `handleProxy`, query parsing in route handler, and conditional log; stale-while-revalidate handles freshness automatically
- **2026-03**: Move crates.io API handling from frontend to server: `POST /api/v1/crates` now fetches upstream for cache misses (in parallel via `handleProxy`) instead of returning `null`; server normalizes raw crates.io responses into a flat `CrateMetadata` type (exported from `server/api.ts`); frontend no longer constructs crates.io URLs or parses raw API responses; deleted `crates-api.ts` (inlined single `fetchCratesMetadata` into `rust/index.tsx`), `crates-api.integration.test.ts`, error classes (`RateLimitError`, `CrateNotFoundError`, `MalformedResponseError`), unused `searchCrates()`, individual `fetchCrateInfo()` and `fetchCrateCache()`; `getCrateCache()` simplified to pure store lookup (no fetch trigger); removed `> 1` batch threshold — all uncached crates fetched in a single request; `type-fest/PartialDeep` no longer used for crates API responses
- **2026-03**: Remove generic provider cache mechanism: delete `TCache` generic from `Provider<T, TCache>` and `ProviderContext`, remove `cache`/`updateCache` from `ProviderContext`, delete `useProviderCache()` hook from `context.ts`; Rust provider now manages its own crate metadata via a module-level external store subscribed to with `useSyncExternalStore` inside `render()` (which is logically a hook — always called at the top level of `ExplorerProvider`); `getCrateCache()`, `fetchCrateCache()`, `batchFetchCrateCache()` no longer take `ctx` for cache access — they read/write the store directly
- **2026-03**: Add collapsible expand/collapse animation: CSS keyframes (`collapsible-slide-down`/`collapsible-slide-up`) using `--radix-collapsible-content-height` CSS variable for smooth height transitions (150ms ease-out); ExplorerItem already used Radix `<CollapsibleContent>` — only needed the `.collapsible-content` class; ExplorerGroup "default" variant switched from `{expanded && items}` conditional rendering to Radix `<Collapsible open={expanded}>` + `<CollapsibleContent>` for animated collapse with delayed unmount
- **2026-03**: Decompose `AppContext` class into separate primitives: delete class and its single context; `appDataState` (presets) passed as prop from `index.tsx` → `App` → `Explorer` (only consumer, no context needed); `navigateTo` provided via `NavigateToProvider` context (stable `useCallback` over iframe ref); `viewerRef` passed as prop to `App` (only consumer is `<iframe>`); consumers now import `useAppData` (removed) or `useNavigateTo` instead of `useAppContext`
- **2026-03**: Remove `currentUrl` from AppContext: `currentUrl` state no longer routed through AppContext — components read it via `useCurrentUrl()` hook directly; `setCurrentUrl` removed from `ProviderContext` interface (all URL writes go through `navigateTo`); `AppContext.navigateTo()` only sets `iframe.src` — the WebView2 `navigated` IPC event handler in `index.tsx` persists the URL to localStorage via `storage.save`, and mitt propagates to all hook consumers; URL normalization in rust provider changed from `setCurrentUrl` to `navigateTo` (always hits proxy cache); `ExplorerPageList` and `ExplorerItemMenu` now use `ctx.navigateTo()` instead of `setCurrentUrl()` from hook
- **2026-03**: Decompose monolithic UI state into self-contained localStorage hooks: replace single `turbodoc:ui-state` JSON blob with two individual slots (`turbodoc:current-url` primitive, `turbodoc:expanded` flat string array); typed localStorage abstraction in `localStorage.ts` with Zod validation and mitt events carrying per-element granularity (`{ element, present }`) for selective re-rendering; `uiState.ts` provides `useCurrentUrl`, `useGroupExpanded(providerId, groupId)`, `useItemExpanded(providerId, itemId)` hooks plus imperative helpers (`expandItems`, `collapseItems`, `renameGroup`, `expandGroup`) for bulk operations; key scheme: `<providerId>:<itemId>` for items, `<providerId>:group:<groupId>` for groups; removed `ui-state-storage.ts`, `UiState` type, `uiStateSchema`, and centralized `useProviderUiState` hook; fixed `State<boolean>` distributive conditional type issue in `prelude.ts`; fixed `AppContext` constructor calling hooks (moved to `index.tsx`)
- **2026-03**: Optimize frontend styling: merge `global.tailwind.css` into `global.css` (single CSS entry point); override HeroUI's default bubbly look with sharper corners (`--field-radius`, `rounded-md` buttons) and compact menu items; fix HeroUI bug where `--color-accent-soft-foreground` was set to `--accent` (invisible text on accent buttons); simplify HeroUI semantic token overrides (remove redundant `*-foreground` tokens that match HeroUI defaults)
- **2026-03**: Remove unused dependencies: drop `@hono/zod-validator`, `http-cache-semantics`, `ts-pattern`, `use-debounce` from frontend; drop `@hono/zod-validator`, `http-cache-semantics`, `immer`, `lucide-react`, `mitt`, `remeda` from server
- **2026-03**: Migrate UI component library from shadcn/ui (vendored Radix primitives) to HeroUI v3 (beta, React Aria-based): replace Button, Input, Select, Dialog, DropdownMenu, Separator with HeroUI equivalents; move Resizable wrapper to `ui/common/Resizable.tsx`; delete `3rdparty/shadcn/` directory, `components.json`, and `@shadcn/*` path alias; remove 7 unused dependencies (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`); keep `@radix-ui/react-collapsible` and `react-resizable-panels` (no HeroUI equivalent); preserve dark-only OKLCH color palette via HeroUI semantic token overrides in `:root`
- **2026-03**: Add batch crate metadata endpoint (`POST /api/v1/crates`): serves cached crates.io API responses from the SQLite HTTP cache and fetches upstream for misses; returns normalized `CrateMetadata`; frontend batch-fetches all uncached crates on provider load in a single request
- **2026-03**: Restructure project into `app/`, `frontend/`, `server/` top-level directories: each TypeScript package has its own `package.json` and `tsconfig.json`; C# host moved to `app/`; `.NET` build output directed to `out/` via `Directory.Build.props`; `data/` directory holds runtime workspace and cache files; Vite config moved to `frontend/vite.config.ts` with `@server` alias for cross-package imports
- **2026-03**: Switch HTTP proxy cache to stale-while-revalidate: stale entries served immediately while background revalidation updates the cache; concurrent refetches for the same URL are deduplicated
- **2026-03**: Remove client-side rate limiter from `crates-api.ts`: proxy cache (24h TTL) shields upstream, so the 1-second inter-request delay is unnecessary; requests now fire immediately
- **2026-03**: Fix crates.io API cache staleness: inject synthetic `Cache-Control: max-age=86400` for crates.io API responses that lack cache directives
- **2026-03**: Move `currentUrl` from server-persisted `appData` to localStorage-backed `uiState`: eliminates HTTP PUT on every navigation, synchronous restore on startup; `appData` now contains only presets
- **2026-03**: Migrate provider cache to HTTP proxy: crates.io API calls routed through `/proxy?url=`, SQLite cache handles persistence and RFC 7234 freshness; removed `cache.<providerId>.json` files, server cache endpoints, cache schema registry (`cache-schemas.ts`), Zod cache schemas (`cache.ts`), and cache IPC functions; `useProviderCache` simplified to in-memory `useImmer({})`
- **2026-03**: UI state moved to localStorage (`turbodoc:ui-state`): synchronous load on startup, no server round-trip; server `/workspace/ui` endpoint and `workspace.ui.json` file removed entirely
- **2026-03**: Fix auto-save race: `useProviderData`/`useProviderCache` now gate saves behind `loadedRef` flag; null-safe access to `ctx.data.crates` in Rust provider
- **2026-03**: Split workspace persistence: `workspace.json` → `preset.json` + `<providerId>.json` + `workspace.ui.json` with independent endpoints and auto-save; server-side auto-migration from legacy format
- **2026-03**: Merged Plan-v0.3.md into README (three-layer architecture, request flow, server design decisions)
- **2026-03**: Rust host removed entirely; replaced with C# WinUI 3 (.NET 10) + WebView2
- **2026-03**: Bun server completed: HTTP proxy (`/proxy?url=`), SQLite cache with LRU eviction, dark mode injection
- **2026-03**: `data.d.ts` migrated to `data.ts` with Zod-based schema definitions
- **2026-03**: Build system: `.justfile` replaces Nushell scripts; `effect` package removed
- **2026-02**: Merged Plan-v0.2.md into README (architecture decisions, identification scheme, provider details)
- **2026-02**: Updated README to reflect v0.2 architecture (provider system, new component hierarchy, Hono server)
- **2026-02**: Directory restructure: frontend code moved from `frontend/` to `src/app/` (later restructured again in 2026-03)
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

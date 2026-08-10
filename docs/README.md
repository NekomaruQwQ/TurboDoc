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
- Data persistence via HTTP API
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
- Version selector appears while hovering/focusing a crate header or one of
  its expanded pages and lazily loads recommended versions
  (latest + semver-grouped)
- Changing version reloads iframe with new version URL
- Current version persisted per-item in workspace
- Auto-sync: version selector updates when iframe navigates to different version

### Feature Requirements

#### Implemented
- Prefix-search, open, and add Explorer crates through a non-exhaustive combobox
- Display crate metadata (versions and links)
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
| **Host** | Rust (eframe/egui + wgpu/DX12 + WebView2) | **The Shell** | Native window management and an extensible startup/error surface. Intercepts configured upstream GETs in `WebResourceRequested` and routes them to `Server::fetch` (proxy + cache), while `/api/v1/*` routes to `Server::dispatch_api` (data only); everything else passes through to Vite. Sends `navigated` events to the frontend, opens external URLs in the system browser, and owns the Vite child through a Job Object. |
| **Backend** | Rust (rusqlite + reqwest + `http-cache-semantics`), in-process — no axum, no bound TCP listener of its own | **The Brain** | Provider data persistence (`/api/v1/data/{file_name}`) reading/writing TOML. Site-agnostic HTTP proxy with SQLite caching, upstream cache directives, conditional revalidation, stale-while-revalidate, LRU eviction, and an explicit downstream response-header allowlist that lets WebView2 cache reusable representations safely. Rustdoc dark-mode injection is applied at serve time. Called synchronously from the WebView2 UI thread via `Handle::block_on`. |
| **Frontend** | Svelte 5 + Vite | **The Face** | UI rendering and provider-specific integrations. The Rust provider constructs and parses sparse-index metadata requests by default and uses the crates.io API only for explicit refreshes. Vite serves all assets directly on the main port (no reverse proxy). |

### Request Flow

There is no loopback HTTP. The host's `WebResourceRequested` callback calls
the backend in-process on the UI thread via `Handle::block_on`.

**Docs page (e.g. https://docs.rs/serde/latest/serde/):**
```
WebView2 iframe navigates
  ├─ OnFrameNavigationStarting: post "navigated" event to frontend
  └─ OnWebResourceRequested (GET, PROXIED_URL prefix match):
       │  host: server.fetch(request)  → proxy::fetch(state, request)
       └─ proxy::fetch:
            ├─ Cache HIT + fresh?  → serve cached body + dark-mode injection
            │                        + cache/representation headers for WebView2 L1 reuse
            ├─ Cache HIT + stale?  → serve cached body immediately with downstream no-cache
            │    └─ background:      conditional revalidation (If-None-Match / If-Modified-Since)
            │         ├─ 304 Not Modified → update policy in cache
            │         └─ 2xx             → replace cache entry
            └─ Cache MISS          → fetch upstream, cache if storable, serve
```

**Crate metadata:**
```
Rust provider needs metadata for a crate
  ├─ First version-selector intent:
  │    GET https://index.crates.io/{Cargo index path}
  │    └─ proxy follows upstream Cache-Control/ETag/Last-Modified normally
  └─ "Refresh Metadata": GET https://crates.io/api/v1/crates/{name}
       └─ frontend uses fetch cache mode "no-store" for a current API result

The frontend parses both representations into its in-memory CrateCache.
Workspace startup, import, and group expansion do not request metadata.
The backend has no crate-specific endpoint, parser, or cache policy.
```

**Frontend `fetch("/api/v1/...")`:**
```
WebView2 fetch from the Svelte app
  └─ OnWebResourceRequested (path starts with /api/v1/):
       │  host: server.dispatch_api(request)  → api::dispatch
       └─ api::dispatch routes by (method, path):
            ├─ GET  /api/v1/data/{f}   → read TOML, return as JSON
            └─ PUT  /api/v1/data/{f}   → write JSON as TOML
```

**Frontend asset request (anything else):**
WebView2 default path → Vite on the main port (HMR WebSocket included). No interception.

### Technology Stack

- **Frontend**: Svelte 5 + TypeScript (strict mode); reactivity via runes (`$state`, `$derived`, `$effect`)
- **Build**: Vite 8 with `@sveltejs/vite-plugin-svelte`
- **State Management**: Svelte 5 `$state` proxies (deep reactive); direct mutation, no Immer
- **Type Utilities**: type-fest (used by `ReadonlyDeep` markers in a few places)
- **UI Components**: shadcn-svelte — vendored Bits UI primitives in `frontend/3rdparty/shadcn/`; paneforge (via the Resizable wrapper) for split panes
- **Styling**: Tailwind CSS v4 with OKLCH color space; `class={[...]}` for conditional classes (no `cn()` in app code)
- **Icons**: `@lucide/svelte` (icons imported individually for tree-shaking)
- **Utilities**: remeda (functional), semver, zod
- **Backend**: Rust (rusqlite + reqwest + `http-cache-semantics`) — in-process, no HTTP listener. `server::start` opens the SQLite cache and returns a `Server` handle the host calls from the WebView2 callback via `runtime.block_on(...)`; that handle also schedules Vite startup on the runtime.
- **Host**: Rust (eframe/egui + wgpu/DX12 + WebView2) — native startup/error UI, window management, WebView2 request interception, server + Vite-child lifecycle. eframe owns the root winit window and WebView2 uses its HWND as the parent for a child controller. The Vite child binds the main port; the host process owns no listener.
- **IPC**: WebView2 intercepts `/api/v1/*` requests from the frontend and dispatches them to the backend in-process (the frontend still calls plain `fetch`, oblivious to the routing); WebView2 `PostWebMessageAsJson` for navigation events; mitt-based event bus inside the frontend (`createSubscriber` bridges into Svelte reactivity).

### Sidebar Layout

```
┌─────────────────────────────────┐
│ [⌕ Search crates…             ] │  ← Prefix search / recent crates
│   serde                         │  ← Up to five suggestions
│   ────────────────────────────  │
│   + Add crate "ser"             │  ← Free-form action (non-exact input)
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
└── App.svelte (owns active `providerId` $state, IPC `navigated` listener,
                initial-document loading state, and resizable workbench layout)
    ├── WorkbenchToolbar.svelte (product identity + read-only current URL)
    ├── Explorer.svelte (left panel; receives the active provider as a prop,
    │                    owns ProviderDataStore, derives view model via
    │                    provider.render(ctx), wires up effects)
    │   ├── ExplorerHeader.svelte (panel label + active provider)
    │   ├── ExplorerSearch.svelte (prefix matches, five-item MRU, Add/Import actions)
    │   │   └── InputActionDialog.svelte (existing Import dialog, externally triggered)
    │   ├── ExplorerGroup (groupName="", derived ungrouped membership)
    │   ├── ExplorerGroup[] (per persisted name in groupOrder)
    │   │   ├── ExplorerGroupHeader (shared collapse + bulk actions;
    │   │   │                      persisted groups also support rename/move/delete)
    │   │   └── ExplorerItem[] (sorted by sortKey, shown when group expanded)
    │   └── ExplorerCreateGroupComponent
    └── editor pane (deferred iframe + loading/error placeholder)
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

- **Explorer** (`frontend/src/ui/explorer/Explorer.svelte`): Receives the active provider and latest reported navigation ID as props; owns per-provider data via `ProviderDataStore` (Svelte 5 `$state` class), constructs `ProviderContext`, calls `provider.render()` inside a `$derived`, and wires up the optional `provider.setupEffects(ctx)` hook inside a `$effect` so any inner `$effect`s the provider creates are bound to this component's lifecycle. A recognized reported navigation preserves the viewport when its page row is already visible; otherwise the Explorer expands the containing group and item, waits for their clipping animations, and minimally reveals the page (falling back to the item header). Recreated implicitly when `provider.id` changes (the `$derived` `ProviderDataStore` reinitializes with the new ID).
- **ExplorerSearch** (`ExplorerSearch.svelte`): Accessible Bits UI combobox over every provider item; shows at most five case-insensitive prefix matches, or the five most recently accessed items for empty input; dispatches provider-owned select/add actions and opens the existing Import dialog
- **ExplorerGroup** (`ExplorerGroup.svelte`): Owns the shared collapsible state and renders filtered/sorted items; the empty group name identifies derived ungrouped membership
- **ExplorerGroupHeader** (`ExplorerGroupHeader.svelte`): Shared chevron trigger and expand/collapse-all menu; persisted named groups additionally support rename, move, and deletion
- **ExplorerCreateGroupComponent** (`ExplorerCreateGroupComponent.svelte`): Button that transforms to inline input for creating new groups
- **ExplorerItem** (`ExplorerItem.svelte`): Collapsible card with name, version selector, menu; expansion state via `itemExpanded(providerId, itemId)` accessor
- **ExplorerItemMenu** (`ExplorerItemMenu.svelte`): Move to group submenu, external links, custom actions
- **ExplorerPageList** (`ExplorerPageList.svelte`): Sorted page list with symbol color coding and pinning buttons
- **InputActionDialog** (`InputActionDialog.svelte`): Generic dialog for `ProviderAction` of type `"input"` — provider supplies labels and an `invoke(value)` callback; the dialog owns the textarea/input UI and supports either its legacy button or an externally controlled trigger

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

Providers register in `frontend/src/providers/index.ts` as a plain `Provider[]` array (default export) and implement the `Provider<T>` interface from `frontend/src/core/data.ts`. Only one provider is rendered at a time — see "Active Provider Selection" below. Each provider's `render()` returns a `ProviderOutput` containing:
- `items: Record<string, Item>` — uniform view models with pages, links, actions, versions
- `search?: ProviderSearch` — provider wording and callbacks for generic item matching, activation, creation, and the empty-input action
- `actions?: ProviderAction[]` — provider-level UI (e.g., import dialog)

View models contain callbacks (e.g., `setPinned`, `setCurrentVersion`, `invoke`) that update provider data by directly mutating the `$state`-proxied store. View models are derived inside a `$derived` block — never memoized manually, never serialized. See `frontend/src/core/data.ts` for the full type definitions.

**Current:** `rust` (docs.rs + doc.rust-lang.org + windows-docs-rs). **Planned:** `rust.cargo`, `cpp.cppreference`, `cpp.msdocs`, etc.

**Data flow:**
```
[Disk/Storage]                         [Deserialization]         [Runtime]
<providerId>.toml ──────────► ProviderDataStore.load() ────► ProviderOutput (View Model)
localStorage (turbodoc:current-url) ──► currentUrl.value ──────► current URL (createSubscriber)
localStorage (turbodoc:expanded) ────► groupExpanded/itemExpanded ► expansion state
localStorage (turbodoc:recent-items) ─► ExplorerSearch ─────────► five-item provider MRU
http_cache SQLite (upstream RFC policy) ─► cache.svelte.ts ───► in-memory crate metadata $state
```

**Navigation flow:**
```
navigateTo(url) ──► DeferredNavigation.request(url)
                         ├─ before `frontend-shown`: retain latest URL
                         └─ after release: iframe.src = url
                                                │
                                                └─► WebView2 posts "navigated"
                                                      + navigationId
                                                            │
                                                            ├─► persist currentUrl
                                                            ├─► Explorer auto-reveal
                                                            │     ├─ visible page: preserve scroll
                                                            │     └─ hidden page: expand + reveal nearest
                                                            └─► correlate initial placeholder

FrameNavigationCompleted(navigationId) ──► matching initial load only
                                              ├─ success: reveal iframe
                                              └─ failure: show Retry state
```

#### Unified Rust Provider

The `rust` provider (`frontend/src/providers/rust/`) handles three documentation domains as a single provider. Originally planned as separate `rust.crate` and `rust.std` providers, merged for simplicity:
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

#### Active Provider Selection

The app shows exactly one provider at a time. `App.svelte` holds the active provider ID as ephemeral `$state` (no persistence yet — defaults to the first registered provider on every launch). A provider switcher UI is planned (placeholder `<!-- Provider Switch Here -->` in `App.svelte`); persistence of the selection will land alongside the planned rename of `/data/:providerId` to a generic key-value endpoint.

Switching providers does not delete other providers' data — `<providerId>.toml` files are independent and reappear unchanged when re-selected.

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
just install   # Installs frontend dependencies + builds the host
just run       # Launches the app with HMR
```

`just run` is `cargo run --release -- --data data`. There is only one mode. `server::start` opens the SQLite cache, then the host schedules the Vite child monitor on Tokio before eframe creates the root winit window and wgpu DX12 surface. egui immediately renders a spinner over the frontend workbench color while WebView2 creates its environment and hidden child controller through completion callbacks; no blocking wait pumps a second event loop. For each launch, the host generates an identity token and passes it to Vite as `TURBODOC_VITE_READY_TOKEN`. Vite owns `GET /ready`, which returns an empty `200` with the matching `X-TurboDoc-Vite-Ready-Token` header after its middleware stack is listening. The host polls that endpoint for at most five seconds, rejecting responses from stale Vite instances, then navigates to `http://127.0.0.1:{port}/` once both Vite and WebView2 are ready. Using the same IPv4 loopback address for Vite binding, readiness, and navigation avoids an IPv6-first `localhost` resolution mismatch. The initial Svelte render leaves the documentation iframe without a `src` and shows an editor-pane placeholder. WebView2's resulting `about:blank` frame bootstrap is allowed but ignored by document tracking; other unsupported frame URLs retain the normal external-link policy. After the top-level navigation completes, the host reveals the controller and posts `frontend-shown`; the frontend waits one animation frame before releasing its latest queued documentation URL. A persistent top-level completion handler repeats that notification after full Vite reloads. A Vite launch/exit, WebView2, readiness-timeout, or initial frontend-navigation failure remains in the native egui surface with expandable and copyable details. Documentation failures stay inside the visible editor pane with a bounded spinner and Retry action. The child handle stays owned and monitored after startup; an unexpected exit hides WebView2 so the native failure UI is visible. HMR's WebSocket talks to Vite on the same port — no `hmr.clientPort` override, no reverse proxy.

Initialization milestones log through `log::info` as `startup +… ms`. A shared monotonic origin makes the concurrently started Vite and native paths directly comparable. Expensive backend, runtime, eframe/wgpu, Vite-readiness, WebView2-environment, and WebView2-controller operations also report their individual phase durations. `WebView2 NavigationCompleted …; controller shown; document loading released` is the perceived-startup milestone because that is when the workbench becomes visible. The separate one-shot `initial document NavigationCompleted …` milestone measures time until the restored documentation becomes usable. Both completion handlers are application behavior rather than diagnostic instrumentation: the top-level handler preserves visibility-before-iframe ordering, while frame completion settles the editor placeholder.

#### Checking for Startup Regressions

Measure both cold and warm dependency-optimization behavior:

1. Close TurboDoc and remove only `frontend/node_modules/.vite`.
2. Run `just run`, then record the `startup +… ms` lines through both `WebView2 NavigationCompleted …; controller shown; document loading released` and `initial document NavigationCompleted …`. This is the cold-cache result and includes Vite dependency prebundling.
3. Close TurboDoc and run `just run` again without changing dependencies, `bun.lock`, or Vite configuration. Record the same lines. Repeat once if needed; these are warm-cache results and represent normal development startup.
4. Compare like with like against previous measurements. A slower `Vite ready on port …` phase points to Vite startup or dependency optimization. Slower WebView2 environment/controller phases point to native browser initialization. If those milestones remain stable but either the shell-visible or initial-document time grows, temporarily add targeted navigation lifecycle probes rather than keeping additional per-navigation telemetry in the normal runtime.

Use the controller-shown timestamp as the perceived-startup headline and retain the initial-document completion as the time-to-content companion metric. Keep the intermediate milestones with both results so the responsible path remains identifiable. Avoid adding Svelte libraries to `optimizeDeps.exclude` merely because they ship `.svelte` sources: `vite-plugin-svelte` supports prebundling them, and excluding large libraries shifts their module graph into the initial on-demand transform path. Keep Lucide imports at individual icon paths such as `@lucide/svelte/icons/pin` so Vite does not traverse the complete icon collection.

A Windows Job Object (set up in `src/main.rs`) ensures the spawned Vite child dies when the host exits, even on abrupt termination.

No packaged-prod build path exists yet. When it lands, it will likely use `ICoreWebView2Environment3::SetVirtualHostNameToFolderMapping` to serve `frontend/dist/` directly from WebView2 — no Rust file server, no bound TCP port.

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
- Theme tokens live in `frontend/global.tailwind.css`; global behavior such as
  typography, scrollbars, selection, and collapse animation lives in
  `frontend/global.css`.
- The OKLCH dark palette follows the current VS Code workbench model: a dark
  outer chrome, subtly separated explorer/editor surfaces, low-contrast panel
  borders, and distinct hover and selection rows.
- Workbench-specific tokens (`--workbench`, `--editor`,
  `--workbench-hover`, `--workbench-selection`, and
  `--workbench-divider`) complement the shadcn semantic tokens inherited by
  buttons, fields, menus, selects, and dialogs.
- Dark mode is triggered by `class="dark"` on `<html>` plus
  `@custom-variant dark (&:is(.dark *))`.

### One Dark Symbol Colors (CSS variables in `frontend/global.css`)
- Yellow (`--color-yellow`): type (struct, enum)
- Cyan (`--color-cyan`): interface (trait)
- Blue (`--color-blue`): function
- Orange (`--color-orange`): macro, constant
- Default: namespace (module), unknown

### Typography
- Monospace font for item names and page links (`font-mono`)
- Compact hierarchy: uppercase panel label, semibold group rows, monospace item
  rows, and smaller monospace page rows.
- Italic for preview pages (emphasis without weight)
- Base font size: 14px (set in `:root` in `frontend/global.css`)
- Font families: Segoe UI Variable/system UI for chrome and Cascadia
  Mono/Consolas for documentation identifiers; no downloaded font assets.

### Spacing
- 4px workbench gutters separate the rounded explorer and editor panels.
- Tree rows use 24–28px heights, shallow indentation, and compact controls.
- Depth comes from panel borders and surface contrast rather than per-item cards
  or heavy shadows.

### Icons (Lucide)

| Component | Icon | Usage |
|-----------|------|-------|
| External Link | `ExternalLink` | Item external links |
| Pin | `Pin` | Pin/unpin button for pages |
| Menu | `EllipsisVertical` | Item/group actions menu |
| Expand All | `ChevronsDown` | Expand all items in group |
| Collapse All | `ChevronsUp` | Collapse all items in group |
| Move Up | `ArrowUp` | Move group up |
| Move Down | `ArrowDown` | Move group down |
| Move to Top | `ArrowUpToLine` | Move group to top |
| Move Under | `LogIn` | Move group under another |
| Move to Group | `LogIn` | Move item to another group |
| Rename | `Pencil` | Rename group |
| Add | `Plus` | Add group button |
| Confirm | `Check` | Confirm rename/add |
| Delete | `Trash2` | Delete group/item |
| More Versions | `Ellipsis` | Version selector placeholder |
| Chevron | `ChevronDown` / `ChevronRight` | Group/item expand-collapse |

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
- One site-agnostic `http_cache` stores any intercepted upstream response that is storable under its actual HTTP headers. There are no URL-prefix TTL overrides or crate-specific tables.
- WebView2 is the process-local L1 cache and SQLite is the persistent/offline L2. The proxy forwards an explicit allowlist of representation, freshness, validator, CORS, privacy, and timing fields; it recomputes `Content-Length` and blocks connection, cookie/authentication, reporting, unsupported range, encoding, digest, CSP, and frame-policy fields.
- Cache entries persist the allowed upstream-derived response fields separately from `CachePolicy`. Fresh hits use the correctly aged response parts returned by `http-cache-semantics`; stale hits add downstream `Cache-Control: no-cache` so WebView2 must return after background revalidation.
- Sparse-index files are the default crate source. The CDN currently provides explicit freshness plus validators, so normal proxy hits and background conditional revalidation apply without adaptation.
- The crates.io API is requested only by the "Refresh Metadata" action. The frontend uses standard `fetch(..., { cache: "no-store" })`; the generic proxy recognizes the resulting request cache directive and bypasses reuse without knowing which site is being refreshed.
- Each provider owns its upstream formats and within-session state. The Rust provider constructs Cargo index paths and parses both newline-delimited index entries and the richer API response in `metadata.ts`; its `$state` cache starts empty on each launch.
- The index intentionally provides package-resolution fields rather than website presentation metadata. Default results therefore include versions and yanked state; Homepage and Repository links appear after an explicit API refresh.

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
- The Rust provider references that same input action from `ProviderSearch.emptyAction`, so empty search offers `Import…` without duplicating the bulk-import dialog or parser.
- Earlier (React) iterations of this codebase used `type: "node"` carrying a `ReactNode` — the Svelte migration replaced that with the declarative `"input"` shape, eliminating the need for providers to ship UI components.

**Migration & Compatibility**
- On startup, if data files don't exist or don't match expected format, initialize with empty defaults
- The Rust server's `/api/v1/data/{fileName}` route accepts any `fileName`, so picking a provider ID that collides with an unrelated file would write to the same TOML — use distinct provider IDs

**Provider API Surface**
- No `serialize`/`deserialize` methods — view model callbacks mutate `$state`-proxied data directly
- No provider collapsing in sidebar — exactly one provider is active at a time, chosen by the (forthcoming) switcher

**Thin-Callback Pattern**
- All proxy and caching logic lives in the in-process backend (`src/server/`). WebView2 registers exact origin/path filters for `PROXIED_URL` and the configured IPv4-loopback `/api/v1/*` origin, so unrelated frontend, HMR, and external traffic never enters the callback. The callback is a router: match the request URL against `PROXIED_URL` prefixes → `server.fetch`; match the path against `/api/v1/` → `server.dispatch_api`; otherwise pass through.
- Backend futures run through the tokio runtime via `Handle::block_on` from the WebView2 UI callback, avoiding a serialize/deserialize round trip or bound TCP listener.
- No axum, no tower-http. The crate has no HTTP server of its own; only the Vite child binds the network.

**Architectural Constraints**
- No URL Rewriting: the WebView still believes it is browsing `docs.rs` directly
- No SSL Proxy: proxying happens after WebView2 intercepts the request intent
- Interception by both URL prefix and path: docs are matched by `PROXIED_URL` (host+scheme), API calls by path prefix (`/api/v1/`). Path-based matching means the API surface works regardless of the page's origin (currently `127.0.0.1:{port}` = Vite; future packaged builds could use a virtual host).
- Configurable Port and Data Directory: required at startup via clap CLI args (`--port`/`-p`, `--data`/`-d`) with env-var fallbacks (`TURBODOC_PORT`, `TURBODOC_DATA`); no defaults — the host fails fast if neither flag nor env var is supplied. The data directory is consumed by `server::start`; the port is consumed by the host's concurrent frontend-startup configuration.

**Dark Mode Injection (Serve-Time)**
- Cache stores clean upstream content; dark mode injection applied at serve time
- Technique: insert `<script>window.localStorage.setItem('rustdoc-theme', 'dark');</script>` after `<meta charset="UTF-8">` in rustdoc HTML responses
- The transform is stable and deterministic, so injected HTML retains upstream freshness in WebView2. Its upstream strong `ETag` and body digests are dropped because the final bytes differ; `Content-Length` is recomputed.
- Any future state-dependent theme transform or change to the injected bytes must first revise browser-cache invalidation.

### Data Model

**Split Data Persistence**
- Workspace persisted as **TOML** files under `$TURBODOC_DATA/` (parsed/serialized via the `toml` crate in `src/server/api/data.rs`); the HTTP wire format remains JSON, so the frontend sees no difference:
  - `<providerId>.toml` — per-provider user data (groups, provider-specific data). Loaded lazily per-provider by `ProviderDataStore.load()` inside `Explorer.svelte`.
- Transient UI state stored in **localStorage** as individual slots, not on the server. Two storage shapes managed by `frontend/src/core/localStorage.ts`:
  - **Primitive** (`turbodoc:current-url`, `turbodoc:recent-items`): current URL plus provider-keyed five-item MRU lists, simple get/set
  - **Array** (`turbodoc:expanded`): flat string array of expanded item/group keys. Key format: `<providerId>:<itemId>` for items, `<providerId>:group:<groupId>` for groups. Membership-check hooks (`useGroupExpanded`, `useItemExpanded`) with selective re-rendering via mitt events — only hooks whose specific key changed re-render.
  - Each slot validated with Zod on load; invalid/missing data falls back to empty defaults (default URL `https://docs.rs/`, nothing expanded). See `frontend/src/core/localStorage.ts` and `frontend/src/core/uiState.svelte.ts`.
- Sparse-index responses use the same RFC-aware `http_cache` SQLite table as documentation pages. Parsed crate metadata is provider-owned, within-session state in the Rust provider's module-level `$state` singleton.
- Server-persisted via HTTP API (`/api/v1/data/{fileName}` — one route per provider data file, plain JSON over `fetch`).
- Provider-data save failures are non-fatal (log + return `{}`). Auto-save on every state change (no debouncing — files are small).

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
ProviderData ($state) ──► provider.render() inside $derived ──► render
              │
              └── direct mutation on the $state proxy
```

- `provider.render()` is a pure data-derivation function called inside a `$derived` block in `Explorer.svelte`. It re-runs whenever its dependencies (`ctx.data`, `ctx.currentUrl`, the `cache.svelte.ts` store) change — Svelte 5 tracks reads automatically.
- Per-provider effects (URL sync and seeding) live in the optional `provider.setupEffects(ctx)` method, called once at host init. Implementations live in `*.svelte.ts` modules so their `$effect` runes bind to the host component's lifecycle. User-intent metadata requests are view-model callbacks rather than startup effects.
- View models contain callbacks (closures over `$state`-mutating functions) — never serialized.
- Direct mutation on `$state` proxies replaces Immer drafts — `ctx.data.crates[name] = …` is reactive.
- `ProviderContext` is constructed once in `Explorer.svelte` with reactive getters over the `ProviderDataStore` (`@/core/providerData.svelte`).

**Independent State Atoms**
- `App.svelte` owns the active `providerId` ($state, ephemeral) and the `navigated` IPC event handler (writes `currentUrl` to localStorage). No server-persisted app-level state.
- `currentUrl` consumed via the `currentUrl.value` reactive accessor (`@/core/uiState.svelte`) in components that need it (`ExplorerPageList`, etc.) — not routed through any global state container.
- Expansion state managed per-component via the `groupExpanded`/`itemExpanded` factories — each accessor reads/writes its own key in the `turbodoc:expanded` localStorage slot. mitt events filter by element so only the matching subscribers re-render.
- Provider data is lazily loaded per-provider inside `Explorer.svelte` via `ProviderDataStore.load()`.
- Each atom has independent auto-save — a change in one slice doesn't trigger writes to others.

**Hybrid IPC**
- Per-provider data CRUD via `/api/v1/data/{file_name}` — frontend calls `fetch()` like any HTTP API; WebView2 intercepts the path and routes it to the in-process `api::data` handlers (no network hop, no axum).
- UI state via localStorage (`turbodoc:current-url`, `turbodoc:expanded`) — no IPC round-trip.
- Documentation and sparse-index caching via the proxy's `http_cache` SQLite (upstream freshness directives, conditional stale-while-revalidate, LRU eviction). The frontend fetches upstream metadata URLs directly and parses their bodies.
- Navigation events via WebView2 `postMessage` (low-latency, event-driven).
- All persistence operations are non-fatal (log errors, don't crash).

**Decomposed Root State (no AppContext class)**
- `App.svelte` owns the active `providerId` ($state) and passes the derived `provider` object as a prop to `Explorer.svelte`. There is no server-persisted `appData` — first paint does not wait on any network round-trip.
- `navigateTo(url)` is a plain function exported from `@/core/context.svelte`. Before the host's `frontend-shown` event it retains only the latest requested URL; after release it imperatively writes `viewerRef.value.src`. Any module can call it without provider/consumer pairing, while startup effects cannot accidentally begin documentation loading under the hidden shell.
- `viewerRef` (`{ value: HTMLIFrameElement | undefined }` with a `$state` field) lives in `@/core/context.svelte`. `App.svelte` writes to it via `bind:this={ctx.viewerRef.value}`; `navigateTo` in the same module reads it. No context entry needed because module-level `$state` is already a singleton.
- `currentUrl` read via the `currentUrl.value` accessor — not part of root state.
- Provider data loaded lazily per-provider inside `Explorer.svelte`.

**Graceful Degradation**
- Stale proxy cache preferred over no data: if upstream refetch fails, the proxy serves the cached response
- App fully functional without API metadata (loads with an empty in-memory cache and fetches sparse-index data on demand through the proxy)
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
- Expansion state managed per-component via `useItemExpanded(providerId, itemId)` hook from `frontend/src/core/uiState.svelte.ts`
- Named and ungrouped groups share the same controlled Collapsible path and `groupExpanded(providerId, groupId)` accessor; ungrouped uses the data model's empty group ID
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

**Auto-Reveal on Navigation**
- Runs only for accepted WebView2 `navigated` reports, not incidental URL-storage or provider-data changes
- Leaves the Explorer untouched when any vertical portion of the corresponding active page row is already visible
- Otherwise expands the containing group and crate, waits for their collapse-layout animations, and scrolls the page row by the minimum nearest-edge distance
- Falls back to the crate header when a provider recognizes the crate but exposes no corresponding page row
- Uses the navigation ID for latest-wins cancellation so redirects and rapid navigation cannot apply stale scrolling
- Preserves keyboard focus and honors reduced-motion preference for programmatic scrolling

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
│
├── frontend/                   # Svelte 5 frontend (own package.json + tsconfig.json)
│   ├── package.json            # Frontend dependencies (Svelte, bits-ui, paneforge, @lucide/svelte, etc.)
│   ├── tsconfig.json           # Extends `@tsconfig/svelte`; `target: ES2022`, `types: ["bun"]`; `include: ["src"]`; paths: `@/*` → frontend/src/, `@/server/*` → server/src/, `@shadcn/*` → frontend/3rdparty/shadcn/
│   ├── vite.config.ts          # Root: frontend/, aliases: `@/` → frontend/src/, `@/server/` → server/src/, `@shadcn/` → frontend/3rdparty/shadcn/
│   ├── svelte.config.ts        # Svelte preprocessor + global warning suppression for a11y/state-ref rules
│   ├── components.json         # shadcn-svelte CLI config (baseColor: zinc, framework: svelte)
│   ├── index.html              # Entry HTML
│   ├── index.ts                # Svelte entry point (`mount(App, ...)`); lives at the frontend root, not under src/
│   ├── global.css              # Tailwind imports, shadcn Zinc OKLCH palette (`:root` + `.dark`), `@theme inline` token mapping, One Dark symbol palette, Bits UI Collapsible animation
│   │
│   ├── 3rdparty/
│   │   └── shadcn/             # Vendored shadcn-svelte primitives (Bits UI / paneforge)
│   │       ├── components/ui/  # button, card, dialog, dropdown-menu, input, resizable, select, separator, collapsible
│   │       └── lib/utils.ts    # cn() — clsx + tailwind-merge wrapper (used internally by vendored components only)
│   │
│   └── src/                    # All application TS/Svelte source (referenced via `@/*` alias)
│       ├── core/
│       │   ├── data.ts                 # Zod schemas + inferred types (ProviderData, Provider, Item, Page, IconProp, ProviderAction)
│       │   ├── context.svelte.ts       # Provider context accessors plus the shared iframe reference and deferred `navigateTo(url)` gate
│       │   ├── documentLifecycle.ts    # Initial iframe navigation gate + correlated placeholder state reducer
│       │   ├── documentLifecycle.test.ts # Deferred-navigation and stale-completion unit tests
│       │   ├── providerData.svelte.ts  # `ProviderDataStore` reactive class — `$state` data + load + autosave
│       │   ├── ipc.ts                  # HTTP data wrappers + validated WebView2 top-level/frame lifecycle events
│       │   ├── itemSearch.ts           # Prefix index/matching + recent-item algorithms
│       │   ├── itemSearch.test.ts      # Prefix, exact-match, limit, and MRU unit tests
│       │   ├── localStorage.ts         # Typed localStorage abstraction (Zod validation, mitt events, primitive + array APIs)
│       │   └── uiState.svelte.ts       # Reactive URL, expansion, and recent-item accessors over mitt+localStorage
│       │
│       ├── providers/
│       │   ├── index.ts            # Provider registry (default-exported `Provider[]`)
│       │   └── rust/               # Unified Rust provider
│       │       ├── index.ts            # Provider implementation (render, URL handling, page parsing, getImportCratesAction inlined)
│       │       ├── effects.svelte.ts   # Per-provider $effect setup (URL sync, seed crates)
│       │       ├── cache.svelte.ts     # `$state` singleton + lazy sparse-index/API fetching
│       │       ├── cache-core.ts       # Rune-independent deduplication and latest-wins request coordinator
│       │       ├── cache-core.test.ts  # Lazy request lifecycle and race unit tests
│       │       ├── metadata.ts         # Cargo index paths + sparse-index/API parsers
│       │       ├── metadata.test.ts    # Metadata URL and parser unit tests
│       │       ├── url.ts              # URL parsing/building (docs.rs, doc.rust-lang.org, windows-docs-rs)
│       │       └── url.test.ts
│       │
│       ├── ui/
│       │   ├── App.svelte          # Root: active `providerId` $state, IPC `navigated` listener, Resizable layout; iframe binds via `bind:this={ctx.viewerRef.value}`
│       │   ├── common/
│       │   │   └── Icon.svelte     # Icon wrapper (lucide-svelte)
│       │   └── explorer/
│       │       ├── Explorer.svelte                  # Active provider host: owns ProviderDataStore, derives view model, sets up effects
│       │       ├── ExplorerGroup.svelte             # Group renderer (default + ungrouped variants)
│       │       ├── ExplorerGroupHeader.svelte       # Group header (collapse, rename, dropdown menu)
│       │       ├── ExplorerCreateGroupComponent.svelte # Add group button/input
│       │       ├── ExplorerItem.svelte              # Collapsible item card with version selector
│       │       ├── ExplorerItemMenu.svelte          # Item menu (move to group, links, actions)
│       │       ├── ExplorerPageList.svelte          # Page list with symbol colors + pinning
│       │       ├── ExplorerSearch.svelte            # Prefix/MRU combobox with Add and Import footer actions
│       │       └── InputActionDialog.svelte         # Generic dialog for `"input"` ProviderAction
│       │
│       └── utils/
│           ├── version-group.ts    # Semver version grouping
│           └── version-group.test.ts
│
├── src/                        # Rust host + in-process backend
│   ├── main.rs                 # Tokio runtime, clap args, Job Object, backend start, app launch
│   ├── app.rs                  # Concurrent Vite/WebView2 startup, eframe splash/error UI, request interception
│   ├── startup.rs              # Shared elapsed-time probe and frontend-matched startup color
│   ├── webview.rs              # WebView2 wrapper (environment, colored controller, event handlers)
│   └── server/                 # In-process backend (no HTTP listener)
│       ├── mod.rs              # `Server` handle (fetch + dispatch_api), AppState, http client + USER_AGENT
│       ├── state.rs            # AppState (DB, http_client, revalidating dedup, data_dir)
│       ├── db.rs               # `cache.sqlite` open + WAL + schema; drops legacy `crates_cache` table
│       ├── api/
│       │   ├── mod.rs          # `dispatch(state, req)` — path-prefix routing + per-request access log
│       │   └── data.rs         # GET/PUT /data/{file_name} (TOML on disk via `toml` crate)
│       ├── proxy/
│       │   ├── mod.rs          # Generic RFC-aware fetch, request cache bypass, response assembly
│       │   ├── cache.rs        # `http_cache` body/policy/allowed-header storage + LRU eviction
│       │   ├── headers.rs      # Explicit WebView2 response-header policy + scoped metadata CORS
│       │   ├── inject.rs       # Stable rustdoc dark-mode <script> injection at serve time
│       │   └── revalidate.rs   # Stale-while-revalidate background task + DashSet dedup
│       └── frontend.rs         # Own Vite + HTTP readiness polling + lifetime exit monitoring
│
├── target/                     # Build output (Rust + runtime data)
│   └── data/                       # Runtime data directory ($TURBODOC_DATA)
│       ├── cache.sqlite            # SQLite database (unified http_cache, WAL mode)
│       └── <id>.toml               # Per-provider user data
│
└── docs/
    └── README.md               # This file
```

---

## Open Questions & Assumptions

### Assumptions Made

1. **Metadata CORS**: crates.io API responses allow cross-origin reads; the sparse index does not, so both configured metadata origins pass through the host proxy. The response policy preserves upstream CORS and synthesizes wildcard read access only when a configured public metadata origin omitted it.
2. **Semver compliance**: Confirmed — crates.io enforces semver, safe to rely on
3. **Single preview page**: Each crate has at most one preview page at a time (derived from `currentUrl`)
4. **No nested groups**: Groups contain items, not other groups (flat structure)
5. **Item discriminated union**: `ProviderOutput.items` uses `Record<string, Item>` (uniform view model)

### Remaining Items

1. **Preset picker UI**: Not yet built — switching presets requires manual workspace edit
2. **Frontend loading/error states**: Native host startup has a spinner and diagnostic error surface; in-app operations still have no shared skeleton/error-boundary system
3. **Packaged-prod build**: Not yet designed — the current shape always spawns Vite. When packaging lands it'll likely use WebView2's `SetVirtualHostNameToFolderMapping` to serve `frontend/dist/` directly with no Rust file server.

### Known Limitations

1. **URL `index.html` not normalized**: `buildUrl`/`parseUrl` in `frontend/src/providers/rust/url.ts` treat `tokio/runtime/` and `tokio/runtime/index.html` as distinct paths. Pin-matching uses the raw path as the key, so the same logical page can be pinned twice if the user reaches it from both forms. An earlier normalization attempt broke root-module detection (which compares against the `"crate/"` form in `rust/index.ts` and the import action) and produced an undefined-name bug for bare version-root URLs — was reverted.

---

## Success Criteria

### Completed
- [x] Multi-provider architecture with view model derivation
- [x] Data/cache persistence via HTTP API
- [x] Unified Rust provider (docs.rs + doc.rust-lang.org + windows-docs-rs)
- [x] Pin/unpin documentation pages with preview page system
- [x] Version selection with semver grouping
- [x] Named groups with full CRUD (create, rename, reorder, delete)
- [x] Move items between groups
- [x] Import crates from docs.rs URLs
- [x] Symbol parsing with One Dark color coding
- [x] Automatic cross-crate navigation via `navigated` event
- [x] Provider-aware Explorer search with prefix matching, Add/Import actions, and IPC-derived recent crates
- [x] Auto-save data and cache on every change
- [x] HTTP proxy with SQLite cache and dark mode injection (v0.3)
- [x] Rust host with native egui startup UI and WebView2 (eframe/wgpu + webview2-com)

### Remaining
- [ ] Provider switcher UI (and persistence of the active provider selection)
- [ ] Shared frontend loading/error states
- [ ] Keyboard shortcuts
- [ ] Cross-provider navigation (partially done via unified rust provider)

---

## Change History

- **2026-08**: Auto-reveal reported iframe navigation in the Explorer. Pass the accepted WebView2 navigation ID separately from persisted `currentUrl` so metadata, storage, and other reactive updates cannot move the sidebar. If the active page row is already at least partially visible, preserve the viewport; otherwise expand its containing group and crate, wait for Bits UI clipping animations, and minimally scroll the page into view with a crate-header fallback. Cancel stale reveal work by navigation generation, retain iframe focus, honor reduced motion, and cover viewport/clipping geometry with dependency-free unit tests.
- **2026-08**: Replace the Rust provider's standalone Import button with a provider-aware Explorer combobox. Non-empty input performs case-insensitive prefix matching over all crates, returns at most five `sortKey`-ordered results, suppresses Add only for exact matches, and retains the existing bulk Import dialog as the empty-input footer action. Empty input shows up to five provider-scoped recently accessed crates stored in localStorage; history advances from the active item derived from IPC-persisted `currentUrl`, not frontend click intent. Selecting or adding navigates to the crate root, while metadata remains lazy. Keep the matching and MRU algorithms rune-independent and unit tested.
- **2026-08**: Split visible-shell startup from restored documentation loading. `App.svelte` initially renders a blank iframe beneath an editor-pane spinner; all early `navigateTo()` calls pass through a latest-request-wins gate. After successful top-level `NavigationCompleted`, the host reveals WebView2 and posts `frontend-shown`; the frontend waits one animation frame before assigning the iframe source. Hosted frame starts/completions carry string navigation IDs so stale results cannot settle the placeholder, while failure or a 30-second document timeout produces an in-pane Retry state without hiding the usable workbench. The persistent top-level handler repeats release after full Vite reloads, and standalone browser development falls back to the iframe `load` event.
- **2026-08**: Replace Vite's one-shot TCP-port probe with a Vite-owned `GET /ready` endpoint and a five-second HTTP readiness deadline. Verify each response against the launch-specific `TURBODOC_VITE_READY_TOKEN` so a stale Vite instance cannot satisfy the probe. Retain and monitor the child handle for its full lifetime so pre- and post-startup exits reach the native error surface, and bound the initial WebView2 navigation wait to 30 seconds.
- **2026-07**: Replace the one-shot GDI startup paint and blocking WebView2 creation wait with an extensible native egui surface. eframe now owns the root winit window and wgpu DX12 renderer; Vite starts before GPU initialization, WebView2 creates its environment and hidden child controller through UI-thread completion callbacks, and a tested coordinator requests initial navigation exactly once after both paths are ready. Render a workbench-colored spinner during initialization and show Vite, WebView2, and initial-navigation failures in-window with expandable/copyable diagnostics. Keep the WebView2 child hidden until successful `NavigationCompleted`, preserve native-dialog confirmation for external URLs, and reserve egui viewports for future custom secondary windows.
- **2026-07**: Make the derived Ungrouped section collapsible and consolidate all explorer groups onto one controlled Bits UI Collapsible path. The empty group name remains Ungrouped's stable data-model identity and now persists expansion through the existing `groupExpanded` accessor. Reuse the shared header and bulk item expansion actions while capability-gating rename, reorder, and delete to persisted named groups.
- **2026-07**: Diagnose and remove a frontend startup regression caused by excluding `@lucide/svelte`, `bits-ui`, and `paneforge` from Vite dependency optimization. Restore `vite-plugin-svelte`'s default prebundling and replace the remaining Lucide icon-barrel import with a direct icon import, reducing observed startup from roughly 20–28 seconds to about 7 seconds. Retain monotonic initialization milestones and phase durations as regression telemetry; remove the temporary top-level navigation lifecycle and Vite first-request probes after they isolated the delay to frontend transformation. Document cold/warm regression checks and why each remaining WebView2 event handler is functional.
- **2026-07**: Align the hosted frontend URL with Vite's IPv4-only bind and readiness probe: navigate WebView2 to `127.0.0.1` instead of `localhost`, avoiding a possible IPv6-first `::1` connection attempt before fallback.
- **2026-07**: Extend version-selector intent across the complete crate item. Hovering or focusing an expanded page row now keeps the owning crate's selector visible and uses the same lazy metadata request policy; moving between the header and pages no longer flickers or cancels pending hover intent.
- **2026-07**: Make crate metadata fetching intent-driven. Remove the Rust provider's startup batch-fetch effect; expose `ItemVersions.status` + idempotent `ensureLoaded()`; reveal the selector on card hover/focus (always on non-hover devices) with idle/loading/error affordances and a 125 ms mouse hover-intent delay. Add a rune-independent `CrateCacheLoader` that deduplicates requests, retains usable data across refresh failures, and uses request generations so stale sparse-index responses cannot overwrite newer explicit API refreshes. Workspace restore and bulk import now issue no automatic crate metadata requests. See `docs/M4-LazyFetching.md`.
- **2026-07**: Reduce and instrument perceived startup latency. Add a shared monotonic elapsed-time probe with cumulative `log::info` milestones and phase durations; schedule Vite on Tokio concurrently with native window and WebView2 creation; synchronize through a typed winit readiness event before the first navigation. Show the native window during WebView2 initialization with the frontend's exact workbench background (`#0E0F13`), apply that color through WebView2 controller options at creation time, and keep only the controller hidden until the initial page completes.
- **2026-07**: Scope WebView2 request interception to the supported documentation, crate-metadata, and configured localhost API URL patterns. Replace the global `*` request filter with exact origin/path filters while preserving iframe-originated request coverage; unrelated Vite assets, HMR traffic, and external URLs no longer cross the WebView2 callback boundary.
- **2026-07**: Expose safe upstream response semantics to WebView2 as a process-local L1 cache. Add an explicit response-header allowlist for representation, cache, validator, CORS, privacy, and timing fields; synthesize wildcard CORS only for configured public crate-metadata origins; continue blocking connection, browser-state, authentication, reporting, unsupported range, encoding, digest, CSP, and frame-policy fields. Persist allowed upstream-derived fields in the SQLite `http_cache` through an additive `response_headers` migration, use correctly aged `http-cache-semantics` parts for fresh hits, force downstream `no-cache` for stale-while-revalidate hits, and refresh stored fields after 304/modified revalidation. Dark-mode injection now reports whether it changed bytes: its stable deterministic HTML retains upstream freshness and `Last-Modified`, while the invalid upstream strong `ETag`, digest/encoding metadata, and length are removed or recomputed.
- **2026-07**: Split Rust crate metadata sources and move all crate awareness to the frontend. Normal loads now construct Cargo sparse-index paths (`https://index.crates.io/...`) and parse newline-delimited version records in `frontend/src/providers/rust/metadata.ts`; "Refresh Metadata" alone fetches and parses the real-time crates.io API with browser cache mode `no-store`, which the generic proxy honors as a request cache bypass. Delete the backend `/api/v1/crates` endpoint, `api/crates.rs`, `crates_metadata.rs`, cache-peek/warming protocol, polling/backoff frontend code, and crates.io-specific synthetic 24-hour TTL. The proxy now applies only upstream HTTP cache policy to every site, while the host intercept list includes the sparse index and API origins so WebView2 can bridge index CORS. Default index results contain versions/yanked state; Homepage and Repository links are populated only by an explicit API refresh.
- **2026-05**: Unify caches + remove axum + collapse to a single mode. Two intertwined cleanups: (1) the dedicated `crates_cache` SQLite table is gone — crate-metadata lookups now flow through the standard HTTP proxy, with `proxy::synth_max_age_for(url)` synthesizing `cache-control: public, max-age=86400` for `https://crates.io/api/v1/crates/*` URLs so RFC 7234 / stale-while-revalidate / LRU eviction all apply uniformly; `src/server/crates_cache.rs` collapsed to `src/server/crates_metadata.rs` (just `CrateMetadata` types + `parse_metadata`); legacy table dropped on startup via `DROP TABLE IF EXISTS crates_cache` in `src/server/db.rs`. (2) `axum` + `tower-http` removed entirely — the in-process backend no longer binds a TCP listener. WebView2's `WebResourceRequested` callback now routes intercepted requests to the backend in-process: docs URLs → `Server::fetch` (proxy + dark-mode), `/api/v1/*` paths → `Server::dispatch_api` (path-prefix dispatch into the rewritten `api::{data, crates, mod}` plain-async-fn handlers), everything else passes through. `Server` (renamed from `ProxyHandle`) wraps `AppState` + `tokio::runtime::Handle` and calls handlers via `Handle::block_on` on the UI thread — same blocking semantics as the old HTTP loopback, minus the serialize/deserialize round trip. `/api/v1/crates` is now non-blocking on cache misses: the handler peeks the proxy cache per name; fresh/stale entries are returned inline in `results`, misses are sent to a deduped warming task (via `state.revalidating`) and the name appears in `pending`. Frontend `cache.svelte.ts::batchFetchCrateCache` polls the pending names with exponential backoff (500ms → 4s, max 8 attempts). Prod mode + `--dev` flag dropped — there's only one mode now: Vite spawns on the main port directly (no port offset, no reverse proxy, no `frontend::reverse_proxy`/`prod_service`), WebView2 navigates to `localhost:{port}` (= Vite). `vite.config.ts` drops the `hmr.clientPort` override (HMR uses the page's port natively). `.justfile` drops `--dev` from the `run` recipe. Net: caches consolidated, two layers (`axum` adapters + `crates_cache`) deleted, dev/prod split collapsed.
- **2026-05**: Bridge WebView2 `WebResourceRequested` directly to `proxy::dispatch` (precursor to the broader axum removal): replace the host-side `reqwest::blocking::Client` loopback (host → `localhost:{port}/proxy?url=...` → axum → `proxy::dispatch`) with a direct in-process call (host → `Server::fetch` → `runtime.block_on(proxy::fetch(...))`); split `proxy::dispatch` into a shared `proxy::fetch` returning `http::Response<Vec<u8>>` (used by both the axum route adapter and the new host path); add `Server` type returned by `server::start`; drop `reqwest`'s `blocking` feature from `Cargo.toml`; the axum `/proxy` route becomes a 4-line adapter calling the shared `fetch`. Eliminates one kernel loopback + one serialize/deserialize per intercepted resource (dozens per docs.rs nav).
- **2026-05**: Rewrite the server in Rust and fold it into the host binary: replace the Bun + Hono + Vite-middleware server (`server/`, now deleted) with an in-process axum server under `src/server/` running on a multi-thread tokio runtime; preserve every HTTP endpoint (`/api/v1/data/{fileName}`, `/api/v1/crates`, `/proxy?url=`) and on-disk format (TOML provider files, `cache.sqlite` with the same `http_cache` + `crates_cache` schemas — no migration); `http-cache-semantics` for RFC 7234 freshness, `rusqlite` (bundled, single connection behind `Mutex` via `tokio::task::spawn_blocking`), `reqwest` for upstream fetches (manual redirect), `dashmap::DashSet` for stale-while-revalidate dedup, `tower-http::ServeDir` for prod frontend; add `--dev` clap flag that spawns `bunx --bun vite dev` on `port + 10000` and reverse-proxies non-API traffic — Vite reads `TURBODOC_VITE_PORT` from env and pins `hmr.clientPort` to the same port so HMR WebSocket bypasses the proxy; drop the data-loss-guard documentation block (was never implemented in the prior server); drop `hono` from frontend deps and rewrite `frontend/src/core/ipc.ts` to use plain `fetch` (no more `hc<typeof apiRoute>`); existing `cache.sqlite` rows from the Bun server stay readable, except `policy` JSON shape changes — the new server detects deserialize failures, drops the row, and re-fetches; `policy` write format is now `serde_json::to_string(&CachePolicy)` from the Rust crate's `serde` feature
- **2026-05**: Remove the frontend `appData` / preset data flow: delete `appDataSchema` and the `AppData` type from `frontend/src/core/data.ts`; delete `loadPresetData()` / `savePresetData()` and the now-unused `getJsonFromResponse` helper from `frontend/src/core/ipc.ts`; drop the `appData` `$state`, its load/autosave `$effect`s, and the `{#if appData}` render gate from `App.svelte` so first paint no longer waits on a network round-trip; persistence-file list comment in `data.ts` updated to drop the `preset.json` bullet; the server's `/data/preset` route remains (unused) pending cleanup alongside the planned rename of `/data/:providerId` to a generic key-value endpoint; on-disk `preset.toml` is abandoned (no migration code, mirroring the prior `workspace.json` precedent); future app-wide settings will piggyback on the renamed generic data endpoint
- **2026-05**: Move to one-provider-at-a-time architecture: collapse `frontend/src/ui/explorer/ExplorerProvider.svelte` into `Explorer.svelte` (single file now owns the `ProviderDataStore`, derives the view model via `provider.render(ctx)`, wires up the optional `provider.setupEffects(ctx)` hook, and runs the eager orphan cleanup `$effect`); switch `frontend/src/providers/index.ts` from `Record<string, Provider>` (built via `remeda.mapToObj`) to a plain default-exported `Provider[]` array, dropping the lone `remeda` usage in that file; `App.svelte` now selects exactly one provider via local `providerId` `$state` (defaulting to `providers[0].id`) and a `$derived` `provider` lookup, replacing the previous iteration over `appData.presets[currentPreset].providers`; `Explorer.svelte`'s `store = $derived(new ProviderDataStore(provider.id))` already handles provider switching by recreating the store when `provider.id` changes; provider switcher UI not yet built (placeholder `<!-- Provider Switch Here -->` in `App.svelte`) and the selection is ephemeral (resets on each launch) until the planned generic data endpoint replaces `/data/:providerId`
- **2026-05**: Reorganize TypeScript files under per-package `src/` subdirectories: move every application/source TS and Svelte file in `frontend/` from `frontend/{core,providers,ui,utils}/` to `frontend/src/{core,providers,ui,utils}/`, and every TS file in `server/` from `server/` to `server/src/`; config (`package.json`, `tsconfig.json`, `vite.config.ts`, `svelte.config.ts`, `components.json`), entry HTML/JS (`index.html`, `index.ts`), styles (`global.css`), and vendored deps (`3rdparty/`) stay at the frontend root; rename Vite/TS alias `@server/` → `@/server/` (now resolves to `server/src/`), keep `@/` mapped to `frontend/src/` and `@shadcn/` mapped to `frontend/3rdparty/shadcn/`; frontend `tsconfig.json` extends `@tsconfig/svelte` with explicit paths (`include: ["src"]`); server `tsconfig.json` extends `@tsconfig/bun` (`include: ["src"]`); server `package.json` `main` pointed at `src/index.ts`; no behavioral changes — purely a layout cleanup so both TypeScript packages mirror the Cargo `src/` convention already used by the Rust host
- **2026-05**: Refactor frontend context management: collapse the two separate Svelte contexts (`provider`, `providerData`) into a single `createContext<ProviderContext>()` whose local interface is `{ info: () => Provider; data: () => ProviderDataStore }`; only `setProvider` is exported as a setter, and consumer-side accessors are the named helpers `getProviderInfo()` / `getProviderData()`; remove `navigateTo` from being a Svelte context entry — it's now a plain exported function in `@/core/context.svelte` that reads the module-level `viewerRef` ($state-wrapped iframe handle); merge `frontend/src/core/context.ts` into `frontend/src/core/context.svelte.ts` (the file already owned `viewerRef` as a `$state` rune, so the merge unifies the module); consumer migration — every component that imported `ctxKeys.provider.get()` / `ctxKeys.providerData.get()` / `ctxKeys.navigateTo.get()` switched to `import * as ctx from "@/core/context.svelte"` + `ctx.getProviderInfo()` / `ctx.getProviderData()` / `ctx.navigateTo`; `ExplorerProvider.svelte` — `store` switched to `$derived(new ProviderDataStore(provider.id))` (recreates if `provider.id` changes), `setupEffects` invocation wrapped in `$effect(() => provider.setupEffects?.(providerContext))` so inner effects bind to this component's lifecycle, `providerContext.data` gained a setter alongside the getter; `frontend/tsconfig.json` — added `"target": "ES2022"` and `"types": ["bun"]` for modern-JS lib coverage and Bun globals
- **2026-05**: Switch server-persisted data files from JSON to TOML — `preset.toml` + `<providerId>.toml` parsed/serialized via `smol-toml` in `server/api.ts`; HTTP wire format unchanged (still JSON over Hono, frontend untouched); legacy `workspace.json` and `workspace.*.json` migration code (`migrateFromMonolithic`, `migrateFromWorkspacePrefix`) removed since they only produced now-obsolete `.json` outputs; `loadDataAsJson`/`saveDataAsJson` renamed to `loadDataFile`/`saveDataFile`; data-loss-guard threshold (30%, min 256 B) preserved against the TOML byte length; no runtime migration — existing `.json` files in `target/data/` are abandoned and the app cold-starts with default presets
- **2026-05**: Parameterize host startup config as clap CLI args: `--data`/`-d` (env fallback `TURBODOC_DATA`) for runtime data directory and `--port`/`-p` (env fallback `TURBODOC_PORT`) for server port; both required, no defaults (replaces the hardcoded `root_dir.join("target/data")` default and the raw `env::var("TURBODOC_PORT").expect(...)` parse); `Args::parse()` becomes the first call in `main::main()` so `--help`/`--version`/missing-arg errors abort cleanly before any side effects; `spawn_server` now explicitly sets `TURBODOC_PORT` on the bun child (the var was previously only inherited from the parent's env, which breaks once `--port` makes parent env optional); add `clap = { version = "4.6.1", features = ["derive", "env"] }` to `Cargo.toml` (the `env` feature provides the env-var fallback declaratively via `#[arg(env = "...")]`); `.justfile` `run` recipe updated to `cargo run --release -- --data data`
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

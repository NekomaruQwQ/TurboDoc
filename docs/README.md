# TurboDoc Frontend Documentation

## Overview

TurboDoc is a universal documentation viewer with local caching and workspace management. The app displays documentation in an iframe with a sidebar explorer for managing items, versions, and pages.

The frontend uses independently persisted **Sources** compiled by reusable
**Adapters**. The navigation rail and Explorer compose those source views into
UI-only **Topics**. See [M7-SourceAdapterTopics.md](M7-SourceAdapterTopics.md)
for the complete architecture and legacy Rust provider migration contract.

**Key Features:**
- Topic-composed documentation viewing over independently persisted sources
- Search and add crates from crates.io
- Version selection with intelligent grouping
- Pin/unpin documentation pages (VS Code-style tabs)
- Alphabetical page collections with drag-reordering within/between collections
- Ordered section spans and URL-derived page names across 15 Rust books
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
- Navigating in the iframe triggers the host's direct navigation callback, auto-detecting the crate
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
- Version choices live in the crate menu after external links and before item
  actions; opening the menu lazily loads their metadata
- Five recommended choices appear directly, while the remaining grouped
  history is available from a scrollable More versions submenu
- Changing version reloads iframe with new version URL
- Current version persisted per-item in workspace
- Auto-sync: the checked menu version updates when iframe navigation changes it

### Feature Requirements

#### Implemented
- Topic NavBar with persisted active selection and explicit landing sources
- Prefix-search, open, and add Explorer crates through a non-exhaustive combobox
- Display crate metadata (versions and links)
- Version selection with intelligent grouping
- Pin/unpin documentation pages
- Preview page system (VS Code-style)
- Symbol type color coding (One Dark theme)
- Named groups for organization
- Data persistence across sessions
- Automatic cross-crate navigation (native host callback)
- Move items between groups via menu
- Import crates from docs.rs URLs
- Rust Crate source (docs.rs + doc.rust-lang.org + windows-docs-rs)
- Fifteen independently persisted Rust Book sources plus Wiki sources
- Automatic cross-topic routing for accepted documentation navigation
- Accessible pointer, touch, and keyboard ordering of WebAdapter pinned pages
- User-defined page collections for Wikis, separate from outer item Groups
- Adapter-owned Rust book sections with previews in reading order

#### Remaining
- Preset picker UI
- Shared loading/error presentation beyond source and workspace persistence
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
| **Host** | Rust (eframe/egui + wgpu/DX12 + WebView2) | **The Shell** | Native window management and startup/error surfaces. Intercepts configured upstream GETs for proxy/cache handling. Rust owns `/api/data/{data_id}`, `/api/sources/{source_id}`, and rejection of unknown `/api` paths; dev-only `/api/ready` passes through to Vite. Release assets use an executable-adjacent virtual-host mapping and persistence uses a separate exact-CORS API origin. |
| **Backend** | Rust (rusqlite + reqwest + `http-cache-semantics`), in-process — no axum or bound listener | **The Brain** | Generic UI/migration TOML persistence plus one TOML file per source under `sources/`. Also provides the site-agnostic SQLite HTTP cache, conditional revalidation, stale-while-revalidate, LRU eviction, reviewed response-header forwarding, and serve-time Rustdoc dark-mode injection. |
| **Frontend** | Svelte 5 + Vite | **The Face** | Compiles source definitions through adapters, derives source views, composes them into UI-only topics, and renders the generic Explorer. Rust crate metadata is lazy and remains source-owned. Release uses built Vite artifacts; dev uses Vite directly for HMR. |

### Request Flow

There is no loopback backend round-trip. The host's `WebResourceRequested`
callback calls the backend in-process on the UI thread via `Handle::block_on`.

**Docs page (e.g. https://docs.rs/serde/latest/serde/):**
```
WebView2 iframe navigates
  ├─ OnFrameNavigationStarting: call `window.__turboDoc__.documentNavigationStarted(...)`
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
Rust Crate source needs metadata for a crate
  ├─ First item-menu opening:
  │    GET https://index.crates.io/{Cargo index path}
  │    └─ proxy follows upstream Cache-Control/ETag/Last-Modified normally
  └─ "Refresh Metadata": GET https://crates.io/api/v1/crates/{name}
       └─ frontend uses fetch cache mode "no-store" for a current API result

The frontend parses both representations into its in-memory CrateCache.
Workspace startup, import, and group expansion do not request metadata.
The backend has no crate-specific endpoint, parser, or cache policy.
```

**Frontend persistence `fetch`:**
```
Frontend chooses the API destination
  ├─ dev: relative /api/... on the Vite origin
  └─ release: https://api.turbodoc.example/api/...
       (unmapped so WebResourceRequested can intercept it)

WebView2 request under /api
  ├─ release OPTIONS preflight
  │    └─ Rust returns the exact mapped frontend origin, GET/PUT/OPTIONS,
  │       Content-Type, and a bounded preflight cache lifetime
  ├─ GET /api/ready
  │    ├─ dev: Rust returns no replacement → Vite validates the launch token
  │    └─ release: Rust rejects the route like any other unknown API
  └─ every other /api request
       │  host: server.dispatch_api(request)  → api::dispatch
       └─ api::dispatch routes by (method, path):
            ├─ GET|PUT /api/data/{data_id}       → root UI/migration TOML
            ├─ GET|PUT /api/sources/{source_id}  → sources/<source_id>.toml
            ├─ known route + wrong method     → 405
            └─ unknown /api path              → 404
```

Release responses, including errors, authorize only
`https://turbodoc.example`; documentation iframes therefore cannot read
application data. The origin split is required because
[WebView2 does not raise `WebResourceRequested` for URLs handled by virtual-host folder mapping](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested#when-to-use-custom-vs-basic-approaches).

In dev mode, Vite independently rejects every non-readiness `/api` path, so
direct requests cannot fall through to frontend content.

**Non-API frontend asset request:**
WebView2 default path → executable-adjacent `public/` through the release
virtual-host mapping, or Vite on the dev port (HMR WebSocket included). No
Rust file server or reverse proxy is involved.

### Technology Stack

- **Frontend**: Svelte 5 + TypeScript (strict mode); reactivity via runes (`$state`, `$derived`, `$effect`)
- **Build**: Vite 8 with `@sveltejs/vite-plugin-svelte`
- **State Management**: Svelte 5 `$state` proxies (deep reactive); direct mutation, no Immer
- **Type Utilities**: type-fest (used by `ReadonlyDeep` markers in a few places)
- **UI Components**: shadcn-svelte — vendored Bits UI primitives in `frontend/3rdparty/shadcn/`; paneforge (via the Resizable wrapper) for split panes
- **Styling**: component-owned semantic CSS for application UI; Tailwind CSS v4
  provides OKLCH design tokens and styles the vendored shadcn-svelte primitives
- **Icons**: `@lucide/svelte` (imported individually for tree-shaking) plus
  topic-owned monochrome SVG marks rendered as current-color masks
- **Utilities**: remeda (functional), semver, zod
- **Drag and drop**: `svelte-dnd-action` (handle-scoped pointer, touch, and keyboard sorting)
- **Backend**: Rust (rusqlite + reqwest + `http-cache-semantics`) — in-process, no HTTP listener. `server::start` opens the SQLite cache and returns a `Server` handle the host calls from the WebView2 callback via `runtime.block_on(...)`.
- **Host**: Rust (eframe/egui + wgpu/DX12 + WebView2) — native startup/error UI, window management, release-folder mapping, WebView2 request interception, backend lifecycle, and optional Vite-child lifecycle. eframe owns the root winit window and WebView2 uses its HWND as the parent for a child controller. The host process owns no listener; only `--dev` binds a Vite port.
- **Native boundary**: All webview→host application communication uses REST-style `fetch()` under `/api/*`; dev uses the Vite origin while release uses the unmapped `https://api.turbodoc.example` origin. WebView2 intercepts that namespace, answers release preflights, passes `/api/ready` through to Vite only in dev mode, dispatches generic and per-source persistence routes to Rust, and rejects every other path. `app.rs` builds host→webview calls to named functions under `window.__turboDoc__`, while the TurboDoc-agnostic WebView2 wrapper executes their source in FIFO order through `ExecuteScriptWithResult`; there is no WebView2 message protocol or generic event dispatcher.

### Sidebar Layout

```
┌─────┬───────────────────────────────┐
│ [R] │ [⌕ Search crates…           ] │  ← Fixed NavBar + pinned search
│     │   serde                       │  ← Up to five suggestions
│     │   ──────────────────────────  │
│     │   + Add crate "ser"           │  ← Free-form action (non-exact input)
│     ├───────────────────────────────┤
│     │   ▶ Ungrouped                 │  ← Scrollable crate/group region
│     │   ▼ My Project                │  ← Group (expanded)
│     │       tokio                   │
│     │       async-std               │
│     │   ▶ Utilities                 │  ← Group (collapsed)
│     │   [+ Add Group]               │  ← Create group button
└─────┴───────────────────────────────┘
```

### Component Hierarchy

```
frontend/index.ts (entry point: mount(App, ...))
└── App.svelte (owns active topic, migration gate, SourceStoreRegistry,
                ExplorerWorkspaceStore, native lifecycle functions,
                topic-home navigation, and the resizable workbench layout)
    ├── WorkbenchToolbar.svelte (product identity + read-only current URL)
    ├── documentation sidebar
    │   ├── NavBar.svelte (registered topic buttons + active marker)
    │   └── Explorer.svelte (loads the active topic's independent stores,
    │       │                renders ready SourceModels, composes ExplorerView,
    │       │                and binds source effects)
    │       ├── ExplorerSearch.svelte (composed prefix/MRU/source actions)
    │       │   └── InputActionDialog.svelte (existing Import dialog, externally triggered)
    │       ├── ExplorerGroup (groupName="", derived ungrouped membership)
    │       ├── ExplorerGroup[] (per persisted name in groupOrder)
    │       │   ├── ExplorerGroupHeader (shared collapse + bulk actions;
    │       │   │                      persisted groups also support rename/move/delete)
    │       │   └── ExplorerItem[] (sorted by sortKey, shown when group expanded)
    │       └── ExplorerCreateGroupComponent
    └── editor pane (deferred iframe + loading/error placeholder)
```

**ExplorerItem.svelte structure:**
```
ExplorerItem (shadcn-svelte Collapsible.Root, backed by Bits UI)
├── Item name (Collapsible.Trigger, clickable, toggles collapse)
├── ExplorerItemMenu (shadcn-svelte DropdownMenu.Root: move to group, links,
│                     radio-style versions, actions)
└── Collapsible.Content
    └── ExplorerPageList
        └── ExplorerPage[] (adapter-sorted or manually ordered pinned block)
            ├── ExplorerPageName (text or symbol with color coding)
            └── Pin/unpin icon
```

### Component Responsibilities

- **NavBar** (`frontend/src/ui/NavBar.svelte`): Fixed 44px workbench rail that renders topics in registry order. Buttons expose topic names and the active primary edge marker; `App.svelte` owns selection persistence and landing navigation.
- **Explorer** (`frontend/src/ui/explorer/Explorer.svelte`): Receives the active UI topic and application-owned stores. It loads source stores concurrently, renders only ready source models, composes their views, installs ready-source effects for this keyed topic lifecycle, and exposes source-specific load/save retries. A recognized navigation expands and reveals the composite item while preserving keys belonging to unknown/loading/error sources during orphan cleanup.
- **ExplorerSearch** (`ExplorerSearch.svelte`): Accessible Bits UI combobox pinned above the scrolling item/group region; shows at most five composed prefix matches or recent composite items and dispatches actions to the owning ready source.
- **ExplorerGroup** (`ExplorerGroup.svelte`): Owns the shared collapsible state and renders filtered/sorted items; the empty group name identifies derived ungrouped membership
- **ExplorerGroupHeader** (`ExplorerGroupHeader.svelte`): Shared chevron trigger and expand/collapse-all menu; persisted named groups additionally support rename, move, and deletion
- **ExplorerCreateGroupComponent** (`ExplorerCreateGroupComponent.svelte`): Button that transforms to inline input for creating new groups
- **ExplorerItem** (`ExplorerItem.svelte`): Collapsible card with source-selected typography, a full-width name, and item menu; expansion state is topic-scoped and keyed by composite item ID.
- **ExplorerItemMenu** (`ExplorerItemMenu.svelte`): Move to group submenu, external links, five direct radio-style version choices plus grouped overflow, and custom actions; opening it is the lazy metadata intent
- **ExplorerPageList** (`ExplorerPageList.svelte`): Source-current page list with symbol colors and pinning. Adapters without manual ordering use `sortKey`; sortable layouts keep home/preview outside drag zones and persist only validated complete permutations.
- **InputActionDialog** (`InputActionDialog.svelte`): Generic dialog for an `ExplorerInputAction`; a source supplies labels and `invoke(value)`, while the component owns the field and trigger UI.

### Identification Scheme

| Entity | Global ID Format | Example |
|--------|------------------|---------|
| Topic | `<topic_id>` | `rust-crates`, `rust-books` |
| Source | `<source_id>` | `rust-crates`, `rust-book`, `wikipedia` |
| Group | topic-local name | `My Project` |
| Item | `<encoded_source_id>:<encoded_local_item_id>` | `rust-crates:tokio`, `rust-book:rust-book` |
| Page (global) | Full URL | `https://docs.rs/tokio/latest/tokio/` |
| Page (local) | `<semantic>` | `runtime/struct.Runtime` |

- URLs always start with `https://` (protocol assumed, not stored in some contexts)
- An adapter guarantees item ID uniqueness within one source view
- Group names are unique within one topic (used as keys in `groups` Record)
- Ungrouped items use empty string `""` as the group name

### Source, Adapter, and Topic System

The provider abstraction has been replaced by four deliberately separate layers:

1. `SourceDefinition<D, R>` pairs a stable source identity with the one
   `Adapter<D, R>` that understands its data and rules.
2. `Adapter.resolve(definition)` compiles one definition into a
   `SourceModel<D>`, conceptually the source ViewModel.
3. `SourceModel.render(context)` derives an ephemeral `SourceView` with
   source-local items and callbacks.
4. A UI-only `Topic` orders ready source models and
   `composeTopicView` creates the generic `ExplorerView`.

There is no shared `SourceData` schema. `D extends object` only guarantees an
object persistence root; each adapter validates its own complete schema and
owns its own `schemaVersion`.

Definitions currently remain code-owned. The boundary is data-oriented so a
later external definition loader does not need to change source models, topic
composition, or the Explorer.

**Data flow:**

```text
sources/<sourceId>.toml ──► SourceDataStore ──► SourceModel.render ──► SourceView
                                      ready SourceView[] + Topic
                                                   │
                                                   ▼
                                              ExplorerView

ui.explorer.toml ──► topic groups/order ───────────────────────────────┘
localStorage ──────► active topic, current URL, expansion, topic MRU
http_cache SQLite ─► lazy Rust crate metadata cache
```

Source stores are lazy but application-owned, so they survive UI-only topic
switches. Every source loads, saves, reports errors, and retries independently.
A topic composes only ready sources; one failed source cannot hide its ready
siblings.

**Current adapters:**

1. `RustCrateAdapter` handles docs.rs, standard-library Rustdoc, and
   windows-docs-rs. A genuinely missing source seeds `serde` and `tokio`;
   an existing explicitly empty crate map stays empty.
2. `RustBookAdapter` handles immutable checked-in book sections and user page
   pins. Fifteen book definitions compile into fifteen independently persisted
   source models.
3. `WebAdapter` handles general HTTPS page sources with user-owned
   collections. Minecraft Wiki and Wikipedia are separate definitions/files.

**Current topics:**

1. Rust Crates.
2. Rust Books.
3. Minecraft Wiki.
4. Wikipedia.

Topic registry validation enforces unique topic IDs, exactly one topic per
source, nonempty source lists, and a valid explicit landing source.

#### Page Organization

The shared `PageLayout` / `PageBlock` view model contains ordered URL
references and capability-driven edit callbacks. The generic renderer does not
know whether a block is a collection or a book section.

1. Wiki sources use `WebAdapter` collections: Home, loose pins, preview, then
   alphabetically sorted user collections. Complete cross-block permutations
   are validated before one state update.
2. Rust book sources use `RustBookAdapter` sections: Home, unknown loose pages,
   then checked-in outline spans in reading order. Users can pin pages but
   cannot edit section structure.
3. Rust crate items retain adapter-defined `sortKey` order and Rust symbol
   presentation.

All page sources require credential-free HTTPS, apply exact structural
ownership, normalize on private URL copies, and re-check ownership after
normalization. Default page identity ignores fragments while persisted
navigation retains the selected section.

#### Topic Selection and Routing

`App.svelte` restores the active topic from
`turbodoc:active-topic-id`, falling back to the first registered topic.
Explicitly selecting a different topic persists it and opens that topic's
configured landing source. Startup restoration keeps the last accepted
document URL.

When the host accepts iframe navigation, the app finds the first source whose
`matchUrl` accepts it and activates that source's topic without navigating
again. Rust crate and Rust book matchers are deliberately disjoint on
`doc.rust-lang.org`.

Topic composition makes item IDs globally unique and reversible:
`encode(sourceId) + ":" + encode(localItemId)`. Groups, expansion, and recent
history use these composite keys. Cleanup removes an orphan only when its owner
is ready; references owned by loading, failed, or unknown sources are preserved.

#### Persistence and Migration

Each source maps to `<dataDir>/sources/<sourceId>.toml`; Explorer groups map
to root `<dataDir>/ui.explorer.toml`. Data is flat, with no `[state]` table.
Serialized save queues snapshot, coalesce, order, retain, and retry writes.

The removable startup migration reads legacy root `rust.toml` plus either
`rust-docs.toml` or the historical `rust-doc.toml`. It treats source files and
topic records as independently authoritative, splits Rust Docs pins across the
book sources, converts both providers' groups to composite keys, and never
changes or deletes legacy files. Validation or write failure blocks new-store
initialization and exposes Retry, preventing defaults from replacing data after
a failed migration.

See [M7-SourceAdapterTopics.md](M7-SourceAdapterTopics.md) for schemas,
invariants, edge cases, extension steps, and the exact migration-removal path.

## Development Workflow

### Running the App

```
just install             # Install frontend dependencies and vendored UI
just release             # Build host + Vite and assemble target/release/public
just run --data data     # Run the assembled release frontend
just dev                 # Run Vite with HMR on port 5173
```

Release mode is the CLI default and is unrelated to Cargo's `release` profile. `just release` happens to use the optimized Cargo profile because that is the project-wide build policy: it builds the host, runs `vite build`, removes the previous assembled `target/release/public`, and copies `frontend/dist` beside the executable. At runtime the host verifies `public/index.html`, maps that directory to `https://turbodoc.example` with WebView2's virtual-host API, and navigates to `/index.html`. Release persistence requests target the separate, unmapped `https://api.turbodoc.example` origin so `WebResourceRequested` can dispatch them to Rust; exact-origin CORS and a narrow preflight policy expose the API only to the mapped frontend. No Job Object, child process, readiness polling, or bound port exists in this mode. Release and dev have distinct frontend origins, so localStorage UI state is intentionally separate; source TOML and SQLite cache state remain shared through `--data`.

`--dev` activates the development-only module in `src/dev.rs`. It discovers the repository from Cargo's executable layout, creates a kill-on-close Job Object, starts Vite on the required `--port`, and monitors the child for its complete lifetime. Each launch receives a unique `TURBODOC_VITE_READY_TOKEN`; Vite owns `GET /api/ready` and returns that token only after its middleware stack is listening. The host polls for at most five seconds, rejects stale Vite processes, and navigates to the matching IPv4 loopback origin only after both Vite and WebView2 are ready. HMR's WebSocket talks to Vite directly on the same port—there is no `hmr.clientPort` override or reverse proxy.

Both modes share the native lifecycle after frontend readiness. egui immediately renders a spinner over the workbench color while WebView2 creates its environment and hidden child controller through completion callbacks. The initial Svelte render leaves the documentation iframe without a `src`; after successful top-level navigation the host reveals the controller and calls `window.__turboDoc__.frontendShown()`, and the frontend releases its latest queued documentation URL on the next animation frame. Startup and initial-navigation failures remain in the native egui surface with expandable, copyable details. Documentation failures stay inside the visible editor pane with a bounded spinner and Retry action. Browser-only execution is unsupported because the native lifecycle, REST interception, and documentation proxy are required application services.

Initialization milestones log through `log::info` as `startup +… ms`. A shared monotonic origin makes concurrent dev-mode Vite and native paths directly comparable; release mode omits those Vite phases. Expensive backend, runtime, eframe/wgpu, WebView2-environment, and WebView2-controller operations report their individual phase durations. `WebView2 NavigationCompleted …; controller shown; document loading released` is the perceived-startup milestone because that is when the workbench becomes visible. The separate one-shot `initial document NavigationCompleted …` milestone measures time until the restored documentation becomes usable. Both completion handlers are application behavior rather than diagnostic instrumentation: the top-level handler preserves visibility-before-iframe ordering, while frame completion settles the editor placeholder.

#### Checking for Startup Regressions

Measure both cold and warm dependency-optimization behavior:

1. Close TurboDoc and remove only `frontend/node_modules/.vite`.
2. Run `just dev`, then record the `startup +… ms` lines through both `WebView2 NavigationCompleted …; controller shown; document loading released` and `initial document NavigationCompleted …`. This is the cold-cache result and includes Vite dependency prebundling.
3. Close TurboDoc and run `just dev` again without changing dependencies, `bun.lock`, or Vite configuration. Record the same lines. Repeat once if needed; these are warm-cache results and represent normal development startup.
4. Compare like with like against previous measurements. A slower `Vite ready on port …` phase points to Vite startup or dependency optimization. Slower WebView2 environment/controller phases point to native browser initialization. If those milestones remain stable but either the shell-visible or initial-document time grows, temporarily add targeted navigation lifecycle probes rather than keeping additional per-navigation telemetry in the normal runtime.

Use the controller-shown timestamp as the perceived-startup headline and retain the initial-document completion as the time-to-content companion metric. Keep the intermediate milestones with both results so the responsible path remains identifiable. Avoid adding Svelte libraries to `optimizeDeps.exclude` merely because they ship `.svelte` sources: `vite-plugin-svelte` supports prebundling them, and excluding large libraries shifts their module graph into the initial on-demand transform path. Keep Lucide imports at individual icon paths such as `@lucide/svelte/icons/pin` so Vite does not traverse the complete icon collection.

A Windows Job Object (set up only by `src/dev.rs`) ensures the spawned Vite child dies when the host exits, even on abrupt termination.

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
- Application presentation is colocated in scoped `<style>` blocks. Markup
  uses role-based classes, while ARIA and `data-*` attributes expose visual
  state. Namespaced global selectors are reserved for forwarded and portalled
  Bits UI elements.
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
- Monospace font for item names and page links (`--font-mono`)
- Compact hierarchy: uppercase panel label, semibold group rows, monospace item
  rows, and smaller monospace page rows.
- Italic for preview pages (emphasis without weight)
- Base font size: 14px (set in `:root` in `frontend/global.css`)
- Font families: Ubuntu Light/system UI for chrome and Ubuntu Mono for
  documentation identifiers; no downloaded font assets.

### Spacing
- 4px workbench gutters separate the rounded explorer and editor panels.
- The NavBar is a fixed 44px rail; each topic receives a 44px square target.
- Tree rows use 24–28px heights, shallow indentation, and compact controls.
- Depth comes from panel borders and surface contrast rather than per-item cards
  or heavy shadows.

### Icons

| Component | Icon | Usage |
|-----------|------|-------|
| Topic | Topic-owned monochrome SVG or Lucide mark | NavBar destination; SVGs render as current-color masks |
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
| More Versions | `Ellipsis` | Version-history submenu |
| Chevron | `ChevronDown` / `ChevronRight` | Group/item expand-collapse |

---

## Design Decisions

Design decisions that shaped the current architecture. Organized by area.

### Architecture

**Source-specific logic, data-oriented definitions**

1. Shared UI depends only on `SourceView`/`ExplorerView`; it never imports
   Rust crate, book, or Wiki persistence types.
2. A definition directly names its adapter because its rule shape has meaning
   only to that adapter.
3. An adapter compiles one source at a time. This makes per-source loading,
   search, errors, and persistence the natural unit.
4. Topics are UI-only composition and do not leak into adapter generics or
   source files.
5. Concrete adapters own their full schema. The generic `D extends object`
   constraint prevents primitive roots without pretending all source data has
   common fields.

**Data model versus source view model**

| Aspect | Persisted source data | `SourceModel` | `SourceView` |
|---|---|---|---|
| Lifetime | Across sessions | Module/application runtime | Fresh reactive derivation |
| Shape | Adapter-specific object | Compiled definition + behavior | Uniform Explorer-facing data |
| Behavior | None | validate, match, render, effects | callbacks over reactive source state |
| Serialized | TOML via JSON API | Never | Never |

**URL routing**

Each model exposes `matchUrl(url)`. Page-oriented adapters compile exact
HTTPS ownership and normalization; Rustdoc parsing stays in the Rust Crate
adapter. `findTopicForUrl` checks topics/sources in registry order, making the
rare overlap tie-breaker explicit and testable.

**Actions and imports**

Source views contribute declarative Explorer actions. The Rust Crate source
reuses one input action for empty-search Import and the Explorer action row.
Generic components own dialogs and menus; sources provide text, icons, and
callbacks rather than Svelte components.

**HTTP cache**

The backend keeps one site-agnostic `http_cache` SQLite table governed by
actual upstream HTTP headers. WebView2 is the process-local L1 and SQLite the
persistent/offline L2. Sparse-index data is the normal Rust crate metadata
source; the crates.io API is used only by explicit Refresh Metadata. See the M4
cache/header documents for response policy and revalidation detail.

**Native boundary**

WebView2 intercepts configured documentation origins plus exact `/api`
segment boundaries. Documentation GETs go to the proxy; generic and per-source
persistence goes to the Rust dispatcher; dev readiness stays Vite-owned.
Release API requests use the unmapped `https://api.turbodoc.example` origin
with exact frontend-origin CORS. There is no loopback backend listener, axum,
WebView2 message protocol, or generic frontend event dispatcher.

### Data Model

**Split persistence**

1. `<dataDir>/sources/<sourceId>.toml` stores one adapter-specific, flat source
   object.
2. `<dataDir>/ui.explorer.toml` stores topic groups and group order using
   composite item keys.
3. `<dataDir>/rust.toml` is optional read-only Rust Crates migration input.
4. `<dataDir>/rust-docs.toml` or historical `<dataDir>/rust-doc.toml` is
   optional read-only Rust Docs migration input; simultaneous files are an
   ambiguity error.
5. `<dataDir>/cache.sqlite` stores generic HTTP cache entries.
6. localStorage holds `activeTopicId`, `currentUrl`, topic-scoped composite
   recent items, and topic/composite expansion keys.

Source and data IDs are validated as lowercase ASCII path-segment-safe keys of
at most 64 bytes. Missing TOML is distinguished from valid empty data by an
explicit response header. Parse/I/O/schema errors surface independently and do
not substitute empty objects.

**Preview and page identity**

Preview state is derived from accepted `currentUrl` and a source's pins.
Home pages use `pinned = null`; an unpinned current page is the preview.
Default page identity ignores fragments, while persisted/navigation targets
retain them. Collection reorders submit complete permutations and preserve the
original accepted target spelling.

**Local UI-state ownership**

The current storage-slot registry owns the complete `turbodoc:` localStorage
namespace. Startup removes every namespaced key absent from that registry,
canonicalizes the surviving slots from the current topic/source registry, and
repairs corrupt values. Non-TurboDoc keys remain untouched; there is no
historical stale-key list or broad `localStorage.clear()` operation.

`uiState.svelte.ts` owns semantic localStorage reconciliation. Removed topics,
removed sources, malformed identities, duplicates, and unknown URLs are pruned
from current registry evidence. Once a source is ready, absent recent-item and
expansion references are removed; registered loading and failed sources retain
their references because a partial topic view cannot prove deletion.

**Source-aware Explorer cleanup**

`ExplorerWorkspaceStore` similarly removes retired topic/source records,
canonicalizes group order, deduplicates group membership, and removes an absent
item only when its owning source is ready. Explorer components supply readiness
evidence but do not implement persistence cleanup policy.

**`latest` remains intent**

Rust crate versions may persist the literal `"latest"`. It is resolved while
building a URL so future releases can remain the user's selected policy.

### State Management

**Reactive derivation**

```text
SourceDataStore.data ($state)
          │
          ├── SourceModel.render(context) inside topic derivation
          │                              └── SourceView callbacks mutate data
          └── SerializedSaveQueue snapshots/coalesces ordered PUTs

ready SourceViews + Topic ──► composeTopicView ──► ExplorerView
```

Source effects install only after validated data is ready and bind to the keyed
Explorer lifecycle. The application-owned `SourceStoreRegistry` outlives that
UI subtree, preserving loaded data and pending writes across topic switches.
Crate metadata is a separate in-memory reactive cache loaded only after user
intent.

**Independent failure domains**

1. Every source has its own load state, save queue, error text, and Retry.
2. Explorer UI state has a separate store/queue and Retry.
3. Ready siblings remain renderable/searchable when one source fails.
4. Persistence queues serialize writes, coalesce to the newest immutable JSON
   snapshot, retain dirty state after failure, and use bounded backoff.
5. The migration gate runs before either target store and exposes a retryable
   blocking error so failed compatibility work cannot be overwritten.

**Root and local state**

`App.svelte` owns active topic selection, the source-store registry, Explorer
workspace, migration gate, and native document lifecycle. `uiState.svelte.ts`
initializes and reconciles validated localStorage before exposing `currentUrl`,
expansion, and recent-item reactive bridges. The shared iframe reference and
deferred `navigateTo(url)` gate remain in `core/context.svelte.ts`.

### UI Patterns

**Callback-Based Data Flow**
- UI components receive view model objects with callbacks, not raw state
- Components don't call `appContext` directly — decoupled from global state
- Adapter/source-specific logic stays in `SourceModel.render()`, not in UI code

**ItemLink vs ItemAction Separation**
- `ItemLink` opens URLs (rendered as anchor elements); `ItemAction` invokes callbacks (rendered as buttons)
- Separate types enforce different UI treatment

**Collapsible Items**
- Items use Radix Collapsible directly (not part of shadcn's standard component set; bundled separately as `@radix-ui/react-collapsible`)
- Expansion state uses `itemExpanded(topicId, compositeItemKey)` from `core/uiState.svelte.ts`
- Named and ungrouped groups share the controlled Collapsible path and `groupExpanded(topicId, groupId)`; ungrouped uses the empty group ID
- Default: collapsed (both items and groups)
- Toggled by clicking item name (items) or group header (groups)
- Bulk operations (Expand All / Collapse All) via imperative `expandItems()` / `collapseItems()` helpers

**Group Management**
- Grouping is UI-owned and available for every topic, including single-source
  Wiki topics. Source views return flat items; the Explorer always renders the
  Ungrouped section, named groups, and the trailing Add Group action.
- Groups remain scoped to one topic and are independent of page collections
  and adapter-owned book sections inside items.
- Groups store composite item keys in `Record<string, { items: ItemKey[] }>` with a separate `groupOrder`
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
- Page pin and row-action visibility are derived from semantic parent
  hover/focus selectors plus `aria-pressed` or `aria-expanded` state.
- Hoverless media queries keep required menu triggers persistently available.
- CSS-only interaction state avoids reactive pointer bookkeeping.

**Auto-Import on Navigation**
- When iframe navigation reaches an unknown crate, the Rust Crate source creates an entry
- Enables seamless cross-crate navigation (follow a link → crate appears in sidebar)
- New crates default to `"latest"` version; user can pin pages or change version later

**Auto-Reveal on Navigation**
- Runs only for accepted WebView2 navigation reports, not incidental URL or source-data changes
- Uses a parameterized fractional center range with a default of `[1/3, 2/3]` of the unobstructed, scrollable Explorer viewport below the pinned search
- Always expands the containing group and crate before measuring their final layout
- Leaves the Explorer untouched only when the crate card intersects the center range and the complete selected page row is inside it
- Otherwise prefers centering the complete crate card on the range midpoint, then constrains that position so the selected page row finishes inside the range
- Calculates and applies one final scroll position; physical content bounds are the only best-effort fallback, avoiding permanent blank scroll gutters
- Falls back to the item header when a source recognizes the item but exposes no matching page row
- Uses the navigation ID for latest-wins cancellation so redirects and rapid navigation cannot apply stale scrolling
- Preserves keyboard focus and honors reduced-motion preference for programmatic scrolling

**Version Auto-Sync**
- When iframe navigation reports a different version, the checked menu item auto-updates
- Handles both `"latest"` and specific version strings
- Ensures the menu always reflects what the user is actually viewing

---

## File Structure

```text
TurboDoc/
├── .justfile
├── Cargo.toml
├── frontend/
│   ├── index.ts
│   ├── vite.config.ts
│   ├── scripts/
│   │   ├── book-outline-import.ts
│   │   └── refresh-book-outlines.ts
│   └── src/
│       ├── adapters/
│       │   ├── rust-crate/       # Rustdoc items, URLs, metadata/cache, actions
│       │   ├── rust-book/        # immutable checked-in section layout
│       │   ├── web/              # user collection layout
│       │   └── shared/           # safe page routing and pin ordering
│       ├── sources/
│       │   ├── rust-crates.ts
│       │   ├── rust-books/       # catalog, definitions, outline snapshots
│       │   ├── web-sources.ts
│       │   └── page-names.ts
│       ├── topics/
│       │   ├── index.ts          # UI-only topic registry and validation
│       │   └── rust.svg
│       ├── migrations/
│       │   └── rust-providers-v1.ts
│       ├── core/
│       │   ├── source.ts         # Definition → Adapter → Model contracts
│       │   ├── explorer.ts       # SourceView and composed ExplorerView types
│       │   ├── topic.ts          # routing and ready-source composition
│       │   ├── itemKey.ts        # canonical composite identities
│       │   ├── sourceDataStore.svelte.ts
│       │   ├── sourceStoreRegistry.ts
│       │   ├── explorerWorkspaceStore.svelte.ts
│       │   ├── serializedSaveQueue.ts
│       │   ├── api.ts
│       │   ├── context.svelte.ts
│       │   ├── localStorage.ts
│       │   └── uiState.svelte.ts
│       └── ui/
│           ├── App.svelte        # migration, app stores, active topic
│           ├── NavBar.svelte     # topic rail
│           └── explorer/         # generic composed Explorer components
├── src/
│   ├── app.rs                    # native host and request interception
│   ├── main.rs
│   └── server/
│       ├── api/
│       │   ├── mod.rs            # strict /api route classification
│       │   └── data.rs           # root and sources/ TOML namespaces
│       └── proxy/                # generic cached documentation proxy
└── docs/
    ├── README.md
    └── M7-SourceAdapterTopics.md
```

## Open Questions & Assumptions

### Assumptions Made

1. **Metadata CORS**: crates.io API responses allow cross-origin reads; the sparse index does not, so both configured metadata origins pass through the host proxy. The response policy preserves upstream CORS and synthesizes wildcard read access only when a configured public metadata origin omitted it.
2. **Semver compliance**: Confirmed — crates.io enforces semver, safe to rely on
3. **Single preview page**: Each crate has at most one preview page at a time (derived from `currentUrl`)
4. **No nested groups**: Groups contain items, not other groups (flat structure)
5. **Source-local items**: each `SourceView` owns local string IDs; topic composition creates canonical `ItemKey` values

### Remaining Items

1. **Preset picker UI**: Not yet built — switching presets requires manual workspace edit
2. **Shared operation feedback**: source/workspace loads and saves have scoped status/retry rows; other in-app operations still lack a shared toast/error-boundary system

### Known Limitations

1. **Rustdoc `index.html` aliases**: `buildUrl`/`parseUrl` in `frontend/src/adapters/rust-crate/url.ts` still treat `tokio/runtime/` and `tokio/runtime/index.html` as distinct paths. Pin matching can therefore retain both spellings.

---

## Success Criteria

### Completed
- [x] SourceDefinition → Adapter → SourceModel → SourceView architecture
- [x] Topic NavBar with persisted selection and explicit landing sources
- [x] Data/cache persistence via HTTP API
- [x] Rust Crate source (docs.rs + doc.rust-lang.org + windows-docs-rs)
- [x] Fifteen independently persisted Rust Book sources
- [x] General WebAdapter sources with user-owned collections
- [x] Pin/unpin documentation pages with preview page system
- [x] Version selection with semver grouping
- [x] Named groups with full CRUD (create, rename, reorder, delete)
- [x] Move items between groups
- [x] Import crates from docs.rs URLs
- [x] Symbol parsing with One Dark color coding
- [x] Automatic cross-crate navigation via direct native lifecycle calls
- [x] Topic-composed Explorer search with source dispatch and composite recent items
- [x] Serialized/coalescing per-source and Explorer UI persistence with retry
- [x] Read-only legacy Rust provider migration with per-source/topic authority
- [x] HTTP proxy with SQLite cache and dark mode injection (v0.3)
- [x] Rust host with native egui startup UI and WebView2 (eframe/wgpu + webview2-com)
- [x] Release frontend from executable-adjacent Vite artifacts, with opt-in Vite dev mode

### Remaining
- [ ] Shared frontend loading/error states
- [ ] Keyboard shortcuts
- [ ] Additional code- or file-defined sources/topics

---

## Change History

- **2026-08**: Centralize local UI-state reconciliation under
  `uiState.svelte.ts`. Treat the registered `turbodoc:` slots as the complete
  namespace allowlist, remove every other namespaced key at startup, repair and
  canonicalize current slots from topic/source ownership, and prune item state
  only when source readiness proves it stale. Move persisted topic/group/item
  cleanup behind `ExplorerWorkspaceStore`, leaving components responsible only
  for supplying current registry and readiness evidence.
- **2026-08**: Replace providers with per-source `SourceDefinition`, `Adapter`,
  `SourceModel`, and `SourceView` layers. Add UI-only topics, composite item
  identity, application-owned source stores, per-source TOML under `sources/`,
  independent reliable saves/errors, RustBook/Web adapter separation, four
  topic destinations, and a removable read-only migration for the legacy Rust
  Crates and Rust Docs provider files.
- **2026-08**: Make item grouping standard Explorer functionality for every
  provider. Remove the provider grouping opt-out, restore Add Group for Doc
  providers, always expand the containing group during navigation reveals, and
  recreate the Explorer subtree on provider changes so group controls bind to
  the correct per-provider store.
- **2026-08**: Separate neutral page-block presentation from user collections
  and provider-owned section spans. Add alphabetical Wiki collections with
  validated cross-zone pin movement and safe removal, retain original Rust
  crate ordering, and place book previews in source reading order. Expand
  Rust Docs to 15 official books with checked-in outline metadata, an explicit
  validated refresh tool, site-specific URL naming and narrow native URL
  scopes. See `docs/M6-PageOrganization.md`.

- **2026-08**: Generalize the singleton `doc` implementation into the
  validated `createDocProvider(config)` template. Move URL ownership,
  canonicalization, page identity, page naming, rendering, and persistence
  callbacks into instance-local runtime closures; inject those resolvers into
  page-order validation instead of consulting a global catalog. Register
  separate `rust-doc`, `minecraft-wiki`, and `wikipedia` providers with
  independent persistence and navigation-rail destinations. Retain the Rust
  host's explicit origin allowlist as a separate security boundary. Leave the
  superseded `doc.toml` untouched rather than attempting a lossy cross-provider
  migration.

- **2026-08**: Add the `doc` provider for English Wikipedia, the stable Rust Book, and Minecraft Wiki. Keep the site catalog code-owned and flat while persisting per-site pinned pages in manual reading order. Add handle-scoped, accessible pointer/touch/keyboard drag ordering with home and preview outside the drop zone; validate finalized permutations and honor reduced motion. Move current-page and URL-ownership semantics into providers so native navigation can switch between Rust and Docs without a second viewer navigation. Add exact hosted/proxied origins, close raw-prefix lookalike-host gaps, and restrict Rustdoc dark-mode injection away from the Book and Wikis. See `docs/M5-DocProvider.md`.

- **2026-08**: Separate application presentation from Svelte structure and
  logic. Replace inline Tailwind utility clusters in `frontend/src/ui/` with
  semantic, component-owned native CSS; express active, preview, pinned,
  identifier, loading, and primitive interaction states through ARIA and
  `data-*` attributes; use namespaced global selectors only for forwarded or
  portalled shadcn/Bits UI roots. Remove app-level `cn`, `buttonVariants`,
  conditional class arrays, group style constants, and the TypeScript symbol
  color map. Keep Tailwind as the token and vendored-primitive layer, leave
  generated shadcn sources untouched, and retain the provider SVG mask URL as
  the sole data-driven inline style.
- **2026-08**: Move crate version selection from the fixed-width crate header control into the item actions menu, after external links and before Refresh Metadata. Show five recommended choices directly as menu radio items and place the remaining non-yanked, semver-grouped history in a bounded More versions submenu. Make menu opening the lazy metadata intent, preserve the current selection through loading and failure, keep exceptional yanked or non-semver current values selectable, and expose the ellipsis trigger on hoverless devices.
- **2026-08**: Add a VS Code-style NavBar to the left side of the Explorer and remove the textual `EXPLORER / Rust` header. Render every registered provider as an accessible icon destination with a primary active-edge marker; providers now declare both a NavBar `icon` and the canonical `homeUrl` opened on explicit selection. Persist the selected provider synchronously in validated localStorage, repair missing or unknown IDs to the registry default, retain the last document during startup restoration, and treat reselecting the active provider as a no-op. Add the official Rust Foundation SVG beside the Rust provider, display it as a theme-aware current-color mask, and record its CC BY attribution and trademark policy.
- **2026-08**: Restore distinct release and development frontend modes without reintroducing an HTTP server. The CLI now defaults to release mode and uses `--dev` to opt into Vite; `--port` is required only for dev and remains independent of Cargo's profile. `just release` builds the optimized Rust host, runs `vite build`, and refreshes `target/release/public` beside the executable. Release startup validates `public/index.html` and maps the directory to the reserved `https://turbodoc.example` origin through WebView2 with cross-origin access denied. Because mapped URLs do not raise `WebResourceRequested`, release provider-data calls use the separate unmapped `https://api.turbodoc.example` origin with exact-origin CORS and bounded preflight caching before direct Rust dispatch. Move all Vite-only repo discovery, Job Object ownership, readiness-token polling, child monitoring, and tests from `src/server/frontend.rs` plus `main.rs` into `src/dev.rs`; release mode creates none of those resources. Keep the shared hidden-controller, frontend-visible-before-document, proxy/cache, and native failure-surface behavior in `app.rs`.
- **2026-08**: Enforce a directional native boundary: every webview→host application operation remains a REST-style `fetch()` under the intercepted `/api/*` namespace, while host→webview lifecycle notifications become ordered direct calls to the typed `window.__turboDoc__` API through `ExecuteScriptWithResult`. Split `ipc.ts` into `api.ts` and `host.ts`; remove the WebView2 `postMessage` declarations, native `PostWebMessage*` wrappers, mitt event bridge, generic message validation, and standalone-browser lifecycle fallback. Keep TurboDoc-specific call construction in `app.rs`; serialize arguments as JSON, submit only script strings to the generic WebView2 FIFO, log failures with their full source, and cover argument escaping with Rust unit tests.
- **2026-08**: Simplify and harden the internal HTTP namespace. Move provider persistence from `/api/v1/data/{provider_id}` to Rust-owned `/api/data/{provider_id}`, move Vite readiness from `/ready` to `/api/ready`, and reject every other `/api` path instead of allowing Vite's frontend fallback. Preserve the launch-token readiness contract, validate provider IDs before mapping them to TOML files, and cover ownership, methods, invalid identifiers, legacy paths, and prefix traps with focused Rust and Bun tests.
- **2026-08**: Pin the Explorer search beneath the panel header by separating it from the crate/group scroll viewport. Keep search and Import actions accessible at every list position, preserve provider layouts without search, and let navigation reveals calculate their center range from only the unobstructed list region.
- **2026-08**: Auto-reveal reported iframe navigation in the Explorer. Pass the accepted WebView2 navigation ID separately from persisted `currentUrl` so metadata, storage, and other reactive updates cannot move the sidebar. Expand the containing group and crate, wait for Bits UI clipping animations, then calculate one constrained position from a parameterized center range (default `[1/3, 2/3]`): preserve scroll only when the card intersects the range and the complete page row is inside it; otherwise prefer centering the card while constraining the page row to the range, with physical scroll bounds and a crate-header fallback. Cancel stale reveal work by navigation generation, retain iframe focus, honor reduced motion, and cover default/custom ranges, card centering, page constraints, and bounds with dependency-free unit tests.
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

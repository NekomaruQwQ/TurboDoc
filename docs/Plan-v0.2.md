# TurboDoc v0.2 Plan: Multi-Provider Architecture

## Overview

TurboDoc v0.1 is a docs.rs-specific documentation viewer. v0.2 transforms it into a **universal documentation reader** supporting multiple providers.

**Planned Providers:**
- v0.2: `rust.std` (doc.rust-lang.org/std)
- Future: `rust.cargo`, `cpp.cppreference`, `cpp.msdocs`, etc.

**Core Metaphor:** TurboDoc is an "enhanced tabbed browser with inactive tab resources released"—not a hierarchical resource manager. The tree depth is strictly limited.

---

## Architecture Overview

### Static vs Dynamic Dispatch

**Decision: Dynamic dispatch** via provider registration.

- Providers register themselves with a common `Provider` interface
- Shared code only knows the interface, cannot access provider-specific internals
- Adding a new provider is isolated work (no central type modifications)
- Separation of concerns is **enforced by the type system**, not just convention

### Data Model vs View Model

| Aspect | Data Model (suffixed "Data") | View Model (no suffix) |
|--------|------------------------------|------------------------|
| Purpose | Storage/serialization format | Runtime with behavior |
| Provider data | `unknown` at app level | Uniform structure |
| Type casting | Single point: deserialization | Already typed |
| Location | Persisted (IPC/localStorage) | Derived in memory |

**Flow:**
```
[Disk/Storage]        [Deserialization]         [Runtime]
AppData (JSON) ──────► Providers ────────────► AppContext (View Model)
AppCache (JSON) ─────►   (cast unknown)  ─────► with behavior methods
```

---

## Data Structures

### AppData (Workspace File via IPC)

```typescript
interface AppData {
  app: {
    presets: Preset[];
    currentPreset: string;
    currentUrl: string;  // Currently viewed URL (HTTPS assumed)
  };
  providers: Record<string, {
    data: unknown;  // Provider-specific data storage
    groups: {
      name: string;
      items: string[];  // Item IDs in this group
      expanded: boolean;
    }[];
    expandedItems: string[];  // Item IDs that are expanded
  }>;
}
```

- `app` contains app-level configuration (presets, current state)
- `providers` maps provider IDs to their data and UI state
- Provider-specific data is opaque (`unknown`) at the app level
- UI state (expanded groups/items) stored **per provider**, default: collapsed
- **Eager cleanup**: Remove orphaned UI state entries when content changes
- **No provider collapsing**: Provider visibility controlled by preset

### AppCache (localStorage)

```typescript
type AppCache = Record<string, unknown>;  // [providerId]: provider-specific cache
```

- Cached metadata (versions, links, etc.) per provider
- Stored in localStorage (frontend-only, no IPC needed)
- Can be cleared without losing user data

---

## Identification Scheme

| Entity | Global ID Format | Example |
|--------|------------------|---------|
| Provider | `<provider>` | `rust.crate` |
| Group | `<provider>:<index>` | `rust.crate:0` |
| Item | `<provider>:<item_name>` | `rust.crate:tokio` |
| Page (global) | Full URL | `https://docs.rs/tokio/latest/tokio/` |
| Page (global alt) | `<provider>:<item>:<semantic>` | `rust.crate:tokio:runtime/struct.Runtime` |
| Page (local) | `<semantic>` | `runtime/struct.Runtime` |

**Design Notes:**
- URLs always start with `https://` (assumed, not stored)
- Provider guarantees item name uniqueness within itself
- Group index (not name) used for identification—allows duplicate group names

---

## Provider Interface

```typescript
interface Provider<T = unknown, TCache = unknown> {
  // Identity
  readonly id: string;                    // "rust.crate", "rust.std"
  readonly name: string;                  // "Rust Crates"

  // Feature flags
  readonly enableItemGrouping: boolean;   // rust.crate: true, rust.std: false
  readonly renderItemNameAsCode: boolean; // Display item names in monospace

  // Core rendering: data model → view model with callbacks
  render(context: ProviderContext<T, TCache>): ProviderOutput;

  // Optional: import item from user input (e.g., crate name, URL)
  importItem?(context: ProviderContext<T, TCache>, input: string):
    | { success: true }
    | { success: false; message: string };
}

interface ProviderContext<T, TCache> {
  readonly data: T;
  updateData(updater: (draft: T) => void): void;

  readonly cache: TCache;
  updateCache(updater: (draft: TCache) => void): void;

  readonly currentUrl: string;
  setCurrentUrl(url: string): void;
}
```

**Design Notes:**
- URL routing (`parseUrl`, `buildUrl`) is provider-specific, not part of the interface
- No `deserialize`/`serialize`—view model callbacks operate data directly via Immer
- Search deferred to post-v0.2
- `render()` returns uniform `ProviderOutput` with `Item[]`, each with behavior callbacks

---

## View Model Structure

Providers return `ProviderOutput` from `render()`, containing uniform view models:

```typescript
type ProviderOutput = ReadonlyDeep<{ items: Item[] }>;

interface Item {
  id: string;           // Unique within provider
  name: string;         // Display name
  sortKey: string;      // For ordering within groups

  pages: Page[];        // Documentation pages
  actions: ItemAction[];// Context menu actions (with invoke callbacks)
  versions: ItemVersionProps | null;  // Version selector (packages only)
}

interface Page {
  name: PageName;       // Text or symbol path
  sortKey: string;
  url: string;          // Full URL, also serves as global ID
  pinned: boolean;
  setPinned(pinned: boolean): void;  // Callback
}

type PageName =
  | { type: "text"; text: string }
  | { type: "symbol"; path: { type: IdentType; name: string }[]; separator: string };

interface ItemVersionProps {
  current: string;
  recommended: string[];  // Quick-access versions
  all: string[][];        // Grouped by semver compatibility
  select(version: string): void;  // Callback
}
```

**Note:** View models contain callbacks for user interactions. They are never serialized.

---

## State Management

**Decision: Derive view model on every render (no memoization initially).**

```
AppData (React state) ───► deriveViewModel() ───► React render
        │
        └── Immer updates (new refs only for changed parts)
```

- Data model lives in React state
- View model derived synchronously on render
- Immer ensures immutable updates with minimal reference changes
- Add `useMemo` later if profiling shows performance issues

**Rationale:**
- Object creation is fast; DOM updates are the bottleneck
- Simple, predictable architecture
- Premature optimization avoided

---

## Storage Strategy

| Data | Storage | Reason |
|------|---------|--------|
| AppData | IPC → workspace file | User content + UI state, needs disk persistence |
| AppCache | localStorage | Frontend-only, can be regenerated |

**Benefits:**
- Simplified IPC (only AppData needs backend)
- Cache can be cleared without losing user data
- Faster cache access (localStorage is sync)

---

## UI Design

### Sidebar Layout

Providers appear as sections (not collapsible—visibility controlled by preset):

```
┌─────────────────────────────────┐
│ [Search...]                     │  ← Unified search, providers contribute
├─────────────────────────────────┤
│ ═ Rust Standard Library ═══════ │  ← Provider header (always visible)
│   std                           │
│   core                          │
│   alloc                         │
├─────────────────────────────────┤
│ ═ Rust Crates ═════════════════ │  ← Provider header
│   ▶ My Project                  │  ← Group (collapsed)
│   ▼ Async                       │  ← Group (expanded)
│       tokio                     │
│       async-std                 │
├─────────────────────────────────┤
│ [⚙ Configure Providers]        │  ← Opens preset picker
└─────────────────────────────────┘
```

### Unified Search (Deferred to post-v0.2)

- Single search bar at the top of explorer
- Each provider that supports search contributes results
- Results grouped by provider (like PowerToys Run)
- Providers without search support are skipped

**Note:** Search functionality is deferred to a later version. v0.2 focuses on multi-provider architecture.

### Preset System

Users select a preset to determine which providers appear and their order:

```typescript
const RUST_PRESET = {
  name: "Rust",
  activeProviders: ["rust.std", "rust.cargo", "rust.crate"]
};

const CPP_PRESET = {
  name: "C++",
  activeProviders: ["cpp.cppreference", "cpp.msdocs"]
};
```

- Presets are stored in `AppData.app.presets`
- Users can create custom presets
- Switching presets doesn't delete provider data (preserved but hidden)

---

## Cross-Provider Navigation

When a page links to a URL handled by a different provider:

1. Each provider attempts to parse the URL (provider-specific `parseUrl`)
2. First matching provider handles the import
3. Auto-import to target provider (like current cross-crate behavior)
4. Navigate to the new page

**Example:** docs.rs page links to `doc.rust-lang.org/std/vec/struct.Vec.html`
→ `rust.std` provider parses URL, imports `std` item, page displayed

---

## Migration & Compatibility

**Decision: No automatic workspace upgrade.**

- v0.2 workspace format is incompatible with v0.1
- Users must recreate their workspace
- Clean break simplifies implementation
- Acceptable for this stage of development

---

## Implementation Phases

### Phase 1: Core Refactoring
- [x] Define `Provider` interface in `core/data.d.ts`
- [x] Refactor `AppData` structure (`app` + `providers`)
- [ ] Implement provider registration system
- [ ] Move cache to localStorage
- [ ] Update `AppContext` to derive view model from providers

### Phase 2: Extract rust.crate Provider
- [x] Create `providers/rust.crate/` directory
- [x] Move crates.io API into provider directory
- [x] Implement URL parsing/building (`url.ts`)
- [ ] Implement `Provider` interface
- [ ] Verify existing functionality preserved

### Phase 3: Implement rust.std Provider
- [ ] Create `providers/rust.std/` directory
- [ ] Implement URL parsing for doc.rust-lang.org
- [ ] Handle version semantics (stable, nightly)
- [ ] No groups needed (just std, core, alloc items)

### Phase 4: UI Updates
- [ ] Add provider sections to Explorer
- [ ] Implement preset picker UI
- [ ] Update cross-provider navigation
- [ ] Polish and testing

**Note:** Unified search deferred to post-v0.2.

---

## Detailed Migration Todo List

This section details how each v0.1.0 file should be refactored. Tasks are not ordered—implement based on dependencies.

### `core/data.d.ts` — Type Definitions

- [x] Define `AppData` with `app` + `providers` structure
- [x] Define `Provider<T, TCache>` interface with `render()`, `importItem()`
- [x] Define `ProviderContext<T, TCache>` with data/cache access + update methods
- [x] Define uniform view model types: `Item`, `Page`, `PageName`, `ItemVersionProps`, `ItemAction`
- [ ] Add `Preset` type (already defined, verify usage)
- [ ] Document identification scheme in comments (provider:item, provider:group:index)

### `core/cache.ts` — NEW: localStorage Cache Layer

- [ ] Create new file `core/cache.ts`
- [ ] Define `AppCache = Record<string, unknown>` type
- [ ] Implement `loadCache(): AppCache` — read from localStorage, parse JSON
- [ ] Implement `saveCache(cache: AppCache): void` — serialize to localStorage
- [ ] Implement `getProviderCache<T>(providerId: string): T | null`
- [ ] Implement `setProviderCache<T>(providerId: string, cache: T): void`
- [ ] Implement `clearCache(): void` — clear all provider caches

### `core/ipc.ts` — IPC Layer Updates

- [ ] Update `LoadWorkspaceResponse` to return `AppData` (not old `Workspace`)
- [ ] Update `SaveWorkspaceRequest` to accept `AppData`
- [ ] Remove `load-cache` and `save-cache` message types (cache moves to localStorage)
- [ ] Remove `LoadCacheResponse`, `SaveCacheRequest` types
- [ ] Update `loadWorkspace()` return type
- [ ] Update `saveWorkspace()` parameter type

### `core/context.ts` — AppContext Rewrite

Current state: Hard-coded to crates, manages `Workspace`/`Cache` separately.

- [ ] Change internal state from `Workspace`/`Cache` to `AppData` + `AppCache`
- [ ] Remove `getCrateCache()` method (move to rust.crate provider)
- [ ] Add `providers: Provider[]` field (injected at construction)
- [ ] Implement `getProviderContext<T, TCache>(providerId): ProviderContext<T, TCache>`
  - Returns context with `data`, `updateData`, `cache`, `updateCache`, `currentUrl`, `setCurrentUrl`
  - `updateData` uses Immer on `appData.providers[providerId].data`
  - `updateCache` uses Immer on localStorage cache
- [ ] Implement `deriveViewModel(): ProviderViewModel[]`
  - Loop through active providers (from current preset)
  - Call `provider.render(context)` for each
  - Return array of `ProviderOutput` with provider metadata
- [ ] Update `onNavigated(url)` to dispatch to matching provider
  - Loop through providers, each tries to parse URL
  - First match handles navigation
  - Auto-import if item not already in provider data
- [ ] Update `navigateTo(url)` to use provider's `buildUrl()` if available
- [ ] Add preset management: `getCurrentPreset()`, `setCurrentPreset(name)`

### `index.tsx` — Entry Point Updates

- [ ] Load `AppData` via `IPC.loadWorkspace()` (new format)
- [ ] Load `AppCache` via `loadCache()` from localStorage (not IPC)
- [ ] Import provider array from `providers/index.ts`
- [ ] Pass providers to `AppContext` constructor
- [ ] Handle first-time startup: initialize empty `AppData` with default preset
- [ ] Handle v0.1 workspace: detect old format, show migration message, start fresh
- [ ] Update auto-save: save `AppData` via IPC, save `AppCache` to localStorage
- [ ] Remove cache IPC event listeners

### `providers/index.ts` — Provider Registration

- [x] Export array of providers: `[RustCrateProvider]`
- [ ] Add `RustStdProvider` when implemented
- [ ] Optionally add `getProvider(id): Provider | undefined` helper

### `providers/rust.crate/index.ts` — Complete Provider Implementation

Current state: Skeleton with incomplete `render()`.

- [ ] Define `RustCrateProviderData` type (array of crates with versions, pinned pages)
- [ ] Define `RustCrateProviderCache` type (crate metadata keyed by name)
- [ ] Implement `render(context)`:
  - Read `context.data` (list of crates)
  - For each crate, create `Item` with:
    - `id`: crate name
    - `name`: crate name
    - `sortKey`: crate name (lowercase)
    - `pages`: call `renderPages()` with pin callbacks
    - `actions`: remove action with `invoke()` callback
    - `versions`: call `renderVersionSelector()` with select callback
  - Return `{ items: [...] }`
- [ ] Implement `renderPages(crate, context)`:
  - Return pinned pages with `setPinned(false)` callback
  - Return root module page (always present)
  - Return preview page if currentUrl matches crate but page not pinned
  - Parse symbol names for `PageName.type === "symbol"`
- [ ] Implement `renderVersionSelector(crate, cache)`:
  - Return `ItemVersionProps` with `current`, `recommended`, `all`
  - `select(version)` callback updates `context.data.crates[i].currentVersion`
- [ ] Implement `importItem(context, input)`:
  - Parse input as URL via `parseUrl()`
  - Parse input as crate name (bare string)
  - Fetch metadata via `CratesAPI.fetchCrateInfo()`
  - Add to `context.data`, update `context.cache`
  - Return `{ success: true }` or `{ success: false, message }`
- [ ] Move crate-specific types to `providers/rust.crate/types.ts`

### `providers/rust.crate/url.ts` — URL Parser (Complete)

- [x] `parseUrl(url)` — parse docs.rs URLs
- [x] `buildUrl(page)` — reconstruct URL from parsed page
- [ ] Fix edge case: empty version string → `null` (use `||` not `??`)

### `providers/rust.crate/crates-api.ts` — API Client (Complete)

- [x] `fetchCrateInfo(crateName)` with rate limiting
- [x] `searchCrates(query)` for future search feature
- [x] Error types: `RateLimitError`, `CrateNotFoundError`
- No changes needed for v0.2

### `providers/rust.std/index.ts` — NEW: Rust Std Provider

- [ ] Create file with `RustStdProvider` implementing `Provider`
- [ ] Set `id: "rust.std"`, `name: "Rust Standard Library"`
- [ ] Set `enableItemGrouping: false`, `renderItemNameAsCode: true`
- [ ] Implement `render(context)`:
  - Return fixed items: `std`, `core`, `alloc`, `proc_macro`, `test`
  - Each item has pages based on currentUrl if it matches
  - No version selector initially (versions = null)
- [ ] Implement `importItem()`: reject all (std items are predefined)

### `providers/rust.std/url.ts` — NEW: URL Parser

- [ ] Create file with `StdPage` type
- [ ] Implement `parseUrl(url)` for:
  - `doc.rust-lang.org/std/...`
  - `doc.rust-lang.org/core/...`
  - `doc.rust-lang.org/alloc/...`
  - `doc.rust-lang.org/nightly/std/...` (version prefix)
- [ ] Implement `buildUrl(page)` to reconstruct URLs

### `ui/App.tsx` — Main Layout Updates

- [ ] Add preset picker button/dropdown in header
- [ ] Show current preset name
- [ ] Optionally show provider count or icons

### `ui/explorer/index.tsx` — Explorer Multi-Provider Support

Current state: Hard-coded `Item` type with `.type === "crate"` dispatch.

- [ ] Import providers and get view model from `AppContext.deriveViewModel()`
- [ ] Loop through providers in active preset order
- [ ] For each provider, render section header (provider name, not collapsible)
- [ ] For each provider, render groups from `AppData.providers[id].groups`
- [ ] For each group, render items sorted by `item.sortKey`
- [ ] Render ungrouped items (items not in any group)
- [ ] Remove `type === "crate"` dispatch, use generic `Item` rendering
- [ ] Update import dialog to support multi-provider:
  - For each URL, find matching provider
  - Group imports by provider
  - Show which provider will handle each URL

### `ui/explorer/ExplorerItem.tsx` — Generalize Item Rendering

Current state: Crate-specific with `CrateCard` structure.

- [ ] Accept generic `Item` from view model (not `ItemCrate`)
- [ ] Render item name (use `<code>` if provider.renderItemNameAsCode)
- [ ] Render version selector if `item.versions !== null`
- [ ] Render page list from `item.pages`
- [ ] Render actions menu from `item.actions`
- [ ] Remove crate-specific imports

### `ui/explorer/ExplorerPageList.tsx` — Generalize Page Rendering

Current state: Uses `CrateCache` for symbol parsing.

- [ ] Accept `Page[]` from view model (already has parsed `PageName`)
- [ ] Render `PageName.type === "text"` as plain text
- [ ] Render `PageName.type === "symbol"` with colored segments
- [ ] Remove crate-specific imports
- [ ] Pin/unpin uses `page.setPinned()` callback (already in view model)

### `ui/explorer/ExplorerVersionSelector.tsx` — Generalize Version Selector

Current state: Uses `CrateCache` for version list.

- [ ] Accept `ItemVersionProps` from view model
- [ ] Use `versions.current`, `versions.recommended`, `versions.all`
- [ ] Use `versions.select(version)` callback
- [ ] Remove crate-specific imports

### `ui/explorer/ExplorerGroupHeader.tsx` — Multi-Provider Import

- [ ] Update import dialog to show which provider handles each URL
- [ ] Pass provider context to import logic
- [ ] Handle mixed-provider imports (group by provider, import each batch)

### `utils/version-group.ts` — Semver Utilities (Complete)

- [x] `computeVersionGroups()` — groups versions by major.minor
- No changes needed, used by rust.crate provider

---

## Success Criteria

- [ ] Two providers (`rust.crate` + `rust.std`) registered and rendering
- [ ] View model derived via `Provider.render()`, not hard-coded
- [ ] `AppData` structure used for workspace persistence
- [ ] `AppCache` stored in localStorage (no cache IPC)
- [ ] Preset switching works without errors
- [ ] Cross-provider navigation: std link → crate auto-import
- [ ] All v0.1 crate features preserved (pin, version, import, groups)
- [ ] v0.1 workspace detected → show migration message, start fresh

---

## Resolved Questions

1. **Search UI**: ✅ **Unified search** (deferred to post-v0.2)
   - Single search bar, providers contribute results (like PowerToys Run)
   - Results grouped by provider

2. **rust.std version handling**: ✅ **stable/nightly for now**
   - Specific version selection (1.83.0, etc.) supported later

3. **Page title extraction**: ✅ **Provider handles it**
   - Page names rendered via `PageName` type (text or symbol path)
   - Extracted during view model derivation in `render()`

4. **URL routing**: ✅ **Provider-specific**
   - Each provider implements its own `parseUrl`/`buildUrl` (not part of interface)
   - No central dispatch; providers handle their own URLs

5. **Data serialization**: ✅ **Callbacks in view model**
   - View model contains behavior callbacks (invoke, setPinned, select)
   - View models are never serialized; derived fresh on each render

---

## File Structure

Frontend and backend share `src/` directory:

```
src/
├── index.tsx               # React entry point
├── index.html
├── global.css / global.tailwind.css
│
├── core/                   # Shared infrastructure
│   ├── data.d.ts           # Provider interface, shared types
│   ├── context.ts          # AppContext with view model derivation
│   ├── ipc.ts              # IPC layer
│   └── prelude.ts          # Common imports/utilities
│
├── providers/
│   ├── index.ts            # Provider registration
│   ├── rust.crate/
│   │   ├── index.ts        # Provider implementation
│   │   ├── url.ts          # URL parsing/building
│   │   └── crates-api.ts   # crates.io API
│   └── rust.std/           # (planned)
│       ├── index.ts
│       └── url.ts
│
├── ui/
│   ├── App.tsx             # React app root
│   └── explorer/
│       ├── index.tsx       # Provider-agnostic explorer
│       └── ...             # Item, group, page components
│
├── utils/
│   └── version-group.ts    # Semver grouping utilities
│
│ # Rust backend (co-located)
├── main.rs
├── app.rs
├── server.rs
├── webview.rs
└── server/
    └── cache/
```
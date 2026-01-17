# TurboDoc v0.2 Plan: Multi-Provider Architecture

## Overview

TurboDoc v0.1 is a docs.rs-specific documentation viewer. v0.2 transforms it into a **universal documentation reader** supporting multiple providers.

**Implemented Providers:**
- v0.2: `rust` — unified provider for docs.rs + doc.rust-lang.org (std, core, alloc, proc_macro)

**Future Providers:**
- `rust.cargo`, `cpp.cppreference`, `cpp.msdocs`, etc.

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

| Aspect | Data Model | View Model |
|--------|------------|------------|
| Purpose | Storage/serialization format | Runtime with behavior |
| Provider data | `unknown` at app level | Uniform structure |
| Type casting | Single point: deserialization | Already typed |
| Location | Persisted (IPC) | Derived in memory |

**Flow:**
```
[Disk/Storage]        [Deserialization]         [Runtime]
Workspace (JSON) ────► Providers ────────────► ProviderOutput (View Model)
Cache (JSON) ────────►   (cast unknown)  ─────► with behavior callbacks
```

**Rationale:**
- Clean separation between what's stored and what's displayed
- Provider-specific data stays opaque at app level—type safety at boundaries
- View models contain callbacks—never serialized, derived fresh each render
- Single point of type casting reduces runtime type errors

---

## Identification Scheme

| Entity | Global ID Format | Example |
|--------|------------------|---------|
| Provider | `<provider>` | `rust` |
| Group | `<provider>:<group_name>` | `rust:My Project` |
| Item | `<provider>:<item_name>` | `rust:tokio` |
| Page (global) | Full URL | `https://docs.rs/tokio/latest/tokio/` |
| Page (local) | `<semantic>` | `runtime/struct.Runtime` |

**Design Notes:**
- URLs always start with `https://` (protocol assumed, not stored in some contexts)
- Provider guarantees item name uniqueness within itself
- Group names are unique within a provider (used as keys in `groups` Record)
- Ungrouped items use empty string `""` as the group name

---

## Data Structures

Types defined in `core/data.d.ts`.

### Workspace (Root Data Model)

```typescript
interface Workspace {
  app: AppData;
  providers: Record<string, ProviderData>;
}

interface AppData {
  presets: Record<string, { providers: string[] }>;
  currentPreset: string;
  currentUrl: string;  // HTTPS protocol assumed
}

interface ProviderData {
  data: unknown;  // Provider-specific data storage
  groups: Record<string, { items: string[] }>;  // Group name → item IDs
  groupOrder: string[];  // Defines group display order
  expandedItems: string[];  // Item IDs that are expanded in UI
  expandedGroups: string[];  // Group names that are expanded in UI
}
```

**Design Notes:**
- `app` contains app-level configuration (presets, current state)
- `providers` maps provider IDs to their data and UI state
- Provider-specific data is opaque (`unknown`) at the app level
- Groups use `Record` with separate `groupOrder` for ordering flexibility
- Ungrouped items represented by empty string `""` as group name
- UI state (expanded groups/items) stored **per provider**, default: collapsed
- **Eager cleanup**: Remove orphaned UI state entries when content changes
- **No provider collapsing**: Provider visibility controlled by preset

### Cache

```typescript
interface Cache {
  providers: Record<string, unknown>;  // [providerId]: provider-specific cache
}
```

- Cached metadata (versions, links, etc.) per provider
- Stored via IPC (same as workspace)
- Can be cleared without losing user data

---

## Provider Interface

```typescript
interface Provider<T = unknown, TCache = unknown> extends ProviderInfo {
  render(context: ProviderContext<T, TCache>): ProviderOutput;
}

interface ProviderInfo {
  readonly id: string;                    // "rust"
  readonly name: string;                  // "Rust"
  readonly enableItemGrouping: boolean;   // true for rust provider
  readonly renderItemNameAsCode: boolean; // Display item names in monospace
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
- No `importItem` method—import UI handled via `ProviderAction` with `type: "node"`
- Search deferred to post-v0.2
- `render()` returns uniform `ProviderOutput` with `Record<string, Item>`

**Rationale for no `importItem` in interface:**
- Import UI varies significantly between providers (URL paste vs search vs file picker)
- `ProviderAction` with `type: "node"` allows providers to render custom React components
- More flexible than a standardized import method

---

## View Model Structure

Providers return `ProviderOutput` from `render()`:

```typescript
type ProviderOutput = ReadonlyDeep<{
  items: Record<string, Item>;  // Item ID → Item
  actions?: ProviderAction[];   // Provider-level actions (e.g., import button)
}>;

type ProviderAction =
  | { type: "node"; render(): ReactNode }  // Custom React component
  | { type: "menu"; name: string; icon: IconProp; invoke(): void };

interface Item {
  id: string;
  name: string;
  sortKey: string;
  pages: Page[];
  links?: ItemLink[];      // External links (crates.io, repo, etc.)
  actions?: ItemAction[];  // Context menu actions
  versions?: ItemVersions; // Version selector (packages only)
}

interface Page {
  name: PageName;
  sortKey: string;
  url: string;
  pinned: boolean | null;  // null = pinning disabled for this page
  setPinned(pinned: boolean): void;
}

type PageName =
  | { type: "text"; text: string }
  | { type: "symbol"; path: { type: IdentType; name: string }[]; separator: string };

interface ItemVersions {
  current: string;
  recommended: string[];
  all: string[][];  // Grouped by semver compatibility
  setCurrentVersion(version: string): void;
}
```

**Design Notes:**
- View models contain callbacks for user interactions—never serialized
- `ItemLink` separated from `ItemAction` for different UI treatment (links open URLs, actions invoke callbacks)
- `Page.pinned = null` means pinning is disabled for that page (e.g., root module page)
- `PageName.type = "symbol"` enables syntax-colored rendering with language-specific separators

---

## State Management

**Decision: Derive view model on every render (no memoization initially).**

```
Workspace (React state) ──► provider.render() ──► React render
        │
        └── Immer updates (new refs only for changed parts)
```

- Data model lives in React state (`useImmer`)
- View model derived synchronously in `ExplorerProvider` component
- `ProviderContext` constructed inline with update callbacks
- Immer ensures immutable updates with minimal reference changes
- Add `useMemo` later if profiling shows performance issues

**Rationale:**
- Object creation is fast; DOM updates are the bottleneck
- Simple, predictable architecture
- Premature optimization avoided
- View model derivation is pure function of data model—easy to reason about

---

## Storage Strategy

| Data | Storage | Reason |
|------|---------|--------|
| Workspace | IPC → workspace file | User content + UI state, needs disk persistence |
| Cache | IPC → cache file | Metadata, can be regenerated |

Both workspace and cache use IPC for persistence. Auto-save triggers on state change.

**Design Notes:**
- Originally planned localStorage for cache, but kept IPC for simplicity
- Cache can be cleared without losing user data
- Workspace save is immediate (no debouncing)—file is small, ensures data safety

---

## UI Design

### Sidebar Layout

Providers appear as sections (visibility controlled by preset):

```
┌─────────────────────────────────┐
│ [+ Import Crates]               │  ← Provider action (rust.crate)
├─────────────────────────────────┤
│   ▶ Ungrouped                   │  ← Ungrouped items
│   ▼ My Project                  │  ← Group (expanded)
│       tokio                     │
│       async-std                 │
│   ▶ Utilities                   │  ← Group (collapsed)
│   [+ Add Group]                 │  ← Create group button
└─────────────────────────────────┘
```

### Unified Search (Deferred to post-v0.2)

- Single search bar at the top of explorer
- Each provider that supports search contributes results
- Results grouped by provider (like PowerToys Run)
- Providers without search support are skipped

### Preset System

Users select a preset to determine which providers appear and their order:

```typescript
const presets = {
  "Rust": { providers: ["rust"] },
  "Empty": { providers: [] },
};
```

- Presets stored in `Workspace.app.presets`
- Users can create custom presets
- Switching presets doesn't delete provider data (preserved but hidden)
- Preset picker UI not yet implemented

---

## Migration & Compatibility

**Decision: No automatic workspace upgrade.**

- v0.2 workspace format is incompatible with v0.1
- Users must recreate their workspace
- Clean break simplifies implementation
- Acceptable for this stage of development

**Implementation:** On startup, if workspace structure doesn't match expected format, initialize with empty defaults.

---

## Resolved Design Questions

1. **Search UI**: ✅ **Unified search** (deferred to post-v0.2)
   - Single search bar, providers contribute results (like PowerToys Run)
   - Results grouped by provider

2. **rust.std version handling**: ✅ **stable/nightly for now**
   - Specific version selection (1.83.0, etc.) supported later

3. **Page title extraction**: ✅ **Provider handles it**
   - Page names rendered via `PageName` type (text or symbol path)
   - Symbol parsing done in provider's `render()` function

4. **URL routing**: ✅ **Provider-specific**
   - Each provider implements its own `parseUrl`/`buildUrl` (not part of interface)
   - No central dispatch; providers handle their own URLs

5. **Data serialization**: ✅ **Callbacks in view model**
   - View model contains behavior callbacks (invoke, setPinned, setCurrentVersion)
   - View models are never serialized; derived fresh on each render

6. **Import mechanism**: ✅ **ProviderAction with type: "node"**
   - Providers render custom import UI via React components
   - More flexible than standardized `importItem` method

---

## Remaining Work

- [x] **Unified Rust Provider** — merged `rust.crate` + `rust.std` into single `rust` provider
- [ ] **Preset Picker UI** — allow users to switch/create presets
- [ ] **Cross-Provider Navigation** — handle links between providers (partially done via unified rust provider)

---

## Unified Rust Provider (Implemented)

### Design Decision: Single Provider

Originally planned as separate `rust.crate` and `rust.std` providers, but merged into a single `rust` provider for simplicity.

**Rationale:**
- Both handle Rust documentation with identical page structure
- Symbol parsing and color coding are the same
- Simpler mental model for users (one "Rust" section in sidebar)
- URL routing handled internally via `getBaseUrlForCrate()`

### Files

- `providers/rust/index.tsx` — Provider implementation
- `providers/rust/url.ts` — URL parsing for docs.rs + doc.rust-lang.org
- `providers/rust/import.tsx` — Import dialog via ProviderAction
- `providers/rust/crates-api.ts` — crates.io API client

### URL Routing

`getBaseUrlForCrate()` determines the base URL based on crate name:
- `std`, `core`, `alloc`, `proc_macro` → `https://doc.rust-lang.org/`
- All other crates → `https://docs.rs/`

### URL Patterns Supported

**docs.rs:**
- `https://docs.rs/{crate}/{version}/{path...}`

**doc.rust-lang.org:**
- `https://doc.rust-lang.org/{std|core|alloc|proc_macro}/{path...}`
- `https://doc.rust-lang.org/{nightly|stable|1.x.y}/{crate}/{path...}` (version prefix)

---

## Cross-Provider Navigation

With the unified `rust` provider, navigation between docs.rs and doc.rust-lang.org is handled seamlessly within a single provider.

**Current behavior (within rust provider):**
- docs.rs page links to `doc.rust-lang.org/std/vec/struct.Vec.html`
- `rust` provider's `parseUrl()` recognizes both URL patterns
- `std` crate auto-imported if not present, page displayed

**Future (multiple providers):**
When a page links to a URL handled by a different provider:
1. Each provider attempts to parse the URL (provider-specific `parseUrl`)
2. First matching provider handles the import
3. Auto-import to target provider
4. Navigate to the new page

---

## Success Criteria

- [x] View model derived via `Provider.render()`, not hard-coded
- [x] `Workspace` structure used for persistence
- [x] All v0.1 crate features preserved (pin, version, import, groups)
- [x] Unified `rust` provider handles both docs.rs and doc.rust-lang.org
- [x] Cross-crate navigation within rust provider (std ↔ third-party crates)
- [ ] Preset switching works without errors

---

## File Structure

```
src/
├── index.tsx                 # ✅ React entry point with workspace/cache loading
├── index.html
├── global.css / global.tailwind.css
│
├── core/
│   ├── data.d.ts             # ✅ Provider interface, shared types
│   ├── context.ts            # ✅ AppContext, ProviderProvider, hooks
│   ├── ipc.ts                # ✅ IPC layer (workspace + cache)
│   └── prelude.ts            # ✅ Common imports/utilities
│
├── providers/
│   ├── index.ts              # ✅ Provider registration (Record<string, Provider>)
│   └── rust/                 # ✅ Unified Rust provider (docs.rs + doc.rust-lang.org)
│       ├── index.tsx         # ✅ Provider implementation
│       ├── url.ts            # ✅ URL parsing/building for both domains
│       ├── url.test.ts       # ✅ URL parsing tests
│       ├── import.tsx        # ✅ Import dialog via ProviderAction
│       ├── crates-api.ts     # ✅ crates.io API client
│       └── crates-api.integration.test.ts
│
├── ui/
│   ├── App.tsx               # ✅ React app root
│   └── explorer/
│       ├── index.tsx                       # ✅ Explorer, ExplorerProvider, ExplorerGroup
│       ├── ExplorerGroupHeader.tsx         # ✅ Group header with menu
│       ├── ExplorerCreateGroupComponent.tsx # ✅ Add group button/input
│       ├── ExplorerItem.tsx                # ✅ Generic item rendering
│       ├── ExplorerItemMenu.tsx            # ✅ Item links and actions menu
│       └── ExplorerPageList.tsx            # ✅ Page list with symbol colors
│
├── utils/
│   └── version-group.ts      # ✅ Semver grouping utilities
│
│ # Rust backend (co-located)
├── main.rs
├── app.rs
├── server.rs
├── webview.rs
└── server/
    └── cache/
```
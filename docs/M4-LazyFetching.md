# M4: Intent-Driven Crate Metadata Fetching

## Summary

TurboDoc does not need crate metadata to restore a workspace. Crate names,
the current version, pinned pages, groups, and the active documentation URL
are already persisted independently. Fetching metadata for every crate during
startup therefore spent network, proxy, parsing, semver-grouping, and reactive
rendering work on controls the user might never open.

M4 moves automatic crates.io sparse-index requests to the first time a crate's
item menu opens. Version choices live in that menu after external links and
before item actions: five recommended choices are direct radio items, with the
remaining grouped history in a More versions submenu. Explicit **Refresh
Metadata** remains an intentional request to the richer crates.io API.

## Goals

- Restore large workspaces without issuing crate metadata requests.
- Keep crate navigation and persisted current versions usable while offline.
- Reclaim the crate-row width previously reserved for version controls.
- Treat pointer, keyboard, and touch menu opening as equivalent user intent.
- Keep long version histories navigable without making the primary menu tall.
- Deduplicate repeated intent and make request races deterministic.
- Keep HTTP freshness and persistence in the existing host proxy.

## Non-goals

- Persisting parsed crate metadata in the frontend.
- Replacing the host's RFC-aware SQLite HTTP cache.
- Fetching metadata when a group expands or an item enters the viewport.
- Adding a general-purpose asynchronous resource framework.
- Adding search or virtualization to the version-history submenu.

## Interaction design

### Menu placement

The crate header contains only its full-width name and ellipsis trigger.
Version choices appear inside the existing Bits UI item menu after external
links and before Refresh Metadata or other item actions. Five unique
recommended choices are shown directly. More versions opens a height-bounded,
scrollable submenu containing the remaining non-yanked history in semver
compatibility groups.

Both levels use menu radio items, so the checked version and keyboard behavior
come from the menu primitive rather than custom checkbox markup. The current
value remains represented even when it is yanked, missing from metadata, or a
non-semver alias.

### Intent timing

Opening the item menu calls `ItemVersions.ensureLoaded()` immediately. This is
the first moment its direct version choices become visible, and the already
open menu can react from loading to ready without requiring a second click.
Repeated openings remain cheap because the provider loader deduplicates active
requests and returns immediately when it has usable data.

Opening the menu for a link or non-version action can also request metadata.
That bounded trade-off keeps the five first-level choices truthful without
restoring broad crate-row hover prefetching.

### Menu states

The persisted `current` version is always available:

| State | Presentation | Interaction |
|---|---|---|
| `idle` | Current version | Menu opening starts loading |
| `loading` | Checked current version and spinner | Repeated activation is deduplicated |
| `ready` | Five direct radio items plus optional More versions submenu | Selection closes the menu and navigates as before |
| `error` | Checked current version and warning | Reopening or selecting the row retries |

The menu stays open while the reactive view model changes state, completing
loading as one logical interaction.

Static standard-library choices (`stable` and `nightly`) begin in `ready`.
The unversioned `windows` documentation item has no version section and
performs no automatic metadata request. Its explicit refresh action can still
request crates.io metadata.

## Data contract

`ItemVersions` owns the provider-neutral lazy-loading surface:

- `status` communicates `idle`, `loading`, `ready`, or `error`;
- `error` provides optional human-readable failure context;
- `ensureLoaded()` idempotently requests the choices; and
- `current` remains valid in every state.

The callback is named for its guarantee rather than for a UI event. The item
menu can invoke it from any opening mechanism without teaching provider code
about DOM events. A broader item-level `prepareMetadata()` abstraction was
rejected because the current interaction and latency concern is specifically
the version choices.

## Request and cache design

The Svelte-facing cache contains a reactive entry per requested crate:

```text
crate name -> { data, status, error }
```

Missing entries represent `idle` without being inserted during rendering.
This keeps provider rendering free of side effects while still allowing
Svelte to track the keyed cache read.

`CrateCacheLoader` is a rune-independent request coordinator. Production
passes it the reactive state object; unit tests pass a plain object. It:

1. returns immediately when a normal request already has usable data;
2. shares the promise for concurrent normal requests;
3. shares repeated explicit refresh requests;
4. permits a refresh to supersede an older normal request;
5. commits results only when their generation is still newest; and
6. converts failures into state instead of rejecting fire-and-forget UI work.

The generation check is a latest-wins policy. Without it, a slow sparse-index
response could overwrite richer metadata returned by a newer `no-store`
crates.io refresh.

An explicit refresh retains old `data` while requesting. If it fails, existing
version choices remain usable even though the entry records the refresh error.

## Request flow

```text
Workspace restore
  -> render crate card with persisted current version
  -> no metadata request

Item menu opens
  -> ItemVersions.ensureLoaded()
  -> CrateCacheLoader.ensure(crate)
     -> usable frontend data: return
     -> matching request active: share promise
     -> otherwise fetch sparse index through host proxy
        -> parse and precompute semver groups
        -> publish reactive ready state
```

The host proxy remains responsible for memory-independent reuse, upstream
cache directives, conditional revalidation, stale-while-revalidate, and disk
eviction. Lazy frontend loading reduces when representations are requested; it
does not duplicate those policies.

## Alternatives considered

### Retain crate-row hover prefetching

Hover prefetching can make the menu ready before it opens, but the crate row no
longer displays a version control. Treating incidental traversal as version
intent would spend network and parsing work without visible feedback. The open
menu can instead update in place after one activation.

### Put every version in a submenu

A version-only submenu keeps the item menu short, but makes common switching
take an unnecessary extra traversal. Five direct recommendations retain the
fast path while bounding the primary menu's height.

### Fetch when a group expands

Expansion describes page-list interest, not version-selection interest. A
large expanded group would recreate the original burst.

### Fetch visible cards with `IntersectionObserver`

Most cards can be visible at startup, and scrolling would turn browsing into
background network activity. Visibility is weaker intent than interaction.

### Persist parsed metadata in the frontend

The host already persists raw HTTP representations with correct cache
semantics. A second persistent cache would need invalidation, migration, and
consistency rules without eliminating parsing indefinitely.

### Abort on pointer leave

Aborting saves little after an intercepted request has begun and creates
thrashing when the pointer crosses the card boundary. Completed responses are
valuable for the rest of the session.

## Failure modes and mitigations

- **Menu opened for another action:** one crate can receive metadata even when
  the user selects a link or move action. Startup and crate-row traversal still
  issue no requests.
- **Offline, 404, malformed, or rate-limited metadata:** the persisted current
  version and documentation navigation remain usable; the menu reports an
  error and permits retry.
- **Synchronous intercepted-request latency:** the menu represents the request
  with a checked loading row. One request can still expose host/UI thread
  latency, but no longer multiplies it by the workspace size.
- **Very large version histories:** parsing and semver grouping happen once
  per successful frontend load; the overflow DOM mounts only when its bounded,
  scrollable submenu opens. This should be measured before adding search or
  virtualization.
- **Refresh racing a normal load:** generations prevent stale overwrites.
- **Refresh failure:** old usable data is retained.
- **Crate deletion during a request:** a late result may remain as an orphaned
  in-memory entry but cannot recreate persisted crate data. Re-importing the
  crate can reuse it for the session.
- **Missing, yanked, prerelease, or non-semver current versions:** the current
  value remains checked and is not silently replaced. Non-semver aliases are
  kept outside `semver.rcompare`.
- **Collapsed groups:** their unmounted cards cannot open a menu and therefore
  cannot fetch.
- **Hoverless input:** the ellipsis trigger is persistently visible, avoiding
  an invisible version entry point on touch devices.

## Verification

Automated coverage verifies:

- no loader activity before explicit `ensure`;
- concurrent request deduplication;
- successful publication and reuse;
- failure state followed by retry;
- old-data preservation after refresh failure; and
- latest-wins behavior between normal and refresh requests.

Manual verification should confirm:

- startup and bulk import issue no sparse-index requests;
- crate-row hover and focus do not request metadata;
- pointer, keyboard, and touch menu opening starts one lazy request;
- the open menu progresses from loading to radio choices without closing;
- five choices appear directly and the remaining grouped history scrolls in
  More versions;
- offline errors can be retried; and
- large workspaces remain responsive during restore.

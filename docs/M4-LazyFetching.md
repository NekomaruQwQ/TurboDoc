# M4: Intent-Driven Crate Metadata Fetching

## Summary

TurboDoc does not need crate metadata to restore a workspace. Crate names,
the current version, pinned pages, groups, and the active documentation URL
are already persisted independently. Fetching metadata for every crate during
startup therefore spent network, proxy, parsing, semver-grouping, and reactive
rendering work on controls the user might never open.

M4 moves automatic crates.io sparse-index requests to the first meaningful
interaction with a crate's version selector. The selector is progressively
disclosed while hovering or focusing anywhere in the crate item—including
its expanded page rows—or on touch-capable layouts. Explicit **Refresh
Metadata** remains an intentional request to the richer crates.io API.

## Goals

- Restore large workspaces without issuing crate metadata requests.
- Keep crate navigation and persisted current versions usable while offline.
- Reveal secondary version controls without shifting each card's layout.
- Treat mouse, keyboard, and touch interaction as equivalent user intent.
- Deduplicate repeated intent and make request races deterministic.
- Keep HTTP freshness and persistence in the existing host proxy.

## Non-goals

- Persisting parsed crate metadata in the frontend.
- Replacing the host's RFC-aware SQLite HTTP cache.
- Fetching metadata when a group expands or an item enters the viewport.
- Adding a general-purpose asynchronous resource framework.
- Implementing the future full-version-list popup.

## Interaction design

### Progressive disclosure

The version selector retains its existing fixed-width footprint but is
transparent and non-pointer-interactive until its crate item is:

- hovered with a hover-capable pointer, including over an expanded page row;
- focused within by keyboard navigation, including a page or pin control;
- rendered on a device that cannot express hover; or
- keeping its portaled version menu open.

Reserving the footprint avoids making long crate names jump or re-truncate
when the selector appears. The dropdown-open condition is important because
Bits UI portals the menu outside the crate item, which otherwise ends its
hover and focus-within state.

The pointer and focus boundary lives on the outer collapsible crate item
rather than its header. Moving between the header and page rows therefore
does not hide the selector, cancel a pending intent timer, or cause visual
flicker.

### Intent timing

Mouse hover waits 125 ms before requesting metadata. This small hover-intent
window filters incidental cursor travel across a long sidebar. Keyboard focus
and non-mouse pointer interaction request immediately because they are
stronger signals.

Leaving the entire crate item cancels only a timer that has not fired. An
in-flight request continues so repeated entry cannot create abort/retry churn
and so a useful cache result is not discarded.

### Selector states

The persisted `current` version is always available:

| State | Presentation | Interaction |
|---|---|---|
| `idle` | Current version | Hover schedules loading; activation loads now |
| `loading` | Current version and spinner | Repeated activation is deduplicated |
| `ready` | Normal recommended-version selector | Version changes behave as before |
| `error` | Current version and warning | Re-entry or activation retries |

Explicit activation is completed as one logical interaction: after a
successful load, the real selector opens automatically instead of requiring a
second click or tap.

Static standard-library choices (`stable` and `nightly`) begin in `ready`.
The unversioned `windows` documentation item has no selector and performs no
automatic metadata request. Its explicit refresh action can still request
crates.io metadata.

## Data contract

`ItemVersions` owns the provider-neutral lazy-loading surface:

- `status` communicates `idle`, `loading`, `ready`, or `error`;
- `error` provides optional human-readable failure context;
- `ensureLoaded()` idempotently requests the choices; and
- `current` remains valid in every state.

The callback is named for its guarantee rather than for a UI event. The
explorer can invoke it from hover, focus, touch, or future interaction models
without teaching provider code about DOM events. A broader item-level
`prepareMetadata()` abstraction was rejected because the current interaction
and latency concern is specifically the version selector.

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

Hover/focus/touch intent
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

### Fetch when the selector is clicked

This minimizes requests further but makes the control feel unresponsive on
first activation and can require a second click to open. Hover intent gives
the common mouse workflow a head start while focus and touch remain explicit.

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

- **Incidental pointer sweeps:** the 125 ms delay filters most accidental
  visits; the loader still deduplicates requests that begin.
- **The window opens under the pointer:** one card may receive legitimate
  hover intent immediately. Startup still avoids the all-crate burst.
- **Offline, 404, malformed, or rate-limited metadata:** the persisted current
  version and documentation navigation remain usable; the selector reports an
  error and permits retry.
- **Synchronous intercepted-request latency:** the intent delay lets the
  selector reveal before `fetch` begins. One request can still expose host/UI
  thread latency, but no longer multiplies it by the workspace size.
- **Very large version histories:** parsing and semver grouping happen once
  per successful frontend load. This can still create an interaction-time
  hitch and should be measured before introducing workers or incremental
  parsing.
- **Rapid focus and pointer transitions:** timers are cleared on leave and
  component destruction; active requests are promise-deduplicated.
- **Portaled dropdown interaction:** explicit open state keeps the selector
  visible while hover/focus temporarily leaves the card.
- **Refresh racing a normal load:** generations prevent stale overwrites.
- **Refresh failure:** old usable data is retained.
- **Crate deletion during a request:** a late result may remain as an orphaned
  in-memory entry but cannot recreate persisted crate data. Re-importing the
  crate can reuse it for the session.
- **Missing, yanked, prerelease, or non-semver current versions:** the current
  value remains visible and is not silently replaced. Non-semver aliases are
  kept outside `semver.rcompare`.
- **Collapsed groups:** their unmounted cards cannot emit intent and therefore
  cannot fetch.
- **Keyboard traversal:** focus intentionally counts as user intent. Tabbing
  through many cards can fetch several crates, which is preferable to making
  the selector inaccessible.

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
- hover reveal occurs immediately but loading waits for hover intent;
- keyboard focus and touch-capable layouts expose the selector;
- the selector remains visible while its dropdown is open;
- offline errors can be retried; and
- large workspaces remain responsive during restore.

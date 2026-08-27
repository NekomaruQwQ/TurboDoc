# Source, Adapter, and Topic Architecture

This document defines the current frontend data-source architecture. It
supersedes the provider model described by the historical M5 and M6 notes.

## 1. Vocabulary and dependency direction

The runtime pipeline is:

```text
SourceDefinition --Adapter.resolve--> SourceModel --SourceModel.render--> SourceView
       data/config                       source ViewModel                    ephemeral UI data

ready SourceView[] --composeTopicView--> ExplorerView
                         Topic                generic Explorer UI
```

1. `SourceDefinition<D, R>` is a code-defined, data-oriented declaration. It
   supplies a stable source ID, a display name, the one meaningful adapter,
   and adapter-specific rules/configuration.
2. `Adapter<D, R>` is reusable logic. It compiles exactly one definition at a
   time with `resolve(definition)`.
3. `SourceModel<D>` is the compiled runtime model and is conceptually the
   source ViewModel. It validates/initializes persistence, owns URL matching,
   derives a `SourceView`, and may install source effects.
4. `SourceView` is a fresh, non-persisted view containing source-local items,
   actions, and search behavior.
5. `Topic` is only a UI composition. It orders already compiled models, chooses
   a landing source, and supplies Explorer wording/iconography. It is not part
   of source persistence and does not appear in the adapter generic types.

There is intentionally no shared `SourceData` base. The only generic bound is
`D extends object`, which prevents primitive persistence roots and lets the
save boundary accept a JSON/TOML object. Concrete adapters own their complete
schemas, including `schemaVersion: 1`; the bound adds no fields and performs no
runtime validation.

## 2. Why a source names its adapter

A source definition is meaningful only with the adapter that interprets its
rules and persistence data. Storing `adapter` directly on `SourceDefinition`
makes that pairing explicit and prevents a topic from selecting or changing
adapter behavior.

This keeps the two reuse axes separate:

1. One adapter can compile many definitions, such as fifteen independent Rust
   books through `RustBookAdapter`.
2. One topic can compose many independently compiled sources, such as the
   fifteen Rust book models in the Rust Books topic.
3. Source state remains independently loadable, searchable, retryable, and
   persistable even when a topic combines its view with sibling sources.

## 3. Current adapters, sources, and topics

| Adapter | Source definitions | Persisted data | UI topic |
|---|---|---|---|
| `RustCrateAdapter` | `rust-crates` | crates, versions, pinned Rustdoc pages | Rust Crates |
| `RustBookAdapter` | 15 checked-in Rust book definitions | one book's pinned pages | Rust Books |
| `WebAdapter` | `minecraft-wiki`, `wikipedia` | one site's pinned pages and user collections | one topic per site |

`RustBookAdapter` only implements immutable checked-in book sections. It does
not expose collection editing. `WebAdapter` is the general page adapter and
only exposes user-owned collections; it contains no book-section policy.

The current UI topic registry is:

1. Rust Crates → `rust-crates`.
2. Rust Books → the 15 book sources in catalog order, with `rust-book` as the
   explicit landing source.
3. Minecraft Wiki → `minecraft-wiki`.
4. Wikipedia → `wikipedia`.

Every source belongs to exactly one topic. Registry validation rejects empty or
duplicate topic IDs, empty topics, duplicate source membership, and an unknown
`homeSourceId` at module initialization.

## 4. Persistence layout and schemas

Source files live at:

```text
<dataDir>/
├── sources/
│   ├── rust-crates.toml
│   ├── rust-book.toml
│   ├── cargo-book.toml
│   ├── ... one file per remaining book ...
│   ├── minecraft-wiki.toml
│   └── wikipedia.toml
├── ui.explorer.toml
├── rust.toml             # optional read-only legacy input
└── cache.sqlite
```

Persistence is flat; there is no `[state]` wrapper. Examples:

```toml
# sources/rust-book.toml
schemaVersion = 1
pinnedPages = ["https://doc.rust-lang.org/stable/book/ch04-01-what-is-ownership.html"]
```

```toml
# sources/minecraft-wiki.toml
schemaVersion = 1
pinnedPages = ["https://minecraft.wiki/w/Redstone_Dust"]

[collections.Mechanics]
pages = ["https://minecraft.wiki/w/Redstone_Dust"]
```

```toml
# sources/rust-crates.toml
schemaVersion = 1

[crates.serde]
currentVersion = "latest"
pinnedPages = []
```

`ui.explorer.toml` is deliberately not source data. It stores topic-owned named
groups and group order. Group entries use composite item keys so identical
source-local IDs cannot collide:

```toml
schemaVersion = 1

[topics.rust-crates]
groupOrder = ["Daily"]

[topics.rust-crates.groups.Daily]
items = ["rust-crates:serde"]
```

The HTTP wire format remains JSON:

1. `GET|PUT /api/sources/{source_id}` maps to
   `<dataDir>/sources/<source_id>.toml`.
2. `GET|PUT /api/data/{data_id}` maps to `<dataDir>/<data_id>.toml` and is
   retained for `ui.explorer` plus the removable migration input.
3. Both IDs use the same strict lowercase, single-path-segment contract.
4. A missing GET returns `200 {}` with
   `x-turbodoc-resource-exists: false`; release CORS explicitly exposes that
   header to the mapped frontend. Malformed or unreadable TOML returns an error
   and is never converted to an empty resource.
5. The `sources` directory is created only by a source PUT, so reads have no
   filesystem side effects.

## 5. Loading, rendering, and saving

`SourceStoreRegistry` is application-owned and creates a `SourceDataStore` only
when a topic first uses its source. Stores survive keyed topic switches, so UI
lifecycle changes cannot abandon a newer save queued behind an in-flight PUT.

Each source loads independently and has `idle`, `loading`, `ready`, or `error`
status. A topic renders and searches only its ready sources. One malformed or
unreadable source therefore produces a source-specific retry row without
blocking ready siblings.

Initialization distinguishes absence from explicit empty data:

1. Rust Crates seeds `serde` and `tokio` only when its source file genuinely
   does not exist.
2. An existing `{ schemaVersion = 1, crates = {} }` remains intentionally empty.
3. Rust books and web sources start with empty pins when absent and materialize
   their files on the first edit.
4. Existing malformed data fails validation and remains untouched.

`SerializedSaveQueue` provides one queue per source and one for Explorer UI
state. It JSON-snapshots reactive data at request time, runs no overlapping
writes, coalesces pending changes to the newest snapshot, marks a snapshot
durable only after success, retains dirty data after failure, and retries with
bounded exponential backoff. The UI also exposes immediate retry actions.

## 6. Topic composition and item identity

`composeTopicView(topic, readySources)` is the only place source-local views
become one Explorer view.

1. Item identity becomes `encode(sourceId) + ":" + encode(localItemId)`.
   Parsing requires a canonical reversible spelling; malformed persisted/search
   values are ignored or preserved as unknown rather than guessed.
2. Item sort keys receive a topic source-order prefix, then retain the
   adapter-owned local order.
3. Search activation decodes the composite key and dispatches only to the
   owning ready source.
4. Add and empty-input actions are collected in topic source order.
5. The first ready source reporting an active item wins; disjoint URL ownership
   should normally make that unique.
6. Group cleanup removes malformed or unregistered-source identities
   immediately, then removes an item owned by a ready source only when that
   item is absent. Registered loading or failed sources are preserved.

The navigation rail lists topics. Explicit topic selection opens the configured
home source; an accepted iframe navigation activates the first topic containing
a matching source without navigating again. Active topic, recent composite
items, and expansion keys use registered localStorage slots. That registry owns
the complete `turbodoc:` namespace: startup removes every unregistered slot and
canonicalizes current values from topic/source ownership, so obsolete
provider-era or versioned UI keys require no explicit migration list.

## 7. URL and page safety

Page-oriented adapters compile a source-private routing pipeline:

1. Parse with `URL`; reject malformed URLs.
2. Require HTTPS and no embedded username/password.
3. Apply the definition's structural `ownsUrl` predicate.
4. Normalize aliases on a private URL copy and sort query parameters.
5. Re-run safety and ownership after normalization.
6. Derive a page identity, defaulting to the canonical URL without its fragment.

Rust book definitions use exact origin/path boundaries and checked-in outline
snapshots. Wiki definitions use exact origins. Rustdoc matching remains inside
`RustCrateAdapter`. Registry order is the documented tie-breaker if future
source matchers overlap.

## 8. `rust.toml` migration and removal

`migrations/rust-provider-v1.ts` is the only compatibility bridge. It never
queries legacy documentation TOML files.

On startup, before any new store can create a target, it:

1. Checks `sources/rust-crates.toml` and `ui.explorer.toml` in parallel.
2. Treats each existing target as independently authoritative and never parses,
   merges, or replaces it.
3. Reads root `rust.toml` only when at least one target is absent.
4. Migrates `data.crates` to flat Rust Crate source data.
5. Migrates groups to the Rust Crates topic and converts local crate IDs to
   composite item keys.
6. Runs independent writes with `Promise.allSettled`, then reports every
   validation/write failure.
7. Never changes or deletes `rust.toml`.

A migration failure blocks source/workspace initialization and presents Retry.
This prevents starter crates or empty UI state from becoming authoritative
after a transient or malformed migration. A missing legacy file is a normal
fresh install. The new empty `ui.explorer.toml` is materialized once, and the
default Rust Crates topic materializes its starter source, so an ordinary fresh
install converges to both authoritative targets.

When legacy support is no longer required, removal is local:

1. Delete `frontend/src/migrations/rust-provider-v1.ts` and its test.
2. Remove its one import and pre-workspace call from `App.svelte`; call
   `workspace.load()` directly on mount.
3. Keep `/api/data/{data_id}` because `ui.explorer.toml` still uses it. No
   adapter, source model, topic, or per-source persistence code depends on the
   legacy `rust` ID.

## 9. Adding another code-defined source

1. Choose an existing adapter only if its persistence schema, URL semantics,
   item model, and page-organization behavior truly match.
2. Otherwise create a small adapter with a concrete Zod schema and focused
   rules type; do not add optional strategy flags to an unrelated adapter.
3. Define the source with a globally unique safe ID and pair it directly with
   that adapter.
4. Compile it once through `resolveSource`.
5. Add the model to exactly one topic and choose an explicit home source.
6. Add exact URL ownership, missing-vs-empty, malformed-data, render, and topic
   routing tests.
7. Add any new upstream origin to the native hosted/proxied security boundary.

The definitions are code-owned for this PoC. Moving them to external data later
does not require changing the `SourceModel` or topic composition boundary; it
requires only a loader capable of constructing adapter-specific validated
definitions.

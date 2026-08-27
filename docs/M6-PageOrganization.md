# Page organization and the Rust bookshelf

> Historical note: the page-layout algorithms remain relevant, but
> [M7-SourceAdapterTopics.md](M7-SourceAdapterTopics.md) supersedes the provider
> terminology, ownership boundaries, and persistence layout in this document.

## Approved design

1. Explorer items remain source/URL ownership boundaries. Outer item Groups
   are unchanged. Neutral `PageLayout` / `PageBlock` view models do not expose
   provider concepts to the renderer.
2. User collection order is Home, loose pins, untitled preview block,
   alphabetically sorted collections, Add collection. Headers are muted,
   case-preserving and non-collapsible, with a small actions menu. Pages move
   within/between collections by pointer, touch or keyboard drag handles.
3. Pins are authoritative. Optional collection-name keys contain ordered pin
   subsets; ambiguous membership becomes loose. Removing a collection keeps
   its pages and appends them to loose pins. Invalid/stale drops are rejected
   atomically; fragments remain navigation targets but not pin identities.
4. Book sources exclusively use provider order. Checked-in outline metadata
   defines contiguous spans and reading order, including the preview. Empty
   spans are hidden; unknown pages fall back to the initial loose block.
   Repeated parent headings are separate spans, never regrouped out of order.
5. The catalog includes Rust Book, Cargo, Nomicon, rust-analyzer, Rust By
   Example, Reference, Edition Guide, rustc, rustdoc, Clippy, Style Guide,
   Unstable Book (nightly), Embedded Book, rustc-dev-guide and rustup.
6. Naming remains a site callback. Rust Book labels retain chapter numbers:
   `ch03-05-control-flow.html` becomes `03-05 Control Flow`. Wiki labels remain
   canonical-URL article titles. No live document-title plumbing.
7. Outline refresh is an explicit Bun development tool; navigation, startup,
   tests and ordinary builds never fetch outlines. No new dependencies.

## Visual direction

Reuse the workbench palette, Ubuntu UI and Ubuntu Mono identifier faces. The
signature is a quiet index heading with a faint continuation rule, aligned to
page text; only action buttons hover. No cards, icons or collapse chevrons for
sections. Preserve current-page selection, italic previews, keyboard focus
and reduced-motion behavior.

## Implementation checklist

- [x] Record the approved scope and inspect existing contracts.
- [x] Neutral page-list composition and multi-zone drag coordinator.
- [x] Quiet block headers, validated name editing and removal confirmation.
- [x] Collection persistence and atomic ordering tests.
- [x] Book outline importer, snapshots, placement and naming policies.
- [x] Official catalog and narrow native hosted/proxy scopes.
- [x] Regression tests, static checks and production builds.
- [ ] Native visual/interaction QA (handed to the user).
- [x] Update architecture documentation and record verification results.

## Baseline

The clean-tree Vite build produced 694.46 kB JavaScript (188.60 kB gzip) and
63.62 kB CSS (11.56 kB gzip). The existing >500 kB chunk warning predates this
change. No user data files will be edited for testing.

## Verification

1. `bun test`: 212 passing tests, 393 assertions. Coverage includes corrupted
   saved metadata, ambiguous membership, fragments, reserved collection names,
   atomic cross-zone permutations, rename/remove behavior, pin/unpin preview
   transitions, repeated section ancestry, unknown-page fallbacks, naming,
   catalog ownership and validated outline parsing.
2. `bunx --bun svelte-check --tsconfig tsconfig.json`: zero errors or warnings.
   Targeted `bunx --bun biome check` passes without applying formatting.
3. `cargo test --release`: 71 passing tests. Native regressions cover the new
   exact book URL scopes and exclusion from Rustdoc-only injection.
4. `cargo clippy --release --all-targets --all-features --locked -- -D warnings`
   and `cargo build --release`: successful.
5. `bunx --bun vite build`: successful. Final JavaScript is 950.59 kB
   (228.65 kB gzip), CSS is 66.77 kB (11.95 kB gzip). JavaScript grows by
   40.05 kB gzip over baseline, principally from offline outline metadata.
   The pre-existing large-chunk advisory remains; no new dependencies.

## Manual QA handoff

A separate development instance runs on port 5187 with disposable data under
`target/page-organization-qa/`, including a separate WebView2 profile. The
stable instance and existing user data were not modified. Automated desktop
inspection could not obtain app approval before its timeout; no visual or
interaction result is claimed. The user volunteered to perform this check.

1. Wiki order: Home, loose pins, preview, alphabetical collections, Add
   collection. Check empty collections and the untitled loose drop target.
2. Pointer and keyboard moves within/between collections, including moving
   the last page out and moving back into an empty collection.
3. Add/rename validation, case preservation, alphabetical relocation and
   focus after Enter/Escape. Remove a nonempty collection and confirm that
   its pages remain pinned at the end of the loose list.
4. Rust Book and Cargo navigation: previews appear within the proper span;
   pinning does not move known pages. Section titles cannot collapse or edit.
5. Original Rust crates: alphabetical pages and naturally interleaved
   previews remain unchanged. Check normal, narrow and reduced-motion UI.

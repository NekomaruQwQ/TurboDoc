# M5: General Documentation Provider

## Summary

TurboDoc's second provider renders a small, code-owned catalog of general
documentation sites. Unlike Rust symbols, a site's pinned pages preserve the
user's reading order and can be rearranged directly with a drag handle.

> **Historical milestone:** this file records the initial singleton `doc`
> implementation. The current architecture exposes the same behavior through
> `createDocProvider(config)` and separate Rust Docs, Minecraft Wiki, and
> Wikipedia instances; see `docs/README.md`.

The first catalog contains English Wikipedia, the stable Rust Book, and the
Minecraft Wiki. Each site is one flat Explorer item: TurboDoc intentionally
does not crawl or reproduce the source site's chapter or category hierarchy.

## Design contract

- Provider ID is `doc`; its default landing page is English Wikipedia.
- Supported site origins and Rust Book path aliases are matched structurally,
  never with permissive string prefixes.
- The catalog itself is immutable. Group membership and ordered pinned pages
  remain user-owned data.
- Every item has a fixed, non-pinnable home page followed by ordered pinned
  pages and, when needed, one unpinned preview of the current page.
- A fragment is part of a navigation target but not a second page identity.
  Pinning another section of an existing page therefore does not create a
  duplicate.
- Native navigation reports may switch to the provider that owns a URL, but
  that switch must never cause a second navigation.
- Only pinned pages participate in drag-and-drop. Home and preview rows cannot
  move, and only a valid permutation of the current pinned set is persisted.
- Rust provider pages retain their alphabetical symbol ordering.
- Existing workbench tokens, compact row geometry, keyboard interaction,
  touch interaction, and reduced-motion preferences remain intact.

## Component checklist

- [x] Provider/page ownership and current-page contracts
- [x] Hard-coded documentation site catalog and URL normalization
- [x] Ordered page persistence, pinning, and reorder validation
- [x] Doc provider rendering, search, grouping, and navigation
- [x] Drag-handle page list UI and provider-aware typography
- [x] Native hosted/proxied origin allowlists and spoofing regression tests
- [x] Rustdoc-only theme injection boundaries
- [x] Architecture and user-facing documentation
- [x] Automated verification and browser visual QA

## Verification contract

- frontend Bun unit tests
- `just svc`
- Biome check without applying formatting
- optimized Vite build
- `cargo test --release`
- `cargo clippy --release`
- workbench browser checks for pointer, keyboard, touch-sized controls,
  truncation, preview/current state, drag feedback, and reduced motion
- final `jj diff` and working-copy review

## Implementation notes

This section is updated as each component is completed so the milestone records
the implemented behavior and its verification evidence.

- **Provider contract:** Providers now own URL classification and current-page
  state. Accepted document navigation switches the active provider without
  causing a redundant viewer navigation, and Rust page identity ignores
  section fragments.
- **Doc catalog and state:** The provider exposes Wikipedia, the stable Rust
  Book, and Minecraft Wiki as immutable flat items. URL parsing requires HTTPS,
  exact origins, and a Book-scoped path; the `/book/` alias normalizes to
  `/stable/book/`.
- **Pages:** A site's fixed home is followed by identity-deduplicated pinned
  targets and an optional current-page preview. Pinned targets preserve their
  section fragment, while fragments do not create duplicate page identities.
  Reordering accepts only a complete permutation of the current pinned set.
- **Focused tests:** 25 routing, catalog, identity, page-order, and provider
  rendering tests pass under Bun.
- **Explorer UI:** `svelte-dnd-action` supplies handle-scoped pointer, delayed
  touch, and keyboard sorting. Only the pinned middle block enters its zone;
  the fixed home and italic preview retain stable positions. Provider metadata
  keeps Rust identifiers monospace while Doc names use the workbench UI face.
- **Native boundary:** Wikipedia and Minecraft Wiki use exact separator-ended
  hosted/proxied prefixes. Existing Rust origins were hardened the same way,
  and regression coverage rejects hostname-prefix lookalikes.
- **Injection boundary:** Serve-time dark-mode injection recognizes Rustdoc
  crate paths on `doc.rust-lang.org` instead of the complete origin, leaving
  the Rust Book and Wiki HTML unmodified.
- **Visual pass:** Default and 800×600 browser checks covered the provider rail,
  site search, flat item cards, home-row alignment, focus, and truncation. The
  direct Vite preview produced only its expected provider-data 404 because the
  native host owns application APIs.
- **Verification:** All 162 Bun tests and 69 optimized Rust tests pass;
  `svelte-check` reports zero diagnostics, changed frontend files have no Biome
  findings, the optimized Vite build succeeds at 187.84 KiB gzip, and Clippy
  reports no warnings. A full-tree Biome audit still surfaces three unrelated
  pre-existing style warnings in `localStorage.ts` and Rust page-name parsing.

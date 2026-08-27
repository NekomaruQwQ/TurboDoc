# TurboDoc Milestone Summary

This document records the defining product or architectural change in each
TurboDoc milestone. It is intentionally a map of the project's evolution, not
an exhaustive changelog.

The first generations were named `v0.1`, `v0.2`, and `v0.3` rather than M1,
M2, and M3. The M0–M3 labels below are retrospective so the complete history
can be discussed with one consistent sequence.

## At a glance

> **M0 loads documentation → M1 manages documentation → M2 abstracts
> providers → M3 separates runtime layers → M4 hardens the platform → M5 adds
> general documentation → M6 gives each source suitable page organization →
> M7 makes sources independently reusable and composable.**

| Milestone | Defining change |
|---|---|
| **M0 — Viewer prototype** | Create a native Rust and WebView2 shell that opens supported documentation, intercepts and caches its requests, and sends external links to the system browser. |
| **M1 — Documentation workspace** | Turn the viewer into a persistent docs.rs workbench with crate versions, preview and pinned pages, groups, imports, metadata, and a VS Code-inspired Explorer. |
| **M2 — Provider architecture** | Move documentation-specific rules behind provider-owned view models so the generic Explorer can present docs.rs, Rust standard-library documentation, and windows-docs-rs as one Rust documentation experience. |
| **M3 — Three-layer runtime** | Separate the native host, local backend, and web frontend. Move persistence to REST-style APIs and make the HTTP-aware SQLite cache, stale-while-revalidate behavior, and serve-time document transformation backend responsibilities. |
| **M4 — Platform consolidation and hardening** | Converge on the Rust host, in-process Rust backend, and Svelte 5 frontend used today, then make the platform shippable through static release assets, faster instrumented startup, lazy crate metadata, an audited proxy-header boundary, and semantic component CSS. |
| **M5 — General documentation** | Expand beyond Rust API documentation with the Rust Book, Wikipedia, and Minecraft Wiki. Give each site URL ownership, independent state, ordered pinned pages, and accessible page reordering. |
| **M6 — Source-specific page organization** | Give different documents organization appropriate to their content: editable alphabetical collections for wikis and immutable reading-order section spans for fifteen Rust books. |
| **M7 — Sources, adapters, and topics** | Replace the overloaded provider abstraction with independently persisted Sources, reusable Adapters, compiled SourceModels, ephemeral SourceViews, and UI-only Topics that compose multiple sources. |

## Detailed milestone notes

1. M4 is recorded across [intent-driven crate metadata](M4-LazyFetching.md),
   [proxy response headers](M4-ProxyHeaders.md),
   [semantic frontend styles](M4-SemanticStyles.md), and
   [startup optimization](M4-StartupOptimization.md).
2. M5 is described in [General Documentation Provider](M5-DocProvider.md).
3. M6 is described in
   [Page Organization and the Rust Bookshelf](M6-PageOrganization.md).
4. M7 and the current architecture are described in
   [Source, Adapter, and Topic Architecture](M7-SourceAdapterTopics.md).

For the complete implementation history and current runtime design, see the
[frontend documentation](README.md).

# VS Code Visual Refresh

## Goal

Refresh TurboDoc's frontend chrome to match the compact, panel-based visual
language of current VS Code while preserving the application's provider,
navigation, grouping, and persistence behavior.

## Constraints

- Keep the native Windows title bar so window movement, snapping, resizing, and
  accessibility remain owned by the operating system.
- Reuse Svelte, Tailwind CSS, shadcn-svelte, Lucide, and Paneforge. The refresh
  does not require another dependency.
- Keep the documentation iframe isolated from the surrounding workbench theme.
- Prefer semantic theme tokens over component-specific color literals.
- Keep hot-path rendering unchanged: styling must not introduce observers,
  timers, filters, or continuous animation.

## Component Plan

- [x] Theme foundation — add workbench surfaces, hover/selection states,
  typography, focus treatment, and compact scrollbar styling.
- [x] Workbench shell — replace the placeholder header, frame both panes, and
  retain the existing resizable layout.
- [x] Explorer header — make the panel purpose and active provider explicit.
- [x] Explorer tree — flatten cards into dense hierarchical rows and align
  group, item, page, version, and action states.
- [x] Overlay surfaces — verify existing menus, selects, inputs, and dialogs
  inherit the new tokens cleanly.
- [x] Verification — run Svelte diagnostics, Biome, the frontend test suite,
  and a production build. The desktop sandbox did not expose the launched
  WebView window for automated screenshot inspection.

## Decisions

- The URL display is read-only. Navigation history controls are intentionally
  omitted because the frontend does not own iframe history across origins.
- The activity bar and status bar are omitted until they represent real
  provider switching or status features; inert VS Code chrome would add noise.
- One Dark symbol colors remain unchanged because they encode identifier type,
  not workbench hierarchy.

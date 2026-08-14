# M4: Semantic Frontend Styles

## Summary

TurboDoc's application-owned Svelte markup currently mixes structure,
reactive state, and long Tailwind utility lists. This migration preserves the
existing workbench design while replacing those lists with semantic,
component-owned CSS. Tailwind remains responsible for design-token generation
and the vendored shadcn-svelte primitives.

## Goals

- Keep component markup focused on structure, content, and behavior.
- Name application classes after interface roles rather than declarations.
- Express visual state through ARIA and `data-*` attributes.
- Keep portalled Bits UI surfaces explicitly styled and collision-safe.
- Preserve layout, interaction, accessibility, and reduced-motion behavior.
- Leave generated files under `frontend/3rdparty/shadcn/` unchanged.

## Non-goals

- Redesigning the VS Code-inspired workbench.
- Removing Tailwind or shadcn-svelte.
- Creating a general-purpose styling library.
- Changing provider, persistence, or navigation behavior.

## Styling contract

- Owned DOM uses Svelte-scoped, role-based classes.
- Classes forwarded to child components or portalled content use an
  `explorer-*` or `workbench-*` prefix and `:global(...)` selectors.
- Existing color, font, radius, and surface variables remain the source of
  truth.
- Static presentation belongs in CSS. Runtime provider mask URLs are the only
  permitted data-driven inline style.
- Interactive state uses existing primitive attributes where possible:
  `aria-current`, `aria-expanded`, `aria-invalid`, `data-state`,
  `data-highlighted`, and narrow application-owned `data-*` attributes.

## Component checklist

- [x] Root document and `Icon.svelte`
- [x] `App.svelte`
- [x] `WorkbenchToolbar.svelte`
- [x] `NavBar.svelte`
- [x] `Explorer.svelte`
- [x] `ExplorerSearch.svelte`
- [x] `ExplorerGroup.svelte`
- [x] `ExplorerGroupHeader.svelte`
- [x] `ExplorerCreateGroupComponent.svelte`
- [x] `ExplorerItem.svelte`
- [x] `ExplorerItemMenu.svelte`
- [x] `ExplorerPageList.svelte`
- [x] `InputActionDialog.svelte`
- [x] Architecture documentation and final verification

## Verification contract

- `just svc`
- frontend Bun unit tests
- optimized Vite build
- application-source audit for utility strings and obsolete style helpers
- pointer, keyboard, hoverless, loading, error, menu, dialog, and page-state
  visual checks
- final `jj diff` and working-copy review

## Implementation notes

- **Root document and Icon:** Root viewport ownership moved from utility
  classes in `index.html` to `global.css`. The SVG-mask renderer now keeps
  static layout in component CSS and exposes only its provider-owned URL as a
  CSS custom property.
- **Workbench shell:** The root panes, sidebar, editor placeholder, toolbar,
  and provider rail now use role-based CSS. Provider selection is styled from
  `aria-current`; loading motion retains a reduced-motion fallback.
- **Explorer frame and search:** Search presence is exposed as data rather
  than a padding class branch. The portalled combobox uses namespaced global
  selectors, while highlight, validation, loading, and motion states remain
  owned by primitive or semantic attributes.
- **Explorer groups:** Group layout and control visibility are component CSS.
  Rename/create fields qualify shadcn's stable `data-slot` attributes, and the
  group menu trigger no longer imports runtime Tailwind variants.
- **Explorer items and menus:** Item rows and expansion content now expose
  semantic roles. The portalled item/version menus use namespaced content
  classes, existing shadcn slots, and attribute-driven trigger visibility;
  app code no longer composes `buttonVariants` or `cn`.
- **Pages and input actions:** Current, preview, pinned, and identifier states
  are represented by ARIA or `data-*` attributes. The TypeScript identifier
  color map is gone, and the pin control now exposes its pressed state.
- **Verification:** `svelte-check` reports no diagnostics, all 137 frontend
  tests pass, Biome reports no findings, and the optimized Vite build
  succeeds. Default and 800×600 browser passes covered the workbench, search
  popup, group menu, inline editor, focus treatment, truncation, and loading
  surface. Direct browser execution produced only the expected provider-data
  404 because the native TurboDoc host owns that API.

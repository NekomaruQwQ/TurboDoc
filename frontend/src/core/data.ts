import type { Component } from "svelte";
import type { LucideProps } from "@lucide/svelte";

/** A renderable icon. Monochrome SVGs are treated as masks so provider-owned
 *  brand assets can follow the workbench's current foreground color. */
export type IconProp =
    | { type: "lucide"; icon: Component<LucideProps> }
    | { type: "monochrome-svg"; src: string };

import * as z from "zod";

// ============================================================================
// Data Model — Zod Schemas
//
// These schemas define the serializable data model for the application.
// The types are inferred from the schemas via `z.infer<>`.
//
// Persistence is split into two independent stores:
//   - <provider>.json           — per-provider user data (groups, provider data)
//   - localStorage             — transient UI state (expansion states, current URL)
// ============================================================================

// Per-provider user data. Persisted to `<providerId>.json`.
//
// Does NOT include UI state (expandedItems/expandedGroups) — those live in
// `UiState` instead.
export const providerDataSchema = z.object({
    // Provider-specific data storage. The schema of this field is defined by
    // each provider and is opaque to the app. The app only provides storage and
    // update mechanism for this field.
    data: z.unknown(),

    // Definition of item groups under this provider. For providers that
    // do not support grouping, this field is an empty object.
    //
    // The app manages item grouping for each provider and providers only
    // need to provide a flat list of items in `Provider.render()`.
    //
    // Each group under a provider must have a unique name, serving as the
    // identifier for the group within that provider. Order of groups is
    // managed by the app and is defined by the order of this array.
    //
    // Each group contains a list of item identifiers that belong to that
    // group. An item can only belong to one group at a time.
    //
    // Items that are not listed in any group are considered ungrouped and
    // will be displayed in a default "ungrouped" group at top of all other
    // groups.
    //
    // Order of groups is defined by the `groupOrder` field below.
    //
    // Order of items within each group as well as in the ungrouped group
    // is determined by the `sortKey` field of each item. The order of the
    // `items` array of each group is not preserved.
    groups: z.record(z.string(), z.object({
        // List of item IDs contained in this group.
        items: z.array(z.string()),
    })),

    // Order of groups under this provider.
    groupOrder: z.array(z.string()),
});

export type ProviderData =
    z.infer<typeof providerDataSchema>;

// ============================================================================
// View Model — Manual Interfaces
//
// These types contain callbacks and are never serialized.
// They are derived fresh on every render via `Provider.render()`.
// ============================================================================

/** The uniform interface for documentation providers. */
export interface Provider<T = unknown>
    extends ProviderInfo {
    /** Return whether this provider can render the supplied navigation URL.
     *  Implementations must parse URL structure instead of relying on raw
     *  string prefixes, which can admit lookalike hosts. */
    ownsUrl(url: string): boolean,

    /** Derive a fresh view model from provider-specific data storage.
     *  Called from `ExplorerProvider.svelte` inside a `$derived`, so it
     *  re-runs whenever its dependencies (e.g. `ctx.data`, `ctx.currentUrl`)
     *  change. Must be a pure data derivation — no side effects, no Svelte
     *  runes. Per-provider effects go in `setupEffects` instead. */
    render(provider: ProviderContext<T>): ProviderOutput,

    /** Optional. Called once during `ExplorerProvider`'s component init.
     *  Implementations should use Svelte 5 `$effect` runes inside to wire
     *  up reactive side effects (URL sync, seeding, etc.).
     *  Because this runs synchronously during init, the runes bind to the
     *  host component's lifecycle. The body must therefore live in a
     *  `*.svelte.ts` module so the compiler accepts the rune calls. */
    setupEffects?(provider: ProviderContext<T>): void,
}

/** Metadata about a provider. */
export interface ProviderInfo {
    /** Unique identifier of the provider. */
    readonly id: string,

    /** Display name of the provider. */
    readonly name: string,

    /** Icon shown for this provider in the workbench navigation bar. */
    readonly icon: IconProp,

    /** Landing page opened when the user explicitly switches to this provider. */
    readonly homeUrl: string,

    /** Whether to enable item grouping for this provider. */
    readonly enableItemGrouping: boolean,

    /** Whether to render item names in <code> tags (monospace font). */
    readonly renderItemNameAsCode: boolean,

    /** Whether to render text page names with the workbench's monospace face. */
    readonly renderPageNameAsCode: boolean,
}

export interface ProviderContext<T = unknown> {
    /** Provider-specific data storage, backed by a Svelte 5 `$state` proxy.
     *  Mutate properties directly (e.g. `ctx.data.crates[name] = …`); the
     *  proxy makes all nested mutations reactive automatically — no Immer
     *  draft, no `updateData(updater)` ceremony. */
    readonly data: T,

    /** The current URL being viewed in the app. HTTPS protocol assumed. */
    readonly currentUrl: string,

    /** Navigate the viewer iframe to a URL. The WebView2 host calls the
     *  frontend's `documentNavigationStarted` function in response, which
     *  persists the URL and propagates to all `currentUrl.value` consumers. */
    navigateTo(url: string): void,
}

export type ProviderOutput = {
    items: Record<string, Item>,
    search?: ProviderSearch,
    actions?: ProviderAction[],
};

/** Configuration for the Explorer's provider-agnostic item search.
 *
 *  The Explorer owns prefix matching and recent-item presentation. Providers
 *  own domain wording, item activation, and creation because those operations
 *  depend on provider-specific identifiers and navigation rules. */
export interface ProviderSearch {
    /** Placeholder shown while the editable combobox is empty. */
    placeholder: string,

    /** Item selected by the accepted navigation URL, if that URL belongs to
     *  this provider. The Explorer records this ID in recent-access history
     *  and uses it to reveal navigation-reported pages. */
    activeItemId?: string,

    /** Open an existing item selected from the search results. Missing IDs
     *  must be ignored because items can disappear while the menu is open. */
    selectItem(itemId: string): void,

    /** Build the provider-specific creation action for free-form input.
     *  Return `null` when the input is not a valid identifier. */
    getAddAction(searchText: string): ProviderSearchAction | null,

    /** Guidance shown when input has neither matches nor a valid add action. */
    invalidText: string,

    /** Existing input action offered below recent items when search is empty. */
    emptyAction?: Extract<ProviderAction, { type: "input" }>,
}

/** A provider-specific action rendered as a selectable combobox row. */
export interface ProviderSearchAction {
    /** User-facing action label. */
    name: string,

    /** Icon distinguishing the action from item results. */
    icon: IconProp,

    /** Perform the action represented by the current search text. */
    invoke(): void,
}

/** A provider-level action, rendered by the Explorer above the items list.
 *
 *  - `"input"` — an action that opens a generic dialog with a text field
 *    (or textarea, if `multiline`). The Explorer owns the dialog UI; the
 *    provider supplies labels and the callback that consumes the typed value.
 *  - `"menu"` — a flat menu entry; clicking calls `invoke()`. */
export type ProviderAction =
    | {
        type: "input",
        name: string,
        icon: IconProp,
        dialogTitle: string,
        dialogDescription: string,
        placeholder?: string,
        multiline?: boolean,
        confirmLabel?: string,
        invoke(value: string): void,
    }
    | { type: "menu", name: string, icon: IconProp, invoke(): void };

/** The uniform view model of a documentation item. */
export interface Item {
    /** Unique identifier for the item within its provider. */
    id: string,

    /** Display name of the item. */
    name: string,

    /** Sort key for ordering items within a group. */
    sortKey: string,

    /** List of documentation pages for this item. */
    pages: Page[],

    /** Persist a manually chosen order for the item's pinned pages.
     *  Providers without this callback keep the Explorer's `sortKey` order.
     *  Callers pass page URLs because they are globally unique identities. */
    reorderPages?(orderedUrls: string[]): void,

    /** List of external links for this item. */
    links?: ItemLink[],

    /** List of custom actions for this item. */
    actions?: ItemAction[],

    /** For items that represent a package (or crate, module, etc.), this field
     *  contains the view model of the version menu. **/
    versions?: ItemVersions,
}

export interface ItemLink {
    /** Display name for the action. */
    name: string,

    /** Target URL to open when the action is triggered. HTTPS protocol assumed. */
    url: string,

    /** Icon for the action.
     *  If `undefined`, the default link icon (`faArrowUpRightFromSquare`) is used. */
    icon?: IconProp,

}

/** An action that can be performed on an item, usually shown in the item menu. */
export interface ItemAction {
    /** Display name for the action. */
    name: string,

    /** Icon for the action. */
    icon?: IconProp,

    /** Whether this action is disabled. */
    disabled?: true,

    /** Whether this action is destructive (e.g., delete).
     *  Destructive actions are highlighted in red in the UI. */
    destructive?: true,

    /** Callback when the action is triggered. */
    invoke(): void,
}

/** The view model of the version choices for a package item. */
export interface ItemVersions {
    /** Availability of the menu's remotely discovered choices.
     *
     * `current` remains usable in every state so an offline metadata request
     * never invalidates the persisted workspace selection. */
    status: "idle" | "loading" | "ready" | "error",

    /** Human-readable failure detail when `status` is `"error"`. */
    error?: string,

    /**
     * List of all versions available, grouped by semver compatibility.
     *
     * Each inner array is referred as a version group and contains a group
     * of versions that are semver-compatible with each other.
     *
     * Both outer and inner arrays should be sorted by semver in descending
     * order (newest versions first).
     **/
    all: string[][],

    /** Currently selected version string. */
    current: string,

    /** Preferred versions listed at the menu's first level before overflow. */
    recommended: string[],

    /** Idempotently request lazy choices after the menu observes user intent.
     * Eager/static providers may omit this callback. */
    ensureLoaded?(): void,

    /** Callback to select a version as the current version. */
    setCurrentVersion(version: string): void,
}

/** A documentation page */
export interface Page {
    /** Name of the documentation page */
    name: PageName,

    /** Sort key for ordering pages within an item */
    sortKey: string,

    /** Target URL to navigate to when this page is selected, also used as
     *  the global unique identifier for the page. */
    url: string,

    /** Whether the current accepted navigation belongs to this page. */
    current: boolean,

    /** Whether this page is pinned for quick access, or null if pinning disabled */
    pinned: boolean | null,

    /** Set or unset the pinned status of this page. */
    setPinned(pinned: boolean): void,
}

/** Name of a documentation page */
export type PageName =
    | { type: "text", text: string }
    | { type: "symbol" } & {
        /** Full path to the symbol */
        path: { type: IdentType, name: string }[],

        /** Separator between path segments (e.g., "::" for Rust) */
        separator: string,
    };

/** Type of a language-agnostic identifier */
export type IdentType =
    | "constant"
    | "function"
    | "interface" // trait in Rust.
    | "macro"
    | "namespace" // module in Rust.
    | "type"      // struct or enum in Rust.
    | "unknown";

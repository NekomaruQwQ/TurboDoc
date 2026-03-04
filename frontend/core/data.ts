import type { IconProp as FontAwesomeIconProp } from "@fortawesome/fontawesome-svg-core";
export type IconProp = ReadonlyDeep<
    | { type: "fontawesome"; name: FontAwesomeIconProp }>;

import type { ReadonlyDeep } from "type-fest";
import type { ReactNode } from "react";

import * as z from "zod";

// ============================================================================
// Data Model — Zod Schemas
//
// These schemas define the serializable data model for the application.
// The types are inferred from the schemas via `z.infer<>`.
//
// Persistence is split into three independent files:
//   - workspace.app.json      — global app state (presets)
//   - workspace.<provider>.json — per-provider user data (groups, provider data)
//   - localStorage             — transient UI state (expansion states, current URL)
// ============================================================================

// Global app state. Persisted to `workspace.app.json`.
export const appDataSchema = z.object({
    // Preset definitions. Each preset is a named collection of active
    // providers.
    presets: z.record(z.string(), z.object({
        // List of active provider IDs in this preset.
        providers: z.array(z.string()),
    })),

    // Currently active preset name.
    currentPreset: z.string(),
});

// Per-provider user data. Persisted to `workspace.<providerId>.json`.
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

// Transient UI state. Persisted to localStorage (`turbodoc:ui-state`).
// Keyed by provider ID — each provider's expansion arrays are stored here
// rather than inside ProviderData, so UI state is saved independently.
export const uiStateSchema = z.object({
    // Currently viewed URL. HTTPS protocol assumed.
    currentUrl: z.string(),

    // Per-provider list of item IDs that are expanded in the UI.
    expandedItems: z.record(z.string(), z.array(z.string())),

    // Per-provider list of group names that are expanded in the UI.
    expandedGroups: z.record(z.string(), z.array(z.string())),
});

export type AppData =
    z.infer<typeof appDataSchema>;
export type ProviderData =
    z.infer<typeof providerDataSchema>;
export type UiState =
    z.infer<typeof uiStateSchema>;

// ============================================================================
// View Model — Manual Interfaces
//
// These types contain callbacks and are never serialized.
// They are derived fresh on every render via `Provider.render()`.
// ============================================================================

/** The uniform interface for documentation providers. */
export interface Provider<T = unknown, TCache = unknown>
    extends ProviderInfo {
    /** Render a full view model from provider-specific data storage. */
    render(provider: ProviderContext<T, TCache>): ProviderOutput,
}

/** Metadata about a provider. */
export interface ProviderInfo {
    /** Unique identifier of the provider. */
    readonly id: string,

    /** Display name of the provider. */
    readonly name: string,

    /** Whether to enable item grouping for this provider. */
    readonly enableItemGrouping: boolean,

    /** Whether to render item names in <code> tags (monospace font). */
    readonly renderItemNameAsCode: boolean,
}

export interface ProviderContext<T = unknown, TCache = unknown> {
    /** Provider-specific data storage. */
    readonly data: T,

    /** Update the provider-specific data storage. */
    updateData(updater: (draft: T) => void): void,

    /** Provider-specific cache storage. */
    readonly cache: TCache,

    /** Update the provider-specific cache storage. */
    updateCache(updater: (draft: TCache) => void): void,

    /** The current URL being viewed in the app. HTTPS protocol assumed. */
    readonly currentUrl: string,

    /** Record a URL as the current URL without navigating the iframe.
     *  Use for state-only updates (e.g., URL normalization, WebView2 events). */
    setCurrentUrl(url: string): void,

    /** Navigate the viewer iframe to a URL and record it as the current URL.
     *  Use when the iframe should actually load new content (e.g., version
     *  change, sidebar page click). */
    navigateTo(url: string): void,
}

export type ProviderOutput = ReadonlyDeep<{
    items: Record<string, Item>,
    actions?: ProviderAction[],
}>;

export type ProviderAction =
    | { type: "node", render(): ReactNode }
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

    /** List of external links for this item. */
    links?: ItemLink[],

    /** List of custom actions for this item. */
    actions?: ItemAction[],

    /** For items that represents a package (or crate, module, etc.), this field
     *  contains the view model of the version selector. **/
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

/** The view model of the version selector for a package item. */
export interface ItemVersions {
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

    /** List of versions that are listed in the version selector combobox. */
    recommended: string[],

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

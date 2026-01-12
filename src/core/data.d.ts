import type { IconProp } from "@fortawesome/fontawesome-svg-core";
export type Icon =
    | { type: "fontawesome"; icon: IconProp }

import type { ReadonlyDeep } from "type-fest";

/** The root data model for the application. */
export interface Workspace {
    app: {
        /** Preset definitions. */
        presets: Preset[],

        /** Currently active preset name. */
        currentPreset: string,

        /** Currently viewed URL. HTTPS protocol assumed. */
        currentUrl: string,
    },
    providers: Record<string,{
        /** Provider-specific data storage. */
        data: unknown,

        /**
         * Definition of item groups under this provider. For providers that
         * do not support grouping, this field is an empty array.
         *
         * The app manages item grouping for each provider and providers only
         * need to provide a flat list of items in `Provider.render()`.
         *
         * Each group under a provider must have a unique name. Order of groups
         * is managed by the app and defined here.
         *
         * Each group contains a list of item identifiers that belong to that
         * group. An item can only belong to one group at a time.
         *
         * Items that are not listed in any group are considered ungrouped and
         * will be displayed in a default "ungrouped" group at top of all other
         * groups.
         *
         * Order of groups is defined by this array and is managed by the app.
         * Order of items within each group as well as in the ungrouped group
         * is determined by the `sortKey` field of each item. The order of the
         * `items` array of each group is not preserved.
         **/
        groups: {
            /** Name of the group */
            name: string,

            /** List of item IDs in this group */
            items: string[],

            /** Whether the group is expanded in the UI */
            expanded: boolean,
        }[],

        /** List of item IDs that are expanded in the UI. */
        expandedItems: string[],
    }>,
}

/** The preset data model, also used as view model. */
export interface Preset {
    /** Name of the preset. */
    name: string,

    /** List of active provider IDs in this preset. */
    providers: string[],
}

export interface Cache {
    providers: Record<string, unknown>,
}

/** The uniform interface for documentation providers. */
export interface Provider<T = unknown, TCache = unknown> {
    /** Unique identifier of the provider. */
    readonly id: string,

    /** Display name of the provider. */
    readonly name: string,

    /** Whether to enable item grouping for this provider. */
    readonly enableItemGrouping: boolean,

    /** Whether to render item names in <code> tags (monospace font). */
    readonly renderItemNameAsCode: boolean,

    /** Render a full view model from provider-specific data storage. */
    render(provider: ProviderContext<T, TCache>): ProviderOutput,

    /** Import an item from a user input string into the provider-specific data storage. */
    importItem?(provider: ProviderContext<T, TCache>, input: string):
        | { readonly success: true }
        | { readonly success: false, readonly message: string },
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

    /** Set the current URL being viewed in the app. HTTPS protocol assumed. */
    setCurrentUrl(url: string): void,
}

export type ProviderOutput = ReadonlyDeep<{
    items: Item[],
}>;

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

    /** List of custom actions for this item. */
    actions: ItemAction[],

    /**
     * For items that represents a package (or crate, module, etc.), this field
     * contains the view model of the version selector.
     *
     * For other items, this field is null.
     **/
    versionSelectorProps: ItemVersionSelectorProps | null,
}

/** An action that can be performed on an item, usually shown in the item menu. */
export interface ItemAction {
    /** Display name for the action. */
    name: string,

    /** Icon for the action. */
    icon: Icon,

    /** Callback when the action is triggered. */
    invoke(): void,
}

/** The view model of the version selector for a package item. */
export interface ItemVersionSelectorProps {
    /** Currently selected version string. */
    current: string,

    /** List of versions that are listed in the version selector combobox. */
    recommended: string[],

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

    /** Callback to select a version as the current version. */
    select(version: string): void,
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
type IdentType =
    | "constant"
    | "function"
    | "interface" // trait in Rust.
    | "macro"
    | "namespace" // module in Rust.
    | "type"      // struct or enum in Rust.
    | "unknown";

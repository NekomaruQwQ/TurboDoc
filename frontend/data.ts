import type { ReadonlyDeep } from "type-fest";

export interface Expandable { expanded: boolean }

export interface Workspace {
    /** Named groups of crates */
    groups: Group[];
    /** Ungrouped items (displayed at top, simpler than a full Group) */
    ungrouped: Item[];
    /** Currently active documentation page */
    currentPage: Page;
}

export type Group =
    Expandable & { name: string, items: Item[] }

export type Page =
    | PageUnknown
    | PageCrate;

export interface PageUnknown {
    type: "unknown",
    url: string,
}

export interface PageCrate {
    type: "crate",
    crateName: string,
    crateVersion: string,
    pathSegments: string[],
}

export function parseUrl(url: string): Page {
    if (url.startsWith("https://docs.rs/")) {
        const urlPath = url.substring("https://docs.rs/".length);
        const [
            crateName,
            crateVersionOrUndefined,
            ...pathSegments
        ] = urlPath.split("/");

        if (crateName)
            return {
                type: "crate",
                crateName,
                crateVersion: crateVersionOrUndefined ?? "latest",
                pathSegments,
            };
    }

    return { type: "unknown", url };
}

export function buildUrl(page: ReadonlyDeep<Page>): string {
    switch (page.type) {
        case "unknown":
            return page.url;
        case "crate":
            return `https://docs.rs/${page.crateName}/${page.crateVersion}/${page.pathSegments.join("/")}`;
    }
}

export type Item =
    Expandable & (
        | { type: "crate", data: ItemCrate });

export interface ItemCrate {
    /** Name of the crate. */
    name: string;

    /**
     * List of pinned docs.rs pages.
     *
     * Each entry is a relative path (e.g., "glam/struct.Vec3.html").
     * The full URL can be constructed as:
     * `https://docs.rs/{crate_name}/{version}/{path}`.
     **/
    pinnedPages: string[];

    /** Currently selected version */
    currentVersion: string;
}

// ==================== Cache ====================

/**
 * Cache file structure (cache.json).
 * Contains cached API data separate from user workspace data.
 */
export interface Cache {
    /** Flat map of crate caches, keyed by crate name for O(1) lookup */
    crates: Record<string, CrateCache>;
}

/**
 * Cached crate metadata from crates.io.
 * Stored separately from workspace to enable independent cache management.
 */
export interface CrateCache {
    /** Timestamp when this cache entry was last updated */
    lastFetched: number;
    /** Name of the crate (for validation) */
    name: string;
    /** Full version list fetched from crates.io API */
    versions: CrateVersion[];
    /** Grouped versions for display */
    versionGroups: { latest: string, versions: CrateVersion[] }[];
    /** Homepage URL */
    homepage: string | null;
    /** Repository URL */
    repository: string | null;
    /** Documentation URL (might differ from docs.rs) */
    documentation: string | null;
}

export interface CrateVersion {
    /** Version number (e.g., "0.10.1") */
    num: string;
    /** Whether this version is yanked */
    yanked: boolean;
}

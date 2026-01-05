interface Expandable { expanded: boolean }

export interface Workspace {
    /** Named groups of crates */
    groups: Group[];
    /** Ungrouped items (displayed at top, simpler than a full Group) */
    ungrouped: Item[];
}

export type Group =
    Expandable & { name: string, items: Item[] }

export type Item =
    Expandable & (
        | { type: 'crate', data: ItemCrate });

export interface ItemCrate {
    /** Name of the crate */
    name: string;
    /** List of pinned docs.rs pages */
    pinnedPages: CratePage[];
    /** Currently opened docs.rs page (may or may not be pinned) */
    currentPage: CratePage | null;
    /** Currently selected version */
    currentVersion: string;
}

export interface CratePage {
    /**
     * The relative path (e.g., 'struct.Vec3.html') of the page.
     * 
     * The full URL of the page can be constructed as
     * `https://docs.rs/{crate_name}/{version}/{path}`.
     **/
    path: string;

    /** Whether this page is pinned */
    pinned: boolean;
}

// ==================== Cache ====================

/**
 * Cache file structure (cache.json).
 * Contains cached API data separate from user workspace data.
 */
export interface Cache {
    /** Flat map of crate caches, keyed by crate name for O(1) lookup */
    crates: Record<string, CrateInfo>;
}

/**
 * Cached crate metadata from crates.io.
 * Stored separately from workspace to enable independent cache management.
 */
export interface CrateInfo {
    /** Name of the crate (for validation) */
    name: string;
    /** Full version list fetched from crates.io API */
    versions: CrateVersion[];
    /** Grouped versions for display */
    versionGroups: { latest: string, versions: CrateVersion[] }[];
    /** Links fetched from crates.io API */
    links: CrateLinks;
    /** Timestamp when this cache entry was last updated */
    lastFetched: number;
}

export interface CrateVersion {
    /** Version number (e.g., '0.10.1') */
    num: string;
    /** Whether this version is yanked */
    yanked: boolean;
}

export interface CrateLinks {
    /** Repository URL */
    repository: string | null;
    /** Homepage URL */
    homepage: string | null;
    /** Documentation URL (might differ from docs.rs) */
    documentation: string | null;
}

export interface Workspace {
    /** Named groups of crates */
    groups: Group[];
    /** Ungrouped crates (displayed at top, simpler than a full Group) */
    ungrouped: ItemCrate[];
}

export interface Group {
    name: string;
    items: Item[];
    isExpanded: boolean;
}

export type Item =
    | { type: "crate", data: ItemCrate };

export interface ItemCrate {
    /** Name of the crate */
    name: string;
    /** Optional links fetched from crates.io API */
    links?: CrateLinks;
    /** Whether the crate card is expanded in the UI */
    isExpanded: boolean;

    /** Full version list fetched from crates.io, sorted from newest to oldest. */
    versions: CrateVersion[];
    /** Grouped versions for display */
    versionGroups: { latest: string, versions: CrateVersion[] }[];
    /** Currently selected version */
    currentVersion: string;

    /** List of pinned docs.rs pages */
    pinnedPages: CratePage[];
    /** Currently opened docs.rs page (may or may not be pinned) */
    currentPage: CratePage | null;
}

export interface CrateVersion {
    /** Version number (e.g., "0.10.1") */
    num: string;
    /** Whether this version is yanked */
    yanked: boolean;
}

export interface CrateLinks {
    /** Repository URL */
    repository?: string;
    /** Homepage URL */
    homepage?: string;
    /** Documentation URL (might differ from docs.rs) */
    documentation?: string;
    /** Timestamp when metadata was fetched (for cache invalidation) */
    fetchedAt: number;
}

export interface CratePage {
    /**
     * The relative path (e.g., "struct.Vec3.html") of the page.
     * 
     * The full URL of the page can be constructed as:
     *     `https://docs.rs/{crate_name}/{version}/{path}`
     **/
    path: string;

    /** Whether this page is pinned */
    pinned: boolean;
}

import type { RustBookPagePlacement } from "@/adapters/rust-book/page-sections";

/** A published outline entry, retained in depth-first reading order. */
export interface BookOutlineEntry {
    /** Relative HTML path within the canonical book root. */
    path: string;
    /** Source title, used only for section ancestry and provenance. */
    title: string;
    /** Ancestor headings, without redundant numerical TOC markers. */
    ancestors: string[];
}

/** Checked-in navigation metadata, never full book contents. */
export interface BookOutlineSnapshot {
    /** Exact published table of contents used by the refresh. */
    sourceUrl: string;
    /** ISO timestamp of the explicit development-time refresh. */
    retrievedAt: string;
    /** Ordered structural metadata; duplicate paths are invalid. */
    entries: BookOutlineEntry[];
}

/** Compile once per used book; repeated ancestry creates distinct spans.
 * This index is immutable shared metadata, not source persistence or DOM. */
export function compileBookOutline(
    entries: readonly BookOutlineEntry[]): ReadonlyMap<string, RustBookPagePlacement> {
    const placements = new Map<string, RustBookPagePlacement>();
    let lastAncestry: string | undefined;
    let span = 0;
    for (const [order, entry] of entries.entries()) {
        const ancestry = JSON.stringify(entry.ancestors);
        if (ancestry !== lastAncestry) span++;
        placements.set(entry.path, {
            spanId: String(span),
            titlePath: entry.ancestors.length ? entry.ancestors : undefined,
            order,
        });
        lastAncestry = ancestry;
    }
    return placements;
}

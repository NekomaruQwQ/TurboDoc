import type { Page, PageBlock, PageLayout } from "@/core/explorer";

/** Placement in an adapter-owned contiguous reading-order span. */
export interface RustBookPagePlacement {
    /** Stable span ID, not merely the heading text (which can recur). */
    spanId: string;
    /** Ancestor titles, absent for a naturally unsectioned span. */
    titlePath?: readonly string[];
    /** Global reading-order rank, independent of the displayed page name. */
    order: number;
}

/** Insert pins and previews with identical placement semantics. Unknown pages
 * remain loose, with the preview last, while known untitled spans stay in situ. */
export function createSectionLayout(
    pages: readonly Page[],
    resolve: (url: URL) => RustBookPagePlacement | null): PageLayout {
    const loose: Page[] = [];
    const placed: { page: Page; placement: RustBookPagePlacement }[] = [];
    for (const page of pages) {
        if (page.pinned === null) continue;
        let placement: RustBookPagePlacement | null = null;
        try {
            const candidate = resolve(new URL(page.url));
            if (candidate && typeof candidate.spanId === "string" && candidate.spanId &&
                Number.isFinite(candidate.order) &&
                (candidate.titlePath === undefined || (Array.isArray(candidate.titlePath) &&
                    candidate.titlePath.every(part => typeof part === "string" && part.trim()))))
                placement = candidate;
        } catch {
            // Code-owned metadata can lag the site; retain navigation and pins.
        }
        if (placement) placed.push({ page, placement });
        else loose.push(page);
    }
    placed.sort((a, b) => a.placement.order - b.placement.order || a.page.url.localeCompare(b.page.url));
    const blocks: PageBlock[] = [
        { id: "home", pageUrls: pages.filter(page => page.pinned === null).map(page => page.url) },
        { id: "", pageUrls: loose.sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(page => page.url) },
    ];
    let previousSpan: string | undefined;
    let urls: string[] = [];
    for (const { page, placement } of placed) {
        if (placement.spanId !== previousSpan) {
            urls = [];
            blocks.push({
                id: `span:${placement.spanId}:${placement.order}`,
                titlePath: placement.titlePath,
                pageUrls: urls,
            });
            previousSpan = placement.spanId;
        }
        urls.push(page.url);
    }
    return { blocks };
}

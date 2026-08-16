import { getDocPageIdentity, parseDocPageTarget } from "./sites";

/** Retain valid, unique pages belonging to one site in their persisted order.
 * Home is excluded because it is a fixed row owned by the provider. */
export function normalizePinnedPages(
    siteId: string,
    homeUrl: string,
    pages: readonly string[]): string[] {
    const homeIdentity = getDocPageIdentity(homeUrl);
    const identities = new Set<string>();
    const normalized: string[] = [];

    for (const page of pages) {
        const target = parseDocPageTarget(page);
        const identity = getDocPageIdentity(page);
        if (!target || target.site.id !== siteId || !identity ||
            identity === homeIdentity || identities.has(identity)) continue;
        identities.add(identity);
        normalized.push(target.url);
    }

    return normalized;
}

/** Validate and apply an ordered URL permutation.
 *
 * Returning `null` rejects stale drag events, duplicates, foreign pages, and
 * partial lists instead of silently dropping persisted user data.
 */
export function reorderPinnedPages(
    current: readonly string[],
    orderedUrls: readonly string[]): string[] | null {
    if (current.length !== orderedUrls.length) return null;

    const currentByIdentity = new Map<string, string>();
    for (const page of current) {
        const identity = getDocPageIdentity(page);
        if (!identity || currentByIdentity.has(identity)) return null;
        currentByIdentity.set(identity, page);
    }

    const reordered: string[] = [];
    for (const requested of orderedUrls) {
        const identity = getDocPageIdentity(requested);
        if (!identity) return null;
        const page = currentByIdentity.get(identity);
        if (!page) return null;
        reordered.push(page);
        currentByIdentity.delete(identity);
    }

    return currentByIdentity.size === 0 ? reordered : null;
}

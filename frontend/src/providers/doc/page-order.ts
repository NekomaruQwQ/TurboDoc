/** Canonical page information required by ordering and persistence logic. */
export interface ResolvedDocPage {
    /** Stable site identifier within the owning Doc provider. */
    readonly siteId: string;

    /** Canonical absolute navigation target, including any useful fragment. */
    readonly url: string;

    /** Stable identity used to deduplicate and reorder pages. */
    readonly identity: string;
}

/** Resolve a raw navigation target against one Doc provider's site catalog. */
export type ResolveDocPage = (input: string) => ResolvedDocPage | null;

/** Retain valid, unique pages belonging to one site in their persisted order.
 * Home is excluded because it is a fixed row owned by the provider. */
export function normalizePinnedPages(
    siteId: string,
    homeIdentity: string,
    pages: readonly string[],
    resolvePage: ResolveDocPage): string[] {
    const identities = new Set<string>();
    const normalized: string[] = [];

    for (const page of pages) {
        const target = resolvePage(page);
        if (!target || target.siteId !== siteId ||
            target.identity === homeIdentity ||
            identities.has(target.identity)) continue;
        identities.add(target.identity);
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
    orderedUrls: readonly string[],
    resolvePage: ResolveDocPage): string[] | null {
    if (current.length !== orderedUrls.length) return null;

    const currentByIdentity = new Map<string, string>();
    let siteId: string | undefined;
    for (const page of current) {
        const target = resolvePage(page);
        siteId ??= target?.siteId;
        if (!target || target.siteId !== siteId ||
            currentByIdentity.has(target.identity)) return null;
        currentByIdentity.set(target.identity, page);
    }

    const reordered: string[] = [];
    for (const requested of orderedUrls) {
        const target = resolvePage(requested);
        if (!target || target.siteId !== siteId) return null;
        const page = currentByIdentity.get(target.identity);
        if (!page) return null;
        reordered.push(page);
        currentByIdentity.delete(target.identity);
    }

    return currentByIdentity.size === 0 ? reordered : null;
}

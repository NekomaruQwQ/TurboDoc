/** Canonical page information required by ordering and persistence logic. */
export interface ResolvedSourcePage {
    /** Stable ID of the independently persisted source. */
    readonly sourceId: string;

    /** Canonical absolute navigation target, including any useful fragment. */
    readonly url: string;

    /** Stable identity used to deduplicate and reorder pages. */
    readonly identity: string;
}

/** Resolve a raw navigation target against one compiled source. */
export type ResolveSourcePage = (input: string) => ResolvedSourcePage | null;

/** Retain valid, unique pages belonging to one site in their persisted order.
 * Home is excluded because it is a fixed row owned by the adapter. */
export function normalizePinnedPages(
    sourceId: string,
    homeIdentity: string,
    pages: unknown,
    resolvePage: ResolveSourcePage): string[] {
    if (!Array.isArray(pages)) return [];
    const identities = new Set<string>();
    const normalized: string[] = [];

    for (const page of pages) {
        if (typeof page !== "string") continue;
        const target = resolvePage(page);
        if (!target || target.sourceId !== sourceId ||
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
    resolvePage: ResolveSourcePage): string[] | null {
    if (current.length !== orderedUrls.length) return null;

    const currentByIdentity = new Map<string, string>();
    let sourceId: string | undefined;
    for (const page of current) {
        const target = resolvePage(page);
        sourceId ??= target?.sourceId;
        if (!target || target.sourceId !== sourceId ||
            currentByIdentity.has(target.identity)) return null;
        currentByIdentity.set(target.identity, page);
    }

    const reordered: string[] = [];
    for (const requested of orderedUrls) {
        const target = resolvePage(requested);
        if (!target || target.sourceId !== sourceId) return null;
        const page = currentByIdentity.get(target.identity);
        if (!page) return null;
        reordered.push(page);
        currentByIdentity.delete(target.identity);
    }

    return currentByIdentity.size === 0 ? reordered : null;
}

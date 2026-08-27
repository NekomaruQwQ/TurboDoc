/** Maximum number of item rows shown by either search or recent history. */
export const ITEM_SEARCH_RESULT_LIMIT = 5;

/** Minimal view shape needed by rune-independent search algorithms. */
export interface SearchableItem {
    /** User-facing item name. */
    name: string;
    /** Stable topic-composed ordering key. */
    sortKey: string;
}

/** One item prepared for repeated case-insensitive prefix comparisons. */
export interface IndexedItem<
    T extends SearchableItem = SearchableItem,
    K extends string = string,
> {
    /** Topic-global composite item identifier. */
    id: K,

    /** Uniform item view model rendered elsewhere in the Explorer. */
    item: T,

    /** Lower-cased item name cached outside the per-keystroke hot path. */
    normalizedName: string,
}

/** Immutable lookup structures rebuilt only when composed topic items change. */
export interface ItemSearchIndex<
    T extends SearchableItem = SearchableItem,
    K extends string = string,
> {
    /** Items in deterministic topic/source-defined order. */
    sorted: readonly IndexedItem<T, K>[],

    /** Item lookup used to preserve MRU order for an empty search. */
    byId: ReadonlyMap<K, IndexedItem<T, K>>,
}

/** Normalize surrounding whitespace and case for matching while leaving the
 *  visible input untouched. Locale-independent casing keeps ASCII-like
 *  source identifiers deterministic across user environments. */
export function normalizeItemSearchText(searchText: string): string {
    return searchText.trim().toLowerCase();
}

/** Build the stable, normalized item index consumed by the combobox.
 *  `sortKey` is the same ordering contract used by normal Explorer groups;
 *  `id` breaks rare ties without relying on object insertion order. */
export function buildItemSearchIndex<
    T extends SearchableItem,
    K extends string = string,
>(items: Record<K, T>): ItemSearchIndex<T, K> {
    const entries = Object.entries(items) as [K, T][];
    const sorted = entries
        .map(([id, item]): IndexedItem<T, K> => ({
            id,
            item,
            normalizedName: normalizeItemSearchText(item.name),
        }))
        .sort((a, b) =>
            a.item.sortKey.localeCompare(b.item.sortKey) ||
            a.id.localeCompare(b.id));
    return {
        sorted,
        byId: new Map(sorted.map(entry => [entry.id, entry])),
    };
}

/** Find at most five case-insensitive prefix matches. Empty input deliberately
 *  returns no name matches because the combobox uses its MRU path instead. */
export function findPrefixItems<T extends SearchableItem, K extends string>(
    index: ItemSearchIndex<T, K>,
    searchText: string): readonly IndexedItem<T, K>[] {
    const normalizedText = normalizeItemSearchText(searchText);
    if (!normalizedText) return [];

    const matches: IndexedItem<T, K>[] = [];
    for (const entry of index.sorted) {
        if (!entry.normalizedName.startsWith(normalizedText)) continue;
        matches.push(entry);
        if (matches.length === ITEM_SEARCH_RESULT_LIMIT) break;
    }
    return matches;
}

/** Resolve an exact case-insensitive match so an existing item never receives
 *  a duplicate Add action. */
export function findExactItem<T extends SearchableItem, K extends string>(
    index: ItemSearchIndex<T, K>,
    searchText: string): IndexedItem<T, K> | undefined {
    const normalizedText = normalizeItemSearchText(searchText);
    if (!normalizedText) return undefined;
    return index.sorted.find(entry => entry.normalizedName === normalizedText);
}

/** Resolve recent IDs without re-sorting them. Deleted, duplicate, or otherwise
 *  stale IDs are skipped, and the visible list remains bounded even if stored
 *  data came from a newer or corrupted client. */
export function resolveRecentItems<T extends SearchableItem, K extends string>(
    index: ItemSearchIndex<T, K>,
    recentItemIds: readonly K[]): readonly IndexedItem<T, K>[] {
    const items: IndexedItem<T, K>[] = [];
    const seen = new Set<K>();
    for (const id of recentItemIds) {
        if (seen.has(id)) continue;
        const entry = index.byId.get(id);
        if (!entry) continue;
        seen.add(id);
        items.push(entry);
        if (items.length === ITEM_SEARCH_RESULT_LIMIT) break;
    }
    return items;
}

/** Move one accessed item to the front of an MRU list, removing duplicates and
 *  retaining only the five entries the empty combobox can display. Returns the
 *  original array when it is already canonical to avoid reactive write loops. */
export function recordRecentItemId(
    recentItemIds: readonly string[],
    itemId: string): readonly string[] {
    const next = [
        itemId,
        ...new Set(recentItemIds.filter(id => id !== itemId)),
    ].slice(0, ITEM_SEARCH_RESULT_LIMIT);
    if (next.length === recentItemIds.length &&
        next.every((id, index) => id === recentItemIds[index])) return recentItemIds;
    return next;
}

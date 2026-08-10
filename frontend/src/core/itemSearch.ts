import type { Item } from "@/core/data";

/** Maximum number of item rows shown by either search or recent history. */
export const ITEM_SEARCH_RESULT_LIMIT = 5;

/** One item prepared for repeated case-insensitive prefix comparisons. */
export interface IndexedItem {
    /** Provider-local item identifier. */
    id: string,

    /** Uniform item view model rendered elsewhere in the Explorer. */
    item: Item,

    /** Lower-cased item name cached outside the per-keystroke hot path. */
    normalizedName: string,
}

/** Immutable lookup structures rebuilt only when provider items change. */
export interface ItemSearchIndex {
    /** Items in deterministic provider-defined order. */
    sorted: readonly IndexedItem[],

    /** Item lookup used to preserve MRU order for an empty search. */
    byId: ReadonlyMap<string, IndexedItem>,
}

/** Normalize surrounding whitespace and case for matching while leaving the
 *  visible input untouched. Locale-independent casing keeps ASCII-like
 *  provider identifiers deterministic across user environments. */
export function normalizeItemSearchText(searchText: string): string {
    return searchText.trim().toLowerCase();
}

/** Build the stable, normalized item index consumed by the combobox.
 *  `sortKey` is the same ordering contract used by normal Explorer groups;
 *  `id` breaks rare ties without relying on object insertion order. */
export function buildItemSearchIndex(items: Record<string, Item>): ItemSearchIndex {
    const sorted = Object.entries(items)
        .map(([id, item]): IndexedItem => ({
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
export function findPrefixItems(
    index: ItemSearchIndex,
    searchText: string): readonly IndexedItem[] {
    const normalizedText = normalizeItemSearchText(searchText);
    if (!normalizedText) return [];

    const matches: IndexedItem[] = [];
    for (const entry of index.sorted) {
        if (!entry.normalizedName.startsWith(normalizedText)) continue;
        matches.push(entry);
        if (matches.length === ITEM_SEARCH_RESULT_LIMIT) break;
    }
    return matches;
}

/** Resolve an exact case-insensitive match so an existing item never receives
 *  a duplicate Add action. */
export function findExactItem(
    index: ItemSearchIndex,
    searchText: string): IndexedItem | undefined {
    const normalizedText = normalizeItemSearchText(searchText);
    if (!normalizedText) return undefined;
    return index.sorted.find(entry => entry.normalizedName === normalizedText);
}

/** Resolve recent IDs without re-sorting them. Deleted, duplicate, or otherwise
 *  stale IDs are skipped, and the visible list remains bounded even if stored
 *  data came from a newer or corrupted client. */
export function resolveRecentItems(
    index: ItemSearchIndex,
    recentItemIds: readonly string[]): readonly IndexedItem[] {
    const items: IndexedItem[] = [];
    const seen = new Set<string>();
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

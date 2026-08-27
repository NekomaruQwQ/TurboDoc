/** A globally unique Explorer item identity.
 *
 * Source-local IDs remain adapter-owned. The Explorer persists only this
 * composite form so items from independently compiled sources cannot collide.
 */
export type ItemKey = string & { readonly __itemKey: unique symbol };

/** Combine a source ID and its local item ID into one reversible key.
 *
 * URI component escaping keeps the separator unambiguous even when an adapter
 * accepts punctuation in its own item identifiers.
 */
export function createItemKey(sourceId: string, localItemId: string): ItemKey {
    if (!sourceId || !localItemId) {
        throw new Error("Composite item keys require nonempty source and local IDs.");
    }
    return `${encodeURIComponent(sourceId)}:${encodeURIComponent(localItemId)}` as ItemKey;
}

/** Split a canonical composite item key.
 *
 * Malformed escapes, missing components, and non-canonical spellings return
 * `null`; callers can then preserve unknown persisted data without guessing
 * which source owns it.
 */
export function parseItemKey(
    value: string,
): { sourceId: string; localItemId: string } | null {
    const separator = value.indexOf(":");
    if (separator <= 0 || separator === value.length - 1) return null;

    try {
        const sourceId = decodeURIComponent(value.slice(0, separator));
        const localItemId = decodeURIComponent(value.slice(separator + 1));
        if (!sourceId || !localItemId) return null;
        if (createItemKey(sourceId, localItemId) !== value) return null;
        return { sourceId, localItemId };
    } catch {
        return null;
    }
}

/** Narrow an untrusted string after verifying its canonical composite form. */
export function isItemKey(value: string): value is ItemKey {
    return parseItemKey(value) !== null;
}

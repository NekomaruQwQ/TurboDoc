import { createSubscriber } from "svelte/reactivity";
import * as storage from "@/core/localStorage";
import { isItemKey, type ItemKey } from "@/core/itemKey";
import { recordRecentItemId } from "@/core/itemSearch";

// ============================================================================
// Reactive bridges over the mitt event bus exposed by localStorage.ts.
//
// Each accessor uses `createSubscriber` to register a fine-grained dependency
// when its `value` getter is read. The first read inside a component
// subscribes to the relevant mitt event; the last reader unsubscribing tears
// the listener down. This is the Svelte 5 analog of React's
// `useSyncExternalStore`, but without the per-component subscribe/snapshot
// boilerplate.
// ============================================================================

// -- currentUrl: a singleton primitive ----------------------------------------

let currentUrlCache = storage.load("currentUrl");
const subscribeCurrentUrl = createSubscriber(update => {
    const handler = (ev: { value: string }) => {
        currentUrlCache = ev.value;
        update();
    };
    storage.on("currentUrl", handler);
    return () => storage.off("currentUrl", handler);
});

export const currentUrl = {
    get value() {
        subscribeCurrentUrl();
        return currentUrlCache;
    },
    set value(v: string) {
        // The "currentUrl" mitt event handler above will refresh the cache
        // and notify other readers; no need to write `currentUrlCache = v`
        // here directly.
        storage.save("currentUrl", v);
    },
};

// -- recentItems: topic-keyed composite item identifiers ---------------------

let recentItemsCache = storage.load("recentItems");
const subscribeRecentItems = createSubscriber(update => {
    const handler = (ev: { value: Record<string, string[]> }) => {
        recentItemsCache = ev.value;
        update();
    };
    storage.on("recentItems", handler);
    return () => storage.off("recentItems", handler);
});

/** Read the five most recently accessed item keys for one topic. The result
 *  is reactive when called inside a Svelte component or derived expression. */
export function recentlyAccessedItemIds(topicId: string): readonly ItemKey[] {
    subscribeRecentItems();
    return (recentItemsCache[topicId] ?? []).filter(isItemKey);
}

/** Record an accepted topic item navigation. Repeated access moves the item
 *  to the front; a no-op canonical list performs no localStorage write. */
export function recordItemAccess(topicId: string, itemId: ItemKey): void {
    const previous = recentItemsCache[topicId] ?? [];
    const next = recordRecentItemId(previous, itemId);
    if (next === previous) return;
    storage.save("recentItems", {
        ...recentItemsCache,
        [topicId]: [...next],
    });
}

// -- expanded: a factory keyed by element id ----------------------------------

/** Reactive accessor for one element of the `expanded` array storage slot.
 *  Membership is checked once at construction; subsequent changes are picked
 *  up via the mitt event filtered by `key`. */
function expanded(key: string) {
    let cache = storage.has("expanded", key);
    const subscribe = createSubscriber(update => {
        const handler = (ev: { element: string; present: boolean }) => {
            if (ev.element === key) {
                cache = ev.present;
                update();
            }
        };
        storage.on("expanded", handler);
        return () => storage.off("expanded", handler);
    });
    return {
        get value(): boolean {
            subscribe();
            return cache;
        },
        set value(v: boolean) {
            if (v) storage.add("expanded", key);
            else storage.remove("expanded", key);
        },
    };
}

/** Expansion state for a named or ungrouped group.
 *  Key format: `<topicId>:group:<groupId>`. */
export const groupExpanded = (topicId: string, groupId: string) =>
    expanded(`${topicId}:group:${groupId}`);

/** Expansion state for an item.
 *  Key format: `<topicId>:item:<compositeItemKey>`. */
export const itemExpanded = (topicId: string, itemId: ItemKey) =>
    expanded(`${topicId}:item:${itemId}`);

// ============================================================================
// Imperative helpers (non-reactive)
//
// These mutate localStorage directly and emit mitt events; any reactive
// accessors that filter for matching keys will pick the change up.
// Useful when you need to mutate expansion state outside of a component
// (e.g., immediately after creating a group).
// ============================================================================

/** Expand a single group. */
export function expandGroup(topicId: string, groupId: string): void {
    storage.add("expanded", `${topicId}:group:${groupId}`);
}

/** Expand multiple items in one write. */
export function expandItems(topicId: string, itemIds: ItemKey[]): void {
    storage.addAll("expanded", itemIds.map(id => `${topicId}:item:${id}`));
}

/** Collapse multiple items in one write. */
export function collapseItems(topicId: string, itemIds: ItemKey[]): void {
    storage.removeAll("expanded", itemIds.map(id => `${topicId}:item:${id}`));
}

/** Remove a deleted group's expansion state. */
export function removeGroup(topicId: string, groupId: string): void {
    storage.remove("expanded", `${topicId}:group:${groupId}`);
}

/** Transfer a group's expansion state from old name to new name. */
export function renameGroup(topicId: string, oldName: string, newName: string): void {
    const oldKey = `${topicId}:group:${oldName}`;
    const newKey = `${topicId}:group:${newName}`;
    if (storage.has("expanded", oldKey)) {
        storage.remove("expanded", oldKey);
        storage.add("expanded", newKey);
    }
}

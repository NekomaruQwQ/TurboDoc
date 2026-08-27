import { createSubscriber } from "svelte/reactivity";
import * as storage from "@/core/localStorage";
import { isItemKey, parseItemKey, type ItemKey } from "@/core/itemKey";
import {
    ITEM_SEARCH_RESULT_LIMIT,
    recordRecentItemId,
} from "@/core/itemSearch";
import {
    findTopicForUrl,
    getTopicHomeUrl,
    type Topic,
} from "@/core/topic";

// ============================================================================
// Central reconciliation
// ============================================================================

/** Canonical local UI state captured before the application mounts. */
export interface InitializedUiState {
    /** Registered topic restored as the initial navigation-rail selection. */
    readonly activeTopicId: string;
    /** Registered source URL restored as the initial document. */
    readonly currentUrl: string;
}

/** Current evidence used to remove stale references for one rendered topic. */
export interface TopicUiStateSnapshot {
    /** Topic whose local state is being reconciled. */
    readonly topic: Topic;
    /** Sources whose validated data currently contributes a view. */
    readonly readySourceIds: readonly string[];
    /** Composite item IDs rendered by the ready sources. */
    readonly validItemIds: readonly ItemKey[];
    /** Persisted named groups currently owned by the topic workspace. */
    readonly groupNames: readonly string[];
}

/** Parsed expansion key used only while canonicalizing persisted state. */
interface ExpansionReference {
    /** Registered topic owning the expansion entry. */
    readonly topic: Topic;
    /** Whether the key identifies a group or composed item. */
    readonly kind: "group" | "item";
    /** Group name or canonical composite item key. */
    readonly value: string;
}

/** Remove obsolete namespaced slots and canonicalize every current slot.
 *
 * The topic registry is the positive allowlist for topic/source identities.
 * An empty registry throws because TurboDoc cannot select a safe URL fallback.
 * `storageArea` exists for deterministic tests; production uses localStorage.
 */
export function initializeUiState(
    topics: readonly Topic[],
    storageArea: Storage = localStorage,
): InitializedUiState {
    const defaultTopic = topics[0];
    if (!defaultTopic) throw new Error("TurboDoc requires at least one topic.");

    storage.pruneUnknownStorageKeys(storageArea);

    const registeredTopicIds = new Set(topics.map(topic => topic.id));
    const storedTopicId = storage.load("activeTopicId", storageArea);
    const activeTopicId = registeredTopicIds.has(storedTopicId)
        ? storedTopicId
        : defaultTopic.id;

    const storedUrl = storage.load("currentUrl", storageArea);
    const currentUrl = findTopicForUrl(topics, storedUrl)
        ? storedUrl
        : getTopicHomeUrl(defaultTopic);
    const recentItems = canonicalRecentItems(
        storage.load("recentItems", storageArea), topics);
    const expanded = canonicalExpandedKeys(
        storage.load("expanded", storageArea), topics);

    // Materializing every current slot repairs invalid JSON and partially
    // malformed values even when their canonical value equals the default.
    storage.save("activeTopicId", activeTopicId, storageArea);
    storage.save("currentUrl", currentUrl, storageArea);
    storage.save("recentItems", recentItems, storageArea);
    storage.replaceAll("expanded", expanded, storageArea);

    currentUrlCache = currentUrl;
    recentItemsCache = recentItems;
    return { activeTopicId, currentUrl };
}

/** Reconcile one topic after its workspace and some or all sources are ready.
 *
 * Missing items are removed only for ready sources. Registered loading or
 * failed sources retain their references until a later snapshot can prove
 * those items stale. `storageArea` exists for deterministic tests.
 */
export function reconcileTopicUiState(
    snapshot: TopicUiStateSnapshot,
    storageArea: Storage = localStorage,
): void {
    const registeredSourceIds = new Set(
        snapshot.topic.sources.map(source => source.id));
    const readySourceIds = new Set(snapshot.readySourceIds.filter(sourceId =>
        registeredSourceIds.has(sourceId)));
    const validItemIds = new Set(snapshot.validItemIds);
    const groupNames = new Set(["", ...snapshot.groupNames]);

    const previousRecentItems = storage.load("recentItems", storageArea);
    const topicRecentItems = canonicalTopicRecentItems(
        previousRecentItems[snapshot.topic.id] ?? [],
        registeredSourceIds,
        readySourceIds,
        validItemIds);
    const nextRecentItems = { ...previousRecentItems };
    if (topicRecentItems.length > 0)
        nextRecentItems[snapshot.topic.id] = topicRecentItems;
    else delete nextRecentItems[snapshot.topic.id];
    recentItemsCache = nextRecentItems;
    storage.save("recentItems", nextRecentItems, storageArea);

    const topicPrefix = `${snapshot.topic.id}:`;
    const groupPrefix = `${snapshot.topic.id}:group:`;
    const itemPrefix = `${snapshot.topic.id}:item:`;
    const nextExpanded = storage.load("expanded", storageArea).filter(key => {
        if (key.startsWith(groupPrefix))
            return groupNames.has(key.slice(groupPrefix.length));
        if (key.startsWith(itemPrefix)) {
            const itemId = key.slice(itemPrefix.length);
            const parsed = parseItemKey(itemId);
            if (!parsed || !registeredSourceIds.has(parsed.sourceId)) return false;
            return !readySourceIds.has(parsed.sourceId) ||
                validItemIds.has(itemId as ItemKey);
        }
        // Startup normally removes malformed current-topic keys. Keeping this
        // guard makes reconciliation safe when called independently in tests
        // or after another browsing context writes malformed state.
        return !key.startsWith(topicPrefix);
    });
    storage.replaceAll("expanded", nextExpanded, storageArea);
}

/** Retain only registered topic/source keys, preserve MRU order, and cap each
 *  topic to the number of rows the search UI can display. */
function canonicalRecentItems(
    value: Readonly<Record<string, readonly string[]>>,
    topics: readonly Topic[],
): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const topic of topics) {
        const sourceIds = new Set(topic.sources.map(source => source.id));
        const items = canonicalTopicRecentItems(
            value[topic.id] ?? [], sourceIds);
        if (items.length > 0) result[topic.id] = items;
    }
    return result;
}

/** Canonicalize one topic's recent items, optionally using source readiness to
 *  remove item identities that are now confirmed absent. */
function canonicalTopicRecentItems(
    values: readonly string[],
    registeredSourceIds: ReadonlySet<string>,
    readySourceIds: ReadonlySet<string> = new Set(),
    validItemIds: ReadonlySet<ItemKey> = new Set(),
): ItemKey[] {
    const result: ItemKey[] = [];
    const seen = new Set<ItemKey>();
    for (const value of values) {
        const parsed = parseItemKey(value);
        if (!parsed || !registeredSourceIds.has(parsed.sourceId)) continue;
        const itemId = value as ItemKey;
        if (readySourceIds.has(parsed.sourceId) && !validItemIds.has(itemId)) continue;
        if (seen.has(itemId)) continue;
        seen.add(itemId);
        result.push(itemId);
        if (result.length === ITEM_SEARCH_RESULT_LIMIT) break;
    }
    return result;
}

/** Canonicalize expansion entries from the current topic/source registry.
 *  Item existence remains undecidable until the owning source becomes ready. */
function canonicalExpandedKeys(
    values: readonly string[],
    topics: readonly Topic[],
): string[] {
    const result = new Set<string>();
    for (const value of values) {
        const reference = parseExpansionReference(value, topics);
        if (reference?.kind === "group") result.add(value);
        if (reference?.kind === "item") {
            const parsed = parseItemKey(reference.value);
            if (parsed && reference.topic.sources.some(
                source => source.id === parsed.sourceId)) result.add(value);
        }
    }
    return [...result].sort();
}

/** Parse a local expansion key against registered topic prefixes. Group names
 *  may contain colons, so parsing uses full ownership prefixes rather than a
 *  delimiter split. */
function parseExpansionReference(
    value: string,
    topics: readonly Topic[],
): ExpansionReference | null {
    for (const topic of topics) {
        const groupPrefix = `${topic.id}:group:`;
        if (value.startsWith(groupPrefix)) {
            return {
                topic,
                kind: "group",
                value: value.slice(groupPrefix.length),
            };
        }
        const itemPrefix = `${topic.id}:item:`;
        if (value.startsWith(itemPrefix)) {
            return {
                topic,
                kind: "item",
                value: value.slice(itemPrefix.length),
            };
        }
    }
    return null;
}

// ============================================================================
// Reactive bridges over the localStorage event bus
// ============================================================================

let currentUrlCache: string | undefined;
const subscribeCurrentUrl = createSubscriber(update => {
    const handler = (event: { value: string }) => {
        currentUrlCache = event.value;
        update();
    };
    storage.on("currentUrl", handler);
    return () => storage.off("currentUrl", handler);
});

/** Reactive current document URL. Initialization normally seeds its cache;
 *  the lazy fallback keeps isolated consumers safe. */
export const currentUrl = {
    get value(): string {
        subscribeCurrentUrl();
        return currentUrlCache ??= storage.load("currentUrl");
    },
    set value(value: string) {
        currentUrlCache = value;
        storage.save("currentUrl", value);
    },
};

/** Persist a registered topic selection through the centralized UI-state API. */
export function setActiveTopicId(topicId: string): void {
    storage.save("activeTopicId", topicId);
}

let recentItemsCache: Record<string, string[]> | undefined;
const subscribeRecentItems = createSubscriber(update => {
    const handler = (event: { value: Record<string, string[]> }) => {
        recentItemsCache = event.value;
        update();
    };
    storage.on("recentItems", handler);
    return () => storage.off("recentItems", handler);
});

/** Read the five most recently accessed item keys for one topic. The result
 *  is reactive when called inside a Svelte component or derived expression. */
export function recentlyAccessedItemIds(topicId: string): readonly ItemKey[] {
    subscribeRecentItems();
    const recentItems = recentItemsCache ??= storage.load("recentItems");
    return (recentItems[topicId] ?? []).filter(isItemKey);
}

/** Record an accepted topic item navigation. Repeated access moves the item
 *  to the front; a no-op canonical list performs no localStorage write. */
export function recordItemAccess(topicId: string, itemId: ItemKey): void {
    const recentItems = recentItemsCache ??= storage.load("recentItems");
    const previous = recentItems[topicId] ?? [];
    const next = recordRecentItemId(previous, itemId);
    if (next === previous) return;
    recentItemsCache = {
        ...recentItems,
        [topicId]: [...next],
    };
    storage.save("recentItems", recentItemsCache);
}

// -- expanded: a factory keyed by element id ----------------------------------

/** Reactive accessor for one element of the `expanded` array storage slot.
 *  Membership is checked once at construction; subsequent changes are picked
 *  up via the event bus filtered by `key`. */
function expanded(key: string) {
    let cache = storage.has("expanded", key);
    const subscribe = createSubscriber(update => {
        const handler = (event: { element: string; present: boolean }) => {
            if (event.element === key) {
                cache = event.present;
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
        set value(value: boolean) {
            if (value) storage.add("expanded", key);
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
// Imperative interaction helpers
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

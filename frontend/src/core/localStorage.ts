import mitt from "mitt";
import z from "zod";

// ============================================================================
// Storage Slot Registry
// ============================================================================

/** Namespace exclusively owned by TurboDoc on the frontend origin. */
const STORAGE_NAMESPACE = "turbodoc:";

/** Preserve valid entries in partially malformed collection slots so startup
 *  reconciliation can discard only the values it can prove unusable. */
const stringArraySchema = z.array(z.unknown()).transform(values =>
    values.filter((value): value is string => typeof value === "string"));

/** Preserve valid topic arrays without allowing one malformed bucket to reset
 *  recent history belonging to every other topic. */
const stringArrayRecordSchema = z.record(z.string(), z.unknown()).transform(value =>
    Object.fromEntries(Object.entries(value).flatMap(([key, candidate]) => {
        const result = stringArraySchema.safeParse(candidate);
        return result.success ? [[key, result.data]] : [];
    })));

const STORAGE = {
    activeTopicId: {
        // Deliberately new: provider-era selection is not migrated because
        // providers do not map one-to-one onto UI-only topics.
        key: "turbodoc:active-topic-id",
        type: "value" as const,
        schema: z.string().default(""),
    },
    currentUrl: {
        key: "turbodoc:current-url",
        type: "value" as const,
        schema: z.string().default("https://docs.rs/"),
    },
    expanded: {
        key: "turbodoc:expanded-v2",
        type: "array" as const,
        schema: stringArraySchema.default([]),
    },
    recentItems: {
        key: "turbodoc:recent-items-v2",
        type: "value" as const,
        schema: stringArrayRecordSchema.default({}),
    },
} as const;

type StorageKey = keyof typeof STORAGE;

type StorageTypeOf<K extends StorageKey> =
    z.infer<typeof STORAGE[K]["schema"]>;

/** Physical keys recognized by this build; every other namespaced key is an
 *  abandoned or newer incompatible slot and is removed during initialization. */
const CURRENT_STORAGE_KEYS = new Set<string>(
    Object.values(STORAGE).map(slot => slot.key));

// ============================================================================
// Events
//
// Each slot type has a different event shape:
// - Primitive ("value") slots emit `{ value }` — the new value.
// - Array slots emit `{ element, present }` — which element changed and
//   whether it is now present. This allows listeners to skip re-renders
//   when the changed element isn't theirs.
// ============================================================================

type StorageEvents = {
    activeTopicId: { value: string },
    currentUrl: { value: string },
    expanded: { element: string, present: boolean },
    recentItems: { value: Record<string, string[]> },
};

const EVENTS = mitt<StorageEvents>();
export const on = EVENTS.on;
export const off = EVENTS.off;

// ============================================================================
// Primitive API — load / save
// ============================================================================

/** Load a value from localStorage with Zod validation.
 *  Returns the schema default on missing/corrupt/invalid data. */
export function load<K extends StorageKey>(
    key: K,
    storageArea: Storage = localStorage,
): StorageTypeOf<K> {
    try {
        const raw = storageArea.getItem(STORAGE[key].key);
        if (raw === null)
            return STORAGE[key].schema.parse(undefined) as StorageTypeOf<K>;

        const result = STORAGE[key].schema.safeParse(JSON.parse(raw));
        if (result.success) return result.data as StorageTypeOf<K>;

        console.warn(`localStorage "${key}" validation failed:`, result.error);
    } catch (err) {
        console.warn(`Failed to load "${key}" from localStorage:`, err);
    }
    return STORAGE[key].schema.parse(undefined) as StorageTypeOf<K>;
}

/** Save a primitive value to localStorage and emit an event. */
export function save<K extends StorageKey>(
    key: K & { [P in StorageKey]: typeof STORAGE[P]["type"] extends "value" ? P : never }[StorageKey],
    value: StorageTypeOf<K>,
    storageArea: Storage = localStorage,
): void {
    if (persist(key, value, storageArea))
        EVENTS.emit(key, { value } as StorageEvents[typeof key]);
}

/** Remove every obsolete TurboDoc slot without relying on a historical-key
 *  list. Unrelated storage remains untouched. Returns the removed-key count. */
export function pruneUnknownStorageKeys(
    storageArea: Storage = localStorage,
): number {
    const obsoleteKeys: string[] = [];
    try {
        // Snapshot first because deleting from a live Storage index shifts all
        // following entries and would otherwise skip adjacent obsolete keys.
        for (let index = 0; index < storageArea.length; index++) {
            const key = storageArea.key(index);
            if (key?.startsWith(STORAGE_NAMESPACE) &&
                !CURRENT_STORAGE_KEYS.has(key)) obsoleteKeys.push(key);
        }
    } catch (err) {
        console.warn("Failed to enumerate TurboDoc localStorage:", err);
        return 0;
    }

    let removed = 0;
    for (const key of obsoleteKeys) {
        try {
            storageArea.removeItem(key);
            removed++;
        } catch (err) {
            console.warn(`Failed to remove obsolete localStorage key "${key}":`, err);
        }
    }
    return removed;
}

// ============================================================================
// Array API — has / add / remove / addAll / removeAll
// ============================================================================

type ArrayKey = { [P in StorageKey]: typeof STORAGE[P]["type"] extends "array" ? P : never }[StorageKey];

/** Check whether `element` is present in an array slot. */
export function has(
    key: ArrayKey,
    element: string,
    storageArea: Storage = localStorage,
): boolean {
    return (load(key, storageArea) as string[]).includes(element);
}

/** Add `element` to an array slot (sorted insert, no duplicates).
 *  Emits `{ element, present: true }` if the element was actually added. */
export function add(
    key: ArrayKey,
    element: string,
    storageArea: Storage = localStorage,
): void {
    const arr = load(key, storageArea) as string[];
    if (arr.includes(element)) return;
    arr.push(element);
    arr.sort();
    if (!persist(key, arr, storageArea)) return;
    EVENTS.emit(key, { element, present: true } as StorageEvents[typeof key]);
}

/** Remove `element` from an array slot.
 *  Emits `{ element, present: false }` if the element was actually removed. */
export function remove(
    key: ArrayKey,
    element: string,
    storageArea: Storage = localStorage,
): void {
    const arr = load(key, storageArea) as string[];
    const index = arr.indexOf(element);
    if (index < 0) return;
    arr.splice(index, 1);
    if (!persist(key, arr, storageArea)) return;
    EVENTS.emit(key, { element, present: false } as StorageEvents[typeof key]);
}

/** Add multiple elements to an array slot in one write.
 *  Emits one event per element that was actually added. */
export function addAll(
    key: ArrayKey,
    elements: string[],
    storageArea: Storage = localStorage,
): void {
    const arr = load(key, storageArea) as string[];
    const added: string[] = [];
    for (const el of elements) {
        if (!arr.includes(el)) {
            arr.push(el);
            added.push(el);
        }
    }
    if (added.length === 0) return;
    arr.sort();
    if (!persist(key, arr, storageArea)) return;
    for (const el of added)
        EVENTS.emit(key, { element: el, present: true } as StorageEvents[typeof key]);
}

/** Remove multiple elements from an array slot in one write.
 *  Emits one event per element that was actually removed. */
export function removeAll(
    key: ArrayKey,
    elements: string[],
    storageArea: Storage = localStorage,
): void {
    const arr = load(key, storageArea) as string[];
    const toRemove = new Set(elements);
    const removed: string[] = [];
    // Iterate backwards to avoid index shifting.
    for (let i = arr.length - 1; i >= 0; i--) {
        const element = arr[i];
        if (element !== undefined && toRemove.has(element)) {
            removed.push(element);
            arr.splice(i, 1);
        }
    }
    if (removed.length === 0) return;
    if (!persist(key, arr, storageArea)) return;
    for (const el of removed)
        EVENTS.emit(key, { element: el, present: false } as StorageEvents[typeof key]);
}

/** Replace an array slot atomically and emit granular membership changes.
 *  Duplicate input is collapsed because array slots represent sets. */
export function replaceAll(
    key: ArrayKey,
    elements: readonly string[],
    storageArea: Storage = localStorage,
): void {
    const previous = load(key, storageArea) as string[];
    const next = [...new Set(elements)].sort();
    if (!persist(key, next, storageArea)) return;

    const previousSet = new Set(previous);
    const nextSet = new Set(next);
    for (const element of previousSet) {
        if (!nextSet.has(element))
            EVENTS.emit(key, { element, present: false } as StorageEvents[typeof key]);
    }
    for (const element of nextSet) {
        if (!previousSet.has(element))
            EVENTS.emit(key, { element, present: true } as StorageEvents[typeof key]);
    }
}

/** Persist one canonical slot only when its serialized representation changed.
 *  Storage failures are non-fatal and suppress events for unapplied writes. */
function persist<K extends StorageKey>(
    key: K,
    value: StorageTypeOf<K>,
    storageArea: Storage,
): boolean {
    try {
        const serialized = JSON.stringify(value);
        if (storageArea.getItem(STORAGE[key].key) === serialized) return false;
        storageArea.setItem(STORAGE[key].key, serialized);
        return true;
    } catch (err) {
        console.warn(`Failed to save "${key}" to localStorage:`, err);
        return false;
    }
}

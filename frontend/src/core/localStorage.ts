import mitt from "mitt";
import z from "zod";

// ============================================================================
// Storage Slot Registry
// ============================================================================

const STORAGE = {
    currentUrl: {
        key: "turbodoc:current-url",
        type: "value" as const,
        schema: z.string().default("https://docs.rs/"),
    },
    expanded: {
        key: "turbodoc:expanded",
        type: "array" as const,
        schema: z.array(z.string()).default([]),
    },
} as const;

type StorageKey = keyof typeof STORAGE;

type StorageTypeOf<K extends StorageKey> =
    z.infer<typeof STORAGE[K]["schema"]>;

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
    currentUrl: { value: string },
    expanded: { element: string, present: boolean },
};

const EVENTS = mitt<StorageEvents>();
export const on = EVENTS.on;
export const off = EVENTS.off;

// ============================================================================
// Primitive API — load / save
// ============================================================================

/** Load a value from localStorage with Zod validation.
 *  Returns the schema default on missing/corrupt/invalid data. */
export function load<K extends StorageKey>(key: K): StorageTypeOf<K> {
    try {
        const raw = localStorage.getItem(STORAGE[key].key);
        if (!raw) return STORAGE[key].schema.parse(undefined) as StorageTypeOf<K>;

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
): void {
    try {
        localStorage.setItem(STORAGE[key].key, JSON.stringify(value));
        EVENTS.emit(key, { value } as StorageEvents[typeof key]);
    } catch (err) {
        console.warn(`Failed to save "${key}" to localStorage:`, err);
    }
}

// ============================================================================
// Array API — has / add / remove / addAll / removeAll
// ============================================================================

type ArrayKey = { [P in StorageKey]: typeof STORAGE[P]["type"] extends "array" ? P : never }[StorageKey];

/** Check whether `element` is present in an array slot. */
export function has(key: ArrayKey, element: string): boolean {
    return (load(key) as string[]).includes(element);
}

/** Add `element` to an array slot (sorted insert, no duplicates).
 *  Emits `{ element, present: true }` if the element was actually added. */
export function add(key: ArrayKey, element: string): void {
    const arr = load(key) as string[];
    if (arr.includes(element)) return;
    arr.push(element);
    arr.sort();
    persistArray(key, arr);
    EVENTS.emit(key, { element, present: true } as StorageEvents[typeof key]);
}

/** Remove `element` from an array slot.
 *  Emits `{ element, present: false }` if the element was actually removed. */
export function remove(key: ArrayKey, element: string): void {
    const arr = load(key) as string[];
    const index = arr.indexOf(element);
    if (index < 0) return;
    arr.splice(index, 1);
    persistArray(key, arr);
    EVENTS.emit(key, { element, present: false } as StorageEvents[typeof key]);
}

/** Add multiple elements to an array slot in one write.
 *  Emits one event per element that was actually added. */
export function addAll(key: ArrayKey, elements: string[]): void {
    const arr = load(key) as string[];
    const added: string[] = [];
    for (const el of elements) {
        if (!arr.includes(el)) {
            arr.push(el);
            added.push(el);
        }
    }
    if (added.length === 0) return;
    arr.sort();
    persistArray(key, arr);
    for (const el of added)
        EVENTS.emit(key, { element: el, present: true } as StorageEvents[typeof key]);
}

/** Remove multiple elements from an array slot in one write.
 *  Emits one event per element that was actually removed. */
export function removeAll(key: ArrayKey, elements: string[]): void {
    const arr = load(key) as string[];
    const toRemove = new Set(elements);
    const removed: string[] = [];
    // Iterate backwards to avoid index shifting.
    for (let i = arr.length - 1; i >= 0; i--) {
        if (toRemove.has(arr[i]!)) {
            removed.push(arr[i]!);
            arr.splice(i, 1);
        }
    }
    if (removed.length === 0) return;
    persistArray(key, arr);
    for (const el of removed)
        EVENTS.emit(key, { element: el, present: false } as StorageEvents[typeof key]);
}

function persistArray(key: ArrayKey, arr: string[]): void {
    try {
        localStorage.setItem(STORAGE[key].key, JSON.stringify(arr));
    } catch (err) {
        console.warn(`Failed to save "${key}" to localStorage:`, err);
    }
}

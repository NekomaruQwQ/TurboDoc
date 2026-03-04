import { useState, useEffect } from "react";

import type { State } from "@/core/prelude";
import * as storage from "@/core/localStorage";

// ============================================================================
// Hooks
// ============================================================================

/** Primitive-value hook for the current URL.
 *  Syncs across components via mitt events — if another component calls
 *  `setCurrentUrl`, all `useCurrentUrl` consumers see the new value. */
export function useCurrentUrl(): State<string> {
    const [currentUrl, setCurrentUrl] = useState<string>(() =>
        storage.load("currentUrl"));

    // Listen to external updates (e.g., navigated event handler in index.tsx).
    useEffect(() => {
        const handler = ({ value }: { value: string }) => setCurrentUrl(value);
        storage.on("currentUrl", handler);
        return () => storage.off("currentUrl", handler);
    }, []);

    // Persist on change.
    useEffect(() => {
        storage.save("currentUrl", currentUrl);
    }, [currentUrl]);

    return [currentUrl, setCurrentUrl];
}

/** Array-membership hook for the `expanded` storage slot.
 *  Returns `[isExpanded, setExpanded]`. Only re-renders when this specific
 *  key's membership changes — other elements changing in the same array
 *  do not trigger a re-render. */
function useExpanded(key: string): State<boolean> {
    const [expanded, setExpanded] = useState<boolean>(() =>
        storage.has("expanded", key));

    // Listen to external updates (e.g., expandAll/collapseAll imperative calls).
    // Filter by element — only re-render when our specific key changes.
    useEffect(() => {
        const handler = ({ element, present }: { element: string, present: boolean }) => {
            if (element === key)
                setExpanded(present);
        };
        storage.on("expanded", handler);
        return () => storage.off("expanded", handler);
    }, [key]);

    // Persist on change.
    useEffect(() => {
        if (expanded)
            storage.add("expanded", key);
        else
            storage.remove("expanded", key);
    }, [expanded, key]);

    return [expanded, setExpanded];
}

/** Expansion state for a named or ungrouped group.
 *  Key format: `<providerId>:group:<groupId>` */
export function useGroupExpanded(
    providerId: string,
    groupId: string):
    State<boolean> {
    return useExpanded(`${providerId}:group:${groupId}`);
}

/** Expansion state for an item.
 *  Key format: `<providerId>:<itemId>` */
export function useItemExpanded(
    providerId: string,
    itemId: string):
    State<boolean> {
    return useExpanded(`${providerId}:${itemId}`);
}

// ============================================================================
// Imperative Helpers (non-hook)
//
// These directly mutate localStorage and emit mitt events. All listening
// `useExpanded` hooks will pick up the changes via their event handlers.
// ============================================================================

/** Expand a single group. For use in non-hook contexts (e.g., after creating a group). */
export function expandGroup(providerId: string, groupId: string): void {
    storage.add("expanded", `${providerId}:group:${groupId}`);
}

/** Expand multiple items in one write. */
export function expandItems(providerId: string, itemIds: string[]): void {
    storage.addAll("expanded", itemIds.map(id => `${providerId}:${id}`));
}

/** Collapse multiple items in one write. */
export function collapseItems(providerId: string, itemIds: string[]): void {
    storage.removeAll("expanded", itemIds.map(id => `${providerId}:${id}`));
}

/** Transfer a group's expansion state from old name to new name. */
export function renameGroup(providerId: string, oldName: string, newName: string): void {
    const oldKey = `${providerId}:group:${oldName}`;
    const newKey = `${providerId}:group:${newName}`;
    if (storage.has("expanded", oldKey)) {
        storage.remove("expanded", oldKey);
        storage.add("expanded", newKey);
    }
}

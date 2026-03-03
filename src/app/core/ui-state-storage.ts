import type { UiState } from "@/app/core/data";
import { uiStateSchema } from "@/app/core/data";

const STORAGE_KEY = "turbodoc:ui-state";

const emptyUiState: UiState = {
    currentUrl: "https://docs.rs/",
    expandedItems: {},
    expandedGroups: {},
};

/** Load UI expansion state from localStorage. Synchronous.
 *  Returns empty defaults on missing/corrupt/invalid data. */
export function loadUiState(): UiState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...emptyUiState };

        const result = uiStateSchema.safeParse(JSON.parse(raw));
        if (result.success) return result.data;

        console.warn("localStorage UI state validation failed:", result.error);
    } catch (err) {
        console.warn("Failed to load UI state from localStorage:", err);
    }
    return { ...emptyUiState };
}

/** Save UI expansion state to localStorage. Synchronous. */
export function saveUiState(state: UiState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.warn("Failed to save UI state to localStorage:", err);
    }
}

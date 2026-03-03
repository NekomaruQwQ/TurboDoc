// == Type declarations for Microsoft WebView2 JavaScript API ==
declare global {
    interface Window {
        chrome: {
            webview: {
                postMessage(message: string): void;
                addEventListener(
                    type: "message", listener: (event: MessageEvent) => void): void;
                removeEventListener(
                    type: "message", listener: (event: MessageEvent) => void): void;
            };
        };
    }
}

// == IPC event emitter setup ==
import mitt from "mitt";

const ipc = mitt<{
    navigated: { url: string },
}>();

export const on = ipc.on;
export const off = ipc.off;

window.chrome?.webview?.addEventListener("message", ({ data }) => {
    if (typeof data.type === "string") {
        console.log("[->] ", data);
        ipc.emit(data.type, data);
    } else {
        console.error("[->] ", data, " (missing 'type')");
    }
});

// == Wrapper functions for API endpoints ==
import { hc } from "hono/client";

import { throwError } from "@/core";
import type apiRoute from "@/server/api";
import { cacheSchemas } from "@/app/providers/cache-schemas";

const api = hc<typeof apiRoute>("/api/v1");

function getJsonFromResponse<T = unknown>(response: {
    ok: boolean,
    statusText: string,
    json(): Promise<T>,
}): Promise<T> {
    return response.ok
        ? response.json()
        : throwError(`API request failed: ${response.statusText}`);
}

// -- App Data --

/** Load global app data. Throws on HTTP/network errors.
 *  No validation — resolves to `unknown`. */
export async function loadAppData(): Promise<unknown> {
    const response = await api.workspace.app.$get();
    return getJsonFromResponse(response);
}

/** Save global app data. Throws on failure. */
export async function saveAppData(data: object): Promise<void> {
    const response = await api.workspace.app.$put({ json: data });
    if (!response.ok)
        throw new Error(`Failed to save app data: ${response.statusText}`);
}

// -- Provider Data --

/** Load a provider's workspace data. Returns `{}` on HTTP errors (non-fatal).
 *  No validation — resolves to `unknown`. */
export async function loadProviderData(providerId: string): Promise<unknown> {
    const response = await api.workspace[":providerId"].$get({
        param: { providerId },
    });
    return response.ok ? response.json() : {};
}

/** Save a provider's workspace data. Non-fatal on HTTP errors. */
export async function saveProviderData(
    providerId: string, data: object,
): Promise<void> {
    const response = await api.workspace[":providerId"].$put({
        param: { providerId },
        json: data,
    });
    if (!response.ok)
        console.error(`Failed to save provider data for ${providerId}: ${response.statusText}`);
}

// -- UI State --

/** Load UI expansion state. Returns `{}` on HTTP errors (non-fatal).
 *  No validation — resolves to `unknown`. */
export async function loadUiState(): Promise<unknown> {
    const response = await api.workspace.ui.$get();
    return response.ok ? response.json() : {};
}

/** Save UI expansion state. Non-fatal on HTTP errors. */
export async function saveUiState(state: object): Promise<void> {
    const response = await api.workspace.ui.$put({ json: state });
    if (!response.ok)
        console.error(`Failed to save UI state: ${response.statusText}`);
}

// -- Provider Cache (validated against cache schemas) --

/** Load a provider's cache. The response is validated against the provider's
 *  registered cache schema. Returns the schema's empty default on HTTP errors
 *  or validation failure (non-fatal). Network errors and malformed JSON throw. */
export async function loadProviderCache(providerId: string): Promise<unknown> {
    const entry = cacheSchemas[providerId];
    const fallback = entry?.empty ?? {};

    const response = await api.cache[":providerId"].$get({
        param: { providerId },
    });
    if (!response.ok) return fallback;

    const raw = await response.json();
    if (!entry) return raw;

    const result = entry.schema.safeParse(raw);
    if (result.success) return result.data;

    console.warn(`Cache validation failed for "${providerId}":`, result.error);
    return fallback;
}

/** Save a provider's cache. Validates outgoing data against the provider's
 *  registered cache schema before sending. Skips the save (with a warning)
 *  if validation fails — catches provider bugs early. Non-fatal on HTTP errors. */
export async function saveProviderCache(
    providerId: string, cache: object,
): Promise<void> {
    const entry = cacheSchemas[providerId];
    if (entry) {
        const result = entry.schema.safeParse(cache);
        if (!result.success) {
            console.warn(
                `Refusing to save invalid cache for "${providerId}":`,
                result.error);
            return;
        }
    }

    const response = await api.cache[":providerId"].$put({
        param: { providerId },
        json: cache,
    });
    if (!response.ok)
        console.error(`Failed to save cache for ${providerId}: ${response.statusText}`);
}

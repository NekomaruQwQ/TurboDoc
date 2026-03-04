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
import type apiRoute from "@server/api";

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

/** Save a provider's workspace data. Non-fatal on HTTP errors.
 *  The server may respond with 409 if the new data is suspiciously smaller
 *  than the existing file (data loss guard). */
export async function saveProviderData(
    providerId: string, data: object,
): Promise<void> {
    const response = await api.workspace[":providerId"].$put({
        param: { providerId },
        json: data,
    });
    if (response.status === 409)
        console.warn(`Provider data save rejected for "${providerId}" (data loss guard). Next legitimate save will succeed.`);
    else if (!response.ok)
        console.error(`Failed to save provider data for ${providerId}: ${response.statusText}`);
}


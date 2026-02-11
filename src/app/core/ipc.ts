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
import type { ReadonlyDeep } from "type-fest";
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

import type { HonoApp } from "@/server";
import { hc } from "hono/client";

const client = hc<HonoApp>("/");

/**
 * Request to load workspace from the host. Throws an error if the file doesn't
 * exist or any other error occurs.
 *
 * This function does not perform any validation on the loaded workspace object,
 * and as such, it resolves to `unknown`.
 */
export async function loadWorkspace(): Promise<unknown> {
    const response = await client.api.v1.workspace.$get();
    if (!response.ok) {
        throw new Error(`Failed to load workspace: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Request to save workspace to the host. Throws an error if save fails or times out.
 */
export async function saveWorkspace(workspace: {}): Promise<void> {
    const response = await client.api.v1.workspace.$put({
        json: workspace,
    });
    if (!response.ok) {
        throw new Error(`Failed to save workspace: ${response.statusText}`);
    }
}

/**
 * Request to load cache from the host.
 *
 * This function does not perform any validation on the loaded cache object,
 * and as such, it resolves to `unknown`.
 *
 * HTTP errors during cache loading are non-fatal, in which case `null` is
 * returned. Network errors and malformed JSON will throw.
 */
export async function loadCache(): Promise<unknown> {
    const response = await client.api.v1.cache.$get();
    if (!response.ok) {
        console.error(`Failed to load cache: ${response.statusText}`);
        return null;
    }

    return await response.json();
}

/**
 * Request to save cache to the host.
 *
 * HTTP errors during cache saving are non-fatal. Network errors will throw.
 */
export async function saveCache(cache: ReadonlyDeep<{}>): Promise<void> {
    const response = await client.api.v1.cache.$put({
        json: cache,
    });
    if (!response.ok) {
        console.error(`Failed to save cache: ${response.statusText}`);
    }
}

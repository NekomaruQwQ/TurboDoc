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

type IpcEvents = {
    "frontend-shown": { type: "frontend-shown" },
    navigated: {
        type: "navigated",
        url: string,
        navigationId: string,
    },
    "document-navigation-completed": {
        type: "document-navigation-completed",
        navigationId: string,
        success: boolean,
        error: string | null,
    },
};

type HostEvent = IpcEvents[keyof IpcEvents];

const ipc = mitt<IpcEvents>();

export const on = ipc.on;
export const off = ipc.off;
export const isHosted = !!window.chrome?.webview;

/** Validate the narrow host-event protocol before exposing messages to the
 * typed frontend bus. Unknown events are ignored so future host additions do
 * not corrupt current application state. */
function isHostEvent(data: unknown): data is HostEvent {
    if (typeof data !== "object" || data === null || !("type" in data)) return false;
    switch (data.type) {
        case "frontend-shown":
            return true;
        case "navigated":
            return "url" in data && typeof data.url === "string" &&
                "navigationId" in data && typeof data.navigationId === "string";
        case "document-navigation-completed":
            return "navigationId" in data && typeof data.navigationId === "string" &&
                "success" in data && typeof data.success === "boolean" &&
                "error" in data && (typeof data.error === "string" || data.error === null);
        default:
            return false;
    }
}

/** Emit a validated discriminated event without weakening mitt's payload
 * types at the dynamic WebView2 boundary. */
function emitHostEvent(event: HostEvent): void {
    switch (event.type) {
        case "frontend-shown":
            ipc.emit("frontend-shown", event);
            break;
        case "navigated":
            ipc.emit("navigated", event);
            break;
        case "document-navigation-completed":
            ipc.emit("document-navigation-completed", event);
            break;
    }
}

window.chrome?.webview?.addEventListener("message", ({ data }) => {
    if (isHostEvent(data)) {
        console.log("[->] ", data);
        emitHostEvent(data);
    } else {
        console.error("[->] ", data, " (unknown or malformed host event)");
    }
});

// == Wrapper functions for API endpoints ==

/** Load a provider's data. Returns `{}` on HTTP errors (non-fatal).
 *  No validation — resolves to `unknown`. */
export async function loadProviderData(providerId: string): Promise<unknown> {
    const response = await fetch(`/api/v1/data/${encodeURIComponent(providerId)}`);
    return response.ok ? response.json() : {};
}

/** Save a provider's data. Non-fatal on HTTP errors. */
export async function saveProviderData(
    providerId: string, data: object,
): Promise<void> {
    const response = await fetch(`/api/v1/data/${encodeURIComponent(providerId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!response.ok)
        console.error(`Failed to save provider data for ${providerId}: ${response.statusText}`);
}

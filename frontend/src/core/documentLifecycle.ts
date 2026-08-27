/** Defers iframe writes until the native host has exposed the app shell.
 *
 * Requests made before `release()` are coalesced so source normalization
 * effects cannot start the iframe during the hidden top-level navigation.
 * After release, callers receive URLs immediately and apply them to the
 * current iframe element. */
export class DeferredNavigation {
    #released = false;
    #pendingUrl: string | undefined;

    /** Request a document URL. Returns it only when navigation is released. */
    request(url: string): string | undefined {
        if (this.#released) return url;
        this.#pendingUrl = url;
        return undefined;
    }

    /** Release exactly once, preferring the newest pre-release request.
     * Duplicate host notifications return `undefined` and never reload the
     * iframe. */
    release(initialUrl: string): string | undefined {
        if (this.#released) return undefined;
        this.#released = true;
        const url = this.#pendingUrl ?? initialUrl;
        this.#pendingUrl = undefined;
        return url;
    }
}

/** UI state for the first documentation navigation only. Later navigations
 * leave the already-usable editor visible and use WebView2's normal loading
 * behavior. */
export type InitialDocumentLoadState =
    | { status: "waiting"; url: string }
    | { status: "loading"; url: string; navigationId: string | null }
    | { status: "ready" }
    | {
        status: "error";
        url: string;
        reason: "failed" | "timeout";
        details: string | null;
    };

/** Events that can change the initial documentation placeholder. */
export type InitialDocumentLoadEvent =
    | { type: "released" }
    | { type: "started"; url: string; navigationId: string }
    | {
        type: "completed";
        navigationId: string;
        success: boolean;
        error: string | null;
    }
    | { type: "timed-out" }
    | { type: "retry" };

/** Apply one correlated document lifecycle event.
 *
 * Completions for superseded navigation IDs are ignored. Once the initial
 * page succeeds, later document events cannot bring the startup placeholder
 * back over an already-usable editor. */
export function reduceInitialDocumentLoad(
    state: InitialDocumentLoadState,
    event: InitialDocumentLoadEvent,
): InitialDocumentLoadState {
    switch (event.type) {
        case "released":
            return state.status === "waiting"
                ? { status: "loading", url: state.url, navigationId: null }
                : state;
        case "started":
            return state.status === "ready"
                ? state
                : {
                    status: "loading",
                    url: event.url,
                    navigationId: event.navigationId,
                };
        case "completed":
            if (state.status !== "loading" ||
                state.navigationId !== event.navigationId)
                return state;
            return event.success
                ? { status: "ready" }
                : {
                    status: "error",
                    url: state.url,
                    reason: "failed",
                    details: event.error,
                };
        case "timed-out":
            return state.status === "loading"
                ? {
                    status: "error",
                    url: state.url,
                    reason: "timeout",
                    details: null,
                }
                : state;
        case "retry":
            return state.status === "error"
                ? { status: "loading", url: state.url, navigationId: null }
                : state;
    }
}

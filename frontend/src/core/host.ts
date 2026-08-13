/** Report emitted by the native host when an accepted documentation-frame
 * navigation begins. */
export interface DocumentNavigationStarted {
    /** Destination URL accepted by the native navigation policy. */
    url: string;
    /** Decimal WebView2 navigation ID, encoded as a string to preserve `u64`. */
    navigationId: string;
}

/** Report emitted by the native host when an accepted documentation-frame
 * navigation completes. */
export interface DocumentNavigationCompleted {
    /** Decimal WebView2 navigation ID, encoded as a string to preserve `u64`. */
    navigationId: string;
    /** Whether WebView2 completed the navigation without a web error. */
    success: boolean;
    /** Native WebView2 error name for failed navigations, otherwise `null`. */
    error: string | null;
}

/** Narrow JavaScript surface invoked directly by the native host.
 *
 * Application data never travels back through this object. Frontend-to-host
 * communication belongs to REST resources under `/api/*`. */
export interface HostApi {
    /** Release deferred documentation loading after the native shell is visible. */
    frontendShown(): void;
    /** Apply an accepted documentation-frame navigation start. */
    documentNavigationStarted(report: DocumentNavigationStarted): void;
    /** Apply an accepted documentation-frame navigation completion. */
    documentNavigationCompleted(report: DocumentNavigationCompleted): void;
}

declare global {
    interface Window {
        /** Direct entry point installed after the Svelte root is mounted. */
        __turboDoc__: HostApi;
    }
}

/** Publish the mounted Svelte root's native-call surface. */
export function installHostApi(api: HostApi): void {
    window.__turboDoc__ = api;
}

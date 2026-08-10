import { createContext } from "svelte";

import type { Provider } from "@/core/data";
import { DeferredNavigation } from "@/core/documentLifecycle";
import type { ProviderDataStore } from "@/core/providerData.svelte";

export const viewerRef =
    new class { value = $state<HTMLIFrameElement>() };

const viewerNavigation = new DeferredNavigation();

/** Request documentation navigation, deferring it until the native host has
 * made the workbench visible. Pre-release requests are coalesced by
 * `DeferredNavigation`. */
export function navigateTo(url: string) {
    const releasedUrl = viewerNavigation.request(url);
    if (releasedUrl && viewerRef.value) viewerRef.value.src = releasedUrl;
}

/** Release initial documentation loading after the host reports that the
 * top-level frontend is visible. Duplicate reports are idempotent. */
export function releaseViewerNavigation(initialUrl: string) {
    const releasedUrl = viewerNavigation.release(initialUrl);
    if (releasedUrl && viewerRef.value) viewerRef.value.src = releasedUrl;
}

export interface ProviderContext {
    info: () => Provider;
    data: () => ProviderDataStore;
}

const [getProvider, setProvider] = createContext<ProviderContext>();

export { setProvider };

export function getProviderInfo(): Provider {
    return getProvider().info();
}

export function getProviderData(): ProviderDataStore {
    return getProvider().data();
}

import { getContext, setContext } from "svelte";

import type { Provider } from "@/core/data";
import type { ProviderDataStore } from "@/core/providerData.svelte";

// Each context entry exposes a `set` (called by a parent component to
// publish a value into the subtree) and a `get` (called by descendants
// to read it). Keys are module-scoped Symbols so collisions are impossible.

const NAVIGATE_TO = Symbol("navigateTo");
const PROVIDER = Symbol("provider");
const PROVIDER_DATA = Symbol("providerData");

/** Navigate the viewer iframe to a URL. The WebView2 host fires a
 *  `navigated` IPC event in response, whose handler (in the App root)
 *  persists the URL to localStorage and propagates to all
 *  `currentUrl.value` consumers via the storage event bus. */
export const navigateTo = {
    set: (fn: (url: string) => void) => setContext(NAVIGATE_TO, fn),
    get: () => getContext<(url: string) => void>(NAVIGATE_TO),
};

export const provider = {
    set: (p: Provider) => setContext(PROVIDER, p),
    get: () => getContext<Provider>(PROVIDER),
};

/** Per-provider data store, set by `ExplorerProvider.svelte` so that
 *  descendants can read & mutate provider data via `providerData.get()`. */
export const providerData = {
    set: (s: ProviderDataStore) => setContext(PROVIDER_DATA, s),
    get: () => getContext<ProviderDataStore>(PROVIDER_DATA),
};

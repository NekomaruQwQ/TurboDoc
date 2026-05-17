import { createContext } from "svelte";

import type { Provider } from "@/core/data";
import type { ProviderDataStore } from "@/core/providerData.svelte";

export const viewerRef =
    new class { value = $state<HTMLIFrameElement>() };

export function navigateTo(url: string) {
    viewerRef.value && (viewerRef.value.src = url);
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

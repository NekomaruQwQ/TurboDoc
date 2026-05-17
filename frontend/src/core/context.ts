import { createContext } from "svelte";

import type { Provider } from "@/core/data";
import type { ProviderDataStore } from "@/core/providerData.svelte";

import { viewerRef } from "@/core/context.svelte";

export const [getProvider, setProvider] =
    createContext<Provider>();
export const [getProviderData, setProviderData] =
    createContext<ProviderDataStore>();

export function navigateTo(url: string) {
    viewerRef && (viewerRef.src = url);
}

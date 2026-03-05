import { createContext, useContext, useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { State } from "@/core/prelude";

import type {
    Provider,
    ProviderData,
} from "@/core/data";
import * as IPC from "@/core/ipc";

// -- Navigation context -------------------------------------------------------

// biome-ignore lint/style/noNonNullAssertion: always assigned in the context provider.
const navigateToContext = createContext<(url: string) => void>(undefined!);
export const NavigateToProvider = navigateToContext.Provider;
/** Navigate the viewer iframe to a URL. The WebView2 host fires a
 *  `navigated` IPC event in response, whose handler in `index.tsx`
 *  persists the URL to localStorage and propagates to all
 *  `useCurrentUrl()` consumers. */
export const useNavigateTo = () => useContext(navigateToContext);

// biome-ignore lint/style/noNonNullAssertion: always assigned in the context provider.
const provider = createContext<Provider>(undefined!);
export const ProviderProvider = provider.Provider;
export const useProvider = () => useContext(provider);

// biome-ignore lint/style/noNonNullAssertion: always assigned in the context provider.
const providerDataContext = createContext<State<ProviderData>>(undefined!);
export const ProviderDataProvider = providerDataContext.Provider;
/** Reads per-provider workspace data from context. Must be a descendant of
 *  `ProviderDataProvider` (set up in `ExplorerProvider`). */
export const useProviderData = () => useContext(providerDataContext);

/** Per-provider workspace data: loaded from disk on mount, auto-saved on change.
 *  Only called once per provider in `ExplorerProvider`; children access the
 *  data via `useProviderData()` (context consumer). */
export function useProviderDataLoader(): State<ProviderData> {
    const provider = useProvider();

    const [providerData, updateProviderData] = useImmer<ProviderData>({
        data: {},
        groups: {},
        groupOrder: [],
    });
    const lastRef = useRef<string>("{}");
    /// Guard: suppress auto-save until initial load completes, preventing
    /// the empty default state from overwriting real data on disk.
    const loadedRef = useRef(false);

    // Load from disk on mount.
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once per provider.
    useEffect(() => {
        IPC.loadProviderData(provider.id)
            .then(loaded => {
                const pd = loaded as ProviderData;
                pd.data ??= {};
                pd.groups ??= {};
                pd.groupOrder ??= [];
                lastRef.current = JSON.stringify(pd);
                loadedRef.current = true;
                updateProviderData(() => pd);
            })
            .catch(err => console.error(err));
    }, []);

    // Auto-save on change (skipped until initial load completes).
    useEffect(() => {
        if (!loadedRef.current) return;
        const json = JSON.stringify(providerData);
        if (lastRef.current !== json) {
            lastRef.current = json;
            IPC.saveProviderData(provider.id, providerData as object)
                .catch(err => console.error(err));
        }
    }, [providerData, provider.id]);

    return [providerData, updateProviderData];
}


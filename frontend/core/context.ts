import type { ReadonlyDeep } from "type-fest";
import { createContext, useContext, useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { State } from "@/core/prelude";

import type {
    AppData,
    Provider,
    ProviderData,
} from "@/core/data";
import * as IPC from "@/core/ipc";

export class AppContext {
    /** Reference to the viewer iframe for programmatic navigation. */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;

    readonly _appData: State<AppData>;

    public constructor(
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        appData: State<AppData>) {
        this.viewerRef = viewerRef;
        this._appData = appData;
    }

    public get appData(): ReadonlyDeep<AppData> {
        return this._appData[0];
    }

    public updateAppData(updater: (draft: AppData) => void): void {
        this._appData[1](draft => {
            updater(draft);
        });
    }

    /** Navigate the viewer iframe to a URL. The WebView2 host fires a
     *  `navigated` IPC event in response, whose handler in `index.tsx`
     *  persists the URL to localStorage and propagates to all
     *  `useCurrentUrl()` consumers. */
    public navigateTo(url: string): void {
        if (this.viewerRef.current) this.viewerRef.current.src = url;
    }
}

// biome-ignore lint/style/noNonNullAssertion: always assigned in the context provider.
const appContext = createContext<AppContext>(undefined!);
export const AppContextProvider = appContext.Provider;
export const useAppContext = () => useContext(appContext);

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

/** Per-provider in-memory cache for API responses. Not persisted — the HTTP
 *  proxy's SQLite cache handles persistence and RFC 7234 freshness. */
export function useProviderCache(): State<unknown> {
    return useImmer<unknown>({});
}

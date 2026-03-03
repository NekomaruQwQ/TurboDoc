import type { ReadonlyDeep } from "type-fest";
import { createContext, useContext, useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { State } from "@/app/core/prelude";

import type {
    AppData,
    UiState,
    Provider,
    ProviderData,
} from "@/app/core/data";
import * as IPC from "@/app/core/ipc";

export class AppContext {
    /** Reference to the viewer iframe for programmatic navigation. */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;

    /** Global app data (presets, current URL). */
    public readonly appData: ReadonlyDeep<AppData>;
    public readonly updateAppData: (updater: (draft: AppData) => void) => void;

    /** UI expansion state (per-provider expandedItems/expandedGroups). */
    public readonly uiState: ReadonlyDeep<UiState>;
    public readonly updateUiState: (updater: (draft: UiState) => void) => void;

    public constructor(args: {
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        appData: ReadonlyDeep<AppData>,
        updateAppData: (updater: (draft: AppData) => void) => void,
        uiState: ReadonlyDeep<UiState>,
        updateUiState: (updater: (draft: UiState) => void) => void,
    }) {
        this.viewerRef = args.viewerRef;
        this.appData = args.appData;
        this.updateAppData = args.updateAppData;
        this.uiState = args.uiState;
        this.updateUiState = args.updateUiState;
    }

    public onNavigated(url: string): void {
        // Ignore false navigation.
        if (url === "https://docs.rs/-/storage-change-detection.html")
            return;

        this.updateAppData(draft => {
            draft.currentUrl = url;
        });
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

export function useCurrentUrl(): State<string> {
    const ctx = useAppContext();
    return [
        ctx.appData.currentUrl,
        (url: string) => {
            ctx.updateAppData(draft => {
                draft.currentUrl = url;
            });
        },
    ];
}

/** Per-provider workspace data: loaded from disk on mount, auto-saved on change.
 *  Follows the same pattern as `useProviderCache`. */
export function useProviderData(): State<ProviderData> {
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

/** Per-provider cache: loaded from disk on mount, auto-saved on change. */
export function useProviderCache(): State<unknown> {
    const provider = useProvider();

    const [cache, updateCache] = useImmer<unknown>({});
    const lastCacheRef = useRef<string>("{}");
    const cacheLoadedRef = useRef(false);

    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once per provider.
    useEffect(() => {
        IPC.loadProviderCache(provider.id)
            .then(loaded => {
                lastCacheRef.current = JSON.stringify(loaded);
                cacheLoadedRef.current = true;
                updateCache(() => loaded);
            })
            .catch(err => console.error(err));
    }, []);

    // Auto-save on change (skipped until initial load completes).
    useEffect(() => {
        if (!cacheLoadedRef.current) return;
        const json = JSON.stringify(cache);
        if (lastCacheRef.current !== json) {
            lastCacheRef.current = json;
            IPC.saveProviderCache(provider.id, cache as object)
                .catch(err => console.error(err));
        }
    }, [cache, provider.id]);

    return [cache, updateCache];
}

/** Per-provider UI expansion state, backed by the centralized UiState atom
 *  in AppContext. Reads/writes the per-provider slice. */
export function useProviderUiState() {
    const ctx = useAppContext();
    const provider = useProvider();
    const pid = provider.id;
    return {
        expandedItems: ctx.uiState.expandedItems[pid] ?? [],
        expandedGroups: ctx.uiState.expandedGroups[pid] ?? [],
        updateExpandedItems: (updater: (draft: string[]) => void) => {
            ctx.updateUiState(draft => {
                draft.expandedItems[pid] ??= [];
                updater(draft.expandedItems[pid]);
            });
        },
        updateExpandedGroups: (updater: (draft: string[]) => void) => {
            ctx.updateUiState(draft => {
                draft.expandedGroups[pid] ??= [];
                updater(draft.expandedGroups[pid]);
            });
        },
    };
}

import type { ReadonlyDeep } from "type-fest";
import { createContext, useContext, useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { State } from "@/app/core/prelude";

import type {
    Workspace,
    Provider,
    ProviderData,
} from "@/app/core/data";
import * as IPC from "@/app/core/ipc";

export class AppContext {
    /** Reference to the viewer iframe for programmatic navigation */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;
    public readonly workspace: ReadonlyDeep<Workspace>;
    public readonly updateWorkspace: (updater: (draft: Workspace) => void) => void;

    public constructor(args: {
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        workspace: ReadonlyDeep<Workspace>,
        updateWorkspace: (updater: (draft: Workspace) => void) => void,
    }) {
        this.viewerRef = args.viewerRef;
        this.workspace = args.workspace;
        this.updateWorkspace = args.updateWorkspace;
    }

    public onNavigated(url: string): void {
        // Ignore false navigation.
        if (url === "https://docs.rs/-/storage-change-detection.html")
            return;

        this.updateWorkspace(draft => {
            draft.app.currentUrl = url;
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
        ctx.workspace.app.currentUrl,
        (url: string) => {
            ctx.updateWorkspace(draft => {
                draft.app.currentUrl = url;
            })
        }
    ]
}

/** Per-provider cache: loaded from disk on mount, auto-saved on change. */
export function useProviderCache(): State<unknown> {
    const provider = useProvider();

    const [cache, updateCache] = useImmer<unknown>({});
    const lastCacheRef = useRef<string>("{}");

    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once per provider.
    useEffect(() => {
        IPC.loadProviderCache(provider.id)
            .then(loaded => {
                lastCacheRef.current = JSON.stringify(loaded);
                updateCache(() => loaded);
            })
            .catch(err => console.error(err));
    }, []);

    useEffect(() => {
        const json = JSON.stringify(cache);
        if (lastCacheRef.current !== json) {
            lastCacheRef.current = json;
            IPC.saveProviderCache(provider.id, cache as object)
                .catch(err => console.error(err));
        }
    }, [cache, provider.id]);

    return [cache, updateCache];
}

export function useProviderData(): State<ProviderData> {
    const ctx = useAppContext();
    const provider = useProvider();
    const providerData = ctx.workspace.providers[provider.id];

    function updateProviderData(updater: (draft: ProviderData) => void): void {
        ctx.updateWorkspace(draft => {
            const providerData = draft.providers[provider.id];
            if (providerData) {
                updater(providerData);
            } else {
                throw new Error(`Unexpected provider id: ${provider.id}`);
            }
        });
    }

    if (providerData) {
        return [providerData, updateProviderData];
    } else {
        throw new Error(`Unexpected provider id: ${provider.id}`);
    }
}

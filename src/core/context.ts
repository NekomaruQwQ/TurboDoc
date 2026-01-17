import type { ReadonlyDeep } from "type-fest";
import { createContext, useContext } from "react";

import type { State } from "@/core/prelude";

import type {
    Workspace,
    Cache,
    ProviderInfo,
    ProviderData,
} from "@/core/data";

export class AppContext {
    /** Reference to the viewer iframe for programmatic navigation */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;
    public readonly workspace: ReadonlyDeep<Workspace>;
    public readonly cache: ReadonlyDeep<Cache>;
    public readonly updateWorkspace: (updater: (draft: Workspace) => void) => void;
    public readonly updateCache: (updater: (draft: Cache) => void) => void;

    public constructor(args: {
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        workspace: ReadonlyDeep<Workspace>,
        cache: ReadonlyDeep<Cache>,
        updateWorkspace: (updater: (draft: Workspace) => void) => void,
        updateCache: (updater: (draft: Cache) => void) => void,
    }) {
        this.viewerRef = args.viewerRef;
        this.workspace = args.workspace;
        this.cache = args.cache;
        this.updateWorkspace = args.updateWorkspace;
        this.updateCache = args.updateCache;
    }

    public onNavigated(url: string): void {
        // Ignore false navigations.
        if (url == "https://docs.rs/-/storage-change-detectioappn.html")
            return;

        this.updateWorkspace(draft => {
            draft.app.currentUrl = url;
        });
    }
}

const appContext = createContext<AppContext>(undefined!);
export const AppContextProvider = appContext.Provider;
export const useAppContext = () => useContext(appContext);

const providerId = createContext<string>(undefined!);
export const ProviderIdProvider = providerId.Provider;
export const useProviderId = () => useContext(providerId);

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
};

export function useProviderData(): State<ProviderData> {
    const ctx = useAppContext();
    const providerId = useProviderId();
    const providerData = ctx.workspace.providers[providerId];

    function updateProviderData(updater: (draft: ProviderData) => void): void {
        ctx.updateWorkspace(draft => {
            const providerData = draft.providers[providerId];
            if (providerData) {
                updater(providerData);
            } else {
                throw new Error(`Unexpected provider id: ${providerId}`);
            }
        });
    }

    if (providerData) {
        return [providerData, updateProviderData];
    } else {
        throw new Error(`Unexpected provider id: ${providerId}`);
    }
}

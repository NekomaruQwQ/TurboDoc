import type { ReadonlyDeep } from "type-fest";
import { createContext, useContext } from "react";

import type { Workspace, Cache } from "@/core/data";

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

        this.updateWorkspace(draft => draft.app.currentUrl = url);
    }
}

const appContext = createContext<AppContext>(undefined!);

export const AppContextProvider = appContext.Provider;
export const useAppContext = () => useContext(appContext);

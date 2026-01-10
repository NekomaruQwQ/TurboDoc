import type { ReadonlyDeep } from "type-fest";

import { createContext, useContext } from "react";

import type { Workspace, Cache, CrateCache } from "@/data";
import { parseUrl, buildUrl } from "@/data";

import { CACHE_EXPIRY_MS } from "@/constants";
import { computeVersionGroups } from "@/utils/version-group";
import * as CratesAPI from "@/services/crates-api";

export interface AppState {
    workspace: Workspace,
    cache: Cache,
}

export class AppContext {
    /** Reference to the viewer iframe for programmatic navigation */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;

    private readonly state: ReadonlyDeep<AppState>;
    private readonly updateState: (updater: (draft: AppState) => void) => void;

    public get workspace(): ReadonlyDeep<Workspace> {
        return this.state.workspace;
    }

    public get cache(): ReadonlyDeep<Cache> {
        return this.state.cache;
    }

    public constructor(args: {
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        state: ReadonlyDeep<AppState>,
        updateState: (updater: (draft: AppState) => void) => void,
    }) {
        this.viewerRef = args.viewerRef;
        this.state = args.state;
        this.updateState = args.updateState;
    }

    public onNavigated(url: string): void {
        // Ignore false navigation to "https://docs.rs/-/storage-change-detection.html".
        if (url == "https://docs.rs/-/storage-change-detectioappn.html")
            return;

        const page = parseUrl(url);
        const pageUrl = buildUrl(page);
        if (pageUrl !== url) {
            // URL normalization: redirect to the normalized URL.
            console.log(`Redirecting from ${url} to ${buildUrl(page)}`);
            this.navigateTo(pageUrl);
            return;
        }

        this.updateWorkspace(workspace => workspace.currentPage = page)
    }

    public navigateTo(url: string): void {
        let iframeWindow = this.viewerRef.current?.contentWindow;
        if (iframeWindow)
            iframeWindow.location.replace(url);
        else
            console.warn("Navigation failed: iframe not loaded yet.");
    }

    public updateWorkspace(updater: (draft: Workspace) => void): void {
        this.updateState(state => { updater(state.workspace); });
        console.log("Workspace updated.");
    }

    private updateCache(updater: (draft: Cache) => void): void {
        this.updateState(state => { updater(state.cache); });
        console.log("Cache updated.");
    }

    /** Invalidates cached metadata for a crate, forcing a refetch on next access. */
    public refreshCrateCache(crateName: string): void {
        this.updateCache(draft => { delete draft.crates[crateName]; });
    }

    public getCrateCache(crateName: string): ReadonlyDeep<CrateCache> | undefined {
        function shouldRefetch(crateCache: ReadonlyDeep<CrateCache> | undefined): boolean {
            if (!crateCache) return true;
            const age = Date.now() - crateCache.lastFetched;
            return age > CACHE_EXPIRY_MS;
        }

        async function refetch(crateName: string, callback: (crateCache: CrateCache) => void): Promise<void> {
            console.log(`Refetching crate info for ${crateName}.`);
            try {
                const crateInfo = await CratesAPI.fetchCrateInfo(crateName);

                const newCrateInfo = {
                    name: crateInfo.crate.name,
                    versions: crateInfo.versions,
                    versionGroups: computeVersionGroups(crateInfo.versions),
                    repository: crateInfo.crate.repository ?? null,
                    homepage: crateInfo.crate.homepage ?? null,
                    documentation: crateInfo.crate.documentation ?? null,
                    lastFetched: Date.now(),
                } satisfies CrateCache;

                callback(newCrateInfo);
            } catch (err) {
                console.error(`Failed to fetch crate info for ${crateName}:`, err);
            }
        }

        let existing = this.cache.crates ? this.cache.crates[crateName] : undefined;
        if (shouldRefetch(existing)) {
            refetch(crateName, crateCache => {
                this.updateCache(draft => {
                    draft.crates[crateName] = crateCache;
                });
            });
        }

        return existing;
    }
}

const appContext = createContext<AppContext>(undefined!);

export const AppContextProvider = appContext.Provider;
export const useAppContext = () => useContext(appContext);

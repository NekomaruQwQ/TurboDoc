import { createContext, useContext } from "react";
import type { Immutable } from "immer";
import { produce } from "immer";

import type { Workspace, Cache, CrateInfo } from '@/data';
import * as IPC from '@/ipc';

import { CACHE_EXPIRY_MS } from "@/constants";
import * as CratesAPI from '@/services/crates-api';
import { computeVersionGroups } from "@/utils/version-group";

export class AppContext {
    public readonly workspace: Immutable<Workspace>;
    private readonly setWorkspace: (value: Immutable<Workspace>) => void;
    private readonly cache: Immutable<Cache>;
    private readonly setCache: (value: Immutable<Cache>) => void;

    /** Reference to the viewer iframe for programmatic navigation */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;

    public constructor(
        viewerRef: React.RefObject<HTMLIFrameElement | null>,
        workspaceState:
            [Immutable<Workspace>, (value: Immutable<Workspace>) => void],
        cacheState:
            [Immutable<Cache>, (value: Immutable<Cache>) => void]) {
        this.viewerRef = viewerRef;
        [this.workspace, this.setWorkspace] = workspaceState;
        [this.cache, this.setCache] = cacheState;
    }

    public navigateTo(url: string): void {
        let iframeWindow = this.viewerRef.current?.contentWindow;
        if (iframeWindow)
            iframeWindow.location.replace(url);
        else
            console.warn('Navigation failed: iframe not loaded yet.');
    }

    public async load(): Promise<void> {
        this.setCache(await IPC.loadCache());
        this.setWorkspace(await IPC.loadWorkspace());
    }

    public async updateWorkspace(updater: (draft: Workspace) => void): Promise<void> {
        const newWorkspace = produce(this.workspace, updater);
        this.setWorkspace(newWorkspace);
        await IPC.saveWorkspace(newWorkspace);
    }

    private async updateCache(updater: (draft: Cache) => void): Promise<void> {
        const newCache = produce(this.cache, updater);
        this.setCache(newCache);
        await IPC.saveCache(newCache);
    }

    public async getCrateInfo(crateName: string): Promise<Immutable<CrateInfo> | undefined> {
        function shouldRefetch(crateCache: Immutable<CrateInfo> | undefined): boolean {
            if (!crateCache) return true;
            const age = Date.now() - crateCache.lastFetched;
            return age > CACHE_EXPIRY_MS;
        }

        if (shouldRefetch(this.cache.crates[crateName])) {
            console.log(`Refetching crate info for ${crateName}.`);
            try {
                const {
                    crate: {
                        repository,
                        homepage,
                        documentation,
                    },
                    versions,
                } = await CratesAPI.fetchCrateInfo(crateName);

                const newCrateInfo = {
                    name: crateName,
                    versions,
                    versionGroups: computeVersionGroups(versions),
                    links: {
                        repository,
                        homepage,
                        documentation,
                    },
                    lastFetched: Date.now(),
                } satisfies CrateInfo;

                await this.updateCache(draft => {
                    draft.crates[crateName] = newCrateInfo;
                });
            } catch (err) {
                console.error(`Failed to fetch crate info for ${crateName}:`, err);
            }
        }

        return this.cache.crates[crateName];
    }
}

const context = createContext<AppContext>(undefined!);
export const AppContextProvider = context.Provider;
export const useAppContext = () => useContext(context);

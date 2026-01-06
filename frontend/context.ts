import type { ReadonlyDeep } from 'type-fest';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useImmer } from 'use-immer';

import type { Workspace, Cache, CrateCache } from '@/data';
import * as IPC from '@/ipc';

import { CACHE_EXPIRY_MS } from '@/constants';
import * as CratesAPI from '@/services/crates-api';
import { computeVersionGroups } from '@/utils/version-group';

export interface AppState {
    workspace: Workspace,
    cache: Cache,
}

export async function loadAppState(): Promise<AppState> {
    // Here we just assume that the loaded data is valid.
    // Validation is deferred to later stages.
    const workspace =
        await IPC.loadWorkspace() as Record<string, unknown> ?? {};
    const cache =
        await IPC.loadCache() as Record<string, unknown> ?? {};
    workspace.groups ??= [];
    workspace.ungrouped ??= [];
    workspace.currentPage ??= 'https://docs.rs/';
    cache.crates ??= {};
    return {
        workspace: workspace as any as Workspace,
        cache: cache as any as Cache,
    }
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

    public constructor() {
        this.viewerRef =
            useRef<HTMLIFrameElement | null>(null);

        [this.state, this.updateState] =
            useImmer<AppState>({
                workspace: { groups: [], ungrouped: [], currentPage: 'https://docs.rs/' },
                cache: { crates: {} },
            });

        // Load the workspace and cache from disk on first render.
        useEffect(() => {
            loadAppState()
                .then(appState => this.updateState(_ => appState))
                .catch(err => console.error(err));
        }, []);

        // If it is the first render, we skip saving to avoid overwriting existing data
        // before it is loaded.
        // If not, we save the workspace and cache on every state change.
        const isFirstRender = useRef(true);
        useEffect(() => {
            if (isFirstRender.current) {
                isFirstRender.current = false;
                return;
            }

            IPC.saveWorkspace(this.state.workspace)
                .catch(err => console.error(err));
            IPC.saveCache(this.state.cache)
                .catch(err => console.error(err));
        }, [this.state]);

        // Listen to the 'navigated' IPCEvent.
        useEffect(() => {
            IPC.on('navigated', event => {
                if (event.url.startsWith('https://docs.rs/') &&
                    !event.url.startsWith('https://docs.rs/-/'))
                this.updateWorkspace(workspace => workspace.currentPage = event.url)
            })
        }, []);
    }

    public navigateTo(url: string): void {
        let iframeWindow = this.viewerRef.current?.contentWindow;
        if (iframeWindow)
            iframeWindow.location.replace(url);
        else
            console.warn('Navigation failed: iframe not loaded yet.');
    }

    public updateWorkspace(updater: (draft: Workspace) => void): void {
        this.updateState(state => { updater(state.workspace); });
        console.log('Workspace updated.');
    }

    private updateCache(updater: (draft: Cache) => void): void {
        this.updateState(state => { updater(state.cache); });
        console.log('Cache updated.');
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

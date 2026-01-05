import type { ReadonlyDeep } from 'type-fest';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useImmer } from 'use-immer';
import { produce } from 'immer';

import type { Workspace, Cache, CrateInfo } from '@/data';
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
        await IPC.loadWorkspace()
            ?? { groups: [], ungrouped: [] } satisfies Workspace;
    const cache =
        await IPC.loadCache()
            ?? { crates: {} } satisfies Cache;
    return {
        workspace: workspace as Workspace,
        cache: cache as Cache,
    }
}

export class AppContext {
    private readonly state: ReadonlyDeep<AppState>;
    private readonly updateState: (updater: (draft: AppState) => AppState) => void;

    public get workspace(): ReadonlyDeep<Workspace> {
        return this.state.workspace;
    }

    public get cache(): ReadonlyDeep<Cache> {
        return this.state.cache;
    }

    /** Reference to the viewer iframe for programmatic navigation */
    public readonly viewerRef: React.RefObject<HTMLIFrameElement | null>;

    public constructor(viewerRef: React.RefObject<HTMLIFrameElement | null>) {
        this.viewerRef = viewerRef;

        [this.state, this.updateState] = useImmer<AppState>({
            workspace: { groups: [], ungrouped: [] },
            cache: { crates: {} },
        });

        useEffect(() => {
            loadAppState()
                .then(appState => this.updateState(_ => appState))
                .catch(err => console.error(err));
        }, []);

        // If it is the first render, we skip saving to avoid overwriting existing data
        // before it is loaded.
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
    }

    public navigateTo(url: string): void {
        let iframeWindow = this.viewerRef.current?.contentWindow;
        if (iframeWindow)
            iframeWindow.location.replace(url);
        else
            console.warn('Navigation failed: iframe not loaded yet.');
    }

    public updateWorkspace(updater: (draft: Workspace) => void): void {
        this.updateState(state => ({ ...state, workspace: produce(state.workspace, updater) }));
        console.log('Workspace updated.');
    }

    private updateCache(updater: (draft: Cache) => void): void {
        this.updateState(state => ({ ...state, cache: produce(state.cache, updater) }));
        console.log('Cache updated.');
    }

    public async getCrateInfo(crateName: string): Promise<ReadonlyDeep<CrateInfo> | undefined> {
        function shouldRefetch(crateCache: ReadonlyDeep<CrateInfo> | undefined): boolean {
            if (!crateCache) return true;
            const age = Date.now() - crateCache.lastFetched;
            return age > CACHE_EXPIRY_MS;
        }

        let existing = this.cache.crates ? this.cache.crates[crateName] : undefined;
        if (shouldRefetch(existing)) {
            console.log(`Refetching crate info for ${crateName}.`);
            try {
                const crateInfo = await CratesAPI.fetchCrateInfo(crateName);

                const newCrateInfo = {
                    name: crateInfo.crate.name,
                    versions: crateInfo.versions,
                    versionGroups: computeVersionGroups(crateInfo.versions),
                    links: {
                        repository: crateInfo.crate.repository ?? null,
                        homepage: crateInfo.crate.homepage ?? null,
                        documentation: crateInfo.crate.documentation ?? null,
                    },
                    lastFetched: Date.now(),
                } satisfies CrateInfo;

                this.updateCache(draft => {
                    draft.crates[crateName] = newCrateInfo;
                });
            } catch (err) {
                console.error(`Failed to fetch crate info for ${crateName}:`, err);
            }
        }

        return this.cache.crates![crateName]!;
    }
}

const context = createContext<AppContext>(undefined!);
export const AppContextProvider = context.Provider;
export const useAppContext = () => useContext(context);

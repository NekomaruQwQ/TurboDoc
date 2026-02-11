import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "@/app/ui/App";

ReactDOM
    // biome-ignore lint/style/noNonNullAssertion: element created in index.html.
    .createRoot(document.getElementById("app")!)
    .render(React.createElement(() => {
        console.log("App rerendered.");
        const ctx = useAppContext();
        return ctx &&
            <React.StrictMode>
                <AppContextProvider value={ctx}>
                    <App />
                </AppContextProvider>
            </React.StrictMode>;
    }));

import type { ReadonlyDeep } from "type-fest";
import { useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { Workspace, Cache } from "@/app/core/data";
import { AppContext, AppContextProvider } from "@/app/core/context";
import * as IPC from "@/app/core/ipc";

async function load(): Promise<[ReadonlyDeep<Workspace>, ReadonlyDeep<Cache>]> {
    // Here we just assume that the loaded data is valid.
    // Validation is deferred to later stages.
    const workspace =
        await IPC.loadWorkspace() as Workspace ?? {};
    const cache =
        await IPC.loadCache() as Cache ?? {};

    workspace.app ??= {
        currentUrl: "https://docs.rs/",
        currentPreset: "Empty",
        presets: {
            "Empty": { providers: [] },
        },
    };
    workspace.providers ??= {};
    cache.providers ??= {};

    return [workspace, cache];
}

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastWorkspaceRef = useRef<string>("");
    const lastCacheRef = useRef<string>("");

    const [workspace, updateWorkspace] =
        useImmer<ReadonlyDeep<Workspace> | null>(null);
    const [cache, updateCache] =
        useImmer<ReadonlyDeep<Cache | null>>(null);
    console.log("Current workspace:", workspace);
    console.log("Current cache:", cache);

    const app = workspace && cache ?
        new AppContext({
            viewerRef,
            workspace,
            cache,
            updateWorkspace:
                updater => updateWorkspace(draft => {
                    draft && updater(draft);
                }),
            updateCache:
                updater => updateCache(draft => {
                    draft && updater(draft);
                }),
        }) : null;

    // Load the workspace and cache from disk on first render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once.
    useEffect(() => {
        load()
            .then(([workspace, cache]) => {
                lastWorkspaceRef.current =
                    JSON.stringify(workspace);
                lastCacheRef.current =
                    JSON.stringify(cache);
                updateWorkspace(() => workspace);
                updateCache(() => cache);
            })
            .catch(err => console.error(err));
    }, []);

    // Save the workspace and cache on every change.
    useEffect(() => {
        if (!workspace) return;
        const json = JSON.stringify(workspace);
        if (lastWorkspaceRef.current !== json) {
            lastWorkspaceRef.current = json;
            IPC.saveWorkspace(workspace)
                .catch(err => console.error(err));
        }
    }, [workspace]);
    useEffect(() => {
        if (!cache) return;
        const json = JSON.stringify(cache);
        if (lastCacheRef.current !== json) {
            lastCacheRef.current = json;
            IPC.saveCache(cache)
                .catch(err => console.error(err));
        }
    }, [cache]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app?.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

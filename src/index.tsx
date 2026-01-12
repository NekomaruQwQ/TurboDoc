import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "@/ui/App";

ReactDOM
    .createRoot(document.getElementById("app")!)
    .render(React.createElement(() => {
        console.log("App rerendered.");
        const app = useAppContext();
        return app && (
            <AppContextProvider value={app}>
                <App />
            </AppContextProvider>);
    }));

import type { ReadonlyDeep } from "type-fest";
import { useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { Workspace, Cache } from "@/core/data";
import { AppContext, AppContextProvider } from "@/core/context";
import * as IPC from "@/core/ipc";

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
        presets: [{name: "Empty", providers: []}],
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

    const app = workspace && cache ?
        new AppContext({
            viewerRef,
            workspace,
            cache,
            updateWorkspace:
                updater => updateWorkspace(draft => draft && updater(draft)),
            updateCache:
                updater => updateCache(draft => draft && updater(draft)),
        }) : null;

    // Load the workspace and cache from disk on first render.
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
        if (lastWorkspaceRef.current !== JSON.stringify(workspace))
            IPC.saveWorkspace(workspace)
                .catch(err => console.error(err));
    }, [workspace]);
    useEffect(() => {
        if (!cache) return;
        if (lastCacheRef.current !== JSON.stringify(cache))
            IPC.saveCache(cache)
                .catch(err => console.error(err));
    }, [cache]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app && app.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

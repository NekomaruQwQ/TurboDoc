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

import type { Workspace } from "@/app/core/data";
import { AppContext, AppContextProvider } from "@/app/core/context";
import * as IPC from "@/app/core/ipc";

async function load(): Promise<ReadonlyDeep<Workspace>> {
    // Here we just assume that the loaded data is valid.
    // Validation is deferred to later stages.
    const workspace =
        await IPC.loadWorkspace() as Workspace ?? {};

    workspace.app ??= {
        currentUrl: "https://docs.rs/",
        currentPreset: "Empty",
        presets: {
            "Empty": { providers: [] },
        },
    };
    workspace.providers ??= {};

    return workspace;
}

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastWorkspaceRef = useRef<string>("");

    const [workspace, updateWorkspace] =
        useImmer<ReadonlyDeep<Workspace> | null>(null);
    console.log("Current workspace:", workspace);

    const app = workspace ?
        new AppContext({
            viewerRef,
            workspace,
            updateWorkspace:
                updater => updateWorkspace(draft => {
                    draft && updater(draft);
                }),
        }) : null;

    // Load the workspace from disk on first render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once.
    useEffect(() => {
        load()
            .then(workspace => {
                lastWorkspaceRef.current =
                    JSON.stringify(workspace);
                updateWorkspace(() => workspace);
            })
            .catch(err => console.error(err));
    }, []);

    // Save the workspace on every change.
    useEffect(() => {
        if (!workspace) return;
        const json = JSON.stringify(workspace);
        if (lastWorkspaceRef.current !== json) {
            lastWorkspaceRef.current = json;
            IPC.saveWorkspace(workspace)
                .catch(err => console.error(err));
        }
    }, [workspace]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app?.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

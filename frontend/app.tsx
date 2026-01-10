import { useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/components/ui/resizable";

import type { Workspace, Cache } from "@/data";
import type { AppState } from "@/context";
import { AppContext, AppContextProvider } from "@/context";
import { Explorer } from "@/explorer";
import { buildUrl } from "@/data";
import * as IPC from "@/ipc";

import type { ReadonlyDeep } from "type-fest";

async function loadAppState(): Promise<AppState> {
    // Here we just assume that the loaded data is valid.
    // Validation is deferred to later stages.
    const workspace =
        await IPC.loadWorkspace() as Record<string, unknown> ?? {};
    const cache =
        await IPC.loadCache() as Record<string, unknown> ?? {};
    workspace.groups ??= [];
    workspace.ungrouped ??= [];
    workspace.currentPage ??= { type: "unknown", url: "https://docs.rs/" };
    cache.crates ??= {};

    const state = {
        workspace: workspace as any as Workspace,
        cache: cache as any as Cache,
    } satisfies AppState;

    const itemComparer =
        (a: ReadonlyDeep<{ name: string }>, b: ReadonlyDeep<{ name: string }>) =>
            a.name.localeCompare(b.name);
    state.workspace.groups.forEach(group => group.items.sort(itemComparer));
    state.workspace.ungrouped.sort(itemComparer);
    return state;
}

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const [state, updateState] = useImmer<AppState | null>(null);

    const app =
        state
            ? new AppContext({
                viewerRef,
                state: state as ReadonlyDeep<AppState>,
                updateState: updater => updateState(draft => draft && updater(draft)),
            })
            : null;

    // Load the workspace and cache from disk on first render.
    useEffect(() => {
        loadAppState()
            .then(appState => updateState(_ => appState))
            .catch(err => console.error(err));
    }, []);

    // Save the workspace and cache on every state change.
    useEffect(() => {
        if (state) {
            IPC.saveWorkspace(state.workspace)
                .catch(err => console.error(err));
            IPC.saveCache(state.cache)
                .catch(err => console.error(err));
        }
    }, [state]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app && app.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

export function App() {
    console.log("App rerendered.");
    const app = useAppContext();
    return app && (
        <AppContextProvider value={app}>
            <div className="w-full h-full flex flex-col">
                <div>-</div>
                <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel defaultSize={20}>
                        <Explorer />
                    </ResizablePanel>
                    <ResizableHandle className="w-0 my-4"/>
                    <ResizablePanel defaultSize={80} className="flex">
                        <iframe
                            ref={app.viewerRef}
                            src={buildUrl(app.workspace.currentPage)}
                            className="w-full h-full rounded-tl-lg"/>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </AppContextProvider>);
}

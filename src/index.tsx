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

import type { AppData, UiState } from "@/app/core/data";
import { AppContext, AppContextProvider } from "@/app/core/context";
import * as IPC from "@/app/core/ipc";

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastAppDataRef = useRef<string>("");
    const lastUiStateRef = useRef<string>("");

    const [appData, updateAppData] =
        useImmer<ReadonlyDeep<AppData> | null>(null);
    const [uiState, updateUiState] =
        useImmer<ReadonlyDeep<UiState> | null>(null);

    const app = (appData && uiState) ?
        new AppContext({
            viewerRef,
            appData,
            updateAppData:
                updater => updateAppData(draft => {
                    draft && updater(draft);
                }),
            uiState,
            updateUiState:
                updater => updateUiState(draft => {
                    draft && updater(draft);
                }),
        }) : null;

    // Load app data and UI state from disk on first render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once.
    useEffect(() => {
        IPC.loadAppData()
            .then(loaded => {
                const data = loaded as AppData ?? {};
                data.currentUrl ??= "https://docs.rs/";
                data.currentPreset ??= "Empty";
                data.presets ??= { "Empty": { providers: [] } };
                lastAppDataRef.current = JSON.stringify(data);
                updateAppData(() => data);
            })
            .catch(err => console.error(err));

        IPC.loadUiState()
            .then(loaded => {
                const state = loaded as UiState ?? {};
                state.expandedItems ??= {};
                state.expandedGroups ??= {};
                lastUiStateRef.current = JSON.stringify(state);
                updateUiState(() => state);
            })
            .catch(err => console.error(err));
    }, []);

    // Auto-save app data.
    useEffect(() => {
        if (!appData) return;
        const json = JSON.stringify(appData);
        if (lastAppDataRef.current !== json) {
            lastAppDataRef.current = json;
            IPC.saveAppData(appData)
                .catch(err => console.error(err));
        }
    }, [appData]);

    // Auto-save UI state.
    useEffect(() => {
        if (!uiState) return;
        const json = JSON.stringify(uiState);
        if (lastUiStateRef.current !== json) {
            lastUiStateRef.current = json;
            IPC.saveUiState(uiState)
                .catch(err => console.error(err));
        }
    }, [uiState]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app?.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

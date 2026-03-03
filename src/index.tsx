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
import * as UiStateStorage from "@/app/core/ui-state-storage";

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastAppDataRef = useRef<string>("");

    const [appData, updateAppData] =
        useImmer<ReadonlyDeep<AppData> | null>(null);
    // UI state is loaded synchronously from localStorage — always available.
    const [uiState, updateUiState] =
        useImmer<ReadonlyDeep<UiState>>(() => UiStateStorage.loadUiState());

    const app = appData ?
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
                    updater(draft);
                }),
        }) : null;

    // Load app data from server on first render.
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

    // Persist UI state to localStorage on change.
    useEffect(() => {
        UiStateStorage.saveUiState(uiState as UiState);
    }, [uiState]);

    // Listen to the "navigated" IPCEvent.
    useEffect(() => {
        return app
            ? IPC.on("navigated", event => app?.onNavigated(event.url))
            : undefined;
    }, [app]);

    return app;
}

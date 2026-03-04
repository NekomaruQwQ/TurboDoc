import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "@/ui/App";

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

import type { AppData } from "@/core/data";
import { AppContext, AppContextProvider } from "@/core/context";
import { useCurrentUrl } from "@/core/uiState";
import * as IPC from "@/core/ipc";

function useAppContext(): AppContext | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastAppDataRef = useRef<string>("");

    const [appData, updateAppData] =
        useImmer<ReadonlyDeep<AppData> | null>(null);
    const currentUrl = useCurrentUrl();

    const app = appData ?
        new AppContext(
            viewerRef,
            [appData, updater => updateAppData(draft => {
                draft && updater(draft);
            })],
            currentUrl) : null;

    // Load app data from server on first render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: effect only run once.
    useEffect(() => {
        IPC.loadAppData()
            .then(loaded => {
                const data = loaded as AppData ?? {};
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

    // Listen to the "navigated" IPCEvent. Only records the URL in state
    // (the iframe already navigated). `currentUrl[1]` (setState) from
    // useState is referentially stable, so this effect subscribes once.
    // biome-ignore lint/correctness/useExhaustiveDependencies: setCurrentUrl is stable.
    useEffect(() => {
        return IPC.on("navigated", event => {
            // Ignore false navigation.
            if (event.url === "https://docs.rs/-/storage-change-detection.html")
                return;
            currentUrl[1](event.url);
        });
    }, []);

    return app;
}

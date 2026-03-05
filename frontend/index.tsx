import * as React from "react";
import * as ReactDOM from "react-dom/client";
import App from "@/ui/App";

ReactDOM
    // biome-ignore lint/style/noNonNullAssertion: element created in index.html.
    .createRoot(document.getElementById("app")!)
    .render(React.createElement(() => {
        console.log("App rerendered.");
        const root = useAppRoot();
        return root &&
            <React.StrictMode>
                <NavigateToProvider value={root.navigateTo}>
                    <App viewerRef={root.viewerRef} appDataState={root.appDataState} />
                </NavigateToProvider>
            </React.StrictMode>;
    }));

import type { ReadonlyDeep } from "type-fest";
import { useCallback, useEffect, useRef } from "react";
import { useImmer } from "use-immer";

import type { AppData } from "@/core/data";
import type { State } from "@/core/prelude";
import { NavigateToProvider } from "@/core/context";
import * as storage from "@/core/localStorage";
import * as IPC from "@/core/ipc";

interface AppRoot {
    viewerRef: React.RefObject<HTMLIFrameElement | null>;
    appDataState: State<AppData>;
    navigateTo: (url: string) => void;
}

function useAppRoot(): AppRoot | null {
    const viewerRef = useRef<HTMLIFrameElement | null>(null);
    const lastAppDataRef = useRef<string>("");

    const [appData, updateAppData] =
        useImmer<ReadonlyDeep<AppData> | null>(null);

    // Stable callback — viewerRef is a ref object, so the closure always
    // sees the latest `.current` without needing it as a dependency.
    // biome-ignore lint/correctness/useExhaustiveDependencies: viewerRef is a stable ref.
    const navigateTo = useCallback((url: string) => {
        if (viewerRef.current) viewerRef.current.src = url;
    }, []);

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

    // Listen to the "navigated" IPCEvent. Only records the URL in
    // localStorage (the iframe already navigated); the mitt event
    // propagates to all useCurrentUrl() consumers.
    useEffect(() => {
        return IPC.on("navigated", event => {
            // Ignore false navigation.
            if (event.url === "https://docs.rs/-/storage-change-detection.html")
                return;
            storage.save("currentUrl", event.url);
        });
    }, []);

    if (!appData) return null;

    const appDataState: State<AppData> = [
        appData,
        updater => updateAppData(draft => { draft && updater(draft); }),
    ];

    return { viewerRef, appDataState, navigateTo };
}

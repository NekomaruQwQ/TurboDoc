import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/ui/common/Resizable";

import { useRef } from "react";

import type { AppData } from "@/core/data";
import type { State } from "@/core/prelude";
import * as storage from "@/core/localStorage";

import Explorer from "@/ui/explorer";

export default function App({ viewerRef, appDataState }: {
    viewerRef: React.RefObject<HTMLIFrameElement | null>,
    appDataState: State<AppData>,
}) {
    // Capture the initial URL once — React never re-sets the `src` attribute
    // after this. All subsequent navigation is imperative via navigateTo().
    const initialUrl = useRef(storage.load("currentUrl"));
    return (
        <div className="w-full h-full flex flex-col">
            <div className="h-12">-</div>
            <ResizablePanelGroup direction="horizontal">
                <ResizablePanel defaultSize={20} className="px-2">
                    {/* Clip the content of explorer with rounded corners */}
                    <div className="w-full h-full rounded-t-lg overflow-clip">
                        <Explorer appDataState={appDataState} />
                    </div>
                </ResizablePanel>
                <ResizableHandle className="w-0"/>
                <ResizablePanel defaultSize={80}>
                    {/** biome-ignore lint/a11y/useIframeTitle: don't care */}
                    <iframe
                        ref={viewerRef}
                        src={initialUrl.current}
                        className="w-full h-full border border-white/30 rounded-tl-3xl"/>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>);
}

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/components/ui/resizable";

import { useAppContext } from "@/core/context";

import Explorer from "@/ui/explorer";

export default function App() {
    const ctx = useAppContext();
    return (
        <div className="w-full h-full flex flex-col">
            <div className="h-12">-</div>
            <ResizablePanelGroup direction="horizontal">
                <ResizablePanel defaultSize={20} className="px-2">
                    {/* Clip the content of explorer with rounded corners */}
                    <div className="w-full h-full rounded-md overflow-clip">
                        <Explorer />
                    </div>
                </ResizablePanel>
                <ResizableHandle className="w-0"/>
                <ResizablePanel defaultSize={80}>
                    {/** biome-ignore lint/a11y/useIframeTitle: don't care */}
                    <iframe
                        ref={ctx.viewerRef}
                        src={ctx.uiState.currentUrl}
                        className="w-full h-full border border-white/25 rounded-tl-md"/>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>);
}

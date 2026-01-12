import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@shadcn/components/ui/resizable";

import { useAppContext } from "@/core/context";

import Explorer from "@/ui/explorer";

export default function App() {
    const app = useAppContext();
    return (
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
                        src={app.workspace.app.currentUrl}
                        className="w-full h-full rounded-tl-xl"/>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>);
}
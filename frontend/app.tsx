import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { AppContext, AppContextProvider } from '@/context';
import { buildUrl } from '@/data';
import { Explorer } from '@/explorer';

export function App() {
    console.log('App rerendered.');
    const app = new AppContext();
    return <AppContextProvider value={app}>
        <div className='w-full h-full flex flex-col'>
            <div>header</div>
            <ResizablePanelGroup direction='horizontal'>
                <ResizablePanel defaultSize={20}>
                    <Explorer />
                </ResizablePanel>
                <ResizableHandle className='w-0 my-4'/>
                <ResizablePanel defaultSize={80} className='flex'>
                    <iframe
                        ref={app.viewerRef}
                        src={buildUrl(app.workspace.currentPage)}
                        className='w-full h-full rounded-tl-lg'/>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    </AppContextProvider>;
}

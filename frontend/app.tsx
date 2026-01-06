import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { AppContext, AppContextProvider } from '@/context';
import { Explorer } from '@/explorer';

export function App() {
    console.log('App rerendered.');
    const app = new AppContext();
    return <AppContextProvider value={app}>
        <div className='w-full h-full flex flex-col'>
            <div>header</div>
            <ResizablePanelGroup direction='horizontal'>
                <ResizablePanel defaultSize={25}>
                    <Explorer />
                </ResizablePanel>
                <ResizableHandle className='w-0 my-4'/>
                <ResizablePanel defaultSize={75} className='flex'>
                    <Card className='w-full h-full p-0 rounded-none rounded-tl-lg'>
                        <iframe
                            ref={app.viewerRef}
                            src='https://docs.rs/'
                            className='w-full h-full rounded-tl-lg'/>
                    </Card>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    </AppContextProvider>;
}

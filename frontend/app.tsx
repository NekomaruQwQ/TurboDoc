import { useRef } from 'react';

import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { AppContext, AppContextProvider } from '@/context';
import { Explorer } from '@/explorer';

export function App() {
    console.log('App rerendered.');

    const viewerRef =
        useRef<HTMLIFrameElement | null>(null);
    const appContext =new AppContext(viewerRef,);

    return <AppContextProvider value={appContext}>
        <div className='w-full h-full flex flex-col'>
            <div>header</div>
            <ResizablePanelGroup direction='horizontal'>
                <ResizablePanel defaultSize={25}>
                    <Explorer />
                </ResizablePanel>
                <ResizableHandle className='mx-1 my-4'/>
                <ResizablePanel defaultSize={75} className='flex'>
                    <Card className='w-full h-full p-px rounded-none rounded-tl-xl'>
                        <iframe
                            ref={appContext.viewerRef}
                            src='https://docs.rs/'
                            className='w-full h-full rounded-tl-xl'/>
                    </Card>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    </AppContextProvider>;
}

import type { ReadonlyDeep } from 'type-fest';

import { useState, useEffect, useRef } from 'react';

import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import type { Workspace, Cache } from '@/data';
import { AppContext, AppContextProvider } from '@/context';
import { Explorer } from '@/explorer';

function useAppContext(): AppContext {
    // Create an AppContext instance by composing hooks.
    let viewerRef =
        useRef<HTMLIFrameElement | null>(null);
    let workspaceState =
        useState<ReadonlyDeep<Workspace>>({ groups: [], ungrouped: [] });
    let cacheState =
        useState<ReadonlyDeep<Cache>>({ crates: {} });
    const appContext =
        new AppContext(
            viewerRef,
            workspaceState,
            cacheState);

    // Load workspace and cache once on mount.
    useEffect(() => {
        (async () => {
            try {
                await appContext.load();
            } catch (err) {
                console.error(err);
            }
        })()
    }, []);

    return appContext;
}

export function App() {
    const appContext = useAppContext();
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

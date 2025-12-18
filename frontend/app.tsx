import { useState, useEffect, useRef } from 'react';
import type { Immutable } from 'immer';

import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import type { Workspace, Cache } from '@/data';
import * as IPC from '@/ipc';
import { AppContext, AppContextProvider } from '@/context';
import { Explorer } from '@/explorer';

function useAppContext(): AppContext {
    // Create an AppContext instance by composing hooks.
    let viewerRef =
        useRef<HTMLIFrameElement | null>(null);
    let workspaceState =
        useState<Immutable<Workspace>>({ groups: [], ungrouped: [] });
    let cacheState =
        useState<Immutable<Cache>>({ crates: {} });
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
    useEffect(() => IPC.init(), []);

    const appContext = useAppContext();
    return <AppContextProvider value={appContext}>
        <div className="w-full h-full flex flex-col">
            <div>header</div>
            <ResizablePanelGroup direction='horizontal'>
                <ResizablePanel defaultSize={25}>
                    <Explorer />
                </ResizablePanel>
                <ResizableHandle className='mx-1 my-2'/>
                <ResizablePanel defaultSize={75} className='flex'>
                    <Card className="w-full h-full p-0.5 rounded-none rounded-tl-xl">
                        <iframe
                            ref={appContext.viewerRef}
                            src='https://docs.rs/'
                            className="w-full h-full rounded-tl-xl"/>
                    </Card>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    </AppContextProvider>;
}

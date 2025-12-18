import { useState, useEffect } from 'react';
import type { Immutable } from 'immer';

import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import type { Workspace, Cache } from '@/data';
import * as IPC from '@/ipc';
import { AppContext, AppContextProvider } from '@/context';
import { Explorer } from '@/explorer';

function useAppContext(): AppContext {
    const appContext = new AppContext(
        useState<Immutable<Workspace>>({ groups: [], ungrouped: [] }),
        useState<Immutable<Cache>>({ crates: {} }));

    // Load once on mount.
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
        <div className="flex-1">
            <div>header</div>
            <ResizablePanelGroup direction='horizontal'>
                <ResizablePanel defaultSize={1}>
                    <Explorer />
                </ResizablePanel>
                <ResizableHandle className='mx-1 my-2'/>
                <ResizablePanel defaultSize={3} className='flex'>
                    <Card className="flex-1 p-0.5 rounded-none rounded-tl-xl">
                        <iframe id='iframe' src='https://docs.rs/' className="flex-1 rounded-tl-xl"/>
                    </Card>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    </AppContextProvider>;
}

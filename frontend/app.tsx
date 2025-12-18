import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import type { Workspace } from '@/data';
import { WorkspaceContext } from '@/global';
import { Explorer } from '@/explorer';

const testWorkspace: Workspace = {
    ungrouped: [],
    groups: [
        {
            name: 'default',
            isExpanded: true,
            items: [
                {
                    type: 'crate',
                    data: {
                        name: 'glam',
                        isExpanded: true,
                        versions: [],
                        versionGroups: [],
                        currentVersion: 'latest',
                        pinnedPages: [],
                        currentPage: null,
                    },
                },
            ],
        },
    ],
};

export function App() {
    const [workspace, setWorkspace] = useState<Workspace>(testWorkspace);
    return <>
        <WorkspaceContext.Provider value={[workspace, setWorkspace]}>
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
        </WorkspaceContext.Provider>
    </>;
}

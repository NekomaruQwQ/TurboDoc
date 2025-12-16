import { useContext } from 'react';


import { WorkspaceContext } from '@/global';

export function Explorer() {
    const [workspace, _] = useContext(WorkspaceContext);
    return <>
        {/* <Tree className={css({
            width: '24em',
        })}>
            {workspace.groups.map(group => <>
                <TreeItem itemType='branch'>
                    <TreeItemLayout>
                        {group.name}<br/>
                    </TreeItemLayout>
                </TreeItem>
            </>)}
        </Tree> */}
    </>;
}

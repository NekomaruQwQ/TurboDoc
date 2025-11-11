import { createContext } from 'preact';
import { useState, useContext } from 'preact/hooks';

import { Tree, TreeItem, TreeItemLayout } from '@fluentui/react-components';

import { WorkspaceContext } from '../app';
import {css} from '@emotion/css';

export function Explorer() {
    const [workspace, _] = useContext(WorkspaceContext);
    return <>
        <Tree className={css({
            width: '24em',
        })}>
            {workspace.groups.map(group => <>
                <TreeItem itemType='branch'>
                    <TreeItemLayout>
                        {group.name}<br/>
                    </TreeItemLayout>
                </TreeItem>
            </>)}
        </Tree>
    </>;
}

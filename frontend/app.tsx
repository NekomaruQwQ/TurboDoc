import { createContext } from 'preact';
import { useState } from 'preact/hooks';
import { css } from '@emotion/css';

import { FluentProvider, webDarkTheme } from '@fluentui/react-components';

import type { Workspace } from './data';
import { Explorer } from './explorer';

const test_workspace: Workspace = {
    groups: [
        {
            name: 'default',
            is_expanded: true,
            items: [
                {
                    type: 'crate',
                    data: {
                        name: 'glam',
                        is_expanded: true,
                        versions: [],
                        current_version: 'latest',
                        docs_pages: [],
                        docs_open_page: undefined,
                    },
                },
            ],
        },
    ],
};

export const WorkspaceContext =
    createContext<[Workspace, (value: Workspace) => void]>(undefined!);

export function App() {
    const [workspace, setWorkspace] = useState<Workspace>(test_workspace);
    return <>
        <WorkspaceContext.Provider value={[workspace, setWorkspace]}>
            <FluentProvider theme={webDarkTheme} className={css({
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
            })}>
                <div>header</div>
                <div className={css({
                    display: 'flex',
                    flexDirection: 'row',
                    flex: 1,
                })}>
                    <Explorer />
                    <iframe id='frame' src='https://docs.rs/' className={css({
                        flex: 1,
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        borderThickness: 0.25,
                        borderTopLeftRadius: '8px',
                    })} />
                </div>
            </FluentProvider>
        </WorkspaceContext.Provider>
    </>;
}

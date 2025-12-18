import { useAppContext } from '@/context';

export function Explorer() {
    const appContext = useAppContext();

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

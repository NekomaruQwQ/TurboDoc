import type { ReadonlyDeep } from 'type-fest';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesDown, faAnglesUp } from '@fortawesome/free-solid-svg-icons';

import { Button } from '@/components/ui/button';

import type { Item } from '@/data';
import { useAppContext } from '@/context';

import type { ExplorerItemProps } from '@/explorer/common';
import { CreateGroupComponent, ExplorerGroupActions, ExplorerGroupHeaderCommon } from "@/explorer/components/misc";
import CrateCard from '@/explorer/crate/CrateCard';
import ExplorerGroupHeader from '@/explorer/ExplorerGroupHeader';

export function Explorer() {
    const app = useAppContext();
    return (
        <div className='px-2 w-full h-full'>
            <div
                className='flex flex-col gap-4 py-2 w-full h-full rounded overflow-x-hidden overflow-y-scroll'
                style={{ scrollbarWidth: 'none' }}>
                <ExplorerUngrouped
                    key=':ungrouped:'
                    items={app.workspace.ungrouped}
                    updateItems={updater => app.updateWorkspace(draft => updater(draft.ungrouped))} />
                {app.workspace.groups.map((group, i) => (
                    <ExplorerGroup
                        key={group.name}
                        name={group.name}
                        items={group.items}
                        expanded={group.expanded}
                        groupIndex={i}
                        groupCount={app.workspace.groups.length}
                        setName={name => {
                            app.updateWorkspace(draft => { draft.groups[i]!.name = name; });
                        }}
                        setExpanded={expanded => {
                            app.updateWorkspace(draft => { draft.groups[i]!.expanded = expanded; });
                        }}
                        updateItems={updater => {
                            app.updateWorkspace(draft => updater(draft.groups[i]!.items));
                        }}
                        moveUp={() => {
                            if (i === 0) return;
                            app.updateWorkspace(draft => {
                                const temp = draft.groups[i - 1]!;
                                draft.groups[i - 1] = draft.groups[i]!;
                                draft.groups[i] = temp;
                            });
                        }}
                        moveDown={() => {
                            if (i === app.workspace.groups.length - 1) return;
                            app.updateWorkspace(draft => {
                                const temp = draft.groups[i + 1]!;
                                draft.groups[i + 1] = draft.groups[i]!;
                                draft.groups[i] = temp;
                            });
                        }}
                        removeGroup={() => {
                            app.updateWorkspace(draft => { draft.groups.splice(i, 1); });
                        }} />
                ))}
                <CreateGroupComponent />
            </div>
        </div>);
}

function ExplorerUngrouped(props: ReadonlyDeep<{
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    // Expand/collapse all: if any item is collapsed, show "expand all"
    const anyCollapsed = props.items.some(item => !item.expanded);

    function toggleAll() {
        props.updateItems(items => {
            for (const item of items) {
                item.expanded = anyCollapsed;
            }
        });
    }

    return (
        <div className='flex flex-col gap-1'>
            <ExplorerGroupHeaderCommon title='Ungrouped'>
                <ExplorerGroupActions>
                    <Button
                        variant='ghost'
                        size='icon'
                        className='h-5 w-5'
                        title={anyCollapsed ? 'Expand all' : 'Collapse all'}
                        onClick={toggleAll}>
                        {anyCollapsed
                            ? <FontAwesomeIcon icon={faAnglesDown} size='sm' />
                            : <FontAwesomeIcon icon={faAnglesUp} size='sm' />}
                    </Button>
                </ExplorerGroupActions>
            </ExplorerGroupHeaderCommon>
            <div className='flex flex-col gap-2'>
                <ExplorerItemList
                    expanded={true}
                    items={props.items}
                    updateItems={props.updateItems} />
            </div>
        </div>);
}

function ExplorerGroup(props: ReadonlyDeep<{
    name: string;
    items: Item[];
    expanded: boolean;
    groupIndex: number;
    groupCount: number;
    setName(name: string): void;
    setExpanded(expanded: boolean): void;
    updateItems(updater: (items: Item[]) => void): void;
    moveUp(): void;
    moveDown(): void;
    removeGroup(): void;
}>) {
    const app = useAppContext();

    function expandAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = true;
        });
    }

    function collapseAll() {
        props.updateItems(items => {
            for (const item of items) item.expanded = false;
        });
    }

    function removeGroup() {
        // Move all crates to ungrouped before removing the group
        app.updateWorkspace(draft => {
            const groupItems = props.items as Item[];
            draft.ungrouped.push(...groupItems);
        });
        props.removeGroup();
    }

    return (
        <div className='flex flex-col gap-1'>
            <ExplorerGroupHeader
                name={props.name}
                isFirst={props.groupIndex === 0}
                isLast={props.groupIndex === props.groupCount - 1}
                expandAll={expandAll}
                collapseAll={collapseAll}
                moveUp={props.moveUp}
                moveDown={props.moveDown}
                renameGroup={props.setName}
                removeGroup={removeGroup} />
            <div className='flex flex-col gap-2'>
                <ExplorerItemList
                    expanded={true}
                    items={props.items}
                    updateItems={props.updateItems} />
            </div>
        </div>);
}

function ExplorerItemList(props: ReadonlyDeep<{
    expanded: boolean;
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    return (
        props.expanded && props.items.map((item, i) => (
            <ExplorerItem
                key={getKeyForItem(item)}
                item={item}
                expanded={item.expanded}
                setExpanded={expanded => {
                    props.updateItems(items => { items[i]!.expanded = expanded; });
                }}
                updateItem={updater => {
                    props.updateItems(items => updater(items[i]!));
                }}
                removeItem={() => {
                    props.updateItems(items => { items.splice(i, 1); });
                }} />)))
}

function ExplorerItem(props: ReadonlyDeep<ExplorerItemProps<Item>>) {
    switch (props.item.type) {
        case 'crate':
            return (
                <CrateCard
                    expanded={props.expanded}
                    setExpanded={props.setExpanded}
                    item={props.item.data}
                    updateItem={updater => props.updateItem(draft => updater(draft.data))}
                    removeItem={() => props.removeItem()} />);
        default:
            return null;
    }
}

function getKeyForItem(item: ReadonlyDeep<Item>): string {
    switch (item.type) {
        case 'crate':
            return ':crate:' + item.data.name;
        default:
            console.warn('Unknown item type for key generation:', item);
            return ':unknown:';
    }
}

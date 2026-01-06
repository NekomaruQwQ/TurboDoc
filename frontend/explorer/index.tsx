import type { ReadonlyDeep } from 'type-fest';
import type { ReactNode } from 'react';

import { useAppContext } from '@/context';
import type { Item } from '@/data';
import { CrateCard } from '@/explorer/items/crate';
import type { ExplorerItemProps } from '@/explorer/common';

export function Explorer() {
    const app = useAppContext();
    return <div className='p-2 space-y-4 w-full h-full'>
        <ExplorerUngrouped
            key=':ungrouped:'
            items={app.workspace.ungrouped}
            updateItems={updater => app.updateWorkspace(draft => updater(draft.ungrouped)) } />
        {
            app.workspace.groups.map((group, i) => (
                <ExplorerGroup
                    key={group.name}
                    name={group.name}
                    items={group.items}
                    expanded={group.expanded}
                    setName={name => {
                        app.updateWorkspace(draft => draft.groups[i]!.name = name);
                    }}
                    setExpanded={expanded => {
                        app.updateWorkspace(draft => draft.groups[i]!.expanded = expanded);
                    }}
                    updateItems={updater => {
                        app.updateWorkspace(draft => updater(draft.groups[i]!.items))
                    }}
                    removeGroup={() =>{
                        app.updateWorkspace(draft => {
                            draft.groups.splice(i, 1);
                        });
                    }} />
            ))
        }
    </div>;
}

function ExplorerGroupCommon(props: ReadonlyDeep<{
    title: string;
    items: Item[];
    itemRenderer: (item: ReadonlyDeep<Item>, i: number) => ReactNode;
}>) {
    return (
        <div className='space-y-2'>
            <div>
                <p className='text-muted-foreground text-sm font-semibold uppercase'>{props.title}</p>
            </div>
            {props.items.map((item, i) => props.itemRenderer(item, i))}
        </div>);
}

function ExplorerUngrouped(props: ReadonlyDeep<{
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    const itemRenderer =
        (item: ReadonlyDeep<Item>, i: number) =>
            <ExplorerItem
                key={getKeyForItem(item)}
                item={item}
                expanded={item.expanded}
                setExpanded={expanded => {
                    props.updateItems(items => items[i]!.expanded = expanded)
                }}
                updateItem={updater => {
                    props.updateItems(items => updater(items[i]!));
                }}
                removeItem={() => {
                    props.updateItems(items => items.splice(i, 1))
                }}
            />
    return (
        <ExplorerGroupCommon
            title='Ungrouped'
            items={props.items}
            itemRenderer={itemRenderer} />);
}

function ExplorerGroup(props: ReadonlyDeep<{
    name: string;
    items: Item[];
    expanded: boolean;
    setName(name: string): void;
    setExpanded(expanded: boolean): void;
    updateItems(updater: (items: Item[]) => void): void;
    removeGroup(): void;
}>) {
    const itemRenderer =
        (item: ReadonlyDeep<Item>, i: number) =>
            <ExplorerItem
                key={getKeyForItem(item)}
                item={item}
                expanded={item.expanded}
                setExpanded={expanded => {
                    props.updateItems(items => items[i]!.expanded = expanded);
                }}
                updateItem={updater => {
                    props.updateItems(items => updater(items[i]!));
                }}
                removeItem={() => {
                    props.updateItems(items => items.splice(i, 1));
                }} />;
    return (
        <ExplorerGroupCommon
            title={props.name}
            items={props.items}
            itemRenderer={itemRenderer} />);
}

function ExplorerItem(props: ReadonlyDeep<ExplorerItemProps<Item>>) {
    switch (props.item.type) {
        case 'crate':
            return (
                <CrateCard
                    expanded={props.expanded}
                    setExpanded={props.setExpanded}
                    item={props.item.data}
                    updateItem={updater => props.updateItem(updater as any)}
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

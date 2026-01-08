import type { ReadonlyDeep } from 'type-fest';

import type { ReactNode, ReactElement, MouseEvent, KeyboardEvent } from "react";
import { useState } from 'react';

import { Plus, Check, ChevronsDown, ChevronsUp, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { Item } from '@/data';
import { useAppContext } from '@/context';

import type { ExplorerItemProps } from '@/explorer/common';
import CrateCard from '@/explorer/crate/CrateCard';
import ExplorerGroupMenu from '@/explorer/ExplorerGroupMenu';

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

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
function CreateGroupComponent() {
    const app = useAppContext();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState('');

    function onOK() {
        const inputTrimmed = inputText.trim();
        if (inputTrimmed) {
            app.updateWorkspace(draft => {
                draft.groups.push({
                    name: inputTrimmed,
                    items: [],
                    expanded: true,
                });
            });
        }
        setInputText('');
        setInputMode(false);
    }

    function onCancel() {
        setInputText('');
        setInputMode(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            onOK();
            return;
        }

        if (e.key === 'Escape') {
            onCancel();
            return;
        }
    }

    function ActionButton(props: {
        className?: string;
        children: ReactNode;
        onMouseDown?: (e: MouseEvent) => void;
        onClick?: (e: MouseEvent) => void;
    }) {
        return (
            <Button
                variant='secondary'
                size={'custom' as any}
                className={`border w-7 h-7 cursor-pointer ${props.className}`}
                onMouseDown={props.onMouseDown}
                onClick={props.onClick}>
                {props.children}
            </Button>);
    }

    return (
        <div className='flex flex-row items-center w-full gap-2 mb-2'>
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder='Group name...'
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={onCancel}
                    className='h-7 text-sm' />
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <ActionButton className='w-7' onMouseDown={e => { e.preventDefault(); onOK(); }}>
                    <Check className='h-3 w-3' />
                </ActionButton>
            </> : <>
                {/* Use onClick to avoid (what?) */}
                <ActionButton className='w-full' onClick={() => setInputMode(true)}>
                    <Plus className='h-3 w-3' />
                    <span>Add Group</span>
                </ActionButton>
            </>}
        </div>);
}

function ExplorerGroupCommon(props: ReadonlyDeep<{
    title: string;
    items: Item[];
    /** Optional header actions rendered to the right of the title. */
    children?: ReactElement<{ children: ReactNode }, typeof ExplorerGroupActions>;
    /** Component to render each item. */
    renderItem(item: ReadonlyDeep<Item>, i: number): ReactNode;
}>) {
    const actions = props.children?.props.children ?? null;
    return (
        <div className='flex flex-col gap-2'>
            <div className='group/header flex flex-row items-center gap-1'>
                <p className='text-muted-foreground text-sm font-semibold uppercase'>{props.title}</p>
                <div className='flex-1 flex flex-row items-center justify-end gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity'>
                    {actions}
                </div>
            </div>
            {props.items.map((item, i) => props.renderItem(item, i))}
        </div>);
}

/** Wrapper for group action buttons in the group header. */
function ExplorerGroupActions(props: { children: ReactNode }) {
    return <>{props.children}</>;
}

function ExplorerUngrouped(props: ReadonlyDeep<{
    items: Item[];
    updateItems(updater: (items: Item[]) => void): void;
}>) {
    // Expand/collapse all: if any item is collapsed, show "expand all"
    const anyCollapsed = props.items.some(item => !item.expanded);

    function onToggleAll() {
        props.updateItems(items => {
            for (const item of items) {
                item.expanded = anyCollapsed;
            }
        });
    }

    function renderItem(item: ReadonlyDeep<Item>, i: number) {
        return (
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
            />);
    }

    return (
        <ExplorerGroupCommon
            title='Ungrouped'
            items={props.items}
            renderItem={renderItem}>
            <ExplorerGroupActions>
                {/* Expand/Collapse All */}
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5'
                    title={anyCollapsed ? 'Expand all' : 'Collapse all'}
                    onClick={onToggleAll}>
                    {anyCollapsed ? <ChevronsDown className='h-3 w-3' /> : <ChevronsUp className='h-3 w-3' />}
                </Button>
            </ExplorerGroupActions>
        </ExplorerGroupCommon>);
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

    // Rename state
    const [isRenaming, setIsRenaming] = useState(false);
    const [editedName, setEditedName] = useState(props.name);

    // Expand/collapse all: if any item is collapsed, show "expand all"
    const anyCollapsed = props.items.some(item => !item.expanded);

    function onToggleAll() {
        props.updateItems(items => {
            for (const item of items) {
                item.expanded = anyCollapsed;
            }
        });
    }

    function handleStartRename() {
        setEditedName(props.name);
        setIsRenaming(true);
    }

    function handleRemoveGroup() {
        // Move all crates to ungrouped before removing the group
        app.updateWorkspace(draft => {
            const groupItems = props.items as Item[];
            draft.ungrouped.push(...groupItems);
        });
        props.removeGroup();
    }

    function renderItem(item: ReadonlyDeep<Item>, i: number) {
        return (
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
                }} />);
    }

    // Render with inline rename input or title
    if (isRenaming) {
        function handleConfirmRename() {
            const trimmed = editedName.trim();
            if (trimmed && trimmed !== props.name) {
                props.setName(trimmed);
            }
            setIsRenaming(false);
        }

        function handleCancelRename() {
            setEditedName(props.name);
            setIsRenaming(false);
        }

        function handleRenameKeyDown(e: React.KeyboardEvent) {
            if (e.key === 'Enter') {
                handleConfirmRename();
            } else if (e.key === 'Escape') {
                handleCancelRename();
            }
        }

        return (
            <div className='space-y-2'>
                <div className='flex flex-row items-center gap-1'>
                    <Input
                        value={editedName}
                        onChange={e => setEditedName(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={handleConfirmRename}
                        autoFocus
                        className='h-6 text-sm font-semibold uppercase' />
                    <Button
                        variant='ghost'
                        size='icon'
                        className='h-5 w-5'
                        onClick={handleConfirmRename}>
                        <Check className='h-3 w-3' />
                    </Button>
                </div>
                {props.items.map((item, i) => renderItem(item, i))}
            </div>);
    }

    return (
        <ExplorerGroupCommon
            title={props.name}
            items={props.items}
            renderItem={renderItem}>
            <ExplorerGroupActions>
                {/* Expand/Collapse All */}
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5'
                    title={anyCollapsed ? 'Expand all' : 'Collapse all'}
                    onClick={onToggleAll}>
                    {anyCollapsed ? <ChevronsDown className='h-3 w-3' /> : <ChevronsUp className='h-3 w-3' />}
                </Button>
                {/* Rename */}
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5'
                    title='Rename group'
                    onClick={handleStartRename}>
                    <Pencil className='h-3 w-3' />
                </Button>
                {/* Group Menu */}
                <ExplorerGroupMenu
                    groupName={props.name}
                    isFirst={props.groupIndex === 0}
                    isLast={props.groupIndex === props.groupCount - 1}
                    moveUp={props.moveUp}
                    moveDown={props.moveDown}
                    removeGroup={handleRemoveGroup} />
            </ExplorerGroupActions>
        </ExplorerGroupCommon>);
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

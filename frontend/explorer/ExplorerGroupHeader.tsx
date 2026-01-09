import { useState, type KeyboardEvent } from 'react';

import { Pencil, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ExplorerGroupActions, ExplorerGroupHeaderCommon } from '@/explorer/components/misc';
import ExplorerGroupMenu from '@/explorer/ExplorerGroupMenu';

interface ExplorerGroupHeaderProps {
    name: string;
    isFirst: boolean;
    isLast: boolean;
    expandAll(): void;
    collapseAll(): void;
    moveUp(): void;
    moveDown(): void;
    renameGroup(newName: string): void;
    removeGroup(): void;
}

/**
 * Header for a named group with rename, expand/collapse all, and group menu.
 * Manages its own rename state (inline input).
 */
export default function ExplorerGroupHeader(props: ExplorerGroupHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [editedName, setEditedName] = useState(props.name);

    function beginRename() {
        setEditedName(props.name);
        setIsRenaming(true);
    }

    function confirmRename() {
        const trimmed = editedName.trim();
        if (trimmed && trimmed !== props.name) {
            props.renameGroup(trimmed);
        }
        setIsRenaming(false);
    }

    function cancelRename() {
        setEditedName(props.name);
        setIsRenaming(false);
    }

    function onRenameKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            confirmRename();
        } else if (e.key === 'Escape') {
            cancelRename();
        }
    }

    // Inline rename input mode
    if (isRenaming) {
        return (
            <div className='flex flex-row items-center gap-1'>
                <Input
                    value={editedName}
                    onChange={e => setEditedName(e.target.value)}
                    onKeyDown={onRenameKeyDown}
                    onBlur={confirmRename}
                    autoFocus
                    className='h-6 text-sm font-semibold' />
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5'
                    onClick={confirmRename}>
                    <Check className='h-3 w-3' />
                </Button>
            </div>);
    }

    // Normal header with title and action buttons
    return (
        <ExplorerGroupHeaderCommon title={props.name}>
            <ExplorerGroupActions>
                {/* Rename */}
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5 invisible group-hover/header:visible'
                    title='Rename group'
                    onClick={beginRename}>
                    <Pencil className='h-3 w-3' />
                </Button>
                {/* Group Menu */}
                <ExplorerGroupMenu
                    groupName={props.name}
                    isFirst={props.isFirst}
                    isLast={props.isLast}
                    expandAll={props.expandAll}
                    collapseAll={props.collapseAll}
                    moveUp={props.moveUp}
                    moveDown={props.moveDown}
                    removeGroup={props.removeGroup} />
            </ExplorerGroupActions>
        </ExplorerGroupHeaderCommon>);
}

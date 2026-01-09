import type { KeyboardEvent } from 'react';
import { useState } from 'react';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faAnglesDown,
    faAnglesUp,
    faArrowDown,
    faArrowUp,
    faCheck,
    faEllipsisVertical,
    faPencil,
    faTrash,
} from '@fortawesome/free-solid-svg-icons';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ExplorerGroupHeaderProps {
    /** Name of the group. */
    groupName: string;

    /** Whether the group is frozen (cannot be renamed, moved and deleted). */
    isFrozen?: boolean;

    /** Whether this is the first group (disables "Move up"). */
    isFirst: boolean;

    /** Whether this is the last group (disables "Move down"). */
    isLast: boolean;

    /** Renames the group to the new name. */
    renameGroup(newName: string): void;

    /** Removes the group from the workspace. Should move items to ungrouped and remove the group. */
    removeGroup(): void;

    /** Expand all items in the group. */
    expandAll(): void;

    /** Collapse all items in the group. */
    collapseAll(): void;

    /** Move the group up in the list. */
    moveUp(): void;

    /** Move the group down in the list. */
    moveDown(): void;
}


/**
 * Header for a named group with rename, expand/collapse all, and group menu.
 * Manages its own rename state (inline input).
 */
export default function ExplorerGroupHeader(props: ExplorerGroupHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [editedName, setEditedName] = useState(props.groupName);
    const [showRemoveDialog, setShowRemoveDialog] = useState(false);

    function beginRename() {
        setEditedName(props.groupName);
        setIsRenaming(true);
    }

    function confirmRename() {
        const trimmed = editedName.trim();
        if (trimmed && trimmed !== props.groupName) {
            props.renameGroup(trimmed);
        }
        setIsRenaming(false);
    }

    function cancelRename() {
        setEditedName(props.groupName);
        setIsRenaming(false);
    }

    function onRenameKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            confirmRename();
        } else if (e.key === 'Escape') {
            cancelRename();
        }
    }

    function confirmRemoveGroup() {
        props.removeGroup();
        setShowRemoveDialog(false);
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
                    className='h-6 rounded text-sm font-semibold' />
                <Button
                    variant='secondary'
                    size='icon'
                    className='size-6 rounded'
                    onClick={confirmRename}>
                    <FontAwesomeIcon icon={faCheck} size='sm' />
                </Button>
            </div>);
    }

    return (
        <div className='group/header flex flex-row h-6 items-center px-0.5 gap-0.5 text-muted-foreground'>
            {/* Group name */}
            <p className='flex-1 text-sm font-semibold uppercase'>{props.groupName}</p>
            {/* Rename button*/}
            {!props.isFrozen && (
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5 rounded invisible group-hover/header:visible'
                    title='Rename group'
                    onClick={beginRename}>
                    <FontAwesomeIcon icon={faPencil} size='sm' />
                </Button>)
            }
            {/* Group Menu */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant='ghost'
                        size='icon'
                        className='h-5 w-5 rounded'>
                        <FontAwesomeIcon icon={faEllipsisVertical} size='sm' />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                    <DropdownMenuItem onClick={props.expandAll}>
                        <FontAwesomeIcon icon={faAnglesDown} size='sm' />
                        <span>Expand all</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={props.collapseAll}>
                        <FontAwesomeIcon icon={faAnglesUp} size='sm' />
                        <span>Collapse all</span>
                    </DropdownMenuItem>
                    {!props.isFrozen && <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={props.isFirst}
                            onClick={props.moveUp}>
                            <FontAwesomeIcon icon={faArrowUp} size='sm' />
                            <span>Move up</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={props.isLast}
                            onClick={props.moveDown}>
                            <FontAwesomeIcon icon={faArrowDown} size='sm' />
                            <span>Move down</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant='destructive'
                            onClick={() => setShowRemoveDialog(true)}>
                            <FontAwesomeIcon icon={faTrash} size='sm' />
                            <span>Remove group</span>
                        </DropdownMenuItem>
                    </>}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Delete Confirmation Dialog */}
            <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Delete group?</DialogTitle>
                        <DialogDescription>
                            This will remove the group "{props.groupName}".
                            Crates in this group will be moved to Ungrouped.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant='outline' onClick={() => setShowRemoveDialog(false)}>Cancel</Button>
                        <Button variant='destructive' onClick={confirmRemoveGroup}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>);
}

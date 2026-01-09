import { useState } from 'react';

import { MoreVertical, ChevronUp, ChevronDown, ChevronsDown, ChevronsUp, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

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

interface ExplorerGroupMenuProps {
    groupName: string;
    /** Whether this is the first group (disables "Move up"). */
    isFirst: boolean;
    /** Whether this is the last group (disables "Move down"). */
    isLast: boolean;
    expandAll(): void;
    collapseAll(): void;
    moveUp(): void;
    moveDown(): void;
    /** Called after user confirms deletion. Should move items to ungrouped and remove the group. */
    removeGroup(): void;
}

/**
 * Dropdown menu for group actions: move up/down, remove.
 * Remove shows a confirmation dialog before executing.
 */
export default function ExplorerGroupMenu(props: ExplorerGroupMenuProps) {
    const [showRemoveDialog, setShowRemoveDialog] = useState(false);

    function handleConfirmDelete() {
        props.removeGroup();
        setShowRemoveDialog(false);
    }

    return <>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-5 w-5'>
                    <MoreVertical className='h-3 w-3' />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={props.expandAll}>
                    <ChevronsDown className='h-3 w-3' />
                    <span>Expand all</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={props.collapseAll}>
                    <ChevronsUp className='h-3 w-3' />
                    <span>Collapse all</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={props.isFirst}
                    onClick={props.moveUp}>
                    <ChevronUp className='h-3 w-3' />
                    <span>Move up</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={props.isLast}
                    onClick={props.moveDown}>
                    <ChevronDown className='h-3 w-3' />
                    <span>Move down</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant='destructive'
                    onClick={() => setShowRemoveDialog(true)}>
                    <Trash2 className='h-3 w-3' />
                    <span>Remove group</span>
                </DropdownMenuItem>
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
                    <Button variant='destructive' onClick={handleConfirmDelete}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>;
}
